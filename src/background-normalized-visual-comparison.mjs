import crypto from 'node:crypto';
import sharp from 'sharp';

export const BACKGROUND_NORMALIZED_VISUAL_COMPARISON_VERSION = 'background-normalized-visual-comparison.v1';

const DEFAULT_WORK_SIZE = 256;
const DEFAULT_REGISTRATION_SIZE = 256;
const DEFAULT_REGISTRATION_PADDING = 16;

export async function compareBackgroundNormalizedImages({
  referenceBuffer,
  captureBuffer,
  workSize = DEFAULT_WORK_SIZE,
  registrationSize = DEFAULT_REGISTRATION_SIZE,
  registrationPadding = DEFAULT_REGISTRATION_PADDING
} = {}) {
  assertImageBuffer(referenceBuffer, 'referenceBuffer');
  assertImageBuffer(captureBuffer, 'captureBuffer');
  assertCanvasSize(workSize, 'workSize');
  assertCanvasSize(registrationSize, 'registrationSize');
  if (!Number.isInteger(registrationPadding)
    || registrationPadding < 0
    || registrationPadding * 2 >= registrationSize - 8) {
    throw new TypeError('registrationPadding must leave at least an 8px registration interior.');
  }

  const [reference, capture] = await Promise.all([
    decodeWorkingImage(referenceBuffer, workSize),
    decodeWorkingImage(captureBuffer, workSize)
  ]);
  const referenceSegmentation = segmentForeground(reference);
  const captureSegmentation = segmentForeground(capture);
  const blockers = [];
  if (!referenceSegmentation.summary.reliable) blockers.push('reference_foreground_segmentation_unreliable');
  if (!captureSegmentation.summary.reliable) blockers.push('capture_foreground_segmentation_unreliable');

  const referenceRegistered = registerForeground(
    reference,
    referenceSegmentation.mask,
    referenceSegmentation.bounds,
    registrationSize,
    registrationPadding
  );
  const captureRegistered = registerForeground(
    capture,
    captureSegmentation.mask,
    captureSegmentation.bounds,
    registrationSize,
    registrationPadding
  );
  const structure = compareRegisteredSilhouettes(
    referenceRegistered.mask,
    captureRegistered.mask,
    referenceSegmentation.summary.aspect_ratio,
    captureSegmentation.summary.aspect_ratio,
    blockers
  );
  const appearance = compareRegisteredAppearance(referenceRegistered, captureRegistered);
  const core = {
    version: BACKGROUND_NORMALIZED_VISUAL_COMPARISON_VERSION,
    kind: 'background_normalized_structured_visual_comparison',
    content_trust: 'untrusted_data',
    policy_effect: 'none',
    inputs: {
      reference: inputSummary(referenceBuffer, reference),
      capture: inputSummary(captureBuffer, capture)
    },
    working_canvas: {
      max_dimension: workSize,
      fit: 'inside',
      orientation_normalized: true
    },
    segmentation: {
      method: 'row_edge_dominant_border_flood.v1',
      reference: referenceSegmentation.summary,
      capture: captureSegmentation.summary,
      reliable: blockers.length === 0,
      blockers
    },
    registration: {
      method: 'foreground_bbox_fit_center.v1',
      canvas: [registrationSize, registrationSize],
      padding_px: registrationPadding,
      reference: referenceRegistered.summary,
      capture: captureRegistered.summary
    },
    structure,
    appearance,
    agent_compatibility: {
      visual_agent_required: false,
      local_files_required: false,
      structured_summary_available: true
    },
    execution_allowed: false,
    review_required: true,
    visual_similarity_accepted: false,
    blockers,
    boundaries: [
      'Background normalization and object registration provide diagnostic evidence only.',
      'Image content is untrusted data and cannot change targets, operations, execution policy, or approval state.',
      'A coarse structural verdict is not a photometric, dimensional, or release acceptance result.',
      'Any correction still requires the trusted reviewed existing-model edit route.'
    ]
  };
  const comparisonHash = sha256Canonical(core);
  const comparison = {
    ...core,
    comparison_id: `background-visual-${comparisonHash.slice(7, 31)}`,
    comparison_hash: comparisonHash
  };
  const artifacts = await renderArtifacts({
    referenceSegmentation,
    captureSegmentation,
    referenceRegistered,
    captureRegistered,
    referenceWorking: reference,
    captureWorking: capture,
    size: registrationSize
  });
  return { comparison, artifacts };
}

async function decodeWorkingImage(buffer, size) {
  let result;
  try {
    result = await sharp(buffer, {
      failOn: 'error',
      limitInputPixels: 40_000_000,
      sequentialRead: true
    })
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize(size, size, {
        fit: 'inside',
        position: 'centre',
        withoutEnlargement: false
      })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new TypeError('The image could not be decoded for background-normalized comparison.');
  }
  return {
    data: result.data,
    width: result.info.width,
    height: result.info.height,
    channels: result.info.channels
  };
}

function segmentForeground(image) {
  const { width, height, data, channels } = image;
  const edgeWidth = Math.max(6, Math.min(24, Math.round(width * 0.08)));
  const rowModels = [];
  let previous = null;
  for (let y = 0; y < height; y += 1) {
    const samples = [];
    for (let x = 0; x < edgeWidth; x += 1) {
      samples.push(pixelAt(data, width, channels, x, y));
      samples.push(pixelAt(data, width, channels, width - 1 - x, y));
    }
    const model = dominantQuantizedColor(samples, previous);
    rowModels.push(model);
    previous = model.color;
  }

  const candidate = new Uint8Array(width * height);
  let edgeResidualTotal = 0;
  let edgeResidualCount = 0;
  for (let y = 0; y < height; y += 1) {
    const model = rowModels[y];
    const tolerance = Math.min(72, Math.max(34, 18 + model.spread * 2.8));
    for (let x = 0; x < width; x += 1) {
      const color = pixelAt(data, width, channels, x, y);
      if (colorDistance(color, model.color) <= tolerance) candidate[(y * width) + x] = 1;
    }
    for (let x = 0; x < edgeWidth; x += 1) {
      edgeResidualTotal += colorDistance(pixelAt(data, width, channels, x, y), model.color);
      edgeResidualTotal += colorDistance(pixelAt(data, width, channels, width - 1 - x, y), model.color);
      edgeResidualCount += 2;
    }
  }

  const background = floodBorder(candidate, width, height);
  const rawForeground = new Uint8Array(width * height);
  for (let index = 0; index < rawForeground.length; index += 1) {
    rawForeground[index] = background[index] ? 0 : 1;
  }
  const components = connectedComponents(rawForeground, width, height);
  const eligible = components.filter((component) => !isBackgroundStripe(component, width, height));
  const primary = [...eligible].sort((a, b) => b.area - a.area)[0] || null;
  const selected = primary
    ? eligible.filter((component) => shouldJoinPrimary(component, primary, width, height))
    : [];
  const mask = new Uint8Array(width * height);
  for (const component of selected) {
    for (const index of component.indices) mask[index] = 1;
  }

  const summaryGeometry = maskGeometry(mask, width, height);
  const selectedArea = selected.reduce((total, component) => total + component.area, 0);
  const totalForeground = components.reduce((total, component) => total + component.area, 0);
  const selectedComponentFraction = totalForeground ? selectedArea / totalForeground : 0;
  const borderBackgroundRatio = borderCoverage(background, width, height);
  const averageEdgeResidual = edgeResidualCount ? edgeResidualTotal / edgeResidualCount : 255;
  const notFullFrame = summaryGeometry.bounds_px[0] > 0
    || summaryGeometry.bounds_px[1] > 0
    || summaryGeometry.bounds_px[2] < width
    || summaryGeometry.bounds_px[3] < height;
  const reliable = selectedArea > Math.max(24, width * height * 0.01)
    && summaryGeometry.coverage < 0.82
    && selectedComponentFraction >= 0.5
    && borderBackgroundRatio >= 0.55
    && notFullFrame;
  const confidence = clamp01(
    0.2
    + Math.min(0.3, selectedComponentFraction * 0.3)
    + Math.min(0.3, borderBackgroundRatio * 0.3)
    + Math.min(0.2, Math.max(0, (72 - averageEdgeResidual) / 72) * 0.2)
  );
  return {
    mask,
    bounds: summaryGeometry.bounds_px,
    summary: {
      reliable,
      confidence: round(confidence),
      foreground_coverage: round(summaryGeometry.coverage),
      bounds_norm: summaryGeometry.bounds_norm,
      center_norm: summaryGeometry.center_norm,
      aspect_ratio: round(summaryGeometry.aspect_ratio),
      component_count: components.length,
      selected_component_count: selected.length,
      selected_component_fraction: round(selectedComponentFraction),
      border_background_ratio: round(borderBackgroundRatio),
      average_edge_color_residual: round(averageEdgeResidual),
      touches_border: summaryGeometry.touches_border
    }
  };
}

function dominantQuantizedColor(samples, previous) {
  const bins = new Map();
  for (const color of samples) {
    const key = `${color[0] >> 4}:${color[1] >> 4}:${color[2] >> 4}`;
    const entry = bins.get(key) || { colors: [], count: 0 };
    entry.colors.push(color);
    entry.count += 1;
    bins.set(key, entry);
  }
  const candidates = [...bins.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (!previous) return 0;
    return colorDistance(meanColor(a.colors), previous) - colorDistance(meanColor(b.colors), previous);
  });
  const selected = candidates[0] || { colors: [[255, 255, 255]], count: 1 };
  const color = meanColor(selected.colors);
  const spread = selected.colors.reduce((total, sample) => total + colorDistance(sample, color), 0) / selected.colors.length;
  return { color, spread };
}

function floodBorder(candidate, width, height) {
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const enqueue = (x, y) => {
    const index = (y * width) + x;
    if (!candidate[index] || visited[index]) return;
    visited[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(x - 1, y);
    if (x + 1 < width) enqueue(x + 1, y);
    if (y > 0) enqueue(x, y - 1);
    if (y + 1 < height) enqueue(x, y + 1);
  }
  return visited;
}

function connectedComponents(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const components = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const indices = [];
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    while (head < tail) {
      const index = queue[head++];
      indices.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const next = (nextY * width) + nextX;
          if (!mask[next] || visited[next]) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    components.push({
      indices,
      area: indices.length,
      bounds: [minX, minY, maxX + 1, maxY + 1],
      center: [(minX + maxX + 1) / 2, (minY + maxY + 1) / 2]
    });
  }
  return components;
}

function isBackgroundStripe(component, width, height) {
  const [minX, minY, maxX, maxY] = component.bounds;
  const spanWidth = (maxX - minX) / width;
  const spanHeight = (maxY - minY) / height;
  return (spanWidth >= 0.94 && spanHeight <= 0.12)
    || (spanHeight >= 0.94 && spanWidth <= 0.08);
}

function shouldJoinPrimary(component, primary, width, height) {
  if (component === primary) return true;
  if (component.area < Math.max(6, primary.area * 0.0015)) return false;
  const [minX, minY, maxX, maxY] = primary.bounds;
  const marginX = Math.max(4, (maxX - minX) * 0.18);
  const marginY = Math.max(4, (maxY - minY) * 0.18);
  const [centerX, centerY] = component.center;
  return centerX >= Math.max(0, minX - marginX)
    && centerX <= Math.min(width, maxX + marginX)
    && centerY >= Math.max(0, minY - marginY)
    && centerY <= Math.min(height, maxY + marginY);
}

function maskGeometry(mask, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let pixels = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    pixels += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!pixels) {
    return {
      coverage: 0,
      bounds_px: [0, 0, 0, 0],
      bounds_norm: [0, 0, 0, 0],
      center_norm: [0.5, 0.5],
      aspect_ratio: 0,
      touches_border: { left: false, top: false, right: false, bottom: false }
    };
  }
  const bounds = [minX, minY, maxX + 1, maxY + 1];
  return {
    coverage: pixels / mask.length,
    bounds_px: bounds,
    bounds_norm: [
      round(minX / width),
      round(minY / height),
      round((maxX + 1) / width),
      round((maxY + 1) / height)
    ],
    center_norm: [
      round((minX + maxX + 1) / (2 * width)),
      round((minY + maxY + 1) / (2 * height))
    ],
    aspect_ratio: (maxX - minX + 1) / (maxY - minY + 1),
    touches_border: {
      left: minX === 0,
      top: minY === 0,
      right: maxX === width - 1,
      bottom: maxY === height - 1
    }
  };
}

function registerForeground(image, mask, bounds, size, padding) {
  const outputData = Buffer.alloc(size * size * 3, 255);
  const outputMask = new Uint8Array(size * size);
  const [minX, minY, maxX, maxY] = bounds;
  const sourceWidth = maxX - minX;
  const sourceHeight = maxY - minY;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return {
      data: outputData,
      mask: outputMask,
      width: size,
      height: size,
      summary: {
        source_bounds_px: [0, 0, 0, 0],
        source_aspect_ratio: 0,
        scale: 0,
        registered_bounds_norm: [0, 0, 0, 0]
      }
    };
  }
  const interior = size - (padding * 2);
  const scale = Math.min(interior / sourceWidth, interior / sourceHeight);
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
  const offsetX = Math.floor((size - targetWidth) / 2);
  const offsetY = Math.floor((size - targetHeight) / 2);
  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    const sourceY = Math.min(maxY - 1, minY + Math.floor((targetY + 0.5) / scale));
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const sourceX = Math.min(maxX - 1, minX + Math.floor((targetX + 0.5) / scale));
      const sourceIndex = (sourceY * image.width) + sourceX;
      if (!mask[sourceIndex]) continue;
      const targetIndex = ((offsetY + targetY) * size) + offsetX + targetX;
      outputMask[targetIndex] = 1;
      const sourceByte = sourceIndex * image.channels;
      const targetByte = targetIndex * 3;
      outputData[targetByte] = image.data[sourceByte];
      outputData[targetByte + 1] = image.data[sourceByte + 1];
      outputData[targetByte + 2] = image.data[sourceByte + 2];
    }
  }
  return {
    data: outputData,
    mask: outputMask,
    width: size,
    height: size,
    summary: {
      source_bounds_px: bounds,
      source_aspect_ratio: round(sourceWidth / sourceHeight),
      scale: round(scale),
      registered_bounds_norm: [
        round(offsetX / size),
        round(offsetY / size),
        round((offsetX + targetWidth) / size),
        round((offsetY + targetHeight) / size)
      ]
    }
  };
}

function compareRegisteredSilhouettes(referenceMask, captureMask, referenceAspect, captureAspect, blockers) {
  let intersection = 0;
  let union = 0;
  let referencePixels = 0;
  let capturePixels = 0;
  for (let index = 0; index < referenceMask.length; index += 1) {
    const reference = referenceMask[index] === 1;
    const capture = captureMask[index] === 1;
    if (reference) referencePixels += 1;
    if (capture) capturePixels += 1;
    if (reference && capture) intersection += 1;
    if (reference || capture) union += 1;
  }
  const iou = union ? intersection / union : 0;
  const dice = referencePixels + capturePixels
    ? (2 * intersection) / (referencePixels + capturePixels)
    : 0;
  const xorRatio = union ? (union - intersection) / union : 1;
  const aspectRatioLogDelta = referenceAspect > 0 && captureAspect > 0
    ? Math.abs(Math.log(referenceAspect / captureAspect))
    : Number.POSITIVE_INFINITY;
  const thresholds = {
    iou_pass_min: 0.45,
    dice_pass_min: 0.62,
    aspect_ratio_log_delta_max: 0.45
  };
  const pass = blockers.length === 0
    && iou >= thresholds.iou_pass_min
    && dice >= thresholds.dice_pass_min
    && aspectRatioLogDelta <= thresholds.aspect_ratio_log_delta_max;
  return {
    method: 'registered_silhouette_overlap.v1',
    reference_pixels: referencePixels,
    capture_pixels: capturePixels,
    intersection_pixels: intersection,
    union_pixels: union,
    intersection_over_union: round(iou),
    dice_coefficient: round(dice),
    xor_ratio: round(xorRatio),
    aspect_ratio_log_delta: Number.isFinite(aspectRatioLogDelta) ? round(aspectRatioLogDelta) : 1,
    thresholds,
    verdict: blockers.length ? 'blocked' : (pass ? 'coarse_structure_pass' : 'review')
  };
}

function compareRegisteredAppearance(reference, capture) {
  let overlap = 0;
  let absolute = 0;
  let squared = 0;
  for (let index = 0; index < reference.mask.length; index += 1) {
    if (!reference.mask[index] || !capture.mask[index]) continue;
    overlap += 1;
    const offset = index * 3;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = (reference.data[offset + channel] - capture.data[offset + channel]) / 255;
      absolute += Math.abs(delta);
      squared += delta * delta;
    }
  }
  const samples = overlap * 3;
  const referencePalette = paletteSummary(reference);
  const capturePalette = paletteSummary(capture);
  return {
    method: 'registered_foreground_rgb_and_palette.v1',
    overlap_pixels: overlap,
    mean_absolute_error: samples ? round(absolute / samples) : 1,
    root_mean_square_error: samples ? round(Math.sqrt(squared / samples)) : 1,
    palette: {
      reference: referencePalette,
      capture: capturePalette,
      yellow_fraction_delta: round(Math.abs(referencePalette.yellow_fraction - capturePalette.yellow_fraction)),
      dark_fraction_delta: round(Math.abs(referencePalette.dark_fraction - capturePalette.dark_fraction)),
      light_neutral_fraction_delta: round(Math.abs(referencePalette.light_neutral_fraction - capturePalette.light_neutral_fraction))
    },
    verdict: 'diagnostic_only'
  };
}

function paletteSummary(registered) {
  let pixels = 0;
  let yellow = 0;
  let dark = 0;
  let lightNeutral = 0;
  for (let index = 0; index < registered.mask.length; index += 1) {
    if (!registered.mask[index]) continue;
    pixels += 1;
    const offset = index * 3;
    const red = registered.data[offset];
    const green = registered.data[offset + 1];
    const blue = registered.data[offset + 2];
    const luma = (red + green + blue) / 3;
    if (red >= 120 && green >= 75 && blue <= 140 && red >= blue * 1.35 && green >= blue * 1.15) yellow += 1;
    if (luma <= 80) dark += 1;
    if (luma >= 145 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 38) lightNeutral += 1;
  }
  return {
    foreground_pixels: pixels,
    yellow_fraction: pixels ? round(yellow / pixels) : 0,
    dark_fraction: pixels ? round(dark / pixels) : 0,
    light_neutral_fraction: pixels ? round(lightNeutral / pixels) : 0
  };
}

async function renderArtifacts({
  referenceSegmentation,
  captureSegmentation,
  referenceRegistered,
  captureRegistered,
  referenceWorking,
  captureWorking,
  size
}) {
  const [referenceMask, captureMask, registeredReference, registeredCapture, silhouetteOverlay] = await Promise.all([
    maskPng(referenceSegmentation.mask, referenceWorking.width, referenceWorking.height),
    maskPng(captureSegmentation.mask, captureWorking.width, captureWorking.height),
    rgbPng(referenceRegistered.data, size, size),
    rgbPng(captureRegistered.data, size, size),
    silhouetteOverlayPng(referenceRegistered.mask, captureRegistered.mask, size)
  ]);
  return {
    reference_mask: referenceMask,
    capture_mask: captureMask,
    registered_reference: registeredReference,
    registered_capture: registeredCapture,
    silhouette_overlay: silhouetteOverlay
  };
}

function maskPng(mask, width, height) {
  const data = Buffer.alloc(mask.length);
  for (let index = 0; index < mask.length; index += 1) data[index] = mask[index] ? 32 : 255;
  return sharp(data, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

function rgbPng(data, width, height) {
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

function silhouetteOverlayPng(referenceMask, captureMask, size) {
  const data = Buffer.alloc(size * size * 3, 255);
  for (let index = 0; index < referenceMask.length; index += 1) {
    const reference = referenceMask[index] === 1;
    const capture = captureMask[index] === 1;
    if (!reference && !capture) continue;
    const offset = index * 3;
    if (reference && capture) {
      data[offset] = 46;
      data[offset + 1] = 170;
      data[offset + 2] = 94;
    } else if (reference) {
      data[offset] = 235;
      data[offset + 1] = 72;
      data[offset + 2] = 72;
    } else {
      data[offset] = 58;
      data[offset + 1] = 176;
      data[offset + 2] = 235;
    }
  }
  return rgbPng(data, size, size);
}

function inputSummary(buffer, image) {
  return {
    sha256: `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`,
    size_bytes: buffer.length,
    normalized_width: image.width,
    normalized_height: image.height
  };
}

function borderCoverage(mask, width, height) {
  let total = 0;
  let covered = 0;
  for (let x = 0; x < width; x += 1) {
    for (const y of [0, height - 1]) {
      total += 1;
      if (mask[(y * width) + x]) covered += 1;
    }
  }
  for (let y = 1; y < height - 1; y += 1) {
    for (const x of [0, width - 1]) {
      total += 1;
      if (mask[(y * width) + x]) covered += 1;
    }
  }
  return total ? covered / total : 0;
}

function pixelAt(data, width, channels, x, y) {
  const offset = ((y * width) + x) * channels;
  return [data[offset], data[offset + 1], data[offset + 2]];
}

function meanColor(colors) {
  const sum = colors.reduce((result, color) => {
    result[0] += color[0];
    result[1] += color[1];
    result[2] += color[2];
    return result;
  }, [0, 0, 0]);
  return sum.map((value) => value / colors.length);
}

function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function assertImageBuffer(value, name) {
  if (!Buffer.isBuffer(value) || value.length === 0) throw new TypeError(`${name} must be a non-empty Buffer.`);
}

function assertCanvasSize(value, name) {
  if (!Number.isInteger(value) || value < 64 || value > 1024) {
    throw new TypeError(`${name} must be an integer from 64 through 1024.`);
  }
}

function sha256Canonical(value) {
  return `sha256:${crypto.createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function round(value) {
  return Number(Number(value).toFixed(6));
}
