import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DETAILED_RECIPE_KINDS, buildDetailedRecipe } from './detailed-modeling/recipes.mjs';
import { FURNISHING_ASSET_KINDS, buildFurnishingAsset } from './detailed-modeling/furnishing-assets.mjs';

const RECIPE_SOURCE = fileURLToPath(new URL('./detailed-modeling/recipes.mjs', import.meta.url));
const FURNISHING_SOURCE = fileURLToPath(new URL('./detailed-modeling/furnishing-assets.mjs', import.meta.url));

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
      return { id: `detail-${recipeKind}`, name: recipeKind, kind: 'parametric_component', recipe: recipeKind,
        path: furnishing?FURNISHING_SOURCE:RECIPE_SOURCE, source: 'project-authored constructive recipe', license: 'project source terms',
        axes: { units: 'mm', up: '+Z', coordinate_system: 'part_local' },
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
    item.recorded_evidence_matches_file = false;
    item.evidence_trust = entry.evidence ? 'untrusted_catalog_claim_requires_live_inspection' : 'no_native_receipt';
    if (entry.path) {
      const assetPath = path.resolve(base || path.dirname(RECIPE_SOURCE), entry.path);
      try {
        const stat = await fs.stat(assetPath);
        item.path = assetPath; item.available = stat.isFile(); item.size_bytes = stat.size;
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
