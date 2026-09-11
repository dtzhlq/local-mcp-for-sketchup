#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { SUITE } from '../../benchmarks/model-accessibility/suite.mjs';
import { classifyRequestEffectiveness, objectHash, sha256 } from './benchmark.mjs';

const GATEWAY = ['start_agent_task', 'resume_agent_task', 'submit_agent_task_input', 'read_agent_artifact'];
const MISUSE_CODES = new Set(['INVALID_ARGUMENT', 'INVALID_ARGUMENTS', 'UNKNOWN_TOOL', 'SCHEMA_VALIDATION_FAILED', 'INVALID_TOOL_ARGUMENTS']);

export function parseEvents(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) return JSON.parse(trimmed);
  return trimmed.split('\n').filter((line) => line.trim()).map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`Invalid raw event JSON at line ${index + 1}`); }
  });
}

function almaEvents(events, threadId, blockers) {
  const calls = new Map();
  let finished = false;
  for (const [eventIndex, envelope] of events.entries()) {
    const event = envelope.event ?? envelope;
    const payload = event.data;
    if (payload?.threadId !== threadId && payload?.id !== threadId) continue;
    if (['memory_retrieval_progress', 'skill_analysis_progress'].includes(event.type)) blockers.push(`alma_context_contamination:${event.type}`);
    if (event.type === 'generation_error') blockers.push(`generation_error:${payload.error ?? 'unknown'}`);
    if (event.type === 'thread_generating' && payload.isGenerating === false) finished = true;
    if (event.type !== 'message_delta') continue;
    for (const delta of payload.deltas ?? []) {
      const message = payload.messageId ?? payload.message?.id;
      if (message === undefined || delta.partIndex === undefined) { if (delta.part?.type?.startsWith('tool-') || delta.type === 'tool_output_set') blockers.push('alma_tool_event_missing_message_or_part_identity'); continue; }
      const key = `${message}/${delta.partIndex}`;
      if (delta.type === 'part_add' && delta.part?.type?.startsWith('tool-')) {
        const part = delta.part;
        const tool = part.type === 'tool-invocation' ? part.toolName : part.type.slice(5);
        if (calls.has(key)) { blockers.push(`duplicate_tool_part:${key}`); continue; }
        calls.set(key, { call_id: part.toolCallId ?? key, tool, arguments: part.input ?? part.args ?? null, result: part.output, raw_event_indices: [eventIndex] });
      } else if (delta.type === 'tool_output_set') {
        const call = calls.get(key);
        if (!call) { blockers.push(`tool_result_without_call:${key}`); continue; }
        call.result = delta.state === 'output-error' ? { error: { code: 'TRANSPORT_TOOL_ERROR', message: delta.errorText } } : delta.output;
        call.raw_event_indices.push(eventIndex);
      }
    }
  }
  if (!finished) blockers.push('alma_generation_completion_not_observed');
  return [...calls.values()];
}

function neutralEvents(events, blockers) {
  const calls = new Map();
  for (const [index, event] of events.entries()) {
    if (event.type === 'tool_call') {
      if (!event.call_id || calls.has(event.call_id)) { blockers.push('duplicate_or_missing_tool_call_id'); continue; }
      calls.set(event.call_id, { call_id: event.call_id, tool: event.tool, arguments: event.arguments, raw_event_indices: [index] });
    } else if (event.type === 'tool_result') {
      const call = calls.get(event.call_id);
      if (!call || call.result !== undefined) { blockers.push('orphan_or_duplicate_tool_result'); continue; }
      call.result = event.result;
      call.raw_event_indices.push(index);
    }
  }
  if (!events.some((event) => event.type === 'generation_complete')) blockers.push('generation_completion_not_observed');
  return [...calls.values()];
}

export function importTranscript({ events, rawBytes, session, tools, format = 'neutral', route = 'optimized' }) {
  const blockers = [];
  const definitions = Array.isArray(tools) ? tools : tools.tools;
  if (!Array.isArray(definitions) || definitions.length !== 4 || !GATEWAY.every((name) => definitions.some((tool) => tool.name === name))) throw new Error('Exactly the four public Agent Gateway tool definitions are required');
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validators = new Map(definitions.map((tool) => [tool.name, ajv.compile(tool.inputSchema)]));
  const aliases = session.tool_name_map ?? {};
  if (Object.values(aliases).some((value) => !GATEWAY.includes(value))) throw new Error('Tool aliases may only map to the four public Gateway tools');
  const calls = format === 'alma' ? almaEvents(events, session.thread_id, blockers) : format === 'neutral' ? neutralEvents(events, blockers) : null;
  if (!calls) throw new Error(`Unknown transcript format: ${format}`);
  for (const call of calls) {
    const actualTool = aliases[call.tool] ?? call.tool;
    const validate = validators.get(actualTool);
    call.exposed_tool = call.tool;
    call.tool = actualTool;
    call.request_valid = !!validate && validate(call.arguments) === true;
    const baselineViolation = route === 'baseline' && (['discover', 'preflight_model'].includes(call.arguments?.intent) || Object.hasOwn(call.arguments?.inputs ?? {}, 'task'));
    if (baselineViolation) call.request_valid = false;
    call.interface_misuse = !call.request_valid || MISUSE_CODES.has(call.result?.error?.code) || MISUSE_CODES.has(call.result?.code);
    const effectiveness = classifyRequestEffectiveness(call);
    call.request_schema_valid = effectiveness.schema_valid;
    call.request_semantically_effective = effectiveness.semantically_effective;
    call.request_semantic_reason = effectiveness.reason;
    call.request_missing_inputs = effectiveness.missing_inputs;
    call.schema_errors = validate?.errors ? structuredClone(validate.errors) : [];
    if (call.arguments === undefined || call.arguments === null || call.result === undefined) blockers.push(`incomplete_raw_tool_call:${call.call_id}`);
    if (!validate) blockers.push(`non_gateway_tool_used:${call.exposed_tool}`);
  }
  if (calls.length === 0) blockers.push('no_observed_tool_calls');
  const isolation = session.isolation_attestation;
  const verified = isolation?.verified === true && typeof isolation?.evidence_sha256 === 'string' && /^[0-9a-f]{64}$/.test(isolation.evidence_sha256) && typeof isolation.verified_by === 'string';
  if (!verified) blockers.push('independent_context_isolation_not_attested');
  const repairEvents = events.filter((event) => event.type === 'automatic_repair');
  let corrections = null;
  if (session.complete_repair_event_capture === true) {
    corrections = {};
    for (const event of repairEvents) {
      if (typeof event.part_id !== 'string' || !calls.some((call) => call.call_id === event.call_id)) { blockers.push('unbound_automatic_repair_event'); continue; }
      corrections[event.part_id] = (corrections[event.part_id] ?? 0) + 1;
    }
  } else blockers.push('complete_repair_event_capture_not_attested');
  let human = null;
  if (session.complete_intervention_event_capture === true) {
    human = { design_clarifications: 0, manual_rescues: 0, system_unlocks: 0, human_tutorials: 0 };
    for (const event of events.filter((event) => event.type === 'human_intervention')) {
      if (!Object.hasOwn(human, event.kind)) blockers.push('unknown_human_intervention');
      else human[event.kind] += 1;
    }
  } else blockers.push('complete_intervention_event_capture_not_attested');
  if (!session.provider_response_model_id) blockers.push('served_model_version_not_attested');
  const initial = session.initial_messages;
  if (!Array.isArray(initial) || initial.length !== 1 || initial[0].role !== 'user') blockers.push('only_one_initial_user_message_required');
  const usageEvents = events.filter((event) => event.type === 'usage' && Number.isSafeInteger(event.input_tokens) && Number.isSafeInteger(event.output_tokens));
  return {
    schema_version: 'model-accessibility-trace.v1', producer: 'independent_collector',
    run_id: session.run_id, model_identity: session.model_identity,
    provider_response_model_id: session.provider_response_model_id ?? null,
    source: { format, raw_sha256: sha256(rawBytes), tool_descriptions_sha256: objectHash(definitions), session_metadata_sha256: objectHash(session) },
    context: {
      fresh: verified ? isolation.fresh : null,
      session_id: session.thread_id ?? session.session_id ?? null,
      repository_access: verified ? isolation.repository_access : null,
      hidden_answers: verified ? isolation.hidden_answers : null,
      human_tutorial: verified ? isolation.human_tutorial : null,
      prior_conversation: verified ? isolation.prior_conversation : null,
      initial_messages: initial ?? null,
      prompt_sha256: initial?.[0]?.content ? sha256(initial[0].content) : null,
      mcp_description_sha256: objectHash(definitions)
    },
    tool_calls: calls, corrections_by_part: corrections, human_interventions: human,
    usage: usageEvents.length ? { input_tokens: usageEvents.reduce((sum, event) => sum + event.input_tokens, 0), output_tokens: usageEvents.reduce((sum, event) => sum + event.output_tokens, 0) } : null,
    import_blockers: [...new Set(blockers)],
    metrics_derived_from_raw_events: true,
    limitation: 'Alma full-pipeline events do not by themselves attest context isolation, served model version, tokens, all repair events or human interventions. Missing metadata is preserved as unknown.'
  };
}

export function dryRunPacket({ caseId, route, tools, requestedModel, sourceRevision }) {
  const testCase = SUITE.cases.find((item) => item.id === caseId);
  if (!testCase) throw new Error(`Unknown case: ${caseId}`);
  if (!SUITE.paths.includes(route)) throw new Error(`Unknown interface path: ${route}`);
  const definitions = Array.isArray(tools) ? tools : tools.tools;
  if (!Array.isArray(definitions) || definitions.length !== 4 || !GATEWAY.every((name) => definitions.some((tool) => tool.name === name))) throw new Error('Dry-run requires exactly four public Gateway definitions');
  if (route === 'baseline' && sourceRevision !== 'de7d482' && !sourceRevision?.startsWith('de7d482')) throw new Error('Baseline description snapshot must come from de7d482');
  const start = definitions.find((tool) => tool.name === 'start_agent_task');
  if (route === 'baseline' && start.inputSchema?.properties?.intent?.enum?.some((value) => ['discover', 'preflight_model'].includes(value))) throw new Error('Baseline snapshot exposes new intents');
  return {
    schema_version: 'model-accessibility-dry-run.v1', dry_run: true, model_invoked: false, live_queue_invoked: false,
    case_id: caseId, interface_path: route, suite_sha256: objectHash(SUITE),
    requested_model: requestedModel ?? null, source_revision: sourceRevision ?? null,
    model_visible: { messages: [{ role: 'user', content: testCase.prompt }], tools: definitions },
    mcp_description_sha256: objectHash(definitions),
    collector_only: {
      transport: 'Alma local provider proxy with explicit context only',
      endpoint_template: '/anthropic-proxy/<verified-provider-id>/v1/messages',
      request_template: { model: requestedModel ?? '<configured-model-id>', max_tokens: '<explicit-run-limit>', stream: false, messages: [{ role: 'user', content: testCase.prompt }], tools: definitions.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })) },
      retain_raw_events: true,
      execution_blockers: ['bind the live fixture and execution authorization', 'configure the exact local proxy origin and provider id', 'capture actual served model version and usage'],
      note: 'The provider proxy skips Alma chat memory/SOUL/skills and executes no tools itself. The separate agent-loop dispatches only the four allowed Gateway tools. This artifact is a reviewable dry-run, not an acceptance result.'
    }
  };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith('--') || !args[i + 1]) throw new Error(`Incomplete argument: ${args[i]}`);
    options[args[i].slice(2)] = args[i + 1];
  }
  if (!options.tools || !options.output) throw new Error('--tools and new --output are required');
  const definitions = JSON.parse(await fs.readFile(options.tools, 'utf8'));
  let result;
  if (command === 'dry-run') result = dryRunPacket({ caseId: options.case, route: options.path ?? 'optimized', tools: definitions, requestedModel: options.model, sourceRevision: options['source-revision'] });
  else if (command === 'import') {
    if (!options.events || !options.session) throw new Error('import requires --events and --session');
    const raw = await fs.readFile(options.events);
    result = importTranscript({ events: parseEvents(raw.toString('utf8')), rawBytes: raw, session: JSON.parse(await fs.readFile(options.session, 'utf8')), tools: definitions, format: options.format ?? 'neutral', route: options.path ?? 'optimized' });
  } else throw new Error('Expected dry-run or import');
  await fs.mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
  await fs.writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ output: path.resolve(options.output), model_invoked: false, import_blockers: result.import_blockers ?? [], dry_run: result.dry_run ?? false })}\n`);
  if (result.import_blockers?.length) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
