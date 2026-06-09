import { emptyModel } from './model-state.mjs';
import { ensureMaterial } from './material-operations.mjs';
import { addMesh, addPrism, addCylinder } from './primitive-operations.mjs';
import { addBooleanCutout, addFaceWithHoles, addGableRoof, addPanelWithOpenings, addProfileExtrude, addShedRoof } from './profile-operations.mjs';
import { addAnalogStick, addBowedPanel, addDomedSurface, addFaceOnCylinder, addLoftBetweenProfiles, addLoftedSolid, addPipeBetweenPoints, addScrewHole, addShellFromFrontSideProfiles, addSweptPath } from './surface-operations.mjs';
import { addBeveledPanel, addBox, addButtonOnPanel, addChamfer, addEngravedLine, addFillet, addImagePlane, addRecess, addRib, addRoundedBox, addSlot, addSlotArray, addStandoffBoss, addText3d, addTextEmboss, addTextEngrave } from './product-operations.mjs';
import { addColumnGrid, addCurvedWall, addCurtainWall, addDoor, addFloorSlab, addFootprintSlab, addHipRoof, addParapetPath, addParkingStallArray, addPathSurface, addRailing, addRoofFootprint, addStairs, addTerrainMesh, addWall, addWallPath, addWindow } from './architecture-operations.mjs';
import { assertObjectIdentityAvailable, boxVertices, objectId, rotationZMatrix } from './object-identity.mjs';
import { applyTransform, normalizeQaMetadata, normalizeTransform, normalizeVector } from './operation-utils.mjs';
import { boundingBoxForVertices, mergeBoundingBoxes } from './snapshot.mjs';

export function addComponentDefinition(model, { name, size = [1000, 1000, 1000], material, operations }) {
  if (!name || typeof name !== 'string') throw new Error('component_definition operation requires a string name');

  if (operations !== undefined) {
    if (!Array.isArray(operations)) throw new Error(`${name}.operations must be an array`);
    const componentModel = emptyModel();
    for (const operation of operations) {
      applyComponentDefinitionOperation(componentModel, operation, name);
    }
    for (const [materialName, materialValue] of Object.entries(componentModel.materials)) {
      if (!model.materials[materialName]) model.materials[materialName] = materialValue;
    }
    const groups = componentModel.groups;
    const faces = groups.reduce((sum, group) => sum + group.faces, 0);
    const edges = groups.reduce((sum, group) => sum + group.edges, 0);
    model.component_definitions[name] = {
      name,
      faces,
      edges,
      groups,
      material: groups.find((group) => group.material)?.material || null,
      bounding_box: mergeBoundingBoxes(groups.map((group) => group.bounding_box))
    };
    return;
  }

  const normalizedSize = normalizeVector(size, [1000, 1000, 1000], `${name}.size`);
  if (normalizedSize.some((value) => value <= 0)) throw new Error(`${name}.size values must be positive`);
  const [w, d, h] = normalizedSize;
  model.component_definitions[name] = {
    name,
    faces: 6,
    edges: 12,
    groups: [],
    material: ensureMaterial(model, material),
    bounding_box: { min: [0, 0, 0], max: [w, d, h], w, d, h }
  };
}

function applyComponentDefinitionOperation(model, operation, componentName) {
  switch (operation.op) {
    case 'material':
      ensureMaterial(model, operation);
      break;
    case 'box':
      addBox(model, operation);
      break;
    case 'rounded_box':
      addRoundedBox(model, operation);
      break;
    case 'beveled_panel':
      addBeveledPanel(model, operation);
      break;
    case 'fillet':
      addFillet(model, operation);
      break;
    case 'chamfer':
      addChamfer(model, operation);
      break;
    case 'recess':
      addRecess(model, operation);
      break;
    case 'engraved_line':
      addEngravedLine(model, operation);
      break;
    case 'text_emboss':
      addTextEmboss(model, operation);
      break;
    case 'text_engrave':
      addTextEngrave(model, operation);
      break;
    case 'text_3d':
      addText3d(model, operation);
      break;
    case 'slot':
      addSlot(model, operation);
      break;
    case 'slot_array':
      addSlotArray(model, operation);
      break;
    case 'rib':
      addRib(model, operation);
      break;
    case 'standoff_boss':
      addStandoffBoss(model, operation);
      break;
    case 'button_on_panel':
      addButtonOnPanel(model, operation);
      break;
    case 'image_plane':
      addImagePlane(model, operation);
      break;
    case 'floor_slab':
      addFloorSlab(model, operation);
      break;
    case 'footprint_slab':
      addFootprintSlab(model, operation);
      break;
    case 'wall':
      addWall(model, operation);
      break;
    case 'wall_path':
      addWallPath(model, operation);
      break;
    case 'curved_wall':
      addCurvedWall(model, operation);
      break;
    case 'roof_footprint':
      addRoofFootprint(model, operation);
      break;
    case 'hip_roof':
      addHipRoof(model, operation);
      break;
    case 'parapet_path':
      addParapetPath(model, operation);
      break;
    case 'curtain_wall':
      addCurtainWall(model, operation);
      break;
    case 'column_grid':
      addColumnGrid(model, operation);
      break;
    case 'path_surface':
      addPathSurface(model, operation);
      break;
    case 'terrain_mesh':
      addTerrainMesh(model, operation);
      break;
    case 'parking_stall_array':
      addParkingStallArray(model, operation);
      break;
    case 'door':
      addDoor(model, operation);
      break;
    case 'window':
      addWindow(model, operation);
      break;
    case 'stairs':
      addStairs(model, operation);
      break;
    case 'railing':
      addRailing(model, operation);
      break;
    case 'panel_with_openings':
      addPanelWithOpenings(model, operation);
      break;
    case 'boolean_cutout':
      addBooleanCutout(model, operation);
      break;
    case 'mesh':
      addMesh(model, operation);
      break;
    case 'prism':
      addPrism(model, operation);
      break;
    case 'face_with_holes':
      addFaceWithHoles(model, operation);
      break;
    case 'profile_extrude':
      addProfileExtrude(model, operation);
      break;
    case 'gable_roof':
      addGableRoof(model, operation);
      break;
    case 'shed_roof':
      addShedRoof(model, operation);
      break;
    case 'cylinder':
      addCylinder(model, operation);
      break;
    case 'loft_between_profiles':
      addLoftBetweenProfiles(model, operation);
      break;
    case 'shell_from_front_side_profiles':
      addShellFromFrontSideProfiles(model, operation);
      break;
    case 'lofted_solid':
      addLoftedSolid(model, operation);
      break;
    case 'face_on_cylinder':
      addFaceOnCylinder(model, operation);
      break;
    case 'analog_stick':
      addAnalogStick(model, operation);
      break;
    case 'screw_hole':
      addScrewHole(model, operation);
      break;
    case 'pipe_between_points':
      addPipeBetweenPoints(model, operation);
      break;
    case 'swept_path':
      addSweptPath(model, operation);
      break;
    case 'domed_surface':
      addDomedSurface(model, operation);
      break;
    case 'bowed_panel':
      addBowedPanel(model, operation);
      break;
    default:
      throw new Error(`${componentName}.operations does not support op: ${operation.op}`);
  }
}

export function addComponentInstance(model, operation) {
  const { name, definition, origin = [0, 0, 0] } = operation;
  if (!name || typeof name !== 'string') throw new Error('component_instance operation requires a string name');
  const componentDefinition = model.component_definitions[definition];
  if (!componentDefinition) throw new Error(`${name}.definition not found: ${definition}`);
  const translation = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const box = componentDefinition.bounding_box;
  const corners = boxVertices(box.min, [box.w, box.d, box.h]);
  const transform = operation.transform || {};
  const extraTranslate = normalizeVector(transform.translate ?? transform.translation ?? operation.translation ?? [0, 0, 0], [0, 0, 0], `${name}.transform.translate`);
  const normalizedTransform = normalizeTransform({ transform: { ...transform, translate: [translation[0] + extraTranslate[0], translation[1] + extraTranslate[1], translation[2] + extraTranslate[2]] } }, name);
  const transformedVertices = applyTransform(corners, {
    transform: {
      ...transform,
      translate: [translation[0] + extraTranslate[0], translation[1] + extraTranslate[1], translation[2] + extraTranslate[2]]
    }
  }, name);
  const boundingBox = boundingBoxForVertices(transformedVertices);
  const id = objectId(operation, name);
  assertObjectIdentityAvailable(model, { id, name });
  model.instances.push({
    id,
    name,
    definition,
    faces: componentDefinition.faces,
    edges: componentDefinition.edges,
    material: componentDefinition.material,
    transform: normalizedTransform,
    bounding_box: boundingBox,
    _vertices: transformedVertices,
    _orientation: rotationZMatrix(normalizedTransform.rotateZ || 0),
    qa: normalizeQaMetadata(operation.qa)
  });
}
