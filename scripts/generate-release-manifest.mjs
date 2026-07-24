#!/usr/bin/env node
import crypto, { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getComponentDefinitionOperationNames, getOperationNames } from '../src/capabilities.mjs';
import { EXPERT_TOOL_NAMES, TOOL_NAMES } from '../src/tool-registry.mjs';
import {
  readPackagedPluginVersion,
  verifyPackagedPluginBytes
} from './package-sketchup-plugin.mjs';
import {
  assertArtifactPathsAbsent,
  resolveCanonicalReleaseArtifactSet,
  withReleaseArtifactSetLock
} from './release-artifact-set.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const LIVE_STATUSES = new Set(['passed', 'blocked', 'unverified']);

export async function generateReleaseManifest({
  outputDir = path.join(REPO_ROOT, 'out/releases'),
  rbz = null,
  requestedVersion = null,
  liveStatus = 'unverified',
  liveReason = null,
  offlineGates = [],
  repoRoot = REPO_ROOT,
  createdAt = new Date().toISOString()
} = {}) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const resolvedOutputDir = resolveFromRoot(resolvedRepoRoot, outputDir);
  await assertExistingDirectory(resolvedOutputDir);

  const versions = await readAndValidateVersions(resolvedRepoRoot, requestedVersion);
  const artifactSet = resolveCanonicalReleaseArtifactSet({
    outputDir: resolvedOutputDir,
    version: versions.requested
  });
  if (rbz !== null && resolveFromRoot(resolvedRepoRoot, rbz) !== artifactSet.rbzPath) {
    throw releaseError(
      'RELEASE_RBZ_PATH_MISMATCH',
      'The RBZ input must be the canonical release artifact for the requested version.'
    );
  }
  if (!LIVE_STATUSES.has(liveStatus)) {
    throw releaseError('RELEASE_LIVE_STATUS_INVALID', `Invalid --live-status: ${liveStatus}`);
  }
  if (!Array.isArray(offlineGates) || offlineGates.some((gate) => typeof gate !== 'string' || gate.length === 0)) {
    throw releaseError('RELEASE_OFFLINE_GATES_INVALID', 'Offline gates must be non-empty strings.');
  }

  return withReleaseArtifactSetLock(
    { outputDir: artifactSet.outputDir, version: artifactSet.version },
    async (lockedSet) => {
      await assertArtifactPathsAbsent([lockedSet.sha256Path, lockedSet.manifestPath]);
      const rbzEvidence = await readStableRegularFile(lockedSet.rbzPath);
      let packagedPluginVersion;
      try {
        packagedPluginVersion = await readPackagedPluginVersion(lockedSet.rbzPath);
      } catch (error) {
        throw releaseError(
          'RELEASE_RBZ_ARCHIVE_INVALID',
          'The canonical RBZ does not contain the exact declared plugin file set and loader.',
          error
        );
      }
      if (packagedPluginVersion !== versions.requested) {
        throw releaseError(
          'RELEASE_RBZ_VERSION_MISMATCH',
          'The packaged plugin loader version does not match the requested release version.'
        );
      }
      try {
        await verifyPackagedPluginBytes(lockedSet.rbzPath, resolvedRepoRoot);
      } catch (error) {
        throw releaseError(
          'RELEASE_RBZ_ARCHIVE_INVALID',
          'The canonical RBZ plugin members do not match the verified source bytes.',
          error
        );
      }
      const sha256 = crypto.createHash('sha256').update(rbzEvidence.bytes).digest('hex');
      const manifest = {
        version: 1,
        kind: 'sketchup_mcp_release_manifest',
        product_version: versions.package,
        plugin_version: versions.plugin,
        created_at: createdAt,
        git: gitMetadata(resolvedRepoRoot),
        release_status: liveStatus === 'passed' ? 'rc_candidate_verified' : 'blocked_live_queue',
        rc_signed: liveStatus === 'passed',
        contracts: {
          mcp_tools: TOOL_NAMES.length,
          expert_tools: EXPERT_TOOL_NAMES.length,
          registered_operations: getOperationNames().length,
          component_scope_operations: getComponentDefinitionOperationNames().length
        },
        offline_gates: [...offlineGates],
        live_queue: {
          status: liveStatus,
          reason: liveReason || null,
          fresh_handshake_required: true
        },
        artifacts: {
          rbz: path.relative(resolvedRepoRoot, lockedSet.rbzPath),
          rbz_size_bytes: rbzEvidence.bytes.length,
          rbz_sha256: sha256,
          sha256_file: path.relative(resolvedRepoRoot, lockedSet.sha256Path)
        }
      };
      const sidecarBytes = Buffer.from(`${sha256}  ${path.basename(lockedSet.rbzPath)}\n`, 'utf8');
      const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      await publishMetadataPairCreateNew(lockedSet, sidecarBytes, manifestBytes, async () => {
        const finalRbzEvidence = await readStableRegularFile(lockedSet.rbzPath);
        if (!sameIdentity(fileIdentity(rbzEvidence.stat), finalRbzEvidence.stat)
          || !finalRbzEvidence.bytes.equals(rbzEvidence.bytes)) {
          throw releaseError(
            'RELEASE_RBZ_CHANGED_DURING_MANIFEST',
            'The canonical RBZ changed while release metadata was being published.'
          );
        }
      });
      return {
        ok: true,
        manifest: lockedSet.manifestPath,
        sha256_file: lockedSet.sha256Path,
        rbz: lockedSet.rbzPath,
        rbz_sha256: sha256,
        rbz_size_bytes: rbzEvidence.bytes.length,
        release_status: manifest.release_status,
        rc_signed: manifest.rc_signed,
        overwrite_performed: false
      };
    }
  );
}

async function readAndValidateVersions(repoRoot, requestedVersion) {
  const packagePath = path.join(repoRoot, 'package.json');
  const loaderPath = path.join(repoRoot, 'sketchup_plugin/alma_sketchup_mcp.rb');
  const [packageBytes, pluginSource] = await Promise.all([
    readStableRegularFile(packagePath),
    readStableRegularFile(loaderPath)
  ]);
  let packageJson;
  try {
    packageJson = JSON.parse(packageBytes.bytes.toString('utf8'));
  } catch (error) {
    throw releaseError('RELEASE_PACKAGE_JSON_INVALID', 'package.json is not valid JSON.', error);
  }
  const packageVersion = packageJson?.version;
  const pluginVersionMatches = [...pluginSource.bytes.toString('utf8')
    .matchAll(/^\s*PLUGIN_VERSION\s*=\s*'([^'\r\n]+)'\s*$/gm)];
  const pluginVersion = pluginVersionMatches[0]?.[1];
  if (typeof packageVersion !== 'string' || packageVersion.length === 0) {
    throw releaseError('RELEASE_PACKAGE_VERSION_MISSING', 'package.json does not declare a release version.');
  }
  if (!pluginVersion) {
    throw releaseError('RELEASE_PLUGIN_VERSION_MISSING', 'The plugin loader does not declare PLUGIN_VERSION.');
  }
  if (pluginVersionMatches.length !== 1) {
    throw releaseError('RELEASE_PLUGIN_VERSION_INVALID', 'The plugin loader must declare PLUGIN_VERSION exactly once.');
  }
  const requested = requestedVersion ?? packageVersion;
  // The resolver provides the single strict filename-segment policy for all three artifacts.
  resolveCanonicalReleaseArtifactSet({ outputDir: repoRoot, version: requested });
  if (packageVersion !== pluginVersion || requested !== packageVersion || requested !== pluginVersion) {
    throw releaseError(
      'RELEASE_VERSION_MISMATCH',
      'Requested, package.json, and SketchUp plugin loader versions must match exactly.'
    );
  }
  return { requested, package: packageVersion, plugin: pluginVersion };
}

async function readStableRegularFile(filePath) {
  let handle;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw releaseError('RELEASE_ARTIFACT_INPUT_MISSING', 'A required release input does not exist.', error);
    }
    if (error?.code === 'ELOOP') {
      throw releaseError('RELEASE_ARTIFACT_INPUT_UNSAFE', 'Release inputs must not be symbolic links.', error);
    }
    throw error;
  }
  try {
    const before = await handle.stat();
    if (!before.isFile()) {
      throw releaseError('RELEASE_ARTIFACT_INPUT_UNSAFE', 'Release inputs must be regular files.');
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const pathStat = await fs.lstat(filePath);
    if (pathStat.isSymbolicLink() || !pathStat.isFile()
      || !sameFileIdentity(before, after) || !sameFileIdentity(after, pathStat)
      || bytes.length !== after.size) {
      throw releaseError('RELEASE_ARTIFACT_INPUT_CHANGED', 'A release input changed while it was being verified.');
    }
    return { bytes, stat: after };
  } finally {
    await handle.close();
  }
}

async function publishMetadataPairCreateNew(artifactSet, sidecarBytes, manifestBytes, verifyBeforeCommit) {
  const staged = [];
  const published = [];
  try {
    staged.push(await stageFile(artifactSet.outputDir, 'sha256', sidecarBytes));
    staged.push(await stageFile(artifactSet.outputDir, 'manifest', manifestBytes));
    await assertArtifactPathsAbsent([artifactSet.sha256Path, artifactSet.manifestPath]);
    published.push(await publishStagedFile(staged[0], artifactSet.sha256Path));
    published.push(await publishStagedFile(staged[1], artifactSet.manifestPath));
    for (const entry of staged) await unlinkIfOwned(entry.path, entry.identity);
    await syncDirectory(artifactSet.outputDir);
    await assertPublishedBytes(artifactSet.sha256Path, sidecarBytes, published[0].identity);
    await assertPublishedBytes(artifactSet.manifestPath, manifestBytes, published[1].identity);
    await verifyBeforeCommit();
  } catch (error) {
    for (const entry of published.reverse()) await unlinkIfOwned(entry.path, entry.identity).catch(() => {});
    await syncDirectory(artifactSet.outputDir).catch(() => {});
    if (error?.code === 'EEXIST') {
      throw releaseError('RELEASE_ARTIFACT_TARGET_EXISTS', 'Release metadata is create-new-only.', error);
    }
    throw error;
  } finally {
    for (const entry of staged) await unlinkIfOwned(entry.path, entry.identity).catch(() => {});
  }
}

async function stageFile(outputDir, label, bytes) {
  const stagePath = path.join(outputDir, `.alma-release-${label}-${randomUUID()}.tmp`);
  const handle = await fs.open(stagePath, 'wx', 0o600);
  try {
    await handle.chmod(0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    const stat = await handle.stat();
    return { path: stagePath, identity: fileIdentity(stat) };
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.unlink(stagePath).catch(() => {});
    throw error;
  } finally {
    await handle.close().catch(() => {});
  }
}

async function publishStagedFile(staged, targetPath) {
  try {
    await fs.link(staged.path, targetPath);
    const targetStat = await fs.lstat(targetPath);
    if (targetStat.isSymbolicLink() || !targetStat.isFile() || !sameFileObject(staged.identity, targetStat)) {
      throw releaseError('RELEASE_ARTIFACT_PUBLISH_VERIFICATION_FAILED', 'Published release metadata failed identity verification.');
    }
    return { path: targetPath, identity: staged.identity };
  } catch (error) {
    await unlinkIfOwned(targetPath, staged.identity).catch(() => {});
    throw error;
  }
}

async function assertPublishedBytes(filePath, expectedBytes, expectedIdentity) {
  const observed = await readStableRegularFile(filePath);
  if (!sameFileObject(expectedIdentity, observed.stat) || !observed.bytes.equals(expectedBytes)) {
    throw releaseError('RELEASE_ARTIFACT_PUBLISH_VERIFICATION_FAILED', 'Published release metadata failed byte verification.');
  }
}

async function unlinkIfOwned(filePath, expectedIdentity) {
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  if (!stat.isSymbolicLink() && sameFileObject(expectedIdentity, stat)) await fs.unlink(filePath);
}

async function assertExistingDirectory(directoryPath) {
  let stat;
  try {
    stat = await fs.lstat(directoryPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw releaseError('RELEASE_ARTIFACT_OUTPUT_NOT_FOUND', 'Release manifest output directory must already exist.', error);
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || await fs.realpath(directoryPath) !== directoryPath) {
    throw releaseError('RELEASE_ARTIFACT_OUTPUT_UNSAFE', 'Release manifest output must be a canonical symlink-free directory.');
  }
}

async function syncDirectory(directoryPath) {
  const handle = await fs.open(directoryPath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function fileIdentity(stat) {
  return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}

function sameIdentity(expected, actual) {
  return expected.dev === actual.dev && expected.ino === actual.ino && expected.size === actual.size
    && expected.mtimeMs === actual.mtimeMs && expected.ctimeMs === actual.ctimeMs;
}

function sameFileObject(expected, actual) {
  return expected.dev === actual.dev && expected.ino === actual.ino;
}

function sameFileIdentity(left, right) {
  return sameIdentity(fileIdentity(left), right);
}

function resolveFromRoot(repoRoot, candidate) {
  return path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(repoRoot, candidate);
}

function gitMetadata(repoRoot) {
  return {
    head: git(repoRoot, 'rev-parse', 'HEAD'),
    branch: git(repoRoot, 'branch', '--show-current')
  };
}

function git(repoRoot, ...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function releaseError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function parseArgs(argv) {
  const result = { offlineGates: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output-dir') result.outputDir = requiredArgValue(argv, ++index, arg);
    else if (arg === '--rbz') result.rbz = requiredArgValue(argv, ++index, arg);
    else if (arg === '--version') result.requestedVersion = requiredArgValue(argv, ++index, arg);
    else if (arg === '--live-status') result.liveStatus = requiredArgValue(argv, ++index, arg);
    else if (arg === '--live-reason') result.liveReason = requiredArgValue(argv, ++index, arg);
    else if (arg === '--offline-gate') result.offlineGates.push(requiredArgValue(argv, ++index, arg));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function requiredArgValue(argv, index, optionName) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${optionName} requires a value.`);
  return value;
}

async function main() {
  const result = await generateReleaseManifest(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (path.resolve(process.argv[1] || '') === SCRIPT_PATH) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
