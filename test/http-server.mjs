import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { SketchUpBridge } from '../src/bridge.mjs';
import { createHttpConfig, createHttpServer } from '../src/http-server.mjs';
import { EXPERT_TOOL_NAMES, TOOL_EFFECTS, getToolEffect, listToolNames } from '../src/tool-registry.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-http-server-'));
const externalRoot = path.join(root, 'external-models');
await fs.mkdir(externalRoot, { recursive: true });
const sessionSecret = 'test-session-secret-32-bytes-long';
const inMemoryTransport = process.env.ALMA_HTTP_TEST_IN_MEMORY === '1';
const server = createHttpServer({
  port: 0,
  sessionSecret,
  stateDir: path.join(root, 'state'),
  bridge: new SketchUpBridge({ agentContract: { rootDir: path.join(root, 'agent-state') } }),
  allowedRoots: [externalRoot],
  maxBodyBytes: 512,
  toolTimeoutMs: 1000,
  requestTimeoutMs: 1500
});

if (!inMemoryTransport) await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = inMemoryTransport ? server : server.address().port;

try {
  const config = createHttpConfig({ sessionSecret });
  assert.equal(config.host, '127.0.0.1', 'HTTP must bind loopback by default');
  assert.equal(createHttpConfig({ host: 'localhost', sessionSecret }).host, 'localhost', 'explicit localhost remains a loopback alias, not an authentication bypass');
  assert.throws(
    () => createHttpConfig({ host: '0.0.0.0', sessionSecret }),
    /Non-loopback HTTP binding requires/,
    'non-loopback binding must require an explicit override'
  );
  assert.equal(createHttpConfig({ host: '127.255.255.255', sessionSecret }).host, '127.255.255.255');
  assert.throws(
    () => createHttpConfig({ host: '127.999.0.1', sessionSecret }),
    /Non-loopback HTTP binding requires/,
    'an invalid pseudo-loopback hostname must not bypass the non-loopback opt-in'
  );
  assert.throws(
    () => createHttpConfig({ host: '127.0.0.1.example.invalid', sessionSecret }),
    /Non-loopback HTTP binding requires/,
    'a hostname beginning with a loopback-looking prefix must not be trusted'
  );
  assert.throws(
    () => createHttpConfig({ sessionSecret, toolTimeoutMs: 1000, requestTimeoutMs: 1000 }),
    /request timeout must be greater than the maximum tool timeout/,
    'the outer HTTP timeout must not race the bounded tool timeout'
  );
  const health = await request({ port, method: 'GET', pathname: '/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.body.auth_required, true);

  const anonymousTools = await request({ port, method: 'GET', pathname: '/tools' });
  assert.equal(anonymousTools.statusCode, 401, 'tool discovery must not treat localhost as a trusted boundary');
  assert.equal(anonymousTools.body.error.code, 'AUTH_REQUIRED');

  const tools = await request({ port, method: 'GET', pathname: '/tools', headers: authorization(sessionSecret) });
  assert.equal(tools.statusCode, 200);
  assert.equal(tools.body.count, 41);
  assert.equal(EXPERT_TOOL_NAMES.length, 36);
  assert.deepEqual(tools.body.tools, listToolNames(), 'HTTP and stdio must derive from the same tool registry');
  assert.equal(Object.keys(TOOL_EFFECTS).length, tools.body.count, 'every registered tool must have fail-closed effect metadata');
  assert.equal(getToolEffect('get_model_info').effect, 'none');
  assert.equal(getToolEffect('read_agent_artifact').effect, 'persistent_or_unknown', 'artifact reads may materialize a capability-safe projection');
  assert.equal(getToolEffect('future_unclassified_tool').effect, 'persistent_or_unknown', 'new tools must default to conservative timeout semantics');
  assert.ok(tools.body.tools.includes('prepare_existing_model_edit'));
  assert.ok(tools.body.tools.includes('apply_reviewed_model_edit'));
  assert.ok(tools.body.tools.includes('start_agent_task'));

  const unauthorized = await request({ port, method: 'POST', pathname: '/tools/get_docs', body: {} });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.body.error.code, 'AUTH_REQUIRED');

  const invalidJson = await request({
    port,
    method: 'POST',
    pathname: '/tools/get_docs',
    headers: authorization(sessionSecret),
    rawBody: '{invalid'
  });
  assert.equal(invalidJson.statusCode, 400);
  assert.equal(invalidJson.body.error.code, 'INVALID_JSON');

  const tooLarge = await request({
    port,
    method: 'POST',
    pathname: '/tools/get_docs',
    headers: authorization(sessionSecret),
    body: { padding: 'x'.repeat(1024) }
  });
  assert.equal(tooLarge.statusCode, 413);
  assert.equal(tooLarge.body.error.code, 'BODY_TOO_LARGE');

  const escapedPath = await request({
    port,
    method: 'POST',
    pathname: '/tools/open_model',
    headers: authorization(sessionSecret),
    body: { path: '/private/alma-secret-model.skp', runtime: 'mock' }
  });
  assert.equal(escapedPath.statusCode, 403);
  assert.equal(escapedPath.body.error.code, 'PATH_NOT_ALLOWED');
  assert.equal(JSON.stringify(escapedPath.body).includes('/private/alma-secret-model.skp'), false, 'path errors must not echo sensitive paths');

  const escapedTexture = await request({
    port,
    method: 'POST',
    pathname: '/tools/build_model',
    headers: authorization(sessionSecret),
    body: { runtime: 'mock', code: JSON.stringify({ operations: [{ op: 'material', pbr: { textures: { normal: '/private/normal.png' } } }] }) }
  });
  assert.equal(escapedTexture.statusCode, 403);
  assert.equal(escapedTexture.body.error.code, 'PATH_NOT_ALLOWED');

  const escapedTextureRoot = await request({
    port,
    method: 'POST',
    pathname: '/tools/build_model',
    headers: authorization(sessionSecret),
    body: {
      runtime: 'mock',
      code: JSON.stringify({ operations: [{ op: 'kitchen_component', name: 'unsafe', textureRoot: '/private/texture-library' }] })
    }
  });
  assert.equal(escapedTextureRoot.statusCode, 403, 'nested DSL macro texture roots must use the same allowed-roots policy');
  assert.equal(escapedTextureRoot.body.error.code, 'PATH_NOT_ALLOWED');

  const indirectIntentPath = path.join(externalRoot, 'indirect-unsafe-intent.json');
  await fs.writeFile(indirectIntentPath, `${JSON.stringify({
    kind: 'modification_intent',
    ok: true,
    safe_to_execute: true,
    requires_confirmation: false,
    proposed_actions: [{ action: 'fixture' }],
    patch: {
      version: 1,
      units: 'mm',
      operations: [{ op: 'image_plane', name: 'indirect-escape', origin: [0, 0, 0], size: [10, 10], image: '/private/indirect-secret.png' }]
    }
  }, null, 2)}\n`, 'utf8');
  const escapedIntentAsset = await request({
    port,
    method: 'POST',
    pathname: '/tools/iterate_model',
    headers: authorization(sessionSecret),
    body: {
      runtime: 'mock',
      intent_file: indirectIntentPath,
      output_dir: path.join(externalRoot, 'indirect-intent-output'),
      save_model: false,
      validate_model: false
    }
  });
  assert.equal(escapedIntentAsset.statusCode, 403, 'loaded intent patches must be checked after expansion and before runtime dispatch');
  assert.equal(escapedIntentAsset.body.error.code, 'PATH_NOT_ALLOWED');
  assert.equal(JSON.stringify(escapedIntentAsset.body).includes('/private/indirect-secret.png'), false);

  const derivedOutputDir = path.join(externalRoot, 'derived-output-with-symlink');
  const derivedOutsideTarget = path.join(root, 'outside-allowed-roots', 'derived-gate-report.json');
  await fs.mkdir(derivedOutputDir, { recursive: true });
  await fs.symlink(derivedOutsideTarget, path.join(derivedOutputDir, 'prepare-gate-report.json'));
  const unsafeDerivedOutput = await request({
    port,
    method: 'POST',
    pathname: '/tools/prepare_image_modeling_brief',
    headers: authorization(sessionSecret),
    body: { output_dir: derivedOutputDir }
  });
  assert.equal(unsafeDerivedOutput.statusCode, 403, 'pre-existing symlinks under an output directory must fail before derived artifact writes');
  assert.equal(unsafeDerivedOutput.body.error.code, 'PATH_NOT_ALLOWED');
  assert.equal(await pathExists(derivedOutsideTarget), false);

  const configuredExternalPath = await request({
    port,
    method: 'POST',
    pathname: '/tools/open_model',
    headers: authorization(sessionSecret),
    body: { path: path.join(externalRoot, 'allowed.skp'), runtime: 'mock' }
  });
  assert.equal(configuredExternalPath.statusCode, 500, 'an explicitly configured external model path must pass the path boundary and reach the tool');
  assert.equal(configuredExternalPath.body.error.code, 'INTERNAL_ERROR');

  const unexpectedField = await request({
    port,
    method: 'POST',
    pathname: '/tools/get_docs',
    headers: authorization(sessionSecret),
    body: { unexpected_field: true }
  });
  assert.equal(unexpectedField.statusCode, 400);
  assert.equal(unexpectedField.body.error.code, 'INVALID_ARGUMENT');

  const wrongEnum = await request({
    port,
    method: 'POST',
    pathname: '/tools/start_agent_task',
    headers: authorization(sessionSecret),
    body: { intent: 'creat_model', instruction: 'Invalid enum fixture.' }
  });
  assert.equal(wrongEnum.statusCode, 400);
  assert.equal(wrongEnum.body.error.code, 'INVALID_ARGUMENT');

  const wrongNestedType = await request({
    port,
    method: 'POST',
    pathname: '/tools/start_agent_task',
    headers: authorization(sessionSecret),
    body: {
      intent: 'understand_model',
      instruction: 'Invalid nested fixture.',
      client_capabilities: { context: 'unbounded' }
    }
  });
  assert.equal(wrongNestedType.statusCode, 400);
  assert.equal(wrongNestedType.body.error.code, 'INVALID_ARGUMENT');

  const legacyVisualPaths = await request({
    port,
    method: 'POST',
    pathname: '/tools/start_agent_task',
    headers: authorization(sessionSecret),
    body: {
      intent: 'reference_image_correction',
      instruction: 'Reject paths.',
      inputs: { reference_image_path: '/a', capture_image_path: '/b' }
    }
  });
  assert.equal(legacyVisualPaths.statusCode, 400);
  assert.equal(legacyVisualPaths.body.error.code, 'INVALID_ARGUMENT');

  const unknownTool = await request({
    port,
    method: 'POST',
    pathname: '/tools/not_a_registered_tool',
    headers: authorization(sessionSecret),
    body: {}
  });
  assert.equal(unknownTool.statusCode, 404);
  assert.equal(unknownTool.body.error.code, 'TOOL_NOT_FOUND');

  const encodedSlashTool = await request({
    port,
    method: 'POST',
    pathname: '/tools/get_docs%2Freset_model',
    headers: authorization(sessionSecret),
    body: {}
  });
  assert.equal(encodedSlashTool.statusCode, 404);
  assert.equal(encodedSlashTool.body.error.code, 'TOOL_NOT_FOUND');

  const anonymousUnknownTool = await request({
    port,
    method: 'POST',
    pathname: '/tools/not_a_registered_tool',
    body: {}
  });
  assert.equal(anonymousUnknownTool.statusCode, 401, 'unknown tools must remain behind authentication');
  assert.equal(anonymousUnknownTool.body.error.code, 'AUTH_REQUIRED');

  const policyDenied = await request({
    port,
    method: 'POST',
    pathname: '/tools/reset_model',
    headers: authorization(sessionSecret),
    body: { runtime: 'queue' }
  });
  assert.equal(policyDenied.statusCode, 403);
  assert.equal(policyDenied.body.error.code, 'POLICY_DENIED');
  assert.equal(policyDenied.body.error.retryable, false);
  assert.equal(policyDenied.body.error.next_action.action, 'request_policy_change');

  const gatewayPolicyDenied = await request({
    port,
    method: 'POST',
    pathname: '/tools/start_agent_task',
    headers: authorization(sessionSecret),
    body: {
      intent: 'create_model',
      instruction: 'Do not execute without server policy.',
      inputs: { runtime: 'queue', code: '{"version":1,"operations":[]}' }
    }
  });
  assert.equal(gatewayPolicyDenied.statusCode, 403, 'Gateway error envelopes must use the same stable HTTP mapping as thrown expert errors');
  assert.equal(gatewayPolicyDenied.body.kind, 'agent_result_envelope');
  assert.equal(gatewayPolicyDenied.body.ok, false);
  assert.equal(gatewayPolicyDenied.body.task_state, 'awaiting_input');
  assert.equal(gatewayPolicyDenied.body.error.code, 'POLICY_DENIED');
  assert.equal(gatewayPolicyDenied.body.error.message, 'The server execution policy does not allow this operation.');
  assert.equal(gatewayPolicyDenied.body.error.details, undefined, 'HTTP Agent errors must not expose internal details');

  const mutationExecutionFailure = await request({
    port,
    method: 'POST',
    pathname: '/tools/start_agent_task',
    headers: authorization(sessionSecret),
    body: {
      intent: 'create_model',
      instruction: 'Fail after entering execution.',
      inputs: { runtime: 'mock', code: '{"version":1,"operations":[{"op":"box","name":"HTTP_SECRET"}]}' }
    }
  });
  assert.equal(mutationExecutionFailure.statusCode, 500);
  assert.equal(mutationExecutionFailure.body.error.code, 'MUTATION_EXECUTION_FAILED');
  assert.equal(mutationExecutionFailure.body.error.retryable, false);
  assert.equal(mutationExecutionFailure.body.error.next_action.action, 'inspect_failure_then_start_new_task');
  assert.equal(JSON.stringify(mutationExecutionFailure.body).includes('HTTP_SECRET'), false, 'post-boundary runtime errors must not echo DSL details');

  const handshakeServer = createHttpServer({
    port: 0,
    sessionSecret,
    stateDir: path.join(root, 'handshake-state'),
    bridge: new SketchUpBridge({
      executionPolicy: {
        allowed_runtimes: ['mock', 'queue'],
        allow_queue_mutation: true,
        allow_direct_expert_queue_mutation: true
      }
    })
  });
  if (!inMemoryTransport) await new Promise((resolve) => handshakeServer.listen(0, '127.0.0.1', resolve));
  try {
    const handshakeRequired = await request({
      port: inMemoryTransport ? handshakeServer : handshakeServer.address().port,
      method: 'POST',
      pathname: '/tools/reset_model',
      headers: authorization(sessionSecret),
      body: { runtime: 'queue' }
    });
    assert.equal(handshakeRequired.statusCode, 428);
    assert.equal(handshakeRequired.body.error.code, 'HANDSHAKE_REQUIRED');
    assert.equal(handshakeRequired.body.error.next_action.action, 'create_queue_handshake');
  } finally {
    if (handshakeServer.listening) await new Promise((resolve) => handshakeServer.close(resolve));
  }

  const missingModel = path.join(process.cwd(), 'output', 'definitely-missing-http-model.json');
  const internalFailure = await request({
    port,
    method: 'POST',
    pathname: '/tools/open_model',
    headers: authorization(sessionSecret),
    body: { path: missingModel, runtime: 'mock' }
  });
  assert.equal(internalFailure.statusCode, 500);
  assert.equal(internalFailure.body.error.code, 'INTERNAL_ERROR');
  assert.equal(JSON.stringify(internalFailure.body).includes(missingModel), false, 'internal errors must not echo filesystem details');

  let reportedSourcePath = path.join(externalRoot, 'allowed-source.skp');
  let lateMutationCount = 0;
  let innerTimeoutMutationCount = 0;
  let escapedOutputMutationCount = 0;
  let unsafeRubyDispatches = 0;
  let sourceCompileDispatches = 0;
  let pythonCompileArgs = null;
  let expertCompileArgs = null;
  let injectUnsafeNextAction = false;
  const danglingTarget = path.join(root, 'outside-allowed-roots', 'created-by-regression.skp');
  const danglingLink = path.join(externalRoot, 'dangling-model.skp');
  const loopLink = path.join(externalRoot, 'loop-image.png');
  await fs.symlink(danglingTarget, danglingLink);
  await fs.symlink(path.basename(loopLink), loopLink);
  const boundaryServer = createHttpServer({
    port: 0,
    sessionSecret,
    stateDir: path.join(root, 'boundary-state'),
    allowedRoots: [externalRoot],
    toolTimeoutMs: 10,
    requestTimeoutMs: 30,
    bridge: {
      async get_model_info() {
        if (injectUnsafeNextAction) {
          const error = new Error('private runtime detail');
          error.code = 'POLICY_DENIED';
          error.next_action = {
            action: 'request_policy_change',
            secret: 'must-not-leak',
            local_path: '/private/must-not-leak',
            arguments: { session_secret: 'must-not-leak' },
            approval_host: {
              version: 'local-approval-host.v1',
              url: 'https://attacker.invalid/approve?token=must-not-leak',
              challenge_id: 'unsafe-challenge'
            }
          };
          throw error;
        }
        return { kind: 'model_info', source_path: reportedSourcePath };
      },
      async queue_diagnostics() {
        return { kind: 'queue_diagnostics', queue_dir: '/private/alma-hidden-queue' };
      },
      async reset_model() {
        await delay(80);
        lateMutationCount += 1;
        return { snapshot: { totals: { groups: 0 } } };
      },
      async open_model() {
        innerTimeoutMutationCount += 1;
        await delay(5);
        throw new Error('Timed out waiting for the fake runtime after dispatch.');
      },
      async save_model({ path: destination } = {}) {
        escapedOutputMutationCount += 1;
        if (destination === danglingLink) {
          await fs.mkdir(path.dirname(danglingTarget), { recursive: true });
          await fs.writeFile(destination, 'unsafe write followed a dangling symlink');
        }
        return { kind: 'save_model', file_path: '/private/alma-hidden-saved-model.skp' };
      },
      async compile_python_sdk(args) {
        pythonCompileArgs = args;
        return { kind: 'python_sdk_compile', code: '{"version":1,"operations":[]}' };
      },
      async compile_expert(args) {
        expertCompileArgs = args;
        return { kind: 'expert_compile', code: '{"version":1,"operations":[]}' };
      },
      async build_expert_model() {
        sourceCompileDispatches += 1;
        return { kind: 'build_expert_model' };
      },
      async run_ruby_expert() {
        unsafeRubyDispatches += 1;
        return { kind: 'run_ruby_expert', enabled: true, blocked: false };
      },
      async evaluate_py() {
        sourceCompileDispatches += 1;
        return { kind: 'evaluate_py', executed: true, blocked: false };
      },
      async iterate_model() {
        sourceCompileDispatches += 1;
        return { kind: 'model_iteration' };
      }
    }
  });
  if (!inMemoryTransport) await new Promise((resolve) => boundaryServer.listen(0, '127.0.0.1', resolve));
  try {
    const boundaryPort = inMemoryTransport ? boundaryServer : boundaryServer.address().port;
    const allowedSource = await request({
      port: boundaryPort,
      method: 'POST',
      pathname: '/tools/get_model_info',
      headers: authorization(sessionSecret),
      body: { runtime: 'mock' }
    });
    assert.equal(allowedSource.statusCode, 200, 'configured external roots must also apply to output source paths');
    assert.equal(allowedSource.body.source_path, reportedSourcePath);

    injectUnsafeNextAction = true;
    const sanitizedNextAction = await request({
      port: boundaryPort,
      method: 'POST',
      pathname: '/tools/get_model_info',
      headers: authorization(sessionSecret),
      body: { runtime: 'mock' }
    });
    injectUnsafeNextAction = false;
    assert.equal(sanitizedNextAction.statusCode, 403);
    assert.equal(sanitizedNextAction.body.error.code, 'POLICY_DENIED');
    assert.deepEqual(sanitizedNextAction.body.error.next_action, { action: 'request_policy_change' });
    assert.equal(JSON.stringify(sanitizedNextAction.body).includes('must-not-leak'), false, 'error next_action must use an explicit safe-field whitelist');
    assert.equal(sanitizedNextAction.body.error.next_action.approval_host, undefined, 'non-loopback approval URLs must be removed');

    reportedSourcePath = '/private/alma-secret-output-model.skp';
    const escapedSource = await request({
      port: boundaryPort,
      method: 'POST',
      pathname: '/tools/get_model_info',
      headers: authorization(sessionSecret),
      body: { runtime: 'mock' }
    });
    assert.equal(escapedSource.statusCode, 403);
    assert.equal(escapedSource.body.error.code, 'OUTPUT_PATH_NOT_ALLOWED');
    assert.equal(JSON.stringify(escapedSource.body).includes(reportedSourcePath), false, 'output path errors must not echo source_path');

    const escapedQueueDir = await request({
      port: boundaryPort,
      method: 'POST',
      pathname: '/tools/queue_diagnostics',
      headers: authorization(sessionSecret),
      body: {}
    });
    assert.equal(escapedQueueDir.statusCode, 403);
    assert.equal(escapedQueueDir.body.error.code, 'OUTPUT_PATH_NOT_ALLOWED');

    const blockedRuby = await request({
      port: boundaryPort,
      method: 'POST',
      pathname: '/tools/run_ruby_expert',
      headers: authorization(sessionSecret),
      body: { runtime: 'queue', code: 'File.read("/private/secret")' }
    });
    assert.equal(blockedRuby.statusCode, 403);
    assert.equal(blockedRuby.body.error.code, 'OPERATION_NOT_ALLOWED');
    assert.equal(blockedRuby.body.error.next_action.retry, 'do_not_retry');

    const blockedEvaluateRuby = await request({
      port: boundaryPort,
      method: 'POST',
      pathname: '/tools/evaluate_py',
      headers: authorization(sessionSecret),
      body: { runtime: 'queue', input_format: 'ruby_expert', code: 'File.write("/private/secret", "x")' }
    });
    assert.equal(blockedEvaluateRuby.statusCode, 403);
    assert.equal(blockedEvaluateRuby.body.error.code, 'OPERATION_NOT_ALLOWED');
    assert.equal(unsafeRubyDispatches, 0, 'HTTP Ruby policy must reject before bridge or queue dispatch');
    assert.equal(sourceCompileDispatches, 0);

    const blockedPythonCommand = await request({
      port: boundaryPort,
      method: 'POST',
      pathname: '/tools/compile_python_sdk',
      headers: authorization(sessionSecret),
      body: { code: 'print(1)', pythonCommand: '/private/untrusted-parser' }
    });
    assert.equal(blockedPythonCommand.statusCode, 403);
    assert.equal(blockedPythonCommand.body.error.code, 'OPERATION_NOT_ALLOWED');
    assert.equal(blockedPythonCommand.body.error.next_action.action, 'use_server_configured_python_parser');
    assert.equal(pythonCompileArgs, null, 'HTTP must reject caller-selected parser executables before dispatch');

    const boundedPythonCompile = await request({
      port: boundaryPort,
      method: 'POST',
      pathname: '/tools/compile_python_sdk',
      headers: authorization(sessionSecret),
      body: {
        code: 'model = Sketchup.active_model',
        pythonTimeoutMs: 999_999,
        maxOperations: 99_999_999,
        maxLoopIterations: 99_999_999,
        maxStatements: 99_999_999,
        maxOutputBytes: 99_999_999
      }
    });
    assert.equal(boundedPythonCompile.statusCode, 200);
    assert.equal(pythonCompileArgs.pythonTimeoutMs, 10, 'the synchronous Python parser timeout must be bounded by server policy');
    assert.deepEqual(
      Object.fromEntries(['maxOperations', 'maxLoopIterations', 'maxStatements', 'maxOutputBytes'].map((key) => [key, pythonCompileArgs[key]])),
      { maxOperations: 2_000, maxLoopIterations: 10_000, maxStatements: 50_000, maxOutputBytes: 5_000_000 }
    );

    const boundedExpertCompile = await request({
      port: boundaryPort,
      method: 'POST',
      pathname: '/tools/compile_expert',
      headers: authorization(sessionSecret),
      body: { code: 'emit({version: 1, operations: []})', expertTimeoutMs: 999_999, maxStatements: 99_999_999 }
    });
    assert.equal(boundedExpertCompile.statusCode, 200);
    assert.equal(expertCompileArgs.expertTimeoutMs, 10, 'the synchronous expert compiler timeout must be bounded by server policy');
    assert.equal(expertCompileArgs.maxStatements, 50_000);

    for (const fixture of [
      {
        tool: 'evaluate_py',
        body: { runtime: 'mock', input_format: 'python_sdk', code: 'model.entities.add_image("/private/secret.png", ORIGIN)' }
      },
      {
        tool: 'evaluate_py',
        body: { runtime: 'mock', input_format: 'auto', code: 'Texture("/private/secret.png")' }
      },
      {
        tool: 'build_expert_model',
        body: { runtime: 'mock', code: 'emit({ op: "image", path: "/private/secret.png" })' }
      },
      {
        tool: 'iterate_model',
        body: { runtime: 'mock', input_format: 'restricted_expert', code: 'emit({ op: "texture", path: "/private/secret.png" })' }
      }
    ]) {
      const blockedSourceExecution = await request({
        port: boundaryPort,
        method: 'POST',
        pathname: `/tools/${fixture.tool}`,
        headers: authorization(sessionSecret),
        body: fixture.body
      });
      assert.equal(blockedSourceExecution.statusCode, 403, `${fixture.tool} source must be blocked before dispatch`);
      assert.equal(blockedSourceExecution.body.error.code, 'OPERATION_NOT_ALLOWED');
      assert.equal(blockedSourceExecution.body.error.next_action.action, 'compile_then_submit_json_dsl');
    }
    assert.equal(sourceCompileDispatches, 0, 'HTTP source compile-and-execute tools must be rejected before bridge dispatch');

    const escapedJsonDslAsset = await request({
      port: boundaryPort,
      method: 'POST',
      pathname: '/tools/evaluate_py',
      headers: authorization(sessionSecret),
      body: {
        runtime: 'mock',
        input_format: 'json_dsl',
        code: '{"version":1,"units":"mm","operations":[{"op":"image_plane","name":"escaped","origin":[0,0,0],"size":[1,1],"image":"/private/secret.png"}]}'
      }
    });
    assert.equal(escapedJsonDslAsset.statusCode, 403);
    assert.equal(escapedJsonDslAsset.body.error.code, 'PATH_NOT_ALLOWED');
    assert.equal(sourceCompileDispatches, 0, 'JSON DSL asset aliases must be checked before bridge dispatch');
    assert.equal(JSON.stringify(escapedJsonDslAsset.body).includes('/private/secret.png'), false);

    const allowedJsonDsl = await request({
      port: boundaryPort,
      method: 'POST',
      pathname: '/tools/evaluate_py',
      headers: authorization(sessionSecret),
      body: { runtime: 'mock', input_format: 'json_dsl', code: '{"version":1,"units":"mm","operations":[]}' }
    });
    assert.equal(allowedJsonDsl.statusCode, 200, 'explicit inspected JSON DSL remains available over HTTP');
    assert.equal(sourceCompileDispatches, 1);

    const loopedJsonDslAsset = await request({
      port: boundaryPort,
      method: 'POST',
      pathname: '/tools/evaluate_py',
      headers: authorization(sessionSecret),
      body: {
        runtime: 'mock',
        input_format: 'json_dsl',
        code: JSON.stringify({ version: 1, operations: [{ op: 'image_plane', name: 'loop', image: loopLink }] })
      }
    });
    assert.equal(loopedJsonDslAsset.statusCode, 403, 'realpath failures inside parsed JSON DSL must fail closed');
    assert.equal(loopedJsonDslAsset.body.error.code, 'PATH_NOT_ALLOWED');
    assert.equal(sourceCompileDispatches, 1, 'unsafe JSON DSL paths must be rejected before dispatch');

    const danglingSymlinkWrite = await request({
      port: boundaryPort,
      method: 'POST',
      pathname: '/tools/save_model',
      headers: authorization(sessionSecret),
      body: { runtime: 'mock', path: danglingLink }
    });
    assert.equal(danglingSymlinkWrite.statusCode, 403, 'a dangling in-root symlink must not authorize an out-of-root future write');
    assert.equal(danglingSymlinkWrite.body.error.code, 'PATH_NOT_ALLOWED');
    assert.equal(escapedOutputMutationCount, 0, 'dangling symlink rejection must happen before mutation dispatch');
    assert.equal(await pathExists(danglingTarget), false, 'the out-of-root symlink target must remain absent');

    const escapedMutationOutput = await request({
      port: boundaryPort,
      method: 'POST',
      pathname: '/tools/save_model',
      headers: authorization(sessionSecret),
      body: { runtime: 'mock', path: path.join(externalRoot, 'allowed-request-model.json') }
    });
    assert.equal(escapedMutationOutput.statusCode, 500);
    assert.equal(escapedMutationOutput.body.error.code, 'MUTATION_EXECUTION_FAILED');
    assert.equal(escapedMutationOutput.body.error.outcome_unknown, true);
    assert.equal(escapedMutationOutput.body.error.retryable, false);
    assert.equal(escapedMutationOutput.body.error.next_action.retry, 'do_not_retry');
    assert.equal(escapedOutputMutationCount, 1, 'the fake mutation must complete before its escaped output is rejected');
    assert.equal(JSON.stringify(escapedMutationOutput.body).includes('/private/alma-hidden-saved-model.skp'), false);

    const innerTimedOutMutation = await request({
      port: boundaryPort,
      method: 'POST',
      pathname: '/tools/open_model',
      headers: authorization(sessionSecret),
      body: { runtime: 'mock', path: path.join(externalRoot, 'allowed-input-model.json') }
    });
    assert.equal(innerTimedOutMutation.statusCode, 500);
    assert.equal(innerTimedOutMutation.body.error.code, 'MUTATION_EXECUTION_FAILED');
    assert.equal(innerTimedOutMutation.body.error.outcome_unknown, true);
    assert.equal(innerTimedOutMutation.body.error.next_action.retry, 'do_not_retry');
    assert.equal(innerTimeoutMutationCount, 1, 'an inner runtime timeout after dispatch must use the same outcome-unknown contract');

    const timedOutMutation = await request({
      port: boundaryPort,
      method: 'POST',
      pathname: '/tools/reset_model',
      headers: authorization(sessionSecret),
      body: { runtime: 'mock' }
    });
    assert.equal(timedOutMutation.statusCode, 500);
    assert.equal(timedOutMutation.body.error.code, 'MUTATION_EXECUTION_FAILED');
    assert.equal(timedOutMutation.body.error.outcome_unknown, true);
    assert.equal(timedOutMutation.body.outcome_unknown, true);
    assert.equal(timedOutMutation.body.error.retryable, false);
    assert.equal(timedOutMutation.body.error.next_action.retry, 'do_not_retry');
    await delay(100);
    assert.equal(lateMutationCount, 1, 'the regression fixture must prove why dispatch timeout is outcome-unknown rather than cancellation');
  } finally {
    if (boundaryServer.listening) await new Promise((resolve) => boundaryServer.close(resolve));
  }

  process.stdout.write(`${JSON.stringify({ ok: true, tools: tools.body.count, tests: 60, stable_agent_errors: true, error_next_action_sanitized: true, visual_paths_rejected: true, final_dsl_paths_fail_closed: true, output_paths_fail_closed: true, symlink_writes_fail_closed: true, derived_output_symlinks_rejected: true, compiler_limits_enforced: true, mutation_timeout_outcome_unknown: true, unsafe_http_ruby_blocked: true, source_compile_execute_blocked: true, unknown_tool_404: true }, null, 2)}\n`);
} finally {
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
}

function authorization(secret) {
  return { authorization: `Bearer ${secret}` };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function request({ port, method, pathname, headers = {}, body, rawBody }) {
  const payload = rawBody ?? (body === undefined ? null : JSON.stringify(body));
  if (port?.almaRequestHandler) {
    return requestInMemory({ server: port, method, pathname, headers, payload });
  }
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: pathname,
      headers: {
        ...headers,
        ...(payload === null ? {} : {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload)
        })
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          resolve({ statusCode: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function requestInMemory({ server: testServer, method, pathname, headers, payload }) {
  const requestHeaders = {
    ...headers,
    ...(payload === null ? {} : {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload)
    })
  };
  const requestStream = Readable.from(payload === null ? [] : [Buffer.from(payload)]);
  requestStream.method = method;
  requestStream.url = pathname;
  requestStream.headers = requestHeaders;
  return new Promise((resolve, reject) => {
    const response = {
      headersSent: false,
      destroyed: false,
      statusCode: null,
      headers: null,
      writeHead(statusCode, responseHeaders) {
        this.statusCode = statusCode;
        this.headers = responseHeaders;
        this.headersSent = true;
      },
      end(chunk = '') {
        try {
          resolve({ statusCode: this.statusCode, body: JSON.parse(String(chunk)) });
        } catch (error) {
          reject(error);
        }
      }
    };
    Promise.resolve(testServer.almaRequestHandler(requestStream, response)).catch(reject);
  });
}
