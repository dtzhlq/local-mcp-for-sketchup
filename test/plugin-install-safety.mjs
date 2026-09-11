import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkSourceFiles,
  installPluginAtomic,
  packagePlugin,
  preflightPackageTarget,
  PLUGIN_FILES
} from '../scripts/package-sketchup-plugin.mjs';
import {
  acquireReleaseArtifactSetLock
} from '../scripts/release-artifact-set.mjs';
import { PRODUCT_VERSION } from '../src/version.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const realTmpRoot = await fs.realpath(os.tmpdir());
const testRoot = await fs.mkdtemp(path.join(realTmpRoot, 'alma-plugin-install-safety-'));
let assertions = 0;

try {
  const sourceManifest = await checkSourceFiles(repoRoot);
  progress('source checked');
  assert.equal(Object.keys(sourceManifest).length, PLUGIN_FILES.length); assertions += 1;

  const installRoot = await makeInstallRoot('successful-install');
  const installResult = await installPluginAtomic({
    pluginDir: installRoot,
    allowedPluginRoot: installRoot,
    sourceRoot: repoRoot
  });
  assert.equal(installResult.plugin_dir, installRoot); assertions += 1;
  assert.equal(installResult.file_count, PLUGIN_FILES.length); assertions += 1;
  assert.match(installResult.manifest_sha256, /^[0-9a-f]{64}$/); assertions += 1;
  assert.equal(installResult.installed_bytes_verified, true); assertions += 1;
  assert.equal(installResult.runtime_activation, 'requires_complete_sketchup_restart'); assertions += 1;
  assert.equal(installResult.live_runtime_verified, false); assertions += 1;
  const baseline = await pluginTreeManifest(installRoot);
  assert.deepEqual(baseline, sourceManifest); assertions += 1;
  await assertNoTransactionDebris(installRoot); assertions += 1;
  progress('successful install');

  const concurrentInstallRoot = await makeInstallRoot('concurrent-install-lock');
  const stageGate = deferred();
  const stageEntered = deferred();
  let firstBackupReached = false;
  let secondBackupReached = false;
  const firstInstall = installPluginAtomic({
    pluginDir: concurrentInstallRoot,
    allowedPluginRoot: concurrentInstallRoot,
    sourceRoot: repoRoot,
    hooks: {
      afterStageVerified() {
        stageEntered.resolve();
        return stageGate.promise;
      },
      afterBackup() { firstBackupReached = true; }
    }
  });
  const installLockPath = path.join(concurrentInstallRoot, '.alma-sketchup-mcp.install.lock');
  await stageEntered.promise;
  assert.equal((await fs.lstat(installLockPath)).mode & 0o777, 0o600); assertions += 1;
  const transactionCountBeforeSecond = (await fs.readdir(concurrentInstallRoot))
    .filter((name) => name.startsWith('.alma-sketchup-mcp-install-')).length;
  assert.equal(firstBackupReached, false); assertions += 1;
  await assert.rejects(
    installPluginAtomic({
      pluginDir: concurrentInstallRoot,
      allowedPluginRoot: concurrentInstallRoot,
      sourceRoot: repoRoot,
      hooks: { afterBackup() { secondBackupReached = true; } }
    }),
    (error) => error?.code === 'PLUGIN_INSTALL_LOCKED'
  ); assertions += 1;
  assert.equal(secondBackupReached, false); assertions += 1;
  assert.equal(
    (await fs.readdir(concurrentInstallRoot)).filter((name) => name.startsWith('.alma-sketchup-mcp-install-')).length,
    transactionCountBeforeSecond
  ); assertions += 1;
  stageGate.resolve();
  await firstInstall;
  assert.equal(firstBackupReached, true); assertions += 1;
  await assertNoTransactionDebris(concurrentInstallRoot); assertions += 1;
  progress('concurrent install lock');

  let copiedBeforeFailure = 0;
  await assert.rejects(
    installPluginAtomic({
      pluginDir: installRoot,
      allowedPluginRoot: installRoot,
      sourceRoot: repoRoot,
      hooks: {
        afterStageFileCopied({ copied }) {
          copiedBeforeFailure = copied;
          if (copied === 3) throw new Error('injected stage copy failure');
        }
      }
    }),
    /injected stage copy failure/
  ); assertions += 1;
  assert.equal(copiedBeforeFailure, 3); assertions += 1;
  assert.deepEqual(await pluginTreeManifest(installRoot), baseline); assertions += 1;
  await assertNoTransactionDebris(installRoot); assertions += 1;
  progress('stage failure rollback');

  const alternateSourceRoot = await makeAlternateSource('alternate-source');
  await appendComment(alternateSourceRoot, 'sketchup_plugin/alma_sketchup_mcp.rb', '# alternate loader bytes');
  await appendComment(alternateSourceRoot, 'sketchup_plugin/alma_sketchup_mcp/snapshot.rb', '# alternate module bytes');
  const alternateManifest = await checkSourceFiles(alternateSourceRoot);
  progress('alternate source checked');
  assert.notEqual(
    alternateManifest['alma_sketchup_mcp.rb'].sha256,
    sourceManifest['alma_sketchup_mcp.rb'].sha256
  ); assertions += 1;

  const driftInstallRoot = await makeInstallRoot('target-drift-before-backup');
  await installPluginAtomic({
    pluginDir: driftInstallRoot,
    allowedPluginRoot: driftInstallRoot,
    sourceRoot: repoRoot
  });
  const driftLoaderPath = path.join(driftInstallRoot, 'alma_sketchup_mcp.rb');
  const externallyChangedLoader = `${await fs.readFile(driftLoaderPath, 'utf8')}\n# external concurrent edit\n`;
  await assert.rejects(
    installPluginAtomic({
      pluginDir: driftInstallRoot,
      allowedPluginRoot: driftInstallRoot,
      sourceRoot: alternateSourceRoot,
      hooks: {
        async beforeBackupSnapshotCheck() {
          await fs.writeFile(driftLoaderPath, externallyChangedLoader, 'utf8');
        }
      }
    }),
    (error) => error?.code === 'PLUGIN_TARGET_CHANGED_DURING_INSTALL'
      && error?.phase === 'pre_backup_snapshot'
  ); assertions += 1;
  assert.equal(await fs.readFile(driftLoaderPath, 'utf8'), externallyChangedLoader); assertions += 1;
  await assertNoTransactionDebris(driftInstallRoot); assertions += 1;
  progress('target drift preserved before backup');
  assert.notEqual(
    alternateManifest['alma_sketchup_mcp/snapshot.rb'].sha256,
    sourceManifest['alma_sketchup_mcp/snapshot.rb'].sha256
  ); assertions += 1;

  await assert.rejects(
    installPluginAtomic({
      pluginDir: installRoot,
      allowedPluginRoot: installRoot,
      sourceRoot: alternateSourceRoot,
      hooks: {
        afterModuleActivated() { throw new Error('injected activation failure'); }
      }
    }),
    /injected activation failure/
  ); assertions += 1;
  assert.deepEqual(await pluginTreeManifest(installRoot), baseline); assertions += 1;
  await assertNoTransactionDebris(installRoot); assertions += 1;
  progress('activation rollback');

  const incompleteRollbackRoot = await makeInstallRoot('incomplete-rollback-recovery');
  await installPluginAtomic({
    pluginDir: incompleteRollbackRoot,
    allowedPluginRoot: incompleteRollbackRoot,
    sourceRoot: repoRoot
  });
  const oldLoaderBytes = await fs.readFile(path.join(incompleteRollbackRoot, 'alma_sketchup_mcp.rb'));
  const rollbackBlocker = 'external blocker must not be overwritten\n';
  let incompleteRollbackError = null;
  try {
    await installPluginAtomic({
      pluginDir: incompleteRollbackRoot,
      allowedPluginRoot: incompleteRollbackRoot,
      sourceRoot: alternateSourceRoot,
      hooks: {
        afterLoaderActivated() { throw new Error('injected failure requiring rollback'); },
        async beforeRollbackRestore({ item }) {
          if (item.name === 'alma_sketchup_mcp.rb') {
            await fs.writeFile(item.final, rollbackBlocker, { encoding: 'utf8', flag: 'wx' });
          }
        }
      }
    });
  } catch (error) {
    incompleteRollbackError = error;
  }
  assert.equal(incompleteRollbackError?.code, 'PLUGIN_INSTALL_ROLLBACK_INCOMPLETE'); assertions += 1;
  assert.equal(incompleteRollbackError?.phase, 'rollback_restore'); assertions += 1;
  assert.equal(typeof incompleteRollbackError?.recovery_path, 'string'); assertions += 1;
  assert.deepEqual(incompleteRollbackError?.rollback_error_codes, ['PLUGIN_ROLLBACK_TARGET_OCCUPIED']); assertions += 1;
  assert.equal(
    await fs.readFile(path.join(incompleteRollbackRoot, 'alma_sketchup_mcp.rb'), 'utf8'),
    rollbackBlocker
  ); assertions += 1;
  const preservedLoaderPath = path.join(
    incompleteRollbackError.recovery_path,
    'backup',
    'alma_sketchup_mcp.rb'
  );
  assert.deepEqual(await fs.readFile(preservedLoaderPath), oldLoaderBytes); assertions += 1;
  assert.equal((await fs.lstat(incompleteRollbackError.recovery_path)).mode & 0o777, 0o700); assertions += 1;
  assert.equal(
    (await fs.lstat(path.join(incompleteRollbackRoot, '.alma-sketchup-mcp.install.lock'))).mode & 0o777,
    0o600
  ); assertions += 1;
  assert.equal(incompleteRollbackError.message.includes(rollbackBlocker.trim()), false); assertions += 1;
  progress('incomplete rollback recovery preserved');

  await assert.rejects(
    installPluginAtomic({
      pluginDir: installRoot,
      allowedPluginRoot: installRoot,
      sourceRoot: alternateSourceRoot,
      hooks: {
        afterModuleActivated() { process.emit('SIGTERM'); }
      }
    }),
    (error) => error?.code === 'PLUGIN_INSTALL_INTERRUPTED'
  ); assertions += 1;
  assert.deepEqual(await pluginTreeManifest(installRoot), baseline); assertions += 1;
  await assertNoTransactionDebris(installRoot); assertions += 1;
  progress('signal rollback');

  let postActivationTamperError = null;
  try {
    await installPluginAtomic({
      pluginDir: installRoot,
      allowedPluginRoot: installRoot,
      sourceRoot: alternateSourceRoot,
      hooks: {
        async beforePostVerify({ state }) {
          await fs.appendFile(path.join(state.installRoot, 'alma_sketchup_mcp', 'snapshot.rb'), '\n# post-activation tamper\n');
        }
      }
    });
  } catch (error) {
    postActivationTamperError = error;
  }
  assert.equal(postActivationTamperError?.code, 'PLUGIN_INSTALL_ROLLBACK_INCOMPLETE'); assertions += 1;
  assert.equal(postActivationTamperError?.original_error_code, 'PLUGIN_BYTE_VERIFICATION_FAILED'); assertions += 1;
  assert.deepEqual(postActivationTamperError?.rollback_error_codes, ['PLUGIN_ROLLBACK_TARGET_CHANGED']); assertions += 1;
  assert.deepEqual(await pluginTreeManifest(installRoot), baseline); assertions += 1;
  assert.equal(
    await pathExists(path.join(postActivationTamperError.recovery_path, 'failed-activation', 'alma_sketchup_mcp')),
    true
  ); assertions += 1;
  progress('post-activation tamper preserved for recovery');

  const emptyInstallRoot = await makeInstallRoot('first-install-rollback');
  await assert.rejects(
    installPluginAtomic({
      pluginDir: emptyInstallRoot,
      allowedPluginRoot: emptyInstallRoot,
      sourceRoot: repoRoot,
      hooks: {
        afterModuleActivated() { throw new Error('injected first-install activation failure'); }
      }
    }),
    /injected first-install activation failure/
  ); assertions += 1;
  assert.equal(await pathExists(path.join(emptyInstallRoot, 'alma_sketchup_mcp.rb')), false); assertions += 1;
  assert.equal(await pathExists(path.join(emptyInstallRoot, 'alma_sketchup_mcp')), false); assertions += 1;
  await assertNoTransactionDebris(emptyInstallRoot); assertions += 1;
  progress('first install rollback');

  const outsideFile = path.join(testRoot, 'outside-sentinel.rb');
  await fs.writeFile(outsideFile, 'outside must remain unchanged\n', 'utf8');
  const targetSymlinkRoot = await makeInstallRoot('target-symlink-rejection');
  await fs.symlink(outsideFile, path.join(targetSymlinkRoot, 'alma_sketchup_mcp.rb'));
  await assert.rejects(
    installPluginAtomic({
      pluginDir: targetSymlinkRoot,
      allowedPluginRoot: targetSymlinkRoot,
      sourceRoot: repoRoot
    }),
    (error) => error?.code === 'PLUGIN_TARGET_SYMLINK_REJECTED'
  ); assertions += 1;
  assert.equal(await fs.readFile(outsideFile, 'utf8'), 'outside must remain unchanged\n'); assertions += 1;
  assert.equal(await pathExists(path.join(targetSymlinkRoot, 'alma_sketchup_mcp')), false); assertions += 1;
  progress('target symlink rejection');

  const realAliasTarget = await makeInstallRoot('real-alias-target');
  const aliasPath = path.join(testRoot, 'install-root-alias');
  await fs.symlink(realAliasTarget, aliasPath);
  await assert.rejects(
    installPluginAtomic({
      pluginDir: aliasPath,
      allowedPluginRoot: aliasPath,
      sourceRoot: repoRoot
    }),
    (error) => error?.code === 'PLUGIN_PATH_SYMLINK_REJECTED'
  ); assertions += 1;
  assert.deepEqual(await fs.readdir(realAliasTarget), []); assertions += 1;
  progress('root symlink rejection');

  const disallowedRoot = path.join(testRoot, 'not-created-disallowed-root');
  const differentAllowedRoot = path.join(testRoot, 'different-allowed-root');
  await assert.rejects(
    installPluginAtomic({
      pluginDir: disallowedRoot,
      allowedPluginRoot: differentAllowedRoot,
      sourceRoot: repoRoot
    }),
    (error) => error?.code === 'PLUGIN_INSTALL_ROOT_NOT_ALLOWED'
  ); assertions += 1;
  assert.equal(await pathExists(disallowedRoot), false); assertions += 1;
  assert.equal(await pathExists(differentAllowedRoot), false); assertions += 1;
  progress('allowed root rejection');

  const unownedTargetRoot = await makeInstallRoot('unowned-target');
  const unownedLoader = path.join(unownedTargetRoot, 'alma_sketchup_mcp.rb');
  await fs.writeFile(unownedLoader, 'unrelated user file\n', 'utf8');
  await assert.rejects(
    installPluginAtomic({
      pluginDir: unownedTargetRoot,
      allowedPluginRoot: unownedTargetRoot,
      sourceRoot: repoRoot
    }),
    (error) => error?.code === 'PLUGIN_TARGET_OWNERSHIP_UNVERIFIED'
  ); assertions += 1;
  assert.equal(await fs.readFile(unownedLoader, 'utf8'), 'unrelated user file\n'); assertions += 1;
  assert.equal(await pathExists(path.join(unownedTargetRoot, 'alma_sketchup_mcp')), false); assertions += 1;
  progress('unowned loader rejection');

  const unownedModuleRoot = await makeInstallRoot('unowned-module-entry');
  await fs.copyFile(
    path.join(repoRoot, 'sketchup_plugin/alma_sketchup_mcp.rb'),
    path.join(unownedModuleRoot, 'alma_sketchup_mcp.rb')
  );
  await fs.mkdir(path.join(unownedModuleRoot, 'alma_sketchup_mcp'));
  const unownedModuleEntry = path.join(unownedModuleRoot, 'alma_sketchup_mcp', 'notes.txt');
  await fs.writeFile(unownedModuleEntry, 'user-owned data\n', 'utf8');
  await assert.rejects(
    installPluginAtomic({
      pluginDir: unownedModuleRoot,
      allowedPluginRoot: unownedModuleRoot,
      sourceRoot: repoRoot
    }),
    (error) => error?.code === 'PLUGIN_TARGET_OWNERSHIP_UNVERIFIED'
  ); assertions += 1;
  assert.equal(await fs.readFile(unownedModuleEntry, 'utf8'), 'user-owned data\n'); assertions += 1;
  progress('unowned module rejection');

  const wrongTypeRoot = await makeInstallRoot('wrong-target-type');
  await fs.mkdir(path.join(wrongTypeRoot, 'alma_sketchup_mcp.rb'));
  await assert.rejects(
    installPluginAtomic({
      pluginDir: wrongTypeRoot,
      allowedPluginRoot: wrongTypeRoot,
      sourceRoot: repoRoot
    }),
    (error) => error?.code === 'PLUGIN_TARGET_TYPE_REJECTED'
  ); assertions += 1;
  assert.equal((await fs.lstat(path.join(wrongTypeRoot, 'alma_sketchup_mcp.rb'))).isDirectory(), true); assertions += 1;
  progress('wrong type rejection');

  const symlinkSourceRoot = await makeAlternateSource('symlink-source');
  const symlinkSourceFile = path.join(symlinkSourceRoot, 'sketchup_plugin/alma_sketchup_mcp/snapshot.rb');
  await fs.rm(symlinkSourceFile);
  await fs.symlink(
    path.join(repoRoot, 'sketchup_plugin/alma_sketchup_mcp/snapshot.rb'),
    symlinkSourceFile
  );
  const untouchedRoot = path.join(testRoot, 'source-rejection-does-not-create-target');
  await assert.rejects(
    installPluginAtomic({
      pluginDir: untouchedRoot,
      allowedPluginRoot: untouchedRoot,
      sourceRoot: symlinkSourceRoot
    }),
    (error) => error?.code === 'PLUGIN_FILE_INVALID'
  ); assertions += 1;
  assert.equal(await pathExists(untouchedRoot), false); assertions += 1;
  progress('source symlink rejection');

  const packageVersion = PRODUCT_VERSION;
  const previousCwd = process.cwd();
  try {
    process.chdir(testRoot);
    const unrelatedCwdPlan = await preflightPackageTarget(packageVersion, 'out/releases');
    assert.equal(unrelatedCwdPlan.resolvedOutputDir, path.join(repoRoot, 'out/releases')); assertions += 1;
  } finally {
    process.chdir(previousCwd);
  }
  progress('repository-relative canonical output');

  const versionMismatchRoot = path.join(testRoot, 'version-mismatch-output-not-created');
  await assert.rejects(
    packagePlugin('0.1.0-rc.999', versionMismatchRoot, repoRoot, {
      artifactLabel: 'version-mismatch',
      canonicalOutputDir: path.join(testRoot, 'canonical-release-root')
    }),
    (error) => error?.code === 'PLUGIN_PACKAGE_VERSION_MISMATCH'
      && error?.phase === 'version_binding'
  ); assertions += 1;
  assert.equal(await pathExists(versionMismatchRoot), false); assertions += 1;
  progress('package version mismatch rejected before output');

  const releaseLockRoot = await makeInstallRoot('canonical-release-lock-contention');
  const heldReleaseLock = await acquireReleaseArtifactSetLock({
    outputDir: releaseLockRoot,
    version: packageVersion
  });
  assert.equal((await fs.lstat(heldReleaseLock.artifactSet.lockPath)).mode & 0o777, 0o600); assertions += 1;
  await assert.rejects(
    acquireReleaseArtifactSetLock({ outputDir: releaseLockRoot, version: packageVersion }),
    (error) => error?.code === 'RELEASE_ARTIFACT_SET_LOCKED'
  ); assertions += 1;
  await assert.rejects(
    packagePlugin(packageVersion, releaseLockRoot, repoRoot, { canonicalOutputDir: releaseLockRoot }),
    (error) => error?.code === 'RELEASE_ARTIFACT_SET_LOCKED'
  ); assertions += 1;
  assert.equal(await pathExists(heldReleaseLock.artifactSet.rbzPath), false); assertions += 1;
  await heldReleaseLock.release();
  assert.deepEqual(await fs.readdir(releaseLockRoot), []); assertions += 1;
  progress('canonical package shared lock contention');

  const replacedLockRoot = await makeInstallRoot('release-lock-ownership-loss');
  const replacedReleaseLock = await acquireReleaseArtifactSetLock({
    outputDir: replacedLockRoot,
    version: packageVersion
  });
  const movedOwnedLock = `${replacedReleaseLock.artifactSet.lockPath}.owned`;
  const foreignLockSentinel = path.join(replacedLockRoot, 'foreign-lock-sentinel');
  await fs.rename(replacedReleaseLock.artifactSet.lockPath, movedOwnedLock);
  await fs.writeFile(foreignLockSentinel, 'foreign lock bytes\n', 'utf8');
  await fs.symlink(foreignLockSentinel, replacedReleaseLock.artifactSet.lockPath);
  await assert.rejects(
    replacedReleaseLock.release(),
    (error) => error?.code === 'RELEASE_ARTIFACT_LOCK_OWNERSHIP_LOST'
  ); assertions += 1;
  assert.equal(await fs.readFile(foreignLockSentinel, 'utf8'), 'foreign lock bytes\n'); assertions += 1;
  assert.equal((await fs.lstat(replacedReleaseLock.artifactSet.lockPath)).isSymbolicLink(), true); assertions += 1;
  progress('release lock ownership loss preserves foreign path');

  const canonicalPackageRoot = await makeInstallRoot('canonical-package-collision');
  const canonicalPackagePath = path.join(canonicalPackageRoot, `alma-sketchup-mcp-${packageVersion}.rbz`);
  await fs.writeFile(canonicalPackagePath, 'historical signed artifact sentinel\n', 'utf8');
  await assert.rejects(
    packagePlugin(packageVersion, canonicalPackageRoot, repoRoot, { canonicalOutputDir: canonicalPackageRoot }),
    (error) => error?.code === 'PLUGIN_PACKAGE_TARGET_EXISTS'
  ); assertions += 1;
  assert.equal(await fs.readFile(canonicalPackagePath, 'utf8'), 'historical signed artifact sentinel\n'); assertions += 1;
  assert.deepEqual((await fs.readdir(canonicalPackageRoot)).sort(), [`alma-sketchup-mcp-${packageVersion}.rbz`]); assertions += 1;
  progress('canonical package preserved');

  const sidecarCollisionRoot = await makeInstallRoot('sidecar-collision');
  const sidecarPath = path.join(sidecarCollisionRoot, `alma-sketchup-mcp-${packageVersion}.sha256`);
  await fs.writeFile(sidecarPath, 'historical checksum sentinel\n', 'utf8');
  await assert.rejects(
    packagePlugin(packageVersion, sidecarCollisionRoot, repoRoot, { canonicalOutputDir: sidecarCollisionRoot }),
    (error) => error?.code === 'PLUGIN_PACKAGE_TARGET_EXISTS'
  ); assertions += 1;
  assert.equal(await fs.readFile(sidecarPath, 'utf8'), 'historical checksum sentinel\n'); assertions += 1;
  assert.equal(await pathExists(path.join(sidecarCollisionRoot, `alma-sketchup-mcp-${packageVersion}.rbz`)), false); assertions += 1;
  progress('sidecar preserved');

  const manifestCollisionRoot = await makeInstallRoot('release-manifest-collision');
  const releaseManifestPath = path.join(manifestCollisionRoot, `release-manifest-${packageVersion}.json`);
  await fs.writeFile(releaseManifestPath, '{"signed":true}\n', 'utf8');
  await assert.rejects(
    packagePlugin(packageVersion, manifestCollisionRoot, repoRoot, { canonicalOutputDir: manifestCollisionRoot }),
    (error) => error?.code === 'PLUGIN_PACKAGE_TARGET_EXISTS'
  ); assertions += 1;
  assert.equal(await fs.readFile(releaseManifestPath, 'utf8'), '{"signed":true}\n'); assertions += 1;
  assert.equal(await pathExists(path.join(manifestCollisionRoot, `alma-sketchup-mcp-${packageVersion}.rbz`)), false); assertions += 1;
  progress('release manifest preserved');

  const unlabeledPreviewRoot = path.join(testRoot, 'unlabeled-preview-not-created');
  await assert.rejects(
    packagePlugin(packageVersion, unlabeledPreviewRoot, repoRoot, {
      canonicalOutputDir: path.join(testRoot, 'canonical-release-root')
    }),
    (error) => error?.code === 'PLUGIN_NON_RELEASE_LABEL_REQUIRED'
  ); assertions += 1;
  assert.equal(await pathExists(unlabeledPreviewRoot), false); assertions += 1;
  progress('unlabeled preview rejected');

  const labeledPreviewRoot = await makeInstallRoot('labeled-preview-collision');
  const artifactLabel = 'unique-test';
  const labeledPackagePath = path.join(
    labeledPreviewRoot,
    `alma-sketchup-mcp-${packageVersion}-nonrelease-${artifactLabel}.rbz`
  );
  await fs.writeFile(labeledPackagePath, 'existing non-release artifact sentinel\n', 'utf8');
  await assert.rejects(
    packagePlugin(packageVersion, labeledPreviewRoot, repoRoot, {
      artifactLabel,
      canonicalOutputDir: path.join(testRoot, 'canonical-release-root')
    }),
    (error) => error?.code === 'PLUGIN_PACKAGE_TARGET_EXISTS'
  ); assertions += 1;
  assert.equal(await fs.readFile(labeledPackagePath, 'utf8'), 'existing non-release artifact sentinel\n'); assertions += 1;
  assert.match(path.basename(labeledPackagePath), /-nonrelease-unique-test\.rbz$/); assertions += 1;
  progress('labeled collision preserved');

  const scriptSource = await fs.readFile(path.join(repoRoot, 'scripts/package-sketchup-plugin.mjs'), 'utf8');
  assert.match(scriptSource, /requires_complete_sketchup_restart/); assertions += 1;
  assert.match(scriptSource, /live_runtime_verified\s*=\s*false|live_runtime_verified:\s*false/); assertions += 1;
  assert.doesNotMatch(scriptSource, /execFileSync\([^)]*(?:osascript|open)|spawnSync\([^)]*(?:SketchUp|osascript)/i); assertions += 1;
  assert.doesNotMatch(scriptSource, /fs\.rm\(packagePath/); assertions += 1;
  assert.match(scriptSource, /fs\.link\(stagedPackagePath, packagePath\)/); assertions += 1;

  process.stdout.write(`${JSON.stringify({
    ok: true,
    assertions,
    plugin_files: PLUGIN_FILES.length,
    tmp_only: true,
    real_plugins_directory_touched: false,
    live_queue_called: false,
    staged_copy_failure_left_partial_install: false,
    activation_failure_rollback_verified: true,
    sigint_sigterm_rollback_verified: true,
    post_install_byte_tamper_rollback_verified: true,
    first_install_failure_left_managed_targets: false,
    symlink_paths_rejected: true,
    path_escape_rejected: true,
    unowned_target_overwrite_rejected: true,
    source_symlink_rejected_before_target_creation: true,
    full_file_byte_verification: true,
    runtime_manifest_verification: true,
    existing_canonical_package_preserved: true,
    existing_release_sidecars_preserved: true,
    package_overwrite_allowed: false,
    non_release_artifact_label_required: true,
    non_release_name_cannot_impersonate_rc: true,
    restart_required: true,
    live_runtime_verified: false
  }, null, 2)}\n`);
} finally {
  await fs.rm(testRoot, { recursive: true, force: true });
}

async function makeInstallRoot(name) {
  const root = path.join(testRoot, name);
  await fs.mkdir(root);
  return fs.realpath(root);
}

async function makeAlternateSource(name) {
  const sourceRoot = path.join(testRoot, name);
  for (const file of PLUGIN_FILES) {
    const source = path.join(repoRoot, ...file.source.split('/'));
    const target = path.join(sourceRoot, ...file.source.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  }
  return fs.realpath(sourceRoot);
}

async function appendComment(sourceRoot, repoPath, comment) {
  await fs.appendFile(path.join(sourceRoot, ...repoPath.split('/')), `\n${comment}\n`, 'utf8');
}

async function pluginTreeManifest(pluginRoot) {
  const manifest = {};
  for (const file of PLUGIN_FILES) {
    const target = path.join(pluginRoot, ...file.target.split('/'));
    const stat = await fs.lstat(target);
    assert.equal(stat.isSymbolicLink(), false);
    assert.equal(stat.isFile(), true);
    const bytes = await fs.readFile(target);
    manifest[file.target] = {
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      size_bytes: bytes.length
    };
  }
  return manifest;
}

async function assertNoTransactionDebris(pluginRoot) {
  const names = await fs.readdir(pluginRoot);
  assert.deepEqual(names.filter((name) => name.startsWith('.alma-sketchup-mcp-install-')), []);
  assert.equal(names.includes('.alma-sketchup-mcp.install.lock'), false);
}

async function pathExists(candidate) {
  try {
    await fs.lstat(candidate);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function progress(message) {
  if (process.env.ALMA_PLUGIN_TEST_PROGRESS === '1') process.stderr.write(`[plugin-install-safety] ${message}\n`);
}

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}
