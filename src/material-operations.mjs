import { nonEmptyString, normalizeKeyword, optionalNumberInRange, positiveNumber } from './operation-utils.mjs';

export function ensureMaterial(model, material, options = '#cccccc') {
  const normalized = normalizeMaterialSpec(material, options);
  if (!normalized) return null;
  const { spec, updateExisting } = normalized;
  const existing = model.materials[spec.name];
  if (existing && !updateExisting) return spec.name;
  model.materials[spec.name] = mergeMaterialSpecs(existing, spec);
  return spec.name;
}

function normalizeMaterialSpec(material, options) {
  if (!material) return null;
  const materialIsObject = typeof material === 'object' && !Array.isArray(material);
  const raw = materialIsObject
    ? { ...material }
    : {
        ...(options && typeof options === 'object' && !Array.isArray(options) ? options : {}),
        name: material,
        color: typeof options === 'string' ? options : options?.color
      };
  if (!raw.name || typeof raw.name !== 'string') throw new Error('material operation requires a string name');
  const spec = { name: raw.name, color: raw.color || '#cccccc' };
  if (raw.alpha !== undefined) spec.alpha = optionalNumberInRange(raw.alpha, 0, 1, `${raw.name}.alpha`);
  if (raw.workflow !== undefined) spec.workflow = normalizeKeyword(raw.workflow, ['classic', 'pbr_metallic_roughness'], `${raw.name}.workflow`);
  if (raw.colorize_type !== undefined || raw.colorizeType !== undefined) {
    spec.colorize_type = normalizeKeyword(raw.colorize_type ?? raw.colorizeType, ['shift', 'tint'], `${raw.name}.colorize_type`);
  }
  if (raw.texture !== undefined) spec.texture = normalizeTextureSpec(raw.texture, `${raw.name}.texture`);
  if (raw.pbr !== undefined) spec.pbr = normalizePbrSpec(raw.pbr, `${raw.name}.pbr`);
  return { spec, updateExisting: materialIsObject };
}

function mergeMaterialSpecs(existing = {}, spec) {
  const merged = { ...existing, ...spec };
  if (existing.texture && spec.texture === undefined) merged.texture = existing.texture;
  if (existing.pbr || spec.pbr) {
    merged.pbr = { ...(existing.pbr || {}), ...(spec.pbr || {}) };
    if (existing.pbr?.textures || spec.pbr?.textures) {
      merged.pbr.textures = { ...(existing.pbr?.textures || {}), ...(spec.pbr?.textures || {}) };
    }
  }
  return merged;
}

function normalizeTextureSpec(texture, fieldName) {
  if (typeof texture === 'string') return { path: nonEmptyString(texture, `${fieldName}.path`) };
  if (!texture || typeof texture !== 'object' || Array.isArray(texture)) throw new Error(`${fieldName} must be a path string or object`);
  const path = nonEmptyString(texture.path ?? texture.file ?? texture.filename, `${fieldName}.path`);
  const normalized = { path };
  if (texture.width !== undefined) normalized.width = positiveNumber(texture.width, undefined, `${fieldName}.width`);
  if (texture.height !== undefined) normalized.height = positiveNumber(texture.height, undefined, `${fieldName}.height`);
  if (texture.scale_u !== undefined || texture.scaleU !== undefined) normalized.scale_u = positiveNumber(texture.scale_u ?? texture.scaleU, undefined, `${fieldName}.scale_u`);
  if (texture.scale_v !== undefined || texture.scaleV !== undefined) normalized.scale_v = positiveNumber(texture.scale_v ?? texture.scaleV, undefined, `${fieldName}.scale_v`);
  return normalized;
}

function normalizePbrSpec(pbr, fieldName) {
  if (!pbr || typeof pbr !== 'object' || Array.isArray(pbr)) throw new Error(`${fieldName} must be an object`);
  const normalized = {};
  for (const key of ['metallic_factor', 'roughness_factor', 'ao_strength']) {
    if (pbr[key] !== undefined) normalized[key] = optionalNumberInRange(pbr[key], 0, 1, `${fieldName}.${key}`);
  }
  if (pbr.normal_scale !== undefined) normalized.normal_scale = positiveNumber(pbr.normal_scale, undefined, `${fieldName}.normal_scale`);
  if (pbr.normal_style !== undefined || pbr.normalStyle !== undefined) {
    normalized.normal_style = normalizeKeyword(pbr.normal_style ?? pbr.normalStyle, ['opengl', 'directx'], `${fieldName}.normal_style`);
  }
  if (pbr.textures !== undefined) normalized.textures = normalizePbrTextures(pbr.textures, `${fieldName}.textures`);
  return normalized;
}

function normalizePbrTextures(textures, fieldName) {
  if (!textures || typeof textures !== 'object' || Array.isArray(textures)) throw new Error(`${fieldName} must be an object`);
  const normalized = {};
  for (const key of ['metallic', 'roughness', 'normal', 'ao', 'opacity']) {
    if (textures[key] !== undefined) {
      normalized[key] = typeof textures[key] === 'string'
        ? nonEmptyString(textures[key], `${fieldName}.${key}`)
        : normalizeTextureSpec(textures[key], `${fieldName}.${key}`).path;
    }
  }
  return normalized;
}
