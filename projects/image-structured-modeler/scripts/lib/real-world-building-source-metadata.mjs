import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(fileURLToPath(new URL('../../../..', import.meta.url)));

export const SOURCE_METADATA_FILENAMES = new Set([
  'view-hints.json',
  'view_hints.json',
  'manifest.json',
  'upload-manifest.json',
  'upload_manifest.json'
]);

const VALID_VIEW_KINDS = new Set(['front', 'rear', 'left', 'right', 'top', 'bottom', 'oblique', 'detail', 'unknown']);
const VALID_UNITS = new Set(['mm', 'cm', 'm', 'in']);

export async function discoverRealWorldBuildingSourceMetadata({
  input = null,
  allFiles = null,
  viewHintsFile = null
} = {}) {
  const files = allFiles || (input ? await listFiles(resolveRepo(input)) : []);
  const candidates = [];
  if (viewHintsFile) {
    candidates.push({
      path: resolveRepo(viewHintsFile),
      source: 'view_hints_file',
      explicit: true
    });
  }
  for (const filePath of files) {
    if (!SOURCE_METADATA_FILENAMES.has(path.basename(filePath).toLowerCase())) continue;
    const source = metadataSourceForFile(filePath);
    candidates.push({
      path: path.resolve(filePath),
      source,
      explicit: false
    });
  }

  const uniqueCandidates = dedupeMetadataCandidates(candidates)
    .sort((a, b) => metadataPriority(a) - metadataPriority(b) || a.path.localeCompare(b.path));
  const viewHints = new Map();
  const metadataFiles = new Set();
  const metadataFileRecords = [];
  const scaleHints = [];

  for (const candidate of uniqueCandidates) {
    let document;
    try {
      document = JSON.parse(await fs.readFile(candidate.path, 'utf8'));
    } catch (error) {
      metadataFiles.add(candidate.path);
      metadataFileRecords.push({
        path: toRepoRelative(candidate.path),
        source: candidate.source,
        status: 'invalid_json',
        error: error.message
      });
      continue;
    }
    metadataFiles.add(candidate.path);
    const contractErrors = validateMetadataDocument({
      document,
      source: candidate.source,
      metadataPath: candidate.path,
      sourceFiles: files
    });
    if (contractErrors.length > 0) {
      metadataFileRecords.push({
        path: toRepoRelative(candidate.path),
        source: candidate.source,
        status: 'invalid_contract',
        kind: document.kind || 'unknown',
        errors: contractErrors
      });
      continue;
    }
    metadataFileRecords.push({
      path: toRepoRelative(candidate.path),
      source: candidate.source,
      status: 'parsed',
      kind: document.kind || 'unknown'
    });
    mergeHints(viewHints, extractViewHints({ document, source: candidate.source, metadataPath: candidate.path }));
    scaleHints.push(...extractScaleHints({ document, source: candidate.source, metadataPath: candidate.path }));
  }

  return {
    metadataFiles,
    metadata_file_records: metadataFileRecords,
    view_hints: viewHints,
    scale_hints: dedupeScaleHints(scaleHints)
  };
}

export function viewRecordsFromSourceMetadata({ filePath, sourceMetadata }) {
  const hints = sourceMetadata?.view_hints;
  if (!hints || hints.size === 0) return [];
  const repoRelativePath = toRepoRelative(filePath).split(path.sep).join('/');
  const basename = path.basename(repoRelativePath);
  const records = [
    ...(hints.get(repoRelativePath) || []),
    ...(hints.get(basename) || [])
  ];
  const seen = new Set();
  return records.filter((record) => {
    const key = `${record.view}:${record.source}:${record.metadata_path || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function viewHintsForImageAnalysis(sourceMetadata) {
  const hints = sourceMetadata?.view_hints;
  if (!hints || hints.size === 0) return null;
  const imageHints = new Map();
  for (const [key, records] of hints.entries()) {
    const sortedRecords = records
      .slice()
      .sort((a, b) => confidenceForHint(b) - confidenceForHint(a));
    const record = sortedRecords[0];
    if (!record) continue;
    imageHints.set(key, {
      kind: record.view,
      confidence: confidenceForHint(record),
      source: record.metadata_path || record.source
    });
  }
  return imageHints;
}

export function knownScaleFromSourceMetadata(sourceMetadata) {
  const scaleHints = sourceMetadata?.scale_hints || [];
  const dimensions = {
    width: null,
    depth: null,
    height: null
  };
  const usedHints = [];
  for (const hint of scaleHints) {
    if (hint.kind !== 'known_dimensions') continue;
    if (dimensions.width == null && positiveNumber(hint.width_mm)) dimensions.width = hint.width_mm;
    if (dimensions.depth == null && positiveNumber(hint.depth_mm)) dimensions.depth = hint.depth_mm;
    if (dimensions.height == null && positiveNumber(hint.height_mm)) dimensions.height = hint.height_mm;
    usedHints.push(hint);
  }
  if (!positiveNumber(dimensions.width) && !positiveNumber(dimensions.depth) && !positiveNumber(dimensions.height)) {
    return null;
  }
  return {
    dimensions,
    hints: usedHints,
    confidence: round(Math.max(...usedHints.map((hint) => Number(hint.confidence || 0.72)), 0.72), 3),
    sources: Array.from(new Set(usedHints.map((hint) => hint.source))).sort(),
    basis: Array.from(new Set(usedHints.flatMap((hint) => hint.basis || []))).sort()
  };
}

export async function readViewHints(hintsPath) {
  const metadata = await discoverRealWorldBuildingSourceMetadata({
    viewHintsFile: hintsPath
  });
  return viewHintsForImageAnalysis(metadata);
}

function extractViewHints({ document, source, metadataPath }) {
  const hints = new Map();
  for (const view of document.views || []) {
    const sourceImage = view.source_image || view.source || view.path || view.file;
    const kind = view.kind || view.view;
    if (!sourceImage || !kind) continue;
    addHint(hints, sourceImage, kind, source, metadataPath, view.confidence);
  }
  for (const reference of document.reference_images || []) {
    if (!reference.source) continue;
    const kind = referenceViewKind(reference);
    if (kind) addHint(hints, reference.source, kind, source, metadataPath, reference.confidence || 0.86);
  }
  for (const asset of [
    ...(document.assets || []),
    ...(document.source_assets || []),
    ...(document.images || [])
  ]) {
    const sourceImage = asset.source_image || asset.source || asset.path || asset.file;
    if (!sourceImage) continue;
    const kinds = Array.isArray(asset.views)
      ? asset.views
      : Array.isArray(asset.view)
        ? asset.view
        : [asset.view || asset.kind].filter(Boolean);
    for (const kind of kinds) addHint(hints, sourceImage, kind, source, metadataPath, asset.confidence);
  }
  for (const sourceImage of document.source_images || []) {
    if (!sourceImage || typeof sourceImage !== 'object') continue;
    const sourcePath = sourceImage.source_image || sourceImage.source || sourceImage.path || sourceImage.file;
    const kind = sourceImage.kind || sourceImage.view;
    if (sourcePath && kind) addHint(hints, sourcePath, kind, source, metadataPath, sourceImage.confidence);
  }
  return hints;
}

function extractScaleHints({ document, source, metadataPath }) {
  const hints = [];
  for (const candidate of [
    document.dimensions,
    document.known_dimensions,
    document.scale,
    document.known_scale,
    document.building_dimensions
  ]) {
    const hint = knownDimensionsHint(candidate, { source, metadataPath, inheritedUnits: document.units });
    if (hint) hints.push(hint);
  }
  for (const item of document.scale_hints || []) {
    const hint = scaleHint(item, { source, metadataPath, inheritedUnits: document.units });
    if (hint) hints.push(hint);
  }
  for (const item of document.scale_anchors || []) {
    const hint = scaleAnchorHint(item, { source, metadataPath, inheritedUnits: document.units });
    if (hint) hints.push(hint);
  }
  return hints;
}

function knownDimensionsHint(value, { source, metadataPath, inheritedUnits }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const units = value.units || inheritedUnits || 'mm';
  const width = dimensionFieldToMm(value, [
    ['width_mm', 'mm'],
    ['known_width_mm', 'mm'],
    ['width', units],
    ['known_width', units]
  ]);
  const depth = dimensionFieldToMm(value, [
    ['depth_mm', 'mm'],
    ['known_depth_mm', 'mm'],
    ['depth', units],
    ['known_depth', units],
    ['length_mm', 'mm'],
    ['length', units]
  ]);
  const height = dimensionFieldToMm(value, [
    ['height_mm', 'mm'],
    ['known_height_mm', 'mm'],
    ['height', units],
    ['known_height', units]
  ]);
  if (!positiveNumber(width) && !positiveNumber(depth) && !positiveNumber(height)) return null;
  return {
    kind: 'known_dimensions',
    target: value.target || 'building',
    units: 'mm',
    ...(positiveNumber(width) ? { width_mm: width } : {}),
    ...(positiveNumber(depth) ? { depth_mm: depth } : {}),
    ...(positiveNumber(height) ? { height_mm: height } : {}),
    confidence: normalizedConfidence(value.confidence, 0.76),
    source,
    metadata_path: toRepoRelative(metadataPath),
    basis: basisForHint(value, source)
  };
}

function scaleHint(value, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const dimensions = knownDimensionsHint(value, context);
  if (dimensions) return dimensions;
  const units = value.units || context.inheritedUnits || 'mm';
  const dimension = scaleHintDimension(value);
  const rawValue = firstPresent(value, ['value_mm', 'physical_mm', 'value', 'known_value']);
  const mm = dimensionToMm(rawValue, units);
  if (!positiveNumber(mm) || !['width', 'depth', 'height'].includes(dimension)) return null;
  return {
    kind: 'known_dimensions',
    target: value.target || 'building',
    units: 'mm',
    [`${dimension}_mm`]: mm,
    confidence: normalizedConfidence(value.confidence, 0.72),
    source: context.source,
    metadata_path: toRepoRelative(context.metadataPath),
    basis: basisForHint(value, context.source)
  };
}

function scaleAnchorHint(value, { source, metadataPath, inheritedUnits }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const units = value.units || inheritedUnits || 'mm';
  const width = dimensionFieldToMm(value, [
    ['physical_width_mm', 'mm'],
    ['width_mm', 'mm'],
    ['width', units]
  ]);
  const height = dimensionFieldToMm(value, [
    ['physical_height_mm', 'mm'],
    ['height_mm', 'mm'],
    ['height', units]
  ]);
  if (!positiveNumber(width) && !positiveNumber(height)) return null;
  return {
    kind: 'scale_anchor',
    anchor_type: value.anchor_type || value.kind || 'known_element',
    ...(value.source_image ? { source_image: value.source_image } : {}),
    ...(positiveNumber(width) ? { physical_width_mm: width } : {}),
    ...(positiveNumber(height) ? { physical_height_mm: height } : {}),
    confidence: normalizedConfidence(value.confidence, 0.68),
    source,
    metadata_path: toRepoRelative(metadataPath),
    basis: basisForHint(value, source)
  };
}

function addHint(hints, sourcePath, kind, source, metadataPath, confidence) {
  const normalized = sourcePath.split(path.sep).join('/');
  const record = {
    view: kind,
    source,
    metadata_path: toRepoRelative(metadataPath),
    ...(confidence !== undefined ? { confidence: normalizedConfidence(confidence, 0.82) } : {})
  };
  addHintRecord(hints, normalized, record);
  addHintRecord(hints, path.basename(normalized), record);
}

function addHintRecord(hints, key, record) {
  const records = hints.get(key) || [];
  if (!records.some((item) => item.view === record.view && item.source === record.source && item.metadata_path === record.metadata_path)) {
    records.push(record);
  }
  hints.set(key, records);
}

function mergeHints(target, source) {
  for (const [key, records] of source.entries()) {
    for (const record of records) addHintRecord(target, key, record);
  }
}

function referenceViewKind(reference) {
  const label = `${reference.id || ''} ${reference.name || ''}`.toLowerCase();
  if (label.includes('top')) return 'top';
  if (label.includes('front')) return 'front';
  if (label.includes('rear') || label.includes('back')) return 'rear';
  if (label.includes('right')) return 'right';
  if (label.includes('left') || label.includes('side')) return 'left';
  if (label.includes('quarter') || label.includes('oblique')) return 'oblique';
  if (reference.plane === 'xy') return 'top';
  if (reference.plane === 'yz') return 'front';
  if (reference.plane === 'xz') return 'left';
  return null;
}

async function listFiles(absoluteInput) {
  const stat = await fs.stat(absoluteInput);
  if (stat.isFile()) return [absoluteInput];
  const entries = await fs.readdir(absoluteInput, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(absoluteInput, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function dedupeMetadataCandidates(candidates) {
  const seen = new Set();
  const result = [];
  for (const candidate of candidates) {
    const key = path.resolve(candidate.path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function dedupeScaleHints(hints) {
  const seen = new Set();
  const result = [];
  for (const hint of hints) {
    const key = JSON.stringify(hint);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(hint);
  }
  return result;
}

function metadataPriority(candidate) {
  if (candidate.explicit) return -1;
  const basename = path.basename(candidate.path).toLowerCase();
  if (basename === 'view-hints.json' || basename === 'view_hints.json') return 0;
  if (basename === 'upload-manifest.json' || basename === 'upload_manifest.json') return 1;
  return 2;
}

function metadataSourceForFile(filePath) {
  const basename = path.basename(filePath).toLowerCase();
  if (basename === 'view-hints.json' || basename === 'view_hints.json') return 'view_hints_file';
  return 'upload_manifest';
}

function validateMetadataDocument({ document, source, metadataPath, sourceFiles = [] }) {
  if (source !== 'upload_manifest') return [];
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return ['upload manifest must be a JSON object'];
  }
  const errors = [];
  if (document.version !== 1) errors.push('version must be 1');
  if (document.kind !== 'real_world_building_upload_manifest') {
    errors.push('kind must be real_world_building_upload_manifest');
  }
  if (document.template_only === true) {
    errors.push('template_only upload manifest must be replaced with a real manifest before intake');
  }
  if (document.object_type && !['building_single', 'building_group'].includes(document.object_type)) {
    errors.push('object_type must be building_single or building_group');
  }
  if (document.units && !VALID_UNITS.has(document.units)) errors.push('units must be mm, cm, m, or in');
  const sourceReferenceSet = buildSourceReferenceSet({
    sourceFiles,
    metadataPath
  });
  errors.push(...validateViews(document.views, sourceReferenceSet));
  for (const [field, value] of [
    ['dimensions', document.dimensions],
    ['known_dimensions', document.known_dimensions],
    ['known_scale', document.known_scale],
    ['scale', document.scale]
  ]) {
    if (value !== undefined) errors.push(...validateKnownDimensions(value, field, document.units));
  }
  if (document.scale_hints !== undefined) {
    if (!Array.isArray(document.scale_hints)) {
      errors.push('scale_hints must be an array');
    } else {
      document.scale_hints.forEach((hint, index) => {
        errors.push(...validateScaleHint(hint, `scale_hints[${index}]`, document.units));
      });
    }
  }
  if (document.scale_anchors !== undefined) {
    if (!Array.isArray(document.scale_anchors)) {
      errors.push('scale_anchors must be an array');
    } else {
      document.scale_anchors.forEach((anchor, index) => {
        errors.push(...validateScaleAnchor(anchor, `scale_anchors[${index}]`, document.units, sourceReferenceSet));
      });
    }
  }
  return errors;
}

function validateViews(views, sourceReferenceSet = new Set()) {
  if (views === undefined) return [];
  if (!Array.isArray(views)) return ['views must be an array'];
  const errors = [];
  views.forEach((view, index) => {
    const prefix = `views[${index}]`;
    if (!view || typeof view !== 'object' || Array.isArray(view)) {
      errors.push(`${prefix} must be an object`);
      return;
    }
    const sourceImage = view.source_image || view.source || view.path || view.file;
    const kind = view.kind || view.view;
    if (!sourceImage || typeof sourceImage !== 'string') errors.push(`${prefix}.source_image must be a non-empty string`);
    else if (!sourceReferenceExists(sourceImage, sourceReferenceSet)) errors.push(`${prefix}.source_image must reference an uploaded source asset: ${sourceImage}`);
    if (!VALID_VIEW_KINDS.has(kind)) errors.push(`${prefix}.kind must be a supported view kind`);
    if (view.confidence !== undefined && !isConfidence(view.confidence)) errors.push(`${prefix}.confidence must be between 0 and 1`);
  });
  return errors;
}

function validateKnownDimensions(value, field, inheritedUnits) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${field} must be an object`];
  const errors = [];
  const units = value.units || inheritedUnits || 'mm';
  if (!VALID_UNITS.has(units)) errors.push(`${field}.units must be mm, cm, m, or in`);
  const hasDimension = [
    'width',
    'depth',
    'height',
    'length',
    'width_mm',
    'depth_mm',
    'height_mm',
    'length_mm',
    'known_width',
    'known_depth',
    'known_height',
    'known_width_mm',
    'known_depth_mm',
    'known_height_mm'
  ].some((key) => positiveNumber(value[key]));
  if (!hasDimension) errors.push(`${field} must provide at least one positive dimension`);
  if (value.confidence !== undefined && !isConfidence(value.confidence)) errors.push(`${field}.confidence must be between 0 and 1`);
  if (value.basis !== undefined && !isStringArray(value.basis)) errors.push(`${field}.basis must be an array of strings`);
  return errors;
}

function validateScaleHint(value, field, inheritedUnits) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${field} must be an object`];
  const errors = [];
  const units = value.units || inheritedUnits || 'mm';
  if (!VALID_UNITS.has(units)) errors.push(`${field}.units must be mm, cm, m, or in`);
  const dimension = value.dimension || value.axis;
  if (dimension !== undefined && !['width', 'depth', 'height'].includes(dimension)) {
    errors.push(`${field}.dimension must be width, depth, or height`);
  }
  const hasValue = ['value', 'value_mm', 'physical_mm', 'known_value'].some((key) => positiveNumber(value[key]))
    || ['width', 'depth', 'height', 'width_mm', 'depth_mm', 'height_mm'].some((key) => positiveNumber(value[key]));
  if (!hasValue) errors.push(`${field} must provide a positive scale value`);
  if (value.confidence !== undefined && !isConfidence(value.confidence)) errors.push(`${field}.confidence must be between 0 and 1`);
  if (value.basis !== undefined && !isStringArray(value.basis)) errors.push(`${field}.basis must be an array of strings`);
  return errors;
}

function scaleHintDimension(value) {
  const dimension = value.dimension || value.axis;
  if (dimension) return dimension;
  return ['width', 'depth', 'height'].includes(value.kind) ? value.kind : null;
}

function validateScaleAnchor(value, field, inheritedUnits, sourceReferenceSet = new Set()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${field} must be an object`];
  const errors = [];
  const units = value.units || inheritedUnits || 'mm';
  if (!VALID_UNITS.has(units)) errors.push(`${field}.units must be mm, cm, m, or in`);
  const hasValue = [
    'width',
    'height',
    'width_mm',
    'height_mm',
    'physical_width_mm',
    'physical_height_mm'
  ].some((key) => positiveNumber(value[key]));
  if (!hasValue) errors.push(`${field} must provide a positive physical width or height`);
  if (value.source_image !== undefined) {
    if (typeof value.source_image !== 'string' || value.source_image.length === 0) {
      errors.push(`${field}.source_image must be a non-empty string when provided`);
    } else if (!sourceReferenceExists(value.source_image, sourceReferenceSet)) {
      errors.push(`${field}.source_image must reference an uploaded source asset: ${value.source_image}`);
    }
  }
  if (value.confidence !== undefined && !isConfidence(value.confidence)) errors.push(`${field}.confidence must be between 0 and 1`);
  if (value.basis !== undefined && !isStringArray(value.basis)) errors.push(`${field}.basis must be an array of strings`);
  return errors;
}

function buildSourceReferenceSet({ sourceFiles, metadataPath }) {
  const references = new Set();
  const metadataDir = metadataPath ? path.dirname(path.resolve(metadataPath)) : null;
  for (const filePath of sourceFiles || []) {
    const absolutePath = path.resolve(filePath);
    if (SOURCE_METADATA_FILENAMES.has(path.basename(absolutePath).toLowerCase())) continue;
    addSourceReference(references, toRepoRelative(absolutePath));
    addSourceReference(references, path.basename(absolutePath));
    if (metadataDir) addSourceReference(references, path.relative(metadataDir, absolutePath));
  }
  return references;
}

function addSourceReference(references, value) {
  if (!value || typeof value !== 'string') return;
  const normalized = normalizeSourceReference(value);
  if (normalized) references.add(normalized);
}

function sourceReferenceExists(sourcePath, references) {
  return references.has(normalizeSourceReference(sourcePath));
}

function normalizeSourceReference(value) {
  return String(value || '').split(path.sep).join('/').replace(/^\.\//, '');
}

function confidenceForHint(record) {
  if (Number.isFinite(Number(record.confidence))) return Number(record.confidence);
  if (record.source === 'view_hints_file') return 0.9;
  if (record.source === 'cad_plan_default') return 0.78;
  return 0.82;
}

function firstPresent(object, keys) {
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null && object[key] !== '') return object[key];
  }
  return null;
}

function dimensionFieldToMm(object, keyUnits) {
  for (const [key, units] of keyUnits) {
    if (object[key] === undefined || object[key] === null || object[key] === '') continue;
    return dimensionToMm(object[key], units);
  }
  return null;
}

function dimensionToMm(value, units) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const normalizedUnits = String(units || 'mm').toLowerCase();
  if (['mm', 'millimeter', 'millimeters'].includes(normalizedUnits)) return round(numeric, 3);
  if (['cm', 'centimeter', 'centimeters'].includes(normalizedUnits)) return round(numeric * 10, 3);
  if (['m', 'meter', 'meters', 'metre', 'metres'].includes(normalizedUnits)) return round(numeric * 1000, 3);
  if (['in', 'inch', 'inches'].includes(normalizedUnits)) return round(numeric * 25.4, 3);
  return round(numeric, 3);
}

function normalizedConfidence(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return round(Math.min(0.98, Math.max(0.1, numeric)), 3);
}

function basisForHint(value, source) {
  const basis = [];
  if (Array.isArray(value.basis)) basis.push(...value.basis.map(String));
  if (typeof value.note === 'string' && value.note.trim()) basis.push(value.note.trim());
  if (basis.length === 0) basis.push(`Provided by ${source}.`);
  return Array.from(new Set(basis));
}

function positiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function isConfidence(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function resolveRepo(relativeOrAbsolute) {
  return path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.resolve(repoRoot, relativeOrAbsolute);
}

function toRepoRelative(filePath) {
  return path.relative(repoRoot, path.resolve(filePath)).split(path.sep).join('/') || '.';
}
