const DIRECTION_ALIASES = [
  { key: 'left', patterns: ['left', '左', '左侧'], axis: 0, order: 'asc' },
  { key: 'right', patterns: ['right', '右', '右侧'], axis: 0, order: 'desc' },
  { key: 'front', patterns: ['front', '前', '前侧'], axis: 1, order: 'asc' },
  { key: 'back', patterns: ['back', 'rear', '后', '后侧'], axis: 1, order: 'desc' },
  { key: 'bottom', patterns: ['bottom', 'lower', '下', '下方'], axis: 2, order: 'asc' },
  { key: 'top', patterns: ['top', 'upper', '上', '上方'], axis: 2, order: 'desc' }
];

const SEMANTIC_TERMS = [
  { key: 'glass', patterns: ['glass', '玻璃'], fields: ['name', 'material', 'definition', 'kind'] },
  { key: 'panel', patterns: ['panel', '板', '面板'], fields: ['name', 'definition', 'kind'] },
  { key: 'cabinet', patterns: ['cabinet', '柜', '橱柜'], fields: ['name', 'definition', 'kind'] },
  { key: 'wall', patterns: ['wall', '墙'], fields: ['name', 'kind', 'tag'] },
  { key: 'door', patterns: ['door', '门'], fields: ['name', 'kind', 'definition'] },
  { key: 'window', patterns: ['window', '窗'], fields: ['name', 'kind', 'definition'] },
  { key: 'table', patterns: ['table', '桌'], fields: ['name', 'definition', 'kind'] },
  { key: 'chair', patterns: ['chair', '椅'], fields: ['name', 'definition', 'kind'] }
];

export function resolveTargets({ query, entities = [], selection = [], filters = {}, limit = 10, allowMultiple = false } = {}) {
  const normalizedQuery = String(query || '').trim();
  if (isSelectionQuery(normalizedQuery) || filters.selection === true) {
    return resolutionResult({
      query: normalizedQuery || 'selection',
      strategy: 'selection',
      candidates: selection.map((entity) => candidate(entity, 1, ['current SketchUp selection'])),
      limit,
      allowMultiple
    });
  }

  const requestedRefs = normalizeRequestedRefs(filters.targets ?? filters.target);
  if (requestedRefs.length) {
    return resolutionResult({
      query: normalizedQuery || 'explicit target',
      strategy: 'explicit_reference',
      candidates: requestedRefs.flatMap((reference) => matchExplicitReference(entities, reference)),
      limit,
      allowMultiple
    });
  }

  let pool = filterEntities(entities, filters);
  const reasons = [];
  const semantic = semanticMatcher(normalizedQuery);
  if (semantic) {
    pool = pool.filter((entity) => semanticMatches(entity, semantic));
    reasons.push(`semantic:${semantic.key}`);
  }
  const freeText = freeTextMatcher(normalizedQuery, semantic);
  if (freeText) {
    const freeTextMatches = pool.filter((entity) => entityText(entity).includes(freeText));
    if (freeTextMatches.length) {
      pool = freeTextMatches;
      reasons.push(`text:${freeText}`);
    }
  }

  const ranking = rankingFromQuery(normalizedQuery, filters);
  const sorted = [...pool].sort((left, right) => compareEntities(left, right, ranking));
  const nth = nthFromQuery(normalizedQuery, filters);
  const ranked = nth !== null ? sorted.slice(nth, nth + 1) : sorted;
  const baseConfidence = confidenceFor({ query: normalizedQuery, filters, ranking, semantic, pool: ranked });
  const candidates = ranked.map((entity, index) => candidate(entity, Math.max(0.05, baseConfidence - index * 0.04), [
    ...reasons,
    ranking.reason,
    nth !== null ? `ordinal:${nth + 1}` : null,
    filterReason(filters)
  ].filter(Boolean)));

  return resolutionResult({
    query: normalizedQuery,
    strategy: ranking.strategy,
    candidates,
    limit,
    allowMultiple
  });
}

function resolutionResult({ query, strategy, candidates, limit, allowMultiple }) {
  const limited = candidates.slice(0, limit);
  const top = limited[0] || null;
  const selected = allowMultiple ? limited : (top && top.confidence >= 0.65 ? [top] : []);
  const deterministic = ['explicit_reference', 'selection', 'largest', 'smallest', 'left', 'right', 'front', 'back', 'top', 'bottom'].includes(strategy);
  return {
    kind: 'target_resolution',
    query,
    strategy,
    ok: selected.length > 0,
    requires_confirmation: allowMultiple ? false : !top || top.confidence < 0.65 || (limited.length !== 1 && !deterministic),
    candidate_count: candidates.length,
    candidates: limited,
    selected_targets: selected.map((item) => item.reference),
    selected
  };
}

function candidate(entity, confidence, reasons = []) {
  const reference = {
    id: entity.id || entity.persistent_id || entity.name,
    ...(entity.name ? { name: entity.name } : {})
  };
  return {
    reference,
    confidence: round(confidence),
    reasons,
    entity: entitySummary(entity)
  };
}

function filterEntities(entities, filters = {}) {
  return entities.filter((entity) => {
    if (filters.includeHidden === false && entity.visible === false) return false;
    if (filters.kind && String(entity.kind) !== String(filters.kind)) return false;
    if (filters.material && String(entity.material) !== String(filters.material)) return false;
    if (filters.tag && String(entity.tag) !== String(filters.tag)) return false;
    if (filters.definition && String(entity.definition) !== String(filters.definition)) return false;
    if (filters.name) {
      const regex = safeRegex(filters.name);
      if (!regex.test(entity.name || '')) return false;
    }
    return true;
  });
}

function normalizeRequestedRefs(targets) {
  if (targets === undefined || targets === null) return [];
  const list = Array.isArray(targets) ? targets : [targets];
  return list.map((target) => {
    if (typeof target === 'string') return { id: target, name: target };
    if (!target || typeof target !== 'object') return {};
    return {
      id: target.target_id ?? target.targetId ?? target.id ?? target.object_id ?? target.objectId ?? target.guid,
      name: target.name ?? target.target ?? target.object
    };
  });
}

function matchExplicitReference(entities, reference) {
  const hasId = reference.id !== undefined && reference.id !== null && String(reference.id).trim() !== '';
  const hasName = reference.name !== undefined && reference.name !== null && String(reference.name).trim() !== '';
  if (!hasId && !hasName) return [];
  return entities
    .filter((entity) => {
      const idMatches = hasId && [entity.id, entity.persistent_id].filter(Boolean).includes(String(reference.id));
      const nameMatches = hasName && entity.name === String(reference.name);
      return idMatches || nameMatches;
    })
    .map((entity) => candidate(entity, 1, ['explicit reference']));
}

function rankingFromQuery(query, filters = {}) {
  if (filters.largest === true || containsAny(query, ['largest', 'biggest', '最大', '最大的'])) {
    return { strategy: 'largest', reason: 'largest volume', compare: (a, b) => volume(b) - volume(a) };
  }
  if (filters.smallest === true || containsAny(query, ['smallest', '最小', '最小的'])) {
    return { strategy: 'smallest', reason: 'smallest volume', compare: (a, b) => volume(a) - volume(b) };
  }
  const explicitSide = filters.side ? DIRECTION_ALIASES.find((item) => item.key === filters.side) : null;
  const side = explicitSide || DIRECTION_ALIASES.find((item) => containsAny(query, item.patterns));
  if (side) {
    return {
      strategy: side.key,
      reason: `${side.key} by bbox center`,
      compare: (a, b) => side.order === 'asc'
        ? center(a)[side.axis] - center(b)[side.axis]
        : center(b)[side.axis] - center(a)[side.axis]
    };
  }
  return { strategy: 'text_or_filters', reason: 'stable name order', compare: (a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)) };
}

function compareEntities(left, right, ranking) {
  const compared = ranking.compare(left, right);
  if (Math.abs(compared) > 1e-9) return compared;
  return String(left.name || left.id).localeCompare(String(right.name || right.id));
}

function nthFromQuery(query, filters = {}) {
  const raw = filters.nth ?? filters.index;
  if (raw !== undefined) {
    const number = Number(raw);
    return Number.isInteger(number) && number > 0 ? number - 1 : null;
  }
  const match = /第\s*(\d+)\s*个|(?:^|\s)(\d+)(?:st|nd|rd|th)?(?:\s|$)/i.exec(query);
  if (!match) return null;
  const number = Number(match[1] || match[2]);
  return Number.isInteger(number) && number > 0 ? number - 1 : null;
}

function semanticMatcher(query) {
  return SEMANTIC_TERMS.find((item) => containsAny(query, item.patterns));
}

function semanticMatches(entity, semantic) {
  return semantic.fields.some((field) => String(entity[field] || '').toLowerCase().includes(semantic.key))
    || semantic.patterns.some((pattern) => entityText(entity).includes(String(pattern).toLowerCase()));
}

function freeTextMatcher(query, semantic) {
  const normalized = String(query || '').toLowerCase().trim();
  if (!normalized || semantic || rankingOnlyQuery(normalized)) return null;
  const cleaned = normalized
    .replace(/第\s*\d+\s*个/g, ' ')
    .replace(/\b\d+(st|nd|rd|th)?\b/g, ' ')
    .replace(/\b(largest|biggest|smallest|left|right|front|back|rear|top|bottom|selected|selection)\b/g, ' ')
    .replace(/[当前的选择选中最大最小左右前后上下侧方那个对象组件]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || null;
}

function rankingOnlyQuery(query) {
  const cleaned = String(query || '').toLowerCase()
    .replace(/第\s*\d+\s*个/g, ' ')
    .replace(/\b\d+(st|nd|rd|th)?\b/g, ' ')
    .replace(/\b(largest|biggest|smallest|left|right|front|back|rear|top|bottom|selected|selection|current)\b/g, ' ')
    .replace(/[当前的选择选中最大最小左右前后上下侧方那个对象组件]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length === 0;
}

function isSelectionQuery(query) {
  const normalized = String(query || '').trim().toLowerCase();
  return ['selection', 'selected', 'current selection', '当前选择', '选中', '选中的对象', '当前选中'].includes(normalized);
}

function confidenceFor({ query, filters, ranking, semantic, pool }) {
  if (!pool.length) return 0;
  if (filters.name || filters.material || filters.tag || filters.kind || filters.definition) return 0.9;
  if (semantic) return pool.length === 1 ? 0.9 : 0.74;
  if (ranking.strategy !== 'text_or_filters') return pool.length === 1 ? 0.88 : 0.78;
  if (query) return pool.length === 1 ? 0.86 : 0.65;
  return pool.length === 1 ? 0.7 : 0.45;
}

function filterReason(filters = {}) {
  const active = ['kind', 'material', 'tag', 'definition', 'name'].filter((key) => filters[key]);
  return active.length ? `filters:${active.join(',')}` : null;
}

function entityText(entity) {
  return [entity.id, entity.persistent_id, entity.name, entity.kind, entity.definition, entity.material, entity.tag]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function entitySummary(entity) {
  return {
    id: entity.id,
    persistent_id: entity.persistent_id,
    name: entity.name,
    entity_type: entity.entity_type,
    kind: entity.kind,
    definition: entity.definition,
    material: entity.material,
    tag: entity.tag,
    visible: entity.visible !== false,
    bounding_box: entity.bounding_box,
    volume: round(volume(entity))
  };
}

function volume(entity) {
  const box = entity.bounding_box || {};
  return Math.max(0, box.w ?? (box.max?.[0] - box.min?.[0]) ?? 0)
    * Math.max(0, box.d ?? (box.max?.[1] - box.min?.[1]) ?? 0)
    * Math.max(0, box.h ?? (box.max?.[2] - box.min?.[2]) ?? 0);
}

function center(entity) {
  const box = entity.bounding_box || { min: [0, 0, 0], max: [0, 0, 0] };
  return [0, 1, 2].map((axis) => ((box.min?.[axis] || 0) + (box.max?.[axis] || 0)) / 2);
}

function containsAny(value, patterns) {
  const text = String(value || '').toLowerCase();
  return patterns.some((pattern) => text.includes(String(pattern).toLowerCase()));
}

function safeRegex(value) {
  try {
    return new RegExp(String(value), 'i');
  } catch (_) {
    return new RegExp(escapeRegex(String(value)), 'i');
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}
