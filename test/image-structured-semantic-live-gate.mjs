import assert from 'node:assert/strict';
import {
  assertRuntimeOnlyLiveBinding,
  assertSemanticLiveGatePreconditions,
  validateSemanticLiveGateReport,
  waitForSemanticLiveModelActivation
} from '../scripts/run-image-structured-semantic-live-gate.mjs';

const valid = {
  runtime: 'queue',
  queueRequired: true,
  executeLive: true,
  disposableCopyConfirmed: true,
  sourceModel: 'output/disposable.skp',
  dslPath: 'output/model.json',
  partGraphPath: 'output/part-graph.json',
  compileManifestPath: 'output/manifest.json',
  outputDir: 'output/semantic-live-gate'
};
assert.match(assertSemanticLiveGatePreconditions(valid).absoluteOutputDir, /output\/semantic-live-gate$/);
assert.throws(() => assertSemanticLiveGatePreconditions({ ...valid, executeLive: false }), /--execute-live/);
assert.throws(() => assertSemanticLiveGatePreconditions({ ...valid, disposableCopyConfirmed: false }), /--disposable-copy-confirmed/);
assert.throws(() => assertSemanticLiveGatePreconditions({ ...valid, runtime: 'mock' }), /--runtime queue/);
assert.throws(() => assertSemanticLiveGatePreconditions({ ...valid, compileManifestPath: null }), /compileManifestPath is required/);
assert.match(assertSemanticLiveGatePreconditions({
  ...valid,
  runtimeOnly: true,
  compileManifestPath: null
}).absoluteOutputDir, /output\/semantic-live-gate$/);
assert.throws(() => assertSemanticLiveGatePreconditions({ ...valid, outputDir: '../outside' }), /inside the repository/);

const runtimePartGraph = {
  id: 'runtime-only-part-graph',
  source_mode: 'manual_authored',
  semantic_contract: { id: 'runtime-only-semantic-contract' }
};
const runtimeDsl = {
  metadata: {
    source_mode: 'manual_authored',
    interpretation_eligible: false,
    part_graph_id: runtimePartGraph.id,
    semantic_contract: { id: runtimePartGraph.semantic_contract.id }
  }
};
assert.equal(assertRuntimeOnlyLiveBinding({ dsl: runtimeDsl, partGraph: runtimePartGraph }), true);
assert.throws(() => assertRuntimeOnlyLiveBinding({
  dsl: { ...runtimeDsl, metadata: { ...runtimeDsl.metadata, source_mode: 'image_structured', interpretation_eligible: true } },
  partGraph: { ...runtimePartGraph, source_mode: 'image_structured' }
}), /cannot accept image_structured/);
const activationSteps = [];
const activated = await waitForSemanticLiveModelActivation({
  bridge: {
    async get_active_model_identity() {
      return {
        document_id: 'document-test',
        model_revision: 'revision-test',
        model_identity: { source_path: '/tmp/expected-working-copy.skp' }
      };
    }
  },
  expectedPath: '/tmp/expected-working-copy.skp',
  steps: activationSteps,
  forStep: 'build',
  timeoutMs: 1000
});
assert.equal(activated.document_id, 'document-test');
assert.deepEqual(activationSteps.map((step) => step.kind), ['model_activation_confirmed']);

const hash = `sha256:${'e'.repeat(64)}`;
const failedReport = {
  version: 1,
  kind: 'image_structured_semantic_live_gate_report',
  claim_scope: 'image_structured_full',
  runtime: 'queue',
  ok: false,
  live_status: 'live_unverified',
  evidence_level: 'queue_incomplete',
  source_model: { path: '/tmp/disposable-source.skp', sha256: hash, modified: false },
  disposable_working_copy: '/tmp/working-copy.skp',
  inputs: {
    dsl: { path: '/tmp/model.json', sha256: hash },
    part_graph: { path: '/tmp/part-graph.json', sha256: hash },
    compile_manifest: { path: '/tmp/manifest.json', sha256: hash },
    source_mode: 'image_structured',
    interpretation_eligible: true,
    semantic_contract_id: null,
    provenance_binding_hash: null,
    source_asset_binding_hash: null,
    compile_receipt_id: null
  },
  fresh_capability_handshake: false,
  capability_runtime: null,
  steps: [{ kind: 'live_gate_error', ok: false }],
  save_reopen_semantic_digest_matches: false,
  claim_boundaries: {
    image_interpretation_accuracy: false,
    structured_semantic_contract: true,
    queue_execution_save_reopen: false,
    note: 'The failed fixture does not upgrade interpretation claims.'
  },
  evidence_limits: {
    view_evidence: 'server_capture_bound_aabb_occlusion_projection',
    pixel_level_semantic_segmentation: false,
    native_mesh_check_in_scope: false,
    native_face_normal_remeasurement: false,
    mesh_winding_evidence: 'not_in_scope',
    note: 'Scoped failure fixture.'
  },
  error: 'queue timeout',
  release_ready: false
};
assert.equal((await validateSemanticLiveGateReport(failedReport)).ok, true);
assert.equal((await validateSemanticLiveGateReport({
  ...failedReport,
  ok: true,
  live_status: 'scoped_live_verified',
  evidence_level: 'queue_live_scoped'
})).ok, false);

const successReport = {
  ...failedReport,
  ok: true,
  live_status: 'scoped_live_verified',
  evidence_level: 'queue_live_scoped',
  source_model: { ...failedReport.source_model, modified: false },
  saved_model: { path: '/tmp/result.skp', sha256: hash },
  inputs: {
    ...failedReport.inputs,
    semantic_contract_id: 'traditional-hall-four-large-surface-truths',
    provenance_binding_hash: hash,
    source_asset_binding_hash: hash,
    compile_receipt_id: 'receipt-test'
  },
  fresh_capability_handshake: true,
  capability_runtime: 'queue',
  captures: [
    { kind: 'capture_view', ok: true, view: 'front', queue_view: 'front', path: '/tmp/front.png', sha256: hash, server_visual_capture: true, read_only_attestation_verified: true },
    { kind: 'capture_view', ok: true, view: 'oblique', queue_view: 'iso', path: '/tmp/oblique.png', sha256: hash, server_visual_capture: true, read_only_attestation_verified: true }
  ],
  save_reopen_semantic_digest_matches: true,
  semantic_revalidation: { ok: true },
  claim_boundaries: {
    ...failedReport.claim_boundaries,
    queue_execution_save_reopen: true
  },
  error: undefined
};
delete successReport.error;
assert.equal((await validateSemanticLiveGateReport(successReport)).ok, true);

const runtimeOnlySuccessReport = {
  ...successReport,
  claim_scope: 'semantic_runtime_only',
  inputs: {
    ...successReport.inputs,
    compile_manifest: null,
    source_mode: 'manual_authored',
    interpretation_eligible: false,
    provenance_binding_hash: null,
    source_asset_binding_hash: null,
    compile_receipt_id: null
  }
};
assert.equal((await validateSemanticLiveGateReport(runtimeOnlySuccessReport)).ok, true);
assert.equal((await validateSemanticLiveGateReport({
  ...runtimeOnlySuccessReport,
  inputs: { ...runtimeOnlySuccessReport.inputs, source_mode: 'image_structured' }
})).ok, false);

process.stdout.write(`${JSON.stringify({
  ok: true,
  live_execution_performed: false,
  required_sequence: ['get_capabilities(queue)', 'build', 'save', 'reopen', 'capture_front', 'capture_oblique', 'semantic_revalidation'],
  fail_closed_without_disposable_confirmation: true,
  runtime_only_scope_excludes_image_structured_lineage: true,
  live_report_schema_success_and_failure_cases: true,
  default_status_without_run: 'live_unverified'
}, null, 2)}\n`);
