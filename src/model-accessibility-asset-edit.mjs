import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentContractError, sha256Canonical } from './agent-contract.mjs';
import { createHash } from 'node:crypto';

export const ASSET_EDIT_VERSION = 'model-accessibility-asset-edit.v1';
const SHA = /^[a-f0-9]{64}$/;
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim() && !/[\0\r\n]/.test(value);
function invalid(field, message, recovery_class = 'self_correctable') {
  throw new AgentContractError('INVALID_ARGUMENT', message, { details: { recovery_class, issues: [{ path: field, message }] } });
}
function fields(value, allowed, required, field) {
  if (!isObject(value)) invalid(field, `${field} must be an object.`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`${field}.${key}`, 'Unknown asset edit field.');
  for (const key of required) if (!Object.hasOwn(value, key)) invalid(`${field}.${key}`, 'Required asset edit input is missing.', 'design_input');
}
function vector(value, field) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) invalid(field, 'Expected three finite millimetre coordinates.');
}
async function requiredFile(file, label, maxBytes) {
  try {
    const resolved = await fs.realpath(file), stat = await fs.stat(resolved);
    if (!stat.isFile() || stat.size === 0 || stat.size > maxBytes) invalid(label, `${label} must be a nonempty bounded regular file.`, 'runtime_blocked');
    return { resolved, stat };
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) throw error;
    throw new AgentContractError('OPERATION_NOT_ALLOWED', `The server-configured ${label} is unavailable; the host must prepare the actual file.`, { details: { recovery_class: 'runtime_blocked', missing_inputs: [label] } });
  }
}

// Pure contract validation is also used by the reviewed operation compiler.
// Loading SKP bytes is native-only; a mock cannot prove asset geometry.
export function validateNativeAssetOperation(operation) {
  const placing = operation?.op === 'place_component_asset';
  if (!placing && operation?.op !== 'replace_component_asset') invalid('op', 'Unknown native asset operation.');
  const common = ['op', 'source_path', 'source_sha256', 'source', 'license', 'origin', 'rotateZ', 'confirmed'];
  fields(operation, [...common, ...(placing ? ['id', 'name'] : ['entity_path', 'target_id', 'edit_scope', 'instance_policy', 'instance_id'])], common.filter(key => key !== 'confirmed'), 'asset_operation');
  if (!text(operation.source_path) || !path.isAbsolute(operation.source_path) || path.extname(operation.source_path).toLowerCase() !== '.skp') invalid('source_path', 'Expected an absolute local SKP path.');
  if (!SHA.test(operation.source_sha256)) invalid('source_sha256', 'Expected the exact SHA-256 of the catalog SKP.');
  for (const key of ['source', 'license']) if (!text(operation[key]) || operation[key].trim().toLowerCase() === 'unknown') invalid(key, 'Recorded source and license are required; neither is inferred from file availability.', 'design_input');
  vector(operation.origin, 'origin');
  if (!Number.isFinite(operation.rotateZ)) invalid('rotateZ', 'Expected a finite rotation in degrees.');
  if (operation.confirmed !== undefined && typeof operation.confirmed !== 'boolean') invalid('confirmed', 'Expected a boolean; this field does not replace trusted approval.');
  if (placing) {
    for (const key of ['id', 'name']) if (!text(operation[key])) invalid(key, 'A unique new root identity is required.');
  } else {
    if (Boolean(operation.entity_path) === Boolean(operation.target_id)) invalid('target', 'Exactly one existing root reference is required.');
    if (operation.entity_path && !/^pid:[1-9]\d*$/.test(operation.entity_path)) invalid('entity_path', 'Native asset replacement supports one canonical root occurrence only.');
    if (operation.target_id && !text(operation.target_id)) invalid('target_id', 'Expected an exact existing root identity.');
    if (operation.edit_scope && !['instance_path', 'top_level'].includes(operation.edit_scope)) invalid('edit_scope', 'Replacement cannot edit a shared definition or nested container.');
    if (operation.instance_policy && operation.instance_policy !== 'definition_wide') invalid('instance_policy', 'Root replacement preserves the actual instance and does not make a copy.');
    if (operation.instance_id !== undefined) invalid('instance_id', 'Nested instance selection is unsupported.');
  }
  return structuredClone(operation);
}

export async function prepareNativeAssetEdit({ assetEdit, taskId, runtime = 'queue', catalogPath: configuredCatalogPath } = {}) {
  fields(assetEdit, ['version', 'mode', 'asset', 'placement', 'target'], ['version', 'mode', 'asset', 'placement'], 'asset_edit');
  if (assetEdit.version !== 1 || !['place', 'replace'].includes(assetEdit.mode)) invalid('asset_edit', 'Use version 1 and mode place or replace.');
  if (runtime !== 'queue') throw new AgentContractError('OPERATION_NOT_ALLOWED', 'Native SKP assets require queue runtime; mock results cannot establish their geometry.', { details: { recovery_class: 'runtime_blocked' } });
  fields(assetEdit.asset, ['id'], ['id'], 'asset_edit.asset');
  if (!text(assetEdit.asset.id)) invalid('asset_edit.asset.id', 'An exact ID from the server-configured native catalog is required.', 'design_input');
  if (!text(configuredCatalogPath)) throw new AgentContractError('OPERATION_NOT_ALLOWED', 'The host has not configured a native asset catalog.', { details: { recovery_class: 'runtime_blocked' } });
  fields(assetEdit.placement, ['origin_mm', 'rotation_z_deg'], ['origin_mm', 'rotation_z_deg'], 'asset_edit.placement');
  vector(assetEdit.placement.origin_mm, 'asset_edit.placement.origin_mm');
  if (!Number.isFinite(assetEdit.placement.rotation_z_deg)) invalid('asset_edit.placement.rotation_z_deg', 'Expected finite degrees.');
  if (!text(taskId)) invalid('task_id', 'A server task identity is required.');
  const { resolved: catalogPath } = await requiredFile(configuredCatalogPath, 'native_asset_catalog', 5_000_000);
  const catalogBytes = await fs.readFile(catalogPath);
  let catalog;
  try { catalog = JSON.parse(catalogBytes); } catch { invalid('native_asset_catalog', 'The configured catalog is not valid JSON.', 'runtime_blocked'); }
  if (catalog.version !== 1 || !Array.isArray(catalog.assets)) invalid('asset_edit.asset.catalog_path', 'Expected catalog version 1 with assets.');
  const matches = catalog.assets.filter(asset => asset.id === assetEdit.asset.id);
  if (matches.length !== 1) invalid('asset_edit.asset.id', 'Asset ID must match exactly one catalog entry.', 'design_input');
  const entry = matches[0];
  if (!text(entry.path)) invalid('asset_edit.asset.id', 'This asset has no native SKP file; constructive recipes must first be materialized independently.', 'runtime_blocked');
  if (path.extname(entry.path).toLowerCase() !== '.skp') invalid('source_path', 'The selected catalog entry must reference a native SKP file, not recipe source.', 'runtime_blocked');
  const { resolved: sourcePath, stat } = await requiredFile(path.resolve(path.dirname(catalogPath), entry.path), 'native_asset_file', 256 * 1024 * 1024);
  const fileSha = createHash('sha256').update(await fs.readFile(sourcePath)).digest('hex');
  const declared = [entry.file_sha256, entry.source_sha256, entry.evidence?.file_sha256].filter(value => value !== undefined);
  if (declared.some(value => !SHA.test(value) || value !== fileSha)) invalid('source_sha256', 'Catalog source hash does not match the actual asset; refresh the source record before review.');
  const operation = { op: assetEdit.mode === 'place' ? 'place_component_asset' : 'replace_component_asset', source_path: sourcePath, source_sha256: fileSha,
    source: entry.source, license: entry.license, origin: [...assetEdit.placement.origin_mm], rotateZ: assetEdit.placement.rotation_z_deg };
  let targets = [];
  if (assetEdit.mode === 'place') {
    if (assetEdit.target !== undefined) invalid('asset_edit.target', 'Placing a new root does not target or replace an existing object.');
    operation.id = `asset-${sha256Canonical({ taskId, assetId: entry.id }).slice(0, 20)}`;
    operation.name = operation.id;
  } else {
    fields(assetEdit.target, ['entity_path', 'target_id'], [], 'asset_edit.target');
    Object.assign(operation, assetEdit.target);
    targets = [structuredClone(assetEdit.target)];
  }
  validateNativeAssetOperation(operation);
  return { version: ASSET_EDIT_VERSION, operations: [operation], targets,
    asset_record: { catalog_path: catalogPath, catalog_sha256: createHash('sha256').update(catalogBytes).digest('hex'), asset_id: entry.id,
      source_path: sourcePath, source_sha256: fileSha, size_bytes: stat.size, source: entry.source, license: entry.license,
      axes: structuredClone(entry.axes ?? null), native_verified: false },
    verification: ['native complete root and source SHA before/after', 'exact requested root origin and rigid Z rotation', 'existing roots, definitions, materials and attributes unchanged except selected definition binding', 'independent closeup, measurements, edit boundary and SKP delivery still required'] };
}
