import fs from 'node:fs/promises';
import path from 'node:path';
import { emptyModel, ensureMaterial, addLevel, addBox, addRoundedBox, addBeveledPanel, addFillet, addChamfer, addRecess, addEngravedLine, addTextEmboss, addTextEngrave, addSlot, addSlotArray, addRib, addStandoffBoss, addButtonOnPanel, addFloorSlab, addWall, addDoor, addWindow, addStairs, addRailing, addPanelWithOpenings, addBooleanCutout, addMesh, addPrism, addFaceWithHoles, addProfileExtrude, addGableRoof, addShedRoof, addCylinder, addLoftBetweenProfiles, addShellFromFrontSideProfiles, addLoftedSolid, addFaceOnCylinder, addAnalogStick, addScrewHole, addPipeBetweenPoints, addSweptPath, addDomedSurface, addBowedPanel, addComponentDefinition, addComponentInstance, deleteObject, renameObject, setObjectMaterial, setObjectVisibility, transformObject, setCamera, addScene, setStyle, setShadow, setRenderingOptions, addDemoRoom, createSnapshot } from './geometry.mjs';
import { mockSessionPath, sessionDir } from './paths.mjs';

const DEFAULT_OPERATION_LIMIT = 2000;

function operationLimit() {
  const raw = process.env.ALMA_SKETCHUP_MAX_OPERATIONS;
  if (!raw) return DEFAULT_OPERATION_LIMIT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('ALMA_SKETCHUP_MAX_OPERATIONS must be a positive integer');
  }
  return parsed;
}

export class MockRuntime {
  constructor({ sessionPath = mockSessionPath } = {}) {
    this.sessionPath = sessionPath;
  }

  async resetModel() {
    const model = emptyModel();
    await this.writeModel(model);
    return createSnapshot(model);
  }

  async buildModel(code) {
    const document = parseDsl(code);
    let model = await this.readModel();

    for (const operation of document.operations) {
      switch (operation.op) {
        case 'reset':
          model = emptyModel();
          break;
        case 'material':
          ensureMaterial(model, operation);
          break;
        case 'delete':
          deleteObject(model, operation);
          break;
        case 'rename':
          renameObject(model, operation);
          break;
        case 'set_material':
          setObjectMaterial(model, operation);
          break;
        case 'set_visibility':
          setObjectVisibility(model, operation);
          break;
        case 'transform_object':
          transformObject(model, operation);
          break;
        case 'level':
          addLevel(model, operation);
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
        case 'floor_slab':
          addFloorSlab(model, operation);
          break;
        case 'wall':
          addWall(model, operation);
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
        case 'component_definition':
          addComponentDefinition(model, operation);
          break;
        case 'component_instance':
          addComponentInstance(model, operation);
          break;
        case 'camera':
          setCamera(model, operation);
          break;
        case 'scene':
          addScene(model, operation);
          break;
        case 'style':
          setStyle(model, operation);
          break;
        case 'shadow':
          setShadow(model, operation);
          break;
        case 'rendering_options':
          setRenderingOptions(model, operation);
          break;
        case 'room':
          addDemoRoom(model, operation);
          break;
        default:
          throw new Error(`Unsupported operation: ${operation.op}`);
      }
    }

    await this.writeModel(model);
    return createSnapshot(model);
  }

  async saveModel({ outputPath, keepSession = true } = {}) {
    const model = await this.readModel();
    const targetPath = path.resolve(outputPath || path.join('output', 'mock-model.json'));
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, `${JSON.stringify({ model, snapshot: createSnapshot(model) }, null, 2)}\n`, 'utf8');
    const stats = await fs.stat(targetPath);
    if (!keepSession) {
      await this.resetModel();
    }
    return {
      file_path: targetPath,
      file_size_bytes: stats.size,
      snapshot: createSnapshot(model)
    };
  }

  async readModel() {
    try {
      const raw = await fs.readFile(this.sessionPath, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT') return emptyModel();
      throw error;
    }
  }

  async writeModel(model) {
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(this.sessionPath, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
  }
}

export function parseDsl(code) {
  if (typeof code !== 'string' || !code.trim()) {
    throw new Error('build_model requires a non-empty JSON DSL string');
  }

  let document;
  try {
    document = JSON.parse(code);
  } catch (error) {
    throw new Error(`build_model accepts JSON DSL only: ${error.message}`);
  }

  if (document.version !== 1) {
    throw new Error('DSL version must be 1');
  }
  if (document.units && document.units !== 'mm') {
    throw new Error('Only millimeter units are supported in the MVP');
  }
  if (!Array.isArray(document.operations)) {
    throw new Error('DSL requires operations array');
  }
  const maxOperations = operationLimit();
  if (document.operations.length > maxOperations) {
    throw new Error(`DSL operation limit exceeded: max ${maxOperations} operations. Set ALMA_SKETCHUP_MAX_OPERATIONS to raise this for trusted large models.`);
  }
  for (const [index, operation] of document.operations.entries()) {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
      throw new Error(`operations[${index}] must be an object`);
    }
    if (typeof operation.op !== 'string') {
      throw new Error(`operations[${index}].op must be a string`);
    }
  }
  return document;
}
