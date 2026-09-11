#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  assertArtifactPathsAbsent,
  resolveCanonicalReleaseArtifactSet,
  withReleaseArtifactSetLock
} from './release-artifact-set.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

export const PLUGIN_FILES = Object.freeze([
  { source: 'sketchup_plugin/alma_sketchup_mcp.rb', target: 'alma_sketchup_mcp.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/operation_registry.rb', target: 'alma_sketchup_mcp/operation_registry.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/native_asset_operations.rb', target: 'alma_sketchup_mcp/native_asset_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/saved_model_lifecycle.rb', target: 'alma_sketchup_mcp/saved_model_lifecycle.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/document_state.rb', target: 'alma_sketchup_mcp/document_state.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/object_operations.rb', target: 'alma_sketchup_mcp/object_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/materials.rb', target: 'alma_sketchup_mcp/materials.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/environment_operations.rb', target: 'alma_sketchup_mcp/environment_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/creation_scope.rb', target: 'alma_sketchup_mcp/creation_scope.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/geometry_evidence.rb', target: 'alma_sketchup_mcp/geometry_evidence.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/geometry_regions.rb', target: 'alma_sketchup_mcp/geometry_regions.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/capture_detail_views.rb', target: 'alma_sketchup_mcp/capture_detail_views.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/section_operations.rb', target: 'alma_sketchup_mcp/section_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/appearance_operations.rb', target: 'alma_sketchup_mcp/appearance_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/texture_mapping.rb', target: 'alma_sketchup_mcp/texture_mapping.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/geometry_operations.rb', target: 'alma_sketchup_mcp/geometry_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/primitive_operations.rb', target: 'alma_sketchup_mcp/primitive_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/product_operations.rb', target: 'alma_sketchup_mcp/product_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/profile_operations.rb', target: 'alma_sketchup_mcp/profile_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/surface_operations.rb', target: 'alma_sketchup_mcp/surface_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/feature_operations.rb', target: 'alma_sketchup_mcp/feature_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/model_revision.rb', target: 'alma_sketchup_mcp/model_revision.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/runtime_source_manifest.rb', target: 'alma_sketchup_mcp/runtime_source_manifest.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/runtime_source_attestation.rb', target: 'alma_sketchup_mcp/runtime_source_attestation.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/boolean_operations.rb', target: 'alma_sketchup_mcp/boolean_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/structural_probe.rb', target: 'alma_sketchup_mcp/structural_probe.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/demo_operations.rb', target: 'alma_sketchup_mcp/demo_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/architecture_operations.rb', target: 'alma_sketchup_mcp/architecture_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/component_operations.rb', target: 'alma_sketchup_mcp/component_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/view_operations.rb', target: 'alma_sketchup_mcp/view_operations.rb' },
  { source: 'sketchup_plugin/alma_sketchup_mcp/snapshot.rb', target: 'alma_sketchup_mcp/snapshot.rb' }
].map((entry) => Object.freeze(entry)));

export const DEFAULT_PLUGIN_DIR = path.join(homedir(), 'Library/Application Support/SketchUp 2026/SketchUp/Plugins');
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, 'out/releases');
const MANAGED_LOADER = 'alma_sketchup_mcp.rb';
const MANAGED_MODULE_DIR = 'alma_sketchup_mcp';
const INSTALL_TRANSACTION_PREFIX = '.alma-sketchup-mcp-install-';
const INSTALL_LOCK_NAME = '.alma-sketchup-mcp.install.lock';
const RUBY_SYNTAX_VERIFIED_MANIFESTS = new Set();

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const version = await pluginVersion(REPO_ROOT);
  const summary = { version, checked: false, installed: false, packaged: false };
  if (options.package) {
    const earlyPackagePlan = await preflightPackageTarget(version, options.outputDir, {
      artifactLabel: options.artifactLabel,
      canonicalOutputDir: DEFAULT_OUTPUT_DIR
    });
    await assertPackageTargetsAbsent(earlyPackagePlan.collisionPaths, {
      sharedCanonicalCheck: earlyPackagePlan.normalizedLabel === null
    });
  }

  if (options.check) {
    await checkSourceFiles(REPO_ROOT);
    summary.checked = true;
  }
  if (options.install) {
    process.stderr.write(
      'WARNING: Installing plugin bytes does not update a running SketchUp process. '
      + 'Fully quit and restart SketchUp before any live verification.\n'
    );
    const install = await installPluginAtomic({
      pluginDir: options.pluginDir,
      allowedPluginRoot: options.allowedPluginRoot,
      sourceRoot: REPO_ROOT
    });
    summary.installed = true;
    summary.plugin_dir = install.plugin_dir;
    summary.installed_file_count = install.file_count;
    summary.installed_manifest_sha256 = install.manifest_sha256;
    summary.installed_bytes_verified = true;
    summary.transactional_staged_install = true;
    summary.atomic_publish_per_managed_target = true;
    summary.exclusive_install_lock = true;
    summary.rollback_on_failure = true;
    summary.restart_required = true;
    summary.runtime_activation = 'requires_complete_sketchup_restart';
    summary.live_runtime_verified = false;
  }
  if (options.package) {
    const packaged = await packagePlugin(version, options.outputDir, REPO_ROOT, {
      artifactLabel: options.artifactLabel,
      canonicalOutputDir: DEFAULT_OUTPUT_DIR
    });
    summary.package_path = packaged.package_path;
    summary.package_sha256 = packaged.package_sha256;
    summary.package_size_bytes = packaged.package_size_bytes;
    summary.package_artifact_class = packaged.artifact_class;
    summary.release_artifact = packaged.release_artifact;
    summary.packaged = true;
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

async function pluginVersion(sourceRoot) {
  const source = await fs.readFile(sourceFilePath(sourceRoot, 'sketchup_plugin/alma_sketchup_mcp.rb'), 'utf8');
  return parseUniquePluginVersion(
    source,
    () => new Error('Could not find one unique PLUGIN_VERSION declaration in sketchup_plugin/alma_sketchup_mcp.rb')
  );
}

export async function checkSourceFiles(sourceRoot = REPO_ROOT) {
  assertPluginFileDefinitions();
  const pluginRoot = path.join(path.resolve(sourceRoot), 'sketchup_plugin');
  await assertNoSymlinkComponents(pluginRoot, { allowMissingTail: false });
  const manifest = {};
  const sourcePaths = [];
  for (const file of PLUGIN_FILES) {
    const sourcePath = sourceFilePath(sourceRoot, file.source);
    await assertRegularFileWithoutSymlink(sourcePath, `plugin source ${file.source}`);
    assertContainedPath(pluginRoot, sourcePath, `plugin source ${file.source}`);
    const bytes = await fs.readFile(sourcePath);
    manifest[file.target] = Object.freeze({
      sha256: sha256(bytes),
      size_bytes: bytes.length
    });
    sourcePaths.push(sourcePath);
  }
  await assertExactModuleEntries(pluginRoot);
  await assertRuntimeSourceManifest(pluginRoot);
  const manifestSha256 = sha256(Buffer.from(stableManifestJson(manifest)));
  if (!RUBY_SYNTAX_VERIFIED_MANIFESTS.has(manifestSha256)) {
    for (const sourcePath of sourcePaths) runRubySyntax(sourcePath);
    RUBY_SYNTAX_VERIFIED_MANIFESTS.add(manifestSha256);
  }
  return Object.freeze(manifest);
}

export async function installPluginAtomic({
  pluginDir,
  allowedPluginRoot = DEFAULT_PLUGIN_DIR,
  sourceRoot = REPO_ROOT,
  hooks = {}
} = {}) {
  if (!pluginDir) throw codedError('PLUGIN_INSTALL_ROOT_REQUIRED', 'pluginDir is required.');
  const sourceManifest = await checkSourceFiles(sourceRoot);
  const installRoot = await prepareAllowedInstallRoot(pluginDir, allowedPluginRoot);
  const installLock = await acquireInstallLock(installRoot);
  let transactionDir = null;
  let state = null;
  let preserveRecovery = false;
  let preserveLock = false;
  let interruptedBy = null;
  const interruptHandlers = new Map(['SIGINT', 'SIGTERM'].map((signal) => [
    signal,
    () => { interruptedBy ||= signal; }
  ]));
  for (const [signal, handler] of interruptHandlers) process.on(signal, handler);
  const assertNotInterrupted = () => {
    if (interruptedBy) {
      throw codedError('PLUGIN_INSTALL_INTERRUPTED', `Plugin installation interrupted by ${interruptedBy}; rolling back.`);
    }
  };
  try {
    const beforeSnapshot = await inspectExistingManagedInstall(installRoot);
    transactionDir = await fs.mkdtemp(path.join(installRoot, INSTALL_TRANSACTION_PREFIX));
    await fs.chmod(transactionDir, 0o700);
    const stageDir = path.join(transactionDir, 'stage');
    const backupDir = path.join(transactionDir, 'backup');
    const failedActivationDir = path.join(transactionDir, 'failed-activation');
    await fs.mkdir(stageDir);
    await fs.mkdir(backupDir);

    state = {
      installRoot,
      transactionDir,
      stageDir,
      backupDir,
      failedActivationDir,
      beforeSnapshot,
      hooks,
      loader: transactionItem(MANAGED_LOADER, 'file', installRoot, stageDir, backupDir, failedActivationDir),
      module: transactionItem(MANAGED_MODULE_DIR, 'directory', installRoot, stageDir, backupDir, failedActivationDir)
    };

    await copyPluginTreeToStage(sourceRoot, stageDir, hooks, state, assertNotInterrupted);
    assertNotInterrupted();
    const stagedVerification = await verifyPluginTree(stageDir, sourceManifest);
    state.loader.stagedSnapshot = await snapshotManagedTargetForRecovery(state.loader.stage, state.loader.expectedType);
    state.module.stagedSnapshot = await snapshotManagedTargetForRecovery(state.module.stage, state.module.expectedType);
    assertNotInterrupted();
    await callHook(hooks, 'afterStageVerified', { state, verification: stagedVerification });
    assertNotInterrupted();

    await callHook(hooks, 'beforeBackupSnapshotCheck', { state });
    const preBackupSnapshot = await inspectExistingManagedInstall(installRoot);
    assertManagedSnapshotEqual(preBackupSnapshot, beforeSnapshot, 'pre_backup_snapshot');
    assertNotInterrupted();

    await backupExistingTarget(state.loader, beforeSnapshot.loader);
    assertNotInterrupted();
    await backupExistingTarget(state.module, beforeSnapshot.module);
    assertNotInterrupted();
    await callHook(hooks, 'afterBackup', { state });
    assertNotInterrupted();

    await activateStagedTarget(state.module);
    assertNotInterrupted();
    await callHook(hooks, 'afterModuleActivated', { state });
    assertNotInterrupted();

    await activateStagedTarget(state.loader);
    assertNotInterrupted();
    await callHook(hooks, 'afterLoaderActivated', { state });
    assertNotInterrupted();
    await callHook(hooks, 'beforePostVerify', { state });
    assertNotInterrupted();

    const installedVerification = await verifyPluginTree(installRoot, sourceManifest);
    assertNotInterrupted();
    await callHook(hooks, 'afterPostVerify', { state, verification: installedVerification });
    assertNotInterrupted();
    return {
      plugin_dir: installRoot,
      file_count: installedVerification.file_count,
      manifest_sha256: installedVerification.manifest_sha256,
      installed_bytes_verified: true,
      runtime_activation: 'requires_complete_sketchup_restart',
      live_runtime_verified: false
    };
  } catch (error) {
    const rollback = state
      ? await rollbackInstall(state)
      : { ok: true, errors: [], phase: null };
    if (!rollback.ok) {
      preserveRecovery = true;
      preserveLock = true;
      try {
        await fs.chmod(transactionDir, 0o700);
      } catch (chmodError) {
        rollback.errors.push(withPhase(
          codedError('PLUGIN_RECOVERY_PERMISSION_FAILED', 'The preserved recovery directory permissions could not be confirmed.'),
          'rollback_preserve'
        ));
        rollback.phase ||= 'rollback_preserve';
      }
      const incomplete = codedError(
        'PLUGIN_INSTALL_ROLLBACK_INCOMPLETE',
        'Plugin installation failed and automatic rollback is incomplete; recovery bytes were preserved.'
      );
      incomplete.phase = rollback.phase || 'rollback_restore';
      incomplete.recovery_path = transactionDir;
      incomplete.original_error_code = publicErrorCode(error);
      incomplete.rollback_error_codes = rollback.errors.map(publicErrorCode);
      throw incomplete;
    }
    throw error;
  } finally {
    for (const [signal, handler] of interruptHandlers) process.off(signal, handler);
    if (transactionDir && !preserveRecovery) {
      await fs.rm(transactionDir, { recursive: true, force: true }).catch(() => {});
    }
    if (!preserveLock) await installLock.release();
  }
}

async function prepareAllowedInstallRoot(pluginDir, allowedPluginRoot) {
  if (!allowedPluginRoot) {
    throw codedError('PLUGIN_ALLOWED_ROOT_REQUIRED', 'allowedPluginRoot is required.');
  }
  const requested = path.resolve(pluginDir);
  const allowed = path.resolve(allowedPluginRoot);
  if (requested !== allowed) {
    throw codedError(
      'PLUGIN_INSTALL_ROOT_NOT_ALLOWED',
      `Refusing plugin installation outside the exact allowed root: ${requested}`
    );
  }
  await assertNoSymlinkComponents(path.dirname(requested), { allowMissingTail: false });
  await fs.mkdir(requested, { recursive: true });
  await assertNoSymlinkComponents(requested, { allowMissingTail: false });
  const stat = await fs.lstat(requested);
  if (!stat.isDirectory()) throw codedError('PLUGIN_INSTALL_ROOT_NOT_DIRECTORY', 'Plugin install root must be a directory.');
  const realRequested = await fs.realpath(requested);
  if (realRequested !== requested) {
    throw codedError('PLUGIN_INSTALL_ROOT_ALIAS_REJECTED', 'Plugin install root must use its canonical symlink-free path.');
  }
  return requested;
}

async function acquireInstallLock(installRoot) {
  const lockPath = path.join(installRoot, INSTALL_LOCK_NAME);
  const token = randomUUID();
  let handle;
  try {
    handle = await fs.open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw codedError('PLUGIN_INSTALL_LOCKED', 'Another plugin installation or recovery owns this install root.');
    }
    throw error;
  }
  const ownedStat = await handle.stat();
  const ownership = { dev: ownedStat.dev, ino: ownedStat.ino };
  let initializationError = null;
  try {
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify({ version: 1, kind: 'alma_plugin_install_lock', token })}\n`, 'utf8');
    await handle.sync();
  } catch (error) {
    initializationError = error;
  } finally {
    try {
      await handle.close();
    } catch (closeError) {
      initializationError ||= closeError;
    }
  }
  if (initializationError) {
    try {
      await unlinkInstallLockIfOwned(lockPath, ownership);
    } catch (cleanupError) {
      const aggregate = new AggregateError(
        [initializationError, cleanupError],
        'Plugin install lock initialization failed and its owned lock path could not be cleaned safely.',
        { cause: initializationError }
      );
      aggregate.code = 'PLUGIN_INSTALL_LOCK_CLEANUP_FAILED';
      throw aggregate;
    }
    throw initializationError;
  }

  let released = false;
  return {
    path: lockPath,
    async release() {
      if (released) return;
      let verificationHandle;
      let closeError = null;
      try {
        const noFollow = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
        verificationHandle = await fs.open(lockPath, noFollow);
        const currentStat = await verificationHandle.stat();
        if (!currentStat.isFile() || currentStat.dev !== ownership.dev || currentStat.ino !== ownership.ino) {
          throw codedError('PLUGIN_INSTALL_LOCK_OWNERSHIP_LOST', 'The plugin install lock ownership changed unexpectedly.');
        }
        const current = JSON.parse(await verificationHandle.readFile('utf8'));
        if (current?.kind !== 'alma_plugin_install_lock' || current?.token !== token) {
          throw codedError('PLUGIN_INSTALL_LOCK_OWNERSHIP_LOST', 'The plugin install lock ownership changed unexpectedly.');
        }
      } catch (error) {
        throw codedError(
          'PLUGIN_INSTALL_LOCK_OWNERSHIP_LOST',
          'The plugin install lock cannot be verified before release.'
        );
      } finally {
        try {
          await verificationHandle?.close();
        } catch (error) {
          closeError = error;
        }
      }
      if (closeError) {
        throw codedError('PLUGIN_INSTALL_LOCK_OWNERSHIP_LOST', 'The plugin install lock verification handle could not be closed safely.');
      }
      await unlinkInstallLockIfOwned(lockPath, ownership);
      released = true;
    }
  };
}

async function unlinkInstallLockIfOwned(lockPath, ownership) {
  const current = await fs.lstat(lockPath).catch(() => null);
  if (!current || current.isSymbolicLink() || !current.isFile()
    || current.dev !== ownership.dev || current.ino !== ownership.ino) {
    throw codedError('PLUGIN_INSTALL_LOCK_OWNERSHIP_LOST', 'The plugin install lock path is no longer owned by this operation.');
  }
  await fs.unlink(lockPath);
}

async function copyPluginTreeToStage(sourceRoot, stageDir, hooks = {}, state = null, assertNotInterrupted = () => {}) {
  let copied = 0;
  for (const file of PLUGIN_FILES) {
    const source = sourceFilePath(sourceRoot, file.source);
    const target = managedTargetPath(stageDir, file.target);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL);
    copied += 1;
    await callHook(hooks, 'afterStageFileCopied', { state, file, copied });
    assertNotInterrupted();
  }
}

async function verifyPluginTree(pluginRoot, expectedManifest) {
  await assertNoSymlinkComponents(pluginRoot, { allowMissingTail: false });
  await assertExactModuleEntries(pluginRoot);
  const actualManifest = {};
  for (const file of PLUGIN_FILES) {
    const target = managedTargetPath(pluginRoot, file.target);
    await assertRegularFileWithoutSymlink(target, `installed plugin target ${file.target}`);
    const bytes = await fs.readFile(target);
    const actual = { sha256: sha256(bytes), size_bytes: bytes.length };
    actualManifest[file.target] = actual;
    const expected = expectedManifest[file.target];
    if (!expected || actual.sha256 !== expected.sha256 || actual.size_bytes !== expected.size_bytes) {
      throw codedError('PLUGIN_BYTE_VERIFICATION_FAILED', `Installed plugin bytes do not match source: ${file.target}`);
    }
  }
  await assertRuntimeSourceManifest(pluginRoot);
  return {
    file_count: PLUGIN_FILES.length,
    manifest_sha256: sha256(Buffer.from(stableManifestJson(actualManifest)))
  };
}

async function assertRuntimeSourceManifest(pluginRoot) {
  const baseDir = path.join(pluginRoot, MANAGED_MODULE_DIR);
  const [booleanSource, modelRevisionSource, manifest] = await Promise.all([
    fs.readFile(path.join(baseDir, 'boolean_operations.rb')),
    fs.readFile(path.join(baseDir, 'model_revision.rb')),
    fs.readFile(path.join(baseDir, 'runtime_source_manifest.rb'), 'utf8')
  ]);
  const booleanMatch = manifest.match(/BOOLEAN_OPERATIONS_SHA256\s*=\s*'([0-9a-f]{64})'/);
  const modelRevisionMatch = manifest.match(/MODEL_REVISION_SHA256\s*=\s*'([0-9a-f]{64})'/);
  if (!booleanMatch || !modelRevisionMatch) throw new Error('Runtime source manifest is missing a valid attested-source SHA-256.');
  const actualBoolean = createHash('sha256').update(booleanSource).digest('hex');
  if (actualBoolean !== booleanMatch[1]) {
    throw new Error('Runtime source manifest does not match boolean_operations.rb.');
  }
  const actualModelRevision = createHash('sha256').update(modelRevisionSource).digest('hex');
  if (actualModelRevision !== modelRevisionMatch[1]) {
    throw new Error('Runtime source manifest does not match model_revision.rb.');
  }
}

export async function packagePlugin(version, outputDir, sourceRoot = REPO_ROOT, {
  artifactLabel = null,
  canonicalOutputDir = DEFAULT_OUTPUT_DIR
} = {}) {
  const plan = await preflightPackageTarget(version, outputDir, { artifactLabel, canonicalOutputDir });
  await assertPackageVersionBinding(version, sourceRoot);
  const sourceManifest = await checkSourceFiles(sourceRoot);
  const build = (collisionPaths = plan.collisionPaths) => buildAndPublishPackage({
    ...plan,
    collisionPaths,
    sourceRoot,
    sourceManifest,
    version
  });

  if (plan.normalizedLabel === null) {
    return withReleaseArtifactSetLock(
      { outputDir: plan.resolvedOutputDir, version },
      async (artifactSet) => {
        if (artifactSet.rbzPath !== plan.packagePath
          || !managedSnapshotsEqual(artifactSet.targets, plan.collisionPaths)) {
          throw codedError('PLUGIN_RELEASE_ARTIFACT_SET_MISMATCH', 'Canonical release artifact paths do not match the shared artifact-set contract.');
        }
        await assertPackageTargetsAbsent(artifactSet.targets, { sharedCanonicalCheck: true });
        return build(artifactSet.targets);
      }
    );
  }

  return build();
}

async function buildAndPublishPackage({
  resolvedOutputDir,
  normalizedLabel,
  packagePath,
  collisionPaths,
  sourceRoot,
  sourceManifest,
  version
}) {
  await fs.mkdir(resolvedOutputDir, { recursive: true });
  await assertNoSymlinkComponents(resolvedOutputDir, { allowMissingTail: false });
  await assertPackageTargetsAbsent(collisionPaths);
  const stageDir = await fs.mkdtemp(path.join(resolvedOutputDir, '.alma-sketchup-mcp-package-'));
  const stagedPackagePath = path.join(stageDir, '.artifact.rbz');
  try {
    for (const file of PLUGIN_FILES) {
      const target = path.join(stageDir, file.target);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(sourceFilePath(sourceRoot, file.source), target);
    }
    await verifyPluginTree(path.resolve(stageDir), sourceManifest);
    const stagedVersion = await pluginVersionFromLoaderPath(path.join(stageDir, MANAGED_LOADER));
    if (stagedVersion !== version) throw packageVersionMismatch();
    const result = spawnSync('zip', ['-qr', stagedPackagePath, ...PLUGIN_FILES.map((file) => file.target)], {
      cwd: stageDir,
      encoding: 'utf8'
    });
    if (result.status !== 0) {
      throw new Error(`zip failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
    }
    await verifyPackagedPluginBytesAgainstManifest(stagedPackagePath, sourceManifest);
    const packagedVersion = await readPackagedPluginVersion(stagedPackagePath);
    if (packagedVersion !== version) throw packageVersionMismatch();
    const stagedPackageSnapshot = await snapshotRegularFile(stagedPackagePath);
    await assertPackageTargetsAbsent(collisionPaths);
    let packageLinked = false;
    let packageBytes;
    try {
      try {
        await fs.link(stagedPackagePath, packagePath);
        packageLinked = true;
      } catch (error) {
        if (error?.code === 'EEXIST') {
          throw codedError('PLUGIN_PACKAGE_TARGET_EXISTS', `Refusing to overwrite existing package artifact: ${packagePath}`);
        }
        throw error;
      }
      await assertPackageTargetsAbsent(
        collisionPaths.filter((targetPath) => targetPath !== packagePath),
        { sharedCanonicalCheck: normalizedLabel === null }
      );
      packageBytes = await readAndSyncPublishedPackageOwned(
        packagePath,
        stagedPackagePath,
        stagedPackageSnapshot,
        resolvedOutputDir
      );
    } catch (error) {
      if (packageLinked) await unlinkPublishedPackageIfOwned(packagePath, stagedPackagePath);
      throw error;
    }
    return {
      package_path: packagePath,
      package_sha256: sha256(packageBytes),
      package_size_bytes: packageBytes.length,
      artifact_class: normalizedLabel ? 'non_release_preview' : 'canonical_release_candidate',
      release_artifact: normalizedLabel === null,
      overwrite_performed: false
    };
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true });
  }
}

export async function preflightPackageTarget(version, outputDir, {
  artifactLabel = null,
  canonicalOutputDir = DEFAULT_OUTPUT_DIR
} = {}) {
  const resolvedOutputDir = resolveRepositoryRelativePath(outputDir);
  const resolvedCanonicalOutputDir = resolveRepositoryRelativePath(canonicalOutputDir);
  const isCanonicalOutput = resolvedOutputDir === resolvedCanonicalOutputDir;
  if (!isCanonicalOutput && !artifactLabel) {
    throw codedError(
      'PLUGIN_NON_RELEASE_LABEL_REQUIRED',
      'A non-default package output directory requires an explicit unique --artifact-label.'
    );
  }
  if (isCanonicalOutput && artifactLabel) {
    throw codedError(
      'PLUGIN_NON_RELEASE_OUTPUT_REQUIRED',
      'Labeled non-release packages must use an explicit non-default --output-dir.'
    );
  }
  const normalizedLabel = artifactLabel ? assertArtifactLabel(artifactLabel) : null;
  const versionName = assertPackageVersionSegment(version);
  const canonicalArtifactSet = normalizedLabel === null
    ? resolveCanonicalReleaseArtifactSet({ outputDir: resolvedOutputDir, version: versionName })
    : null;
  const artifactStem = normalizedLabel
    ? `alma-sketchup-mcp-${versionName}-nonrelease-${normalizedLabel}`
    : `alma-sketchup-mcp-${versionName}`;
  const packagePath = canonicalArtifactSet?.rbzPath
    || path.join(resolvedOutputDir, `${artifactStem}.rbz`);
  const collisionPaths = normalizedLabel
    ? [
        packagePath,
        path.join(resolvedOutputDir, `${artifactStem}.sha256`),
        path.join(resolvedOutputDir, `nonrelease-manifest-${versionName}-${normalizedLabel}.json`)
      ]
    : canonicalArtifactSet.targets;
  return { resolvedOutputDir, normalizedLabel, packagePath, collisionPaths };
}

function resolveRepositoryRelativePath(value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(REPO_ROOT, value);
}

async function assertPackageTargetsAbsent(targetPaths, { sharedCanonicalCheck = false } = {}) {
  if (sharedCanonicalCheck) {
    try {
      await assertArtifactPathsAbsent(targetPaths);
      return;
    } catch (error) {
      if (error?.code === 'RELEASE_ARTIFACT_TARGET_EXISTS') {
        throw codedError('PLUGIN_PACKAGE_TARGET_EXISTS', 'Refusing to overwrite an existing canonical release artifact or metadata target.');
      }
      throw error;
    }
  }
  for (const targetPath of targetPaths) {
    const stat = await lstatOrNull(targetPath);
    if (stat) {
      throw codedError('PLUGIN_PACKAGE_TARGET_EXISTS', `Refusing to overwrite existing package artifact or release metadata: ${targetPath}`);
    }
  }
}

async function unlinkPublishedPackageIfOwned(packagePath, stagedPackagePath) {
  const [published, staged] = await Promise.all([
    fs.lstat(packagePath).catch(() => null),
    fs.lstat(stagedPackagePath).catch(() => null)
  ]);
  if (!published || !staged || published.dev !== staged.dev || published.ino !== staged.ino) {
    throw codedError(
      'PLUGIN_PACKAGE_PUBLISH_CLEANUP_FAILED',
      'A canonical package publish conflict occurred and package ownership could not be verified for cleanup.'
    );
  }
  await fs.unlink(packagePath);
}

async function readAndSyncPublishedPackageOwned(packagePath, stagedPackagePath, expectedSnapshot, outputDir) {
  const staged = await fs.lstat(stagedPackagePath);
  if (staged.isSymbolicLink() || !staged.isFile()) {
    throw codedError('PLUGIN_PACKAGE_PUBLISH_VERIFICATION_FAILED', 'Staged package ownership cannot be verified.');
  }
  const noFollow = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const handle = await fs.open(packagePath, noFollow);
  let bytes;
  try {
    const published = await handle.stat();
    if (!published.isFile() || published.dev !== staged.dev || published.ino !== staged.ino) {
      throw codedError('PLUGIN_PACKAGE_PUBLISH_VERIFICATION_FAILED', 'Published package ownership does not match the staged artifact.');
    }
    await handle.sync();
    bytes = await handle.readFile();
    const afterRead = await handle.stat();
    const pathAfterRead = await fs.lstat(packagePath);
    const actualSnapshot = { sha256: sha256(bytes), size_bytes: bytes.length };
    if (!afterRead.isFile() || afterRead.dev !== staged.dev || afterRead.ino !== staged.ino
      || afterRead.size !== published.size || afterRead.mtimeMs !== published.mtimeMs
      || afterRead.ctimeMs !== published.ctimeMs || pathAfterRead.isSymbolicLink() || !pathAfterRead.isFile()
      || pathAfterRead.dev !== staged.dev || pathAfterRead.ino !== staged.ino
      || !managedSnapshotsEqual(actualSnapshot, expectedSnapshot)) {
      throw codedError('PLUGIN_PACKAGE_PUBLISH_VERIFICATION_FAILED', 'Published package bytes changed during final verification.');
    }
  } finally {
    await handle.close();
  }
  const directoryHandle = await fs.open(outputDir, fs.constants.O_RDONLY);
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
  return bytes;
}

async function assertPackageVersionBinding(version, sourceRoot) {
  assertPackageVersionSegment(version);
  let sourceVersion;
  let packageVersion;
  try {
    sourceVersion = await pluginVersion(sourceRoot);
    const packageJsonPath = path.join(path.resolve(sourceRoot), 'package.json');
    await assertRegularFileWithoutSymlink(packageJsonPath, 'package metadata');
    packageVersion = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))?.version;
  } catch {
    throw packageVersionMismatch();
  }
  if (sourceVersion !== version || packageVersion !== version) throw packageVersionMismatch();
}

async function pluginVersionFromLoaderPath(loaderPath) {
  const source = await fs.readFile(loaderPath, 'utf8');
  return parseUniquePluginVersion(source, packageVersionMismatch);
}

function parseUniquePluginVersion(source, errorFactory) {
  const matches = [...source.matchAll(/^\s*PLUGIN_VERSION\s*=\s*'([^'\r\n]+)'\s*$/gm)];
  if (matches.length !== 1) throw errorFactory();
  return matches[0][1];
}

function packageVersionMismatch() {
  return withPhase(
    codedError(
      'PLUGIN_PACKAGE_VERSION_MISMATCH',
      'Requested, package metadata, source loader, and staged loader versions must match exactly.'
    ),
    'version_binding'
  );
}

function assertPackageVersionSegment(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) {
    throw packageVersionMismatch();
  }
  return value;
}

export async function verifyPackagedFileList(packagePath) {
  const result = spawnSync('unzip', ['-Z1', packagePath], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`unzip verification failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  const actual = result.stdout.split(/\r?\n/).filter(Boolean).sort();
  const expected = PLUGIN_FILES.map((file) => file.target).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw codedError('PLUGIN_PACKAGE_FILE_SET_MISMATCH', 'Packaged RBZ file set does not match the declared plugin manifest.');
  }
}

export async function verifyPackagedPluginBytes(packagePath, sourceRoot = REPO_ROOT) {
  const sourceManifest = await checkSourceFiles(sourceRoot);
  return verifyPackagedPluginBytesAgainstManifest(packagePath, sourceManifest);
}

async function verifyPackagedPluginBytesAgainstManifest(packagePath, sourceManifest) {
  await verifyPackagedFileList(packagePath);
  const archiveManifest = {};
  for (const file of PLUGIN_FILES) {
    const expected = sourceManifest[file.target];
    const result = spawnSync('unzip', ['-p', packagePath, file.target], {
      maxBuffer: Math.max(256 * 1024, expected.size_bytes + (64 * 1024))
    });
    if (result.status !== 0 || result.error || !Buffer.isBuffer(result.stdout)) {
      throw codedError('PLUGIN_PACKAGE_MEMBER_INVALID', 'A packaged plugin member could not be read safely.');
    }
    const actual = { sha256: sha256(result.stdout), size_bytes: result.stdout.length };
    if (actual.sha256 !== expected.sha256 || actual.size_bytes !== expected.size_bytes) {
      throw codedError('PLUGIN_PACKAGE_BYTE_VERIFICATION_FAILED', 'Packaged plugin bytes do not match the verified source manifest.');
    }
    archiveManifest[file.target] = actual;
  }
  return Object.freeze({
    file_count: PLUGIN_FILES.length,
    manifest_sha256: sha256(Buffer.from(stableManifestJson(archiveManifest)))
  });
}

export async function readPackagedPluginVersion(packagePath) {
  await verifyPackagedFileList(packagePath);
  const result = spawnSync('unzip', ['-p', packagePath, MANAGED_LOADER], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024
  });
  if (result.status !== 0 || result.error) {
    throw codedError('PLUGIN_PACKAGE_LOADER_INVALID', 'Packaged plugin loader could not be read safely.');
  }
  return parseUniquePluginVersion(
    result.stdout,
    () => codedError('PLUGIN_PACKAGE_LOADER_INVALID', 'Packaged plugin loader must have one unique plugin version declaration.')
  );
}

function assertArtifactLabel(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$/.test(value)) {
    throw codedError('PLUGIN_ARTIFACT_LABEL_INVALID', 'Artifact label must be 2-64 safe filename characters.');
  }
  return value;
}

function transactionItem(name, expectedType, installRoot, stageDir, backupDir, failedActivationDir) {
  return {
    name,
    expectedType,
    final: path.join(installRoot, name),
    stage: path.join(stageDir, name),
    backup: path.join(backupDir, name),
    failedActivation: path.join(failedActivationDir, name),
    existed: false,
    backedUp: false,
    activated: false,
    quarantined: false,
    backupSnapshot: null,
    stagedSnapshot: null
  };
}

async function backupExistingTarget(item, expectedSnapshot) {
  const stat = await lstatOrNull(item.final);
  item.existed = stat !== null;
  if (!stat) {
    if (expectedSnapshot !== null) throw targetChangedDuringInstall('backup_verification');
    return;
  }
  if (expectedSnapshot === null) throw targetChangedDuringInstall('backup_verification');
  assertExpectedManagedType(stat, item.expectedType, item.final);
  try {
    await fs.rename(item.final, item.backup);
  } catch (error) {
    if (['ENOENT', 'EEXIST', 'ENOTEMPTY'].includes(error?.code)) {
      throw targetChangedDuringInstall('backup_verification');
    }
    throw error;
  }
  item.backedUp = true;
  item.backupSnapshot = await snapshotManagedTargetForRecovery(item.backup, item.expectedType);
  assertManagedSnapshotEqual(item.backupSnapshot, expectedSnapshot, 'backup_verification');
}

async function activateStagedTarget(item) {
  if (await lstatOrNull(item.final)) throw targetChangedDuringInstall('activation');
  try {
    if (item.expectedType === 'file') {
      await fs.link(item.stage, item.final);
      item.activated = true;
      await fs.unlink(item.stage);
    } else {
      await fs.rename(item.stage, item.final);
      item.activated = true;
    }
  } catch (error) {
    if (['EEXIST', 'ENOTEMPTY', 'EISDIR', 'ENOTDIR'].includes(error?.code)) {
      throw targetChangedDuringInstall('activation');
    }
    throw error;
  }
}

async function rollbackInstall(state) {
  const managedMutationOccurred = [state.loader, state.module]
    .some((item) => item.backedUp || item.activated || item.quarantined);
  if (!managedMutationOccurred) return { ok: true, errors: [], phase: null };

  const errors = [];
  let phase = null;
  const record = (error, fallbackPhase) => {
    if (!error?.phase) error.phase = fallbackPhase;
    phase ||= error.phase;
    errors.push(error);
  };

  for (const item of [state.loader, state.module]) {
    if (!item.activated) continue;
    try {
      await fs.mkdir(state.failedActivationDir, { recursive: true });
      const current = await lstatOrNull(item.final);
      if (!current) {
        item.activated = false;
        continue;
      }
      assertExpectedManagedType(current, item.expectedType, item.final);
      await fs.rename(item.final, item.failedActivation);
      item.activated = false;
      item.quarantined = true;
      const quarantinedSnapshot = await snapshotManagedTargetForRecovery(item.failedActivation, item.expectedType);
      if (!managedSnapshotsEqual(quarantinedSnapshot, item.stagedSnapshot)) {
        throw withPhase(
          codedError('PLUGIN_ROLLBACK_TARGET_CHANGED', 'A managed target changed before rollback and was preserved for recovery.'),
          'rollback_remove_activation'
        );
      }
    } catch (error) {
      record(error, 'rollback_remove_activation');
    }
  }

  for (const item of [state.module, state.loader]) {
    if (!item.backedUp) continue;
    try {
      await callHook(state.hooks, 'beforeRollbackRestore', { state, item });
      if (await lstatOrNull(item.final)) {
        throw withPhase(
          codedError('PLUGIN_ROLLBACK_TARGET_OCCUPIED', 'A rollback target is occupied; preserved backup bytes were not overwritten.'),
          'rollback_restore'
        );
      }
      await fs.rename(item.backup, item.final);
      item.backedUp = false;
      const restoredSnapshot = await snapshotManagedTargetForRecovery(item.final, item.expectedType);
      if (!managedSnapshotsEqual(restoredSnapshot, item.backupSnapshot)) {
        throw withPhase(
          codedError('PLUGIN_ROLLBACK_VERIFICATION_FAILED', 'Restored managed bytes do not match the preserved backup.'),
          'rollback_verify'
        );
      }
    } catch (error) {
      record(error, 'rollback_restore');
    }
  }

  for (const item of [state.loader, state.module]) {
    if (item.existed || item.backedUp || item.activated) continue;
    try {
      if (await lstatOrNull(item.final)) {
        throw withPhase(
          codedError('PLUGIN_ROLLBACK_VERIFICATION_FAILED', 'A first-install rollback left a managed target behind.'),
          'rollback_verify'
        );
      }
    } catch (error) {
      record(error, 'rollback_verify');
    }
  }

  return { ok: errors.length === 0, errors, phase };
}

function targetChangedDuringInstall(phase) {
  return withPhase(
    codedError(
      'PLUGIN_TARGET_CHANGED_DURING_INSTALL',
      'Managed plugin targets changed during installation; current external content was not overwritten.'
    ),
    phase
  );
}

function assertManagedSnapshotEqual(actual, expected, phase) {
  if (!managedSnapshotsEqual(actual, expected)) throw targetChangedDuringInstall(phase);
}

function managedSnapshotsEqual(left, right) {
  return stableManifestJson(left) === stableManifestJson(right);
}

async function inspectExistingManagedInstall(pluginRoot) {
  const loaderPath = path.join(pluginRoot, MANAGED_LOADER);
  const modulePath = path.join(pluginRoot, MANAGED_MODULE_DIR);
  const loaderStat = await lstatOrNull(loaderPath);
  const moduleStat = await lstatOrNull(modulePath);

  if (loaderStat?.isSymbolicLink() || moduleStat?.isSymbolicLink()) {
    throw codedError('PLUGIN_TARGET_SYMLINK_REJECTED', 'Existing managed plugin targets must not be symbolic links.');
  }
  if (loaderStat) assertExpectedManagedType(loaderStat, 'file', loaderPath);
  if (moduleStat) assertExpectedManagedType(moduleStat, 'directory', modulePath);

  const loader = loaderStat ? await snapshotRegularFile(loaderPath) : null;
  const module = moduleStat ? await snapshotFlatDirectory(modulePath) : null;
  if (loader) {
    const loaderSource = await fs.readFile(loaderPath, 'utf8');
    if (!/module\s+AlmaSketchupMCP\b/.test(loaderSource) || !/PLUGIN_VERSION\s*=/.test(loaderSource)) {
      throw codedError('PLUGIN_TARGET_OWNERSHIP_UNVERIFIED', `Refusing to overwrite an unrecognized file: ${loaderPath}`);
    }
  }
  if (!loader && module) {
    const markerPath = path.join(modulePath, 'operation_registry.rb');
    const markerStat = await lstatOrNull(markerPath);
    if (!markerStat || markerStat.isSymbolicLink() || !markerStat.isFile()
      || !/module\s+AlmaSketchupMCP\b/.test(await fs.readFile(markerPath, 'utf8'))) {
      throw codedError('PLUGIN_TARGET_OWNERSHIP_UNVERIFIED', `Refusing to overwrite an unrecognized directory: ${modulePath}`);
    }
  }
  return { loader, module };
}

async function snapshotRegularFile(filePath) {
  await assertRegularFileWithoutSymlink(filePath, `managed plugin file ${filePath}`);
  const bytes = await fs.readFile(filePath);
  return { sha256: sha256(bytes), size_bytes: bytes.length };
}

async function snapshotManagedTargetForRecovery(targetPath, expectedType) {
  const stat = await fs.lstat(targetPath);
  assertExpectedManagedType(stat, expectedType, targetPath);
  if (expectedType === 'file') return snapshotRegularFile(targetPath);
  return snapshotDirectoryForRecovery(targetPath);
}

async function snapshotDirectoryForRecovery(directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const snapshot = {};
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isFile()) {
      snapshot[entry.name] = await snapshotRegularFile(entryPath);
    } else if (entry.isDirectory()) {
      snapshot[entry.name] = {
        kind: 'directory',
        entries: await snapshotDirectoryForRecovery(entryPath)
      };
    } else if (entry.isSymbolicLink()) {
      snapshot[entry.name] = {
        kind: 'symlink',
        target_sha256: sha256(Buffer.from(await fs.readlink(entryPath)))
      };
    } else {
      snapshot[entry.name] = { kind: 'unsupported' };
    }
  }
  return snapshot;
}

async function snapshotFlatDirectory(directoryPath) {
  const stat = await fs.lstat(directoryPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw codedError('PLUGIN_TARGET_TYPE_REJECTED', `Managed plugin module target is not a real directory: ${directoryPath}`);
  }
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const files = {};
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) {
      throw codedError('PLUGIN_TARGET_SYMLINK_REJECTED', `Refusing symbolic link inside managed plugin directory: ${entry.name}`);
    }
    if (!entry.isFile()) {
      throw codedError('PLUGIN_TARGET_TYPE_REJECTED', `Refusing unexpected non-file inside managed plugin directory: ${entry.name}`);
    }
    const entryPath = path.join(directoryPath, entry.name);
    if (!entry.name.endsWith('.rb') || !/module\s+AlmaSketchupMCP\b/.test(await fs.readFile(entryPath, 'utf8'))) {
      throw codedError('PLUGIN_TARGET_OWNERSHIP_UNVERIFIED', `Refusing to replace an unrecognized managed-directory entry: ${entry.name}`);
    }
    files[entry.name] = await snapshotRegularFile(entryPath);
  }
  return files;
}

async function assertExactModuleEntries(pluginRoot) {
  const modulePath = path.join(pluginRoot, MANAGED_MODULE_DIR);
  const stat = await fs.lstat(modulePath).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    throw codedError('PLUGIN_MODULE_DIRECTORY_INVALID', `Missing or unsafe plugin module directory: ${modulePath}`);
  }
  const actual = await fs.readdir(modulePath, { withFileTypes: true });
  for (const entry of actual) {
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw codedError('PLUGIN_MODULE_ENTRY_INVALID', `Plugin module entry must be a regular file: ${entry.name}`);
    }
  }
  const actualNames = actual.map((entry) => entry.name).sort();
  const expectedNames = PLUGIN_FILES
    .filter((file) => file.target.startsWith(`${MANAGED_MODULE_DIR}/`))
    .map((file) => path.posix.basename(file.target))
    .sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw codedError('PLUGIN_FILE_SET_MISMATCH', 'Plugin module file set does not match the declared packaging manifest.');
  }
}

function assertPluginFileDefinitions() {
  const sources = new Set();
  const targets = new Set();
  for (const file of PLUGIN_FILES) {
    if (!isSafeRelativePath(file.source) || !file.source.startsWith('sketchup_plugin/')) {
      throw codedError('PLUGIN_SOURCE_PATH_INVALID', `Unsafe plugin source path: ${file.source}`);
    }
    if (!isSafeRelativePath(file.target)
      || (file.target !== MANAGED_LOADER && !file.target.startsWith(`${MANAGED_MODULE_DIR}/`))) {
      throw codedError('PLUGIN_TARGET_PATH_INVALID', `Unsafe plugin target path: ${file.target}`);
    }
    if (sources.has(file.source) || targets.has(file.target)) {
      throw codedError('PLUGIN_FILE_MAPPING_DUPLICATE', `Duplicate plugin file mapping: ${file.target}`);
    }
    sources.add(file.source);
    targets.add(file.target);
  }
  if (!targets.has(MANAGED_LOADER)) {
    throw codedError('PLUGIN_LOADER_MAPPING_MISSING', 'Plugin loader mapping is missing.');
  }
}

function managedTargetPath(pluginRoot, relativeTarget) {
  if (!isSafeRelativePath(relativeTarget)) {
    throw codedError('PLUGIN_TARGET_PATH_INVALID', `Unsafe plugin target path: ${relativeTarget}`);
  }
  const target = path.resolve(pluginRoot, ...relativeTarget.split('/'));
  assertContainedPath(path.resolve(pluginRoot), target, `plugin target ${relativeTarget}`);
  return target;
}

function sourceFilePath(sourceRoot, relativeSource) {
  if (!isSafeRelativePath(relativeSource)) {
    throw codedError('PLUGIN_SOURCE_PATH_INVALID', `Unsafe plugin source path: ${relativeSource}`);
  }
  const source = path.resolve(sourceRoot, ...relativeSource.split('/'));
  assertContainedPath(path.resolve(sourceRoot), source, `plugin source ${relativeSource}`);
  return source;
}

function assertContainedPath(root, candidate, label) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw codedError('PLUGIN_PATH_ESCAPE_REJECTED', `${label} escapes its allowed root.`);
  }
}

function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || value.includes('\u0000')
    || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  const segments = value.split('/');
  return path.posix.normalize(value) === value
    && segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

async function assertNoSymlinkComponents(candidatePath, { allowMissingTail }) {
  const absolute = path.resolve(candidatePath);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  const segments = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (allowMissingTail && error?.code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw codedError('PLUGIN_PATH_SYMLINK_REJECTED', `Symbolic links are not allowed in plugin install paths: ${current}`);
    }
  }
}

async function assertRegularFileWithoutSymlink(filePath, label) {
  const stat = await fs.lstat(filePath).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
    throw codedError('PLUGIN_FILE_INVALID', `${label} must be a regular, non-symlink file.`);
  }
}

function assertExpectedManagedType(stat, expectedType, targetPath) {
  if (stat.isSymbolicLink()) {
    throw codedError('PLUGIN_TARGET_SYMLINK_REJECTED', `Refusing symbolic-link plugin target: ${targetPath}`);
  }
  const matches = expectedType === 'file' ? stat.isFile() : stat.isDirectory();
  if (!matches) {
    throw codedError('PLUGIN_TARGET_TYPE_REJECTED', `Unexpected managed target type at ${targetPath}; expected ${expectedType}.`);
  }
}

async function lstatOrNull(filePath) {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function callHook(hooks, name, context) {
  const hook = hooks?.[name];
  if (typeof hook === 'function') await hook(context);
}

function stableManifestJson(value) {
  return JSON.stringify(sortObject(value));
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function withPhase(error, phase) {
  error.phase = phase;
  return error;
}

function publicErrorCode(error) {
  return typeof error?.code === 'string' && /^[A-Z0-9_]{3,96}$/.test(error.code)
    ? error.code
    : 'PLUGIN_INSTALL_FAILED';
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
    allowedPluginRoot: DEFAULT_PLUGIN_DIR,
    pluginDirExplicit: false,
    allowedPluginRootExplicit: false,
    outputDir: DEFAULT_OUTPUT_DIR,
    outputDirExplicit: false,
    artifactLabel: null
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
    } else if (arg === '--plugin-dir') {
      options.pluginDir = requiredArgValue(argv, ++index, '--plugin-dir');
      options.pluginDirExplicit = true;
    } else if (arg === '--allowed-plugin-root') {
      options.allowedPluginRoot = requiredArgValue(argv, ++index, '--allowed-plugin-root');
      options.allowedPluginRootExplicit = true;
    } else if (arg === '--output-dir') {
      options.outputDir = requiredArgValue(argv, ++index, '--output-dir');
      options.outputDirExplicit = true;
    } else if (arg === '--artifact-label') {
      options.artifactLabel = requiredArgValue(argv, ++index, '--artifact-label');
    }
    else if (arg === '--help' || arg === '-h') return usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.install && options.pluginDirExplicit && !options.allowedPluginRootExplicit
    && path.resolve(options.pluginDir) !== path.resolve(DEFAULT_PLUGIN_DIR)) {
    throw codedError(
      'PLUGIN_ALLOWED_ROOT_REQUIRED',
      'A custom --plugin-dir requires the same explicit --allowed-plugin-root.'
    );
  }
  if (options.package && resolveRepositoryRelativePath(options.outputDir) !== resolveRepositoryRelativePath(DEFAULT_OUTPUT_DIR)
    && !options.artifactLabel) {
    throw codedError(
      'PLUGIN_NON_RELEASE_LABEL_REQUIRED',
      'A non-default --output-dir requires a unique --artifact-label.'
    );
  }
  if (options.package && options.artifactLabel
    && resolveRepositoryRelativePath(options.outputDir) === resolveRepositoryRelativePath(DEFAULT_OUTPUT_DIR)) {
    throw codedError(
      'PLUGIN_NON_RELEASE_OUTPUT_REQUIRED',
      'A labeled non-release artifact requires an explicit non-default --output-dir.'
    );
  }
  if (!options.check && !options.install && !options.package) options.check = true;
  return options;
}

function requiredArgValue(argv, index, optionName) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${optionName} requires a value.`);
  return value;
}

function usage() {
  process.stdout.write(`Usage:
  node scripts/package-sketchup-plugin.mjs --check
  node scripts/package-sketchup-plugin.mjs --check --install
  node scripts/package-sketchup-plugin.mjs --check --install --plugin-dir /exact/root --allowed-plugin-root /exact/root
  node scripts/package-sketchup-plugin.mjs --check --package
  node scripts/package-sketchup-plugin.mjs --check --package --output-dir out/previews/unique-run --artifact-label unique-run
  node scripts/package-sketchup-plugin.mjs --all

Install safety:
  - custom install roots require an exact --allowed-plugin-root match;
  - symbolic links and unexpected managed target types are rejected;
  - source, staged, and installed bytes are verified before success;
  - a complete SketchUp restart is required before live runtime verification.
  - package artifacts and release metadata are create-new-only and are never overwritten;
  - non-default package outputs are named nonrelease-<label> and cannot impersonate a signed RC.
`);
  process.exit(0);
}

if (path.resolve(process.argv[1] || '') === SCRIPT_PATH) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
