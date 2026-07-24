import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = 'schema/real-model-recursive-reliability-evidence-v1.schema.json';
const evidencePath = 'docs/evidence/real-model-recursive-reliability-v1-mock-evidence.json';
const [schema, evidence] = await Promise.all([readJson(schemaPath), readJson(evidencePath)]);
const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);

assert.equal(validate(evidence), true, JSON.stringify(validate.errors, null, 2));
assert.equal(evidence.tests.recursive_review.assertions, 116);
assert.equal(evidence.tests.staged_plan.assertions, 80);
assert.equal(evidence.queue_boundary.queue_requests_created, 0);
assert.equal(evidence.authorization_boundary.mutation_authorized, false);
assert.equal(evidence.release_boundary.release_acceptance, false);

const hashEntries = Object.entries(evidence.hashes);
assert.equal(hashEntries.length, 11);
for (const [relativePath, expected] of hashEntries) {
  assert.equal(pathInsideRepo(relativePath), true, `hash path escapes repository: ${relativePath}`);
  assert.match(expected, /^sha256:[0-9a-f]{64}$/, `invalid historical SHA-256 binding for ${relativePath}`);
}

const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-recursive-reliability-evidence-'));
const unusedQueueDir = path.join(stateDir, 'queue-must-not-exist');
try {
  const archival = await runJsonTest(
    'test/real-model-reliability-plan-v1-archival-lineage.mjs',
    unusedQueueDir
  );
  assert.equal(archival.ok, true);
  assert.equal(archival.staged_plan_version, evidence.contracts.staged_plan.version);
  assert.equal(archival.archival_evidence_files, 1);
  assert.equal(archival.evidence_byte_hash_bindings, 1);
  assert.equal(archival.historical_schemas_validated, 2);
  assert.equal(archival.historical_embedded_source_bindings, hashEntries.length);
  assert.equal(archival.current_source_hashes_compared, 0);
  assert.equal(archival.lineage_only, true);
  assert.equal(archival.current_acceptance, false);
  assert.equal(archival.release_acceptance, false);
  assert.equal(archival.live_queue_called, false);
  assert.equal(await exists(unusedQueueDir), false, 'offline evidence commands must not create a queue state directory');
} finally {
  await fs.rm(stateDir, { recursive: true, force: true });
}

const negativeCases = [
  mutate(evidence, (value) => { value.queue_boundary.queue_requests_created = 1; }),
  mutate(evidence, (value) => { value.authorization_boundary.mutation_authorized = true; }),
  mutate(evidence, (value) => { value.release_boundary.release_acceptance = true; }),
  mutate(evidence, (value) => { value.fail_closed.generated_cutter_without_lineage = false; }),
  mutate(evidence, (value) => { value.authorization_boundary.server_recommended_is_execution_authority = true; })
];
for (const invalid of negativeCases) {
  assert.equal(validate(invalid), false, 'unsafe mock-evidence overclaim must fail schema validation');
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  recursive_assertions: evidence.tests.recursive_review.assertions,
  plan_assertions: evidence.tests.staged_plan.assertions,
  queue_requests_created: 0,
  mutation_authorized: false,
  release_acceptance: false,
  evidence_byte_hash_bindings: 1,
  historical_embedded_hash_bindings: hashEntries.length,
  current_source_hashes_compared: 0,
  lineage_only: true,
  current_acceptance: false,
  historical_core_commands_rerun: false,
  schema_negative_cases: negativeCases.length
}, null, 2)}\n`);

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
}

async function runJsonTest(relativePath, statePath) {
  const { stdout } = await execFileAsync(process.execPath, [path.join(repoRoot, relativePath)], {
    cwd: repoRoot,
    env: { ...process.env, ALMA_SKETCHUP_STATE_DIR: statePath }
  });
  return JSON.parse(stdout);
}

function pathInsideRepo(relativePath) {
  const candidate = path.resolve(repoRoot, relativePath);
  const relative = path.relative(repoRoot, candidate);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function mutate(value, callback) {
  const result = structuredClone(value);
  callback(result);
  return result;
}

function exists(targetPath) {
  return fs.access(targetPath).then(() => true, () => false);
}
