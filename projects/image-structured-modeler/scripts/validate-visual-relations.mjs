#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SketchUpBridge } from '../../../src/bridge.mjs';
import { repoRoot } from './lib/image-analysis.mjs';

const AXIS_INDEX = { x: 0, y: 1, z: 2 };

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await validateVisualRelations({
    observations: await readJson(options.observations || 'projects/image-structured-modeler/examples/switch-controller/observations.json'),
    fixture: await readJson(options.fixture || 'projects/image-structured-modeler/examples/switch-controller/visual-relations.fixture.json'),
    code: await fs.readFile(resolveRepo(options.code || 'examples/acceptance-switch-controller.json'), 'utf8'),
    runtime: options.runtime || 'mock',
    timeoutMs: options.timeoutMs,
    mockSessionPath: options.mockSessionPath || 'output/image-structured-modeler/sessions/visual-relation-qa-mock-session.json'
  });

  if (options.output) {
    const output = resolveRepo(options.output);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  process.stdout.write(`${JSON.stringify({
    ok: report.ok,
    verdict: report.verdict,
    checked_relations: report.summary.checked_relations,
    checked_footprints: report.summary.checked_footprints,
    issues: report.summary.total_issues,
    negative_cases: report.summary.negative_cases_checked
  }, null, 2)}\n`);
  if (!report.ok) process.exit(1);
}

export async function validateVisualRelations({ observations, fixture, code, runtime = 'mock', timeoutMs = null, mockSessionPath } = {}) {
  if (!observations?.visual_relation_graph) throw new Error('visual relation QA requires observations.visual_relation_graph');
  if (!fixture?.required_relations?.length && !fixture?.footprint_rules?.length) {
    throw new Error('visual relation QA requires fixture.required_relations or fixture.footprint_rules');
  }
  const bridge = new SketchUpBridge({ mock: { sessionPath: resolveRepo(mockSessionPath || 'output/image-structured-modeler/sessions/visual-relation-qa-mock-session.json') } });
  const { snapshot } = await bridge.build_model({ runtime, code, timeoutMs });
  const modelContext = makeModelContext(snapshot, fixture);
  const relationResults = [];
  const footprintResults = [];
  const issues = [];

  for (const rule of fixture.required_relations || []) {
    const imageRelation = findImageRelation(observations.visual_relation_graph.relations || [], fixture, rule);
    if (!imageRelation) {
      issues.push(issue('visual_relation.image_missing', rule, `Missing image-space relation candidate for ${rule.item} ${rule.type} ${rule.anchor}.`));
      relationResults.push({ id: rule.id, ok: false, image_relation: null, model_relation: null });
      continue;
    }
    if (imageRelation.confidence < (rule.min_confidence ?? 0.4)) {
      issues.push(issue('visual_relation.image_low_confidence', rule, `Image-space relation ${rule.id} confidence ${imageRelation.confidence} is below ${rule.min_confidence}.`, { confidence: imageRelation.confidence }));
    }
    if (rule.image_only === true || rule.mode === 'image_only') {
      relationResults.push({
        id: rule.id,
        ok: imageRelation.confidence >= (rule.min_confidence ?? 0.4),
        image_relation: compactImageRelation(imageRelation),
        model_relation: {
          skipped: true,
          reason: 'image_only relation candidate; no model projection item is expected in this slice.'
        }
      });
      continue;
    }

    const modelRelation = evaluateModelRelation(modelContext, fixture, rule);
    if (!modelRelation.ok) {
      issues.push(issue('visual_relation.model_relation_mismatch', rule, modelRelation.message, modelRelation.evidence));
    }
    const spacingIssue = spacingIssueFor(rule, imageRelation, modelRelation);
    if (spacingIssue) issues.push(spacingIssue);

    relationResults.push({
      id: rule.id,
      ok: modelRelation.ok && !spacingIssue && imageRelation.confidence >= (rule.min_confidence ?? 0.4),
      image_relation: compactImageRelation(imageRelation),
      model_relation: modelRelation
    });
  }

  for (const rule of fixture.footprint_rules || []) {
    const result = evaluateFootprintRule(observations, modelContext, fixture, rule);
    footprintResults.push(result);
    if (!result.ok) {
      issues.push(issue('visual_grounding.footprint_delta', rule, result.message, result.evidence, result.severity || 'error'));
    }
  }

  const negativeResults = [];
  for (const negativeCase of fixture.negative_cases || []) {
    const result = evaluateNegativeCase(modelContext, fixture, negativeCase);
    negativeResults.push(result);
    if (!result.ok) {
      issues.push(issue('visual_relation.negative_case_not_detected', negativeCase, `Negative case ${negativeCase.id} did not fail required relation QA.`, result));
    }
  }

  const bySeverity = countBy(issues, 'severity');
  const summary = {
    checked_relations: (fixture.required_relations || []).length,
    checked_footprints: footprintResults.length,
    matched_image_relations: relationResults.filter((result) => result.image_relation).length,
    matched_model_relations: relationResults.filter((result) => result.model_relation?.ok).length,
    matched_footprints: footprintResults.filter((result) => result.ok).length,
    image_only_relations: relationResults.filter((result) => result.model_relation?.skipped).length,
    negative_cases_checked: negativeResults.length,
    negative_cases_detected: negativeResults.filter((result) => result.ok).length,
    total_issues: issues.length,
    by_severity: {
      error: bySeverity.error || 0,
      warn: bySeverity.warn || 0,
      info: bySeverity.info || 0
    }
  };

  return {
    kind: 'visual_relation_qa',
    version: 1,
    ok: summary.by_severity.error === 0,
    verdict: summary.by_severity.error > 0 ? 'fail' : summary.by_severity.warn > 0 ? 'review' : 'pass',
    fixture: fixture.id || fixture.name,
    summary,
    issues,
    relation_results: relationResults,
    footprint_results: footprintResults,
    negative_results: negativeResults
  };
}

function makeModelContext(snapshot, fixture) {
  const items = [...(snapshot.groups || []), ...(snapshot.instances || [])].filter((item) => item.bounding_box);
  const axes = normalizeAxes(fixture.model?.axes || ['x', 'y']);
  const frame = frameBox(items, fixture.model?.frame_items || fixture.model?.frameItems || []);
  return { items, axes, frame };
}

function findImageRelation(relations, fixture, rule) {
  const itemAliases = aliasSet(fixture.aliases?.image, rule.item);
  const anchorAliases = aliasSet(fixture.aliases?.image, rule.anchor);
  return relations.find((relation) => relationMatches(relation, rule, itemAliases, anchorAliases))
    || relations.find((relation) => reverseRelationMatches(relation, rule, itemAliases, anchorAliases));
}

function relationMatches(relation, rule, itemAliases, anchorAliases) {
  return relation.type === rule.type
    && (!rule.image_view || relation.view === rule.image_view)
    && itemAliases.has(relation.item)
    && anchorAliases.has(relation.anchor);
}

function reverseRelationMatches(relation, rule, itemAliases, anchorAliases) {
  if (!['same_row', 'aligned_with', 'touching', 'mirrored_pair', 'centered_on'].includes(rule.type)) return false;
  return relation.type === rule.type
    && (!rule.image_view || relation.view === rule.image_view)
    && itemAliases.has(relation.anchor)
    && anchorAliases.has(relation.item);
}

function evaluateModelRelation(context, fixture, rule, overrideItems = null) {
  const items = overrideItems || context.items;
  const item = findModelItem(items, fixture, rule.item);
  const anchor = findModelItem(items, fixture, rule.anchor);
  if (!item || !anchor) {
    return {
      ok: false,
      message: `Missing model item(s) for ${rule.item} ${rule.type} ${rule.anchor}.`,
      evidence: { item_found: Boolean(item), anchor_found: Boolean(anchor) }
    };
  }
  const axes = normalizeAxes(rule.model_axes || rule.modelAxes || fixture.model?.axes || context.axes);
  const frame = context.frame;
  const itemBox = projectedBounds(item.bounding_box, axes);
  const anchorBox = projectedBounds(anchor.bounding_box, axes);
  const itemCenter = normalizedCenter(item.bounding_box, axes, frame);
  const anchorCenter = normalizedCenter(anchor.bounding_box, axes, frame);
  const delta = [round(itemCenter[0] - anchorCenter[0]), round(itemCenter[1] - anchorCenter[1])];
  const minDelta = rule.min_model_delta ?? rule.min_delta ?? 0.02;
  const tolerance = rule.model_tolerance ?? rule.tolerance ?? 0.055;
  const ok = relationSatisfied(rule.type, { itemBox, anchorBox, delta, minDelta, tolerance, frame });
  return {
    ok,
    type: rule.type,
    item: item.id || item.name,
    anchor: anchor.id || anchor.name,
    delta_norm: delta,
    min_delta: minDelta,
    tolerance,
    message: ok
      ? `${rule.item} ${rule.type} ${rule.anchor} is satisfied in model projection.`
      : `${rule.item} is not ${rule.type} ${rule.anchor} in model projection.`,
    evidence: {
      item: item.id || item.name,
      anchor: anchor.id || anchor.name,
      model_axes: axes,
      item_center: itemCenter,
      anchor_center: anchorCenter,
      delta_norm: delta
    }
  };
}

function evaluateFootprintRule(observations, context, fixture, rule) {
  const item = findModelItem(context.items, fixture, rule.item);
  if (!item) {
    return {
      ok: false,
      message: `Missing model item for footprint rule ${rule.id}.`,
      evidence: { item_found: false }
    };
  }
  const imageMatch = findImageFootprint(observations, fixture, rule);
  if (!imageMatch?.observation || !imageMatch?.frame) {
    return {
      ok: false,
      message: `Missing image footprint evidence for ${rule.item}.`,
      evidence: {
        image_view: rule.image_view || 'top',
        requires_grounding: rule.require_grounding || null
      }
    };
  }
  const requiredGrounding = rule.require_grounding || rule.requireGrounding;
  const groundingMethod = imageMatch.observation.grounding?.method || null;
  if (requiredGrounding && groundingMethod !== requiredGrounding) {
    return {
      ok: false,
      message: `${rule.id} uses ${groundingMethod || 'ungrounded'} image evidence instead of ${requiredGrounding}.`,
      evidence: {
        observation_id: imageMatch.observation.id,
        grounding_method: groundingMethod,
        required_grounding: requiredGrounding,
        note: imageMatch.observation.note || null
      }
    };
  }

  const axes = normalizeAxes(rule.model_axes || rule.modelAxes || fixture.model?.axes || context.axes);
  const frame = frameBox(context.items, rule.model_frame_items || rule.modelFrameItems || fixture.model?.frame_items || fixture.model?.frameItems || []);
  const modelBox = normalizedProjectedBox(item.bounding_box, axes, frame);
  const imageBox = normalizedImageBox(imageMatch.observation.bbox, imageMatch.frame.bbox);
  const centerDelta = [
    round(Math.abs(modelBox.center[0] - imageBox.center[0])),
    round(Math.abs(modelBox.center[1] - imageBox.center[1]))
  ];
  const extentDelta = [
    round(Math.abs(modelBox.extent[0] - imageBox.extent[0])),
    round(Math.abs(modelBox.extent[1] - imageBox.extent[1]))
  ];
  const centerTolerance = rule.center_tolerance ?? rule.centerTolerance ?? rule.tolerance ?? 0.035;
  const extentTolerance = rule.extent_tolerance ?? rule.extentTolerance ?? rule.tolerance ?? 0.045;
  const extentTol = Array.isArray(extentTolerance) ? extentTolerance : [extentTolerance, extentTolerance];
  const ok = centerDelta[0] <= centerTolerance
    && centerDelta[1] <= centerTolerance
    && extentDelta[0] <= extentTol[0]
    && extentDelta[1] <= extentTol[1];
  return {
    id: rule.id,
    ok,
    item: item.id || item.name,
    observation_id: imageMatch.observation.id,
    grounding_method: groundingMethod,
    image_view: imageMatch.image.detected_view?.kind,
    message: ok
      ? `${rule.item} model footprint matches image footprint.`
      : `${rule.item} model footprint diverges from image footprint.`,
    evidence: {
      model_box: modelBox,
      image_box: imageBox,
      center_delta: centerDelta,
      extent_delta: extentDelta,
      center_tolerance: centerTolerance,
      extent_tolerance: extentTol,
      observation_id: imageMatch.observation.id,
      grounding: imageMatch.observation.grounding || null
    }
  };
}

function relationSatisfied(type, { itemBox, anchorBox, delta, minDelta, tolerance, frame }) {
  if (type === 'right_of') return delta[0] > minDelta;
  if (type === 'left_of') return delta[0] < -minDelta;
  if (type === 'above') return delta[1] > minDelta;
  if (type === 'below') return delta[1] < -minDelta;
  if (type === 'same_row') return Math.abs(delta[1]) <= tolerance && Math.abs(delta[0]) >= minDelta;
  if (type === 'aligned_with') return Math.abs(delta[0]) <= tolerance || Math.abs(delta[1]) <= tolerance;
  if (type === 'centered_on') return Math.abs(delta[0]) <= tolerance && Math.abs(delta[1]) <= (tolerance * 1.6);
  if (type === 'inside') return containsProjected(anchorBox, itemBox, tolerance * frameExtent(frame));
  if (type === 'touching') return projectedTouching(itemBox, anchorBox, frame, tolerance);
  if (type === 'mirrored_pair') return projectedMirroredPair(itemBox, anchorBox, frame, tolerance);
  return false;
}

function spacingIssueFor(rule, imageRelation, modelRelation) {
  const tolerance = rule.spacing_tolerance ?? rule.spacingTolerance;
  if (!tolerance || !modelRelation.ok) return null;
  const expected = rule.expected_model_delta || imageRelation.basis?.delta_norm?.map((value) => Math.abs(value));
  if (!Array.isArray(expected) || expected.length !== 2) return null;
  const actual = modelRelation.delta_norm.map((value) => Math.abs(value));
  const delta = [round(Math.abs(actual[0] - expected[0])), round(Math.abs(actual[1] - expected[1]))];
  if (delta[0] <= tolerance && delta[1] <= tolerance) return null;
  return issue('visual_relation.spacing_delta', rule, `Projected spacing for ${rule.id} diverges from image evidence.`, {
    expected_abs_delta: expected,
    actual_abs_delta: actual,
    delta,
    tolerance
  }, rule.spacing_severity || 'error');
}

function evaluateNegativeCase(context, fixture, negativeCase) {
  const transformed = transformItems(context.items, context.frame, normalizeAxes(negativeCase.model_axes || fixture.model?.axes || context.axes), negativeCase.transform);
  const ruleIds = new Set(negativeCase.rule_ids || negativeCase.ruleIds || []);
  const rules = fixture.required_relations.filter((rule) => ruleIds.size === 0 ? rule.mirror_negative : ruleIds.has(rule.id));
  const evaluations = rules.map((rule) => evaluateModelRelation(context, fixture, rule, transformed));
  const failedCount = evaluations.filter((result) => !result.ok).length;
  return {
    id: negativeCase.id,
    transform: negativeCase.transform,
    checked_rules: rules.map((rule) => rule.id),
    failed_rules: evaluations.filter((result) => !result.ok).map((result, index) => rules[index]?.id).filter(Boolean),
    ok: failedCount >= (negativeCase.min_failed_rules ?? 1),
    evaluations
  };
}

function transformItems(items, frame, axes, transform) {
  if (transform !== 'mirror_x') return items;
  const axisIndex = AXIS_INDEX[axes[0]];
  const center = (frame.min[axisIndex] + frame.max[axisIndex]) / 2;
  return items.map((item) => ({
    ...item,
    bounding_box: mirrorBox(item.bounding_box, axisIndex, center)
  }));
}

function mirrorBox(box, axisIndex, center) {
  const min = [...box.min];
  const max = [...box.max];
  const nextMin = [...min];
  const nextMax = [...max];
  nextMin[axisIndex] = round(center - (max[axisIndex] - center));
  nextMax[axisIndex] = round(center - (min[axisIndex] - center));
  return {
    ...box,
    min: nextMin,
    max: nextMax,
    w: nextMax[0] - nextMin[0],
    d: nextMax[1] - nextMin[1],
    h: nextMax[2] - nextMin[2]
  };
}

function findImageFootprint(observations, fixture, rule) {
  const imageView = rule.image_view || 'top';
  const image = (observations.images || []).find((candidate) => candidate.detected_view?.kind === imageView);
  if (!image) return null;
  const aliases = aliasSet(fixture.aliases?.image, rule.item);
  const candidates = (image.observations || [])
    .filter((observation) => observation.bbox && aliases.has(observation.component_hint))
    .sort((a, b) => imageObservationScore(b) - imageObservationScore(a));
  const frameAliases = aliasSet(fixture.aliases?.image, rule.image_frame || rule.imageFrame || 'site');
  const frame = (image.observations || [])
    .filter((observation) => observation.bbox && frameAliases.has(observation.component_hint))
    .sort((a, b) => imageObservationScore(b) - imageObservationScore(a))[0];
  return { image, observation: candidates[0], frame };
}

function imageObservationScore(observation) {
  let score = Number(observation.confidence) || 0;
  if (/^pixel_/i.test(observation.grounding?.method || '')) score += 10;
  if (observation.grounding?.method === 'layout_prior' || /template|layout|prior/i.test(observation.note || '')) score -= 5;
  return score;
}

function findModelItem(items, fixture, key) {
  const aliases = aliasSet(fixture.aliases?.model, key);
  return items.find((item) => aliases.has(item.id) || aliases.has(item.name) || aliases.has(item.qa?.part_id));
}

function aliasSet(aliasRoot = {}, key) {
  const aliases = new Set([key]);
  for (const value of aliasRoot[key] || []) aliases.add(value);
  return aliases;
}

function compactImageRelation(relation) {
  return {
    id: relation.id,
    type: relation.type,
    item: relation.item,
    anchor: relation.anchor,
    source_image: relation.source_image,
    view: relation.view,
    confidence: relation.confidence,
    review_required: relation.review_required,
    basis: relation.basis
  };
}

function frameBox(items, frameRefs) {
  const refs = new Set(frameRefs);
  const selected = refs.size
    ? items.filter((item) => refs.has(item.id) || refs.has(item.name) || refs.has(item.qa?.part_id))
    : items;
  const boxes = (selected.length ? selected : items).map((item) => item.bounding_box).filter(Boolean);
  return mergeBoxes(boxes);
}

function projectedBounds(box, axes) {
  const first = AXIS_INDEX[axes[0]];
  const second = AXIS_INDEX[axes[1]];
  return {
    min: [box.min[first], box.min[second]],
    max: [box.max[first], box.max[second]],
    w: box.max[first] - box.min[first],
    h: box.max[second] - box.min[second]
  };
}

function normalizedCenter(box, axes, frame) {
  const projected = projectedBounds(box, axes);
  const frameBounds = projectedBounds(frame, axes);
  return [
    round(((projected.min[0] + projected.max[0]) / 2 - frameBounds.min[0]) / Math.max(1, frameBounds.w)),
    round(((projected.min[1] + projected.max[1]) / 2 - frameBounds.min[1]) / Math.max(1, frameBounds.h))
  ];
}

function normalizedProjectedBox(box, axes, frame) {
  const projected = projectedBounds(box, axes);
  const frameBounds = projectedBounds(frame, axes);
  const min = [
    round((projected.min[0] - frameBounds.min[0]) / Math.max(1, frameBounds.w)),
    round((projected.min[1] - frameBounds.min[1]) / Math.max(1, frameBounds.h))
  ];
  const max = [
    round((projected.max[0] - frameBounds.min[0]) / Math.max(1, frameBounds.w)),
    round((projected.max[1] - frameBounds.min[1]) / Math.max(1, frameBounds.h))
  ];
  return {
    min,
    max,
    center: [round((min[0] + max[0]) / 2), round((min[1] + max[1]) / 2)],
    extent: [round(max[0] - min[0]), round(max[1] - min[1])]
  };
}

function normalizedImageBox(bbox, frameBbox) {
  const minU = (bbox[0] - frameBbox[0]) / Math.max(1, frameBbox[2]);
  const maxU = (bbox[0] + bbox[2] - frameBbox[0]) / Math.max(1, frameBbox[2]);
  const minV = 1 - ((bbox[1] + bbox[3] - frameBbox[1]) / Math.max(1, frameBbox[3]));
  const maxV = 1 - ((bbox[1] - frameBbox[1]) / Math.max(1, frameBbox[3]));
  return {
    min: [round(minU), round(minV)],
    max: [round(maxU), round(maxV)],
    center: [round((minU + maxU) / 2), round((minV + maxV) / 2)],
    extent: [round(maxU - minU), round(maxV - minV)]
  };
}

function containsProjected(outer, inner, tolerance) {
  return inner.min[0] >= outer.min[0] - tolerance
    && inner.max[0] <= outer.max[0] + tolerance
    && inner.min[1] >= outer.min[1] - tolerance
    && inner.max[1] <= outer.max[1] + tolerance;
}

function projectedTouching(a, b, frame, tolerance) {
  const gapX = Math.max(0, Math.max(b.min[0] - a.max[0], a.min[0] - b.max[0]));
  const gapY = Math.max(0, Math.max(b.min[1] - a.max[1], a.min[1] - b.max[1]));
  return gapX / Math.max(1, frame.w || 1) <= tolerance || gapY / Math.max(1, frame.d || frame.h || 1) <= tolerance;
}

function frameExtent(frame) {
  return Math.max(1, Math.abs(frame.w || 0), Math.abs(frame.d || 0), Math.abs(frame.h || 0));
}

function projectedMirroredPair(a, b, frame, tolerance) {
  const frameBounds = projectedBounds(frame, ['x', 'y']);
  const centerX = (frameBounds.min[0] + frameBounds.max[0]) / 2;
  const aCenter = (a.min[0] + a.max[0]) / 2;
  const bCenter = (b.min[0] + b.max[0]) / 2;
  const rowError = Math.abs((a.min[1] + a.max[1]) / 2 - (b.min[1] + b.max[1]) / 2) / Math.max(1, frameBounds.h);
  const mirrorError = Math.abs((aCenter + bCenter) / 2 - centerX) / Math.max(1, frameBounds.w);
  return mirrorError <= tolerance && rowError <= tolerance * 1.5;
}

function mergeBoxes(boxes) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], box.min[axis]);
      max[axis] = Math.max(max[axis], box.max[axis]);
    }
  }
  return { min, max, w: max[0] - min[0], d: max[1] - min[1], h: max[2] - min[2] };
}

function normalizeAxes(axes) {
  return axes.map((axis) => {
    if (!Object.hasOwn(AXIS_INDEX, axis)) throw new Error(`Unknown model projection axis: ${axis}`);
    return axis;
  });
}

function issue(type, rule, message, evidence = null, severity = 'error') {
  return {
    severity: rule.severity || severity,
    type,
    rule_id: rule.id,
    message,
    evidence
  };
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(resolveRepo(relativePath), 'utf8'));
}

function resolveRepo(relativePath) {
  return path.resolve(repoRoot, relativePath);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--observations') options.observations = argv[++index];
    else if (arg === '--fixture') options.fixture = argv[++index];
    else if (arg === '--code') options.code = argv[++index];
    else if (arg === '--runtime') options.runtime = argv[++index];
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--mock-session-path') options.mockSessionPath = argv[++index];
    else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/validate-visual-relations.mjs \\
    --observations projects/image-structured-modeler/examples/switch-controller/observations.json \\
    --fixture projects/image-structured-modeler/examples/switch-controller/visual-relations.fixture.json \\
    --code examples/acceptance-switch-controller.json \\
    --output projects/image-structured-modeler/examples/switch-controller/visual-relation-qa/report.json
`);
}

function countBy(items, key) {
  const result = {};
  for (const item of items || []) {
    const value = item[key] || 'unknown';
    result[value] = (result[value] || 0) + 1;
  }
  return result;
}

function round(value) {
  return Number(Number(value || 0).toFixed(3));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
