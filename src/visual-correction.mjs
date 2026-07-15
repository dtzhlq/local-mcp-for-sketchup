import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { markUntrustedData, sha256Canonical } from './agent-contract.mjs';
import { validateReferenceVisualSnapshot } from './reference-visual-qa.mjs';

export const VISUAL_EVIDENCE_VERSION = 'visual-correction-evidence.v1';
export const VISUAL_CORRECTION_PATCH_VERSION = 'visual-correction-patch.v1';
export const VISUAL_CORRECTION_QA_VERSION = 'visual-correction-qa.v1';

export async function analyzeReferenceImageCorrection({
  referenceImagePath,
  captureImagePath,
  modelGraph,
  modelSnapshot,
  referenceSpec,
  correctionTargets = [],
  correctionOperations = [],
  outputDir,
  allowedRoots = []
} = {}) {
  if (!referenceImagePath || !captureImagePath) throw new Error('Reference and captured image paths are required');
  if (!modelGraph?.model_revision) throw new Error('Visual correction requires a current ModelGraph');
  const referencePath = await assertAllowedImagePath(referenceImagePath, allowedRoots);
  const capturePath = await assertAllowedImagePath(captureImagePath, allowedRoots);
  const [reference, capture] = await Promise.all([readNormalizedImage(referencePath), readNormalizedImage(capturePath)]);
  const comparison = compareImages(reference, capture);
  const referenceQa = referenceSpec && modelSnapshot
    ? validateReferenceVisualSnapshot(modelSnapshot, { spec: referenceSpec, includePreview: false })
    : null;
  const confidence = evidenceConfidence(comparison, referenceQa);
  const blockers = [];
  if (comparison.foreground.reference.coverage === 0 || comparison.foreground.capture.coverage === 0) blockers.push('foreground_not_detected');
  if (!correctionTargets.length || !correctionOperations.length) blockers.push('mapped_correction_operations_required');
  const evidenceCore = {
    version: VISUAL_EVIDENCE_VERSION,
    kind: 'reference_image_existing_model_evidence',
    model_graph_id: modelGraph.graph_id,
    model_revision: modelGraph.model_revision,
    input_image: publicImageSummary(reference),
    captured_image: publicImageSummary(capture),
    alignment: comparison.alignment,
    difference: comparison.difference,
    foreground: comparison.foreground,
    reference_model_qa: referenceQa ? markUntrustedData(referenceQa, 'image_derived_reference_spec') : null,
    confidence,
    untrusted_data_fields: ['input_image', 'captured_image', 'reference_model_qa', 'ocr'],
    blockers
  };
  const evidence = {
    ...evidenceCore,
    evidence_id: `visual-evidence-${sha256Canonical(evidenceCore).slice(7, 31)}`
  };
  const patchCore = {
    version: VISUAL_CORRECTION_PATCH_VERSION,
    kind: 'visual_correction_patch',
    evidence_id: evidence.evidence_id,
    model_revision: modelGraph.model_revision,
    targets: structuredClone(correctionTargets),
    operations: structuredClone(correctionOperations),
    risk_level: inferRisk(correctionOperations),
    blockers,
    execution_allowed: false,
    review_required: true,
    execution_route: 'trusted_reviewed_existing_model_edit_only'
  };
  const patch = {
    ...patchCore,
    correction_patch_id: `visual-patch-${sha256Canonical(patchCore).slice(7, 31)}`,
    next_action: blockers.length
      ? { action: 'supply_mapped_correction_operations_or_better_images' }
      : {
          action: 'start_reviewed_existing_model_edit',
          tool: 'start_agent_task',
          arguments: {
            intent: 'reviewed_existing_model_edit',
            instruction: 'Apply the user-reviewed reference-image correction patch.',
            interface_level: 'guided',
            inputs: { targets: structuredClone(correctionTargets), operations: structuredClone(correctionOperations) }
          }
        }
  };
  const artifacts = {};
  if (outputDir) {
    await fs.mkdir(outputDir, { recursive: true });
    artifacts.evidence = await writeJsonAtomic(path.join(outputDir, 'visual-correction-evidence.v1.json'), evidence);
    artifacts.correction_patch = await writeJsonAtomic(path.join(outputDir, 'visual-correction-patch.v1.json'), patch);
    artifacts.overlay = await writeOverlay(reference, capture, path.join(outputDir, 'visual-difference-overlay.png'));
  }
  return { evidence, correction_patch: patch, artifacts };
}

export async function verifyReferenceImageCorrection({ referenceImagePath, captureImagePath, previousEvidence, allowedRoots = [], outputDir } = {}) {
  const referencePath = await assertAllowedImagePath(referenceImagePath, allowedRoots);
  const capturePath = await assertAllowedImagePath(captureImagePath, allowedRoots);
  const [reference, capture] = await Promise.all([readNormalizedImage(referencePath), readNormalizedImage(capturePath)]);
  const comparison = compareImages(reference, capture);
  const previousMae = Number(previousEvidence?.difference?.mean_absolute_error);
  const improved = Number.isFinite(previousMae) ? comparison.difference.mean_absolute_error < previousMae : null;
  const pass = comparison.difference.mean_absolute_error <= 0.02 && comparison.alignment.foreground_center_delta_norm <= 0.03;
  const core = {
    version: VISUAL_CORRECTION_QA_VERSION,
    kind: 'visual_correction_qa',
    previous_evidence_id: previousEvidence?.evidence_id || null,
    alignment: comparison.alignment,
    difference: comparison.difference,
    improved,
    verdict: pass ? 'pass' : improved ? 'review' : 'fail',
    review_required: !pass,
    next_action: pass ? null : { action: 'review_visual_residuals_before_another_correction' }
  };
  const report = { ...core, qa_id: `visual-qa-${sha256Canonical(core).slice(7, 31)}` };
  const artifacts = {};
  if (outputDir) {
    await fs.mkdir(outputDir, { recursive: true });
    artifacts.qa = await writeJsonAtomic(path.join(outputDir, 'visual-correction-qa.v1.json'), report);
    artifacts.overlay = await writeOverlay(reference, capture, path.join(outputDir, 'visual-correction-qa-overlay.png'));
  }
  return { report, artifacts };
}

async function assertAllowedImagePath(value, roots) {
  const candidate = path.resolve(String(value));
  if (!roots.length) throw new Error('Visual image roots must be configured');
  let canonical;
  try { canonical = await fs.realpath(candidate); } catch { throw new Error('Visual image artifact does not exist'); }
  for (const root of roots) {
    let canonicalRoot;
    try { canonicalRoot = await fs.realpath(path.resolve(root)); } catch { canonicalRoot = path.resolve(root); }
    const relative = path.relative(canonicalRoot, canonical);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return canonical;
  }
  throw new Error('Visual image artifact is outside configured allowed roots');
}

async function readNormalizedImage(filePath) {
  const source = sharp(filePath, { failOn: 'error', limitInputPixels: 40_000_000 });
  const metadata = await source.metadata();
  if (!['png', 'jpeg', 'webp', 'tiff'].includes(metadata.format)) throw new Error('Unsupported visual image format');
  const { data, info } = await source.clone().flatten({ background: '#ffffff' }).resize(128, 128, { fit: 'contain', background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    path: filePath,
    sha256: `sha256:${crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex')}`,
    metadata: { format: metadata.format, width: metadata.width, height: metadata.height, channels: metadata.channels },
    data,
    width: info.width,
    height: info.height,
    channels: info.channels
  };
}

function publicImageSummary(image) {
  return { sha256: image.sha256, ...image.metadata };
}

function compareImages(reference, capture) {
  let absolute = 0;
  let squared = 0;
  for (let index = 0; index < reference.data.length; index += 1) {
    const delta = (reference.data[index] - capture.data[index]) / 255;
    absolute += Math.abs(delta);
    squared += delta * delta;
  }
  const count = reference.data.length;
  const referenceForeground = foregroundSummary(reference);
  const captureForeground = foregroundSummary(capture);
  const dx = captureForeground.center[0] - referenceForeground.center[0];
  const dy = captureForeground.center[1] - referenceForeground.center[1];
  return {
    alignment: {
      method: 'normalized_canvas_and_foreground_centroid.v1',
      scale: [1, 1],
      translation_norm: [round(dx), round(dy)],
      foreground_center_delta_norm: round(Math.hypot(dx, dy))
    },
    difference: {
      method: 'normalized_rgb.v1',
      mean_absolute_error: round(absolute / count),
      root_mean_square_error: round(Math.sqrt(squared / count)),
      compared_pixels: reference.width * reference.height
    },
    foreground: { reference: referenceForeground, capture: captureForeground }
  };
}

function foregroundSummary(image) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  let pixels = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = (y * image.width + x) * image.channels;
      const luminance = (image.data[index] + image.data[index + 1] + image.data[index + 2]) / (3 * 255);
      if (luminance >= 0.94) continue;
      pixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!pixels) return { coverage: 0, bounds_norm: [0, 0, 0, 0], center: [0.5, 0.5] };
  return {
    coverage: round(pixels / (image.width * image.height)),
    bounds_norm: [round(minX / image.width), round(minY / image.height), round((maxX + 1) / image.width), round((maxY + 1) / image.height)],
    center: [round((minX + maxX + 1) / (2 * image.width)), round((minY + maxY + 1) / (2 * image.height))]
  };
}

async function writeOverlay(reference, capture, outputPath) {
  const pixels = Buffer.alloc(reference.width * reference.height * 4);
  for (let pixel = 0; pixel < reference.width * reference.height; pixel += 1) {
    const source = pixel * 3;
    const target = pixel * 4;
    const referenceLuma = (reference.data[source] + reference.data[source + 1] + reference.data[source + 2]) / 3;
    const captureLuma = (capture.data[source] + capture.data[source + 1] + capture.data[source + 2]) / 3;
    pixels[target] = 255 - referenceLuma;
    pixels[target + 1] = 255 - captureLuma;
    pixels[target + 2] = 255 - captureLuma;
    pixels[target + 3] = 255;
  }
  await sharp(pixels, { raw: { width: reference.width, height: reference.height, channels: 4 } }).png().toFile(outputPath);
  return outputPath;
}

function evidenceConfidence(comparison, referenceQa) {
  const foreground = Math.min(comparison.foreground.reference.coverage, comparison.foreground.capture.coverage);
  const qaPenalty = Math.min(0.2, Number(referenceQa?.summary?.total || 0) * 0.02);
  return round(Math.max(0, Math.min(1, 0.65 + Math.min(0.25, foreground * 2) - qaPenalty)));
}

function inferRisk(operations) {
  const destructive = new Set(['delete', 'erase_entities', 'explode_entity']);
  const topology = new Set(['pushpull_face', 'transform_entities', 'cut_hole', 'cut_slot', 'cut_recess', 'boolean_union', 'boolean_difference', 'boolean_intersect']);
  if (operations.some((operation) => destructive.has(operation.op))) return 'S4';
  if (operations.some((operation) => topology.has(operation.op))) return 'S3';
  return operations.length ? 'S2' : null;
}

async function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, filePath);
  return filePath;
}

function round(value) {
  return Number(Number(value).toFixed(6));
}
