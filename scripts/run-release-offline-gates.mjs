#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportSchemaPath = path.join(repoRoot, 'schema', 'release-offline-gate-report-v1.schema.json');
const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 ? path.resolve(repoRoot, args[outputIndex + 1] || '') : null;

if (outputIndex >= 0 && (!args[outputIndex + 1] || args[outputIndex + 1].startsWith('--'))) {
  throw new Error('--output requires a path.');
}
for (let index = 0; index < args.length; index += 1) {
  const value = args[index];
  if (value === '--list') continue;
  if (value === '--output') {
    index += 1;
    continue;
  }
  throw new Error(`Unknown argument: ${value}`);
}

const checks = Object.freeze([
  nodeCheck('current-source-core', 'scripts/run-test-layer.mjs', 'current-source-core'),
  nodeCheck('copy-fast-live-evidence', 'test/copy-fast-session-live-evidence.mjs'),
  npmCheck('plugin-source-and-registry', 'run', 'plugin:check'),
  npmCheck('tool-registry', 'run', 'tool-registry:check'),
  npmCheck('mock-qa', 'run', 'qa:mock'),
  npmCheck('expert-mock-qa', 'run', 'qa:expert:mock'),
  npmCheck('mock-performance-budgets', 'run', 'qa:budget:mock'),
  npmCheck('restricted-python-corpus', 'run', 'test:python-sdk-source-compat'),
  npmCheck('official-api-r3-mock', 'run', 'qa:official-api-r3:mock'),
  npmCheck('python-sdk-high-value-mock', 'run', 'qa:python-sdk-high-value:mock'),
  npmCheck('nested-edit-mock', 'run', 'qa:nested-edit:mock'),
  npmCheck('save-reopen-mock', 'run', 'qa:save-reopen:mock'),
  npmCheck('mcp-capability-suite-mock', 'run', 'qa:mcp-capability-suite', '--', '--runtime', 'mock'),
  npmCheck('image-structured-regression', 'run', 'test:image-structured'),
  npmCheck('plugin-install-safety', 'run', 'test:plugin-install-safety'),
  npmCheck('release-manifest-create-new', 'run', 'test:release-manifest-create-new'),
  npmCheck('historical-artifact-drift-guard', 'run', 'test:release-artifact-drift-evidence'),
  Object.freeze({ name: 'diff-whitespace', executable: 'git', args: Object.freeze(['diff', '--check']) })
]);

if (listOnly) {
  process.stdout.write(`${JSON.stringify(definition(), null, 2)}\n`);
} else {
  const startedAt = Date.now();
  const results = [];
  for (const check of checks) {
    const result = await runCheck(check);
    results.push(result);
    process.stdout.write(`[${result.ok ? 'PASS' : 'FAIL'}] ${result.command} (${result.duration_ms} ms)\n`);
  }
  const failed = results.filter((result) => !result.ok);
  const report = {
    version: 'release-offline-gate-report.v1',
    kind: 'release_offline_gate_report',
    created_at: new Date().toISOString(),
    queue_allowed: false,
    expected_runtime: 'mock_or_offline',
    checks: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    duration_ms: Date.now() - startedAt,
    result: failed.length ? 'fail' : 'pass',
    failed_checks: failed.map((result) => result.name),
    command_results: results,
    artifact_boundary: {
      existing_rc2_artifacts_are_historical_and_immutable: true,
      canonical_new_version_target_checked_here: false
    },
    offline_acceptance: failed.length === 0,
    live_queue_acceptance: false,
    release_acceptance: false
  };
  await validateReport(report);
  if (outputPath) await writeCreateNewReport(outputPath, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (failed.length) process.exitCode = 1;
}

function definition() {
  return {
    version: 'release-offline-gate-definition.v1',
    queue_allowed: false,
    expected_runtime: 'mock_or_offline',
    checks: checks.map((check) => ({
      name: check.name,
      command: commandText(check)
    })),
    artifact_boundary: {
      existing_rc2_artifacts_are_historical_and_immutable: true,
      canonical_new_version_target_checked_here: false
    }
  };
}

function nodeCheck(name, ...commandArgs) {
  return Object.freeze({
    name,
    executable: process.execPath,
    args: Object.freeze(commandArgs)
  });
}

function npmCheck(name, ...commandArgs) {
  return Object.freeze({
    name,
    executable: 'npm',
    args: Object.freeze(commandArgs)
  });
}

async function runCheck(check) {
  const startedAt = Date.now();
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(check.executable, check.args, {
      cwd: repoRoot,
      env: safeOfflineEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
  return {
    name: check.name,
    command: commandText(check),
    ok: exitCode === 0,
    exit_code: exitCode,
    duration_ms: Date.now() - startedAt
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
    ALMA_SKETCHUP_RELEASE_OFFLINE_GATE: '1'
  };
}

function commandText(check) {
  const executable = check.executable === process.execPath ? 'node' : check.executable;
  return [executable, ...check.args].map(shellWord).join(' ');
}

function shellWord(value) {
  return /^[A-Za-z0-9_./:@+-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

async function writeCreateNewReport(filePath, report) {
  const relative = path.relative(repoRoot, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Release offline report must stay inside the repository.');
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx'
  });
}

async function validateReport(report) {
  const schema = JSON.parse(await fs.readFile(reportSchemaPath, 'utf8'));
  const validate = new Ajv2020({
    strict: false,
    allErrors: true,
    validateFormats: false
  }).compile(schema);
  if (!validate(report)) {
    const error = new Error(`Release offline gate report schema failed: ${JSON.stringify(validate.errors)}`);
    error.code = 'RELEASE_OFFLINE_GATE_REPORT_INVALID';
    throw error;
  }
  const failedNames = report.command_results
    .filter((entry) => !entry.ok)
    .map((entry) => entry.name);
  if (report.checks !== report.command_results.length
    || report.passed + report.failed !== report.checks
    || JSON.stringify(failedNames) !== JSON.stringify(report.failed_checks)) {
    const error = new Error('Release offline gate report result bindings are inconsistent.');
    error.code = 'RELEASE_OFFLINE_GATE_REPORT_INVALID';
    throw error;
  }
}
