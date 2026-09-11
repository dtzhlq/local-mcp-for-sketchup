import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { emptyModel } from './model-state.mjs';
import { addImageReference, setFaceUv } from './appearance-operations.mjs';
import { ensureMaterial } from './material-operations.mjs';
import { addArcCurve, addCurve, addGeometryInput, addMesh, addPrism, addCylinder } from './primitive-operations.mjs';
import { addBooleanCutout, addFaceWithHoles, addGableRoof, addPanelWithOpenings, addProfileExtrude, addShedRoof } from './profile-operations.mjs';
import { addAnalogStick, addBowedPanel, addDomedSurface, addFaceOnCylinder, addLoftBetweenProfiles, addLoftedSolid, addPipeBetweenPoints, addScrewHole, addShellFromFrontSideProfiles, addSweptPath } from './surface-operations.mjs';
import { addBeveledPanel, addBox, addButtonOnPanel, addChamfer, addEngravedLine, addFillet, addImagePlane, addRecess, addRib, addRoundedBox, addSlot, addSlotArray, addStandoffBoss, addText3d, addTextEmboss, addTextEngrave } from './product-operations.mjs';
import { addBoss, addRaisedRib, cutHole, cutRecess, cutSlot } from './feature-operations.mjs';
import { booleanDifference, booleanIntersect, booleanUnion, manifoldCheck, manifoldRepair } from './boolean-operations.mjs';
import { addColumnGrid, addCurvedWall, addCurtainWall, addDoor, addFloorSlab, addFootprintSlab, addHipRoof, addLevel, addParapetPath, addParkingStallArray, addPathSurface, addRailing, addRoofFootprint, addStairs, addTerrainMesh, addWall, addWallPath, addWindow } from './architecture-operations.mjs';
import { addComponentDefinition, addComponentInstance } from './component-operations.mjs';
import { addDemoRoom } from './demo-operations.mjs';
import { addTag, assignTag, deleteObject, duplicateEntity, eraseEntities, explodeEntity, pushpullFace, removeObjectAttribute, renameObject, replaceComponentDefinition, reverseFace, setEdgeProperties, setFaceMaterial, setObjectAttribute, setObjectClassification, setObjectMaterial, setObjectTextureTransform, setObjectVisibility, transformEntities, transformObject } from './object-operations.mjs';
import { mockSessionPath } from './paths.mjs';
import { entityListFromSnapshot, inspectSnapshot, modelInfoFromSnapshot, selectionFromModel, setModelSelection, versionedPath } from './model-inspection.mjs';
import { createSnapshot, mergeBoundingBoxes } from './snapshot.mjs';
import { addScene, setCamera, setRenderingOptions, setShadow, setStyle } from './view-operations.mjs';
import { adoptMockModel } from './model-adoption.mjs';
import { validateCreationScopeAgainstModel } from './agent-dsl-policy.mjs';
import { environmentDefine, environmentUpdate, environmentActivate, styleLoad, styleActivate } from './environment-operations.mjs';
import { sectionPlane, sectionPlaneActivate } from './section-operations.mjs';

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
  constructor({ sessionPath = process.env.ALMA_SKETCHUP_MOCK_SESSION_PATH || mockSessionPath, sourcePath = null, lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS } = {}) {
    this.sessionPath = sessionPath;
    this.sourcePath = typeof sourcePath === 'string' && sourcePath.trim() ? path.resolve(sourcePath) : null;
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
      validateCreationScopeAgainstModel(document, model);

      for (const operation of document.operations) {
        switch (operation.op) {
        case 'environment_define': environmentDefine(model, operation); break;
        case 'environment_update': environmentUpdate(model, operation); break;
        case 'environment_activate': environmentActivate(model, operation); break;
        case 'style_load': styleLoad(model, operation); break;
        case 'style_activate': styleActivate(model, operation); break;
        case 'section_plane': sectionPlane(model, operation); break;
        case 'section_plane_activate': sectionPlaneActivate(model, operation); break;
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
        case 'remove_attribute':
          removeObjectAttribute(model, operation);
          break;
        case 'classification':
          setObjectClassification(model, operation);
          break;
        case 'texture_transform':
          setObjectTextureTransform(model, operation);
          break;
        case 'face_uv':
          setFaceUv(model, operation);
          break;
        case 'image_reference':
          addImageReference(model, operation);
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
        case 'set_face_material':
          setFaceMaterial(model, operation);
          break;
        case 'set_visibility':
          setObjectVisibility(model, operation);
          break;
        case 'transform_object':
          transformObject(model, operation);
          break;
        case 'set_edge_properties':
          setEdgeProperties(model, operation);
          break;
        case 'reverse_face':
          reverseFace(model, operation);
          break;
        case 'pushpull_face':
          pushpullFace(model, operation);
          break;
        case 'duplicate_entity':
          duplicateEntity(model, operation);
          break;
        case 'replace_component_definition':
          replaceComponentDefinition(model, operation);
          break;
        case 'explode_entity':
          explodeEntity(model, operation);
          break;
        case 'erase_entities':
          eraseEntities(model, operation);
          break;
        case 'transform_entities':
          transformEntities(model, operation);
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
        case 'geometry_input':
          addGeometryInput(model, operation);
          break;
        case 'curve':
          addCurve(model, operation);
          break;
        case 'arc_curve':
          addArcCurve(model, operation);
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
        case 'selection':
          setModelSelection(model, { targets: operation.targets || [], mode: operation.mode || 'replace' });
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

  async saveModelVersion({ outputPath, basePath, label, keepSession = true } = {}) {
    const targetPath = versionedPath(outputPath || basePath, {
      defaultBase: path.join('output', 'mock-model.json'),
      label,
      extension: '.json'
    });
    return this.saveModel({ outputPath: targetPath, keepSession });
  }

  async openModel({ inputPath, path: requestedPath } = {}) {
    if (!inputPath && !requestedPath) throw new Error('open_model requires path');
    const targetPath = path.resolve(inputPath || requestedPath);
    return this.withSessionLock(async () => {
      const model = await readMockModelArtifact(targetPath, 'open_model');
      await this.writeModel(model);
      return {
        kind: 'open_model',
        runtime: 'mock',
        file_path: targetPath,
        snapshot: createSnapshot(model)
      };
    });
  }

  async importModel({ inputPath, path: requestedPath, mode = 'append', prefix, options = {} } = {}) {
    if (!inputPath && !requestedPath) throw new Error('import_model requires path');
    const targetPath = path.resolve(inputPath || requestedPath);
    return this.withSessionLock(async () => {
      const imported = await readMockModelArtifact(targetPath, 'import_model');
      let model = await this.readModel();
      const normalizedMode = String(mode || 'append').toLowerCase();
      if (!['append', 'replace'].includes(normalizedMode)) throw new Error('import_model.mode must be append or replace');
      let importResult;
      if (options.preserve_root === true) {
        const preserved = appendImportedRoot(normalizedMode === 'replace' ? emptyModel() : model, imported, {
          prefix: prefix || path.basename(targetPath, path.extname(targetPath)),
          id: options.id,
          sourcePath: targetPath
        });
        model = preserved.model;
        importResult = preserved.import;
      } else if (normalizedMode === 'replace') {
        model = imported;
      } else if (normalizedMode === 'append') {
        model = appendImportedModel(model, imported, { prefix: prefix || path.basename(targetPath, path.extname(targetPath)) });
      } else {
        throw new Error('import_model.mode must be append or replace');
      }
      await this.writeModel(model);
      return {
        kind: 'import_model',
        runtime: 'mock',
        file_path: targetPath,
        mode: normalizedMode,
        ...(importResult ? { import: importResult } : {}),
        snapshot: createSnapshot(model)
      };
    });
  }

  async exportModel({ outputPath, path: requestedPath, format = 'mock_json' } = {}) {
    const normalizedFormat = String(format || 'mock_json').toLowerCase();
    if (!['mock_json', 'json'].includes(normalizedFormat)) {
      throw new Error('mock export_model supports format mock_json/json only');
    }
    return this.withSessionLock(async () => {
      const model = await this.readModel();
      const targetPath = path.resolve(outputPath || requestedPath || path.join('output', 'mock-export.json'));
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, `${JSON.stringify({ model, snapshot: createSnapshot(model), format: normalizedFormat }, null, 2)}\n`, 'utf8');
      const stats = await fs.stat(targetPath);
      return {
        kind: 'export_model',
        runtime: 'mock',
        format: normalizedFormat,
        file_path: targetPath,
        file_size_bytes: stats.size,
        snapshot: createSnapshot(model)
      };
    });
  }

  async inspectModel(options = {}) {
    return this.withSessionLock(async () => {
      const model = await this.readModel();
      return inspectSnapshot(createSnapshot(model), {
        ...options,
        runtime: 'mock',
        selection: selectionFromModel(model)
      });
    });
  }

  async listEntities(options = {}) {
    return this.withSessionLock(async () => {
      const snapshot = createSnapshot(await this.readModel());
      return {
        kind: 'list_entities',
        runtime: 'mock',
        entities: entityListFromSnapshot(snapshot, options)
      };
    });
  }

  async getModelInfo() {
    return this.withSessionLock(async () => {
      return modelInfoFromSnapshot(createSnapshot(await this.readModel()), { runtime: 'mock' });
    });
  }

  async adoptOpenModel(options = {}) {
    return this.withSessionLock(async () => {
      const model = await this.readModel();
      const workingModel = options.read_only === true || options.readOnly === true ? structuredClone(model) : model;
      const report = adoptMockModel(workingModel, options);
      if (workingModel === model) await this.writeModel(model);
      const mockDocumentFingerprint = crypto.createHash('sha256').update(path.resolve(this.sessionPath)).digest('hex');
      return {
        ...report,
        read_only: workingModel !== model,
        model_identity: {
          model_guid: `mock_${mockDocumentFingerprint}`,
          runtime_object_id: null,
          title: 'mock_session',
          source_path: this.sourcePath
        },
        document_id: `mock_document_${mockDocumentFingerprint}`
      };
    });
  }

  async getSelection() {
    return this.withSessionLock(async () => {
      return {
        kind: 'get_selection',
        runtime: 'mock',
        selection: selectionFromModel(await this.readModel())
      };
    });
  }

  async setSelection({ targets = [], mode = 'replace' } = {}) {
    return this.withSessionLock(async () => {
      const model = await this.readModel();
      const selection = setModelSelection(model, { targets, mode });
      await this.writeModel(model);
      return {
        kind: 'set_selection',
        runtime: 'mock',
        mode,
        selection,
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

async function readMockModelArtifact(filePath, operationName) {
  if (!filePath) throw new Error(`${operationName} requires path`);
  const document = JSON.parse(await fs.readFile(filePath, 'utf8'));
  const model = document.model || document;
  if (!model || typeof model !== 'object' || !Array.isArray(model.groups)) {
    throw new Error(`${operationName} mock runtime can open/import only mock model JSON artifacts with a model.groups array`);
  }
  return normalizeImportedModel(structuredClone(model));
}

function normalizeImportedModel(model) {
  return {
    ...emptyModel(),
    ...model,
    groups: model.groups || [],
    instances: model.instances || [],
    component_definitions: model.component_definitions || {},
    classification_schemas: model.classification_schemas || [],
    materials: model.materials || {},
    tags: model.tags || {},
    image_references: model.image_references || {},
    selection: []
  };
}

function appendImportedModel(model, imported, { prefix }) {
  const result = normalizeImportedModel(structuredClone(model));
  const importedModel = normalizeImportedModel(structuredClone(imported));
  Object.assign(result.materials, importedModel.materials);
  Object.assign(result.tags, importedModel.tags);
  Object.assign(result.image_references, importedModel.image_references);
  result.classification_schemas = [...new Map([
    ...(result.classification_schemas || []),
    ...(importedModel.classification_schemas || [])
  ].map((schema) => [JSON.stringify(schema), schema])).values()];
  for (const [definitionName, definition] of Object.entries(importedModel.component_definitions || {})) {
    const nextName = uniqueName(definitionName, new Set(Object.keys(result.component_definitions || {})), prefix);
    result.component_definitions[nextName] = { ...definition, name: nextName };
  }
  const usedIds = new Set([...result.groups, ...(result.instances || [])].map((item) => item.id || item.name));
  const usedNames = new Set([...result.groups, ...(result.instances || [])].map((item) => item.name));
  for (const group of importedModel.groups || []) {
    result.groups.push(renameImportedObject(group, usedIds, usedNames, prefix));
  }
  for (const instance of importedModel.instances || []) {
    result.instances ||= [];
    result.instances.push(renameImportedObject(instance, usedIds, usedNames, prefix));
  }
  return result;
}

// Component import has its own collision-safe path. Legacy exploded append is unchanged.
function appendImportedRoot(model, imported, { prefix, id, sourcePath }) {
  const result = normalizeImportedModel(structuredClone(model));
  const source = normalizeImportedModel(structuredClone(imported));
  for (const container of [source, ...Object.values(source.component_definitions)]) {
    for (const instance of container.instances || []) {
      if (!Object.hasOwn(source.component_definitions, instance.definition)) throw new Error(`import_model definition not found in asset: ${instance.definition}`);
    }
  }
  const maps = { definitions: {}, materials: {}, tags: {}, image_references: {}, entity_ids: {} };
  for (const [collection, mapKey] of [['component_definitions', 'definitions'], ['materials', 'materials'], ['tags', 'tags'], ['image_references', 'image_references']]) {
    const used = new Set(Object.keys(result[collection]));
    for (const name of Object.keys(source[collection])) {
      const renamed = uniqueName(name, used, prefix);
      used.add(renamed);
      maps[mapKey][name] = renamed;
    }
  }

  const usedIds = new Set();
  const usedNames = new Set();
  const collectIdentities = (container) => {
    for (const item of [...(container.groups || []), ...(container.instances || [])]) {
      usedIds.add(item.id || item.name); usedNames.add(item.name);
    }
  };
  collectIdentities(result);
  Object.values(result.component_definitions).forEach(collectIdentities);
  const rootDefinitionName = uniqueName(`${prefix || 'Imported'}_Root`, new Set([...Object.keys(result.component_definitions), ...Object.values(maps.definitions)]), prefix);
  const rootId = uniqueName(id || `${prefix || 'Imported'}_root`, usedIds, prefix);
  const rootName = uniqueName(prefix || 'Imported', usedNames, prefix);
  usedIds.add(rootId); usedNames.add(rootName);
  const remapContainer = (container, scope) => {
    const ids = new Set();
    const names = new Set();
    maps.entity_ids[scope] = {};
    for (const item of [...(container.groups || []), ...(container.instances || [])]) {
      const originalId = item.id || item.name;
      if (!originalId || !item.name || ids.has(originalId) || names.has(item.name)) throw new Error(`import_model has missing or duplicate entity identity in ${scope}`);
      ids.add(originalId); names.add(item.name);
      item.id = uniqueName(originalId, usedIds, prefix); usedIds.add(item.id);
      item.name = uniqueName(item.name, usedNames, prefix); usedNames.add(item.name);
      maps.entity_ids[scope][originalId] = item.id;
      // Runtime persistent IDs belong to the source document and cannot identify the new object.
      delete item.persistent_id;
      delete item.guid;
    }
    return remapImportedResources(container, maps);
  };

  for (const [collection, mapKey] of [['materials', 'materials'], ['tags', 'tags'], ['image_references', 'image_references']]) {
    for (const [name, value] of Object.entries(source[collection])) {
      const renamed = maps[mapKey][name];
      result[collection][renamed] = typeof value === 'object' && value !== null ? { ...structuredClone(value), name: renamed } : structuredClone(value);
    }
  }
  for (const [name, definition] of Object.entries(source.component_definitions)) {
    const remapped = remapContainer(definition, `definition:${name}`);
    delete remapped.persistent_id;
    result.component_definitions[maps.definitions[name]] = { ...remapped, name: maps.definitions[name] };
  }
  const top = remapContainer({ groups: source.groups, instances: source.instances }, 'model');
  const completed = new Set();
  const visiting = new Set();
  const summarize = (container) => {
    for (const instance of container.instances || []) {
      const definition = result.component_definitions[instance.definition];
      if (!definition || !Object.values(maps.definitions).includes(instance.definition)) throw new Error(`import_model definition not found in asset: ${instance.definition}`);
      if (visiting.has(instance.definition)) throw new Error(`import_model component definitions contain a cycle: ${instance.definition}`);
      if (!completed.has(instance.definition)) {
        visiting.add(instance.definition);
        // Size-only legacy component definitions keep their stored primitive totals.
        if ((definition.groups || []).length || (definition.instances || []).length) Object.assign(definition, summarize(definition));
        visiting.delete(instance.definition); completed.add(instance.definition);
      }
      instance.faces = definition.faces; instance.edges = definition.edges;
    }
    const items = [...(container.groups || []), ...(container.instances || [])];
    return { faces: items.reduce((n, item) => n + (item.faces || 0), 0), edges: items.reduce((n, item) => n + (item.edges || 0), 0), bounding_box: mergeBoundingBoxes(items.map(item => item.bounding_box)) };
  };
  const summary = summarize(top);
  result.component_definitions[rootDefinitionName] = {
    name: rootDefinitionName, groups: top.groups, instances: top.instances,
    ...summary, material: null,
    import_source: { path: sourcePath, runtime: 'mock', native_geometry_verified: false }
  };
  result.classification_schemas = [...new Map([...(result.classification_schemas || []), ...(source.classification_schemas || [])].map(schema => [JSON.stringify(schema), schema])).values()];
  addComponentInstance(result, { id: rootId, name: rootName, definition: rootDefinitionName, origin: [0, 0, 0] });
  return { model: result, import: {
    strategy: 'mock_component_definition+component_instance', root_preserved: true,
    definition: rootDefinitionName, instance_id: rootId, bounding_box: summary.bounding_box,
    identity_map: maps, native_geometry_verified: false
  } };
}

function remapImportedResources(value, maps) {
  if (Array.isArray(value)) return value.map(item => remapImportedResources(item, maps));
  if (!value || typeof value !== 'object') return value;
  const fields = { definition: 'definitions', material: 'materials', back_material: 'materials', frame_material: 'materials', panel_material: 'materials', tag: 'tags', image_reference: 'image_references' };
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (fields[key] && typeof child === 'string') return [key, maps[fields[key]][child] || child];
    // Free-form user attributes and provenance strings are data, not resource references.
    if (['attributes', 'attribute_dictionaries', 'definition_attribute_dictionaries', 'metadata'].includes(key)) return [key, structuredClone(child)];
    return [key, remapImportedResources(child, maps)];
  }));
}

function renameImportedObject(object, usedIds, usedNames, prefix) {
  const clone = structuredClone(object);
  clone.id = uniqueName(clone.id || clone.name, usedIds, prefix);
  clone.name = uniqueName(clone.name, usedNames, prefix);
  usedIds.add(clone.id);
  usedNames.add(clone.name);
  return clone;
}

function uniqueName(value, used, prefix) {
  const base = String(value || 'Imported');
  if (!used.has(base)) return base;
  const safePrefix = String(prefix || 'import').replace(/[^a-z0-9_-]+/gi, '_') || 'import';
  let candidate = `${safePrefix}_${base}`;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${safePrefix}_${base}_${index}`;
    index += 1;
  }
  return candidate;
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
