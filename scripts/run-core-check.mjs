#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');

const steps = [
  ['version contract', ['test/version-contract.mjs']],
  ['tool registry drift', ['scripts/generate-tool-registry-doc.mjs', '--check']],
  ['Ruby operation registry drift', ['scripts/generate-ruby-operation-registry.mjs', '--check']],
  ['plugin structure and Ruby syntax', ['scripts/package-sketchup-plugin.mjs', '--check']],
  ['agent-install manifest', ['scripts/validate-agent-install-manifest.mjs']],
  ['agent-install release blockers', ['test/agent-install-manifest.mjs']],
  ['DCO policy parser', ['test/dco-check.mjs']],
  ['agent JSON and TOML merge', ['test/agent-config-merge.mjs']],
  ['agent atomic config writer', ['test/agent-config-writer.mjs']],
  ['installed-bundle client configuration', ['test/configure-client.mjs']],
  ['SketchUp 2026 platform paths', ['test/sketchup-plugin-platform-paths.mjs']],
  ['service bundle target plan', ['test/service-bundle-plan.mjs']],
  ['plugin install safety', ['test/plugin-install-safety.mjs']],
  ['plugin crash safety', ['test/sketchup-plugin-crash-safety.mjs']],
  ['plugin document state', ['test/sketchup-plugin-document-state.mjs']],
  ['plugin bridge lifecycle', ['test/sketchup-plugin-bridge-lifecycle-contract.mjs']],
  ['plugin model graph', ['test/sketchup-plugin-model-graph-contract.mjs']],
  ['plugin native classification', ['test/sketchup-native-classification-contract.mjs']],
  ['plugin runtime attestation', ['test/runtime-source-attestation.mjs']],
  ['plugin structural probe', ['test/sketchup-plugin-structural-probe-contract.mjs']],
  ['tool input validation', ['test/tool-input-validator.mjs']],
  ['bounded expert compiler', ['test/expert-compiler.mjs']],
  ['MCP server protocol', ['test/mcp-server.mjs']],
  ['Agent Contract store', ['test/agent-contract.mjs']],
  ['Agent Gateway', ['test/agent-gateway.mjs']],
  ['Agent production capability boundary', ['test/agent-gateway-production-capabilities.mjs']],
  ['reviewed image-brief boundary', ['test/image-structured-mcp-adapter.mjs']],
  ['41-tool mock capability suite', [
    'scripts/validate-mcp-capability-suite.mjs',
    '--runtime', 'mock',
    '--output-dir', 'output/core-check/mcp-capability-suite'
  ]]
];

const startedAt = new Date();
for (const [label, args] of steps) {
  process.stdout.write(`\n[core-check] ${label}\n`);
  const result = await run(process.execPath, args);
  if (result.code !== 0) {
    process.stderr.write(`[core-check] FAILED: ${label} (exit ${result.code})\n`);
    process.exit(result.code || 1);
  }
}

process.stdout.write(`${JSON.stringify({
  kind: 'local_mcp_for_sketchup_core_check',
  status: 'passed',
  layer: 'offline_and_mock_only',
  live_sketchup_verified: false,
  release_acceptance: false,
  step_count: steps.length,
  started_at: startedAt.toISOString(),
  finished_at: new Date().toISOString()
}, null, 2)}\n`);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        LOCAL_MCP_FOR_SKETCHUP_STATE_DIR: path.join(repoRoot, 'output', 'core-check', 'state')
      },
      stdio: 'inherit'
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (signal) reject(new Error(`Core check subprocess stopped by ${signal}: ${args.join(' ')}`));
      else resolve({ code });
    });
  });
}
