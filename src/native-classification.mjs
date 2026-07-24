import crypto from 'node:crypto';

export const NATIVE_CLASSIFICATION_SUMMARY_VERSION = 'sketchup-native-classification-summary.v1';
export const NATIVE_CLASSIFICATION_ENUMERATION_BLOCKER = 'assigned_schema_types_not_enumerable';

export function normalizeClassificationSchemas(value = []) {
  const schemas = Array.isArray(value) ? value : [];
  const normalized = schemas.flatMap((schema) => {
    const name = typeof schema === 'string' ? schema.trim() : String(schema?.name || '').trim();
    if (!name) return [];
    const namespace = typeof schema === 'object' && schema !== null && schema.namespace !== undefined && schema.namespace !== null
      ? String(schema.namespace)
      : null;
    return [{ name, namespace }];
  });
  return [...new Map(normalized.map((schema) => [`${schema.name}\u0000${schema.namespace || ''}`, schema])).values()]
    .sort((left, right) => left.name.localeCompare(right.name) || String(left.namespace || '').localeCompare(String(right.namespace || '')));
}

export function createNativeClassificationSummary({
  classificationSchemas = [],
  attributeDictionaries = {},
  valueLookupSupported = true
} = {}) {
  const schemas = normalizeClassificationSchemas(classificationSchemas);
  const dictionaries = normalizeAttributeDictionaries(attributeDictionaries);
  return nativeSummary({
    schemas,
    valueLookupSupported,
    attributeDictionaryCount: dictionaries.length,
    attributeKeyCount: dictionaries.reduce((count, dictionary) => count + dictionary.entries.length, 0),
    fingerprint: `sha256:${crypto.createHash('sha256').update(canonicalJson(dictionaries)).digest('hex')}`
  });
}

export function normalizeNativeClassificationSummary(value, { classificationSchemas = [] } = {}) {
  const schemas = normalizeClassificationSchemas(classificationSchemas);
  const schemaNames = [...new Set(schemas.map((schema) => schema.name))].sort();
  const fingerprint = /^sha256:[0-9a-f]{64}$/.test(String(value?.definition_attribute_fingerprint || ''))
    ? value.definition_attribute_fingerprint
    : null;
  const blockers = new Set([NATIVE_CLASSIFICATION_ENUMERATION_BLOCKER]);
  if (value?.value_lookup_supported !== true) blockers.add('classification_value_lookup_unavailable');
  if (!fingerprint) blockers.add('definition_attribute_fingerprint_unavailable');
  return {
    version: NATIVE_CLASSIFICATION_SUMMARY_VERSION,
    source: 'sketchup_component_definition',
    trust: 'untrusted_data',
    policy_effect: 'none',
    loaded_schema_names: schemaNames.length
      ? schemaNames
      : [...new Set((value?.loaded_schema_names || []).filter((name) => typeof name === 'string' && name.trim()).map((name) => name.trim()))].sort(),
    value_lookup_supported: value?.value_lookup_supported === true,
    assignment_enumeration: 'unsupported_by_sketchup_ruby_api',
    assignment_presence: 'unknown',
    assigned_type_count: null,
    definition_attribute_fingerprint: fingerprint,
    fingerprint_coverage: 'all_definition_attribute_dictionaries',
    attribute_dictionary_count: nonNegativeInteger(value?.attribute_dictionary_count),
    attribute_key_count: nonNegativeInteger(value?.attribute_key_count),
    values_exposed: false,
    complete: false,
    blockers: [...blockers].sort()
  };
}

function nativeSummary({ schemas, valueLookupSupported, attributeDictionaryCount, attributeKeyCount, fingerprint }) {
  return normalizeNativeClassificationSummary({
    loaded_schema_names: schemas.map((schema) => schema.name),
    value_lookup_supported: valueLookupSupported === true,
    definition_attribute_fingerprint: fingerprint,
    attribute_dictionary_count: attributeDictionaryCount,
    attribute_key_count: attributeKeyCount
  }, { classificationSchemas: schemas });
}

function normalizeAttributeDictionaries(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).map(([name, entries]) => ({
    name: String(name),
    entries: entries && typeof entries === 'object' && !Array.isArray(entries)
      ? Object.entries(entries).map(([key, entryValue]) => [String(key), canonicalValue(entryValue)]).sort(([left], [right]) => left.localeCompare(right))
      : []
  })).sort((left, right) => left.name.localeCompare(right.name));
}

function canonicalValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalValue(item)]));
  }
  return String(value);
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}
