import { nonEmptyString, normalizeBoolean, normalizeCamera, normalizeColor, normalizeKeyword, optionalNumberInRange, positiveNumber } from './operation-utils.mjs';

export function setCamera(model, { eye, target, up = [0, 0, 1], fov = 35 }) {
  model.view_state = {
    camera: normalizeCamera({ eye, target, up, fov }, 'camera')
  };
}

export function addScene(model, { name, camera }) {
  if (!name || typeof name !== 'string') throw new Error('scene operation requires a string name');
  const scene = { name };
  if (camera) scene.camera = normalizeCamera(camera, `${name}.camera`);
  model.scenes.push(scene);
  if (scene.camera) model.view_state = { camera: scene.camera, scene: name };
}

export function setStyle(model, operation = {}) {
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
  model.style_state = style;
}

export function setShadow(model, operation = {}) {
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
  model.shadow_state = shadow;
}

export function setRenderingOptions(model, operation = {}) {
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
  model.rendering_options = options;
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
