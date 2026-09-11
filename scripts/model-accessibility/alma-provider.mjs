import crypto from 'node:crypto';

// This uses Alma's installed provider proxy, not its chat-thread pipeline.
// Authentication stays inside Alma. Importing/constructing this module never
// reads settings, credentials, memories or conversations and never calls a model.
export const ALMA_PROVIDER_TRANSPORT_VERSION = 'alma-provider-transport.v1';

export class AlmaProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AlmaProviderError';
    this.code = code;
    this.details = details;
    this.retrySafe = false;
  }
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validText = value => typeof value === 'string' && value.length > 0;

export function almaMessagesEndpoint({ baseUrl, providerId } = {}) {
  if (!validText(baseUrl)) throw new AlmaProviderError('INVALID_CONFIG', 'An explicitly verified Alma baseUrl is required.');
  let url;
  try { url = new URL(baseUrl); } catch { throw new AlmaProviderError('INVALID_CONFIG', 'Alma baseUrl must be a URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new AlmaProviderError('INVALID_CONFIG', 'Use the verified loopback Alma origin without credentials, path, query or fragment.');
  }
  if (typeof providerId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/.test(providerId)) {
    throw new AlmaProviderError('INVALID_CONFIG', 'providerId must be the exact public Alma provider id.');
  }
  return `${url.origin}/anthropic-proxy/${encodeURIComponent(providerId)}/v1/messages`;
}

function validateMessageBody(body) {
  if (!isObject(body)) throw new AlmaProviderError('INVALID_REQUEST', 'An Anthropic Messages request object is required.');
  const allowed = new Set(['model', 'messages', 'max_tokens', 'system', 'metadata', 'stop_sequences', 'stream', 'temperature', 'top_p', 'top_k', 'tools', 'tool_choice']);
  for (const key of Object.keys(body)) if (!allowed.has(key)) throw new AlmaProviderError('INVALID_REQUEST', `Unsupported request field: ${key}.`);
  if (!validText(body.model)) throw new AlmaProviderError('INVALID_REQUEST', 'An explicit model id is required.');
  if (!Number.isSafeInteger(body.max_tokens) || body.max_tokens < 1) throw new AlmaProviderError('INVALID_REQUEST', 'max_tokens must be a positive integer.');
  if (body.stream !== undefined && body.stream !== false) throw new AlmaProviderError('INVALID_REQUEST', 'This transport preserves non-streaming raw JSON; stream must be false.');
  if (!Array.isArray(body.messages) || body.messages.length === 0) throw new AlmaProviderError('INVALID_REQUEST', 'messages must contain a fresh, explicitly supplied conversation.');
  for (const [index, message] of body.messages.entries()) {
    if (!isObject(message) || !['user', 'assistant'].includes(message.role)) throw new AlmaProviderError('INVALID_REQUEST', `messages[${index}] requires user or assistant role.`);
    if (typeof message.content !== 'string' && !Array.isArray(message.content)) throw new AlmaProviderError('INVALID_REQUEST', `messages[${index}].content must be text or Anthropic content blocks.`);
    if (Array.isArray(message.content)) for (const block of message.content) {
      if (!isObject(block) || !['text', 'image', 'tool_use', 'tool_result'].includes(block.type)) throw new AlmaProviderError('INVALID_REQUEST', `messages[${index}] contains an unsupported content block.`);
      if (block.type === 'text' && typeof block.text !== 'string') throw new AlmaProviderError('INVALID_REQUEST', 'text blocks require text.');
      if (block.type === 'tool_use' && (!validText(block.id) || !validText(block.name) || !isObject(block.input))) throw new AlmaProviderError('INVALID_REQUEST', 'tool_use blocks require id, name and object input.');
      if (block.type === 'tool_result' && !validText(block.tool_use_id)) throw new AlmaProviderError('INVALID_REQUEST', 'tool_result blocks require tool_use_id.');
    }
  }
  if (body.system !== undefined && typeof body.system !== 'string' && !(Array.isArray(body.system) && body.system.every(block => isObject(block) && block.type === 'text' && typeof block.text === 'string'))) {
    throw new AlmaProviderError('INVALID_REQUEST', 'system must be explicitly supplied text or text blocks.');
  }
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools)) throw new AlmaProviderError('INVALID_REQUEST', 'tools must be an explicit Anthropic tool array.');
    const names = new Set();
    for (const tool of body.tools) {
      if (!isObject(tool) || !validText(tool.name) || !isObject(tool.input_schema) || names.has(tool.name)) throw new AlmaProviderError('INVALID_REQUEST', 'Each tool requires a unique name and input_schema.');
      names.add(tool.name);
    }
  }
  for (const key of ['temperature', 'top_p']) if (body[key] !== undefined && (!Number.isFinite(body[key]) || body[key] < 0 || body[key] > 1)) throw new AlmaProviderError('INVALID_REQUEST', `${key} must be in [0, 1] for this installed Alma proxy.`);
  if (body.top_k !== undefined && (!Number.isSafeInteger(body.top_k) || body.top_k < 0)) throw new AlmaProviderError('INVALID_REQUEST', 'top_k must be a nonnegative integer.');
}

function serializableBody(body) {
  validateMessageBody(body);
  let json;
  try {
    json = JSON.stringify({ ...body, stream: false }, (_key, value) => {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('non-finite');
      if (typeof value === 'function' || typeof value === 'bigint' || typeof value === 'symbol') throw new Error('not-json');
      return value;
    });
  } catch { throw new AlmaProviderError('INVALID_REQUEST', 'The request must contain finite, serializable JSON data.'); }
  return json;
}

async function responseText(response, maximum, abortController) {
  const announced = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(announced) && announced > maximum) {
    abortController.abort();
    throw new AlmaProviderError('RESPONSE_TOO_LARGE', 'Alma response exceeds the configured byte limit.');
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maximum) throw new AlmaProviderError('RESPONSE_TOO_LARGE', 'Alma response exceeds the configured byte limit.');
    return text;
  }
  const reader = response.body.getReader(), chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) {
        await reader.cancel();
        abortController.abort();
        throw new AlmaProviderError('RESPONSE_TOO_LARGE', 'Alma response exceeds the configured byte limit.');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, bytes).toString('utf8');
  } finally { reader.releaseLock(); }
}

/**
 * One local HTTP request; no automatic retries and no tool execution.
 * Abort/timeout stops the client wait. Alma 0.4.22 does not forward this signal
 * to its upstream provider, so upstream generation/cost may remain unknown.
 */
export async function requestAlmaMessage({ baseUrl, providerId, body, signal, timeoutMs = 60_000, maxResponseBytes = 8_000_000, fetchImpl = globalThis.fetch } = {}) {
  const endpoint = almaMessagesEndpoint({ baseUrl, providerId });
  const requestJson = serializableBody(body);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw new AlmaProviderError('INVALID_CONFIG', 'timeoutMs must be 1..600000.');
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 64_000_000) throw new AlmaProviderError('INVALID_CONFIG', 'maxResponseBytes must be 1..64000000.');
  if (typeof fetchImpl !== 'function') throw new AlmaProviderError('INVALID_CONFIG', 'A fetch implementation is required.');
  if (signal?.aborted) throw new AlmaProviderError('REQUEST_ABORTED', 'Alma request cancelled before submission.', { request_submitted: false, upstream_outcome_unknown: false, upstream_cancellation_confirmed: false });
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  let timedOut = false, submitted = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const startedAt = new Date().toISOString(), started = performance.now();
  const requestSummary = { version: ALMA_PROVIDER_TRANSPORT_VERSION, endpoint, provider_id: providerId, requested_model: body.model, request_sha256: crypto.createHash('sha256').update(requestJson).digest('hex'), message_count: body.messages.length, tool_names: (body.tools || []).map(tool => tool.name), system_supplied: body.system !== undefined, max_tokens: body.max_tokens, started_at: startedAt };
  let rawResponseText = null, rawResponse = null, httpStatus = null;
  try {
    submitted = true;
    const response = await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: requestJson, signal: controller.signal, redirect: 'error' });
    httpStatus = response.status;
    rawResponseText = await responseText(response, maxResponseBytes, controller);
    try { rawResponse = JSON.parse(rawResponseText); } catch {
      throw new AlmaProviderError('INVALID_RESPONSE', 'Alma returned a non-JSON response.', { raw_response_text: rawResponseText, http_status: httpStatus });
    }
    if (!response.ok || rawResponse?.type === 'error') throw new AlmaProviderError('PROVIDER_ERROR', `Alma provider proxy returned HTTP ${httpStatus}.`, { http_status: httpStatus, raw_response: rawResponse, raw_response_text: rawResponseText });
    if (!isObject(rawResponse) || rawResponse.type !== 'message' || rawResponse.role !== 'assistant' || !Array.isArray(rawResponse.content)) throw new AlmaProviderError('INVALID_RESPONSE', 'Alma returned an unexpected Anthropic Messages shape.', { http_status: httpStatus, raw_response: rawResponse, raw_response_text: rawResponseText });
    return { ...structuredClone(rawResponse), rawResponse, rawResponseText, transport: {
      ...requestSummary, http_status: httpStatus, elapsed_ms: Math.round(performance.now() - started), client_retries: 0,
      reported_model: rawResponse.model ?? null, served_model_verified: false, model_evidence: 'alma_proxy_echo_not_upstream_model_attestation',
      reported_model_matches_requested: rawResponse.model === body.model,
      model_attestation: 'request_echo_only', usage_attestation: 'proxy_may_default_missing_to_zero',
      usage_evidence: 'alma_proxy_reported_input_output_only_missing_upstream_usage_may_be_zero',
      upstream_cancellation_supported: false, upstream_request_count: null,
      context_source: 'explicit_request_only_alma_provider_proxy',
      tool_execution: 'caller_owned_no_tools_executed_by_transport'
    } };
  } catch (error) {
    const details = { request: requestSummary, request_submitted: submitted, http_status: httpStatus, elapsed_ms: Math.round(performance.now() - started), client_retries: 0, upstream_outcome_unknown: submitted, upstream_cancellation_confirmed: false };
    if (error instanceof AlmaProviderError) {
      error.details = { ...details, ...error.details };
      throw error;
    }
    const code = timedOut ? 'REQUEST_TIMEOUT' : controller.signal.aborted ? 'REQUEST_ABORTED' : 'TRANSPORT_ERROR';
    throw new AlmaProviderError(code, timedOut ? 'Alma request timed out; upstream completion and cost remain unknown.' : controller.signal.aborted ? 'Alma request cancelled locally; upstream cancellation is unverified.' : 'Alma provider transport failed; no automatic retry was attempted.', details);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

/** Explicit per-run provider configuration; defaults never inject a system prompt. */
export function createAlmaProvider({ baseUrl, providerId, model, maxTokens = 2048, timeoutMs = 60_000, maxResponseBytes, fetchImpl } = {}) {
  almaMessagesEndpoint({ baseUrl, providerId });
  if (!validText(model)) throw new AlmaProviderError('INVALID_CONFIG', 'An explicit provider model id is required.');
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) throw new AlmaProviderError('INVALID_CONFIG', 'maxTokens must be a positive integer.');
  return {
    providerId,
    model,
    transportVersion: ALMA_PROVIDER_TRANSPORT_VERSION,
    async invoke({ messages, tools, maxTokens: requestedMaxTokens = maxTokens, signal, system, temperature, topP, topK, stopSequences, toolChoice } = {}) {
      return requestAlmaMessage({ baseUrl, providerId, timeoutMs, maxResponseBytes, fetchImpl, signal, body: {
        model, messages, tools, max_tokens: requestedMaxTokens, stream: false,
        ...(system !== undefined ? { system } : {}), ...(temperature !== undefined ? { temperature } : {}), ...(topP !== undefined ? { top_p: topP } : {}), ...(topK !== undefined ? { top_k: topK } : {}), ...(stopSequences !== undefined ? { stop_sequences: stopSequences } : {}), ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {})
      } });
    }
  };
}
