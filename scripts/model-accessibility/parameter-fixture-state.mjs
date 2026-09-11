import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256Canonical } from '../../src/agent-contract.mjs';

export const PARAMETER_FIXTURE_STATE_VERSION = 'host-parameter-fixture-state.v1';
export const PARAMETER_FIXTURE_STATE_FILENAME = 'parameter-fixture-ready.private.json';
export async function writeParameterFixtureState({ bridge, stateRoot, record }) {
  const body = { ...record, version: PARAMETER_FIXTURE_STATE_VERSION, state_root: path.resolve(stateRoot), task_store_root: path.resolve(bridge.taskStore.rootDir) };
  const signed = { ...body, integrity_hmac: await bridge.taskStore.mutationReceiptLedger.sign(body) };
  await fs.writeFile(path.join(stateRoot, PARAMETER_FIXTURE_STATE_FILENAME), `${JSON.stringify(signed, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return body;
}

// Host-only directory attachment. No native reads, task-state refresh, source
// recapture, approval issuing or model-visible identity hints are performed.
export async function verifyParameterFixtureState({ bridge, stateRoot, runtime }) {
  const filename = path.join(stateRoot, PARAMETER_FIXTURE_STATE_FILENAME);
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw new Error('Invalid initialized parameter fixture manifest.');
  const { integrity_hmac, ...body } = JSON.parse(await fs.readFile(filename, 'utf8'));
  if (body.version !== PARAMETER_FIXTURE_STATE_VERSION || body.fixture_ready !== true || body.formal_acceptance !== false ||
    body.runtime !== runtime || body.state_root !== path.resolve(stateRoot) || body.task_store_root !== path.resolve(bridge.taskStore.rootDir) ||
    integrity_hmac !== await bridge.taskStore.mutationReceiptLedger.sign(body) ||
    !Array.isArray(body.creation_sources) || body.creation_sources.length !== 2 || new Set(body.creation_sources.map(item => item.task_id)).size !== 2)
    throw new Error('Initialized parameter fixture binding/signature mismatch.');
  for (const source of body.creation_sources) {
    const task = await bridge.taskStore.getTask(source.task_id, { includePrivate: true }), record = task.private?.creation?.parameter_source;
    if (!record) throw new Error('Initialized fixture lost its original parameter source.');
    const { source_record_hash, ...core } = record;
    if (task.intent !== 'create_model' || task.inputs.runtime !== runtime || task.private.creation.parameter_edit_support?.baseline_captured !== true ||
      record.version !== 'model-accessibility-parameter-source.v1' || record.runtime !== runtime ||
      record.parameter_revision !== 0 || record.creation_task_id !== task.task_id || source_record_hash !== sha256Canonical(core) ||
      source_record_hash !== source.source_record_hash || sha256Canonical(task.inputs.task) !== source.source_hash ||
      task.private.creation.parameter_source_document_binding !== body.document_binding)
      throw new Error('Initialized fixture parameter source changed or is not an initial trusted capture.');
  }
  return { verified: true, fixture_ready: true, runtime, case_id: body.case_id, formal_acceptance: false };
}
