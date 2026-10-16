#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const extended = process.argv.includes('--extended');
if (process.argv.slice(2).some(arg => arg !== '--extended')) throw new Error('Usage: run-core-check.mjs [--extended]');

const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'local-mcp-for-sketchup-core-check-'));
const stateDir = path.join(runRoot, 'state');
const steps = [
  ['CAD kernel geometry and safe editing', ['test/cad-kernel/core.mjs']],
  ['NURBS surfaces and curved-edge fillets', ['test/cad-kernel/surfaces.mjs']],
  ['version contract', ['test/version-contract.mjs']],
  ['tool registry drift', ['scripts/generate-tool-registry-doc.mjs', '--check']],
  ['Ruby operation registry drift', ['scripts/generate-ruby-operation-registry.mjs', '--check']],
  ['plugin structure and Ruby syntax', ['scripts/package-sketchup-plugin.mjs', '--check']],
  ['agent-install manifest', ['scripts/validate-agent-install-manifest.mjs']],
  ['agent-install release blockers', ['test/agent-install-manifest.mjs']],
  ['platform-aware installation entrypoint', ['test/agent-install-entry-doc.mjs']],
  ['DCO policy parser', ['test/dco-check.mjs']],
  ['agent JSON and TOML merge', ['test/agent-config-merge.mjs']],
  ['agent atomic config writer', ['test/agent-config-writer.mjs']],
  ['installed-bundle client configuration', ['test/configure-client.mjs']],
  ['SketchUp 2026 platform paths', ['test/sketchup-plugin-platform-paths.mjs']],
  ['service bundle target plan', ['test/service-bundle-plan.mjs']],
  ['service bundle reproducibility', ['test/service-bundle-reproducibility.mjs']],
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
  ['Detail quality native entity identity', ['test/detail-quality.mjs']],
  ['Mutation receipt durability across platforms', ['test/mutation-receipt-durability.mjs']],
  ['Traditional assembly geometry and provenance', ['test/traditional-assembly.mjs']],
  ['Development model authorization boundary', ['test/development-model-policy.mjs']],
  ['Traditional assembly review recovery', ['test/traditional-assembly-review-recovery.mjs']],
  ['Stable document delivery', ['test/delivery-stable-document.mjs']],
  ['Scene verification connection', ['test/traditional-scene-connection.mjs']],
  ['Saved scene source continuation', ['test/traditional-scene-saved-sources.mjs']],
  ['Bounded parameter source projection', ['test/parameter-source-response-projection.mjs']],
  ['Agent Gateway', ['test/agent-gateway.mjs']],
  ['Agent production capability boundary', ['test/agent-gateway-production-capabilities.mjs']],
  ['reviewed image-brief boundary', ['test/image-structured-mcp-adapter.mjs']],
  ['registered-tool mock capability suite', [
    'scripts/validate-mcp-capability-suite.mjs',
    '--runtime', 'mock',
    '--output-dir', path.join(runRoot, 'mcp-capability-suite')
  ]]
];

// Keep the quick package/core gate, and make existing behavioral regressions a
// named CI entrypoint instead of depending on manual one-off invocations.
if (extended) steps.push(
  ['First-use discovery and bounded workflow templates', ['test/model-accessibility-onboarding.mjs']],
  ['Discovered workflows and reviewed layout editing', ['test/model-accessibility-layout-edit.mjs']],
  ['Native layout QA resume guards (offline fixtures)', ['test/qa-layout-native-resume.mjs']],
  ['Traditional bay structure migration and current verification', ['test/traditional-assembly-structure-edit.mjs']],
  ['Native assembly joint measurements and evidence boundaries', ['test/traditional-assembly-joints.mjs']],
  ['Bounded public native joint measurement results', ['test/traditional-joint-response-projection.mjs']],
  ['Modeling math and transforms', ['test/modeling-uplift/math-geometry.mjs']],
  ['Native geometry reading and safe local editing', ['test/modeling-uplift/reading-editing.mjs']],
  ['Staged program recovery and idempotency', ['test/modeling-uplift/program.mjs']],
  ['Image structure and reviewed creation', ['test/image-structure.mjs']],
  ['Atomic queue publication and recovery', ['test/queue-publication.mjs']],
  ['Queue and task timing', ['test/queue-timing.mjs']],
  ['Native queue timing envelope', ['test/ruby/queue_timing_test.rb']],
  ['Native operation runtime profiling', ['test/ruby/build_runtime_profile_test.rb']],
  ['Revision snapshot cost invariants', ['test/ruby/revision_snapshot_cost_test.rb']],
  ['Scoped recursive index', ['test/ruby/scoped_recursive_index_test.rb']]
);

const startedAt = new Date();
let failedStep = null;
try {
  for (const [label, args] of steps) {
    process.stdout.write(`\n[core-check] ${label}\n`);
    const result = await run(args[0].endsWith('.rb') ? 'ruby' : process.execPath, args);
    if (result.code !== 0) {
      failedStep = { label, code: result.code || 1 };
      break;
    }
  }

  if (!failedStep) {
    process.stdout.write(`${JSON.stringify({
      kind: 'local_mcp_for_sketchup_core_check',
      status: 'passed',
      layer: 'offline_and_mock_only',
      suite: extended ? 'extended_behavioral_regression' : 'core',
      isolated_test_state: true,
      live_sketchup_verified: false,
      release_acceptance: false,
      step_count: steps.length,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString()
    }, null, 2)}\n`);
  }
} finally {
  await fs.rm(runRoot, { recursive: true, force: true });
}

if (failedStep) {
  process.stderr.write(`[core-check] FAILED: ${failedStep.label} (exit ${failedStep.code})\n`);
  process.exitCode = failedStep.code;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        LOCAL_MCP_FOR_SKETCHUP_STATE_DIR: stateDir
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
