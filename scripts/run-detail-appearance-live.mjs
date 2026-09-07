#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SketchUpBridge } from '../src/bridge.mjs';
import { sha256Canonical } from '../src/agent-contract.mjs';
import { loadNativeAppearanceCatalog, buildNativeAppearancePlan, assertAppearanceAssetsUnchanged, evaluateNativeAppearanceReadback, compareNativeAppearancePersistence } from '../src/detailed-modeling/appearance-presets.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
export const DETAIL_APPEARANCE_ROOT = path.join(repo, 'output/detail-modeling-implementation-2026-09-06');
const TIMEOUT = 600000;
const HELP = `Usage:
  node scripts/run-detail-appearance-live.mjs preview LABEL RUN_ID --style-path /absolute/exported.style [--assignments-file /absolute/assignments.json] [--swatches true|false] [--swatch-origin 8000,0,0] [--model-name LABEL.skp] [--catalog-file /absolute/catalog-v2.json]
  node scripts/run-detail-appearance-live.mjs apply LABEL RUN_ID
  node scripts/run-detail-appearance-live.mjs capture LABEL RUN_ID
  node scripts/run-detail-appearance-live.mjs reopen LABEL RUN_ID

preview only reads the saved active test copy and writes the exact appearance
plan. apply verifies its model revision, catalog/assets and server material map,
uses a fresh queue handshake and this run's existing expert-appearance policy,
then saves a new LABEL-RUN_ID-appearance.skp. No approval click is simulated.
Assignments JSON maps original logical material names to wood/stone/tile/paint/
metal/glass/fabric. Swatches default true and use only source-provided channels.
Scene captures require an already selected saved scene and unmodified native
style so that the original display can be restored safely. No native Photoreal
style is fabricated. Optional --capture-current-display true commits the actual
current native rendering options into the newly imported style; --style-path
then names a real donor style supplying its other style settings. Photoreal
must already be enabled and still requires native readback and visual checks.
Importing this module or --help never invokes live tools.`;

export function parseDetailAppearanceArguments(argv) {
  if (!argv.length || argv.includes('--help')) return { help: true };
  const [action, label, runId, ...rest] = argv;
  if (!['preview', 'apply', 'capture', 'reopen'].includes(action)) throw new Error('Expected preview, apply, capture or reopen');
  for (const [key, value] of [['label', label], ['runId', runId]]) if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(value || '')) throw new Error(`Invalid ${key}`);
  const allowed = new Set(['style-path', 'capture-current-display', 'assignments-file', 'swatches', 'swatch-origin', 'model-name', 'catalog-file']), options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]?.replace(/^--/, '');
    if (action !== 'preview' || !rest[index]?.startsWith('--') || !allowed.has(key) || options[key] !== undefined || !rest[index + 1]) throw new Error(`Invalid or duplicate option ${rest[index]}`);
    options[key] = rest[index + 1];
  }
  if (action === 'preview' && (!options['style-path'] || !path.isAbsolute(options['style-path']) || !options['style-path'].toLowerCase().endsWith('.style'))) throw new Error('preview requires an absolute exported native --style-path');
  for (const field of ['assignments-file', 'catalog-file']) if (options[field] && !path.isAbsolute(options[field])) throw new Error(`${field} must be an absolute local path`);
  const modelName = options['model-name'] || `${label}.skp`;
  if (!/^[a-z0-9][a-z0-9-]*\.skp$/.test(modelName) || !modelName.startsWith(`${label}.`) && !modelName.startsWith(`${label}-`)) throw new Error('model-name must use the exact label prefix');
  if (options.swatches !== undefined && !['true', 'false'].includes(options.swatches)) throw new Error('swatches must be true or false');
  if (options['capture-current-display'] !== undefined && !['true', 'false'].includes(options['capture-current-display'])) throw new Error('capture-current-display must be true or false');
  const swatchOrigin = (options['swatch-origin'] || '8000,0,0').split(',').map(Number);
  if (swatchOrigin.length !== 3 || !swatchOrigin.every(Number.isFinite)) throw new Error('swatch-origin must be finite XYZ millimeters');
  return { action, label, runId, modelName, stylePath: options['style-path'], assignmentsFile: options['assignments-file'],
    swatches: options.swatches !== 'false', swatchOrigin, captureCurrentDisplay: options['capture-current-display'] === 'true',
    catalogPath: options['catalog-file'] || path.join(DETAIL_APPEARANCE_ROOT, 'appearance-assets/catalog-v2.json') };
}

export async function runDetailAppearanceLive(args) {
  if (args.help) { console.log(HELP); return; }
  const models = path.join(DETAIL_APPEARANCE_ROOT, 'models');
  const sourceEvidence = path.join(DETAIL_APPEARANCE_ROOT, 'evidence', args.label);
  const runDir = path.join(sourceEvidence, 'appearance', args.runId);
  const auditDir = ['capture', 'reopen'].includes(args.action) ? path.join(runDir, `${args.action}-${Date.now()}`) : runDir;
  if (args.action === 'preview') {
    await fs.mkdir(path.dirname(runDir), { recursive: true }); await fs.mkdir(runDir, { recursive: false });
  } else if (auditDir !== runDir) await fs.mkdir(auditDir, { recursive: false });
  const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
  const write = async (name, value, directory = auditDir) => fs.writeFile(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const bridge = new SketchUpBridge({ queue: { timeoutMs: TIMEOUT },
    executionPolicy: { allowed_runtimes: ['mock', 'queue'], allow_queue_mutation: true, allow_direct_expert_queue_mutation: true },
    agentContract: { rootDir: path.join(DETAIL_APPEARANCE_ROOT, 'agent-state') },
    sessionContract: { serverSessionId: 'detail-modeling-live-implementation' },
    mock: { sessionPath: path.join(DETAIL_APPEARANCE_ROOT, 'offline-unused.json') } });
  let expectedPath = path.join(models, args.modelName);
  const guard = async () => {
    if (path.dirname(path.resolve(expectedPath)) !== models || !path.basename(expectedPath).startsWith(`${args.label}.`) && !path.basename(expectedPath).startsWith(`${args.label}-`)) throw new Error('Expected model escaped this test label and models directory');
    const model = await bridge.get_model_info({ runtime: 'queue', timeoutMs: TIMEOUT });
    if (!model.source_path || path.resolve(model.source_path) !== expectedPath) throw new Error(`Active model must be the exact saved test copy: ${expectedPath}`);
    const realModels = await fs.realpath(models);
    if (path.dirname(await fs.realpath(expectedPath)) !== realModels) throw new Error('Test model symlink escaped the permitted directory');
    return model;
  };
  const fresh = async () => { await guard(); return (await bridge.create_queue_handshake({ timeoutMs: TIMEOUT })).session_contract; };
  const state = async () => {
    await guard();
    const { snapshot } = await bridge.inspect_model({ runtime: 'queue', timeoutMs: TIMEOUT, includeSnapshot: true });
    if (!snapshot?.model_revision || snapshot.model_revision_complete !== true) throw new Error('Appearance work requires a fresh complete native model revision');
    return { model_revision: snapshot.model_revision, snapshot };
  };
  const nativeCaps = async () => {
    const capabilities = await bridge.get_capabilities({ runtime: 'queue', timeoutMs: TIMEOUT });
    if (capabilities.runtime?.native_appearance?.evidence !== 'native_api_probe') throw new Error('Fresh native appearance capability probe is required');
    return capabilities.runtime.native_appearance;
  };
  const capture = async plan => {
    const batches = [];
    for (let offset = 0; offset < plan.capture_views.length; offset += 24) {
      const batch = await bridge.capture_detail_views({ runtime: 'queue', timeoutMs: TIMEOUT, session_contract: await fresh(),
        views: plan.capture_views.slice(offset, offset + 24), output_dir: path.join(auditDir, `views-${offset / 24 + 1}`) });
      batches.push(batch); await write(`capture-${offset / 24 + 1}.json`, batch);
    }
    return { ok: batches.every(batch => batch.restored === true && batch.captures.every(view => view.server_verified === true)), batches: batches.length,
      captures: batches.flatMap(batch => batch.captures || []), modified_state: batches.map(batch => ({ before: batch.modified_before, after: batch.modified_after, restoration: batch.restoration })) };
  };
  if (args.action === 'preview') {
    await guard();
    const current = await state(), capabilities = await nativeCaps();
    const creationResult = await json(path.join(sourceEvidence, 'create-result.json'));
    const task = await bridge.taskStore.getTask(creationResult.task_id, { includePrivate: true });
    if (!task.private?.creation?.material_map) throw new Error('The original server creation material map is required');
    const materialMap = task.private.creation.material_map;
    const assignments = args.assignmentsFile ? await json(args.assignmentsFile) : {};
    const existing = new Set((current.snapshot?.materials || current.snapshot?.native_appearance?.materials || []).map(material => material.name));
    for (const logical of Object.keys(assignments)) if (!existing.has(materialMap[logical])) throw new Error(`Assigned native material is missing from the active model: ${logical}`);
    const bundle = await json(path.join(sourceEvidence, 'frozen-bundle.json'));
    const plan = await buildNativeAppearancePlan({ catalogRecord: await loadNativeAppearanceCatalog({ catalogPath: args.catalogPath }), materialMap, assignments,
      nativeCapabilities: capabilities, namespace: `${args.label}_${args.runId}`.replaceAll('-', '_'), stylePath: args.stylePath, captureCurrentDisplay: args.captureCurrentDisplay,
      sceneViews: bundle.views, currentMaterials: current.snapshot?.materials, comparisonSwatches: args.swatches, swatchOrigin: args.swatchOrigin });
    const sourceModelHash = sha256Canonical({ source_path: expectedPath, model_revision: current.model_revision });
    const preview = { version: 'detail-appearance-live-preview.v1', source_model_path: expectedPath,
      saved_model_path: path.join(models, `${args.label}-${args.runId}-appearance.skp`), model_revision_before: current.model_revision,
      source_model_hash: sourceModelHash, creation_task_id: task.task_id, creation_material_map_hash: sha256Canonical(materialMap),
      appearance_plan_hash: plan.appearance_plan_hash, capture_prerequisite: 'Select a saved scene and save any active style changes before controlled scene capture.' };
    await write('plan.json', plan); await write('preview.json', preview); await write('snapshot-before.json', current.snapshot);
    console.log(JSON.stringify({ ok: true, action: 'preview', evidence_dir: runDir, model_revision: current.model_revision,
      operations: plan.document.operations.length, unsupported_comparisons: plan.matrix.filter(item => item.status === 'unsupported').length, next: `apply ${args.label} ${args.runId}` })); return;
  }
  const preview = await json(path.join(runDir, 'preview.json')), plan = await json(path.join(runDir, 'plan.json'));
  if (plan.appearance_plan_hash !== preview.appearance_plan_hash) throw new Error('Preview plan hash mismatch');
  if (args.action === 'apply') {
    expectedPath = preview.source_model_path;
    const current = await state();
    if (current.model_revision !== preview.model_revision_before) throw new Error('Active model changed after appearance preview; prepare a new preview');
    const task = await bridge.taskStore.getTask(preview.creation_task_id, { includePrivate: true });
    if (sha256Canonical(task.private?.creation?.material_map) !== preview.creation_material_map_hash) throw new Error('Server creation material map changed after preview');
    await assertAppearanceAssetsUnchanged(plan);
    const capabilities = await nativeCaps();
    if (sha256Canonical(capabilities) !== sha256Canonical(plan.native_capabilities)) throw new Error('Native appearance capabilities changed after preview');
    if (await fs.stat(preview.saved_model_path).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) throw new Error('Independent appearance output model already exists');
    await write('apply-start.json', { appearance_plan_hash: plan.appearance_plan_hash, model_revision: current.model_revision });
    const applied = await bridge.build_model({ runtime: 'queue', timeoutMs: TIMEOUT, session_contract: await fresh(), code: JSON.stringify(plan.document) });
    await write('apply-result.json', applied);
    const after = await state();
    const readback = evaluateNativeAppearanceReadback({ plan, snapshot: { ...after.snapshot,
      warnings: [...(after.snapshot?.warnings || []), ...(applied.snapshot?.warnings || applied.warnings || [])] } });
    await write('snapshot-after.json', after.snapshot); await write('native-readback.json', readback);
    const saved = await bridge.save_model({ runtime: 'queue', timeoutMs: TIMEOUT, session_contract: await fresh(), path: preview.saved_model_path, keep_session: true });
    expectedPath = preview.saved_model_path; await write('saved.json', saved);
    console.log(JSON.stringify({ ok: readback.ok, action: 'apply', evidence_dir: runDir, model_path: expectedPath,
      unapplied_fields: readback.unapplied_fields, native_warnings: readback.native_warnings, unsupported_comparisons: readback.unsupported_comparisons.length,
      next: `capture ${args.label} ${args.runId}; reopen ${args.label} ${args.runId}` })); return;
  }
  expectedPath = preview.saved_model_path;
  await guard();
  if (args.action === 'reopen') {
    const opened = await bridge.open_model({ runtime: 'queue', timeoutMs: TIMEOUT, session_contract: await fresh(), path: expectedPath });
    await write('opened.json', opened);
  }
  const current = await state(), readback = evaluateNativeAppearanceReadback({ plan, snapshot: current.snapshot });
  await write('snapshot.json', current.snapshot); await write('native-readback.json', readback);
  const persistence = args.action === 'reopen' ? compareNativeAppearancePersistence({ before: await json(path.join(runDir, 'snapshot-after.json')), after: current.snapshot }) : null;
  if (persistence) await write('native-persistence.json', persistence);
  let captureResult;
  try { captureResult = await capture(plan); }
  catch (error) { captureResult = { ok: false, error: { code: error.code || null, message: error.message } }; }
  await write('capture-summary.json', captureResult);
  const summary = { ok: readback.ok && captureResult.ok && (!persistence || persistence.ok), action: args.action, evidence: 'live_runtime', evidence_dir: auditDir,
    model_path: expectedPath, model_revision: current.model_revision, native_readback_verified: readback.ok,
    captures_verified_and_restored: captureResult.ok, native_state_matches_saved_readback: persistence?.ok ?? null,
    disk_reload_verified: false, native_state_persisted: null, unsupported_comparisons: readback.unsupported_comparisons.length,
    photoreal_visual_acceptance: 'pending_operator_image_review' };
  await write('summary.json', summary); console.log(JSON.stringify(summary));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runDetailAppearanceLive(parseDetailAppearanceArguments(process.argv.slice(2)));
