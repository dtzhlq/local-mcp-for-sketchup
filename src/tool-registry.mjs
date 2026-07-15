import { TOOL_REGISTRY } from './mcp-server.mjs';

export { TOOL_REGISTRY };

export const TOOL_NAMES = Object.freeze(TOOL_REGISTRY.map((tool) => tool.name));

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
