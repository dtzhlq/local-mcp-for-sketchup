import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runner = path.join(repoRoot, 'scripts', 'run-test-layer.mjs');

const core = listLayer('current-source-core');
assert.equal(core.version, 'test-layer-definition.v1');
assert.equal(core.expected_runtime, 'mock_or_offline');
assert.equal(core.queue_allowed, false);
assert.ok(core.checks.length >= 35);
assert.ok(core.checks.includes('node test/version-contract.mjs'));
assert.ok(core.checks.includes('node test/copy-fast-session.mjs'));
assert.ok(core.checks.includes('node test/trusted-model-copy-auto-approval.mjs'));
assert.ok(core.checks.includes('node test/copy-fast-session-mock-evidence.mjs'));
assert.ok(core.checks.includes('node test/copy-fast-session-live-runner.mjs'));
assert.ok(core.checks.includes('node test/visual-correction.mjs'));
assert.ok(core.checks.includes('node test/background-normalized-visual-comparison.mjs'));
assert.equal(core.checks.includes('node test/visual-correction-gateway-structured-result-mock-evidence.mjs'), false);
assert.ok(core.checks.includes('node test/agent-gateway.mjs'));
assert.ok(core.checks.includes('node test/mcp-capability-suite-safety.mjs'));
assert.ok(core.checks.includes('node test/release-offline-gate-runner.mjs'));
assert.equal(core.checks.some((command) => /--runtime\s+queue/.test(command)), false);
assert.equal(core.checks.some((command) => /run-.*live/i.test(command)), false);

const evidence = listLayer('capture-bound-evidence');
assert.equal(evidence.version, 'test-layer-definition.v1');
assert.equal(evidence.expected_runtime, 'offline_evidence_validation');
assert.equal(evidence.queue_allowed, false);
assert.ok(evidence.checks.length >= 15);
assert.ok(evidence.checks.includes('node test/fresh-process-multi-model-visual-evidence.mjs'));
assert.ok(evidence.checks.includes('node test/trusted-model-copy-auto-approval-evidence.mjs'));
assert.ok(evidence.checks.includes('node test/copy-fast-session-live-evidence-v2.mjs'));
assert.equal(evidence.checks.includes('node test/copy-fast-session-live-evidence.mjs'), false);
assert.ok(evidence.checks.includes('node test/visual-correction-gateway-structured-result-mock-evidence.mjs'));
assert.ok(evidence.checks.includes('node test/independent-agent-compatibility-evidence-v2.mjs'));
assert.ok(evidence.checks.includes('node test/independent-agent-compatibility-evidence-v3.mjs'));
assert.ok(evidence.checks.includes('node test/mock-evidence-hash-integrity.mjs'));
assert.equal(evidence.checks.some((command) => /--runtime\s+queue/.test(command)), false);

const invalid = spawnSync(process.execPath, [runner, 'unknown-layer'], {
  cwd: repoRoot,
  encoding: 'utf8'
});
assert.equal(invalid.status, 2);
assert.match(invalid.stderr, /current-source-core/);
assert.match(invalid.stderr, /capture-bound-evidence/);

const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
assert.equal(
  packageJson.scripts['test:current-source-core'],
  'node scripts/run-test-layer.mjs current-source-core'
);
assert.equal(
  packageJson.scripts['test:capture-bound-evidence'],
  'node scripts/run-test-layer.mjs capture-bound-evidence'
);

process.stdout.write(`${JSON.stringify({
  ok: true,
  current_source_core_checks: core.checks.length,
  capture_bound_evidence_checks: evidence.checks.length,
  queue_allowed: false,
  unknown_layer_fail_closed: true,
  historical_evidence_not_rewritten: true
}, null, 2)}\n`);

function listLayer(name) {
  const result = spawnSync(process.execPath, [runner, name, '--list'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
