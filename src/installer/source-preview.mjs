#!/usr/bin/env node
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), '..', '..');

export const OFFICIAL_SOURCE_REMOTES = Object.freeze([
  'https://github.com/dtzhlq/local-mcp-for-sketchup.git',
  'https://gitee.com/dtzhlq/local-mcp-for-sketchup.git'
]);

export async function verifySourcePreview({
  checkoutRoot = defaultRoot,
  requireGitProvenance = true,
  runHandshake = true,
  nodeVersion = process.versions.node,
  platform = process.platform,
  arch = process.arch
} = {}) {
  assertSupportedTarget(platform, arch);
  assertNode24(nodeVersion);

  const root = await fs.realpath(path.resolve(String(checkoutRoot || '')));
  await assertDirectoryNoSymlink(root, 'source checkout');
  const [packageJson, packageLock] = await Promise.all([
    readJsonRegular(path.join(root, 'package.json'), 'package.json'),
    readJsonRegular(path.join(root, 'package-lock.json'), 'package-lock.json')
  ]);
  if (packageJson.name !== 'local-mcp-for-sketchup' ||
      !/^0\.1\.0-rc\.[0-9]+$/.test(String(packageJson.version || ''))) {
    throw codedError('SOURCE_PREVIEW_PACKAGE_INVALID', 'The source package identity or version is invalid.');
  }
  if (packageLock.name !== packageJson.name || packageLock.version !== packageJson.version ||
      packageLock.packages?.['']?.version !== packageJson.version) {
    throw codedError('SOURCE_PREVIEW_LOCK_MISMATCH', 'package-lock.json does not match package.json.');
  }

  const serverPath = path.join(root, 'src', 'mcp-server.mjs');
  await assertRegularNoSymlink(serverPath, 'MCP server entrypoint');
  await assertRegularNoSymlink(path.join(root, 'node_modules', 'ajv', 'package.json'), 'locked dependencies');

  const provenance = requireGitProvenance
    ? await verifyGitProvenance(root)
    : Object.freeze({ verified: false, reason: 'test-or-explicit-skip' });
  const handshake = runHandshake
    ? await verifyMcpHandshake({ root, serverPath, expectedVersion: packageJson.version })
    : Object.freeze({ verified: false, tools: null, reason: 'explicit-skip' });

  return Object.freeze({
    ok: true,
    channel: 'source-technical-preview',
    checkout_root: root,
    product_version: packageJson.version,
    platform: `${platform}-${arch}`,
    node_version: nodeVersion,
    node_path: process.execPath,
    server_path: serverPath,
    git: provenance,
    mcp_stdio: handshake,
    live_sketchup_verified: false,
    release_acceptance: false
  });
}

async function verifyGitProvenance(root) {
  const [remote, branch, head, remoteMain, trackedChanges] = await Promise.all([
    git(root, ['remote', 'get-url', 'origin']),
    git(root, ['branch', '--show-current']),
    git(root, ['rev-parse', 'HEAD']),
    git(root, ['rev-parse', 'refs/remotes/origin/main']),
    git(root, ['status', '--porcelain', '--untracked-files=no'])
  ]);
  const normalizedRemote = normalizeRemote(remote);
  if (!OFFICIAL_SOURCE_REMOTES.includes(normalizedRemote)) {
    throw codedError('SOURCE_PREVIEW_REMOTE_REJECTED', `Unrecognized origin remote: ${remote}`);
  }
  if (branch !== 'main') {
    throw codedError('SOURCE_PREVIEW_BRANCH_REJECTED', `Expected main branch, found ${branch || 'detached HEAD'}.`);
  }
  if (head !== remoteMain) {
    throw codedError('SOURCE_PREVIEW_HEAD_MISMATCH', 'HEAD does not match the fetched origin/main revision.');
  }
  if (trackedChanges) {
    throw codedError('SOURCE_PREVIEW_TRACKED_CHANGES', 'Tracked source files are modified; use a fresh checkout.');
  }
  return Object.freeze({
    verified: true,
    remote: normalizedRemote,
    branch,
    commit: head,
    tracked_changes: false
  });
}

async function verifyMcpHandshake({ root, serverPath, expectedVersion }) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'local-mcp-source-preview-'));
  const server = spawn(process.execPath, [serverPath], {
    cwd: root,
    env: {
      ...process.env,
      LOCAL_MCP_FOR_SKETCHUP_ENABLE_RUBY_EXPERT: '',
      LOCAL_MCP_FOR_SKETCHUP_STATE_DIR: path.join(temporaryRoot, 'state'),
      LOCAL_MCP_FOR_SKETCHUP_MOCK_SESSION_PATH: path.join(temporaryRoot, 'mock-session.json')
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let buffer = '';
  let stderr = '';
  const pending = new Map();
  server.stdout.setEncoding('utf8');
  server.stderr.setEncoding('utf8');
  server.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        try {
          const message = JSON.parse(line);
          const resolver = pending.get(message.id);
          if (resolver) {
            pending.delete(message.id);
            resolver.resolve(message);
          }
        } catch (error) {
          for (const resolver of pending.values()) resolver.reject(error);
          pending.clear();
        }
      }
      newline = buffer.indexOf('\n');
    }
  });
  server.stderr.on('data', (chunk) => { stderr += chunk; });

  const request = (id, method, params = undefined) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(codedError('SOURCE_PREVIEW_MCP_TIMEOUT', `MCP ${method} timed out. ${stderr.trim()}`));
    }, 10_000);
    pending.set(id, {
      resolve: (message) => { clearTimeout(timer); resolve(message); },
      reject: (error) => { clearTimeout(timer); reject(error); }
    });
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`);
  });

  try {
    const initialized = await request(1, 'initialize', { protocolVersion: '2024-11-05' });
    if (initialized.error || initialized.result?.serverInfo?.version !== expectedVersion) {
      throw codedError('SOURCE_PREVIEW_MCP_VERSION_MISMATCH', 'MCP initialize returned an unexpected server version.');
    }
    const listed = await request(2, 'tools/list');
    const names = listed.result?.tools?.map((tool) => tool.name) || [];
    if (listed.error || names.length !== 41 || new Set(names).size !== 41) {
      throw codedError('SOURCE_PREVIEW_MCP_TOOLS_MISMATCH', `Expected 41 unique MCP tools, received ${names.length}.`);
    }
    return Object.freeze({ verified: true, tools: names.length, protocol_version: '2024-11-05' });
  } finally {
    for (const resolver of pending.values()) resolver.reject(codedError('SOURCE_PREVIEW_MCP_STOPPED', 'MCP verification stopped.'));
    pending.clear();
    server.stdin.end();
    if (server.exitCode === null) server.kill('SIGTERM');
    await new Promise((resolve) => {
      if (server.exitCode !== null) resolve();
      else server.once('close', resolve);
    });
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function git(root, args) {
  try {
    const result = await execFileAsync('git', args, { cwd: root, encoding: 'utf8' });
    return result.stdout.trim();
  } catch (error) {
    throw codedError('SOURCE_PREVIEW_GIT_FAILED', `Git provenance check failed: ${error.stderr?.trim() || error.message}`);
  }
}

function normalizeRemote(value) {
  return String(value || '').trim().replace(/\/$/, '').replace(/\.git$/, '') + '.git';
}

function assertSupportedTarget(platform, arch) {
  if (!((platform === 'darwin' && arch === 'arm64') || (platform === 'win32' && arch === 'x64'))) {
    throw codedError('SOURCE_PREVIEW_PLATFORM_UNSUPPORTED', `Unsupported source preview target: ${platform}-${arch}.`);
  }
}

function assertNode24(version) {
  if (!/^24\./.test(String(version || ''))) {
    throw codedError('SOURCE_PREVIEW_NODE_UNSUPPORTED', `Node.js 24 is required; found ${version || 'unknown'}.`);
  }
}

async function readJsonRegular(filePath, label) {
  await assertRegularNoSymlink(filePath, label);
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    throw codedError('SOURCE_PREVIEW_JSON_INVALID', `${label} is invalid: ${error.message}`);
  }
}

async function assertDirectoryNoSymlink(filePath, label) {
  const stat = await fs.lstat(filePath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw codedError('SOURCE_PREVIEW_PATH_REJECTED', `${label} must be a non-symlink directory.`);
  }
}

async function assertRegularNoSymlink(filePath, label) {
  const stat = await fs.lstat(filePath).catch((error) => {
    if (error?.code === 'ENOENT') throw codedError('SOURCE_PREVIEW_FILE_MISSING', `${label} is missing: ${filePath}`);
    throw error;
  });
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw codedError('SOURCE_PREVIEW_PATH_REJECTED', `${label} must be a regular non-symlink file.`);
  }
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseArgs(argv) {
  let checkoutRoot = defaultRoot;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--checkout-root') checkoutRoot = argv[++index];
    else if (argv[index] === '--help') {
      process.stdout.write('Usage: node src/installer/source-preview.mjs [--checkout-root PATH]\n');
      process.exit(0);
    } else throw codedError('SOURCE_PREVIEW_ARGUMENT_UNKNOWN', `Unknown argument: ${argv[index]}`);
  }
  return { checkoutRoot };
}

const invokedPath = await fs.realpath(path.resolve(process.argv[1] || '')).catch(() => path.resolve(process.argv[1] || ''));
if (invokedPath === scriptPath) {
  const result = await verifySourcePreview(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
