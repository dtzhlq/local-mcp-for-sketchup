#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iterations = positiveInteger(process.argv[2] || 20);
const outputDir = path.join(rootDir, 'output', 'mock-session-isolation');
await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });

const results = [];
for (let index = 1; index <= iterations; index += 1) {
  const pair = await Promise.all([
    runNode('scripts/validate-python-sdk-high-value.mjs', [
      '--output-file', path.join(outputDir, `high-value-${index}.json`)
    ]),
    runNode('scripts/validate-nested-entity-edit.mjs', [
      '--runtime', 'mock',
      '--output-dir', path.join(outputDir, `nested-${index}`)
    ])
  ]);
  assert(pair.every((item) => item.code === 0), formatFailure(index, pair));
  results.push({ iteration: index, ok: true });
}

const summary = { ok: true, iterations, concurrent_validators: 2, results };
await fs.writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ ok: true, iterations, concurrent_runs: iterations * 2 }, null, 2)}\n`);

function runNode(script, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function formatFailure(index, pair) {
  return [`mock validator isolation failed at iteration ${index}`, ...pair.map((item) => item.stderr || item.stdout)].join('\n');
}

function positiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('iterations must be a positive integer');
  return parsed;
}
