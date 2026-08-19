#!/usr/bin/env node
import crypto from 'node:crypto';
import fs, { constants as fsConstants } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { SketchUpBridge } from '../src/bridge.mjs';
import { freshSessionOptions } from '../src/live-session-contract.mjs';
import { verifyImageStructuredCompileReceipt } from '../src/image-structured-compile-receipts.mjs';
import { hasValidArtifactContentSignature } from '../src/image-structured-provenance.mjs';
import {
  compareSemanticSnapshots,
  deriveSemanticViewEvidenceFromSnapshot,
  validatePartGraphSemanticContract
} from '../src/product-modeling/semantic-contract-qa.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

export function assertSemanticLiveGatePreconditions({
  runtime,
  queueRequired,
  executeLive,
  disposableCopyConfirmed,
  runtimeOnly,
  sourceModel,
  dslPath,
  partGraphPath,
  compileManifestPath,
  outputDir
} = {}) {
  if (runtime !== 'queue' || queueRequired !== true) throw new Error('Live semantic gate requires --runtime queue --queue-required');
  if (executeLive !== true) throw new Error('Live semantic gate is disabled unless --execute-live is explicit');
  if (disposableCopyConfirmed !== true) throw new Error('Live semantic gate requires --disposable-copy-confirmed');
  const requiredInputs = { sourceModel, dslPath, partGraphPath, outputDir };
  if (runtimeOnly !== true) requiredInputs.compileManifestPath = compileManifestPath;
  for (const [name, value] of Object.entries(requiredInputs)) {
    if (!value) throw new Error(`${name} is required`);
  }
  const absoluteOutputDir = path.resolve(repoRoot, outputDir);
  const relativeOutput = path.relative(repoRoot, absoluteOutputDir);
  if (relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) throw new Error('Live semantic gate output directory must stay inside the repository');
  return { absoluteOutputDir };
}

export async function runImageStructuredSemanticLiveGate(options = {}) {
  const { absoluteOutputDir } = assertSemanticLiveGatePreconditions(options);
  const claimScope = options.runtimeOnly === true ? 'semantic_runtime_only' : 'image_structured_full';
  const timeoutMs = Number(options.timeoutMs || 20_000);
  const sourceModel = path.resolve(repoRoot, options.sourceModel);
  const dslPath = path.resolve(repoRoot, options.dslPath);
  const partGraphPath = path.resolve(repoRoot, options.partGraphPath);
  const compileManifestPath = options.runtimeOnly === true ? null : path.resolve(repoRoot, options.compileManifestPath);
  await assertRegularNonSymlinkFile(sourceModel, 'disposable source model');
  await assertRegularNonSymlinkFile(dslPath, 'safe JSON DSL');
  await assertRegularNonSymlinkFile(partGraphPath, 'PartGraph');
  if (compileManifestPath) await assertRegularNonSymlinkFile(compileManifestPath, 'image-structured compile manifest');
  const [dsl, partGraph, compileManifest] = await Promise.all([
    readJson(dslPath),
    readJson(partGraphPath),
    compileManifestPath ? readJson(compileManifestPath) : null
  ]);
  const precompile = validatePartGraphSemanticContract(partGraph, { phase: 'prelive', dsl });
  if (!precompile.ok) throw new Error(`PartGraph semantic contract fails before live execution: ${precompile.issues.map((issue) => issue.id).join(', ')}`);
  const meshAssertionCount = (partGraph.semantic_contract?.assertions || []).filter((assertion) => assertion.type === 'mesh_integrity').length;

  const compileReceiptStateDir = options.compileReceiptStateDir
    ? path.resolve(repoRoot, options.compileReceiptStateDir)
    : null;
  if (compileReceiptStateDir) {
    const relativeReceiptState = path.relative(repoRoot, compileReceiptStateDir);
    if (relativeReceiptState.startsWith('..') || path.isAbsolute(relativeReceiptState)) {
      throw new Error('Compile receipt state directory must stay inside the repository');
    }
  }
  const bridge = options.bridge || new SketchUpBridge({
    executionPolicy: {
      allowed_runtimes: ['queue'],
      allow_queue_mutation: true,
      allow_direct_expert_queue_mutation: true
    },
    ...(compileReceiptStateDir ? { imageStructuredCompileReceipts: { stateDir: compileReceiptStateDir } } : {})
  });
  if (claimScope === 'semantic_runtime_only') {
    assertRuntimeOnlyLiveBinding({ dsl, partGraph });
  } else {
    await assertLiveCompileBinding({ bridge, dsl, dslPath, partGraph, partGraphPath, compileManifest });
  }

  await fs.mkdir(absoluteOutputDir, { recursive: true });
  await assertNoSymlinkPathComponents(absoluteOutputDir, repoRoot);
  const runId = timestampId();
  const runDir = path.join(absoluteOutputDir, `live-${runId}`);
  await fs.mkdir(runDir, { recursive: false, mode: 0o700 });
  const workingCopy = path.join(runDir, `semantic-gate-working-copy-${runId}.skp`);
  const savedModel = path.join(runDir, `semantic-gate-result-${runId}.skp`);
  const reportPath = path.join(runDir, 'semantic-live-gate-report.json');
  await fs.copyFile(sourceModel, workingCopy, fsConstants.COPYFILE_EXCL);
  const sourceHash = await sha256File(sourceModel);
  if (await sha256File(workingCopy) !== sourceHash) throw new Error('Disposable working copy is not byte-identical to the source model');

  const steps = [];
  let report;
  try {
    const capabilities = await bridge.get_capabilities({ runtime: 'queue', timeoutMs });
    if (capabilities.runtime?.name !== 'queue' || capabilities.runtime?.dsl_version !== 1) {
      throw new Error('Fresh get_capabilities did not return the required queue DSL runtime');
    }
    steps.push({
      kind: 'get_capabilities_queue',
      ok: true,
      runtime: capabilities.runtime.name,
      capability_version: capabilities.runtime.capability_version,
      manifest_version: capabilities.runtime.manifest_version,
      dsl_version: capabilities.runtime.dsl_version
    });
    const preopenIdentity = await bridge.get_active_model_identity({ runtime: 'queue', timeoutMs: Math.min(timeoutMs, 20_000) });
    steps.push({
      kind: 'preopen_active_model_identity',
      ok: preopenIdentity.pending_open !== true,
      path: preopenIdentity.model_identity?.source_path || null,
      pending_open: preopenIdentity.pending_open === true,
      activation_confirmed: preopenIdentity.activation_confirmed !== false
    });
    if (preopenIdentity.pending_open === true) {
      throw new Error('A previous open_model is still awaiting SketchUp window activation; focus that model and retry with a fresh gate run.');
    }
    await bridge.open_model({
      runtime: 'queue',
      timeoutMs,
      path: workingCopy,
      ...await recordedFreshSessionOptions(bridge, steps, 'open_disposable_working_copy', timeoutMs)
    });
    steps.push({ kind: 'open_disposable_working_copy', ok: true, path: workingCopy });
    await waitForSemanticLiveModelActivation({
      bridge,
      expectedPath: workingCopy,
      steps,
      forStep: 'build',
      timeoutMs
    });

    const built = await bridge.build_model({
      runtime: 'queue',
      timeoutMs,
      code: JSON.stringify(dsl),
      ...await recordedFreshSessionOptions(bridge, steps, 'build', timeoutMs)
    });
    steps.push({ kind: 'build', ok: true, semantic_entity_count: semanticEntityCount(built.snapshot) });

    const saved = await bridge.save_model({
      runtime: 'queue',
      timeoutMs,
      path: savedModel,
      keep_session: true,
      ...await recordedFreshSessionOptions(bridge, steps, 'save', timeoutMs)
    });
    steps.push({ kind: 'save', ok: true, path: saved.file_path || savedModel });
    await assertRegularNonSymlinkFile(savedModel, 'saved live gate model');

    await bridge.open_model({
      runtime: 'queue',
      timeoutMs,
      path: savedModel,
      ...await recordedFreshSessionOptions(bridge, steps, 'reopen', timeoutMs)
    });
    steps.push({ kind: 'reopen', ok: true, path: savedModel });
    await waitForSemanticLiveModelActivation({
      bridge,
      expectedPath: savedModel,
      steps,
      forStep: 'adopt_reopened_model',
      timeoutMs
    });
    const reopened = await bridge.adopt_open_model({
      runtime: 'queue',
      timeoutMs,
      read_only: true,
      recursive: true,
      recursive_limit: 100000,
      ...await recordedFreshSessionOptions(bridge, steps, 'adopt_reopened_model', timeoutMs)
    });

    const captureSpecs = [
      { view: 'front', queueView: 'front', file: 'front.png', eye: [0, -100000, 5000] },
      { view: 'oblique', queueView: 'iso', file: 'oblique.png', eye: [80000, -80000, 60000] }
    ];
    const captures = [];
    for (const spec of captureSpecs) {
      const outputPath = path.join(runDir, spec.file);
      const positioningPath = path.join(runDir, `${spec.view}-camera-positioning.png`);
      const positioned = await bridge.capture_view({
        runtime: 'queue',
        timeoutMs,
        path: positioningPath,
        view: spec.queueView,
        width: 800,
        height: 500,
        zoom_extents: true,
        server_visual_capture: false,
        ...await recordedFreshSessionOptions(bridge, steps, `position_view_${spec.view}`, timeoutMs)
      });
      await assertRegularNonSymlinkFile(positioningPath, `${spec.view} camera positioning capture`);
      steps.push({
        kind: 'position_view',
        ok: true,
        view: spec.view,
        queue_view: spec.queueView,
        path: positioned.file_path || positioningPath
      });
      const captured = await bridge.capture_view({
        runtime: 'queue',
        timeoutMs,
        path: outputPath,
        view: 'current',
        width: 1600,
        height: 1000,
        zoom_extents: false,
        server_visual_capture: true,
        ...await recordedFreshSessionOptions(bridge, steps, `capture_${spec.view}`, timeoutMs)
      });
      await assertRegularNonSymlinkFile(outputPath, `${spec.view} capture`);
      const attestation = captured.read_only_attestation || {};
      const readOnlyAttestationVerified = attestation.server_visual_capture === true
        && attestation.state_unchanged === true
        && attestation.view_unchanged === true
        && attestation.model_revision_before === attestation.model_revision_after;
      if (!readOnlyAttestationVerified) throw new Error(`${spec.view} server visual capture lacks a stable read-only attestation`);
      const item = {
        kind: 'capture_view',
        ok: true,
        view: spec.view,
        queue_view: spec.queueView,
        path: captured.file_path || outputPath,
        eye: spec.eye,
        sha256: await sha256File(outputPath),
        server_visual_capture: true,
        read_only_attestation_verified: true
      };
      captures.push(item);
      steps.push(item);
    }

    const beforeSnapshot = built.snapshot;
    const afterSnapshot = reopened.snapshot || reopened;
    const beforeViewEvidence = deriveSemanticViewEvidenceFromSnapshot({ partGraph, snapshot: beforeSnapshot, captures });
    const afterViewEvidence = deriveSemanticViewEvidenceFromSnapshot({ partGraph, snapshot: afterSnapshot, captures });
    const semanticRevalidation = compareSemanticSnapshots({
      partGraph,
      beforeSnapshot,
      afterSnapshot,
      beforeViewEvidence,
      afterViewEvidence
    });
    const nativeMeshRemeasurement = meshAssertionCount > 0
      && semanticRevalidation.before.summary.native_mesh_remeasured >= meshAssertionCount
      && semanticRevalidation.after.summary.native_mesh_remeasured >= meshAssertionCount;
    const nativeMeshRequirementSatisfied = meshAssertionCount === 0 || nativeMeshRemeasurement;
    const sourceModelUnchanged = (await sha256File(sourceModel)) === sourceHash;
    const semanticLiveOk = semanticRevalidation.ok && nativeMeshRequirementSatisfied && sourceModelUnchanged;
    steps.push({
      kind: 'semantic_revalidation',
      ok: semanticLiveOk,
      digest_matches: semanticRevalidation.digest_matches,
      native_mesh_check_in_scope: meshAssertionCount > 0,
      native_mesh_remeasurement: nativeMeshRemeasurement,
      native_mesh_requirement_satisfied: nativeMeshRequirementSatisfied
    });
    steps.push({ kind: 'source_model_integrity', ok: sourceModelUnchanged, sha256: sourceHash });
    report = {
      version: 1,
      kind: 'image_structured_semantic_live_gate_report',
      claim_scope: claimScope,
      runtime: 'queue',
      ok: semanticLiveOk,
      live_status: semanticLiveOk ? 'scoped_live_verified' : 'live_unverified',
      evidence_level: semanticLiveOk ? 'queue_live_scoped' : 'queue_incomplete',
      source_model: { path: sourceModel, sha256: sourceHash, modified: !sourceModelUnchanged },
      disposable_working_copy: workingCopy,
      saved_model: { path: savedModel, sha256: await sha256File(savedModel) },
      inputs: {
        dsl: { path: dslPath, sha256: await sha256File(dslPath) },
        part_graph: { path: partGraphPath, sha256: await sha256File(partGraphPath) },
        compile_manifest: compileManifestPath ? { path: compileManifestPath, sha256: await sha256File(compileManifestPath) } : null,
        source_mode: partGraph.source_mode,
        interpretation_eligible: dsl.metadata?.interpretation_eligible === true,
        semantic_contract_id: partGraph.semantic_contract?.id || null,
        provenance_binding_hash: dsl.metadata?.provenance_binding_hash || null,
        source_asset_binding_hash: dsl.metadata?.source_asset_binding_hash || null,
        compile_receipt_id: compileManifest?.compile_receipt?.receipt_id || null
      },
      fresh_capability_handshake: true,
      capability_runtime: 'queue',
      steps,
      captures,
      save_reopen_semantic_digest_matches: semanticRevalidation.digest_matches,
      semantic_revalidation: semanticRevalidation,
      claim_boundaries: semanticLiveClaimBoundaries({ semanticLiveOk }),
      evidence_limits: semanticLiveEvidenceLimits({ nativeMeshRemeasurement, nativeMeshInScope: meshAssertionCount > 0 }),
      release_ready: false
    };
  } catch (error) {
    steps.push({ kind: 'live_gate_error', ok: false, error: error.message });
    report = {
      version: 1,
      kind: 'image_structured_semantic_live_gate_report',
      claim_scope: claimScope,
      runtime: 'queue',
      ok: false,
      live_status: 'live_unverified',
      evidence_level: 'queue_incomplete',
      source_model: { path: sourceModel, sha256: sourceHash, modified: (await sha256File(sourceModel)) !== sourceHash },
      disposable_working_copy: workingCopy,
      inputs: {
        dsl: { path: dslPath, sha256: await sha256File(dslPath) },
        part_graph: { path: partGraphPath, sha256: await sha256File(partGraphPath) },
        compile_manifest: compileManifestPath ? { path: compileManifestPath, sha256: await sha256File(compileManifestPath) } : null,
        source_mode: partGraph.source_mode,
        interpretation_eligible: dsl.metadata?.interpretation_eligible === true,
        semantic_contract_id: partGraph.semantic_contract?.id || null,
        provenance_binding_hash: dsl.metadata?.provenance_binding_hash || null,
        source_asset_binding_hash: dsl.metadata?.source_asset_binding_hash || null,
        compile_receipt_id: compileManifest?.compile_receipt?.receipt_id || null
      },
      fresh_capability_handshake: steps.some((step) => step.kind === 'get_capabilities_queue' && step.ok),
      capability_runtime: steps.some((step) => step.kind === 'get_capabilities_queue' && step.ok) ? 'queue' : null,
      steps,
      save_reopen_semantic_digest_matches: false,
      claim_boundaries: semanticLiveClaimBoundaries({ semanticLiveOk: false }),
      evidence_limits: semanticLiveEvidenceLimits({ nativeMeshRemeasurement: false, nativeMeshInScope: meshAssertionCount > 0 }),
      error: error.message,
      release_ready: false
    };
  }
  const validation = await validateSemanticLiveGateReport(report);
  if (!validation.ok) throw new Error(`Semantic live gate report failed its schema: ${JSON.stringify(validation.errors)}`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return { report, reportPath };
}

export async function validateSemanticLiveGateReport(report) {
  const schema = await readJson(path.join(repoRoot, 'schema/image-structured-semantic-live-gate-report.schema.json'));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  return { ok: validate(report), errors: validate.errors || [] };
}

async function assertRegularNonSymlinkFile(filePath, label) {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file: ${filePath}`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function sha256File(filePath) {
  return `sha256:${crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex')}`;
}

function semanticEntityCount(snapshot) {
  return (snapshot?.items || snapshot?.entities || snapshot?.objects || snapshot?.groups || []).length;
}

function semanticLiveEvidenceLimits({ nativeMeshRemeasurement, nativeMeshInScope }) {
  return {
    view_evidence: 'server_capture_bound_aabb_occlusion_projection',
    pixel_level_semantic_segmentation: false,
    native_mesh_check_in_scope: nativeMeshInScope === true,
    native_face_normal_remeasurement: nativeMeshRemeasurement === true,
    mesh_winding_evidence: nativeMeshInScope !== true
      ? 'not_in_scope'
      : nativeMeshRemeasurement === true ? 'native_runtime_face_measurement' : 'incomplete',
    note: 'A scoped live pass does not by itself prove pixel-level interpretation accuracy or release acceptance.'
  };
}

function semanticLiveClaimBoundaries({ semanticLiveOk }) {
  return {
    image_interpretation_accuracy: false,
    structured_semantic_contract: true,
    queue_execution_save_reopen: semanticLiveOk === true,
    note: 'This gate measures structured semantics and queue persistence only; it never upgrades image interpretation accuracy.'
  };
}

export function assertRuntimeOnlyLiveBinding({ dsl, partGraph } = {}) {
  if (!dsl || !partGraph) throw new Error('Runtime-only live binding requires both DSL and PartGraph');
  if (partGraph.source_mode === 'image_structured') {
    throw new Error('Runtime-only live gate cannot accept image_structured input; use the full signed lineage gate');
  }
  if (dsl.metadata?.source_mode !== partGraph.source_mode
    || dsl.metadata?.interpretation_eligible !== false
    || dsl.metadata?.part_graph_id !== partGraph.id
    || dsl.metadata?.semantic_contract?.id !== partGraph.semantic_contract?.id) {
    throw new Error('Runtime-only DSL metadata is not bound to the non-interpretation PartGraph semantic contract');
  }
  return true;
}

async function assertLiveCompileBinding({ bridge, dsl, dslPath, partGraph, partGraphPath, compileManifest }) {
  if (partGraph.source_mode !== 'image_structured' || !hasValidArtifactContentSignature(partGraph)) {
    throw new Error('Live semantic gate requires a signed image_structured PartGraph');
  }
  if (dsl.metadata?.source_mode !== 'image_structured'
    || dsl.metadata?.interpretation_eligible !== true
    || dsl.metadata?.part_graph_id !== partGraph.id
    || dsl.metadata?.semantic_contract?.id !== partGraph.semantic_contract?.id) {
    throw new Error('Safe DSL metadata is not bound to the image-structured PartGraph semantic contract');
  }
  if (compileManifest?.kind !== 'image_structured_mcp_compile_manifest'
    || compileManifest.preview_only !== true
    || compileManifest.queue_called !== false
    || compileManifest.summary?.part_graph_id !== partGraph.id
    || compileManifest.summary?.source_mode !== 'image_structured'
    || compileManifest.summary?.interpretation_eligible !== true
    || !/^sha256:[a-f0-9]{64}$/.test(String(compileManifest.summary?.source_asset_binding_hash || ''))
    || compileManifest.summary.source_asset_binding_hash !== dsl.metadata?.source_asset_binding_hash) {
    throw new Error('Image-structured compile manifest is missing or incompatible');
  }
  const dslSha256 = await sha256File(dslPath);
  if (compileManifest.artifacts?.safe_json_dsl_sha256 !== dslSha256) {
    throw new Error('Compile manifest DSL hash does not match the requested safe DSL bytes');
  }
  const manifestDslPath = path.resolve(repoRoot, compileManifest.artifacts?.safe_json_dsl_preview || '');
  const manifestPartGraphPath = path.resolve(repoRoot, compileManifest.inputs?.part_graph || '');
  if (manifestDslPath !== dslPath || manifestPartGraphPath !== partGraphPath) {
    throw new Error('Compile manifest input/output paths do not match the requested live artifacts');
  }
  const receipt = compileManifest.compile_receipt;
  const binding = {
    version: 1,
    kind: 'image_structured_compile_binding',
    source_mode: 'image_structured',
    part_graph_id: partGraph.id,
    artifact_signatures: { part_graph: partGraph.content_signature },
    accepted_candidate_ids: receipt?.accepted_candidate_ids || [],
    source_asset_binding_hash: compileManifest.summary.source_asset_binding_hash,
    binding_hash: compileManifest.summary?.provenance_binding_hash
  };
  const trustedKey = await bridge.imageStructuredReceiptAuthority.publicKeyPem();
  verifyImageStructuredCompileReceipt(receipt, {
    binding,
    publicKeyPem: trustedKey,
    dslSha256,
    expectedPhase: 'compiled_dsl'
  });
  if (dsl.metadata.provenance_binding_hash !== binding.binding_hash) {
    throw new Error('Safe DSL provenance binding does not match the compile manifest receipt');
  }
}

async function recordedFreshSessionOptions(bridge, steps, forStep, timeoutMs) {
  const options = await freshSessionOptions(bridge, { runtime: 'queue', timeoutMs });
  const contract = options.session_contract;
  steps.push({
    kind: 'fresh_queue_handshake',
    ok: true,
    for_step: forStep,
    handshake_id: contract.handshake_id,
    session_id: contract.session_id,
    document_id: contract.document_id,
    model_revision: contract.model_revision,
    expires_at: contract.expires_at
  });
  return options;
}

export async function waitForSemanticLiveModelActivation({ bridge, expectedPath, steps = [], forStep, timeoutMs }) {
  const started = Date.now();
  const activationTimeoutMs = Number(timeoutMs || 20_000);
  const boundedProbeTimeoutMs = Math.min(activationTimeoutMs, 20_000);
  let observedPath = null;
  while (Date.now() - started < activationTimeoutMs) {
    const identity = await bridge.get_active_model_identity({ timeoutMs: boundedProbeTimeoutMs });
    observedPath = identity?.model_identity?.source_path || null;
    if (observedPath && path.resolve(observedPath) === path.resolve(expectedPath)) {
      steps.push({
        kind: 'model_activation_confirmed',
        ok: true,
        for_step: forStep,
        path: expectedPath,
        document_id: identity.document_id || null,
        model_revision: identity.model_revision || null
      });
      return identity;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`SketchUp did not activate the expected model before timeout: ${observedPath || '<no-active-source-path>'}`);
}

async function assertNoSymlinkPathComponents(targetPath, allowedRoot) {
  const relative = path.relative(allowedRoot, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path leaves the allowed repository root');
  let cursor = allowedRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const stat = await fs.lstat(cursor);
    if (stat.isSymbolicLink()) throw new Error(`Live semantic gate path crosses a symlink: ${cursor}`);
  }
}

function timestampId() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
}

function parseArgs(argv) {
  const options = { runtime: 'queue', timeoutMs: 20_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = () => {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === '--runtime') options.runtime = take();
    else if (arg === '--queue-required') options.queueRequired = true;
    else if (arg === '--execute-live') options.executeLive = true;
    else if (arg === '--disposable-copy-confirmed') options.disposableCopyConfirmed = true;
    else if (arg === '--runtime-only') options.runtimeOnly = true;
    else if (arg === '--source-model') options.sourceModel = take();
    else if (arg === '--dsl') options.dslPath = take();
    else if (arg === '--part-graph') options.partGraphPath = take();
    else if (arg === '--compile-manifest') options.compileManifestPath = take();
    else if (arg === '--compile-receipt-state-dir') options.compileReceiptStateDir = take();
    else if (arg === '--output-dir') options.outputDir = take();
    else if (arg === '--timeout-ms') options.timeoutMs = Number(take());
    else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  process.stdout.write(`Usage:
  node scripts/run-image-structured-semantic-live-gate.mjs \\
    --runtime queue --queue-required --execute-live --disposable-copy-confirmed \\
    --source-model <disposable-source.skp> --dsl <safe-dsl.json> \\
    --part-graph <part-graph.json> --compile-manifest <manifest.json> \\
    --compile-receipt-state-dir <trusted-receipt-state-dir> \\
    --output-dir <workspace-output-dir>

For a structure/runtime-only run that is explicitly excluded from image interpretation
accuracy, add --runtime-only and omit --compile-manifest. The PartGraph must not use
source_mode=image_structured and its DSL must set interpretation_eligible=false.

This command switches SketchUp to a workspace-contained disposable copy, builds, saves,
reopens, captures front/oblique views, and revalidates the semantic contract.
`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  runImageStructuredSemanticLiveGate(options).then(({ report, reportPath }) => {
    process.stdout.write(`${JSON.stringify({ ok: report.ok, live_status: report.live_status, report: reportPath, release_ready: false }, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  }).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
