import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(await fs.readFile(new URL('../schema/live-visual-capture-evidence-v1.schema.json', import.meta.url), 'utf8'));
const evidence = JSON.parse(await fs.readFile(new URL('../docs/evidence/live-visual-capture-evidence-2026-07-16.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validate = ajv.compile(schema);

assert.equal(validate(evidence), true, JSON.stringify(validate.errors));
assert.equal(evidence.installed_source.installed_plugin_main_sha256, evidence.installed_source.workspace_plugin_main_sha256);
assert.equal(evidence.model_binding.total_seen, evidence.model_binding.indexed);
assert.equal(evidence.capture.handle, `image-artifact:${evidence.capture.sha256}`);
assert.equal(evidence.capture.provenance.model_revision, evidence.model_binding.model_revision);
assert.equal(evidence.invariants.live_mutation_performed, false);
assert.equal(evidence.invariants.external_reference_used, false);
assert.equal(evidence.invariants.reviewed_edit_performed, false);
assert.equal(evidence.release_acceptance, false);

for (const mutate of [
  (value) => { value.installed_source.exact_hash_match = false; },
  (value) => { value.invariants.live_mutation_performed = true; },
  (value) => { value.queue_after.processing = 1; },
  (value) => { value.release_acceptance = true; }
]) {
  const invalid = structuredClone(evidence);
  mutate(invalid);
  assert.equal(validate(invalid), false);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  current_source_exact_match: true,
  live_capture: true,
  revision_unchanged: true,
  queue_clean: true,
  live_mutation_performed: false,
  external_reference_used: false,
  release_acceptance: false,
  negative_cases: 4
}, null, 2)}\n`);
