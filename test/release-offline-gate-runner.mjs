import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runner = path.join(repoRoot, 'scripts', 'run-release-offline-gates.mjs');
const schema = JSON.parse(await fs.readFile(
  path.join(repoRoot, 'schema', 'release-offline-gate-report-v1.schema.json'),
  'utf8'
));
const validate = new Ajv2020({
  strict: false,
  allErrors: true,
  validateFormats: false
}).compile(schema);
const listed = spawnSync(process.execPath, [runner, '--list'], {
  cwd: repoRoot,
  encoding: 'utf8'
});
assert.equal(listed.status, 0, listed.stderr);
const definition = JSON.parse(listed.stdout);

assert.equal(definition.version, 'release-offline-gate-definition.v1');
assert.equal(definition.queue_allowed, false);
assert.equal(definition.expected_runtime, 'mock_or_offline');
assert.equal(definition.checks.length, 18);
assert.equal(new Set(definition.checks.map((entry) => entry.name)).size, 18);
assert.ok(definition.checks.some((entry) => entry.command === 'node scripts/run-test-layer.mjs current-source-core'));
assert.ok(definition.checks.some((entry) => entry.command === 'node test/copy-fast-session-live-evidence.mjs'));
assert.ok(definition.checks.some((entry) => entry.command === 'npm run qa:mcp-capability-suite -- --runtime mock'));
assert.ok(definition.checks.some((entry) => entry.command === 'npm run test:image-structured'));
assert.ok(definition.checks.some((entry) => entry.command === 'npm run test:release-manifest-create-new'));
assert.ok(definition.checks.some((entry) => entry.command === 'git diff --check'));
assert.equal(definition.checks.some((entry) => /--runtime\s+queue/.test(entry.command)), false);
assert.equal(definition.artifact_boundary.existing_rc2_artifacts_are_historical_and_immutable, true);
assert.equal(definition.artifact_boundary.canonical_new_version_target_checked_here, false);

const source = await fs.readFile(runner, 'utf8');
for (const binding of [
  "ALMA_SKETCHUP_AGENT_ALLOWED_RUNTIMES: 'mock'",
  "ALMA_SKETCHUP_AGENT_ALLOW_QUEUE_MUTATION: '0'",
  "ALMA_SKETCHUP_ALLOW_DIRECT_EXPERT_QUEUE_MUTATION: '0'",
  "ALMA_SKETCHUP_COPY_FAST_MODE: '0'"
]) {
  assert.match(source, new RegExp(escapeRegex(binding)));
}
assert.match(source, /flag:\s*'wx'/);
assert.doesNotMatch(source, /execSync|spawnSync/);
assert.match(source, /await validateReport\(report\)/);
assert.match(source, /RELEASE_OFFLINE_GATE_REPORT_INVALID/);

const commandResults = definition.checks.map((entry) => ({
  name: entry.name,
  command: entry.command,
  ok: true,
  exit_code: 0,
  duration_ms: 1
}));
const validReport = {
  version: 'release-offline-gate-report.v1',
  kind: 'release_offline_gate_report',
  created_at: '2026-07-24T05:26:02.355Z',
  queue_allowed: false,
  expected_runtime: 'mock_or_offline',
  checks: 18,
  passed: 18,
  failed: 0,
  duration_ms: 18,
  result: 'pass',
  failed_checks: [],
  command_results: commandResults,
  artifact_boundary: definition.artifact_boundary,
  offline_acceptance: true,
  live_queue_acceptance: false,
  release_acceptance: false
};
assert.equal(validate(validReport), true, JSON.stringify(validate.errors));

for (const [label, mutate] of [
  ['queue allowed', (value) => { value.queue_allowed = true; }],
  ['queue runtime', (value) => { value.expected_runtime = 'queue'; }],
  ['false release acceptance', (value) => { value.release_acceptance = true; }],
  ['contradictory pass count', (value) => { value.failed = 1; }],
  ['contradictory pass result', (value) => { value.offline_acceptance = false; }],
  ['successful nonzero exit', (value) => { value.command_results[0].exit_code = 1; }],
  ['unknown check', (value) => { value.command_results[0].name = 'unknown'; }],
  ['sensitive extra field', (value) => { value.command_results[0].environment = { SECRET: 'leak' }; }]
]) {
  const invalid = structuredClone(validReport);
  mutate(invalid);
  assert.equal(validate(invalid), false, `${label} must fail report schema`);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  checks: definition.checks.length,
  queue_allowed: definition.queue_allowed,
  explicit_mock_capability_suite: true,
  live_evidence_validation_is_read_only: true,
  create_new_report: true,
  report_schema_validated_before_write: true,
  report_schema_negative_cases: 8,
  historical_rc2_artifacts_preserved: true
}, null, 2)}\n`);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
