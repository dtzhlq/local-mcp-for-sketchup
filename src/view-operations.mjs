import { nonEmptyString, normalizeBoolean, normalizeCamera, normalizeColor, normalizeKeyword, optionalNumberInRange, positiveNumber } from './operation-utils.mjs';

export function setCamera(model, { eye, target, up = [0, 0, 1], fov = 35 }) {
  model.view_state = {
    camera: normalizeCamera({ eye, target, up, fov }, 'camera')
  };
}

export function addScene(model, operation = {}) {
  const { name, camera } = operation;
  if (!name || typeof name !== 'string') throw new Error('scene operation requires a string name');
  const scene = { name };
  if (camera) scene.camera = normalizeCamera(camera, `${name}.camera`);
  const transitionTime = operation.transition_time ?? operation.transitionTime;
  if (transitionTime !== undefined) scene.transition_time = optionalNumberInRange(transitionTime, -1, 3600, `${name}.transition_time`);
  const useCamera = operation.use_camera ?? operation.useCamera;
  if (useCamera !== undefined) scene.use_camera = normalizeBoolean(useCamera, `${name}.use_camera`);
  const layerVisibility = operation.layer_visibility ?? operation.layerVisibility;
  if (layerVisibility !== undefined) scene.layer_visibility = normalizeSceneVisibility(layerVisibility, `${name}.layer_visibility`);
  const drawingelementVisibility = operation.drawingelement_visibility ?? operation.drawingElementVisibility;
  if (drawingelementVisibility !== undefined) scene.drawingelement_visibility = normalizeSceneObjectVisibility(drawingelementVisibility, `${name}.drawingelement_visibility`);
  const renderingOptions = operation.rendering_options ?? operation.renderingOptions;
  if (renderingOptions !== undefined) scene.rendering_options = normalizeRenderingOptions(stripOperationField(renderingOptions));
  const shadow = operation.shadow ?? operation.shadow_info ?? operation.shadowInfo;
  if (shadow !== undefined) scene.shadow = normalizeShadow(stripOperationField(shadow));
  const style = operation.style;
  if (style !== undefined) scene.style = normalizeStyle(stripOperationField(style));
  const updateFlags = operation.update_flags ?? operation.updateFlags;
  if (updateFlags !== undefined) scene.update_flags = Number(updateFlags);
  model.scenes.push(scene);
  if (scene.camera) model.view_state = { camera: scene.camera, scene: name };
}

export function setStyle(model, operation = {}) {
  const style = normalizeStyle(operation);
  model.style_state = style;
}

function normalizeStyle(operation = {}) {
  const style = {};
  if (operation.name !== undefined) style.name = nonEmptyString(operation.name, 'style.name');
  assignBoolean(style, operation, 'display_edges', 'style.display_edges');
  assignBoolean(style, operation, 'profiles', 'style.profiles');
  assignBoolean(style, operation, 'display_watermarks', 'style.display_watermarks');
  assignBoolean(style, operation, 'draw_ground', 'style.draw_ground');
  assignBoolean(style, operation, 'draw_sky', 'style.draw_sky');
  if (operation.profile_width !== undefined || operation.profileWidth !== undefined) {
    style.profile_width = positiveNumber(operation.profile_width ?? operation.profileWidth, undefined, 'style.profile_width');
  }
  if (operation.face_style !== undefined || operation.faceStyle !== undefined) {
    style.face_style = normalizeKeyword(operation.face_style ?? operation.faceStyle, ['wireframe', 'hidden_line', 'shaded', 'shaded_with_textures', 'monochrome'], 'style.face_style');
  }
  assignColor(style, operation, 'background_color', 'style.background_color');
  assignColor(style, operation, 'sky_color', 'style.sky_color');
  assignColor(style, operation, 'ground_color', 'style.ground_color');
  return style;
}

export function setShadow(model, operation = {}) {
  model.shadow_state = normalizeShadow(operation);
}

function normalizeShadow(operation = {}) {
  const shadow = {};
  assignBoolean(shadow, operation, 'display', 'shadow.display');
  if (operation.time !== undefined) {
    const time = new Date(operation.time);
    if (Number.isNaN(time.getTime())) throw new Error('shadow.time must be an ISO-8601 date/time string');
    shadow.time = time.toISOString();
  }
  if (operation.light !== undefined) shadow.light = optionalNumberInRange(operation.light, 0, 100, 'shadow.light');
  if (operation.dark !== undefined) shadow.dark = optionalNumberInRange(operation.dark, 0, 100, 'shadow.dark');
  if (operation.use_sun_for_shading !== undefined || operation.useSunForShading !== undefined) {
    shadow.use_sun_for_shading = normalizeBoolean(operation.use_sun_for_shading ?? operation.useSunForShading, 'shadow.use_sun_for_shading');
  }
  return shadow;
}

export function setRenderingOptions(model, operation = {}) {
  model.rendering_options = normalizeRenderingOptions(operation);
}

function normalizeRenderingOptions(operation = {}) {
  const options = {};
  assignRenderingBoolean(options, operation, 'draw_hidden_geometry', 'drawHiddenGeometry');
  assignRenderingBoolean(options, operation, 'display_color_by_layer', 'displayColorByLayer');
  assignRenderingBoolean(options, operation, 'transparency');
  assignRenderingBoolean(options, operation, 'draw_back_edges', 'drawBackEdges');
  assignRenderingBoolean(options, operation, 'draw_hidden', 'drawHidden');
  assignRenderingBoolean(options, operation, 'draw_ground', 'drawGround');
  assignRenderingBoolean(options, operation, 'draw_horizon', 'drawHorizon');
  assignRenderingNumber(options, operation, 'edge_display_mode', 'edgeDisplayMode', 0, 10);
  assignRenderingNumber(options, operation, 'render_mode', 'renderMode', 0, 10);
  assignRenderingNumber(options, operation, 'face_color_mode', 'faceColorMode', 0, 10);
  assignRenderingNumber(options, operation, 'model_transparency', 'modelTransparency', 0, 3);
  assignRenderingNumber(options, operation, 'material_transparency', 'materialTransparency', 0, 3);
  assignRenderingColor(options, operation, 'background_color', 'backgroundColor');
  assignRenderingColor(options, operation, 'sky_color', 'skyColor');
  assignRenderingColor(options, operation, 'ground_color', 'groundColor');
  return options;
}

function normalizeSceneVisibility(entries, fieldName) {
  if (!Array.isArray(entries)) throw new Error(`${fieldName} must be an array`);
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${fieldName}[${index}] must be an object`);
    const layer = entry.layer ?? entry.tag ?? entry.name;
    if (!layer || typeof layer !== 'string') throw new Error(`${fieldName}[${index}].layer must be a string`);
    return {
      layer,
      visible: normalizeBoolean(entry.visible, `${fieldName}[${index}].visible`)
    };
  });
}

function normalizeSceneObjectVisibility(entries, fieldName) {
  if (!Array.isArray(entries)) throw new Error(`${fieldName} must be an array`);
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${fieldName}[${index}] must be an object`);
    const target = entry.target_id ?? entry.targetId ?? entry.id ?? entry.object_id ?? entry.objectId ?? entry.guid;
    const name = entry.name ?? entry.target ?? entry.object;
    if (target === undefined && name === undefined) throw new Error(`${fieldName}[${index}] requires target_id or name`);
    return {
      ...(target !== undefined ? { target_id: String(target) } : {}),
      ...(name !== undefined ? { name: String(name) } : {}),
      visible: normalizeBoolean(entry.visible, `${fieldName}[${index}].visible`)
    };
  });
}

function stripOperationField(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const { op: _op, ...rest } = value;
  return rest;
}

function assignBoolean(target, source, field, fieldName) {
  if (source[field] !== undefined) target[field] = normalizeBoolean(source[field], fieldName);
}

function assignColor(target, source, field, fieldName) {
  const camel = field.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
  const value = source[field] ?? source[camel];
  if (value !== undefined) target[field] = normalizeColor(value, fieldName);
}

function assignRenderingBoolean(target, source, field, alias = field) {
  const value = source[field] ?? source[alias];
  if (value !== undefined) target[field] = normalizeBoolean(value, `rendering_options.${field}`);
}

function assignRenderingNumber(target, source, field, alias, min, max) {
  const value = source[field] ?? source[alias];
  if (value !== undefined) target[field] = optionalNumberInRange(value, min, max, `rendering_options.${field}`);
}

function assignRenderingColor(target, source, field, alias) {
  const value = source[field] ?? source[alias];
  if (value !== undefined) target[field] = normalizeColor(value, `rendering_options.${field}`);
}
