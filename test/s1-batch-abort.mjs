import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { validateS1BatchAbort } from '../scripts/validate-s1-batch-abort.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-s1-batch-abort-'));
try {
  await assert.rejects(
    validateS1BatchAbort({ runtime: 'queue', outputDir: path.join(root, 'must-not-run') }),
    /--runtime queue --queue-required/,
    'live controlled abort must require explicit queue opt-in'
  );

  const report = await validateS1BatchAbort({ runtime: 'mock', outputDir: path.join(root, 'mock') });
  assert.equal(report.ok, true);
  assert.equal(report.runtime, 'mock');
  assert.equal(report.risk_level, 'S1');
  assert.equal(report.error.code, 'MUTATION_EXECUTION_FAILED');
  assert.equal(report.error.retryable, false);
  assert.equal(report.model_revision_after, report.model_revision_before);
  assert.equal(report.model_revision_after_replay, report.model_revision_before);
  assert.equal(report.probe_absent, true);
  assert.equal(report.idempotent_error_replay, true);
  assert.equal(report.queue_clean, null);
  await fs.access(report.artifacts.report);

  const schema = JSON.parse(await fs.readFile(path.resolve('schema/controlled-s1-batch-abort-report-v1.schema.json'), 'utf8'));
  const validate = new Ajv2020({ allErrors: true, strict: false, validateFormats: false }).compile(schema);
  assert.equal(validate(report), true, JSON.stringify(validate.errors));

  process.stdout.write(`${JSON.stringify({
    ok: true,
    runtime: report.runtime,
    risk_level: report.risk_level,
    model_revision_preserved: true,
    probe_absent: true,
    nonretryable_execution_failure: true,
    idempotent_error_replay: true,
    explicit_live_opt_in: true
  }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
