export const SERVER_ID = 'local-mcp-for-sketchup';

export function stdioServerSpec({ nodePath, serverPath }) {
  if (!absoluteLike(nodePath) || !absoluteLike(serverPath)) {
    throw codedError('AGENT_CONFIG_ABSOLUTE_PATH_REQUIRED', 'Bundled Node and MCP server paths must be absolute.');
  }
  return Object.freeze({
    command: nodePath,
    args: [serverPath]
  });
}

export function mergeJsonMcpConfig(existingText, spec, {
  serverId = SERVER_ID
} = {}) {
  const current = parseJsonConfig(existingText);
  const servers = current.mcpServers;
  if (servers !== undefined && (!servers || typeof servers !== 'object' || Array.isArray(servers))) {
    throw codedError('AGENT_CONFIG_INVALID', 'mcpServers must be a JSON object.');
  }
  const nextServers = servers || {};
  const existing = nextServers[serverId];
  if (existing !== undefined) {
    if (stableJson(existing) === stableJson(spec)) {
      return { changed: false, text: normalizedJson(current), format: 'json', server_id: serverId };
    }
    throw codedError(
      'AGENT_CONFIG_CONFLICT',
      `Refusing to replace the existing ${serverId} MCP server entry.`
    );
  }
  const next = {
    ...current,
    mcpServers: {
      ...nextServers,
      [serverId]: spec
    }
  };
  return { changed: true, text: normalizedJson(next), format: 'json', server_id: serverId };
}

export function mergeCodexToml(existingText, spec, {
  serverId = SERVER_ID
} = {}) {
  const source = String(existingText || '');
  const header = `[mcp_servers.${serverId}]`;
  const table = renderCodexTomlTable(spec, serverId);
  const block = [
    '# Managed by Local MCP for SketchUp. The installer refuses to overwrite a conflicting entry.',
    table
  ].join('\n');
  const start = source.indexOf(header);
  if (start >= 0) {
    const remainder = source.slice(start + header.length);
    const nextHeader = remainder.search(/^\s*\[[^\]\r\n]+\]\s*$/m);
    const end = nextHeader >= 0 ? start + header.length + nextHeader : source.length;
    const existingBlock = source.slice(start, end).trim();
    if (existingBlock === table.trim()) {
      return { changed: false, text: source, format: 'toml', server_id: serverId };
    }
    throw codedError(
      'AGENT_CONFIG_CONFLICT',
      `Refusing to replace the existing ${serverId} MCP server table.`
    );
  }

  const separator = source.length === 0
    ? ''
    : source.endsWith('\n\n')
      ? ''
      : source.endsWith('\n')
        ? '\n'
        : '\n\n';
  return {
    changed: true,
    text: `${source}${separator}${block}\n`,
    format: 'toml',
    server_id: serverId
  };
}

export function renderManualMcpSnippet(spec, {
  serverId = SERVER_ID
} = {}) {
  return normalizedJson({
    mcpServers: {
      [serverId]: spec
    }
  });
}

function renderCodexTomlTable(spec, serverId) {
  return [
    `[mcp_servers.${serverId}]`,
    `command = ${tomlString(spec.command)}`,
    `args = [${spec.args.map(tomlString).join(', ')}]`
  ].join('\n');
}

function parseJsonConfig(text) {
  const source = String(text || '').trim();
  if (!source) return {};
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw codedError('AGENT_CONFIG_INVALID', `Agent JSON configuration is invalid: ${error.message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw codedError('AGENT_CONFIG_INVALID', 'Agent JSON configuration root must be an object.');
  }
  return value;
}

function normalizedJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function absoluteLike(value) {
  return typeof value === 'string' && (
    value.startsWith('/') ||
    /^[a-zA-Z]:[\\/]/.test(value)
  );
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
