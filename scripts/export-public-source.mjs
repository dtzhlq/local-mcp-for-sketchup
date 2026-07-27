#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');

export async function exportPublicSource({
  outputDir,
  allowlistPath = path.join(repoRoot, 'release', 'public-source-allowlist.txt'),
  sourceRoot = repoRoot
}) {
  if (!outputDir) throw codedError('PUBLIC_EXPORT_OUTPUT_REQUIRED', '--output-dir is required.');
  const root = path.resolve(sourceRoot);
  const destinationRoot = path.resolve(outputDir);
  assertOutsideSource(root, destinationRoot);
  await assertAbsent(destinationRoot);

  const allowlist = await parseAllowlist(allowlistPath);
  const planned = [];
  const seenDestinations = new Set();
  for (const entry of allowlist) {
    const source = resolveInside(root, entry.source);
    const stat = await fs.lstat(source);
    if (stat.isSymbolicLink()) {
      throw codedError('PUBLIC_EXPORT_SYMLINK_REJECTED', `Allowlisted source is a symbolic link: ${entry.source}`);
    }
    if (stat.isDirectory()) {
      if (entry.destination !== entry.source) {
        throw codedError('PUBLIC_EXPORT_DIRECTORY_MAPPING_REJECTED', `Directory mappings are not supported: ${entry.source}`);
      }
      for (const file of await listRegularFiles(source, root)) {
        addPlan(planned, seenDestinations, file, file);
      }
    } else if (stat.isFile()) {
      addPlan(planned, seenDestinations, entry.source, entry.destination);
    } else {
      throw codedError('PUBLIC_EXPORT_SOURCE_TYPE_REJECTED', `Allowlisted source is not a regular file or directory: ${entry.source}`);
    }
  }

  await fs.mkdir(destinationRoot, { recursive: false, mode: 0o755 });
  let bytes = 0;
  try {
    for (const item of planned.sort((a, b) => a.destination.localeCompare(b.destination))) {
      const source = resolveInside(root, item.source);
      const destination = resolveInside(destinationRoot, item.destination);
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
      await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
      const stat = await fs.stat(destination);
      bytes += stat.size;
      await fs.chmod(destination, stat.mode & 0o111 ? 0o755 : 0o644);
    }
  } catch (error) {
    error.message = `Public export stopped with a partial create-new directory at ${destinationRoot}: ${error.message}`;
    throw error;
  }

  return Object.freeze({
    output_dir: destinationRoot,
    file_count: planned.length,
    size_bytes: bytes,
    excluded_first_release_roots: Object.freeze([
      'projects/',
      'reference/',
      'test media and models',
      'legacy internal skill directories',
      'sketchup_sdk_py.txt',
      'historical release artifacts and evidence'
    ])
  });
}

async function parseAllowlist(allowlistPath) {
  const text = await fs.readFile(allowlistPath, 'utf8');
  const entries = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+->\s+/);
    if (parts.length > 2 || !parts[0]) {
      throw codedError('PUBLIC_EXPORT_ALLOWLIST_INVALID', `Invalid allowlist line ${index + 1}.`);
    }
    const source = normalizeRelative(parts[0], index + 1);
    const destination = normalizeRelative(parts[1] || parts[0], index + 1);
    entries.push({ source, destination });
  }
  return entries;
}

async function listRegularFiles(directory, root) {
  const output = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute);
    if (entry.isSymbolicLink()) {
      throw codedError('PUBLIC_EXPORT_SYMLINK_REJECTED', `Allowlisted tree contains a symbolic link: ${relative}`);
    }
    if (entry.isDirectory()) output.push(...await listRegularFiles(absolute, root));
    else if (entry.isFile()) output.push(relative);
    else throw codedError('PUBLIC_EXPORT_SOURCE_TYPE_REJECTED', `Allowlisted tree contains a special file: ${relative}`);
  }
  return output;
}

function addPlan(plan, seen, source, destination) {
  const normalizedDestination = normalizeRelative(destination);
  if (seen.has(normalizedDestination)) {
    throw codedError('PUBLIC_EXPORT_DUPLICATE_DESTINATION', `Multiple allowlist entries write ${normalizedDestination}.`);
  }
  seen.add(normalizedDestination);
  plan.push({ source: normalizeRelative(source), destination: normalizedDestination });
}

function normalizeRelative(value, line = null) {
  const normalized = path.normalize(String(value || '').replace(/\/$/, ''));
  if (!normalized || normalized === '.' || path.isAbsolute(normalized) || normalized.startsWith(`..${path.sep}`) || normalized === '..') {
    throw codedError('PUBLIC_EXPORT_PATH_REJECTED', `Unsafe repository-relative path${line ? ` on line ${line}` : ''}: ${value}`);
  }
  return normalized;
}

function resolveInside(root, relative) {
  const resolved = path.resolve(root, relative);
  const difference = path.relative(root, resolved);
  if (difference.startsWith(`..${path.sep}`) || difference === '..' || path.isAbsolute(difference)) {
    throw codedError('PUBLIC_EXPORT_PATH_REJECTED', `Path escapes its root: ${relative}`);
  }
  return resolved;
}

function assertOutsideSource(sourceRoot, destinationRoot) {
  const relative = path.relative(sourceRoot, destinationRoot);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw codedError('PUBLIC_EXPORT_INSIDE_SOURCE_REJECTED', 'The clean public export must be outside the source checkout.');
  }
}

async function assertAbsent(target) {
  try {
    await fs.lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  throw codedError('PUBLIC_EXPORT_TARGET_EXISTS', `Refusing to overwrite existing public export: ${target}`);
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseArgs(argv) {
  let outputDir = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--output-dir') outputDir = argv[++index];
    else if (argv[index] === '--help') {
      process.stdout.write('Usage: node scripts/export-public-source.mjs --output-dir /new/empty/path\n');
      process.exit(0);
    } else {
      throw codedError('PUBLIC_EXPORT_ARGUMENT_UNKNOWN', `Unknown argument: ${argv[index]}`);
    }
  }
  return { outputDir };
}

if (path.resolve(process.argv[1] || '') === scriptPath) {
  const result = await exportPublicSource(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
