import { TOOL_REGISTRY } from './tool-definitions.mjs';

export { TOOL_REGISTRY };

export const TOOL_NAMES = Object.freeze(TOOL_REGISTRY.map((tool) => tool.name));

export const AGENT_GATEWAY_TOOL_NAMES = Object.freeze([
  'start_agent_task',
  'resume_agent_task',
  'submit_agent_task_input',
  'read_agent_artifact'
]);

export const SESSION_CONTRACT_TOOL_NAMES = Object.freeze(['create_queue_handshake']);

export const TOOL_EFFECT_CONTRACT_VERSION = 'tool-effect.v1';
const SIDE_EFFECT_FREE_TOOL_NAMES = new Set(TOOL_REGISTRY.filter(tool=>tool.annotations.readOnlyHint).map(tool=>tool.name));

export const TOOL_EFFECTS = Object.freeze(Object.fromEntries(TOOL_NAMES.map((name) => [name, Object.freeze({
  version: TOOL_EFFECT_CONTRACT_VERSION,
  effect: SIDE_EFFECT_FREE_TOOL_NAMES.has(name) ? 'none' : 'persistent_or_unknown',
  timeout_outcome: SIDE_EFFECT_FREE_TOOL_NAMES.has(name) ? 'no_persistent_effect_expected' : 'unknown_do_not_retry'
})])));

const gatewayToolNames = new Set(AGENT_GATEWAY_TOOL_NAMES);
const sessionContractToolNames = new Set(SESSION_CONTRACT_TOOL_NAMES);
export const EXPERT_TOOL_NAMES = Object.freeze(TOOL_NAMES.filter((name) => !gatewayToolNames.has(name) && !sessionContractToolNames.has(name)));

const toolByName = new Map(TOOL_REGISTRY.map((tool) => [tool.name, tool]));

export function getToolDefinition(name) {
  return toolByName.get(name) || null;
}

export function listToolDefinitions() {
  return TOOL_REGISTRY;
}

export function listToolNames() {
  return TOOL_NAMES;
}

export function getToolEffect(name) {
  return TOOL_EFFECTS[name] || Object.freeze({
    version: TOOL_EFFECT_CONTRACT_VERSION,
    effect: 'persistent_or_unknown',
    timeout_outcome: 'unknown_do_not_retry'
  });
}
