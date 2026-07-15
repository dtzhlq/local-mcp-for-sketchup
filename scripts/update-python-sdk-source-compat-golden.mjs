import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { compilePythonSdkScript } from '../src/python-sdk-compiler.mjs';

const repoRoot = process.cwd();
const fixtureRoot = path.join(repoRoot, 'examples', 'python-sdk-source-compat');
const expectedDir = path.join(fixtureRoot, 'expected');
const manifest = JSON.parse(await fs.readFile(path.join(fixtureRoot, 'manifest.json'), 'utf8'));
await fs.mkdir(expectedDir, { recursive: true });

const written = [];
for (const testCase of manifest.cases) {
  if (testCase.expected_status !== 'compiled') continue;
  const source = await fs.readFile(path.join(repoRoot, testCase.source), 'utf8');
  const compiled = compilePythonSdkScript(source);
  const fixture = {
    version: 1,
    kind: 'python_sdk_source_compat_golden',
    case_id: testCase.id,
    source_sha256: sha256(source),
    document: compiled.document,
    result: Object.hasOwn(compiled, 'result')
      ? { mode: 'present', value: compiled.result }
      : { mode: 'omitted' }
  };
  const outputPath = path.join(expectedDir, `${testCase.id}.json`);
  await fs.writeFile(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  written.push(path.relative(repoRoot, outputPath));
}

process.stdout.write(`${JSON.stringify({ ok: true, written: written.length, files: written }, null, 2)}\n`);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
