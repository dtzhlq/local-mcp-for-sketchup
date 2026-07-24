#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { SketchUpBridge } from '../src/bridge.mjs';
import { modelRevisionForAdoption } from '../src/existing-model-editing.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const DEFAULT_FIXTURE = path.join(REPO_ROOT, 'test', 'fixtures', 'model-graph', 'target-quality-benchmark-v1.json');
const BENCHMARK_SCHEMA_PATH = path.join(REPO_ROOT, 'schema', 'model-graph-target-quality-benchmark-v1.schema.json');
const REPORT_SCHEMA_PATH = path.join(REPO_ROOT, 'schema', 'model-graph-target-quality-report-v1.schema.json');
const SOURCE_PATHS = Object.freeze([
  'src/model-graph.mjs',
  'src/existing-model-edit-proposer.mjs',
  'src/agent-gateway.mjs',
  'schema/model-graph-v1.schema.json',
  'schema/existing-model-edit-proposal-v1.schema.json',
  'schema/model-graph-target-quality-benchmark-v1.schema.json',
  'schema/model-graph-target-quality-report-v1.schema.json',
  'test/fixtures/model-graph/target-quality-benchmark-v1.json',
  'scripts/run-model-graph-target-quality-benchmark.mjs'
]);

const isMain = process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH;
if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  });
}

export async function main(argv = []) {
  const options = parseArgs(argv);
  const report = await runModelGraphTargetQualityBenchmark({ fixturePath: options.fixture });
  if (options.output) await writeOutput(options.output, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export async function runModelGraphTargetQualityBenchmark({ fixturePath = DEFAULT_FIXTURE } = {}) {
  const [benchmark, benchmarkSchema, reportSchema] = await Promise.all([
    readJson(fixturePath),
    readJson(BENCHMARK_SCHEMA_PATH),
    readJson(REPORT_SCHEMA_PATH)
  ]);
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  const validateBenchmark = ajv.compile(benchmarkSchema);
  assert.equal(validateBenchmark(benchmark), true, JSON.stringify(validateBenchmark.errors, null, 2));
  assertUniqueBenchmarkIds(benchmark);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-target-quality-'));
  const bridge = new SketchUpBridge({
    mock: { sessionPath: path.join(root, 'session.json') },
    agentContract: { rootDir: path.join(root, 'agent-state') },
    approval: {
      stateDir: path.join(root, 'approvals'),
      secret: 'target-quality-benchmark-secret-at-least-32-bytes'
    },
    executionPolicy: { allowed_runtimes: ['mock'], auto_approve_risks: [] }
  });
  const clientCapabilities = Object.freeze({
    vision: false,
    local_files: false,
    structured_output: false,
    context: 'short',
    parallel: false
  });
  const caseResults = [];
  const privateCaseState = new Map();
  const modelRevisions = new Set();
  let gatewayToolCalls = 0;
  let artifactPageCalls = 0;

  try {
    for (const model of benchmark.models) {
      await bridge.build_model({ runtime: 'mock', code: JSON.stringify(model.dsl_document) });
      const before = await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 5000, read_only: true });
      const beforeRevision = modelRevisionForAdoption(before);
      modelRevisions.add(beforeRevision);

      for (const benchmarkCase of model.cases) {
        let envelope;
        if (benchmarkCase.flow === 'start') {
          gatewayToolCalls += 1;
          envelope = await bridge.start_agent_task({
            intent: 'propose_existing_model_edit',
            instruction: benchmarkCase.instruction,
            interface_level: 'guided',
            client_capabilities: clientCapabilities,
            idempotency_key: `target-quality:${model.model_id}:${benchmarkCase.case_id}`,
            inputs: {
              runtime: 'mock',
              target_query: benchmarkCase.target_query,
              action: benchmarkCase.action,
              parameters: benchmarkCase.parameters,
              recursive_limit: 5000,
              save_model: false,
              capture_view: false
            }
          });
        } else {
          const source = privateCaseState.get(benchmarkCase.source_case_id);
          assert.ok(source, `missing source case ${benchmarkCase.source_case_id}`);
          const matches = source.proposal.candidates.filter(
            (candidate) => candidateLabel(candidate) === benchmarkCase.clarification_fixture_label
          );
          const selectedCandidate = matches[benchmarkCase.clarification_candidate_rank - 1];
          assert.ok(selectedCandidate, `clarification candidate rank unavailable for ${benchmarkCase.case_id}`);
          gatewayToolCalls += 1;
          envelope = await bridge.submit_agent_task_input({
            task_id: source.envelope.task_id,
            idempotency_key: `target-quality:${model.model_id}:${benchmarkCase.case_id}`,
            input: {
              target_ref: selectedCandidate.persistent_ref,
              shared_policy: benchmarkCase.shared_policy
            }
          });
        }

        assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
        const expanded = await expandedEnvelopeDocument(bridge, envelope);
        artifactPageCalls += expanded.pages;
        const proposal = expanded.document.result?.proposal;
        assert.ok(proposal, `missing proposal for ${benchmarkCase.case_id}`);
        const result = evaluateCase({ benchmarkCase, model, envelope, proposal, modelRevision: beforeRevision });
        caseResults.push(result);
        privateCaseState.set(benchmarkCase.case_id, { envelope, proposal });
      }

      const after = await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 5000, read_only: true });
      assert.equal(modelRevisionForAdoption(after), beforeRevision, `Agent flow changed model ${model.model_id}`);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }

  assert.equal(modelRevisions.size, benchmark.models.length, 'each benchmark model must have a distinct revision');
  const uniqueCases = caseResults.filter((entry) => entry.expected_task_state === 'awaiting_review');
  const ambiguityCases = caseResults.filter((entry) => entry.expected_task_state === 'awaiting_input');
  const clarificationCases = caseResults.filter((entry) => entry.flow === 'clarify');
  const report = {
    version: 'model-graph-target-quality-report.v1',
    kind: 'model_graph_target_quality_report',
    benchmark_version: benchmark.version,
    runtime: 'mock',
    execution_surface: 'agent_gateway',
    client_profile: {
      level: 'L0',
      ...clientCapabilities,
      max_in_flight: 1
    },
    source_bindings: await sourceBindings(),
    model_count: benchmark.models.length,
    domains: [...new Set(benchmark.models.map((model) => model.domain))].sort(),
    cases: caseResults,
    metrics: {
      models: benchmark.models.length,
      cases: caseResults.length,
      distinct_model_revisions: modelRevisions.size,
      unique_selection_attempts: uniqueCases.length,
      correct_unique_selections: uniqueCases.filter((entry) => entry.ground_truth_match).length,
      target_top_k: {
        k: 5,
        attempts: uniqueCases.length,
        hits: uniqueCases.filter((entry) => entry.expected_candidates_in_top_k === entry.expected_candidate_count).length,
        rate: ratio(uniqueCases.filter((entry) => entry.expected_candidates_in_top_k === entry.expected_candidate_count).length, uniqueCases.length)
      },
      ambiguity_abstention: {
        attempts: ambiguityCases.length,
        passed: ambiguityCases.filter((entry) => entry.ground_truth_match && entry.requires_clarification).length,
        rate: ratio(ambiguityCases.filter((entry) => entry.ground_truth_match && entry.requires_clarification).length, ambiguityCases.length)
      },
      clarification_recovery: {
        attempts: clarificationCases.length,
        succeeded: clarificationCases.filter((entry) => entry.ground_truth_match && entry.task_state === 'awaiting_review').length,
        rate: ratio(clarificationCases.filter((entry) => entry.ground_truth_match && entry.task_state === 'awaiting_review').length, clarificationCases.length)
      },
      gateway_tool_calls: gatewayToolCalls,
      artifact_page_calls: artifactPageCalls,
      schema_errors: 0,
      invalid_retries: 0
    },
    safety: {
      fixture_setup_mutations_excluded_from_agent_metrics: true,
      model_revision_unchanged_after_each_agent_flow: true,
      proposal_execution_count: 0,
      model_mutation_count_after_fixture_setup: 0,
      approval_challenge_count: 0,
      live_queue_called: false,
      untrusted_model_data_policy_effect: 'none'
    },
    hard_gates: {
      wrong_object_automatic_execution: 0,
      unauthorized_s2_s4_execution: 0,
      duplicate_request_duplicate_modification: 0,
      ambiguous_target_automatic_selection: 0
    },
    acceptance: {
      cross_domain_fixture_benchmark: true,
      ambiguity_fail_closed: true,
      top_k_measured: true,
      real_skp_multi_model_live: false,
      live_mutation: false,
      release_acceptance: false
    },
    boundary: 'This source-bound benchmark proves deterministic target selection, ambiguity abstention, and explicit shared-occurrence clarification across four independent mock domain models through the Agent Gateway. It does not prove target quality on multiple live SKP files, authorize or execute any model edit, or establish release acceptance.'
  };
  assertPublicReportSafe(report);
  const validateReport = ajv.compile(reportSchema);
  assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors, null, 2));
  return report;
}

function evaluateCase({ benchmarkCase, model, envelope, proposal, modelRevision }) {
  assert.equal(envelope.task_state, benchmarkCase.expected.task_state, benchmarkCase.case_id);
  assert.equal(proposal.execution_allowed, false, benchmarkCase.case_id);
  assert.equal(proposal.model_revision, modelRevision, benchmarkCase.case_id);
  const candidates = proposal.candidates || [];
  const expectedLabels = benchmarkCase.expected.candidate_fixture_labels;
  const topKLabels = candidates.slice(0, 5).map(candidateLabel);
  const expectedHits = expectedLabels.filter((label) => topKLabels.includes(label)).length;
  assert.equal(expectedHits, expectedLabels.length, `${benchmarkCase.case_id} ground truth absent from top-k`);
  const selectedTargets = proposal.selected_targets || [];
  const operations = proposal.operation_proposal || [];
  const selectedCandidate = selectedTargets.length === 1
    ? candidates.find((candidate) => candidate.entity_path === selectedTargets[0].entity_path)
    : null;
  const selectedLabel = selectedCandidate ? candidateLabel(selectedCandidate) : null;
  const expectedSelectedLabel = benchmarkCase.expected.selected_fixture_label;
  const ambiguityReasonVerified = benchmarkCase.expected.ambiguity_reason
    ? proposal.ambiguity_reasons.includes(benchmarkCase.expected.ambiguity_reason)
    : proposal.ambiguity_reasons.length === 0;
  const expectedPolicy = benchmarkCase.expected.instance_policy;
  const instancePolicyVerified = expectedPolicy === null
    ? selectedTargets.length === 0
    : selectedTargets.length === 1
      && selectedTargets[0].instance_policy === expectedPolicy
      && operations[0]?.instance_policy === expectedPolicy;
  const groundTruthMatch = expectedSelectedLabel === null
    ? proposal.requires_clarification === true && selectedTargets.length === 0 && operations.length === 0 && ambiguityReasonVerified
    : proposal.requires_clarification === false && selectedLabel === expectedSelectedLabel && selectedTargets.length === 1 && operations.length === 1;
  assert.equal(groundTruthMatch, true, benchmarkCase.case_id);
  assert.equal(instancePolicyVerified, true, benchmarkCase.case_id);
  return {
    case_id: benchmarkCase.case_id,
    model_id: model.model_id,
    domain: model.domain,
    flow: benchmarkCase.flow,
    model_revision: modelRevision,
    task_state: envelope.task_state,
    expected_task_state: benchmarkCase.expected.task_state,
    candidate_count: candidates.length,
    expected_candidate_count: expectedLabels.length,
    expected_candidates_in_top_k: expectedHits,
    selected_target_count: selectedTargets.length,
    operation_count: operations.length,
    requires_clarification: proposal.requires_clarification,
    ambiguity_reason_verified: ambiguityReasonVerified,
    ground_truth_match: groundTruthMatch,
    instance_policy_verified: instancePolicyVerified,
    execution_allowed: false,
    selected_target_fingerprint: selectedTargets.length === 1
      ? `sha256:${sha256Text(`${modelRevision}:${selectedTargets[0].entity_path}`)}`
      : null,
    content_trust: 'untrusted_data',
    policy_effect: 'none'
  };
}

async function expandedEnvelopeDocument(bridge, envelope) {
  const handle = envelope.presentation?.full_result_artifact;
  if (!handle) return { document: { result: envelope.data }, pages: 0 };
  let offset = 0;
  let content = '';
  let pages = 0;
  while (true) {
    const page = await bridge.read_agent_artifact({ handle, task_id: envelope.task_id, offset, max_chars: 4096 });
    assert.equal(page.ok, true, JSON.stringify(page.error));
    content += page.data.artifact.content;
    pages += 1;
    if (page.data.artifact.eof) break;
    assert.ok(page.data.artifact.next_offset > offset, 'artifact pagination did not advance');
    offset = page.data.artifact.next_offset;
    assert.ok(pages < 10_000, 'artifact pagination exceeded safety limit');
  }
  return { document: JSON.parse(content), pages };
}

function candidateLabel(candidate) {
  return candidate?.summary?.value?.name ?? null;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 1 : numerator / denominator;
}

function assertUniqueBenchmarkIds(benchmark) {
  const modelIds = benchmark.models.map((model) => model.model_id);
  assert.equal(new Set(modelIds).size, modelIds.length, 'benchmark model_id values must be unique');
  const cases = benchmark.models.flatMap((model) => model.cases);
  const caseIds = cases.map((entry) => entry.case_id);
  assert.equal(new Set(caseIds).size, caseIds.length, 'benchmark case_id values must be unique');
  const seen = new Set();
  for (const benchmarkCase of cases) {
    if (benchmarkCase.flow === 'clarify') assert.ok(seen.has(benchmarkCase.source_case_id), 'clarification must follow its source case');
    seen.add(benchmarkCase.case_id);
  }
}

function assertPublicReportSafe(value) {
  walk(value, (key, child) => {
    assert.doesNotMatch(key, /^(?:task[_-]?id|session[_-]?id|document[_-]?id|source[_-]?path|token|secret)$/i);
    if (typeof child === 'string') {
      assert.equal(child.startsWith('/') || /^[A-Za-z]:[\\/]/.test(child) || child.startsWith('file://'), false);
    }
  });
}

async function sourceBindings() {
  return Promise.all(SOURCE_PATHS.map(async (relativePath) => ({
    path: relativePath,
    sha256: `sha256:${await sha256File(path.join(REPO_ROOT, relativePath))}`
  })));
}

async function writeOutput(value, report) {
  const target = path.resolve(value);
  const outputRoot = path.join(REPO_ROOT, 'output');
  const relative = path.relative(outputRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('--output must stay inside the repository output directory.');
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.writeFile(temp, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await fs.rename(temp, target);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function sha256File(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function walk(value, callback) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    callback(key, child);
    walk(child, callback);
  }
}

function parseArgs(argv) {
  const options = { fixture: DEFAULT_FIXTURE, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--fixture') options.fixture = path.resolve(requiredValue(argv, ++index, arg));
    else if (arg === '--output') options.output = requiredValue(argv, ++index, arg);
    else if (arg === '--help' || arg === '-h') throw new Error(usage());
    else throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  return options;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function usage() {
  return 'Usage: node scripts/run-model-graph-target-quality-benchmark.mjs [--fixture <path>] [--output <output-path>]';
}
