import assert from 'node:assert/strict';
import { createAlmaProvider, requestAlmaMessage, almaMessagesEndpoint } from '../scripts/model-accessibility/alma-provider.mjs';

// All responses are local fixtures. This test never calls Alma or a model.
const baseUrl = 'http://127.0.0.1:23001';
const providerId = 'fixture-provider';
const model = 'fixture-model';
const toolNames = ['start_agent_task', 'submit_agent_task_input', 'resume_agent_task', 'read_agent_artifact'];
const tools = toolNames.map(name => ({ name, description: `Fixture ${name}`, input_schema: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false } }));
const messages = [{ role: 'user', content: 'Create the explicitly requested window.' }];
const raw = { id: 'fixture-1', type: 'message', role: 'assistant', model, content: [{ type: 'tool_use', id: 'tool-1', name: 'start_agent_task', input: { id: '窗-test' } }], stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 25 } };
let calls = [];
const fetchImpl = async (url, options) => {
  calls.push({ url, options, body: JSON.parse(options.body) });
  return new Response(JSON.stringify(raw), { status: 200, headers: { 'content-type': 'application/json' } });
};
const provider = createAlmaProvider({ baseUrl, providerId, model, maxTokens: 512, fetchImpl });
assert.equal(calls.length, 0, 'Constructing the transport cannot invoke a model.');
const result = await provider.invoke({ messages, tools });
assert.equal(calls.length, 1);
assert.equal(calls[0].url, `${baseUrl}/anthropic-proxy/fixture-provider/v1/messages`);
assert.deepEqual(calls[0].options.headers, { 'Content-Type': 'application/json' }, 'Credentials are managed inside Alma, never read or added by this helper.');
assert.equal(calls[0].options.redirect, 'error');
assert.deepEqual(calls[0].body.tools.map(tool => tool.name), toolNames, 'No tool injection or auto-selection is allowed.');
assert.deepEqual(calls[0].body.messages, messages);
assert.equal(calls[0].body.max_tokens, 512);
assert.equal(calls[0].body.stream, false);
assert.equal(Object.hasOwn(calls[0].body, 'system'), false, 'No hidden system prompt may be added.');
assert.deepEqual(result.rawResponse, raw);
assert.equal(result.rawResponseText, JSON.stringify(raw));
assert.notEqual(result.content, result.rawResponse.content, 'Caller-owned conversation blocks must not alias the preserved raw response.');
assert.deepEqual(result.content, raw.content);
assert.deepEqual(result.usage, raw.usage);
assert.equal(result.transport.model_attestation, 'request_echo_only');
assert.equal(result.transport.usage_attestation, 'proxy_may_default_missing_to_zero');
assert.equal(result.transport.served_model_verified, false);
assert.equal(result.transport.client_retries, 0);
assert.equal(result.transport.upstream_cancellation_supported, false);

const followup = [...messages, { role: 'assistant', content: result.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: '{"task_id":"task-fixture","quality_accepted":false}' }] }];
await provider.invoke({ messages: followup, tools, maxTokens: 400 });
assert.equal(calls.length, 2);
assert.deepEqual(calls[1].body.messages, followup, 'Tool calls and results must round-trip unchanged.');
assert.equal(calls[1].body.max_tokens, 400);
assert.equal(almaMessagesEndpoint({ baseUrl, providerId: 'plugin:fixture:google' }), `${baseUrl}/anthropic-proxy/plugin%3Afixture%3Agoogle/v1/messages`);
for (const url of ['https://example.com', 'http://user:pass@127.0.0.1:23001', `${baseUrl}/api`, `${baseUrl}?key=hidden`]) assert.throws(() => almaMessagesEndpoint({ baseUrl: url, providerId }), /loopback/);
assert.throws(() => almaMessagesEndpoint({ providerId }), /explicitly verified/);
assert.throws(() => almaMessagesEndpoint({ baseUrl, providerId: '../providers' }), /providerId/);

const body = { model, messages, tools, max_tokens: 100, stream: false };
await assert.rejects(() => requestAlmaMessage({ baseUrl, providerId, body: { ...body, apiKey: 'never-read' }, fetchImpl }), error => error.code === 'INVALID_REQUEST');
await assert.rejects(() => requestAlmaMessage({ baseUrl, providerId, body: { ...body, stream: true }, fetchImpl }), error => error.code === 'INVALID_REQUEST');
assert.equal(calls.length, 2, 'Invalid input must fail before an HTTP request.');

let failureCalls = 0;
for (const [fixture, expected] of [
  [() => new Response('{"type":"error","error":{"type":"rate_limit_error"}}', { status: 429 }), 'PROVIDER_ERROR'],
  [() => new Response('invalid-json', { status: 200 }), 'INVALID_RESPONSE'],
  [() => new Response('{"type":"unrelated"}', { status: 200 }), 'INVALID_RESPONSE'],
  [() => { throw new Error('fixture connection refused'); }, 'TRANSPORT_ERROR']
]) {
  const before = failureCalls;
  await assert.rejects(() => requestAlmaMessage({ baseUrl, providerId, body, fetchImpl: async () => { failureCalls++; return fixture(); } }), error => error.code === expected && error.retrySafe === false && error.details.client_retries === 0);
  assert.equal(failureCalls, before + 1, 'Errors must never trigger an automatic retry.');
}
const aborted = new AbortController(); aborted.abort();
await assert.rejects(() => requestAlmaMessage({ baseUrl, providerId, body, signal: aborted.signal, fetchImpl }), error => error.code === 'REQUEST_ABORTED' && error.details.request_submitted === false);
assert.equal(calls.length, 2);
const waitForAbort = async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Fixture aborted', 'AbortError')), { once: true }));
await assert.rejects(() => requestAlmaMessage({ baseUrl, providerId, body, timeoutMs: 5, fetchImpl: waitForAbort }), error => error.code === 'REQUEST_TIMEOUT' && error.details.upstream_outcome_unknown === true && error.details.upstream_cancellation_confirmed === false);
const cancel = new AbortController();
const pending = requestAlmaMessage({ baseUrl, providerId, body, signal: cancel.signal, fetchImpl: waitForAbort });
cancel.abort();
await assert.rejects(() => pending, error => error.code === 'REQUEST_ABORTED' && error.details.upstream_outcome_unknown === true);
await assert.rejects(() => requestAlmaMessage({ baseUrl, providerId, body, maxResponseBytes: 20, fetchImpl }), error => error.code === 'RESPONSE_TOO_LARGE');

console.log(JSON.stringify({ ok: true, evidence_level: 'fixture_transport_only', real_model_calls: 0, cases: ['exact-four-tool-payload-no-system-no-credentials', 'anthropic-tool-use-and-result-roundtrip', 'raw-response-usage-and-model-evidence-preserved', 'explicit-loopback-endpoint-and-provider-encoding', 'invalid-input-rejected-before-request', 'errors-without-retries', 'abort-timeout-with-unknown-upstream-outcome', 'bounded-response-size'] }, null, 2));
