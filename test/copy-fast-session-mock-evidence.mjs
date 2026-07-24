import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(await fs.readFile(
  path.join(root, 'schema', 'copy-fast-session-mock-evidence-v1.schema.json'),
  'utf8'
));
const evidence = JSON.parse(await fs.readFile(
  path.join(root, 'docs', 'evidence', 'copy-fast-session-v1-mock-evidence.json'),
  'utf8'
));
const validate = new Ajv2020({
  allErrors: true,
  strict: false,
  formats: { 'date-time': true }
}).compile(schema);

assert.equal(validate(evidence), true, JSON.stringify(validate.errors));
for (const [repoPath, expected] of Object.entries(evidence.source_hashes)) {
  const candidate = path.resolve(root, repoPath);
  const relative = path.relative(root, candidate);
  assert.equal(relative.startsWith('..') || path.isAbsolute(relative), false, `${repoPath} escaped the repository`);
  const actual = crypto.createHash('sha256').update(await fs.readFile(candidate)).digest('hex');
  assert.equal(actual, expected, `${repoPath} source hash drifted`);
}

for (const [label, mutate] of [
  ['agent enable', (value) => { value.policy.agent_can_enable = true; }],
  ['original scope', (value) => { value.policy.activation = 'agent_declared_copy'; }],
  ['per edit action', (value) => { value.acceptance.per_edit_user_action_required = true; }],
  ['approval challenge', (value) => { value.acceptance.per_edit_approval_challenges = 1; }],
  ['duplicate mutation', (value) => { value.acceptance.duplicate_mutation = true; }],
  ['outside root', (value) => { value.acceptance.outside_root_failed_closed = false; }],
  ['legacy no-session binding', (value) => { value.acceptance.legacy_binding_without_session_failed_closed = false; }],
  ['restart inheritance', (value) => { value.acceptance.restart_failed_closed = false; }],
  ['expiry inheritance', (value) => { value.acceptance.expiry_failed_closed = false; }],
  ['path exposure', (value) => { value.acceptance.public_path_fingerprints_exposed = true; }],
  ['queue call', (value) => { value.acceptance.live_queue_calls = 1; }],
  ['release acceptance', (value) => { value.release_acceptance = true; }],
  ['unexpected field', (value) => { value.agent_override = true; }]
]) {
  const invalid = structuredClone(evidence);
  mutate(invalid);
  assert.equal(validate(invalid), false, `${label} must fail schema validation`);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  source_hashes_valid: Object.keys(evidence.source_hashes).length,
  session_reused_across_tasks: true,
  per_edit_approval_challenges: 0,
  s1_and_s4_executed: true,
  agent_can_enable: false,
  outside_root_failed_closed: true,
  legacy_binding_without_session_failed_closed: true,
  restart_expiry_revocation_failed_closed: true,
  duplicate_mutation: false,
  live_queue_calls: 0,
  policy_negative_cases: 13,
  release_acceptance: false
}, null, 2)}\n`);
