import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { sha256Canonical } from '../agent-contract.mjs';
import { normalizeAppearanceAssetPath, normalizeEnvironmentSettings } from '../environment-operations.mjs';

export const APPEARANCE_MATERIAL_KINDS = Object.freeze(['wood', 'stone', 'tile', 'paint', 'metal', 'glass', 'fabric']);
const CHANNELS = ['metalness', 'roughness', 'normal', 'ao'];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
const within = (parent, child) => child === parent || child.startsWith(parent + path.sep);
const plain = value => value && typeof value === 'object' && !Array.isArray(value);

async function fileEvidence(file, expected, role, assetRoot) {
  if (!path.isAbsolute(file) || /[\0\r\n]/.test(file)) fail(`${role} must be an absolute local file`);
  const real = await fs.realpath(file);
  if (assetRoot && !within(assetRoot, real)) fail(`${role} escaped the catalog asset directory`);
  const stat = await fs.stat(real);
  if (!stat.isFile()) fail(`${role} is not a file`);
  const digest = sha(await fs.readFile(real));
  if (expected && digest !== expected) fail(`${role} source hash mismatch`);
  return { path: real, sha256: digest, size_bytes: stat.size, role };
}

export async function loadNativeAppearanceCatalog({ catalogPath }) {
  const catalog_path = await fs.realpath(catalogPath), root = path.dirname(catalog_path);
  const bytes = await fs.readFile(catalog_path);
  if (bytes.length > 5_000_000) fail('Appearance catalog exceeds 5 MB');
  const catalog = JSON.parse(bytes);
  if (catalog.version !== 1 || !plain(catalog.presets) || !plain(catalog.environments)) fail('Appearance catalog requires version 1, presets and environments');
  if (!catalog.license || !Array.isArray(catalog.assets)) fail('Appearance catalog requires source and license records');
  const requests = new Map();
  const add = (file, expected, role, restricted = false) => {
    if (typeof file !== 'string' || !file) fail(`${role} path is missing`);
    const existing = requests.get(file);
    if (existing && expected && existing.expected && expected !== existing.expected) fail(`Conflicting asset hashes: ${file}`);
    requests.set(file, { file, expected: expected || existing?.expected, role, restricted });
  };
  for (const kind of APPEARANCE_MATERIAL_KINDS) {
    const preset = catalog.presets[kind];
    if (!plain(preset) || !plain(preset.pbr) || !/^[a-f0-9]{64}$/.test(preset.source_sha256 || '')) fail(`Missing verified source preset: ${kind}`);
    normalizeAppearanceAssetPath(preset.source_skm_path, ['.skm'], `${kind}.source_skm_path`);
    add(preset.source_skm_path, preset.source_sha256, `${kind}.source_skm`);
    if (preset.texture) add(preset.texture.path, null, `${kind}.base_texture`, true);
    for (const [channel, file] of Object.entries(preset.pbr.textures || {})) add(file, null, `${kind}.${channel}_texture`, true);
  }
  for (const kind of ['studio', 'daylight']) {
    const asset = catalog.environments[kind];
    if (!plain(asset) || !asset.license || !/^[a-f0-9]{64}$/.test(asset.file_sha256 || '') || !/^[a-f0-9]{64}$/.test(asset.archive_sha256 || '')) fail(`Missing verified HDR provenance: ${kind}`);
    normalizeAppearanceAssetPath(asset.path, ['.hdr', '.exr'], `${kind}.path`);
    add(asset.path, asset.file_sha256, `${kind}.environment`, true);
    add(asset.source, asset.archive_sha256, `${kind}.source_archive`);
  }
  const settled = await Promise.allSettled([...requests.values()].map(item => fileEvidence(item.file, item.expected, item.role, item.restricted ? root : null)));
  const errors = settled.filter(result => result.status === 'rejected').map(result => result.reason.message);
  if (errors.length) fail(errors.join('; '));
  return { catalog, catalog_path, catalog_sha256: sha(bytes), asset_manifest: settled.map(result => result.value),
    evidence: 'verified_local_files_not_native_application', license: catalog.license };
}

export function mapNativeNormalStyle(sourceValue, nativeCapabilities) {
  const constants = nativeCapabilities?.normal_style_constants;
  if (!Number.isInteger(sourceValue) || !plain(constants)) fail('A source normal enum and actual native normal_style_constants are required');
  const matches = ['opengl', 'directx'].filter(key => Number.isInteger(constants[key]) && constants[key] === sourceValue);
  if (matches.length !== 1) fail(`Native normal enum is missing or ambiguous for source value ${sourceValue}`);
  return matches[0];
}

function capabilitiesForMaterials(capabilities) {
  if (!capabilities?.workflow_getter) fail('Native PBR workflow readback is unsupported');
  for (const channel of CHANNELS) if (!capabilities.pbr_channels?.[channel]?.read || !capabilities.pbr_channels?.[channel]?.write) fail(`Native PBR ${channel} read/write is unsupported`);
}

function materialFromPreset(kind, name, catalog, capabilities, current, unsupported) {
  const source = catalog.presets[kind];
  if (!source) fail(`Unknown appearance preset: ${kind}`);
  const pbr = structuredClone(source.pbr);
  if (pbr.textures?.normal) pbr.normal_style = mapNativeNormalStyle(source.source_normal_style_value, capabilities);
  else if (pbr.normal_scale !== undefined) {
    delete pbr.normal_scale;
    unsupported.push({ material: name, preset: kind, field: 'pbr.normal_scale', status: 'not_applicable', reason: 'source_has_no_normal_texture' });
  }
  const color = source.source_color || current?.color;
  if (!color) unsupported.push({ material: name, preset: kind, field: 'source_color', status: 'not_recorded', reason: 'catalog_and_current_material_have_no_source_color' });
  return { op: 'material', name, ...(color ? { color } : {}), alpha: source.alpha ?? 1,
    ...(source.texture ? { texture: structuredClone(source.texture) } : {}), pbr };
}

export function buildAppearanceMaterialOperations({ catalog, materialMap, assignments, nativeCapabilities, currentMaterials = [] }) {
  capabilitiesForMaterials(nativeCapabilities);
  if (!plain(materialMap) || !plain(assignments)) fail('Explicit materialMap and logical material assignments are required');
  const operations = [], unsupported_fields = [], used = new Set();
  const current = new Map((Array.isArray(currentMaterials) ? currentMaterials : Object.values(currentMaterials)).map(item => [item.name, item]));
  for (const [logical, kind] of Object.entries(assignments)) {
    const name = materialMap[logical];
    if (typeof name !== 'string' || !name) fail(`The server creation materialMap has no material: ${logical}`);
    if (used.has(name)) fail(`Multiple presets target one native material: ${name}`);
    if (!catalog.presets[kind]?.texture && current.get(name)?.texture) fail(`Untextured preset ${kind} cannot clear the existing base texture of ${name}; use a fresh material or an explicit supported texture-clear operation`);
    used.add(name);
    operations.push(materialFromPreset(kind, name, catalog, nativeCapabilities, current.get(name), unsupported_fields));
  }
  return { operations, unsupported_fields, assignments: structuredClone(assignments) };
}

const VARIANTS = [
  ['baseline'], ['metal-0', 'metallic_factor', 0], ['metal-1', 'metallic_factor', 1],
  ['roughness-0', 'roughness_factor', 0], ['roughness-1', 'roughness_factor', 1],
  ['normal-0', 'normal_scale', 0], ['normal-1', 'normal_scale', 1],
  ['ao-0', 'ao_strength', 0], ['ao-1', 'ao_strength', 1], ['alpha-035', 'alpha', 0.35], ['alpha-1', 'alpha', 1]
];

export function buildAppearanceChannelSwatches({ catalog, nativeCapabilities, namespace, origin = [0, 0, 0] }) {
  capabilitiesForMaterials(nativeCapabilities);
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(namespace)) fail('A safe swatch namespace is required');
  if (!Array.isArray(origin) || origin.length !== 3 || !origin.every(Number.isFinite)) fail('Swatch origin must be finite XYZ millimeters');
  const operations = [], matrix = [], unsupported_fields = [];
  APPEARANCE_MATERIAL_KINDS.forEach((kind, row) => VARIANTS.forEach(([variant, field, value], column) => {
    const name = `${namespace}_${kind}_${variant}`, source = catalog.presets[kind];
    const entry = { preset: kind, variant, material: name, row, column, field: field || null, requested_value: value ?? null };
    const texture = field === 'normal_scale' ? 'normal' : field === 'ao_strength' ? 'ao' : null;
    if (texture && !source.pbr.textures?.[texture]) {
      matrix.push({ ...entry, status: 'unsupported', reason: `source_has_no_${texture}_texture` }); return;
    }
    const operation = materialFromPreset(kind, name, catalog, nativeCapabilities, null, unsupported_fields);
    if (field === 'alpha') operation.alpha = value;
    else if (field) {
      operation.pbr[field] = value;
      operation.pbr[{ metallic_factor: 'metalness_enabled', roughness_factor: 'roughness_enabled', normal_scale: 'normal_enabled', ao_strength: 'ao_enabled' }[field]] = true;
      // Endpoint tests use the scalar alone for metallic/roughness. Existing
      // channel textures would multiply the factor and obscure the 0/1 test.
      if (field === 'metallic_factor' && operation.pbr.textures) delete operation.pbr.textures.metallic;
      if (field === 'roughness_factor' && operation.pbr.textures) delete operation.pbr.textures.roughness;
    }
    operations.push(operation, { op: 'box', id: `${name}_panel`, name: `${name}_panel`,
      origin: [origin[0] + column * 380, origin[1] + row * 460, origin[2]], size: [320, 360, 80], material: name,
      ...(operation.texture ? { texture_transform: { projection: 'box', texture_size_mm: [320, 360], side: 'both' } } : {}) });
    matrix.push({ ...entry, status: 'planned', entity_id: `${name}_panel` });
  }));
  const width = VARIANTS.length * 380, height = APPEARANCE_MATERIAL_KINDS.length * 460;
  const camera = { eye: [origin[0] + width * 1.1, origin[1] - height * 1.6, origin[2] + width * 1.3], target: [origin[0] + width / 2, origin[1] + height / 2, origin[2]], up: [0, 0, 1], fov: 42 };
  const views = [{ id: 'swatches_overview', camera }, ...APPEARANCE_MATERIAL_KINDS.map((kind, row) => ({ id: `swatches_${kind}`, camera: {
    eye: [origin[0] + width / 2, origin[1] + row * 460 - 3000, origin[2] + 2300],
    target: [origin[0] + width / 2, origin[1] + row * 460 + 180, origin[2] + 40], up: [0, 0, 1], fov: 55
  } }))];
  return { operations, matrix, unsupported_fields, camera, views, dimensions_mm: [width, height, 80] };
}

export async function buildNativeAppearancePlan({ catalogRecord, materialMap = {}, assignments = {}, nativeCapabilities,
  namespace, stylePath, captureCurrentDisplay = false, sceneViews = [], currentMaterials = [], comparisonSwatches = false, swatchOrigin = [0, 0, 0], environmentSettings = {} }) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(namespace || '')) fail('A safe appearance namespace is required');
  const { catalog } = catalogRecord;
  const material = buildAppearanceMaterialOperations({ catalog, materialMap, assignments, nativeCapabilities, currentMaterials });
  const operations = [...material.operations], unsupported_fields = [...material.unsupported_fields];
  const samples = comparisonSwatches ? buildAppearanceChannelSwatches({ catalog, nativeCapabilities, namespace, origin: swatchOrigin }) : null;
  if (samples) { operations.push(...samples.operations); unsupported_fields.push(...samples.unsupported_fields); }
  if (!nativeCapabilities.environments?.supported || !nativeCapabilities.scene_environment || !nativeCapabilities.scene_style || !nativeCapabilities.style_load) fail('Native HDR, scene environment/style binding and style loading are required');
  if (!stylePath) fail('A real exported native .style path is required; Photoreal is not inferred');
  if (typeof captureCurrentDisplay !== 'boolean') fail('captureCurrentDisplay must be boolean');
  if (captureCurrentDisplay && !nativeCapabilities.style_capture_current_display) fail('Native current display style capture is unsupported');
  normalizeAppearanceAssetPath(stylePath, ['.style'], 'stylePath');
  const styleEvidence = await fileEvidence(stylePath, null, 'operator_supplied_native_style');
  const styleName = `${namespace}_native_style`;
  operations.push({ op: 'style_load', name: styleName, path: styleEvidence.path, activate: true, ...(captureCurrentDisplay ? { capture_current_display: true } : {}) });
  const environments = [];
  for (const key of ['studio', 'daylight']) {
    const settings = normalizeEnvironmentSettings({ rotation: key === 'studio' ? 20 : 130, skydome_exposure: 1, reflection_exposure: 1,
      use_as_skydome: true, use_for_reflections: true, linked_sun: false, ...(environmentSettings[key] || {}) });
    for (const field of Object.keys(settings)) if (nativeCapabilities.environments.settings?.[field] !== true) fail(`Native environment setting is unsupported: ${field}`);
    const operation = { op: 'environment_define', id: `${namespace}_${key}`, name: `${namespace}_${key}`, path: catalog.environments[key].path, ...settings };
    environments.push(operation); operations.push(operation);
  }
  const views = samples ? [...samples.views, ...sceneViews] : sceneViews;
  if (!views.length) fail('At least one camera view is required to bind independent native scenes');
  const scenes = [];
  for (const environment of environments) for (const view of views) {
    if (!view.id || !plain(view.camera)) fail('Appearance scene views require an id and explicit camera');
    const name = `${namespace}_${view.id}_${environment.name.endsWith('_studio') ? 'studio' : 'daylight'}`;
    const scene = { op: 'scene', name, camera: structuredClone(view.camera), style_ref: styleName, environment_ref: environment.id, use_environment: true, transition_time: 0 };
    scenes.push(scene); operations.push(scene);
  }
  operations.push({ op: 'environment_activate', environment_ref: environments[0].id }, { op: 'camera', ...views[0].camera });
  const plan = { version: 'native-appearance-plan.v1', namespace, evidence: 'prepared_local_assets_requires_native_readback',
    catalog_path: catalogRecord.catalog_path, catalog_sha256: catalogRecord.catalog_sha256,
    license: catalogRecord.license, asset_manifest: [...catalogRecord.asset_manifest, styleEvidence],
    document: { version: 1, units: 'mm', operations }, material_assignments: material.assignments,
    expected: { materials: operations.filter(operation => operation.op === 'material'), absent_base_textures: operations.filter(operation => operation.op === 'material' && !operation.texture).map(operation => operation.name), environments, scenes, current_environment: environments[0].id, style_name: styleName },
    unsupported_fields, matrix: samples?.matrix || [],
    capture_views: scenes.map(scene => ({ id: scene.name, scene_ref: scene.name, width: 1800, height: 1100, min_width: 1400, min_height: 900 })),
    native_capabilities: structuredClone(nativeCapabilities), photoreal_status: 'operator_supplied_style_requires_visual_acceptance' };
  return { ...plan, appearance_plan_hash: sha256Canonical(plan) };
}

export async function assertAppearanceAssetsUnchanged(plan) {
  const { appearance_plan_hash, ...unsigned } = plan;
  if (appearance_plan_hash !== sha256Canonical(unsigned)) fail('Appearance plan content was modified');
  const catalog = await fs.readFile(plan.catalog_path);
  if (sha(catalog) !== plan.catalog_sha256) fail('Appearance catalog changed after preview');
  const checks = await Promise.allSettled(plan.asset_manifest.map(item => fileEvidence(item.path, item.sha256, item.role)));
  const errors = checks.filter(item => item.status === 'rejected').map(item => item.reason.message);
  if (errors.length) fail(errors.join('; '));
  return { ok: true, checked_files: checks.length, appearance_plan_hash };
}

function same(expected, actual) {
  if (typeof expected === 'number' && typeof actual === 'number') return Math.abs(expected - actual) < 1.0e-6;
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((value, index) => same(value, actual[index]));
  if (plain(expected)) return plain(actual) && Object.keys(expected).length === Object.keys(actual).length && Object.keys(expected).every(key => Object.hasOwn(actual, key) && same(expected[key], actual[key]));
  return expected === actual;
}

export function compareNativeAppearancePersistence({ before, after }) {
  const previous = before?.native_appearance, current = after?.native_appearance;
  if (previous?.evidence !== 'native_api' || current?.evidence !== 'native_api') return { ok: false, reason: 'native_appearance_evidence_missing' };
  const { signature: before_signature, ...beforeState } = structuredClone(previous);
  const { signature: after_signature, ...afterState } = structuredClone(current);
  const embedded_paths_verified = [];
  for (const material of beforeState.materials || []) {
    const other = (afterState.materials || []).find(item => item.name === material.name);
    for (const [channel, filename] of Object.entries(material.pbr?.textures || {})) {
      const next = other?.pbr?.textures?.[channel], pixels = material.pbr?.texture_pixels?.[channel];
      if (typeof filename !== 'string' || typeof next !== 'string' || filename === next) continue;
      if (path.basename(filename) === path.basename(next) && validPixelFingerprint(pixels) && same(pixels, other.pbr?.texture_pixels?.[channel])) {
        material.pbr.textures[channel] = other.pbr.textures[channel] = path.basename(filename);
        embedded_paths_verified.push({ material: material.name, channel, sha256: pixels.sha256 });
      }
    }
  }
  return { ok: same(beforeState, afterState), before_signature, after_signature, numeric_tolerance: 1e-6,
    embedded_paths_verified,
    scope: 'all_native_appearance_fields_including_rendering_options_and_scene_bindings' };
}
function validPixelFingerprint(value) {
  return value?.evidence === 'native_texture_pixels_v1' && /^[a-f0-9]{64}$/.test(value.sha256 || '') &&
    Number.isInteger(value.width) && value.width > 0 && Number.isInteger(value.height) && value.height > 0 &&
    Number.isInteger(value.bits_per_pixel) && value.bits_per_pixel > 0 && Number.isInteger(value.row_padding) && value.row_padding >= 0 && typeof value.platform === 'string';
}
export function evaluateNativeAppearanceReadback({ plan, snapshot }) {
  const fields = [], native = snapshot?.native_appearance;
  const compare = (target, field, expected, actual) => fields.push({ target, field, expected, actual: actual ?? null,
    status: actual === undefined ? 'missing_native_field' : same(expected, actual) ? 'applied' : 'not_applied' });
  const materialSource = native?.materials || snapshot?.materials;
  const materials = new Map((Array.isArray(materialSource) ? materialSource : Object.values(materialSource || {})).map(material => [material.name, material]));
  for (const expected of plan.expected.materials) {
    const actual = materials.get(expected.name);
    compare(expected.name, 'material_exists', true, actual ? true : undefined);
    if (!actual) continue;
    if ((plan.expected.absent_base_textures || []).includes(expected.name)) compare(expected.name, 'base_texture_absent', true, !actual.texture);
    for (const key of ['alpha', 'color']) if (expected[key] !== undefined) compare(expected.name, key, expected[key], actual[key]);
    if (expected.texture) for (const key of ['path', 'width', 'height']) if (expected.texture[key] !== undefined) compare(expected.name, `texture.${key}`, expected.texture[key], actual.texture?.[key]);
    for (const [key, value] of Object.entries(expected.pbr || {})) {
      if (key === 'textures') for (const [channel, file] of Object.entries(value)) {
        const nativePath = actual.pbr?.textures?.[channel];
        if (typeof nativePath === 'string' && nativePath === path.basename(nativePath) && validPixelFingerprint(actual.pbr?.texture_pixels?.[channel])) {
          compare(expected.name, `pbr.textures.${channel}.filename`, path.basename(file), nativePath);
        } else compare(expected.name, `pbr.textures.${channel}`, file, nativePath);
      }
      else compare(expected.name, `pbr.${key}`, value, actual.pbr?.[key]);
    }
  }
  for (const expected of plan.expected.environments) {
    const actual = native?.environments?.find(item => item.id === expected.id || item.name === expected.name);
    compare(expected.name, 'environment_exists', true, actual ? true : undefined);
    for (const [key, value] of Object.entries(expected)) if (!['op', 'id', 'name'].includes(key)) {
      // Environment#path returns the embedded image filename, not its original
      // filesystem location. This check proves filename identity only; source
      // bytes are checked separately by the import asset manifest.
      if (key === 'path') compare(expected.name, 'path.filename', path.basename(value), typeof actual?.path === 'string' ? path.basename(actual.path) : undefined);
      else compare(expected.name, key, value, actual?.[key]);
    }
  }
  for (const expected of plan.expected.scenes) {
    const actual = native?.scenes?.find(item => item.name === expected.name);
    compare(expected.name, 'scene_exists', true, actual ? true : undefined);
    compare(expected.name, 'environment_ref', expected.environment_ref, actual?.environment_ref);
    compare(expected.name, 'use_environment', true, actual?.use_environment);
    compare(expected.name, 'style_ref', expected.style_ref, actual?.style_native?.name);
    compare(expected.name, 'use_style', true, actual?.use_style);
  }
  compare('model', 'current_environment', plan.expected.current_environment, native?.current_environment);
  const nativeEvidence = native?.evidence === 'native_api';
  const warnings = (snapshot?.warnings || []).filter(warning => /material|environment|style/i.test([warning.code, warning.message].join(' ')));
  return { version: 'native-appearance-readback.v1', evidence: nativeEvidence ? 'native_api_readback' : 'not_native_evidence',
    ok: nativeEvidence && fields.every(field => field.status === 'applied') && !warnings.length,
    fields, unapplied_fields: fields.filter(field => field.status !== 'applied'), unsupported_fields: plan.unsupported_fields,
    unsupported_comparisons: plan.matrix.filter(item => item.status === 'unsupported'), native_warnings: warnings,
    appearance_signature: native?.signature || null, photoreal_visual_acceptance: 'pending' };
}
