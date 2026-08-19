const ARCHITECTURAL_PRIMITIVES = new Set([
  'column_grid',
  'bay_enclosure',
  'masonry_sill_wall',
  'podium_with_front_stair'
]);

export function expandArchitecturalPrimitives(partGraph = {}) {
  const expanded = structuredClone(partGraph);
  const parts = [];
  const expansions = [];
  for (const part of expanded.parts || []) {
    const primitive = part.shape?.primitive;
    if (!ARCHITECTURAL_PRIMITIVES.has(primitive)) {
      parts.push(part);
      continue;
    }
    const generated = expandArchitecturalPart(part);
    parts.push(...generated);
    expansions.push({
      primitive_part_id: part.id,
      primitive,
      generated_part_ids: generated.map((entry) => entry.id)
    });
  }
  expanded.parts = parts;
  expanded.architectural_primitive_expansion = {
    version: 1,
    source_part_graph_id: partGraph.id || null,
    expansions
  };
  return expanded;
}

export function isArchitecturalPrimitive(value) {
  return ARCHITECTURAL_PRIMITIVES.has(value);
}

function expandArchitecturalPart(part) {
  if (part.shape.primitive === 'column_grid') return expandColumnGrid(part);
  if (part.shape.primitive === 'bay_enclosure') return expandBayEnclosure(part);
  if (part.shape.primitive === 'masonry_sill_wall') return expandMasonrySillWall(part);
  if (part.shape.primitive === 'podium_with_front_stair') return expandPodiumWithFrontStair(part);
  throw new Error(`Unsupported architectural primitive: ${part.shape.primitive}`);
}

function expandColumnGrid(part) {
  const parameters = part.shape.parameters || {};
  const origin = vector3(parameters.origin, 'column_grid.origin');
  const columnSize = positiveVector3(parameters.column_size, 'column_grid.column_size');
  const layers = Array.isArray(parameters.layers) ? parameters.layers : [];
  if (layers.length === 0) throw new Error(`column_grid ${part.id} requires at least one explicit layer`);
  const generated = [];
  const layerIds = new Set();
  for (const layer of layers) {
    if (!layer?.id || !layer?.role) throw new Error(`column_grid ${part.id} layers require id and role`);
    if (layerIds.has(layer.id)) throw new Error(`column_grid ${part.id} layer id is duplicated: ${layer.id}`);
    layerIds.add(layer.id);
    const xs = numericArray(layer.x_positions, `column_grid ${part.id} ${layer.id}.x_positions`);
    const ys = numericArray(layer.y_positions, `column_grid ${part.id} ${layer.id}.y_positions`);
    for (let yIndex = 0; yIndex < ys.length; yIndex += 1) {
      for (let xIndex = 0; xIndex < xs.length; xIndex += 1) {
        const id = `${part.id}--${safeId(layer.id)}--r${yIndex + 1}c${xIndex + 1}`;
        generated.push(generatedBox(part, {
          id,
          name: `${part.name}_${layer.id}_R${yIndex + 1}C${xIndex + 1}`,
          role: layer.role,
          origin: [origin[0] + xs[xIndex] - columnSize[0] / 2, origin[1] + ys[yIndex] - columnSize[1] / 2, origin[2]],
          size: columnSize,
          material: layer.material || parameters.material || part.material,
          primitiveRole: layer.id
        }));
      }
    }
  }
  return generated;
}

function expandBayEnclosure(part) {
  const parameters = part.shape.parameters || {};
  const origin = vector3(parameters.origin, 'bay_enclosure.origin');
  const bayCount = positiveInteger(parameters.bay_count, 'bay_enclosure.bay_count');
  const bayWidth = positiveNumber(parameters.bay_width, 'bay_enclosure.bay_width');
  const thickness = positiveNumber(parameters.thickness, 'bay_enclosure.thickness');
  const height = positiveNumber(parameters.height, 'bay_enclosure.height');
  const sillHeight = nonNegativeNumber(parameters.sill_height ?? 0, 'bay_enclosure.sill_height');
  const windowHeight = positiveNumber(parameters.window_height ?? Math.max(1, height - sillHeight), 'bay_enclosure.window_height');
  if (sillHeight + windowHeight > height) throw new Error(`bay_enclosure ${part.id} sill and window exceed height`);
  const axis = parameters.axis || 'x';
  if (!['x', 'y'].includes(axis)) throw new Error(`bay_enclosure ${part.id} axis must be x or y`);
  const generated = [];
  for (let index = 0; index < bayCount; index += 1) {
    const offset = index * bayWidth;
    const bayOrigin = axis === 'x' ? [origin[0] + offset, origin[1], origin[2]] : [origin[0], origin[1] + offset, origin[2]];
    const horizontalSize = axis === 'x' ? [bayWidth, thickness] : [thickness, bayWidth];
    if (sillHeight > 0) {
      generated.push(generatedBox(part, {
        id: `${part.id}--bay-${index + 1}--sill`,
        name: `${part.name}_Bay_${index + 1}_Sill`,
        role: parameters.sill_role || 'masonry_sill_wall',
        origin: bayOrigin,
        size: [...horizontalSize, sillHeight],
        material: parameters.sill_material || parameters.wall_material || part.material,
        primitiveRole: 'sill'
      }));
    }
    generated.push(generatedBox(part, {
      id: `${part.id}--bay-${index + 1}--window`,
      name: `${part.name}_Bay_${index + 1}_Window`,
      role: parameters.window_role || 'enclosure_window',
      origin: [bayOrigin[0], bayOrigin[1], origin[2] + sillHeight],
      size: [...horizontalSize, windowHeight],
      material: parameters.window_material || part.material,
      primitiveRole: 'window'
    }));
    const headerHeight = height - sillHeight - windowHeight;
    if (headerHeight > 0) {
      generated.push(generatedBox(part, {
        id: `${part.id}--bay-${index + 1}--header`,
        name: `${part.name}_Bay_${index + 1}_Header`,
        role: parameters.wall_role || 'enclosure_wall',
        origin: [bayOrigin[0], bayOrigin[1], origin[2] + sillHeight + windowHeight],
        size: [...horizontalSize, headerHeight],
        material: parameters.wall_material || part.material,
        primitiveRole: 'header'
      }));
    }
  }
  return generated;
}

function expandMasonrySillWall(part) {
  const parameters = part.shape.parameters || {};
  return [generatedBox(part, {
    id: `${part.id}--wall`,
    name: `${part.name}_Wall`,
    role: parameters.role || 'masonry_sill_wall',
    origin: vector3(parameters.origin, 'masonry_sill_wall.origin'),
    size: positiveVector3(parameters.size, 'masonry_sill_wall.size'),
    material: parameters.material || part.material,
    primitiveRole: 'wall'
  })];
}

function expandPodiumWithFrontStair(part) {
  const parameters = part.shape.parameters || {};
  const origin = vector3(parameters.origin, 'podium_with_front_stair.origin');
  const size = positiveVector3(parameters.size, 'podium_with_front_stair.size');
  const generated = [generatedBox(part, {
    id: `${part.id}--podium`,
    name: `${part.name}_Podium`,
    role: parameters.podium_role || 'podium',
    origin,
    size,
    material: parameters.material || part.material,
    primitiveRole: 'podium'
  })];
  const stair = parameters.front_stair;
  if (!stair || stair.enabled === false) throw new Error(`podium_with_front_stair ${part.id} requires an explicit front_stair`);
  const steps = positiveInteger(stair.steps, 'podium_with_front_stair.front_stair.steps');
  const width = positiveNumber(stair.width, 'podium_with_front_stair.front_stair.width');
  const run = positiveNumber(stair.run, 'podium_with_front_stair.front_stair.run');
  const centerX = number(stair.center_x ?? origin[0] + size[0] / 2, 'podium_with_front_stair.front_stair.center_x');
  const frontY = number(stair.front_y ?? origin[1] - run, 'podium_with_front_stair.front_stair.front_y');
  const treadRun = run / steps;
  const rise = size[2] / steps;
  for (let index = 0; index < steps; index += 1) {
    generated.push(generatedBox(part, {
      id: `${part.id}--front-stair--step-${index + 1}`,
      name: `${part.name}_Front_Stair_Step_${index + 1}`,
      role: stair.role || 'front_stair',
      origin: [centerX - width / 2, frontY + index * treadRun, origin[2]],
      size: [width, treadRun, rise * (index + 1)],
      material: stair.material || parameters.material || part.material,
      primitiveRole: 'front_stair'
    }));
  }
  if (parameters.balustrade !== undefined) {
    if (parameters.balustrade?.enabled !== true) throw new Error(`podium_with_front_stair ${part.id} balustrade must be omitted or explicitly enabled`);
    generated.push(...expandExplicitBalustrade(part, origin, size, parameters.balustrade));
  }
  return generated;
}

function expandExplicitBalustrade(part, origin, size, balustrade) {
  const postSize = positiveNumber(balustrade.post_size, 'balustrade.post_size');
  const height = positiveNumber(balustrade.height, 'balustrade.height');
  const inset = nonNegativeNumber(balustrade.inset ?? 0, 'balustrade.inset');
  const points = [
    [origin[0] + inset, origin[1] + inset],
    [origin[0] + size[0] - inset - postSize, origin[1] + inset],
    [origin[0] + inset, origin[1] + size[1] - inset - postSize],
    [origin[0] + size[0] - inset - postSize, origin[1] + size[1] - inset - postSize]
  ];
  return points.map(([x, y], index) => generatedBox(part, {
    id: `${part.id}--balustrade--post-${index + 1}`,
    name: `${part.name}_Balustrade_Post_${index + 1}`,
    role: balustrade.role || 'balustrade',
    origin: [x, y, origin[2] + size[2]],
    size: [postSize, postSize, height],
    material: balustrade.material || part.material,
    primitiveRole: 'balustrade'
  }));
}

function generatedBox(parent, { id, name, role, origin, size, material, primitiveRole }) {
  const qa = {
    ...(parent.qa || {}),
    architectural_primitive_id: parent.id,
    architectural_primitive: parent.shape.primitive,
    architectural_primitive_role: primitiveRole,
    source_candidate_ids: clone(parent.source_candidate_ids || parent.qa?.source_candidate_ids || []),
    source_observation_ids: clone(parent.source_observation_ids || parent.qa?.source_observation_ids || [])
  };
  return {
    id,
    name,
    type: role,
    role,
    parent: parent.id,
    ...(parent.tag ? { tag: parent.tag } : {}),
    ...(material ? { material } : {}),
    shape: { primitive: 'box', parameters: { origin: clone(origin), size: clone(size), ...(material ? { material } : {}) } },
    evidence_status: parent.evidence_status,
    fallback_state: parent.fallback_state,
    ...(parent.evidence_sources ? { evidence_sources: clone(parent.evidence_sources) } : {}),
    ...(parent.source_candidate_ids ? { source_candidate_ids: clone(parent.source_candidate_ids) } : {}),
    ...(parent.source_observation_ids ? { source_observation_ids: clone(parent.source_observation_ids) } : {}),
    review_required: parent.review_required === true,
    helper_allowed: parent.helper_allowed === true,
    photo_grade_eligible: parent.photo_grade_eligible === true,
    qa
  };
}

function numericArray(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => !Number.isFinite(Number(item)))) throw new Error(`${label} requires a non-empty numeric array`);
  return value.map(Number);
}

function vector3(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => !Number.isFinite(Number(item)))) throw new Error(`${label} requires three numbers`);
  return value.map(Number);
}

function positiveVector3(value, label) {
  const result = vector3(value, label);
  if (result.some((item) => item <= 0)) throw new Error(`${label} values must be positive`);
  return result;
}

function positiveInteger(value, label) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1) throw new Error(`${label} must be a positive integer`);
  return result;
}

function positiveNumber(value, label) {
  const result = number(value, label);
  if (result <= 0) throw new Error(`${label} must be positive`);
  return result;
}

function nonNegativeNumber(value, label) {
  const result = number(value, label);
  if (result < 0) throw new Error(`${label} must be non-negative`);
  return result;
}

function number(value, label) {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`${label} must be numeric`);
  return result;
}

function safeId(value) {
  return String(value).trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}

function clone(value) {
  return structuredClone(value);
}
