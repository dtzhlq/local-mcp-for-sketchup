import { getRuntimeCapabilities } from './capabilities.mjs';
import { getDocs } from './docs.mjs';
import { MockRuntime } from './mock-runtime.mjs';
import { QueueRuntime } from './queue-runtime.mjs';
import { compareSnapshots } from './snapshot-diff.mjs';

export class SketchUpBridge {
  constructor(options = {}) {
    this.options = options;
    this.mockRuntime = new MockRuntime(options.mock || {});
  }

  async get_docs() {
    return { docs: getDocs() };
  }

  async get_capabilities({ runtime = 'mock', timeoutMs } = {}) {
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    return { runtime: await this.resolveRuntimeCapabilities(selectedRuntime, runtime) };
  }

  async build_model({ code, runtime = 'mock', timeoutMs } = {}) {
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    const runtimeCapabilities = await this.resolveRuntimeCapabilities(selectedRuntime, runtime);
    const snapshot = await selectedRuntime.buildModel(code);
    return { snapshot: this.attachRuntimeCapabilities(snapshot, runtimeCapabilities) };
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
    include_snapshots = false
  } = {}) {
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

  async resolveRuntimeCapabilities(selectedRuntime, runtime) {
    const descriptor = typeof selectedRuntime.getCapabilities === 'function'
      ? await selectedRuntime.getCapabilities()
      : getRuntimeCapabilities(runtime);
    return attachCompatibilityReport(descriptor, runtime);
  }

  attachRuntimeCapabilities(snapshot, runtimeCapabilities) {
    return {
      ...snapshot,
      runtime: runtimeCapabilities
    };
  }

  selectRuntime(runtime, { timeoutMs } = {}) {
    if (runtime === 'mock') return this.mockRuntime;
    if (runtime === 'queue') return this.options.queueRuntime || new QueueRuntime({ ...(this.options.queue || {}), timeoutMs });
    throw new Error(`Unknown runtime: ${runtime}`);
  }
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
  }

  return {
    ...actual,
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
