import fs from 'node:fs/promises';
import path from 'node:path';
import { getRuntimeCapabilities } from './capabilities.mjs';
import { getDocs } from './docs.mjs';
import { compileExpertScript } from './expert-compiler.mjs';
import { compilePythonSdkScript } from './python-sdk-compiler.mjs';
import { modelInfoFromSnapshot } from './model-inspection.mjs';
import { MockRuntime } from './mock-runtime.mjs';
import { QueueRuntime } from './queue-runtime.mjs';
import { validateModelSnapshot } from './model-qa.mjs';
import { validateReferenceVisualSnapshot } from './reference-visual-qa.mjs';
import { compareSnapshots } from './snapshot-diff.mjs';
import { getWorkflowBundle } from './workflows.mjs';
import { runModelIteration } from './iteration.mjs';
import { expandDslCode } from './dsl-expansion.mjs';
import { buildLimitationsReport, formatLimitationsReportMarkdown } from './limitations-report.mjs';
import { resolveTargets } from './target-resolution.mjs';
import { analyzeSelectionGeometry } from './selection-geometry-interpreter.mjs';
import { planModificationIntent } from './modification-intent.mjs';
import { compileReviewedPartGraph, prepareImageModelingBrief } from './image-structured-mcp-adapter.mjs';

export class SketchUpBridge {
  constructor(options = {}) {
    this.options = options;
    this.mockRuntime = new MockRuntime(options.mock || {});
    this.runtimeCapabilitiesCache = new Map();
  }

  async get_docs() {
    return { docs: getDocs() };
  }

  async get_workflow_bundle() {
    return getWorkflowBundle();
  }

  async prepare_image_modeling_brief(options = {}) {
    return prepareImageModelingBrief(options);
  }

  async compile_reviewed_part_graph(options = {}) {
    return compileReviewedPartGraph(options);
  }

  async get_capabilities({ runtime = 'mock', timeoutMs } = {}) {
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    return { runtime: await this.resolveRuntimeCapabilities(selectedRuntime, runtime, { force: true }) };
  }

  async queue_diagnostics({ includeFiles = false, timeoutMs } = {}) {
    const selectedRuntime = this.selectRuntime('queue', { timeoutMs });
    if (typeof selectedRuntime.diagnostics !== 'function') {
      throw new Error('Selected queue runtime does not support diagnostics');
    }
    return selectedRuntime.diagnostics({ includeFiles });
  }

  async build_model({ code, runtime = 'mock', timeoutMs } = {}) {
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    const runtimeCapabilities = await this.resolveRuntimeCapabilities(selectedRuntime, runtime);
    const prepared = this.prepareDslCode(code);
    const snapshot = await selectedRuntime.buildModel(prepared.code);
    return {
      snapshot: this.attachRuntimeCapabilities(snapshot, runtimeCapabilities),
      ...(prepared.expansion.changed ? { expansion: prepared.expansion } : {})
    };
  }

  async compile_expert({ code, seed, maxOperations, maxLoopIterations, maxStatements, maxOutputBytes, expertTimeoutMs } = {}) {
    return compileExpertScript(code, { seed, maxOperations, maxLoopIterations, maxStatements, maxOutputBytes, timeoutMs: expertTimeoutMs });
  }

  async compile_python_sdk({ code, maxOperations, maxLoopIterations, maxStatements, maxOutputBytes, pythonTimeoutMs, pythonCommand } = {}) {
    return compilePythonSdkScript(code, { maxOperations, maxLoopIterations, maxStatements, maxOutputBytes, timeoutMs: pythonTimeoutMs, pythonCommand });
  }

  async build_expert_model({ code, runtime = 'mock', timeoutMs, seed, maxOperations, maxLoopIterations, maxStatements, maxOutputBytes, expertTimeoutMs } = {}) {
    const compiled = await this.compile_expert({ code, seed, maxOperations, maxLoopIterations, maxStatements, maxOutputBytes, expertTimeoutMs });
    const result = await this.build_model({ code: compiled.code, runtime, timeoutMs });
    return {
      compiled: {
        document: compiled.document,
        expert: compiled.expert
      },
      snapshot: result.snapshot
    };
  }

  async reset_model({ runtime = 'mock', timeoutMs } = {}) {
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    const runtimeCapabilities = await this.resolveRuntimeCapabilities(selectedRuntime, runtime);
    const snapshot = await selectedRuntime.resetModel();
    return { snapshot: this.attachRuntimeCapabilities(snapshot, runtimeCapabilities) };
  }

  async save_model({ path, keep_session = true, runtime = 'mock', timeoutMs } = {}) {
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    const runtimeCapabilities = await this.resolveRuntimeCapabilities(selectedRuntime, runtime);
    const result = await selectedRuntime.saveModel({ outputPath: path, keepSession: keep_session });
    if (result.snapshot) {
      result.snapshot = this.attachRuntimeCapabilities(result.snapshot, runtimeCapabilities);
    }
    if (result.snapshot && result.file_size_bytes) {
      result.snapshot.artifact_size_bytes = result.file_size_bytes;
    }
    return result;
  }

  async save_model_version({ path, base_path, label, keep_session = true, runtime = 'mock', timeoutMs } = {}) {
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    const runtimeCapabilities = await this.resolveRuntimeCapabilities(selectedRuntime, runtime);
    if (typeof selectedRuntime.saveModelVersion !== 'function') {
      throw new Error(`Runtime ${runtime} does not support save_model_version`);
    }
    const result = await selectedRuntime.saveModelVersion({ outputPath: path, basePath: base_path, label, keepSession: keep_session });
    if (result.snapshot) result.snapshot = this.attachRuntimeCapabilities(result.snapshot, runtimeCapabilities);
    if (result.snapshot && result.file_size_bytes) result.snapshot.artifact_size_bytes = result.file_size_bytes;
    return result;
  }

  async open_model({ path, runtime = 'queue', timeoutMs } = {}) {
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    const runtimeCapabilities = await this.resolveRuntimeCapabilities(selectedRuntime, runtime);
    if (typeof selectedRuntime.openModel !== 'function') throw new Error(`Runtime ${runtime} does not support open_model`);
    const result = await selectedRuntime.openModel({ path });
    if (result.snapshot) result.snapshot = this.attachRuntimeCapabilities(result.snapshot, runtimeCapabilities);
    return result;
  }

  async import_model({ path, mode, prefix, options, runtime = 'queue', timeoutMs } = {}) {
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    const runtimeCapabilities = await this.resolveRuntimeCapabilities(selectedRuntime, runtime);
    if (typeof selectedRuntime.importModel !== 'function') throw new Error(`Runtime ${runtime} does not support import_model`);
    const result = await selectedRuntime.importModel({ path, mode, prefix, options });
    if (result.snapshot) result.snapshot = this.attachRuntimeCapabilities(result.snapshot, runtimeCapabilities);
    return result;
  }

  async export_model({ path, format, options, runtime = 'queue', timeoutMs } = {}) {
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    const runtimeCapabilities = await this.resolveRuntimeCapabilities(selectedRuntime, runtime);
    if (typeof selectedRuntime.exportModel !== 'function') throw new Error(`Runtime ${runtime} does not support export_model`);
    const result = await selectedRuntime.exportModel({ path, format, options });
    if (result.snapshot) {
      result.snapshot = this.attachRuntimeCapabilities(result.snapshot, runtimeCapabilities);
      if (result.file_size_bytes) result.snapshot.artifact_size_bytes = result.file_size_bytes;
    }
    return result;
  }

  async inspect_model({ runtime = 'mock', timeoutMs, includeEntities = true, includeSnapshot = false, includeHidden = true, kind, material, tag, name } = {}) {
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    if (typeof selectedRuntime.inspectModel !== 'function') throw new Error(`Runtime ${runtime} does not support inspect_model`);
    const result = await selectedRuntime.inspectModel({ includeEntities, includeSnapshot, includeHidden, kind, material, tag, name });
    if (result.snapshot) {
      const runtimeCapabilities = await this.resolveRuntimeCapabilities(selectedRuntime, runtime);
      result.snapshot = this.attachRuntimeCapabilities(result.snapshot, runtimeCapabilities);
    }
    return result;
  }

  async list_entities({ runtime = 'mock', timeoutMs, includeHidden = true, kind, material, tag, name } = {}) {
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    if (typeof selectedRuntime.listEntities !== 'function') throw new Error(`Runtime ${runtime} does not support list_entities`);
    return selectedRuntime.listEntities({ includeHidden, kind, material, tag, name });
  }

  async get_model_info({ runtime = 'mock', timeoutMs } = {}) {
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    if (typeof selectedRuntime.getModelInfo !== 'function') throw new Error(`Runtime ${runtime} does not support get_model_info`);
    return selectedRuntime.getModelInfo();
  }

  async adopt_open_model({ runtime = 'mock', timeoutMs, recursive = false, recursive_limit, recursiveLimit, force = false, prefix } = {}) {
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    if (typeof selectedRuntime.adoptOpenModel !== 'function') throw new Error(`Runtime ${runtime} does not support adopt_open_model`);
    return selectedRuntime.adoptOpenModel({
      recursive,
      recursive_limit: recursive_limit ?? recursiveLimit,
      force,
      prefix
    });
  }

  async resolve_model_targets({
    query,
    runtime = 'mock',
    timeoutMs,
    includeHidden = true,
    kind,
    material,
    tag,
    name,
    definition,
    side,
    nth,
    index,
    target,
    targets,
    largest,
    smallest,
    selection,
    allowMultiple = false,
    limit = 10
  } = {}) {
    const inspected = await this.inspect_model({
      runtime,
      timeoutMs,
      includeEntities: true,
      includeSnapshot: false,
      includeHidden,
      kind,
      material,
      tag,
      name
    });
    const resolution = resolveTargets({
      query,
      entities: inspected.entities || [],
      selection: inspected.selection || [],
      limit,
      allowMultiple,
      filters: {
        includeHidden,
        kind,
        material,
        tag,
        name,
        definition,
        side,
        nth,
        index,
        target,
        targets,
        largest,
        smallest,
        selection
      }
    });
    return {
      ...resolution,
      runtime,
      model_info: inspected.model_info
    };
  }

  async get_selection({ runtime = 'mock', timeoutMs } = {}) {
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    if (typeof selectedRuntime.getSelection !== 'function') throw new Error(`Runtime ${runtime} does not support get_selection`);
    return selectedRuntime.getSelection();
  }

  async analyze_selection_geometry({ runtime = 'mock', timeoutMs, assume, includeDetails = true } = {}) {
    const inspected = await this.inspect_model({
      runtime,
      timeoutMs,
      includeEntities: true,
      includeSnapshot: true,
      includeHidden: true
    });
    return analyzeSelectionGeometry({
      selection: inspected.selection || [],
      snapshot: inspected.snapshot,
      model_info: inspected.model_info,
      runtime,
      assume,
      includeDetails
    });
  }

  async plan_modification_intent({
    runtime = 'mock',
    timeoutMs,
    runtimeLockHeld = false,
    ...options
  } = {}) {
    if (!runtimeLockHeld && runtime === 'queue') {
      return this.withRuntimeLock('queue', { timeoutMs }, (lockedBridge) => lockedBridge.plan_modification_intent({
        ...options,
        runtime,
        timeoutMs,
        runtimeLockHeld: true
      }));
    }
    return planModificationIntent({ ...options, runtime, timeoutMs, bridge: this });
  }

  async set_selection({ targets = [], mode = 'replace', runtime = 'mock', timeoutMs } = {}) {
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    const runtimeCapabilities = await this.resolveRuntimeCapabilities(selectedRuntime, runtime);
    if (typeof selectedRuntime.setSelection !== 'function') throw new Error(`Runtime ${runtime} does not support set_selection`);
    const result = await selectedRuntime.setSelection({ targets, mode });
    if (result.snapshot) result.snapshot = this.attachRuntimeCapabilities(result.snapshot, runtimeCapabilities);
    return result;
  }

  async evaluate_py({
    code,
    input_format,
    inputFormat,
    runtime = 'mock',
    timeoutMs,
    seed,
    maxOperations,
    maxLoopIterations,
    maxStatements,
    maxOutputBytes,
    expertTimeoutMs,
    pythonTimeoutMs,
    pythonCommand,
    audit_path,
    auditPath
  } = {}) {
    if (typeof code !== 'string' || code.trim().length === 0) {
      throw new Error('evaluate_py requires non-empty code');
    }
    const format = String(input_format ?? inputFormat ?? 'auto').toLowerCase();
    const audit = {
      kind: 'evaluate_py',
      runtime,
      input_format: format,
      started_at: new Date().toISOString(),
      code_sha256: await sha256Hex(code)
    };

    if (format === 'auto' || format === 'json_dsl') {
      const parsed = parseJsonDslIfPossible(code);
      if (parsed) {
        const built = await this.build_model({ code: JSON.stringify(parsed), runtime, timeoutMs });
        return {
          ...audit,
          compatibility_mode: 'safe_json_dsl',
          executed: true,
          blocked: false,
          finished_at: new Date().toISOString(),
          snapshot: built.snapshot
        };
      }
      if (format === 'json_dsl') throw new Error('evaluate_py input_format=json_dsl requires a JSON DSL document');
    }

    if (format === 'auto' || format === 'python_sdk') {
      try {
        const compiled = await this.compile_python_sdk({ code, maxOperations, maxLoopIterations, maxStatements, maxOutputBytes, pythonTimeoutMs, pythonCommand });
        const built = await this.build_model({ code: compiled.code, runtime, timeoutMs });
        return {
          ...audit,
          compatibility_mode: 'python_sdk_facade_compiler',
          executed: true,
          blocked: false,
          finished_at: new Date().toISOString(),
          compiled: {
            document: compiled.document,
            python_sdk: compiled.python_sdk,
            ...(Object.hasOwn(compiled, 'result') ? { result: compiled.result } : {})
          },
          snapshot: built.snapshot
        };
      } catch (error) {
        if (format === 'python_sdk') throw error;
      }
    }

    if (format === 'expert' || format === 'restricted_expert') {
      const built = await this.build_expert_model({ code, runtime, timeoutMs, seed, maxOperations, maxLoopIterations, maxStatements, maxOutputBytes, expertTimeoutMs });
      return {
        ...audit,
        compatibility_mode: 'restricted_expert_compiler',
        executed: true,
        blocked: false,
        finished_at: new Date().toISOString(),
        compiled: built.compiled,
        snapshot: built.snapshot
      };
    }

    if (format === 'ruby_expert') {
      if (runtime !== 'queue') throw new Error('evaluate_py input_format=ruby_expert requires queue runtime');
      const result = await this.run_ruby_expert({ code, audit_path: audit_path ?? auditPath, runtime, timeoutMs });
      return {
        ...audit,
        compatibility_mode: 'ruby_expert_debug',
        executed: result.enabled === true && result.blocked !== true,
        blocked: result.blocked === true,
        finished_at: new Date().toISOString(),
        ruby_expert: result
      };
    }

    return {
      ...audit,
      compatibility_mode: 'blocked_python_runtime',
      executed: false,
      blocked: true,
      finished_at: new Date().toISOString(),
      reason: 'This controlled evaluate_py compatibility layer accepts JSON DSL, restricted python_sdk facade code, restricted_expert, or gated ruby_expert input only; arbitrary Python execution is not enabled.'
    };
  }

  async build_report({
    code,
    snapshot,
    runtime = 'mock',
    timeoutMs,
    output_dir,
    save_model = true,
    save_path,
    capture_view = false,
    capture,
    validate_model = true,
    validate_reference_model = false,
    model_spec,
    reference_spec,
    includePreview = true,
    strictCollisions,
    strictUnanchored,
    floatingDetails
  } = {}) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportDir = path.resolve(output_dir || path.join('output', 'build-reports', `build-report-${stamp}`));
    await fs.mkdir(reportDir, { recursive: true });

    let activeSnapshot = snapshot;
    const artifacts = {};
    let dslExpansion = null;
    if (code) {
      await fs.writeFile(path.join(reportDir, 'input.dsl.json'), `${code.trim()}\n`, 'utf8');
      artifacts.input_dsl = path.join(reportDir, 'input.dsl.json');
      const prepared = this.prepareDslCode(code);
      dslExpansion = prepared.expansion;
      if (prepared.expansion.changed) {
        await fs.writeFile(path.join(reportDir, 'expanded.dsl.json'), prepared.code, 'utf8');
        artifacts.expanded_dsl = path.join(reportDir, 'expanded.dsl.json');
        await writeJsonArtifact(artifacts, 'dsl_expansion', path.join(reportDir, 'dsl-expansion.json'), prepared.expansion);
      }
      activeSnapshot = (await this.build_model({ code, runtime, timeoutMs })).snapshot;
    }
    if (!activeSnapshot) {
      activeSnapshot = (await this.inspect_model({ runtime, timeoutMs, includeSnapshot: true, includeEntities: false })).snapshot;
    }
    await writeJsonArtifact(artifacts, 'snapshot', path.join(reportDir, 'snapshot.json'), activeSnapshot);
    await writeJsonArtifact(artifacts, 'model_info', path.join(reportDir, 'model-info.json'), modelInfoFromSnapshot(activeSnapshot, { runtime }));

    let savedModel = null;
    if (save_model !== false) {
      savedModel = await this.save_model_version({
        path: save_path || path.join(reportDir, runtime === 'queue' ? 'model.skp' : 'model.json'),
        label: stamp,
        runtime,
        timeoutMs
      });
      artifacts.model = savedModel.file_path;
    }

    let modelQa = null;
    if (validate_model !== false) {
      modelQa = await this.validate_model({
        snapshot: activeSnapshot,
        runtime,
        timeoutMs,
        spec: model_spec,
        includePreview,
        strictCollisions,
        strictUnanchored,
        floatingDetails
      });
      await writeJsonArtifact(artifacts, 'model_qa', path.join(reportDir, 'model-qa.json'), modelQa);
    }

    let referenceQa = null;
    if (validate_reference_model || reference_spec) {
      referenceQa = await this.validate_reference_model({
        snapshot: activeSnapshot,
        runtime,
        timeoutMs,
        spec: reference_spec,
        includePreview
      });
      await writeJsonArtifact(artifacts, 'reference_qa', path.join(reportDir, 'reference-qa.json'), referenceQa);
    }

    const limitationsReport = buildLimitationsReport({
      snapshot: activeSnapshot,
      modelQa,
      expansion: dslExpansion,
      runtime
    });
    await writeJsonArtifact(artifacts, 'limitations_report', path.join(reportDir, 'limitations-report.json'), limitationsReport);
    await writeTextArtifact(artifacts, 'limitations_markdown', path.join(reportDir, 'limitations.md'), formatLimitationsReportMarkdown(limitationsReport));

    let captureResult = null;
    if ((capture_view || capture) && runtime === 'queue') {
      captureResult = await this.capture_view({
        ...(capture && typeof capture === 'object' ? capture : {}),
        path: path.join(reportDir, 'capture.png'),
        runtime,
        timeoutMs
      });
      artifacts.capture = captureResult.file_path;
      await writeJsonArtifact(artifacts, 'capture_metadata', path.join(reportDir, 'capture.json'), captureResult);
    }

    const manifest = {
      kind: 'build_report',
      runtime,
      output_dir: reportDir,
      created_at: new Date().toISOString(),
      artifacts,
      saved_model: savedModel,
      capture: captureResult,
      summary: {
        totals: activeSnapshot.totals,
        bounding_box: activeSnapshot.bounding_box,
        warning_summary: activeSnapshot.warning_summary,
        dsl_expansion: dslExpansion ? {
          changed: dslExpansion.changed,
          macro_count: dslExpansion.macro_count,
          source_operations: dslExpansion.source_operations,
          expanded_operations: dslExpansion.expanded_operations
        } : null,
        model_qa: modelQa ? { ok: modelQa.ok, verdict: modelQa.verdict, level: modelQa.level, issue_count: modelQa.issues?.length || 0, accepted_warning_count: modelQa.accepted_warnings?.length || 0 } : null,
        reference_qa: referenceQa ? { ok: referenceQa.ok, verdict: referenceQa.verdict, level: referenceQa.level, issue_count: referenceQa.issues?.length || 0 } : null,
        limitations: limitationsReport.summary
      }
    };
    await writeJsonArtifact(artifacts, 'manifest', path.join(reportDir, 'manifest.json'), manifest);
    return manifest;
  }

  async iterate_model({
    runtime = 'mock',
    timeoutMs,
    runtimeLockHeld = false,
    ...options
  } = {}) {
    if (!runtimeLockHeld && runtime === 'queue') {
      return this.withRuntimeLock('queue', { timeoutMs }, (lockedBridge) => lockedBridge.iterate_model({
        ...options,
        runtime,
        timeoutMs,
        runtimeLockHeld: true
      }));
    }
    return runModelIteration(this, { ...options, runtime, timeoutMs });
  }

  async capture_view({
    path,
    view,
    scene,
    width,
    height,
    antialias,
    compression,
    zoom_extents,
    zoomExtents,
    runtime = 'queue',
    timeoutMs
  } = {}) {
    if (runtime !== 'queue') {
      throw new Error('capture_view is currently supported only for queue runtime');
    }
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    if (typeof selectedRuntime.captureView !== 'function') {
      throw new Error('Selected queue runtime does not support capture_view');
    }
    return selectedRuntime.captureView({
      path,
      view,
      scene,
      width,
      height,
      antialias,
      compression,
      zoom_extents: zoom_extents ?? zoomExtents
    });
  }

  async run_ruby_expert({ code, audit_path, auditPath, runtime = 'queue', timeoutMs } = {}) {
    if (process.env.ALMA_SKETCHUP_ENABLE_RUBY_EXPERT !== '1') {
      return {
        kind: 'run_ruby_expert',
        runtime,
        enabled: false,
        blocked: true,
        reason: 'Set ALMA_SKETCHUP_ENABLE_RUBY_EXPERT=1 in both Node and SketchUp plugin environments to enable this destructive debug-only tool.'
      };
    }
    if (runtime !== 'queue') {
      throw new Error('run_ruby_expert is supported only for queue runtime');
    }
    if (typeof code !== 'string' || code.trim().length === 0) {
      throw new Error('run_ruby_expert requires non-empty Ruby code');
    }
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    if (typeof selectedRuntime.runRubyExpert !== 'function') {
      throw new Error('Selected queue runtime does not support run_ruby_expert');
    }
    return selectedRuntime.runRubyExpert({ code, audit_path: audit_path ?? auditPath });
  }

  async compare_model({
    code,
    expected_runtime = 'mock',
    actual_runtime = 'queue',
    timeoutMs,
    reset_first = true,
    toleranceMm,
    topologyTolerance,
    budgets,
    topIssueLimit,
    include_snapshots = false,
    runtimeLockHeld = false
  } = {}) {
    if (!runtimeLockHeld && [expected_runtime, actual_runtime].includes('queue')) {
      return this.withRuntimeLock('queue', { timeoutMs }, (lockedBridge) => lockedBridge.compare_model({
        code,
        expected_runtime,
        actual_runtime,
        timeoutMs,
        reset_first,
        toleranceMm,
        topologyTolerance,
        budgets,
        topIssueLimit,
        include_snapshots,
        runtimeLockHeld: true
      }));
    }
    if (reset_first) {
      await this.reset_model({ runtime: expected_runtime, timeoutMs });
    }
    const expected = await this.build_model({ code, runtime: expected_runtime, timeoutMs });
    if (reset_first) {
      await this.reset_model({ runtime: actual_runtime, timeoutMs });
    }
    const actual = await this.build_model({ code, runtime: actual_runtime, timeoutMs });
    const report = compareSnapshots(expected.snapshot, actual.snapshot, { toleranceMm, topologyTolerance, budgets, topIssueLimit });
    return {
      expected_runtime,
      actual_runtime,
      reset_first,
      report,
      ...(include_snapshots ? { expected: expected.snapshot, actual: actual.snapshot } : {})
    };
  }

  async validate_model({
    code,
    snapshot,
    runtime = 'mock',
    timeoutMs,
    spec,
    includePreview = true,
    strictCollisions,
    strictUnanchored,
    floatingDetails
  } = {}) {
    const builtSnapshot = snapshot || (await this.build_model({ code, runtime, timeoutMs })).snapshot;
    return validateModelSnapshot(builtSnapshot, {
      spec,
      includePreview,
      strictCollisions,
      strictUnanchored,
      floatingDetails
    });
  }

  async validate_reference_model({
    code,
    snapshot,
    runtime = 'mock',
    timeoutMs,
    spec,
    includePreview = true
  } = {}) {
    const builtSnapshot = snapshot || (await this.build_model({ code, runtime, timeoutMs })).snapshot;
    return validateReferenceVisualSnapshot(builtSnapshot, {
      spec,
      includePreview
    });
  }

  async resolveRuntimeCapabilities(selectedRuntime, runtime, { force = false } = {}) {
    if (!force && this.runtimeCapabilitiesCache.has(runtime)) {
      return this.runtimeCapabilitiesCache.get(runtime);
    }
    const descriptor = typeof selectedRuntime.getCapabilities === 'function'
      ? await selectedRuntime.getCapabilities()
      : getRuntimeCapabilities(runtime);
    const runtimeCapabilities = attachCompatibilityReport(descriptor, runtime);
    this.runtimeCapabilitiesCache.set(runtime, runtimeCapabilities);
    return runtimeCapabilities;
  }

  attachRuntimeCapabilities(snapshot, runtimeCapabilities) {
    return {
      ...snapshot,
      runtime: runtimeCapabilities
    };
  }

  prepareDslCode(code) {
    return expandDslCode(code);
  }

  selectRuntime(runtime, { timeoutMs } = {}) {
    if (runtime === 'mock') return this.mockRuntime;
    if (runtime === 'queue') return this.options.queueRuntime || new QueueRuntime({ ...(this.options.queue || {}), timeoutMs });
    throw new Error(`Unknown runtime: ${runtime}`);
  }

  async withRuntimeLock(runtime, { timeoutMs } = {}, callback) {
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    if (typeof selectedRuntime.withExclusiveAccess !== 'function') {
      return callback(this);
    }
    return selectedRuntime.withExclusiveAccess(async () => {
      const lockedBridge = new SketchUpBridge({
        ...this.options,
        ...(runtime === 'queue' ? { queueRuntime: selectedRuntime } : {})
      });
      if (runtime === 'mock') lockedBridge.mockRuntime = selectedRuntime;
      return callback(lockedBridge);
    }, { method: `${runtime}-runtime-session` });
  }
}

async function sha256Hex(value) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(value).digest('hex');
}

function parseJsonDslIfPossible(code) {
  try {
    const parsed = JSON.parse(code);
    if (parsed?.version === 1 && Array.isArray(parsed.operations)) return parsed;
    return null;
  } catch (_) {
    return null;
  }
}

async function writeJsonArtifact(artifacts, key, filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  artifacts[key] = filePath;
}

async function writeTextArtifact(artifacts, key, filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, 'utf8');
  artifacts[key] = filePath;
}

function attachCompatibilityReport(descriptor, runtime) {
  const expected = getRuntimeCapabilities(runtime);
  const actual = descriptor || {};
  const issues = [];

  addScalarIssue(issues, 'runtime.name', expected.name, actual.name, 'error');
  addScalarIssue(issues, 'runtime.dsl_version', expected.dsl_version, actual.dsl_version, 'error');
  addScalarIssue(issues, 'runtime.manifest_version', expected.manifest_version, actual.manifest_version, 'warn');
  addScalarIssue(issues, 'runtime.capability_version', expected.capability_version, actual.capability_version, 'warn');

  const expectedOperations = new Set(expected.supported_operations || []);
  const actualOperations = new Set(actual.supported_operations || []);
  for (const operation of expectedOperations) {
    if (!actualOperations.has(operation)) {
      issues.push({
        type: 'runtime.operation_missing',
        severity: 'error',
        message: `Runtime ${runtime} is missing manifest operation: ${operation}`,
        operation
      });
    }
  }
  for (const operation of actualOperations) {
    if (!expectedOperations.has(operation)) {
      issues.push({
        type: 'runtime.operation_extra',
        severity: 'info',
        message: `Runtime ${runtime} reports extra operation outside current manifest: ${operation}`,
        operation
      });
    }
  }

  for (const [operation, expectedSupport] of Object.entries(expected.operation_support || {})) {
    const actualSupport = actual.operation_support?.[operation];
    if (!actualSupport) continue;
    if (actualSupport.status !== expectedSupport.status) {
      issues.push({
        type: 'runtime.operation_status_mismatch',
        severity: 'warn',
        message: `Runtime ${runtime} operation ${operation} reports ${actualSupport.status}, manifest expects ${expectedSupport.status}`,
        operation,
        expected: expectedSupport.status,
        actual: actualSupport.status
      });
    }
    if (actualSupport.stability !== undefined && actualSupport.stability !== expectedSupport.stability) {
      issues.push({
        type: 'runtime.operation_stability_mismatch',
        severity: 'warn',
        message: `Runtime ${runtime} operation ${operation} reports ${actualSupport.stability} stability, manifest expects ${expectedSupport.stability}`,
        operation,
        expected: expectedSupport.stability,
        actual: actualSupport.stability
      });
    }
    if (actualSupport.schema !== undefined && !sameJson(actualSupport.schema, expectedSupport.schema)) {
      issues.push({
        type: 'runtime.operation_schema_mismatch',
        severity: 'warn',
        message: `Runtime ${runtime} operation ${operation} schema differs from manifest`,
        operation,
        expected: expectedSupport.schema,
        actual: actualSupport.schema
      });
    }
    if (actualSupport.component_scope !== undefined && !sameJson(actualSupport.component_scope, expectedSupport.component_scope)) {
      issues.push({
        type: 'runtime.operation_component_scope_mismatch',
        severity: 'warn',
        message: `Runtime ${runtime} operation ${operation} component scope differs from manifest`,
        operation,
        expected: expectedSupport.component_scope,
        actual: actualSupport.component_scope
      });
    }
  }

  return {
    ...actual,
    operation_support: normalizeOperationSupport(actual.operation_support, expected.operation_support),
    compatibility: {
      ok: !issues.some((issue) => issue.severity === 'error'),
      level: compatibilityLevel(issues),
      checked_against: {
        manifest_version: expected.manifest_version,
        capability_version: expected.capability_version,
        dsl_version: expected.dsl_version
      },
      issues
    }
  };
}

function normalizeOperationSupport(actualSupport = {}, expectedSupport = {}) {
  const normalized = {};
  for (const [operation, expected] of Object.entries(expectedSupport || {})) {
    const actual = actualSupport?.[operation] || {};
    normalized[operation] = {
      ...expected,
      ...actual,
      schema: actual.schema ?? expected.schema,
      component_scope: actual.component_scope ?? expected.component_scope
    };
  }
  for (const [operation, actual] of Object.entries(actualSupport || {})) {
    if (!normalized[operation]) normalized[operation] = actual;
  }
  return normalized;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addScalarIssue(issues, field, expected, actual, severity) {
  if (expected === actual) return;
  issues.push({
    type: 'runtime.descriptor_mismatch',
    severity,
    field,
    message: `${field} mismatch: expected ${expected}, got ${actual}`,
    expected,
    actual
  });
}

function compatibilityLevel(issues) {
  if (issues.some((issue) => issue.severity === 'error')) return 'error';
  if (issues.some((issue) => issue.severity === 'warn')) return 'warn';
  if (issues.some((issue) => issue.severity === 'info')) return 'info';
  return 'ok';
}

export async function callTool(name, args = {}, bridge = new SketchUpBridge()) {
  if (typeof bridge[name] !== 'function') {
    throw new Error(`Unknown tool: ${name}`);
  }
  return bridge[name](args);
}
