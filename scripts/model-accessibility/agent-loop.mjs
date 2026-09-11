#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { SUITE } from '../../benchmarks/model-accessibility/suite.mjs';
import { objectHash, sha256 } from './benchmark.mjs';

export const GATEWAY_TOOLS = ['start_agent_task', 'resume_agent_task', 'submit_agent_task_input', 'read_agent_artifact'];

export function validateLoopDefinitions(definitions, route) {
  if (!Array.isArray(definitions) || definitions.length !== 4 || new Set(definitions.map((item) => item.name)).size !== 4 || !GATEWAY_TOOLS.every((name) => definitions.some((tool) => tool.name === name))) throw new Error('Exactly the four public Gateway tool definitions are required');
  if (!['baseline', 'optimized'].includes(route)) throw new Error('Expected baseline or optimized route');
  const start = definitions.find((tool) => tool.name === 'start_agent_task');
  if (route === 'baseline' && start.inputSchema?.properties?.intent?.enum?.some((intent) => ['discover', 'preflight_model'].includes(intent))) throw new Error('Baseline tool descriptions expose optimized intents');
  return definitions;
}

function plainResult(value) {
  // Canonical JSON round trip avoids giving the model private in-memory object state.
  return JSON.parse(JSON.stringify(value));
}

export async function runModelLoop({ provider, gateway, waitForApproval, task, definitions, outputDir, route = 'optimized', requestedModel, sourceRevision, limits, testFixture = false, signal }) {
  validateLoopDefinitions(definitions, route);
  if (route === 'baseline' && !sourceRevision?.startsWith('de7d482')) throw new Error('Baseline descriptions must be pinned to de7d482');
  if (!task?.id || typeof task.prompt !== 'string') throw new Error('A fixed case and user prompt are required');
  for (const key of ['max_provider_requests', 'max_tool_calls', 'max_total_tokens', 'max_output_tokens_per_request', 'max_wall_seconds']) {
    if (!Number.isSafeInteger(limits?.[key]) || limits[key] <= 0) throw new Error(`Positive explicit ${key} is required`);
  }
  if (typeof provider?.invoke !== 'function' || typeof gateway !== 'function') throw new Error('Provider.invoke and gateway functions are required');
  if (waitForApproval !== undefined && typeof waitForApproval !== 'function') throw new Error('waitForApproval must be a host-only function.');
  const approvalWaitMs = (limits.approval_wait_seconds ?? 600) * 1000;
  if (!Number.isSafeInteger(approvalWaitMs) || approvalWaitMs < 1 || approvalWaitMs > 900_000) throw new Error('approval_wait_seconds must be positive and at most 900.');
  // Create-new run directory: never reuse a context or overwrite earlier attempts.
  await fs.mkdir(outputDir, { recursive: false });
  const runId = crypto.randomUUID();
  const began = Date.now();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason ?? new Error('Run cancelled'));
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const deadline = setTimeout(() => controller.abort(new Error('Run wall-time limit reached')), limits.max_wall_seconds * 1000);
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validators = new Map(definitions.map((tool) => [tool.name, ajv.compile(tool.inputSchema)]));
  const anthropicTools = definitions.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }));
  const messages = [{ role: 'user', content: task.prompt }];
  const rawPath = path.join(outputDir, 'events.jsonl');
  await fs.writeFile(rawPath, '', { flag: 'wx' });
  const emit = async (event) => { await fs.appendFile(rawPath, `${JSON.stringify({ ...event, recorded_at: new Date().toISOString() })}\n`); };
  const toolIds = new Set();
  const servedModels = new Set();
  const observedUnlocks = new Set();
  let approvalPauseCount = 0;
  let approvalWaitSeconds = 0;
  let requests = 0;
  let calls = 0;
  let tokens = 0;
  let tokensComplete = true;
  let outcome = 'not_started';
  let finalText = '';
  let error = null;
  let errorDetails = null;
  await fs.writeFile(path.join(outputDir, 'model-input.json'), JSON.stringify({ messages, tools: definitions }, null, 2), { flag: 'wx' });
  await emit({ type: 'session_start', run_id: runId, case_id: task.id, requested_model: requestedModel, interface_path: route, source_revision: sourceRevision, test_fixture: testFixture, prompt_sha256: sha256(task.prompt), tool_descriptions_sha256: objectHash(definitions), limits });
  try {
    for (let turn = 0; turn < limits.max_provider_requests; turn += 1) {
      controller.signal.throwIfAborted();
      if (tokens >= limits.max_total_tokens) { outcome = 'token_limit'; break; }
      const request = { messages: plainResult(messages), tools: anthropicTools, maxTokens: Math.min(limits.max_output_tokens_per_request, limits.max_total_tokens - tokens), signal: controller.signal };
      await emit({ type: 'provider_request', request_index: requests, body: { messages: request.messages, tools: request.tools, max_tokens: request.maxTokens } });
      requests += 1;
      const response = await provider.invoke(request);
      controller.signal.throwIfAborted();
      await emit({ type: 'provider_response', request_index: requests - 1, response });
      if (typeof response.model === 'string') servedModels.add(response.model);
      const usage = response.usage;
      if (Number.isSafeInteger(usage?.input_tokens) && usage.input_tokens >= 0 && Number.isSafeInteger(usage?.output_tokens) && usage.output_tokens >= 0) {
        const cached = (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
        const cacheKnown = Number.isSafeInteger(cached) && cached >= 0;
        tokens += usage.input_tokens + usage.output_tokens + (cacheKnown ? cached : 0);
        await emit({ type: 'usage', request_index: requests - 1, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0, cache_read_input_tokens: usage.cache_read_input_tokens ?? 0, raw_usage: usage });
        if (!cacheKnown) tokensComplete = false;
      } else tokensComplete = false;
      if (!Array.isArray(response.content)) { outcome = 'invalid_provider_response'; break; }
      const assistantContent = plainResult(response.content);
      messages.push({ role: 'assistant', content: assistantContent });
      const toolUses = assistantContent.filter((part) => part.type === 'tool_use');
      if (toolUses.length === 0) {
        finalText = assistantContent.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
        outcome = response.stop_reason === 'max_tokens' ? 'output_token_limit' : 'model_finished';
        await emit({ type: 'generation_complete', stop_reason: response.stop_reason ?? null, model_claim: finalText });
        break;
      }
      if (!tokensComplete) { outcome = 'usage_unavailable_before_next_dispatch'; break; }
      if (tokens >= limits.max_total_tokens) { outcome = 'token_limit'; break; }
      const results = [];
      const approvals = new Map();
      for (const use of toolUses) {
        controller.signal.throwIfAborted();
        if (calls >= limits.max_tool_calls) { outcome = 'tool_call_limit'; break; }
        if (!use.id || toolIds.has(use.id)) { outcome = 'duplicate_or_missing_tool_call_id'; break; }
        toolIds.add(use.id);
        calls += 1;
        const validate = validators.get(use.name);
        const validSchema = !!validate && validate(use.input) === true;
        const baselineViolation = route === 'baseline' && (['discover', 'preflight_model'].includes(use.input?.intent) || Object.hasOwn(use.input?.inputs ?? {}, 'task'));
        await emit({ type: 'tool_call', call_id: use.id, tool: use.name, arguments: use.input, request_valid: validSchema && !baselineViolation });
        let result;
        if (!validSchema || baselineViolation) {
          result = { ok: false, error: { code: 'INVALID_ARGUMENT', message: baselineViolation ? 'This requested capability is not exposed by the baseline tool contract.' : 'Request does not match the public Gateway tool schema.', details: validate?.errors ?? [] } };
        } else if (approvals.size > 0) {
          result = { ok: false, execution_started: false, error: { code: 'APPROVAL_REQUIRED', message: 'A prior call in this turn awaits local user approval. This later call was not dispatched; inspect the same task after the host status changes.' } };
          await emit({ type: 'tool_dispatch_held', call_id: use.id, reason: 'prior_call_awaiting_approval', execution_started: false });
        } else {
          try { result = plainResult(await gateway(use.name, use.input, { signal: controller.signal, runId, callId: use.id })); }
          catch (cause) {
            // The dispatch may have mutated SketchUp before its response was lost.
            // Persist uncertainty and stop; never repeat it from the runner.
            await emit({ type: 'execution_uncertain', call_id: use.id, message: cause.message });
            outcome = 'gateway_response_uncertain';
            throw cause;
          }
        }
        await emit({ type: 'tool_result', call_id: use.id, result });
        results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(result) });
        const approval = pendingApproval(result);
        if (approval) approvals.set(approval.task_id, { ...approval, call_id: use.id });
      }
      if (['tool_call_limit', 'duplicate_or_missing_tool_call_id'].includes(outcome)) break;
      messages.push({ role: 'user', content: results });
      // Human approval is a host unlock, not another model request or an apply
      // performed by the runner. Keep exactly this conversation and all budgets.
      for (const approval of approvals.values()) {
        approvalPauseCount++;
        const paused = Date.now();
        const record = { kind: 'model_accessibility_approval_pause', run_id: runId, ...approval,
          pause_index: approvalPauseCount, provider_request_count: requests, tool_call_count: calls,
          conversation_sha256: objectHash(messages), messages: plainResult(messages),
          continuation: 'Keep this process alive. A verified host decision resumes this same conversation; the model chooses its own Gateway calls.',
          cross_process_resume_supported: false, mutation_performed_by_runner: false };
        await fs.writeFile(path.join(outputDir, `approval-pause-${approvalPauseCount}.json`), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        await emit({ type: 'approval_pause', ...approval, pause_index: approvalPauseCount, conversation_sha256: record.conversation_sha256 });
        if (!waitForApproval) { outcome = 'awaiting_approval_host'; break; }
        let decision;
        try { decision = await waitForApproval({ taskId: approval.task_id, signal: controller.signal, timeoutMs: approvalWaitMs }); }
        finally { approvalWaitSeconds += (Date.now() - paused) / 1000; }
        controller.signal.throwIfAborted();
        // Whitelist status fields: never send an issuer token, credentials,
        // arbitrary callback text, design hint or task answer to the model.
        const valid = decision?.task_id === approval.task_id && decision.status === 'approved'
          && decision.approval_status === 'approved_pending_execution' && typeof decision.decision_id === 'string'
          && typeof decision.challenge_id === 'string' && (!approval.challenge_id || decision.challenge_id === approval.challenge_id);
        await emit({ type: 'approval_wait_result', task_id: approval.task_id, status: valid ? 'approved' : decision?.status || 'invalid', code: decision?.code || null });
        if (!valid) {
          outcome = decision?.status === 'timeout' ? 'awaiting_approval_timeout'
            : ['rejected', 'expired', 'blocked'].includes(decision?.status) ? `approval_${decision.status}` : 'approval_status_invalid';
          break;
        }
        const key = `${approval.task_id}:${decision.challenge_id}:${decision.decision_id}`;
        if (!observedUnlocks.has(key)) {
          observedUnlocks.add(key);
          await emit({ type: 'human_intervention', kind: 'system_unlocks', task_id: approval.task_id,
            challenge_id: decision.challenge_id, decision_id: decision.decision_id, source: 'verified_local_approval_readiness',
            test_fixture: testFixture, design_clarification: false, manual_rescue: false, human_tutorial: false });
          messages.at(-1).content.push({ type: 'text', text: JSON.stringify({ kind: 'host_approval_status', task_id: approval.task_id,
            approval_status: 'approved_pending_execution', next_step: 'Resume this same task to read its current Gateway next_action. The host has not executed the edit.' }) });
        }
        await emit({ type: 'approval_resume', task_id: approval.task_id, run_id: runId, conversation_sha256: objectHash(messages), model_context_replaced: false, mutation_performed_by_runner: false });
      }
      if (/^(awaiting_approval_|approval_)/.test(outcome)) break;
      outcome = 'provider_request_limit';
    }
  } catch (cause) {
    error = cause.message;
    errorDetails = cause.details ?? null;
    if (outcome !== 'gateway_response_uncertain') outcome = controller.signal.aborted ? 'cancelled_or_wall_time_limit' : 'provider_or_runtime_error';
    await emit({ type: 'run_error', outcome, message: error, details: errorDetails });
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', abort);
  }
  const raw = await fs.readFile(rawPath);
  const summary = {
    schema_version: 'model-accessibility-loop.v1', run_id: runId, case_id: task.id, test_fixture: testFixture,
    interface_path: route, outcome, error, error_details: errorDetails, requested_model: requestedModel ?? null, response_model_ids: [...servedModels],
    provider_request_count: requests, tool_call_count: calls, total_reported_tokens: tokensComplete ? tokens : null,
    usage_complete: tokensComplete, wall_time_seconds: (Date.now() - began) / 1000,
    approval_pause_count: approvalPauseCount, approval_wait_seconds: approvalWaitSeconds,
    observed_system_unlocks: observedUnlocks.size, system_unlock_source: 'verified_local_approval_readiness',
    raw_events: { path: 'events.jsonl', sha256: sha256(raw) }, model_claim: finalText,
    independent_quality_assessment: 'missing', live_runtime_acceptance: false, release_acceptance: false,
    boundaries: ['A finished model turn is not a completed modeling task.', 'Response model IDs are preserved as returned by the provider; backend-version certainty requires provider attestation.', 'Native geometry, closeups, edit boundaries and delivered files require independent assessment.', 'Requested token limits bound replies and future dispatch; the provider may also charge for input/cache tokens.']
  };
  await fs.writeFile(path.join(outputDir, 'run-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
  return summary;
}

function pendingApproval(result) {
  if (!/^task_[0-9a-f-]+$/i.test(result?.task_id || '') || result.task_state !== 'awaiting_review'
    || result.next_action?.action !== 'request_user_approval') return null;
  return { task_id: result.task_id,
    challenge_id: result.next_action.approval_host?.challenge_id || result.next_action.challenge_id || result.next_action.challenge?.challenge_id || result.result?.approval_challenge?.challenge_id || null,
    approval_url: result.next_action.approval_host?.url || result.next_action.approval_url || null };
}

async function main() {
  const options = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith('--') || !args[i + 1]) throw new Error(`Invalid argument: ${args[i]}`);
    options[args[i].slice(2)] = args[i + 1];
  }
  for (const key of ['case', 'tools', 'output-dir', 'provider-config', 'gateway-module', 'limits']) if (!options[key]) throw new Error(`Missing --${key}`);
  const read = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
  const task = SUITE.cases.find((item) => item.id === options.case);
  if (!task) throw new Error(`Unknown fixed case: ${options.case}`);
  const { createAlmaProvider } = await import('./alma-provider.mjs');
  const providerConfig = await read(options['provider-config']);
  if (providerConfig.existing_subscription_authorized !== true || providerConfig.incremental_cost_cap !== 0) throw new Error('This runner requires explicit authorization for existing included subscription only, with incremental cost cap 0');
  const provider = createAlmaProvider(providerConfig);
  const adapter = await import(pathToFileURL(path.resolve(options['gateway-module'])).href);
  const tools = await read(options.tools);
  const summary = await runModelLoop({ provider, gateway: adapter.callGateway, waitForApproval: adapter.waitForApproval, task, definitions: Array.isArray(tools) ? tools : tools.tools, outputDir: path.resolve(options['output-dir']), route: options.path ?? 'optimized', requestedModel: providerConfig.model, sourceRevision: options['source-revision'], limits: await read(options.limits) });
  process.stdout.write(`${JSON.stringify({ output: path.resolve(options['output-dir']), outcome: summary.outcome, calls: summary.tool_call_count, tokens: summary.total_reported_tokens, release_acceptance: false })}\n`);
  if (summary.outcome !== 'model_finished') process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
