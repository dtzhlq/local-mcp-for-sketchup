import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  projectRoot,
  'docs',
  'evidence',
  'visual-correction-gateway-structured-result-v1-mock-evidence.json'
);
const schema = JSON.parse(await fs.readFile(
  path.join(
    projectRoot,
    'schema',
    'visual-correction-gateway-structured-result-mock-evidence-v1.schema.json'
  ),
  'utf8'
));
const evidence = JSON.parse(await fs.readFile(evidencePath, 'utf8'));
const validate = new Ajv2020({
  allErrors: true,
  strict: false,
  formats: { 'date-time': true }
}).compile(schema);

assert.equal(validate(evidence), true, JSON.stringify(validate.errors));

for (const [repoPath, expected] of Object.entries(evidence.source_hashes)) {
  const candidate = path.resolve(projectRoot, repoPath);
  const relative = path.relative(projectRoot, candidate);
  assert.equal(relative.startsWith('..') || path.isAbsolute(relative), false, `${repoPath} escaped the repository`);
  const bytes = await fs.readFile(candidate);
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(actual, expected, `${repoPath} source hash drifted`);
}

for (const [label, mutate] of [
  ['queue execution', (value) => { value.acceptance.queue_called = true; }],
  ['visual acceptance', (value) => { value.acceptance.visual_similarity_accepted = true; }],
  ['execution permission', (value) => { value.acceptance.execution_allowed = true; }],
  ['promotion permission', (value) => { value.acceptance.diagnostic_boundary.promotion_allowed = true; }],
  ['review authority', (value) => { value.acceptance.diagnostic_boundary.review_authority = 'agent'; }],
  ['approval authority', (value) => { value.acceptance.diagnostic_boundary.approval_authority = 'agent'; }],
  ['release acceptance', (value) => { value.release_acceptance = true; }],
  ['missing artifact handles', (value) => { value.acceptance.immutable_visual_artifact_handles = 0; }],
  ['larger L0 envelope', (value) => { value.acceptance.l0_max_chars = 8192; }],
  ['unexpected field', (value) => { value.untrusted_extension = true; }]
]) {
  const candidate = structuredClone(evidence);
  mutate(candidate);
  assert.equal(validate(candidate), false, `${label} must fail schema validation`);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  source_hashes_valid: Object.keys(evidence.source_hashes).length,
  structured_result: evidence.contracts.qa_result,
  immutable_visual_artifact_handles: evidence.acceptance.immutable_visual_artifact_handles,
  l0_max_chars: evidence.acceptance.l0_max_chars,
  no_vision_supported: evidence.acceptance.l0_no_vision_supported,
  no_local_files_supported: evidence.acceptance.l0_no_local_files_supported,
  decision_injection_categories_rejected: evidence.acceptance.client_decision_injection_rejected.length,
  policy_negative_cases: 10,
  visual_similarity_accepted: false,
  execution_allowed: false,
  live_queue_called: false,
  release_acceptance: false
}, null, 2)}\n`);
