import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import { expandArchitecturalPrimitives } from '../src/product-modeling/architectural-primitives.mjs';
import { compilePartGraphToSketchUpDsl } from '../src/product-modeling/part-graph-compiler.mjs';

const profile = {
  version: 1,
  profile_id: 'traditional_hall_editable',
  product: { type: 'building', name: 'Traditional Hall Editable' },
  units: 'mm',
  materials: [
    { name: 'Timber', color: '#713d24' },
    { name: 'Stone', color: '#aaa79e' },
    { name: 'Window', color: '#315d68' }
  ]
};

const graph = {
  version: 1,
  id: 'traditional-hall-primitive-fixture',
  profile_id: profile.profile_id,
  source_mode: 'manual_authored',
  product: profile.product,
  units: 'mm',
  parts: [
    primitivePart('hall-column-grids', 'Hall_Column_Grids', 'column_grid', {
      origin: [0, 0, 500],
      column_size: [320, 320, 4200],
      material: 'Timber',
      layers: [
        { id: 'outer', role: 'outer_eave_column', x_positions: [-4200, 0, 4200], y_positions: [-3200, 3200] },
        { id: 'enclosure', role: 'enclosure_column', x_positions: [-3600, 0, 3600], y_positions: [-2500, 2500] },
        { id: 'interior', role: 'interior_column', x_positions: [-1800, 1800], y_positions: [-900, 900] }
      ]
    }),
    primitivePart('front-bays', 'Front_Bays', 'bay_enclosure', {
      origin: [-3600, -2500, 500],
      bay_count: 3,
      bay_width: 2400,
      thickness: 180,
      height: 3000,
      sill_height: 900,
      window_height: 1500,
      sill_material: 'Stone',
      window_material: 'Window',
      wall_material: 'Timber'
    }),
    primitivePart('side-sill-wall', 'Side_Sill_Wall', 'masonry_sill_wall', {
      origin: [-4500, -2200, 500],
      size: [180, 4400, 900],
      material: 'Stone'
    }),
    primitivePart('hall-podium', 'Hall_Podium', 'podium_with_front_stair', {
      origin: [-5000, -3500, 0],
      size: [10000, 7000, 500],
      material: 'Stone',
      front_stair: { enabled: true, steps: 5, width: 2800, run: 1800 }
    })
  ]
};

const schema = JSON.parse(await fs.readFile('schema/part-graph.schema.json', 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
assert.equal(validate(graph), true, JSON.stringify(validate.errors, null, 2));

const expanded = expandArchitecturalPrimitives(graph);
assert.equal(expanded.parts.some((part) => ['column_grid', 'bay_enclosure', 'masonry_sill_wall', 'podium_with_front_stair'].includes(part.shape.primitive)), false);
assert.equal(expanded.parts.every((part) => part.shape.primitive === 'box'), true);
assert.equal(expanded.parts.some((part) => part.role === 'balustrade'), false, 'podium must not add a balustrade by default');
assert.ok(expanded.parts.some((part) => part.role === 'outer_eave_column'));
assert.ok(expanded.parts.some((part) => part.role === 'enclosure_column'));
assert.ok(expanded.parts.some((part) => part.role === 'interior_column'));
assert.ok(expanded.parts.some((part) => part.role === 'masonry_sill_wall'));
assert.ok(expanded.parts.some((part) => part.role === 'front_stair'));
for (const part of expanded.parts) {
  assert.ok(part.parent, `${part.id} must preserve its high-level primitive identity`);
  assert.deepEqual(part.source_candidate_ids, [`candidate-${part.parent}`]);
  assert.deepEqual(part.source_observation_ids, ['observation-front']);
  assert.equal(part.qa.architectural_primitive_id, part.parent);
  assert.equal(part.tag, 'Hall_Structure');
}

const dsl = compilePartGraphToSketchUpDsl(graph, profile, { repoRoot: process.cwd() });
const geometryOps = dsl.operations.filter((operation) => operation.id);
assert.equal(geometryOps.length, expanded.parts.length);
assert.equal(geometryOps.every((operation) => operation.op === 'box'), true, 'architectural primitives must lower only to the existing safe DSL');
assert.ok(geometryOps.every((operation) => operation.qa?.architectural_primitive_id));
assert.equal(dsl.operations.filter((operation) => operation.op === 'assign_tag').length, expanded.parts.length);

const extendedBays = structuredClone(graph);
extendedBays.parts.find((part) => part.id === 'front-bays').shape.parameters.bay_count = 4;
const expandedExtended = expandArchitecturalPrimitives(extendedBays);
for (const id of ['front-bays--bay-1--sill', 'front-bays--bay-1--window', 'front-bays--bay-1--header']) {
  assert.ok(expanded.parts.some((part) => part.id === id));
  assert.ok(expandedExtended.parts.some((part) => part.id === id), `${id} must remain stable across a bay-count edit`);
}

const explicitBalustrade = structuredClone(graph);
explicitBalustrade.parts.find((part) => part.id === 'hall-podium').shape.parameters.balustrade = {
  enabled: true,
  post_size: 160,
  height: 900,
  inset: 120
};
assert.equal(validate(explicitBalustrade), true, JSON.stringify(validate.errors, null, 2));
assert.equal(expandArchitecturalPrimitives(explicitBalustrade).parts.filter((part) => part.role === 'balustrade').length, 4);

const implicitBalustrade = structuredClone(graph);
implicitBalustrade.parts.find((part) => part.id === 'hall-podium').shape.parameters.balustrade = {
  enabled: false,
  post_size: 160,
  height: 900
};
assert.equal(validate(implicitBalustrade), false, 'schema must reject an implicit or disabled balustrade request');
assert.throws(() => expandArchitecturalPrimitives(implicitBalustrade), /balustrade must be omitted or explicitly enabled/);

process.stdout.write(`${JSON.stringify({
  ok: true,
  high_level_primitives: 4,
  generated_safe_parts: expanded.parts.length,
  explicit_column_layers: ['outer', 'enclosure', 'interior'],
  balustrade_default: 'absent',
  identity_and_lineage_preserved: true
}, null, 2)}\n`);

function primitivePart(id, name, primitive, parameters) {
  return {
    id,
    name,
    type: primitive,
    role: primitive,
    tag: 'Hall_Structure',
    shape: { primitive, parameters },
    evidence_status: 'manual_confirmed',
    fallback_state: 'real_feature_op',
    evidence_sources: [{ kind: 'image_observation', status: 'manual_confirmed', observation_id: 'observation-front' }],
    source_candidate_ids: [`candidate-${id}`],
    source_observation_ids: ['observation-front'],
    review_required: false,
    qa: {}
  };
}
