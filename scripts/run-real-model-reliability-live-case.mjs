#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { SketchUpBridge } from '../src/bridge.mjs';
import {
  cleanupReliabilityQueueArtifacts,
  DEFAULT_RELIABILITY_MANIFEST,
  installReliabilityInterruptCleanup,
  preflightLiveCorpus,
  reliabilityActivationSettleMs,
  runQueueCorpus
} from './run-real-model-reliability-harness.mjs';

export const REAL_MODEL_RELIABILITY_LIVE_CASE_REPORT_VERSION = 'real-model-reliability-live-case-report.v1';
export const REAL_MODEL_RELIABILITY_LIVE_PREPARATION_VERSION = 'real-model-reliability-live-case-preparation.v1';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function runRealModelReliabilityLiveCase({
  caseId,
  runtime = 'queue',
  queueRequired = false,
  timeoutMs = 240000,
  activationSettleMs = 0,
  prepareOnly = false,
  activeWorkingCopy,
  outputDir,
  manifestPath = DEFAULT_RELIABILITY_MANIFEST,
  liveArtifactRoot,
  installSignalHandlers = true,
  cleanupOptions = {},
  preflightHooks = {}
} = {}) {
  assert(typeof caseId === 'string' && caseId.trim(), '--case is required');
  assert(typeof liveArtifactRoot === 'string' && liveArtifactRoot.trim(), '--live-artifact-root is required');
  assert(Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0, 'timeoutMs must be a positive number');
  assert(typeof prepareOnly === 'boolean', 'prepareOnly must be boolean');
  if (prepareOnly) {
    assert(!activeWorkingCopy, '--active-working-copy cannot be combined with --prepare-only');
  } else {
    assert(runtime === 'queue', 'single real-model live case runner requires --runtime queue');
    assert(queueRequired === true, 'single real-model live case requires explicit --runtime queue --queue-required');
  }
  activationSettleMs = reliabilityActivationSettleMs(activationSettleMs);

  const absoluteManifestPath = resolveRepoPath(manifestPath);
  const manifest = await readAndValidate(
    absoluteManifestPath,
    path.join(repoRoot, 'schema/real-model-reliability-corpus-v1.schema.json'),
    'real-model reliability corpus manifest'
  );
  const matches = manifest.cases.filter((entry) => entry.id === caseId);
  assert(matches.length === 1, `unknown or duplicate reliability case: ${caseId}`);
  const selectedCase = matches[0];
  const absoluteOutputDir = path.resolve(outputDir || `output/live-validation/real-model-reliability/${caseId}`);
  await fs.mkdir(absoluteOutputDir, { recursive: true });
  const selectedManifest = { ...manifest, cases: [selectedCase] };
  let preflight = await preflightLiveCorpus({
    manifest: selectedManifest,
    liveArtifactRoot,
    outputDir: absoluteOutputDir,
    hooks: preflightHooks
  });
  if (prepareOnly) {
    const prepared = preflight[0];
    const preparationPath = path.join(absoluteOutputDir, 'real-model-reliability-live-case-preparation.v1.json');
    const [workingCopySha256, contractSha256] = await Promise.all([
      stablePreparedWorkingCopySha256(prepared.working_path, {
        allowedRoot: path.join(absoluteOutputDir, 'live-work'),
        label: 'Prepared live working copy'
      }),
      sha256File(prepared.contract_path)
    ]);
    assert(workingCopySha256 === prepared.sha256, 'prepared working copy hash differs from the hash-bound source');
    const preparation = {
      version: REAL_MODEL_RELIABILITY_LIVE_PREPARATION_VERSION,
      kind: 'real_model_reliability_live_case_preparation',
      ok: true,
      queue_called: false,
      selected_case: {
        case_id: selectedCase.id,
        domain: selectedCase.domain,
        artifact_file: selectedCase.live.artifact,
        contract_file: selectedCase.live.contract
      },
      artifacts: {
        source_artifact: repoRelativeOrRedacted(prepared.artifact_path),
        source_sha256: prepared.sha256,
        working_copy: repoRelativeOrRedacted(prepared.working_path),
        working_copy_sha256: workingCopySha256,
        contract: repoRelativeOrRedacted(prepared.contract_path),
        contract_sha256: contractSha256
      },
      next_action: {
        action: 'launch_working_copy_as_only_sketchup_document_then_run_active_prepared_case',
        cli_flag: '--active-working-copy',
        requires_plugin_start: true,
        note: 'Preparation is filesystem-only. No queue request was created and no SketchUp model was opened.'
      }
    };
    await validatePreparation(preparation);
    await fs.writeFile(preparationPath, `${JSON.stringify(preparation, null, 2)}\n`, 'utf8');
    return {
      preparation,
      preparation_path: preparationPath,
      launch_path: prepared.working_path
    };
  }

  let activePreparedModel = false;
  if (activeWorkingCopy) {
    const generated = preflight[0];
    const activePrepared = await validateActivePreparedWorkingCopy({
      prepared: generated,
      requestedPath: activeWorkingCopy,
      outputDir: absoluteOutputDir
    });
    const generatedWorkingRoot = path.dirname(generated.case_dir);
    if (!isWithin(generatedWorkingRoot, activePrepared.working_path)) {
      await fs.rm(generatedWorkingRoot, { recursive: true, force: true });
    }
    preflight = [activePrepared];
    activePreparedModel = true;
  }
  process.stderr.write([
    '',
    '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
    `[DANGER] REAL-MODEL RELIABILITY LIVE CASE: ${caseId}`,
    activePreparedModel
      ? 'This run WILL modify the already-active hash-bound disposable copy, save, and'
      : 'This run WILL open, modify when the selected task requires it, save, and',
    activePreparedModel
      ? 'reopen it. No initial open_model request will create another SketchUp window.'
      : 'reopen a hash-bound disposable copy in the current SketchUp session.',
    '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
    ''
  ].join('\n'));

  const uninstallCleanup = installSignalHandlers
    ? installReliabilityInterruptCleanup({ cleanupOptions })
    : () => {};
  try {
    const execution = await runQueueCorpus({
      manifest: selectedManifest,
      preflight,
      outputDir: absoluteOutputDir,
      timeoutMs: Number(timeoutMs),
      activationSettleMs,
      activePreparedModel
    });
    assert(execution.results.length === 1, 'single-case execution returned an unexpected result count');
    const result = execution.results[0];
    const bridge = new SketchUpBridge({});
    const diagnostics = await bridge.queue_diagnostics({ timeoutMs: Number(timeoutMs) });
    const queueClean = {
      queue: diagnostics.queue.count,
      processing: diagnostics.processing.count,
      responses: diagnostics.responses.count,
      lock: diagnostics.lock.exists
    };
    assert(Object.values(queueClean).every((value) => value === 0 || value === false), 'queue residue remained after single-case execution');

    if (result.ok !== true) {
      const failurePath = path.join(absoluteOutputDir, 'real-model-reliability-live-case-failure.v1.json');
      await fs.writeFile(failurePath, `${JSON.stringify({
        version: 'real-model-reliability-live-case-failure.v1',
        kind: 'real_model_reliability_live_case_failure',
        ok: false,
        runtime: 'queue',
        evidence_scope: 'user_authorized_single_hash_bound_live_case',
        selected_case: {
          case_id: selectedCase.id,
          domain: selectedCase.domain,
          tasks: selectedCase.tasks
        },
        runtime_attestation: execution.runtime,
        result,
        queue_clean: queueClean,
        acceptance: {
          selected_case_passed: false,
          formal_corpus_complete: false,
          release_acceptance: false
        }
      }, null, 2)}\n`, 'utf8');
      throw new Error(`${result.error || `${caseId} failed`}\nFailure artifact: ${failurePath}`);
    }
    const tasksPassed = result.tasks.filter((task) => task.status === 'passed').length;
    assert(tasksPassed === selectedCase.tasks.length, `${caseId} did not pass every declared task`);

    const prepared = preflight[0];
    const verifiedModelPath = path.join(prepared.case_dir, `${caseId}.verified.skp`);
    const [sourceSha256, workingCopySha256, verifiedModelSha256, contractSha256, verifiedStats] = await Promise.all([
      sha256File(prepared.artifact_path),
      sha256File(prepared.working_path),
      sha256File(verifiedModelPath),
      sha256File(prepared.contract_path),
      fs.stat(verifiedModelPath)
    ]);
    assert(sourceSha256 === prepared.sha256, 'external source bytes changed after the live case');
    assert(workingCopySha256 === prepared.sha256, 'disposable working input bytes changed unexpectedly');

    const counters = execution.counters;
    const recoveryRate = counters.recovery_attempts ? counters.recoveries / counters.recovery_attempts : 1;
    const reportPath = path.join(absoluteOutputDir, 'real-model-reliability-live-case-report.v1.json');
    const report = {
      version: REAL_MODEL_RELIABILITY_LIVE_CASE_REPORT_VERSION,
      kind: 'real_model_reliability_live_case_report',
      ok: true,
      runtime: 'queue',
      evidence_scope: 'user_authorized_single_hash_bound_live_case',
      full_manifest: {
        version: manifest.version,
        path: repoRelativeOrRedacted(absoluteManifestPath),
        sha256: await sha256File(absoluteManifestPath),
        case_count: manifest.cases.length
      },
      selected_case: {
        case_id: selectedCase.id,
        domain: selectedCase.domain,
        task_count: selectedCase.tasks.length,
        artifact_file: selectedCase.live.artifact,
        contract_file: selectedCase.live.contract
      },
      runtime_attestation: execution.runtime,
      safety: {
        explicit_queue_opt_in: true,
        ephemeral_operator_policy: true,
        default_policy_unchanged: true,
        preflight_before_queue: true,
        disposable_copy_only: true,
        original_bytes_unchanged: true,
        interrupt_cleanup_enabled: installSignalHandlers === true
      },
      metrics: {
        tasks_total: selectedCase.tasks.length,
        tasks_passed: tasksPassed,
        task_success_rate: tasksPassed / selectedCase.tasks.length,
        wrong_object_modification_count: counters.wrong_object_modifications,
        silent_geometry_corruption_count: counters.silent_geometry_corruption,
        recovery_attempts: counters.recovery_attempts,
        recoveries: counters.recoveries,
        recovery_rate: recoveryRate
      },
      result,
      queue_clean: queueClean,
      artifacts: {
        source_artifact: repoRelativeOrRedacted(prepared.artifact_path),
        source_sha256: sourceSha256,
        working_copy: repoRelativeOrRedacted(prepared.working_path),
        working_copy_sha256: workingCopySha256,
        verified_model: repoRelativeOrRedacted(verifiedModelPath),
        verified_model_sha256: verifiedModelSha256,
        verified_model_bytes: verifiedStats.size,
        contract: repoRelativeOrRedacted(prepared.contract_path),
        contract_sha256: contractSha256,
        report: repoRelativeOrRedacted(reportPath)
      },
      acceptance: {
        selected_case_passed: true,
        formal_corpus_cases_passed: 1,
        formal_corpus_cases_total: manifest.cases.length,
        formal_corpus_complete: false,
        cross_version: 'deferred_by_user',
        release_acceptance: false
      }
    };
    await validateReport(report);
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return { report, report_path: reportPath };
  } finally {
    uninstallCleanup();
    await cleanupReliabilityQueueArtifacts(process.pid, cleanupOptions);
  }
}

async function readAndValidate(valuePath, schemaPath, label) {
  const [value, schema] = await Promise.all([
    fs.readFile(valuePath, 'utf8').then(JSON.parse),
    fs.readFile(schemaPath, 'utf8').then(JSON.parse)
  ]);
  const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
  assert(validate(value), `${label} is invalid: ${JSON.stringify(validate.errors)}`);
  return value;
}

async function validateReport(report) {
  const schema = JSON.parse(await fs.readFile(path.join(repoRoot, 'schema/real-model-reliability-live-case-report-v1.schema.json'), 'utf8'));
  const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
  assert(validate(report), `single-case live report is invalid: ${JSON.stringify(validate.errors)}`);
}

async function validatePreparation(preparation) {
  const schema = JSON.parse(await fs.readFile(path.join(repoRoot, 'schema/real-model-reliability-live-case-preparation-v1.schema.json'), 'utf8'));
  const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
  assert(validate(preparation), `single-case live preparation is invalid: ${JSON.stringify(validate.errors)}`);
}

export async function validateActivePreparedWorkingCopy({
  prepared,
  requestedPath,
  outputDir
}) {
  assert(prepared && typeof prepared === 'object', 'prepared live case is required');
  assert(typeof requestedPath === 'string' && requestedPath.trim(), '--active-working-copy requires a path');
  const allowedRoot = path.join(path.resolve(outputDir), 'live-work');
  const workingPath = path.resolve(requestedPath);
  assert(isWithin(allowedRoot, workingPath), '--active-working-copy must remain inside the selected output directory live-work root');
  const workingSha256 = await stablePreparedWorkingCopySha256(workingPath, {
    allowedRoot,
    label: 'Active prepared working copy'
  });
  assert(workingSha256 === prepared.sha256, 'active prepared working copy hash differs from the hash-bound source');
  const [workingRealPath, sourceRealPath] = await Promise.all([
    fs.realpath(workingPath),
    fs.realpath(prepared.artifact_path)
  ]);
  assert(workingRealPath !== sourceRealPath, 'active prepared working copy must not be the source artifact');
  const caseDir = path.dirname(workingPath);
  const verifiedPath = path.join(caseDir, `${prepared.corpus_case.id}.verified.skp`);
  const verifiedStats = await fs.lstat(verifiedPath).catch(() => null);
  assert(!verifiedStats, 'active prepared case directory already contains a verified model; overwrite is forbidden');
  return {
    ...prepared,
    working_path: workingPath,
    case_dir: caseDir
  };
}

async function stablePreparedWorkingCopySha256(filePath, { allowedRoot, label }) {
  const rootPath = path.resolve(allowedRoot);
  const rootStats = await fs.lstat(rootPath).catch(() => null);
  assert(rootStats?.isDirectory() && !rootStats.isSymbolicLink(), `${label} root must be a real directory`);
  const rootRealPath = await fs.realpath(rootPath);
  const resolvedPath = path.resolve(filePath);
  assert(isWithin(rootPath, resolvedPath), `${label} escapes its allowed root`);
  const beforePath = await fs.lstat(resolvedPath, { bigint: true }).catch(() => null);
  assert(beforePath?.isFile() && !beforePath.isSymbolicLink(), `${label} must be a regular non-symlink file`);
  const beforeRealPath = await fs.realpath(resolvedPath);
  assert(isWithin(rootRealPath, beforeRealPath), `${label} real path escapes its allowed root`);
  const handle = await fs.open(resolvedPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const beforeHandle = await handle.stat({ bigint: true });
    assert(sameFileIdentityAndSize(beforePath, beforeHandle), `${label} changed while being opened`);
    const hash = crypto.createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) hash.update(chunk);
    const [afterHandle, afterPath, afterRealPath] = await Promise.all([
      handle.stat({ bigint: true }),
      fs.lstat(resolvedPath, { bigint: true }).catch(() => null),
      fs.realpath(resolvedPath).catch(() => null)
    ]);
    assert(afterPath?.isFile() && !afterPath.isSymbolicLink(), `${label} changed type while being hashed`);
    assert(afterRealPath && isWithin(rootRealPath, afterRealPath), `${label} real path escaped while being hashed`);
    assert(sameFileIdentityAndSize(beforeHandle, afterHandle), `${label} descriptor changed while being hashed`);
    assert(sameFileIdentityAndSize(beforeHandle, afterPath), `${label} path was replaced while being hashed`);
    assert(
      beforeHandle.mtimeNs === afterHandle.mtimeNs && beforeHandle.ctimeNs === afterHandle.ctimeNs,
      `${label} timestamps changed while being hashed`
    );
    return `sha256:${hash.digest('hex')}`;
  } finally {
    await handle.close();
  }
}

function sameFileIdentityAndSize(left, right) {
  return Boolean(left && right)
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size;
}

async function sha256File(filePath) {
  const bytes = await fs.readFile(filePath);
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function repoRelativeOrRedacted(filePath) {
  const relative = path.relative(repoRoot, path.resolve(filePath));
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative
    : `<external>/${path.basename(filePath)}`;
}

function isWithin(root, candidate) {
  const absoluteRoot = path.resolve(root);
  const absoluteCandidate = path.resolve(candidate);
  return absoluteCandidate === absoluteRoot || absoluteCandidate.startsWith(`${absoluteRoot}${path.sep}`);
}

function resolveRepoPath(value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(repoRoot, value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(argv) {
  const options = {};
  const takeValue = (index, name) => {
    const value = argv[index + 1];
    if (value === undefined || value === '' || value.startsWith('--')) throw new Error(`${name} requires a value`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--case') options.caseId = takeValue(index++, arg);
    else if (arg === '--runtime') options.runtime = takeValue(index++, arg);
    else if (arg === '--queue-required') options.queueRequired = true;
    else if (arg === '--timeout-ms') options.timeoutMs = Number(takeValue(index++, arg));
    else if (arg === '--activation-settle-ms') options.activationSettleMs = Number(takeValue(index++, arg));
    else if (arg === '--prepare-only') options.prepareOnly = true;
    else if (arg === '--active-working-copy') options.activeWorkingCopy = takeValue(index++, arg);
    else if (arg === '--output-dir') options.outputDir = takeValue(index++, arg);
    else if (arg === '--manifest') options.manifestPath = takeValue(index++, arg);
    else if (arg === '--live-artifact-root') options.liveArtifactRoot = takeValue(index++, arg);
    else if (arg === '--help' || arg === '-h') return usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  process.stdout.write([
    'Usage:',
    '  node scripts/run-real-model-reliability-live-case.mjs --prepare-only --case <case-id> --live-artifact-root <root> --output-dir <dir>',
    '  node scripts/run-real-model-reliability-live-case.mjs --runtime queue --queue-required --case <case-id> --live-artifact-root <root> [--output-dir <dir>] [--timeout-ms 240000] [--activation-settle-ms 0] [--active-working-copy <path>]',
    ''
  ].join('\n'));
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runRealModelReliabilityLiveCase(parseArgs(process.argv.slice(2)))
    .then(({ report, report_path: reportPath, preparation, preparation_path: preparationPath, launch_path: launchPath }) => {
      const output = report
        ? { ...report, artifact: reportPath }
        : { ...preparation, artifact: preparationPath, launch_path: launchPath };
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}
