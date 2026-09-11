#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SUITE } from '../../benchmarks/model-accessibility/suite.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHA = /^[a-f0-9]{64}$/;
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const same = (a, b) => canonical(a) === canonical(b);
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const objectHash = (value) => sha256(canonical(value));
const json = async (name) => JSON.parse(await fs.readFile(name, 'utf8'));

// Request usability is independent of final geometry/file acceptance. In
// particular, a wide JSON schema cannot prove that intent-specific inputs exist.
export function classifyRequestEffectiveness(call) {
  const schema_valid = typeof call?.request_valid === 'boolean' ? call.request_valid : null;
  const classified = (semantically_effective, reason, missing_inputs = []) => ({ schema_valid, semantically_effective, reason, missing_inputs });
  if (schema_valid === false) return classified(false, 'schema_or_interface_rejected');
  if (schema_valid === null) return classified(null, 'schema_validation_unknown');
  const response = call?.result;
  if (!response || typeof response !== 'object' || Array.isArray(response)) return classified(null, 'response_not_observed');
  const body = response.result && typeof response.result === 'object' && !Array.isArray(response.result) ? response.result : {};
  if ([response, body].some(value => value.error || value.ok === false || MISUSE_RESPONSE_CODES.has(value.code))) return classified(false, 'gateway_error_response');
  const actions = [response.next_action, body.next_action].filter(action => action && typeof action === 'object');
  const containers = [response, body, response.details, body.details, ...actions].filter(value => value && typeof value === 'object');
  const missing = [];
  for (const value of containers) {
    for (const key of ['missing_inputs', 'missing_required_inputs', 'required_inputs']) {
      if (Array.isArray(value[key])) missing.push(...value[key]);
    }
  }
  for (const action of actions) if (Array.isArray(action.required)) missing.push(...action.required);
  if (missing.length) return classified(false, 'missing_required_input', structuredClone(missing));
  const state = response.task_state ?? response.state ?? body.task_state ?? body.state ?? body.status?.execution_status;
  if (state === 'awaiting_input') return classified(false, 'awaiting_required_input');
  if (['failed', 'cancelled', 'blocked'].includes(state)) return classified(false, 'request_did_not_progress');
  if (response.ok === true) return classified(true, 'gateway_confirmed_without_error_or_missing_input');
  return classified(null, 'response_semantics_unknown');
}

const MISUSE_RESPONSE_CODES = new Set(['INVALID_ARGUMENT', 'INVALID_ARGUMENTS', 'UNKNOWN_TOOL', 'SCHEMA_VALIDATION_FAILED', 'INVALID_TOOL_ARGUMENTS', 'MISSING_INPUT', 'MISSING_REQUIRED_INPUT', 'MISSING_REQUIRED_INPUTS']);

export function validateSuite(suite = SUITE) {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  const positives = suite.cases.filter((item) => item.kind === 'positive');
  const categories = [...new Set(positives.map((item) => item.category))];
  require(categories.length === 15, 'exactly 15 positive task categories are required');
  require(new Set(suite.cases.map((item) => item.id)).size === suite.cases.length, 'case IDs must be unique');
  require(suite.positive_success_target === 0.9, 'the fixed positive target must remain 90%');
  require(same(suite.paths, ['baseline', 'optimized']), 'the two comparison paths are required');
  for (const category of categories) {
    const cases = positives.filter((item) => item.category === category);
    require(cases.filter((item) => item.split === 'acceptance').length >= 2, `${category}: at least two acceptance variants required`);
    require(cases.some((item) => item.split === 'development'), `${category}: development variant missing`);
    require(cases.some((item) => item.split === 'release_holdout'), `${category}: release holdout missing`);
    require(new Set(cases.map((item) => objectHash(item.parameters))).size === cases.length, `${category}: variants must differ`);
  }
  for (const item of suite.cases) {
    require(nonempty(item.prompt) && item.criteria.length > 0 && new Set(item.criteria).size === item.criteria.length, `${item.id}: prompt and distinct criteria required`);
    require(suite.fixtures.includes(item.fixture_id), `${item.id}: unknown fixture`);
    require(item.required_evidence.includes('edit_boundary'), `${item.id}: edit-boundary evidence missing`);
    if (item.kind === 'positive') require(item.required_evidence.includes('file_delivery') && item.required_evidence.includes('geometry'), `${item.id}: file and geometry evidence required`);
    if (item.kind === 'positive' && !item.required_evidence.includes('closeup')) require(nonempty(item.closeup_exemption), `${item.id}: closeup exemption must be fixed before execution`);
  }
  for (const kind of ['missing_input', 'repairable_input', 'environment_blocked', 'repairable_quality', 'recover_execution', 'approval_required']) {
    require(suite.cases.some((item) => item.kind === 'negative' && item.failure_class === kind), `missing negative class: ${kind}`);
  }
  return { valid: errors.length === 0, errors, positive_categories: categories.length, acceptance_positives: positives.filter((item) => item.split === 'acceptance').length, development_positives: positives.filter((item) => item.split === 'development').length, release_holdout_positives: positives.filter((item) => item.split === 'release_holdout').length, acceptance_negatives: suite.cases.filter((item) => item.kind === 'negative').length, suite_sha256: objectHash(suite) };
}

export function configurationBlockers(config, suite = SUITE) {
  const blockers = [];
  const need = (condition, message) => { if (!condition) blockers.push(message); };
  need(config?.schema_version === 'model-accessibility-config.v1', 'configuration_schema');
  for (const key of ['source_revision', 'sketchup_version', 'plugin_version']) need(nonempty(config?.[key]), `missing_${key}`);
  for (const key of ['source_sha256', 'runtime_capabilities_sha256', 'mcp_server_snapshot_sha256']) need(SHA.test(config?.[key]), `missing_${key}`);
  // A layout variant can change the fixture itself; bind every case, not just a fixture family.
  for (const item of suite.cases) need(SHA.test(config?.fixture_snapshots?.[item.id]), `missing_fixture_snapshot:${item.id}`);
  const identities = [];
  for (const tier of suite.model_tiers) {
    const slots = config?.model_slots?.filter((slot) => slot.tier === tier) ?? [];
    need(slots.length === 1, `model_slot_count:${tier}`);
    const slot = slots[0];
    for (const key of ['provider', 'model_id', 'model_version']) need(nonempty(slot?.[key]), `missing_model_${key}:${tier}`);
    need(slot?.configuration && typeof slot.configuration === 'object' && !Array.isArray(slot.configuration) && Object.keys(slot.configuration).length > 0, `missing_exact_model_configuration:${tier}`);
    if (nonempty(slot?.model_id) && nonempty(slot?.model_version)) identities.push(`${slot.provider}/${slot.model_id}/${slot.model_version}`);
  }
  need(identities.length === 3 && new Set(identities).size === 3, 'three_distinct_attestable_models_required');
  for (const route of suite.paths) {
    need(Array.isArray(config?.paths?.[route]?.entry_tools) && config.paths[route].entry_tools.length > 0, `missing_entry_tools:${route}`);
    need(SHA.test(config?.paths?.[route]?.mcp_description_sha256), `missing_public_mcp_description_snapshot:${route}`);
  }
  const protocol = config?.protocol;
  for (const key of ['new_context_each_run', 'same_fixture_per_pair']) need(protocol?.[key] === true, `protocol:${key}`);
  for (const key of ['repository_access', 'hidden_answers', 'human_tutorial']) need(protocol?.[key] === false, `protocol:${key}`);
  need(protocol?.maximum_repairs_per_part === 3, 'protocol:maximum_repairs_per_part');
  need(config?.resources?.max_open_sketchup_models === 1, 'resources:one_sketchup_model_at_a_time');
  need(nonempty(config?.resources?.currency), 'resources:currency');
  need(finite(config?.resources?.model_cost_cap), 'resources:explicit_cost_cap');
  need(config?.resources?.cost_authorized === true, 'resources:cost_not_authorized');
  need(nonempty(config?.resources?.live_window), 'resources:live_window');
  return blockers;
}

export function createFreeze(config, suite = SUITE, frozenAt = new Date().toISOString()) {
  const blockers = [...validateSuite(suite).errors, ...configurationBlockers(config, suite)];
  if (blockers.length) throw new Error(`Cannot freeze incomplete protocol: ${blockers.join(', ')}`);
  return { schema_version: 'model-accessibility-freeze.v1', frozen_at: frozenAt, suite_sha256: objectHash(suite), config_sha256: objectHash(config), split: 'acceptance', scoring_policy_sha256: objectHash(suite.scoring_policy), config };
}

async function artifact(root, descriptor, errors, name) {
  if (!descriptor || !nonempty(descriptor.path) || !SHA.test(descriptor.sha256)) { errors.push(`missing_artifact:${name}`); return null; }
  try {
    const rootPath = await fs.realpath(root);
    const lexicalPath = path.resolve(rootPath, descriptor.path);
    if (path.isAbsolute(descriptor.path) || !lexicalPath.startsWith(`${rootPath}${path.sep}`)) throw new Error('path must remain inside evidence directory');
    const realPath = await fs.realpath(lexicalPath);
    if (!realPath.startsWith(`${rootPath}${path.sep}`)) throw new Error('symlink escapes evidence directory');
    const bytes = await fs.readFile(realPath);
    if (sha256(bytes) !== descriptor.sha256) throw new Error('SHA-256 mismatch');
    return { bytes, value: path.extname(realPath) === '.json' ? JSON.parse(bytes.toString('utf8')) : null };
  } catch (error) { errors.push(`invalid_artifact:${name}:${error.message}`); return null; }
}

export async function evaluateRun({ run, evidenceRoot, config, freeze, suite = SUITE, testCase }) {
  const errors = [];
  const failed = [];
  const need = (condition, code) => { if (!condition) errors.push(code); };
  need(run.schema_version === 'model-accessibility-run.v1', 'run_schema');
  need(run.evidence_mode === 'live' && run.test_fixture !== true, 'live_evidence_required');
  need(nonempty(run.run_id), 'run_id_required');
  need(run.suite_sha256 === objectHash(suite), 'suite_hash_mismatch');
  need(freeze && run.freeze_sha256 === objectHash(freeze), 'freeze_hash_mismatch');
  need(run.case_id === testCase.id, 'case_id_mismatch');
  const slot = config.model_slots?.find((item) => item.tier === run.model_tier);
  need(slot && same(run.model_identity, slot), 'exact_model_identity_mismatch');
  need(suite.paths.includes(run.interface_path), 'unknown_interface_path');
  const trace = (await artifact(evidenceRoot, run.artifacts?.transcript, errors, 'transcript'))?.value;
  const native = (await artifact(evidenceRoot, run.artifacts?.runtime_readback, errors, 'runtime_readback'))?.value;
  const assessment = (await artifact(evidenceRoot, run.artifacts?.assessment, errors, 'assessment'))?.value;
  const billing = (await artifact(evidenceRoot, run.artifacts?.billing, errors, 'billing'))?.value;
  const artifacts = {};
  for (const name of testCase.required_evidence) artifacts[name] = (await artifact(evidenceRoot, run.artifacts?.[name], errors, name))?.value;
  need(trace?.schema_version === 'model-accessibility-trace.v1' && trace?.producer === 'independent_collector', 'independent_collector_trace_required');
  need(!Array.isArray(trace?.import_blockers) || trace.import_blockers.length === 0, 'transcript_import_incomplete');
  need(trace?.run_id === run.run_id && same(trace?.model_identity, slot), 'trace_identity_mismatch');
  need(nonempty(trace?.provider_response_model_id) && trace?.provider_response_model_id === slot?.model_version, 'provider_model_version_not_attested');
  need(trace?.context?.fresh === true && nonempty(trace?.context?.session_id), 'fresh_context_required');
  for (const key of ['repository_access', 'hidden_answers', 'human_tutorial', 'prior_conversation']) need(trace?.context?.[key] === false, `context:${key}`);
  need(trace?.context?.prompt_sha256 === sha256(testCase.prompt), 'task_prompt_mismatch');
  need(trace?.context?.mcp_description_sha256 === config.paths?.[run.interface_path]?.mcp_description_sha256, 'mcp_description_mismatch');
  need(Array.isArray(trace?.context?.initial_messages) && trace.context.initial_messages.length === 1 && trace.context.initial_messages[0]?.role === 'user' && trace.context.initial_messages[0]?.content === testCase.prompt, 'initial_messages_must_contain_only_fixed_user_task');
  need(Array.isArray(trace?.tool_calls) && trace.tool_calls.length > 0, 'raw_tool_trace_required');
  const calls = Array.isArray(trace?.tool_calls) ? trace.tool_calls : [];
  for (const [index, call] of calls.entries()) {
    need(nonempty(call.tool) && call.arguments && typeof call.arguments === 'object' && call.result !== undefined, `incomplete_tool_event:${index}`);
    need(typeof call.request_valid === 'boolean' && typeof call.interface_misuse === 'boolean', `unclassified_tool_event:${index}`);
  }
  const repairs = trace?.corrections_by_part;
  need(repairs && typeof repairs === 'object' && !Array.isArray(repairs) && Object.values(repairs).every(integer), 'correction_counts_required');
  if (repairs && Object.values(repairs).some((value) => value > 3)) failed.push('automatic_repair_limit_exceeded');
  for (const key of ['design_clarifications', 'manual_rescues', 'system_unlocks', 'human_tutorials']) need(integer(trace?.human_interventions?.[key]), `missing_human_metric:${key}`);
  if ((trace?.human_interventions?.manual_rescues ?? 0) > 0 || (trace?.human_interventions?.human_tutorials ?? 0) > 0 || (testCase.kind === 'positive' && (trace?.human_interventions?.design_clarifications ?? 0) > 0)) failed.push('not_unassisted');
  need(native?.runtime === 'queue' && native?.native_sketchup === true && native?.test_fixture !== true && native?.run_id === run.run_id, 'native_queue_readback_required');
  for (const key of ['source_sha256', 'sketchup_version', 'plugin_version', 'runtime_capabilities_sha256', 'mcp_server_snapshot_sha256']) need(native?.[key] === config[key], `runtime_config_mismatch:${key}`);
  need(native?.fixture_sha256 === config.fixture_snapshots?.[testCase.id], 'fixture_hash_mismatch');
  need(native?.max_simultaneous_open_models === 1 && native?.closed_after_run === true, 'single_model_cleanup_required');
  need(finite(native?.wall_time_seconds) && native.wall_time_seconds > 0, 'actual_live_duration_required');
  need(nonempty(native?.started_at) && Date.parse(native.started_at) >= Date.parse(freeze?.frozen_at), 'run_must_follow_freeze');
  need(assessment?.producer === 'independent_assessor' && assessment?.model_under_test === false && nonempty(assessment?.assessor_id) && assessment?.run_id === run.run_id, 'independent_assessment_required');
  need(assessment?.suite_sha256 === objectHash(suite), 'assessment_suite_mismatch');
  for (const criterion of testCase.criteria) {
    const check = assessment?.checks?.find((item) => item.criterion === criterion);
    need(check && ['passed', 'failed', 'unresolved'].includes(check.status) && nonempty(check.observation) && Array.isArray(check.evidence_keys) && check.evidence_keys.length > 0, `missing_criterion:${criterion}`);
    if (check?.status !== 'passed') failed.push(criterion);
    for (const key of check?.evidence_keys ?? []) need(Object.hasOwn(run.artifacts ?? {}, key) && (key === 'runtime_readback' || testCase.required_evidence.includes(key)), `criterion_evidence_missing:${criterion}:${key}`);
  }
  for (const name of testCase.required_evidence) {
    const proof = artifacts[name];
    need(proof?.run_id === run.run_id && proof?.runtime === 'queue' && proof?.producer === 'independent_assessor' && proof?.test_fixture !== true, `unbound_evidence:${name}`);
    if (proof?.status !== 'passed') failed.push(`evidence:${name}`);
    need(Array.isArray(proof?.observations) && proof.observations.length > 0, `no_observations:${name}`);
  }
  if (testCase.required_evidence.includes('closeup')) {
    const captures = artifacts.closeup?.captures;
    need(Array.isArray(captures) && captures.length > 0, 'native_closeup_images_required');
    for (const [index, capture] of (captures ?? []).entries()) {
      const img = await artifact(evidenceRoot, capture, errors, `closeup_image:${index}`);
      const signature = img?.bytes?.subarray(0, 8).toString('hex');
      need(signature === '89504e470d0a1a0a' || img?.bytes?.subarray(0, 3).toString('hex') === 'ffd8ff', `invalid_closeup_image:${index}`);
    }
  }
  if (testCase.required_evidence.includes('file_delivery')) {
    const delivery = artifacts.file_delivery;
    const saved = await artifact(evidenceRoot, delivery?.file, errors, 'delivered_file');
    if (testCase.category === 'asset_query') need(saved?.value && nonempty(delivery?.file?.path), 'catalog_json_delivery_required');
    else {
      need(delivery?.file?.path?.toLowerCase().endsWith('.skp') && saved?.bytes?.length > 0, 'saved_skp_required');
      need(delivery?.native_save_success === true && delivery?.native_reopen_success === true && delivery?.reopened_sha256 === delivery?.file?.sha256, 'native_save_reopen_required');
    }
  }
  for (const key of ['wrong_object_execution', 'unauthorized_execution', 'duplicate_modification', 'frozen_requirement_violation', 'manual_edit_loss', 'false_completion']) {
    need(integer(assessment?.hard_gates?.[key]), `missing_safety_metric:${key}`);
    if (assessment?.hard_gates?.[key] !== 0) failed.push(`safety:${key}`);
  }
  need(billing?.producer === 'independent_collector' && billing?.run_id === run.run_id && billing?.currency === config.resources?.currency && ['provider_usage', 'invoice', 'published_rate_calculation', 'subscription_allocation'].includes(billing?.basis), 'billing_provenance_required');
  need(finite(billing?.model_cost) && integer(billing?.input_tokens) && integer(billing?.output_tokens) && nonempty(billing?.source), 'billing_metrics_required');
  need(typeof billing?.estimated === 'boolean', 'billing_estimation_must_be_explicit');
  const firstRequest = calls.length ? classifyRequestEffectiveness(calls[0]) : { schema_valid: null, semantically_effective: null, reason: 'no_observed_tool_calls' };
  return {
    run_id: run.run_id, case_id: testCase.id, model_tier: run.model_tier, interface_path: run.interface_path,
    status: errors.length ? 'invalid_evidence' : failed.length ? 'failed' : 'passed', errors, failed_criteria: [...new Set(failed)],
    context_id: trace?.context?.session_id ?? null,
    metrics: { tool_calls: calls.length, first_request_valid: firstRequest.schema_valid,
      first_request_schema_valid: firstRequest.schema_valid,
      first_request_semantically_effective: firstRequest.semantically_effective,
      first_request_semantic_reason: firstRequest.reason,
      interface_misuses: calls.filter((call) => call.interface_misuse === true).length, correction_rounds: repairs && Object.values(repairs).every(integer) ? Object.values(repairs).reduce((a, b) => a + b, 0) : null, human_interventions: trace?.human_interventions ?? null, model_cost: finite(billing?.model_cost) ? billing.model_cost : null, currency: billing?.currency ?? null, cost_estimated: billing?.estimated ?? null, input_tokens: billing?.input_tokens ?? null, output_tokens: billing?.output_tokens ?? null, live_seconds: finite(native?.wall_time_seconds) ? native.wall_time_seconds : null }
  };
}

export function summarizeRuns(rows, expected) {
  const passed = rows.filter((row) => row.status === 'passed').length;
  const valid = rows.filter((row) => ['passed', 'failed'].includes(row.status));
  const allCostsKnown = rows.length > 0 && rows.every((row) => finite(row.metrics?.model_cost));
  const cost = allCostsKnown ? rows.reduce((sum, row) => sum + row.metrics.model_cost, 0) : null;
  const schemaKnown = valid.filter(row => typeof row.metrics.first_request_schema_valid === 'boolean');
  const semanticKnown = valid.filter(row => typeof row.metrics.first_request_semantically_effective === 'boolean');
  const semanticRate = semanticKnown.length ? semanticKnown.filter(row => row.metrics.first_request_semantically_effective).length / semanticKnown.length : null;
  return {
    expected, received: rows.length, valid_evidence_runs: valid.length, passed,
    failed: rows.filter((row) => row.status === 'failed').length,
    invalid_evidence: rows.filter((row) => row.status === 'invalid_evidence').length,
    missing: Math.max(0, expected - rows.length),
    fixed_set_completion_rate: passed / expected,
    observed_valid_run_success_rate: valid.length ? passed / valid.length : null,
    first_schema_valid_request_rate: schemaKnown.length ? schemaKnown.filter(row => row.metrics.first_request_schema_valid).length / schemaKnown.length : null,
    first_schema_valid_request_observed_runs: schemaKnown.length,
    first_semantically_effective_request_rate: semanticRate,
    first_semantically_effective_request_observed_runs: semanticKnown.length,
    first_semantically_effective_request_unknown_runs: valid.length - semanticKnown.length,
    first_effective_request_rate: semanticRate,
    interface_misuses: valid.reduce((sum, row) => sum + row.metrics.interface_misuses, 0),
    correction_rounds: valid.reduce((sum, row) => sum + row.metrics.correction_rounds, 0),
    tool_calls: valid.reduce((sum, row) => sum + row.metrics.tool_calls, 0),
    design_clarifications: valid.reduce((sum, row) => sum + row.metrics.human_interventions.design_clarifications, 0),
    manual_rescues: valid.reduce((sum, row) => sum + row.metrics.human_interventions.manual_rescues, 0),
    system_unlocks: valid.reduce((sum, row) => sum + row.metrics.human_interventions.system_unlocks, 0),
    human_tutorials: valid.reduce((sum, row) => sum + row.metrics.human_interventions.human_tutorials, 0),
    total_model_cost: cost,
    cost_per_success: cost !== null && passed > 0 ? cost / passed : null,
    includes_estimated_cost: rows.some((row) => row.metrics?.cost_estimated === true),
    live_seconds: valid.reduce((sum, row) => sum + row.metrics.live_seconds, 0),
    unsuccessful_case_ids: rows.filter((row) => row.status !== 'passed').map((row) => row.case_id)
  };
}

export async function aggregate({ config, freeze = null, evidenceRoot, suite = SUITE, split = 'acceptance' }) {
  if (!['acceptance', 'release_holdout', 'development'].includes(split)) throw new Error(`Unknown split: ${split}`);
  const blockers = [...validateSuite(suite).errors, ...configurationBlockers(config, suite)];
  if (!freeze || freeze.schema_version !== 'model-accessibility-freeze.v1' || freeze.suite_sha256 !== objectHash(suite) || freeze.config_sha256 !== objectHash(config) || !same(freeze.config, config) || freeze.scoring_policy_sha256 !== objectHash(suite.scoring_policy) || !Number.isFinite(Date.parse(freeze.frozen_at))) blockers.push('valid_pre_execution_freeze_required');
  const cases = suite.cases.filter((item) => item.kind === 'negative' || item.split === split);
  const rawRuns = [];
  let entries = [];
  try { entries = (await fs.readdir(path.join(evidenceRoot, 'runs'))).filter((file) => file.endsWith('.json')).sort(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const file of entries) {
    try { rawRuns.push({ file, run: await json(path.join(evidenceRoot, 'runs', file)) }); }
    catch (error) { blockers.push(`unreadable_run:${file}:${error.message}`); }
  }
  const evaluated = [];
  const identities = new Set();
  const sessions = new Set();
  const tuples = new Set();
  for (const { file, run } of rawRuns) {
    const testCase = cases.find((item) => item.id === run.case_id);
    if (!testCase || !suite.paths.includes(run.interface_path) || !suite.model_tiers.includes(run.model_tier)) { blockers.push(`unexpected_run:${file}`); continue; }
    const tuple = `${run.model_tier}/${run.interface_path}/${run.case_id}`;
    if (tuples.has(tuple)) { blockers.push(`duplicate_case_run:${tuple}`); continue; }
    tuples.add(tuple);
    const result = await evaluateRun({ run, evidenceRoot, config, freeze, suite, testCase });
    if (identities.has(run.run_id)) { result.errors.push('duplicate_run_identity'); result.status = 'invalid_evidence'; }
    if (result.context_id && sessions.has(result.context_id)) { result.errors.push('context_reused'); result.status = 'invalid_evidence'; }
    identities.add(run.run_id);
    if (result.context_id) sessions.add(result.context_id);
    evaluated.push(result);
  }
  const models = suite.model_tiers.map((tier) => {
    const routes = Object.fromEntries(suite.paths.map((route) => {
      const rows = evaluated.filter((item) => item.model_tier === tier && item.interface_path === route);
      const selected = (kind) => rows.filter((row) => cases.find((item) => item.id === row.case_id).kind === kind);
      const positiveCases = cases.filter((item) => item.kind === 'positive');
      const positive = summarizeRuns(selected('positive'), positiveCases.length);
      const negative = summarizeRuns(selected('negative'), cases.filter((item) => item.kind === 'negative').length);
      positive.missing_case_ids = positiveCases.filter((item) => !rows.some((row) => row.case_id === item.id)).map((item) => item.id);
      negative.missing_case_ids = cases.filter((item) => item.kind === 'negative' && !rows.some((row) => row.case_id === item.id)).map((item) => item.id);
      const byCategory = Object.fromEntries([...new Set(positiveCases.map((item) => item.category))].map((category) => [category, summarizeRuns(selected('positive').filter((row) => positiveCases.find((item) => item.id === row.case_id).category === category), positiveCases.filter((item) => item.category === category).length)]));
      return [route, { positive, negative, by_category: byCategory }];
    }));
    const baseline = routes.baseline.positive;
    const optimized = routes.optimized.positive;
    const complete = [baseline, optimized, routes.baseline.negative, routes.optimized.negative].every((group) => group.valid_evidence_runs === group.expected);
    const delta = complete ? optimized.fixed_set_completion_rate - baseline.fixed_set_completion_rate : null;
    const misuseReduction = complete ? baseline.interface_misuses - optimized.interface_misuses : null;
    return {
      tier, model_identity: config.model_slots?.find((slot) => slot.tier === tier) ?? null,
      ...routes,
      comparison: { paired_evidence_complete: complete, success_rate_delta: delta, interface_misuse_reduction: misuseReduction, improvement_demonstrated: complete && delta >= 0 && (delta > 0 || misuseReduction > 0) },
      optimized_target_met: optimized.valid_evidence_runs === optimized.expected && optimized.fixed_set_completion_rate >= suite.positive_success_target,
      safety_negative_cases_passed: routes.baseline.negative.passed === routes.baseline.negative.expected && routes.optimized.negative.passed === routes.optimized.negative.expected
    };
  });
  const expected = cases.length * suite.paths.length * suite.model_tiers.length;
  if (evaluated.length < expected) blockers.push(`missing_live_run_evidence:${expected - evaluated.length}`);
  if (evaluated.some((row) => row.status === 'invalid_evidence')) blockers.push('invalid_run_evidence');
  const reportedCost = evaluated.reduce((sum, row) => sum + (row.metrics?.model_cost ?? 0), 0);
  if (finite(config.resources?.model_cost_cap) && reportedCost > config.resources.model_cost_cap) blockers.push('cost_cap_exceeded');
  const crossModelAccepted = blockers.length === 0 && models.every((model) => model.optimized_target_met && model.safety_negative_cases_passed && model.comparison.improvement_demonstrated);
  return {
    schema_version: 'model-accessibility-report.v1', generated_at: new Date().toISOString(), split,
    suite_sha256: objectHash(suite), config_sha256: objectHash(config), freeze_sha256: freeze ? objectHash(freeze) : null,
    evidence_level: evaluated.some((row) => row.status !== 'invalid_evidence') ? 'imported_live_evidence' : 'offline_contract_only',
    benchmark_invoked_model: false, benchmark_invoked_live_queue: false,
    request_metric_definitions: {
      version: 'schema-and-response-semantics.v2',
      schema_valid: 'Frozen public tool schema and interface-path validation only; does not establish intent-specific required inputs.',
      semantically_effective: 'Schema-valid first call with an observed ok=true Gateway response, no error, missing required input, awaiting_input, failed, cancelled or blocked state. This is request progress, not final task acceptance.',
      unknown: 'Absent schema validation or insufficient response semantics remain null and are excluded from observed-rate denominators; observed and unknown counts are reported.',
      legacy_first_request_valid: 'Alias for first_request_schema_valid.',
      legacy_first_effective_request_rate: 'Alias for first_semantically_effective_request_rate; schema-only behavior was corrected before formal freeze.'
    },
    expected_run_count: expected, received_run_count: evaluated.length, blockers,
    models, runs: evaluated,
    cross_model_acceptance: crossModelAccepted && split === 'acceptance',
    release_holdout_acceptance: crossModelAccepted && split === 'release_holdout',
    release_acceptance: false,
    limitations: [
      'This collector validates imported evidence integrity and the fixed assessment contract; it does not itself invoke or attest a model provider or inspect SketchUp.',
      'Hashes bind supplied evidence bytes, not the truth of collector or assessor statements; trusted independent capture and review remain required.',
      'Missing, mock, contaminated, duplicate, unpinned, unreviewed or cost-unknown evidence cannot establish success.',
      'Overall product release additionally requires existing safety/compatibility regressions and separately accepted release holdouts.'
    ]
  };
}

export function markdown(report) {
  const lines = ['# 普通模型首次使用验收报告', '', `证据级别：${report.evidence_level}。报告只核验已有证据，本次 runner 未调用模型或 SketchUp。`, '', `固定集合：${report.split}；要求 ${report.expected_run_count} 次运行，收到 ${report.received_run_count} 次。跨模型验收：${report.cross_model_acceptance ? '通过' : '未通过'}。发布验收：未完成。`, '', '| 模型档位 | 路径 | 正例通过 / 固定总数 | 有效实机证据 | 负例通过 / 固定总数 | 每个成功任务模型成本 |', '| --- | --- | --- | --- | --- | --- |'];
  if (report.configuration_basis === 'unconfigured_example') lines.splice(4, 0, '此报告使用未填写的示例配置测试失败关闭行为；其中缺失访问/费用字段不代表用户当前授权状态或 Alma 实际可用模型。', '');
  for (const model of report.models) for (const route of ['baseline', 'optimized']) {
    const p = model[route].positive; const n = model[route].negative;
    lines.push(`| ${model.tier} | ${route} | ${p.passed} / ${p.expected} | ${p.valid_evidence_runs} | ${n.passed} / ${n.expected} | ${p.cost_per_success ?? '无可核验成本'} |`);
  }
  lines.push('', '未采集运行的 0 / 固定总数表示缺少完成证据，不表示已观测到模型失败。负例不进入正例完成率；强模型不补足普通模型成绩。', '', '## 阻塞项', '', ...report.blockers.map((item) => `- ${item}`), '', '完整 JSON 按模型、路径、任务类别列出缺失项、未通过项、人工介入、修正、调用、费用和实机时间；比较只在完整配对证据存在时计算。', '');
  return lines.join('\n');
}

async function writeNew(file, value) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, value, { flag: 'wx' }); }

async function main() {
  const [command = 'validate', ...argv] = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!['--config', '--freeze', '--evidence-dir', '--output', '--split'].includes(argv[index]) || !argv[index + 1]) throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
    options[argv[index].slice(2)] = argv[index + 1];
  }
  if (command === 'validate') {
    const result = validateSuite();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.valid) process.exitCode = 1;
    return;
  }
  const config = await json(path.resolve(options.config ?? path.join(ROOT, 'benchmarks/model-accessibility/config.example.json')));
  if (command === 'freeze') {
    if (!options.output) throw new Error('freeze requires a new --output file');
    const freeze = createFreeze(config);
    await writeNew(path.resolve(options.output), `${JSON.stringify(freeze, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ freeze_sha256: objectHash(freeze), output: path.resolve(options.output) })}\n`);
    return;
  }
  if (command !== 'report') throw new Error(`Unknown command: ${command}`);
  const freeze = options.freeze ? await json(path.resolve(options.freeze)) : null;
  const report = await aggregate({ config, freeze, evidenceRoot: path.resolve(options['evidence-dir'] ?? path.join(ROOT, 'benchmarks/model-accessibility/evidence')), split: options.split ?? 'acceptance' });
  report.configuration_basis = options.config ? 'provided_configuration' : 'unconfigured_example';
  if (options.output) {
    await writeNew(path.resolve(options.output), `${JSON.stringify(report, null, 2)}\n`);
    await writeNew(path.resolve(options.output).replace(/\.json$/i, '') + '.md', markdown(report));
  }
  process.stdout.write(`${JSON.stringify({ evidence_level: report.evidence_level, expected_runs: report.expected_run_count, received_runs: report.received_run_count, cross_model_acceptance: report.cross_model_acceptance, release_holdout_acceptance: report.release_holdout_acceptance, release_acceptance: false, blocker_count: report.blockers.length })}\n`);
  // Evidence absence remains a non-successful exit even when the report was written.
  if (!(report.cross_model_acceptance || report.release_holdout_acceptance)) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
