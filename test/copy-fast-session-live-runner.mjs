import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020.js';
import { defaultStateDir, projectRoot } from '../src/paths.mjs';
import {
  COPY_FAST_LIVE_DEFAULT_MODEL,
  COPY_FAST_LIVE_MODEL_SHA256,
  COPY_FAST_LIVE_VERSION,
  assertCopyFastCompletedTask,
  assertCopyFastLiveEvidenceBindings,
  assertCopyFastLiveEvidenceSchema,
  assertCopyFastPreparedTask,
  assertCopyFastReadiness,
  assertInstalledPluginExactMatch,
  assertLiveRunOptions,
  inspectDisposableModel
} from '../scripts/run-copy-fast-session-live.mjs';
import {
  CAPABILITY_MANIFEST_VERSION,
  RUNTIME_CAPABILITY_VERSION
} from '../src/capabilities.mjs';
import { PRODUCT_VERSION } from '../src/version.mjs';

const script = path.join(projectRoot, 'scripts', 'run-copy-fast-session-live.mjs');
const queueBefore = await queueSnapshot();
const model = await inspectDisposableModel();
assert.equal(model.basename, 'Fire Escape.disposable.skp');
assert.equal(model.sha256, COPY_FAST_LIVE_MODEL_SHA256);
assert.equal(model.size_bytes, 142149);
assert.equal(model.save_model, false);
const workspacePlugin = await assertInstalledPluginExactMatch({
  pluginDir: path.join(projectRoot, 'sketchup_plugin')
});
assert.equal(workspacePlugin.file_count, 22);
assert.equal(workspacePlugin.exact_workspace_match, true);
assert.equal(workspacePlugin.paths_exposed, false);

const tamperedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'copy-fast-plugin-'));
const tamperedPlugin = path.join(tamperedRoot, 'plugin');
try {
  await fs.cp(path.join(projectRoot, 'sketchup_plugin'), tamperedPlugin, { recursive: true });
  await fs.appendFile(
    path.join(tamperedPlugin, 'alma_sketchup_mcp', 'component_operations.rb'),
    '\n# tampered fixture\n',
    'utf8'
  );
  await assert.rejects(
    () => assertInstalledPluginExactMatch({ pluginDir: tamperedPlugin }),
    /does not match the current workspace/
  );
} finally {
  await fs.rm(tamperedRoot, { recursive: true, force: true });
}

assert.throws(() => assertLiveRunOptions({}), /requires --runtime queue/);
assert.throws(() => assertLiveRunOptions({
  runtime: 'queue',
  queueRequired: true,
  ackDisposableCopy: true
}), /fresh-sketchup-confirmed/);
assert.doesNotThrow(() => assertLiveRunOptions({
  runtime: 'queue',
  queueRequired: true,
  ackDisposableCopy: true,
  freshSketchUpConfirmed: true
}));

const preparedTask = {
  ok: true,
  task_id: 'task_11111111-1111-4111-8111-111111111111',
  task_state: 'approved',
  result: {
    risk_level: 'S4',
    execution_mode: 'copy_fast',
    user_action_required: false,
    approval_challenge: null,
    copy_fast_session: {
      status: 'active',
      session_id: 'copy_session_11111111-1111-4111-8111-111111111111',
      agent_can_enable: false
    }
  },
  next_action: {
    action: 'execute_copy_edit',
    approval_status: 'copy_fast_active',
    user_action_required: false,
    copy_fast_session_id: 'copy_session_11111111-1111-4111-8111-111111111111',
    required: ['session_contract']
  }
};
const prepared = assertCopyFastPreparedTask(preparedTask);
assert.equal(prepared.session_id, preparedTask.result.copy_fast_session.session_id);
assert.throws(
  () => assertCopyFastPreparedTask({
    ...preparedTask,
    task_state: 'awaiting_review'
  }),
  /expected approved Copy Fast state/
);

const readiness = {
  ok: true,
  approval_status: 'copy_fast_active',
  approved_by: 'execution-policy:copy-fast-session',
  challenge_id: null,
  user_action_required: false,
  approval_token_exposed: false,
  copy_fast_session: { session_id: prepared.session_id }
};
assert.doesNotThrow(() => assertCopyFastReadiness(readiness, prepared.session_id));
assert.throws(
  () => assertCopyFastReadiness({ ...readiness, challenge_id: 'challenge_bad' }, prepared.session_id),
  /not ready/
);

const completedTask = {
  ok: true,
  task_state: 'completed',
  result: {
    authorization: {
      mode: 'server_policy_copy_fast_session',
      copy_fast_session_id: prepared.session_id,
      user_action_required: false
    },
    mutation_receipt: {
      receipt_id: 'mutation-receipt-111111111111111111111111',
      status: 'finalized'
    },
    model_revision_before: `sha256:${'a'.repeat(64)}`,
    model_revision_after: `sha256:${'b'.repeat(64)}`
  }
};
assert.equal(
  assertCopyFastCompletedTask(completedTask, prepared.session_id).model_revision_after,
  completedTask.result.model_revision_after
);
assert.throws(
  () => assertCopyFastCompletedTask({
    ...completedTask,
    result: {
      ...completedTask.result,
      authorization: {
        ...completedTask.result.authorization,
        mode: 'server_policy_trusted_model_copy_auto_approval'
      }
    }
  }, prepared.session_id),
  /did not complete/
);

const check = spawnSync(process.execPath, [
  script,
  'check',
  '--plugin-dir',
  path.join(projectRoot, 'sketchup_plugin')
], {
  cwd: projectRoot,
  encoding: 'utf8'
});
assert.equal(check.status, 0, check.stderr);
const checkResult = JSON.parse(check.stdout);
assert.equal(checkResult.ok, true);
assert.equal(checkResult.mutates_model, false);
assert.equal(checkResult.live_queue_calls, 0);
assert.equal(checkResult.disposable_model.sha256, COPY_FAST_LIVE_MODEL_SHA256);
assert.equal(checkResult.installed_source.exact_workspace_match, true);

const blockedLive = spawnSync(process.execPath, [script, 'run'], {
  cwd: projectRoot,
  encoding: 'utf8'
});
assert.equal(blockedLive.status, 1);
assert.match(blockedLive.stderr, /--queue-required/);
assert.deepEqual(await queueSnapshot(), queueBefore, 'blocked/default runner commands must not create queue files');

const schema = JSON.parse(await fs.readFile(
  path.join(projectRoot, 'schema', 'copy-fast-session-live-evidence-v2.schema.json'),
  'utf8'
));
const validate = new Ajv2020({
  allErrors: true,
  strict: false,
  formats: { 'date-time': true }
}).compile(schema);
const evidence = validEvidence();
assert.equal(validate(evidence), true, JSON.stringify(validate.errors, null, 2));
assert.equal(assertCopyFastLiveEvidenceBindings(evidence), true);
assert.equal(await assertCopyFastLiveEvidenceSchema(evidence), true);

const negativeCases = [
  ['review state', (value) => { value.prepare.task_state = 'awaiting_review'; }],
  ['user action', (value) => { value.prepare.user_action_required = true; }],
  ['challenge', (value) => { value.prepare.approval_challenge = { challenge_id: 'forged' }; }],
  ['old authorization', (value) => { value.apply.authorization_mode = 'server_policy_trusted_model_copy_auto_approval'; }],
  ['different session', (value) => { value.apply.copy_fast_session_id = 'copy_session_22222222-2222-4222-8222-222222222222'; }],
  ['unchanged revision', (value) => { value.apply.model_revision_after = value.apply.model_revision_before; }],
  ['duplicate mutation', (value) => { value.replay.duplicate_mutation = true; }],
  ['disk changed', (value) => { value.model.disk_bytes_unchanged = false; }],
  ['queue residue', (value) => { value.queue.after.queue = 1; }],
  ['root exposure', (value) => { value.prepare.configured_roots_exposed_to_agent = true; }],
  ['restart missing', (value) => { value.runtime.operator_confirmed_full_sketchup_restart = false; }],
  ['loaded source mismatch', (value) => { value.runtime.loaded_source_attestation_match = false; }],
  ['installed source mismatch', (value) => { value.installed_source.exact_workspace_match = false; }],
  ['release acceptance', (value) => { value.release_acceptance = true; }],
  ['unexpected field', (value) => { value.agent_override = true; }]
];
for (const [label, mutate] of negativeCases) {
  const candidate = structuredClone(evidence);
  mutate(candidate);
  if (label === 'different session' || label === 'unchanged revision') {
    assert.equal(validate(candidate), true, `${label} is a cross-field binding case`);
    assert.throws(
      () => assertCopyFastLiveEvidenceBindings(candidate),
      /not bound|does not prove/,
      `${label} must fail cross-field binding validation`
    );
  } else {
    assert.equal(validate(candidate), false, `${label} must fail schema validation`);
  }
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  version: COPY_FAST_LIVE_VERSION,
  disposable_model_sha256: COPY_FAST_LIVE_MODEL_SHA256,
  default_model_verified: model.sha256 === COPY_FAST_LIVE_MODEL_SHA256
    && path.isAbsolute(COPY_FAST_LIVE_DEFAULT_MODEL),
  explicit_live_opt_in_required: true,
  default_queue_calls: 0,
  approved_copy_fast_contract: true,
  old_authorization_rejected: true,
  schema_valid: true,
  negative_cases: negativeCases.length,
  live_queue_called: false
}, null, 2)}\n`);

function validEvidence() {
  const sha = 'a'.repeat(64);
  const beforeRevision = 'sha256:d540fdc8697e93f27a0312f75d382b6d5901597ef87e6673980fd21e97e3abb4';
  const sessionId = 'copy_session_11111111-1111-4111-8111-111111111111';
  return {
    version: COPY_FAST_LIVE_VERSION,
    kind: 'copy_fast_session_live_evidence',
    captured_at: '2026-07-24T12:00:00.000Z',
    branch: 'codex/agent-contract-v1',
    baseline_commit: 'a'.repeat(40),
    source_sha256: {
      'src/copy-fast-session.mjs': sha,
      'src/agent-contract.mjs': sha,
      'src/agent-gateway.mjs': sha,
      'src/agent-response-projection.mjs': sha,
      'src/existing-model-editing.mjs': sha,
      'src/bridge.mjs': sha,
      'src/queue-runtime.mjs': sha,
      'src/session-contract.mjs': sha,
      'src/task-mutation-receipt-ledger.mjs': sha,
      'src/version.mjs': sha,
      'src/capabilities.mjs': sha,
      'scripts/run-copy-fast-session-live.mjs': sha,
      'schema/copy-fast-session-live-evidence-v2.schema.json': sha
    },
    runtime: {
      name: 'queue',
      server_version: PRODUCT_VERSION,
      plugin_version: PRODUCT_VERSION,
      sketchup_version: '2026',
      capability_version: RUNTIME_CAPABILITY_VERSION,
      manifest_version: CAPABILITY_MANIFEST_VERSION,
      compatibility_ok: true,
      operation_count: 101,
      boolean_operations_sha256: '4e23e8d35603f4d08c9c5c9c9174c99451ffcb3bd94ab233001d331beafb3b4b',
      model_revision_source_sha256: 'b5c4c64c346c5abe1258be32c8027d542a4ccc28e2afc70c48debf3fcb886134',
      model_revision_strategy: 'definition-merkle.v2',
      loaded_source_attestation_match: true,
      server_process_fresh_for_session: true,
      operator_confirmed_full_sketchup_restart: true,
      handshake_id: 'handshake_11111111-1111-4111-8111-111111111111',
      plugin_session_id: 'session_11111111',
      document_id: 'document_11111111'
    },
    installed_source: {
      file_count: 22,
      manifest_sha256: sha,
      exact_workspace_match: true,
      paths_exposed: false
    },
    model: {
      basename: 'Fire Escape.disposable.skp',
      sha256: COPY_FAST_LIVE_MODEL_SHA256,
      size_bytes: 142149,
      expected_initial_revision: beforeRevision,
      save_model: false,
      disk_sha256_before: COPY_FAST_LIVE_MODEL_SHA256,
      disk_sha256_after: COPY_FAST_LIVE_MODEL_SHA256,
      disk_bytes_unchanged: true,
      revision_complete: true,
      logical_occurrences_before: 5859,
      active_document_modified_after: true
    },
    prepare: {
      task_id: 'task_11111111-1111-4111-8111-111111111111',
      task_state: 'approved',
      risk_level: 'S4',
      plan_id: 'existing-edit-111111111111111111111111',
      plan_hash: `sha256:${sha}`,
      model_revision: beforeRevision,
      execution_mode: 'copy_fast',
      next_action: 'execute_copy_edit',
      user_action_required: false,
      approval_challenge: null,
      copy_fast_session_id: sessionId,
      copy_fast_session_expires_at: '2026-07-24T12:30:00.000Z',
      approval_challenges_created: 0,
      configured_roots_exposed_to_agent: false
    },
    apply: {
      task_state: 'completed',
      submit_count: 1,
      authorization_mode: 'server_policy_copy_fast_session',
      approved_by: 'execution-policy:copy-fast-session',
      copy_fast_session_id: sessionId,
      user_action_required: false,
      receipt_id: 'mutation-receipt-111111111111111111111111',
      receipt_status: 'finalized',
      model_revision_before: beforeRevision,
      model_revision_after: `sha256:${'b'.repeat(64)}`,
      revision_changed: true,
      target_absent: true,
      empty_parent_absent: true,
      structural_group_count_after: 0,
      approval_token_exposed_to_agent: false,
      milestone_acceptance: true
    },
    replay: {
      same_idempotency_key: true,
      idempotent_replay: true,
      duplicate_mutation: false,
      task_state: 'completed'
    },
    queue: {
      before: { queue: 0, processing: 0, responses: 0, lock_exists: false },
      after: { queue: 0, processing: 0, responses: 0, lock_exists: false }
    },
    release_acceptance: false,
    boundaries: [
      'This proves one current-source Copy Fast S4 live path on an exact disposable model copy.',
      'The SKP is intentionally not saved; save/reopen behavior is covered by separate reliability evidence.',
      'This does not prove broad destructive-edit reliability, visual quality, multi-Agent compatibility, or cross-version SketchUp support.'
    ]
  };
}

async function queueSnapshot() {
  const entries = {};
  for (const name of ['queue', 'processing', 'responses']) {
    const directory = path.join(defaultStateDir, name);
    try {
      entries[name] = (await fs.readdir(directory)).sort();
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      entries[name] = [];
    }
  }
  for (const name of ['queue-runtime.lock']) {
    const candidate = path.join(defaultStateDir, name);
    entries[name] = await fs.stat(candidate).then(() => true, (error) => {
      if (error?.code === 'ENOENT') return false;
      throw error;
    });
  }
  return entries;
}
