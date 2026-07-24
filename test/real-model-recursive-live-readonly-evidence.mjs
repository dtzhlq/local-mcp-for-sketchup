import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

if (!process.argv.includes('--local-capture')) {
  process.stderr.write(
    'LOCAL_CAPTURE_REQUIRED: this verifier reads machine-local raw live artifacts; run npm run test:real-model-recursive-live-readonly-capture-local explicitly.\n'
  );
  process.exit(2);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = 'docs/evidence/real-model-recursive-live-readonly-evidence-2026-07-20-capability6.json';
const schemaPath = 'schema/real-model-recursive-live-readonly-evidence-v1.schema.json';
const evidenceRaw = await fs.readFile(path.join(repoRoot, evidencePath), 'utf8');
const [evidence, schema] = await Promise.all([
  Promise.resolve(JSON.parse(evidenceRaw)),
  readJson(schemaPath)
]);
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
let assertions = 0;

assertValid(ajv, schema, evidence, 'capability .6 live wrapper'); assertions += 1;
assert.equal(evidence.runtime.capability_version, '0.1.0-rc.2-capabilities.6'); assertions += 1;
assert.equal(evidence.runtime.structural_groups_version, 'structural-groups.v1'); assertions += 1;
assert.equal(evidence.result, 'pass_with_fail_closed_terminal_blocker'); assertions += 1;

const artifactEntries = Object.entries(evidence.artifact_bindings);
assert.equal(artifactEntries.length, 7); assertions += 1;
for (const [name, binding] of artifactEntries) {
  assert.equal(pathInsideRepo(binding.path), true, `${name} path must stay workspace-relative`); assertions += 1;
  assert.equal(await sha256File(binding.path), binding.sha256, `stale evidence binding: ${name}`); assertions += 1;
}
assert.match(
  evidence.artifact_bindings.recursive_terminal_review.path,
  /recursive-review-probe-round8-terminal-v2-original-readonly\.json$/
); assertions += 1;
assert.doesNotMatch(
  evidence.artifact_bindings.recursive_terminal_review.path,
  /round8-terminal-original-readonly\.json$/
); assertions += 1;

// Installed locations are deliberately omitted. These paired digests record the
// exact workspace/installed match at capture time without making immutable live
// evidence depend on whatever source tree happens to exist in a future checkout.
for (const [name, binding] of Object.entries(evidence.installed_source).filter(([, value]) => value && typeof value === 'object')) {
  assert.equal(pathInsideRepo(binding.workspace_path), true, `${name} workspace path must stay relative`); assertions += 1;
  assert.equal(binding.workspace_sha256_at_capture, binding.installed_sha256_at_capture, `${name} capture hash mismatch`); assertions += 1;
  assert.equal(binding.capture_time_exact_match, true); assertions += 1;
}

const inventory = await readBoundArtifact('inventory');
const mapping = await readBoundArtifact('semantic_mapping');
const amendment = await readBoundArtifact('semantic_mapping_amendment');
const sessionResult = await readBoundArtifact('session_contract');
const phase1 = await readBoundArtifact('structural_phase1');
const terminalProbe = await readBoundArtifact('structural_terminal_probe');
const terminalReview = await readBoundArtifact('recursive_terminal_review');

assertValid(ajv, await readJson('schema/real-model-candidate-inventory-v1.schema.json'), inventory, 'inventory'); assertions += 1;
assertValid(ajv, await readJson('schema/real-model-candidate-semantic-mapping-v1.schema.json'), mapping, 'semantic mapping'); assertions += 1;
assertValid(ajv, await readJson('schema/real-model-candidate-semantic-mapping-amendment-v1.schema.json'), amendment, 'semantic mapping amendment'); assertions += 1;
assertValid(ajv, await readJson('schema/session-contract-v1.schema.json'), sessionResult.session_contract, 'session contract'); assertions += 1;
assertValid(ajv, await readJson('schema/real-model-recursive-target-review-v1.schema.json'), terminalReview, 'terminal recursive review'); assertions += 1;

const inventoryCandidate = inventory.candidates.find((candidate) => candidate.candidate_id === evidence.source.candidate_id);
assert.ok(inventoryCandidate); assertions += 1;
assert.equal(inventoryCandidate.candidate_handle, evidence.source.candidate_handle); assertions += 1;
assert.equal(inventoryCandidate.source.sha256, evidence.source.sha256_before); assertions += 1;
assert.equal(inventoryCandidate.source.size_bytes, evidence.source.size_bytes); assertions += 1;
assert.equal(amendment.addition.candidate_id, evidence.source.candidate_id); assertions += 1;
assert.equal(amendment.addition.source_sha256, evidence.source.sha256_before); assertions += 1;
assert.equal(amendment.bindings.base_mapping.sha256, stripPrefix(evidence.artifact_bindings.semantic_mapping.sha256)); assertions += 1;
assert.equal(amendment.bindings.candidate_inventory.sha256, stripPrefix(evidence.artifact_bindings.inventory.sha256)); assertions += 1;
assert.equal(await sha256File(evidence.source.relative_path), evidence.source.sha256_after); assertions += 1;
assert.equal((await fs.stat(path.join(repoRoot, evidence.source.relative_path))).size, evidence.source.size_bytes); assertions += 1;
assert.equal(evidence.source.sha256_before, evidence.source.sha256_after); assertions += 1;

const session = sessionResult.session_contract;
assert.equal(sessionResult.kind, 'create_queue_handshake'); assertions += 1;
assert.equal(sessionResult.mutates_model, false); assertions += 1;
assert.equal(session.capability_version, evidence.runtime.capability_version); assertions += 1;
assert.equal(session.manifest_version, evidence.runtime.manifest_version); assertions += 1;
assert.equal(session.dsl_version, evidence.runtime.dsl_version); assertions += 1;
assert.equal(session.queue_state, 'idle'); assertions += 1;
assert.equal(session.model_revision, evidence.revision_attestation.handshake); assertions += 1;
assert.equal(session.document_id, evidence.session_summary.document_id); assertions += 1;
assert.equal(typeof session.signature, 'string'); assertions += 1;
assert.ok(session.signature.length > 20); assertions += 1;
assert.equal(evidenceRaw.includes(session.signature), false, 'public wrapper must not copy the session signature'); assertions += 1;
assert.equal(containsPropertyNamed(evidence, 'signature'), false, 'public wrapper must not expose a signature property'); assertions += 1;
assert.equal(evidence.artifact_bindings.session_contract.sensitive_fields_embedded_in_wrapper, false); assertions += 1;
assert.equal(evidence.session_summary.used_as_mutation_authority, false); assertions += 1;

assert.equal(phase1.kind, 'adopt_open_model'); assertions += 1;
assert.equal(phase1.runtime, 'queue'); assertions += 1;
assert.equal(phase1.read_only, true); assertions += 1;
assert.equal(phase1.session_id, session.session_id); assertions += 1;
assert.equal(phase1.document_id, session.document_id); assertions += 1;
assert.equal(phase1.model_revision, evidence.revision_attestation.structural_phase1); assertions += 1;
assert.equal(phase1.model_revision_complete, true); assertions += 1;
assert.equal(phase1.structural_groups.version, evidence.runtime.structural_groups_version); assertions += 1;
assert.equal(phase1.structural_groups.total_seen, evidence.structural_probe.total_seen); assertions += 1;
assert.equal(phase1.structural_groups.returned, evidence.structural_probe.returned); assertions += 1;
assert.equal(phase1.structural_groups.truncated, false); assertions += 1;
assert.equal(phase1.structural_groups.fresh_manifold_requested, 0); assertions += 1;
assert.equal(phase1.structural_groups.fresh_manifold_matched, 0); assertions += 1;

assert.equal(terminalProbe.kind, 'adopt_open_model'); assertions += 1;
assert.equal(terminalProbe.runtime, 'queue'); assertions += 1;
assert.equal(terminalProbe.read_only, true); assertions += 1;
assert.equal(terminalProbe.session_id, session.session_id); assertions += 1;
assert.equal(terminalProbe.document_id, session.document_id); assertions += 1;
assert.equal(terminalProbe.model_revision, evidence.revision_attestation.structural_terminal_probe); assertions += 1;
assert.equal(terminalProbe.model_revision_complete, true); assertions += 1;
assert.equal(terminalProbe.structural_groups.total_seen, 41); assertions += 1;
assert.equal(terminalProbe.structural_groups.total_seen_exact, true); assertions += 1;
assert.equal(terminalProbe.structural_groups.returned, 41); assertions += 1;
assert.equal(terminalProbe.structural_groups.truncated, false); assertions += 1;
assert.equal(terminalProbe.structural_groups.fresh_manifold_requested, 15); assertions += 1;
assert.equal(terminalProbe.structural_groups.fresh_manifold_matched, 15); assertions += 1;
assert.equal(terminalProbe.structural_groups.fresh_manifold_unmatched, 0); assertions += 1;
assert.deepEqual(terminalProbe.structural_groups.fresh_manifold_unmatched_paths, []); assertions += 1;

const fresh = terminalProbe.structural_groups.entries.filter((entry) => entry.manifold_attestation.status === 'fresh_matched');
const manifold = fresh.filter((entry) => entry.manifold_attestation.is_manifold === true);
const nonManifold = fresh.filter((entry) => entry.manifold_attestation.is_manifold === false);
assert.equal(fresh.length, evidence.structural_probe.terminal_fresh_matched); assertions += 1;
assert.equal(manifold.length, evidence.structural_probe.terminal_manifold); assertions += 1;
assert.equal(nonManifold.length, evidence.structural_probe.terminal_non_manifold); assertions += 1;
for (const entry of fresh) {
  const attestation = entry.manifold_attestation;
  assert.equal(attestation.fresh, true); assertions += 1;
  assert.equal(attestation.matched, true); assertions += 1;
  assert.equal(attestation.entity_path, entry.entity_path); assertions += 1;
  assert.equal(attestation.model_revision, terminalProbe.model_revision); assertions += 1;
  assert.equal(attestation.report.entity_path, entry.entity_path); assertions += 1;
  assert.equal(attestation.report.model_revision, terminalProbe.model_revision); assertions += 1;
  assert.equal(attestation.report.checked, true); assertions += 1;
  assert.equal(attestation.report.method, 'sketchup_manifold_api'); assertions += 1;
  assert.equal(attestation.report.is_manifold, attestation.is_manifold); assertions += 1;
}

assert.equal(terminalReview.runtime, 'offline'); assertions += 1;
assert.equal(terminalReview.live_queue_called, false); assertions += 1;
assert.equal(terminalReview.source.sha256, evidence.source.sha256_after); assertions += 1;
assert.equal(terminalReview.model.revision, evidence.revision_attestation.recursive_terminal_review); assertions += 1;
assert.equal(terminalReview.model.revision_complete, true); assertions += 1;
assert.equal(terminalReview.input_summary.total_seen, 41); assertions += 1;
assert.equal(terminalReview.input_summary.fresh_manifold_requested, 15); assertions += 1;
assert.equal(terminalReview.input_summary.fresh_manifold_matched, 15); assertions += 1;
assert.equal(terminalReview.input_summary.fresh_manifold_unmatched, 0); assertions += 1;
assert.equal(terminalReview.input_summary.exact_fresh_entry_matches, 15); assertions += 1;
assert.equal(terminalReview.review.status, 'blocked'); assertions += 1;
assert.deepEqual(terminalReview.review.blockers, ['no_manifold_qualified_pair']); assertions += 1;
assert.deepEqual(terminalReview.review.manifold_probe_paths, []); assertions += 1;
assert.equal(terminalReview.review.recommended_proposal, null); assertions += 1;
assert.equal(terminalReview.review.role_bindings, null); assertions += 1;
assert.equal(terminalReview.next_action.action, 'select_manifold_qualified_disposable_model_case'); assertions += 1;
assert.deepEqual(terminalReview.next_action.manifold_probe_paths, []); assertions += 1;
assert.equal(terminalReview.next_action.mutation_authorized, false); assertions += 1;
assert.equal(terminalReview.next_action.release_acceptance, false); assertions += 1;
assert.equal(terminalReview.safety.model_mutation_requested, false); assertions += 1;
assert.equal(terminalReview.safety.model_mutation_authorized, false); assertions += 1;

assert.deepEqual(evidence.safety.queue_before, { queue: 0, processing: 0, responses: 0, lock_exists: false }); assertions += 1;
assert.deepEqual(evidence.safety.queue_after, { queue: 0, processing: 0, responses: 0, lock_exists: false }); assertions += 1;
assert.equal(evidence.safety.model_content_mutation_requested, false); assertions += 1;
assert.equal(evidence.safety.model_content_mutation_performed, false); assertions += 1;
assert.equal(evidence.authorization_boundary.mutation_authorized, false); assertions += 1;
assert.equal(evidence.release_acceptance, false); assertions += 1;

const negativeCases = [
  mutate(evidence, (value) => { value.runtime.capability_version = '0.1.0-rc.2-capabilities.5'; }),
  mutate(evidence, (value) => { value.artifact_bindings.recursive_terminal_review.path = '/tmp/terminal.json'; }),
  mutate(evidence, (value) => { value.artifact_bindings.session_contract.sensitive_fields_embedded_in_wrapper = true; }),
  mutate(evidence, (value) => { value.terminal_review.blockers = []; }),
  mutate(evidence, (value) => { value.terminal_review.next_action = 'resolve_fail_closed_recursive_review_blockers'; }),
  mutate(evidence, (value) => { value.safety.model_content_mutation_performed = true; }),
  mutate(evidence, (value) => { value.authorization_boundary.mutation_authorized = true; }),
  mutate(evidence, (value) => { value.release_acceptance = true; })
];
const validate = ajv.compile(schema);
for (const invalid of negativeCases) {
  assert.equal(validate(invalid), false, 'unsafe or ambiguous live-evidence mutation must fail schema validation'); assertions += 1;
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  capability_version: evidence.runtime.capability_version,
  structural_groups: evidence.structural_probe.total_seen,
  fresh_matched: evidence.structural_probe.terminal_fresh_matched,
  manifold: evidence.structural_probe.terminal_manifold,
  non_manifold: evidence.structural_probe.terminal_non_manifold,
  terminal_blocker: evidence.terminal_review.blockers[0],
  next_action: evidence.terminal_review.next_action,
  artifact_hashes_checked: artifactEntries.length,
  sensitive_session_value_embedded: false,
  queue_clean: true,
  mutation_performed: false,
  release_acceptance: false,
  schema_negative_cases: negativeCases.length,
  assertions
}, null, 2)}\n`);

async function readBoundArtifact(name) {
  return readJson(evidence.artifact_bindings[name].path);
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
}

async function sha256File(relativePath) {
  const digest = crypto.createHash('sha256').update(await fs.readFile(path.join(repoRoot, relativePath))).digest('hex');
  return `sha256:${digest}`;
}

function assertValid(instance, valueSchema, value, label) {
  const validate = instance.compile(valueSchema);
  assert.equal(validate(value), true, `${label}: ${JSON.stringify(validate.errors, null, 2)}`);
}

function pathInsideRepo(relativePath) {
  const candidate = path.resolve(repoRoot, relativePath);
  const relative = path.relative(repoRoot, candidate);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function stripPrefix(value) {
  return value.replace(/^sha256:/, '');
}

function containsPropertyNamed(value, needle) {
  if (!value || typeof value !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(value, needle)) return true;
  return Object.values(value).some((child) => containsPropertyNamed(child, needle));
}

function mutate(value, callback) {
  const result = structuredClone(value);
  callback(result);
  return result;
}
