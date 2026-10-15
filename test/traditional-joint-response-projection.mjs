import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { createResultEnvelope } from '../src/agent-contract.mjs';
import { createAgentResponsePolicy, presentAgentResultEnvelope } from '../src/agent-response-projection.mjs';

// Public presentation fixtures exercise evidence retention only. They do not
// query SketchUp and provide no live native geometry or release acceptance.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'traditional-joint-projection-'));
const revision = `sha256:${'1'.repeat(64)}`;
const specificationHash = `sha256:${'2'.repeat(64)}`;
const nativeRow = (index, status = 'pass') => ({
  id: `root-${index}:column_beam`, kind: 'column_beam', status,
  evidence_level: 'native_surface_distance', measured_distance_mm: status === 'fail' ? 3 : 0,
  tolerance_mm: 1, units: 'mm', method: 'minimum_native_triangle_surface_distance',
  first_entity_path: `pid:${index + 1}.pid:100`, second_entity_path: `pid:${index + 1}.pid:200`,
  snapshot_handles: [`geometry:${'3'.repeat(64)}`],
  penetration_checked: false, bearing_capacity_checked: false,
  interpretation: status === 'fail' ? 'surface_gap_exceeds_tolerance' : 'surfaces_within_gap_tolerance; intersection_not_excluded'
});
const cases = [
  { name: 'native', evidence: 'native_surface_distance', rows: Array.from({ length: 3 }, (_, i) => nativeRow(i)), counts: { pass: 3, fail: 0, unsupported: 0, unverified: 0 } },
  { name: 'legacy-field', evidence: 'native_surface_distance', legacyField: true, rows: Array.from({ length: 3 }, (_, i) => nativeRow(i)), counts: { pass: 3, fail: 0, unsupported: 0, unverified: 0 } },
  { name: 'mixed', evidence: 'mixed_or_unverified', rows: [
    ...Array.from({ length: 9 }, (_, i) => nativeRow(i)),
    { ...nativeRow(9), status: 'unsupported', evidence_level: 'compiler_expected_coordinates', measured_distance_mm: null, reason: 'triangle_pair_budget_exceeded' },
    { ...nativeRow(10), status: 'unverified', evidence_level: 'compiler_expected_coordinates', measured_distance_mm: null, reason: 'native_joint_report_unverified' },
    nativeRow(11, 'fail')
  ], counts: { pass: 9, fail: 1, unsupported: 1, unverified: 1 } },
  { name: 'legacy', evidence: 'compiler_expected_coordinates', rows: [], counts: { pass: 0, fail: 0, unsupported: 0, unverified: 0 } },
  { name: 'not-applicable', evidence: 'not_applicable', rows: [], counts: { pass: 0, fail: 0, unsupported: 0, unverified: 0 } }
];
try {
  const bridge = new SketchUpBridge({ agentContract: { rootDir: root }, executionPolicy: { allowed_runtimes: ['mock'], auto_approve_risks: [] } });
  for (const limit of [4096, 2048]) for (const kind of ['create_model_result', 'verify_model_result', 'verify_creation_result', 'verify_scene_result']) for (const fixture of cases) {
    const responsePolicy = createAgentResponsePolicy({ trustedPolicy: { max_context_chars: { guided: limit } } });
    const { task } = await bridge.taskStore.createTask({ intent: kind === 'create_model_result' ? 'create_model' : 'verify_model', instruction: 'Exercise bounded joint evidence presentation.', responsePolicy, inputs: { runtime: 'mock' } });
    const remaining = fixture.rows.filter(row => row.status !== 'pass').map(row => ({ type: row.status === 'fail' ? 'assembly.joint_gap_exceeded' : 'assembly.joint_unverified', joint_id: row.id, status: row.status === 'fail' ? 'fail' : 'unverified', reason: row.reason || row.interpretation }));
    const result = {
      kind, quality_status: remaining.length ? 'fail' : 'pass', quality_accepted: remaining.length === 0,
      // The general native summary must not promote unverified joint evidence.
      evidence_level: 'native_summary',
      quality: { quality_status: remaining.length ? 'fail' : 'pass', model_revision: revision, specification_hash: specificationHash,
        connection_evidence_level: fixture.legacyField ? fixture.evidence : 'compiler_expected_coordinates',
        ...(fixture.legacyField ? {} : { native_joint_evidence_level: fixture.evidence }), native_joint_measurements: fixture.rows,
        joint_measurement_scope: 'selected_member_pairs_only', joint_penetration_checked: false, joint_bearing_capacity_checked: false,
        remaining, connection_checks: [{ evidence_level: 'compiler_expected_coordinates', notes: 'compiler expectation only; '.repeat(100) }] },
      source_path: path.join(root, 'private-model.skp')
    };
    const envelope = createResultEnvelope({ task, data: result });
    const shown = await presentAgentResultEnvelope({ envelope, task, taskStore: bridge.taskStore }).catch(error => { error.message += ` (${kind}/${fixture.name}/${limit})`; throw error; });
    assert.ok(JSON.stringify(shown).length <= limit, `${kind}/${fixture.name} exceeded ${limit}`);
    assert.equal(shown.presentation.projected, true);
    assert.equal(shown.result.kind, kind);
    assert.equal(shown.result.quality_accepted, result.quality_accepted);
    const summary = shown.result.quality?.joint_summary || shown.result.joint_summary;
    assert.ok(summary, `${kind}/${fixture.name} lost joint evidence at ${limit}`);
    assert.deepEqual(summary.counts, fixture.counts);
    assert.equal(summary.evidence_level, fixture.evidence);
    assert.equal(summary.scope, 'selected_member_pairs_only');
    assert.equal(summary.penetration_checked, false);
    assert.equal(summary.bearing_capacity_checked, false);
    assert.equal(JSON.stringify(shown).includes(root), false);
    if (limit === 4096 && fixture.name === 'native') {
      assert.equal(summary.model_revision, revision);
      assert.equal(summary.units, 'mm');
      assert.equal(summary.samples.length, 2);
      assert.equal(summary.samples[0].measured_distance_mm, 0);
      assert.equal(summary.samples[0].tolerance_mm, 1);
    }
    if (summary.samples?.length && fixture.name === 'mixed') {
      assert.equal(summary.samples[0].status, 'fail', 'Late failures must precede passing samples.');
      assert.equal(summary.samples[1].status, 'unverified');
      assert.equal(summary.samples[1].measured_distance_mm, null);
    }
    if (limit === 2048) assert.equal(summary.samples, undefined);
    // Exercise public opaque pagination at both budgets: no
    // omitted sample, source binding or evidence boundary may be lost.
    if (kind === 'create_model_result' && ((limit === 4096 && fixture.name === 'native') || (limit === 2048 && fixture.name === 'mixed'))) {
      let handle = shown.presentation.full_result_artifact, offset = 0, content = '';
      while (true) {
        const page = await bridge.read_agent_artifact({ task_id: task.task_id, handle, offset, max_chars: 1500 });
        assert.ok(JSON.stringify(page).length <= limit);
        const artifact = page.data.artifact;
        content += artifact.content;
        if (artifact.eof) break;
        assert.ok(artifact.next_offset > offset); handle = artifact.handle; offset = artifact.next_offset;
      }
      const restored = JSON.parse(content).result.quality;
      assert.deepEqual(restored.native_joint_measurements, fixture.rows);
      assert.equal(restored.connection_evidence_level, 'compiler_expected_coordinates');
      assert.equal(restored.native_joint_evidence_level, fixture.evidence);
      assert.equal(restored.model_revision, revision);
      assert.equal(restored.specification_hash, specificationHash);
      assert.equal(restored.joint_penetration_checked, false);
      assert.equal(content.includes(root), false);
      const again = await presentAgentResultEnvelope({ envelope, task, taskStore: bridge.taskStore });
      assert.equal(again.presentation.full_result_artifact, shown.presentation.full_result_artifact);
    }
  }
  console.log('Traditional joint public projection: native/mixed/compiler/not-applicable evidence, bounded samples, gap-only boundaries and complete artifact pagination survive 4096/2048 character create/verify responses (offline fixtures only).');
} finally { await fs.rm(root, { recursive: true, force: true }); }
