import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deliverModelAccessibilityTask } from '../src/model-accessibility-delivery.mjs';
import { freezeDetailSpecification } from '../src/detail-quality.mjs';

// Queue-shaped metadata is an isolated fault fixture, never native evidence.
// Stop at save: only the real pre-save identity/revision guard is exercised.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'delivery-stable-document-'));
try {
  const sourceId = 'task_12345678-abcd-4321-aaaa-123456789abc';
  const revision = 'sha256:' + 'a'.repeat(64), frozen = freezeDetailSpecification({ version: 1, required_parts: [{ id: 'root' }], required_views: [] });
  const quality = { quality_status: 'pass', quality_accepted: true, evidence_level: 'live_runtime', remaining: [], specification_hash: frozen.hash };
  const acceptedContract = { runtime: 'queue', session_id: 'fixture-session', document_id: 'fixture-document', model_identity: { model_guid: 'before-camera', runtime_object_id: '500', source_path: null }, model_revision: revision };
  const current = { ...acceptedContract, model_identity: { ...acceptedContract.model_identity, model_guid: 'after-camera-restoration' }, model_revision_complete: true };
  const source = { intent: 'create_model', state: 'completed', inputs: { session_contract: acceptedContract },
    private: { creation: { runtime: 'queue', frozen_spec: frozen, round: { snapshot: { model_revision: revision, model_revision_complete: true } } } },
    result: { kind: 'create_model_result', ...quality, quality, snapshot: { model_revision: revision } } };
  let state = current, saves = 0;
  const bridge = { sessionContractAuthority: { verify: async () => {} }, create_queue_handshake: async () => ({ session_contract: current }),
    withAgentGatewayExecution: async (_, callback) => callback({ withLiveMutationAuthorization: async (_, callback) => callback({
      selectRuntime: () => ({ getSessionState: async () => state }), save_model: async () => { saves++; throw new Error('fixture stops at save'); }
    }) }) };
  const run = async (suffix, expectedCode) => {
    const taskId = 'task_12345678-abcd-4321-aaaa-123456789ab' + suffix;
    const store = { rootDir: path.join(root, suffix), mutationReceiptLedger: { sign: async () => 'fixture-signature' },
      getTask: async id => id === sourceId ? source : { intent: 'deliver_model', inputs: { source_task_id: sourceId, runtime: 'queue', session_contract: current } } };
    await assert.rejects(deliverModelAccessibilityTask({ bridge, taskStore: store, taskId, sourceTaskId: sourceId, sessionContract: current }), error => error.code === expectedCode);
  };
  await run('d', 'MUTATION_RECOVERY_REQUIRED');
  assert.equal(saves, 1, 'restored GUID change must pass the stable document guard');
  state = { ...current, document_id: 'different-document' }; await run('e', 'MODEL_IDENTITY_MISMATCH');
  state = { ...current, model_identity: { ...current.model_identity, source_path: '/different/model.skp' } }; await run('f', 'MODEL_IDENTITY_MISMATCH');
  state = { ...current, model_revision: 'sha256:' + 'b'.repeat(64) }; await run('0', 'MODEL_REVISION_MISMATCH');
  assert.equal(saves, 1, 'another document/path or revision must block before save');
  console.log('Delivery: restored GUID drift accepted only for the same document/path and exact full revision; changed source rejected before save.');
} finally { await fs.rm(root, { recursive: true, force: true }); }
