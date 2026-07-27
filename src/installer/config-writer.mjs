import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function mergeAgentConfigFile({
  configPath,
  merge,
  now = () => new Date(),
  expectedParent = null
}) {
  if (typeof merge !== 'function') throw codedError('AGENT_CONFIG_MERGE_REQUIRED', 'A configuration merge function is required.');
  const resolvedPath = path.resolve(String(configPath || ''));
  if (expectedParent) assertContained(path.resolve(expectedParent), resolvedPath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true, mode: 0o700 });
  await assertNoSymlinkPath(path.dirname(resolvedPath));

  const before = await snapshotConfig(resolvedPath);
  const merged = merge(before.text);
  if (!merged?.changed) {
    return {
      changed: false,
      config_path: resolvedPath,
      backup_path: null,
      format: merged?.format || null
    };
  }

  const backupPath = before.exists
    ? `${resolvedPath}.local-mcp-backup-${formatTimestamp(now())}`
    : null;
  if (backupPath) {
    await fs.copyFile(resolvedPath, backupPath, fs.constants.COPYFILE_EXCL);
    await fs.chmod(backupPath, before.mode);
  }

  const temporaryPath = path.join(
    path.dirname(resolvedPath),
    `.${path.basename(resolvedPath)}.local-mcp-${process.pid}-${randomUUID()}.tmp`
  );
  let temporaryCreated = false;
  try {
    const handle = await fs.open(temporaryPath, 'wx', before.exists ? before.mode : 0o600);
    temporaryCreated = true;
    try {
      await handle.writeFile(String(merged.text), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    const current = await snapshotConfig(resolvedPath);
    if (!sameSnapshot(before, current)) {
      throw codedError('AGENT_CONFIG_CHANGED_DURING_INSTALL', 'Agent configuration changed while the installer was preparing an update.');
    }
    await fs.rename(temporaryPath, resolvedPath);
    temporaryCreated = false;
    const directoryHandle = await fs.open(path.dirname(resolvedPath), fs.constants.O_RDONLY);
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch (error) {
    if (temporaryCreated) await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }

  return {
    changed: true,
    config_path: resolvedPath,
    backup_path: backupPath,
    format: merged.format || null
  };
}

async function snapshotConfig(configPath) {
  const stat = await fs.lstat(configPath).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat) return { exists: false, text: '', sha256: null, size: 0, mode: 0o600 };
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw codedError('AGENT_CONFIG_TARGET_REJECTED', 'Agent configuration must be a regular non-symlink file.');
  }
  const bytes = await fs.readFile(configPath);
  return {
    exists: true,
    text: bytes.toString('utf8'),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
    mode: stat.mode & 0o777
  };
}

async function assertNoSymlinkPath(directoryPath) {
  const resolved = path.resolve(directoryPath);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) {
      throw codedError('AGENT_CONFIG_SYMLINK_REJECTED', `Refusing configuration path through symlink: ${current}`);
    }
  }
}

function sameSnapshot(left, right) {
  return left.exists === right.exists &&
    left.sha256 === right.sha256 &&
    left.size === right.size;
}

function assertContained(parent, candidate) {
  const relative = path.relative(parent, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    if (candidate !== parent) {
      throw codedError('AGENT_CONFIG_PATH_OUTSIDE_ALLOWED_ROOT', 'Agent configuration path is outside its allowed root.');
    }
  }
}

function formatTimestamp(value) {
  return value.toISOString().replace(/[:.]/g, '-');
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
