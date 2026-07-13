import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ADAPTER_REQUIRED_ROLES = {
  objectnet3d_pose_cad_adapter: ['source_image', 'pose_annotation', 'cad_model'],
  pix3d_image_cad_adapter: ['source_image', 'image_annotation', 'cad_model'],
  cmp_facade_segmentation_adapter: ['source_image', 'facade_label_map']
};

export function supportedExternalBenchmarkAdapters() {
  return Object.keys(ADAPTER_REQUIRED_ROLES);
}

export async function prepareExternalBenchmarkSamplePackage({ sample, packageDir, files, createdAt = new Date().toISOString() } = {}) {
  if (!sample?.id || !ADAPTER_REQUIRED_ROLES[sample.adapter]) throw new Error('A supported Tier1 sample definition is required');
  const absolutePackageDir = path.resolve(packageDir || sample.local_path);
  await fs.mkdir(absolutePackageDir, { recursive: true });
  const entries = [];
  for (const [role, filePath] of Object.entries(files || {})) {
    const absoluteFile = path.resolve(absolutePackageDir, filePath);
    assertInsidePackage(absolutePackageDir, absoluteFile);
    const stat = await fs.stat(absoluteFile);
    if (!stat.isFile()) throw new Error(`External benchmark role ${role} must reference a file`);
    entries.push({
      role,
      relative_path: path.relative(absolutePackageDir, absoluteFile),
      media_type: mediaTypeFor(absoluteFile),
      byte_size: stat.size,
      sha256: await sha256File(absoluteFile)
    });
  }
  const requiredRoles = ADAPTER_REQUIRED_ROLES[sample.adapter];
  const missingRoles = requiredRoles.filter((role) => !entries.some((entry) => entry.role === role));
  if (missingRoles.length) throw new Error(`Missing required external benchmark roles: ${missingRoles.join(', ')}`);
  const packageManifest = {
    kind: 'external_benchmark_sample_package_v1',
    version: 1,
    sample_id: sample.id,
    dataset: sample.dataset,
    domain: sample.domain,
    adapter: sample.adapter,
    source_url: sample.dataset_url,
    license_note: sample.license_note,
    created_at: createdAt,
    files: entries,
    promotion_allowed: false,
    compile_allowed: false
  };
  const output = path.join(absolutePackageDir, 'sample-package.json');
  await fs.writeFile(output, `${JSON.stringify(packageManifest, null, 2)}\n`, 'utf8');
  return { packageManifest, output };
}

export async function runExternalBenchmarkAdapter({ sample, packageDir } = {}) {
  const requiredRoles = ADAPTER_REQUIRED_ROLES[sample?.adapter];
  const blockers = [];
  const absolutePackageDir = path.resolve(packageDir || sample?.local_path || '.');
  const manifestPath = path.join(absolutePackageDir, 'sample-package.json');
  if (!requiredRoles) blockers.push('unsupported_external_benchmark_adapter');
  let packageManifest = null;
  try {
    packageManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch {
    blockers.push('external_sample_package_manifest_required');
  }
  if (packageManifest) {
    if (packageManifest.kind !== 'external_benchmark_sample_package_v1' || packageManifest.version !== 1) blockers.push('external_sample_package_contract_invalid');
    if (packageManifest.sample_id !== sample.id) blockers.push('external_sample_package_id_mismatch');
    if (packageManifest.adapter !== sample.adapter) blockers.push('external_sample_package_adapter_mismatch');
    if (packageManifest.promotion_allowed !== false || packageManifest.compile_allowed !== false) blockers.push('external_sample_package_must_be_non_promotable');
  }
  const files = packageManifest?.files || [];
  for (const role of requiredRoles || []) if (!files.some((entry) => entry.role === role)) blockers.push(`external_sample_role_missing:${role}`);
  const checkedFiles = [];
  for (const entry of files) {
    const absoluteFile = path.resolve(absolutePackageDir, entry.relative_path || '');
    try {
      assertInsidePackage(absolutePackageDir, absoluteFile);
      const stat = await fs.stat(absoluteFile);
      if (!stat.isFile()) throw new Error('not_file');
      const actualSha256 = await sha256File(absoluteFile);
      if (actualSha256 !== entry.sha256) blockers.push(`external_sample_checksum_mismatch:${entry.role}`);
      const metadata = entry.role === 'source_image' || entry.role === 'facade_label_map'
        ? await readRasterMetadata(absoluteFile)
        : null;
      checkedFiles.push({ role: entry.role, relative_path: entry.relative_path, sha256: actualSha256, byte_size: stat.size, exists: true, metadata });
    } catch (error) {
      blockers.push(`external_sample_file_invalid:${entry.role}`);
      checkedFiles.push({ role: entry.role, relative_path: entry.relative_path, exists: false, error: error.message });
    }
  }
  const incompleteOnly = blockers.length > 0 && blockers.every((blocker) => blocker === 'external_sample_package_manifest_required' || blocker.startsWith('external_sample_role_missing:'));
  const status = blockers.length === 0
    ? 'ready_for_evidence_review'
    : incompleteOnly
      ? 'blocked_sample_package_incomplete'
      : 'blocked_invalid_package';
  return {
    kind: 'external_benchmark_adapter_report_v1',
    version: 1,
    sample_id: sample?.id || 'unknown',
    dataset: sample?.dataset || 'unknown',
    domain: sample?.domain || 'external',
    adapter: sample?.adapter || 'unknown',
    status,
    required_file_roles: requiredRoles || [],
    checked_files: checkedFiles,
    metrics: {
      checked_file_count: checkedFiles.length,
      source_image_count: checkedFiles.filter((entry) => entry.role === 'source_image' && entry.exists).length,
      annotation_count: checkedFiles.filter((entry) => ['pose_annotation', 'image_annotation', 'facade_label_map'].includes(entry.role) && entry.exists).length,
      cad_model_count: checkedFiles.filter((entry) => entry.role === 'cad_model' && entry.exists).length,
      false_promotion_count: 0
    },
    promotion_allowed: false,
    compile_allowed: false,
    blockers: Array.from(new Set(blockers)),
    artifacts: { sample_package: path.relative(absolutePackageDir, manifestPath) }
  };
}

function assertInsidePackage(packageDir, filePath) {
  const relative = path.relative(packageDir, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('External benchmark file must be inside its package directory');
}

async function sha256File(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

async function readRasterMetadata(filePath) {
  const metadata = await sharp(filePath).metadata();
  return { width: metadata.width, height: metadata.height, format: metadata.format };
}

function mediaTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff'].includes(extension)) return 'image';
  if (['.json', '.mat', '.txt', '.xml'].includes(extension)) return 'annotation';
  if (['.obj', '.off', '.ply', '.dae', '.stl'].includes(extension)) return 'cad_model';
  return 'binary';
}
