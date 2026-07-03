export function buildLimitationsReport({ snapshot = {}, modelQa = null, expansion = null, runtime = 'mock' } = {}) {
  const entries = [];
  for (const limitation of expansion?.limitations || []) {
    entries.push(normalizeEntry(limitation, 'dsl_expansion'));
  }
  for (const warning of snapshot.warnings || []) {
    if (warning.type === 'info.limitation') {
      entries.push(normalizeEntry({
        type: warning.type,
        severity: warning.severity || 'info',
        source: warning.source,
        message: warning.message
      }, 'runtime'));
    }
  }
  const acceptedWarnings = modelQa?.accepted_warnings || [];
  if (acceptedWarnings.length) {
    entries.push({
      type: 'qa.expected_collision_accepted',
      severity: 'info',
      source: 'model_qa',
      message: `${acceptedWarnings.length} raw bbox collision warning(s) were accepted by expected contact rules.`,
      category: 'qa',
      count: acceptedWarnings.length
    });
  }
  const pbrMaterials = (snapshot.materials || []).filter((material) => material.pbr);
  if (pbrMaterials.length && runtime === 'queue') {
    entries.push({
      type: 'material.pbr_queue_fidelity',
      severity: 'info',
      source: 'materials',
      message: 'Queue runtime records PBR intent, but visual fidelity still depends on SketchUp material support and available texture files.',
      category: 'material',
      count: pbrMaterials.length
    });
  }
  if (expansion?.changed) {
    entries.push({
      type: 'dsl.bridge_macro_expansion',
      severity: 'info',
      source: 'build_report',
      message: 'The model was built from bridge-expanded DSL; inspect expanded.dsl.json for the exact low-level operations sent to the runtime.',
      category: 'dsl',
      count: expansion.expanded_operations
    });
  }
  return {
    kind: 'limitations_report',
    runtime,
    ok: entries.every((entry) => entry.severity !== 'error'),
    summary: summarize(entries),
    entries
  };
}

export function formatLimitationsReportMarkdown(report = {}, options = {}) {
  const lines = [];
  lines.push(`# ${options.title || 'SketchUp Capability Limitations Report'}`);
  lines.push('');
  lines.push(`- Runtime: \`${report.runtime || 'unknown'}\``);
  lines.push(`- Entries: ${report.entries?.length || 0}`);
  lines.push(`- OK: ${report.ok === true ? 'true' : 'false'}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Severity | Count |');
  lines.push('|---|---:|');
  for (const severity of ['error', 'warn', 'info']) {
    lines.push(`| ${severity} | ${report.summary?.by_severity?.[severity] || 0} |`);
  }
  lines.push('');
  lines.push('## Entries');
  lines.push('');
  if (!report.entries?.length) {
    lines.push('No explicit limitations recorded.');
  } else {
    lines.push('| Severity | Type | Source | Message |');
    lines.push('|---|---|---|---|');
    for (const entry of report.entries) {
      lines.push(`| ${escapeMarkdown(entry.severity)} | \`${escapeMarkdown(entry.type)}\` | ${escapeMarkdown(entry.source || '')} | ${escapeMarkdown(entry.message || '')} |`);
    }
  }
  lines.push('');
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

function normalizeEntry(entry, fallbackCategory) {
  return {
    type: entry.type || 'info.limitation',
    severity: entry.severity || 'info',
    source: entry.source || null,
    message: entry.message || '',
    category: entry.category || fallbackCategory || 'info',
    ...(entry.count !== undefined ? { count: entry.count } : {})
  };
}

function summarize(entries) {
  const bySeverity = { error: 0, warn: 0, info: 0 };
  const byType = {};
  const byCategory = {};
  for (const entry of entries) {
    bySeverity[entry.severity] = (bySeverity[entry.severity] || 0) + 1;
    byType[entry.type] = (byType[entry.type] || 0) + 1;
    byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
  }
  return {
    total: entries.length,
    by_severity: bySeverity,
    by_type: byType,
    by_category: byCategory
  };
}

function escapeMarkdown(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}
