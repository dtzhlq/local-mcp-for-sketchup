import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { compilePythonSdkScript } from '../src/python-sdk-compiler.mjs';

const repoRoot = process.cwd();
const fixtureRoot = path.join(repoRoot, 'examples', 'python-sdk-source-compat');
const manifest = JSON.parse(await fs.readFile(path.join(fixtureRoot, 'manifest.json'), 'utf8'));
const expectations = JSON.parse(await fs.readFile(path.join(fixtureRoot, 'expected-results.json'), 'utf8'));

assert.equal(manifest.kind, 'python_sdk_source_compat_manifest');
assert.equal(manifest.cases.length, 12, 'source compatibility corpus must keep the release baseline at 12 cases');

const reportCases = [];
for (const testCase of manifest.cases) {
  const expected = expectations.cases[testCase.id];
  assert.ok(expected, `missing expectation for ${testCase.id}`);
  const source = await fs.readFile(path.join(repoRoot, testCase.source), 'utf8');
  try {
    const compiled = compilePythonSdkScript(source);
    assert.equal(testCase.expected_status, 'compiled', `${testCase.id} unexpectedly compiled`);
    assert.equal(compiled.document.operations.length, expected.operations, `${testCase.id} operation count`);
    const operationKinds = [...new Set(compiled.document.operations.map((operation) => operation.op))];
    for (const operation of expected.required_ops || []) {
      assert.ok(operationKinds.includes(operation), `${testCase.id} must emit ${operation}`);
    }
    assertResultMode(compiled, expected, testCase.id);
    reportCases.push({
      id: testCase.id,
      source: testCase.source,
      status: 'compiled',
      operations: compiled.document.operations.length,
      operation_kinds: operationKinds,
      result_mode: expected.result_mode,
      facade_objects: compiled.python_sdk.facade_objects
    });
  } catch (error) {
    const reason = classifyUnsupportedReason(error);
    assert.equal(testCase.expected_status, 'unsupported', `${testCase.id} failed unexpectedly: ${error.message}`);
    assert.equal(reason, expected.reason, `${testCase.id} unsupported reason`);
    reportCases.push({
      id: testCase.id,
      source: testCase.source,
      status: 'unsupported',
      reason,
      message: error.message
    });
  }
}

const report = {
  version: 1,
  kind: 'python_sdk_source_compat_report',
  ok: true,
  summary: {
    total: reportCases.length,
    compiled: reportCases.filter((item) => item.status === 'compiled').length,
    unsupported: reportCases.filter((item) => item.status === 'unsupported').length
  },
  cases: reportCases
};
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
  assert.equal(typeof compiled.result, 'object', `${id} result must be JSON-compatible`);
  for (const key of expected.result_keys || []) {
    assert.ok(Object.hasOwn(compiled.result, key), `${id} result must contain ${key}`);
  }
}

function classifyUnsupportedReason(error) {
  if (/Unsupported Python statement: Import\b/.test(error?.message || '')) return 'unsupported_python_statement_import';
  return 'unclassified_compile_error';
}
