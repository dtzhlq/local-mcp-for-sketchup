// Explicitly invoked, dedicated-model live QA. Never closes/reopens a model.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { runLayoutNativeQA } from './qa-workflow-improvements-layout.mjs';
import { runStructureNativeQA } from './qa-workflow-improvements-structure.mjs';

const mode = process.argv[2] || 'inspect';
assert.ok(['inspect', 'bootstrap', 'layout', 'structure', 'capture', 'save'].includes(mode));
const mutationMode = mode !== 'inspect';
const authorizationRef = (process.env.SKETCHUP_QA_AUTHORIZATION_REF || '').trim();
if (mutationMode && !authorizationRef) {
  throw new Error('SKETCHUP_QA_AUTHORIZATION_REF must explicitly identify the current user authorization for non-inspect native QA.');
}
const outputDir = path.resolve(process.argv[3] || 'output/workflow-improvements-native-20261015');
const fixture = path.join(outputDir, 'workflow-improvements.skp');
const bridge = new SketchUpBridge({
  agentContract: { rootDir: path.join(outputDir, 'tasks') },
  approval: { stateDir: path.join(outputDir, 'approval') },
  executionPolicy: { allowed_runtimes: ['mock', 'queue'], allow_queue_mutation: mutationMode,
    allow_direct_expert_queue_mutation: mutationMode, auto_approve_risks: [],
    development_model_auto_approval: { enabled: mutationMode,
      authorization_ref: mutationMode ? authorizationRef : '',
      allowed_roots: mutationMode ? [outputDir] : [], allowed_risks: mutationMode ? ['S1', 'S2', 'S3'] : [],
      max_affected_instances: 40, allow_save_model: mutationMode },
    resource_limits: { max_operations: 100, max_affected_instances: 40, max_recursive_entities: 20000 } }
});
const write = async (name, value) => fs.writeFile(path.join(outputDir, `${name}.json`), JSON.stringify(value, null, 2));
await fs.mkdir(outputDir, { recursive: true });
try {
  const diagnostics = await bridge.queue_diagnostics();
  assert.equal(diagnostics.queue.count, 0); assert.equal(diagnostics.processing.count, 0);
  assert.equal(diagnostics.responses.count, 0); assert.equal(diagnostics.lock.exists, false);
  const capability = await bridge.get_capabilities({ runtime: 'queue', timeoutMs: 20000 });
  assert.equal(capability.runtime.compatibility.ok, true);
  if (mode === 'bootstrap') {
    await fs.access(fixture).then(() => { throw new Error('Fixture exists; inspect and resume, do not bootstrap again.'); }, e => { if (e.code !== 'ENOENT') throw e; });
    const baseline = JSON.parse(await fs.readFile(path.join(outputDir, 'initial-model.json'), 'utf8'));
    const saved = await bridge.withFreshQueueMutationAuthorization({ operation: 'save_model', timeoutMs: 30000 }, async live => {
      const info = await live.get_model_info({ runtime: 'queue', timeoutMs: 30000 });
      assert.equal(info.source_path, null); assert.equal(info.model_modified, false);
      assert.deepEqual(info.totals, baseline.totals); assert.deepEqual(info.component_definitions, baseline.component_definitions);
      return live.save_model({ runtime: 'queue', path: fixture, timeoutMs: 30000 });
    });
    await write('fixture-initial-save', saved);
    console.log(JSON.stringify({ mode, saved: true, fixture }));
  } else if (mode === 'inspect') {
    const info = await bridge.get_model_info({ runtime: 'queue', timeoutMs: 30000 });
    await write('current-model', info);
    console.log(JSON.stringify({ plugin: capability.runtime.plugin, compatibility: capability.runtime.compatibility.ok,
      source_path: info.source_path, totals: info.totals, model_modified: info.model_modified }));
  } else {
    const info = await bridge.get_model_info({ runtime: 'queue', timeoutMs: 30000 });
    assert.equal(info.source_path, fixture, 'Only the dedicated, saved fixture may be modified.');
    if (mode === 'layout' || mode === 'structure') {
      const result = await (mode === 'layout' ? runLayoutNativeQA : runStructureNativeQA)({ bridge, outputDir, ...(mode === 'layout' ? { resumeRunId: process.argv[4], resumeStage: process.argv[5] } : { resumeAfterInsert: process.argv[4] === 'resume-after-insert' }) });
      console.log(JSON.stringify(result));
      if (!result.ok) process.exitCode = 1;
    } else if (mode === 'capture') {
      const result = await bridge.withFreshQueueMutationAuthorization({ operation: 'capture_detail_views', timeoutMs: 120000 }, live => live.capture_detail_views({
        runtime: 'queue', timeoutMs: 120000, output_dir: path.join(outputDir, 'final-views'),
        views: [{ id: 'overview', width: 1600, height: 1000 }]
      }));
      assert.equal(result.restored, true);
      assert.ok(result.captures.every(capture => capture.server_verified === true));
      await write('final-captures', result);
      console.log(JSON.stringify({ mode, captures: result.captures.map(capture => ({ path: capture.path, sha256: capture.sha256, server_verified: capture.server_verified })) }));
    } else {
      const saved = await bridge.withFreshQueueMutationAuthorization({ operation: 'save_model', timeoutMs: 30000 }, live => live.save_model({ runtime: 'queue', path: fixture, timeoutMs: 30000 }));
      await write('fixture-final-save', saved);
      console.log(JSON.stringify({ mode, saved: true, fixture, size_bytes: (await fs.stat(fixture)).size }));
    }
  }
} finally {
  await write(`timing-${mode}`, await bridge.queue_diagnostics());
}
