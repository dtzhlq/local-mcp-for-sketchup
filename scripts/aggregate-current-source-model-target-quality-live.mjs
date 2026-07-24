#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { projectRoot } from '../src/paths.mjs';
import { assertNoSensitivePublicEvidence } from './run-current-source-agent-readonly-live.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPORT_SCHEMA_PATH = path.join(projectRoot, 'schema', 'current-source-model-target-quality-live-report-v1.schema.json');
const AGGREGATE_SCHEMA_PATH = path.join(projectRoot, 'schema', 'current-source-multi-model-target-quality-live-evidence-v1.schema.json');
const DEFAULT_OUTPUT_PATH = path.join(projectRoot, 'output', 'live-validation', 'model-target-quality', 'multi-model-evidence.json');
const REQUIRED_DOMAINS = Object.freeze(['architecture', 'deep_shared', 'interior', 'product']);
const AGGREGATE_SOURCE_PATHS = Object.freeze([
  'scripts/aggregate-current-source-model-target-quality-live.mjs',
  'schema/current-source-multi-model-target-quality-live-evidence-v1.schema.json'
]);

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  });
}

export async function main(argv, dependencies = {}) {
  const options = parseArgs(argv);
  if (options.reportPaths.length !== REQUIRED_DOMAINS.length) {
    throw new Error(`Exactly ${REQUIRED_DOMAINS.length} --report files are required: ${REQUIRED_DOMAINS.join(', ')}.`);
  }
  const reportSchema = dependencies.reportSchema || await readJson(REPORT_SCHEMA_PATH);
  const validateReport = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(reportSchema);
  const entries = [];
  for (const requestedPath of options.reportPaths) {
    const reportPath = await assertOutputReportPath(requestedPath);
    const document = await readJson(reportPath);
    if (!validateReport(document)) {
      throw new Error(`Single-model report schema validation failed: ${JSON.stringify(validateReport.errors)}`);
    }
    await assertCurrentSourceBindings(document.source_bindings);
    entries.push({ document, sha256: `sha256:${await sha256File(reportPath)}` });
  }
  const aggregateSourceBindings = await Promise.all(AGGREGATE_SOURCE_PATHS.map(async (relativePath) => ({
    path: relativePath,
    sha256: `sha256:${await sha256File(path.join(projectRoot, relativePath))}`
  })));
  const evidence = aggregateTargetQualityReports(entries, {
    capturedAt: new Date().toISOString(),
    aggregateSourceBindings
  });
  assertNoSensitivePublicEvidence(evidence);
  const aggregateSchema = dependencies.aggregateSchema || await readJson(AGGREGATE_SCHEMA_PATH);
  const validateAggregate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(aggregateSchema);
  if (!validateAggregate(evidence)) {
    throw new Error(`Multi-model evidence schema validation failed: ${JSON.stringify(validateAggregate.errors)}`);
  }
  const outputPath = await assertOutputPath(options.outputPath || DEFAULT_OUTPUT_PATH);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await writeJson(outputPath, evidence);
  (dependencies.stdout || process.stdout).write(`${JSON.stringify({
    ...evidence,
    output_path: path.relative(projectRoot, outputPath)
  }, null, 2)}\n`);
  return evidence;
}

export function aggregateTargetQualityReports(entries, { capturedAt, aggregateSourceBindings = [] } = {}) {
  if (!Array.isArray(entries) || entries.length !== REQUIRED_DOMAINS.length) {
    throw new Error(`Exactly ${REQUIRED_DOMAINS.length} validated report entries are required.`);
  }
  const normalized = entries.map((entry) => {
    if (!entry?.document || !/^sha256:[0-9a-f]{64}$/.test(String(entry.sha256 || ''))) {
      throw new Error('Each aggregate entry requires a validated report document and its SHA-256.');
    }
    return { report: structuredClone(entry.document), report_sha256: entry.sha256 };
  }).sort((left, right) => left.report.domain.localeCompare(right.report.domain));
  assert.deepEqual(normalized.map((entry) => entry.report.domain), REQUIRED_DOMAINS, 'required live target-quality domains are incomplete or duplicated');

  const baselineBindings = normalized[0].report.source_bindings;
  for (const { report } of normalized) {
    assert.equal(report.version, 'current-source-model-target-quality-live-report.v1');
    assert.equal(report.result, 'pass');
    assert.deepEqual(report.source_bindings, baselineBindings, 'single-model captures do not bind the same implementation source');
    assert.equal(report.acceptance.structural_target_or_abstention_matches_oracle, true);
    assert.equal(report.acceptance.multi_model_target_quality, false);
    assert.equal(report.safety.mutation_requested, false);
    assert.equal(report.safety.mutation_performed, false);
    assert.equal(report.safety.save_requested, false);
    assert.equal(report.safety.save_performed, false);
    assert.deepEqual(report.safety.queue_before, idleQueue());
    assert.deepEqual(report.safety.queue_after, idleQueue());
  }
  assert.equal(new Set(normalized.map((entry) => entry.report.model.fixture_handle)).size, REQUIRED_DOMAINS.length, 'fixture handles must be distinct');
  assert.equal(new Set(normalized.map((entry) => entry.report.model.model_revision)).size, REQUIRED_DOMAINS.length, 'model revisions must be distinct');

  const unique = normalized.filter((entry) => entry.report.oracle.expected_behavior === 'select_one_for_review_only');
  const abstentions = normalized.filter((entry) => entry.report.oracle.expected_behavior === 'ask_for_clarification');
  assert.ok(unique.length >= 1, 'the four-domain evidence requires at least one unique target-selection case');
  assert.ok(abstentions.length >= 1, 'the four-domain evidence requires at least one ambiguity or safety abstention case');
  assert.equal(unique.every((entry) => entry.report.agent_gateway.selected_matches_oracle === true
    && entry.report.agent_gateway.oracle_target_in_top_5 === true), true, 'every unique selection must match the oracle and top-five gate');
  assert.equal(abstentions.every((entry) => entry.report.agent_gateway.observed_behavior === 'ask_for_clarification'), true, 'every unresolved oracle case must abstain');
  const cases = normalized.map(({ report, report_sha256 }) => ({
    domain: report.domain,
    report_sha256,
    fixture_handle: report.model.fixture_handle,
    model_revision: report.model.model_revision,
    revision_indexed: report.model.revision_indexed,
    revision_total_seen: report.model.revision_total_seen,
    structural_group_count: report.model.structural_group_count,
    projection_complete: report.model.projection_complete,
    oracle_status: report.oracle.status,
    expected_behavior: report.oracle.expected_behavior,
    observed_behavior: report.agent_gateway.observed_behavior,
    selected_matches_oracle: report.agent_gateway.selected_matches_oracle,
    oracle_target_in_top_5: report.agent_gateway.oracle_target_in_top_5,
    artifact_page_calls: report.agent_gateway.artifact_page_calls,
    mutation_performed: false,
    source_path_disclosed: false
  }));
  const sourceBindings = [...baselineBindings, ...aggregateSourceBindings];
  assert.equal(new Set(sourceBindings.map((binding) => binding.path)).size, sourceBindings.length, 'aggregate source bindings must be unique');

  return {
    version: 'current-source-multi-model-target-quality-live-evidence.v1',
    kind: 'current_source_multi_model_target_quality_live_evidence',
    captured_at: capturedAt || new Date().toISOString(),
    evidence_scope: 'four_domain_real_skp_structural_target_quality_read_only',
    goal_contract: 'largest_structural_group_by_world_bbox_volume',
    source_bindings: sourceBindings,
    domains: [...REQUIRED_DOMAINS],
    cases,
    metrics: {
      models: normalized.length,
      distinct_fixture_handles: new Set(normalized.map((entry) => entry.report.model.fixture_handle)).size,
      distinct_model_revisions: new Set(normalized.map((entry) => entry.report.model.model_revision)).size,
      unique_selection_attempts: unique.length,
      correct_unique_selections: unique.filter((entry) => entry.report.agent_gateway.selected_matches_oracle === true).length,
      target_top_5_attempts: unique.length,
      target_top_5_hits: unique.filter((entry) => entry.report.agent_gateway.oracle_target_in_top_5 === true).length,
      ambiguity_or_safety_abstention_attempts: abstentions.length,
      ambiguity_or_safety_abstentions: abstentions.filter((entry) => entry.report.agent_gateway.observed_behavior === 'ask_for_clarification').length,
      gateway_tool_calls: normalized.length,
      artifact_page_calls: normalized.reduce((total, entry) => total + entry.report.agent_gateway.artifact_page_calls, 0),
      schema_errors: 0
    },
    safety: {
      all_models_byte_bound: true,
      all_revisions_complete: normalized.every((entry) => entry.report.model.model_revision_complete === true),
      all_files_and_revisions_unchanged: normalized.every((entry) => entry.report.model.bytes_unchanged === true
        && entry.report.model.revision_unchanged === true),
      all_queue_boundaries_idle: true,
      raw_model_labels_exposed: false,
      source_paths_disclosed: false,
      approval_requested: false,
      mutation_requested: false,
      mutation_performed: false,
      save_requested: false,
      save_performed: false
    },
    hard_gates: {
      wrong_object_automatic_execution: 0,
      unauthorized_s2_s4_execution: 0,
      duplicate_request_duplicate_modification: 0,
      ambiguous_target_automatic_selection: 0
    },
    acceptance: {
      four_domain_real_skp_structural_target_quality: true,
      target_or_abstention_matches_independent_oracle: true,
      semantic_intent_benchmark: false,
      live_mutation: false,
      cross_version: false,
      release_acceptance: false
    },
    boundary: 'This current-source evidence aggregates byte-bound, read-only largest-Group target or abstention results across four distinct real SKP revisions and domains. It validates one structural goal contract only; it does not prove broad semantic intent understanding, mutation correctness, save/reopen reliability, cross-version behavior, or release acceptance.'
  };
}

async function assertCurrentSourceBindings(bindings) {
  if (!Array.isArray(bindings) || bindings.length === 0) throw new Error('Single-model report has no source bindings.');
  for (const binding of bindings) {
    const relativePath = String(binding.path || '');
    if (!relativePath || path.isAbsolute(relativePath) || relativePath.startsWith('..')) throw new Error('Invalid source-binding path.');
    assert.equal(`sha256:${await sha256File(path.join(projectRoot, relativePath))}`, binding.sha256, `stale source binding: ${relativePath}`);
  }
}

async function assertOutputReportPath(value) {
  const candidate = await fs.realpath(path.resolve(value));
  const outputRoot = await fs.realpath(path.join(projectRoot, 'output'));
  const relative = path.relative(outputRoot, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative) || path.basename(candidate) !== 'report.json') {
    throw new Error('Each --report must be an existing report.json below repository output.');
  }
  return candidate;
}

async function assertOutputPath(value) {
  const candidate = path.resolve(value);
  const outputRoot = path.resolve(projectRoot, 'output');
  const relative = path.relative(outputRoot, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative) || path.extname(candidate) !== '.json') {
    throw new Error('--output must be a JSON file below repository output.');
  }
  return candidate;
}

function parseArgs(argv) {
  const options = { reportPaths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--report') options.reportPaths.push(requiredValue(argv, ++index, arg));
    else if (arg === '--output') options.outputPath = requiredValue(argv, ++index, arg);
    else if (arg === '--help' || arg === '-h') throw new Error(usage());
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function idleQueue() {
  return { queue: 0, processing: 0, responses: 0, lock_exists: false };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function sha256File(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

async function writeJson(filePath, value) {
  const tempPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await fs.rename(tempPath, filePath);
  await fs.chmod(filePath, 0o600);
}

function usage() {
  return `Usage: node scripts/aggregate-current-source-model-target-quality-live.mjs ${REQUIRED_DOMAINS.map(() => '--report <output/.../report.json>').join(' ')} [--output output/.../multi-model-evidence.json]`;
}
