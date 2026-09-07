import path from 'node:path';
import { nonEmptyString, normalizeBoolean, optionalNumberInRange } from './operation-utils.mjs';

const NUMBER_FIELDS = { rotation: [0, 360], skydome_exposure: [0, 20], reflection_exposure: [0, 10] };
const BOOLEAN_FIELDS = ['use_as_skydome', 'use_for_reflections', 'linked_sun'];

export function normalizeAppearanceAssetPath(value, extensions, field) {
  const assetPath = nonEmptyString(value, field).trim();
  const windowsDrive = /^[a-z]:[\\/]/i.test(assetPath);
  if ((!windowsDrive && /^[a-z][a-z0-9+.-]*:/i.test(assetPath)) || /[\0\r\n]/.test(assetPath)) throw new Error(`${field} must be a local asset path`);
  if (!extensions.includes(path.extname(assetPath).toLowerCase())) throw new Error(`${field} must use ${extensions.join(', ')}`);
  return assetPath;
}

export function normalizeEnvironmentSettings(operation = {}) {
  const settings = {};
  for (const [field, [min, max]] of Object.entries(NUMBER_FIELDS)) {
    if (operation[field] !== undefined) settings[field] = optionalNumberInRange(operation[field], min, max, `environment.${field}`);
  }
  for (const field of BOOLEAN_FIELDS) {
    if (operation[field] !== undefined) settings[field] = normalizeBoolean(operation[field], `environment.${field}`);
  }
  if (operation.description !== undefined) {
    if (typeof operation.description !== 'string') throw new Error('environment.description must be a string');
    settings.description = operation.description;
  }
  if (operation.linked_sun_position !== undefined) {
    const value = operation.linked_sun_position;
    if (!Array.isArray(value) || ![2, 3].includes(value.length)) throw new Error('environment.linked_sun_position must be [u, v] or [u, v, 0]');
    if (value.length === 3 && value[2] !== 0) throw new Error('environment.linked_sun_position[2] must be 0');
    settings.linked_sun_position = [
      optionalNumberInRange(value[0], 0, 1, 'environment.linked_sun_position[0]'),
      optionalNumberInRange(value[1], -1, 1, 'environment.linked_sun_position[1]'), 0
    ];
  }
  return settings;
}

export function environmentDefine(model, operation) {
  const name = nonEmptyString(operation.name, 'environment_define.name');
  const id = nonEmptyString(operation.id ?? name, 'environment_define.id');
  const assetPath = normalizeAppearanceAssetPath(operation.path, ['.hdr', '.exr', '.ske'], 'environment_define.path');
  const settings = normalizeEnvironmentSettings(operation);
  model.environments ||= [];
  if (model.environments.some((entry) => entry.name === name || entry.id === id)) throw new Error('environment_define identity already exists');
  const environment = { id, name, path: assetPath, rotation: 0, skydome_exposure: 1, reflection_exposure: 1,
    use_as_skydome: true, use_for_reflections: true, linked_sun: false, ...settings, evidence: 'mock' };
  model.environments.push(environment);
  return environment;
}

export function resolveEnvironment(model, reference) {
  const ref = nonEmptyString(reference, 'environment_ref');
  const matches = (model.environments || []).filter((entry) => entry.id === ref || entry.name === ref);
  if (matches.length !== 1) throw new Error(`environment_ref must resolve uniquely: ${ref}`);
  return matches[0];
}

export function environmentUpdate(model, operation) {
  if (operation.path !== undefined) throw new Error('environment_update cannot replace an asset; define a new environment');
  const environment = resolveEnvironment(model, operation.environment_ref);
  Object.assign(environment, normalizeEnvironmentSettings(operation));
  return environment;
}

export function environmentActivate(model, operation) {
  if (!Object.hasOwn(operation, 'environment_ref')) throw new Error('environment_activate requires environment_ref (null disables the environment)');
  model.current_environment = operation.environment_ref === null ? null : resolveEnvironment(model, operation.environment_ref).id;
  return model.current_environment;
}

export function styleLoad(model, operation) {
  const name = nonEmptyString(operation.name, 'style_load.name');
  const assetPath = normalizeAppearanceAssetPath(operation.path, ['.style'], 'style_load.path');
  const activate = operation.activate === undefined || normalizeBoolean(operation.activate, 'style_load.activate');
  const capture = operation.capture_current_display === undefined ? false : normalizeBoolean(operation.capture_current_display, 'style_load.capture_current_display');
  if (capture && !activate) throw new Error('style_load capture_current_display requires activate');
  model.native_styles ||= [];
  if (model.native_styles.some((entry) => entry.name === name)) throw new Error(`style_load identity already exists: ${name}`);
  const style = { name, path: assetPath, evidence: 'mock' };
  if (capture) style.rendering_options = structuredClone(model.rendering_options || {});
  model.native_styles.push(style);
  if (activate) model.current_style = name;
  return style;
}

export function resolveStyle(model, reference) {
  const ref = nonEmptyString(reference, 'style_ref');
  const matches = (model.native_styles || []).filter((entry) => entry.name === ref);
  if (matches.length !== 1) throw new Error(`style_ref must resolve uniquely: ${ref}`);
  return matches[0];
}

export function styleActivate(model, operation) {
  const style = resolveStyle(model, operation.style_ref);
  model.current_style = style.name;
  if (style.rendering_options) model.rendering_options = structuredClone(style.rendering_options);
  return model.current_style;
}
