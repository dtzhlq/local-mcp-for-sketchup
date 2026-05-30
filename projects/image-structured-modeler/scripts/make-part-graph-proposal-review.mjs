#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from './lib/image-analysis.mjs';
import { summarizeCorrectionPatch } from './lib/part-graph-corrections.mjs';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const partGraphPath = path.resolve(repoRoot, options.partGraph || 'projects/image-structured-modeler/examples/ambulance/part-graph.skeleton.json');
  const acceptedReviewPath = path.resolve(repoRoot, options.acceptedReview || 'projects/image-structured-modeler/examples/ambulance/parameter-proposal-review.accepted.json');
  const patchPath = path.resolve(repoRoot, options.patch || 'projects/image-structured-modeler/examples/ambulance/correction-patch.parameter-proposals.json');
  const output = path.resolve(repoRoot, options.output || 'projects/image-structured-modeler/examples/ambulance/proposal-review/index.html');

  const partGraph = await readJson(partGraphPath);
  const acceptedReview = await readJsonIfExists(acceptedReviewPath);
  const patch = await readJsonIfExists(patchPath);
  const html = buildProposalReviewHtml({
    partGraph,
    acceptedReview,
    patch,
    sourcePaths: { partGraphPath, acceptedReviewPath, patchPath },
    output
  });

  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, html, 'utf8');
  process.stdout.write(`${JSON.stringify({ ok: true, output, proposals: collectParameterProposals(partGraph).length }, null, 2)}\n`);
}

export function buildProposalReviewHtml({ partGraph, acceptedReview = null, patch = null, sourcePaths = {}, output }) {
  const proposals = collectParameterProposals(partGraph);
  const acceptedKeys = acceptedProposalKeys(acceptedReview);
  const selectedCount = proposals.filter((proposal) => acceptedKeys.has(proposalKey(proposal)) || acceptedKeys.has(proposal.path)).length;
  const summary = partGraph.review?.parameter_proposal_summary || summarizeProposals(proposals);
  const statusCounts = countBy(proposals, 'status');
  const patchSummary = patch ? summarizeCorrectionPatch(patch) : null;
  const initialReview = acceptedReview || {
    version: 1,
    kind: 'parameter_proposal_review',
    target_part_graph_id: partGraph.id || null,
    reviewer: 'proposal-review-workbench',
    verdict: 'accepted_subset',
    accepted_proposals: []
  };
  const sourceLinks = Object.entries(sourcePaths)
    .filter(([, value]) => value)
    .map(([key, value]) => `<li><code>${escapeHtml(key)}</code>: <code>${escapeHtml(path.relative(repoRoot, value))}</code></li>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Parameter Proposal Review</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #18202b;
      --muted: #5d6878;
      --line: #d6dce5;
      --panel: #ffffff;
      --soft: #f4f7fa;
      --accent: #0f766e;
      --accent-soft: #e8f7f4;
      --warn: #9a5a00;
      --warn-soft: #fff6e6;
      --bad: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: #eef2f6;
      line-height: 1.45;
    }
    header {
      background: var(--panel);
      border-bottom: 1px solid var(--line);
      padding: 26px 32px 18px;
    }
    main {
      max-width: 1480px;
      margin: 0 auto;
      padding: 24px 32px 44px;
    }
    h1 {
      margin: 0 0 6px;
      font-size: 28px;
      line-height: 1.16;
      font-weight: 760;
      letter-spacing: 0;
    }
    h2 {
      margin: 0 0 12px;
      font-size: 18px;
      line-height: 1.25;
      font-weight: 720;
      letter-spacing: 0;
    }
    h3 {
      margin: 0 0 8px;
      font-size: 14px;
      line-height: 1.25;
      font-weight: 720;
      letter-spacing: 0;
    }
    p { margin: 0; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.92em;
    }
    .subtle { color: var(--muted); }
    .grid { display: grid; gap: 16px; }
    .summary {
      grid-template-columns: repeat(5, minmax(0, 1fr));
      margin-bottom: 18px;
    }
    .metric, .section {
      background: var(--panel);
      border: 1px solid var(--line);
    }
    .metric {
      min-height: 86px;
      padding: 13px;
    }
    .metric strong {
      display: block;
      margin-top: 6px;
      font-size: 24px;
      line-height: 1.1;
    }
    .section {
      padding: 18px;
      margin-bottom: 18px;
    }
    .two {
      grid-template-columns: minmax(280px, 0.8fr) minmax(360px, 1.2fr);
      align-items: start;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-bottom: 12px;
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
    button:focus-visible,
    textarea:focus-visible,
    input:focus-visible {
      outline: 2px solid #2563eb;
      outline-offset: 2px;
    }
    .tag {
      display: inline-block;
      max-width: 100%;
      margin: 0 5px 5px 0;
      padding: 2px 7px;
      border: 1px solid var(--line);
      background: #fff;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .tag.good {
      border-color: #9bd6ce;
      background: var(--accent-soft);
      color: #0f5f58;
    }
    .tag.warn {
      border-color: #e8c57f;
      background: var(--warn-soft);
      color: var(--warn);
    }
    .tag.bad {
      border-color: #efb2ac;
      background: #fff1f0;
      color: var(--bad);
    }
    .proposal-list {
      border: 1px solid var(--line);
      background: var(--soft);
      max-height: 720px;
      overflow: auto;
    }
    .proposal-item {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 10px;
      padding: 12px;
      border-bottom: 1px solid var(--line);
      background: #fff;
    }
    .proposal-item:last-child { border-bottom: 0; }
    .proposal-item input { margin-top: 3px; }
    .proposal-title {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
      margin-bottom: 8px;
    }
    .proposal-grid {
      display: grid;
      grid-template-columns: minmax(120px, 0.7fr) minmax(180px, 1fr);
      gap: 8px 12px;
      font-size: 13px;
    }
    .proposal-grid div:nth-child(odd) {
      color: var(--muted);
    }
    .value-box {
      max-height: 120px;
      overflow: auto;
      padding: 8px;
      background: var(--soft);
      border: 1px solid var(--line);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      line-height: 1.4;
    }
    textarea {
      width: 100%;
      min-height: 620px;
      resize: vertical;
      border: 1px solid var(--line);
      padding: 10px;
      color: var(--ink);
      background: #fff;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    ul {
      margin: 0;
      padding-left: 18px;
    }
    li + li { margin-top: 4px; }
    .status-line {
      min-height: 20px;
      color: var(--muted);
      font-size: 13px;
    }
    .table-wrap { overflow-x: auto; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
      border-bottom: 1px solid var(--line);
    }
    th {
      background: var(--soft);
      font-weight: 700;
    }
    @media (max-width: 980px) {
      header { padding: 22px 18px 14px; }
      main { padding: 18px; }
      .summary, .two, .proposal-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Parameter Proposal Review</h1>
    <p class="subtle">${escapeHtml(partGraph.name || partGraph.id || 'PartGraph')} - accepted proposals become a standard PartGraph correction patch.</p>
  </header>
  <main>
    <section class="grid summary">
      ${metric('Proposals', String(proposals.length))}
      ${metric('Parts Covered', String(summary.parts_with_proposals || unique(proposals.map((proposal) => proposal.part_id)).length))}
      ${metric('Review Required', String(summary.review_required || proposals.filter((proposal) => proposal.review_required).length))}
      ${metric('Accepted Fixture', String(selectedCount))}
      ${metric('Patch Edits', String(patchSummary?.total_edits || 0))}
    </section>

    <section class="grid two">
      <div class="section">
        <h2>Review Context</h2>
        <p>${tags(statusTagItems(statusCounts))}</p>
        <h3 style="margin-top:14px">Sources</h3>
        <ul>${sourceLinks || '<li>No source paths recorded.</li>'}</ul>
        <h3 style="margin-top:14px">Patch Summary</h3>
        ${patchSummaryBlock(patch, patchSummary)}
      </div>
      <div class="section">
        <h2>Accepted Review JSON</h2>
        <div class="toolbar">
          <button type="button" id="select-all-proposals">Select All</button>
          <button type="button" id="clear-proposals">Clear</button>
          <button type="button" class="primary" id="validate-accepted-proposals">Validate JSON</button>
          <button type="button" id="copy-accepted-proposals">Copy</button>
          <button type="button" id="download-accepted-proposals">Download</button>
        </div>
        <textarea id="accepted-proposals-json" spellcheck="false">${escapeHtml(JSON.stringify(initialReview, null, 2))}</textarea>
        <p class="status-line" id="proposal-review-status"></p>
      </div>
    </section>

    <section class="section">
      <h2>Proposal Queue</h2>
      <div class="proposal-list">
        ${proposals.map((proposal) => proposalBlock(proposal, acceptedKeys)).join('')}
      </div>
    </section>

    <section class="section">
      <h2>Accepted Patch Targets</h2>
      ${acceptedPatchTargets(patch)}
    </section>

    <script type="application/json" id="parameter-proposals-data">${escapeScriptJson(JSON.stringify({
      part_graph_id: partGraph.id || null,
      part_graph_name: partGraph.name || null,
      proposals
    }))}</script>
    <script type="application/json" id="accepted-review-meta">${escapeScriptJson(JSON.stringify(initialReview))}</script>
    <script>
      const proposalPayload = JSON.parse(document.getElementById('parameter-proposals-data').textContent);
      const reviewMeta = JSON.parse(document.getElementById('accepted-review-meta').textContent);
      const textArea = document.getElementById('accepted-proposals-json');
      const statusLine = document.getElementById('proposal-review-status');
      const checkboxes = Array.from(document.querySelectorAll('[data-proposal-key]'));

      function selectedProposals() {
        const selectedKeys = new Set(checkboxes.filter((item) => item.checked).map((item) => item.dataset.proposalKey));
        return proposalPayload.proposals
          .filter((proposal) => selectedKeys.has(proposal.part_id + '|' + proposal.path))
          .map((proposal) => ({
            part_id: proposal.part_id,
            path: proposal.path,
            reason: 'Accepted in Parameter Proposal Review UI.'
          }));
      }

      function currentReview() {
        return {
          version: 1,
          kind: 'parameter_proposal_review',
          target_part_graph_id: reviewMeta.target_part_graph_id || proposalPayload.part_graph_id,
          reviewer: reviewMeta.reviewer || 'proposal-review-workbench',
          verdict: selectedProposals().length ? 'accepted_subset' : 'needs_review',
          accepted_proposals: selectedProposals(),
          notes: reviewMeta.notes || []
        };
      }

      function refreshJson() {
        textArea.value = JSON.stringify(currentReview(), null, 2);
        statusLine.textContent = selectedProposals().length + ' proposal(s) selected.';
      }

      function validateJson() {
        try {
          const parsed = JSON.parse(textArea.value);
          if (parsed.kind !== 'parameter_proposal_review') throw new Error('kind must be parameter_proposal_review');
          if (!Array.isArray(parsed.accepted_proposals)) throw new Error('accepted_proposals must be an array');
          statusLine.textContent = 'Accepted review JSON is valid.';
        } catch (error) {
          statusLine.textContent = error.message;
        }
      }

      document.getElementById('select-all-proposals').addEventListener('click', () => {
        checkboxes.forEach((item) => { item.checked = true; });
        refreshJson();
      });
      document.getElementById('clear-proposals').addEventListener('click', () => {
        checkboxes.forEach((item) => { item.checked = false; });
        refreshJson();
      });
      document.getElementById('validate-accepted-proposals').addEventListener('click', validateJson);
      document.getElementById('copy-accepted-proposals').addEventListener('click', async () => {
        try {
          if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('Clipboard API unavailable');
          await navigator.clipboard.writeText(textArea.value);
          statusLine.textContent = 'Accepted review JSON copied.';
        } catch (_error) {
          textArea.focus();
          textArea.select();
          document.execCommand('copy');
          statusLine.textContent = 'Accepted review JSON selected and copied with browser fallback.';
        }
      });
      document.getElementById('download-accepted-proposals').addEventListener('click', () => {
        const blob = new Blob([textArea.value + '\\n'], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'parameter-proposal-review.accepted.json';
        link.click();
        URL.revokeObjectURL(link.href);
      });
      checkboxes.forEach((item) => item.addEventListener('change', refreshJson));
      refreshJson();
    </script>
  </main>
</body>
</html>`;
}

function proposalBlock(proposal, acceptedKeys) {
  const key = proposalKey(proposal);
  const checked = acceptedKeys.has(key) || acceptedKeys.has(proposal.path);
  const basis = Array.isArray(proposal.basis) ? proposal.basis : [];
  const measurements = Array.isArray(proposal.image_measurements) ? proposal.image_measurements : [];
  return `<article class="proposal-item">
    <input type="checkbox" data-proposal-key="${escapeHtml(key)}"${checked ? ' checked' : ''}>
    <div>
      <div class="proposal-title">
        <strong>${escapeHtml(proposal.part_id || 'unknown_part')}</strong>
        <span class="tag">${escapeHtml(proposal.parameter || proposal.path || 'parameter')}</span>
        <span class="tag ${proposal.review_required ? 'warn' : 'good'}">${escapeHtml(proposal.status || 'unknown')}</span>
        <span class="tag">${escapeHtml(String(proposal.confidence ?? 'n/a'))}</span>
      </div>
      <div class="proposal-grid">
        <div>Path</div><div><code>${escapeHtml(proposal.path || '')}</code></div>
        <div>Basis</div><div>${tags(basis.map((item) => ({ text: item, kind: 'good' }))) || '<span class="subtle">None</span>'}</div>
        <div>Views</div><div>${tags(viewTagItems(proposal)) || '<span class="subtle">None</span>'}</div>
        <div>Measurements</div><div>${escapeHtml(String(measurements.length))}</div>
        <div>Current Value</div><div class="value-box">${escapeHtml(stableJson(proposal.current_value))}</div>
        <div>Proposed Value</div><div class="value-box">${escapeHtml(stableJson(proposal.proposed_value))}</div>
      </div>
    </div>
  </article>`;
}

function patchSummaryBlock(patch, patchSummary) {
  if (!patch || !patchSummary) return '<p class="subtle">No generated proposal patch found yet.</p>';
  return `<ul>
    <li><code>source</code>: ${escapeHtml(patch.source || 'unknown')}</li>
    <li><code>report_verdict</code>: ${escapeHtml(patch.report_verdict || 'unknown')}</li>
    <li><code>set_edits</code>: ${escapeHtml(String(patchSummary.set_edits))}</li>
    <li><code>targets</code>: ${escapeHtml(patchSummary.targets.join(', ') || 'none')}</li>
  </ul>`;
}

function acceptedPatchTargets(patch) {
  const edits = patch?.edits || [];
  if (!edits.length) return '<p class="subtle">No accepted patch edits generated.</p>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>Part</th><th>Path</th><th>Action</th><th>Reason</th></tr></thead>
    <tbody>
      ${edits.map((edit) => `<tr>
        <td><code>${escapeHtml(edit.part_id || '')}</code></td>
        <td><code>${escapeHtml(edit.path || '')}</code></td>
        <td>${escapeHtml(edit.action || '')}</td>
        <td>${escapeHtml(edit.reason || '')}</td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

function collectParameterProposals(partGraph) {
  const proposals = [];
  for (const proposal of partGraph.review?.parameter_proposals || []) {
    if (proposal?.part_id && proposal?.path) proposals.push(proposal);
  }
  for (const part of partGraph.parts || []) {
    for (const proposal of part.parameter_proposals || []) {
      if (proposal?.part_id && proposal?.path) proposals.push(proposal);
    }
  }
  const seen = new Set();
  return proposals.filter((proposal) => {
    const key = proposalKey(proposal);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function acceptedProposalKeys(review = {}) {
  const accepted = new Set();
  for (const item of review?.accepted_proposals || []) {
    if (typeof item === 'string') {
      accepted.add(item);
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    if (item.part_id && item.path) accepted.add(proposalKey(item));
    if (item.path) accepted.add(item.path);
  }
  return accepted;
}

function summarizeProposals(proposals) {
  return {
    total: proposals.length,
    parts_with_proposals: unique(proposals.map((proposal) => proposal.part_id)).length,
    review_required: proposals.filter((proposal) => proposal.review_required).length,
    by_status: countBy(proposals, 'status')
  };
}

function statusTagItems(counts) {
  return Object.entries(counts).map(([status, count]) => ({
    text: `${status}: ${count}`,
    kind: status === 'needs_review' ? 'warn' : 'good'
  }));
}

function viewTagItems(proposal) {
  return [
    ...(proposal.confirmed_views || []).map((view) => ({ text: `confirmed:${view}`, kind: 'good' })),
    ...(proposal.missing_views || []).map((view) => ({ text: `missing:${view}`, kind: 'warn' })),
    ...(proposal.source_views || []).map((view) => ({ text: `source:${view}`, kind: '' }))
  ];
}

function metric(label, value) {
  return `<div class="metric"><span class="subtle">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function tags(items) {
  return items.map((item) => `<span class="tag ${escapeHtml(item.kind || '')}">${escapeHtml(item.text)}</span>`).join('');
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const value = item?.[key] || 'unknown';
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function stableJson(value) {
  if (value === undefined) return 'undefined';
  return JSON.stringify(value, null, 2);
}

function proposalKey(proposal) {
  return `${proposal.part_id}|${proposal.path}`;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeScriptJson(value) {
  return String(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--part-graph') options.partGraph = argv[++index];
    else if (arg === '--accepted-review') options.acceptedReview = argv[++index];
    else if (arg === '--patch') options.patch = argv[++index];
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

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/make-part-graph-proposal-review.mjs \\
    --part-graph projects/image-structured-modeler/examples/ambulance/part-graph.skeleton.json \\
    --accepted-review projects/image-structured-modeler/examples/ambulance/parameter-proposal-review.accepted.json \\
    --patch projects/image-structured-modeler/examples/ambulance/correction-patch.parameter-proposals.json \\
    --output projects/image-structured-modeler/examples/ambulance/proposal-review/index.html
`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
