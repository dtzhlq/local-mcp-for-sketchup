import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(await fs.readFile(path.resolve('schema/agent-contract-mutation-recovery-evidence-v1.schema.json'), 'utf8'));
const evidence = JSON.parse(await fs.readFile(path.resolve('docs/evidence/agent-contract-mutation-recovery-v1-mock-evidence.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
assert.equal(ajv.validate(schema, evidence), true, JSON.stringify(ajv.errors));

for (const relativePath of Object.values(evidence.implementation).filter((value) => typeof value === 'string' && value.includes('/'))) {
  assert.equal((await fs.stat(path.resolve(relativePath))).isFile(), true, `${relativePath} must exist`);
}
for (const command of evidence.tests) {
  const filePath = command.slice('node '.length);
  assert.equal((await fs.stat(path.resolve(filePath))).isFile(), true, `${filePath} must exist`);
}
assert.equal(evidence.boundary.live_queue_called, false);
assert.equal(evidence.boundary.universal_native_exactly_once_claimed, false);

process.stdout.write(`${JSON.stringify({ ok: true, schema_valid: true, referenced_files_exist: true, mock_only: true }, null, 2)}\n`);
