import { markUntrustedData, sha256Canonical } from './agent-contract.mjs';
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

export function proposeExistingModelEdit({ graph, instruction, target_query, target_ref, action, parameters = {}, shared_policy, limit = 5 } = {}) {
  if (graph?.version !== 'model-graph.v1') throw new Error('proposeExistingModelEdit requires ModelGraph v1');
  const normalizedInstruction = requiredString(instruction, 'instruction');
  const operation = action || inferOperation(normalizedInstruction);
  const query = String(target_query || inferTargetQuery(normalizedInstruction, operation) || '').trim();
  const pool = graph.nodes.filter((node) => node.node_type === 'occurrence' && (node.entity_path || node.reference) && node.editable && node.synthetic !== true);
  const ranked = rankCandidates(pool, { query, targetRef: target_ref, operation, instruction: normalizedInstruction });
  const candidates = ranked.slice(0, Math.max(1, Math.min(Number(limit) || 5, 20))).map((item) => proposalCandidate(item));
  const exclusions = ranked.slice(candidates.length, candidates.length + 10).map((item) => ({
    node_id: item.node.node_id,
    persistent_ref: persistentRefForNode(item.node),
    entity_path: item.node.entity_path || null,
    reason: item.allowed ? 'lower_evidence_score' : `operation_not_allowed:${operation || 'unknown'}`
  }));
  const top = ranked.find((item) => item.allowed) || null;
  const second = ranked.filter((item) => item.allowed)[1] || null;
  const missingParameters = requiredParameters(operation).filter((field) => parameters[field] === undefined);
  const sharedDecision = sharedPolicyFor(top?.node, shared_policy, normalizedInstruction);
  const ambiguityReasons = [];
  if (!operation) ambiguityReasons.push('operation_not_understood');
  if (!query && !target_ref) ambiguityReasons.push('target_description_missing');
  if (!top || top.confidence < 0.68) ambiguityReasons.push('target_confidence_too_low');
  if (top && second && top.confidence - second.confidence < 0.12 && !target_ref && !deterministicQuery(query)) ambiguityReasons.push('multiple_similar_targets');
  if (missingParameters.length) ambiguityReasons.push(`missing_parameters:${missingParameters.join(',')}`);
  if (sharedDecision.requires_clarification) ambiguityReasons.push('shared_definition_policy_required');

  const requiresClarification = ambiguityReasons.length > 0;
  const target = !requiresClarification && top ? targetContract(top.node, sharedDecision.policy) : null;
  const operationProposal = target && operation
    ? { op: operation, ...target, ...structuredClone(parameters) }
    : null;
  const proposalCore = {
    version: EXISTING_MODEL_EDIT_PROPOSAL_VERSION,
    kind: 'existing_model_edit_proposal',
    graph_id: graph.graph_id,
    model_revision: graph.model_revision,
    instruction: markUntrustedData(normalizedInstruction, 'agent_instruction'),
    target_query: markUntrustedData(query, 'agent_target_query'),
    requested_action: operation,
    candidates,
    exclusions,
    selected_targets: target ? [target] : [],
    operation_proposal: operationProposal ? [operationProposal] : [],
    shared_definition_policy: sharedDecision,
    risk_level: operation ? existingModelEditRiskForOperation(operation) : null,
    confidence: top?.confidence || 0,
    requires_clarification: requiresClarification,
    ambiguity_reasons: ambiguityReasons,
    execution_allowed: false,
    execution_route: 'trusted_reviewed_existing_model_edit_only'
  };
  const proposalId = sha256Canonical(proposalCore).slice(7, 31);
  return {
    ...proposalCore,
    proposal_id: `edit-proposal-${proposalId}`,
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

function rankCandidates(nodes, { query, targetRef, operation, instruction }) {
  const tokens = queryTokens(query);
  const semantic = semanticHints(`${query} ${instruction}`);
  let scored = nodes.map((node) => {
    const textFields = [node.name, node.kind, node.definition_name, node.material, node.tag, stringifyClassification(node.classification), node.reference].filter(Boolean).map((value) => String(value).toLowerCase());
    const joined = textFields.join(' ');
    const evidence = [];
    let score = 0;
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
      if (!tokens.length && !semantic.length) score += 0.1;
    }
    const allowed = Boolean(operation && node.allowed_operations.includes(operation));
    if (allowed) score += 0.12;
    else if (operation) score -= 0.35;
    if (allowed && ['group', 'component_instance'].includes(node.entity_type) && !faceOrEdgeSpecific(operation)) {
      score += 0.22;
      evidence.push({ kind: 'object_scope_preferred', trust: 'server_contract' });
    }
    return { node, score, allowed, evidence };
  });

  const deterministic = deterministicRanking(query);
  if (deterministic) {
    const relevanceFloor = tokens.length || semantic.length ? 0.45 : 0.05;
    const eligible = scored.filter((item) => item.allowed && item.score >= relevanceFloor);
    const ordered = [...eligible].sort((left, right) => deterministic.compare(left.node, right.node) || right.score - left.score || left.node.node_id.localeCompare(right.node.node_id));
    if (ordered[0]) {
      ordered[0].score = Math.max(ordered[0].score, 0.86);
      ordered[0].evidence.push({ kind: 'deterministic_spatial_ranking', strategy: deterministic.strategy, trust: 'server_geometry' });
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
  if (!node.entity_path) {
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
  return node.entity_path ? { entity_path: node.entity_path } : { target_id: node.reference || node.persistent_id || node.name };
}

function matchesExplicitReference(node, targetRef) {
  if (typeof targetRef === 'string') return [node.node_id, node.entity_path, node.reference, node.persistent_id, node.name].includes(targetRef);
  if (!targetRef || typeof targetRef !== 'object') return false;
  const entityPath = targetRef.entity_path || targetRef.entityPath;
  const targetId = targetRef.target_id || targetRef.targetId || targetRef.id || targetRef.reference;
  return entityPath ? node.entity_path === entityPath : Boolean(targetId && [node.reference, node.persistent_id, node.name].includes(targetId));
}

function sharedPolicyFor(node, requested, instruction) {
  if (!node?.shared_definition) return { required: false, policy: requested || 'definition_wide', affected_instance_count: node?.affected_instance_count || 1, requires_clarification: false };
  const normalized = String(requested || '').trim();
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
  if (reasons.includes('operation_not_understood')) return { question: 'What change should be proposed?', choices: ACTION_PATTERNS.map((entry) => entry.op) };
  if (reasons.includes('multiple_similar_targets')) return { question: 'Which candidate is the intended target?', choices: candidates.map((item) => ({ persistent_ref: item.persistent_ref, confidence: item.confidence, summary: item.summary })) };
  if (reasons.includes('shared_definition_policy_required')) return { question: 'Should the edit affect only this occurrence or every occurrence of the shared definition?', choices: ['make_unique', 'definition_wide'] };
  if (missingParameters.length) return { question: 'Required operation parameters are missing.', required_parameters: missingParameters };
  return { question: 'Please provide a more specific target reference or description.', choices: candidates };
}

function clarificationFields(reasons, missingParameters) {
  const fields = [];
  if (reasons.includes('operation_not_understood')) fields.push('action');
  if (reasons.some((reason) => ['target_description_missing', 'target_confidence_too_low', 'multiple_similar_targets'].includes(reason))) fields.push('target_ref_or_target_query');
  if (reasons.includes('shared_definition_policy_required')) fields.push('shared_policy');
  fields.push(...missingParameters.map((field) => `parameters.${field}`));
  return [...new Set(fields)];
}

function deterministicQuery(query) {
  return Boolean(deterministicRanking(query));
}

function deterministicRanking(query) {
  const text = String(query || '').toLowerCase();
  if (containsAny(text, ['largest', 'biggest', '最大'])) return { strategy: 'largest', compare: (left, right) => volume(right) - volume(left) };
  if (containsAny(text, ['smallest', '最小'])) return { strategy: 'smallest', compare: (left, right) => volume(left) - volume(right) };
  const directions = [
    { terms: ['left', '左'], axis: 0, order: 1, strategy: 'left' },
    { terms: ['right', '右'], axis: 0, order: -1, strategy: 'right' },
    { terms: ['front', '前'], axis: 1, order: 1, strategy: 'front' },
    { terms: ['back', 'rear', '后'], axis: 1, order: -1, strategy: 'back' },
    { terms: ['bottom', '下'], axis: 2, order: 1, strategy: 'bottom' },
    { terms: ['top', '上'], axis: 2, order: -1, strategy: 'top' }
  ];
  const selected = directions.find((entry) => containsAny(text, entry.terms));
  if (!selected) return null;
  return { strategy: selected.strategy, compare: (left, right) => selected.order * (center(left)[selected.axis] - center(right)[selected.axis]) };
}

function matchingField(node, query) {
  const normalized = String(query).toLowerCase();
  return ['name', 'kind', 'definition_name', 'material', 'tag', 'reference'].find((field) => String(node[field] || '').toLowerCase() === normalized) || 'text';
}

function stringifyClassification(value) {
  return value ? JSON.stringify(value) : '';
}

function rootInstanceReference(entityPath) {
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
