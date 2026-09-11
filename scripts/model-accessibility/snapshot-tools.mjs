#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { GATEWAY_TOOLS } from './agent-loop.mjs';
import { objectHash, ROOT, sha256 } from './benchmark.mjs';

const execute = promisify(execFile);
function literal(node) {
  if (node.type === 'Literal') return node.value;
  if (node.type === 'ArrayExpression') return node.elements.map(literal);
  if (node.type === 'ObjectExpression') return Object.fromEntries(node.properties.map((property) => {
    if (property.type !== 'Property' || property.computed || property.kind !== 'init') throw new Error('Nonliteral tool definition rejected');
    return [property.key.name ?? property.key.value, literal(property.value)];
  }));
  if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'Literal') return -node.argument.value;
  throw new Error(`Public tool schema requires unsupported expression ${node.type}; inspect explicitly before exporting`);
}

export function extractGatewayDefinitions(source) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const declarations = ast.body.filter((node) => node.type === 'VariableDeclaration').flatMap((node) => node.declarations);
  const registry = declarations.find((node) => node.id?.name === 'BASE_TOOL_REGISTRY')?.init;
  if (registry?.type !== 'ArrayExpression') throw new Error('Expected static BASE_TOOL_REGISTRY declaration');
  const selected = registry.elements.filter((node) => node.type === 'ObjectExpression' && node.properties.some((property) => property.key?.name === 'name' && GATEWAY_TOOLS.includes(property.value?.value))).map(literal);
  if (selected.length !== 4 || !GATEWAY_TOOLS.every((name) => selected.some((tool) => tool.name === name))) throw new Error('Four original Gateway tools were not found');
  const mutating = declarations.find((node) => node.id?.name === 'LIVE_MUTATING_TOOL_NAMES')?.init;
  if (mutating?.type !== 'NewExpression' || mutating.callee.name !== 'Set' || mutating.arguments.length !== 1) throw new Error('Cannot verify registry augmentation');
  if (literal(mutating.arguments[0]).some((name) => GATEWAY_TOOLS.includes(name))) throw new Error('Gateway schema now receives runtime augmentation; exporter requires review');
  return selected;
}

export async function snapshotTools({ revision = 'working-tree', outputDir }) {
  let source;
  let resolved;
  if (revision === 'working-tree') { source = await fs.readFile(path.join(ROOT, 'src/mcp-server.mjs'), 'utf8'); resolved = 'working-tree'; }
  else {
    if (revision !== 'de7d482') throw new Error('Only the designated baseline de7d482 is allowed');
    resolved = (await execute('git', ['rev-parse', '--verify', 'de7d482^{commit}'], { cwd: ROOT })).stdout.trim();
    source = (await execute('git', ['show', `${resolved}:src/mcp-server.mjs`], { cwd: ROOT, maxBuffer: 4 * 1024 * 1024 })).stdout;
  }
  const tools = extractGatewayDefinitions(source);
  await fs.mkdir(outputDir, { recursive: false });
  await fs.writeFile(path.join(outputDir, 'mcp-server.source.mjs'), source, { flag: 'wx' });
  await fs.writeFile(path.join(outputDir, 'tools.json'), `${JSON.stringify(tools, null, 2)}\n`, { flag: 'wx' });
  const manifest = { schema_version: 'model-accessibility-tools-snapshot.v1', source_revision: resolved, source_path: 'src/mcp-server.mjs', source_sha256: sha256(source), mcp_description_sha256: objectHash(tools), tool_names: tools.map((tool) => tool.name), source_executed: false, native_runtime_called: false, source_checkout_modified: false };
  await fs.writeFile(path.join(outputDir, 'snapshot.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return manifest;
}

async function main() {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) options[process.argv[i].slice(2)] = process.argv[i + 1];
  if (!options['output-dir']) throw new Error('A new --output-dir is required');
  process.stdout.write(`${JSON.stringify(await snapshotTools({ revision: options.revision, outputDir: path.resolve(options['output-dir']) }), null, 2)}\n`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
