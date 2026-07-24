import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { preflightLiveCorpus } from '../scripts/run-real-model-reliability-harness.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harnessPath = path.join(repoRoot, 'scripts/run-real-model-reliability-harness.mjs');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-real-model-reliability-'));

try {
  const stateDir = path.join(root, 'default-mock-state');
  const outputDir = path.join(root, 'default-mock-output');
  const baseEnv = {
    ...process.env,
    ALMA_SKETCHUP_STATE_DIR: stateDir,
    ALMA_SKETCHUP_AGENT_ALLOWED_RUNTIMES: 'mock',
    ALMA_SKETCHUP_AGENT_ALLOW_QUEUE_MUTATION: '0',
    ALMA_SKETCHUP_ALLOW_DIRECT_EXPERT_QUEUE_MUTATION: '0'
  };
  delete baseEnv.ALMA_SKETCHUP_QUEUE_DIR;
  delete baseEnv.ALMA_SKETCHUP_RESPONSE_DIR;
  delete baseEnv.ALMA_SKETCHUP_PROCESSING_DIR;

  const defaultRun = await run(process.execPath, [harnessPath, '--output-dir', outputDir], { env: baseEnv });
  assert.equal(defaultRun.code, 0, defaultRun.stderr);
  const report = JSON.parse(await fs.readFile(path.join(outputDir, 'real-model-reliability-report.v1.json'), 'utf8'));
  assert.equal(report.ok, true);
  assert.equal(report.runtime, 'mock', 'the reliability harness must default to mock');
  assert.equal(report.evidence_scope, 'deterministic_mock_only');
  assert.equal(report.live_queue_called, false, 'the default harness must not call the live queue');
  assert.equal(report.manifest.repository_tracked_skp_count, 0);
  assert.equal(report.manifest.external_live_artifacts_verified, 0);
  assert.equal(report.safety.explicit_queue_opt_in, false);
  assert.equal(report.safety.active_model_mutation_warning_emitted, false);
  assert.equal(report.corpus_cases, 7);
  assert.equal(report.passed_cases, 7);
  assert.deepEqual(report.tasks, { total: 23, passed: 23, failed: 0 });
  assert.deepEqual(report.metrics, {
    task_success_rate: 1,
    wrong_object_modification_count: 0,
    silent_geometry_corruption_count: 0,
    recovery_attempts: 2,
    recoveries: 2,
    recovery_rate: 1
  });
  assert.equal(Object.values(report.coverage).every((entry) => entry.status === 'passed'), true);
  assert.deepEqual(new Set(report.results.map((entry) => entry.domain)), new Set([
    'architecture', 'interior', 'product', 'shared_component', 'imported_cad', 'appearance', 'transform_edge_case'
  ]));
  assert.equal(await exists(path.join(stateDir, 'queue')), false, 'the default command must not create a queue directory');
  assert.equal(await exists(path.join(stateDir, 'queue-runtime.lock')), false, 'the default command must not create a queue lock');

  const missingQueueFlag = await run(process.execPath, [
    harnessPath, '--runtime', 'queue', '--output-dir', path.join(root, 'missing-flag-output')
  ], { env: baseEnv });
  assert.notEqual(missingQueueFlag.code, 0);
  assert.match(missingQueueFlag.stderr, /requires explicit --runtime queue --queue-required/);
  assert.equal(await exists(path.join(stateDir, 'queue')), false, 'missing --queue-required must fail before queue transport');

  const missingExternalCorpus = await run(process.execPath, [
    harnessPath,
    '--runtime', 'queue',
    '--queue-required',
    '--live-artifact-root', path.join(root, 'missing-live-corpus'),
    '--output-dir', path.join(root, 'missing-corpus-output')
  ], { env: baseEnv });
  assert.notEqual(missingExternalCorpus.code, 0);
  assert.match(missingExternalCorpus.stderr, /Live reliability artifact root is missing|Live contract architecture-golden is invalid or missing|External live artifact is missing/);
  assert.doesNotMatch(missingExternalCorpus.stderr, /REAL-MODEL RELIABILITY LIVE GATE/, 'warning/transport phase must not start before complete preflight');
  assert.equal(await exists(path.join(stateDir, 'queue')), false, 'external corpus preflight must finish before queue transport');
  assert.equal(await exists(path.join(stateDir, 'queue-runtime.lock')), false);

  const artifactSymlinkRoot = path.join(root, 'artifact-symlink-live-corpus');
  await makeCompleteHashBoundCorpus(artifactSymlinkRoot);
  const outsideArtifact = path.join(root, 'outside-architecture.skp');
  await fs.writeFile(outsideArtifact, 'external-live-placeholder:architecture-golden', 'utf8');
  await fs.rm(path.join(artifactSymlinkRoot, 'architecture-building.skp'));
  await fs.symlink(outsideArtifact, path.join(artifactSymlinkRoot, 'architecture-building.skp'));
  const artifactSymlink = await run(process.execPath, [
    harnessPath,
    '--runtime', 'queue',
    '--queue-required',
    '--live-artifact-root', artifactSymlinkRoot,
    '--output-dir', path.join(root, 'artifact-symlink-output')
  ], { env: baseEnv });
  assert.notEqual(artifactSymlink.code, 0);
  assert.match(artifactSymlink.stderr, /External live artifact architecture-golden must not be a symbolic link/);
  assert.doesNotMatch(artifactSymlink.stderr, /REAL-MODEL RELIABILITY LIVE GATE/);
  assert.equal(await exists(path.join(stateDir, 'queue')), false);

  const sidecarSymlinkRoot = path.join(root, 'sidecar-symlink-live-corpus');
  await makeCompleteHashBoundCorpus(sidecarSymlinkRoot);
  const sidecarPath = path.join(sidecarSymlinkRoot, 'architecture-building.reliability.json');
  const outsideSidecar = path.join(root, 'outside-architecture.reliability.json');
  await fs.rename(sidecarPath, outsideSidecar);
  await fs.symlink(outsideSidecar, sidecarPath);
  const sidecarSymlink = await run(process.execPath, [
    harnessPath,
    '--runtime', 'queue',
    '--queue-required',
    '--live-artifact-root', sidecarSymlinkRoot,
    '--output-dir', path.join(root, 'sidecar-symlink-output')
  ], { env: baseEnv });
  assert.notEqual(sidecarSymlink.code, 0);
  assert.match(sidecarSymlink.stderr, /Live contract architecture-golden is invalid or missing: Live contract architecture-golden must not be a symbolic link/);
  assert.doesNotMatch(sidecarSymlink.stderr, /REAL-MODEL RELIABILITY LIVE GATE/);
  assert.equal(await exists(path.join(stateDir, 'queue')), false);

  const swapRoot = path.join(root, 'file-swap-live-corpus');
  await makeCompleteHashBoundCorpus(swapRoot);
  const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, 'test/reliability-corpus/manifest.json'), 'utf8'));
  let swapped = false;
  await assert.rejects(
    preflightLiveCorpus({
      manifest,
      liveArtifactRoot: swapRoot,
      outputDir: path.join(root, 'file-swap-output'),
      hooks: {
        async afterOpen({ label, file_path: filePath }) {
          if (swapped || label !== 'External live artifact architecture-golden') return;
          swapped = true;
          const displaced = `${filePath}.opened-inode`;
          await fs.rename(filePath, displaced);
          await fs.writeFile(filePath, 'external-live-placeholder:architecture-golden', 'utf8');
        }
      }
    }),
    /path was replaced while being read/
  );
  assert.equal(swapped, true);
  assert.equal(await exists(path.join(stateDir, 'queue')), false, 'file-swap preflight must not call queue transport');

  const completeCorpusRoot = path.join(root, 'complete-hash-bound-live-corpus');
  await makeCompleteHashBoundCorpus(completeCorpusRoot);
  const deniedByPolicy = await run(process.execPath, [
    harnessPath,
    '--runtime', 'queue',
    '--queue-required',
    '--live-artifact-root', completeCorpusRoot,
    '--output-dir', path.join(root, 'policy-denied-output')
  ], { env: baseEnv });
  assert.notEqual(deniedByPolicy.code, 0);
  assert.match(deniedByPolicy.stderr, /REAL-MODEL RELIABILITY LIVE GATE/);
  assert.match(deniedByPolicy.stderr, /denied by execution policy/);
  assert.equal(await exists(path.join(stateDir, 'queue')), false, 'Agent/CLI flags must not override server execution policy');
  assert.equal(await exists(path.join(stateDir, 'queue-runtime.lock')), false);

  const hashMismatchRoot = path.join(root, 'hash-mismatch-live-corpus');
  await fs.mkdir(hashMismatchRoot, { recursive: true });
  await fs.writeFile(path.join(hashMismatchRoot, 'architecture-building.skp'), 'external-live-placeholder', 'utf8');
  await fs.writeFile(path.join(hashMismatchRoot, 'architecture-building.reliability.json'), `${JSON.stringify({
    version: 'real-model-reliability-live-case.v1',
    kind: 'real_model_reliability_live_case',
    case_id: 'architecture-golden',
    artifact_file: 'architecture-building.skp',
    artifact_sha256: `sha256:${'0'.repeat(64)}`,
    targets: {},
    expectations: {
      minimum_entities: 1,
      minimum_recursive_entities: 1,
      minimum_scenes: 0,
      required_materials: [],
      uv_target_roles: [],
      hidden_target_roles: [],
      minimum_shared_occurrences: 0,
      boolean_operation: null
    }
  }, null, 2)}\n`, 'utf8');
  const hashMismatch = await run(process.execPath, [
    harnessPath,
    '--runtime', 'queue',
    '--queue-required',
    '--live-artifact-root', hashMismatchRoot,
    '--output-dir', path.join(root, 'hash-mismatch-output')
  ], { env: baseEnv });
  assert.notEqual(hashMismatch.code, 0);
  assert.match(hashMismatch.stderr, /Live artifact sha256 mismatch for architecture-golden/);
  assert.doesNotMatch(hashMismatch.stderr, /REAL-MODEL RELIABILITY LIVE GATE/, 'hash mismatch must stop before warning/transport phase');
  assert.equal(await exists(path.join(stateDir, 'queue')), false, 'hash mismatch must fail before queue transport');
  assert.equal(await exists(path.join(stateDir, 'queue-runtime.lock')), false);

  const tracked = await run('git', ['ls-files', '--', '*.skp', '*.skb']);
  assert.equal(tracked.code, 0, tracked.stderr);
  assert.equal(tracked.stdout.trim(), '', 'the repository must not claim generated/untracked SKP files as live corpus evidence');

  const interruption = await verifySignalCleanup(root);
  assert.equal(interruption.queue_runtime_called, false, 'the interrupt cleanup fixture must never call queue transport');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    default_runtime: report.runtime,
    live_queue_called: report.live_queue_called,
    cases: `${report.passed_cases}/${report.corpus_cases}`,
    tasks: `${report.tasks.passed}/${report.tasks.total}`,
    metrics: report.metrics,
    repository_tracked_skp_count: 0,
    external_live_status: 'not_run_external_live_required',
    queue_opt_in_fail_closed: true,
    external_preflight_before_queue: true,
    hash_mismatch_fail_closed: true,
    artifact_symlink_fail_closed: true,
    sidecar_symlink_fail_closed: true,
    file_swap_fail_closed: true,
    execution_policy_fail_closed: true,
    interrupt_cleanup: interruption
  }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

async function makeCompleteHashBoundCorpus(targetRoot) {
  const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, 'test/reliability-corpus/manifest.json'), 'utf8'));
  await fs.mkdir(targetRoot, { recursive: true });
  for (const corpusCase of manifest.cases) {
    const content = `external-live-placeholder:${corpusCase.id}`;
    await fs.writeFile(path.join(targetRoot, corpusCase.live.artifact), content, 'utf8');
    const targets = {};
    const bind = (role) => { targets[role] = { persistent_id: `${corpusCase.id}:${role}` }; };
    if (corpusCase.tasks.includes('boolean_manifold')) {
      bind('boolean_target');
      bind('boolean_tool');
    }
    if (corpusCase.tasks.includes('abnormal_topology_detection')) bind('repair_target');
    if (corpusCase.tasks.includes('locked_fail_closed')) {
      bind('locked_target');
      bind('guard_target');
      bind('transform_target');
    }
    const uvTargetRoles = corpusCase.tasks.includes('uv_material_preservation') ? ['uv_target'] : [];
    const hiddenTargetRoles = corpusCase.id === 'appearance-scenes-hidden' ? ['hidden_target'] : [];
    for (const role of [...uvTargetRoles, ...hiddenTargetRoles]) bind(role);
    const contract = {
      version: 'real-model-reliability-live-case.v1',
      kind: 'real_model_reliability_live_case',
      case_id: corpusCase.id,
      artifact_file: corpusCase.live.artifact,
      artifact_sha256: `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`,
      targets,
      expectations: {
        minimum_entities: 1,
        minimum_recursive_entities: corpusCase.tasks.includes('large_recursive_index') ? 1000 : 1,
        minimum_scenes: corpusCase.tasks.includes('scene_visibility_preservation') ? 1 : 0,
        required_materials: corpusCase.tasks.includes('material_preservation') ? ['Reliability_Material'] : [],
        uv_target_roles: uvTargetRoles,
        hidden_target_roles: hiddenTargetRoles,
        minimum_shared_occurrences: corpusCase.tasks.includes('shared_definition_identity') ? 2 : 0,
        boolean_operation: corpusCase.tasks.includes('boolean_manifold') ? 'boolean_difference' : null,
        ...(corpusCase.tasks.includes('abnormal_topology_detection')
          ? { expected_topology_issue_codes: ['boundary_edges'] }
          : {})
      }
    };
    await fs.writeFile(path.join(targetRoot, corpusCase.live.contract), `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  }
}

async function verifySignalCleanup(testRoot) {
  const stateDir = path.join(testRoot, 'interrupt-state');
  const queueDir = path.join(stateDir, 'queue');
  const processingDir = path.join(stateDir, 'processing');
  const responseDir = path.join(stateDir, 'responses');
  const lockPath = path.join(stateDir, 'queue-runtime.lock');
  const cleanupOptions = { queueDir, processingDir, responseDir, lockPath };
  const source = `
    import fs from 'node:fs/promises';
    import { installReliabilityInterruptCleanup } from ${JSON.stringify(pathToFileURL(harnessPath).href)};
    const options = JSON.parse(process.env.RELIABILITY_CLEANUP_OPTIONS);
    await Promise.all([options.queueDir, options.processingDir, options.responseDir].map((entry) => fs.mkdir(entry, { recursive: true })));
    const queuedId = \`${'${process.pid}'}-queued\`;
    const claimedId = \`${'${process.pid}'}-claimed\`;
    const readOnlyId = \`${'${process.pid}'}-read-only\`;
    await fs.writeFile(options.queueDir + '/' + queuedId + '.json', JSON.stringify({ id: queuedId, client_pid: process.pid }) + '\\n');
    await fs.writeFile(options.processingDir + '/' + claimedId + '.json', JSON.stringify({ id: claimedId, client_pid: process.pid }) + '\\n');
    await fs.writeFile(options.processingDir + '/' + readOnlyId + '.json', JSON.stringify({ id: readOnlyId, client_pid: process.pid, method: 'get_session_state', params: {} }) + '\\n');
    await fs.writeFile(options.responseDir + '/' + claimedId + '.json', JSON.stringify({ result: { outcome: 'unknown' } }) + '\\n');
    await fs.writeFile(options.responseDir + '/' + readOnlyId + '.json', JSON.stringify({ result: { kind: 'queue_session_state' } }) + '\\n');
    await fs.writeFile(options.lockPath, JSON.stringify({ pid: process.pid }) + '\\n');
    installReliabilityInterruptCleanup({ cleanupOptions: options });
    process.stdout.write(JSON.stringify({ ready: true, queue_runtime_called: false }) + '\\n');
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: repoRoot,
    env: { ...process.env, RELIABILITY_CLEANUP_OPTIONS: JSON.stringify(cleanupOptions) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  await waitFor(() => stdout.includes('\n'), 5000);
  const ready = JSON.parse(stdout.trim().split('\n')[0]);
  assert.deepEqual(ready, { ready: true, queue_runtime_called: false });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  child.kill('SIGTERM');
  const result = await exited;
  assert.deepEqual(result, { code: 143, signal: null }, `unexpected cleanup child exit: ${stderr}`);
  await waitFor(async () => (await jsonFiles(queueDir)).length === 0 && !await exists(lockPath), 5000);
  assert.deepEqual(await jsonFiles(queueDir), [], 'SIGTERM cleanup must remove its unclaimed request');
  assert.equal(await exists(lockPath), false, 'SIGTERM cleanup must remove its owned lock');
  assert.equal((await jsonFiles(processingDir)).length, 1, 'outcome-unknown processing evidence must be preserved');
  assert.equal((await jsonFiles(responseDir)).length, 1, 'unobserved response evidence must be preserved');
  assert.deepEqual(await jsonFiles(processingDir), [`${child.pid}-claimed.json`], 'claimed read-only processing must be removed');
  assert.deepEqual(await jsonFiles(responseDir), [`${child.pid}-claimed.json`], 'claimed read-only response must be removed');
  return {
    signal: 'SIGTERM',
    removed_own_request: true,
    removed_own_lock: true,
    removed_read_only_processing: true,
    removed_read_only_response: true,
    preserved_outcome_unknown: true,
    queue_runtime_called: false
  };
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function jsonFiles(directory) {
  try {
    return (await fs.readdir(directory)).filter((entry) => entry.endsWith('.json')).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function waitFor(predicate, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}
