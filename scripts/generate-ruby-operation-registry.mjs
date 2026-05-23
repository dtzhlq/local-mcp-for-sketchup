#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRuntimeCapabilities } from '../src/capabilities.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const defaultOutputPath = path.join(repoRoot, 'sketchup_plugin/alma_sketchup_mcp/operation_registry.rb');

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const content = buildRubyRegistry();
  if (options.check) {
    const existing = await fs.readFile(options.outputPath, 'utf8');
    if (existing !== content) {
      throw new Error(`${path.relative(repoRoot, options.outputPath)} is out of date. Run npm run registry:sync.`);
    }
    process.stdout.write(`${JSON.stringify({ ok: true, checked: path.relative(repoRoot, options.outputPath) }, null, 2)}\n`);
    return;
  }
  await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
  await fs.writeFile(options.outputPath, content, 'utf8');
  process.stdout.write(`${JSON.stringify({ ok: true, written: path.relative(repoRoot, options.outputPath) }, null, 2)}\n`);
}

function buildRubyRegistry() {
  const descriptor = getRuntimeCapabilities('queue');
  const operationSupport = Object.fromEntries(
    descriptor.supported_operations.map((operation) => [operation, descriptor.operation_support[operation]])
  );
  return [
    '# frozen_string_literal: true',
    '',
    '# Generated from src/capabilities.mjs. Run `npm run registry:sync` after editing the operation registry.',
    '',
    'module AlmaSketchupMCP',
    `  OPERATION_SUPPORT = ${rubyLiteral(operationSupport, 2)}.freeze`,
    '  SUPPORTED_OPERATIONS = OPERATION_SUPPORT.keys.freeze',
    '',
    '  def self.operation_support_descriptor',
    '    OPERATION_SUPPORT',
    '  end',
    'end',
    ''
  ].join('\n');
}

function rubyLiteral(value, depth = 0) {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every((item) => typeof item === 'string')) {
      return `[${value.map((item) => rubyString(item)).join(', ')}]`;
    }
    const indent = ' '.repeat(depth);
    const childIndent = ' '.repeat(depth + 2);
    return `[\n${value.map((item) => `${childIndent}${rubyLiteral(item, depth + 2)}`).join(",\n")}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const indent = ' '.repeat(depth);
    const childIndent = ' '.repeat(depth + 2);
    return `{\n${entries.map(([key, item]) => `${childIndent}${rubyString(key)} => ${rubyLiteral(item, depth + 2)}`).join(",\n")}\n${indent}}`;
  }
  if (typeof value === 'string') return rubyString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'nil';
  throw new Error(`Unsupported Ruby literal value: ${String(value)}`);
}

function rubyString(value) {
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function parseArgs(argv) {
  const options = {
    check: false,
    outputPath: defaultOutputPath
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') options.check = true;
    else if (arg === '--output') options.outputPath = path.resolve(argv[++index]);
    else if (arg === '--help' || arg === '-h') return usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  process.stdout.write(`Usage:\n  node scripts/generate-ruby-operation-registry.mjs [--check] [--output sketchup_plugin/alma_sketchup_mcp/operation_registry.rb]\n`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
