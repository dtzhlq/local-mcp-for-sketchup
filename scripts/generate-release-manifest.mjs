#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getComponentDefinitionOperationNames, getOperationNames } from '../src/capabilities.mjs';
import { EXPERT_TOOL_NAMES, TOOL_NAMES } from '../src/tool-registry.mjs';

const options = parseArgs(process.argv.slice(2));
const packageJson = JSON.parse(await fs.readFile('package.json', 'utf8'));
const pluginSource = await fs.readFile('sketchup_plugin/alma_sketchup_mcp.rb', 'utf8');
const pluginVersion = pluginSource.match(/PLUGIN_VERSION = '([^']+)'/)?.[1];
if (!pluginVersion) throw new Error('Could not read PLUGIN_VERSION');
if (pluginVersion !== packageJson.version) {
  throw new Error(`Version mismatch: package=${packageJson.version}, plugin=${pluginVersion}`);
}

const releaseDir = path.resolve(options.outputDir || 'out/releases');
const rbzPath = path.resolve(options.rbz || path.join(releaseDir, `alma-sketchup-mcp-${pluginVersion}.rbz`));
const rbz = await fs.readFile(rbzPath);
const sha256 = crypto.createHash('sha256').update(rbz).digest('hex');
const shaPath = path.join(releaseDir, `alma-sketchup-mcp-${pluginVersion}.sha256`);
const manifestPath = path.join(releaseDir, `release-manifest-${pluginVersion}.json`);
const liveStatus = options.liveStatus || 'unverified';
if (!['passed', 'blocked', 'unverified'].includes(liveStatus)) throw new Error(`Invalid --live-status: ${liveStatus}`);
const registeredOperations = getOperationNames().length;
const componentScopeOperations = getComponentDefinitionOperationNames().length;

const manifest = {
  version: 1,
  kind: 'sketchup_mcp_release_manifest',
  product_version: packageJson.version,
  plugin_version: pluginVersion,
  created_at: new Date().toISOString(),
  git: {
    head: git('rev-parse', 'HEAD'),
    branch: git('branch', '--show-current')
  },
  release_status: liveStatus === 'passed' ? 'rc_candidate_verified' : 'blocked_live_queue',
  rc_signed: liveStatus === 'passed',
  contracts: {
    mcp_tools: TOOL_NAMES.length,
    expert_tools: EXPERT_TOOL_NAMES.length,
    registered_operations: registeredOperations,
    component_scope_operations: componentScopeOperations
  },
  offline_gates: options.offlineGates,
  live_queue: {
    status: liveStatus,
    reason: options.liveReason || null,
    fresh_handshake_required: true
  },
  artifacts: {
    rbz: path.relative(process.cwd(), rbzPath),
    rbz_size_bytes: rbz.byteLength,
    rbz_sha256: sha256,
    sha256_file: path.relative(process.cwd(), shaPath)
  }
};

await fs.mkdir(releaseDir, { recursive: true });
await fs.writeFile(shaPath, `${sha256}  ${path.basename(rbzPath)}\n`, 'utf8');
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ ok: true, manifest: manifestPath, sha256_file: shaPath, release_status: manifest.release_status, rc_signed: manifest.rc_signed }, null, 2)}\n`);

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function parseArgs(argv) {
  const result = { offlineGates: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output-dir') result.outputDir = argv[++index];
    else if (arg === '--rbz') result.rbz = argv[++index];
    else if (arg === '--live-status') result.liveStatus = argv[++index];
    else if (arg === '--live-reason') result.liveReason = argv[++index];
    else if (arg === '--offline-gate') result.offlineGates.push(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}
