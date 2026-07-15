import { TOOL_REGISTRY } from './mcp-server.mjs';

export { TOOL_REGISTRY };

export const TOOL_NAMES = Object.freeze(TOOL_REGISTRY.map((tool) => tool.name));

export const AGENT_GATEWAY_TOOL_NAMES = Object.freeze([
  'start_agent_task',
  'resume_agent_task',
  'submit_agent_task_input',
  'read_agent_artifact'
]);

const gatewayToolNames = new Set(AGENT_GATEWAY_TOOL_NAMES);
export const EXPERT_TOOL_NAMES = Object.freeze(TOOL_NAMES.filter((name) => !gatewayToolNames.has(name)));

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
