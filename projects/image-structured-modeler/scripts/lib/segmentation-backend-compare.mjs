import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { repoRoot } from './image-analysis.mjs';
import { BIRD_EYE_LAND_COVER_COLORS, buildBirdEyeLandCoverV1 } from './bird-eye-land-cover.mjs';

export const REFERENCE_MASK_BANK_CLASSES = [
  'building_roof_or_footprint',
  'paved_surface',
  'vegetation',
  'parking_marking',
  'road_surface_or_drive_aisle'
];

const CLASS_MAP = {
  building_roof_or_footprint: ['building_footprint'],
  paved_surface: ['paved_surface'],
  vegetation: ['vegetation_tree', 'vegetation_low'],
  parking_marking: ['parking_marking'],
  road_surface_or_drive_aisle: ['road_surface_candidate']
};

export async function buildSegmentationBackendCompare({ observations = {}, options = {} } = {}) {
  const landCover = observations.land_cover_v1 || await buildBirdEyeLandCoverV1({ observations });
  const referenceBank = await ensureReferenceMaskBankScaffold(options.referenceMaskBank || defaultReferenceMaskBankPath());
  const insid3 = await inspectInsid3Availability({ referenceBank, options });
  const classicalCandidates = observedMaskCandidatesFromLandCover(landCover, 'classical_cv_v1');
  const insid3Candidates = insid3.available ? [] : [];
  const fusedCandidates = fuseObservedMaskCandidates({ classicalCandidates, insid3Candidates });
  const overlap = compareClassicalAndInsid3({ classicalCandidates, insid3Candidates });
  const qa = compareQa({ classicalCandidates, insid3Candidates, fusedCandidates, insid3 });
  return {
    kind: 'segmentation_backend_compare_v1',
    version: 1,
    source_image: landCover.source_image || null,
    coordinate_convention: 'image_x_right_y_down',
    backends: {
      default: 'classical_cv_v1',
      optional: 'insid3_optional'
    },
    reference_mask_bank: referenceBank,
    insid3,
    observed_mask_candidates: fusedCandidates,
    backend_candidates: {
      classical_cv_v1: classicalCandidates,
      insid3_optional: insid3Candidates
    },
    overlap,
    fusion_decision: fusionDecision({ insid3, fusedCandidates }),
    qa,
    correction_targets: correctionTargetsFromQa(qa)
  };
}

export function segmentationBackendCompareReport(compare = {}) {
  return {
    kind: 'segmentation_backend_compare_report',
    version: 1,
    ok: compare.qa?.ok === true,
    verdict: compare.qa?.verdict || 'fail',
    segmentation_backend_compare: compare,
    summary: {
      default_backend: compare.backends?.default || null,
      optional_backend: compare.backends?.optional || null,
      insid3_status: compare.insid3?.status || 'unknown',
      insid3_available: compare.insid3?.available === true,
      insid3_blockers: compare.insid3?.blockers || [],
      classical_candidate_count: compare.backend_candidates?.classical_cv_v1?.length || 0,
      insid3_candidate_count: compare.backend_candidates?.insid3_optional?.length || 0,
      fused_observed_mask_count: compare.observed_mask_candidates?.length || 0,
      promoted_geometry_count: (compare.observed_mask_candidates || []).filter((candidate) => candidate.grounding_decision === 'promoted_geometry').length,
      mean_backend_overlap: compare.overlap?.mean_overlap ?? null,
      fusion_decision: compare.fusion_decision?.decision || null
    },
    issues: compare.qa?.issues || [],
    correction_targets: compare.correction_targets || []
  };
}

export async function renderSegmentationBackendCompareArtifact({
  observations = {},
  compare = null,
  outputDir,
  basename = 'segmentation-backend-compare'
} = {}) {
  const resolved = compare || await buildSegmentationBackendCompare({ observations });
  const topImage = findTopImage(observations);
  const raster = await loadTopRaster(topImage).catch(() => null);
  const imageHref = raster ? await rasterDataUrl(raster) : null;
  const svg = renderCompareSvg({ compare: resolved, imageHref });
  await fs.mkdir(outputDir, { recursive: true });
  const svgPath = path.join(outputDir, `${basename}.svg`);
  const pngPath = path.join(outputDir, `${basename}.png`);
  await fs.writeFile(svgPath, svg, 'utf8');
  await sharp(Buffer.from(svg), { density: 144 }).png().toFile(pngPath);
  return { svgPath, pngPath };
}

export async function ensureReferenceMaskBankScaffold(referenceMaskBankPath = defaultReferenceMaskBankPath()) {
  const root = path.isAbsolute(referenceMaskBankPath) ? referenceMaskBankPath : path.resolve(repoRoot, referenceMaskBankPath);
  await fs.mkdir(root, { recursive: true });
  const entries = [];
  for (const [index, className] of REFERENCE_MASK_BANK_CLASSES.entries()) {
    const classDir = path.join(root, className);
    await fs.mkdir(classDir, { recursive: true });
    const refPath = path.join(classDir, 'reference.png');
    const maskPath = path.join(classDir, 'mask.png');
    await writeReferencePngIfMissing(refPath, className, index, false);
    await writeReferencePngIfMissing(maskPath, className, index, true);
    entries.push({
      class: className,
      reference_image: path.relative(repoRoot, refPath),
      binary_mask: path.relative(repoRoot, maskPath),
      source: 'programmatic_scaffold',
      note: 'Minimal concept reference for optional INSID3 smoke testing; not a per-image annotation library.'
    });
  }
  const manifest = {
    kind: 'reference_mask_bank_v1',
    version: 1,
    default_backend: 'insid3_optional',
    classes: REFERENCE_MASK_BANK_CLASSES,
    entries
  };
  const manifestPath = path.join(root, 'manifest.json');
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return {
    path: path.relative(repoRoot, root),
    manifest_path: path.relative(repoRoot, manifestPath),
    classes: REFERENCE_MASK_BANK_CLASSES,
    entry_count: entries.length,
    entries
  };
}

function observedMaskCandidatesFromLandCover(landCover = {}, backend) {
  const masks = landCover.masks || [];
  const result = [];
  for (const [concept, classes] of Object.entries(CLASS_MAP)) {
    const matches = masks.filter((mask) => classes.includes(mask.class));
    for (const [index, mask] of matches.entries()) {
      result.push({
        id: `${backend}_${concept}_${index + 1}`,
        concept,
        land_cover_class: mask.class,
        source_backend: backend,
        source_mask_id: mask.id,
        bbox_px: mask.bbox_px,
        polygon_px: mask.polygon_px,
        area_px: mask.area_px || bboxArea(mask.bbox_px),
        confidence: mask.confidence ?? 0.58,
        review_required: true,
        grounding_decision: 'observed_mask_candidate',
        note: 'Segmentation backend output is observed evidence only; GroundPlan promotion is decided by boundary/residual QA.'
      });
    }
  }
  return result;
}

function fuseObservedMaskCandidates({ classicalCandidates = [], insid3Candidates = [] } = {}) {
  if (!insid3Candidates.length) return classicalCandidates.map((candidate) => ({
    ...candidate,
    fusion_method: 'classical_only_insid3_skipped'
  }));
  const fused = [...classicalCandidates];
  for (const candidate of insid3Candidates) {
    if (fused.some((existing) => existing.concept === candidate.concept && intersectionRatio(existing.bbox_px, candidate.bbox_px) > 0.55)) continue;
    fused.push({ ...candidate, fusion_method: 'insid3_only_review' });
  }
  return fused.map((candidate) => ({
    ...candidate,
    review_required: true,
    grounding_decision: 'observed_mask_candidate'
  }));
}

function compareClassicalAndInsid3({ classicalCandidates = [], insid3Candidates = [] } = {}) {
  if (!insid3Candidates.length) {
    return {
      available: false,
      mean_overlap: null,
      per_class: Object.fromEntries(REFERENCE_MASK_BANK_CLASSES.map((className) => [className, null])),
      note: 'INSID3 optional backend skipped; overlap cannot be computed.'
    };
  }
  const perClass = {};
  for (const className of REFERENCE_MASK_BANK_CLASSES) {
    const classical = classicalCandidates.filter((candidate) => candidate.concept === className);
    const insid3 = insid3Candidates.filter((candidate) => candidate.concept === className);
    const overlaps = [];
    for (const a of classical) {
      for (const b of insid3) overlaps.push(intersectionRatio(a.bbox_px, b.bbox_px));
    }
    perClass[className] = overlaps.length ? round(Math.max(...overlaps)) : 0;
  }
  return {
    available: true,
    mean_overlap: round(average(Object.values(perClass).filter(Number.isFinite), 0)),
    per_class: perClass
  };
}

async function inspectInsid3Availability({ referenceBank, options }) {
  const blockers = [];
  const root = options.insid3Root || process.env.INSID3_ROOT || null;
  const weights = options.dinoV3Weights || process.env.DINOV3_WEIGHTS || process.env.INSID3_DINOV3_WEIGHTS || null;
  const enabled = options.enableInsid3 || process.env.INSID3_ENABLE === '1';
  if (!enabled) blockers.push('INSID3_ENABLE is not set to 1');
  if (!root) blockers.push('INSID3_ROOT is not configured');
  else if (!await exists(root)) blockers.push(`INSID3_ROOT does not exist: ${root}`);
  if (!weights) blockers.push('DINOV3_WEIGHTS / INSID3_DINOV3_WEIGHTS is not configured');
  else if (!await exists(weights)) blockers.push(`DINOv3 weights path does not exist: ${weights}`);
  if (!referenceBank?.entry_count) blockers.push('reference mask bank is empty');
  if (blockers.length) {
    return {
      backend: 'insid3_optional',
      available: false,
      status: 'skipped_unavailable',
      blockers,
      expected_inputs: ['reference image', 'reference mask', 'target image', 'DINOv3 weights'],
      note: 'Optional backend skipped; default classical/high-contrast pipeline remains authoritative.'
    };
  }
  return {
    backend: 'insid3_optional',
    available: false,
    status: 'configured_but_not_executed',
    blockers: ['INSID3 adapter execution is intentionally not part of default npm tests'],
    expected_inputs: ['reference image', 'reference mask', 'target image', 'DINOv3 weights'],
    note: 'Environment appears configured, but this JS smoke gate only defines the contract unless an explicit adapter is added.'
  };
}

function compareQa({ classicalCandidates, insid3Candidates, fusedCandidates, insid3 }) {
  const issues = [];
  if (!classicalCandidates.length) issues.push(issue('fail', 'classical_masks_missing', 'No classical land-cover masks were available for comparison.'));
  if (!insid3.available) issues.push(issue('info', 'insid3_optional_skipped', `INSID3 optional backend skipped: ${(insid3.blockers || []).join('; ')}`));
  const promoted = fusedCandidates.filter((candidate) => candidate.grounding_decision === 'promoted_geometry');
  if (promoted.length) issues.push(issue('fail', 'segmentation_backend_promoted_geometry', 'Segmentation backend compare must not promote geometry directly.'));
  return {
    ok: classicalCandidates.length > 0 && promoted.length === 0,
    verdict: classicalCandidates.length > 0 && promoted.length === 0 ? 'pass' : 'fail',
    classical_candidate_count: classicalCandidates.length,
    insid3_candidate_count: insid3Candidates.length,
    fused_observed_mask_count: fusedCandidates.length,
    insid3_status: insid3.status,
    promoted_geometry_count: promoted.length,
    issues
  };
}

function fusionDecision({ insid3, fusedCandidates }) {
  if (!insid3.available) {
    return {
      decision: 'classical_only_with_insid3_skip_report',
      fused_count: fusedCandidates.length,
      reason: 'INSID3 optional backend unavailable; fused masks come from classical land-cover only.'
    };
  }
  return {
    decision: 'classical_plus_insid3_review_fusion',
    fused_count: fusedCandidates.length,
    reason: 'INSID3 outputs are review-only observed mask candidates.'
  };
}

function renderCompareSvg({ compare = {}, imageHref = null }) {
  const site = inferSite(compare);
  const panelW = Math.max(1, Math.round(site[2]));
  const panelH = Math.max(1, Math.round(site[3]));
  const gap = 20;
  const titleH = 32;
  const width = panelW * 2 + gap;
  const height = panelH * 2 + gap + titleH * 2 + 92;
  const panels = [
    { x: 0, y: 0, contentY: titleH },
    { x: panelW + gap, y: 0, contentY: titleH },
    { x: 0, y: panelH + titleH + gap, contentY: panelH + titleH + gap + titleH },
    { x: panelW + gap, y: panelH + titleH + gap, contentY: panelH + titleH + gap + titleH }
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f4f6f8"/>
  ${panelTitle(panels[0], panelW, 'Original')}
  ${imageHref ? `<image href="${imageHref}" x="${panels[0].x}" y="${panels[0].contentY}" width="${panelW}" height="${panelH}" preserveAspectRatio="none"/>` : `<rect x="${panels[0].x}" y="${panels[0].contentY}" width="${panelW}" height="${panelH}" fill="#d8dee6"/>`}
  ${panelTitle(panels[1], panelW, 'Classical masks')}
  <rect x="${panels[1].x}" y="${panels[1].contentY}" width="${panelW}" height="${panelH}" fill="#fff"/>
  ${maskSvg(compare.backend_candidates?.classical_cv_v1 || [], panels[1])}
  ${panelTitle(panels[2], 'INSID3 optional'.length * 10 < panelW ? panelW : panelW, 'INSID3 optional')}
  <rect x="${panels[2].x}" y="${panels[2].contentY}" width="${panelW}" height="${panelH}" fill="#fff"/>
  ${compare.insid3?.available ? maskSvg(compare.backend_candidates?.insid3_optional || [], panels[2]) : skippedSvg(compare.insid3, panels[2], panelW, panelH)}
  ${panelTitle(panels[3], panelW, 'Fused observed masks')}
  <rect x="${panels[3].x}" y="${panels[3].contentY}" width="${panelW}" height="${panelH}" fill="#fff"/>
  ${maskSvg(compare.observed_mask_candidates || [], panels[3])}
  ${panels.map((p) => `<rect x="${p.x}" y="${p.contentY}" width="${panelW}" height="${panelH}" fill="none" stroke="#111827" stroke-width="2"/>`).join('\n')}
  <rect x="0" y="${height - 76}" width="${width}" height="76" fill="#fff" stroke="#d1d5db"/>
  <text x="18" y="${height - 42}" font-size="15" font-weight="700" fill="#111827" font-family="Inter, Arial, sans-serif">INSID3 ${escapeXml(compare.insid3?.status || 'unknown')} | fused masks ${compare.observed_mask_candidates?.length || 0} | promoted geometry 0</text>
  <text x="18" y="${height - 18}" font-size="14" fill="#475569" font-family="Inter, Arial, sans-serif">Segmentation masks remain observed evidence; BoundaryGraph and residual QA decide GroundPlan promotion.</text>
</svg>`;
}

function maskSvg(candidates = [], panel) {
  return candidates.map((candidate, index) => {
    const color = colorForConcept(candidate.concept, candidate.land_cover_class);
    const [x, y, w, h] = candidate.bbox_px || [0, 0, 0, 0];
    return `<rect x="${panel.x + x}" y="${panel.contentY + y}" width="${w}" height="${h}" fill="${color}" opacity="${0.26 + (index % 3) * 0.06}" stroke="${color}" stroke-width="2"/>`;
  }).join('\n');
}

function skippedSvg(insid3, panel, width, height) {
  const blocker = (insid3?.blockers || ['unavailable'])[0];
  return `<rect x="${panel.x + 22}" y="${panel.contentY + 22}" width="${width - 44}" height="${Math.min(120, height - 44)}" rx="6" fill="#f8fafc" stroke="#cbd5e1"/>
  <text x="${panel.x + 42}" y="${panel.contentY + 58}" font-size="18" font-weight="700" fill="#334155" font-family="Inter, Arial, sans-serif">INSID3 skipped</text>
  <text x="${panel.x + 42}" y="${panel.contentY + 88}" font-size="13" fill="#64748b" font-family="Inter, Arial, sans-serif">${escapeXml(blocker)}</text>`;
}

function panelTitle(panel, width, text) {
  return `<rect x="${panel.x}" y="${panel.y}" width="${width}" height="32" fill="#111827"/><text x="${panel.x + 12}" y="${panel.y + 22}" fill="#fff" font-size="15" font-weight="700" font-family="Inter, Arial, sans-serif">${escapeXml(text)}</text>`;
}

async function writeReferencePngIfMissing(filePath, className, index, maskOnly) {
  if (await exists(filePath)) return;
  const color = colorForConcept(className);
  const shape = maskOnly
    ? `<rect x="${18 + index * 2}" y="${18 + index * 2}" width="${92 - index * 5}" height="${68 + index * 2}" fill="#fff"/>`
    : `<rect width="128" height="96" fill="#17202a"/><rect x="${18 + index * 2}" y="${18 + index * 2}" width="${92 - index * 5}" height="${68 + index * 2}" fill="${color}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96" viewBox="0 0 128 96"><rect width="128" height="96" fill="#000"/>${shape}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(filePath);
}

async function loadTopRaster(topImage) {
  if (!topImage?.image?.path || /^synthetic:\/\//.test(topImage.image.path)) return null;
  const imagePath = path.resolve(repoRoot, topImage.image.path);
  const width = topImage.image.analysis_width || topImage.image.width || 900;
  const height = topImage.image.analysis_height || Math.round(width * (topImage.image.height || 1) / Math.max(1, topImage.image.width || 1));
  const { data, info } = await sharp(imagePath)
    .rotate()
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height, channels: info.channels };
}

async function rasterDataUrl(raster) {
  const buffer = await sharp(raster.buffer, {
    raw: { width: raster.width, height: raster.height, channels: raster.channels }
  }).png().toBuffer();
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

function inferSite(compare) {
  const candidates = compare.observed_mask_candidates || [];
  if (!candidates.length) return [0, 0, 900, 675];
  const x0 = Math.min(...candidates.map((item) => item.bbox_px?.[0] ?? 0), 0);
  const y0 = Math.min(...candidates.map((item) => item.bbox_px?.[1] ?? 0), 0);
  const x1 = Math.max(...candidates.map((item) => (item.bbox_px?.[0] ?? 0) + (item.bbox_px?.[2] ?? 0)), 900);
  const y1 = Math.max(...candidates.map((item) => (item.bbox_px?.[1] ?? 0) + (item.bbox_px?.[3] ?? 0)), 675);
  return [x0, y0, x1 - x0, y1 - y0];
}

function findTopImage(observations) {
  return observations.images?.find((image) => image.detected_view?.kind === 'top')
    || observations.images?.find((image) => image.view === 'top')
    || observations.images?.[0]
    || null;
}

function defaultReferenceMaskBankPath() {
  return path.join(repoRoot, 'projects', 'image-structured-modeler', 'examples', 'reference-mask-bank');
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function colorForConcept(concept, fallbackClass = null) {
  if (fallbackClass && BIRD_EYE_LAND_COVER_COLORS[fallbackClass]) return BIRD_EYE_LAND_COVER_COLORS[fallbackClass];
  if (concept === 'building_roof_or_footprint') return '#2f80d0';
  if (concept === 'paved_surface') return '#c9d0d8';
  if (concept === 'vegetation') return '#278a3c';
  if (concept === 'parking_marking') return '#fff7b0';
  if (concept === 'road_surface_or_drive_aisle') return '#8b949e';
  return '#94a3b8';
}

function correctionTargetsFromQa(qa = {}) {
  if (qa.insid3_status === 'skipped_unavailable') {
    return [{
      target: 'segmentation_backend_compare.insid3_optional',
      action: 'configure_optional_backend_or_accept_skip',
      reason: 'INSID3 is optional and currently unavailable; default path still runs.'
    }];
  }
  return [];
}

function bboxArea(bbox = [0, 0, 0, 0]) {
  return Math.max(0, bbox[2] || 0) * Math.max(0, bbox[3] || 0);
}

function intersectionRatio(a, b) {
  const inter = intersectionArea(a, b);
  const union = bboxArea(a) + bboxArea(b) - inter;
  return round(inter / Math.max(1, union));
}

function intersectionArea(a = [0, 0, 0, 0], b = [0, 0, 0, 0]) {
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];
  const xOverlap = Math.max(0, Math.min(ax2, bx2) - Math.max(a[0], b[0]));
  const yOverlap = Math.max(0, Math.min(ay2, by2) - Math.max(a[1], b[1]));
  return xOverlap * yOverlap;
}

function average(values = [], fallback = 0) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return fallback;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function issue(severity, ruleId, message) {
  return { severity, rule_id: ruleId, message };
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
