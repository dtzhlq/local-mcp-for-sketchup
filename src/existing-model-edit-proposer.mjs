import { AgentContractError, markUntrustedData, sha256Canonical } from './agent-contract.mjs';
import { existingModelEditRiskForOperation } from './existing-model-editing.mjs';

export const EXISTING_MODEL_EDIT_PROPOSAL_VERSION = 'existing-model-edit-proposal.v1';

const ACTION_PATTERNS = [
  { op: 'rename', patterns: ['rename', '重命名', '改名'] },
  { op: 'set_material', patterns: ['material', '材质', '颜色'] },
  { op: 'set_visibility', patterns: ['hide', 'show', 'visible', '隐藏', '显示'] },
  { op: 'transform_object', patterns: ['move', 'rotate', 'scale', '移动', '旋转', '缩放'] },
  { op: 'attribute', patterns: ['attribute', 'metadata', '属性', '元数据'] },
  { op: 'delete', patterns: ['delete', 'remove', '删除'] },
  { op: 'pushpull_face', patterns: ['pushpull', 'extrude face', '推拉', '拉伸面'] },
  { op: 'cut_hole', patterns: ['hole', '孔', '开孔'] },
  { op: 'manifold_check', patterns: ['manifold', '实体检查', '流形'] }
];

const STRUCTURAL_GROUP_ACTIONS = new Set([
  'attribute',
  'rename',
  'set_material',
  'set_visibility',
  'transform_object'
]);

export function planExistingModelEditDiscovery({ instruction, target_query, target_ref, action, discovery_mode } = {}) {
  const requestedMode = discovery_mode || 'auto';
  if (!['auto', 'structural_groups', 'full_recursive'].includes(requestedMode)) {
    throw new AgentContractError('INVALID_ARGUMENT', 'discovery_mode must be auto, structural_groups, or full_recursive.');
  }
  if (requestedMode !== 'auto') {
    return {
      mode: requestedMode,
      reason: requestedMode === 'structural_groups' ? 'caller_requested_bounded_group_projection' : 'caller_requested_full_recursive_index'
    };
  }
  const normalizedInstruction = String(instruction || '').trim();
  const operation = action || inferOperation(normalizedInstruction);
  const query = String(target_query || inferTargetQuery(normalizedInstruction, operation) || '').trim();
  if (STRUCTURAL_GROUP_ACTIONS.has(operation) && groupScopedQuery(query)) {
    return { mode: 'structural_groups', reason: 'bounded_group_scope_is_sufficient_for_target_discovery' };
  }
  return { mode: 'full_recursive', reason: 'target_scope_requires_full_recursive_index' };
}

export function proposeExistingModelEdit({ graph, model_key, instruction, target_query, target_ref, action, parameters = {}, shared_policy, limit = 5 } = {}) {
  if (graph?.version !== 'model-graph.v1') throw new Error('proposeExistingModelEdit requires ModelGraph v1');
  if (!/^model_[0-9a-f]{32}$/.test(String(model_key || ''))) throw new AgentContractError('MODEL_IDENTITY_UNAVAILABLE', 'A persisted model_key is required for a bound edit proposal.');
  const normalizedInstruction = requiredString(instruction, 'instruction');
  const normalizedParameters = normalizeProposalParameters(parameters);
  const operation = action || inferOperation(normalizedInstruction);
  if (operation !== null && operation !== undefined && !ACTION_PATTERNS.some((entry) => entry.op === operation)) {
    throw new AgentContractError('INVALID_ARGUMENT', 'action is not supported by the guided existing-model proposal contract.');
  }
  validateProposalParameters(operation, normalizedParameters);
  const query = String(target_query || inferTargetQuery(normalizedInstruction, operation) || '').trim();
  const pool = graph.nodes.filter((node) => node.node_type === 'occurrence'
    && (node.entity_path || node.reference)
    && (node.editable || node.proposal_eligible === true)
    && node.synthetic !== true);
  const explicitMatches = target_ref ? pool.filter((node) => matchesExplicitReference(node, target_ref)) : null;
  const exactExplicitTarget = explicitMatches?.length === 1;
  const coverage = proposalTargetCoverage(graph, {
    operation,
    query,
    targetRef: target_ref,
    explicitMatches: explicitMatches || []
  });
  const ranked = target_ref
    ? rankCandidates(explicitMatches.length ? explicitMatches : pool, {
      query,
      targetRef: explicitMatches.length ? target_ref : null,
      operation,
      instruction: normalizedInstruction
    })
    : rankCandidates(pool, { query, targetRef: null, operation, instruction: normalizedInstruction });
  const candidates = ranked.slice(0, Math.max(1, Math.min(Number(limit) || 5, 20))).map((item) => proposalCandidate(item));
  const exclusions = ranked.slice(candidates.length, candidates.length + 10).map((item) => ({
    node_id: item.node.node_id,
    persistent_ref: persistentRefForNode(item.node),
    entity_path: item.node.entity_path || null,
    reason: item.allowed ? 'lower_evidence_score' : `operation_not_allowed:${operation || 'unknown'}`
  }));
  const explicitCandidate = exactExplicitTarget ? ranked[0] : null;
  const top = target_ref ? (explicitCandidate?.allowed ? explicitCandidate : null) : (ranked.find((item) => item.allowed) || null);
  const confidenceCandidate = explicitCandidate || top;
  const second = target_ref ? null : (ranked.filter((item) => item.allowed)[1] || null);
  const blockedDeterministicTarget = target_ref
    ? null
    : (ranked.find((item) => item.deterministic_target_status === 'blocked') || null);
  const unresolvedDeterministicTie = !target_ref
    && ranked.some((item) => item.deterministic_target_status === 'ambiguous_tie');
  const deterministicResolution = hasDeterministicResolution(top);
  const missingParameters = requiredParameters(operation).filter((field) => normalizedParameters[field] === undefined);
  const sharedDecision = sharedPolicyFor(confidenceCandidate?.node, shared_policy, normalizedInstruction);
  const ambiguityReasons = [];
  if (!coverage.sufficient_for_proposal) ambiguityReasons.push(coverage.blocker);
  if (!operation) ambiguityReasons.push('operation_not_understood');
  if (!query && !target_ref) ambiguityReasons.push('target_description_missing');
  if (target_ref && explicitMatches.length === 0) ambiguityReasons.push('explicit_target_not_found');
  if (target_ref && explicitMatches.length > 1) ambiguityReasons.push('explicit_target_ambiguous');
  if (exactExplicitTarget && explicitCandidate?.node.effective_locked) ambiguityReasons.push('target_locked');
  if (exactExplicitTarget && operation && !explicitCandidate?.allowed && !explicitCandidate?.node.effective_locked) ambiguityReasons.push('operation_not_allowed_for_target');
  if (blockedDeterministicTarget?.node.effective_locked) ambiguityReasons.push('target_locked');
  if (blockedDeterministicTarget && !blockedDeterministicTarget.node.effective_locked) ambiguityReasons.push('operation_not_allowed_for_target');
  if (!target_ref && (!top || top.confidence < 0.68)) ambiguityReasons.push('target_confidence_too_low');
  if (top && second && top.confidence - second.confidence < 0.12 && !target_ref && !deterministicResolution) ambiguityReasons.push('multiple_similar_targets');
  if (unresolvedDeterministicTie && !ambiguityReasons.includes('multiple_similar_targets')) ambiguityReasons.push('multiple_similar_targets');
  if (missingParameters.length) ambiguityReasons.push(`missing_parameters:${missingParameters.join(',')}`);
  if (sharedDecision.requires_clarification) ambiguityReasons.push('shared_definition_policy_required');

  const requiresClarification = ambiguityReasons.length > 0;
  const target = !requiresClarification && top ? targetContract(top.node, sharedDecision.policy) : null;
  const operationProposal = target && operation
    ? { ...structuredClone(normalizedParameters), op: operation, ...target }
    : null;
  const proposalCore = {
    version: EXISTING_MODEL_EDIT_PROPOSAL_VERSION,
    kind: 'existing_model_edit_proposal',
    model_key,
    graph_id: graph.graph_id,
    model_revision: graph.model_revision,
    instruction: markUntrustedData(normalizedInstruction, 'agent_instruction'),
    target_query: markUntrustedData(query, 'agent_target_query'),
    target_resolution: {
      mode: target_ref ? 'explicit_reference' : 'evidence_ranking',
      status: target_ref
        ? (explicitMatches.length === 1 ? 'exact_one' : (explicitMatches.length === 0 ? 'not_found' : 'ambiguous'))
        : (top ? 'ranked_candidate' : 'unresolved'),
      match_count: target_ref ? explicitMatches.length : ranked.filter((item) => item.allowed).length,
      exact_reference_required: Boolean(target_ref),
      fallback_selection_allowed: false,
      ...(graph.projections?.structural_groups ? { coverage } : {})
    },
    requested_action: operation,
    candidates,
    exclusions,
    selected_targets: target ? [target] : [],
    operation_proposal: operationProposal ? [operationProposal] : [],
    shared_definition_policy: sharedDecision,
    risk_level: operation ? existingModelEditRiskForOperation(operation) : null,
    confidence: confidenceCandidate?.confidence || 0,
    requires_clarification: requiresClarification,
    ambiguity_reasons: ambiguityReasons,
    execution_allowed: false,
    execution_route: 'trusted_reviewed_existing_model_edit_only'
  };
  const proposalId = sha256Canonical(proposalCore).slice(7, 31);
  const proposalHash = sha256Canonical(proposalCore);
  return {
    ...proposalCore,
    proposal_id: `edit-proposal-${proposalId}`,
    proposal_hash: proposalHash,
    clarification: requiresClarification ? clarificationFor(ambiguityReasons, candidates, missingParameters) : null,
    next_action: requiresClarification
      ? { action: 'submit_task_input', required: clarificationFields(ambiguityReasons, missingParameters) }
      : {
        action: 'start_reviewed_existing_model_edit',
        tool: 'start_agent_task',
        arguments: {
          intent: 'reviewed_existing_model_edit',
          instruction: normalizedInstruction,
          interface_level: 'guided',
          inputs: { runtime: 'mock', targets: [target], operations: [operationProposal] }
        }
      }
  };
}

function normalizeProposalParameters(parameters) {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw new AgentContractError('INVALID_ARGUMENT', 'proposal parameters must be an object.');
  }
  const reserved = new Set([
    'op', 'target_id', 'targetId', 'object_id', 'objectId', 'entity_path', 'entityPath',
    'target_path', 'targetPath', 'targets', 'tools', 'edit_scope', 'editScope',
    'instance_policy', 'instancePolicy', 'instance_id', 'instanceId', 'confirmed', 'review'
  ]);
  const conflicts = Object.keys(parameters).filter((key) => reserved.has(key));
  if (conflicts.length) {
    throw new AgentContractError('INVALID_ARGUMENT', 'proposal parameters cannot override server-selected operation routing.', {
      details: { reserved_fields: conflicts.sort() }
    });
  }
  return structuredClone(parameters);
}

function validateProposalParameters(operation, parameters) {
  if (!operation) return;
  const allowedByOperation = {
    rename: ['new_name'],
    set_material: ['material', 'side'],
    set_visibility: ['visible'],
    transform_object: ['transform'],
    attribute: ['dictionary', 'key', 'value'],
    delete: [],
    pushpull_face: ['distance'],
    cut_hole: ['center', 'radius', 'segments', 'feature_id'],
    manifold_check: ['check_id', 'fail_on_non_manifold']
  };
  const allowed = new Set(allowedByOperation[operation] || []);
  const unexpected = Object.keys(parameters).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw new AgentContractError('INVALID_ARGUMENT', `parameters contains unsupported fields for ${operation}.`, {
      details: { unsupported_fields: unexpected.sort(), allowed_fields: [...allowed].sort() }
    });
  }
  const present = (key) => Object.hasOwn(parameters, key);
  const nonEmpty = (key) => typeof parameters[key] === 'string' && parameters[key].trim();
  if (operation === 'rename' && present('new_name') && !nonEmpty('new_name')) invalidParameter('new_name', 'a non-empty string');
  if (operation === 'set_material') {
    if (present('material') && !nonEmpty('material')) invalidParameter('material', 'a non-empty string');
    if (present('side') && !['front', 'back', 'both'].includes(parameters.side)) invalidParameter('side', 'front, back, or both');
  }
  if (operation === 'set_visibility' && present('visible') && typeof parameters.visible !== 'boolean') invalidParameter('visible', 'a boolean');
  if (operation === 'transform_object' && present('transform') && (!isPlainObject(parameters.transform) || !Object.keys(parameters.transform).length)) invalidParameter('transform', 'a non-empty object');
  if (operation === 'attribute') {
    if (present('dictionary') && !nonEmpty('dictionary')) invalidParameter('dictionary', 'a non-empty string');
    if (present('key') && !nonEmpty('key')) invalidParameter('key', 'a non-empty string');
    if (present('value') && !isJsonValue(parameters.value)) invalidParameter('value', 'a JSON value');
  }
  if (operation === 'pushpull_face' && present('distance') && (!Number.isFinite(parameters.distance) || parameters.distance === 0)) invalidParameter('distance', 'a finite non-zero number');
  if (operation === 'cut_hole') {
    if (present('center') && (!Array.isArray(parameters.center) || ![2, 3].includes(parameters.center.length) || !parameters.center.every(Number.isFinite))) invalidParameter('center', 'a finite 2D or 3D coordinate array');
    if (present('radius') && (!Number.isFinite(parameters.radius) || parameters.radius <= 0)) invalidParameter('radius', 'a positive finite number');
    if (present('segments') && (!Number.isInteger(parameters.segments) || parameters.segments < 3)) invalidParameter('segments', 'an integer of at least 3');
    if (present('feature_id') && !nonEmpty('feature_id')) invalidParameter('feature_id', 'a non-empty string');
  }
  if (operation === 'manifold_check') {
    if (present('check_id') && !nonEmpty('check_id')) invalidParameter('check_id', 'a non-empty string');
    if (present('fail_on_non_manifold') && typeof parameters.fail_on_non_manifold !== 'boolean') invalidParameter('fail_on_non_manifold', 'a boolean');
  }
}

function invalidParameter(field, expected) {
  throw new AgentContractError('INVALID_ARGUMENT', `parameters.${field} must be ${expected}.`);
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isJsonValue(value) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isPlainObject(value) && Object.entries(value).every(([key, item]) => typeof key === 'string' && isJsonValue(item));
}

function rankCandidates(nodes, { query, targetRef, operation, instruction }) {
  const tokens = queryTokens(query);
  const semantic = semanticHints(`${query} ${instruction}`);
  const structural = structuralHints(`${query} ${instruction}`);
  let scored = nodes.map((node) => {
    const textFields = [node.name, node.kind, node.definition_name, node.material, node.tag, stringifyClassification(node.classification), node.reference].filter(Boolean).map((value) => String(value).toLowerCase());
    const joined = textFields.join(' ');
    const evidence = [];
    let score = 0;
    let trustedTieScore = 0;
    if (node.projection_source === 'structural-groups.v1') {
      evidence.push({
        kind: 'bounded_structural_group_projection',
        version: 'structural-groups.v1',
        coordinate_space: node.spatial_summary?.coordinate_space || null,
        leaf_entities_materialized: false,
        trust: 'server_model_structure'
      });
    }
    if (targetRef && matchesExplicitReference(node, targetRef)) {
      score = 1;
      evidence.push({ kind: 'explicit_reference', value: structuredClone(targetRef), trust: 'server_reference' });
    } else {
      if (query && textFields.some((field) => field === query.toLowerCase())) {
        score += 0.72;
        evidence.push({ kind: 'exact_text_match', field: matchingField(node, query), trust: 'untrusted_model_data' });
      }
      for (const token of tokens) {
        if (joined.includes(token)) {
          score += 0.18;
          evidence.push({ kind: 'text_token_match', token, trust: 'untrusted_model_data' });
        }
      }
      if (semantic.some((hint) => joined.includes(hint))) {
        score += 0.24;
        evidence.push({ kind: 'semantic_hint_match', hints: semantic, trust: 'untrusted_model_data' });
      }
      if (matchesStructuralHint(node, structural)) {
        score += 0.32;
        trustedTieScore += 0.32;
        evidence.push({
          kind: 'trusted_topology_match',
          predicate: structural.geometry,
          topology: topologyCounts(node),
          trust: 'server_model_structure'
        });
      }
      if (!tokens.length && !semantic.length) score += 0.1;
    }
    const operationSupported = Boolean(operation && node.allowed_operations.includes(operation));
    if (operationSupported) trustedTieScore += 0.12;
    if (operationSupported && ['group', 'component_instance'].includes(node.entity_type) && !faceOrEdgeSpecific(operation)) {
      trustedTieScore += 0.22;
    }
    const relevanceScore = score
      + (operationSupported ? 0.12 : (operation ? -0.35 : 0))
      + (operationSupported && ['group', 'component_instance'].includes(node.entity_type) && !faceOrEdgeSpecific(operation) ? 0.22 : 0);
    const allowed = Boolean(operationSupported && node.effective_locked !== true);
    if (allowed) score += 0.12;
    else if (operation) score -= 0.35;
    if (allowed && ['group', 'component_instance'].includes(node.entity_type) && !faceOrEdgeSpecific(operation)) {
      score += 0.22;
      evidence.push({ kind: 'object_scope_preferred', trust: 'server_contract' });
    }
    return { node, score, relevanceScore, trustedTieScore, operationSupported, allowed, evidence };
  });

  const deterministic = deterministicRanking(query, structural);
  if (deterministic && !targetRef) {
    const relevanceFloor = tokens.length || semantic.length ? 0.45 : 0.05;
    const relevant = scored.filter((item) => item.operationSupported
      && item.relevanceScore >= relevanceFloor
      && (!deterministic.qualifies || deterministic.qualifies(item.node)));
    const ordered = [...relevant].sort((left, right) => deterministic.compare(left.node, right.node) || right.trustedTieScore - left.trustedTieScore || left.node.node_id.localeCompare(right.node.node_id));
    const metricTie = ordered[0] && ordered[1] && deterministic.compare(ordered[0].node, ordered[1].node) === 0;
    const trustedTieResolved = metricTie && ordered[0].trustedTieScore - ordered[1].trustedTieScore >= 0.12;
    const uniquelyRanked = ordered[0] && (!ordered[1] || !metricTie || trustedTieResolved);
    if (metricTie && !trustedTieResolved) {
      for (const item of ordered.filter((entry) => deterministic.compare(ordered[0].node, entry.node) === 0)) {
        item.deterministic_target_status = 'ambiguous_tie';
      }
    }
    if (uniquelyRanked) {
      ordered[0].score = Math.max(ordered[0].score, 0.86);
      ordered[0].deterministic_target_status = ordered[0].allowed ? 'eligible' : 'blocked';
      ordered[0].evidence.push({
        kind: deterministic.evidence_kind,
        strategy: deterministic.strategy,
        ...(trustedTieResolved ? { tie_breaker: 'trusted_server_evidence' } : {}),
        trust: deterministic.trust
      });
      if (!ordered[0].allowed) {
        ordered[0].evidence.push({
          kind: 'deterministic_target_operation_blocked',
          reason: ordered[0].node.effective_locked ? 'target_locked' : 'operation_not_allowed_for_target',
          trust: 'server_contract'
        });
      }
    }
  }
  scored = scored.map((item) => ({ ...item, confidence: clamp(round(item.score), 0, 1) }));
  return scored.sort((left, right) => right.confidence - left.confidence || left.node.node_id.localeCompare(right.node.node_id));
}

function proposalCandidate(item) {
  return {
    node_id: item.node.node_id,
    persistent_ref: persistentRefForNode(item.node),
    entity_path: item.node.entity_path || null,
    entity_type: item.node.entity_type,
    confidence: item.confidence,
    allowed_for_operation: item.allowed,
    evidence: item.evidence,
    effective_locked: item.node.effective_locked === true,
    locked_ancestor_path: item.node.locked_ancestor_path || null,
    shared_definition: item.node.shared_definition,
    affected_instance_count: item.node.affected_instance_count,
    summary: markUntrustedData({
      name: item.node.name,
      kind: item.node.kind,
      definition_name: item.node.definition_name,
      material: item.node.material,
      tag: item.node.tag,
      bounding_box: item.node.bounding_box
    }, 'sketchup_model_entity')
  };
}

function targetContract(node, sharedPolicy) {
  if (!node.entity_path || node.edit_scope === 'top_level') {
    return {
      target_id: node.reference || node.persistent_id || node.name,
      edit_scope: 'top_level'
    };
  }
  return {
    entity_path: node.entity_path,
    edit_scope: 'instance_path',
    instance_policy: sharedPolicy || 'definition_wide',
    ...(sharedPolicy === 'make_unique' ? { instance_id: rootInstanceReference(node.entity_path) } : {})
  };
}

function persistentRefForNode(node) {
  return node.entity_path && node.edit_scope !== 'top_level'
    ? { entity_path: node.entity_path }
    : { target_id: node.reference || node.persistent_id || node.name };
}

function matchesExplicitReference(node, targetRef) {
  if (typeof targetRef === 'string' || typeof targetRef === 'number') {
    const normalized = String(targetRef);
    return [node.node_id, node.entity_path, node.reference, node.persistent_id, node.name]
      .filter((value) => value !== undefined && value !== null)
      .some((value) => String(value) === normalized);
  }
  if (!targetRef || typeof targetRef !== 'object') return false;
  const entityPath = targetRef.entity_path || targetRef.entityPath;
  const targetId = targetRef.node_id || targetRef.nodeId || targetRef.target_id || targetRef.targetId || targetRef.id || targetRef.reference;
  if (entityPath) return String(node.entity_path) === String(entityPath);
  if (targetId === undefined || targetId === null || targetId === '') return false;
  const normalized = String(targetId);
  return [node.node_id, node.reference, node.persistent_id, node.name]
    .filter((value) => value !== undefined && value !== null)
    .some((value) => String(value) === normalized);
}

function sharedPolicyFor(node, requested, instruction) {
  const normalized = String(requested || '').trim();
  if (normalized && !['definition_wide', 'make_unique'].includes(normalized)) {
    throw new AgentContractError('INVALID_ARGUMENT', 'shared_policy must be definition_wide or make_unique.');
  }
  if (!node?.shared_definition) return { required: false, policy: normalized || 'definition_wide', affected_instance_count: node?.affected_instance_count || 1, requires_clarification: false };
  if (['definition_wide', 'make_unique'].includes(normalized)) {
    return { required: true, policy: normalized, affected_instance_count: node.affected_instance_count, requires_clarification: false };
  }
  if (containsAny(instruction, ['all occurrences', 'every instance', '全部实例', '所有实例'])) {
    return { required: true, policy: 'definition_wide', affected_instance_count: node.affected_instance_count, requires_clarification: false };
  }
  return {
    required: true,
    policy: null,
    recommended: 'make_unique',
    affected_instance_count: node.affected_instance_count,
    requires_clarification: true,
    reason: 'The target belongs to a shared definition; the user must choose one occurrence or all occurrences.'
  };
}

function proposalTargetCoverage(graph, { operation, query, explicitMatches }) {
  const fullModelGraphComplete = graph.completeness?.complete === true;
  const structural = graph.projections?.structural_groups || null;
  if (fullModelGraphComplete) {
    return {
      mode: 'full_recursive_model_graph',
      sufficient_for_proposal: true,
      full_model_graph_complete: true,
      structural_groups_complete: structural?.complete === true,
      eligible_entity_types: ['group', 'component_instance', 'face', 'edge'],
      leaf_entities_materialized: true,
      blocker: null
    };
  }
  if (!structural) {
    return {
      mode: 'incomplete_model_graph',
      sufficient_for_proposal: false,
      full_model_graph_complete: false,
      structural_groups_complete: false,
      eligible_entity_types: [],
      leaf_entities_materialized: false,
      blocker: 'model_graph_incomplete'
    };
  }
  const groupOperation = STRUCTURAL_GROUP_ACTIONS.has(operation);
  const exactProjectedGroup = explicitMatches.length === 1
    && explicitMatches[0].projection_source === 'structural-groups.v1'
    && explicitMatches[0].entity_type === 'group';
  if (groupOperation && exactProjectedGroup) {
    return structuralCoverage('exact_structural_group_reference', true, structural, null);
  }
  if (groupOperation && groupScopedQuery(query) && structural.complete === true) {
    return structuralCoverage('complete_structural_group_projection', true, structural, null);
  }
  if (groupOperation && groupScopedQuery(query)) {
    return structuralCoverage('incomplete_structural_group_projection', false, structural, 'target_projection_incomplete');
  }
  return structuralCoverage('structural_group_scope_mismatch', false, structural, 'target_projection_scope_mismatch');
}

function structuralCoverage(mode, sufficient, structural, blocker) {
  return {
    mode,
    sufficient_for_proposal: sufficient,
    full_model_graph_complete: false,
    structural_groups_complete: structural.complete === true,
    eligible_entity_types: ['group'],
    leaf_entities_materialized: false,
    blocker
  };
}

function groupScopedQuery(value) {
  const text = String(value || '').toLowerCase();
  if (!text || /\bcomponents?\b/.test(text) || text.includes('组件')) return false;
  return /\bgroups?\b/.test(text) || text.includes('群组') || text.includes('群組') || text.includes('组');
}

function inferOperation(instruction) {
  return ACTION_PATTERNS.find((entry) => containsAny(instruction, entry.patterns))?.op || null;
}

function inferTargetQuery(instruction, operation) {
  let value = String(instruction || '').toLowerCase();
  for (const entry of ACTION_PATTERNS) for (const pattern of entry.patterns) value = value.replaceAll(pattern.toLowerCase(), ' ');
  value = value
    .replace(/\b(to|with|using|by|please|the|a|an|one|all|make|set)\b/g, ' ')
    .replace(/[请把将用为设成一个全部]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return operation ? value : '';
}

function queryTokens(query) {
  const stop = new Set(['the', 'a', 'an', 'one', 'all', 'current', 'existing', 'model', 'object', 'component', 'largest', 'smallest', 'left', 'right', 'front', 'back', 'top', 'bottom']);
  return String(query || '').toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter((token) => token.length > 1 && !stop.has(token));
}

function semanticHints(value) {
  const text = String(value || '').toLowerCase();
  const groups = [
    ['wall', '墙'], ['door', '门'], ['window', '窗'], ['cabinet', '柜'], ['chair', '椅'], ['table', '桌'],
    ['body', 'shell', '壳体', '机身'], ['button', '按钮'], ['panel', '面板'], ['face', '面'], ['edge', '边'], ['leaf', '叶片']
  ];
  return groups.find((group) => group.some((term) => text.includes(term))) || [];
}

function structuralHints(value) {
  const text = String(value || '').toLowerCase();
  const geometryBearing = [
    'geometry-bearing', 'geometry bearing', 'contains geometry', 'with geometry',
    '包含几何', '含几何', '带几何'
  ];
  const emptyWrapper = [
    'empty wrapper', 'geometry-free wrapper', 'wrapper without geometry',
    '空包装组', '空壳组', '无几何包装组'
  ];
  return {
    geometry: containsAny(text, geometryBearing)
      ? 'geometry_bearing'
      : (containsAny(text, emptyWrapper) ? 'geometry_free' : null)
  };
}

function matchesStructuralHint(node, structural) {
  if (!structural?.geometry) return false;
  const count = topologyCount(node);
  return structural.geometry === 'geometry_bearing' ? count > 0 : count === 0;
}

function requiredParameters(operation) {
  return {
    rename: ['new_name'],
    set_material: ['material'],
    set_visibility: ['visible'],
    transform_object: ['transform'],
    attribute: ['dictionary', 'key', 'value'],
    pushpull_face: ['distance'],
    cut_hole: ['center', 'radius']
  }[operation] || [];
}

function faceOrEdgeSpecific(operation) {
  return ['set_face_material', 'reverse_face', 'pushpull_face', 'set_edge_properties'].includes(operation);
}

function clarificationFor(reasons, candidates, missingParameters) {
  if (reasons.includes('target_projection_incomplete')) return { question: 'The bounded structural Group projection was truncated. Supply an exact current Group entity_path, narrow the Group query, or explicitly request full_recursive discovery.', required_action: 'narrow_or_choose_full_recursive_discovery' };
  if (reasons.includes('target_projection_scope_mismatch')) return { question: 'The bounded projection covers Group occurrences only. Supply an exact Group reference or explicitly request full_recursive discovery for another entity type.', required_action: 'choose_group_or_full_recursive_discovery' };
  if (reasons.includes('model_graph_incomplete')) return { question: 'The recursive model index is incomplete. Rebuild the proposal with a sufficient recursive_limit before choosing a target.', required_action: 'rebuild_complete_model_graph' };
  if (reasons.includes('operation_not_understood')) return { question: 'What change should be proposed?', choices: ACTION_PATTERNS.map((entry) => entry.op) };
  if (reasons.includes('explicit_target_not_found')) return { question: 'The supplied target reference does not exist in this model revision. Supply a current exact target reference.', choices: candidates.map((item) => ({ persistent_ref: item.persistent_ref, confidence: item.confidence, summary: item.summary })) };
  if (reasons.includes('explicit_target_ambiguous')) return { question: 'The supplied target reference matches more than one occurrence. Supply an exact entity_path or node_id.', choices: candidates.map((item) => ({ persistent_ref: item.persistent_ref, confidence: item.confidence, summary: item.summary })) };
  if (reasons.includes('target_locked')) return { question: 'The exact target is locked. Unlock it explicitly in SketchUp or choose another target.', required_action: 'unlock_or_choose_target' };
  if (reasons.includes('operation_not_allowed_for_target')) return { question: 'The requested operation is not allowed for the exact target type.', required_action: 'choose_supported_operation_or_target' };
  if (reasons.includes('multiple_similar_targets')) return { question: 'Which candidate is the intended target?', choices: candidates.map((item) => ({ persistent_ref: item.persistent_ref, confidence: item.confidence, summary: item.summary })) };
  if (reasons.includes('shared_definition_policy_required')) return { question: 'Should the edit affect only this occurrence or every occurrence of the shared definition?', choices: ['make_unique', 'definition_wide'] };
  if (missingParameters.length) return { question: 'Required operation parameters are missing.', required_parameters: missingParameters };
  return { question: 'Please provide a more specific target reference or description.', choices: candidates };
}

function clarificationFields(reasons, missingParameters) {
  const fields = [];
  if (reasons.some((reason) => ['target_projection_incomplete', 'target_projection_scope_mismatch'].includes(reason))) {
    fields.push('target_ref_or_target_query', 'discovery_mode');
  }
  if (reasons.includes('model_graph_incomplete')) fields.push('recursive_limit');
  if (reasons.includes('operation_not_understood')) fields.push('action');
  if (reasons.some((reason) => ['target_description_missing', 'target_confidence_too_low', 'multiple_similar_targets', 'explicit_target_not_found', 'explicit_target_ambiguous', 'target_locked'].includes(reason))) fields.push('target_ref_or_target_query');
  if (reasons.includes('shared_definition_policy_required')) fields.push('shared_policy');
  fields.push(...missingParameters.map((field) => `parameters.${field}`));
  return [...new Set(fields)];
}

function deterministicRanking(query, structural = structuralHints(query)) {
  const text = String(query || '').toLowerCase();
  const qualifies = structural?.geometry ? (node) => matchesStructuralHint(node, structural) : null;
  if (containsAny(text, ['deepest', 'innermost', 'inner-most', '最深', '最内层'])) {
    return structuralRanking('deepest', (left, right) => pathDepth(right) - pathDepth(left), qualifies);
  }
  if (containsAny(text, ['outermost', 'outer-most', 'top-level', 'root group', '最外层', '顶层组', '根组'])) {
    return structuralRanking('outermost', (left, right) => pathDepth(left) - pathDepth(right), qualifies);
  }
  if (containsAny(text, ['largest', 'biggest', '最大'])) return spatialRanking('largest', (left, right) => volume(right) - volume(left), qualifies);
  if (containsAny(text, ['smallest', '最小'])) return spatialRanking('smallest', (left, right) => volume(left) - volume(right), qualifies);
  const directions = [
    { terms: ['left', '左'], axis: 0, order: 1, strategy: 'left' },
    { terms: ['right', '右'], axis: 0, order: -1, strategy: 'right' },
    { terms: ['front', '前'], axis: 1, order: 1, strategy: 'front' },
    { terms: ['back', 'rear', '后'], axis: 1, order: -1, strategy: 'back' },
    { terms: ['bottom', '下'], axis: 2, order: 1, strategy: 'bottom' },
    { terms: ['top', '上'], axis: 2, order: -1, strategy: 'top' }
  ];
  const selected = directions.find((entry) => containsAny(text, entry.terms));
  if (selected) {
    return spatialRanking(
      selected.strategy,
      (left, right) => selected.order * (center(left)[selected.axis] - center(right)[selected.axis]),
      qualifies
    );
  }
  if (qualifies) return structuralRanking(structural.geometry, () => 0, qualifies);
  return null;
}

function spatialRanking(strategy, compare, qualifies) {
  return { strategy, compare, qualifies, evidence_kind: 'deterministic_spatial_ranking', trust: 'server_geometry' };
}

function structuralRanking(strategy, compare, qualifies) {
  return { strategy, compare, qualifies, evidence_kind: 'deterministic_structural_ranking', trust: 'server_model_structure' };
}

function hasDeterministicResolution(item) {
  return Boolean(item?.evidence?.some((entry) => [
    'deterministic_spatial_ranking',
    'deterministic_structural_ranking'
  ].includes(entry.kind)));
}

function matchingField(node, query) {
  const normalized = String(query).toLowerCase();
  return ['name', 'kind', 'definition_name', 'material', 'tag', 'reference'].find((field) => String(node[field] || '').toLowerCase() === normalized) || 'text';
}

function stringifyClassification(value) {
  return value ? JSON.stringify(value) : '';
}

function rootInstanceReference(entityPath) {
  if (String(entityPath).startsWith('pid:')) return String(entityPath).slice(4).split('.')[0];
  const first = String(entityPath).split('/')[0];
  const encoded = first.split(':').at(-1);
  try { return Buffer.from(encoded, 'base64url').toString('utf8'); } catch { return encoded; }
}

function volume(node) {
  return node.spatial_summary?.volume || 0;
}

function center(node) {
  return node.spatial_summary?.center || [0, 0, 0];
}

function topologyCounts(node) {
  return {
    faces: finiteCount(node.topology_summary?.faces),
    edges: finiteCount(node.topology_summary?.edges),
    vertices: finiteCount(node.topology_summary?.vertices)
  };
}

function topologyCount(node) {
  return Object.values(topologyCounts(node)).reduce((sum, value) => sum + value, 0);
}

function finiteCount(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function pathDepth(node) {
  const value = String(node.entity_path || '');
  if (value.startsWith('pid:')) return value.slice(4).split('.').filter(Boolean).length;
  return value.split('/').filter(Boolean).length;
}

function containsAny(value, patterns) {
  const text = String(value || '').toLowerCase();
  return patterns.some((pattern) => text.includes(String(pattern).toLowerCase()));
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}
