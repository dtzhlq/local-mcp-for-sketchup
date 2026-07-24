#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { callTool, SketchUpBridge } from '../src/bridge.mjs';
import { AGENT_GATEWAY_TOOL_NAMES, listToolDefinitions } from '../src/tool-registry.mjs';
import { ToolInputValidator } from '../src/tool-input-validator.mjs';

const L0_CLIENT_CAPABILITIES = Object.freeze({
  vision: false,
  local_files: false,
  structured_output: false,
  context: 'short',
  parallel: false
});
const probeRoot = await resolveProbeRoot(process.env.ALMA_INDEPENDENT_AGENT_PROBE_ROOT);
const allowedTools = new Set(AGENT_GATEWAY_TOOL_NAMES);
const auditPath = path.join(probeRoot, 'tool-audit.jsonl');
const validator = new ToolInputValidator(listToolDefinitions());

process.exitCode = await main();

async function main() {
  const [tool = '', rawArgs = '{}'] = process.argv.slice(2);
  let requestedArgs;
  try {
    requestedArgs = JSON.parse(rawArgs);
  } catch {
    await respond(tool, null, null, {
      ok: false,
      error: {
        code: 'INVALID_JSON_ARGUMENTS',
        message: 'The second CLI argument must be one JSON object.',
        retryable: false,
        next_action: { action: 'retry_with_valid_json_object' }
      }
    });
    return 2;
  }

  if (!requestedArgs || Array.isArray(requestedArgs) || typeof requestedArgs !== 'object') {
    await respond(tool, requestedArgs, null, {
      ok: false,
      error: {
        code: 'INVALID_JSON_ARGUMENTS',
        message: 'The second CLI argument must be one JSON object.',
        retryable: false,
        next_action: { action: 'retry_with_valid_json_object' }
      }
    });
    return 2;
  }

  if (!allowedTools.has(tool)) {
    await respond(tool, requestedArgs, null, {
      ok: false,
      error: {
        code: 'TOOL_NOT_ALLOWED',
        message: `Independent Agent probe permits only: ${[...allowedTools].join(', ')}`,
        retryable: false,
        next_action: { action: 'use_agent_gateway_tool_surface' }
      }
    });
    return 2;
  }

  const args = trustedProbeArguments(tool, requestedArgs);
  const bridge = new SketchUpBridge({
    mock: { sessionPath: path.join(probeRoot, 'mock-session.json') },
    agentContract: { rootDir: path.join(probeRoot, 'agent-state') },
    approval: {
      stateDir: path.join(probeRoot, 'approvals'),
      secret: 'independent-agent-probe-local-secret-at-least-32-bytes'
    },
    executionPolicy: {
      allowed_runtimes: ['mock'],
      allow_queue_mutation: false,
      allow_direct_expert_queue_mutation: false,
      auto_approve_risks: []
    }
  });
  let result;
  try {
    validator.validate(tool, args);
    result = await callTool(tool, args, bridge);
  } catch (error) {
    result = {
      contract_version: 'agent-contract.v1',
      kind: 'agent_result_envelope',
      ok: false,
      task_id: typeof args?.task_id === 'string' ? args.task_id : null,
      task_state: 'failed',
      retryable: error?.retryable === true,
      idempotent_replay: false,
      result: null,
      data: null,
      warnings: [],
      error: {
        code: String(error?.code || 'INTERNAL_ERROR'),
        message: safeMessage(error),
        retryable: error?.retryable === true,
        next_action: error?.next_action || { action: 'inspect_error_and_retry_if_safe' }
      },
      next_action: error?.next_action || null,
      artifacts: []
    };
  }
  await respond(tool, requestedArgs, args, result);
  return result?.ok === false ? 2 : 0;
}

async function respond(toolName, requestedArgs, dispatchedArgs, value) {
  const auditState = await nextAuditState(auditPath);
  const artifact = value?.data?.artifact || value?.result?.artifact || null;
  const auditCore = {
    version: 'independent-agent-tool-audit-event.v1',
    sequence: auditState.sequence,
    previous_event_hash: auditState.previous_event_hash,
    called_at: new Date().toISOString(),
    tool: String(toolName || ''),
    requested_args_hash: requestedArgs && typeof requestedArgs === 'object'
      ? sha256Canonical(requestedArgs)
      : null,
    dispatched_args_hash: dispatchedArgs && typeof dispatchedArgs === 'object'
      ? sha256Canonical(dispatchedArgs)
      : null,
    trusted_profile: 'L0',
    runtime: dispatchedArgs?.inputs?.runtime || null,
    idempotency_key: typeof dispatchedArgs?.idempotency_key === 'string'
      ? dispatchedArgs.idempotency_key
      : null,
    task_id: typeof value?.task_id === 'string'
      ? value.task_id
      : (typeof dispatchedArgs?.task_id === 'string' ? dispatchedArgs.task_id : null),
    ok: value?.ok === true,
    task_state: typeof value?.task_state === 'string' ? value.task_state : null,
    idempotent_replay: value?.idempotent_replay === true,
    error_code: value?.error?.code || null,
    result_kind: value?.data?.kind || value?.result?.kind || null,
    full_result_artifact: value?.presentation?.full_result_artifact
      || value?.data?.full_result_artifact
      || value?.result?.full_result_artifact
      || null,
    artifact_handle: typeof dispatchedArgs?.handle === 'string' ? dispatchedArgs.handle : null,
    artifact_max_chars: Number.isInteger(dispatchedArgs?.max_chars) ? dispatchedArgs.max_chars : null,
    artifact_kind: typeof artifact?.kind === 'string' ? artifact.kind : null,
    artifact_encoding: typeof artifact?.encoding === 'string' ? artifact.encoding : null,
    artifact_offset: Number.isInteger(artifact?.offset) ? artifact.offset : null,
    artifact_next_offset: Number.isInteger(artifact?.next_offset) ? artifact.next_offset : null,
    artifact_total_chars: Number.isInteger(artifact?.total_chars) ? artifact.total_chars : null,
    artifact_eof: artifact?.eof === true,
    artifact_content_present: typeof artifact?.content === 'string',
    artifact_content_chars: typeof artifact?.content === 'string' ? artifact.content.length : null,
    artifact_content_omitted_for_capability: artifact?.content_omitted_for_capability === true,
    response_hash: sha256Canonical(value)
  };
  const eventHash = sha256Canonical(auditCore);
  await fs.appendFile(
    auditPath,
    `${JSON.stringify({ ...auditCore, event_hash: eventHash })}\n`,
    { encoding: 'utf8', mode: 0o600 }
  );
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function trustedProbeArguments(toolName, requestedArgs) {
  const args = structuredClone(requestedArgs);
  if (toolName !== 'start_agent_task') return args;
  return {
    ...args,
    interface_level: 'guided',
    client_capabilities: structuredClone(L0_CLIENT_CAPABILITIES)
  };
}

async function resolveProbeRoot(value) {
  if (!value) throw new Error('ALMA_INDEPENDENT_AGENT_PROBE_ROOT is required.');
  const root = path.resolve(value);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error('Independent Agent probe root must be an existing directory.');
  return fs.realpath(root);
}

async function nextAuditState(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    if (lines.length === 0) return { sequence: 1, previous_event_hash: null };
    const previous = JSON.parse(lines.at(-1));
    return {
      sequence: lines.length + 1,
      previous_event_hash: typeof previous?.event_hash === 'string' ? previous.event_hash : null
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { sequence: 1, previous_event_hash: null };
    throw error;
  }
}

function sha256Canonical(value) {
  return `sha256:${crypto.createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function safeMessage(error) {
  return String(error?.message || error || 'Unknown error')
    .replaceAll(/hmac_sha256:[A-Za-z0-9_-]+/g, 'hmac_sha256:[redacted]')
    .replaceAll(/(token|secret)=\S+/gi, '$1=[redacted]')
    .slice(0, 600);
}
