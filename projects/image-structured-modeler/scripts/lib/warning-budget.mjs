export function classifySnapshotWarnings(snapshot = {}) {
  const itemMetadataByName = snapshotItemMetadataByName(snapshot);
  return (snapshot.warnings || []).map((warning) => ({
    ...warning,
    classification: classifyWarning(warning, itemMetadataByName)
  }));
}

export function classifyWarning(warning = {}, itemMetadataByName = new Map()) {
  if (warning.type === 'material.pbr_unsupported') {
    return {
      bucket: 'queue_material_limitation',
      severity_override: 'info',
      expected: true,
      source: 'runtime_material_capability',
      note: 'SketchUp runtime does not apply the PBR fields used by the DSL material metadata.'
    };
  }
  if (!warning.type?.startsWith('geometry.bbox_')) {
    return {
      bucket: 'unclassified',
      severity_override: warning.severity || 'warn',
      expected: false,
      source: 'classifier_fallback',
      note: 'No image-structured-modeler classifier exists for this warning type yet.'
    };
  }

  const [left, right] = warningPairNames(warning);
  const metadataClassification = classifyExpectedContact(left, right, itemMetadataByName)
    || classifyExpectedContact(right, left, itemMetadataByName);
  if (metadataClassification) return metadataClassification;

  const names = [left, right].filter(Boolean);
  const hasFaceDome = names.some((name) => name.includes('Face_Dome'));
  const hasShell = names.some((name) => name.includes('Shell'));
  const hasRearGrip = names.some((name) => name.includes('Rear_Grip'));
  const hasMountedDetail = names.some((name) => /Button|Thumbstick|Screw|LED/.test(name));

  if (hasShell && hasFaceDome) {
    return {
      bucket: 'intentional_shallow_overlap',
      severity_override: 'info',
      expected: true,
      source: 'name_heuristic',
      note: 'Face dome is a cosmetic skin layered onto the controller shell.'
    };
  }
  if (hasFaceDome && hasMountedDetail) {
    return {
      bucket: 'expected_mounted_detail',
      severity_override: 'info',
      expected: true,
      source: 'name_heuristic',
      note: 'Buttons, sticks, screws, and indicators are mounted on the face panel and share bbox volume with it.'
    };
  }
  if (hasRearGrip && (hasShell || hasFaceDome || hasMountedDetail)) {
    return {
      bucket: 'expected_grip_attachment',
      severity_override: 'info',
      expected: true,
      source: 'name_heuristic',
      note: 'Rear grip and nearby shell/detail bounding boxes overlap because attachment/recess geometry is still approximate.'
    };
  }
  return {
    bucket: 'needs_geometry_review',
    severity_override: warning.severity || 'warn',
    expected: false,
    source: 'classifier_fallback',
    note: 'Potential real collision or bbox false positive; inspect before tightening warning budgets.'
  };
}

export function summarizeWarningClassifications(warnings = []) {
  const summary = {};
  for (const warning of warnings) {
    const bucket = warning.classification.bucket;
    if (!summary[bucket]) summary[bucket] = { total: 0, expected: 0, needs_review: 0 };
    summary[bucket].total += 1;
    if (warning.classification.expected) summary[bucket].expected += 1;
    else summary[bucket].needs_review += 1;
  }
  return summary;
}

export function createWarningGate({ expectedWarnings = [], actualWarnings = [] } = {}) {
  const expectedUnexpected = expectedWarnings.filter((warning) => !warning.classification.expected);
  const actualUnexpected = actualWarnings.filter((warning) => !warning.classification.expected);
  return {
    ok: expectedUnexpected.length === 0 && actualUnexpected.length === 0,
    expected_unexpected_count: expectedUnexpected.length,
    actual_unexpected_count: actualUnexpected.length
  };
}

export function evaluateSnapshotWarningBudget(report, budget) {
  const runtime = report?.runtime;
  const runtimeBudget = budget?.runtimes?.[runtime];
  const issues = [];
  if (!runtimeBudget) {
    issues.push(`No warning budget configured for runtime ${runtime}`);
    return { ok: false, issues };
  }

  const errorWarnings = Number(report?.snapshot_summary?.warning_summary?.by_severity?.error || 0);
  const maxErrorWarnings = numberOrDefault(runtimeBudget.max_error_warnings, 0);
  if (errorWarnings > maxErrorWarnings) {
    issues.push(`${runtime}: error warnings ${errorWarnings} exceed budget ${maxErrorWarnings}`);
  }
  issues.push(...evaluateWarningSummaryBudget(report?.warning_classification_summary || {}, runtimeBudget, runtime));
  return { ok: issues.length === 0, issues };
}

export function evaluateDiffWarningBudget(report, budget) {
  const key = `${report?.expected_runtime}_to_${report?.actual_runtime}`;
  const diffBudget = budget?.diffs?.[key];
  const issues = [];
  if (!diffBudget) {
    issues.push(`No diff warning budget configured for ${key}`);
    return { ok: false, issues };
  }

  const errorDiffs = Number(report?.report?.summary?.by_severity?.error || 0);
  const maxErrorDiffs = numberOrDefault(diffBudget.max_error_diffs, 0);
  if (errorDiffs > maxErrorDiffs) {
    issues.push(`${key}: error diffs ${errorDiffs} exceed budget ${maxErrorDiffs}`);
  }

  const unexpectedWarnings =
    Number(report?.warning_gate?.expected_unexpected_count || 0) +
    Number(report?.warning_gate?.actual_unexpected_count || 0);
  const maxUnexpectedWarnings = numberOrDefault(diffBudget.max_unexpected_warnings, 0);
  if (unexpectedWarnings > maxUnexpectedWarnings) {
    issues.push(`${key}: unexpected warnings ${unexpectedWarnings} exceed budget ${maxUnexpectedWarnings}`);
  }

  const expectedRuntimeBudget = budget?.runtimes?.[report?.expected_runtime];
  const actualRuntimeBudget = budget?.runtimes?.[report?.actual_runtime];
  if (!expectedRuntimeBudget) issues.push(`No warning budget configured for expected runtime ${report?.expected_runtime}`);
  else issues.push(...evaluateWarningSummaryBudget(report?.warning_classification_summary?.expected || {}, expectedRuntimeBudget, `${key}.expected`));
  if (!actualRuntimeBudget) issues.push(`No warning budget configured for actual runtime ${report?.actual_runtime}`);
  else issues.push(...evaluateWarningSummaryBudget(report?.warning_classification_summary?.actual || {}, actualRuntimeBudget, `${key}.actual`));

  return { ok: issues.length === 0, issues };
}

function warningPairNames(warning) {
  const source = warning.source || '';
  const names = source
    .replaceAll('group:', '')
    .split(';')
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length >= 2) return names.slice(0, 2);
  const match = /(?:collide|overlap):\s+(.+?)\s+intersects\s+(.+)$/i.exec(warning.message || '');
  return match ? [match[1], match[2]] : names;
}

function snapshotItemMetadataByName(snapshot = {}) {
  return new Map(
    [...(snapshot.groups || []), ...(snapshot.instances || [])]
      .filter((item) => item?.name && item.qa)
      .map((item) => [item.name, item.qa])
  );
}

function classifyExpectedContact(sourceName, targetName, itemMetadataByName) {
  if (!sourceName || !targetName) return null;
  const metadata = itemMetadataByName.get(sourceName);
  const contacts = metadata?.expected_contacts || metadata?.expectedContacts;
  if (!Array.isArray(contacts)) return null;
  const contact = contacts.find((item) => {
    if (!item || typeof item !== 'object') return false;
    const withName = item.with ?? item.object ?? item.name;
    return withName === targetName;
  });
  if (!contact) return null;
  return {
    bucket: contact.bucket,
    severity_override: 'info',
    expected: true,
    source: 'qa.expected_contacts',
    note: contact.note || `${sourceName} declares expected contact with ${targetName}.`
  };
}

function evaluateWarningSummaryBudget(summary, runtimeBudget, label) {
  const issues = [];
  const bucketBudget = runtimeBudget.buckets || {};
  const allowedBuckets = new Set(runtimeBudget.allowed_buckets || Object.keys(bucketBudget));
  const maxNeedsReview = numberOrDefault(runtimeBudget.max_needs_review, 0);
  let needsReview = 0;

  for (const [bucket, item] of Object.entries(summary)) {
    if (!allowedBuckets.has(bucket)) {
      issues.push(`${label}: bucket ${bucket} is not allowed`);
    }
    needsReview += Number(item.needs_review || 0);
  }
  if (needsReview > maxNeedsReview) {
    issues.push(`${label}: needs_review warnings ${needsReview} exceed budget ${maxNeedsReview}`);
  }

  for (const [bucket, expected] of Object.entries(bucketBudget)) {
    const actualTotal = Number(summary[bucket]?.total || 0);
    if (expected.exact_total !== undefined && actualTotal !== Number(expected.exact_total)) {
      issues.push(`${label}: bucket ${bucket} total ${actualTotal} must equal ${expected.exact_total}`);
    }
    if (expected.min_total !== undefined && actualTotal < Number(expected.min_total)) {
      issues.push(`${label}: bucket ${bucket} total ${actualTotal} below minimum ${expected.min_total}`);
    }
    if (expected.max_total !== undefined && actualTotal > Number(expected.max_total)) {
      issues.push(`${label}: bucket ${bucket} total ${actualTotal} exceeds maximum ${expected.max_total}`);
    }
  }

  return issues;
}

function numberOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
