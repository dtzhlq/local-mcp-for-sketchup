#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot, toRepoRelative } from './lib/image-analysis.mjs';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = path.resolve(repoRoot, options.input || 'projects/image-structured-modeler/examples/switch-controller/observations.json');
  const output = path.resolve(repoRoot, options.output || 'projects/image-structured-modeler/examples/switch-controller/model-plan.json');
  const observationSet = JSON.parse(await fs.readFile(input, 'utf8'));
  const manualCorrections = options.manualCorrections
    ? JSON.parse(await fs.readFile(path.resolve(repoRoot, options.manualCorrections), 'utf8'))
    : null;
  const modelPlan = generateModelPlan(observationSet, {
    knownWidth: numberOption(options.knownWidth, 280),
    knownHeight: numberOption(options.knownHeight, 155),
    knownDepth: numberOption(options.knownDepth, 42),
    manualCorrections
  });

  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(modelPlan, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ok: true, output, parts: modelPlan.parts.length }, null, 2)}\n`);
}

export function generateModelPlan(observationSet, options = {}) {
  const knownWidth = options.knownWidth ?? 280;
  const knownHeight = options.knownHeight ?? 155;
  const knownDepth = options.knownDepth ?? 42;
  const manualCorrections = options.manualCorrections || null;
  const viewIds = makeViewIds(observationSet.images || []);
  const views = (observationSet.images || []).map((image) => ({
    id: viewIds.get(image.image.path),
    kind: image.detected_view.kind,
    source_image: image.image.path,
    confidence: image.detected_view.confidence
  }));

  const evidence = (componentHints, preferredKinds = ['front', 'rear', 'right']) => {
    const hints = Array.isArray(componentHints) ? componentHints : [componentHints];
    const matches = [];
    for (const image of observationSet.images || []) {
      if (!preferredKinds.includes(image.detected_view.kind)) continue;
      for (const observation of image.observations || []) {
        if (!hints.includes(observation.component_hint)) continue;
        matches.push(evidenceFromObservation(observation, viewIds.get(image.image.path)));
      }
    }
    if (matches.length > 0) return matches.slice(0, 4);
    return [{
      view: views[0]?.id || 'unknown_view',
      kind: 'manual_note',
      confidence: 0.35,
      note: `No direct component candidate yet for ${hints.join('/')}; generated from controller layout prior.`
    }];
  };

  const object = {
    type: observationSet.object?.type || 'game_controller',
    name: observationSet.object?.name || 'Switch Joy-Con Grip Controller',
    source_images: observationSet.object?.source_images || []
  };

  const modelPlan = {
    version: 1,
    object,
    scale: {
      units: 'mm',
      known_width: knownWidth,
      known_height: knownHeight,
      known_depth: knownDepth,
      confidence: observationSet.missing_views?.includes('top') ? 0.58 : 0.72
    },
    views,
    parts: [
      {
        id: 'center_grip_body',
        type: 'beveled_panel',
        material: 'Satin_Black_Plastic',
        parameters: { width: 96, height: 150, thickness: 26, corner_radius: 8 },
        evidence: evidence('center_grip_body', ['front', 'rear'])
      },
      {
        id: 'left_joycon_shell',
        type: 'lofted_shell',
        material: 'Warm_White_Plastic',
        parameters: { width: 92, height: 155, thickness: 24, side: 'left', mirror_pair: 'right_joycon_shell' },
        evidence: evidence('left_joycon_shell', ['front'])
      },
      {
        id: 'right_joycon_shell',
        type: 'lofted_shell',
        material: 'Warm_White_Plastic',
        parameters: { width: 92, height: 155, thickness: 24, side: 'right', mirror_pair: 'left_joycon_shell' },
        evidence: evidence('right_joycon_shell', ['front'])
      },
      {
        id: 'rear_grip_pair',
        type: 'grip_handle',
        material: 'Satin_Black_Plastic',
        parameters: { symmetric: true, width_each: 54, height: 132, thickness: 36, needs_side_profile: true },
        evidence: evidence(['rear_grip_left', 'rear_grip_right', 'side_thickness_profile'], ['rear', 'right'])
      },
      {
        id: 'left_thumbstick',
        type: 'analog_stick',
        parent: 'left_joycon_shell',
        material: 'Rubber_Thumbstick',
        parameters: { center: [-92, -20, 26], outer_radius: 11, top_radius: 9.5, height: 14, recess_depth: 2.5 },
        evidence: evidence('left_thumbstick', ['front'])
      },
      {
        id: 'right_thumbstick',
        type: 'analog_stick',
        parent: 'right_joycon_shell',
        material: 'Rubber_Thumbstick',
        parameters: { center: [72, 34, 26], outer_radius: 10.5, top_radius: 9, height: 13, recess_depth: 2.5 },
        evidence: evidence('right_thumbstick', ['front']),
        uncertainty: ['Inferred from Switch controller layout; current photos need semantic confirmation.']
      },
      {
        id: 'abxy_cluster',
        type: 'button_on_panel',
        parent: 'right_joycon_shell',
        material: 'Gloss_Black_Button',
        parameters: {
          buttons: [
            { label: 'X', center: [104, -36], radius: 5.8 },
            { label: 'Y', center: [88, -20], radius: 5.6 },
            { label: 'A', center: [120, -20], radius: 5.6 },
            { label: 'B', center: [104, -4], radius: 5.6 }
          ]
        },
        evidence: evidence('abxy_cluster', ['front'])
      },
      {
        id: 'left_button_cluster',
        type: 'button_on_panel',
        parent: 'left_joycon_shell',
        material: 'Gloss_Black_Button',
        parameters: {
          buttons: [
            { label: 'L1', center: [-122, 20], radius: 4.8 },
            { label: 'L2', center: [-108, 8], radius: 4.8 },
            { label: 'L3', center: [-94, 20], radius: 4.8 },
            { label: 'L4', center: [-108, 32], radius: 4.8 }
          ]
        },
        evidence: evidence('left_button_cluster', ['front']),
        uncertainty: ['Button labels and exact positions need manual review.']
      },
      {
        id: 'shoulder_rail_pair',
        type: 'trigger',
        material: 'Satin_Black_Plastic',
        parameters: { width_each: 76, height: 11, thickness: 6 },
        evidence: evidence('side_thickness_profile', ['right'])
      }
    ],
    review: {
      overlay_path: observationSet.review?.overlay_dir || null,
      open_questions: observationSet.review?.open_questions || []
    }
  };

  return applyManualCorrections(modelPlan, manualCorrections);
}

export function applyManualCorrections(modelPlan, corrections) {
  if (!corrections) return modelPlan;
  if (corrections.version !== 1) throw new Error('manual corrections version must be 1');
  const next = structuredClone(modelPlan);
  const applied = [];

  if (corrections.scale) {
    for (const [correctionKey, modelKey] of [
      ['known_width', 'known_width'],
      ['known_height', 'known_height'],
      ['known_depth', 'known_depth'],
      ['confidence', 'confidence']
    ]) {
      if (corrections.scale[correctionKey] !== undefined) {
        next.scale[modelKey] = corrections.scale[correctionKey];
        applied.push(`scale.${modelKey}`);
      }
    }
  }

  for (const correction of corrections.parts || []) {
    const index = next.parts.findIndex((part) => part.id === correction.id);
    if (correction.action === 'remove') {
      if (index >= 0) {
        next.parts.splice(index, 1);
        applied.push(`remove:${correction.id}`);
      }
      continue;
    }

    if (correction.action === 'add') {
      if (index >= 0) throw new Error(`manual correction add target already exists: ${correction.id}`);
      next.parts.push({
        id: correction.id,
        type: correction.type,
        parent: correction.parent,
        material: correction.material,
        parameters: correction.parameters || {},
        evidence: [manualEvidence(correction)],
        ...(correction.uncertainty ? { uncertainty: correction.uncertainty } : {})
      });
      applied.push(`add:${correction.id}`);
      continue;
    }

    if (correction.action === 'update') {
      if (index < 0) throw new Error(`manual correction update target not found: ${correction.id}`);
      const target = next.parts[index];
      if (correction.type) target.type = correction.type;
      if (correction.parent) target.parent = correction.parent;
      if (correction.material) target.material = correction.material;
      if (correction.parameters) target.parameters = deepMerge(target.parameters || {}, correction.parameters);
      if (correction.uncertainty) target.uncertainty = correction.uncertainty;
      target.evidence = [...(target.evidence || []), manualEvidence(correction)];
      applied.push(`update:${correction.id}`);
      continue;
    }

    throw new Error(`Unsupported manual correction action: ${correction.action}`);
  }

  if (corrections.review?.open_questions) {
    next.review.open_questions = corrections.review.open_questions;
    applied.push('review.open_questions');
  }
  next.review.corrections_applied = applied;
  if (corrections.notes?.length) next.review.correction_notes = corrections.notes;
  return next;
}

function manualEvidence(correction) {
  return {
    view: 'manual_correction',
    kind: 'manual_note',
    confidence: 0.95,
    note: correction.evidence_note || `Manual correction applied to ${correction.id}.`
  };
}

function deepMerge(base, override) {
  const result = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base?.[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      result[key] = deepMerge(base[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function makeViewIds(images) {
  const counts = new Map();
  const viewIds = new Map();
  for (const image of images) {
    const kind = image.detected_view.kind;
    const base = kind === 'right' || kind === 'left' ? 'side_photo' : `${kind}_photo`;
    const count = (counts.get(base) || 0) + 1;
    counts.set(base, count);
    viewIds.set(image.image.path, count === 1 ? base : `${base}_${count}`);
  }
  return viewIds;
}

function evidenceFromObservation(observation, view) {
  return {
    view,
    kind: evidenceKind(observation.kind),
    points: observation.points || bboxToPolygon(observation.bbox),
    confidence: observation.confidence,
    note: observation.note || `Evidence from ${observation.id}.`
  };
}

function evidenceKind(kind) {
  if (kind === 'center_point') return 'center_point';
  if (kind === 'edge' || kind === 'curve') return 'edge';
  if (kind === 'color_region') return 'color_region';
  if (kind === 'text_or_logo') return 'text_label';
  if (kind === 'component_bbox') return 'silhouette';
  return 'manual_note';
}

function bboxToPolygon(bbox) {
  if (!bbox) return undefined;
  const [x, y, width, height] = bbox;
  return [[x, y], [x + width, y], [x + width, y + height], [x, y + height], [x, y]];
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.input = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--known-width') options.knownWidth = argv[++index];
    else if (arg === '--known-height') options.knownHeight = argv[++index];
    else if (arg === '--known-depth') options.knownDepth = argv[++index];
    else if (arg === '--manual-corrections') options.manualCorrections = argv[++index];
    else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function numberOption(value, fallback) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`Expected positive number, got ${value}`);
  return number;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/generate-model-plan.mjs \\
    --input projects/image-structured-modeler/examples/switch-controller/observations.json \\
    --output projects/image-structured-modeler/examples/switch-controller/model-plan.json \\
    --manual-corrections projects/image-structured-modeler/examples/switch-controller/manual-corrections.json
`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
