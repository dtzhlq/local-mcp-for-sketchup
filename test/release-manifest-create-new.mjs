import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateReleaseManifest } from '../scripts/generate-release-manifest.mjs';
import { PLUGIN_FILES } from '../scripts/package-sketchup-plugin.mjs';
import {
  acquireReleaseArtifactSetLock,
  resolveCanonicalReleaseArtifactSet
} from '../scripts/release-artifact-set.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
const version = packageJson.version;
const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-release-manifest-create-new-'));
let assertions = 0;

try {
  const validRbzBytes = await buildValidRbzFixture();
  const successRoot = await makeOutput('success');
  const successSet = await writeRbz(successRoot, validRbzBytes);
  const rbzBefore = await fingerprint(successSet.rbzPath);
  const success = await generateReleaseManifest({
    outputDir: successRoot,
    requestedVersion: version,
    liveStatus: 'blocked',
    liveReason: 'tmp-only test; no live queue',
    offlineGates: ['tmp-only-regression']
  });
  assert.equal(success.ok, true); assertions += 1;
  assert.equal(success.overwrite_performed, false); assertions += 1;
  assert.equal(success.rbz, successSet.rbzPath); assertions += 1;
  assert.deepEqual(await fingerprint(successSet.rbzPath), rbzBefore); assertions += 1;
  const expectedHash = crypto.createHash('sha256').update(await fs.readFile(successSet.rbzPath)).digest('hex');
  assert.equal(success.rbz_sha256, expectedHash); assertions += 1;
  assert.equal(success.rbz_size_bytes, rbzBefore.size); assertions += 1;
  assert.equal(
    await fs.readFile(successSet.sha256Path, 'utf8'),
    `${expectedHash}  ${path.basename(successSet.rbzPath)}\n`
  ); assertions += 1;
  const manifest = JSON.parse(await fs.readFile(successSet.manifestPath, 'utf8'));
  assert.equal(manifest.product_version, version); assertions += 1;
  assert.equal(manifest.plugin_version, version); assertions += 1;
  assert.equal(manifest.artifacts.rbz_sha256, expectedHash); assertions += 1;
  assert.equal(manifest.artifacts.rbz_size_bytes, rbzBefore.size); assertions += 1;
  assert.equal(manifest.live_queue.status, 'blocked'); assertions += 1;
  assert.equal(manifest.rc_signed, false); assertions += 1;
  assert.equal((await fs.lstat(successSet.sha256Path)).isFile(), true); assertions += 1;
  assert.equal((await fs.lstat(successSet.manifestPath)).isFile(), true); assertions += 1;
  assert.deepEqual(await transientEntries(successRoot), []); assertions += 1;

  const publishedBeforeRetry = await Promise.all([
    fingerprint(successSet.rbzPath),
    fingerprint(successSet.sha256Path),
    fingerprint(successSet.manifestPath)
  ]);
  await assert.rejects(
    generateReleaseManifest({ outputDir: successRoot, requestedVersion: version }),
    (error) => error?.code === 'RELEASE_ARTIFACT_TARGET_EXISTS'
  ); assertions += 1;
  assert.deepEqual(await Promise.all([
    fingerprint(successSet.rbzPath),
    fingerprint(successSet.sha256Path),
    fingerprint(successSet.manifestPath)
  ]), publishedBeforeRetry); assertions += 1;
  assert.deepEqual(await transientEntries(successRoot), []); assertions += 1;

  for (const occupied of ['sha256Path', 'manifestPath']) {
    const outputDir = await makeOutput(`existing-${occupied}`);
    const artifactSet = await writeRbz(outputDir, validRbzBytes);
    const sentinel = Buffer.from(`historical ${occupied} sentinel\n`);
    await fs.writeFile(artifactSet[occupied], sentinel, { flag: 'wx' });
    const rbzFingerprint = await fingerprint(artifactSet.rbzPath);
    await assert.rejects(
      generateReleaseManifest({ outputDir, requestedVersion: version }),
      (error) => error?.code === 'RELEASE_ARTIFACT_TARGET_EXISTS'
    ); assertions += 1;
    assert.deepEqual(await fs.readFile(artifactSet[occupied]), sentinel); assertions += 1;
    assert.deepEqual(await fingerprint(artifactSet.rbzPath), rbzFingerprint); assertions += 1;
    const absentPeer = occupied === 'sha256Path' ? artifactSet.manifestPath : artifactSet.sha256Path;
    assert.equal(await pathExists(absentPeer), false); assertions += 1;
    assert.deepEqual(await transientEntries(outputDir), []); assertions += 1;
  }

  const missingRbzRoot = await makeOutput('missing-rbz');
  const missingRbzSet = resolveCanonicalReleaseArtifactSet({ outputDir: missingRbzRoot, version });
  await assert.rejects(
    generateReleaseManifest({ outputDir: missingRbzRoot, requestedVersion: version }),
    (error) => error?.code === 'RELEASE_ARTIFACT_INPUT_MISSING'
  ); assertions += 1;
  assert.equal(await pathExists(missingRbzSet.sha256Path), false); assertions += 1;
  assert.equal(await pathExists(missingRbzSet.manifestPath), false); assertions += 1;
  assert.deepEqual(await transientEntries(missingRbzRoot), []); assertions += 1;

  const directoryRbzRoot = await makeOutput('directory-rbz');
  const directoryRbzSet = resolveCanonicalReleaseArtifactSet({ outputDir: directoryRbzRoot, version });
  await fs.mkdir(directoryRbzSet.rbzPath);
  await assert.rejects(
    generateReleaseManifest({ outputDir: directoryRbzRoot, requestedVersion: version }),
    (error) => error?.code === 'RELEASE_ARTIFACT_INPUT_UNSAFE'
  ); assertions += 1;
  assert.equal((await fs.lstat(directoryRbzSet.rbzPath)).isDirectory(), true); assertions += 1;
  assert.equal(await pathExists(directoryRbzSet.sha256Path), false); assertions += 1;
  assert.equal(await pathExists(directoryRbzSet.manifestPath), false); assertions += 1;

  const symlinkRbzRoot = await makeOutput('symlink-rbz');
  const symlinkRbzSet = resolveCanonicalReleaseArtifactSet({ outputDir: symlinkRbzRoot, version });
  const externalRbz = path.join(testRoot, 'external-rbz-sentinel');
  await fs.writeFile(externalRbz, 'external rbz bytes\n', { flag: 'wx' });
  await fs.symlink(externalRbz, symlinkRbzSet.rbzPath);
  await assert.rejects(
    generateReleaseManifest({ outputDir: symlinkRbzRoot, requestedVersion: version }),
    (error) => error?.code === 'RELEASE_ARTIFACT_INPUT_UNSAFE'
  ); assertions += 1;
  assert.equal((await fs.lstat(symlinkRbzSet.rbzPath)).isSymbolicLink(), true); assertions += 1;
  assert.equal(await fs.readFile(externalRbz, 'utf8'), 'external rbz bytes\n'); assertions += 1;
  assert.equal(await pathExists(symlinkRbzSet.sha256Path), false); assertions += 1;
  assert.equal(await pathExists(symlinkRbzSet.manifestPath), false); assertions += 1;

  const corruptRbzRoot = await makeOutput('corrupt-rbz');
  const corruptRbzSet = await writeRbz(corruptRbzRoot, Buffer.from('not a zip archive\n'));
  await assert.rejects(
    generateReleaseManifest({ outputDir: corruptRbzRoot, requestedVersion: version }),
    (error) => error?.code === 'RELEASE_RBZ_ARCHIVE_INVALID'
  ); assertions += 1;
  assert.equal(await fs.readFile(corruptRbzSet.rbzPath, 'utf8'), 'not a zip archive\n'); assertions += 1;
  assert.equal(await pathExists(corruptRbzSet.sha256Path), false); assertions += 1;
  assert.equal(await pathExists(corruptRbzSet.manifestPath), false); assertions += 1;

  const wrongPackagedVersionBytes = await buildValidRbzFixture({
    fixtureName: 'wrong-packaged-version',
    pluginVersion: '0.0.0-wrong'
  });
  const wrongPackagedVersionRoot = await makeOutput('wrong-packaged-version-output');
  const wrongPackagedVersionSet = await writeRbz(wrongPackagedVersionRoot, wrongPackagedVersionBytes);
  await assert.rejects(
    generateReleaseManifest({ outputDir: wrongPackagedVersionRoot, requestedVersion: version }),
    (error) => error?.code === 'RELEASE_RBZ_VERSION_MISMATCH'
  ); assertions += 1;
  assert.equal(await pathExists(wrongPackagedVersionSet.sha256Path), false); assertions += 1;
  assert.equal(await pathExists(wrongPackagedVersionSet.manifestPath), false); assertions += 1;

  const extraEntryBytes = await buildValidRbzFixture({
    fixtureName: 'extra-archive-entry',
    extraEntries: ['unexpected.txt']
  });
  const extraEntryRoot = await makeOutput('extra-archive-entry-output');
  const extraEntrySet = await writeRbz(extraEntryRoot, extraEntryBytes);
  await assert.rejects(
    generateReleaseManifest({ outputDir: extraEntryRoot, requestedVersion: version }),
    (error) => error?.code === 'RELEASE_RBZ_ARCHIVE_INVALID'
  ); assertions += 1;
  assert.equal(await pathExists(extraEntrySet.sha256Path), false); assertions += 1;
  assert.equal(await pathExists(extraEntrySet.manifestPath), false); assertions += 1;

  const tamperedMemberBytes = await buildValidRbzFixture({
    fixtureName: 'tampered-member',
    tamperedTarget: 'alma_sketchup_mcp/boolean_operations.rb'
  });
  const tamperedMemberRoot = await makeOutput('tampered-member-output');
  const tamperedMemberSet = await writeRbz(tamperedMemberRoot, tamperedMemberBytes);
  await assert.rejects(
    generateReleaseManifest({ outputDir: tamperedMemberRoot, requestedVersion: version }),
    (error) => error?.code === 'RELEASE_RBZ_ARCHIVE_INVALID'
  ); assertions += 1;
  assert.equal(await pathExists(tamperedMemberSet.sha256Path), false); assertions += 1;
  assert.equal(await pathExists(tamperedMemberSet.manifestPath), false); assertions += 1;

  const realOutput = await makeOutput('real-output');
  const aliasedOutput = path.join(testRoot, 'aliased-output');
  await fs.symlink(realOutput, aliasedOutput, 'dir');
  await writeRbz(realOutput, validRbzBytes);
  await assert.rejects(
    generateReleaseManifest({ outputDir: aliasedOutput, requestedVersion: version }),
    (error) => error?.code === 'RELEASE_ARTIFACT_OUTPUT_UNSAFE'
  ); assertions += 1;
  assert.equal((await fs.lstat(aliasedOutput)).isSymbolicLink(), true); assertions += 1;
  assert.deepEqual(await transientEntries(realOutput), []); assertions += 1;

  const missingOutput = path.join(testRoot, 'must-not-be-created');
  await assert.rejects(
    generateReleaseManifest({ outputDir: missingOutput, requestedVersion: version }),
    (error) => error?.code === 'RELEASE_ARTIFACT_OUTPUT_NOT_FOUND'
  ); assertions += 1;
  assert.equal(await pathExists(missingOutput), false); assertions += 1;

  const escapedRbzRoot = await makeOutput('escaped-rbz');
  const escapedRbzSet = await writeRbz(escapedRbzRoot, validRbzBytes);
  const wrongRbz = path.join(testRoot, 'wrong.rbz');
  await fs.writeFile(wrongRbz, 'wrong rbz sentinel\n', { flag: 'wx' });
  await assert.rejects(
    generateReleaseManifest({ outputDir: escapedRbzRoot, rbz: wrongRbz, requestedVersion: version }),
    (error) => error?.code === 'RELEASE_RBZ_PATH_MISMATCH'
  ); assertions += 1;
  assert.equal(await fs.readFile(wrongRbz, 'utf8'), 'wrong rbz sentinel\n'); assertions += 1;
  assert.equal(await pathExists(escapedRbzSet.sha256Path), false); assertions += 1;
  assert.equal(await pathExists(escapedRbzSet.manifestPath), false); assertions += 1;

  const mismatchRoot = await makeOutput('requested-version-mismatch');
  await assert.rejects(
    generateReleaseManifest({ outputDir: mismatchRoot, requestedVersion: `${version}-wrong` }),
    (error) => error?.code === 'RELEASE_VERSION_MISMATCH'
  ); assertions += 1;
  assert.deepEqual(await fs.readdir(mismatchRoot), []); assertions += 1;
  await assert.rejects(
    generateReleaseManifest({ outputDir: mismatchRoot, requestedVersion: '../escape' }),
    (error) => error?.code === 'RELEASE_ARTIFACT_VERSION_INVALID'
  ); assertions += 1;
  assert.deepEqual(await fs.readdir(mismatchRoot), []); assertions += 1;

  const splitVersionRepo = path.join(testRoot, 'split-version-repo');
  await fs.mkdir(path.join(splitVersionRepo, 'sketchup_plugin'), { recursive: true });
  await fs.writeFile(path.join(splitVersionRepo, 'package.json'), `${JSON.stringify({ version })}\n`, { flag: 'wx' });
  await fs.writeFile(
    path.join(splitVersionRepo, 'sketchup_plugin/alma_sketchup_mcp.rb'),
    "PLUGIN_VERSION = '0.0.0-mismatch'\n",
    { flag: 'wx' }
  );
  const splitVersionOutput = await makeOutput('split-version-output');
  await assert.rejects(
    generateReleaseManifest({
      outputDir: splitVersionOutput,
      requestedVersion: version,
      repoRoot: splitVersionRepo
    }),
    (error) => error?.code === 'RELEASE_VERSION_MISMATCH'
  ); assertions += 1;
  assert.deepEqual(await fs.readdir(splitVersionOutput), []); assertions += 1;

  const duplicateVersionRepo = path.join(testRoot, 'duplicate-version-repo');
  await fs.mkdir(path.join(duplicateVersionRepo, 'sketchup_plugin'), { recursive: true });
  await fs.writeFile(
    path.join(duplicateVersionRepo, 'package.json'),
    `${JSON.stringify({ version })}\n`,
    { flag: 'wx' }
  );
  await fs.writeFile(
    path.join(duplicateVersionRepo, 'sketchup_plugin/alma_sketchup_mcp.rb'),
    `PLUGIN_VERSION = '${version}'\nPLUGIN_VERSION = '${version}'\n`,
    { flag: 'wx' }
  );
  const duplicateVersionOutput = await makeOutput('duplicate-version-output');
  await assert.rejects(
    generateReleaseManifest({
      outputDir: duplicateVersionOutput,
      requestedVersion: version,
      repoRoot: duplicateVersionRepo
    }),
    (error) => error?.code === 'RELEASE_PLUGIN_VERSION_INVALID'
  ); assertions += 1;
  assert.deepEqual(await fs.readdir(duplicateVersionOutput), []); assertions += 1;

  const lockedRoot = await makeOutput('locked');
  const lockedSet = await writeRbz(lockedRoot, validRbzBytes);
  const heldLock = await acquireReleaseArtifactSetLock({ outputDir: lockedRoot, version });
  try {
    await assert.rejects(
      generateReleaseManifest({ outputDir: lockedRoot, requestedVersion: version }),
      (error) => error?.code === 'RELEASE_ARTIFACT_SET_LOCKED'
    ); assertions += 1;
    assert.equal(await pathExists(lockedSet.sha256Path), false); assertions += 1;
    assert.equal(await pathExists(lockedSet.manifestPath), false); assertions += 1;
  } finally {
    await heldLock.release();
  }
  assert.equal(await pathExists(lockedSet.lockPath), false); assertions += 1;

  const raceRoot = await makeOutput('race');
  const raceSet = await writeRbz(raceRoot, validRbzBytes);
  const raceResults = await Promise.allSettled([
    generateReleaseManifest({ outputDir: raceRoot, requestedVersion: version }),
    generateReleaseManifest({ outputDir: raceRoot, requestedVersion: version })
  ]);
  const fulfilled = raceResults.filter((result) => result.status === 'fulfilled');
  const rejected = raceResults.filter((result) => result.status === 'rejected');
  assert.equal(fulfilled.length, 1); assertions += 1;
  assert.equal(rejected.length, 1); assertions += 1;
  assert.equal(
    ['RELEASE_ARTIFACT_SET_LOCKED', 'RELEASE_ARTIFACT_TARGET_EXISTS'].includes(rejected[0].reason?.code),
    true
  ); assertions += 1;
  assert.equal(await pathExists(raceSet.sha256Path), true); assertions += 1;
  assert.equal(await pathExists(raceSet.manifestPath), true); assertions += 1;
  assert.deepEqual(await transientEntries(raceRoot), []); assertions += 1;

  const cliRoot = await makeOutput('cli-from-unrelated-cwd');
  const cliSet = await writeRbz(cliRoot, validRbzBytes);
  const unrelatedCwd = path.join(testRoot, 'unrelated-cwd');
  await fs.mkdir(unrelatedCwd);
  const cli = spawnSync(process.execPath, [
    path.join(repoRoot, 'scripts/generate-release-manifest.mjs'),
    '--output-dir', cliRoot,
    '--version', version,
    '--live-status', 'unverified',
    '--offline-gate', 'tmp-cli-root-test'
  ], { cwd: unrelatedCwd, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr); assertions += 1;
  const cliSummary = JSON.parse(cli.stdout);
  assert.equal(cliSummary.manifest, cliSet.manifestPath); assertions += 1;
  assert.equal(cliSummary.sha256_file, cliSet.sha256Path); assertions += 1;
  assert.equal(JSON.parse(await fs.readFile(cliSet.manifestPath, 'utf8')).product_version, version); assertions += 1;
  assert.deepEqual(await transientEntries(cliRoot), []); assertions += 1;

  process.stdout.write(`${JSON.stringify({
    ok: true,
    assertions,
    tmp_only: true,
    current_release_artifacts_touched: false,
    live_queue_called: false,
    metadata_create_new_only: true,
    rbz_regular_non_symlink_verified: true,
    rbz_hash_and_size_verified: true,
    rbz_member_bytes_bound_to_source: true,
    canonical_path_policy_verified: true,
    requested_package_plugin_version_match_required: true,
    shared_lock_contention_verified: true,
    concurrent_duplicate_metadata_writes: 0,
    script_root_independent_of_cwd: true
  }, null, 2)}\n`);
} finally {
  await fs.rm(testRoot, { recursive: true, force: true });
}

async function makeOutput(name) {
  const outputDir = path.join(testRoot, name);
  await fs.mkdir(outputDir);
  return fs.realpath(outputDir);
}

async function buildValidRbzFixture({
  fixtureName = 'valid-rbz',
  pluginVersion = version,
  extraEntries = [],
  tamperedTarget = null
} = {}) {
  const stageDir = path.join(testRoot, `${fixtureName}-stage`);
  const packagePath = path.join(testRoot, `${fixtureName}-fixture.rbz`);
  await fs.mkdir(stageDir);
  for (const file of PLUGIN_FILES) {
    const target = path.join(stageDir, ...file.target.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    const source = path.join(repoRoot, ...file.source.split('/'));
    await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL);
    if (file.target === 'alma_sketchup_mcp.rb' && pluginVersion !== version) {
      const loader = await fs.readFile(target, 'utf8');
      await fs.writeFile(
        target,
        loader.replace(
          /^\s*PLUGIN_VERSION\s*=\s*'[^'\r\n]+'\s*$/m,
          `  PLUGIN_VERSION = '${pluginVersion}'`
        ),
        'utf8'
      );
    }
    if (file.target === tamperedTarget) {
      await fs.appendFile(target, '\n# tmp-only tamper sentinel\n', 'utf8');
    }
  }
  for (const extraEntry of extraEntries) {
    await fs.writeFile(path.join(stageDir, extraEntry), `extra entry ${extraEntry}\n`, { flag: 'wx', mode: 0o600 });
  }
  const zip = spawnSync('zip', [
    '-q',
    packagePath,
    ...PLUGIN_FILES.map((file) => file.target),
    ...extraEntries
  ], {
    cwd: stageDir,
    encoding: 'utf8'
  });
  assert.equal(zip.status, 0, zip.stderr || zip.stdout); assertions += 1;
  return fs.readFile(packagePath);
}

async function writeRbz(outputDir, bytes) {
  const artifactSet = resolveCanonicalReleaseArtifactSet({ outputDir, version });
  await fs.writeFile(artifactSet.rbzPath, bytes, { flag: 'wx', mode: 0o600 });
  return artifactSet;
}

async function fingerprint(filePath) {
  const [bytes, stat] = await Promise.all([fs.readFile(filePath), fs.lstat(filePath)]);
  return {
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    size: stat.size,
    mode: stat.mode & 0o777,
    symbolic_link: stat.isSymbolicLink()
  };
}

async function transientEntries(outputDir) {
  return (await fs.readdir(outputDir)).filter((entry) => entry.endsWith('.tmp') || entry.endsWith('.lock')).sort();
}

async function pathExists(filePath) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
