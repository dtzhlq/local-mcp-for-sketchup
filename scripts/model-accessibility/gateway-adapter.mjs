import path from 'node:path';
import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { SketchUpBridge } from '../../src/bridge.mjs';
import { defaultStateDir } from '../../src/paths.mjs';
import { AGENT_GATEWAY_TOOL_NAMES, TOOL_REGISTRY } from '../../src/tool-registry.mjs';
import { ToolInputValidator } from '../../src/tool-input-validator.mjs';
import { verifyParameterFixtureState } from './parameter-fixture-state.mjs';

// Host configuration only. The tested model has no access to this module,
// policy, filesystem, setup tools or a trusted decision callback.
const validator = new ToolInputValidator(TOOL_REGISTRY.filter(tool => AGENT_GATEWAY_TOOL_NAMES.includes(tool.name)));
export function gatewayHostOptions(options = {}, env = process.env) {
  const root = options.stateRoot ?? env.MODEL_ACCESSIBILITY_STATE_ROOT;
  if (!root || !path.isAbsolute(root)) throw new Error('The host must supply an absolute MODEL_ACCESSIBILITY_STATE_ROOT for this independent run.');
  const runtime = options.runtime ?? env.MODEL_ACCESSIBILITY_RUNTIME ?? 'mock';
  if (!['mock', 'queue'].includes(runtime)) throw new Error('MODEL_ACCESSIBILITY_RUNTIME must be mock or queue.');
  const live = runtime === 'queue';
  const initializedFixture = options.initializedFixtureStateRoot ?? env.MODEL_ACCESSIBILITY_INITIALIZED_FIXTURE_STATE_ROOT;
  if (initializedFixture && (!path.isAbsolute(initializedFixture) || path.resolve(initializedFixture) !== path.resolve(root))) throw new Error('Initialized fixture state must be the exact explicit host state root.');
  const approvalOverride = options.approvalStateDir ?? env.MODEL_ACCESSIBILITY_APPROVAL_STATE_DIR;
  if (approvalOverride && !path.isAbsolute(approvalOverride)) throw new Error('Approval state directory must be an absolute host path.');
  const isolatedApproval = path.join(root, 'approval');
  if (!live && approvalOverride && path.resolve(approvalOverride) !== path.resolve(isolatedApproval)) throw new Error('Mock runs cannot share the live approval state directory.');
  return { root, runtime, initializedFixture: Boolean(initializedFixture), bridgeOptions: { mock: { sessionPath: path.join(root, 'mock.json') },
    ...((options.assetCatalogPath ?? env.SKETCHUP_MCP_ASSET_CATALOG_PATH) ? { assetCatalogPath: options.assetCatalogPath ?? env.SKETCHUP_MCP_ASSET_CATALOG_PATH } : {}),
    agentContract: { rootDir: path.join(root, 'tasks') },
    approval: { stateDir: live ? approvalOverride || path.join(defaultStateDir, 'agent-contract-v1', 'approvals') : isolatedApproval,
      ...((options.approvalHostUrl ?? env.MODEL_ACCESSIBILITY_APPROVAL_HOST_URL) ? { approvalHostUrl: options.approvalHostUrl ?? env.MODEL_ACCESSIBILITY_APPROVAL_HOST_URL } : {}) },
    executionPolicy: { allowed_runtimes: live ? ['mock', 'queue'] : ['mock'], allow_queue_mutation: live,
      allow_direct_expert_queue_mutation: false, auto_approve_risks: [] } } };
}

// This factory and its status methods are host-only, never provider tools.
// The injectable constructor is for isolated tests; no decision issuer exists.
export function createGatewayAdapter(options = {}, { createBridge = config => new SketchUpBridge(config), env = process.env } = {}) {
  const config = gatewayHostOptions(options, env);
  const observedTasks = new Set();
  let bridgePromise;
  const getBridge = () => bridgePromise ||= (async () => {
    if (!config.initializedFixture) await fs.mkdir(config.root, { recursive: false });
    else { const stat = await fs.lstat(config.root); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Initialized fixture state root must be an existing ordinary directory.'); }
    const bridge = createBridge(config.bridgeOptions);
    if (config.initializedFixture) await verifyParameterFixtureState({ bridge, stateRoot: config.root, runtime: config.runtime });
    return bridge;
  })();
  const api = {
    async callGateway(name, args, { signal } = {}) {
      signal?.throwIfAborted();
      validator.validate(name, args);
      const target = await getBridge();
      const result = await target[name](args);
      if (/^task_[0-9a-f-]+$/i.test(result?.task_id || '')) observedTasks.add(result.task_id);
      return result;
    },
    async readApprovalStatus({ taskId, signal } = {}) {
      signal?.throwIfAborted();
      if (!observedTasks.has(taskId)) throw new Error('Approval status may only follow a task returned during this run.');
      const target = await getBridge();
      try {
        // Verifies server-private plan/challenge HMAC and the stored user
        // decision, including parameter-parent -> reviewed-child binding.
        // It neither refreshes task state nor consumes/returns an approval token.
        const ready = await target.verify_agent_task_authorization_ready({ task_id: taskId });
        if (ready.ok !== true || ready.task_id !== taskId || ready.approval_status !== 'approved_pending_execution' || ready.approval_token_exposed !== false || !ready.decision_id || !ready.challenge_id) {
          return { task_id: taskId, status: 'blocked', code: 'UNEXPECTED_AUTHORIZATION_READINESS' };
        }
        return { task_id: taskId, status: 'approved', approval_status: ready.approval_status, challenge_id: ready.challenge_id, decision_id: ready.decision_id };
      } catch (error) {
        const code = error.code || 'APPROVAL_READ_ERROR';
        const status = code === 'APPROVAL_REQUIRED' ? 'pending' : code === 'APPROVAL_EXPIRED' ? 'expired'
          : code === 'POLICY_DENIED' && error.next_action?.reason === 'trusted_user_rejected' ? 'rejected' : 'blocked';
        return { task_id: taskId, status, code };
      }
    },
    async waitForApproval({ taskId, signal, timeoutMs = 600_000, pollMs = 1000 } = {}) {
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 900_000 || !Number.isSafeInteger(pollMs) || pollMs < 1 || pollMs > 5000) throw new Error('Approval wait requires bounded positive timeout/poll milliseconds.');
      const deadline = Date.now() + timeoutMs;
      do {
        const status = await api.readApprovalStatus({ taskId, signal });
        if (status.status !== 'pending') return status;
        const remaining = deadline - Date.now();
        if (remaining <= 0) return { ...status, status: 'timeout' };
        await delay(Math.min(pollMs, remaining), undefined, { signal });
      } while (true);
    }
  };
  return api;
}

let singleton;
const adapter = () => singleton ||= createGatewayAdapter();
export const callGateway = (...args) => adapter().callGateway(...args);
export const waitForApproval = (...args) => adapter().waitForApproval(...args);
