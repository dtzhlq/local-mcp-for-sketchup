import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { queryLocalAssets } from '../src/asset-catalog.mjs';
import { buildDetailedRecipe } from '../src/detailed-modeling/recipes.mjs';
import { FURNISHING_ASSET_KINDS, buildFurnishingAsset } from '../src/detailed-modeling/furnishing-assets.mjs';
import { compilePartGraphToSketchUpDsl } from '../src/product-modeling/part-graph-compiler.mjs';
import { MockRuntime } from '../src/mock-runtime.mjs';

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'accessibility-asset-bounds-'));
try {
  const assets = (await queryLocalAssets()).assets;
  assert.equal(assets.length, 12);
  for (const asset of assets) {
    const { min, max, size } = asset.default_bounds_mm;
    assert.ok([...min, ...max, ...size].every(Number.isFinite));
    assert.ok(size.every(value => value > 0));
    assert.deepEqual(size, max.map((value, axis) => value - min[axis]));
    assert.deepEqual(asset.default_dimensions_mm, { width: size[0], depth: size[1], height: size[2] });
    assert.deepEqual(asset.axes.dimension_axes, { width: '+X', depth: '+Y', height: '+Z' });
    assert.deepEqual(asset.axes.bounds_array_order, ['x', 'y', 'z']);
    assert.deepEqual(asset.axes.origin_mm, [0, 0, 0]);
    assert.equal(asset.axes.origin_is_bounds_min, min.every(value => value === 0));
    assert.deepEqual(asset.dimensions_evidence.parameter_overrides, {});
    assert.equal(asset.dimensions_evidence.source, 'compiled_default_recipe_component_bounds');
    assert.equal(asset.dimensions_evidence.conservative_for_rotated_children, true);
    assert.equal(asset.dimensions_evidence.native_verified, false);
    assert.equal(asset.native_geometry_verified, false);
    assert.equal(asset.native_verified, false);
  }

  // Physical additions and non-corner origins must survive discovery: nominal
  // input width/depth/height alone do not describe the occupied space.
  const asset = kind => assets.find(item => item.recipe === kind);
  assert.equal(asset('window').default_dimensions_mm.width, 1670, 'The 1600 mm window includes sill overhangs');
  assert.equal(asset('cabinet').default_bounds_mm.min[1], -59, 'Drawer hardware projects in front of the cabinet origin');
  assert.equal(asset('cabinet').default_dimensions_mm.depth, 659, 'Default 600 mm carcass depth does not include projecting hardware');
  assert.ok(asset('door').default_bounds_mm.min[1] < -300, 'The authored default open leaf changes occupied depth');
  assert.deepEqual(asset('side_table').default_bounds_mm.min, [-310, -310, 0], 'The round table has a centered local origin');
  assert.deepEqual(asset('side_table').default_dimensions_mm, { width: 620, depth: 620, height: 535 });

  // Independently run representative full recipes through the file-backed
  // offline runtime, covering nested rotations and both recipe families.
  for (const kind of ['window', 'door', 'cabinet', 'reading_chair', 'side_table']) {
    const id = `verify-${kind}`;
    const recipe = FURNISHING_ASSET_KINDS.includes(kind) ? buildFurnishingAsset(kind, { id }) : buildDetailedRecipe(kind, { id });
    const graph = { version: 2, id, units: 'mm', coordinate_system: 'part_local', parts: recipe.parts,
      roots: [{ part_id: recipe.root_id, instance_id: id, origin: [0, 0, 0] }] };
    const dsl = compilePartGraphToSketchUpDsl(graph, {}, { includeReset: false });
    const runtime = new MockRuntime({ sessionPath: path.join(temporary, `${kind}.json`) });
    const snapshot = await runtime.buildModel(JSON.stringify(dsl));
    const bounds = snapshot.instances.find(instance => instance.id === id).bounding_box;
    assert.deepEqual(asset(kind).default_bounds_mm, { min: bounds.min, max: bounds.max, size: [bounds.w, bounds.d, bounds.h] });
  }

  const expectedWindowBounds = structuredClone(asset('window').default_bounds_mm);
  asset('window').default_bounds_mm.min[0] = 99999;
  const filtered = (await queryLocalAssets({ query: 'detail-window', kind: 'parametric_component', limit: 1 })).assets;
  assert.equal(filtered.length, 1);
  assert.deepEqual(filtered[0].default_bounds_mm, expectedWindowBounds, 'Caller edits cannot corrupt cached default bounds');

  const catalogPath = path.join(temporary, 'external.json');
  const bytes = JSON.stringify({ version: 1, assets: [{ id: 'claimed', name: 'Catalog claim', recipe: 'window',
    native_geometry_verified: true, native_verified: true }] });
  await fs.writeFile(catalogPath, bytes, { flag: 'wx' });
  const claimed = (await queryLocalAssets({ catalog_path: catalogPath })).assets[0];
  assert.equal(claimed.native_geometry_verified, false);
  assert.equal(claimed.native_verified, false);
  assert.equal(claimed.default_dimensions_mm, undefined, 'External catalog recipes are not silently materialized as built-in geometry');
  assert.equal(await fs.readFile(catalogPath, 'utf8'), bytes, 'Asset discovery leaves external catalog source unchanged');
  console.log('model-accessibility-asset-catalog: all 12 default bounds/axes, physical projections, 5 full offline recipe comparisons, cache isolation and untrusted native claims passed; no live/native verification');
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
