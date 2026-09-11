import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFurnishingAsset, FURNISHING_MATERIALS } from '../../src/detailed-modeling/furnishing-assets.mjs';
import { roundedRectangle, circlePoints } from '../../src/detailed-modeling/recipes.mjs';
import { compilePartGraphToSketchUpDsl } from '../../src/product-modeling/part-graph-compiler.mjs';
import { objectHash } from './benchmark.mjs';

// Host-authored asset sources, prepared before formal acceptance. Native SKP
// generation/measurement is a separate step; no catalog verification is implied.
export function nativeAssetSources() {
  const chair = buildFurnishingAsset('reading_chair', { id: 'catalog-chair', parameters: { width: 760, depth: 790, seat_height: 440, back_height: 960 } });
  const armchair = buildFurnishingAsset('reading_chair', { id: 'catalog-armchair', parameters: { width: 920, depth: 880, seat_height: 470, back_height: 1060 } });
  const parts = [], children = [];
  function part(key, primitive, parameters, material, role) {
    const id = `catalog-stool-${key}`;
    parts.push({ id, name: id, type: 'detail_geometry', role, material, detail_level: 'detailed', evidence_status: 'manual_confirmed', fallback_state: 'structured_primitive', shape: { primitive, parameters } });
    children.push({ part_id: id });
  }
  part('seat', 'profile_extrude', { origin: [0, 0, 430], plane: 'xy', outer: roundedRectangle(440, 440, 55, 8), depth: 30, holes: [] }, 'Detail_Oak', 'stool_seat');
  for (const [index, x, y] of [[1, 55, 55], [2, 385, 55], [3, 385, 385], [4, 55, 385]]) {
    part(`leg-${index}`, 'profile_extrude', { origin: [x, y, 6], plane: 'xy', outer: circlePoints(23, 32), depth: 424, holes: [] }, 'Detail_Oak', 'stool_leg');
    part(`pad-${index}`, 'profile_extrude', { origin: [x, y, 0], plane: 'xy', outer: circlePoints(23, 32), depth: 6, holes: [] }, 'Detail_Gasket', 'floor_pad');
  }
  for (const [index, origin, size] of [[1, [55, 43, 382], [330, 24, 48]], [2, [55, 373, 382], [330, 24, 48]], [3, [43, 55, 382], [24, 330, 48]], [4, [373, 55, 382], [24, 330, 48]]]) part(`apron-${index}`, 'box', { origin, size }, 'Detail_Oak_Endgrain', 'seat_apron');
  parts.push({ id: 'catalog-stool', name: 'catalog-stool', type: 'assembly', role: 'stool', detail_level: 'detailed', evidence_status: 'manual_confirmed', fallback_state: 'structured_primitive', assembly: { children } });
  const stool = { root_id: 'catalog-stool', parts, materials: structuredClone(FURNISHING_MATERIALS) };
  return [['chair', chair], ['stool', stool], ['armchair', armchair]].map(([kind, source]) => {
    const graph = { version: 2, id: `native-source-${kind}`, profile_id: `native-source-${kind}`, units: 'mm', coordinate_system: 'part_local', parts: source.parts, roots: [{ part_id: source.root_id, instance_id: `Asset-${kind}`, origin: [0, 0, 0] }] };
    // Bind the serialized payload actually sent to native, excluding optional
    // undefined fields that JSON drops while writing the source document.
    const dsl = JSON.parse(JSON.stringify(compilePartGraphToSketchUpDsl(graph, { version: 1, profile_id: graph.profile_id, materials: source.materials }, { includeReset: false })));
    return { asset_id: `local-${kind}`, kind, root_id: `Asset-${kind}`, graph, dsl, dsl_sha256: objectHash(dsl), source: 'Project-authored constructive furniture source', license: 'project source terms', native_geometry_verified: false,
      axes: { units: 'mm', up: '+Z', origin_mm: [0, 0, 0], dimension_axes: { width: '+X', depth: '+Y', height: '+Z' }, facing: '-Y' } };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.resolve(process.argv[2]);
  await fs.mkdir(directory, { recursive: false });
  for (const source of nativeAssetSources()) await fs.writeFile(path.join(directory, `${source.kind}.json`), JSON.stringify(source, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ directory, sources: 3, native_geometry_verified: false }));
}
