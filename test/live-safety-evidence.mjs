import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [schema, evidence] = await Promise.all([
  readJson('schema/agent-contract-live-safety-evidence-v1.schema.json'),
  readJson('docs/evidence/agent-contract-v1-live-safety-evidence-2026-07-15.json')
]);
const validate = new Ajv2020({ allErrors: true, strict: false, validateFormats: false }).compile(schema);

assert.equal(validate(evidence), true, JSON.stringify(validate.errors, null, 2));
assert.equal(evidence.release_acceptance, false);
assert.equal(evidence.gates.mdi_routing.intermediary_closed_to_force_routing, false);
assert.equal(evidence.gates.mdi_routing.wrong_document_mutation_count, 0);

const releaseOverclaim = clone(evidence);
releaseOverclaim.release_acceptance = true;
assert.equal(validate(releaseOverclaim), false, 'live slice evidence must never sign a release candidate');

const missingMdiProof = clone(evidence);
missingMdiProof.gates.mdi_routing.status = 'failed_closed';
assert.equal(validate(missingMdiProof), false, 'named-slice acceptance requires current-source two-window MDI proof');

const forcedRouting = clone(evidence);
forcedRouting.gates.mdi_routing.intermediary_closed_to_force_routing = true;
assert.equal(validate(forcedRouting), false, 'closing the intermediary may not count as an MDI routing pass');

const absoluteArtifact = clone(evidence);
absoluteArtifact.gates.strong_save_reopen.artifact.path = '/tmp/report.json';
assert.equal(validate(absoluteArtifact), false, 'public evidence artifacts must be repo-relative');

const sourceMismatch = clone(evidence);
sourceMismatch.source_binding.installed_plugin_matches_source = false;
assert.equal(validate(sourceMismatch), false, 'current-source acceptance requires installed/source hash parity');

process.stdout.write(`${JSON.stringify({
  ok: true,
  schema: 'agent-contract-live-safety-evidence-v1',
  named_slice_acceptance: evidence.named_slice_acceptance,
  release_acceptance: evidence.release_acceptance,
  negative_cases: 5
}, null, 2)}\n`);

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
