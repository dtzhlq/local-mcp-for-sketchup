#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const PLUGIN_FILES = [
  { source: 'sketchup_plugin/alma_sketchup_mcp.rb', target: 'alma_sketchup_mcp.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/operation_registry.rb', target: 'alma_sketchup_mcp/operation_registry.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/object_operations.rb', target: 'alma_sketchup_mcp/object_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/materials.rb', target: 'alma_sketchup_mcp/materials.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/geometry_operations.rb', target: 'alma_sketchup_mcp/geometry_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/primitive_operations.rb', target: 'alma_sketchup_mcp/primitive_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/product_operations.rb', target: 'alma_sketchup_mcp/product_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/profile_operations.rb', target: 'alma_sketchup_mcp/profile_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/surface_operations.rb', target: 'alma_sketchup_mcp/surface_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/feature_operations.rb', target: 'alma_sketchup_mcp/feature_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/boolean_operations.rb', target: 'alma_sketchup_mcp/boolean_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/demo_operations.rb', target: 'alma_sketchup_mcp/demo_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/architecture_operations.rb', target: 'alma_sketchup_mcp/architecture_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/component_operations.rb', target: 'alma_sketchup_mcp/component_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/view_operations.rb', target: 'alma_sketchup_mcp/view_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/snapshot.rb', target: 'alma_sketchup_mcp/snapshot.rb' }
];

const DEFAULT_PLUGIN_DIR = path.join(homedir(), 'Library/Application Support/SketchUp 2026/SketchUp/Plugins');
const DEFAULT_OUTPUT_DIR = 'out/releases';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const version = await pluginVersion();
  const summary = { version, checked: false, installed: false, packaged: false };

  if (options.check) {
    await checkSourceFiles();
    summary.checked = true;
  }
  if (options.install) {
    await installPlugin(options.pluginDir);
    await checkInstalledFiles(options.pluginDir);
    summary.installed = true;
    summary.plugin_dir = options.pluginDir;
  }
  if (options.package) {
    summary.package_path = await packagePlugin(version, options.outputDir);
    summary.packaged = true;
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

async function pluginVersion() {
  const source = await fs.readFile('sketchup_plugin/alma_sketchup_mcp.rb', 'utf8');
  const match = source.match(/PLUGIN_VERSION = '([^']+)'/);
  if (!match) throw new Error('Could not find PLUGIN_VERSION in sketchup_plugin/alma_sketchup_mcp.rb');
  return match[1];
}

async function checkSourceFiles() {
  for (const file of PLUGIN_FILES) {
    await assertFile(file.source);
    runRubySyntax(file.source);
  }
}

async function installPlugin(pluginDir) {
  for (const file of PLUGIN_FILES) {
    const target = path.join(pluginDir, file.target);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(file.source, target);
  }
}

async function checkInstalledFiles(pluginDir) {
  for (const file of PLUGIN_FILES) {
    const target = path.join(pluginDir, file.target);
    await assertFile(target);
    runRubySyntax(target);
  }
}

async function packagePlugin(version, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  const packagePath = path.join(outputDir, `alma-sketchup-mcp-${safeName(version)}.rbz`);
  const stageDir = path.join(outputDir, `.stage-${Date.now()}`);
  await fs.rm(stageDir, { recursive: true, force: true });
  await fs.mkdir(stageDir, { recursive: true });
  try {
    for (const file of PLUGIN_FILES) {
      const target = path.join(stageDir, file.target);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(file.source, target);
    }
    await fs.rm(packagePath, { force: true });
    const result = spawnSync('zip', ['-qr', path.resolve(packagePath), ...PLUGIN_FILES.map((file) => file.target)], {
      cwd: stageDir,
      encoding: 'utf8'
    });
    if (result.status !== 0) {
      throw new Error(`zip failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
    }
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true });
  }
  return packagePath;
}

async function assertFile(filePath) {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) throw new Error(`Missing plugin file: ${filePath}`);
}

function runRubySyntax(filePath) {
  const result = spawnSync('ruby', ['-c', filePath], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Ruby syntax check failed for ${filePath}:\n${result.stderr || result.stdout}`);
  }
}

function safeName(value) {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, '-');
}

function parseArgs(argv) {
  const options = {
    check: false,
    install: false,
    package: false,
    pluginDir: DEFAULT_PLUGIN_DIR,
    outputDir: DEFAULT_OUTPUT_DIR
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') options.check = true;
    else if (arg === '--install') options.install = true;
    else if (arg === '--package') options.package = true;
    else if (arg === '--all') {
      options.check = true;
      options.install = true;
      options.package = true;
    } else if (arg === '--plugin-dir') options.pluginDir = argv[++index];
    else if (arg === '--output-dir') options.outputDir = argv[++index];
    else if (arg === '--help' || arg === '-h') return usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.check && !options.install && !options.package) options.check = true;
  return options;
}

function usage() {
  process.stdout.write(`Usage:
  node scripts/package-sketchup-plugin.mjs --check
  node scripts/package-sketchup-plugin.mjs --check --install
  node scripts/package-sketchup-plugin.mjs --check --package
  node scripts/package-sketchup-plugin.mjs --all
`);
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
