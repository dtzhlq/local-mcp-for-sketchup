import { AgentContractError } from './agent-contract.mjs';
import { OPERATION_REGISTRY } from './capabilities.mjs';
import { expandDslCode } from './dsl-expansion.mjs';

// Agent Gateway create/verify(code) is deliberately narrower than the expert
// build_model surface. Every operation must be explicitly classified here;
// adding an operation to the shared registry does not make it Gateway-safe.
export const AGENT_GATEWAY_ADDITIVE_CREATION_OPERATIONS = Object.freeze([
  'box',
  'rounded_box',
  'beveled_panel',
  'fillet',
  'chamfer',
  'recess',
  'engraved_line',
  'text_emboss',
  'text_engrave',
  'text_3d',
  'slot',
  'slot_array',
  'rib',
  'standoff_boss',
  'button_on_panel',
  'prism',
  'panel_with_openings',
  'boolean_cutout',
  'face_with_holes',
  'profile_extrude',
  'mesh',
  'geometry_input',
  'curve',
  'arc_curve',
  'gable_roof',
  'shed_roof',
  'cylinder',
  'loft_between_profiles',
  'shell_from_front_side_profiles',
  'lofted_solid',
  'face_on_cylinder',
  'analog_stick',
  'screw_hole',
  'pipe_between_points',
  'swept_path',
  'domed_surface',
  'bowed_panel',
  'floor_slab',
  'footprint_slab',
  'wall',
  'wall_path',
  'curved_wall',
  'roof_footprint',
  'hip_roof',
  'parapet_path',
  'curtain_wall',
  'column_grid',
  'path_surface',
  'terrain_mesh',
  'parking_stall_array',
  'door',
  'window',
  'stairs',
  'railing',
  'component_instance',
  'room'
]);

const ADDITIVE_CREATION_SET = new Set(AGENT_GATEWAY_ADDITIVE_CREATION_OPERATIONS);
const EXISTING_TARGET_FIELDS = Object.freeze([
  'target_id',
  'targetId',
  'target',
  'object',
  'entity_path',
  'entityPath',
  'target_path',
  'targetPath',
  'edit_scope',
  'editScope',
  'instance_policy',
  'instancePolicy',
  'instance_id',
  'instanceId',
  'confirmed'
]);
const MATERIAL_SPEC_FIELDS = new Set([
  'material',
  'back_material',
  'backMaterial',
  'front_material',
  'frontMaterial',
  'f_material',
  'b_material',
  'hole_material',
  'holeMaterial',
  'frame_material',
  'frameMaterial',
  'panel_material',
  'panelMaterial'
]);

for (const operation of AGENT_GATEWAY_ADDITIVE_CREATION_OPERATIONS) {
  if (!OPERATION_REGISTRY[operation]) {
    throw new Error(`Agent Gateway creation policy references an unregistered operation: ${operation}`);
  }
}

export function prepareAgentGatewayCreationDsl(code, { intent = 'create_model' } = {}) {
  let prepared;
  try {
    prepared = expandDslCode(code);
  } catch (error) {
    throw new AgentContractError('INVALID_ARGUMENT', `${intent} requires a valid safe JSON DSL document.`, {
      details: { reason: String(error?.message || error) }
    });
  }

  const blocked = [];
  for (const [index, operation] of prepared.document.operations.entries()) {
    const operationPath = `operations[${index}]`;
    if (!ADDITIVE_CREATION_SET.has(operation.op)) {
      blocked.push({
        path: operationPath,
        op: operation.op,
        reason: blockedReason(operation.op)
      });
      continue;
    }
    const targetFields = EXISTING_TARGET_FIELDS.filter((field) => Object.hasOwn(operation, field));
    if (targetFields.length) {
      blocked.push({
        path: operationPath,
        op: operation.op,
        reason: 'existing_target_fields',
        fields: targetFields
      });
    }
    const mutableMaterialSpecs = findMutableMaterialSpecs(operation, operationPath);
    if (mutableMaterialSpecs.length) {
      blocked.push({
        path: operationPath,
        op: operation.op,
        reason: 'named_material_may_be_updated',
        fields: mutableMaterialSpecs
      });
    }
  }

  if (blocked.length) {
    throw new AgentContractError(
      'OPERATION_NOT_ALLOWED',
      `${intent} accepts additive creation operations only; use reviewed_existing_model_edit for existing-model changes.`,
      {
        details: {
          execution_route: 'reviewed_existing_model_edit',
          blocked_operations: blocked
        },
        nextAction: {
          action: 'start_reviewed_existing_model_edit',
          intent: 'reviewed_existing_model_edit'
        }
      }
    );
  }

  return prepared;
}

function blockedReason(operation) {
  if (!OPERATION_REGISTRY[operation]) return 'unregistered_operation';
  if (operation === 'reset') return 'model_reset';
  if (operation === 'component_definition') return 'existing_definition_may_be_replaced';
  if (['material', 'tag', 'image_reference'].includes(operation)) return 'named_resource_may_be_updated';
  if (['camera', 'scene', 'style', 'shadow', 'rendering_options'].includes(operation)) return 'global_model_state_change';
  if (operation === 'selection') return 'existing_target_selection';
  return 'existing_model_edit_or_unclassified_operation';
}

function findMutableMaterialSpecs(value, currentPath, found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findMutableMaterialSpecs(item, `${currentPath}[${index}]`, found));
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${currentPath}.${key}`;
    if (MATERIAL_SPEC_FIELDS.has(key) && nested && typeof nested === 'object') found.push(nestedPath);
    findMutableMaterialSpecs(nested, nestedPath, found);
  }
  return found;
}
