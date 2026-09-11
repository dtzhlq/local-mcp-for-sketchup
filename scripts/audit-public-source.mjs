#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const forbiddenRoots = new Set([
  'projects',
  'reference',
  'node_modules',
  'output',
  'out',
  '.pnpm-store'
]);
const forbiddenExtensions = new Set([
  '.skp', '.skb', '.dbk', '.dwg', '.dxf',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic',
  '.mp4', '.mov', '.avi', '.zip', '.rbz'
]);
const forbiddenTextPatterns = [
  { name: 'macOS absolute user path', pattern: /\/Users\/[^/\s"'`]+/g },
  { name: 'Windows absolute user path', pattern: /[A-Za-z]:\\Users\\[^\\\s"'`]+/g },
  { name: 'private key material', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'GitHub token', pattern: /\bgh[opusr]_[A-Za-z0-9_]{30,}\b/g },
  { name: 'OpenAI API key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/g }
];
const permittedLegacyPluginIdentifiers = new Set([
  'AlmaSketchupMCP',
  'AlmaFeatures',
  'AlmaBoolean',
  'AlmaManifold'
]);

export async function auditPublicSource({
  root = repoRoot,
  maximumFileBytes = 1_000_000,
  maximumTreeBytes = 12_000_000
} = {}) {
  const resolvedRoot = path.resolve(root);
  const files = await listFiles(resolvedRoot);
  const compatibility=JSON.parse(await fs.readFile(path.join(resolvedRoot,'release/legacy-compatibility-identifiers.json'),'utf8'));
  const findings = [];
  const manifest = [];
  let treeBytes = 0;

  for (const relative of files) {
    const segments = relative.split(path.sep);
    if (forbiddenRoots.has(segments[0])) {
      findings.push({ rule: 'excluded-root', path: relative });
    }
    const extension = path.extname(relative).toLowerCase();
    if (forbiddenExtensions.has(extension)) {
      findings.push({ rule: 'binary-or-model-file', path: relative });
    }
    const absolute = path.join(resolvedRoot, relative);
    const bytes = await fs.readFile(absolute);
    treeBytes += bytes.length;
    if (bytes.length > maximumFileBytes) {
      findings.push({ rule: 'oversized-file', path: relative, size_bytes: bytes.length });
    }
    if (!bytes.includes(0)) {
      const text = bytes.toString('utf8');
      for (const detector of forbiddenTextPatterns) {
        const matches = [...text.matchAll(detector.pattern)];
        for (const match of matches.slice(0, 3)) {
          findings.push({
            rule: detector.name,
            path: relative,
            line: text.slice(0, match.index).split('\n').length,
            sample: redact(match[0])
          });
        }
      }
      for (const match of text.matchAll(/\bAlma[A-Za-z0-9_-]*\b|\bALMA_[A-Za-z0-9_]+\b|\balma[_-][A-Za-z0-9_-]+\b/g)) {
        const permittedLocation =
          relative.startsWith(`sketchup_plugin${path.sep}local_mcp_for_sketchup${path.sep}`) ||
          relative === path.join('scripts', 'audit-public-source.mjs');
        const permitted = (permittedLocation && permittedLegacyPluginIdentifiers.has(match[0])) || (compatibility[relative]?.includes(match[0]) === true) || relative === 'release/legacy-compatibility-identifiers.json';
        if (!permitted) {
          findings.push({
            rule: 'legacy-product-identifier',
            path: relative,
            line: text.slice(0, match.index).split('\n').length,
            sample: match[0]
          });
        }
      }
    }
    manifest.push(`${sha256(bytes)}  ${relative.split(path.sep).join('/')}`);
  }

  if (treeBytes > maximumTreeBytes) {
    findings.push({ rule: 'oversized-public-tree', size_bytes: treeBytes, maximum_bytes: maximumTreeBytes });
  }
  for (const required of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md', 'SECURITY.md', 'TRADEMARKS.md']) {
    if (!files.includes(required)) findings.push({ rule: 'required-file-missing', path: required });
  }

  return Object.freeze({
    passed: findings.length === 0,
    root: resolvedRoot,
    file_count: files.length,
    size_bytes: treeBytes,
    findings,
    sha256_manifest: `${manifest.sort().join('\n')}\n`
  });
}

async function listFiles(root) {
  const output = [];
  async function visit(directory) {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git') continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute);
      if (entry.isSymbolicLink()) {
        throw codedError('PUBLIC_AUDIT_SYMLINK_REJECTED', `Public tree contains a symbolic link: ${relative}`);
      }
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) output.push(relative);
      else throw codedError('PUBLIC_AUDIT_SPECIAL_FILE_REJECTED', `Public tree contains a special file: ${relative}`);
    }
  }
  await visit(root);
  return output;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function redact(value) {
  if (value.length < 10) return '[redacted]';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseArgs(argv) {
  let root = repoRoot;
  let printManifest = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root') root = argv[++index];
    else if (argv[index] === '--print-manifest') printManifest = true;
    else throw codedError('PUBLIC_AUDIT_ARGUMENT_UNKNOWN', `Unknown argument: ${argv[index]}`);
  }
  return { root, printManifest };
}

if (path.resolve(process.argv[1] || '') === scriptPath) {
  const options = parseArgs(process.argv.slice(2));
  const report = await auditPublicSource({ root: options.root });
  if (options.printManifest) process.stdout.write(report.sha256_manifest);
  else process.stdout.write(`${JSON.stringify({ ...report, sha256_manifest: undefined }, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
