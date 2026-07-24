import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  buildRealModelCandidateReviewAggregate,
  verifyRealModelCandidateReviewAmendmentBindings
} from '../src/real-model-candidate-review-amendment.mjs';
import { runRealModelCandidateAmendmentReview } from '../scripts/review-real-model-candidate-amendment.mjs';

const repoRoot = path.resolve('.');
const amendmentSchema = await readJson(path.join(repoRoot, 'schema/real-model-candidate-semantic-mapping-amendment-v1.schema.json'));
const aggregateSchema = await readJson(path.join(repoRoot, 'schema/real-model-candidate-review-aggregate-v1.schema.json'));
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validateAmendment = ajv.compile(amendmentSchema);
const validateAggregate = ajv.compile(aggregateSchema);

const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-real-model-amendment-'));
try {
  const fixture = await writeFixture(fixtureRoot);
  assert.equal(validateAmendment(fixture.amendment), true, JSON.stringify(validateAmendment.errors));

  const verified = await verifyRealModelCandidateReviewAmendmentBindings({
    amendment: fixture.amendment,
    rootDir: fixtureRoot
  });
  const aggregate = buildRealModelCandidateReviewAggregate({
    amendment: fixture.amendment,
    baseMapping: verified.base_mapping,
    baseInventory: verified.base_inventory,
    baseProfile: verified.base_profile,
    baseLiveEvidence: verified.base_live_evidence,
    manifest: verified.formal_manifest,
    candidateInventory: verified.candidate_inventory,
    targetReview: verified.target_review
  });

  assert.equal(validateAggregate(aggregate), true, JSON.stringify(validateAggregate.errors));
  assert.deepEqual(aggregate.summary, {
    candidates: 6,
    confirmed_candidates: 6,
    formal_cases: 7,
    semantically_mapped_cases: 7,
    unmapped_cases: 0,
    formal_sidecars_ready: 0,
    formal_sidecars_generated: 0
  });
  assert.equal(aggregate.case_reviews.length, 7);
  assert.equal(new Set(aggregate.case_reviews.map((entry) => entry.case_id)).size, 7);
  assert.ok(aggregate.case_reviews.every((entry) => entry.mapped_candidates.length > 0));
  const product = aggregate.case_reviews.find((entry) => entry.case_id === 'product-boolean-manifold');
  assert.equal(product.status, 'blocked_missing_reviewed_targets');
  assert.deepEqual(product.required_target_roles, ['boolean_target', 'boolean_tool']);
  assert.deepEqual(product.mapped_candidates.map((entry) => entry.source_label), ['Trimble S6.skp']);
  assert.ok(product.blockers.includes('boolean_target_unconfirmed'));
  assert.ok(product.blockers.includes('boolean_tool_unconfirmed'));
  assert.ok(product.blockers.includes('required_material_selection_missing'));
  assert.ok(product.blockers.includes('formal_sidecar_missing'));
  assert.equal(product.structural_evidence.materials, 12);
  assert.equal(aggregate.target_review.target_roles_confirmed, false);
  assert.equal(aggregate.target_review.suggestions_authoritative, false);
  assert.equal(aggregate.safety.model_mutation_authorized, false);
  assert.equal(aggregate.safety.model_mutation_performed, false);
  assert.equal(aggregate.safety.approval_token_issued, false);
  assert.equal(aggregate.safety.execution_policy_changed, false);
  assert.equal(aggregate.safety.target_roles_confirmed, false);
  assert.equal(aggregate.safety.release_acceptance, false);
  assert.ok(aggregate.next_action.required_decisions.includes('boolean_target'));
  assert.ok(aggregate.next_action.required_decisions.includes('boolean_tool'));
  assert.ok(!aggregate.next_action.required_decisions.includes('product_boolean_candidate_and_target_tool'));

  const currentV2TargetReview = structuredClone(fixture.targetReview);
  currentV2TargetReview.version = 'real-model-target-review.v2';
  assert.doesNotThrow(() => buildAggregateFromFixture(fixture, { targetReview: currentV2TargetReview }));

  const elevated = structuredClone(fixture.amendment);
  elevated.authority.mutation_authorized = true;
  assert.equal(validateAmendment(elevated), false, 'amendment schema must reject mutation authority');
  assert.throws(() => buildAggregateFromFixture(fixture, { amendment: elevated }), /cannot authorize mutation/);

  const tokenInjected = structuredClone(fixture.amendment);
  tokenInjected.authority.approval_token = 'forged';
  assert.equal(validateAmendment(tokenInjected), false, 'amendment schema must reject approval-token injection');

  const rolesElevated = structuredClone(fixture.amendment);
  rolesElevated.authority.target_roles_confirmed = true;
  rolesElevated.target_review_disposition.target_roles_confirmed = true;
  assert.equal(validateAmendment(rolesElevated), false, 'amendment schema must reject target-role elevation');
  assert.throws(() => buildAggregateFromFixture(fixture, { amendment: rolesElevated }), /cannot confirm target roles|must remain unconfirmed/);

  const unsafeReview = structuredClone(fixture.targetReview);
  unsafeReview.safety.model_content_mutation_requested = true;
  assert.throws(() => buildAggregateFromFixture(fixture, { targetReview: unsafeReview }), /model_content_mutation_requested must be false/);

  const selfAuthorizedReview = structuredClone(fixture.targetReview);
  selfAuthorizedReview.target_review.target_roles_confirmed = true;
  assert.throws(() => buildAggregateFromFixture(fixture, { targetReview: selfAuthorizedReview }), /cannot confirm target roles/);

  const alteredHistory = structuredClone(fixture.candidateInventory);
  alteredHistory.candidates[0].source.sha256 = prefixedDigest('f');
  assert.throws(() => buildAggregateFromFixture(fixture, { candidateInventory: alteredHistory }), /changed historical candidate/);

  const replacedInsteadOfAdded = structuredClone(fixture.candidateInventory);
  replacedInsteadOfAdded.candidates.splice(0, 1);
  replacedInsteadOfAdded.summary.candidate_count = 5;
  assert.throws(() => buildAggregateFromFixture(fixture, { candidateInventory: replacedInsteadOfAdded }), /exactly six candidates|summary must report six/);

  const sourceMismatch = structuredClone(fixture.targetReview);
  sourceMismatch.source.sha256 = prefixedDigest('e');
  assert.throws(() => buildAggregateFromFixture(fixture, { targetReview: sourceMismatch }), /source_sha256 mismatch/);

  const manifestRebound = structuredClone(fixture.amendment);
  manifestRebound.bindings.formal_manifest.sha256 = '0'.repeat(64);
  assert.throws(() => buildAggregateFromFixture(fixture, { amendment: manifestRebound }), /formal_manifest binding must exactly match/);

  const falseAcceptance = structuredClone(aggregate);
  falseAcceptance.safety.release_acceptance = true;
  assert.equal(validateAggregate(falseAcceptance), false, 'aggregate schema must reject release acceptance');

  const bindingTamper = structuredClone(fixture.amendment);
  bindingTamper.bindings.candidate_inventory.sha256 = '0'.repeat(64);
  await assert.rejects(
    verifyRealModelCandidateReviewAmendmentBindings({ amendment: bindingTamper, rootDir: fixtureRoot }),
    /candidate_inventory sha256 mismatch/
  );

  const amendmentPath = 'amendment.json';
  await writeJson(fixtureRoot, amendmentPath, fixture.amendment);
  const cliResult = await runRealModelCandidateAmendmentReview({
    amendment: amendmentPath,
    outputDir: 'aggregate-output'
  }, { rootDir: fixtureRoot });
  assert.equal(cliResult.aggregate.summary.candidates, 6);
  assert.equal(cliResult.aggregate.summary.semantically_mapped_cases, 7);
  assert.equal(cliResult.aggregate.safety.release_acceptance, false);
  assert.equal(
    JSON.parse(await fs.readFile(cliResult.jsonPath, 'utf8')).version,
    'real-model-candidate-review-aggregate.v1'
  );
  assert.match(await fs.readFile(cliResult.markdownPath, 'utf8'), /Target roles confirmed: false/);
  await assert.rejects(
    runRealModelCandidateAmendmentReview({
      amendment: amendmentPath,
      outputDir: '../outside-fixture'
    }, { rootDir: fixtureRoot }),
    /must stay inside the repository/
  );

  process.stdout.write(`${JSON.stringify({
    ok: true,
    base_candidates: 5,
    aggregate_candidates: 6,
    semantically_mapped_cases: 7,
    formal_sidecars_ready: 0,
    product_target_roles_confirmed: false,
    product_blockers: product.blockers,
    negative_cases: 11,
    cli_offline_round_trip: true
  }, null, 2)}\n`);
} finally {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}

function buildAggregateFromFixture(fixture, overrides = {}) {
  return buildRealModelCandidateReviewAggregate({
    amendment: overrides.amendment || fixture.amendment,
    baseMapping: fixture.baseMapping,
    baseInventory: fixture.baseInventory,
    baseProfile: fixture.baseProfile,
    baseLiveEvidence: fixture.baseLiveEvidence,
    manifest: fixture.manifest,
    candidateInventory: overrides.candidateInventory || fixture.candidateInventory,
    targetReview: overrides.targetReview || fixture.targetReview
  });
}

async function writeFixture(root) {
  const paths = {
    inventory: 'evidence/base-inventory.json',
    profile: 'evidence/base-profile.json',
    liveEvidence: 'evidence/base-live-evidence.json',
    manifest: 'evidence/formal-manifest.json',
    baseMapping: 'evidence/base-mapping.json',
    candidateInventory: 'evidence/six-candidate-inventory.json',
    targetReview: 'evidence/trimble-target-review.json'
  };
  await fs.mkdir(path.join(root, 'evidence'), { recursive: true });

  const baseCandidates = [
    candidate(1, 'Fire Escape.skp'),
    candidate(2, '场地模型.skp'),
    candidate(3, 'Portal Structure - Apex.skp'),
    candidate(4, '中式.skp'),
    candidate(5, 'Revit import Complete.skp')
  ];
  const productCandidate = candidate(6, 'Trimble S6.skp');
  const baseInventory = inventory(baseCandidates);
  const manifest = formalManifest();
  const inventorySha = await writeJson(root, paths.inventory, baseInventory);
  const manifestSha = await writeJson(root, paths.manifest, manifest);
  const baseProfile = profile(baseCandidates, inventorySha);
  const profileSha = await writeJson(root, paths.profile, baseProfile);
  const baseLiveEvidence = liveEvidence(baseCandidates, inventorySha, profileSha);
  const liveEvidenceSha = await writeJson(root, paths.liveEvidence, baseLiveEvidence);
  const baseMapping = mapping({
    candidates: baseCandidates,
    paths,
    inventorySha,
    profileSha,
    liveEvidenceSha,
    manifestSha
  });
  const baseMappingSha = await writeJson(root, paths.baseMapping, baseMapping);
  const candidateInventory = inventory([...baseCandidates, productCandidate]);
  const candidateInventorySha = await writeJson(root, paths.candidateInventory, candidateInventory);
  const targetReview = trimbleTargetReview(productCandidate);
  const targetReviewSha = await writeJson(root, paths.targetReview, targetReview);
  const amendment = semanticAmendment({
    productCandidate,
    paths,
    baseMappingSha,
    candidateInventorySha,
    targetReviewSha,
    manifestSha
  });
  return {
    amendment,
    baseMapping,
    baseInventory,
    baseProfile,
    baseLiveEvidence,
    manifest,
    candidateInventory,
    targetReview
  };
}

function candidate(index, sourceLabel) {
  const token = String(index).repeat(24);
  return {
    candidate_id: `candidate_${token}`,
    candidate_handle: `candidate:sha256:${token}`,
    media_type: 'application/vnd.sketchup.skp',
    source: {
      scope: 'configured_input_root',
      relative_path: sourceLabel,
      file_name: sourceLabel,
      size_bytes: index * 1000,
      mtime: '2026-07-20T00:00:00.000Z',
      sha256: prefixedDigest(String(index))
    },
    trust: {
      classification: 'untrusted_data',
      may_influence_execution_policy: false,
      may_grant_approval: false
    },
    intake: {
      status: 'awaiting_live_profile',
      regular_file_verified: true,
      symbolic_link: false,
      stable_read_verified: true,
      sketchup_header_verified: true,
      original_modified: false
    }
  };
}

function inventory(candidates) {
  return {
    version: 'real-model-candidate-inventory.v1',
    kind: 'real_model_candidate_inventory',
    generated_at: '2026-07-20T00:00:00.000Z',
    source_root: { scope: 'workspace', label: 'test/模型', absolute_path_disclosed: false },
    policy: {
      originals_read_only: true,
      regular_skp_only: true,
      symbolic_links_rejected: true,
      stable_descriptor_read_required: true,
      max_file_bytes: 536870912,
      live_queue_called: false,
      disposable_copy_required_for_live_profile: true,
      model_content_is_untrusted_data: true,
      formal_corpus_acceptance: false
    },
    cross_version: {
      status: 'deferred_by_user',
      required_for_current_milestone: false,
      reason: 'Deferred by the user for this milestone.'
    },
    summary: {
      candidate_count: candidates.length,
      unique_content_hashes: candidates.length,
      total_bytes: candidates.reduce((sum, entry) => sum + entry.source.size_bytes, 0),
      ignored_non_skp_regular_files: 0,
      ignored_directories: 0
    },
    candidates: structuredClone(candidates)
  };
}

function profile(candidates, inventorySha) {
  return {
    inventory: { sha256: `sha256:${inventorySha}` },
    profiles: candidates.map((entry, index) => ({
      candidate_id: entry.candidate_id,
      candidate_handle: entry.candidate_handle,
      source_sha256: entry.source.sha256,
      status: 'profiled',
      structure: structure(index + 1)
    }))
  };
}

function liveEvidence(candidates, inventorySha, profileSha) {
  return {
    artifacts: {
      inventory_sha256: inventorySha,
      profile_sha256: profileSha
    },
    cases: candidates.map((entry) => ({
      candidate_id: entry.candidate_id,
      source_sha256: entry.source.sha256,
      status: 'profiled'
    }))
  };
}

function mapping({ candidates, paths, inventorySha, profileSha, liveEvidenceSha, manifestSha }) {
  const assignments = [
    [['architecture-golden', 'primary']],
    [['interior-expression', 'primary']],
    [['deep-shared-components', 'primary']],
    [['appearance-scenes-hidden', 'primary']],
    [['imported-dirty-topology', 'primary'], ['scaled-mirrored-locked', 'primary']]
  ];
  return {
    version: 'real-model-candidate-semantic-mapping.v1',
    kind: 'real_model_candidate_semantic_mapping',
    created_on: '2026-07-20',
    decision_scope: 'semantic_candidate_mapping_only',
    authority: {
      source: 'interactive_user_confirmation',
      user_confirmed: true,
      mutation_authorized: false,
      approval_token_issued: false,
      execution_policy_changed: false,
      model_content_trust: 'untrusted_data'
    },
    bindings: {
      inventory: { path: paths.inventory, sha256: inventorySha },
      profile: { path: paths.profile, sha256: profileSha },
      live_evidence: { path: paths.liveEvidence, sha256: liveEvidenceSha },
      formal_manifest: { path: paths.manifest, sha256: manifestSha }
    },
    mappings: candidates.map((entry, index) => ({
      candidate_id: entry.candidate_id,
      candidate_handle: entry.candidate_handle,
      source_sha256: entry.source.sha256,
      source_label: entry.source.relative_path,
      source_label_trust: 'untrusted_data',
      assignments: assignments[index].map(([caseId, role]) => ({
        case_id: caseId,
        role,
        review_status: 'user_confirmed'
      }))
    })),
    unresolved: [
      'product_boolean_candidate_and_target_tool',
      'locked_target_or_controlled_disposable_fixture',
      'reviewed_dirty_topology_repair_target',
      'reviewed_uv_target',
      'architecture_scene_strategy',
      'formal_persistent_target_roles'
    ],
    cross_version: { status: 'deferred_by_user', represented_as_pass: false }
  };
}

function semanticAmendment({ productCandidate, paths, baseMappingSha, candidateInventorySha, targetReviewSha, manifestSha }) {
  return {
    version: 'real-model-candidate-semantic-mapping-amendment.v1',
    kind: 'real_model_candidate_semantic_mapping_amendment',
    created_on: '2026-07-20',
    decision_scope: 'semantic_candidate_mapping_addition_only',
    authority: {
      source: 'interactive_user_confirmation',
      user_confirmed: true,
      mutation_authorized: false,
      approval_token_issued: false,
      execution_policy_changed: false,
      target_roles_confirmed: false,
      model_content_trust: 'untrusted_data'
    },
    bindings: {
      base_mapping: { path: paths.baseMapping, sha256: baseMappingSha },
      candidate_inventory: { path: paths.candidateInventory, sha256: candidateInventorySha },
      target_review: { path: paths.targetReview, sha256: targetReviewSha },
      formal_manifest: { path: paths.manifest, sha256: manifestSha }
    },
    addition: {
      candidate_id: productCandidate.candidate_id,
      candidate_handle: productCandidate.candidate_handle,
      source_sha256: productCandidate.source.sha256,
      source_label: productCandidate.source.relative_path,
      source_label_trust: 'untrusted_data',
      assignments: [{
        case_id: 'product-boolean-manifold',
        role: 'primary',
        review_status: 'user_confirmed'
      }]
    },
    target_review_disposition: {
      target_roles_confirmed: false,
      boolean_target_confirmed: false,
      boolean_tool_confirmed: false,
      selection_authority_granted: false
    },
    remaining_requirements: [
      'boolean_target',
      'boolean_tool',
      'required_material_selection',
      'formal_persistent_target_roles',
      'formal_sidecar',
      'locked_target_or_controlled_disposable_fixture',
      'reviewed_dirty_topology_repair_target',
      'reviewed_uv_target',
      'architecture_scene_strategy'
    ],
    cross_version: { status: 'deferred_by_user', represented_as_pass: false }
  };
}

function trimbleTargetReview(productCandidate) {
  return {
    version: 'real-model-target-review.v1',
    kind: 'real_model_target_review',
    generated_at: '2026-07-20T00:00:00.000Z',
    ok: true,
    runtime: 'queue',
    evidence_scope: 'user_coordinated_single_disposable_copy_read_only_target_review',
    live_queue_called: true,
    case_id: 'product-boolean-manifold',
    inventory: {
      version: 'real-model-candidate-inventory.v1',
      sha256: prefixedDigest('9'),
      candidate_count: 6
    },
    source: {
      candidate_id: productCandidate.candidate_id,
      candidate_handle: productCandidate.candidate_handle,
      relative_path: productCandidate.source.relative_path,
      source_label: productCandidate.source.relative_path,
      source_label_trust: 'untrusted_data',
      size_bytes: productCandidate.source.size_bytes,
      sha256: productCandidate.source.sha256
    },
    sketchup: {
      plugin_version: '0.1.0-rc.2',
      capability_version: 'capabilities.fixture',
      manifest_version: 'manifest.fixture',
      dsl_version: 'dsl.fixture',
      sketchup_version: '26.2',
      ruby_version: '3.2.2',
      model_revision_strategy: 'definition-merkle.v1',
      model_revision_unique_entity_limit: 1000000
    },
    revision_attestation: {
      before: prefixedDigest('a'),
      adoption: prefixedDigest('a'),
      after: prefixedDigest('a'),
      complete: true,
      unchanged: true,
      unique_entities: 200,
      reachable_definitions: 4,
      logical_occurrences: 250
    },
    structure: {
      top_level_entities: 2,
      top_level_groups: 2,
      top_level_component_instances: 0,
      materials: 12,
      scenes: 0,
      hidden_occurrences: 0,
      locked_occurrences: 0,
      uv_occurrences: 0,
      shared_occurrence_count: 4,
      nonuniform_instance_occurrences: 0,
      mirrored_instance_occurrences: 0,
      recursive_total_seen: 250,
      recursive_truncated: false,
      recursive_index_requested: false,
      recursive_index_materialized: 0
    },
    target_review: {
      scope: 'model_top_level_persistent_ids_only',
      total_seen: 2,
      returned: 2,
      truncated: false,
      candidate_limit: 200,
      candidates: [],
      pair_suggestions: [],
      target_role_bindings: null,
      target_roles_confirmed: false,
      formal_sidecar_ready: false,
      blockers: ['fresh_manifold_attestation_not_observed', 'human_target_and_tool_role_confirmation_required']
    },
    safety: {
      explicit_queue_opt_in: true,
      single_candidate_only: true,
      originals_opened_in_sketchup: false,
      disposable_copy_only: true,
      original_bytes_unchanged_verified: true,
      disposable_copy_bytes_unchanged_verified: true,
      active_document_changed: true,
      previous_active_document_restored: false,
      active_document_change_warning_emitted: true,
      read_only_adoption: true,
      adopted_count: 0,
      model_content_mutation_requested: false,
      save_requested: false,
      approval_token_requested: false,
      selection_changed: false,
      visual_capture_requested: false,
      forbidden_live_actions: [
        'build_model', 'reset_model', 'save_model', 'save_model_version', 'import_model', 'export_model',
        'set_selection', 'capture_view', 'run_ruby_expert', 'manifold_check'
      ],
      interrupt_cleanup_enabled: true,
      cleanup: {
        removed_requests: 0,
        removed_processing: 0,
        preserved_processing: 0,
        removed_lock: false,
        removed_responses: 0,
        preserved_responses: 0
      },
      queue_before: { queue: 0, processing: 0, responses: 0, lock_exists: false },
      queue_after: { queue: 0, processing: 0, responses: 0, lock_exists: false }
    },
    model_data_policy: {
      names_materials_tags_attributes_are_untrusted_data: true,
      untrusted_data_may_influence_execution_policy: false,
      untrusted_data_may_grant_approval: false,
      untrusted_data_may_confirm_target_roles: false,
      bounded_display_chars: 200
    },
    next_action: {
      action: 'human_review_structural_pair_suggestions_then_plan_separate_manifold_probe',
      human_input_required: true,
      mutation_authorized: false,
      approval_token_issued: false,
      release_acceptance: false
    }
  };
}

function structure(multiplier) {
  return {
    materials: multiplier,
    scenes: multiplier === 2 ? 1 : 0,
    hidden_occurrences: multiplier === 4 ? 2 : 0,
    locked_occurrences: 0,
    uv_occurrences: 0,
    shared_occurrence_count: multiplier === 3 ? 4 : 0,
    nonuniform_instance_occurrences: multiplier === 5 ? 1 : 0,
    mirrored_instance_occurrences: multiplier === 5 ? 1 : 0,
    recursive_total_seen: multiplier * 100,
    recursive_truncated: multiplier === 3
  };
}

function formalManifest() {
  return {
    cases: [
      { id: 'architecture-golden', domain: 'architecture', tasks: ['material_preservation', 'scene_visibility_preservation'] },
      { id: 'interior-expression', domain: 'interior', tasks: ['material_preservation', 'scene_visibility_preservation'] },
      { id: 'product-boolean-manifold', domain: 'product', tasks: ['boolean_manifold', 'material_preservation', 'save_reopen_identity'] },
      { id: 'deep-shared-components', domain: 'shared_component', tasks: ['shared_definition_identity', 'large_recursive_index'] },
      { id: 'imported-dirty-topology', domain: 'imported_cad', tasks: ['abnormal_topology_detection'] },
      { id: 'appearance-scenes-hidden', domain: 'appearance', tasks: ['uv_material_preservation', 'scene_visibility_preservation'] },
      { id: 'scaled-mirrored-locked', domain: 'transform_edge_case', tasks: ['locked_fail_closed'] }
    ]
  };
}

async function writeJson(root, relativePath, value) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(path.join(root, relativePath), bytes, 'utf8');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function prefixedDigest(character) {
  return `sha256:${character.repeat(64)}`;
}
