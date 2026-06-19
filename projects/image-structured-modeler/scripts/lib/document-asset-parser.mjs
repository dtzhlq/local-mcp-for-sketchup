import fs from 'node:fs/promises';
import path from 'node:path';
import { repoRoot, toRepoRelative } from './image-analysis.mjs';

const PROFILE_DEFAULT_HEIGHT = {
  building_single: 10500,
  building_group: 18000,
  vehicle_ambulance: 1050,
  switch_controller: 155,
  compact_remote: 158
};

export async function parseDocumentAssets({ assetFiles = [], objectType = 'unknown', objectName = 'Document Asset', profile = 'unknown_object' } = {}) {
  const parsedAssets = [];
  for (const asset of assetFiles) {
    if (asset.mediaType === 'cad') parsedAssets.push(await parseCadAsset(asset, { profile }));
    else if (asset.mediaType === 'pdf') parsedAssets.push(await parsePdfAsset(asset));
  }
  const cadAssets = parsedAssets.filter((asset) => asset.media_type === 'cad');
  const pdfAssets = parsedAssets.filter((asset) => asset.media_type === 'pdf');
  const primaryCad = cadAssets.find((asset) => asset.geometry?.bbox);
  const sourceAssets = parsedAssets.map((asset) => asset.path);
  const missingViews = requiredViewsForProfile(profile, primaryCad ? ['top'] : []);
  const parserRisks = [];
  if (pdfAssets.some((asset) => asset.status !== 'parsed')) parserRisks.push('pdf_parse_failed');
  if (cadAssets.some((asset) => asset.status !== 'parsed')) parserRisks.push('cad_parse_failed');
  if (!primaryCad) parserRisks.push('cad_geometry_not_extracted');
  if (pdfAssets.length && primaryCad) parserRisks.push('pdf_metadata_only');

  const images = [];
  for (const parsed of parsedAssets) {
    if (parsed.media_type === 'cad' && parsed.geometry?.bbox) images.push(cadObservationImage(parsed, profile));
    else images.push(documentMetadataObservationImage(parsed));
  }

  const defaultScale = primaryCad
    ? {
        width: round(primaryCad.geometry.bbox.width),
        depth: round(primaryCad.geometry.bbox.height),
        height: PROFILE_DEFAULT_HEIGHT[profile] || 0
      }
    : {};
  const scaleConfidence = primaryCad ? 0.82 : 0;
  const observations = images.flatMap((image) => image.observations || []);
  const observationSet = {
    version: 1,
    object: {
      type: objectType,
      name: objectName,
      profile,
      source_images: sourceAssets
    },
    image_set_quality: primaryCad ? 'medium' : 'low',
    views_detected: primaryCad ? ['top'] : ['unknown'],
    missing_views: missingViews,
    images,
    scale_calibration: {
      units: 'mm',
      strategy: primaryCad ? 'cad_document_units_mm' : 'document_parser_no_scale_geometry',
      default_scale: defaultScale,
      measurements: primaryCad ? [{
        view: 'top',
        source_image: primaryCad.path,
        observation_id: 'cad_document_outline',
        anchor_type: 'cad_outline_bbox',
        object_bbox: [0, 0, round(primaryCad.geometry.bbox.width), round(primaryCad.geometry.bbox.height)],
        physical_width_mm: round(primaryCad.geometry.bbox.width),
        physical_height_mm: round(primaryCad.geometry.bbox.height),
        pixels_per_mm_x: 1,
        pixels_per_mm_y: 1,
        confidence: scaleConfidence,
        basis: [`dxf_lwpolyline_units:${primaryCad.geometry.units}`],
        review_required: true,
        note: `DXF model units are normalized to millimeters from ${primaryCad.geometry.units}; user must confirm units.`
      }] : [],
      confidence: scaleConfidence,
      missing_views: missingViews,
      notes: [
        primaryCad
          ? 'CAD parser extracted a top-view outline and scale anchor; confirm units and height before geometry promotion.'
          : 'Document parser did not extract usable CAD geometry.'
      ]
    },
    visual_relation_graph: {
      version: 1,
      coordinate_convention: 'image_x_right_y_down',
      relation_types: [],
      source_images: sourceAssets,
      relations: [],
      summary: {
        relations: 0,
        parser_required: false,
        document_assets: parsedAssets.length
      },
      open_questions: [
        'Confirm CAD drawing units and map document views before PartGraph promotion.'
      ]
    },
    evidence_graph: {
      version: 1,
      image_count: images.length,
      views_detected: primaryCad ? ['top'] : ['unknown'],
      missing_views: missingViews,
      parts: primaryCad ? [cadEvidenceGraphPart(primaryCad, missingViews)] : [],
      part_matches: [],
      visual_relations: [],
      scale_calibration: {
        units: 'mm',
        strategy: primaryCad ? 'cad_document_units_mm' : 'document_parser_no_scale_geometry',
        default_scale: defaultScale,
        measurements: [],
        confidence: scaleConfidence,
        missing_views: missingViews
      },
      open_questions: [
        'PDF/CAD parser output is review evidence, not direct compile permission.'
      ]
    },
    quality_report: {
      usable_for_modeling: Boolean(primaryCad),
      risks: parserRisks,
      notes: [
        'Document parser v1 extracts simple PDF metadata and DXF LWPOLYLINE outlines only.'
      ]
    },
    review: {
      overlay_dir: null,
      open_questions: [
        'Confirm drawing units, object profile, height, and missing photo views before promotion.'
      ]
    },
    document_parse_report: makeDocumentParseReport({ parsedAssets, primaryCad, missingViews, parserRisks })
  };
  return {
    observationSet,
    report: observationSet.document_parse_report
  };
}

async function parseCadAsset(asset, { profile = 'unknown_object' } = {}) {
  if (asset.extension === '.dxf') {
    const text = await fs.readFile(asset.path, 'utf8');
    const units = parseDxfInsUnits(text);
    const polylines = parseDxfLwPolylines(text, units);
    const largest = polylines
      .map((polyline) => ({ ...polyline, bbox: bboxForPoints(polyline.points) }))
      .filter((item) => item.bbox.width > 0 && item.bbox.height > 0)
      .sort((a, b) => outlineRank(b, profile) - outlineRank(a, profile))[0];
    return {
      path: toRepoRelative(asset.path),
      media_type: 'cad',
      extension: asset.extension,
      parser: 'dxf_lwpolyline_v1',
      status: largest ? 'parsed' : 'blocked',
      geometry: largest ? {
        kind: 'lwpolyline_outline',
        point_count: largest.points.length,
        points: largest.points.map((point) => [round(point[0]), round(point[1])]),
        bbox: largest.bbox,
        layer: largest.layer,
        units: units.name,
        unit_scale_to_mm: units.scaleToMm,
        candidate_outlines: polylines.length,
        selection_basis: outlineSelectionBasis(largest, profile)
      } : null,
      cad_units: units.name,
      unit_scale_to_mm: units.scaleToMm,
      candidate_outlines: polylines.length,
      selected_layer: largest?.layer || null,
      blockers: largest ? [] : ['cad_outline_not_found']
    };
  }
  return {
    path: toRepoRelative(asset.path),
    media_type: 'cad',
    extension: asset.extension,
    parser: 'unsupported_cad_metadata_v1',
    status: 'blocked',
    geometry: null,
    blockers: ['unsupported_cad_format'],
    candidate_outlines: 0
  };
}

async function parsePdfAsset(asset) {
  const text = await fs.readFile(asset.path, 'utf8');
  const mediaBox = parsePdfMediaBox(text);
  const strings = Array.from(text.matchAll(/\(([^()]*)\)/g)).map((match) => match[1]).filter(Boolean);
  return {
    path: toRepoRelative(asset.path),
    media_type: 'pdf',
    extension: asset.extension,
    parser: 'pdf_metadata_v1',
    status: mediaBox ? 'parsed' : 'blocked',
    page_count: countPdfPages(text),
    media_box: mediaBox,
    text_samples: strings.slice(0, 5),
    geometry: null,
    blockers: mediaBox ? ['pdf_geometry_not_extracted'] : ['pdf_media_box_not_found']
  };
}

function parseDxfLwPolylines(text, units = { scaleToMm: 1 }) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const pairs = [];
  for (let index = 0; index < lines.length - 1; index += 2) {
    pairs.push([lines[index], lines[index + 1]]);
  }
  const polylines = [];
  for (let index = 0; index < pairs.length; index += 1) {
    if (pairs[index][0] !== '0' || pairs[index][1] !== 'LWPOLYLINE') continue;
    const points = [];
    let layer = '0';
    let pendingX = null;
    for (let cursor = index + 1; cursor < pairs.length; cursor += 1) {
      const [code, value] = pairs[cursor];
      if (code === '0') break;
      if (code === '8') layer = value || layer;
      else if (code === '10') pendingX = Number(value);
      else if (code === '20' && pendingX !== null) {
        const y = Number(value);
        if (Number.isFinite(pendingX) && Number.isFinite(y)) {
          points.push([pendingX * units.scaleToMm, y * units.scaleToMm]);
        }
        pendingX = null;
      }
    }
    if (points.length >= 2) polylines.push({ points, layer });
  }
  return polylines;
}

function parseDxfInsUnits(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const index = lines.findIndex((line) => line === '$INSUNITS');
  if (index === -1) return { code: null, name: 'millimeter_assumed', scaleToMm: 1 };
  for (let cursor = index + 1; cursor < Math.min(lines.length - 1, index + 12); cursor += 2) {
    if (lines[cursor] !== '70') continue;
    const code = Number(lines[cursor + 1]);
    if (!Number.isFinite(code)) break;
    const units = dxfUnitsToMillimeters(code);
    return { code, ...units };
  }
  return { code: null, name: 'millimeter_assumed', scaleToMm: 1 };
}

function dxfUnitsToMillimeters(code) {
  const units = {
    0: { name: 'unitless_assumed_mm', scaleToMm: 1 },
    1: { name: 'inch', scaleToMm: 25.4 },
    2: { name: 'foot', scaleToMm: 304.8 },
    4: { name: 'millimeter', scaleToMm: 1 },
    5: { name: 'centimeter', scaleToMm: 10 },
    6: { name: 'meter', scaleToMm: 1000 }
  };
  return units[code] || { name: `unsupported_insunits_${code}_assumed_mm`, scaleToMm: 1 };
}

function outlineRank(polyline, profile) {
  const layerPriority = outlineLayerPriority(polyline.layer, profile);
  const area = polyline.bbox.width * polyline.bbox.height;
  return layerPriority * 1e12 + area;
}

function outlineLayerPriority(layer = '', profile = 'unknown_object') {
  const normalized = layer.toLowerCase();
  if (/dimension|dim|grid|axis|anno|text|label|hatch|furniture/.test(normalized)) return 0;
  if (/building|footprint|outline|wall/.test(normalized)) return 4;
  if (profile === 'building_group' && /site|boundary|parcel/.test(normalized)) return 3;
  if (/site|boundary|parcel/.test(normalized)) return 2;
  return 1;
}

function outlineSelectionBasis(polyline, profile) {
  return {
    layer: polyline.layer || '0',
    layer_priority: outlineLayerPriority(polyline.layer, profile),
    area_mm2: round(polyline.bbox.width * polyline.bbox.height)
  };
}

function parsePdfMediaBox(text) {
  const match = text.match(/\/MediaBox\s*\[\s*([0-9.+-]+)\s+([0-9.+-]+)\s+([0-9.+-]+)\s+([0-9.+-]+)\s*\]/);
  if (!match) return null;
  const values = match.slice(1).map(Number);
  if (!values.every(Number.isFinite)) return null;
  return {
    x0: values[0],
    y0: values[1],
    x1: values[2],
    y1: values[3],
    width: round(values[2] - values[0]),
    height: round(values[3] - values[1])
  };
}

function countPdfPages(text) {
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return matches ? matches.length : 0;
}

function cadObservationImage(parsed, profile) {
  const width = Math.max(1, Math.round(parsed.geometry.bbox.width));
  const height = Math.max(1, Math.round(parsed.geometry.bbox.height));
  const points = normalizePointsToBBox(parsed.geometry.points, parsed.geometry.bbox);
  return {
    version: 1,
    image: {
      path: parsed.path,
      width,
      height,
      analysis_width: width,
      analysis_height: height
    },
    detected_view: {
      kind: 'top',
      confidence: 0.9,
      notes: ['CAD LWPOLYLINE interpreted as top-view outline.']
    },
    observations: [
      {
        id: 'cad_document_outline',
        kind: 'sampled_contour',
        source_view: 'top',
        component_hint: profile === 'building_group' ? 'site_boundary' : 'building_main_mass',
        bbox: [0, 0, width, height],
        points,
        contour: {
          kind: 'cad_lwpolyline_outline',
          polygon: closePolygon(points),
          sample_count: points.length,
          source: parsed.path,
          review_required: true
        },
        grounding: {
          method: 'cad_lwpolyline_units',
          pixel_bbox: [0, 0, width, height],
          pixel_count: width * height,
          grounding_quality: {
            version: 1,
            status: 'review_required',
            bbox_proxy: false,
            review_required: true,
            reasons: ['cad_units_require_confirmation', 'height_requires_confirmation']
          },
          review_required: true
        },
        grounding_status: 'review_confirmed',
        confidence: 0.82,
        note: `CAD outline parsed from LWPOLYLINE layer ${parsed.geometry.layer}; units normalized from ${parsed.geometry.units}.`
      },
      {
        id: 'cad_document_scale_anchor',
        kind: 'scale_anchor',
        source_view: 'top',
        component_hint: 'document_scale_anchor',
        bbox: [0, 0, width, height],
        confidence: 0.82,
        note: 'CAD drawing extents used as provisional scale anchor.'
      }
    ],
    quality_report: {
      usable_for_modeling: true,
      risks: ['cad_units_require_confirmation', 'height_requires_confirmation'],
      missing_views: requiredViewsForProfile(profile, ['top'])
    }
  };
}

function documentMetadataObservationImage(parsed) {
  const width = Math.max(1, Math.round(parsed.media_box?.width || 1));
  const height = Math.max(1, Math.round(parsed.media_box?.height || 1));
  return {
    version: 1,
    image: {
      path: parsed.path,
      width,
      height,
      analysis_width: width,
      analysis_height: height
    },
    detected_view: {
      kind: 'unknown',
      confidence: 0,
      notes: ['Document metadata parsed; no geometry extracted.']
    },
    observations: [
      {
        id: `${parsed.media_type}_document_metadata`,
        kind: 'manual_review',
        source_view: 'unknown',
        component_hint: 'source_document',
        confidence: parsed.status === 'parsed' ? 0.35 : 0,
        note: parsed.text_samples?.length
          ? `Text samples: ${parsed.text_samples.join(' | ')}`
          : `${parsed.media_type.toUpperCase()} metadata requires review.`
      }
    ],
    quality_report: {
      usable_for_modeling: false,
      risks: parsed.blockers || [],
      missing_views: ['profile', 'scale', 'views']
    }
  };
}

function cadEvidenceGraphPart(parsed, missingViews) {
  return {
    part_id: 'cad_document_outline',
    status: 'observed',
    required_views: ['top'],
    confirmed_views: ['top'],
    missing_views: missingViews,
    confidence: 0.82,
    sources: [
      {
        view: 'top',
        kind: 'cad_lwpolyline_outline',
        status: 'observed',
        source_image: parsed.path,
        observation_id: 'cad_document_outline',
        confidence: 0.82,
        note: `CAD parser extracted LWPOLYLINE outline from layer ${parsed.geometry.layer}.`
      }
    ],
    conflicts: [
      {
        type: 'document_units_unconfirmed',
        severity: 'warn',
        note: `CAD units are normalized from ${parsed.geometry.units}; user must confirm scale.`
      }
    ],
    open_questions: [
      'Confirm CAD units, building height, and facade views before promotion.'
    ]
  };
}

function makeDocumentParseReport({ parsedAssets, primaryCad, missingViews, parserRisks }) {
  return {
    version: 1,
    kind: 'document_asset_parse_report',
    parser: 'document_asset_parser_v1',
    ok: Boolean(primaryCad),
    status: primaryCad ? 'parsed_review_required' : 'blocked',
    assets: parsedAssets.map((asset) => ({
      path: asset.path,
      media_type: asset.media_type,
      extension: asset.extension,
      parser: asset.parser,
      status: asset.status,
      blockers: asset.blockers || [],
      page_count: asset.page_count,
      cad_units: asset.cad_units,
      unit_scale_to_mm: asset.unit_scale_to_mm,
      selected_layer: asset.selected_layer,
      candidate_outlines: asset.candidate_outlines
    })),
    summary: {
      parsed_assets: parsedAssets.filter((asset) => asset.status === 'parsed').length,
      pdf_assets: parsedAssets.filter((asset) => asset.media_type === 'pdf').length,
      cad_assets: parsedAssets.filter((asset) => asset.media_type === 'cad').length,
      cad_outlines: primaryCad ? 1 : 0,
      cad_candidate_outlines: parsedAssets
        .filter((asset) => asset.media_type === 'cad')
        .reduce((sum, asset) => sum + Number(asset.candidate_outlines || 0), 0),
      pdf_pages: parsedAssets
        .filter((asset) => asset.media_type === 'pdf')
        .reduce((sum, asset) => sum + Number(asset.page_count || 0), 0),
      missing_views: missingViews,
      risks: parserRisks
    },
    extracted_geometry: primaryCad ? {
      source_asset: primaryCad.path,
      kind: primaryCad.geometry.kind,
      point_count: primaryCad.geometry.point_count,
      width_mm: round(primaryCad.geometry.bbox.width),
      depth_mm: round(primaryCad.geometry.bbox.height),
      units: primaryCad.geometry.units,
      unit_scale_to_mm: primaryCad.geometry.unit_scale_to_mm,
      layer: primaryCad.geometry.layer,
      candidate_outlines: primaryCad.geometry.candidate_outlines,
      selection_basis: primaryCad.geometry.selection_basis
    } : null,
    blockers: primaryCad ? ['review_required_before_promotion'] : parserRisks
  };
}

function bboxForPoints(points) {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: round(minX),
    y: round(minY),
    width: round(maxX - minX),
    height: round(maxY - minY)
  };
}

function normalizePointsToBBox(points, bbox) {
  return points.map((point) => [round(point[0] - bbox.x), round(point[1] - bbox.y)]);
}

function closePolygon(points) {
  if (!points.length) return [];
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return points;
  return [...points, first];
}

function requiredViewsForProfile(profile, confirmedViews = []) {
  const byProfile = {
    building_single: ['oblique', 'front', 'left', 'top'],
    building_group: ['top', 'oblique'],
    vehicle_ambulance: ['front', 'left', 'rear', 'top'],
    switch_controller: ['front', 'rear', 'right'],
    compact_remote: ['front', 'right']
  };
  const required = byProfile[profile] || ['profile', 'scale', 'views'];
  return required.filter((view) => !confirmedViews.includes(view));
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

export const documentAssetParserInternals = {
  parseDxfLwPolylines,
  parsePdfMediaBox
};
