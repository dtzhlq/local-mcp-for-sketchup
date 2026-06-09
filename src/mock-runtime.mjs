import fs from 'node:fs/promises';
import path from 'node:path';
import { emptyModel } from './model-state.mjs';
import { ensureMaterial } from './material-operations.mjs';
import { addMesh, addPrism, addCylinder } from './primitive-operations.mjs';
import { addBooleanCutout, addFaceWithHoles, addGableRoof, addPanelWithOpenings, addProfileExtrude, addShedRoof } from './profile-operations.mjs';
import { addAnalogStick, addBowedPanel, addDomedSurface, addFaceOnCylinder, addLoftBetweenProfiles, addLoftedSolid, addPipeBetweenPoints, addScrewHole, addShellFromFrontSideProfiles, addSweptPath } from './surface-operations.mjs';
import { addBeveledPanel, addBox, addButtonOnPanel, addChamfer, addEngravedLine, addFillet, addImagePlane, addRecess, addRib, addRoundedBox, addSlot, addSlotArray, addStandoffBoss, addText3d, addTextEmboss, addTextEngrave } from './product-operations.mjs';
import { addBoss, addRaisedRib, cutHole, cutRecess, cutSlot } from './feature-operations.mjs';
import { booleanDifference, booleanIntersect, booleanUnion, manifoldCheck, manifoldRepair } from './boolean-operations.mjs';
import { addColumnGrid, addCurvedWall, addCurtainWall, addDoor, addFloorSlab, addFootprintSlab, addHipRoof, addLevel, addParapetPath, addParkingStallArray, addPathSurface, addRailing, addRoofFootprint, addStairs, addTerrainMesh, addWall, addWallPath, addWindow } from './architecture-operations.mjs';
import { addComponentDefinition, addComponentInstance } from './component-operations.mjs';
import { addDemoRoom } from './demo-operations.mjs';
import { addTag, assignTag, deleteObject, renameObject, setObjectAttribute, setObjectClassification, setObjectMaterial, setObjectTextureTransform, setObjectVisibility, transformObject } from './object-operations.mjs';
import { mockSessionPath } from './paths.mjs';
import { createSnapshot } from './snapshot.mjs';
import { addScene, setCamera, setRenderingOptions, setShadow, setStyle } from './view-operations.mjs';

const DEFAULT_OPERATION_LIMIT = 2000;
const DEFAULT_LOCK_TIMEOUT_MS = 30000;
const STALE_LOCK_MS = 60000;

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
  constructor({ sessionPath = process.env.ALMA_SKETCHUP_MOCK_SESSION_PATH || mockSessionPath, lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS } = {}) {
    this.sessionPath = sessionPath;
    this.lockPath = `${sessionPath}.lock`;
    this.lockTimeoutMs = lockTimeoutMs;
  }

  async resetModel() {
    return this.withSessionLock(async () => {
      const model = emptyModel();
      await this.writeModel(model);
      return createSnapshot(model);
    });
  }

  async buildModel(code) {
    return this.withSessionLock(async () => {
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
        case 'tag':
          addTag(model, operation);
          break;
        case 'assign_tag':
          assignTag(model, operation);
          break;
        case 'attribute':
          setObjectAttribute(model, operation);
          break;
        case 'classification':
          setObjectClassification(model, operation);
          break;
        case 'texture_transform':
          setObjectTextureTransform(model, operation);
          break;
        case 'uv_project_planar':
          setObjectTextureTransform(model, { ...operation, projection: 'planar' });
          break;
        case 'uv_project_box':
          setObjectTextureTransform(model, { ...operation, projection: 'box' });
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
        case 'cut_hole':
          cutHole(model, operation);
          break;
        case 'cut_slot':
          cutSlot(model, operation);
          break;
        case 'cut_recess':
          cutRecess(model, operation);
          break;
        case 'add_boss':
          addBoss(model, operation);
          break;
        case 'add_raised_rib':
          addRaisedRib(model, operation);
          break;
        case 'boolean_union':
          booleanUnion(model, operation);
          break;
        case 'boolean_difference':
          booleanDifference(model, operation);
          break;
        case 'boolean_intersect':
          booleanIntersect(model, operation);
          break;
        case 'manifold_check':
          manifoldCheck(model, operation);
          break;
        case 'manifold_repair':
          manifoldRepair(model, operation);
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
    });
  }

  async saveModel({ outputPath, keepSession = true } = {}) {
    return this.withSessionLock(async () => {
      const model = await this.readModel();
      const targetPath = path.resolve(outputPath || path.join('output', 'mock-model.json'));
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, `${JSON.stringify({ model, snapshot: createSnapshot(model) }, null, 2)}\n`, 'utf8');
      const stats = await fs.stat(targetPath);
      if (!keepSession) {
        await this.writeModel(emptyModel());
      }
      return {
        file_path: targetPath,
        file_size_bytes: stats.size,
        snapshot: createSnapshot(model)
      };
    });
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
    await fs.mkdir(path.dirname(this.sessionPath), { recursive: true });
    const tmpPath = `${this.sessionPath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
    await fs.rename(tmpPath, this.sessionPath);
  }

  async withSessionLock(callback) {
    await fs.mkdir(path.dirname(this.sessionPath), { recursive: true });
    const startedAt = Date.now();
    while (true) {
      let handle;
      try {
        handle = await fs.open(this.lockPath, 'wx');
        await handle.writeFile(JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }));
        await handle.close();
        break;
      } catch (error) {
        if (handle) await handle.close().catch(() => {});
        if (error.code !== 'EEXIST') throw error;
        await this.removeStaleLock();
        if (Date.now() - startedAt > this.lockTimeoutMs) {
          throw new Error(`Timed out waiting for mock runtime session lock: ${this.lockPath}`);
        }
        await sleep(50);
      }
    }

    try {
      return await callback();
    } finally {
      await fs.rm(this.lockPath, { force: true });
    }
  }

  async removeStaleLock() {
    try {
      const stats = await fs.stat(this.lockPath);
      if (Date.now() - stats.mtimeMs > STALE_LOCK_MS) {
        await fs.rm(this.lockPath, { force: true });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
