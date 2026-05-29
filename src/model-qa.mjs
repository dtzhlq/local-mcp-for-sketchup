const AXIS_INDEX = { x: 0, y: 1, z: 2 };
const DEFAULT_VIEWS = [
  { name: 'top', axes: ['x', 'y'], depthAxis: 'z', title: 'Top' },
  { name: 'front', axes: ['x', 'z'], depthAxis: 'y', title: 'Front' },
  { name: 'right', axes: ['y', 'z'], depthAxis: 'x', title: 'Right' }
];
const DEFAULT_PREVIEW_SIZE = { width: 960, height: 640, padding: 44 };
const DETAIL_ROLE_PATTERN = /(button|control|stick|thumb|screw|light|lamp|window|door|mirror|handle|label|text|decal|rib|rail|shelf|book|toy|wheel|tire|hub|bumper|stripe|sticker|peg|knob|slot|seam|panel|grille)/i;

export function validateModelSnapshot(snapshot = {}, options = {}) {
  const spec = normalizeSpec(options.spec || {});
  const items = visibleItems(snapshot);
  const itemIndex = buildItemIndex(items);
  const expectedPairs = expectedContactPairs(items, spec, itemIndex);
  const issues = [];

  validateSnapshotWarnings(issues, snapshot, expectedPairs, options);
  validateContactRules(issues, spec.contacts, itemIndex);
  validateInsideRules(issues, spec.inside, itemIndex);
  validateSupportRules(issues, spec.support, itemIndex);
  validateSeparationRules(issues, spec.separation, itemIndex);
  validateFloatingDetails(issues, items, itemIndex, expectedPairs, spec, options);

  const preview = options.includePreview === false
    ? null
    : renderOrthographicPreview(snapshot, { views: spec.views, title: spec.title || options.title });
  const correctionSuggestions = correctionSuggestionsForIssues(issues);
  const summary = summarizeIssues(issues, items, preview);

  return {
    kind: 'model_qa',
    ok: summary.by_severity.error === 0,
    level: reportLevel(summary.by_severity),
    verdict: summary.by_severity.error > 0 ? 'fail' : summary.by_severity.warn > 0 ? 'review' : 'pass',
    summary,
    issues,
    correction_suggestions: correctionSuggestions,
    preview
  };
}

export function renderOrthographicPreview(snapshot = {}, options = {}) {
  const items = visibleItems(snapshot);
  const views = (options.views?.length ? options.views : DEFAULT_VIEWS).map((view) => normalizeView(view));
  const modelBox = snapshot.bounding_box || mergeBoxes(items.map((item) => item.bounding_box));
  const rendered = views.map((view) => renderViewSvg({
    view,
    items,
    modelBox,
    title: options.title || 'Model QA Preview',
    size: options.size || DEFAULT_PREVIEW_SIZE
  }));
  return {
    kind: 'orthographic_preview',
    views: rendered,
    html: renderPreviewHtml(rendered, { title: options.title || 'Model QA Preview' })
  };
}

export function formatModelQaReportMarkdown(report = {}, options = {}) {
  const lines = [];
  lines.push(`# ${options.title || 'SketchUp Model QA Report'}`);
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
  lines.push(`| Visible items | ${report.summary?.visible_items || 0} |`);
  lines.push(`| Total issues | ${report.summary?.total || 0} |`);
  lines.push(`| Errors | ${report.summary?.by_severity?.error || 0} |`);
  lines.push(`| Warnings | ${report.summary?.by_severity?.warn || 0} |`);
  lines.push(`| Info | ${report.summary?.by_severity?.info || 0} |`);
  lines.push('');

  lines.push('## Issues');
  lines.push('');
  if (!report.issues?.length) {
    lines.push('No layout issues.');
    lines.push('');
  } else {
    lines.push('| Severity | Type | Item | Message | Suggestion |');
    lines.push('|---|---|---|---|---|');
    for (const issue of report.issues.slice(0, options.issueLimit || 50)) {
      lines.push(`| ${escapeMarkdown(issue.severity)} | \`${escapeMarkdown(issue.type)}\` | ${escapeMarkdown(issue.item || '')} | ${escapeMarkdown(issue.message || '')} | ${escapeMarkdown(issue.suggestion || '')} |`);
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

  if (report.preview_files?.views?.length) {
    lines.push('## Preview Files');
    lines.push('');
    for (const file of report.preview_files.views) {
      lines.push(`- ${escapeMarkdown(file.name)}: \`${escapeMarkdown(file.path)}\``);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

export function formatModelQaPreviewHtml(reportOrPreview = {}, options = {}) {
  const preview = reportOrPreview.preview || reportOrPreview;
  if (preview?.html) return preview.html;
  return renderPreviewHtml(preview?.views || [], { title: options.title || 'Model QA Preview' });
}

function normalizeSpec(spec) {
  const rules = spec.rules || spec;
  return {
    title: spec.title || spec.name || 'Model QA',
    contacts: normalizeRuleArray(rules.contacts || rules.expected_contacts),
    allowed_collisions: normalizeRuleArray(rules.allowed_collisions || rules.allowedCollisions),
    inside: normalizeRuleArray(rules.inside || rules.regions),
    support: normalizeRuleArray(rules.support || rules.anchors),
    separation: normalizeRuleArray(rules.separation || rules.separations),
    views: normalizeRuleArray(rules.views || spec.views)
  };
}

function normalizeRuleArray(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('model QA spec rule groups must be arrays');
  return value;
}

function visibleItems(snapshot) {
  return [...(snapshot.groups || []), ...(snapshot.instances || [])]
    .filter((item) => item?.visible !== false && item?.bounding_box)
    .map((item) => ({
      ...item,
      ref: item.id || item.name,
      type: item.definition ? 'instance' : 'group'
    }));
}

function buildItemIndex(items) {
  const index = new Map();
  for (const item of items) {
    if (item.id) index.set(item.id, item);
    if (item.name) index.set(item.name, item);
  }
  return { items, byRef: index };
}

function expectedContactPairs(items, spec, itemIndex) {
  const pairs = new Set();
  for (const item of items) {
    for (const contact of item.qa?.expected_contacts || []) {
      pairs.add(pairKey(item.name, contact.with));
      pairs.add(pairKey(item.id, contact.with));
    }
  }
  for (const rule of spec.contacts || []) {
    addResolvedPairs(pairs, rule, itemIndex);
  }
  for (const rule of spec.allowed_collisions || []) {
    addResolvedPairs(pairs, rule, itemIndex);
  }
  return pairs;
}

function addResolvedPairs(pairs, rule, itemIndex) {
  for (const item of resolveItems(rule, 'item', itemIndex)) {
    for (const target of resolveItems(rule, 'with', itemIndex)) {
      pairs.add(pairKey(item.name, target.name));
      pairs.add(pairKey(item.id, target.id));
      pairs.add(pairKey(item.name, target.id));
      pairs.add(pairKey(item.id, target.name));
    }
  }
}

function validateSnapshotWarnings(issues, snapshot, expectedPairs, options) {
  for (const warning of snapshot.warnings || []) {
    if (warning.severity === 'info') continue;
    if (warning.type === 'geometry.bbox_collision' || warning.type === 'geometry.bbox_overlap') {
      const [left, right] = warningPairRefs(warning);
      if (left && right && expectedPairs.has(pairKey(left, right))) continue;
      addIssue(issues, {
        type: 'layout.unexpected_collision',
        severity: options.strictCollisions === false ? 'warn' : 'error',
        item: left && right ? `${left} / ${right}` : undefined,
        message: warning.message || 'Unclassified bounding-box collision.',
        evidence: { warning },
        suggestion: 'Add an expected contact only if this is intentional; otherwise resize or move one of the parts.'
      });
      continue;
    }
    if (warning.category !== 'geometry' && options.includeRuntimeWarnings !== true) continue;
    addIssue(issues, {
      type: 'snapshot.warning',
      severity: warning.severity === 'error' ? 'error' : 'warn',
      item: warning.source || undefined,
      message: warning.message || warning.type,
      evidence: { warning },
      suggestion: 'Resolve the runtime warning before accepting the model.'
    });
  }
}

function validateContactRules(issues, rules, itemIndex) {
  for (const rule of rules) {
    const items = resolveItems(rule, 'item', itemIndex);
    const targets = resolveItems(rule, 'with', itemIndex);
    if (!items.length || !targets.length) {
      addMissingRuleIssue(issues, 'layout.contact_missing_ref', rule, 'Expected contact rule references missing item(s).');
      continue;
    }
    for (const item of items) {
      for (const target of targets) {
        const distance = boxDistance(item.bounding_box, target.bounding_box);
        const tolerance = numberOption(rule.tolerance_mm ?? rule.toleranceMm, 2);
        if (distance > tolerance) {
          addIssue(issues, {
            type: 'layout.expected_contact_gap',
            severity: rule.severity || 'error',
            item: item.name,
            message: `${item.name} should contact ${target.name}, but the bbox gap is ${round(distance)} mm.`,
            evidence: { target: target.name, distance_mm: round(distance), tolerance_mm: tolerance },
            suggestion: `Move ${item.name} toward ${target.name} until their bounding boxes touch.`,
            correction: {
              action: 'move_to_contact',
              target: item.name,
              with: target.name,
              distance_mm: round(distance)
            }
          });
        }
      }
    }
  }
}

function validateInsideRules(issues, rules, itemIndex) {
  for (const rule of rules) {
    const items = resolveItems(rule, 'item', itemIndex);
    const parents = resolveItems(rule, 'parent', itemIndex);
    if (!items.length || !parents.length) {
      addMissingRuleIssue(issues, 'layout.inside_missing_ref', rule, 'Inside-region rule references missing item(s).');
      continue;
    }
    const axes = normalizeAxes(rule.axes || ['x', 'y']);
    const margin = numberOption(rule.margin_mm ?? rule.marginMm, 0);
    const tolerance = numberOption(rule.tolerance_mm ?? rule.toleranceMm, 1);
    for (const item of items) {
      for (const parent of parents) {
        const outside = outsideDistance(item.bounding_box, parent.bounding_box, axes, margin);
        if (outside > tolerance) {
          addIssue(issues, {
            type: 'layout.outside_parent_region',
            severity: rule.severity || 'error',
            item: item.name,
            message: `${item.name} exceeds ${parent.name} on ${axes.join('/')} by ${round(outside)} mm.`,
            evidence: { parent: parent.name, axes, outside_mm: round(outside), tolerance_mm: tolerance },
            suggestion: `Move or shrink ${item.name} so its projected bbox stays inside ${parent.name}.`,
            correction: {
              action: 'fit_inside_parent',
              target: item.name,
              parent: parent.name,
              axes,
              outside_mm: round(outside)
            }
          });
        }
      }
    }
  }
}

function validateSupportRules(issues, rules, itemIndex) {
  for (const rule of rules) {
    const items = resolveItems(rule, 'item', itemIndex);
    const parents = rule.parent || rule.with ? resolveItems(rule, rule.parent ? 'parent' : 'with', itemIndex) : itemIndex.items;
    if (!items.length || !parents.length) {
      addMissingRuleIssue(issues, 'layout.support_missing_ref', rule, 'Support rule references missing item(s).');
      continue;
    }
    for (const item of items) {
      const supported = parents.some((parent) => parent !== item && isSupportedBy(item, parent, rule));
      if (!supported) {
        addIssue(issues, {
          type: 'layout.unsupported_item',
          severity: rule.severity || 'error',
          item: item.name,
          message: `${item.name} is not supported by the expected parent surface.`,
          evidence: { parent: rule.parent || rule.with || 'any', max_gap_mm: numberOption(rule.max_gap_mm ?? rule.maxGapMm, 3) },
          suggestion: `Move ${item.name} onto its parent surface or declare the correct anchor.`,
          correction: {
            action: 'anchor_to_surface',
            target: item.name,
            parent: rule.parent || rule.with || null
          }
        });
      }
    }
  }
}

function validateSeparationRules(issues, rules, itemIndex) {
  for (const rule of rules) {
    const members = resolveItems(rule, 'items', itemIndex);
    if (members.length < 2) {
      addMissingRuleIssue(issues, 'layout.separation_missing_ref', rule, 'Separation rule needs at least two resolved items.');
      continue;
    }
    const axes = normalizeAxes(rule.axes || ['x', 'y']);
    const minGap = numberOption(rule.min_gap_mm ?? rule.minGapMm, 0);
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const gap = planarGap(members[i].bounding_box, members[j].bounding_box, axes);
        if (gap < minGap) {
          addIssue(issues, {
            type: 'layout.insufficient_separation',
            severity: rule.severity || 'error',
            item: `${members[i].name} / ${members[j].name}`,
            message: `${members[i].name} and ${members[j].name} are ${round(minGap - gap)} mm too close on ${axes.join('/')}.`,
            evidence: { axes, gap_mm: round(gap), min_gap_mm: minGap },
            suggestion: 'Move the controls apart or reduce their footprints.',
            correction: {
              action: 'increase_spacing',
              targets: [members[i].name, members[j].name],
              axes,
              required_gap_mm: minGap,
              current_gap_mm: round(gap)
            }
          });
        }
      }
    }
  }
}

function validateFloatingDetails(issues, items, itemIndex, expectedPairs, spec, options) {
  if (options.floatingDetails === false) return;
  const ruleTargets = new Set();
  for (const rules of [spec.contacts, spec.inside, spec.support]) {
    for (const rule of rules || []) {
      for (const ref of refsFromRule(rule, 'item')) ruleTargets.add(ref);
      for (const item of resolveItems(rule, 'item', itemIndex)) ruleTargets.add(item.name);
    }
  }
  const modelBox = mergeBoxes(items.map((item) => item.bounding_box));
  const groundTolerance = numberOption(options.groundToleranceMm, 2);
  for (const item of items) {
    if (!isDetailItem(item)) continue;
    if (ruleTargets.has(item.name) || ruleTargets.has(item.id)) continue;
    if (item.bounding_box.min[2] <= modelBox.min[2] + groundTolerance) continue;
    if (hasAnyExpectedContact(item, expectedPairs)) continue;
    if (items.some((other) => other !== item && isSupportedBy(item, other, { max_gap_mm: 4, allow_penetration_mm: 5 }))) continue;
    if (items.some((other) => other !== item && boxDistance(item.bounding_box, other.bounding_box) <= 1)) continue;
    addIssue(issues, {
      type: 'layout.unanchored_detail',
      severity: options.strictUnanchored ? 'error' : 'warn',
      item: item.name,
      message: `${item.name} looks like a visible detail but has no support, contact, or parent rule.`,
      evidence: { role: item.qa?.role || null, bounding_box: item.bounding_box },
      suggestion: 'Add qa.expected_contacts or a model QA support/inside rule, or move the detail onto a parent surface.',
      correction: {
        action: 'add_anchor_rule',
        target: item.name
      }
    });
  }
}

function renderViewSvg({ view, items, modelBox, title, size }) {
  const axes = normalizeAxes(view.axes);
  const bounds = projectedBounds(modelBox, axes);
  const scale = fitScale(bounds, size);
  const sorted = [...items].sort((a, b) => boxCenter(a.bounding_box)[AXIS_INDEX[view.depthAxis]] - boxCenter(b.bounding_box)[AXIS_INDEX[view.depthAxis]]);
  const rects = sorted.map((item, index) => {
    const projected = projectBox(item.bounding_box, axes, bounds, size, scale);
    const color = colorForItem(item, index);
    const label = escapeXml(shortLabel(item.name || item.id || `item-${index + 1}`));
    return [
      `<rect x="${round(projected.x)}" y="${round(projected.y)}" width="${round(projected.w)}" height="${round(projected.h)}" rx="3" fill="${color}" fill-opacity="0.48" stroke="${color}" stroke-width="1.4"/>`,
      projected.w > 26 && projected.h > 12 ? `<text x="${round(projected.x + 4)}" y="${round(projected.y + 12)}" font-size="10" fill="#1b1b1b">${label}</text>` : ''
    ].join('');
  }).join('\n  ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}" role="img" aria-label="${escapeXml(view.title)} preview">
  <rect width="100%" height="100%" fill="#f7f5ef"/>
  <text x="18" y="28" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#222">${escapeXml(title)} - ${escapeXml(view.title)}</text>
  <text x="18" y="48" font-family="Arial, sans-serif" font-size="12" fill="#555">axes ${axes.join('/')} from snapshot bounding boxes</text>
  <g font-family="Arial, sans-serif">${rects}</g>
</svg>`;
  return {
    name: view.name,
    title: view.title,
    axes,
    svg,
    projected_items: items.length,
    bounds
  };
}

function renderPreviewHtml(views, { title }) {
  const sections = views.map((view) => `<section>
  <h2>${escapeXml(view.title)}</h2>
  ${view.svg}
</section>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeXml(title)}</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #eeece6; color: #222; }
    header { padding: 18px 24px 8px; }
    h1 { margin: 0; font-size: 22px; }
    main { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 16px; padding: 16px 24px 28px; }
    section { background: #fffdf8; border: 1px solid #d8d2c7; border-radius: 8px; overflow: hidden; }
    h2 { margin: 0; padding: 12px 14px; font-size: 15px; border-bottom: 1px solid #d8d2c7; }
    svg { display: block; width: 100%; height: auto; }
  </style>
</head>
<body>
  <header><h1>${escapeXml(title)}</h1></header>
  <main>
${sections}
  </main>
</body>
</html>`;
}

function normalizeView(view) {
  if (typeof view === 'string') {
    const builtIn = DEFAULT_VIEWS.find((item) => item.name === view);
    if (!builtIn) throw new Error(`Unknown model QA preview view: ${view}`);
    return builtIn;
  }
  return {
    name: view.name || view.title || 'view',
    title: view.title || view.name || 'View',
    axes: normalizeAxes(view.axes || ['x', 'y']),
    depthAxis: view.depthAxis || view.depth_axis || axisNotIn(view.axes || ['x', 'y'])
  };
}

function normalizeAxes(axes) {
  if (!Array.isArray(axes) || axes.length !== 2) throw new Error('model QA axes must be a two-item array');
  return axes.map((axis) => {
    if (!Object.hasOwn(AXIS_INDEX, axis)) throw new Error(`Unknown model QA axis: ${axis}`);
    return axis;
  });
}

function axisNotIn(axes) {
  return ['x', 'y', 'z'].find((axis) => !axes.includes(axis)) || 'z';
}

function refsFromRule(rule, key) {
  const value = rule[key] ?? rule[`${key}s`] ?? (key === 'with' ? rule.parent : undefined);
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function resolveItems(rule, key, itemIndex) {
  const refs = refsFromRule(rule, key);
  const matches = [];
  for (const ref of refs) {
    if (typeof ref === 'string' && itemIndex.byRef.has(ref)) {
      matches.push(itemIndex.byRef.get(ref));
    } else if (typeof ref === 'string' && looksLikeRegex(ref)) {
      const regex = new RegExp(ref.slice(1, -1));
      matches.push(...itemIndex.items.filter((item) => regex.test(item.name) || regex.test(item.id || '')));
    }
  }
  if (rule.match && key === 'item') {
    const regex = new RegExp(rule.match);
    matches.push(...itemIndex.items.filter((item) => regex.test(item.name) || regex.test(item.id || '')));
  }
  if (Array.isArray(rule.matches) && key === 'items') {
    for (const pattern of rule.matches) {
      const regex = new RegExp(pattern);
      matches.push(...itemIndex.items.filter((item) => regex.test(item.name) || regex.test(item.id || '')));
    }
  }
  return uniqueItems(matches);
}

function looksLikeRegex(value) {
  return value.length > 2 && value.startsWith('/') && value.endsWith('/');
}

function uniqueItems(items) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = item.id || item.name;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function warningPairRefs(warning) {
  const source = warning.source || '';
  const sourceMatch = /group:([^;]+);([^;]+)/.exec(source);
  if (sourceMatch) return [sourceMatch[1], sourceMatch[2]];
  const messageMatch = /:\s+(.+?)\s+intersects\s+(.+)$/i.exec(warning.message || '');
  if (messageMatch) return [messageMatch[1], messageMatch[2]];
  return [null, null];
}

function pairKey(left, right) {
  return [left, right].filter(Boolean).map(String).sort().join('::');
}

function hasAnyExpectedContact(item, expectedPairs) {
  for (const pair of expectedPairs) {
    if (pair.includes(item.name) || (item.id && pair.includes(item.id))) return true;
  }
  return false;
}

function isDetailItem(item) {
  const role = item.qa?.role || item.qa?.intent || '';
  const name = item.name || item.id || '';
  const box = item.bounding_box;
  const largest = Math.max(box.w || box.max[0] - box.min[0], box.d || box.max[1] - box.min[1], box.h || box.max[2] - box.min[2]);
  return DETAIL_ROLE_PATTERN.test(`${role} ${name}`) || largest < 220;
}

function isSupportedBy(item, parent, rule = {}) {
  const itemBox = item.bounding_box;
  const parentBox = parent.bounding_box;
  const gap = itemBox.min[2] - parentBox.max[2];
  const maxGap = numberOption(rule.max_gap_mm ?? rule.maxGapMm, 3);
  const allowPenetration = numberOption(rule.allow_penetration_mm ?? rule.allowPenetrationMm, 2);
  return gap <= maxGap && gap >= -allowPenetration && overlapAmount(itemBox, parentBox, 0) > 0 && overlapAmount(itemBox, parentBox, 1) > 0;
}

function boxDistance(a, b) {
  const gaps = [0, 1, 2].map((axis) => intervalGap(a.min[axis], a.max[axis], b.min[axis], b.max[axis]));
  return Math.hypot(...gaps.map((gap) => Math.max(0, gap)));
}

function planarGap(a, b, axes) {
  const gaps = axes.map((axis) => {
    const index = AXIS_INDEX[axis];
    return intervalGap(a.min[index], a.max[index], b.min[index], b.max[index]);
  });
  if (gaps.some((gap) => gap > 0)) return Math.max(...gaps);
  return Math.max(...gaps);
}

function intervalGap(aMin, aMax, bMin, bMax) {
  if (aMax < bMin) return bMin - aMax;
  if (bMax < aMin) return aMin - bMax;
  return -Math.min(aMax, bMax) + Math.max(aMin, bMin);
}

function overlapAmount(a, b, axis) {
  return Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]);
}

function outsideDistance(itemBox, parentBox, axes, margin) {
  let outside = 0;
  for (const axis of axes) {
    const index = AXIS_INDEX[axis];
    outside = Math.max(outside, parentBox.min[index] + margin - itemBox.min[index]);
    outside = Math.max(outside, itemBox.max[index] - (parentBox.max[index] - margin));
  }
  return Math.max(0, outside);
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

function projectBox(box, axes, bounds, size, scale) {
  const projected = projectedBounds(box, axes);
  return {
    x: size.padding + (projected.min[0] - bounds.min[0]) * scale,
    y: size.height - size.padding - (projected.max[1] - bounds.min[1]) * scale,
    w: Math.max(1, projected.w * scale),
    h: Math.max(1, projected.h * scale)
  };
}

function fitScale(bounds, size) {
  const availableW = Math.max(1, size.width - size.padding * 2);
  const availableH = Math.max(1, size.height - size.padding * 2);
  return Math.min(availableW / Math.max(1, bounds.w), availableH / Math.max(1, bounds.h));
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

function boxCenter(box) {
  return [0, 1, 2].map((axis) => (box.min[axis] + box.max[axis]) / 2);
}

function colorForItem(item, index) {
  const source = item.material || item.qa?.role || item.name || String(index);
  let hash = 0;
  for (const char of source) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 58% 52%)`;
}

function shortLabel(value) {
  if (value.length <= 30) return value;
  return `${value.slice(0, 27)}...`;
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
    visible_items: items.length,
    preview_views: preview?.views?.length || 0
  };
}

function reportLevel(bySeverity) {
  if (bySeverity.error > 0) return 'error';
  if (bySeverity.warn > 0) return 'warn';
  if (bySeverity.info > 0) return 'info';
  return 'ok';
}

function correctionSuggestionsForIssues(issues) {
  return issues
    .filter((issue) => issue.correction)
    .map((issue) => ({
      ...issue.correction,
      reason: issue.message,
      issue_type: issue.type,
      severity: issue.severity,
      target: issue.correction.target || issue.item
    }));
}

function addMissingRuleIssue(issues, type, rule, message) {
  addIssue(issues, {
    type,
    severity: rule.severity || 'error',
    item: refsFromRule(rule, 'item').join(', ') || refsFromRule(rule, 'items').join(', '),
    message,
    evidence: { rule },
    suggestion: 'Fix the model QA spec or rename the generated part consistently.'
  });
}

function addIssue(issues, issue) {
  issues.push({
    severity: issue.severity || 'warn',
    type: issue.type,
    item: issue.item || null,
    message: issue.message,
    suggestion: issue.suggestion || null,
    evidence: issue.evidence || null,
    correction: issue.correction || null
  });
}

function numberOption(value, fallback) {
  const number = value === undefined || value === null ? fallback : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value) {
  return Number(value.toFixed(3));
}

function escapeMarkdown(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
