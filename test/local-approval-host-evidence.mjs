import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [schema, evidence] = await Promise.all([
  readJson('schema/local-approval-host-evidence-v1.schema.json'),
  readJson('docs/evidence/local-approval-host-v1-mock-evidence.json')
]);
const validate = new Ajv2020({ allErrors: true, strict: false, validateFormats: false }).compile(schema);

assert.equal(validate(evidence), true, JSON.stringify(validate.errors, null, 2));
assert.equal(evidence.boundaries.real_user_approval, false);
assert.equal(evidence.boundaries.live_queue_called, false);
assert.equal(evidence.boundaries.sketchup_model_mutated, false);
assert.equal(evidence.boundaries.release_acceptance, false);
assert.equal(evidence.security_gates.approval_token_server_private, true);

const releaseOverclaim = clone(evidence);
releaseOverclaim.boundaries.release_acceptance = true;
assert.equal(validate(releaseOverclaim), false, 'isolated browser evidence must not sign a release candidate');

const fakeHumanApproval = clone(evidence);
fakeHumanApproval.boundaries.real_user_approval = true;
assert.equal(validate(fakeHumanApproval), false, 'automated browser evidence must not claim real user approval');

const liveMutationOverclaim = clone(evidence);
liveMutationOverclaim.boundaries.sketchup_model_mutated = true;
assert.equal(validate(liveMutationOverclaim), false, 'mock evidence must not claim a live SketchUp mutation');

const tokenExposure = clone(evidence);
tokenExposure.security_gates.approval_token_server_private = false;
assert.equal(validate(tokenExposure), false, 'approval token exposure must fail the evidence contract');

const unsafeOpaqueOrigin = clone(evidence);
unsafeOpaqueOrigin.browser_verification.opaque_origin_handling = 'accepted_for_cross-site';
assert.equal(validate(unsafeOpaqueOrigin), false, 'opaque origins may only be accepted with same-origin Fetch Metadata');

process.stdout.write(`${JSON.stringify({
  ok: true,
  schema: 'local-approval-host-evidence-v1',
  browser_surface: evidence.browser_verification.browser_surface,
  token_exposed: false,
  live_queue_called: false,
  negative_cases: 5
}, null, 2)}\n`);

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
