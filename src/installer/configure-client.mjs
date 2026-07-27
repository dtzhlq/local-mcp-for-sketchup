#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mergeCodexToml,
  mergeJsonMcpConfig,
  renderManualMcpSnippet,
  stdioServerSpec
} from './agent-config.mjs';
import { mergeAgentConfigFile } from './config-writer.mjs';

const scriptPath = fileURLToPath(import.meta.url);

export function knownClientTarget(clientId, {
  homeDir = os.homedir(),
  platform = process.platform
} = {}) {
  if (clientId === 'codex') {
    return Object.freeze({
      id: clientId,
      mode: 'safe-merge',
      format: 'toml',
      configPath: path.join(homeDir, '.codex', 'config.toml'),
      allowedRoot: path.join(homeDir, '.codex')
    });
  }
  if (clientId === 'cursor') {
    return Object.freeze({
      id: clientId,
      mode: 'safe-merge',
      format: 'json',
      configPath: path.join(homeDir, '.cursor', 'mcp.json'),
      allowedRoot: path.join(homeDir, '.cursor')
    });
  }
  if (clientId === 'claude-desktop') {
    return Object.freeze({
      id: clientId,
      mode: 'manual-or-dxt',
      format: null,
      configPath: null,
      allowedRoot: null,
      reason: 'Use a reviewed Claude Desktop Extension (DXT), or follow manual instructions.'
    });
  }
  return Object.freeze({
    id: clientId || 'unknown',
    mode: 'manual',
    format: null,
    configPath: null,
    allowedRoot: null,
    reason: `No automatic configuration policy is defined for ${clientId || 'this client'}.`
  });
}

export async function configureInstalledBundle({
  bundleRoot,
  clientId,
  configPath = null,
  allowedConfigRoot = null,
  dryRun = false,
  homeDir = os.homedir(),
  platform = process.platform,
  arch = process.arch
}) {
  const root = path.resolve(String(bundleRoot || ''));
  const bundle = await readAndValidateBundle(root, { platform, arch });
  const command = path.join(root, ...bundle.entrypoint.command_relative.split('/'));
  const serverPath = path.join(root, ...bundle.entrypoint.args_relative[0].split('/'));
  await assertRegularNoSymlink(command, 'bundled Node executable');
  await assertRegularNoSymlink(serverPath, 'MCP server entrypoint');
  const spec = stdioServerSpec({ nodePath: command, serverPath });
  const target = knownClientTarget(clientId, { homeDir, platform });

  if (target.mode !== 'safe-merge') {
    return Object.freeze({
      changed: false,
      client: target.id,
      mode: target.mode,
      bundle_target: bundle.target,
      reason: target.reason,
      manual_snippet: renderManualMcpSnippet(spec)
    });
  }

  const resolvedConfig = path.resolve(configPath || target.configPath);
  const resolvedAllowedRoot = path.resolve(allowedConfigRoot || target.allowedRoot);
  const merge = target.format === 'toml'
    ? (text) => mergeCodexToml(text, spec)
    : (text) => mergeJsonMcpConfig(text, spec);
  if (dryRun) {
    return Object.freeze({
      changed: false,
      dry_run: true,
      client: target.id,
      mode: target.mode,
      format: target.format,
      config_path: resolvedConfig,
      allowed_root: resolvedAllowedRoot,
      bundle_target: bundle.target,
      manual_snippet: renderManualMcpSnippet(spec)
    });
  }
  const result = await mergeAgentConfigFile({
    configPath: resolvedConfig,
    expectedParent: resolvedAllowedRoot,
    merge
  });
  return Object.freeze({
    ...result,
    client: target.id,
    mode: target.mode,
    bundle_target: bundle.target,
    manual_snippet: renderManualMcpSnippet(spec)
  });
}

async function readAndValidateBundle(root, { platform, arch }) {
  await assertDirectoryNoSymlink(root, 'service bundle root');
  const metadataPath = path.join(root, 'bundle.json');
  await assertRegularNoSymlink(metadataPath, 'service bundle metadata');
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  if (metadata?.schema_version !== 'local-mcp-service-bundle.v1' ||
      metadata?.product !== 'local-mcp-for-sketchup') {
    throw codedError('SERVICE_BUNDLE_METADATA_INVALID', 'The service bundle metadata is not recognized.');
  }
  const expectedTarget = `${platform}-${arch}`;
  if (metadata.target !== expectedTarget) {
    throw codedError(
      'SERVICE_BUNDLE_PLATFORM_MISMATCH',
      `Bundle target ${metadata.target} cannot be configured on ${expectedTarget}.`
    );
  }
  if (!/^0\.1\.0-rc\.[0-9]+$/.test(String(metadata.version || ''))) {
    throw codedError('SERVICE_BUNDLE_VERSION_INVALID', 'The service bundle version is invalid.');
  }
  if (!metadata.entrypoint?.command_relative || metadata.entrypoint?.args_relative?.length !== 1) {
    throw codedError('SERVICE_BUNDLE_ENTRYPOINT_INVALID', 'The service bundle entrypoint is invalid.');
  }
  for (const relative of [metadata.entrypoint.command_relative, ...metadata.entrypoint.args_relative]) {
    assertSafeRelative(relative);
  }
  return metadata;
}

function assertSafeRelative(value) {
  const normalized = path.posix.normalize(String(value || ''));
  if (!normalized || normalized === '.' || normalized === '..' ||
      normalized.startsWith('../') || normalized.startsWith('/') ||
      normalized.includes('\\')) {
    throw codedError('SERVICE_BUNDLE_ENTRYPOINT_INVALID', `Unsafe bundle-relative path: ${value}`);
  }
}

async function assertDirectoryNoSymlink(filePath, label) {
  const stat = await fs.lstat(filePath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw codedError('SERVICE_BUNDLE_PATH_REJECTED', `${label} must be a non-symlink directory.`);
  }
}

async function assertRegularNoSymlink(filePath, label) {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw codedError('SERVICE_BUNDLE_PATH_REJECTED', `${label} must be a regular non-symlink file.`);
  }
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--bundle-root') options.bundleRoot = argv[++index];
    else if (argv[index] === '--client') options.clientId = argv[++index];
    else if (argv[index] === '--config-path') options.configPath = argv[++index];
    else if (argv[index] === '--allowed-config-root') options.allowedConfigRoot = argv[++index];
    else if (argv[index] === '--dry-run') options.dryRun = true;
    else if (argv[index] === '--help') {
      process.stdout.write(
        'Usage: node src/installer/configure-client.mjs --bundle-root PATH '
        + '--client codex|cursor|claude-desktop|CLIENT [--dry-run]\n'
      );
      process.exit(0);
    } else throw codedError('AGENT_CONFIG_ARGUMENT_UNKNOWN', `Unknown argument: ${argv[index]}`);
  }
  return options;
}

if (path.resolve(process.argv[1] || '') === scriptPath) {
  const result = await configureInstalledBundle(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
