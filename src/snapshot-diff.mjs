export const DEFAULT_SNAPSHOT_DIFF_TOLERANCE_MM = 1;
export const DEFAULT_TOP_ISSUE_LIMIT = 10;

export function compareSnapshots(expected, actual, {
  toleranceMm = DEFAULT_SNAPSHOT_DIFF_TOLERANCE_MM,
  topologyTolerance = {},
  budgets = {},
  topIssueLimit = DEFAULT_TOP_ISSUE_LIMIT
} = {}) {
  const diffs = [];

  const normalizedTopologyTolerance = normalizeTopologyTolerance(topologyTolerance);
  compareRuntimeCompatibility(diffs, expected?.runtime, actual?.runtime);
  compareTotals(diffs, expected?.totals || {}, actual?.totals || {}, normalizedTopologyTolerance);
  compareArtifactSize(diffs, expected, actual);
  checkBudgets(diffs, actual, budgets);
  compareStringSets(diffs, 'materials', expected?.material_names || [], actual?.material_names || []);
  compareStringSets(diffs, 'component_definitions', expected?.component_definitions || [], actual?.component_definitions || []);
  compareNamedCollections(diffs, 'groups', expected?.groups || [], actual?.groups || [], toleranceMm, normalizedTopologyTolerance);
  compareNamedCollections(diffs, 'instances', expected?.instances || [], actual?.instances || [], toleranceMm, normalizedTopologyTolerance);
  compareScenes(diffs, expected?.scenes || [], actual?.scenes || []);
  compareLevels(diffs, expected?.levels || [], actual?.levels || [], toleranceMm);
  compareBoundingBox(diffs, 'bounding_box', expected?.bounding_box, actual?.bounding_box, toleranceMm, 'warn');

  const summary = summarizeDiffs(diffs);
  const level = reportLevel(summary);
  return {
    ok: summary.by_severity.error === 0,
    level,
    verdict: verdictForLevel(level),
    tolerance_mm: toleranceMm,
    topology_tolerance: normalizedTopologyTolerance,
    budgets: normalizeBudgets(budgets),
    summary,
    top_issues: topIssues(diffs, topIssueLimit),
    recommendations: recommendationsForDiffs(diffs),
    diffs
  };
}

function compareRuntimeCompatibility(diffs, expectedRuntime, actualRuntime) {
  if (!actualRuntime) {
    addDiff(diffs, 'snapshot.runtime_missing', 'error', 'runtime', 'Actual snapshot is missing runtime descriptor', expectedRuntime, actualRuntime);
    return;
  }
  if (actualRuntime.compatibility && actualRuntime.compatibility.ok === false) {
    addDiff(diffs, 'runtime.compatibility_failed', 'error', 'runtime.compatibility', 'Actual runtime compatibility check failed', true, actualRuntime.compatibility);
  }
  if (expectedRuntime?.manifest_version && actualRuntime.manifest_version && expectedRuntime.manifest_version !== actualRuntime.manifest_version) {
    addDiff(diffs, 'runtime.manifest_mismatch', 'warn', 'runtime.manifest_version', 'Runtime manifest versions differ', expectedRuntime.manifest_version, actualRuntime.manifest_version);
  }
  if (expectedRuntime?.dsl_version && actualRuntime.dsl_version && expectedRuntime.dsl_version !== actualRuntime.dsl_version) {
    addDiff(diffs, 'runtime.dsl_version_mismatch', 'error', 'runtime.dsl_version', 'Runtime DSL versions differ', expectedRuntime.dsl_version, actualRuntime.dsl_version);
  }
}

function compareTotals(diffs, expectedTotals, actualTotals, topologyTolerance) {
  const keys = new Set([...Object.keys(expectedTotals), ...Object.keys(actualTotals)]);
  keys.delete('vertices');
  for (const key of keys) {
    const tolerance = topologyTolerance[key] || 0;
    if (Math.abs((expectedTotals[key] || 0) - (actualTotals[key] || 0)) > tolerance) {
      addDiff(diffs, 'snapshot.total_mismatch', 'warn', `totals.${key}`, `Snapshot total ${key} differs`, expectedTotals[key] || 0, actualTotals[key] || 0, undefined, tolerance ? { tolerance } : undefined);
    }
  }
}

function compareArtifactSize(diffs, expected, actual) {
  const expectedSize = expected?.artifact_size_bytes;
  const actualSize = actual?.artifact_size_bytes;
  if (expectedSize === undefined && actualSize === undefined) return;
  if (expectedSize === undefined || actualSize === undefined) {
    addDiff(diffs, 'artifact.size_missing', 'info', 'artifact_size_bytes', 'Artifact size is missing on one side', expectedSize, actualSize);
    return;
  }
  if (expectedSize !== actualSize) {
    const ratio = expectedSize > 0 ? actualSize / expectedSize : null;
    addDiff(diffs, 'artifact.size_mismatch', 'info', 'artifact_size_bytes', 'Artifact size differs', expectedSize, actualSize, undefined, { ratio });
  }
}

function checkBudgets(diffs, snapshot, budgets) {
  const normalized = normalizeBudgets(budgets);
  checkBudget(diffs, 'faces', snapshot?.totals?.faces, normalized.max_faces, 'error');
  checkBudget(diffs, 'edges', snapshot?.totals?.edges, normalized.max_edges, 'warn');
  checkBudget(diffs, 'vertices', snapshot?.totals?.vertices, normalized.max_vertices, 'warn');
  checkBudget(diffs, 'groups', snapshot?.totals?.groups, normalized.max_groups, 'warn');
  checkBudget(diffs, 'instances', snapshot?.totals?.instances, normalized.max_instances, 'warn');
  checkBudget(diffs, 'artifact_size_bytes', snapshot?.artifact_size_bytes, normalized.max_artifact_size_bytes, 'warn');
}

function checkBudget(diffs, metric, actual, max, severity) {
  if (max === undefined || max === null || Number.isNaN(max)) return;
  const actualNumber = Number(actual || 0);
  if (actualNumber > max) {
    addDiff(diffs, 'budget.exceeded', severity, metric === 'artifact_size_bytes' ? metric : `totals.${metric}`, `${metric} exceeds budget`, max, actualNumber, metric, { over_by: actualNumber - max });
  }
}

function compareStringSets(diffs, path, expectedItems, actualItems) {
  const expectedSet = new Set(expectedItems);
  const actualSet = new Set(actualItems);
  for (const item of expectedSet) {
    if (!actualSet.has(item)) addDiff(diffs, `${path}.missing`, 'warn', path, `${path} item missing: ${item}`, item, null, item);
  }
  for (const item of actualSet) {
    if (!expectedSet.has(item)) addDiff(diffs, `${path}.extra`, 'info', path, `${path} item extra: ${item}`, null, item, item);
  }
}

function compareNamedCollections(diffs, path, expectedItems, actualItems, toleranceMm, topologyTolerance) {
  const expectedByName = byName(expectedItems);
  const actualByName = byName(actualItems);

  for (const [name, expectedItem] of expectedByName) {
    const actualItem = actualByName.get(name);
    if (!actualItem) {
      addDiff(diffs, `${path}.missing`, 'error', path, `${path} item missing: ${name}`, expectedItem, null, name);
      continue;
    }
    compareField(diffs, `${path}.${name}.kind`, expectedItem.kind, actualItem.kind, 'info', name);
    compareField(diffs, `${path}.${name}.material`, expectedItem.material, actualItem.material, 'warn', name);
    compareMetric(diffs, `${path}.${name}.faces`, expectedItem.faces, actualItem.faces, topologyTolerance.faces, 'warn', name);
    compareMetric(diffs, `${path}.${name}.edges`, expectedItem.edges, actualItem.edges, topologyTolerance.edges, 'warn', name);
    compareBoundingBox(diffs, `${path}.${name}.bounding_box`, expectedItem.bounding_box, actualItem.bounding_box, toleranceMm, 'warn', name);
  }

  for (const [name, actualItem] of actualByName) {
    if (!expectedByName.has(name)) addDiff(diffs, `${path}.extra`, 'info', path, `${path} item extra: ${name}`, null, actualItem, name);
  }
}

function compareScenes(diffs, expectedScenes, actualScenes) {
  compareStringSets(diffs, 'scenes', expectedScenes.map((scene) => scene.name).filter(Boolean), actualScenes.map((scene) => scene.name).filter(Boolean));
}

function compareLevels(diffs, expectedLevels, actualLevels, toleranceMm) {
  const expectedByName = byName(expectedLevels);
  const actualByName = byName(actualLevels);
  for (const [name, expectedLevel] of expectedByName) {
    const actualLevel = actualByName.get(name);
    if (!actualLevel) {
      addDiff(diffs, 'levels.missing', 'warn', 'levels', `Level missing: ${name}`, expectedLevel, null, name);
      continue;
    }
    compareMetric(diffs, `levels.${name}.elevation`, expectedLevel.elevation, actualLevel.elevation, toleranceMm, 'warn', name);
    compareMetric(diffs, `levels.${name}.height`, expectedLevel.height, actualLevel.height, toleranceMm, 'info', name);
  }
  for (const [name, actualLevel] of actualByName) {
    if (!expectedByName.has(name)) addDiff(diffs, 'levels.extra', 'info', 'levels', `Level extra: ${name}`, null, actualLevel, name);
  }
}

function compareBoundingBox(diffs, path, expectedBox, actualBox, toleranceMm, severity, name) {
  if (!expectedBox && !actualBox) return;
  if (!expectedBox || !actualBox) {
    addDiff(diffs, 'bbox.missing', severity, path, `Bounding box missing at ${path}`, expectedBox, actualBox, name);
    return;
  }
  for (const key of ['w', 'd', 'h']) {
    compareMetric(diffs, `${path}.${key}`, expectedBox[key], actualBox[key], toleranceMm, severity, name);
  }
  for (const key of ['min', 'max']) {
    for (let index = 0; index < 3; index += 1) {
      compareMetric(diffs, `${path}.${key}.${index}`, expectedBox[key]?.[index], actualBox[key]?.[index], toleranceMm, severity, name);
    }
  }
}

function compareField(diffs, path, expected, actual, severity, name) {
  if (expected === undefined && actual === undefined) return;
  if (expected !== actual) addDiff(diffs, 'snapshot.field_mismatch', severity, path, `${path} differs`, expected, actual, name);
}

function compareMetric(diffs, path, expected, actual, tolerance, severity, name) {
  if (expected === undefined && actual === undefined) return;
  const expectedNumber = Number(expected || 0);
  const actualNumber = Number(actual || 0);
  if (Math.abs(expectedNumber - actualNumber) > tolerance) {
    addDiff(diffs, 'snapshot.metric_mismatch', severity, path, `${path} differs by more than ${tolerance}`, expectedNumber, actualNumber, name);
  }
}

function byName(items) {
  return new Map(items.filter((item) => item?.name).map((item) => [item.name, item]));
}

function addDiff(diffs, type, severity, path, message, expected, actual, name, details) {
  const diff = { type, severity, path, message, expected, actual };
  if (name !== undefined) diff.name = name;
  if (details !== undefined) diff.details = details;
  diffs.push(diff);
}

function normalizeTopologyTolerance(topologyTolerance = {}) {
  return {
    faces: finiteNonNegativeNumber(topologyTolerance.faces, 0),
    edges: finiteNonNegativeNumber(topologyTolerance.edges, 0),
    groups: finiteNonNegativeNumber(topologyTolerance.groups, 0),
    instances: finiteNonNegativeNumber(topologyTolerance.instances, 0)
  };
}

function finiteNonNegativeNumber(value, fallback) {
  const number = value === undefined || value === null || value === '' ? fallback : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeBudgets(budgets = {}) {
  return Object.fromEntries(
    Object.entries(budgets)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => [key, Number(value)])
      .filter(([, value]) => Number.isFinite(value))
  );
}

function topIssues(diffs, limit) {
  const severityRank = { error: 0, warn: 1, info: 2 };
  return diffs
    .slice()
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
    .slice(0, limit)
    .map(({ type, severity, path, message, name, expected, actual, details }) => ({ type, severity, path, message, name, expected, actual, details }));
}

function recommendationsForDiffs(diffs) {
  const recommendations = [];
  if (diffs.some((diff) => diff.type === 'runtime.compatibility_failed')) {
    recommendations.push('Check get_capabilities output before trusting queue snapshot results.');
  }
  if (diffs.some((diff) => diff.type.endsWith('.missing'))) {
    recommendations.push('Inspect missing named objects first; downstream totals and bounding boxes may be secondary effects.');
  }
  if (diffs.some((diff) => diff.type === 'snapshot.metric_mismatch' && diff.path.includes('bounding_box'))) {
    recommendations.push('Review bounding box drift against tolerance_mm; raise tolerance only for expected SketchUp numeric differences.');
  }
  if (diffs.some((diff) => diff.type === 'budget.exceeded')) {
    recommendations.push('Reduce geometry resolution or componentize repeated details to stay within QA budgets.');
  }
  if (diffs.some((diff) => diff.type === 'artifact.size_mismatch')) {
    recommendations.push('Compare artifact_size_bytes with face/vertex counts to catch unexpectedly heavy SKP output.');
  }
  return recommendations;
}

function verdictForLevel(level) {
  if (level === 'error') return 'fail';
  if (level === 'warn') return 'review';
  if (level === 'info') return 'pass_with_notes';
  return 'pass';
}

function summarizeDiffs(diffs) {
  const bySeverity = { error: 0, warn: 0, info: 0 };
  const byType = {};
  for (const diff of diffs) {
    bySeverity[diff.severity] = (bySeverity[diff.severity] || 0) + 1;
    byType[diff.type] = (byType[diff.type] || 0) + 1;
  }
  return {
    total: diffs.length,
    by_severity: bySeverity,
    by_type: byType
  };
}

function reportLevel(summary) {
  if (summary.by_severity.error > 0) return 'error';
  if (summary.by_severity.warn > 0) return 'warn';
  if (summary.by_severity.info > 0) return 'info';
  return 'ok';
}
