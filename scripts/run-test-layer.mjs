#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const layer = process.argv[2];
const listOnly = process.argv.includes('--list');

const TEST_LAYERS = Object.freeze({
  'current-source-core': Object.freeze({
    description: 'Current-source, offline/mock implementation and contract checks. No live SketchUp queue is allowed.',
    expected_runtime: 'mock_or_offline',
    queue_allowed: false,
    checks: Object.freeze([
      node('test/version-contract.mjs'),
      node('test/tool-input-validator.mjs'),
      node('test/image-artifact-store.mjs'),
      node('test/agent-contract.mjs'),
      node('test/agent-task-store-recovery.mjs'),
      node('test/task-mutation-receipt-ledger.mjs'),
      node('test/copy-fast-session.mjs'),
      node('test/trusted-model-copy-auto-approval.mjs'),
      node('test/copy-fast-session-mock-evidence.mjs'),
      node('test/copy-fast-session-live-runner.mjs'),
      node('test/approval-tokens.mjs'),
      node('test/local-approval-host.mjs'),
      node('test/session-contract.mjs'),
      node('test/existing-model-editing.mjs'),
      node('test/agent-gateway.mjs'),
      node('test/agent-gateway-mutation-recovery.mjs'),
      node('test/agent-gateway-production-capabilities.mjs'),
      node('test/model-graph-proposer.mjs'),
      node('test/model-graph-store.mjs'),
      node('test/native-classification.mjs'),
      node('test/design-intent-graph.mjs'),
      node('test/design-intent-store.mjs'),
      node('test/design-intent-gateway-store.mjs'),
      node('test/design-intent-cross-domain.mjs'),
      node('test/visual-correction.mjs'),
      node('test/background-normalized-visual-comparison.mjs'),
      node('test/live-visual-capture.mjs'),
      node('test/reliability-corpus.mjs'),
      node('test/agent-compatibility-simulator.mjs'),
      node('test/agent-compatibility-report-schema.mjs'),
      node('test/independent-agent-compatibility-probe.mjs'),
      node('test/mcp-server.mjs'),
      node('test/http-server.mjs'),
      node('test/mcp-capability-suite-safety.mjs'),
      node('test/queue-runtime-lock.mjs'),
      node('test/queue-response-recovery-cli.mjs'),
      node('test/release-offline-gate-runner.mjs'),
      node('scripts/generate-tool-registry-doc.mjs', '--check'),
      node('scripts/generate-ruby-operation-registry.mjs', '--check')
    ])
  }),
  'capture-bound-evidence': Object.freeze({
    description: 'Strict immutable evidence validators. Source drift is a failing stale-evidence result, never silently accepted.',
    expected_runtime: 'offline_evidence_validation',
    queue_allowed: false,
    checks: Object.freeze([
      node('test/current-source-live-readonly-evidence.mjs'),
      node('test/current-source-agent-readonly-live-evidence.mjs'),
      node('test/current-source-agent-target-quality-live-evidence.mjs'),
      node('test/current-source-agent-bounded-group-live-evidence.mjs'),
      node('test/model-graph-target-quality-benchmark.mjs'),
      node('test/current-source-reviewed-plan-live-evidence.mjs'),
      node('test/current-source-reviewed-plan-v3-live-evidence.mjs'),
      node('test/current-source-save-reopen-identity-live-evidence.mjs'),
      node('test/design-intent-live-lineage-evidence.mjs'),
      node('test/current-source-multi-model-target-quality-live-evidence.mjs'),
      node('test/current-source-real-model-reliability-live-evidence-v6.mjs'),
      node('test/fresh-process-multi-model-visual-evidence.mjs'),
      node('test/live-visual-capture-evidence.mjs'),
      node('test/trimble-s6-reference-correction-live-evidence.mjs'),
      node('test/trimble-s6-background-normalized-visual-evidence.mjs'),
      node('test/local-approval-live-evidence.mjs'),
      node('test/trusted-model-copy-auto-approval-evidence.mjs'),
      node('test/copy-fast-session-live-evidence-v2.mjs'),
      node('test/visual-correction-gateway-structured-result-mock-evidence.mjs'),
      node('test/independent-agent-compatibility-evidence.mjs'),
      node('test/independent-agent-compatibility-evidence-v2.mjs'),
      node('test/independent-agent-compatibility-evidence-v3.mjs'),
      node('test/mock-evidence-hash-integrity.mjs')
    ])
  })
});

if (!Object.hasOwn(TEST_LAYERS, layer)) {
  const available = Object.keys(TEST_LAYERS);
  process.stderr.write(`Usage: node scripts/run-test-layer.mjs <${available.join('|')}> [--list]\n`);
  process.exitCode = 2;
} else {
  const definition = TEST_LAYERS[layer];
  if (listOnly) {
    process.stdout.write(`${JSON.stringify(publicDefinition(layer, definition), null, 2)}\n`);
  } else {
    const startedAt = Date.now();
    const results = [];
    for (const check of definition.checks) {
      const result = await runCheck(check, safeOfflineEnvironment());
      results.push(result);
      const status = result.ok ? 'PASS' : 'FAIL';
      process.stdout.write(`[${status}] ${result.command} (${result.duration_ms} ms)\n`);
      if (!result.ok && result.output_tail) process.stderr.write(`${result.output_tail}\n`);
    }
    const failed = results.filter((result) => !result.ok);
    const report = {
      version: 'test-layer-report.v1',
      layer,
      description: definition.description,
      expected_runtime: definition.expected_runtime,
      queue_allowed: definition.queue_allowed,
      checks: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      duration_ms: Date.now() - startedAt,
      result: failed.length ? 'fail' : 'pass',
      failure_semantics: layer === 'capture-bound-evidence'
        ? 'A failure means the immutable capture is stale, incomplete, corrupted, or no longer source-bound; it must not be rewritten as current evidence.'
        : 'A failure means the current offline/mock implementation or contract does not pass its core regression.',
      failed_commands: failed.map((result) => result.command)
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (failed.length) process.exitCode = 1;
  }
}

function node(script, ...args) {
  return Object.freeze({ executable: process.execPath, args: Object.freeze([script, ...args]) });
}

function publicDefinition(name, definition) {
  return {
    version: 'test-layer-definition.v1',
    layer: name,
    description: definition.description,
    expected_runtime: definition.expected_runtime,
    queue_allowed: definition.queue_allowed,
    checks: definition.checks.map(commandText)
  };
}

function safeOfflineEnvironment() {
  return {
    ...process.env,
    ALMA_SKETCHUP_AGENT_ALLOWED_RUNTIMES: 'mock',
    ALMA_SKETCHUP_AGENT_ALLOW_QUEUE_MUTATION: '0',
    ALMA_SKETCHUP_ALLOW_DIRECT_EXPERT_QUEUE_MUTATION: '0',
    ALMA_SKETCHUP_AUTO_APPROVE_S1: '0',
    ALMA_SKETCHUP_TRUSTED_COPY_AUTO_APPROVAL: '0',
    ALMA_SKETCHUP_COPY_FAST_MODE: '0',
    ALMA_SKETCHUP_COPY_ROOTS: '',
    ALMA_SKETCHUP_TEST_LAYER: layer,
    ALMA_SKETCHUP_TEST_LAYER_QUEUE_ALLOWED: '0'
  };
}

async function runCheck(check, env) {
  const startedAt = Date.now();
  const child = spawn(check.executable, check.args, {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  const output = Buffer.concat([...stdout, ...stderr]).toString('utf8');
  return {
    command: commandText(check),
    ok: exit.code === 0 && exit.signal === null,
    exit_code: exit.code,
    signal: exit.signal,
    duration_ms: Date.now() - startedAt,
    output_tail: tail(output, 24)
  };
}

function commandText(check) {
  return ['node', ...check.args].map(shellDisplay).join(' ');
}

function shellDisplay(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:-]+$/.test(text) ? text : JSON.stringify(text);
}

function tail(value, lines) {
  return String(value || '').trim().split(/\r?\n/).slice(-lines).join('\n');
}
