import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { queryLocalAssets } from '../src/asset-catalog.mjs';

const builtins = await queryLocalAssets();
assert.equal(builtins.assets.length, 12);
assert.equal(new Set(builtins.assets.map(asset => asset.id)).size, 12);
assert.ok(builtins.assets.every(asset => asset.available && asset.source !== 'unknown' && asset.license !== 'unknown'));
assert.ok(builtins.assets.every(asset => asset.native_geometry_verified === false && asset.geometry_acceptance === 'requires_live_instance_check'));
assert.ok(builtins.assets.every(asset => asset.axes.units === 'mm' && asset.component_hierarchy.length > 0));
assert.equal((await queryLocalAssets({ query: 'window', kind: 'parametric_component', limit: 1 })).assets[0].recipe, 'window');
assert.deepEqual(builtins.policy, { purchases: false, automatic_downloads: false, license_unknown_is_usable_proof: false });

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'sketchup-asset-catalog-'));
const assetPath = path.join(temporary, 'asset.skp');
const directoryPath = path.join(temporary, 'directory.skp');
await fs.mkdir(directoryPath);
await fs.writeFile(assetPath, 'offline fixture bytes; not a real SKP', { flag: 'wx' });
const hash = crypto.createHash('sha256').update(await fs.readFile(assetPath)).digest('hex');
const catalogPath = path.join(temporary, 'catalog.json');
await fs.writeFile(catalogPath, JSON.stringify({ version: 1, assets: [
  { id: 'recorded', name: 'Recorded part', kind: 'skp', path: 'asset.skp', source: 'user supplied local archive', license: 'Internal fixture use', evidence: { source: 'sketchup_runtime', file_sha256: hash } },
  { id: 'unknown', name: 'Unknown provenance part', kind: 'skp', path: 'asset.skp' },
  { id: 'mock', name: 'Mock evidence part', kind: 'skp', path: 'asset.skp', evidence: { source: 'mock', file_sha256: hash } },
  { id: 'missing', name: 'Missing part', kind: 'skp', path: 'missing.skp', evidence: { source: 'sketchup_runtime', file_sha256: hash } },
  { id: 'directory', name: 'Directory masquerading as asset', kind: 'skp', path: 'directory.skp', evidence: { source: 'sketchup_runtime', file_sha256: hash } }
] }), { flag: 'wx' });
let result = await queryLocalAssets({ catalog_path: catalogPath });
assert.equal(result.assets[0].path, await fs.realpath(assetPath));
assert.equal(result.assets[0].native_geometry_verified, false, 'A forged catalog source/hash cannot authenticate native geometry');
assert.equal(result.assets[0].recorded_evidence_matches_file, true, 'Matching bytes only bind the untrusted catalog record');
assert.equal(result.assets[0].current_file_sha256, hash);
assert.equal(result.assets[0].license, 'Internal fixture use');
assert.equal(result.assets[1].license, 'unknown');
assert.equal(result.assets[1].source, 'unknown');
assert.equal(result.assets[1].native_geometry_verified, false);
assert.equal(result.assets[2].native_geometry_verified, false);
assert.equal(result.assets[3].available, false);
assert.equal(result.assets[3].native_geometry_verified, false);
assert.equal(result.assets[4].available, false);
assert.equal(result.assets[4].native_geometry_verified, false, 'A directory must never be hashed or accepted as a model file');
assert.equal(result.assets[4].current_file_sha256, undefined);
await fs.appendFile(assetPath, '\nchanged after recorded evidence');
result = await queryLocalAssets({ catalog_path: catalogPath, query: 'Recorded part' });
assert.equal(result.assets.length, 1);
assert.equal(result.assets[0].native_geometry_verified, false, 'Changed file bytes must invalidate old geometry evidence');
assert.equal(result.assets[0].recorded_evidence_matches_file, false);
assert.notEqual(result.assets[0].current_file_sha256, hash);
await fs.unlink(assetPath);
assert.equal((await queryLocalAssets({ catalog_path: catalogPath, query: 'recorded' })).assets[0].available, false);
for (const limit of [0, 201, 1.5]) await assert.rejects(() => queryLocalAssets({ limit }), /limit must be 1..200/);
const badCatalog = path.join(temporary, 'invalid.json');
await fs.writeFile(badCatalog, JSON.stringify({ version: 2, assets: [] }), { flag: 'wx' });
await assert.rejects(() => queryLocalAssets({ catalog_path: badCatalog }), /requires version=1/);
console.log('asset-catalog: twelve authored recipes/assets, source/license preservation, forged native claim rejected, exact hash association/stale hash/missing file and query validation passed; fixtures do not prove real SKP geometry');
