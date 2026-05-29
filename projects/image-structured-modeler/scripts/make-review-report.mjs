#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/image-analysis.mjs';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const observationsPath = path.resolve(repoRoot, options.observations || 'projects/image-structured-modeler/examples/switch-controller/observations.json');
  const modelPlanPath = path.resolve(repoRoot, options.modelPlan || 'projects/image-structured-modeler/examples/switch-controller/model-plan.json');
  const outputDslPath = path.resolve(repoRoot, options.outputDsl || 'projects/image-structured-modeler/examples/switch-controller/output.json');
  const correctionsPath = path.resolve(repoRoot, options.manualCorrections || 'projects/image-structured-modeler/examples/switch-controller/manual-corrections.json');
  const output = path.resolve(repoRoot, options.output || 'projects/image-structured-modeler/examples/switch-controller/review/index.html');

  const observations = await readJsonIfExists(observationsPath);
  const modelPlan = await readJsonIfExists(modelPlanPath);
  const outputDsl = await readJsonIfExists(outputDslPath);
  const corrections = await readJsonIfExists(correctionsPath);
  if (!observations) throw new Error(`Missing observations file: ${observationsPath}`);

  const html = buildReviewHtml({
    observations,
    modelPlan,
    outputDsl,
    corrections,
    output,
    sourcePaths: { observationsPath, modelPlanPath, outputDslPath, correctionsPath }
  });
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, html, 'utf8');
  process.stdout.write(`${JSON.stringify({ ok: true, output }, null, 2)}\n`);
}

export function buildReviewHtml({ observations, modelPlan, outputDsl, corrections, output, sourcePaths }) {
  const reportDir = path.dirname(output);
  const operationCounts = countOperations(outputDsl?.operations || []);
  const overlayDir = observations.review?.overlay_dir
    ? path.resolve(repoRoot, observations.review.overlay_dir)
    : null;
  const openQuestions = modelPlan?.review?.open_questions || observations.review?.open_questions || [];
  const risks = observations.quality_report?.risks || [];
  const parts = modelPlan?.parts || [];
  const evidenceSummary = modelPlan?.review?.evidence_summary || summarizePartEvidence(parts, observations);
  const evidenceGraph = modelPlan?.review?.evidence_graph || null;
  const semanticFusion = modelPlan?.review?.semantic_fusion || null;
  const correctionSuggestions = modelPlan?.review?.correction_suggestions || [];
  const sourceLinks = Object.entries(sourcePaths)
    .filter(([, value]) => value)
    .map(([key, value]) => `<li><code>${escapeHtml(key)}</code>: <code>${escapeHtml(path.relative(repoRoot, value))}</code></li>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(observations.object?.name || 'Image Structured Model Review')}</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #1d2430;
      --muted: #5c6675;
      --line: #d9dde3;
      --panel: #ffffff;
      --soft: #f5f7fa;
      --accent: #0f766e;
      --warn: #a15c00;
      --bad: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: #eef1f5;
      line-height: 1.45;
    }
    header {
      padding: 28px 32px 18px;
      background: #ffffff;
      border-bottom: 1px solid var(--line);
    }
    main { padding: 24px 32px 40px; max-width: 1440px; margin: 0 auto; }
    h1 { margin: 0 0 6px; font-size: 28px; font-weight: 760; letter-spacing: 0; }
    h2 { margin: 0 0 14px; font-size: 18px; font-weight: 720; letter-spacing: 0; }
    h3 { margin: 0 0 10px; font-size: 15px; font-weight: 720; letter-spacing: 0; }
    p { margin: 0; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.92em; }
    .subtle { color: var(--muted); }
    .grid { display: grid; gap: 16px; }
    .summary { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 20px; }
    .metric {
      background: var(--panel);
      border: 1px solid var(--line);
      padding: 14px;
      min-height: 88px;
    }
    .metric strong { display: block; font-size: 24px; margin-top: 6px; }
    .section {
      background: var(--panel);
      border: 1px solid var(--line);
      padding: 18px;
      margin-bottom: 18px;
    }
    .two { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .image-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .image-block {
      border: 1px solid var(--line);
      background: var(--soft);
      min-width: 0;
    }
    .image-block img {
      display: block;
      width: 100%;
      height: auto;
      border-bottom: 1px solid var(--line);
      background: #111;
    }
    .image-body { padding: 12px; }
    .tag {
      display: inline-block;
      padding: 2px 7px;
      border: 1px solid var(--line);
      background: #fff;
      margin: 0 5px 5px 0;
      font-size: 12px;
    }
    .tag.warn { color: var(--warn); border-color: #e2bd7d; background: #fff8e8; }
    .tag.good { color: var(--accent); border-color: #9dd9d1; background: #eefaf8; }
    .tag.bad { color: var(--bad); border-color: #efb2ac; background: #fff1f0; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
    th { background: var(--soft); font-weight: 700; }
    ul { margin: 0; padding-left: 18px; }
    li + li { margin-top: 4px; }
    .mono-list li { word-break: break-word; }
    .workbench {
      display: grid;
      gap: 14px;
    }
    .workbench-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .workbench-grid {
      display: grid;
      grid-template-columns: minmax(280px, 0.95fr) minmax(320px, 1.05fr);
      gap: 14px;
      align-items: start;
    }
    .suggestion-list {
      border: 1px solid var(--line);
      max-height: 460px;
      overflow: auto;
      background: var(--soft);
    }
    .suggestion-item {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 10px;
      padding: 10px;
      border-bottom: 1px solid var(--line);
      background: #fff;
    }
    .suggestion-item:last-child { border-bottom: 0; }
    .suggestion-item input { margin-top: 3px; }
    .suggestion-title {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
      margin-bottom: 5px;
    }
    button {
      border: 1px solid var(--line);
      background: #fff;
      color: var(--ink);
      padding: 7px 10px;
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    button.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    button:focus-visible, textarea:focus-visible {
      outline: 2px solid #2563eb;
      outline-offset: 2px;
    }
    textarea {
      width: 100%;
      min-height: 460px;
      resize: vertical;
      border: 1px solid var(--line);
      padding: 10px;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: var(--ink);
      background: #fff;
    }
    @media (max-width: 900px) {
      header { padding: 22px 18px 14px; }
      main { padding: 18px; }
      .summary, .two, .image-grid, .workbench-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(observations.object?.name || 'Image Structured Model Review')}</h1>
    <p class="subtle">Generated from deterministic CV baseline plus optional manual corrections. Review before queue runtime export.</p>
  </header>
  <main>
    <section class="grid summary">
      ${metric('Image Quality', observations.image_set_quality || 'unknown')}
      ${metric('Images', String(observations.images?.length || 0))}
      ${metric('Parts', String(parts.length))}
      ${metric('DSL Ops', String(outputDsl?.operations?.length || 0))}
      ${metric('Observed', String(evidenceSummary.status_counts?.observed || 0))}
      ${metric('Template Prior', String(evidenceSummary.template_prior_parts?.length || 0))}
      ${metric('Fusion Confirmed', String(semanticFusion?.summary?.confirmed || 0))}
      ${metric('Needs Review', String(semanticFusion?.summary?.needs_review || 0))}
    </section>

    <section class="grid two">
      <div class="section">
        <h2>Coverage</h2>
        <p>${tags((observations.views_detected || []).map((view) => ({ text: view, kind: 'good' })))}</p>
        <h3 style="margin-top:14px">Missing Views</h3>
        <p>${tags((observations.missing_views || []).map((view) => ({ text: view, kind: 'warn' }))) || '<span class="subtle">None</span>'}</p>
        <h3 style="margin-top:14px">Risks</h3>
        ${list(risks.length ? risks : ['No image-set risk recorded.'])}
      </div>
      <div class="section">
        <h2>Manual Corrections</h2>
        ${correctionsSummary(corrections, modelPlan)}
      </div>
    </section>

    <section class="section">
      <h2>Open Questions</h2>
      ${list(openQuestions.length ? openQuestions : ['No open questions recorded.'])}
    </section>

    <section class="section">
      <h2>Evidence Status</h2>
      ${evidenceSummaryBlock(evidenceSummary)}
    </section>

    <section class="section">
      <h2>Evidence Graph</h2>
      ${evidenceGraphBlock(evidenceGraph)}
    </section>

    <section class="section">
      <h2>Semantic Fusion</h2>
      ${semanticFusionBlock(semanticFusion)}
    </section>

    <section class="section">
      <h2>Corrections Workbench</h2>
      ${correctionsWorkbenchBlock(correctionSuggestions, sourcePaths?.correctionsPath)}
    </section>

    <section class="section">
      <h2>Correction Patch Suggestions</h2>
      ${correctionSuggestionBlock(correctionSuggestions)}
    </section>

    <section class="section">
      <h2>Review Overlays</h2>
      <div class="grid image-grid">
        ${(observations.images || []).map((image) => imageBlock(image, overlayDir, reportDir)).join('\n')}
      </div>
    </section>

    <section class="section">
      <h2>Model Plan Parts</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Part</th><th>Type</th><th>Status</th><th>Evidence Sources</th><th>Semantics</th><th>Uncertainty</th></tr></thead>
          <tbody>
            ${parts.map(partRow).join('\n')}
          </tbody>
        </table>
      </div>
    </section>

    <section class="grid two">
      <div class="section">
        <h2>Output DSL</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Operation</th><th>Count</th></tr></thead>
            <tbody>${Object.entries(operationCounts).map(([op, count]) => `<tr><td><code>${escapeHtml(op)}</code></td><td>${count}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
      <div class="section">
        <h2>Source Files</h2>
        <ul class="mono-list">${sourceLinks}</ul>
      </div>
    </section>
  </main>
  <script type="application/json" id="correction-suggestions-data">${escapeScriptJson(correctionSuggestions)}</script>
  <script>${workbenchScript()}</script>
</body>
</html>
`;
}

function imageBlock(image, overlayDir, reportDir) {
  const base = path.basename(image.image.path).replace(/\.[^.]+$/, '');
  const overlayPath = overlayDir ? path.join(overlayDir, `${base}-overlay.png`) : null;
  const overlaySrc = overlayPath ? toHtmlPath(path.relative(reportDir, overlayPath)) : '';
  const overlayLine = overlaySrc
    ? `<img src="${escapeHtml(overlaySrc)}" alt="${escapeHtml(base)} review overlay">`
    : '';
  const componentHints = (image.observations || [])
    .filter((observation) => observation.kind === 'component_bbox' && observation.component_hint !== 'main_object')
    .map((observation) => observation.component_hint);
  const risks = image.quality_report?.risks?.length
    ? `\n      <h3 style="margin-top:12px">Risks</h3>${list(image.quality_report.risks)}`
    : '';
  return `<article class="image-block">
${overlayLine ? `    ${overlayLine}\n` : ''}    <div class="image-body">
      <h3>${escapeHtml(path.basename(image.image.path))}</h3>
      <p>${tags([{ text: image.detected_view.kind, kind: 'good' }, { text: `confidence ${image.detected_view.confidence}`, kind: '' }])}</p>
      <p class="subtle">edges ${image.metrics?.edge_count || 0} · density ${image.metrics?.edge_density || 0} · symmetry ${image.metrics?.symmetry_score || 0}</p>
      <h3 style="margin-top:12px">Component Candidates</h3>
      <p>${tags(componentHints.map((hint) => ({ text: hint, kind: '' }))) || '<span class="subtle">None</span>'}</p>${risks}
    </div>
  </article>`;
}

function partRow(part) {
  const evidenceSources = part.evidence_sources?.length
    ? part.evidence_sources
    : (part.evidence || []).map((item) => ({ view: item.view, kind: item.kind, status: item.kind === 'manual_note' ? 'template_prior' : 'observed', note: item.note }));
  const evidence = evidenceSources.map((item) => `${item.view}:${item.kind}${item.confidence !== undefined ? ` (${item.confidence})` : ''}`).join(', ');
  const status = part.evidence_status || legacyStatusToEvidenceStatus(part.status) || 'unknown';
  const semantics = part.feature_semantics?.length ? part.feature_semantics.join(', ') : 'none';
  return `<tr>
    <td><code>${escapeHtml(part.id)}</code></td>
    <td>${escapeHtml(part.type)}</td>
    <td>${statusTag(status)}${part.template_prior ? '<br><span class="tag warn">template prior</span>' : ''}${part.manual_confirmed ? '<br><span class="tag good">manual confirmed</span>' : ''}</td>
    <td>${escapeHtml(evidence || 'none')}</td>
    <td>${escapeHtml(semantics)}<br>${featureMappingTags(part.feature_mapping)}</td>
    <td>${escapeHtml((part.uncertainty || []).join('; ') || '')}</td>
  </tr>`;
}

function evidenceSummaryBlock(summary) {
  const counts = summary.status_counts || {};
  return `<div class="grid two">
    <div>
      <h3>Status Counts</h3>
      <p>${tags([
        { text: `observed ${counts.observed || 0}`, kind: 'good' },
        { text: `inferred ${counts.inferred || 0}`, kind: 'warn' },
        { text: `template ${counts.template_prior || 0}`, kind: 'bad' },
        { text: `manual ${counts.manual_confirmed || 0}`, kind: 'good' }
      ])}</p>
      <h3 style="margin-top:14px">View Coverage</h3>
      <p>${tags((summary.views_detected || []).map((view) => ({ text: view, kind: 'good' }))) || '<span class="subtle">None</span>'}</p>
    </div>
    <div>
      <h3>Template Prior Parts</h3>
      ${list(summary.template_prior_parts?.length ? summary.template_prior_parts : ['None'])}
      <h3 style="margin-top:14px">Manual Confirmed Parts</h3>
      ${list(summary.manual_confirmed_parts?.length ? summary.manual_confirmed_parts : ['None'])}
    </div>
  </div>`;
}

function evidenceGraphBlock(graph) {
  if (!graph) return '<p class="subtle">No evidence graph recorded.</p>';
  return `<div class="table-wrap">
    <table>
      <thead><tr><th>Part</th><th>Required Views</th><th>Confirmed Views</th><th>Missing</th><th>Conflicts / Questions</th></tr></thead>
      <tbody>
        ${(graph.parts || []).map(graphPartRow).join('\n')}
      </tbody>
    </table>
  </div>
  <h3 style="margin-top:14px">Graph Open Questions</h3>
  ${list(graph.open_questions?.length ? graph.open_questions : ['None'])}`;
}

function semanticFusionBlock(fusion) {
  if (!fusion) return '<p class="subtle">No semantic fusion recorded.</p>';
  const summary = fusion.summary || {};
  return `<div class="grid two">
    <div>
      <h3>Fusion Summary</h3>
      <p>${tags([
        { text: `confirmed ${summary.confirmed || 0}`, kind: 'good' },
        { text: `partial ${summary.partial || 0}`, kind: 'warn' },
        { text: `needs review ${summary.needs_review || 0}`, kind: 'bad' },
        { text: `strategy ${fusion.strategy || 'unknown'}`, kind: '' }
      ])}</p>
      <h3 style="margin-top:14px">Cross-View Confirmed</h3>
      ${list(summary.cross_view_confirmed_parts?.length ? summary.cross_view_confirmed_parts : ['None'])}
    </div>
    <div>
      <h3>Review Drivers</h3>
      <p>${tags([
        { text: `fallback ${summary.fallback_parts?.length || 0}`, kind: summary.fallback_parts?.length ? 'warn' : 'good' },
        { text: `template prior ${summary.template_prior_parts?.length || 0}`, kind: summary.template_prior_parts?.length ? 'warn' : 'good' }
      ])}</p>
      <h3 style="margin-top:14px">Open Questions</h3>
      ${list(fusion.open_questions?.length ? fusion.open_questions : ['None'])}
    </div>
  </div>
  <div class="table-wrap" style="margin-top:14px">
    <table>
      <thead><tr><th>Part</th><th>Status</th><th>Decision</th><th>Confidence</th><th>Signals</th><th>Review Flags</th></tr></thead>
      <tbody>
        ${(fusion.parts || []).map(semanticFusionPartRow).join('\n')}
      </tbody>
    </table>
  </div>`;
}

function semanticFusionPartRow(part) {
  const signals = part.signals || {};
  return `<tr>
    <td><code>${escapeHtml(part.part_id)}</code><br>${escapeHtml((part.semantic_labels || []).join(', ') || 'none')}</td>
    <td>${fusionStatusTag(part.status)}</td>
    <td>${escapeHtml(part.decision || 'unknown')}</td>
    <td>${escapeHtml(part.confidence ?? 'unknown')}</td>
    <td>${escapeHtml(`coverage ${signals.required_view_coverage ?? 'n/a'}; sources ${signals.observed_source_count ?? 0}/${signals.source_count ?? 0}; mapping ${signals.feature_mapping_confidence ?? 'n/a'}`)}</td>
    <td>${tags((part.review_flags || []).map((flag) => ({ text: flag, kind: flag.includes('fallback') || flag.includes('missing') ? 'warn' : '' }))) || '<span class="subtle">None</span>'}</td>
  </tr>`;
}

function correctionsWorkbenchBlock(suggestions, correctionsPath) {
  const target = correctionsPath ? path.relative(repoRoot, correctionsPath) : 'manual-corrections.json';
  return `<div class="workbench" id="corrections-workbench">
    <p class="subtle">Select suggested patches, edit the JSON payload, then copy or download it for <code>${escapeHtml(target)}</code>.</p>
    <div class="workbench-toolbar">
      <button type="button" id="select-all-corrections">Select all</button>
      <button type="button" id="clear-corrections">Clear</button>
      <button type="button" id="validate-corrections">Validate JSON</button>
      <button type="button" class="primary" id="copy-corrections">Copy JSON</button>
      <button type="button" id="download-corrections">Download JSON</button>
      <span class="subtle" id="corrections-status">${escapeHtml(suggestions.length ? `${suggestions.length} suggested patch(es) selected` : 'No suggested patches')}</span>
    </div>
    <div class="workbench-grid">
      <div class="suggestion-list" aria-label="Correction suggestions">
        ${suggestions.length ? suggestions.map((suggestion, index) => correctionWorkbenchItem(suggestion, index)).join('\n') : '<p class="subtle" style="padding:10px">No correction suggestions recorded.</p>'}
      </div>
      <div>
        <textarea id="corrections-json" spellcheck="false" aria-label="Manual corrections JSON"></textarea>
      </div>
    </div>
  </div>`;
}

function correctionWorkbenchItem(suggestion, index) {
  const fusion = suggestion.fusion_status ? `fusion ${suggestion.fusion_status}` : 'fusion review';
  const decision = suggestion.fusion_decision ? `decision ${suggestion.fusion_decision}` : '';
  return `<label class="suggestion-item" data-correction-suggestion="${escapeHtml(suggestion.part_id)}">
    <input type="checkbox" class="correction-checkbox" data-index="${index}" checked>
    <span>
      <span class="suggestion-title">
        <code>${escapeHtml(suggestion.part_id)}</code>
        ${tags([{ text: fusion, kind: suggestion.fusion_status === 'needs_review' ? 'bad' : 'warn' }, { text: decision, kind: '' }])}
      </span>
      <span class="subtle">${escapeHtml(suggestion.reason)}</span>
    </span>
  </label>`;
}

function correctionSuggestionBlock(suggestions) {
  if (!suggestions.length) return '<p class="subtle">No correction patch suggestions recorded.</p>';
  return `<div class="table-wrap">
    <table>
      <thead><tr><th>Part</th><th>Reason</th><th>Patch</th></tr></thead>
      <tbody>
        ${suggestions.map((suggestion) => `<tr>
          <td><code>${escapeHtml(suggestion.part_id)}</code></td>
          <td>${escapeHtml(suggestion.reason)}</td>
          <td><code>${escapeHtml(JSON.stringify(suggestion.patch))}</code></td>
        </tr>`).join('\n')}
      </tbody>
    </table>
  </div>`;
}

function graphPartRow(part) {
  const conflicts = (part.conflicts || []).map((conflict) => `${conflict.type}: ${conflict.note}`);
  const questions = part.open_questions || [];
  return `<tr>
    <td><code>${escapeHtml(part.part_id)}</code><br>${statusTag(part.status)}${part.template_prior ? '<br><span class="tag warn">template prior</span>' : ''}${part.manual_confirmed ? '<br><span class="tag good">manual confirmed</span>' : ''}</td>
    <td>${escapeHtml((part.required_views || []).join(', ') || 'none')}</td>
    <td>${escapeHtml((part.confirmed_views || []).join(', ') || 'none')}</td>
    <td>${escapeHtml((part.missing_views || []).join(', ') || 'none')}</td>
    <td>${escapeHtml([...conflicts, ...questions].join('; ') || 'none')}</td>
  </tr>`;
}

function correctionsSummary(corrections, modelPlan) {
  if (!corrections) return '<p class="subtle">No manual corrections file found.</p>';
  const applied = modelPlan?.review?.corrections_applied || [];
  const partLines = (corrections.parts || []).map((part) => `${part.action}:${part.id}${part.evidence_status ? ` -> ${part.evidence_status}` : ''}`);
  return [
    `<p>${tags([
    { text: `${corrections.parts?.length || 0} part corrections`, kind: corrections.parts?.length ? 'warn' : '' },
    { text: `${applied.length} applied`, kind: applied.length ? 'good' : '' }
  ])}</p>`,
    '<h3 style="margin-top:14px">Scale</h3>',
    `<p class="subtle">width ${corrections.scale?.known_width ?? 'unknown'} · height ${corrections.scale?.known_height ?? 'unknown'} · depth ${corrections.scale?.known_depth ?? 'unknown'} · confidence ${corrections.scale?.confidence ?? 'unknown'}</p>`,
    partLines.length ? `<h3 style="margin-top:14px">Part Patches</h3>${list(partLines)}` : '',
    corrections.notes?.length ? `<h3 style="margin-top:14px">Notes</h3>${list(corrections.notes)}` : ''
  ].filter(Boolean).join('\n  ');
}

function metric(label, value) {
  return `<div class="metric"><span class="subtle">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function tags(items) {
  return items.map((item) => `<span class="tag ${escapeHtml(item.kind || '')}">${escapeHtml(item.text)}</span>`).join('');
}

function statusTag(status) {
  const kind = status === 'observed' || status === 'manual_confirmed'
    ? 'good'
    : status === 'template_prior'
      ? 'bad'
      : 'warn';
  return `<span class="tag ${kind}">${escapeHtml(status)}</span>`;
}

function fusionStatusTag(status) {
  const kind = status === 'confirmed'
    ? 'good'
    : status === 'needs_review'
      ? 'bad'
      : 'warn';
  return `<span class="tag ${kind}">${escapeHtml(status || 'unknown')}</span>`;
}

function featureMappingTags(mapping) {
  if (!mapping) return '<span class="tag warn">feature op pending</span>';
  const operation = mapping.operation || 'unknown';
  const fallback = mapping.fallback || 'none';
  if (fallback === 'none') {
    return tags([{ text: `real feature op: ${operation}`, kind: 'good' }]);
  }
  return tags([
    { text: `fallback: ${fallback}`, kind: 'warn' },
    { text: `visual op: ${operation}`, kind: '' }
  ]);
}

function list(items) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function countOperations(operations) {
  return operations.reduce((counts, operation) => {
    counts[operation.op] = (counts[operation.op] || 0) + 1;
    return counts;
  }, {});
}

function summarizePartEvidence(parts, observations) {
  const statusCounts = { observed: 0, inferred: 0, template_prior: 0, manual_confirmed: 0 };
  const templatePriorParts = [];
  const manualConfirmedParts = [];
  for (const part of parts || []) {
    const status = part.evidence_status || legacyStatusToEvidenceStatus(part.status) || 'template_prior';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    if (part.template_prior) templatePriorParts.push(part.id);
    if (part.manual_confirmed || status === 'manual_confirmed') manualConfirmedParts.push(part.id);
  }
  return {
    image_count: observations.images?.length || 0,
    views_detected: observations.views_detected || [],
    missing_views: observations.missing_views || [],
    status_counts: statusCounts,
    template_prior_parts: templatePriorParts,
    manual_confirmed_parts: manualConfirmedParts
  };
}

function legacyStatusToEvidenceStatus(status) {
  if (status === 'visually_detected') return 'observed';
  if (status === 'manually_confirmed') return 'manual_confirmed';
  if (status === 'inferred') return 'inferred';
  return null;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--observations') options.observations = argv[++index];
    else if (arg === '--model-plan') options.modelPlan = argv[++index];
    else if (arg === '--output-dsl') options.outputDsl = argv[++index];
    else if (arg === '--manual-corrections') options.manualCorrections = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function toHtmlPath(value) {
  return value.split(path.sep).join('/');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeScriptJson(value) {
  return JSON.stringify(value || [])
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

function workbenchScript() {
  return `(() => {
  const dataNode = document.getElementById('correction-suggestions-data');
  const editor = document.getElementById('corrections-json');
  const status = document.getElementById('corrections-status');
  if (!dataNode || !editor || !status) return;

  let suggestions = [];
  try {
    suggestions = JSON.parse(dataNode.textContent || '[]');
  } catch {
    suggestions = [];
  }

  const checkboxes = () => Array.from(document.querySelectorAll('.correction-checkbox'));
  const selectedPatches = () => checkboxes()
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => suggestions[Number(checkbox.dataset.index)]?.patch)
    .filter(Boolean);
  const payloadFromSelection = () => ({
    version: 1,
    notes: ['Generated from review corrections workbench; merge reviewed patches into manual-corrections.json.'],
    parts: selectedPatches()
  });
  const setStatus = (message, kind = '') => {
    status.textContent = message;
    status.className = kind ? 'tag ' + kind : 'subtle';
  };
  const syncFromSelection = () => {
    const payload = payloadFromSelection();
    editor.value = JSON.stringify(payload, null, 2);
    setStatus(payload.parts.length + ' patch(es) selected');
  };
  const readEditorPayload = () => {
    const payload = JSON.parse(editor.value);
    if (payload.version !== 1) throw new Error('version must be 1');
    if (!Array.isArray(payload.parts)) throw new Error('parts must be an array');
    return payload;
  };

  document.getElementById('select-all-corrections')?.addEventListener('click', () => {
    for (const checkbox of checkboxes()) checkbox.checked = true;
    syncFromSelection();
  });
  document.getElementById('clear-corrections')?.addEventListener('click', () => {
    for (const checkbox of checkboxes()) checkbox.checked = false;
    syncFromSelection();
  });
  document.getElementById('validate-corrections')?.addEventListener('click', () => {
    try {
      const payload = readEditorPayload();
      setStatus('valid JSON with ' + payload.parts.length + ' patch(es)', 'good');
    } catch (error) {
      setStatus(error.message || 'invalid JSON', 'bad');
    }
  });
  document.getElementById('copy-corrections')?.addEventListener('click', async () => {
    try {
      readEditorPayload();
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(editor.value);
      } else {
        editor.select();
        document.execCommand('copy');
      }
      setStatus('copied JSON', 'good');
    } catch (error) {
      setStatus(error.message || 'copy failed', 'bad');
    }
  });
  document.getElementById('download-corrections')?.addEventListener('click', () => {
    try {
      readEditorPayload();
      const blob = new Blob([editor.value + '\\n'], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'manual-corrections.workbench.json';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setStatus('downloaded JSON', 'good');
    } catch (error) {
      setStatus(error.message || 'download failed', 'bad');
    }
  });
  for (const checkbox of checkboxes()) {
    checkbox.addEventListener('change', syncFromSelection);
  }
  syncFromSelection();
})();`;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/make-review-report.mjs \\
    --observations projects/image-structured-modeler/examples/switch-controller/observations.json \\
    --model-plan projects/image-structured-modeler/examples/switch-controller/model-plan.json \\
    --output-dsl projects/image-structured-modeler/examples/switch-controller/output.json \\
    --manual-corrections projects/image-structured-modeler/examples/switch-controller/manual-corrections.json \\
    --output projects/image-structured-modeler/examples/switch-controller/review/index.html
`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
