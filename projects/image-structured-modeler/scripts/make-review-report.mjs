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
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
    th { background: var(--soft); font-weight: 700; }
    ul { margin: 0; padding-left: 18px; }
    li + li { margin-top: 4px; }
    .mono-list li { word-break: break-word; }
    @media (max-width: 900px) {
      header { padding: 22px 18px 14px; }
      main { padding: 18px; }
      .summary, .two, .image-grid { grid-template-columns: 1fr; }
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
      <h2>Review Overlays</h2>
      <div class="grid image-grid">
        ${(observations.images || []).map((image) => imageBlock(image, overlayDir, reportDir)).join('\n')}
      </div>
    </section>

    <section class="section">
      <h2>Model Plan Parts</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Part</th><th>Type</th><th>Material</th><th>Evidence</th><th>Uncertainty</th></tr></thead>
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
  return `<article class="image-block">
${overlayLine ? `    ${overlayLine}\n` : ''}    <div class="image-body">
      <h3>${escapeHtml(path.basename(image.image.path))}</h3>
      <p>${tags([{ text: image.detected_view.kind, kind: 'good' }, { text: `confidence ${image.detected_view.confidence}`, kind: '' }])}</p>
      <p class="subtle">edges ${image.metrics?.edge_count || 0} · density ${image.metrics?.edge_density || 0} · symmetry ${image.metrics?.symmetry_score || 0}</p>
      <h3 style="margin-top:12px">Component Candidates</h3>
      <p>${tags(componentHints.map((hint) => ({ text: hint, kind: '' }))) || '<span class="subtle">None</span>'}</p>
      ${image.quality_report?.risks?.length ? `<h3 style="margin-top:12px">Risks</h3>${list(image.quality_report.risks)}` : ''}
    </div>
  </article>`;
}

function partRow(part) {
  const evidence = (part.evidence || []).map((item) => `${item.view}:${item.kind}`).join(', ');
  return `<tr>
    <td><code>${escapeHtml(part.id)}</code></td>
    <td>${escapeHtml(part.type)}</td>
    <td>${escapeHtml(part.material)}</td>
    <td>${escapeHtml(evidence || 'none')}</td>
    <td>${escapeHtml((part.uncertainty || []).join('; ') || '')}</td>
  </tr>`;
}

function correctionsSummary(corrections, modelPlan) {
  if (!corrections) return '<p class="subtle">No manual corrections file found.</p>';
  const applied = modelPlan?.review?.corrections_applied || [];
  return `<p>${tags([
    { text: `${corrections.parts?.length || 0} part corrections`, kind: corrections.parts?.length ? 'warn' : '' },
    { text: `${applied.length} applied`, kind: applied.length ? 'good' : '' }
  ])}</p>
  <h3 style="margin-top:14px">Scale</h3>
  <p class="subtle">width ${corrections.scale?.known_width ?? 'unknown'} · height ${corrections.scale?.known_height ?? 'unknown'} · depth ${corrections.scale?.known_depth ?? 'unknown'} · confidence ${corrections.scale?.confidence ?? 'unknown'}</p>
  ${corrections.notes?.length ? `<h3 style="margin-top:14px">Notes</h3>${list(corrections.notes)}` : ''}`;
}

function metric(label, value) {
  return `<div class="metric"><span class="subtle">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function tags(items) {
  return items.map((item) => `<span class="tag ${escapeHtml(item.kind || '')}">${escapeHtml(item.text)}</span>`).join('');
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
