import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { compilePythonSdkScript } from '../src/python-sdk-compiler.mjs';

const repoRoot = process.cwd();
const fixtureRoot = path.join(repoRoot, 'examples', 'python-sdk-source-compat');
const manifest = JSON.parse(await fs.readFile(path.join(fixtureRoot, 'manifest.json'), 'utf8'));
const expectations = JSON.parse(await fs.readFile(path.join(fixtureRoot, 'expected-results.json'), 'utf8'));

assert.equal(manifest.kind, 'python_sdk_source_compat_manifest');
assert.ok(manifest.cases.length >= 30, 'source compatibility corpus must contain at least 30 release cases');
assert.equal(new Set(manifest.cases.map((item) => item.id)).size, manifest.cases.length, 'source compatibility ids must be unique');

const reportCases = [];
for (const testCase of manifest.cases) {
  const expected = expectations.cases[testCase.id];
  assert.ok(expected, `missing expectation for ${testCase.id}`);
  assert.ok(testCase.category, `${testCase.id} must declare a category`);
  assert.ok(Array.isArray(testCase.symbols) && testCase.symbols.length, `${testCase.id} must declare covered symbols`);
  const source = await fs.readFile(path.join(repoRoot, testCase.source), 'utf8');
  const sourceSha256 = sha256(source);
  try {
    const compiled = compilePythonSdkScript(source);
    assert.equal(testCase.expected_status, 'compiled', `${testCase.id} unexpectedly compiled`);
    assert.equal(compiled.document.operations.length, expected.operations, `${testCase.id} operation count`);
    const operationKinds = [...new Set(compiled.document.operations.map((operation) => operation.op))];
    for (const operation of expected.required_ops || []) {
      assert.ok(operationKinds.includes(operation), `${testCase.id} must emit ${operation}`);
    }
    assertResultMode(compiled, expected, testCase.id);
    const golden = JSON.parse(await fs.readFile(path.join(fixtureRoot, 'expected', `${testCase.id}.json`), 'utf8'));
    assert.equal(golden.case_id, testCase.id, `${testCase.id} golden case id`);
    assert.equal(golden.source_sha256, sourceSha256, `${testCase.id} source hash`);
    assert.deepEqual(compiled.document, golden.document, `${testCase.id} canonical DSL`);
    const resultEnvelope = Object.hasOwn(compiled, 'result') ? { mode: 'present', value: compiled.result } : { mode: 'omitted' };
    assert.deepEqual(resultEnvelope, golden.result, `${testCase.id} canonical result`);
    reportCases.push({
      id: testCase.id,
      category: testCase.category,
      symbols: testCase.symbols,
      source: testCase.source,
      source_sha256: sourceSha256,
      status: 'compiled',
      operations: compiled.document.operations.length,
      operation_kinds: operationKinds,
      result_mode: expected.result_mode,
      dsl_sha256: sha256(JSON.stringify(compiled.document)),
      result_sha256: sha256(JSON.stringify(resultEnvelope)),
      facade_objects: compiled.python_sdk.facade_objects
    });
  } catch (error) {
    const reason = classifyUnsupportedReason(error);
    assert.equal(testCase.expected_status, 'unsupported', `${testCase.id} failed unexpectedly: ${error.message}`);
    assert.equal(reason, expected.reason, `${testCase.id} unsupported reason`);
    reportCases.push({
      id: testCase.id,
      category: testCase.category,
      symbols: testCase.symbols,
      source: testCase.source,
      source_sha256: sourceSha256,
      status: 'unsupported',
      reason,
      message: error.message
    });
  }
}

const report = {
  version: 2,
  kind: 'python_sdk_source_compat_report',
  ok: true,
  summary: {
    total: reportCases.length,
    compiled: reportCases.filter((item) => item.status === 'compiled').length,
    unsupported: reportCases.filter((item) => item.status === 'unsupported').length,
    unclassified: reportCases.filter((item) => item.reason === 'unclassified_compile_error').length,
    categories: Object.fromEntries([...new Set(reportCases.map((item) => item.category))].sort().map((category) => [category, reportCases.filter((item) => item.category === category).length]))
  },
  cases: reportCases
};
assert.equal(report.summary.unclassified, 0, 'every unsupported source must have a stable reason code');
const outputDir = path.join(repoRoot, 'output', 'python-sdk-source-compat');
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, 'source-compat-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);

function assertResultMode(compiled, expected, id) {
  const hasResult = Object.hasOwn(compiled, 'result');
  if (expected.result_mode === 'omitted') {
    assert.equal(hasResult, false, `${id} result must be omitted`);
    return;
  }
  assert.equal(hasResult, true, `${id} result must be present`);
  if (expected.result_mode === 'null') {
    assert.equal(compiled.result, null, `${id} result must be null`);
    return;
  }
  if (expected.result_mode === 'scalar') {
    assert.notEqual(compiled.result, null, `${id} scalar result must not be null`);
    assert.equal(['string', 'number', 'boolean'].includes(typeof compiled.result), true, `${id} result must be scalar`);
    return;
  }
  assert.equal(typeof compiled.result, 'object', `${id} result must be JSON-compatible`);
  for (const key of expected.result_keys || []) {
    assert.ok(Object.hasOwn(compiled.result, key), `${id} result must contain ${key}`);
  }
}

function classifyUnsupportedReason(error) {
  const message = error?.message || '';
  if (/Unsupported Python statement: Import\b/.test(message)) return 'unsupported_python_statement_import';
  if (/Unsupported Python statement: While\b/.test(message)) return 'unsupported_python_statement_while';
  if (/Unsupported Python statement: Try\b/.test(message)) return 'unsupported_python_statement_try';
  if (/Unsupported Python expression: Lambda\b/.test(message)) return 'unsupported_python_expression_lambda';
  if (/Unsupported Python SDK function: open\b/.test(message)) return 'unsupported_python_function_open';
  if (/UVHelper only supports the positioned material side authored on the same Face/.test(message)) return 'unsupported_active_model_uv_query';
  return 'unclassified_compile_error';
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
