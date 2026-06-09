import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { repoRoot } from './image-analysis.mjs';

const BUILDING_HINTS = new Set([
  'primary_blue_roof_hall',
  'warehouse_west_north',
  'warehouse_west_south',
  'warehouse_inner_north',
  'warehouse_inner_south',
  'utility_building',
  'admin_office'
]);

const PARKING_HINTS = new Set(['parking_lot', 'parking_stall_row_north', 'parking_stall_row_south']);

export async function annotateObservationSetWithOpenCvEdgeV1(observations = {}, options = {}) {
  if (observations.object?.profile !== 'building_group' && observations.object?.type !== 'building_group') return observations;
  if (observations.opencv_edge_v1 && !options.force) return observations;
  const opencvEdge = await buildOpenCvEdgeV1({ observations, options });
  return {
    ...observations,
    opencv_edge_v1: opencvEdge
  };
}

export async function buildOpenCvEdgeV1({ observations = {}, options = {} } = {}) {
  const topImage = findTopImage(observations);
  if (!topImage?.image?.path || /^synthetic:\/\//.test(topImage.image.path)) return unavailableOpenCvEdge('missing_top_raster');
  const site = normalizeBbox(
    observations.land_cover_v1?.site_bbox_px
    || findObservation(topImage, 'site_boundary')?.bbox
    || findObservation(topImage, 'building_top_site_boundary')?.bbox
    || topImage.metrics?.object_bbox
    || [0, 0, topImage.image?.analysis_width || 1, topImage.image?.analysis_height || 1]
  );
  const outputDir = resolveRepo(options.outputDir || 'projects/image-structured-modeler/examples/building-group/structured-plan');
  const outputPath = resolveRepo(options.output || path.join(outputDir, 'opencv-edge-v1-report.json'));
  await fs.mkdir(outputDir, { recursive: true });
  const python = options.python || process.env.OPENCV_PYTHON || 'python3';
  const env = pythonEnv(options);
  const scriptPath = resolveRepo('projects/image-structured-modeler/scripts/opencv_edge_backend.py');
  const imagePath = resolveRepo(topImage.image.path);
  const args = [
    scriptPath,
    '--image', imagePath,
    '--source-image', topImage.image.path,
    '--output', outputPath,
    '--output-dir', outputDir,
    '--width', String(topImage.image.analysis_width || topImage.image.width || 900),
    '--height', String(topImage.image.analysis_height || topImage.image.height || 675),
    '--site-bbox', JSON.stringify(site),
    '--building-boxes', JSON.stringify(buildingExclusionBoxes(topImage)),
    '--parking-boxes', JSON.stringify(parkingBoxesFor(topImage))
  ];
  try {
    await runPython(python, args, env);
    const report = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    return report;
  } catch (error) {
    if (options.requireOpenCv) throw error;
    return unavailableOpenCvEdge('opencv_backend_unavailable', {
      message: error.message,
      python,
      expected_pythonpath: env.PYTHONPATH || null
    });
  }
}

export function openCvEdgeReport(opencvEdge = {}) {
  return {
    kind: 'opencv_edge_v1_report',
    version: 1,
    ok: opencvEdge.qa?.ok === true,
    verdict: opencvEdge.qa?.verdict || 'fail',
    opencv_edge_v1: opencvEdge,
    summary: {
      backend: opencvEdge.backend || null,
      opencv_version: opencvEdge.opencv_version || null,
      numpy_version: opencvEdge.numpy_version || null,
      source_image: opencvEdge.source_image || null,
      edge_pixel_count: opencvEdge.edge_pixel_count || 0,
      candidate_edge_count: opencvEdge.candidate_edges?.length || 0,
      accepted_edge_count: opencvEdge.qa?.accepted_edge_count || 0,
      rejected_edge_count: opencvEdge.qa?.rejected_edge_count || 0,
      site_perimeter_confidence: opencvEdge.qa?.site_perimeter_confidence ?? 0,
      road_boundary_confidence: opencvEdge.qa?.road_boundary_confidence ?? 0,
      building_outline_confidence: opencvEdge.qa?.building_outline_confidence ?? 0,
      roof_seam_rejection_count: opencvEdge.qa?.roof_seam_rejection_count || 0,
      internal_strong_edge_rejection_count: opencvEdge.qa?.internal_strong_edge_rejection_count || 0,
      site_perimeter_sides_with_rejected_alternatives: opencvEdge.qa?.site_perimeter_sides_with_rejected_alternatives || 0
    },
    issues: opencvEdge.qa?.issues || [],
    correction_targets: opencvEdge.correction_targets || []
  };
}

export function boundaryEdgesFromOpenCvEdgeV1(opencvEdge = {}) {
  if (!opencvEdge || opencvEdge.kind !== 'opencv_edge_v1') return [];
  return (opencvEdge.candidate_edges || [])
    .filter((candidate) => candidate.accepted)
    .filter((candidate) => !['roof_internal_seam', 'unknown_strong_edge'].includes(candidate.class))
    .map((candidate, index) => ({
      id: `opencv_boundary_edge_${index + 1}_${candidate.id}`,
      type: boundaryTypeForCandidate(candidate.class),
      state: 'observed',
      a: candidate.a,
      b: candidate.b,
      method: 'opencv_edge_v1_segment',
      confidence: candidate.confidence,
      source_ids: [candidate.id],
      inference_level: 'observed',
      completion_hypothesis_id: null,
      completion_reason: null,
      class_boundary_hint: candidate.class,
      risk_flags: candidate.risk_flags || [],
      source_pixel_support_ratio: candidate.source_pixel_support_ratio,
      source_edge_strength: candidate.source_edge_strength,
      context: candidate.context || null
    }));
}

function pythonEnv(options = {}) {
  const search = [
    options.pythonPath,
    process.env.OPENCV_PYTHONPATH,
    resolveRepo('output/python-opencv'),
    resolveRepo('output/python-opencv-smoke')
  ].filter(Boolean);
  const existing = search.filter((item) => path.isAbsolute(item));
  const current = process.env.PYTHONPATH ? [process.env.PYTHONPATH] : [];
  return {
    ...process.env,
    PYTHONPATH: [...existing, ...current].join(path.delimiter)
  };
}

function runPython(python, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`OpenCV backend failed with exit ${code}: ${stderr || stdout}`));
    });
  });
}

function unavailableOpenCvEdge(reason, detail = {}) {
  const qa = {
    ok: false,
    verdict: 'skipped',
    accepted_edge_count: 0,
    rejected_edge_count: 0,
    site_perimeter_confidence: 0,
    road_boundary_confidence: 0,
    building_outline_confidence: 0,
    roof_seam_rejection_count: 0,
    internal_strong_edge_rejection_count: 0,
    site_perimeter_sides_with_rejected_alternatives: 0,
    issues: [{
      severity: 'info',
      rule_id: reason,
      message: detail.message || 'OpenCV backend unavailable; install cv2/numpy or provide OPENCV_PYTHONPATH.'
    }]
  };
  return {
    kind: 'opencv_edge_v1',
    version: 1,
    backend: 'unavailable',
    coordinate_convention: 'image_x_right_y_down',
    source_image: null,
    analysis_size: { width: 0, height: 0 },
    site_bbox_px: [0, 0, 0, 0],
    classes: [],
    preprocessing: {},
    edge_pixel_count: 0,
    candidate_edges: [],
    site_perimeter_candidates: {},
    qa,
    correction_targets: [{
      target: 'opencv_edge_v1.backend',
      action: 'configure_real_opencv_backend',
      reason
    }],
    unavailable_detail: detail
  };
}

function boundaryTypeForCandidate(edgeClass) {
  if (edgeClass === 'building_outline') return 'building_exclusion_edge';
  if (edgeClass === 'site_perimeter_candidate') return 'site_boundary_edge';
  if (edgeClass === 'road_boundary_candidate') return 'road_boundary_edge';
  if (edgeClass === 'paved_green_boundary') return 'paved_green_edge';
  return 'unknown_boundary_edge';
}

function buildingExclusionBoxes(topImage) {
  return (topImage?.observations || [])
    .filter((item) => BUILDING_HINTS.has(item.component_hint))
    .map((item) => normalizeBbox(item.bbox));
}

function parkingBoxesFor(topImage) {
  return (topImage?.observations || [])
    .filter((item) => PARKING_HINTS.has(item.component_hint))
    .map((item) => normalizeBbox(item.bbox));
}

function findTopImage(observations) {
  return observations.images?.find((image) => image.detected_view?.kind === 'top')
    || observations.images?.find((image) => image.view === 'top')
    || observations.images?.[0]
    || null;
}

function findObservation(image, hint) {
  return image?.observations?.find((item) => item.component_hint === hint || item.id === hint) || null;
}

function normalizeBbox(bbox = [0, 0, 0, 0]) {
  const [x, y, w, h] = bbox.map((value) => Number(value) || 0);
  return [round(x), round(y), round(Math.max(0, w)), round(Math.max(0, h))];
}

function resolveRepo(value) {
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
