import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function resolveCanonicalReleaseArtifactSet({ outputDir, version }) {
  if (!outputDir) throw releaseError('RELEASE_ARTIFACT_OUTPUT_REQUIRED', 'Release artifact output directory is required.');
  const safeVersion = assertSafeSegment(version, 'version');
  const resolvedOutputDir = path.resolve(outputDir);
  const stem = `alma-sketchup-mcp-${safeVersion}`;
  const artifactSet = {
    outputDir: resolvedOutputDir,
    version: safeVersion,
    rbzPath: path.join(resolvedOutputDir, `${stem}.rbz`),
    sha256Path: path.join(resolvedOutputDir, `${stem}.sha256`),
    manifestPath: path.join(resolvedOutputDir, `release-manifest-${safeVersion}.json`),
    lockPath: path.join(resolvedOutputDir, `.${stem}.release-artifact-set.lock`)
  };
  artifactSet.targets = Object.freeze([
    artifactSet.rbzPath,
    artifactSet.sha256Path,
    artifactSet.manifestPath
  ]);
  return Object.freeze(artifactSet);
}

export async function acquireReleaseArtifactSetLock({ outputDir, version }) {
  const artifactSet = resolveCanonicalReleaseArtifactSet({ outputDir, version });
  await fs.mkdir(artifactSet.outputDir, { recursive: true });
  const outputStat = await fs.lstat(artifactSet.outputDir);
  if (outputStat.isSymbolicLink() || !outputStat.isDirectory()) {
    throw releaseError('RELEASE_ARTIFACT_OUTPUT_UNSAFE', 'Release artifact output must be a real directory.');
  }
  if (await fs.realpath(artifactSet.outputDir) !== artifactSet.outputDir) {
    throw releaseError('RELEASE_ARTIFACT_OUTPUT_UNSAFE', 'Release artifact output must use its canonical symlink-free path.');
  }

  const token = randomUUID();
  let handle;
  try {
    handle = await fs.open(artifactSet.lockPath, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw releaseError('RELEASE_ARTIFACT_SET_LOCKED', 'Another process holds the release artifact-set lock.');
    }
    throw error;
  }
  let ownership = null;
  let initialized = false;
  let initializationError = null;
  try {
    const ownedStat = await handle.stat();
    ownership = { dev: ownedStat.dev, ino: ownedStat.ino };
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify({ version: 1, kind: 'alma_release_artifact_set_lock', token })}\n`, 'utf8');
    await handle.sync();
    initialized = true;
  } catch (error) {
    initializationError = error;
  } finally {
    try {
      await handle.close();
    } catch (closeError) {
      initializationError ||= closeError;
    }
  }
  if (!initialized || initializationError) {
    if (!ownership) {
      throw aggregateReleaseError(
        'RELEASE_ARTIFACT_LOCK_CLEANUP_FAILED',
        initializationError || releaseError('RELEASE_ARTIFACT_LOCK_INITIALIZATION_FAILED', 'Release artifact-set lock initialization failed.'),
        releaseError('RELEASE_ARTIFACT_LOCK_OWNERSHIP_LOST', 'Fresh lock identity could not be established for safe cleanup.'),
        'Release artifact-set lock initialization failed before safe cleanup ownership could be established.'
      );
    }
    try {
      await unlinkOwnedLockPath(artifactSet.lockPath, ownership);
    } catch (cleanupError) {
      throw aggregateReleaseError(
        'RELEASE_ARTIFACT_LOCK_CLEANUP_FAILED',
        initializationError || releaseError('RELEASE_ARTIFACT_LOCK_INITIALIZATION_FAILED', 'Release artifact-set lock initialization failed.'),
        cleanupError,
        'Release artifact-set lock initialization failed and its owned lock path could not be cleaned safely.'
      );
    }
    throw initializationError || releaseError(
      'RELEASE_ARTIFACT_LOCK_INITIALIZATION_FAILED',
      'Release artifact-set lock initialization failed.'
    );
  }

  let released = false;
  return {
    artifactSet,
    async release() {
      if (released) return;
      let verificationHandle;
      let verificationError = null;
      try {
        const noFollow = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
        verificationHandle = await fs.open(artifactSet.lockPath, noFollow);
        const currentStat = await verificationHandle.stat();
        if (!sameIdentity(currentStat, ownership) || !currentStat.isFile()) {
          throw releaseError('RELEASE_ARTIFACT_LOCK_OWNERSHIP_LOST', 'Release artifact-set lock ownership changed unexpectedly.');
        }
        const current = JSON.parse(await verificationHandle.readFile('utf8'));
        if (current?.token !== token || current?.kind !== 'alma_release_artifact_set_lock') {
          throw releaseError('RELEASE_ARTIFACT_LOCK_OWNERSHIP_LOST', 'Release artifact-set lock ownership changed unexpectedly.');
        }
      } catch (error) {
        verificationError = releaseError(
          'RELEASE_ARTIFACT_LOCK_OWNERSHIP_LOST',
          'Release artifact-set lock cannot be verified before release.',
          error
        );
      } finally {
        try {
          await verificationHandle?.close();
        } catch (error) {
          verificationError ||= releaseError(
            'RELEASE_ARTIFACT_LOCK_OWNERSHIP_LOST',
            'Release artifact-set lock verification handle could not be closed safely.',
            error
          );
        }
      }
      if (verificationError) throw verificationError;
      await unlinkOwnedLockPath(artifactSet.lockPath, ownership);
      released = true;
    }
  };
}

export async function withReleaseArtifactSetLock(options, callback) {
  const lock = await acquireReleaseArtifactSetLock(options);
  let callbackError = null;
  try {
    return await callback(lock.artifactSet);
  } catch (error) {
    callbackError = error;
    throw error;
  } finally {
    try {
      await lock.release();
    } catch (releaseFailure) {
      if (!callbackError) throw releaseFailure;
      const aggregate = new AggregateError(
        [callbackError, releaseFailure],
        'Release artifact operation failed and its lock could not be safely released.',
        { cause: callbackError }
      );
      aggregate.code = 'RELEASE_ARTIFACT_OPERATION_AND_LOCK_RELEASE_FAILED';
      throw aggregate;
    }
  }
}

export async function assertArtifactPathsAbsent(paths) {
  for (const targetPath of paths) {
    let stat;
    try {
      stat = await fs.lstat(targetPath);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (stat) {
      const error = releaseError('RELEASE_ARTIFACT_TARGET_EXISTS', 'A release artifact-set target already exists.');
      error.target_path = targetPath;
      throw error;
    }
  }
}

async function unlinkOwnedLockPath(lockPath, ownership) {
  let current;
  try {
    current = await fs.lstat(lockPath);
  } catch (error) {
    throw releaseError('RELEASE_ARTIFACT_LOCK_OWNERSHIP_LOST', 'Release artifact-set lock path cannot be verified for cleanup.', error);
  }
  if (current.isSymbolicLink() || !current.isFile() || !sameIdentity(current, ownership)) {
    throw releaseError('RELEASE_ARTIFACT_LOCK_OWNERSHIP_LOST', 'Release artifact-set lock path is no longer owned by this operation.');
  }
  await fs.unlink(lockPath);
}

function sameIdentity(stat, ownership) {
  return stat.dev === ownership.dev && stat.ino === ownership.ino;
}

function aggregateReleaseError(code, primary, cleanup, message) {
  const error = new AggregateError([primary, cleanup], message, { cause: primary });
  error.code = code;
  return error;
}

function assertSafeSegment(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) {
    throw releaseError('RELEASE_ARTIFACT_VERSION_INVALID', `Release artifact ${label} is not a safe filename segment.`);
  }
  return value;
}

function releaseError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}
