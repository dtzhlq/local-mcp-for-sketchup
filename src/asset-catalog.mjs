import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DETAILED_RECIPE_KINDS, buildDetailedRecipe } from './detailed-modeling/recipes.mjs';
import { FURNISHING_ASSET_KINDS, buildFurnishingAsset } from './detailed-modeling/furnishing-assets.mjs';
import { compilePartGraphToSketchUpDsl } from './product-modeling/part-graph-compiler.mjs';
import { emptyModel } from './model-state.mjs';
import { addComponentDefinition } from './component-operations.mjs';

const RECIPE_SOURCE = fileURLToPath(new URL('./detailed-modeling/recipes.mjs', import.meta.url));
const FURNISHING_SOURCE = fileURLToPath(new URL('./detailed-modeling/furnishing-assets.mjs', import.meta.url));
const defaultBoundsCache = new Map();

// Compile the authored default recipe without creating a runtime, session file,
// or native model. Component bounds include nested placements and projecting
// hardware; rotated child AABBs can conservatively enclose the actual surface.
function defaultRecipeBounds(recipe) {
  if (defaultBoundsCache.has(recipe.recipe_signature)) return structuredClone(defaultBoundsCache.get(recipe.recipe_signature));
  const graph = { version: 2, id: `catalog-${recipe.id}`, units: 'mm', coordinate_system: 'part_local',
    parts: recipe.parts, roots: [{ part_id: recipe.root_id, instance_id: recipe.id, origin: [0, 0, 0] }] };
  const dsl = compilePartGraphToSketchUpDsl(graph, {}, { includeReset: false });
  const model = emptyModel();
  for (const operation of dsl.operations) {
    if (operation.op === 'component_definition') addComponentDefinition(model, operation);
  }
  const bounds = model.component_definitions[`PG2_${recipe.root_id}`]?.bounding_box;
  if (!bounds || ![...bounds.min, ...bounds.max, bounds.w, bounds.d, bounds.h].every(Number.isFinite) || [bounds.w, bounds.d, bounds.h].some(value => value <= 0)) {
    throw new Error(`Default recipe has no finite positive component bounds: ${recipe.kind}`);
  }
  const result = {
    default_dimensions_mm: { width: bounds.w, depth: bounds.d, height: bounds.h },
    default_bounds_mm: { min: [...bounds.min], max: [...bounds.max], size: [bounds.w, bounds.d, bounds.h] },
    dimensions_evidence: { source: 'compiled_default_recipe_component_bounds', parameter_overrides: {},
      interpretation: 'Axis-aligned extents including projecting geometry; not nominal design parameters.',
      conservative_for_rotated_children: true, native_verified: false }
  };
  defaultBoundsCache.set(recipe.recipe_signature, result);
  return structuredClone(result);
}

export async function queryLocalAssets({ catalog_path, query = '', kind, limit = 50 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Asset query limit must be 1..200.');
  let entries;
  let base;
  if (catalog_path) {
    const location = await fs.realpath(catalog_path);
    base = path.dirname(location);
    const bytes = await fs.readFile(location);
    if (bytes.length > 5_000_000) throw new Error('Asset catalog exceeds 5 MB.');
    const document = JSON.parse(bytes);
    if (document.version !== 1 || !Array.isArray(document.assets)) throw new Error('Asset catalog requires version=1 and assets.');
    entries = document.assets;
  } else {
    entries = [...DETAILED_RECIPE_KINDS,...FURNISHING_ASSET_KINDS].map(recipeKind => {
      const furnishing=FURNISHING_ASSET_KINDS.includes(recipeKind);
      const recipe = furnishing?buildFurnishingAsset(recipeKind,{id:`asset-${recipeKind}`}):buildDetailedRecipe(recipeKind, { id: `asset-${recipeKind}` });
      const defaultGeometry = defaultRecipeBounds(recipe);
      return { id: `detail-${recipeKind}`, name: recipeKind, kind: 'parametric_component', recipe: recipeKind,
        path: furnishing?FURNISHING_SOURCE:RECIPE_SOURCE, source: 'project-authored constructive recipe', license: 'project source terms',
        axes: { units: 'mm', up: '+Z', coordinate_system: 'part_local',
          dimension_axes: { width: '+X', depth: '+Y', height: '+Z' }, bounds_array_order: ['x', 'y', 'z'],
          origin_mm: [0, 0, 0], origin_is_bounds_min: defaultGeometry.default_bounds_mm.min.every(value => value === 0),
          origin_description: 'Authored recipe origin; use default_bounds_mm.min to locate the enclosing minimum corner.' },
        ...defaultGeometry,
        component_hierarchy: recipe.parts.filter(p => p.assembly).map(p => ({ id: p.id, children: p.assembly.children.length })),
        materials: [...new Set(recipe.parts.map(p => p.material).filter(Boolean))],
        geometry_acceptance: 'requires_live_instance_check', recipe_signature: recipe.recipe_signature };
    });
  }
  const needle = String(query).toLowerCase();
  const results = [];
  for (const entry of entries) {
    if (!entry.id || !entry.name) throw new Error('Asset entries need stable id and name.');
    if (kind && entry.kind !== kind) continue;
    if (needle && !JSON.stringify([entry.id, entry.name, entry.tags, entry.recipe]).toLowerCase().includes(needle)) continue;
    const item = structuredClone(entry);
    item.license = entry.license || 'unknown';
    item.source = entry.source || 'unknown';
    // A user-editable catalog records a claim. Matching bytes preserve that
    // record's association, but cannot authenticate a native runtime receipt.
    item.native_geometry_verified = false;
    item.native_verified = false;
    item.recorded_evidence_matches_file = false;
    item.evidence_trust = entry.evidence ? 'untrusted_catalog_claim_requires_live_inspection' : 'no_native_receipt';
    if (entry.path) {
      const assetPath = path.resolve(base || path.dirname(RECIPE_SOURCE), entry.path);
      try {
        const stat = await fs.stat(assetPath);
        item.path = assetPath; item.file_name = path.basename(assetPath); item.file_extension = path.extname(assetPath).toLowerCase(); item.available = stat.isFile(); item.size_bytes = stat.size;
        if (!item.available) item.native_geometry_verified = false;
        if (item.available && entry.evidence?.file_sha256) {
          const hash = crypto.createHash('sha256').update(await fs.readFile(assetPath)).digest('hex');
          item.recorded_evidence_matches_file = hash === entry.evidence.file_sha256;
          item.current_file_sha256 = hash;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        item.available = false; item.native_geometry_verified = false;
      }
    } else { item.available = Boolean(entry.recipe); item.native_geometry_verified = false; }
    results.push(item);
    if (results.length >= limit) break;
  }
  return { version: 'local-asset-catalog.v1', kind: 'asset_query', assets: results,
    policy: { purchases: false, automatic_downloads: false, license_unknown_is_usable_proof: false } };
}
