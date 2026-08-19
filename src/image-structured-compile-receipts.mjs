import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson } from './agent-contract.mjs';
import { defaultStateDir } from './paths.mjs';

export const IMAGE_STRUCTURED_COMPILE_RECEIPT_VERSION = 'image-structured-compile-receipt.v1';

export class ImageStructuredCompileReceiptAuthority {
  constructor({ stateDir = path.join(defaultStateDir, 'image-structured-compile-receipts') } = {}) {
    this.stateDir = path.resolve(stateDir);
    this.privateKeyPath = path.join(this.stateDir, 'ed25519-private-key.pem');
    this.publicKeyPath = path.join(this.stateDir, 'ed25519-public-key.pem');
    this.keysPromise = null;
  }

  async issue({ binding, authorization, dslSha256 = null } = {}) {
    assertBinding(binding);
    assertAuthorization(binding, authorization);
    if (dslSha256 !== null && !/^sha256:[a-f0-9]{64}$/.test(String(dslSha256))) {
      throw new Error('Compiled DSL SHA-256 must use the sha256:<hex> form');
    }
    const keys = await this.keys();
    const publicKeyFingerprint = fingerprintPublicKey(keys.publicKeyPem);
    const issuedAt = new Date().toISOString();
    const expiresAt = authorization.expires_at;
    const core = {
      version: IMAGE_STRUCTURED_COMPILE_RECEIPT_VERSION,
      kind: 'image_structured_compile_receipt',
      receipt_id: `image_compile_${crypto.randomUUID()}`,
      phase: dslSha256 ? 'compiled_dsl' : 'precompile_authorization',
      binding_hash: binding.binding_hash,
      source_asset_binding_hash: binding.source_asset_binding_hash,
      dsl_sha256: dslSha256,
      part_graph_id: binding.part_graph_id,
      part_graph_signature: binding.artifact_signatures.part_graph,
      accepted_candidate_ids: [...binding.accepted_candidate_ids],
      approval_challenge_id: authorization.challenge_id,
      approved_by: authorization.approved_by,
      approval_channel: authorization.approval_channel,
      issued_at: issuedAt,
      expires_at: expiresAt,
      public_key_fingerprint: publicKeyFingerprint
    };
    const signature = crypto.sign(null, Buffer.from(canonicalJson(core)), keys.privateKey).toString('base64url');
    return { ...core, signature };
  }

  async publicKeyPem() {
    return (await this.keys()).publicKeyPem;
  }

  async keys() {
    if (!this.keysPromise) this.keysPromise = this.loadOrCreateKeys();
    return this.keysPromise;
  }

  async loadOrCreateKeys() {
    await fs.mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    try {
      const [privateKeyPem, publicKeyPem] = await Promise.all([
        fs.readFile(this.privateKeyPath, 'utf8'),
        fs.readFile(this.publicKeyPath, 'utf8')
      ]);
      return verifiedKeyPair(privateKeyPem, publicKeyPem);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
    await Promise.all([
      writeExclusive(this.privateKeyPath, privateKeyPem, 0o600),
      writeExclusive(this.publicKeyPath, publicKeyPem, 0o644)
    ]);
    const [persistedPrivateKeyPem, persistedPublicKeyPem] = await Promise.all([
      fs.readFile(this.privateKeyPath, 'utf8'),
      fs.readFile(this.publicKeyPath, 'utf8')
    ]);
    return verifiedKeyPair(persistedPrivateKeyPem, persistedPublicKeyPem);
  }
}

export function verifyImageStructuredCompileReceipt(receipt, {
  binding,
  publicKeyPem,
  dslSha256 = null,
  expectedPhase = null,
  now = Date.now()
} = {}) {
  assertBinding(binding);
  if (!receipt || typeof receipt !== 'object') throw new Error('Image-structured compile receipt is required');
  if (receipt.version !== IMAGE_STRUCTURED_COMPILE_RECEIPT_VERSION || receipt.kind !== 'image_structured_compile_receipt') {
    throw new Error('Image-structured compile receipt version is invalid');
  }
  if (!['precompile_authorization', 'compiled_dsl'].includes(receipt.phase)) {
    throw new Error('Image-structured compile receipt phase is invalid');
  }
  if (expectedPhase !== null && receipt.phase !== expectedPhase) {
    throw new Error(`Image-structured compile receipt phase mismatch: expected ${expectedPhase}`);
  }
  if (receipt.binding_hash !== binding.binding_hash) throw new Error('Image-structured compile receipt binding hash mismatch');
  if (receipt.source_asset_binding_hash !== binding.source_asset_binding_hash) {
    throw new Error('Image-structured compile receipt source asset binding mismatch');
  }
  if (dslSha256 !== null) {
    if (!/^sha256:[a-f0-9]{64}$/.test(String(dslSha256))) throw new Error('Expected compiled DSL SHA-256 is invalid');
    if (receipt.phase !== 'compiled_dsl' || receipt.dsl_sha256 !== dslSha256) {
      throw new Error('Image-structured compile receipt DSL hash mismatch');
    }
  } else if (receipt.phase === 'precompile_authorization' && receipt.dsl_sha256 !== null) {
    throw new Error('Precompile authorization receipt must not bind compiled DSL bytes');
  } else if (receipt.phase === 'compiled_dsl' && !/^sha256:[a-f0-9]{64}$/.test(String(receipt.dsl_sha256 || ''))) {
    throw new Error('Compiled DSL receipt is missing its DSL hash');
  }
  if (receipt.part_graph_id !== binding.part_graph_id) throw new Error('Image-structured compile receipt PartGraph id mismatch');
  if (receipt.part_graph_signature !== binding.artifact_signatures.part_graph) {
    throw new Error('Image-structured compile receipt PartGraph signature mismatch');
  }
  if (!sameStringSet(receipt.accepted_candidate_ids, binding.accepted_candidate_ids)) {
    throw new Error('Image-structured compile receipt accepted candidates mismatch');
  }
  if (!Number.isFinite(Date.parse(receipt.expires_at)) || Date.parse(receipt.expires_at) <= now) {
    throw new Error('Image-structured compile receipt is expired');
  }
  if (typeof publicKeyPem !== 'string' || !publicKeyPem.includes('BEGIN PUBLIC KEY')) {
    throw new Error('Trusted image-structured compile public key is required');
  }
  if (receipt.public_key_fingerprint !== fingerprintPublicKey(publicKeyPem)) {
    throw new Error('Image-structured compile receipt public key fingerprint mismatch');
  }
  const { signature, ...core } = receipt;
  if (typeof signature !== 'string' || !signature) throw new Error('Image-structured compile receipt signature is missing');
  const ok = crypto.verify(
    null,
    Buffer.from(canonicalJson(core)),
    crypto.createPublicKey(publicKeyPem),
    Buffer.from(signature, 'base64url')
  );
  if (!ok) throw new Error('Image-structured compile receipt signature is invalid');
  return true;
}

export function fingerprintPublicKey(publicKeyPem) {
  const der = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return `sha256:${crypto.createHash('sha256').update(der).digest('hex')}`;
}

function assertBinding(binding) {
  if (!binding || binding.kind !== 'image_structured_compile_binding' || !/^sha256:[a-f0-9]{64}$/.test(String(binding.binding_hash || ''))) {
    throw new Error('A valid image-structured compile binding is required');
  }
  if (!binding.part_graph_id || !/^sha256:[a-f0-9]{64}$/.test(String(binding.artifact_signatures?.part_graph || ''))) {
    throw new Error('The image-structured compile binding must include the PartGraph signature');
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(String(binding.source_asset_binding_hash || ''))) {
    throw new Error('The image-structured compile binding must include verified source assets');
  }
  if (!Array.isArray(binding.accepted_candidate_ids) || binding.accepted_candidate_ids.length === 0) {
    throw new Error('The image-structured compile binding must include accepted candidates');
  }
}

function assertAuthorization(binding, authorization) {
  if (!authorization || authorization.kind !== 'approval_token') throw new Error('Trusted local approval authorization is required');
  if (authorization.plan_id !== binding.part_graph_id) throw new Error('Approval plan id does not match the PartGraph');
  if (authorization.plan_hash !== binding.binding_hash) throw new Error('Approval plan hash does not match the compile binding');
  if (authorization.model_revision !== binding.artifact_signatures.part_graph) throw new Error('Approval model revision does not match the PartGraph signature');
  if (authorization.risk_level !== 'S2') throw new Error('Image-structured compile approval must use S2 risk');
  if (!authorization.allowed_operations?.includes('compile_reviewed_part_graph')) {
    throw new Error('Approval does not allow compile_reviewed_part_graph');
  }
  if (!authorization.approved_by || !authorization.approval_channel) throw new Error('Approval has no trusted user-presence identity');
  if (!Number.isFinite(Date.parse(authorization.expires_at)) || Date.parse(authorization.expires_at) <= Date.now()) {
    throw new Error('Approval authorization is expired');
  }
}

function verifiedKeyPair(privateKeyPem, publicKeyPem) {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const derivedPublicKeyPem = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  if (fingerprintPublicKey(derivedPublicKeyPem) !== fingerprintPublicKey(publicKeyPem)) {
    throw new Error('Image-structured compile receipt keypair is inconsistent');
  }
  return { privateKey, publicKeyPem };
}

async function writeExclusive(filePath, content, mode) {
  try {
    const handle = await fs.open(filePath, 'wx', mode);
    await handle.writeFile(content, 'utf8');
    await handle.close();
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
}

function sameStringSet(left, right) {
  const first = [...new Set(left || [])].sort();
  const second = [...new Set(right || [])].sort();
  return first.length === second.length && first.every((value, index) => value === second[index]);
}
