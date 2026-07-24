export function mockStructuralPersistentId(item = {}, entityType, ancestorPersistentIds = []) {
  const rawPersistentId = String(item.persistent_id ?? item.persistentId ?? '');
  if (/^[1-9]\d*$/.test(rawPersistentId)) return rawPersistentId;
  return deterministicMockPersistentId([
    ...ancestorPersistentIds.map(String),
    entityType,
    item.id || item.adopted_id || item.name || 'anonymous'
  ].join(':'));
}

export function canonicalMockPidPath(pathSegments) {
  return `pid:${pathSegments.map((item) => typeof item === 'string' ? item : item.persistent_id).join('.')}`;
}

export function parseCanonicalMockPidPath(value) {
  const match = /^pid:([1-9]\d*(?:\.[1-9]\d*)*)$/.exec(String(value || ''));
  if (!match) throw new Error('mock canonical persistent path must use pid:<positive-id>[.<positive-id>...]');
  return match[1].split('.');
}

function deterministicMockPersistentId(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return String((hash % 2_000_000_000) + 1);
}
