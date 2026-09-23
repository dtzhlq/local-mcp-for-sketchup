import { buildYfRecipe } from './traditional-timber/yf-recipe.mjs';
import { YF_PARAMETER_RULES, YF_RULES, yfRuleBinding, resolveYfParameters } from './traditional-timber/yf-rules.mjs';
import { timberDetailSpecification } from './traditional-timber/quality.mjs';
import { AgentContractError } from './agent-contract.mjs';
import { buildDetailedRecipe, DETAIL_MATERIALS, DETAILED_RECIPE_KINDS, roundedRectangle } from './detailed-modeling/recipes.mjs';
import { buildFurnishingAsset, FURNISHING_ASSET_KINDS } from './detailed-modeling/furnishing-assets.mjs';
import { describeAssemblyOccurrences, DETAIL_SAMPLE_RESOURCE_BUDGET } from './detailed-modeling/scenes.mjs';
import { requirementsForOccurrences, DETAIL_COVERAGE_VERSION } from './detailed-modeling/requirements.mjs';
import { bindRecipeVoidsToInstances } from './detailed-modeling/compose-design.mjs';
import { compilePartGraphToSketchUpDsl } from './product-modeling/part-graph-compiler.mjs';
import { freezeDetailSpecification } from './detail-quality.mjs';

export const MODEL_ACCESSIBILITY_TASK_VERSION = 'model-accessibility-task.v1';
export const MODEL_ACCESSIBILITY_TASK_KINDS = Object.freeze(['window', 'door', 'cabinet', 'sink_counter', 'asset_placement', 'traditional_timber']);
const clone = value => structuredClone(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const compiledPreflights=new WeakMap();
const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const number = (min, max, description, defaultValue) => ({ type: 'number', minimum: min, maximum: max, description, ...(defaultValue === undefined ? { required: true } : { default: defaultValue }) });
const mm = (min, max, description, defaultValue) => ({ ...number(min, max, description, defaultValue), units: 'mm' });
const COMMON_DIMENSIONS = {
  traditional_timber: YF_PARAMETER_RULES,
  window: { width_mm: mm(500, 5000, 'Overall outer frame width along local +X.'), depth_mm: mm(80, 500, 'Frame depth along local +Y.'), height_mm: mm(500, 4000, 'Outer frame height along local +Z.'), sill_back_edge_mm: mm(-1000, 1000, 'Signed Y position of the sill back edge.', 150) },
  door: { width_mm: mm(650, 2000, 'Overall jamb width along local +X.'), depth_mm: mm(80, 500, 'Jamb depth along local +Y.'), height_mm: mm(1900, 4000, 'Overall jamb height along local +Z.'), open_angle_deg: { ...number(-100, 0, 'Leaf angle about its left hinge, clockwise from above opens toward -Y; this recipe is left hinged.'), units: 'degrees' } },
  cabinet: { width_mm: mm(500, 2400, 'Outside carcass width along local +X.'), depth_mm: mm(450, 1200, 'Carcass depth along local +Y.'), height_mm: mm(600, 1600, 'Overall cabinet height along local +Z.'), front_gap_mm: mm(1, 12, 'Visible drawer front gaps.', 3), handle_length_mm: mm(40, 1000, 'Length of the centered drawer handle.', 190), drawer_extension_mm: mm(0, 1000, 'Top drawer extension toward local -Y.', 0), handle_material: { type: 'string', enum: ['Detail_Stainless', 'Detail_Brass'], default: 'Detail_Stainless', description: 'Existing recipe finish; no undeclared material is created.' } },
  sink: { width_mm: mm(400, 1800, 'Outer basin/rim width along +X.'), depth_mm: mm(300, 1000, 'Outer basin/rim depth along +Y.'), height_mm: mm(100, 400, 'Basin depth measured from basin bottom to rim.' ) },
  reading_chair: { width_mm: mm(620, 1600, 'Overall chair width.'), depth_mm: mm(650, 1600, 'Nominal chair depth.'), seat_height_mm: mm(360, 650, 'Top of the seat cushion above floor.'), back_height_mm: mm(800, 1700, 'Nominal back height above floor; must exceed seat height by 300 mm.') },
  side_table: { radius_mm: mm(220, 800, 'Round tabletop radius about the local origin.'), height_mm: mm(420, 1000, 'Tabletop height above floor.') },
  pendant_light: { radius_mm: mm(150, 700, 'Shade lower radius about the local origin.'), shade_height_mm: mm(180, 900, 'Shade height above its lower edge.'), drop_mm: mm(500, 3000, 'Ceiling mount height above shade lower edge; at least shade height + 150 mm.') },
  potted_plant: { height_mm: mm(850, 3000, 'Nominal plant height.'), pot_height_mm: mm(220, 1000, 'Planter rim height.'), pot_radius_mm: mm(130, 500, 'Planter top radius; plant height must exceed planter height by 400 mm.') }
};
COMMON_DIMENSIONS.sink_counter = {
  width_mm: mm(700, 6000, 'Countertop width along +X.'), depth_mm: mm(500, 1500, 'Countertop depth along +Y.'), height_mm: mm(650, 1400, 'Countertop finished upper surface above the local origin.'), thickness_mm: mm(12, 80, 'Stone countertop thickness.'),
  sink_width_mm: mm(400, 1800, 'Outer sink rim width.'), sink_depth_mm: mm(300, 1000, 'Outer sink rim depth.'), sink_height_mm: mm(100, 400, 'Basin depth below countertop upper surface.'),
  sink_offset_x_mm: mm(25, 5500, 'Sink rim minimum X, measured from counter left edge.'), sink_offset_y_mm: mm(25, 1000, 'Sink rim minimum Y, measured from counter front edge.')
};
const PARAMETER_NAMES = Object.freeze({ width_mm: 'width', depth_mm: 'depth', height_mm: 'height', sill_back_edge_mm: 'sill_back_edge', open_angle_deg: 'open_angle', front_gap_mm: 'front_gap', handle_length_mm: 'handle_length', drawer_extension_mm: 'drawer_extension', handle_material: 'handle_material', seat_height_mm: 'seat_height', back_height_mm: 'back_height', radius_mm: 'radius', shade_height_mm: 'shade_height', drop_mm: 'drop', pot_height_mm: 'pot_height', pot_radius_mm: 'pot_radius' });
const DEFAULT_PARAMETERS = Object.freeze({
  traditional_timber: {chi_mm:300},
  window: { width_mm: 1600, depth_mm: 130, height_mm: 1300 }, door: { width_mm: 1020, depth_mm: 150, height_mm: 2250, open_angle_deg: -18 }, cabinet: { width_mm: 800, depth_mm: 600, height_mm: 870 },
  sink_counter: { width_mm: 1200, depth_mm: 650, height_mm: 900, thickness_mm: 28, sink_width_mm: 740, sink_depth_mm: 440, sink_height_mm: 180, sink_offset_x_mm: 230, sink_offset_y_mm: 60 },
  sink: { width_mm: 740, depth_mm: 440, height_mm: 180 }, reading_chair: { width_mm: 760, depth_mm: 790, seat_height_mm: 440, back_height_mm: 960 }, side_table: { radius_mm: 310, height_mm: 535 }, pendant_light: { radius_mm: 235, shade_height_mm: 300, drop_mm: 900 }, potted_plant: { height_mm: 1250, pot_height_mm: 370, pot_radius_mm: 195 }
});
const TASK_TITLES = { traditional_timber:'Yingzao Fashi five-bay ten-rafter hip-roof hall with subsidiary eaves', window: 'Detailed double sash window', door: 'Detailed left hinged door', cabinet: 'Three drawer cabinet', sink_counter: 'Countertop with real sink opening', asset_placement: 'Place complete built-in asset roots' };
const COORDINATES = Object.freeze({ units: 'mm', angles: 'degrees', world: 'SketchUp world X/Y/Z; +Z is up.', local: '+X is width; +Y is depth/back; +Z is up; furniture and joinery face -Y.', origin: 'Window/door: outer frame lower left at Y=0. Cabinet: carcass lower left at Y=0, feet at Z=0. Sink-counter: counter lower left projected to floor. Round assets: center axis; pendant origin is shade lower edge.', transform_order: 'Construct the definition in local mm, rotate about local Z, then translate its origin to world origin_mm. Positive rotation is counterclockwise viewed from +Z.', limits: 'This helper supports Z rotation only. No implicit scaling, mirroring, host wall cutting, or automatic alignment.' });
const BOUNDARIES = Object.freeze({ preflight_is_quality_acceptance: false, geometry_requires_live_measurement: true, close_views_required: true, approval_policy_unchanged: true, task_requirements_frozen_after_creation: true, max_automatic_refinements_per_part: 3, mock_is_live_acceptance: false });

function exampleTask(kind) {
  const recipe = kind === 'asset_placement' ? 'side_table' : kind;
  return { version: 1, kind, id: `example-${kind}`, units: 'mm', ...(kind === 'asset_placement' ? { asset_id: 'detail-side_table' } : {}), parameters: clone(DEFAULT_PARAMETERS[recipe]), placement: { origin_mm: [0, 0, 0] } };
}

/** A read-only, progressively expandable contract, suitable for an existing Gateway artifact. */
export function getModelAccessibilityTaskCatalog({ task, detail = 'summary', query = '' } = {}) {
  if (!['summary', 'parameters', 'examples', 'all'].includes(detail)) throw new AgentContractError('INVALID_ARGUMENT', 'detail must be summary, parameters, examples, or all.');
  if (task !== undefined && !MODEL_ACCESSIBILITY_TASK_KINDS.includes(task)) throw new AgentContractError('INVALID_ARGUMENT', `Unknown task kind: ${task}`);
  const expanded = detail !== 'summary';
  const kinds = task ? [task] : MODEL_ACCESSIBILITY_TASK_KINDS;
  const tasks = kinds.map(kind => {
    const sample = exampleTask(kind), recipe = kind === 'asset_placement' ? 'side_table' : kind;
    const error = clone(sample); delete error.parameters[Object.keys(DEFAULT_PARAMETERS[recipe])[0]];
    return { kind, title: TASK_TITLES[kind], intent: 'create_model', input_field: 'inputs.task',
      ...(kind==='traditional_timber'?{preset:YF_RULES.id,rule_binding:yfRuleBinding(),implementation_status:YF_RULES.status,creation_available:['frozen','released'].includes(YF_RULES.status),units_note:'Geometry and placement use mm. Architectural lengths use explicit chi_mm and named chi parameters; material fen is distinct.'}:{}),
      required: ['version', 'kind', 'id', 'units', 'parameters', 'placement_or_instances', ...(kind === 'asset_placement' ? ['asset_id'] : [])],
      ...(expanded ? { parameters: kind === 'asset_placement' ? { by_asset_recipe: clone(Object.fromEntries(Object.entries(COMMON_DIMENSIONS).filter(([name]) => !['sink_counter','traditional_timber'].includes(name)))) } : clone(COMMON_DIMENSIONS[kind]), placement: { required: ['origin_mm'], origin_mm: { type: 'array', length: 3, item_type: 'number', absolute_maximum: 1_000_000 }, rotation_z_deg: { type: 'number', minimum: -360, maximum: 360, default: 0 }, instances: { minimum: 1, maximum: 12, required_per_item: ['id', 'origin_mm'], semantics: 'Every instance shares this one generated definition. Explicit world origins perform placement; existing objects are never moved.' } }, dependencies: dependencyDescriptions(recipe), fixed_design: fixedDesign(recipe) } : {}),
      ...(['examples', 'all'].includes(detail) ? { examples: { minimal: { tool: 'start_agent_task', arguments: { intent: 'create_model', instruction: TASK_TITLES[kind], idempotency_key: `example-${kind}-v1`, inputs: { runtime: 'mock', task: sample } } }, common_error: { input: error, expected: { code: 'MISSING_INPUT', path: `task.parameters.${Object.keys(DEFAULT_PARAMETERS[recipe])[0]}`, recovery_class: 'design_input' } } } } : {}) };
  });
  const needle = String(query).toLowerCase();
  const assets = [...DETAILED_RECIPE_KINDS, ...FURNISHING_ASSET_KINDS].filter(name => `detail-${name} ${name}`.toLowerCase().includes(needle)).map(name => ({ id: `detail-${name}`, name, source: 'project-authored constructive recipe', license: 'project source terms', placement_supported: Object.hasOwn(COMMON_DIMENSIONS, name), axes: { units: 'mm', up: '+Z', coordinate_system: 'part_local', description_ref: 'coordinates' }, ...(expanded && DEFAULT_PARAMETERS[name] ? { nominal_parameters_mm: clone(DEFAULT_PARAMETERS[name]) } : {}), geometry_acceptance: 'requires_live_instance_check' }));
  return { kind: 'model_accessibility_task_catalog', version: MODEL_ACCESSIBILITY_TASK_VERSION, units: 'mm', tasks, assets: task === 'asset_placement' || detail === 'all' ? assets : undefined,
    coordinates: clone(COORDINATES), boundaries: clone(BOUNDARIES),
    discover: { detail_values: ['summary', 'parameters', 'examples', 'all'], task_values: clone(MODEL_ACCESSIBILITY_TASK_KINDS), suggested_expansion: 'Choose one task kind and request its parameters, then examples.' }
  };
}

function dependencyDescriptions(kind) {
  const base = ['Every required parameter must be a finite JSON number in the declared range; numeric strings are rejected.', 'Provide placement or instances, never both. At most 12 instances keep required captures within the existing 24-view quality gate.', 'Bounds are helper support limits, not universal construction regulations.'];
  const byKind = { traditional_timber:['chi_mm is required. Other lengths are in chi; main/subsidiary material grades are fixed at 2/3.','The frozen preset has five bays, ten rafter spans and one inner column line.','Creation requires a frozen rule package; native acceptance belongs to the actual generated model. One overview is required; hidden joint simplification and selected dimensions remain explicit.'], cabinet: ['handle_length_mm <= width_mm - 64; drawer_extension_mm <= depth_mm - 90.', '(height_mm - 100 - 3 * front_gap_mm) / 3 > 55; drawer fronts and cavity must remain positive.'], reading_chair: ['back_height_mm >= seat_height_mm + 300.'], pendant_light: ['drop_mm >= shade_height_mm + 150.'], potted_plant: ['height_mm >= pot_height_mm + 400.'], sink_counter: ['sink_offset_x_mm + sink_width_mm <= width_mm - 25.', 'sink_offset_y_mm + sink_depth_mm + 90 <= depth_mm, leaving a supported faucet mount behind the rim.', 'height_mm - sink_height_mm >= 100; thickness_mm < sink_height_mm.', 'The rectangular through opening is sink_width_mm - 36 by sink_depth_mm - 36, inset 18 mm from the sink rim.'] };
  return [...base, ...(byKind[kind] || [])];
}
function fixedDesign(kind) {
  return ({ traditional_timber:'Fixed YF five-bay single-trough hip-roof dian with open subsidiary eaves, central double board door and four po-zi-ling windows. Project-selected layout; no other periods or painting.', window: 'Two shared sash assemblies, fixed 55 mm outer frame, 6 mm panes, 270 mm projecting sill; this helper does not change sash count or opening angle.', door: 'Left hinge only, three visible hinges, 60 mm jambs, 46 mm leaf; open_angle_deg is required.', cabinet: 'Three shared drawer boxes, 18 mm carcass boards, 100 mm toe space, only the top drawer extends.', sink_counter: 'Countertop and complete sink are one assembly; no supporting cabinet is inferred. Stone finish, stainless sink, faucet and open drain follow the existing recipe.' })[kind] || 'Uses the complete project-authored asset root and its original constructive subparts and finishes.';
}

function issue(issues, path, code, message, fix, recovery = 'self_correctable') {
  if (recovery === 'needs_design_input') recovery = 'design_input';
  issues.push({ code, path, message, recovery_class: recovery, missing_inputs: code === 'MISSING_INPUT' ? [path] : [], fix_options: [{ action: recovery === 'design_input' ? 'supply_explicit_design_value' : 'correct_input', path, instruction: fix }] });
}
function unknownKeys(value, allowed, location, issues) {
  if (!object(value)) return;
  for (const key of Object.keys(value)) if (!allowed.includes(key)) issue(issues, `${location}.${key}`, 'UNKNOWN_FIELD', `Unknown field ${key}; it would otherwise be ignored.`, `Use one of: ${allowed.join(', ')}.`);
}
function requireObject(value, location, issues) {
  if (object(value)) return true;
  issue(issues, location, value === undefined ? 'MISSING_INPUT' : 'INVALID_TYPE', 'An explicit JSON object is required.', 'Supply the documented object.', value === undefined ? 'needs_design_input' : 'self_correctable');
  return false;
}
function requireId(value, location, issues) {
  if (typeof value === 'string' && identifier.test(value)) return true;
  issue(issues, location, value === undefined ? 'MISSING_INPUT' : 'INVALID_IDENTIFIER', 'An id must use 1..96 letters, digits, underscore or hyphen and start with a letter or digit.', 'Supply a stable design id; do not change it to retry the same task.');
  return false;
}
function validatePlacement(value, location, issues, id) {
  if (!requireObject(value, location, issues)) return null;
  unknownKeys(value, id === undefined ? ['id', 'origin_mm', 'rotation_z_deg'] : ['origin_mm', 'rotation_z_deg'], location, issues);
  const instanceId = id ?? value.id;
  if (id === undefined) requireId(instanceId, `${location}.id`, issues);
  if (!Array.isArray(value.origin_mm) || value.origin_mm.length !== 3 || value.origin_mm.some(coordinate => !Number.isFinite(coordinate) || Math.abs(coordinate) > 1_000_000)) issue(issues, `${location}.origin_mm`, value.origin_mm === undefined ? 'MISSING_INPUT' : 'INVALID_VECTOR', 'origin_mm requires three finite world millimeter numbers with absolute values <= 1000000.', 'Supply the desired explicit [x, y, z] origin.', value.origin_mm === undefined ? 'needs_design_input' : 'self_correctable');
  const angle = value.rotation_z_deg === undefined ? 0 : value.rotation_z_deg;
  if (!Number.isFinite(angle) || angle < -360 || angle > 360) issue(issues, `${location}.rotation_z_deg`, 'OUT_OF_RANGE', 'rotation_z_deg must be a finite number between -360 and 360.', 'Express the requested rotation in degrees.');
  return { instance_id: instanceId, origin: clone(value.origin_mm), transform: { rotateZ: angle } };
}

/** No runtime calls or user-model writes. Context facts are optional preflight evidence, never permission. */
export function preflightModelAccessibilityTask(task, context = {}) {
  const issues = [], normalized = {};
  let bundle = null;
  if (!requireObject(task, 'task', issues)) return result();
  unknownKeys(task, ['version', 'kind', 'id', 'units', 'asset_id', 'parameters', 'placement', 'instances'], 'task', issues);
  if (task.version !== 1) issue(issues, 'task.version', task.version === undefined ? 'MISSING_INPUT' : 'UNSUPPORTED_VERSION', 'Task version must be 1.', 'Set version to 1.');
  if (!MODEL_ACCESSIBILITY_TASK_KINDS.includes(task.kind)) issue(issues, 'task.kind', 'UNSUPPORTED_TASK', `Supported task kinds: ${MODEL_ACCESSIBILITY_TASK_KINDS.join(', ')}.`, 'Discover a supported task contract or use the existing reviewed workflow.');
  requireId(task.id, 'task.id', issues);
  if (task.units !== 'mm') issue(issues, 'task.units', task.units === undefined ? 'MISSING_INPUT' : 'UNSUPPORTED_UNITS', 'This helper accepts explicit millimeters only.', 'Convert all dimensions and origins to mm and set units to mm.');
  let recipeKind = task.kind;
  if (task.kind === 'asset_placement') {
    const asset = typeof task.asset_id === 'string' && task.asset_id.startsWith('detail-') ? task.asset_id.slice(7) : null;
    if (!asset || !Object.hasOwn(COMMON_DIMENSIONS, asset) || ['sink_counter','traditional_timber'].includes(asset)) issue(issues, 'task.asset_id', task.asset_id === undefined ? 'MISSING_INPUT' : 'UNSUPPORTED_ASSET', 'Select an asset_id whose catalog entry has placement_supported=true.', 'Read the built-in asset catalog and use its exact detail-<name> id.');
    recipeKind = asset;
  } else if (task.asset_id !== undefined) issue(issues, 'task.asset_id', 'UNEXPECTED_FIELD', 'asset_id belongs only to asset_placement.', 'Remove asset_id or choose asset_placement.');
  const contract = Object.hasOwn(COMMON_DIMENSIONS, recipeKind || '') ? COMMON_DIMENSIONS[recipeKind] : null;
  const parameters = {};
  if (requireObject(task.parameters, 'task.parameters', issues) && contract) {
    unknownKeys(task.parameters, Object.keys(contract), 'task.parameters', issues);
    for (const [key, rule] of Object.entries(contract)) {
      const value = task.parameters[key] === undefined && Object.hasOwn(rule, 'default') ? rule.default : task.parameters[key];
      if (value === undefined) issue(issues, `task.parameters.${key}`, 'MISSING_INPUT', `${key} is required and has no implicit design default.`, rule.description, 'needs_design_input');
      else if (['number','integer'].includes(rule.type) && (!Number.isFinite(value) || value < rule.minimum || value > rule.maximum || rule.type==='integer'&&!Number.isInteger(value))) issue(issues, `task.parameters.${key}`, 'OUT_OF_RANGE', `${key} must be a finite number in [${rule.minimum}, ${rule.maximum}] ${rule.units || ''}.`, `Supply ${rule.description}`);
      else if (rule.enum && !rule.enum.includes(value)) issue(issues, `task.parameters.${key}`, 'UNSUPPORTED_VALUE', `${key} must be one of ${rule.enum.join(', ')}.`, 'Select one of the declared recipe finishes.');
      else parameters[key] = value;
    }
  }
  const dependency = (valid, key, message) => { if (!valid) issue(issues, `task.parameters.${key}`, 'PARAMETER_DEPENDENCY', message, 'Adjust the named dimensions while preserving the design requirement.'); };
  if (contract && Object.keys(contract).every(key => Object.hasOwn(parameters, key))) {
    const p = parameters;
    if(recipeKind==='traditional_timber'){try{resolveYfParameters(p);}catch(error){dependency(false,'chi_mm',error.message);}}
    if (recipeKind === 'cabinet') { dependency(p.handle_length_mm <= p.width_mm - 64, 'handle_length_mm', 'Handle length must be <= width_mm - 64.'); dependency(p.drawer_extension_mm <= p.depth_mm - 90, 'drawer_extension_mm', 'Drawer extension must be <= depth_mm - 90.'); dependency((p.height_mm - 100 - 3 * p.front_gap_mm) / 3 > 55, 'front_gap_mm', 'Drawer sides must retain positive height.'); }
    if (recipeKind === 'reading_chair') dependency(p.back_height_mm >= p.seat_height_mm + 300, 'back_height_mm', 'Back height must be >= seat_height_mm + 300.');
    if (recipeKind === 'pendant_light') dependency(p.drop_mm >= p.shade_height_mm + 150, 'drop_mm', 'Drop must be >= shade_height_mm + 150.');
    if (recipeKind === 'potted_plant') dependency(p.height_mm >= p.pot_height_mm + 400, 'height_mm', 'Plant height must be >= pot_height_mm + 400.');
    if (recipeKind === 'sink_counter') { dependency(p.sink_offset_x_mm + p.sink_width_mm <= p.width_mm - 25, 'sink_offset_x_mm', 'Leave at least 25 mm beyond the sink rim at the counter right edge.'); dependency(p.sink_offset_y_mm + p.sink_depth_mm + 90 <= p.depth_mm, 'sink_offset_y_mm', 'Leave at least 90 mm behind the rim for the faucet mount.'); dependency(p.height_mm - p.sink_height_mm >= 100 && p.thickness_mm < p.sink_height_mm, 'sink_height_mm', 'Keep the basin bottom >= 100 mm above origin and sink depth greater than countertop thickness.'); }
  }
  const instances = [];
  if ((task.placement !== undefined) === (task.instances !== undefined)) issue(issues, 'task.placement', 'PLACEMENT_CHOICE_REQUIRED', 'Supply exactly one of placement or instances.', 'Use placement for one root, or instances for explicit shared-definition copies.', task.placement === undefined ? 'needs_design_input' : 'self_correctable');
  else if (task.placement !== undefined) instances.push(validatePlacement(task.placement, 'task.placement', issues, `id-${task.id}`));
  else if (!Array.isArray(task.instances) || task.instances.length < 1 || task.instances.length > 12) issue(issues, 'task.instances', 'RESOURCE_BUDGET', 'instances requires 1..12 placements.', 'Use at most 12 instances so each receives the existing required close views.');
  else for (const [index, item] of task.instances.entries()) instances.push(validatePlacement(item, `task.instances[${index}]`, issues));
  const seen = new Set(), existing = new Set(context.existingIds || []);
  for (const [index, instance] of instances.entries()) if (instance) { if (seen.has(instance.instance_id)) issue(issues, `task.instances[${index}].id`, 'DUPLICATE_IDENTIFIER', 'Every root instance id must be distinct.', 'Give each intended occurrence a different stable id.'); seen.add(instance.instance_id); if (existing.has(instance.instance_id)) issue(issues, 'task.id', 'NAME_CONFLICT', `The supplied context already contains ${instance.instance_id}.`, 'Resume the existing task to retry; choose a distinct id only for a genuinely new object.'); }
  if (existing.has(task.id)) issue(issues, 'task.id', 'NAME_CONFLICT', `The supplied context already contains ${task.id}.`, 'Resolve the existing object or supply a new design id.');
  Object.assign(normalized, { version: 1, kind: task.kind, id: task.id, units: 'mm', recipe_kind: recipeKind, ...(task.kind === 'asset_placement' ? { asset_id: task.asset_id } : {}), parameters, instances: instances.filter(Boolean) });
  if (!issues.length) {
    try {
      bundle = buildBundle(normalized, context);
      const supported = context.availableOperations ? new Set(context.availableOperations) : null;
      for (const operation of collectOperations(bundle.dsl.operations)) if (supported && !supported.has(operation)) issue(issues, 'task.kind', 'CAPABILITY_UNSUPPORTED', `Current runtime does not declare generated operation ${operation}.`, 'Use a runtime that advertises every required operation.', 'runtime_blocked');
      const estimates = estimateGeometry(bundle.part_graph);
      const budget = Object.fromEntries(Object.entries(task.kind==='traditional_timber'?{max_faces:4000000,max_edges:12000000,max_vertices:4000000}:DETAIL_SAMPLE_RESOURCE_BUDGET).map(([key, value]) => [key, Math.min(value, context.resourceBudget?.[key] ?? value)]));
      for (const [name, value] of Object.entries(estimates)) if (value > budget[`max_${name}`]) issue(issues, 'task.instances', 'RESOURCE_BUDGET', `Conservative ${name} estimate ${value} exceeds ${budget[`max_${name}`]}.`, 'Reduce the instance count or arrange a separately reviewed resource budget.');
      const operationCount = countOperations(bundle.dsl.operations);
      const operationLimit=task.kind==='traditional_timber'?context.limits?.max_builtin_preset_operations??100000:context.limits?.max_operations;
      const leafLimit=task.kind==='traditional_timber'?context.limits?.max_builtin_preset_leaf_occurrences??120000:context.limits?.max_affected_instances;
      if (operationLimit !== undefined && operationCount > operationLimit) issue(issues, 'task.kind', 'RESOURCE_BUDGET', `Generated operation count ${operationCount} exceeds server limit ${operationLimit}.`, 'Use a smaller explicitly scoped task or request a reviewed server policy change.', 'runtime_blocked');
      if (leafLimit !== undefined && (bundle.leaf_occurrence_count ?? bundle.parts_mapping.length) > leafLimit) issue(issues, 'task.instances', 'RESOURCE_BUDGET', `Expanded leaf occurrence count ${(bundle.leaf_occurrence_count ?? bundle.parts_mapping.length)} exceeds server limit ${leafLimit}.`, 'Reduce the number of requested instances.', 'runtime_blocked');
      normalized.resource_estimate = estimates;
      normalized.operation_count = operationCount;
      normalized.leaf_occurrence_count = (bundle.leaf_occurrence_count ?? bundle.parts_mapping.length);
      normalized.required_operations = collectOperations(bundle.dsl.operations);
    } catch (error) { issue(issues, 'task.parameters', 'RECIPE_COMPILE_FAILED', String(error.message), 'Correct the explicit recipe dimensions; compilation did not execute SketchUp.'); }
  }
  return result();
  function result() { const report={ kind: 'model_accessibility_preflight', version: MODEL_ACCESSIBILITY_TASK_VERSION, ok: issues.length === 0, issues, normalized: issues.length ? null : normalized, evidence_level: 'preflight_only', execution_started: false, quality_accepted: false, boundaries: clone(BOUNDARIES), remaining_runtime_checks: task?.kind==='traditional_timber'?['fresh session and atomic creation scope','native major-assembly summary','one overview and visible joint review']:['fresh runtime capability and session binding', 'atomic target/name absence and execution policy', 'actual geometry, collision and required void measurements', 'native resource totals', 'server close views and file save/reopen'], checked: ['declared dimensions and dependencies', 'units, axes and placement', 'references and names supplied in context', 'all generated operation dependencies when supplied', 'conservative expanded geometry estimate'] }; if(bundle&&!issues.length)compiledPreflights.set(report,bundle);return report; }
}

/** Compile only; the existing Gateway retains authorization, task storage, frozen QA and execution. */
export function compileModelAccessibilityTask(task, context = {}) {
  const preflight = preflightModelAccessibilityTask(task, context);
  if (!preflight.ok) {
    const recovery_class = preflight.issues.some(item => item.recovery_class === 'design_input') ? 'design_input' : preflight.issues.some(item => item.recovery_class === 'runtime_blocked') ? 'runtime_blocked' : 'self_correctable';
    throw new AgentContractError('INVALID_ARGUMENT', 'Common task preflight failed before execution.', { details: { preflight, issues: preflight.issues, recovery_class }, nextAction: { action: 'correct_input', required: preflight.issues.flatMap(item => item.missing_inputs) } });
  }
  const bundle = compiledPreflights.get(preflight);
  if(!bundle)throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR','The successful preflight lost its server-compiled bundle.');
  return { intent: 'create_model', inputs: { code: JSON.stringify(bundle.dsl), detail_spec: bundle.detail_spec, views: bundle.views }, bundle, preflight };
}

function buildBundle(task, context = {}) {
  const parameters = Object.fromEntries(Object.entries(task.parameters).map(([key, value]) => [PARAMETER_NAMES[key] || key, value]));
  const recipe = task.kind==='traditional_timber'?buildYfRecipe({id:task.id,parameters,legacyRendering:context.timberLegacyRendering===true}):task.kind === 'sink_counter' ? sinkCounterRecipe(task.id, task.parameters) : FURNISHING_ASSET_KINDS.includes(task.recipe_kind) ? buildFurnishingAsset(task.recipe_kind, { id: task.id, parameters }) : buildDetailedRecipe(task.recipe_kind, { id: task.id, parameters });
  const graph = { version: 2, id: `accessibility-${task.id}`, profile_id: `accessibility-${task.id}`, units: 'mm', coordinate_system: 'part_local', product: { type: task.kind, name: task.id }, parts: recipe.parts, roots: task.instances.map(instance => ({ part_id: recipe.root_id, ...clone(instance) })) };
  const profile = { version: 1, profile_id: graph.profile_id, materials: clone(recipe.materials || DETAIL_MATERIALS) };
  const dsl = compilePartGraphToSketchUpDsl(graph, profile, { includeReset: false });
  const timber=task.kind==='traditional_timber';
  const occurrences = timber?[]:describeAssemblyOccurrences(graph);
  const leafCount=timber?countLeafOccurrences(graph):occurrences.length;
  const required_parts = timber?[]:requirementsForOccurrences(graph.parts, occurrences, recipe.requirements);
  const required_voids = bindRecipeVoidsToInstances(recipe.required_voids || [], recipe.root_id, task.instances);
  const views = timber?[camerasFor(task,task.instances[0])[0]]:task.instances.flatMap(instance => camerasFor(task, instance));
  const detail_spec = timber?timberDetailSpecification(graph,views,yfRuleBinding()):{ version: 1, coverage_version: DETAIL_COVERAGE_VERSION, scene_id: graph.id, detail_level: 'detailed', resource_budget: clone(DETAIL_SAMPLE_RESOURCE_BUDGET), required_parts, required_voids, required_views: views.map(view => ({ id: view.id, kind: view.kind, instance_path: clone(view.instance_path), min_width: 1400, min_height: 900 })), max_iterations: 6 };
  freezeDetailSpecification(detail_spec);
  return { dsl, part_graph: graph, profile, parts_mapping: occurrences, leaf_occurrence_count:leafCount, detail_spec, views, recipe_signature: recipe.recipe_signature, ...(timber?{rule_binding:yfRuleBinding(),rule_expected_values:recipe.measurements,provenance:recipe.provenance}:{}), parameters: clone(task.parameters), source: 'explicit_task_compilation', evidence_level: 'constructive_dsl_only', live_geometry_verified: false };
}

function sinkCounterRecipe(id, p) {
  const sinkId = `${id}-sink`, sink = buildDetailedRecipe('sink', { id: sinkId, parameters: { width: p.sink_width_mm, depth: p.sink_depth_mm, height: p.sink_height_mm } });
  const slabId = `${id}-countertop`, slabRoot = `${id}-slab`, sinkPlacement = { part_id: sinkId, instance_id: `${id}-sink-instance`, origin: [p.sink_offset_x_mm, p.sink_offset_y_mm, p.height_mm - p.sink_height_mm] };
  const x = p.sink_offset_x_mm + 18, y = p.sink_offset_y_mm + 18, w = p.sink_width_mm - 36, d = p.sink_depth_mm - 36;
  const shape = { primitive: 'profile_extrude', parameters: { origin: [0, 0, p.height_mm - p.thickness_mm], plane: 'xy', outer: roundedRectangle(p.width_mm, p.depth_mm, 7), depth: p.thickness_mm, holes: [[[x, y], [x + w, y], [x + w, y + d], [x, y + d]]] } };
  const metadata = { detail_level: 'detailed', evidence_status: 'manual_confirmed', fallback_state: 'structured_primitive' };
  const parts = [...sink.parts, { id: slabId, name: slabId, type: 'detail_geometry', role: 'worktop', material: 'Detail_Stone', shape, ...metadata }, { id: slabRoot, name: slabRoot, type: 'assembly', role: 'countertop', assembly: { children: [{ part_id: slabId }] }, ...metadata }, { id, name: id, type: 'assembly', role: 'sink_counter', assembly: { children: [sinkPlacement, { part_id: slabRoot }] }, ...metadata }];
  const required_voids = sink.required_voids.map(rule => ({ ...clone(rule), instance_path: [id, sinkPlacement.instance_id, ...rule.instance_path.slice(1)] }));
  required_voids.push({ id: `${id}-counter-opening`, instance_path: [id], search_scope: 'assembly', bounds_mm: { min: [x + 30, y + 30, p.height_mm - p.thickness_mm - 1], max: [x + w - 30, y + d - 30, p.height_mm + 1] } });
  return { id, root_id: id, parts, required_voids, requirements: [...sink.requirements, { id: slabId, role: 'worktop', material: 'Detail_Stone', geometry_checks: [{ type: 'opening', min_count: 1 }, { type: 'profile', min_vertices: 24 }] }], materials: DETAIL_MATERIALS };
}

function camerasFor(task, instance) {
  const p = task.parameters;
  const centered = ['side_table', 'pendant_light', 'potted_plant'].includes(task.recipe_kind);
  const w = p.width_mm || (p.radius_mm || p.pot_radius_mm || 500) * 2;
  const d = p.depth_mm || w;
  const h = p.height_mm || p.back_height_mm || p.drop_mm || 1000;
  const center = centered ? [0, 0, h / 2] : [w / 2, d / 2, h / 2];
  const rotation = instance.transform.rotateZ * Math.PI / 180;
  const world = ([x, y, z]) => [x * Math.cos(rotation) - y * Math.sin(rotation) + instance.origin[0], x * Math.sin(rotation) + y * Math.cos(rotation) + instance.origin[1], z + instance.origin[2]];
  const span = Math.max(w, d, h);
  return ['overview', 'closeup'].map(kind => {
    // Frame the complete native root, including projections such as the sill
    // and hardware, using the existing bounds-driven orthographic capture.
    // Nominal recipe dimensions do not guarantee a fully visible overview.
    if (kind === 'overview') return { id: `${instance.instance_id}-${kind}`, kind, instance_path: [instance.instance_id], width: 1600, height: 1000, camera: { projection: 'orthographic' } };
    const closeTarget = task.kind === 'sink_counter' ? [p.sink_offset_x_mm + p.sink_width_mm / 2, p.sink_offset_y_mm + p.sink_depth_mm / 2, p.height_mm]
      : task.recipe_kind === 'pendant_light' ? [0, 0, p.shade_height_mm / 2]
      : task.recipe_kind === 'side_table' ? [0, 0, h * 0.95]
      : [center[0], centered ? 0 : d * 0.22, h * 0.65];
    const target = closeTarget;
    const distance = span * 0.9;
    return { id: `${instance.instance_id}-${kind}`, kind, instance_path: [instance.instance_id], width: 1600, height: 1000, camera: { eye: world([target[0] + distance * 0.4, target[1] - distance, target[2] + distance * 0.45]), target: world(target), up: [0, 0, 1], fov: 38 } };
  });
}

function collectOperations(operations) {
  return [...new Set(operations.flatMap(operation => [operation.op, ...(Array.isArray(operation.operations) ? collectOperations(operation.operations) : [])]))].sort();
}
function countOperations(operations) {
  return operations.reduce((sum, operation) => sum + 1 + (Array.isArray(operation.operations) ? countOperations(operation.operations) : 0), 0);
}
function countLeafOccurrences(graph){
  const parts=new Map(graph.parts.map(p=>[p.id,p])),memo=new Map();
  const count=id=>{
    if(memo.has(id))return memo.get(id);
    const p=parts.get(id),n=p.assembly?p.assembly.children.reduce((s,c)=>s+count(c.part_id),0):1;
    memo.set(id,n);return n;
  };
  return graph.roots.reduce((s,r)=>s+count(r.part_id),0);
}
function estimateGeometry(graph) {
  const parts = new Map(graph.parts.map(part => [part.id, part]));
  const memo=new Map();
  const costs = id => {
    if(memo.has(id))return memo.get(id);
    const part = parts.get(id);
    if (part.assembly){const result=part.assembly.children.reduce((sum, child) => add(sum, costs(child.part_id)), { faces: 0, edges: 0, vertices: 0 });memo.set(id,result);return result;}
    const { primitive, parameters: p } = part.shape;
    let faces, vertices;
    if (primitive === 'box') [faces, vertices] = [6, 8];
    else if (primitive === 'mesh') [faces, vertices] = [p.faces.reduce((sum, face) => sum + Math.max(1, face.length - 2), 0), p.vertices.length];
    else if (primitive === 'cylinder') [faces, vertices] = [(p.segments || 24) * 2 + 2, (p.segments || 24) * 2];
    else if (primitive === 'profile_extrude') { const count = p.outer.length + (p.holes || []).reduce((sum, hole) => sum + hole.length, 0); [faces, vertices] = [count * 4, count * 2]; }
    else if (primitive === 'pipe_between_points') { const rings = (p.points || [p.start, p.end]).length, segments = p.segments || 32; [faces, vertices] = [Math.max(1, rings - 1) * segments * 2 + segments * 2, rings * segments]; }
    else if (primitive === 'lofted_solid') { const rings = p.profile.length, segments = p.n || p.segments || 10; [faces, vertices] = [(rings - 1) * segments * 2 + (segments - 2) * 2, rings * segments]; }
    else throw new Error(`Resource estimate is unavailable for ${primitive}.`);
    const result={ faces, edges: faces * 3, vertices };memo.set(id,result);return result;
  };
  const add = (a, b) => ({ faces: a.faces + b.faces, edges: a.edges + b.edges, vertices: a.vertices + b.vertices });
  return graph.roots.reduce((sum, root) => add(sum, costs(root.part_id)), { faces: 0, edges: 0, vertices: 0 });
}
