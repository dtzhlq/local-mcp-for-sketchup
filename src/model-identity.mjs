import path from 'node:path';
import { AgentContractError, sha256Canonical } from './agent-contract.mjs';

export function modelIdentityForAdoption(adoption, { identityHint } = {}) {
  if (adoption?.kind !== 'adopt_open_model') {
    throw new AgentContractError('INVALID_ARGUMENT', 'A stable model identity requires an adopt_open_model report.');
  }
  const runtime = String(adoption.runtime || 'unknown');
  const candidates = [identityHint, adoption.model_identity].filter((value) => value && typeof value === 'object');
  const sourcePath = firstString([
    ...candidates.map((value) => value.source_path),
    adoption.model_info?.source_path
  ]);
  if (sourcePath) return opaqueIdentity('source_path', 'persistent', runtime, path.resolve(sourcePath));

  const documentId = firstString([
    ...candidates.map((value) => value.document_id),
    adoption.document_id
  ]);
  if (documentId) return opaqueIdentity('document_id', 'session', runtime, documentId);

  const runtimeObjectId = firstString(candidates.map((value) => value.runtime_object_id));
  if (runtimeObjectId) return opaqueIdentity('runtime_object_id', 'session', runtime, runtimeObjectId);

  const guid = firstString(candidates.map((value) => value.model_guid));
  if (guid) return opaqueIdentity('model_guid', 'version', runtime, guid);

  throw new AgentContractError('MODEL_IDENTITY_UNAVAILABLE', 'A stable model identity is required before model-bound planning.', {
    details: { runtime, next_required_input: runtime === 'queue' ? 'fresh_queue_handshake' : 'stable_runtime_model_identity' }
  });
}

export function modelKeyForIdentity(identity) {
  const fingerprint = String(identity?.fingerprint || '');
  if (!/^sha256:[0-9a-f]{64}$/.test(fingerprint)) {
    throw new AgentContractError('MODEL_IDENTITY_UNAVAILABLE', 'The model identity fingerprint is invalid.');
  }
  return `model_${fingerprint.slice(7, 39)}`;
}

function opaqueIdentity(basis, stability, runtime, rawValue) {
  return {
    basis,
    stability,
    runtime,
    fingerprint: sha256Canonical({ basis, runtime, value: String(rawValue) }),
    sensitive_values_persisted: false
  };
}

function firstString(values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || null;
}
