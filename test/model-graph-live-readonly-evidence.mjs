import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(await fs.readFile(new URL('../schema/model-graph-live-readonly-evidence-v1.schema.json', import.meta.url), 'utf8'));
const evidence = JSON.parse(await fs.readFile(new URL('../docs/evidence/model-graph-v1-live-readonly-evidence-2026-07-16.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const valid = ajv.validate(schema, evidence);
assert.equal(valid, true, JSON.stringify(ajv.errors));
assert.equal(evidence.adoption.model_revision_before, evidence.adoption.model_revision_after);
assert.equal(evidence.adoption.total_seen, evidence.adoption.indexed);
assert.equal(evidence.model.model_revision, evidence.adoption.model_revision_after);
assert.equal(evidence.proposal.execution_allowed, false);
assert.equal(evidence.proposal.selected_target_count, 0);
assert.equal(evidence.proposal.operation_count, 0);
assert.equal(evidence.live_mutation_performed, false);
assert.equal(evidence.release_acceptance, false);
assert.equal(evidence.installed_source.current_workspace_exact_hash_match, true);
assert.equal(evidence.installed_source.requires_reinstall_restart, false);

process.stdout.write(`${JSON.stringify({
  ok: true,
  evidence_scope: evidence.evidence_scope,
  live_mutation_performed: false,
  revision_unchanged: true,
  ambiguity_fail_closed: true,
  queue_clean: true,
  release_acceptance: false,
  requires_reinstall_restart: false
}, null, 2)}\n`);
