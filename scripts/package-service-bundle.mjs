#!/usr/bin/env node
import crypto from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const productId = 'local-mcp-for-sketchup';
const nodeVersion = '24.18.0';
export const serviceBundleRuntimeDirectories = Object.freeze(['src', 'schema', 'sketchup_plugin']);
const lgpl = Object.freeze({
  url: 'https://raw.githubusercontent.com/spdx/license-list-data/5bf6d9610255540bfbee6890765a616042bf1e11/text/LGPL-3.0-or-later.txt',
  sha256: '996af0513df21f7496288951c41428a03c174e9e4a9d63665c57d670f845ccb1'
});

export const serviceBundleTargets = Object.freeze({
  'darwin-arm64': Object.freeze({
    os: 'darwin',
    arch: 'arm64',
    nodeArchive: `node-v${nodeVersion}-darwin-arm64.tar.gz`,
    nodeSha256: 'e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1',
    archiveExtension: 'tar.gz',
    mediaType: 'application/gzip',
    nodeExecutable: 'node/bin/node',
    sharpPlatformPackage: '@img/sharp-darwin-arm64',
    libvipsPlatformPackage: '@img/sharp-libvips-darwin-arm64'
  }),
  'win32-x64': Object.freeze({
    os: 'win32',
    arch: 'x64',
    nodeArchive: `node-v${nodeVersion}-win-x64.zip`,
    nodeSha256: '0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821',
    archiveExtension: 'zip',
    mediaType: 'application/zip',
    nodeExecutable: 'node/node.exe',
    sharpPlatformPackage: '@img/sharp-win32-x64',
    // The Windows sharp platform package carries libvips in the same archive.
    libvipsPlatformPackage: null
  })
});

export function planServiceBundle({
  targetId,
  version,
  outputDir,
  artifactLabel,
  candidate = false
}) {
  const target = serviceBundleTargets[targetId];
  if (!target) throw codedError('SERVICE_BUNDLE_TARGET_UNSUPPORTED', `Unsupported service bundle target: ${targetId}`);
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(String(version || ''))) {
    throw codedError('SERVICE_BUNDLE_VERSION_INVALID', `Invalid technical-preview version: ${version}`);
  }
  if (candidate && artifactLabel) {
    throw codedError('SERVICE_BUNDLE_CANDIDATE_LABEL_FORBIDDEN', '--candidate uses the canonical file name and cannot be combined with --artifact-label.');
  }
  if (!candidate && !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(String(artifactLabel || ''))) {
    throw codedError('SERVICE_BUNDLE_LABEL_REQUIRED', 'A 3-64 character lowercase --artifact-label is required for a non-release bundle.');
  }
  const resolvedOutput = path.resolve(String(outputDir || ''));
  if (!outputDir) throw codedError('SERVICE_BUNDLE_OUTPUT_REQUIRED', '--output-dir is required.');
  const fileName = candidate
    ? `${productId}-${version}-${targetId}.${target.archiveExtension}`
    : `nonrelease-${artifactLabel}-${productId}-${version}-${targetId}.${target.archiveExtension}`;
  return Object.freeze({
    targetId,
    target,
    version,
    artifactLabel,
    candidate,
    outputDir: resolvedOutput,
    artifactPath: path.join(resolvedOutput, fileName),
    fileName
  });
}

export async function packageServiceBundle({
  targetId,
  outputDir,
  artifactLabel,
  candidate = false,
  sourceRoot = repoRoot,
  cacheDir = path.join(os.homedir(), '.cache', productId, 'upstream')
}) {
  const packageMetadata = JSON.parse(await fs.readFile(path.join(sourceRoot, 'release', 'public-package.json'), 'utf8'));
  const plan = planServiceBundle({
    targetId,
    version: packageMetadata.version,
    outputDir,
    artifactLabel,
    candidate
  });
  await fs.mkdir(plan.outputDir, { recursive: true, mode: 0o755 });
  await assertAbsent(plan.artifactPath);

  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), `${productId}-bundle-`));
  const bundleRoot = path.join(workRoot, productId);
  try {
    await fs.mkdir(path.join(bundleRoot, 'app'), { recursive: true, mode: 0o755 });
    await fs.mkdir(path.join(bundleRoot, 'node'), { recursive: true, mode: 0o755 });
    await copyRuntimeSource(sourceRoot, bundleRoot);

    const nodeArchiveUrl = `https://nodejs.org/dist/v${nodeVersion}/${plan.target.nodeArchive}`;
    const nodeArchivePath = await obtainPinnedFile({
      url: nodeArchiveUrl,
      expectedSha256: plan.target.nodeSha256,
      cacheDir,
      maximumBytes: 100_000_000
    });
    await extractNodeRuntime(nodeArchivePath, bundleRoot, plan.target);

    await installProductionDependencies(path.join(bundleRoot, 'app'), plan.target);
    const inventory = await collectDependencyLicenses(path.join(bundleRoot, 'app', 'node_modules'), bundleRoot, {
      targetId,
      expectedNativePackages: [
        plan.target.sharpPlatformPackage,
        plan.target.libvipsPlatformPackage
      ].filter(Boolean),
      cacheDir
    });
    await assertNativeDependencyBoundary(inventory.packages, plan.target);
    if (targetId === `${process.platform}-${process.arch}`) {
      await runChecked(path.join(bundleRoot, ...plan.target.nodeExecutable.split('/')), [
        '--input-type=module',
        '--eval',
        "await import('./src/runtime-source-attestation.mjs'); const sharp = (await import('sharp')).default; if (!sharp?.versions?.sharp) process.exit(2);"
      ], { cwd: path.join(bundleRoot, 'app') });
    }

    const nodeLicenseBytes = await fs.readFile(path.join(bundleRoot, 'node', 'LICENSE'));
    const bundleMetadata = {
      schema_version: 'local-mcp-service-bundle.v1',
      product: productId,
      version: plan.version,
      target: targetId,
      sketchup_major: 2026,
      release_candidate: plan.candidate,
      release_artifact: false,
      entrypoint: {
        command_relative: plan.target.nodeExecutable,
        args_relative: ['app/src/mcp-server.mjs']
      },
      bundled_node: {
        version: nodeVersion,
        upstream_url: nodeArchiveUrl,
        upstream_sha256: plan.target.nodeSha256,
        license_sha256: sha256(nodeLicenseBytes)
      },
      dependency_inventory: 'THIRD_PARTY_LICENSES/inventory.json',
      runtime_policy: {
        telemetry: false,
        runtime_license_check: false,
        mandatory_network: false
      },
      verification: {
        build_host_execution: targetId === `${process.platform}-${process.arch}`,
        live_sketchup_verified: false,
        release_acceptance: false
      }
    };
    await writeNewJson(path.join(bundleRoot, 'bundle.json'), bundleMetadata);
    await normalizeTree(bundleRoot, new Date('2026-01-01T00:00:00.000Z'));
    await createArchive(bundleRoot, plan.artifactPath, plan.target.archiveExtension);

    const artifactBytes = await fs.readFile(plan.artifactPath);
    return Object.freeze({
      kind: plan.candidate
        ? 'local_mcp_for_sketchup_service_bundle_candidate'
        : 'local_mcp_for_sketchup_service_bundle_preview',
      release_candidate: plan.candidate,
      release_artifact: false,
      target: targetId,
      version: plan.version,
      path: plan.artifactPath,
      file_name: plan.fileName,
      media_type: plan.target.mediaType,
      sha256: sha256(artifactBytes),
      size_bytes: artifactBytes.length,
      bundled_node: {
        version: nodeVersion,
        upstream_sha256: plan.target.nodeSha256
      },
      dependency_count: inventory.packages.length,
      native_dependencies_verified: true,
      live_sketchup_verified: false,
      release_acceptance: false
    });
  } finally {
    await fs.rm(workRoot, { recursive: true, force: true });
  }
}

async function copyRuntimeSource(sourceRoot, bundleRoot) {
  const appRoot = path.join(bundleRoot, 'app');
  for (const directory of serviceBundleRuntimeDirectories) {
    await copyTree(path.join(sourceRoot, directory), path.join(appRoot, directory));
  }
  for (const file of ['package-lock.json']) {
    await copyFileNew(path.join(sourceRoot, file === 'package-lock.json' ? 'release/public-package-lock.json' : file), path.join(appRoot, file));
  }
  await copyFileNew(path.join(sourceRoot, 'release', 'public-package.json'), path.join(appRoot, 'package.json'));
  for (const file of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md', 'SECURITY.md', 'TRADEMARKS.md']) {
    await copyFileNew(path.join(sourceRoot, file), path.join(bundleRoot, file));
  }
}

async function obtainPinnedFile({
  url,
  expectedSha256,
  cacheDir,
  maximumBytes
}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw codedError('PINNED_DOWNLOAD_HTTPS_REQUIRED', `HTTPS required: ${url}`);
  await fs.mkdir(cacheDir, { recursive: true, mode: 0o755 });
  const cachePath = path.join(cacheDir, `${expectedSha256}-${path.basename(parsed.pathname)}`);
  const existing = await readIfValid(cachePath, expectedSha256, maximumBytes);
  if (existing) return cachePath;

  const bytes = await downloadBytes(url, maximumBytes);
  if (bytes.length > maximumBytes) throw codedError('PINNED_DOWNLOAD_TOO_LARGE', `Download exceeds size limit: ${url}`);
  const actual = sha256(bytes);
  if (actual !== expectedSha256) {
    throw codedError('PINNED_DOWNLOAD_HASH_MISMATCH', `SHA-256 mismatch for ${url}; expected ${expectedSha256}, got ${actual}`);
  }
  await fs.writeFile(cachePath, bytes, { flag: 'wx', mode: 0o644 }).catch(async (error) => {
    if (error?.code !== 'EEXIST') throw error;
    if (!await readIfValid(cachePath, expectedSha256, maximumBytes)) throw error;
  });
  return cachePath;
}

async function downloadBytes(url, maximumBytes) {
  try {
    const response = await fetch(url, {
      redirect: 'error',
      headers: {
        accept: 'application/octet-stream, text/plain;q=0.9',
        'user-agent': 'Local-MCP-for-SketchUp-release-builder/0.1'
      },
      signal: AbortSignal.timeout(30_000)
    });
    if (response.ok) {
      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > maximumBytes) throw codedError('PINNED_DOWNLOAD_TOO_LARGE', `Download exceeds size limit: ${url}`);
      return Buffer.from(await response.arrayBuffer());
    }
  } catch (error) {
    if (error?.code === 'PINNED_DOWNLOAD_TOO_LARGE') throw error;
  }

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), `${productId}-download-`));
  const temporaryFile = path.join(temporaryRoot, 'download');
  try {
    await runChecked('curl', [
      '--fail',
      '--silent',
      '--show-error',
      '--location',
      '--proto', '=https',
      '--proto-redir', '=https',
      '--max-redirs', '3',
      '--connect-timeout', '10',
      '--max-time', '60',
      '--max-filesize', String(maximumBytes),
      '--output', temporaryFile,
      url
    ]);
    return await fs.readFile(temporaryFile);
  } catch (error) {
    throw codedError('PINNED_DOWNLOAD_FAILED', `Pinned HTTPS download failed: ${url}; ${error.message}`);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function readIfValid(filePath, expectedSha256, maximumBytes) {
  try {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumBytes) return false;
    return sha256(await fs.readFile(filePath)) === expectedSha256;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function extractNodeRuntime(archivePath, bundleRoot, target) {
  const nodeDir = path.join(bundleRoot, 'node');
  if (target.os === 'darwin') {
    const archiveRoot = `node-v${nodeVersion}-darwin-arm64`;
    const extractionRoot = await fs.mkdtemp(path.join(os.tmpdir(), `${productId}-node-`));
    try {
      await runChecked('tar', [
        '-xzf', archivePath,
        '-C', extractionRoot,
        `${archiveRoot}/bin/node`,
        `${archiveRoot}/LICENSE`
      ]);
      await copyFileNew(path.join(extractionRoot, archiveRoot, 'bin', 'node'), path.join(nodeDir, 'bin', 'node'));
      await fs.chmod(path.join(nodeDir, 'bin', 'node'), 0o755);
      await copyFileNew(path.join(extractionRoot, archiveRoot, 'LICENSE'), path.join(nodeDir, 'LICENSE'));
    } finally {
      await fs.rm(extractionRoot, { recursive: true, force: true });
    }
  } else {
    const archiveRoot = `node-v${nodeVersion}-win-x64`;
    const extractionRoot = await fs.mkdtemp(path.join(os.tmpdir(), `${productId}-node-`));
    try {
      await runChecked('unzip', [
        '-q', archivePath,
        `${archiveRoot}/node.exe`,
        `${archiveRoot}/LICENSE`,
        '-d', extractionRoot
      ]);
      await copyFileNew(path.join(extractionRoot, archiveRoot, 'node.exe'), path.join(nodeDir, 'node.exe'));
      await copyFileNew(path.join(extractionRoot, archiveRoot, 'LICENSE'), path.join(nodeDir, 'LICENSE'));
    } finally {
      await fs.rm(extractionRoot, { recursive: true, force: true });
    }
  }
}

async function installProductionDependencies(appRoot, target) {
  await runChecked(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
    'ci',
    '--omit=dev',
    '--include=optional',
    '--ignore-scripts',
    `--os=${target.os}`,
    `--cpu=${target.arch}`,
    '--no-audit',
    '--no-fund'
  ], { cwd: appRoot });
  // The service invokes its entrypoint directly and does not need npm command
  // shims. Removing .bin also keeps the distributable tree free of symlinks.
  await fs.rm(path.join(appRoot, 'node_modules', '.bin'), { recursive: true, force: true });
}

async function collectDependencyLicenses(nodeModulesRoot, bundleRoot, {
  targetId,
  expectedNativePackages,
  cacheDir
}) {
  const licenseRoot = path.join(bundleRoot, 'THIRD_PARTY_LICENSES');
  await fs.mkdir(licenseRoot, { recursive: true, mode: 0o755 });
  const packageDirs = await listPackageDirectories(nodeModulesRoot);
  const packages = [];
  for (const directory of packageDirs) {
    const metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    const relativeDirectory = path.relative(nodeModulesRoot, directory).split(path.sep).join('/');
    const noticeDirectory = path.join(licenseRoot, 'npm', relativeDirectory);
    await fs.mkdir(noticeDirectory, { recursive: true, mode: 0o755 });
    await copyFileNew(path.join(directory, 'package.json'), path.join(noticeDirectory, 'package.json'));
    const copied = [];
    for (const name of await fs.readdir(directory)) {
      if (!/^(?:licen[cs]e|notice|copying)(?:[._-].*)?$/i.test(name)) continue;
      const source = path.join(directory, name);
      const stat = await fs.lstat(source);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      await copyFileNew(source, path.join(noticeDirectory, name));
      copied.push(name);
    }
    for (const supplemental of ['README.md', 'versions.json']) {
      if (!metadata.name?.startsWith('@img/sharp-libvips-')) continue;
      const source = path.join(directory, supplemental);
      try {
        await copyFileNew(source, path.join(noticeDirectory, supplemental));
        copied.push(supplemental);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    const license = metadata.license || metadata.licenses || null;
    if (copied.length === 0 && license !== 'LGPL-3.0-or-later') {
      throw codedError('DEPENDENCY_LICENSE_FILE_MISSING', `No license file found for ${metadata.name}@${metadata.version}`);
    }
    packages.push({
      name: metadata.name,
      version: metadata.version,
      license,
      repository: typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url || null,
      homepage: metadata.homepage || null,
      copied_notice_files: copied.sort()
    });
  }

  const lgplPath = await obtainPinnedFile({
    url: lgpl.url,
    expectedSha256: lgpl.sha256,
    cacheDir,
    maximumBytes: 100_000
  });
  await copyFileNew(lgplPath, path.join(licenseRoot, 'LGPL-3.0-or-later.txt'));
  const inventory = {
    schema_version: 'third-party-inventory.v1',
    target: targetId,
    generated_from_package_lock: true,
    expected_native_packages: expectedNativePackages,
    packages: packages.sort((a, b) => a.name.localeCompare(b.name)),
    lgpl_text: {
      source: lgpl.url,
      sha256: lgpl.sha256,
      file: 'LGPL-3.0-or-later.txt'
    }
  };
  await writeNewJson(path.join(licenseRoot, 'inventory.json'), inventory);
  return inventory;
}

async function assertNativeDependencyBoundary(packages, target) {
  const names = new Set(packages.map((item) => item.name));
  for (const required of [target.sharpPlatformPackage, target.libvipsPlatformPackage].filter(Boolean)) {
    if (!names.has(required)) throw codedError('SERVICE_BUNDLE_NATIVE_DEPENDENCY_MISSING', `Target dependency missing: ${required}`);
  }
  const forbiddenSuffixes = target.os === 'darwin'
    ? ['win32-x64']
    : ['darwin-arm64'];
  for (const name of names) {
    if (forbiddenSuffixes.some((suffix) => name.endsWith(suffix))) {
      throw codedError('SERVICE_BUNDLE_FOREIGN_NATIVE_DEPENDENCY', `Foreign native dependency present: ${name}`);
    }
  }
}

async function listPackageDirectories(nodeModulesRoot) {
  const directories = [];
  for (const entry of await fs.readdir(nodeModulesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.bin') continue;
    const absolute = path.join(nodeModulesRoot, entry.name);
    if (entry.name.startsWith('@')) {
      for (const child of await fs.readdir(absolute, { withFileTypes: true })) {
        if (child.isDirectory() && await exists(path.join(absolute, child.name, 'package.json'))) {
          directories.push(path.join(absolute, child.name));
        }
      }
    } else if (await exists(path.join(absolute, 'package.json'))) {
      directories.push(absolute);
    }
  }
  return directories;
}

export async function createArchive(bundleRoot, artifactPath, extension) {
  const parent = path.dirname(bundleRoot);
  const rootName = path.basename(bundleRoot);
  if (extension === 'tar.gz') {
    const tarPath = path.join(parent, `.${productId}-${crypto.randomUUID()}.tar`);
    try {
      await runChecked('tar', ['-cf', tarPath, '-C', parent, rootName]);
      await pipeline(
        createReadStream(tarPath),
        createGzip({ level: 9 }),
        createWriteStream(artifactPath, { flags: 'wx', mode: 0o644 })
      );
    } catch (error) {
      await fs.rm(artifactPath, { force: true });
      throw error;
    } finally {
      await fs.rm(tarPath, { force: true });
    }
  } else {
    await runChecked('zip', ['-q', '-X', '-r', artifactPath, rootName], { cwd: parent });
  }
}

async function copyTree(sourceRoot, destinationRoot) {
  const stat = await fs.lstat(sourceRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw codedError('SERVICE_BUNDLE_SOURCE_REJECTED', `Expected regular directory: ${sourceRoot}`);
  await fs.mkdir(destinationRoot, { recursive: true, mode: 0o755 });
  for (const entry of (await fs.readdir(sourceRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const source = path.join(sourceRoot, entry.name);
    const destination = path.join(destinationRoot, entry.name);
    if (entry.isSymbolicLink()) throw codedError('SERVICE_BUNDLE_SYMLINK_REJECTED', `Runtime source contains a symbolic link: ${source}`);
    if (entry.isDirectory()) await copyTree(source, destination);
    else if (entry.isFile()) await copyFileNew(source, destination);
    else throw codedError('SERVICE_BUNDLE_SOURCE_REJECTED', `Runtime source contains a special file: ${source}`);
  }
}

async function copyFileNew(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
  await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
}

async function writeNewJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o755 });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
}

async function normalizeTree(root, timestamp) {
  async function visit(current) {
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) throw codedError('SERVICE_BUNDLE_SYMLINK_REJECTED', `Bundle contains a symbolic link: ${current}`);
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(current)).sort()) await visit(path.join(current, name));
      await fs.chmod(current, 0o755);
    } else if (stat.isFile()) {
      const executable = current.endsWith(`${path.sep}node`) || current.endsWith(`${path.sep}node.exe`);
      await fs.chmod(current, executable ? 0o755 : 0o644);
    } else {
      throw codedError('SERVICE_BUNDLE_SOURCE_REJECTED', `Bundle contains a special file: ${current}`);
    }
    await fs.utimes(current, timestamp, timestamp);
  }
  await visit(root);
}

async function runChecked(command, args, { cwd = repoRoot } = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (signal) reject(codedError('SERVICE_BUNDLE_COMMAND_SIGNAL', `${command} stopped by ${signal}`));
      else if (code !== 0) reject(codedError('SERVICE_BUNDLE_COMMAND_FAILED', `${command} exited with ${code}`));
      else resolve();
    });
  });
}

async function assertAbsent(filePath) {
  if (await exists(filePath)) throw codedError('SERVICE_BUNDLE_ARTIFACT_EXISTS', `Refusing to overwrite artifact: ${filePath}`);
}

async function exists(filePath) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--target') options.targetId = argv[++index];
    else if (argv[index] === '--output-dir') options.outputDir = argv[++index];
    else if (argv[index] === '--artifact-label') options.artifactLabel = argv[++index];
    else if (argv[index] === '--candidate') options.candidate = true;
    else if (argv[index] === '--cache-dir') options.cacheDir = argv[++index];
    else if (argv[index] === '--help') {
      process.stdout.write(
        'Usage: node scripts/package-service-bundle.mjs '
        + '--target darwin-arm64|win32-x64 --output-dir PATH '
        + '(--artifact-label NAME | --candidate) [--cache-dir PATH]\n'
      );
      process.exit(0);
    } else throw codedError('SERVICE_BUNDLE_ARGUMENT_UNKNOWN', `Unknown argument: ${argv[index]}`);
  }
  return options;
}

if (path.resolve(process.argv[1] || '') === scriptPath) {
  const result = await packageServiceBundle(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
