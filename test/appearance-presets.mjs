import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { SketchUpBridge } from '../src/bridge.mjs';
import { APPEARANCE_MATERIAL_KINDS, loadNativeAppearanceCatalog, mapNativeNormalStyle, buildAppearanceMaterialOperations,
  buildAppearanceChannelSwatches, buildNativeAppearancePlan, assertAppearanceAssetsUnchanged, evaluateNativeAppearanceReadback, compareNativeAppearancePersistence } from '../src/detailed-modeling/appearance-presets.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'appearance-presets-'));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
try {
  const file = async (name, contents = `offline fixture ${name}`) => {
    const location = path.join(directory, name); await fs.writeFile(location, contents); return { path: location, sha256: digest(contents) };
  };
  const catalog = { version: 1, assets: [], presets: {}, environments: {}, license: 'test fixtures, not vendor material or native evidence' };
  for (const kind of APPEARANCE_MATERIAL_KINDS) {
    const source = await file(`${kind}.skm`);
    const textures = kind === 'glass' ? {} : { normal: (await file(`${kind}-normal.png`)).path, roughness: (await file(`${kind}-roughness.png`)).path };
    if (['paint', 'fabric'].includes(kind)) textures.ao = (await file(`${kind}-ao.png`)).path;
    catalog.presets[kind] = { name: `Source_${kind}`, source_skm_path: source.path, source_sha256: source.sha256,
      source_color: '#aaaaaa', source_normal_style_value: 42, pbr: { textures, normal_scale: 1, normal_enabled: kind !== 'glass',
        metalness_enabled: kind === 'metal', roughness_enabled: true, ao_enabled: Boolean(textures.ao), roughness_factor: 0.6, metallic_factor: 0,
        ...(textures.ao ? { ao_strength: 1 } : {}) }, ...(kind === 'glass' ? { alpha: 0.75 } : { texture: { path: (await file(`${kind}-base.png`)).path, width: 500, height: 500 } }) };
  }
  for (const key of ['studio', 'daylight']) {
    const hdr = await file(`${key}.hdr`), archive = await file(`${key}.ske`);
    catalog.environments[key] = { path: hdr.path, file_sha256: hdr.sha256, source: archive.path, archive_sha256: archive.sha256, license: catalog.license };
  }
  const catalogPath = path.join(directory, 'catalog.json'); await fs.writeFile(catalogPath, JSON.stringify(catalog));
  const style = await file('operator-exported.style');
  const capabilities = { evidence: 'native_api_probe', workflow_getter: true, normal_style_constants: { opengl: 42, directx: 21 },
    pbr_channels: Object.fromEntries(['metalness', 'roughness', 'normal', 'ao'].map(key => [key, { read: true, write: true }])),
    environments: { supported: true, settings: Object.fromEntries(['rotation', 'skydome_exposure', 'reflection_exposure', 'use_as_skydome', 'use_for_reflections', 'linked_sun'].map(key => [key, true])) }, scene_environment: true, scene_style: true, style_load: true };
  assert.equal(mapNativeNormalStyle(42, capabilities), 'opengl');
  assert.equal(mapNativeNormalStyle(21, capabilities), 'directx');
  assert.throws(() => mapNativeNormalStyle(1, capabilities), /missing or ambiguous/);
  assert.throws(() => mapNativeNormalStyle(42, {}), /actual native/);
  const record = await loadNativeAppearanceCatalog({ catalogPath });
  assert.ok(record.asset_manifest.length > 20); assert.equal(record.evidence, 'verified_local_files_not_native_application');
  const mapped = buildAppearanceMaterialOperations({ catalog, materialMap: { Timber: 'creation_ns_wood' }, assignments: { Timber: 'wood' }, nativeCapabilities: capabilities });
  assert.equal(mapped.operations[0].name, 'creation_ns_wood'); assert.equal(mapped.operations[0].pbr.normal_style, 'opengl');
  assert.equal(mapped.operations[0].skm_path, undefined, 'existing named materials use channels; SKM load requires a new name');
  assert.throws(() => buildAppearanceMaterialOperations({ catalog, materialMap: {}, assignments: { Missing: 'wood' }, nativeCapabilities: capabilities }), /materialMap/);
  assert.throws(() => buildAppearanceMaterialOperations({ catalog, materialMap: { Existing: 'textured' }, assignments: { Existing: 'glass' }, nativeCapabilities: capabilities, currentMaterials: [{ name: 'textured', texture: { path: 'old.png' } }] }), /cannot clear/);
  assert.throws(() => buildAppearanceMaterialOperations({ catalog, materialMap: {}, assignments: {}, nativeCapabilities: { ...capabilities, workflow_getter: false } }), /workflow/);
  const swatches = buildAppearanceChannelSwatches({ catalog, nativeCapabilities: capabilities, namespace: 'swatch_test' });
  assert.equal(swatches.matrix.length, 77);
  assert.equal(swatches.operations.find(item => item.name === 'swatch_test_wood_normal-0').pbr.normal_scale, 0);
  assert.equal(swatches.operations.find(item => item.name === 'swatch_test_paint_ao-0').pbr.ao_strength, 0);
  assert.equal(swatches.operations.find(item => item.name === 'swatch_test_metal_metal-0').pbr.metallic_factor, 0);
  assert.equal(swatches.operations.find(item => item.name === 'swatch_test_stone_roughness-1').pbr.textures.roughness, undefined);
  assert.equal(swatches.matrix.find(item => item.preset === 'glass' && item.variant === 'normal-1').status, 'unsupported');
  assert.equal(swatches.matrix.find(item => item.preset === 'wood' && item.variant === 'ao-1').status, 'unsupported');
  assert.equal(swatches.operations.find(item => item.name === 'swatch_test_glass_alpha-035').alpha, 0.35);
  const plan = await buildNativeAppearancePlan({ catalogRecord: record, materialMap: { Timber: 'creation_ns_wood' }, assignments: { Timber: 'wood' },
    nativeCapabilities: capabilities, namespace: 'appearance_test', stylePath: style.path,
    sceneViews: [{ id: 'detail', camera: { eye: [1000, -2000, 1500], target: [0, 0, 0], up: [0, 0, 1] } }], comparisonSwatches: true });
  assert.equal(plan.expected.scenes.length, 18);
  assert.notEqual(plan.expected.scenes[0].environment_ref, plan.expected.scenes[9].environment_ref);
  assert.equal(plan.capture_views.every(view => view.scene_ref && !view.eye), true);
  assert.equal((await assertAppearanceAssetsUnchanged(plan)).ok, true);
  const captureArguments = { catalogRecord: record, nativeCapabilities: capabilities, namespace: 'capture_test', stylePath: style.path,
    captureCurrentDisplay: true, sceneViews: [{ id: 'detail', camera: { eye: [1, -2, 1], target: [0, 0, 0], up: [0, 0, 1] } }] };
  await assert.rejects(() => buildNativeAppearancePlan(captureArguments), /capture is unsupported/);
  const capturedPlan = await buildNativeAppearancePlan({ ...captureArguments, nativeCapabilities: { ...capabilities, style_capture_current_display: true } });
  assert.equal(capturedPlan.document.operations.find(operation => operation.op === 'style_load').capture_current_display, true);
  await assert.rejects(() => assertAppearanceAssetsUnchanged({ ...plan, namespace: 'tampered' }), /modified/);
  await assert.rejects(() => buildNativeAppearancePlan({ catalogRecord: record, nativeCapabilities: capabilities, namespace: 'x', sceneViews: [], stylePath: null }), /real exported/);

  const bridge = new SketchUpBridge({ mock: { sessionPath: path.join(directory, 'mock-session.json') } });
  const built = await bridge.build_model({ runtime: 'mock', code: JSON.stringify(plan.document) });
  assert.ok(built.snapshot.materials.length > 50, 'the generated operations are executable by the existing runtime contract');
  assert.equal(evaluateNativeAppearanceReadback({ plan, snapshot: built.snapshot }).ok, false, 'a mock run must never become native appearance evidence');
  // API-shaped contract fixture exercises readback failure detection. It is
  // deliberately separate from the mock run and is not native acceptance.
  const nativeFixture = { materials: plan.expected.materials.map(({ op, ...material }) => structuredClone(material)),
    native_appearance: { evidence: 'native_api', current_environment: plan.expected.current_environment,
      environments: plan.expected.environments.map(({ op, ...environment }) => structuredClone(environment)),
      scenes: plan.expected.scenes.map(scene => ({ name: scene.name, environment_ref: scene.environment_ref, use_environment: true, use_style: true, style_native: { name: scene.style_ref } })) } };
  assert.equal(evaluateNativeAppearanceReadback({ plan, snapshot: nativeFixture }).ok, true);
  for (const environment of nativeFixture.native_appearance.environments) environment.path = path.basename(environment.path);
  assert.equal(evaluateNativeAppearanceReadback({ plan, snapshot: nativeFixture }).ok, true, 'Native Environment#path returns only the embedded filename');
  const wrongImage = structuredClone(nativeFixture);
  wrongImage.native_appearance.environments[0].path = 'wrong.hdr';
  assert.equal(evaluateNativeAppearanceReadback({ plan, snapshot: wrongImage }).ok, false, 'A different environment image filename must still fail');
  const pixels = { evidence: 'native_texture_pixels_v1', width: 2, height: 2, bits_per_pixel: 24, row_padding: 0, platform: 'platform_osx', sha256: 'a'.repeat(64) };
  const embeddedFixture = structuredClone(nativeFixture);
  const embeddedMaterial = embeddedFixture.materials[0];
  embeddedMaterial.pbr.textures.normal = path.basename(embeddedMaterial.pbr.textures.normal);
  embeddedMaterial.pbr.texture_pixels = { normal: pixels };
  assert.equal(evaluateNativeAppearanceReadback({ plan, snapshot: embeddedFixture }).ok, true);
  delete embeddedMaterial.pbr.texture_pixels;
  assert.equal(evaluateNativeAppearanceReadback({ plan, snapshot: embeddedFixture }).ok, false, 'A bare filename is insufficient for a reloaded PBR channel');
  const textureBefore = { native_appearance: { evidence: 'native_api', materials: [{ name: 'wood', pbr: { textures: { normal: '/source/normal.png' }, texture_pixels: { normal: pixels } } }] } };
  const textureAfter = structuredClone(textureBefore);
  textureAfter.native_appearance.materials[0].pbr.textures.normal = 'normal.png';
  assert.equal(compareNativeAppearancePersistence({ before: textureBefore, after: textureAfter }).ok, true);
  assert.equal(textureBefore.native_appearance.materials[0].pbr.textures.normal, '/source/normal.png', 'Comparison must not rewrite historical snapshots');
  textureAfter.native_appearance.materials[0].pbr.texture_pixels.normal.sha256 = 'b'.repeat(64);
  assert.equal(compareNativeAppearancePersistence({ before: textureBefore, after: textureAfter }).ok, false, 'Same filename with different native pixels must fail');
  delete textureAfter.native_appearance.materials[0].pbr.texture_pixels;
  assert.equal(compareNativeAppearancePersistence({ before: textureBefore, after: textureAfter }).ok, false, 'Filename-only evidence cannot prove embedded texture persistence');
  const persistedFixture = structuredClone(nativeFixture);
  nativeFixture.native_appearance.environments[0].rotation += 1e-10;
  assert.equal(compareNativeAppearancePersistence({ before: persistedFixture, after: nativeFixture }).ok, true);
  nativeFixture.native_appearance.rendering_options = { PhotorealFutureOption: true };
  assert.equal(compareNativeAppearancePersistence({ before: persistedFixture, after: nativeFixture }).ok, false);
  delete nativeFixture.native_appearance.rendering_options;
  nativeFixture.materials[0].pbr.normal_scale = 0;
  let readback = evaluateNativeAppearanceReadback({ plan, snapshot: nativeFixture });
  assert.equal(readback.ok, false); assert.ok(readback.unapplied_fields.some(field => field.field === 'pbr.normal_scale' && field.status === 'not_applied'));
  delete nativeFixture.materials[0].pbr.textures.normal;
  readback = evaluateNativeAppearanceReadback({ plan, snapshot: nativeFixture });
  assert.ok(readback.unapplied_fields.some(field => field.field === 'pbr.textures.normal' && field.status === 'missing_native_field'));
  await fs.appendFile(style.path, 'tampered');
  await assert.rejects(() => assertAppearanceAssetsUnchanged(plan), /hash mismatch/);
  const wrongCatalog = structuredClone(catalog); wrongCatalog.environments.daylight.file_sha256 = '0'.repeat(64);
  await fs.writeFile(catalogPath, JSON.stringify(wrongCatalog));
  await assert.rejects(() => loadNativeAppearanceCatalog({ catalogPath }), /hash mismatch/);
  console.log('appearance presets: asset provenance, native enum mapping, executable mock plan, channel endpoints, unsupported slots and strict readback passed (offline only)');
} finally { await fs.rm(directory, { recursive: true, force: true }); }
