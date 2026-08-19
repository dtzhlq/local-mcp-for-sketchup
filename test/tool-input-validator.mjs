import assert from 'node:assert/strict';
import { listToolDefinitions } from '../src/tool-registry.mjs';
import { ToolInputValidator } from '../src/tool-input-validator.mjs';
import { ValidatedToolDispatcher } from '../src/validated-tool-dispatcher.mjs';

const registry = listToolDefinitions();
const validator = new ToolInputValidator(registry);
assert.equal(registry.length, 42);

assert.deepEqual(validator.validate('get_docs', { topic: 'overview', detail: 'summary', max_chars: 512 }), {
  topic: 'overview', detail: 'summary', max_chars: 512
});
assert.equal(validator.schemaFor('get_capabilities').additionalProperties, false, 'schemas omitted by the registry must fail closed at the cloned top level');
assert.doesNotThrow(() => validator.validate('start_agent_task', {
  intent: 'understand_model',
  instruction: 'Nested inputs remain an explicitly free-form task payload.',
  inputs: { domain_specific: { arbitrary: ['shape', 1, true] } }
}));
assert.doesNotThrow(() => validator.validate('build_report', {
  runtime: 'mock',
  validate_model: true,
  strictCollisions: false,
  strictUnanchored: true,
  floatingDetails: false
}));

expectInvalid(() => validator.validate('get_docs', { unexpected_field: true }), 'additionalProperties');
expectInvalid(() => validator.validate('start_agent_task', {
  intent: 'creat_model', instruction: 'Wrong enum fixture.'
}), 'enum');
expectInvalid(() => validator.validate('start_agent_task', {
  intent: 'understand_model',
  instruction: 'Wrong nested field fixture.',
  client_capabilities: { context: 'unbounded', execution_policy: { allowed_runtimes: ['queue'] } }
}), 'additionalProperties');
expectInvalid(() => validator.validate('not_a_tool', {}), 'registered_tool');

let invocations = 0;
const dispatcher = new ValidatedToolDispatcher({
  toolRegistry: registry,
  invoke: async (name, args, context) => {
    invocations += 1;
    return { name, args, context };
  }
});
const dispatched = await dispatcher.dispatch('get_docs', { topic: 'overview' }, { actor: 'agent' });
assert.equal(dispatched.name, 'get_docs');
assert.equal(dispatched.context.actor, 'agent');
await assert.rejects(
  dispatcher.dispatch('get_docs', { unexpected_field: true }),
  (error) => error?.code === 'INVALID_ARGUMENT'
);
assert.equal(invocations, 1, 'invalid input must be rejected before the tool implementation is invoked');

process.stdout.write(`${JSON.stringify({ ok: true, tools: registry.length, top_level_fail_closed: true, nested_free_shape_preserved: true }, null, 2)}\n`);

function expectInvalid(callback, keyword) {
  assert.throws(callback, (error) => {
    assert.equal(error?.code, 'INVALID_ARGUMENT');
    assert.equal(error?.retryable, false);
    assert.equal(error?.next_action?.action, 'correct_input');
    assert.ok(error?.details?.issues?.some((issue) => issue.keyword === keyword), JSON.stringify(error?.details));
    return true;
  });
}
