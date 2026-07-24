#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Canonical } from '../src/agent-contract.mjs';
import { SketchUpBridge } from '../src/bridge.mjs';
import { QUEUE_MODEL_REVISION_STRATEGY } from '../src/capabilities.mjs';
import { modelRevisionForAdoption } from '../src/existing-model-editing.mjs';
import { freshSessionOptions } from '../src/live-session-contract.mjs';
import { MODEL_REVISION_SOURCE_SHA256 } from '../src/runtime-source-attestation.mjs';
import { compareSnapshots } from '../src/snapshot-diff.mjs';

const SAVE_REOPEN_REPORT_VERSION = 2;
const SAVE_REOPEN_REPORT_CONTRACT = 'save-reopen-identity-report.v2';
const CURRENT_QUEUE_REVISION_STRATEGY = 'definition-merkle.v2';
const MODEL_REVISION_SOURCE_PATH = fileURLToPath(new URL('../sketchup_plugin/alma_sketchup_mcp/model_revision.rb', import.meta.url));

export async function validateSaveReopenIdentity({
  runtime = 'mock',
  queueRequired = false,
  timeoutMs = runtime === 'queue' ? 180000 : 30000,
  outputDir = `output/save-reopen-identity/${runtime}`,
  savePath,
  intermediaryPath,
  resumeAfterOpen = false
} = {}) {
  if (runtime === 'queue' && queueRequired !== true && resumeAfterOpen !== true) {
    throw new Error('Live save/reopen validation requires explicit --runtime queue --queue-required because it resets, saves, and reopens the current SketchUp model.');
  }
  if (!['mock', 'queue'].includes(runtime)) throw new Error('runtime must be mock or queue');
  if (runtime === 'queue' && resumeAfterOpen !== true) {
    process.stderr.write('[DANGER] save/reopen identity QA will reset, replace, save, switch, and reopen the model currently active in SketchUp.\n');
  }

  const expectedModelRevisionSourceSha256 = runtime === 'queue'
    ? await assertCurrentModelRevisionSource()
    : null;

  const absoluteOutputDir = path.resolve(outputDir);
  const absoluteSavePath = path.resolve(savePath || path.join(absoluteOutputDir, runtime === 'queue' ? 'save-reopen-identity.skp' : 'save-reopen-identity.json'));
  const absoluteIntermediaryPath = path.resolve(intermediaryPath || path.join(absoluteOutputDir, runtime === 'queue' ? 'save-reopen-intermediary.skp' : 'save-reopen-intermediary.json'));
  const checkpointPath = path.join(absoluteOutputDir, 'save-reopen-checkpoint.json');
  assert(!samePath(absoluteSavePath, absoluteIntermediaryPath), 'savePath and intermediaryPath must be different files');
  await fs.mkdir(absoluteOutputDir, { recursive: true });
  const bridge = new SketchUpBridge(runtime === 'mock'
    ? { mock: { sessionPath: path.join(absoluteOutputDir, '.mock-session.json') } }
    : {});
  const runtimeBindingAtStart = await inspectRuntimeRevisionBinding({
    bridge,
    runtime,
    timeoutMs,
    expectedModelRevisionSourceSha256
  });

  if (resumeAfterOpen === true) {
    const checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf8'));
    assert(checkpoint?.kind === 'save_reopen_identity_checkpoint', 'save/reopen checkpoint is invalid');
    assert(checkpoint.version === SAVE_REOPEN_REPORT_VERSION, 'save/reopen checkpoint is not the v2 contract');
    assert(checkpoint.report_contract === SAVE_REOPEN_REPORT_CONTRACT, 'save/reopen checkpoint report contract is not v2');
    assert(checkpoint.runtime === runtime, `checkpoint runtime ${checkpoint.runtime} does not match ${runtime}`);
    assert(
      checkpoint.destructive_opt_in_observed === (runtime === 'queue'),
      'checkpoint destructive opt-in boundary does not match its runtime'
    );
    assertSamePath(checkpoint.target_path, absoluteSavePath, 'checkpoint target path does not match --save-path');
    assertSamePath(checkpoint.intermediary_path, absoluteIntermediaryPath, 'checkpoint intermediary path does not match --intermediary-path');
    assert(
      JSON.stringify(checkpoint.before_revision_observation) === JSON.stringify(revisionObservation({
        runtime,
        adoption: checkpoint.before,
        runtimeBinding: checkpoint.runtime_binding_before
      })),
      'checkpoint before revision observation does not match its captured adoption'
    );
    const reopenedInfo = await bridge.get_model_info({ runtime, timeoutMs });
    if (runtime === 'queue') {
      assertSamePath(reopenedInfo.source_path, absoluteSavePath, 'activate the saved target model before --resume-after-open');
    }
    return completeValidation({
      bridge,
      runtime,
      timeoutMs,
      absoluteOutputDir,
      absoluteSavePath,
      absoluteIntermediaryPath,
      checkpointPath,
      before: checkpoint.before,
      saved: checkpoint.saved,
      intermediarySaved: checkpoint.intermediary_saved,
      targetInfoBeforeSwitch: checkpoint.target_info_before_switch,
      intermediaryInfo: checkpoint.intermediary_info,
      reopened: { kind: 'open_model_resume', runtime, file_path: absoluteSavePath },
      reopenedInfo,
      resumedAfterActivation: true,
      runtimeBindingBefore: checkpoint.runtime_binding_before,
      expectedModelRevisionSourceSha256
    });
  }

  await bridge.build_model({
    runtime,
    timeoutMs,
    code: JSON.stringify(identityFixture()),
    ...await freshSessionOptions(bridge, { runtime, timeoutMs })
  });
  const before = await adopt(bridge, runtime, timeoutMs);
  assert(before.recursive_truncated === false, 'recursive identity index must not truncate before save');
  const beforeRevisionObservation = revisionObservation({
    runtime,
    adoption: before,
    runtimeBinding: runtimeBindingAtStart
  });
  const leafOccurrences = before.recursive_index.filter((entry) => entry.name === 'Save_Reopen_Leaf_Box');
  assert(leafOccurrences.length === 2, 'shared leaf group must have two occurrences before save');
  assert(leafOccurrences.every((entry) => entry.shared_definition === true && entry.affected_instance_count === 2), 'shared-definition impact must be explicit before save');

  const saved = await bridge.save_model({
    runtime,
    timeoutMs,
    path: absoluteSavePath,
    keep_session: true,
    ...await freshSessionOptions(bridge, { runtime, timeoutMs })
  });
  await fs.access(absoluteSavePath);
  const targetInfoBeforeSwitch = await bridge.get_model_info({ runtime, timeoutMs });
  if (runtime === 'queue') {
    assertSamePath(targetInfoBeforeSwitch.source_path, absoluteSavePath, 'active SketchUp path must be the saved target before switching documents');
  }

  const intermediaryBuilt = await bridge.build_model({
    runtime,
    timeoutMs,
    code: JSON.stringify(intermediaryFixture()),
    ...await freshSessionOptions(bridge, { runtime, timeoutMs })
  });
  assert(sha256Canonical(intermediaryBuilt.snapshot) !== sha256Canonical(before.snapshot), 'intermediary fixture must differ from the identity target');
  const intermediarySaved = await bridge.save_model({
    runtime,
    timeoutMs,
    path: absoluteIntermediaryPath,
    keep_session: true,
    ...await freshSessionOptions(bridge, { runtime, timeoutMs })
  });
  await fs.access(absoluteIntermediaryPath);
  const intermediaryInfo = await bridge.get_model_info({ runtime, timeoutMs });
  if (runtime === 'queue') {
    assertSamePath(intermediaryInfo.source_path, absoluteIntermediaryPath, 'active SketchUp path must switch to the saved intermediary model');
    assert(!samePath(intermediaryInfo.source_path, absoluteSavePath), 'intermediary model must not report the target path');
  }

  await fs.writeFile(checkpointPath, `${JSON.stringify({
    version: SAVE_REOPEN_REPORT_VERSION,
    kind: 'save_reopen_identity_checkpoint',
    runtime,
    report_contract: SAVE_REOPEN_REPORT_CONTRACT,
    destructive_opt_in_observed: runtime === 'queue',
    target_path: absoluteSavePath,
    intermediary_path: absoluteIntermediaryPath,
    before,
    before_revision_observation: beforeRevisionObservation,
    runtime_binding_before: runtimeBindingAtStart,
    saved,
    intermediary_saved: intermediarySaved,
    target_info_before_switch: targetInfoBeforeSwitch,
    intermediary_info: intermediaryInfo
  }, null, 2)}\n`, 'utf8');

  let reopened;
  try {
    reopened = await bridge.open_model({
      runtime,
      timeoutMs,
      path: absoluteSavePath,
      ...await freshSessionOptions(bridge, { runtime, timeoutMs })
    });
  } catch (error) {
    error.message = `${error.message}\nCheckpoint preserved at ${checkpointPath}. If SketchUp opened the target in another macOS document window, activate that target, close only the saved intermediary window, then rerun with --resume-after-open.`;
    throw error;
  }
  const reopenedInfo = await bridge.get_model_info({ runtime, timeoutMs });
  if (runtime === 'queue') {
    if (!samePath(reopenedInfo.source_path, absoluteSavePath)) {
      throw new Error(`SketchUp accepted open_model but the queue is not yet routed to the target document (open_status=${reopened.open_status || 'unknown'}, source_path=${reopenedInfo.source_path || '<none>'}). Checkpoint preserved at ${checkpointPath}. Focus the target, close only the saved intermediary window if necessary, then rerun with --resume-after-open.`);
    }
    assert(!samePath(reopenedInfo.source_path, absoluteIntermediaryPath), 'reopened target must not report the intermediary path');
  } else {
    assertSamePath(reopened.file_path, absoluteSavePath, 'mock open_model must report the target artifact path');
  }

  return completeValidation({
    bridge,
    runtime,
    timeoutMs,
    absoluteOutputDir,
    absoluteSavePath,
    absoluteIntermediaryPath,
    checkpointPath,
    before,
    saved,
    intermediarySaved,
    targetInfoBeforeSwitch,
    intermediaryInfo,
    reopened,
    reopenedInfo,
    resumedAfterActivation: false,
    runtimeBindingBefore: runtimeBindingAtStart,
    expectedModelRevisionSourceSha256
  });
}

async function completeValidation({
  bridge,
  runtime,
  timeoutMs,
  absoluteOutputDir,
  absoluteSavePath,
  absoluteIntermediaryPath,
  checkpointPath,
  before,
  saved,
  intermediarySaved,
  targetInfoBeforeSwitch,
  intermediaryInfo,
  reopened,
  reopenedInfo,
  resumedAfterActivation,
  runtimeBindingBefore,
  expectedModelRevisionSourceSha256
}) {
  const beforeSignature = identitySignature(before);
  const beforeRevision = modelRevisionForAdoption(before);
  const after = await adopt(bridge, runtime, timeoutMs);
  assert(after.recursive_truncated === false, 'recursive identity index must not truncate after reopen');
  const afterSignature = identitySignature(after);
  const afterRevision = modelRevisionForAdoption(after);
  assert(afterRevision === beforeRevision, 'model revision must survive save/reopen');
  const runtimeBindingAfter = await inspectRuntimeRevisionBinding({
    bridge,
    runtime,
    timeoutMs,
    expectedModelRevisionSourceSha256
  });
  const revisionAttestation = {
    before: revisionObservation({ runtime, adoption: before, runtimeBinding: runtimeBindingBefore }),
    after: revisionObservation({ runtime, adoption: after, runtimeBinding: runtimeBindingAfter }),
    revision_exact_match: true,
    strategy_exact_match: runtime === 'queue' ? true : null,
    source_exact_match: runtime === 'queue' ? true : null,
    current_source_verified: runtime === 'queue',
    after_reopen_clean: runtime === 'queue'
  };
  assertSaveReopenRevisionAttestation({
    runtime,
    revisionAttestation,
    expectedModelRevisionSourceSha256
  });
  assert(JSON.stringify(afterSignature) === JSON.stringify(beforeSignature), 'persistent occurrence identity must survive save/reopen exactly');
  const reopenedLeaves = after.recursive_index.filter((entry) => entry.name === 'Save_Reopen_Leaf_Box');
  assert(reopenedLeaves.length === 2, 'shared leaf group must have two occurrences after reopen');
  assert(reopenedLeaves.every((entry) => entry.shared_definition === true && entry.affected_instance_count === 2), 'shared-definition impact must survive reopen');
  const snapshotDiff = compareSnapshots(snapshotForCompare(before.snapshot, runtime), snapshotForCompare(after.snapshot, runtime), {
    toleranceMm: 0,
    topologyTolerance: { faces: 0, edges: 0, groups: 0, instances: 0 }
  });
  assert(snapshotDiff.diffs.length === 0, `snapshot diff must be empty after real path-switch reopen; got ${snapshotDiff.diffs.length}: ${JSON.stringify(snapshotDiff.diffs)}`);

  const diagnostics = runtime === 'queue' ? await bridge.queue_diagnostics({ timeoutMs }) : null;
  if (diagnostics) {
    assert(diagnostics.queue.count === 0, 'queue must be empty after save/reopen validation');
    assert(diagnostics.processing.count === 0, 'processing must be empty after save/reopen validation');
    assert(diagnostics.responses.count === 0, 'responses must be empty after save/reopen validation');
    assert(diagnostics.lock.exists === false, 'queue lock must be absent after save/reopen validation');
  }

  const reportPath = path.join(absoluteOutputDir, 'save-reopen-identity-report.json');
  const snapshotDiffPath = path.join(absoluteOutputDir, 'save-reopen-snapshot-diff.json');
  await fs.writeFile(snapshotDiffPath, `${JSON.stringify(snapshotDiff, null, 2)}\n`, 'utf8');
  const report = {
    version: SAVE_REOPEN_REPORT_VERSION,
    contract_version: SAVE_REOPEN_REPORT_CONTRACT,
    kind: 'save_reopen_identity_report',
    ok: true,
    runtime,
    evidence_scope: runtime === 'queue' ? 'live_queue_distinct_path_save_reopen' : 'mock_contract_only',
    live_proof: runtime === 'queue',
    destructive_opt_in: {
      required_for_queue: true,
      observed: runtime === 'queue',
      resume_is_read_only: true
    },
    model_revision_before: beforeRevision,
    model_revision_after: afterRevision,
    revision_attestation: revisionAttestation,
    saved_model: saved.path || saved.file_path || absoluteSavePath,
    path_switch: {
      verified: true,
      active_source_path_verified: runtime === 'queue',
      resumed_after_activation: resumedAfterActivation,
      target_path: absoluteSavePath,
      intermediary_path: intermediarySaved.path || intermediarySaved.file_path || absoluteIntermediaryPath,
      source_before_switch: targetInfoBeforeSwitch.source_path || null,
      source_before_reopen: intermediaryInfo.source_path || null,
      source_after_reopen: reopenedInfo.source_path || null,
      open_result_path: reopened.path || reopened.file_path || absoluteSavePath
    },
    identity: {
      entries_before: beforeSignature.length,
      entries_after: afterSignature.length,
      signature_before: sha256Canonical(beforeSignature),
      signature_after: sha256Canonical(afterSignature),
      exact_match: true,
      shared_leaf_occurrences: reopenedLeaves.length,
      face_edge_entries: after.recursive_index.filter((entry) => ['face', 'edge'].includes(entry.entity_type)).length
    },
    snapshot_compare: {
      tolerance_mm: 0,
      diff_count: snapshotDiff.diffs.length,
      exact_match: snapshotDiff.diffs.length === 0,
      verdict: snapshotDiff.verdict
    },
    queue_clean: diagnostics ? {
      queue: diagnostics.queue.count,
      processing: diagnostics.processing.count,
      responses: diagnostics.responses.count,
      lock: diagnostics.lock.exists
    } : null,
    artifacts: {
      report: reportPath,
      saved_model: saved.path || saved.file_path || absoluteSavePath,
      intermediary_model: intermediarySaved.path || intermediarySaved.file_path || absoluteIntermediaryPath,
      snapshot_diff: snapshotDiffPath,
      checkpoint: checkpointPath
    }
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

export function assertSaveReopenRevisionAttestation({
  runtime,
  revisionAttestation,
  expectedModelRevisionSourceSha256 = null
} = {}) {
  assert(['mock', 'queue'].includes(runtime), 'revision attestation runtime must be mock or queue');
  const before = revisionAttestation?.before;
  const after = revisionAttestation?.after;
  assert(before && after, 'revision attestation requires before and after observations');
  assert(/^sha256:[0-9a-f]{64}$/.test(String(before.model_revision || '')), 'before model revision must be a SHA-256');
  assert(/^sha256:[0-9a-f]{64}$/.test(String(after.model_revision || '')), 'after model revision must be a SHA-256');
  assert(before.model_revision === after.model_revision, 'model revision must survive save/reopen');
  assert(revisionAttestation.revision_exact_match === true, 'revision exact-match claim must be true');

  if (runtime === 'mock') {
    for (const [phase, observation] of [['before', before], ['after', after]]) {
      assert(observation.model_revision_strategy === null, `mock ${phase} strategy must be null`);
      assert(observation.model_revision_source_sha256 === null, `mock ${phase} source hash must be null`);
      assert(observation.model_modified === null, `mock ${phase} modified state must be null`);
    }
    assert(expectedModelRevisionSourceSha256 === null, 'mock must not bind a live Model Revision source hash');
    assert(revisionAttestation.strategy_exact_match === null, 'mock must not claim a live strategy match');
    assert(revisionAttestation.source_exact_match === null, 'mock must not claim a live source match');
    assert(revisionAttestation.current_source_verified === false, 'mock must not claim current live source verification');
    assert(revisionAttestation.after_reopen_clean === false, 'mock must not claim live post-reopen clean state');
    return true;
  }

  assert(QUEUE_MODEL_REVISION_STRATEGY === CURRENT_QUEUE_REVISION_STRATEGY, 'tracked queue strategy is not definition-merkle.v2');
  assert(/^[0-9a-f]{64}$/.test(String(expectedModelRevisionSourceSha256 || '')), 'queue requires the current Model Revision source SHA-256');
  for (const [phase, observation] of [['before', before], ['after', after]]) {
    assert(observation.model_revision_strategy === CURRENT_QUEUE_REVISION_STRATEGY, `queue ${phase} strategy must be definition-merkle.v2`);
    assert(observation.model_revision_source_sha256 === expectedModelRevisionSourceSha256, `queue ${phase} source hash is not the current Model Revision source`);
    assert(typeof observation.model_modified === 'boolean', `queue ${phase} modified state must be a boolean`);
  }
  assert(after.model_modified === false, 'reopened saved model must report model_modified=false');
  assert(before.model_revision_strategy === after.model_revision_strategy, 'Model Revision strategy changed across save/reopen');
  assert(before.model_revision_source_sha256 === after.model_revision_source_sha256, 'Model Revision source changed across save/reopen');
  assert(revisionAttestation.strategy_exact_match === true, 'queue strategy exact-match claim must be true');
  assert(revisionAttestation.source_exact_match === true, 'queue source exact-match claim must be true');
  assert(revisionAttestation.current_source_verified === true, 'queue current-source verification must be true');
  assert(revisionAttestation.after_reopen_clean === true, 'queue post-reopen clean-state verification must be true');
  return true;
}

async function assertCurrentModelRevisionSource() {
  assert(QUEUE_MODEL_REVISION_STRATEGY === CURRENT_QUEUE_REVISION_STRATEGY, 'tracked queue strategy must be definition-merkle.v2 before live save/reopen');
  const actual = crypto.createHash('sha256').update(await fs.readFile(MODEL_REVISION_SOURCE_PATH)).digest('hex');
  assert(
    actual === MODEL_REVISION_SOURCE_SHA256,
    'workspace model_revision.rb does not match the tracked runtime source manifest; no live queue request was created'
  );
  return actual;
}

async function inspectRuntimeRevisionBinding({
  bridge,
  runtime,
  timeoutMs,
  expectedModelRevisionSourceSha256
}) {
  if (runtime === 'mock') {
    return {
      model_revision_strategy: null,
      model_revision_source_sha256: null
    };
  }
  const capabilities = (await bridge.get_capabilities({ runtime: 'queue', timeoutMs })).runtime;
  assert(capabilities?.compatibility?.ok === true, 'live queue capabilities are not compatible with the current server');
  assert(capabilities?.model_revision?.strategy === CURRENT_QUEUE_REVISION_STRATEGY, 'live queue strategy must be definition-merkle.v2');
  assert(
    capabilities?.model_revision_source_sha256 === expectedModelRevisionSourceSha256,
    'live queue Model Revision source hash does not match the current workspace source'
  );
  return {
    model_revision_strategy: capabilities.model_revision.strategy,
    model_revision_source_sha256: capabilities.model_revision_source_sha256
  };
}

function revisionObservation({ runtime, adoption, runtimeBinding }) {
  const modelRevision = modelRevisionForAdoption(adoption);
  if (runtime === 'mock') {
    return {
      model_revision: modelRevision,
      model_revision_strategy: null,
      model_revision_source_sha256: null,
      model_modified: null
    };
  }
  assert(runtimeBinding?.model_revision_strategy === CURRENT_QUEUE_REVISION_STRATEGY, 'queue runtime binding strategy is not definition-merkle.v2');
  assert(/^[0-9a-f]{64}$/.test(String(runtimeBinding?.model_revision_source_sha256 || '')), 'queue runtime binding source hash is missing');
  assert(adoption?.model_revision_strategy === runtimeBinding.model_revision_strategy, 'adoption Model Revision strategy does not match live capabilities');
  assert(typeof adoption?.model_modified === 'boolean', 'adoption model_modified is unavailable');
  return {
    model_revision: modelRevision,
    model_revision_strategy: adoption.model_revision_strategy,
    model_revision_source_sha256: runtimeBinding.model_revision_source_sha256,
    model_modified: adoption.model_modified
  };
}

function intermediaryFixture() {
  return {
    version: 1,
    units: 'mm',
    operations: [
      { op: 'reset' },
      { op: 'box', id: 'save-reopen-intermediary-box', name: 'Save_Reopen_Intermediary_Box', origin: [0, 0, 0], size: [40, 50, 60] },
      { op: 'scene', name: 'Save_Reopen_Intermediary_Scene', camera: { eye: [300, -400, 240], target: [20, 25, 30], up: [0, 0, 1], fov: 35 } }
    ]
  };
}

function identityFixture() {
  return {
    version: 1,
    units: 'mm',
    operations: [
      { op: 'reset' },
      { op: 'material', name: 'Save_Reopen_Base', color: '#7f91a6' },
      { op: 'tag', name: 'Save_Reopen_Identity', visible: true },
      {
        op: 'component_definition',
        name: 'Save_Reopen_Leaf',
        operations: [
          { op: 'box', id: 'save-reopen-leaf-box', name: 'Save_Reopen_Leaf_Box', origin: [0, 0, 0], size: [120, 70, 30], material: 'Save_Reopen_Base' }
        ]
      },
      {
        op: 'component_definition',
        name: 'Save_Reopen_Middle',
        operations: [
          { op: 'component_instance', id: 'save-reopen-leaf-instance', name: 'Save_Reopen_Leaf_Instance', definition: 'Save_Reopen_Leaf', origin: [0, 0, 0] }
        ]
      },
      { op: 'component_instance', id: 'save-reopen-middle-a', name: 'Save_Reopen_Middle_A', definition: 'Save_Reopen_Middle', origin: [0, 0, 0] },
      { op: 'component_instance', id: 'save-reopen-middle-b', name: 'Save_Reopen_Middle_B', definition: 'Save_Reopen_Middle', origin: [250, 0, 0] },
      { op: 'scene', name: 'Save_Reopen_Iso', camera: { eye: [700, -900, 500], target: [120, 40, 20], up: [0, 0, 1], fov: 35 } }
    ]
  };
}

function adopt(bridge, runtime, timeoutMs) {
  return bridge.adopt_open_model({
    runtime,
    timeoutMs,
    recursive: true,
    recursive_limit: 2000,
    prefix: 'save-reopen',
    read_only: true
  });
}

function identitySignature(adoption) {
  return (adoption.recursive_index || []).map((entry) => ({
    entity_path: entry.entity_path,
    persistent_id_path: entry.persistent_id_path,
    entity_type: entry.entity_type,
    reference: entry.reference,
    name: entry.name || null,
    definition_name: entry.definition_name || null,
    parent_definition: entry.parent_definition || null,
    shared_definition: entry.shared_definition === true,
    affected_instance_count: entry.affected_instance_count,
    editable: entry.editable === true,
    edit_scope: entry.edit_scope || null
  })).sort((left, right) => left.entity_path.localeCompare(right.entity_path));
}

function snapshotForCompare(snapshot, runtime) {
  return {
    ...snapshot,
    runtime: snapshot?.runtime || { name: runtime }
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function samePath(left, right) {
  if (!left || !right) return false;
  return path.resolve(String(left)) === path.resolve(String(right));
}

function assertSamePath(actual, expected, message) {
  assert(samePath(actual, expected), `${message}: expected ${expected}, got ${actual || '<none>'}`);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--runtime') options.runtime = argv[++index];
    else if (arg === '--queue-required') options.queueRequired = true;
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else if (arg === '--output-dir') options.outputDir = argv[++index];
    else if (arg === '--save-path') options.savePath = argv[++index];
    else if (arg === '--intermediary-path') options.intermediaryPath = argv[++index];
    else if (arg === '--resume-after-open') options.resumeAfterOpen = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  validateSaveReopenIdentity(parseArgs(process.argv.slice(2)))
    .then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exit(1);
    });
}
