#!/usr/bin/env node
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mergeCodexToml,
  mergeJsonMcpConfig,
  renderManualMcpSnippet,
  stdioServerSpec
} from './agent-config.mjs';
import { mergeAgentConfigFile } from './config-writer.mjs';
import { knownClientTarget } from './configure-client.mjs';
import { verifySourcePreview } from './source-preview.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), '..', '..');

export async function configureSourcePreview({
  checkoutRoot = defaultRoot,
  clientId,
  apply = false,
  homeDir = os.homedir(),
  platform = process.platform,
  arch = process.arch,
  nodeVersion = process.versions.node,
  requireGitProvenance = true,
  runHandshake = true
} = {}) {
  if (!clientId) throw codedError('SOURCE_PREVIEW_CLIENT_REQUIRED', '--client is required.');
  const verified = await verifySourcePreview({
    checkoutRoot,
    requireGitProvenance,
    runHandshake,
    platform,
    arch,
    nodeVersion
  });
  const spec = stdioServerSpec({ nodePath: process.execPath, serverPath: verified.server_path });
  const target = knownClientTarget(clientId, { homeDir, platform });

  if (target.mode !== 'safe-merge') {
    return Object.freeze({
      ok: true,
      channel: verified.channel,
      source_commit: verified.git.commit || null,
      tools_verified: verified.mcp_stdio.tools,
      changed: false,
      client: target.id,
      mode: target.mode,
      reason: target.reason,
      manual_snippet: renderManualMcpSnippet(spec),
      restart_client_required: true,
      live_sketchup_verified: false,
      release_acceptance: false
    });
  }

  const merge = target.format === 'toml'
    ? (text) => mergeCodexToml(text, spec)
    : (text) => mergeJsonMcpConfig(text, spec);
  if (!apply) {
    return Object.freeze({
      ok: true,
      channel: verified.channel,
      source_commit: verified.git.commit || null,
      tools_verified: verified.mcp_stdio.tools,
      changed: false,
      dry_run: true,
      client: target.id,
      mode: target.mode,
      format: target.format,
      config_path: target.configPath,
      manual_snippet: renderManualMcpSnippet(spec),
      next_action: `Re-run with --client ${target.id} --apply after reviewing this path and snippet.`,
      live_sketchup_verified: false,
      release_acceptance: false
    });
  }

  const result = await mergeAgentConfigFile({
    configPath: target.configPath,
    expectedParent: target.allowedRoot,
    merge
  });
  return Object.freeze({
    ok: true,
    channel: verified.channel,
    source_commit: verified.git.commit || null,
    tools_verified: verified.mcp_stdio.tools,
    ...result,
    client: target.id,
    mode: target.mode,
    manual_snippet: renderManualMcpSnippet(spec),
    restart_client_required: true,
    live_sketchup_verified: false,
    release_acceptance: false
  });
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseArgs(argv) {
  let checkoutRoot = defaultRoot;
  let clientId = null;
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--checkout-root') checkoutRoot = argv[++index];
    else if (argv[index] === '--client') clientId = argv[++index];
    else if (argv[index] === '--apply') apply = true;
    else if (argv[index] === '--help') {
      process.stdout.write(
        'Usage: node src/installer/configure-source-preview.mjs '
        + '--client codex|cursor|claude-desktop|CLIENT [--checkout-root PATH] [--apply]\n'
      );
      process.exit(0);
    } else throw codedError('SOURCE_PREVIEW_ARGUMENT_UNKNOWN', `Unknown argument: ${argv[index]}`);
  }
  return { checkoutRoot, clientId, apply };
}

const invokedPath = await fs.realpath(path.resolve(process.argv[1] || '')).catch(() => path.resolve(process.argv[1] || ''));
if (invokedPath === scriptPath) {
  const result = await configureSourcePreview(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
