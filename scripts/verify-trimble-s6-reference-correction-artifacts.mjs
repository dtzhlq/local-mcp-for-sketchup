#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateModelSnapshot } from '../src/model-qa.mjs';
import { defaultStateDir, projectRoot } from '../src/paths.mjs';
import { QueueRuntime } from '../src/queue-runtime.mjs';
import {
  buildTrimbleCorrectionOperations,
  trimbleS6ExpectedContactPairs
} from './run-trimble-s6-reference-correction-live.mjs';

const options = parseArgs(process.argv.slice(2));
const defaultOutputRoot = path.join(
  projectRoot,
  'output',
  'live-validation',
  'visual-correction',
  'trimble-s6-reference-correction-2026-07-22'
);
const runDir = path.resolve(options.runDir || await latestRunDir(defaultOutputRoot));
const finalizedDir = path.join(runDir, 'finalized-artifacts');
const prepare = await readJson(path.join(runDir, 'prepare.json'));
const taskPath = path.join(defaultStateDir, 'agent-contract-v1', 'tasks', `${prepare.task_id}.json`);
const task = await readJson(taskPath);
await materializePublicFinalizedArtifacts({ task, taskId: prepare.task_id, finalizedDir });
const [snapshot, rawQa, applyResult, captureMetadata] = await Promise.all([
  readJson(path.join(finalizedDir, 'after-snapshot.json')),
  readJson(path.join(finalizedDir, 'model-qa.json')),
  readJson(path.join(finalizedDir, 'apply-result.json')),
  readJson(path.join(finalizedDir, 'capture.json'))
]);

const operations = buildTrimbleCorrectionOperations();
const operationQaByName = new Map(operations
  .filter((operation) => operation.name && operation.qa)
  .map((operation) => [operation.name, operation.qa]));
const reviewedSnapshot = structuredClone(snapshot);
for (const group of reviewedSnapshot.groups || []) {
  const reviewedQa = operationQaByName.get(group.name);
  if (reviewedQa) group.qa = structuredClone(reviewedQa);
}
const reviewedQa = validateModelSnapshot(reviewedSnapshot, { includePreview: false });
const correction = verifyCorrectionSnapshot(snapshot, operations);
const queue = await new QueueRuntime({ timeoutMs: options.timeoutMs || 30_000 }).diagnostics({ includeFiles: false });
const queueSummary = summarizeQueue(queue);
const capturePath = path.join(finalizedDir, 'capture.png');
const captureStat = await fs.stat(capturePath);
const captureSha256 = await sha256File(capturePath);
const approvedOperations = task.private?.existing_edit_plan?.dsl_document?.operations || [];
const approvedContactCount = approvedOperations.reduce(
  (count, operation) => count + (operation.qa?.expected_contacts?.length || 0),
  0
);
const expectedContactCount = trimbleS6ExpectedContactPairs().length;
const rawUnexpectedCollisions = (rawQa.issues || []).filter((issue) => issue.type === 'layout.unexpected_collision');
const receipt = task.result?.mutation_receipt || null;
const taskCompleted = task.state === 'completed' && task.result?.ok === true;
const revisionChanged = task.result?.model_revision_before
  && task.result?.model_revision_after
  && task.result.model_revision_before !== task.result.model_revision_after;
const capturePass = captureStat.isFile()
  && captureStat.size === captureMetadata.file_size_bytes
  && captureMetadata.read_only_attestation?.state_unchanged === true;
const queueIdle = queueSummary.queue === 0
  && queueSummary.processing === 0
  && queueSummary.responses === 0
  && queueSummary.lock_exists === false;
const reviewedContactPass = reviewedQa.ok === true
  && reviewedQa.verdict === 'pass'
  && reviewedQa.issues.length === 0
  && reviewedQa.accepted_warnings.length === expectedContactCount;
const milestoneAcceptance = taskCompleted
  && receipt?.status === 'finalized'
  && revisionChanged
  && correction.pass
  && reviewedContactPass
  && capturePass
  && queueIdle;

const acceptance = {
  kind: 'trimble_s6_reference_correction_acceptance',
  version: 'trimble-s6-reference-correction-acceptance.v1',
  generated_at: new Date().toISOString(),
  run_id: prepare.run_id,
  task_id: prepare.task_id,
  task_state: task.state,
  task_ok: task.result?.ok === true,
  risk_level: task.result?.risk_level || applyResult.risk_level || null,
  plan_id: task.result?.plan_id || applyResult.plan_id || null,
  plan_hash: prepare.plan_hash,
  mutation_receipt: receipt,
  model_revision_before: task.result?.model_revision_before || applyResult.model_revision_before || null,
  model_revision_after: task.result?.model_revision_after || null,
  model_revision_changed: Boolean(revisionChanged),
  correction,
  raw_model_qa: {
    ok: rawQa.ok === true,
    verdict: rawQa.verdict,
    unexpected_collision_count: rawUnexpectedCollisions.length,
    other_issue_count: (rawQa.issues || []).length - rawUnexpectedCollisions.length
  },
  reviewed_expected_contact_qa: {
    ok: reviewedQa.ok === true,
    verdict: reviewedQa.verdict,
    issue_count: reviewedQa.issues.length,
    accepted_warning_count: reviewedQa.accepted_warnings.length,
    expected_contact_count: expectedContactCount
  },
  qa_contract_binding: {
    approved_plan_expected_contact_count: approvedContactCount,
    current_runner_expected_contact_count: expectedContactCount,
    plan_hash_bound_for_this_run: approvedContactCount === expectedContactCount,
    classification: approvedContactCount === expectedContactCount
      ? 'hash_bound_before_execution'
      : 'posthoc_reviewed_expected_contacts',
    raw_qa_preserved: true
  },
  capture: {
    path: capturePath,
    sha256: captureSha256,
    size_bytes: captureStat.size,
    dimensions: [captureMetadata.width, captureMetadata.height],
    read_only_state_unchanged: captureMetadata.read_only_attestation?.state_unchanged === true
  },
  queue_after: queueSummary,
  model_saved: false,
  milestone_acceptance: milestoneAcceptance,
  release_acceptance: false,
  release_blockers: [
    ...(approvedContactCount === expectedContactCount ? [] : ['expected_contact_qa_not_hash_bound_in_approved_plan']),
    'model_not_saved_or_reopened',
    'structured_reference_alignment_and_pixel_difference_not_completed'
  ]
};

await fs.writeFile(path.join(finalizedDir, 'reviewed-expected-contact-model-qa.json'), `${JSON.stringify(reviewedQa, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(runDir, 'acceptance.json'), `${JSON.stringify(acceptance, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({
  ok: milestoneAcceptance,
  task_id: acceptance.task_id,
  task_state: acceptance.task_state,
  mutation_receipt: receipt,
  correction: acceptance.correction,
  raw_model_qa: acceptance.raw_model_qa,
  reviewed_expected_contact_qa: acceptance.reviewed_expected_contact_qa,
  qa_contract_binding: acceptance.qa_contract_binding,
  capture: acceptance.capture,
  queue_after: acceptance.queue_after,
  milestone_acceptance: acceptance.milestone_acceptance,
  release_acceptance: acceptance.release_acceptance,
  acceptance_path: path.join(runDir, 'acceptance.json')
}, null, 2)}\n`);
if (!milestoneAcceptance) process.exitCode = 1;

function verifyCorrectionSnapshot(value, expectedOperations) {
  const materials = new Map((value.materials || []).map((material) => [material.name, String(material.color || '').toLowerCase()]));
  const expectedMaterials = new Map(expectedOperations
    .filter((operation) => operation.op === 'material')
    .map((operation) => [operation.name, operation.color.toLowerCase()]));
  const groups = value.groups || [];
  const actualNames = new Set(groups.map((group) => group.name));
  const expectedNames = expectedOperations
    .filter((operation) => operation.name && !['material', 'set_material'].includes(operation.op))
    .map((operation) => operation.name);
  const missingGroups = expectedNames.filter((name) => !actualNames.has(name));
  const materialMismatches = [...expectedMaterials]
    .filter(([name, color]) => materials.get(name) !== color)
    .map(([name, color]) => ({ name, expected: color, actual: materials.get(name) || null }));
  const lowerCover = groups.find((group) => String(group.persistent_id || '') === '89455');
  const lowerCoverPass = lowerCover?.material === '[Color_005]';
  return {
    pass: missingGroups.length === 0 && materialMismatches.length === 0 && lowerCoverPass,
    expected_added_group_count: expectedNames.length,
    observed_added_group_count: expectedNames.length - missingGroups.length,
    missing_groups: missingGroups,
    material_mismatches: materialMismatches,
    lower_front_cover: {
      entity_path: 'pid:89455',
      present: Boolean(lowerCover),
      material: lowerCover?.material || null,
      expected_material: '[Color_005]',
      pass: lowerCoverPass
    }
  };
}

async function latestRunDir(root) {
  const latest = await readJson(path.join(root, 'latest.json'));
  if (!latest.run_dir) throw new Error('latest.json does not contain run_dir.');
  return latest.run_dir;
}

function summarizeQueue(value) {
  return {
    queue: Number(value.queue?.count ?? value.queue_count ?? -1),
    processing: Number(value.processing?.count ?? value.processing_count ?? -1),
    responses: Number(value.responses?.count ?? value.response_count ?? -1),
    lock_exists: value.lock?.exists ?? value.lock_exists ?? null
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function sha256File(filePath) {
  const bytes = await fs.readFile(filePath);
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

async function materializePublicFinalizedArtifacts({ task, taskId, finalizedDir }) {
  const allowedNames = [
    'after-model-info.json',
    'after-snapshot.json',
    'apply-result.json',
    'capture.json',
    'capture.png',
    'input.dsl.json',
    'manifest.json',
    'model-qa.json',
    'snapshot-diff.json'
  ];
  const applyRoot = path.join(
    defaultStateDir,
    'agent-contract-v1',
    'task-artifacts',
    taskId,
    'apply'
  );
  const canonicalApplyRoot = await fs.realpath(applyRoot);
  const byName = new Map();
  for (const candidate of Object.values(task.private?.artifact_paths || {})) {
    if (typeof candidate !== 'string') continue;
    const name = path.basename(candidate);
    if (allowedNames.includes(name)) byName.set(name, candidate);
  }
  await fs.mkdir(finalizedDir, { recursive: true, mode: 0o700 });
  for (const name of allowedNames) {
    const sourcePath = byName.get(name);
    if (!sourcePath) throw new Error(`Task ${taskId} is missing finalized artifact ${name}.`);
    const sourceStat = await fs.lstat(sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      throw new Error(`Task ${taskId} artifact ${name} is not a regular non-symlink file.`);
    }
    const canonicalSource = await fs.realpath(sourcePath);
    if (!canonicalSource.startsWith(`${canonicalApplyRoot}${path.sep}`)
      || path.basename(canonicalSource) !== name) {
      throw new Error(`Task ${taskId} artifact ${name} escaped its apply artifact root.`);
    }
    await fs.copyFile(canonicalSource, path.join(finalizedDir, name));
  }
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--run-dir') result.runDir = argv[++index];
    else if (argv[index] === '--timeout-ms') result.timeoutMs = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return result;
}
