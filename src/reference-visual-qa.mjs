import { renderOrthographicPreview } from './model-qa.mjs';

const AXIS_INDEX = { x: 0, y: 1, z: 2 };
const DEFAULT_VIEW = { name: 'left', title: 'Left Reference', axes: ['x', 'z'], depthAxis: 'y' };

export function validateReferenceVisualSnapshot(snapshot = {}, options = {}) {
  const spec = normalizeReferenceSpec(options.spec || {});
  const items = visualItems(snapshot);
  const itemIndex = buildItemIndex(items);
  const issues = [];

  validateSilhouetteRules(issues, spec.silhouettes, spec, itemIndex);
  validateKeypointRules(issues, spec.keypoints, spec, itemIndex);
  validateExtentRatioRules(issues, spec.extentRatios, spec, itemIndex);
  validateAreaRatioRules(issues, spec.areaRatios, spec, itemIndex);
  validateRelativePositionRules(issues, spec.relativePositions, spec, itemIndex);
  validateOrientationRules(issues, spec.orientationRules, spec, itemIndex);
  validateFeatureRules(issues, spec.featureRules, itemIndex);

  const preview = options.includePreview === false
    ? null
    : renderReferencePreview(snapshot, spec, items);
  const summary = summarizeIssues(issues, items, preview);

  return {
    kind: 'reference_visual_qa',
    ok: summary.by_severity.error === 0,
    level: reportLevel(summary.by_severity),
    verdict: summary.by_severity.error > 0 ? 'fail' : summary.by_severity.warn > 0 ? 'review' : 'pass',
    summary,
    issues,
    correction_suggestions: correctionSuggestionsForIssues(issues),
    preview
  };
}

export function formatReferenceVisualQaReportMarkdown(report = {}, options = {}) {
  const lines = [];
  lines.push(`# ${options.title || 'SketchUp Reference Visual QA Report'}`);
  lines.push('');
  lines.push(`- Verdict: **${report.verdict || 'unknown'}**`);
  lines.push(`- Level: **${report.level || 'unknown'}**`);
  lines.push(`- OK: **${report.ok === true ? 'true' : 'false'}**`);
  if (report.preview_files?.html) lines.push(`- Preview: \`${report.preview_files.html}\``);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|---|---:|');
  lines.push(`| Checked items | ${report.summary?.checked_items || 0} |`);
  lines.push(`| Total issues | ${report.summary?.total || 0} |`);
  lines.push(`| Errors | ${report.summary?.by_severity?.error || 0} |`);
  lines.push(`| Warnings | ${report.summary?.by_severity?.warn || 0} |`);
  lines.push(`| Info | ${report.summary?.by_severity?.info || 0} |`);
  lines.push('');
  lines.push('## Issues');
  lines.push('');
  if (!report.issues?.length) {
    lines.push('No reference visual issues.');
    lines.push('');
  } else {
    lines.push('| Severity | Type | Rule | Item | Message | Target |');
    lines.push('|---|---|---|---|---|---|');
    for (const issue of report.issues.slice(0, options.issueLimit || 50)) {
      lines.push(`| ${escapeMarkdown(issue.severity)} | \`${escapeMarkdown(issue.type)}\` | ${escapeMarkdown(issue.rule_id || '')} | ${escapeMarkdown(issue.item || '')} | ${escapeMarkdown(issue.message || '')} | \`${escapeMarkdown(issue.correction?.target || '')}\` |`);
    }
    lines.push('');
  }
  lines.push('## Correction Suggestions');
  lines.push('');
  if (!report.correction_suggestions?.length) {
    lines.push('- No correction suggestions.');
  } else {
    for (const suggestion of report.correction_suggestions.slice(0, options.suggestionLimit || 25)) {
      lines.push(`- \`${escapeMarkdown(suggestion.action)}\` ${escapeMarkdown(suggestion.target || '')}: ${escapeMarkdown(suggestion.reason || '')}`);
    }
  }
  lines.push('');
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

function normalizeReferenceSpec(spec) {
  const rules = spec.rules || spec;
  const views = normalizeRuleArray(rules.views || spec.views || [DEFAULT_VIEW]).map((view) => normalizeView(view));
  return {
    title: spec.title || spec.name || 'Reference Visual QA',
    views,
    silhouettes: normalizeRuleArray(rules.silhouettes || rules.silhouette),
    keypoints: normalizeRuleArray(rules.keypoints || rules.keypoint),
    extentRatios: normalizeRuleArray(rules.extent_ratios || rules.extentRatios),
    areaRatios: normalizeRuleArray(rules.area_ratios || rules.areaRatios),
    relativePositions: normalizeRuleArray(rules.relative_positions || rules.relativePositions),
    orientationRules: normalizeRuleArray(rules.orientation || rules.orientation_rules || rules.orientationRules),
    featureRules: normalizeRuleArray(rules.features || rules.feature_rules || rules.featureRules)
  };
}

function validateSilhouetteRules(issues, rules, spec, itemIndex) {
  for (const rule of rules) {
    const view = viewForRule(rule, spec);
    const items = resolveRuleItems(rule, itemIndex);
    if (!items.length) {
      addMissingRuleIssue(issues, 'reference.silhouette_missing_ref', rule, 'Silhouette rule references missing item(s).');
      continue;
    }
    const box = mergeBoxes(items.map((item) => item.bounding_box));
    const bounds = projectedBounds(box, view.axes);
    const actual = safeDivide(bounds.w, bounds.h, 0);
    const expected = numberOption(rule.aspect_ratio ?? rule.aspectRatio ?? rule.reference?.aspect_ratio ?? rule.reference?.aspectRatio, null);
    if (expected === null) continue;
    const relativeDelta = expected === 0 ? Math.abs(actual) : Math.abs(actual - expected) / Math.abs(expected);
    const tolerance = numberOption(rule.tolerance ?? rule.tolerance_ratio ?? rule.toleranceRatio, 0.06);
    if (relativeDelta > tolerance) {
      addIssue(issues, {
        type: 'reference.silhouette_aspect',
        rule,
        item: labelForItems(items),
        message: `${ruleLabel(rule)} aspect ratio is ${round(actual)}, expected ${round(expected)} within ${round(tolerance * 100)}%.`,
        evidence: {
          view: view.name,
          actual_aspect_ratio: round(actual),
          expected_aspect_ratio: round(expected),
          relative_delta: round(relativeDelta)
        },
        correction: correctionForRule(rule, items[0], {
          metric: 'aspect_ratio',
          actual: round(actual),
          expected: round(expected),
          view: view.name
        })
      });
    }
  }
}

function validateKeypointRules(issues, rules, spec, itemIndex) {
  for (const rule of rules) {
    const view = viewForRule(rule, spec);
    const item = firstRuleItem(rule, itemIndex);
    if (!item) {
      addMissingRuleIssue(issues, 'reference.keypoint_missing_ref', rule, 'Keypoint rule references a missing item.');
      continue;
    }
    const frame = frameBoxForRule(rule, view, itemIndex);
    const actual = normalizedPoint(item.bounding_box, view.axes, frame, rule.point || 'center');
    const expected = normalizedExpectedPoint(rule);
    if (!expected) continue;
    const delta = vectorDelta(actual, expected);
    const tolerance = numberOption(rule.tolerance ?? rule.tolerance_norm ?? rule.toleranceNorm, 0.035);
    if (delta.distance > tolerance) {
      addIssue(issues, {
        type: 'reference.keypoint_delta',
        rule,
        item: item.name || item.id,
        message: `${ruleLabel(rule)} ${rule.point || 'center'} is ${round(delta.distance)} normalized units from reference.`,
        evidence: {
          view: view.name,
          point: rule.point || 'center',
          actual,
          expected,
          delta_norm: round(delta.distance),
          delta_mm: round(deltaMm(delta, frame, view.axes))
        },
        correction: correctionForRule(rule, item, {
          metric: 'keypoint',
          point: rule.point || 'center',
          actual,
          expected,
          delta_norm: [round(delta.dx), round(delta.dy)],
          view: view.name
        })
      });
    }
  }
}

function validateAreaRatioRules(issues, rules, spec, itemIndex) {
  for (const rule of rules) {
    const view = viewForRule(rule, spec);
    const items = resolveRuleItems(rule, itemIndex);
    if (!items.length) {
      addMissingRuleIssue(issues, 'reference.area_missing_ref', rule, 'Area-ratio rule references missing item(s).');
      continue;
    }
    const frame = frameBoxForRule(rule, view, itemIndex);
    const box = mergeBoxes(items.map((item) => item.bounding_box));
    const itemBounds = projectedBounds(box, view.axes);
    const frameBounds = projectedBounds(frame, view.axes);
    const actual = safeDivide(itemBounds.w * itemBounds.h, frameBounds.w * frameBounds.h, 0);
    const expected = numberOption(rule.expected ?? rule.ratio ?? rule.reference?.ratio, null);
    if (expected === null) continue;
    const delta = Math.abs(actual - expected);
    const tolerance = numberOption(rule.tolerance ?? rule.tolerance_ratio ?? rule.toleranceRatio, 0.025);
    if (delta > tolerance) {
      addIssue(issues, {
        type: 'reference.area_ratio',
        rule,
        item: labelForItems(items),
        message: `${ruleLabel(rule)} area ratio is ${round(actual)}, expected ${round(expected)} +/- ${round(tolerance)}.`,
        evidence: {
          view: view.name,
          actual_ratio: round(actual),
          expected_ratio: round(expected),
          delta_ratio: round(delta)
        },
        correction: correctionForRule(rule, items[0], {
          metric: 'area_ratio',
          actual: round(actual),
          expected: round(expected),
          view: view.name
        })
      });
    }
  }
}

function validateExtentRatioRules(issues, rules, spec, itemIndex) {
  for (const rule of rules) {
    const view = viewForRule(rule, spec);
    const items = resolveRuleItems(rule, itemIndex);
    if (!items.length) {
      addMissingRuleIssue(issues, 'reference.extent_missing_ref', rule, 'Extent-ratio rule references missing item(s).');
      continue;
    }
    const frame = frameBoxForRule(rule, view, itemIndex);
    const box = mergeBoxes(items.map((item) => item.bounding_box));
    const itemBounds = projectedBounds(box, view.axes);
    const frameBounds = projectedBounds(frame, view.axes);
    const actual = [
      round(safeDivide(itemBounds.w, frameBounds.w, 0)),
      round(safeDivide(itemBounds.h, frameBounds.h, 0))
    ];
    const expected = normalizedExpectedExtent(rule);
    if (!expected) continue;
    const tolerance = normalizedExtentTolerance(rule);
    const delta = [round(Math.abs(actual[0] - expected[0])), round(Math.abs(actual[1] - expected[1]))];
    if (delta[0] > tolerance[0] || delta[1] > tolerance[1]) {
      addIssue(issues, {
        type: 'reference.extent_ratio',
        rule,
        item: labelForItems(items),
        message: `${ruleLabel(rule)} extent is ${actual.join(' x ')} of the frame, expected ${expected.join(' x ')}.`,
        evidence: {
          view: view.name,
          actual_ratio: actual,
          expected_ratio: expected,
          delta_ratio: delta,
          tolerance_ratio: tolerance
        },
        correction: correctionForRule(rule, items[0], {
          metric: 'extent_ratio',
          actual,
          expected,
          view: view.name
        })
      });
    }
  }
}

function validateRelativePositionRules(issues, rules, spec, itemIndex) {
  for (const rule of rules) {
    const view = viewForRule(rule, spec);
    const item = firstRuleItem(rule, itemIndex);
    const anchor = firstRuleItem({ item: rule.anchor || rule.with }, itemIndex);
    if (!item || !anchor) {
      addMissingRuleIssue(issues, 'reference.relative_missing_ref', rule, 'Relative-position rule references missing item(s).');
      continue;
    }
    const frame = frameBoxForRule(rule, view, itemIndex);
    const itemCenter = normalizedPoint(item.bounding_box, view.axes, frame, 'center');
    const anchorCenter = normalizedPoint(anchor.bounding_box, view.axes, frame, 'center');
    const actual = [round(itemCenter[0] - anchorCenter[0]), round(itemCenter[1] - anchorCenter[1])];
    const expected = normalizedExpectedPoint(rule);
    if (!expected) continue;
    const delta = vectorDelta(actual, expected);
    const tolerance = numberOption(rule.tolerance ?? rule.tolerance_norm ?? rule.toleranceNorm, 0.035);
    if (delta.distance > tolerance) {
      addIssue(issues, {
        type: 'reference.relative_position_delta',
        rule,
        item: item.name || item.id,
        message: `${ruleLabel(rule)} relative offset is ${round(delta.distance)} normalized units from reference.`,
        evidence: {
          view: view.name,
          anchor: anchor.name || anchor.id,
          actual_delta: actual,
          expected_delta: expected,
          delta_norm: round(delta.distance)
        },
        correction: correctionForRule(rule, item, {
          metric: 'relative_position',
          actual,
          expected,
          anchor: anchor.qa?.part_id || anchor.id || anchor.name,
          view: view.name
        })
      });
    }
  }
}

function validateOrientationRules(issues, rules, spec, itemIndex) {
  for (const rule of rules) {
    const view = viewForRule(rule, spec);
    const item = firstRuleItem(rule, itemIndex);
    const anchor = firstRuleItem({ item: rule.anchor || rule.with }, itemIndex);
    if (!item || !anchor) {
      addMissingRuleIssue(issues, 'reference.orientation_missing_ref', rule, 'Orientation rule references missing item(s).');
      continue;
    }
    const direction = rule.direction || rule.expected_direction || rule.expectedDirection;
    const descriptor = orientationDescriptor(direction);
    if (!descriptor) {
      addIssue(issues, {
        type: 'reference.orientation_invalid_direction',
        rule,
        item: item.name || item.id,
        message: `${ruleLabel(rule)} uses unsupported orientation direction: ${direction}.`,
        correction: correctionForRule(rule, item, { metric: 'orientation', direction })
      });
      continue;
    }
    const frame = frameBoxForRule(rule, view, itemIndex);
    const itemCenter = normalizedPoint(item.bounding_box, view.axes, frame, 'center');
    const anchorCenter = normalizedPoint(anchor.bounding_box, view.axes, frame, 'center');
    const actualDelta = round(itemCenter[descriptor.axis] - anchorCenter[descriptor.axis]);
    const minDelta = numberOption(rule.min_delta ?? rule.minDelta, 0.01);
    if (descriptor.sign * actualDelta <= minDelta) {
      addIssue(issues, {
        type: 'reference.orientation_order',
        rule,
        item: item.name || item.id,
        message: `${ruleLabel(rule)} expects ${item.name || item.id} to be ${direction} ${anchor.name || anchor.id}, but the signed normalized delta is ${actualDelta}.`,
        evidence: {
          view: view.name,
          item: item.name || item.id,
          anchor: anchor.name || anchor.id,
          direction,
          axis: descriptor.axis === 0 ? 'u' : 'v',
          actual_delta: actualDelta,
          min_delta: minDelta,
          item_center: itemCenter,
          anchor_center: anchorCenter
        },
        correction: correctionForRule(rule, item, {
          metric: 'orientation',
          direction,
          actual_delta: actualDelta,
          min_delta: minDelta,
          anchor: anchor.qa?.part_id || anchor.id || anchor.name,
          view: view.name
        })
      });
    }
  }
}

function validateFeatureRules(issues, rules, itemIndex) {
  for (const rule of rules) {
    const item = firstRuleItem(rule, itemIndex);
    if (!item) {
      addMissingRuleIssue(issues, 'reference.feature_missing_ref', rule, 'Feature rule references a missing item.');
      continue;
    }
    const features = Array.isArray(item.features) ? item.features : [];
    const matches = features.filter((feature) => featureMatchesRule(feature, rule));
    const requiredIds = requiredFeatureIds(rule);
    const missingIds = requiredIds.filter((id) => !features.some((feature) => featureIdForMatch(feature) === id));
    if (missingIds.length) {
      addIssue(issues, {
        type: 'reference.feature_missing',
        rule,
        item: item.name || item.id,
        message: `${ruleLabel(rule)} is missing required feature(s): ${missingIds.join(', ')}.`,
        evidence: {
          required_ids: requiredIds,
          missing_ids: missingIds,
          actual_ids: features.map((feature) => featureIdForMatch(feature)).filter(Boolean)
        },
        correction: correctionForRule(rule, item, {
          metric: 'feature_presence',
          missing_ids: missingIds
        })
      });
    }
    const exactCount = numberOption(rule.count ?? rule.expected_count ?? rule.expectedCount, null);
    const minCount = numberOption(rule.min_count ?? rule.minCount, exactCount);
    const maxCount = numberOption(rule.max_count ?? rule.maxCount, exactCount);
    if (minCount !== null && matches.length < minCount) {
      addFeatureCountIssue(issues, rule, item, matches, features, 'min_count', minCount);
    }
    if (maxCount !== null && matches.length > maxCount) {
      addFeatureCountIssue(issues, rule, item, matches, features, 'max_count', maxCount);
    }
  }
}

function addFeatureCountIssue(issues, rule, item, matches, features, countKind, expected) {
  addIssue(issues, {
    type: 'reference.feature_count',
    rule,
    item: item.name || item.id,
    message: `${ruleLabel(rule)} matched ${matches.length} feature(s), expected ${countKind === 'min_count' ? 'at least' : 'at most'} ${expected}.`,
    evidence: {
      expected,
      actual: matches.length,
      count_kind: countKind,
      op: rule.op || rule.operation || null,
      face: rule.face || null,
      feature_id_pattern: rule.feature_id_pattern || rule.featureIdPattern || rule.id_pattern || rule.idPattern || null,
      matched_ids: matches.map((feature) => featureIdForMatch(feature)).filter(Boolean),
      actual_ids: features.map((feature) => featureIdForMatch(feature)).filter(Boolean)
    },
    correction: correctionForRule(rule, item, {
      metric: 'feature_count',
      expected,
      actual: matches.length,
      count_kind: countKind
    })
  });
}

function renderReferencePreview(snapshot, spec, items) {
  const previewSnapshot = {
    ...snapshot,
    groups: items.filter((item) => item.type === 'group'),
    instances: items.filter((item) => item.type === 'instance'),
    bounding_box: mergeBoxes(items.map((item) => item.bounding_box))
  };
  return renderOrthographicPreview(previewSnapshot, {
    title: spec.title,
    views: spec.views
  });
}

function visualItems(snapshot) {
  return [...(snapshot.groups || []), ...(snapshot.instances || [])]
    .filter((item) => item?.visible !== false && item?.bounding_box)
    .filter((item) => item.qa?.role !== 'reference_image' && item.qa?.fallback_state !== 'reference_only')
    .map((item) => ({
      ...item,
      ref: item.id || item.qa?.part_id || item.name,
      type: item.definition ? 'instance' : 'group'
    }));
}

function buildItemIndex(items) {
  const byRef = new Map();
  for (const item of items) {
    for (const ref of [item.id, item.name, item.qa?.part_id]) {
      if (ref) byRef.set(ref, item);
    }
  }
  return { items, byRef };
}

function resolveRuleItems(rule, itemIndex) {
  const refs = refsFromRule(rule);
  const matches = [];
  for (const ref of refs) {
    if (typeof ref === 'string' && itemIndex.byRef.has(ref)) {
      matches.push(itemIndex.byRef.get(ref));
    } else if (typeof ref === 'string' && looksLikeRegex(ref)) {
      const regex = new RegExp(ref.slice(1, -1));
      matches.push(...itemIndex.items.filter((item) => regex.test(item.name || '') || regex.test(item.id || '') || regex.test(item.qa?.part_id || '')));
    }
  }
  for (const key of ['match', 'part_match', 'partMatch']) {
    if (!rule[key]) continue;
    const regex = new RegExp(rule[key]);
    matches.push(...itemIndex.items.filter((item) => regex.test(item.name || '') || regex.test(item.id || '') || regex.test(item.qa?.part_id || '')));
  }
  return uniqueItems(matches);
}

function firstRuleItem(rule, itemIndex) {
  return resolveRuleItems(rule, itemIndex)[0] || null;
}

function refsFromRule(rule) {
  const value = rule.item ?? rule.items ?? rule.part_id ?? rule.partId;
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function requiredFeatureIds(rule) {
  const value = rule.required_ids ?? rule.requiredIds ?? rule.feature_ids ?? rule.featureIds ?? [];
  return (Array.isArray(value) ? value : [value]).filter(Boolean).map((item) => String(item));
}

function featureMatchesRule(feature, rule) {
  if (rule.op && String(feature.op || feature.operation || '') !== String(rule.op)) return false;
  if (rule.operation && String(feature.op || feature.operation || '') !== String(rule.operation)) return false;
  if (rule.face && String(feature.face || '') !== String(rule.face)) return false;
  if (rule.semantic && String(feature.semantic || '') !== String(rule.semantic)) return false;
  const semanticPattern = rule.semantic_pattern ?? rule.semanticPattern;
  if (semanticPattern && !matchesPattern(feature.semantic || '', semanticPattern)) return false;
  const featureId = featureIdForMatch(feature);
  const explicitId = rule.feature_id ?? rule.featureId;
  if (explicitId && featureId !== String(explicitId)) return false;
  const pattern = rule.feature_id_pattern ?? rule.featureIdPattern ?? rule.id_pattern ?? rule.idPattern;
  if (pattern && !matchesPattern(featureId, pattern)) return false;
  return true;
}

function featureIdForMatch(feature) {
  return String(feature?.id ?? feature?.feature_id ?? feature?.featureId ?? '');
}

function matchesPattern(value, pattern) {
  return new RegExp(String(pattern)).test(String(value || ''));
}

function frameBoxForRule(rule, view, itemIndex) {
  const frame = rule.frame || view.frame;
  const frameItems = frame ? resolveRuleItems(frame, itemIndex) : itemIndex.items;
  if (!frameItems.length) return mergeBoxes(itemIndex.items.map((item) => item.bounding_box));
  return mergeBoxes(frameItems.map((item) => item.bounding_box));
}

function viewForRule(rule, spec) {
  const viewName = rule.view || rule.view_name || rule.viewName;
  if (!viewName) return spec.views[0] || DEFAULT_VIEW;
  return spec.views.find((view) => view.name === viewName) || normalizeView({ name: viewName, axes: rule.axes || ['x', 'z'] });
}

function normalizeView(view) {
  if (typeof view === 'string') {
    if (view === 'top') return { name: 'top', title: 'Top Reference', axes: ['x', 'y'], depthAxis: 'z' };
    if (view === 'front') return { name: 'front', title: 'Front Reference', axes: ['y', 'z'], depthAxis: 'x' };
    if (view === 'right') return { name: 'right', title: 'Right Reference', axes: ['y', 'z'], depthAxis: 'x' };
    return { ...DEFAULT_VIEW, name: view, title: `${view} Reference` };
  }
  const axes = normalizeAxes(view.axes || ['x', 'z']);
  return {
    ...view,
    name: view.name || view.title || 'reference',
    title: view.title || view.name || 'Reference',
    axes,
    depthAxis: view.depthAxis || view.depth_axis || axisNotIn(axes)
  };
}

function normalizeRuleArray(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('reference visual QA rule groups must be arrays');
  return value;
}

function normalizeAxes(axes) {
  if (!Array.isArray(axes) || axes.length !== 2) throw new Error('reference visual QA axes must be a two-item array');
  return axes.map((axis) => {
    if (!Object.hasOwn(AXIS_INDEX, axis)) throw new Error(`Unknown reference visual QA axis: ${axis}`);
    return axis;
  });
}

function axisNotIn(axes) {
  return ['x', 'y', 'z'].find((axis) => !axes.includes(axis)) || 'z';
}

function normalizedExpectedPoint(rule) {
  const value = rule.expected || rule.reference?.point || rule.reference?.delta || rule.delta;
  if (!Array.isArray(value) || value.length !== 2) return null;
  return value.map((item) => Number(item));
}

function normalizedExpectedExtent(rule) {
  const value = rule.expected || rule.reference?.extent || rule.extent;
  if (Array.isArray(value) && value.length === 2) return value.map((item) => Number(item));
  const width = numberOption(rule.width ?? rule.expected_width ?? rule.expectedWidth ?? rule.reference?.width, null);
  const height = numberOption(rule.height ?? rule.expected_height ?? rule.expectedHeight ?? rule.reference?.height, null);
  if (width === null || height === null) return null;
  return [width, height];
}

function normalizedExtentTolerance(rule) {
  const tolerance = rule.tolerance ?? rule.tolerance_ratio ?? rule.toleranceRatio;
  if (Array.isArray(tolerance) && tolerance.length === 2) return tolerance.map((item) => Number(item));
  const width = numberOption(rule.width_tolerance ?? rule.widthTolerance, null);
  const height = numberOption(rule.height_tolerance ?? rule.heightTolerance, null);
  if (width !== null || height !== null) return [width ?? 0.025, height ?? 0.025];
  const scalar = numberOption(tolerance, 0.025);
  return [scalar, scalar];
}

function orientationDescriptor(direction) {
  if (direction === 'right_of') return { axis: 0, sign: 1 };
  if (direction === 'left_of') return { axis: 0, sign: -1 };
  if (direction === 'above') return { axis: 1, sign: 1 };
  if (direction === 'below') return { axis: 1, sign: -1 };
  return null;
}

function normalizedPoint(box, axes, frame, pointName) {
  const projected = projectedBounds(box, axes);
  const frameBounds = projectedBounds(frame, axes);
  const point = pointForProjectedBox(projected, pointName);
  return [
    round(safeDivide(point[0] - frameBounds.min[0], frameBounds.w, 0)),
    round(safeDivide(point[1] - frameBounds.min[1], frameBounds.h, 0))
  ];
}

function pointForProjectedBox(box, pointName) {
  const center = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2];
  if (pointName === 'min' || pointName === 'bottom_left') return [box.min[0], box.min[1]];
  if (pointName === 'max' || pointName === 'top_right') return [box.max[0], box.max[1]];
  if (pointName === 'top_left') return [box.min[0], box.max[1]];
  if (pointName === 'bottom_right') return [box.max[0], box.min[1]];
  return center;
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

function mergeBoxes(boxes) {
  const valid = boxes.filter(Boolean);
  if (!valid.length) return { min: [0, 0, 0], max: [1, 1, 1], w: 1, d: 1, h: 1 };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const box of valid) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], box.min[axis]);
      max[axis] = Math.max(max[axis], box.max[axis]);
    }
  }
  return { min, max, w: max[0] - min[0], d: max[1] - min[1], h: max[2] - min[2] };
}

function correctionForRule(rule, item, evidence) {
  const target = normalizeCorrectionTarget(rule, item);
  if (!target) return null;
  return {
    action: 'update_part_graph',
    target: target.path,
    part_id: target.part_id,
    reason: rule.reason || `Adjust ${target.part_id || item?.qa?.part_id || item?.name || 'part'} to match the reference ${evidence.metric}.`,
    evidence
  };
}

function normalizeCorrectionTarget(rule, item) {
  const raw = rule.correction_target ?? rule.correctionTarget ?? rule.target_path ?? rule.targetPath;
  if (!raw) return null;
  if (typeof raw === 'string') {
    return {
      path: raw,
      part_id: rule.part_id || rule.partId || item?.qa?.part_id || item?.id || null
    };
  }
  return {
    path: raw.path,
    part_id: raw.part_id || raw.partId || rule.part_id || rule.partId || item?.qa?.part_id || item?.id || null
  };
}

function addMissingRuleIssue(issues, type, rule, message) {
  addIssue(issues, {
    type,
    rule,
    item: refsFromRule(rule).join(', '),
    message,
    correction: correctionForRule(rule, null, { metric: 'missing_reference' })
  });
}

function addIssue(issues, issue) {
  issues.push({
    severity: issue.rule?.severity || issue.severity || 'error',
    type: issue.type,
    rule_id: issue.rule?.id || null,
    item: issue.item || null,
    message: issue.message,
    suggestion: issue.rule?.suggestion || null,
    evidence: issue.evidence || null,
    correction: issue.correction || null
  });
}

function correctionSuggestionsForIssues(issues) {
  return issues
    .filter((issue) => issue.correction)
    .map((issue) => ({
      ...issue.correction,
      reason: issue.correction.reason || issue.message,
      issue_type: issue.type,
      rule_id: issue.rule_id,
      severity: issue.severity
    }));
}

function summarizeIssues(issues, items, preview) {
  const bySeverity = { error: 0, warn: 0, info: 0 };
  const byType = {};
  for (const issue of issues) {
    bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
    byType[issue.type] = (byType[issue.type] || 0) + 1;
  }
  return {
    total: issues.length,
    by_severity: bySeverity,
    by_type: byType,
    checked_items: items.length,
    preview_views: preview?.views?.length || 0
  };
}

function reportLevel(bySeverity) {
  if (bySeverity.error > 0) return 'error';
  if (bySeverity.warn > 0) return 'warn';
  if (bySeverity.info > 0) return 'info';
  return 'ok';
}

function vectorDelta(actual, expected) {
  const dx = actual[0] - expected[0];
  const dy = actual[1] - expected[1];
  return { dx, dy, distance: Math.hypot(dx, dy) };
}

function deltaMm(delta, frame, axes) {
  const bounds = projectedBounds(frame, axes);
  return Math.hypot(delta.dx * bounds.w, delta.dy * bounds.h);
}

function ruleLabel(rule) {
  return rule.label || rule.id || 'reference rule';
}

function labelForItems(items) {
  return items.map((item) => item.name || item.id).join(', ');
}

function uniqueItems(items) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = item.id || item.qa?.part_id || item.name;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function looksLikeRegex(value) {
  return value.length > 2 && value.startsWith('/') && value.endsWith('/');
}

function numberOption(value, fallback) {
  const number = value === undefined || value === null ? fallback : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeDivide(numerator, denominator, fallback) {
  return denominator === 0 ? fallback : numerator / denominator;
}

function round(value) {
  return Number(value.toFixed(3));
}

function escapeMarkdown(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}
