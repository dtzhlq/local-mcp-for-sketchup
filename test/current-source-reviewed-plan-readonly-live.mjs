import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertExplicitOptIn } from '../scripts/run-current-source-reviewed-plan-readonly-live.mjs';

const valid = {
  runtime: 'queue',
  queueRequired: true,
  disposableCopyConfirmed: true,
  expectedModelSha256: 'a'.repeat(64),
  structuralGroupLimit: 5000,
  recursiveLimit: 100_000,
  timeoutMs: 180_000
};
let assertions = 0;
assert.doesNotThrow(() => assertExplicitOptIn(valid)); assertions += 1;
for (const invalid of [
  { ...valid, runtime: 'mock' },
  { ...valid, queueRequired: false },
  { ...valid, disposableCopyConfirmed: false },
  { ...valid, expectedModelSha256: 'short' },
  { ...valid, structuralGroupLimit: 0 },
  { ...valid, structuralGroupLimit: 5001 },
  { ...valid, recursiveLimit: 0 },
  { ...valid, recursiveLimit: 1_000_001 },
  { ...valid, timeoutMs: 999 },
  { ...valid, timeoutMs: 600_001 }
]) {
  assert.throws(() => assertExplicitOptIn(invalid)); assertions += 1;
}

const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/run-current-source-reviewed-plan-readonly-live.mjs');
const child = spawn(process.execPath, [scriptPath], {
  env: {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    TMPDIR: process.env.TMPDIR || ''
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => { stdout += chunk; });
child.stderr.on('data', (chunk) => { stderr += chunk; });
const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', resolve);
});
assert.equal(exitCode, 1); assertions += 1;
assert.equal(stdout, ''); assertions += 1;
assert.match(stderr, /Explicit live opt-in required/); assertions += 1;

process.stdout.write(`${JSON.stringify({
  ok: true,
  explicit_queue_opt_in: true,
  disposable_confirmation_required: true,
  default_live_queue_called: false,
  approval_decision_default: false,
  assertions
}, null, 2)}\n`);
