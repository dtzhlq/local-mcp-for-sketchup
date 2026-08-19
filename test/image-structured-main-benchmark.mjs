import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { runImageStructuredMainBenchmark } from '../scripts/run-image-structured-main-benchmark.mjs';
import { evaluateRuntimeEvidence } from '../src/product-modeling/image-structured-benchmark.mjs';

const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'main-image-benchmark-'));
try {
  const report = await runImageStructuredMainBenchmark({ outputDir });
  assert.equal(report.methods.length, 4);
  assert.equal(report.scoring_policy.aggregate_score, null);
  assert.equal(report.scoring_policy.interpretation_cannot_be_replaced_by_face_count_or_model_size, true);
  const observedRouter = report.methods.find((method) => method.id === 'observed_building_single_router');
  assert.equal(observedRouter.interpretation.status, 'scored');
  assert.equal(observedRouter.interpretation.score, 0);
  assert.equal(observedRouter.interpretation.passed, 0);
  assert.equal(observedRouter.interpretation.total, 4);
  assert.equal(observedRouter.interpretation.urban_false_positive_count, 36);
  assert.equal(observedRouter.structure.status, 'fail');
  assert.equal(observedRouter.runtime.offline.status, 'not_available');
  const truthFixture = report.methods.find((method) => method.id === 'reviewed_truth_contract_fixture');
  assert.equal(truthFixture.interpretation.status, 'excluded');
  assert.equal(truthFixture.interpretation.reason, 'manually_constructed_ground_truth_contract_fixture_not_image_interpretation');
  assert.equal(truthFixture.structure.status, 'pass');
  assert.equal(report.methods.find((method) => method.id === 'direct_multimodal_dsl_reverse_wrapped').interpretation.status, 'excluded');
  assert.equal(report.methods.find((method) => method.id === 'imported_geometry_baseline').interpretation.status, 'excluded');
  assert.equal(report.summary.structure_passed_methods, 3);
  assert.equal(report.methods.filter((method) => method.id !== 'observed_building_single_router').every((method) => method.runtime.offline.evidence_level === 'offline_mock'), true);
  assert.equal(report.methods.every((method) => method.runtime.live.status === 'live_unverified'), true);
  assert.equal(report.methods.every((method) => method.runtime.release.release_ready === false), true);
  assert.equal(report.live_status, 'live_unverified');
  assert.equal(report.verdict, 'technical_baseline');
  assert.equal(report.release_ready, false);

  const provenanceBindingHash = `sha256:${'c'.repeat(64)}`;
  const incompleteSelfAssertion = evaluateRuntimeEvidence({
    runtime: 'queue',
    fresh_capability_handshake: true,
    capability_runtime: 'queue',
    save_reopen_semantic_digest_matches: true,
    mock_build_ok: true,
    steps: [
      { kind: 'get_capabilities_queue', ok: true },
      { kind: 'build', ok: true },
      { kind: 'save', ok: true },
      { kind: 'reopen', ok: true },
      { kind: 'capture_view', ok: true, view: 'front' },
      { kind: 'capture_view', ok: true, view: 'oblique' },
      { kind: 'semantic_revalidation', ok: true }
    ]
  }, { metadata: { provenance_binding_hash: provenanceBindingHash }, operations: [{ op: 'reset' }] });
  assert.equal(incompleteSelfAssertion.live.status, 'live_unverified');

  const captureHash = `sha256:${'d'.repeat(64)}`;
  const completeLiveEvidence = {
    version: 1,
    kind: 'image_structured_semantic_live_gate_report',
    claim_scope: 'image_structured_full',
    runtime: 'queue',
    ok: true,
    live_status: 'scoped_live_verified',
    evidence_level: 'queue_live_scoped',
    source_model: { modified: false },
    inputs: {
      source_mode: 'image_structured',
      interpretation_eligible: true,
      provenance_binding_hash: provenanceBindingHash,
      source_asset_binding_hash: provenanceBindingHash
    },
    fresh_capability_handshake: true,
    capability_runtime: 'queue',
    save_reopen_semantic_digest_matches: true,
    release_ready: false,
    evidence_limits: { native_face_normal_remeasurement: false },
    mock_build_ok: true,
    steps: [
      { kind: 'get_capabilities_queue', ok: true },
      { kind: 'fresh_queue_handshake', ok: true, for_step: 'build' },
      { kind: 'build', ok: true },
      { kind: 'fresh_queue_handshake', ok: true, for_step: 'save' },
      { kind: 'save', ok: true },
      { kind: 'fresh_queue_handshake', ok: true, for_step: 'reopen' },
      { kind: 'reopen', ok: true },
      { kind: 'fresh_queue_handshake', ok: true, for_step: 'capture_front' },
      { kind: 'capture_view', ok: true, view: 'front', sha256: captureHash, server_visual_capture: true, read_only_attestation_verified: true },
      { kind: 'fresh_queue_handshake', ok: true, for_step: 'capture_oblique' },
      { kind: 'capture_view', ok: true, view: 'oblique', sha256: captureHash, server_visual_capture: true, read_only_attestation_verified: true },
      { kind: 'semantic_revalidation', ok: true }
    ]
  };
  const fakeLive = evaluateRuntimeEvidence(completeLiveEvidence, {
    metadata: {
      source_mode: 'image_structured',
      interpretation_eligible: true,
      provenance_binding_hash: provenanceBindingHash,
      source_asset_binding_hash: provenanceBindingHash
    },
    operations: [{ op: 'reset' }]
  });
  assert.equal(fakeLive.live.status, 'verified');
  const staleHandshake = evaluateRuntimeEvidence({
    ...completeLiveEvidence,
    fresh_capability_handshake: false,
  }, {
    metadata: {
      source_mode: 'image_structured',
      interpretation_eligible: true,
      provenance_binding_hash: provenanceBindingHash,
      source_asset_binding_hash: provenanceBindingHash
    },
    operations: [{ op: 'reset' }]
  });
  assert.equal(staleHandshake.live.status, 'live_unverified');

  const runtimeOnlyLive = evaluateRuntimeEvidence({
    ...completeLiveEvidence,
    claim_scope: 'semantic_runtime_only',
    inputs: {
      source_mode: 'manual_authored',
      interpretation_eligible: false,
      provenance_binding_hash: null
    }
  }, {
    metadata: {
      source_mode: 'manual_authored',
      interpretation_eligible: false
    },
    operations: [{ op: 'reset' }]
  });
  assert.equal(runtimeOnlyLive.live.status, 'verified');
  const mismatchedRuntimeOnlyScope = evaluateRuntimeEvidence({
    ...completeLiveEvidence,
    claim_scope: 'semantic_runtime_only',
    inputs: {
      source_mode: 'manual_authored',
      interpretation_eligible: false,
      provenance_binding_hash: null
    }
  }, {
    metadata: {
      source_mode: 'image_structured',
      interpretation_eligible: true,
      provenance_binding_hash: provenanceBindingHash,
      source_asset_binding_hash: provenanceBindingHash
    },
    operations: [{ op: 'reset' }]
  });
  assert.equal(mismatchedRuntimeOnlyScope.live.status, 'live_unverified');

  const schema = JSON.parse(await fs.readFile('schema/image-structured-main-benchmark-report.schema.json', 'utf8'));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  assert.equal(validate(report), true, JSON.stringify(validate.errors, null, 2));

  process.stdout.write(`${JSON.stringify({
    ok: true,
    methods: report.methods.length,
    interpretation_scored: report.summary.interpretation_scored_methods,
    observed_router_truth_score: `${observedRouter.interpretation.passed}/${observedRouter.interpretation.total}`,
    interpretation_excluded: 3,
    structure_passed: report.summary.structure_passed_methods,
    runtime_live_status: report.live_status,
    release_ready: report.release_ready
  }, null, 2)}\n`);
} finally {
  await fs.rm(outputDir, { recursive: true, force: true });
}
