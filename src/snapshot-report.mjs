export function formatSnapshotReportMarkdown(result, { title = 'SketchUp Snapshot QA Report' } = {}) {
  const report = result?.report || result;
  const isCompareModel = Boolean(result?.report);
  const lines = [];

  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`- Verdict: **${report.verdict || 'unknown'}**`);
  lines.push(`- Level: **${report.level || 'unknown'}**`);
  lines.push(`- OK: **${report.ok === true ? 'true' : 'false'}**`);
  lines.push(`- Tolerance: \`${report.tolerance_mm ?? '-'} mm\``);
  if (isCompareModel) {
    lines.push(`- Expected runtime: \`${result.expected_runtime}\``);
    lines.push(`- Actual runtime: \`${result.actual_runtime}\``);
    lines.push(`- Reset first: \`${result.reset_first}\``);
  }
  lines.push('');

  appendSummary(lines, report.summary);
  appendTopologyTolerance(lines, report.topology_tolerance);
  appendBudgets(lines, report.budgets);
  appendTopIssues(lines, report.top_issues || []);
  appendRecommendations(lines, report.recommendations || []);
  appendDiffTypeBreakdown(lines, report.summary?.by_type || {});

  return `${lines.join('\n')}\n`;
}

function appendSummary(lines, summary = {}) {
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|---|---:|');
  lines.push(`| Total diffs | ${summary.total || 0} |`);
  lines.push(`| Errors | ${summary.by_severity?.error || 0} |`);
  lines.push(`| Warnings | ${summary.by_severity?.warn || 0} |`);
  lines.push(`| Info | ${summary.by_severity?.info || 0} |`);
  lines.push('');
}

function appendTopologyTolerance(lines, topologyTolerance = {}) {
  const entries = Object.entries(topologyTolerance).filter(([, value]) => Number(value) > 0);
  if (entries.length === 0) return;
  lines.push('## Topology Tolerance');
  lines.push('');
  lines.push('| Metric | Tolerance |');
  lines.push('|---|---:|');
  for (const [key, value] of entries) {
    lines.push(`| \`${escapeMarkdown(key)}\` | ${value} |`);
  }
  lines.push('');
}

function appendBudgets(lines, budgets = {}) {
  const entries = Object.entries(budgets).filter(([, value]) => value !== undefined && value !== null);
  if (entries.length === 0) return;
  lines.push('## Budgets');
  lines.push('');
  lines.push('| Budget | Limit |');
  lines.push('|---|---:|');
  for (const [key, value] of entries) {
    lines.push(`| \`${escapeMarkdown(key)}\` | ${value} |`);
  }
  lines.push('');
}

function appendTopIssues(lines, issues) {
  lines.push('## Top Issues');
  lines.push('');
  if (issues.length === 0) {
    lines.push('No issues. Nice and clean.');
    lines.push('');
    return;
  }
  lines.push('| Severity | Type | Path | Name | Message |');
  lines.push('|---|---|---|---|---|');
  for (const issue of issues) {
    lines.push(`| ${escapeMarkdown(issue.severity || '')} | \`${escapeMarkdown(issue.type || '')}\` | \`${escapeMarkdown(issue.path || '')}\` | ${escapeMarkdown(issue.name || '')} | ${escapeMarkdown(issue.message || '')} |`);
  }
  lines.push('');
}

function appendRecommendations(lines, recommendations) {
  lines.push('## Recommendations');
  lines.push('');
  if (recommendations.length === 0) {
    lines.push('- No follow-up needed from the current report.');
    lines.push('');
    return;
  }
  for (const recommendation of recommendations) {
    lines.push(`- ${escapeMarkdown(recommendation)}`);
  }
  lines.push('');
}

function appendDiffTypeBreakdown(lines, byType) {
  const entries = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return;
  lines.push('## Diff Type Breakdown');
  lines.push('');
  lines.push('| Type | Count |');
  lines.push('|---|---:|');
  for (const [type, count] of entries) {
    lines.push(`| \`${escapeMarkdown(type)}\` | ${count} |`);
  }
  lines.push('');
}

function escapeMarkdown(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}
