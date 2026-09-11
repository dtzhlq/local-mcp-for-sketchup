import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SUITE } from '../benchmarks/model-accessibility/suite.mjs';
import { aggregate, classifyRequestEffectiveness, configurationBlockers, createFreeze, evaluateRun, objectHash, sha256, summarizeRuns, validateSuite } from '../scripts/model-accessibility/benchmark.mjs';
import { dryRunPacket, importTranscript, parseEvents } from '../scripts/model-accessibility/transcript.mjs';
import { GATEWAY_TOOLS, runModelLoop } from '../scripts/model-accessibility/agent-loop.mjs';
import { extractGatewayDefinitions } from '../scripts/model-accessibility/snapshot-tools.mjs';

// This is an offline contract test. Native-shaped fixtures are deliberately marked
// test_fixture and must never become a live model grade or survive as evidence.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'model-accessibility-contract-'));
let assertions = 0;
function check(value, message) { assertions += 1; assert.ok(value, message); }
const baseConfig = JSON.parse(await fs.readFile(new URL('../benchmarks/model-accessibility/config.example.json', import.meta.url), 'utf8'));
const config = {
  ...structuredClone(baseConfig), source_revision: 'test-revision', source_sha256: sha256('test-source'),
  sketchup_version: 'test-sketchup', plugin_version: 'test-plugin', runtime_capabilities_sha256: sha256('test-capabilities'),
  mcp_server_snapshot_sha256: sha256('test-server'),
  fixture_snapshots: Object.fromEntries(SUITE.cases.map((item) => [item.id, sha256(`test-fixture-${item.id}`)])),
  model_slots: SUITE.model_tiers.map((tier) => ({ tier, provider: 'TEST_ONLY', model_id: `test-${tier}`, model_version: `test-${tier}-version-1`, configuration: { temperature: 0, reasoning_effort: 'test' } })),
  paths: Object.fromEntries(SUITE.paths.map((route) => [route, { ...baseConfig.paths[route], mcp_description_sha256: sha256(`test-${route}`) }])),
  resources: { currency: 'TEST', model_cost_cap: 0, cost_authorized: true, live_window: 'TEST_ONLY_NO_EXECUTION', max_open_sketchup_models: 1 }
};
const freeze = createFreeze(config, SUITE, '2026-09-08T00:00:00Z');

async function writeArtifact(prefix, name, value) {
  const relative = `artifacts/${prefix}/${name}.json`;
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await fs.writeFile(path.join(root, relative), bytes);
  return { path: relative, sha256: sha256(bytes) };
}

async function shapedRun(testCase, suffix = 'a') {
  const id = `test-only-${suffix}`;
  const identity = config.model_slots[0];
  const binding = { run_id: id, runtime: 'queue', producer: 'independent_assessor', status: 'passed', observations: ['Synthetic contract fixture; never a live observation.'] };
  const trace = {
    schema_version: 'model-accessibility-trace.v1', producer: 'independent_collector', run_id: id,
    model_identity: identity, provider_response_model_id: identity.model_version,
    context: { fresh: true, session_id: `test-context-${suffix}`, repository_access: false, hidden_answers: false, human_tutorial: false, prior_conversation: false, prompt_sha256: sha256(testCase.prompt), mcp_description_sha256: config.paths.baseline.mcp_description_sha256, initial_messages: [{ role: 'user', content: testCase.prompt }] },
    tool_calls: [{ tool: 'get_capabilities', arguments: { runtime: 'queue' }, result: { test_only: true }, request_valid: true, interface_misuse: false }],
    corrections_by_part: {}, human_interventions: { design_clarifications: 0, manual_rescues: 0, system_unlocks: 1, human_tutorials: 0 }
  };
  const native = { run_id: id, runtime: 'queue', native_sketchup: true, source_sha256: config.source_sha256, sketchup_version: config.sketchup_version, plugin_version: config.plugin_version, runtime_capabilities_sha256: config.runtime_capabilities_sha256, mcp_server_snapshot_sha256: config.mcp_server_snapshot_sha256, fixture_sha256: config.fixture_snapshots[testCase.id], max_simultaneous_open_models: 1, closed_after_run: true, wall_time_seconds: 1, started_at: '2026-09-08T01:00:00Z' };
  const assessment = { producer: 'independent_assessor', model_under_test: false, assessor_id: 'TEST_ASSESSOR', run_id: id, suite_sha256: objectHash(SUITE), checks: testCase.criteria.map((criterion) => ({ criterion, status: 'passed', observation: 'Synthetic contract fixture.', evidence_keys: ['runtime_readback'] })), hard_gates: Object.fromEntries(['wrong_object_execution', 'unauthorized_execution', 'duplicate_modification', 'frozen_requirement_violation', 'manual_edit_loss', 'false_completion'].map((key) => [key, 0])) };
  const billing = { producer: 'independent_collector', run_id: id, currency: 'TEST', basis: 'subscription_allocation', model_cost: 0, input_tokens: 0, output_tokens: 0, source: 'Synthetic test cost; no model invoked.', estimated: false };
  const artifacts = {};
  for (const [name, value] of Object.entries({ transcript: trace, runtime_readback: native, assessment, billing })) artifacts[name] = await writeArtifact(id, name, value);
  for (const name of testCase.required_evidence) artifacts[name] = await writeArtifact(id, name, binding);
  if (testCase.category === 'asset_query') {
    const file = await writeArtifact(id, 'catalog-delivery', { items: [], test_only: true });
    artifacts.file_delivery = await writeArtifact(id, 'file_delivery', { ...binding, file });
  }
  return { run: { schema_version: 'model-accessibility-run.v1', evidence_mode: 'live', test_fixture: true, run_id: id, suite_sha256: objectHash(SUITE), freeze_sha256: objectHash(freeze), case_id: testCase.id, model_tier: identity.tier, model_identity: identity, interface_path: 'baseline', artifacts }, trace, native, assessment, billing };
}

async function evaluate(shaped, testCase) { return evaluateRun({ run: shaped.run, evidenceRoot: root, config, freeze, testCase }); }

try {
  const suiteResult = validateSuite();
  check(suiteResult.valid, 'fixed suite validates');
  const frozenSource = await fs.readFile(new URL('../benchmarks/model-accessibility/snapshots/baseline-de7d482/mcp-server.source.mjs', import.meta.url), 'utf8');
  const frozenTools = JSON.parse(await fs.readFile(new URL('../benchmarks/model-accessibility/snapshots/baseline-de7d482/tools.json', import.meta.url), 'utf8'));
  check(objectHash(extractGatewayDefinitions(frozenSource)) === objectHash(frozenTools), 'baseline snapshot remains exactly source-bound without evaluating historical source');
  check(!frozenTools[0].inputSchema.properties.intent.enum.includes('discover'), 'baseline fixture does not contain optimized discovery');
  assert.deepEqual([suiteResult.positive_categories, suiteResult.acceptance_positives, suiteResult.acceptance_negatives, suiteResult.development_positives, suiteResult.release_holdout_positives], [15, 30, 13, 15, 15]); assertions += 1;
  const duplicate = structuredClone(SUITE); duplicate.cases.push(duplicate.cases[0]);
  check(!validateSuite(duplicate).valid, 'duplicate cases rejected');
  const lowered = structuredClone(SUITE); lowered.positive_success_target = 0.8;
  check(!validateSuite(lowered).valid, 'target cannot be reduced');
  const missingVariant = structuredClone(SUITE); missingVariant.cases = missingVariant.cases.filter((item) => item.id !== 'window.acceptance_b');
  check(!validateSuite(missingVariant).valid, 'two acceptance variants required for every category');
  const noEdit = structuredClone(SUITE); noEdit.cases[0].required_evidence = ['geometry', 'closeup', 'file_delivery'];
  check(!validateSuite(noEdit).valid, 'edit-boundary evidence is mandatory');
  const changed = structuredClone(SUITE); changed.cases[0].prompt += 'changed';
  check(objectHash(SUITE) !== objectHash(changed), 'requirements changes alter the freeze digest');
  check(configurationBlockers(baseConfig).includes('resources:cost_not_authorized'), 'sample config cannot imply paid-service authorization');
  assert.throws(() => createFreeze(baseConfig), /Cannot freeze/); assertions += 1;
  check(configurationBlockers(config).length === 0, 'complete non-live test configuration passes structural checks');
  const reusedModels = structuredClone(config); reusedModels.model_slots[1] = { ...reusedModels.model_slots[0], tier: 'midrange' };
  check(configurationBlockers(reusedModels).includes('three_distinct_attestable_models_required'), 'one model relabeled as another tier is rejected');
  const missingFixture = structuredClone(config); delete missingFixture.fixture_snapshots['asset_replace.acceptance_b'];
  check(configurationBlockers(missingFixture).includes('missing_fixture_snapshot:asset_replace.acceptance_b'), 'fixtures are frozen per variant');

  const empty = await aggregate({ config: baseConfig, evidenceRoot: root });
  check(empty.expected_run_count === 258 && empty.received_run_count === 0, 'three models times two paths times 30 positives plus 13 negatives');
  check(empty.evidence_level === 'offline_contract_only' && !empty.cross_model_acceptance && !empty.release_acceptance, 'empty report is explicitly offline and fail-closed');
  check(empty.models.every((item) => item.optimized.positive.expected === 30 && item.optimized.negative.expected === 13), 'negative denominator stays separate');
  check(empty.models.every((item) => item.optimized.positive.observed_valid_run_success_rate === null && item.optimized.positive.cost_per_success === null && item.comparison.success_rate_delta === null), 'missing evidence is neither fabricated observed failure nor fabricated cost/improvement');

  const queryCase = SUITE.cases.find((item) => item.id === 'asset_query.acceptance_a');
  const shaped = await shapedRun(queryCase);
  const mockResult = await evaluate(shaped, queryCase);
  check(mockResult.status === 'invalid_evidence' && mockResult.errors.includes('live_evidence_required'), 'even complete native-shaped test fixtures cannot pass');
  assert.deepEqual(mockResult.errors, ['live_evidence_required']); assertions += 1;
  shaped.trace.context.prior_conversation = true;
  shaped.run.artifacts.transcript = await writeArtifact(shaped.run.run_id, 'transcript', shaped.trace);
  check((await evaluate(shaped, queryCase)).errors.includes('context:prior_conversation'), 'prior context contamination rejected');
  shaped.trace.context.prior_conversation = false;
  shaped.trace.context.initial_messages.push({ role: 'system', content: 'Hidden solution' });
  shaped.run.artifacts.transcript = await writeArtifact(shaped.run.run_id, 'transcript', shaped.trace);
  check((await evaluate(shaped, queryCase)).errors.includes('initial_messages_must_contain_only_fixed_user_task'), 'hidden initial tutorial rejected');
  shaped.trace.context.initial_messages.pop();
  shaped.trace.provider_response_model_id = 'floating-alias';
  shaped.run.artifacts.transcript = await writeArtifact(shaped.run.run_id, 'transcript', shaped.trace);
  check((await evaluate(shaped, queryCase)).errors.includes('provider_model_version_not_attested'), 'requested model name cannot replace response-version attestation');
  shaped.trace.provider_response_model_id = shaped.run.model_identity.model_version;
  shaped.trace.corrections_by_part = { B: 4 };
  shaped.trace.human_interventions.manual_rescues = 1;
  shaped.run.artifacts.transcript = await writeArtifact(shaped.run.run_id, 'transcript', shaped.trace);
  const overRepair = await evaluate(shaped, queryCase);
  check(overRepair.failed_criteria.includes('automatic_repair_limit_exceeded'), 'fourth repair fails bounded recovery');
  check(overRepair.failed_criteria.includes('not_unassisted'), 'manual rescue cannot count as unaided success');
  shaped.native.fixture_sha256 = sha256('different-layout');
  shaped.native.started_at = '2026-09-07T00:00:00Z';
  shaped.native.closed_after_run = false;
  shaped.run.artifacts.runtime_readback = await writeArtifact(shaped.run.run_id, 'runtime_readback', shaped.native);
  const alteredRuntime = await evaluate(shaped, queryCase);
  check(alteredRuntime.errors.includes('fixture_hash_mismatch'), 'different geometry conditions cannot be paired');
  check(alteredRuntime.errors.includes('run_must_follow_freeze'), 'historical evidence cannot be retroactively admitted');
  check(alteredRuntime.errors.includes('single_model_cleanup_required'), 'model window cleanup is required');
  shaped.assessment.checks[0].status = 'failed';
  shaped.assessment.hard_gates.false_completion = 1;
  shaped.run.artifacts.assessment = await writeArtifact(shaped.run.run_id, 'assessment', shaped.assessment);
  const quality = await evaluate(shaped, queryCase);
  check(quality.failed_criteria.includes(queryCase.criteria[0]), 'quality failure cannot be hidden by completed tool result');
  check(quality.failed_criteria.includes('safety:false_completion'), 'false success is a hard safety failure');
  delete shaped.billing.model_cost;
  shaped.run.artifacts.billing = await writeArtifact(shaped.run.run_id, 'billing', shaped.billing);
  check((await evaluate(shaped, queryCase)).errors.includes('billing_metrics_required'), 'unknown cost is not zero');

  const badHash = await shapedRun(queryCase, 'hash');
  badHash.run.artifacts.geometry.sha256 = sha256('tampered');
  check((await evaluate(badHash, queryCase)).errors.some((item) => item.includes('SHA-256 mismatch')), 'tampered evidence rejected');
  const pathEscape = await shapedRun(queryCase, 'escape');
  pathEscape.run.artifacts.geometry.path = '../outside.json';
  check((await evaluate(pathEscape, queryCase)).errors.some((item) => item.includes('path must remain inside evidence directory')), 'path traversal rejected');
  const symlinkEscape = await shapedRun(queryCase, 'symlink');
  const external = path.join(os.tmpdir(), `outside-accessibility-${path.basename(root)}.json`);
  await fs.writeFile(external, '{}');
  try {
    await fs.symlink(external, path.join(root, 'escape-link.json'));
    symlinkEscape.run.artifacts.geometry = { path: 'escape-link.json', sha256: sha256('{}') };
    check((await evaluate(symlinkEscape, queryCase)).errors.some((item) => item.includes('symlink escapes evidence directory')), 'symlink escape rejected');
  } finally { await fs.unlink(external); }

  const negativeCase = SUITE.cases.find((item) => item.id === 'negative.uncertain_response');
  const negative = await shapedRun(negativeCase, 'negative');
  check((await evaluate(negative, negativeCase)).errors.length === 1, 'negative behavior has its own evidence contract');
  await fs.mkdir(path.join(root, 'runs'));
  await fs.writeFile(path.join(root, 'runs', 'positive.json'), JSON.stringify(shaped.run));
  await fs.writeFile(path.join(root, 'runs', 'negative.json'), JSON.stringify(negative.run));
  await fs.writeFile(path.join(root, 'runs', 'duplicate.json'), JSON.stringify(shaped.run));
  const aggregateResult = await aggregate({ config, freeze, evidenceRoot: root });
  check(aggregateResult.blockers.some((item) => item.startsWith('duplicate_case_run:')), 'duplicate reruns cannot cherry-pick a passing attempt');
  check(aggregateResult.models[0].baseline.positive.received === 1 && aggregateResult.models[0].baseline.negative.received === 1, 'negative runs never boost positive numerator or received count');
  check(!aggregateResult.cross_model_acceptance && aggregateResult.models.every((model) => !model.optimized_target_met), 'one model and offline fixtures cannot stand in for the three-model acceptance');
  const modifiedConfig = structuredClone(config); modifiedConfig.source_revision = 'new-source';
  check((await aggregate({ config: modifiedConfig, freeze, evidenceRoot: root })).blockers.includes('valid_pre_execution_freeze_required'), 'post-freeze configuration drift rejected');
  const holdout = await aggregate({ config, freeze, evidenceRoot: path.join(root, 'unseen'), split: 'release_holdout' });
  check(holdout.expected_run_count === 168 && !holdout.cross_model_acceptance && !holdout.release_holdout_acceptance, 'holdouts are independently reported and cannot masquerade as first-use acceptance');

  const definitions = GATEWAY_TOOLS.map((name) => ({ name, description: `Test-only ${name}`, inputSchema: name === 'start_agent_task' ? { type: 'object', required: ['intent'], properties: { intent: { type: 'string', enum: ['create_model', 'discover'] }, inputs: { type: 'object' } }, additionalProperties: false } : { type: 'object', properties: {}, additionalProperties: false } }));
  const loopLimits = { max_provider_requests: 3, max_tool_calls: 3, max_total_tokens: 500, max_output_tokens_per_request: 100, max_wall_seconds: 5 };
  let invokeCount = 0;
  let dispatchCount = 0;
  let firstRequest;
  const fakeProvider = { invoke: async (request) => {
    invokeCount += 1;
    if (invokeCount === 1) { firstRequest = request; return { model: 'TEST_ECHO', usage: { input_tokens: 10, output_tokens: 20 }, content: [{ type: 'tool_use', id: 'call-1', name: 'start_agent_task', input: { intent: 'discover' } }], stop_reason: 'tool_use' }; }
    return { model: 'TEST_ECHO', usage: { input_tokens: 20, output_tokens: 10 }, content: [{ type: 'text', text: 'Synthetic final claim.' }], stop_reason: 'end_turn' };
  } };
  const loop = await runModelLoop({ provider: fakeProvider, gateway: async () => { dispatchCount += 1; return { ok: true }; }, task: queryCase, definitions, outputDir: path.join(root, 'loop'), limits: loopLimits, testFixture: true });
  check(loop.outcome === 'model_finished' && invokeCount === 2 && dispatchCount === 1, 'provider-neutral loop performs real callback round trips');
  check(firstRequest.messages.length === 1 && firstRequest.messages[0].content === queryCase.prompt && !Object.hasOwn(firstRequest, 'system') && firstRequest.tools.length === 4, 'only user task and four public tool descriptions enter the first model request');
  check(loop.total_reported_tokens === 60 && !loop.live_runtime_acceptance && !loop.release_acceptance, 'loop derives usage while separating model claims from acceptance');
  const rawLoop = await fs.readFile(path.join(root, 'loop', 'events.jsonl'));
  const neutral = importTranscript({ events: parseEvents(rawLoop.toString('utf8')), rawBytes: rawLoop, tools: definitions, session: { run_id: loop.run_id, session_id: loop.run_id, initial_messages: [{ role: 'user', content: queryCase.prompt }] } });
  check(neutral.tool_calls.length === 1 && neutral.tool_calls[0].request_valid && !neutral.tool_calls[0].interface_misuse, 'tool validity and misuse are derived from raw events and frozen schemas');
  check(neutral.tool_calls[0].request_schema_valid && neutral.tool_calls[0].request_semantically_effective, 'a schema-valid call with an affirmative Gateway response records request progress');
  check(neutral.provider_response_model_id === null && neutral.import_blockers.includes('served_model_version_not_attested'), 'returned request echo is not silently upgraded to served-model attestation');
  check(neutral.corrections_by_part === null && neutral.human_interventions === null, 'unobserved repair and intervention counts remain unknown');
  const dry = dryRunPacket({ caseId: queryCase.id, route: 'optimized', tools: definitions });
  check(dry.model_visible.messages.length === 1 && dry.model_visible.tools.length === 4 && !dry.model_invoked, 'dry-run exports clean model-visible payload without calling a model');
  assert.throws(() => dryRunPacket({ caseId: queryCase.id, route: 'baseline', tools: definitions, sourceRevision: 'de7d482' }), /new intents/); assertions += 1;
  const baselineDefinitions = structuredClone(definitions); baselineDefinitions[0].inputSchema.properties.intent.enum = ['create_model'];
  const incompleteInputEvents = [
    { type: 'tool_call', call_id: 'missing-code', tool: 'start_agent_task', arguments: { intent: 'create_model', inputs: { model_spec: { kind: 'window' } } } },
    { type: 'tool_result', call_id: 'missing-code', result: { ok: true, task_state: 'awaiting_input', next_action: { action: 'submit_task_input', required: ['code'] } } },
    { type: 'generation_complete' }
  ];
  const incompleteInputTrace = importTranscript({ events: incompleteInputEvents, rawBytes: Buffer.from(JSON.stringify(incompleteInputEvents)), tools: baselineDefinitions, session: {}, route: 'baseline' });
  const missingCode = incompleteInputTrace.tool_calls[0];
  check(missingCode.request_valid === true && missingCode.request_schema_valid === true && missingCode.request_semantically_effective === false, 'baseline model_spec can be schema-valid while missing executable code');
  check(missingCode.request_semantic_reason === 'missing_required_input' && missingCode.request_missing_inputs.includes('code'), 'semantic rejection records the actual required code field');
  const responseCases = [
    [{ ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Creation requires JSON DSL.' } }, false, 'gateway_error_response'],
    [{ ok: true, code: 'MISSING_REQUIRED_INPUT' }, false, 'gateway_error_response'],
    [{ ok: true, result: { error: { code: 'INVALID_ARGUMENT' } } }, false, 'gateway_error_response'],
    [{ ok: true, missing_inputs: ['code'] }, false, 'missing_required_input'],
    [{ ok: true, result: { next_action: { required: ['code'] } } }, false, 'missing_required_input'],
    [{ ok: true, task_state: 'awaiting_input' }, false, 'awaiting_required_input'],
    [{ ok: true, result: { state: 'failed' } }, false, 'request_did_not_progress'],
    [undefined, null, 'response_not_observed'],
    [{ task_id: 'response-with-no-status' }, null, 'response_semantics_unknown'],
    [{ ok: true, result: { examples: [{ error: { code: 'INVALID_ARGUMENT' }, missing_inputs: ['code'] }] } }, true, 'gateway_confirmed_without_error_or_missing_input']
  ];
  for (const [result, effective, reason] of responseCases) {
    const classified = classifyRequestEffectiveness({ request_valid: true, result, request_semantically_effective: true });
    check(classified.semantically_effective === effective && classified.reason === reason, `response semantics: ${reason}`);
  }
  check(classifyRequestEffectiveness({ request_valid: false, result: { ok: true } }).semantically_effective === false, 'affirmative response cannot override rejected input schema');
  check(classifyRequestEffectiveness({ result: { ok: true } }).semantically_effective === null, 'unknown schema validity is not guessed from a response');
  const semanticShaped = await shapedRun(queryCase, 'semantic');
  semanticShaped.trace.tool_calls = [{ ...missingCode, request_semantically_effective: true }];
  semanticShaped.run.artifacts.transcript = await writeArtifact(semanticShaped.run.run_id, 'transcript', semanticShaped.trace);
  const semanticEvaluation = await evaluate(semanticShaped, queryCase);
  check(semanticEvaluation.metrics.first_request_schema_valid === true && semanticEvaluation.metrics.first_request_semantically_effective === false, 'scorer recomputes response semantics instead of trusting a claimed effective boolean');
  check(semanticEvaluation.status === 'invalid_evidence', 'request metrics do not turn synthetic fixtures into accepted live evidence');
  const metricRows = [false, true, null].map((effective, index) => ({ status: 'failed', case_id: `test-only-${index}`, metrics: {
    first_request_schema_valid: true, first_request_semantically_effective: effective,
    interface_misuses: 0, correction_rounds: 0, tool_calls: 1, model_cost: 0, live_seconds: 0,
    human_interventions: { design_clarifications: 0, manual_rescues: 0, system_unlocks: 0, human_tutorials: 0 }
  } }));
  const metricSummary = summarizeRuns(metricRows, 3);
  check(metricSummary.first_schema_valid_request_rate === 1 && metricSummary.first_semantically_effective_request_rate === 0.5 && metricSummary.first_effective_request_rate === 0.5, 'schema-only validity cannot inflate the effective-request rate');
  check(metricSummary.first_semantically_effective_request_observed_runs === 2 && metricSummary.first_semantically_effective_request_unknown_runs === 1, 'unknown response semantics remain explicitly outside the observed denominator');
  check(metricSummary.fixed_set_completion_rate === 0 && empty.request_metric_definitions.version === 'schema-and-response-semantics.v2', 'metric clarification preserves the fixed task-completion criterion');
  invokeCount = 0; dispatchCount = 0;
  const baselineLoop = await runModelLoop({ provider: fakeProvider, gateway: async () => { dispatchCount += 1; return {}; }, task: queryCase, definitions: baselineDefinitions, outputDir: path.join(root, 'baseline-loop'), route: 'baseline', sourceRevision: 'de7d482', limits: loopLimits, testFixture: true });
  check(baselineLoop.outcome === 'model_finished' && dispatchCount === 0, 'optimized intents cannot pass baseline dispatch');
  const baselineRaw = await fs.readFile(path.join(root, 'baseline-loop', 'events.jsonl'));
  const baselineTrace = importTranscript({ events: parseEvents(baselineRaw.toString('utf8')), rawBytes: baselineRaw, tools: baselineDefinitions, session: {}, route: 'baseline' });
  check(baselineTrace.tool_calls[0].interface_misuse, 'baseline misuse is visible rather than hidden behind server correction');
  invokeCount = 0; dispatchCount = 0;
  const uncertainLoop = await runModelLoop({ provider: fakeProvider, gateway: async () => { dispatchCount += 1; throw new Error('Synthetic lost response after dispatch'); }, task: queryCase, definitions, outputDir: path.join(root, 'uncertain-loop'), limits: loopLimits, testFixture: true });
  check(uncertainLoop.outcome === 'gateway_response_uncertain' && dispatchCount === 1 && invokeCount === 1, 'uncertain mutation is checkpointed and never automatically retried');
  invokeCount = 0; dispatchCount = 0;
  const boundedLoop = await runModelLoop({ provider: fakeProvider, gateway: async () => { dispatchCount += 1; return {}; }, task: queryCase, definitions, outputDir: path.join(root, 'bounded-loop'), limits: { ...loopLimits, max_total_tokens: 25 }, testFixture: true });
  check(boundedLoop.outcome === 'token_limit' && dispatchCount === 0, 'reported budget exhaustion stops before tool dispatch');

  process.stdout.write(`${assertions} model-accessibility benchmark offline contract assertions passed; model calls=0; live queue calls=0; release_acceptance=false\n`);
} finally { await fs.rm(root, { recursive: true, force: true }); }
