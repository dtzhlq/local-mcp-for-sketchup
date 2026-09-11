import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { SketchUpBridge } from '../src/bridge.mjs';
import { sha256Canonical } from '../src/agent-contract.mjs';
import { trustedBridgeReceipt } from '../src/task-mutation-receipt-ledger.mjs';
import { MODEL_ACCESSIBILITY_APPEARANCE_VERSION as version, normalizeNativeAppearanceInput } from '../src/model-accessibility-appearance.mjs';
import { readNativeAppearanceSavedProvenance } from '../src/model-accessibility-appearance-receipt.mjs';

// Deliberately synthetic signed records exercise reader integrity only. No
// actual native file, appearance execution or user approval is represented.
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'appearance-receipt-')));
const revision = n => `sha256:${String(n).padStart(64, '0')}`;
let serial = 0;
async function fixture() {
  const bridge = new SketchUpBridge({ agentContract: { rootDir: path.join(root, `fixture-${++serial}`) }, approval: { stateDir: path.join(root, `approval-${serial}`), secret: 'appearance-provenance-offline-fixture-secret' } });
  const taskStore = bridge.taskStore;
  const appearance = { kind: 'native_pbr', target: 'P', preset: 'wood', texture_size_mm: [750, 750], rotation: 30 };
  const task = (await taskStore.createTask({ intent: 'apply_native_appearance', instruction: 'Offline synthetic provenance only.', executionPolicy: bridge.executionPolicy, inputs: { runtime: 'queue', appearance } })).task;
  const directory = path.join(taskStore.rootDir, 'task-artifacts', task.task_id, 'native-appearance');
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, 'model.skp'), bytes = Buffer.from('Fixture bytes; not a native SKP.');
  await fs.writeFile(target, bytes, { flag: 'wx' });
  const file = { path: target, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size_bytes: bytes.length, role: 'saved_model' };
  const core = { version, task_id: task.task_id, input: normalizeNativeAppearanceInput(appearance), model_revision: revision(1) };
  const plan = { ...core, appearance_plan_hash: sha256Canonical(core) };
  const planRecord = { task_id: task.task_id, plan, binding: { task_id: task.task_id, plan_hash: plan.appearance_plan_hash, model_revision: plan.model_revision }, directory };
  const signed = async body => ({ ...body, integrity_hmac: await taskStore.mutationReceiptLedger.sign(body) });
  const savePlan = async () => taskStore.update(task.task_id, { private: { appearance_plan: await signed(planRecord) } });
  await savePlan();
  const base = { version, task_id: task.task_id, plan_hash: plan.appearance_plan_hash };
  const claim = { ...base, phase: 'started' };
  const complete = { ...base, phase: 'complete', file,
    saved_state: { runtime: 'queue', session_id: 'offline-session', document_id: 'offline-document', model_identity: { runtime_object_id: '42', source_path: target, title: 'model', model_guid: 'offline-guid' }, model_revision: revision(2), model_revision_complete: true, model_modified: false },
    capture: { server_verified: true, model_revision: revision(2), model_revision_complete: true },
    native_receipt: trustedBridgeReceipt({ runtime: 'queue', nativeReceipt: { version: 'mutation-receipt.v1', kind: 'sketchup_mutation_receipt', operation: 'Fixture build', commit_state: 'committed', committed_at: new Date().toISOString() } }),
    result: { kind: 'model_accessibility_appearance', stage: 'applied', saved: true, file: { bytes: file.size_bytes, sha256: file.sha256 }, model_revision: revision(2), quality_accepted: false, evidence_level: 'live_saved_file', native_readback: { ok: true }, uv_readback: { ok: true }, geometry_preserved: true, unrelated_unchanged: true, native_style_readback: true, native_workflow_readback: true } };
  const saveRecords = async () => {
    await fs.writeFile(path.join(directory, 'execution-claim.json'), JSON.stringify(await signed(claim)));
    await fs.writeFile(path.join(directory, 'complete-receipt.json'), JSON.stringify(await signed(complete)));
  };
  await saveRecords();
  return { taskStore, task, complete, claim, planRecord, target, directory, saveRecords, savePlan, read: () => readNativeAppearanceSavedProvenance({ taskStore, appearanceTaskId: task.task_id }) };
}
try {
  const valid = await fixture(), proof = await valid.read();
  assert.equal(proof.delivery_task_id, valid.task.task_id);
  assert.deepEqual(proof.after_identity, valid.complete.saved_state.model_identity);
  assert.equal(proof.post_save_revision, revision(2));
  assert.equal(proof.source_binding.document_id, 'offline-document');
  assert.equal(proof.parameter_continuation_available, false);
  assert.equal(proof.parameter_binding, undefined);
  assert.equal(proof.quality_accepted, false);
  const legacy = await fixture(); delete legacy.complete.saved_state; await legacy.saveRecords();
  await assert.rejects(legacy.read(), error => error.code === 'OPERATION_NOT_ALLOWED' && /no signed post-save/.test(error.message));
  for (const mutate of [
    value => { value.saved_state.model_modified = true; },
    value => { value.saved_state.model_revision_complete = false; },
    value => { value.saved_state.model_revision = revision(9); },
    value => { value.saved_state.model_identity.source_path = '/untrusted/other.skp'; },
    value => { value.saved_state.document_id = ''; },
    value => { value.capture.server_verified = false; },
    value => { value.result.native_readback.ok = false; },
    value => { value.result.native_workflow_readback = false; },
    value => { value.result.quality_accepted = true; },
    value => { value.native_receipt.native_receipt.commit_state = 'unknown'; },
    value => { value.plan_hash = revision(99); }
  ]) {
    const broken = await fixture(); mutate(broken.complete); await broken.saveRecords();
    await assert.rejects(broken.read(), error => error.code === 'ARTIFACT_INTEGRITY_ERROR');
  }
  const wrongClaim = await fixture(); wrongClaim.claim.task_id = valid.task.task_id; await wrongClaim.saveRecords();
  await assert.rejects(wrongClaim.read(), error => error.code === 'ARTIFACT_INTEGRITY_ERROR');
  const tampered = await fixture();
  const receiptPath = path.join(tampered.directory, 'complete-receipt.json');
  const record = JSON.parse(await fs.readFile(receiptPath, 'utf8')); record.saved_state.document_id = 'forged-doc';
  await fs.writeFile(receiptPath, JSON.stringify(record));
  await assert.rejects(tampered.read(), error => error.code === 'ARTIFACT_INTEGRITY_ERROR' && /signature/.test(error.message));
  const alteredFile = await fixture(); await fs.appendFile(alteredFile.target, 'altered');
  await assert.rejects(alteredFile.read(), error => error.code === 'ARTIFACT_INTEGRITY_ERROR');
  const changedInput = await fixture(); await changedInput.taskStore.update(changedInput.task.task_id, { inputs: { runtime: 'queue', appearance: { ...changedInput.task.inputs.appearance, rotation: 45 } } });
  await assert.rejects(changedInput.read(), error => error.code === 'ARTIFACT_INTEGRITY_ERROR');
  const symlink = await fixture(); await fs.rename(symlink.target, `${symlink.target}.original`); await fs.symlink(`${symlink.target}.original`, symlink.target);
  await assert.rejects(symlink.read(), error => error.code === 'ARTIFACT_INTEGRITY_ERROR');
  console.log(JSON.stringify({ ok: true, evidence: 'isolated_signed_provenance_reader_fixtures', native_calls: 0, approval_decisions: 0, real_skp_acceptance: false }));
} finally { await fs.rm(root, { recursive: true, force: true }); }
