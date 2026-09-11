import { AgentContractError } from './agent-contract.mjs';

export const HOST_CREATION_METADATA_VERSION = 'new-root-metadata.v1';
export const HOST_CREATION_METADATA_OPS = new Set(['attribute', 'tag', 'assign_tag']);
const dictionaries = new Set(['BenchmarkFixture', 'BenchmarkManualEdit']);
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = reason => { throw new AgentContractError('OPERATION_NOT_ALLOWED', `Host creation metadata rejected: ${reason}`); };
function keys(value, allowed) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('unexpected fields');
}
export function validateHostAttributeValues(dictionary, attributes) {
  if (!dictionaries.has(dictionary)) fail('dictionary must be an explicit inert fixture dictionary');
  if (!plain(attributes) || !Object.keys(attributes).length || Object.keys(attributes).length > 32) fail('attributes require 1..32 literal values');
  for (const [key, value] of Object.entries(attributes)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || forbiddenKeys.has(key)) fail('invalid attribute key');
    if (!(value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)
      || typeof value === 'string' && value.length <= 2048)) fail('only finite scalar literal attributes are supported');
  }
}

// Called by both the prepared-document validator and the atomic mock guard.
// This validates closure, not authorization. Gateway authorization is an
// in-process host option brand followed by a server-signed immutable packet.
export function validateHostCreationMetadata(document, rootObjects) {
  const scope = document.creation_scope, declaration = scope?.host_metadata;
  const metadata = (document.operations || []).filter(op => HOST_CREATION_METADATA_OPS.has(op.op));
  if (!declaration) { if (metadata.length) fail('host declaration missing'); return { tags: [] }; }
  keys(declaration, ['version', 'root_ids', 'tags']);
  if (declaration.version !== HOST_CREATION_METADATA_VERSION) fail('unsupported version');
  const validList = list => Array.isArray(list) && list.length <= 12 && list.every(id => typeof id === 'string' && id.startsWith(scope.namespace)) && new Set(list).size === list.length;
  if (!validList(declaration.root_ids) || !declaration.root_ids.length || !validList(declaration.tags)) fail('invalid roots or tags');
  if (declaration.tags.some(name => !new RegExp(`^${scope.namespace}tag_[a-f0-9]{16}$`).test(name))) fail('tag name must use the task namespace');
  const declaredRoots = new Set(declaration.root_ids), actualRoots = new Set(rootObjects.map(op => op.id));
  if ([...declaredRoots].some(id => !actualRoots.has(id))) fail('declared root is not created by this transaction');
  const declaredTags = new Set(declaration.tags), createdTags = new Set(), seenRoots = new Set();
  for (const op of document.operations) {
    if (!HOST_CREATION_METADATA_OPS.has(op.op)) { if (actualRoots.has(op.id)) seenRoots.add(op.id); continue; }
    if (op.op === 'tag') {
      keys(op, ['op', 'name', 'visible']);
      if (!declaredTags.has(op.name) || createdTags.has(op.name) || op.visible !== true) fail('tag must be unique, new and visible');
      createdTags.add(op.name);
      continue;
    }
    if (!declaredRoots.has(op.target_id) || !seenRoots.has(op.target_id)) fail('target must be an earlier new root');
    if (op.op === 'attribute') {
      keys(op, ['op', 'target_id', 'dictionary', 'attributes']);
      validateHostAttributeValues(op.dictionary, op.attributes);
    } else {
      keys(op, ['op', 'target_id', 'tag']);
      if (!createdTags.has(op.tag)) fail('assignment must use an earlier newly created tag');
    }
  }
  if (createdTags.size !== declaredTags.size) fail('declared tag has no creation operation');
  return { tags: [...createdTags] };
}
