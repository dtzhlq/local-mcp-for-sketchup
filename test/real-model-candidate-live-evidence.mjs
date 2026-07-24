import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';

const evidence = await readJson('docs/evidence/real-model-candidate-live-evidence-2026-07-20.json');
const evidenceSchema = await readJson('schema/real-model-candidate-live-evidence-v1.schema.json');
const inventory = await readJson(evidence.artifacts.inventory_path);
const inventorySchema = await readJson('schema/real-model-candidate-inventory-v1.schema.json');
const profile = await readJson(evidence.artifacts.profile_path);
const profileSchema = await readJson('schema/real-model-candidate-profile-v1.schema.json');
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });

assertValid(ajv, evidenceSchema, evidence, 'live evidence');
assertValid(ajv, inventorySchema, inventory, 'inventory');
assertValid(ajv, profileSchema, profile, 'profile');
assert.equal(await sha256File(evidence.artifacts.inventory_path), evidence.artifacts.inventory_sha256);
assert.equal(await sha256File(evidence.artifacts.profile_path), evidence.artifacts.profile_sha256);
// This is an immutable historical live-evidence record.  Its workspace hashes
// describe the source tree at capture time; later capability work must not
// rewrite that evidence or make the historical test depend on today's tree.
assert.equal(
  evidence.installed_source.workspace_plugin_main_sha256,
  evidence.installed_source.installed_plugin_main_sha256
);
assert.equal(
  evidence.installed_source.workspace_model_revision_sha256,
  evidence.installed_source.installed_model_revision_sha256
);
assert.equal(evidence.installed_source.exact_match, true);

assert.equal(profile.ok, true);
assert.equal(profile.live_queue_called, true);
assert.equal(profile.sketchup.capability_version, evidence.runtime.capability_version);
assert.equal(profile.sketchup.version, evidence.runtime.sketchup_version);
assert.equal(profile.summary.candidates, evidence.corpus.candidate_count);
assert.equal(profile.summary.profiled, evidence.corpus.profiled);
assert.equal(profile.summary.failed, 0);
assert.equal(profile.summary.formal_cases_accepted, 0);
assert.equal(inventory.candidates.length, evidence.corpus.candidate_count);
assert.equal(inventory.summary.total_bytes, evidence.corpus.total_bytes);
assert.equal(inventory.summary.unique_content_hashes, evidence.corpus.unique_content_hashes);

const inventoryById = new Map(inventory.candidates.map((candidate) => [candidate.candidate_id, candidate]));
const profileById = new Map(profile.profiles.map((candidate) => [candidate.candidate_id, candidate]));
assert.equal(inventoryById.size, evidence.cases.length);
assert.equal(profileById.size, evidence.cases.length);

for (const candidate of evidence.cases) {
  const inventoryCandidate = inventoryById.get(candidate.candidate_id);
  const profileCandidate = profileById.get(candidate.candidate_id);
  assert.ok(inventoryCandidate, `missing inventory candidate ${candidate.candidate_id}`);
  assert.ok(profileCandidate, `missing profile candidate ${candidate.candidate_id}`);
  assert.equal(inventoryCandidate.source.sha256, candidate.source_sha256);
  assert.equal(inventoryCandidate.source.size_bytes, candidate.source_bytes);
  assert.equal(profileCandidate.source_sha256, candidate.source_sha256);
  assert.equal(profileCandidate.status, 'profiled');
  assert.equal(profileCandidate.formal_sidecar.generated, false);
  assert.equal(profileCandidate.revision_attestation.before, candidate.revision_before);
  assert.equal(profileCandidate.revision_attestation.after, candidate.revision_after);
  assert.equal(candidate.revision_before, candidate.revision_after);
  assert.equal(profileCandidate.revision_attestation.complete, true);
  assert.equal(profileCandidate.revision_attestation.unchanged, true);
  assert.equal(profileCandidate.revision_attestation.strategy, candidate.revision_strategy);
  assert.equal(profileCandidate.revision_attestation.unique_entity_limit, candidate.unique_entity_limit);
  assert.equal(profileCandidate.revision_attestation.unique_entities, candidate.unique_entities);
  assert.equal(profileCandidate.revision_attestation.reachable_definitions, candidate.reachable_definitions);
  assert.deepEqual(candidate.structure, {
    top_level_entities: profileCandidate.structure.top_level_entities,
    recursive_sample_indexed: profileCandidate.structure.recursive_indexed,
    logical_occurrences: profileCandidate.structure.recursive_total_seen,
    recursive_sample_truncated: profileCandidate.structure.recursive_truncated,
    max_occurrence_depth: profileCandidate.structure.max_occurrence_depth,
    materials: profileCandidate.structure.materials,
    tags: profileCandidate.structure.tags,
    scenes: profileCandidate.structure.scenes,
    classification_schemas: profileCandidate.structure.classification_schemas,
    hidden_occurrences: profileCandidate.structure.hidden_occurrences,
    locked_occurrences: profileCandidate.structure.locked_occurrences,
    shared_definition_count: profileCandidate.structure.shared_definition_count,
    shared_occurrence_count: profileCandidate.structure.shared_occurrence_count,
    nonuniform_instances: profileCandidate.structure.nonuniform_instance_occurrences,
    mirrored_instances: profileCandidate.structure.mirrored_instance_occurrences,
    warning_count: profileCandidate.structure.warning_count
  });
}

const large = evidence.cases.find((candidate) => candidate.candidate_id === evidence.large_model_gate.candidate_id);
assert.ok(large);
assert.equal(large.structure.logical_occurrences, evidence.large_model_gate.logical_occurrences);
assert.equal(large.unique_entities, evidence.large_model_gate.unique_entities);
assert.equal(large.reachable_definitions, evidence.large_model_gate.reachable_definitions);
assert.ok(large.unique_entities < evidence.runtime.model_revision_unique_entity_limit);
assert.ok(large.structure.logical_occurrences > evidence.runtime.model_revision_unique_entity_limit);
assert.equal(evidence.safety.model_content_mutation_requested, false);
assert.equal(evidence.safety.save_requested, false);
assert.equal(evidence.safety.reset_requested, false);
assert.equal(evidence.safety.ruby_expert_requested, false);
assert.equal(evidence.safety.queue + evidence.safety.processing + evidence.safety.responses, 0);
assert.equal(evidence.safety.lock_exists, false);
assert.equal(evidence.release_acceptance, false);
assert.equal(evidence.cross_version.represented_as_pass, false);

process.stdout.write(`${JSON.stringify({
  ok: true,
  evidence_scope: evidence.evidence_scope,
  candidates: evidence.corpus.candidate_count,
  profiled: evidence.corpus.profiled,
  failures: evidence.corpus.failed,
  large_model_logical_occurrences: evidence.large_model_gate.logical_occurrences,
  large_model_unique_entities: evidence.large_model_gate.unique_entities,
  all_revisions_unchanged: evidence.safety.all_revisions_unchanged,
  originals_unchanged: evidence.safety.original_bytes_unchanged_verified,
  queue_clean: true,
  live_mutation_performed: false,
  release_acceptance: false
}, null, 2)}\n`);

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function assertValid(ajv, schema, value, label) {
  const validate = ajv.compile(schema);
  assert.equal(validate(value), true, `${label}: ${JSON.stringify(validate.errors)}`);
}

async function sha256File(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}
