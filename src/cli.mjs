#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { SketchUpBridge } from './bridge.mjs';
import { formatModelQaReportMarkdown } from './model-qa.mjs';
import { formatReferenceVisualQaReportMarkdown } from './reference-visual-qa.mjs';
import { compareSnapshots } from './snapshot-diff.mjs';
import { formatSnapshotReportMarkdown } from './snapshot-report.mjs';

const bridge = new SketchUpBridge({ sessionContract: { serverSessionId: 'cli-session-contract.v1' } });

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  const options = parseArgs(argv);
  if (options.sessionContractFile) {
    const document = JSON.parse(await fs.readFile(options.sessionContractFile, 'utf8'));
    options.sessionContract = document.session_contract || document;
  }
  if (options.freshHandshake === true && !options.sessionContract && command !== 'create_queue_handshake') {
    options.sessionContract = (await bridge.create_queue_handshake({ expires_in_ms: options.expiresInMs, timeoutMs: options.timeoutMs })).session_contract;
  }

  switch (command) {
    case 'get_docs':
      return output(await bridge.get_docs({ topic: options.topic, detail: options.detail, max_chars: options.maxChars }), options);
    case 'get_workflow_bundle':
      return output(await bridge.get_workflow_bundle(), options);
    case 'get_capabilities':
      return output(await bridge.get_capabilities({ runtime: options.runtime || 'mock', timeoutMs: options.timeoutMs }), options);
    case 'create_queue_handshake':
      return output(await bridge.create_queue_handshake({ expires_in_ms: options.expiresInMs, timeoutMs: options.timeoutMs }), options);
    case 'queue_diagnostics':
      return output(await bridge.queue_diagnostics({ includeFiles: options.includeFiles === true, timeoutMs: options.timeoutMs }), options);
    case 'recover_queue_response':
      return output(await bridge.recover_queue_response({
        request_id: options.requestId,
        expected_result_kind: options.expectedResultKind,
        expected_client_pid: options.expectedClientPid,
        timeoutMs: options.timeoutMs
      }), options);
    case 'reset_model':
      return output(await bridge.reset_model({ runtime: options.runtime || 'mock', timeoutMs: options.timeoutMs, ...liveSessionOptions(options) }), options);
    case 'build_model': {
      const code = options.codeFile ? await fs.readFile(options.codeFile, 'utf8') : options.code;
      return output(await bridge.build_model({ code, runtime: options.runtime || 'mock', timeoutMs: options.timeoutMs, ...liveSessionOptions(options) }), options);
    }
    case 'compile_expert': {
      const code = options.codeFile ? await fs.readFile(options.codeFile, 'utf8') : options.code;
      return output(await bridge.compile_expert({ code, ...expertOptions(options) }), options);
    }
    case 'compile_python_sdk': {
      const code = options.codeFile ? await fs.readFile(options.codeFile, 'utf8') : options.code;
      return output(await bridge.compile_python_sdk({ code, ...pythonSdkOptions(options) }), options);
    }
    case 'build_expert_model': {
      const code = options.codeFile ? await fs.readFile(options.codeFile, 'utf8') : options.code;
      return output(await bridge.build_expert_model({ code, runtime: options.runtime || 'mock', timeoutMs: options.timeoutMs, ...expertOptions(options), ...liveSessionOptions(options) }), options);
    }
    case 'save_model':
      return output(await bridge.save_model({ path: options.path, keep_session: options.keepSession !== false, runtime: options.runtime || 'mock', timeoutMs: options.timeoutMs, ...liveSessionOptions(options) }), options);
    case 'save_model_version':
      return output(await bridge.save_model_version({ path: options.path, base_path: options.basePath, label: options.label, keep_session: options.keepSession !== false, runtime: options.runtime || 'mock', timeoutMs: options.timeoutMs, ...liveSessionOptions(options) }), options);
    case 'open_model':
      return output(await bridge.open_model({ path: options.path, runtime: options.runtime || 'queue', timeoutMs: options.timeoutMs, ...liveSessionOptions(options) }), options);
    case 'import_model':
      return output(await bridge.import_model({ path: options.path, mode: options.mode, prefix: options.prefix, runtime: options.runtime || 'queue', timeoutMs: options.timeoutMs, ...liveSessionOptions(options) }), options);
    case 'export_model':
      return output(await bridge.export_model({ path: options.path, format: options.exportFormat, runtime: options.runtime || 'queue', timeoutMs: options.timeoutMs, ...liveSessionOptions(options) }), options);
    case 'get_model_info':
      return output(await bridge.get_model_info({ runtime: options.runtime || 'mock', timeoutMs: options.timeoutMs }), options);
    case 'list_entities':
      return output(await bridge.list_entities({ runtime: options.runtime || 'mock', timeoutMs: options.timeoutMs, includeHidden: options.includeHidden !== false, kind: options.kind, material: options.material, tag: options.tag, name: options.name }), options);
    case 'inspect_model':
      return output(await bridge.inspect_model({ runtime: options.runtime || 'mock', timeoutMs: options.timeoutMs, includeEntities: options.includeEntities !== false, includeSnapshot: options.includeSnapshot === true, includeHidden: options.includeHidden !== false, kind: options.kind, material: options.material, tag: options.tag, name: options.name }), options);
    case 'adopt_open_model':
      return output(await bridge.adopt_open_model({
        runtime: options.runtime || 'mock',
        timeoutMs: options.timeoutMs,
        recursive: options.recursive === true,
        recursive_limit: options.recursiveLimit,
        force: options.force === true,
        prefix: options.prefix,
        read_only: options.readOnly === true,
        ...structuralProbeCliOptions(options),
        ...liveSessionOptions(options)
      }), options);
    case 'resolve_model_targets':
      return output(await bridge.resolve_model_targets({
        query: options.query || options.targetQuery,
        runtime: options.runtime || 'mock',
        timeoutMs: options.timeoutMs,
        includeHidden: options.includeHidden !== false,
        kind: options.kind,
        material: options.material,
        tag: options.tag,
        name: options.name,
        definition: options.definition,
        side: options.side,
        nth: options.nth,
        index: options.index,
        targets: options.targets,
        largest: options.largest,
        smallest: options.smallest,
        selection: options.selection,
        allowMultiple: options.allowMultiple === true,
        limit: options.limit
      }), options);
    case 'get_selection':
      return output(await bridge.get_selection({ runtime: options.runtime || 'mock', timeoutMs: options.timeoutMs }), options);
    case 'analyze_selection_geometry':
      return output(await bridge.analyze_selection_geometry({
        runtime: options.runtime || 'mock',
        timeoutMs: options.timeoutMs,
        assume: options.assume,
        includeDetails: options.includeDetails !== false
      }), options);
    case 'plan_modification_intent': {
      const parameters = await readOptionalJsonOption(options.parametersJson, options.parametersFile, 'parameters');
      return output(await bridge.plan_modification_intent({
        instruction: options.instruction || options.code,
        action: options.action,
        parameters,
        target_query: options.targetQuery || options.query,
        targets: options.targets,
        assume: options.assume,
        output_dir: options.outputDir,
        compile_patch: options.compilePatch,
        allow_ambiguous_targets: options.allowAmbiguousTargets,
        runtime: options.runtime || 'mock',
        timeoutMs: options.timeoutMs
      }), options);
    }
    case 'set_selection':
      return output(await bridge.set_selection({ targets: options.targets || [], mode: options.mode || 'replace', runtime: options.runtime || 'mock', timeoutMs: options.timeoutMs, ...liveSessionOptions(options) }), options);
    case 'capture_view':
      return output(await bridge.capture_view({
        path: options.path,
        view: options.view,
        scene: options.scene,
        width: options.width,
        height: options.height,
        antialias: options.antialias,
        compression: options.compression,
        zoom_extents: options.zoomExtents,
        runtime: options.runtime || 'queue',
        timeoutMs: options.timeoutMs,
        ...liveSessionOptions(options)
      }), options);
    case 'run_ruby_expert': {
      const code = options.codeFile ? await fs.readFile(options.codeFile, 'utf8') : options.code;
      return output(await bridge.run_ruby_expert({
        code,
        audit_path: options.auditPath,
        runtime: options.runtime || 'queue',
        timeoutMs: options.timeoutMs,
        ...liveSessionOptions(options)
      }), options);
    }
    case 'evaluate_py': {
      const code = options.codeFile ? await fs.readFile(options.codeFile, 'utf8') : options.code;
      return output(await bridge.evaluate_py({
        code,
        input_format: options.inputFormat,
        audit_path: options.auditPath,
        runtime: options.runtime || 'mock',
        timeoutMs: options.timeoutMs,
        ...expertOptions(options),
        ...pythonSdkOptions(options),
        ...liveSessionOptions(options)
      }), options);
    }
    case 'build_report': {
      const code = options.codeFile ? await fs.readFile(options.codeFile, 'utf8') : options.code;
      const snapshot = options.snapshotFile ? await readSnapshotJson(options.snapshotFile, 'snapshot') : undefined;
      const modelSpec = options.modelSpecFile ? JSON.parse(await fs.readFile(options.modelSpecFile, 'utf8')) : (options.specFile ? JSON.parse(await fs.readFile(options.specFile, 'utf8')) : undefined);
      const referenceSpec = options.referenceSpecFile ? JSON.parse(await fs.readFile(options.referenceSpecFile, 'utf8')) : undefined;
      return output(await bridge.build_report({
        code,
        snapshot,
        output_dir: options.outputDir,
        save_path: options.path,
        save_model: options.saveModel,
        capture_view: options.captureView,
        capture: captureOptions(options),
        validate_model: options.validateModel,
        validate_reference_model: options.validateReferenceModel,
        model_spec: modelSpec,
        reference_spec: referenceSpec,
        runtime: options.runtime || 'mock',
        timeoutMs: options.timeoutMs,
        includePreview: options.includePreview !== false,
        ...liveSessionOptions(options)
      }), options);
    }
    case 'iterate_model': {
      const code = options.codeFile ? await fs.readFile(options.codeFile, 'utf8') : options.code;
      const modelSpec = options.modelSpecFile ? JSON.parse(await fs.readFile(options.modelSpecFile, 'utf8')) : (options.specFile ? JSON.parse(await fs.readFile(options.specFile, 'utf8')) : undefined);
      const referenceSpec = options.referenceSpecFile ? JSON.parse(await fs.readFile(options.referenceSpecFile, 'utf8')) : undefined;
      const intent = await readOptionalJsonOption(options.intentJson, undefined, 'intent');
      return output(await bridge.iterate_model({
        code,
        intent,
        intent_file: options.intentFile,
        input_format: options.inputFormat,
        label: options.label,
        output_dir: options.outputDir,
        targets: options.targets,
        target_query: options.targetQuery || options.query,
        allow_ambiguous_targets: options.allowAmbiguousTargets,
        preview_only: options.previewOnly,
        selection_mode: options.mode,
        save_model: options.saveModel,
        save_path: options.path,
        capture_view: options.captureView,
        validate_model: options.validateModel,
        validate_reference_model: options.validateReferenceModel,
        model_spec: modelSpec,
        reference_spec: referenceSpec,
        runtime: options.runtime || 'mock',
        timeoutMs: options.timeoutMs,
        includePreview: options.includePreview !== false,
        toleranceMm: options.toleranceMm,
        topologyTolerance: topologyToleranceOptions(options),
        budgets: budgetOptions(options),
        topIssueLimit: options.topIssueLimit,
        strictCollisions: options.strictCollisions,
        strictUnanchored: options.strictUnanchored,
        floatingDetails: options.floatingDetails,
        ...expertOptions(options),
        ...pythonSdkOptions(options),
        ...liveSessionOptions(options)
      }), options);
    }
    case 'compare_snapshots': {
      const expected = await readSnapshotJson(options.expectedFile, 'expected');
      const actual = await readSnapshotJson(options.actualFile, 'actual');
      return output(compareSnapshots(expected, actual, { toleranceMm: options.toleranceMm, topologyTolerance: topologyToleranceOptions(options), budgets: budgetOptions(options), topIssueLimit: options.topIssueLimit }), options, { markdownTitle: 'SketchUp Snapshot Compare Report' });
    }
    case 'compare_model': {
      const code = options.codeFile ? await fs.readFile(options.codeFile, 'utf8') : options.code;
      return output(await bridge.compare_model({
        code,
        expected_runtime: options.expectedRuntime || 'mock',
        actual_runtime: options.actualRuntime || 'queue',
        timeoutMs: options.timeoutMs,
        reset_first: options.resetFirst !== false,
        toleranceMm: options.toleranceMm,
        topologyTolerance: topologyToleranceOptions(options),
        budgets: budgetOptions(options),
        topIssueLimit: options.topIssueLimit,
        include_snapshots: options.includeSnapshots === true,
        ...liveSessionOptions(options)
      }), options, { markdownTitle: 'SketchUp Model Runtime Compare Report' });
    }
    case 'validate_model': {
      const code = options.codeFile ? await fs.readFile(options.codeFile, 'utf8') : options.code;
      const snapshot = options.snapshotFile ? await readSnapshotJson(options.snapshotFile, 'snapshot') : undefined;
      const spec = options.specFile ? JSON.parse(await fs.readFile(options.specFile, 'utf8')) : undefined;
      const result = await bridge.validate_model({
        code,
        snapshot,
        spec,
        runtime: options.runtime || 'mock',
        timeoutMs: options.timeoutMs,
        includePreview: options.includePreview !== false,
        strictCollisions: options.strictCollisions,
        strictUnanchored: options.strictUnanchored,
        floatingDetails: options.floatingDetails,
        ...liveSessionOptions(options)
      });
      if (options.previewDir) {
        await writePreviewFiles(result, options.previewDir);
      }
      return output(result, options, { markdownTitle: 'SketchUp Model QA Report' });
    }
    case 'validate_reference_model': {
      const code = options.codeFile ? await fs.readFile(options.codeFile, 'utf8') : options.code;
      const snapshot = options.snapshotFile ? await readSnapshotJson(options.snapshotFile, 'snapshot') : undefined;
      const spec = options.specFile ? JSON.parse(await fs.readFile(options.specFile, 'utf8')) : undefined;
      const result = await bridge.validate_reference_model({
        code,
        snapshot,
        spec,
        runtime: options.runtime || 'mock',
        timeoutMs: options.timeoutMs,
        includePreview: options.includePreview !== false,
        ...liveSessionOptions(options)
      });
      if (options.previewDir) {
        await writePreviewFiles(result, options.previewDir);
      }
      return output(result, options, { markdownTitle: 'SketchUp Reference Visual QA Report' });
    }
    default:
      usage();
      process.exit(command ? 1 : 0);
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--runtime') options.runtime = argv[++index];
    else if (arg === '--request-id') options.requestId = argv[++index];
    else if (arg === '--expected-result-kind') options.expectedResultKind = argv[++index];
    else if (arg === '--expected-client-pid') options.expectedClientPid = Number(argv[++index]);
    else if (arg === '--expected-runtime') options.expectedRuntime = argv[++index];
    else if (arg === '--actual-runtime') options.actualRuntime = argv[++index];
    else if (arg === '--code') options.code = argv[++index];
    else if (arg === '--code-file') options.codeFile = argv[++index];
    else if (arg === '--path') options.path = argv[++index];
    else if (arg === '--base-path') options.basePath = argv[++index];
    else if (arg === '--label') options.label = argv[++index];
    else if (arg === '--mode') options.mode = argv[++index];
    else if (arg === '--prefix') options.prefix = argv[++index];
    else if (arg === '--kind') options.kind = argv[++index];
    else if (arg === '--material') options.material = argv[++index];
    else if (arg === '--tag') options.tag = argv[++index];
    else if (arg === '--name') options.name = argv[++index];
    else if (arg === '--definition') options.definition = argv[++index];
    else if (arg === '--side') options.side = argv[++index];
    else if (arg === '--nth') options.nth = Number(argv[++index]);
    else if (arg === '--index') options.index = Number(argv[++index]);
    else if (arg === '--query') options.query = argv[++index];
    else if (arg === '--topic') options.topic = argv[++index];
    else if (arg === '--detail') options.detail = argv[++index];
    else if (arg === '--target-query') options.targetQuery = argv[++index];
    else if (arg === '--assume') options.assume = argv[++index];
    else if (arg === '--instruction') options.instruction = argv[++index];
    else if (arg === '--action') options.action = argv[++index];
    else if (arg === '--limit') options.limit = Number(argv[++index]);
    else if (arg === '--recursive-limit') options.recursiveLimit = Number(argv[++index]);
    else if (arg === '--structural-groups') options.structuralGroups = true;
    else if (arg === '--structural-group-limit') options.structuralGroupLimit = Number(argv[++index]);
    else if (arg === '--fresh-manifold-path') {
      options.freshManifoldPaths ||= [];
      options.freshManifoldPaths.push(argv[++index]);
    }
    else if (arg === '--expires-in-ms') options.expiresInMs = Number(argv[++index]);
    else if (arg === '--session-contract-file') options.sessionContractFile = argv[++index];
    else if (arg === '--target') {
      options.targets ||= [];
      options.targets.push(argv[++index]);
    }
    else if (arg === '--targets-json') options.targets = JSON.parse(argv[++index]);
    else if (arg === '--parameters-json') options.parametersJson = argv[++index];
    else if (arg === '--parameters-file') options.parametersFile = argv[++index];
    else if (arg === '--intent-json') options.intentJson = argv[++index];
    else if (arg === '--intent-file') options.intentFile = argv[++index];
    else if (arg === '--input-format') options.inputFormat = argv[++index];
    else if (arg === '--export-format') options.exportFormat = argv[++index];
    else if (arg === '--output-dir') options.outputDir = argv[++index];
    else if (arg === '--audit-path') options.auditPath = argv[++index];
    else if (arg === '--view') options.view = argv[++index];
    else if (arg === '--scene') options.scene = argv[++index];
    else if (arg === '--width') options.width = Number(argv[++index]);
    else if (arg === '--height') options.height = Number(argv[++index]);
    else if (arg === '--compression') options.compression = Number(argv[++index]);
    else if (arg === '--output-file') options.outputFile = argv[++index];
    else if (arg === '--format') options.format = argv[++index];
    else if (arg === '--expected-file') options.expectedFile = argv[++index];
    else if (arg === '--actual-file') options.actualFile = argv[++index];
    else if (arg === '--snapshot-file') options.snapshotFile = argv[++index];
    else if (arg === '--spec-file') options.specFile = argv[++index];
    else if (arg === '--model-spec-file') options.modelSpecFile = argv[++index];
    else if (arg === '--reference-spec-file') options.referenceSpecFile = argv[++index];
    else if (arg === '--preview-dir') options.previewDir = argv[++index];
    else if (arg === '--tolerance-mm') options.toleranceMm = Number(argv[++index]);
    else if (arg === '--face-tolerance') options.faceTolerance = Number(argv[++index]);
    else if (arg === '--edge-tolerance') options.edgeTolerance = Number(argv[++index]);
    else if (arg === '--group-tolerance') options.groupTolerance = Number(argv[++index]);
    else if (arg === '--instance-tolerance') options.instanceTolerance = Number(argv[++index]);
    else if (arg === '--top-issues') options.topIssueLimit = Number(argv[++index]);
    else if (arg === '--max-faces') options.maxFaces = Number(argv[++index]);
    else if (arg === '--max-edges') options.maxEdges = Number(argv[++index]);
    else if (arg === '--max-vertices') options.maxVertices = Number(argv[++index]);
    else if (arg === '--max-groups') options.maxGroups = Number(argv[++index]);
    else if (arg === '--max-instances') options.maxInstances = Number(argv[++index]);
    else if (arg === '--max-artifact-size-bytes') options.maxArtifactSizeBytes = Number(argv[++index]);
    else if (arg === '--max-operations') options.maxOperations = Number(argv[++index]);
    else if (arg === '--max-loop-iterations') options.maxLoopIterations = Number(argv[++index]);
    else if (arg === '--max-statements') options.maxStatements = Number(argv[++index]);
    else if (arg === '--max-output-bytes') options.maxOutputBytes = Number(argv[++index]);
    else if (arg === '--max-chars') options.maxChars = Number(argv[++index]);
    else if (arg === '--expert-timeout-ms') options.expertTimeoutMs = Number(argv[++index]);
    else if (arg === '--python-timeout-ms') options.pythonTimeoutMs = Number(argv[++index]);
    else if (arg === '--python-command') options.pythonCommand = argv[++index];
    else if (arg === '--seed') options.seed = Number(argv[++index]);
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else if (arg === '--no-keep-session') options.keepSession = false;
    else if (arg === '--no-reset-first') options.resetFirst = false;
    else if (arg === '--include-snapshots') options.includeSnapshots = true;
    else if (arg === '--include-snapshot') options.includeSnapshot = true;
    else if (arg === '--no-entities') options.includeEntities = false;
    else if (arg === '--no-hidden') options.includeHidden = false;
    else if (arg === '--include-files') options.includeFiles = true;
    else if (arg === '--recursive') options.recursive = true;
    else if (arg === '--read-only') options.readOnly = true;
    else if (arg === '--fresh-handshake') options.freshHandshake = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--largest') options.largest = true;
    else if (arg === '--smallest') options.smallest = true;
    else if (arg === '--selection') options.selection = true;
    else if (arg === '--allow-multiple') options.allowMultiple = true;
    else if (arg === '--allow-ambiguous-targets') options.allowAmbiguousTargets = true;
    else if (arg === '--compile-patch') options.compilePatch = true;
    else if (arg === '--no-compile-patch') options.compilePatch = false;
    else if (arg === '--preview-only') options.previewOnly = true;
    else if (arg === '--antialias') options.antialias = true;
    else if (arg === '--no-antialias') options.antialias = false;
    else if (arg === '--zoom-extents') options.zoomExtents = true;
    else if (arg === '--no-zoom-extents') options.zoomExtents = false;
    else if (arg === '--no-preview') options.includePreview = false;
    else if (arg === '--no-details') options.includeDetails = false;
    else if (arg === '--no-save-model') options.saveModel = false;
    else if (arg === '--capture-view') options.captureView = true;
    else if (arg === '--no-validate-model') options.validateModel = false;
    else if (arg === '--validate-reference-model') options.validateReferenceModel = true;
    else if (arg === '--strict-collisions') options.strictCollisions = true;
    else if (arg === '--loose-collisions') options.strictCollisions = false;
    else if (arg === '--strict-unanchored') options.strictUnanchored = true;
    else if (arg === '--no-floating-details') options.floatingDetails = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function expertOptions(options) {
  return {
    seed: options.seed,
    maxOperations: options.maxOperations,
    maxLoopIterations: options.maxLoopIterations,
    maxStatements: options.maxStatements,
    maxOutputBytes: options.maxOutputBytes,
    expertTimeoutMs: options.expertTimeoutMs
  };
}

function pythonSdkOptions(options) {
  return {
    maxOperations: options.maxOperations,
    maxLoopIterations: options.maxLoopIterations,
    maxStatements: options.maxStatements,
    maxOutputBytes: options.maxOutputBytes,
    pythonTimeoutMs: options.pythonTimeoutMs,
    pythonCommand: options.pythonCommand
  };
}

function liveSessionOptions(options) {
  return options.sessionContract ? { session_contract: options.sessionContract } : {};
}

function structuralProbeCliOptions(options) {
  const result = {};
  if (options.structuralGroups === true) result.structural_groups = true;
  if (options.structuralGroupLimit !== undefined) result.structural_group_limit = options.structuralGroupLimit;
  if (Array.isArray(options.freshManifoldPaths)) result.fresh_manifold_paths = options.freshManifoldPaths;
  return result;
}

function captureOptions(options) {
  const capture = {};
  for (const key of ['view', 'scene', 'width', 'height', 'antialias', 'compression']) {
    if (options[key] !== undefined) capture[key] = options[key];
  }
  if (options.zoomExtents !== undefined) capture.zoom_extents = options.zoomExtents;
  return Object.keys(capture).length ? capture : undefined;
}

async function readSnapshotJson(filePath, label) {
  if (!filePath) throw new Error(`compare_snapshots requires --${label}-file`);
  const document = JSON.parse(await fs.readFile(filePath, 'utf8'));
  if (!document.snapshot) return document;
  return {
    ...document.snapshot,
    artifact_size_bytes: document.snapshot.artifact_size_bytes ?? document.file_size_bytes
  };
}

async function readOptionalJsonOption(jsonValue, filePath, label) {
  if (filePath) return JSON.parse(await fs.readFile(filePath, 'utf8'));
  if (jsonValue === undefined) return undefined;
  try {
    return JSON.parse(jsonValue);
  } catch (error) {
    throw new Error(`--${label}-json must be valid JSON: ${error.message}`);
  }
}

function topologyToleranceOptions(options) {
  return {
    faces: options.faceTolerance,
    edges: options.edgeTolerance,
    groups: options.groupTolerance,
    instances: options.instanceTolerance
  };
}

function budgetOptions(options) {
  return {
    max_faces: options.maxFaces,
    max_edges: options.maxEdges,
    max_vertices: options.maxVertices,
    max_groups: options.maxGroups,
    max_instances: options.maxInstances,
    max_artifact_size_bytes: options.maxArtifactSizeBytes
  };
}

async function output(value, options, { markdownTitle } = {}) {
  const rendered = renderOutput(value, options, { markdownTitle });
  if (options.outputFile) {
    await fs.writeFile(options.outputFile, rendered, 'utf8');
    process.stderr.write(`Wrote ${options.format || 'json'} output to ${options.outputFile}\n`);
    return;
  }
  process.stdout.write(rendered);
}

function renderOutput(value, options, { markdownTitle } = {}) {
  if (options.format === 'markdown') {
    if (value?.kind === 'model_qa') {
      return formatModelQaReportMarkdown(value, { title: markdownTitle || 'SketchUp Model QA Report' });
    }
    if (value?.kind === 'reference_visual_qa') {
      return formatReferenceVisualQaReportMarkdown(value, { title: markdownTitle || 'SketchUp Reference Visual QA Report' });
    }
    return formatSnapshotReportMarkdown(value, { title: markdownTitle || 'SketchUp QA Report' });
  }
  if (options.format === 'dsl') {
    if (typeof value.code !== 'string') throw new Error('--format dsl requires a compile_expert result');
    return value.code;
  }
  if (options.format && options.format !== 'json') {
    throw new Error(`Unknown format: ${options.format}`);
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writePreviewFiles(report, previewDir) {
  if (!report.preview) return;
  await fs.mkdir(previewDir, { recursive: true });
  const viewFiles = [];
  for (const view of report.preview.views || []) {
    const fileName = `${safeFileName(view.name)}.svg`;
    const filePath = path.join(previewDir, fileName);
    await fs.writeFile(filePath, view.svg, 'utf8');
    viewFiles.push({ name: view.name, path: filePath });
  }
  const htmlPath = path.join(previewDir, 'index.html');
  await fs.writeFile(htmlPath, report.preview.html, 'utf8');
  report.preview_files = { html: htmlPath, views: viewFiles };
}

function safeFileName(value) {
  return String(value || 'view').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'view';
}

function usage() {
  process.stdout.write(`Usage:
  node src/cli.mjs get_docs
  node src/cli.mjs get_workflow_bundle
  node src/cli.mjs get_capabilities [--runtime mock|queue]
  node src/cli.mjs create_queue_handshake [--expires-in-ms 120000] [--output-file output/session-contract.json]
  node src/cli.mjs queue_diagnostics [--include-files]
  node src/cli.mjs recover_queue_response --request-id CLIENTPID-CREATEDMS-UUID --expected-result-kind queue_session_state [--expected-client-pid CLIENTPID]
  node src/cli.mjs reset_model [--runtime mock|queue] [--session-contract-file output/session-contract.json]
  node src/cli.mjs build_model --code-file examples/demo-room.json [--runtime mock|queue]
  node src/cli.mjs compile_expert --code-file examples/expert-parametric-fixture.js [--format dsl]
  node src/cli.mjs compile_python_sdk --code-file examples/python-sdk-facade-fixture.py [--format dsl]
  node src/cli.mjs build_expert_model --code-file examples/expert-parametric-fixture.js [--runtime mock|queue]
  node src/cli.mjs save_model --path output/model.json [--runtime mock|queue] [--no-keep-session]
  node src/cli.mjs save_model_version [--path output/model-version.json] [--base-path output/model.json] [--label review] [--runtime mock|queue]
  node src/cli.mjs open_model --path output/model.json [--runtime mock|queue]
  node src/cli.mjs import_model --path input/model.skp [--mode append|replace] [--prefix Imported] [--runtime mock|queue]  # replace is mock-only; queue fails closed
  node src/cli.mjs export_model --path output/model.obj [--export-format obj] [--runtime mock|queue]
  node src/cli.mjs get_model_info [--runtime mock|queue]
  node src/cli.mjs list_entities [--runtime mock|queue] [--kind box] [--material Wall] [--tag Level1] [--name wall] [--no-hidden]
  node src/cli.mjs inspect_model [--runtime mock|queue] [--include-snapshot] [--no-entities]
  node src/cli.mjs adopt_open_model [--runtime mock|queue] [--read-only] [--recursive] [--recursive-limit 500] [--structural-groups] [--structural-group-limit 500] [--fresh-manifold-path pid:...] [--force] [--prefix adopted]
  node src/cli.mjs resolve_model_targets --query "largest cabinet" [--runtime mock|queue] [--kind box] [--material Oak] [--side left] [--allow-multiple]
  node src/cli.mjs get_selection [--runtime mock|queue]
  node src/cli.mjs analyze_selection_geometry [--runtime mock|queue] [--assume road] [--no-details]
  node src/cli.mjs plan_modification_intent --instruction "paint selected cabinet" --action set_material --parameters-json '{"material":"Oak"}' [--target-query "current selection"] [--output-dir output/intent] [--runtime mock|queue]
  node src/cli.mjs set_selection --target object-id [--target other-id] [--mode replace|add|remove|clear] [--runtime mock|queue]
  node src/cli.mjs capture_view --path output/capture.png [--view current|top|front|right|iso] [--scene Scene_Name] [--width 1280] [--height 720] [--runtime queue]
  LOCAL_MCP_FOR_SKETCHUP_ENABLE_RUBY_EXPERT=1 node src/cli.mjs run_ruby_expert --code 'Sketchup.active_model.title' [--audit-path output/ruby-expert-audit.json] [--runtime queue]
  node src/cli.mjs evaluate_py --code-file examples/demo-room.json [--input-format json_dsl|python_sdk|restricted_expert|ruby_expert] [--runtime mock|queue]
  node src/cli.mjs build_report --code-file examples/demo-room.json [--output-dir output/build-report] [--model-spec-file examples/model-qa/spec.json] [--reference-spec-file examples/reference-visual-qa/spec.json] [--capture-view] [--runtime mock|queue]
  node src/cli.mjs iterate_model --code-file patch.json [--input-format json_dsl|python_sdk|restricted_expert] [--target object-id] [--target-query "largest cabinet"] [--preview-only] [--label review] [--output-dir output/iterations/review] [--runtime mock|queue]
  node src/cli.mjs iterate_model --intent-file output/intent/modification-intent.json [--output-dir output/iterations/from-intent] [--runtime mock|queue]
  node src/cli.mjs compare_snapshots --expected-file output/mock-a.json --actual-file output/mock-b.json [--tolerance-mm 1] [--face-tolerance 1] [--edge-tolerance 3] [--max-faces 5000] [--max-artifact-size-bytes 50000000] [--format markdown] [--output-file output/report.md]
  node src/cli.mjs compare_model --code-file examples/demo-room.json [--expected-runtime mock] [--actual-runtime queue] [--timeout-ms 60000] [--face-tolerance 1] [--edge-tolerance 3] [--format markdown] [--output-file output/report.md]
  node src/cli.mjs validate_model --code-file examples/demo-room.json [--runtime mock|queue] [--spec-file examples/model-qa/spec.json] [--preview-dir output/model-qa/demo] [--format markdown] [--output-file output/model-qa/demo.md]
  node src/cli.mjs validate_reference_model --code-file examples/acceptance-ambulance-reference.json [--runtime mock|queue] [--spec-file examples/reference-visual-qa/ambulance-reference.json] [--preview-dir output/reference-visual-qa/ambulance-reference] [--format markdown] [--output-file output/reference-visual-qa/ambulance-reference/report.md]

Runtime notes:
  mock  - deterministic offline runtime for tests and local iteration.
  queue - sends requests to the SketchUp Ruby plugin through ~/.local-mcp-for-sketchup. Live mutations require --session-contract-file, or explicit same-command --fresh-handshake.
`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
