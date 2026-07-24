import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const BINDING_KEYS = Object.freeze(['inventory', 'profile', 'live_evidence', 'formal_manifest']);

export async function verifyRealModelCandidateReviewBindings({ mapping, rootDir }) {
  const root = path.resolve(rootDir);
  const realRoot = await fs.realpath(root);
  const documents = {};
  for (const key of BINDING_KEYS) {
    const binding = mapping?.bindings?.[key];
    reviewAssert(binding && typeof binding.path === 'string', `missing binding ${key}`);
    const candidate = path.resolve(root, binding.path);
    reviewAssert(isWithin(root, candidate), `binding ${key} escapes repository root`);
    const stat = await fs.lstat(candidate).catch(() => null);
    reviewAssert(stat?.isFile() === true && stat.isSymbolicLink() === false, `binding ${key} must be a regular non-symlink file`);
    const realCandidate = await fs.realpath(candidate);
    reviewAssert(isWithin(realRoot, realCandidate), `binding ${key} resolves outside repository root`);
    const bytes = await fs.readFile(realCandidate);
    const actual = crypto.createHash('sha256').update(bytes).digest('hex');
    reviewAssert(actual === binding.sha256, `binding ${key} sha256 mismatch`);
    documents[key] = JSON.parse(bytes.toString('utf8'));
  }
  return documents;
}

export function buildRealModelCandidateReview({ mapping, inventory, profile, liveEvidence, manifest }) {
  reviewAssert(mapping?.authority?.mutation_authorized === false, 'semantic mapping cannot authorize mutation');
  reviewAssert(mapping?.authority?.approval_token_issued === false, 'semantic mapping cannot issue approval tokens');
  reviewAssert(mapping?.authority?.execution_policy_changed === false, 'semantic mapping cannot change execution policy');
  reviewAssert(Array.isArray(inventory?.candidates), 'candidate inventory is missing');
  reviewAssert(Array.isArray(profile?.profiles), 'candidate profile is missing');
  reviewAssert(Array.isArray(liveEvidence?.cases), 'candidate live evidence is missing');
  reviewAssert(Array.isArray(manifest?.cases) && manifest.cases.length === 7, 'formal reliability manifest must contain seven cases');
  reviewAssert(profile?.inventory?.sha256 === `sha256:${mapping.bindings.inventory.sha256}`, 'profile inventory binding mismatch');
  reviewAssert(liveEvidence?.artifacts?.inventory_sha256 === mapping.bindings.inventory.sha256, 'live evidence inventory binding mismatch');
  reviewAssert(liveEvidence?.artifacts?.profile_sha256 === mapping.bindings.profile.sha256, 'live evidence profile binding mismatch');

  const inventoryById = uniqueMap(inventory.candidates, 'candidate_id', 'inventory candidate');
  const profileById = uniqueMap(profile.profiles, 'candidate_id', 'profile candidate');
  const liveById = uniqueMap(liveEvidence.cases, 'candidate_id', 'live evidence candidate');
  const manifestById = uniqueMap(manifest.cases, 'id', 'formal case');
  const mappingById = uniqueMap(mapping.mappings, 'candidate_id', 'semantic mapping candidate');
  reviewAssert(mappingById.size === inventoryById.size, 'every inventoried candidate must have exactly one semantic mapping');

  for (const [candidateId, mapped] of mappingById) {
    const inventoried = inventoryById.get(candidateId);
    const profiled = profileById.get(candidateId);
    const live = liveById.get(candidateId);
    reviewAssert(inventoried && profiled && live, `semantic mapping references unknown candidate ${candidateId}`);
    reviewAssert(profiled.status === 'profiled' && live.status === 'profiled', `candidate ${candidateId} lacks a successful live profile`);
    reviewAssert(mapped.candidate_handle === inventoried.candidate_handle, `candidate ${candidateId} handle mismatch`);
    reviewAssert(mapped.source_sha256 === inventoried.source.sha256, `candidate ${candidateId} source sha256 mismatch`);
    reviewAssert(mapped.source_sha256 === profiled.source_sha256 && mapped.source_sha256 === live.source_sha256, `candidate ${candidateId} evidence sha256 mismatch`);
    reviewAssert(mapped.source_label === inventoried.source.relative_path, `candidate ${candidateId} source label mismatch`);
    const assignmentIds = new Set();
    for (const assignment of mapped.assignments) {
      reviewAssert(manifestById.has(assignment.case_id), `candidate ${candidateId} references unknown case ${assignment.case_id}`);
      reviewAssert(!assignmentIds.has(assignment.case_id), `candidate ${candidateId} repeats case ${assignment.case_id}`);
      assignmentIds.add(assignment.case_id);
    }
  }
  for (const candidateId of inventoryById.keys()) reviewAssert(mappingById.has(candidateId), `candidate ${candidateId} has no semantic mapping`);

  const caseReviews = manifest.cases.map((corpusCase) => {
    const mappedCandidates = [];
    const structures = [];
    for (const mapped of mapping.mappings) {
      const assignment = mapped.assignments.find((entry) => entry.case_id === corpusCase.id);
      if (!assignment) continue;
      mappedCandidates.push({
        candidate_id: mapped.candidate_id,
        candidate_handle: mapped.candidate_handle,
        source_sha256: mapped.source_sha256,
        source_label: mapped.source_label,
        role: assignment.role
      });
      structures.push(profileById.get(mapped.candidate_id).structure);
    }
    mappedCandidates.sort(compareMappedCandidates);
    const structuralEvidence = aggregateStructuralEvidence(structures);
    const requiredTargetRoles = requiredRoles(corpusCase);
    const blockers = deriveBlockers(corpusCase, mappedCandidates, structuralEvidence, requiredTargetRoles);
    const baselineBlockers = blockers.filter((entry) => !['formal_sidecar_missing', 'reviewed_target_roles_missing', 'required_material_selection_missing'].includes(entry));
    const status = mappedCandidates.length === 0
      ? 'blocked_missing_semantic_mapping'
      : baselineBlockers.length > 0
        ? 'blocked_missing_baseline_or_probe'
        : 'blocked_missing_formal_sidecar';
    return {
      case_id: corpusCase.id,
      domain: corpusCase.domain,
      status,
      mapped_candidates: mappedCandidates,
      required_target_roles: requiredTargetRoles,
      structural_evidence: structuralEvidence,
      blockers,
      formal_sidecar_ready: false
    };
  });

  const mappedCaseCount = caseReviews.filter((entry) => entry.mapped_candidates.length > 0).length;
  return {
    version: 'real-model-candidate-review-report.v1',
    kind: 'real_model_candidate_review_report',
    generated_on: mapping.created_on,
    evidence_scope: 'user_confirmed_semantics_and_structural_readiness_only',
    bindings: structuredClone(mapping.bindings),
    summary: {
      candidates: inventoryById.size,
      confirmed_candidates: mappingById.size,
      formal_cases: manifest.cases.length,
      semantically_mapped_cases: mappedCaseCount,
      unmapped_cases: manifest.cases.length - mappedCaseCount,
      formal_sidecars_ready: 0,
      formal_sidecars_generated: 0
    },
    case_reviews: caseReviews,
    safety: {
      live_queue_called: false,
      model_mutation_authorized: false,
      model_mutation_performed: false,
      approval_token_issued: false,
      formal_sidecar_auto_generated: false,
      release_acceptance: false
    },
    next_action: {
      action: 'collect_reviewed_target_roles_and_prepare_disposable_formal_fixtures',
      human_input_required: true,
      required_decisions: [...mapping.unresolved]
    }
  };
}

export function renderRealModelCandidateReviewMarkdown(report) {
  const lines = [
    '# Real-model Candidate Review',
    '',
    `Confirmed candidates: ${report.summary.confirmed_candidates}/${report.summary.candidates}. Semantically mapped formal cases: ${report.summary.semantically_mapped_cases}/${report.summary.formal_cases}. Formal sidecars ready: ${report.summary.formal_sidecars_ready}.`,
    '',
    'This report records semantic routing only. It grants no mutation authority, creates no approval token, and does not promote a candidate into the formal live corpus.',
    '',
    '| Formal case | Candidate mapping | Status | Blocking evidence |',
    '| --- | --- | --- | --- |'
  ];
  for (const review of report.case_reviews) {
    const candidates = review.mapped_candidates.length
      ? review.mapped_candidates.map((entry) => `${escapeMarkdown(entry.source_label)} (${entry.role})`).join(', ')
      : 'unmapped';
    lines.push(`| ${review.case_id} | ${candidates} | ${review.status} | ${review.blockers.join(', ')} |`);
  }
  lines.push('', '## Required human decisions', '');
  for (const decision of report.next_action.required_decisions) lines.push(`- ${decision}`);
  lines.push('', 'Cross-version validation remains deferred and is not represented as a pass.', '');
  return lines.join('\n');
}

function deriveBlockers(corpusCase, mappedCandidates, evidence, targetRoles) {
  const blockers = [];
  if (mappedCandidates.length === 0) blockers.push('semantic_mapping_missing');
  blockers.push('formal_sidecar_missing');
  if (targetRoles.length > 0) blockers.push('reviewed_target_roles_missing');
  if (corpusCase.tasks.includes('material_preservation')) {
    blockers.push('required_material_selection_missing');
    if (evidence.materials === 0) blockers.push('material_evidence_absent');
  }
  if (corpusCase.tasks.includes('scene_visibility_preservation') && evidence.scenes === 0) blockers.push('required_scene_evidence_absent');
  if (corpusCase.tasks.includes('uv_material_preservation') && evidence.uv_occurrences === 0) blockers.push('uv_target_evidence_absent');
  if (corpusCase.id === 'appearance-scenes-hidden' && evidence.hidden_occurrences === 0) blockers.push('hidden_target_evidence_absent');
  if (corpusCase.tasks.includes('shared_definition_identity') && evidence.shared_occurrences < 2) blockers.push('shared_occurrence_evidence_absent');
  if (corpusCase.tasks.includes('large_recursive_index') && evidence.profile_sample_truncated) blockers.push('full_recursive_index_not_yet_attested');
  if (corpusCase.tasks.includes('abnormal_topology_detection')) blockers.push('reviewed_topology_probe_missing');
  if (corpusCase.tasks.includes('locked_fail_closed') && evidence.locked_occurrences === 0) blockers.push('locked_target_evidence_absent');
  return [...new Set(blockers)];
}

function requiredRoles(corpusCase) {
  const roles = [];
  if (corpusCase.tasks.includes('boolean_manifold')) roles.push('boolean_target', 'boolean_tool');
  if (corpusCase.tasks.includes('abnormal_topology_detection')) roles.push('repair_target');
  if (corpusCase.tasks.includes('locked_fail_closed')) roles.push('locked_target', 'guard_target', 'transform_target');
  if (corpusCase.tasks.includes('uv_material_preservation')) roles.push('uv_target');
  if (corpusCase.id === 'appearance-scenes-hidden') roles.push('hidden_target');
  return roles;
}

function aggregateStructuralEvidence(structures) {
  const max = (field) => structures.reduce((value, structure) => Math.max(value, Number(structure?.[field] || 0)), 0);
  return {
    materials: max('materials'),
    scenes: max('scenes'),
    hidden_occurrences: max('hidden_occurrences'),
    locked_occurrences: max('locked_occurrences'),
    uv_occurrences: max('uv_occurrences'),
    shared_occurrences: max('shared_occurrence_count'),
    nonuniform_instances: max('nonuniform_instance_occurrences'),
    mirrored_instances: max('mirrored_instance_occurrences'),
    logical_occurrences: max('recursive_total_seen'),
    profile_sample_truncated: structures.some((structure) => structure?.recursive_truncated === true)
  };
}

function uniqueMap(values, key, label) {
  const result = new Map();
  for (const value of values) {
    const id = value?.[key];
    reviewAssert(typeof id === 'string' && id.length > 0, `${label} is missing ${key}`);
    reviewAssert(!result.has(id), `${label} ${id} is duplicated`);
    result.set(id, value);
  }
  return result;
}

function compareMappedCandidates(left, right) {
  const roleOrder = { primary: 0, supporting: 1 };
  return (roleOrder[left.role] - roleOrder[right.role]) || left.candidate_id.localeCompare(right.candidate_id);
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function escapeMarkdown(value) {
  return String(value).replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');
}

function reviewAssert(condition, message) {
  if (!condition) {
    const error = new Error(message);
    error.code = 'REAL_MODEL_CANDIDATE_REVIEW_INVALID';
    throw error;
  }
}
