import {
  prepareStructureLineEvidenceImageDataUrl,
  renderStructureLineEvidenceOverlaySvg
} from './opencv-structure-line-backend.mjs';

export const CALIBRATION_BENCHMARK_REPORT_KIND = 'calibration_benchmark_report_v1';

export function buildCalibrationBenchmarkReport({
  groundTruth,
  structureLineEvidence,
  perspectiveCalibration
} = {}) {
  const imageSize = structureLineEvidence.source_image;
  const annotatedLines = flattenTruthLines(groundTruth, imageSize);
  const segmentById = new Map(structureLineEvidence.raw_segments.map((segment) => [segment.id, segment]));
  const lineResults = annotatedLines.map((truthLine) => matchTruthLine({
    truthLine,
    segments: structureLineEvidence.raw_segments,
    policy: groundTruth.evaluation_policy
  }));
  const totalTruthLength = lineResults.reduce((sum, result) => sum + result.truth_length_px, 0);
  const coveredTruthLength = lineResults.reduce((sum, result) => sum + result.covered_length_px, 0);
  const structuralLengthCoverageRecall = totalTruthLength > 0 ? coveredTruthLength / totalTruthLength : 0;
  const horizontalTruthFamilies = groundTruth.axis_families.filter((family) => family.role === 'horizontal_axis');
  const predictedHorizontal = perspectiveCalibration.direction_families.filter((family) => family.role === 'horizontal_candidate');
  const familyAssignments = assignTruthToPredictedFamilies({
    truthFamilies: horizontalTruthFamilies,
    predictedFamilies: predictedHorizontal,
    imageSize,
    segmentById,
    policy: groundTruth.evaluation_policy
  });
  const distinctPredictedIds = new Set(familyAssignments
    .map((assignment) => assignment.predicted_family_id)
    .filter(Boolean));
  const lineRecallGate = structuralLengthCoverageRecall >= groundTruth.evaluation_policy.target_structural_length_coverage_recall;
  const twoFamiliesGate = horizontalTruthFamilies.length >= 2
    && familyAssignments.length >= 2
    && distinctPredictedIds.size >= 2
    && familyAssignments.every((assignment) => (
      assignment.directional_recall >= groundTruth.evaluation_policy.target_family_recall
    ));
  const spatialSupportGate = predictedHorizontal.length >= 2
    && predictedHorizontal.every((family) => family.spatial_cell_count >= 3 && family.support_count >= 5);
  const groundTruthAccepted = groundTruth.review_status === 'accepted';
  const blockers = [];
  if (!lineRecallGate) blockers.push('structural_line_coverage_recall_below_target');
  if (!twoFamiliesGate) blockers.push('two_review_truth_horizontal_families_not_recovered');
  if (!spatialSupportGate) blockers.push('predicted_direction_family_spatial_support_insufficient');
  if (!groundTruthAccepted) blockers.push('accepted_calibration_ground_truth_required_for_release_gate');
  let conclusion = 'pass';
  if (!groundTruthAccepted) conclusion = 'diagnostic_only_ground_truth_review_required';
  else if (!lineRecallGate) conclusion = 'fail_line_evidence';
  else if (!twoFamiliesGate || !spatialSupportGate) conclusion = 'fail_direction_families';
  return {
    kind: CALIBRATION_BENCHMARK_REPORT_KIND,
    version: 1,
    sample_id: groundTruth.sample_id,
    ground_truth_status: groundTruth.review_status,
    metrics: {
      annotated_line_count: annotatedLines.length,
      matched_line_count: lineResults.filter((result) => result.matched_segment_ids.length > 0).length,
      structural_length_coverage_recall: round(structuralLengthCoverageRecall),
      family_results: familyAssignments,
      line_results: lineResults
    },
    gates: {
      line_recall: lineRecallGate,
      two_horizontal_families: twoFamiliesGate,
      spatial_support: spatialSupportGate,
      accepted_ground_truth_required_for_release: groundTruthAccepted
    },
    false_promotion_count: 0,
    conclusion,
    blockers
  };
}

export async function renderCalibrationBenchmarkArtifacts({
  groundTruth,
  structureLineEvidence,
  perspectiveCalibration,
  report,
  sourceImagePath,
  topologySvg = null
} = {}) {
  const imageDataUrl = await prepareStructureLineEvidenceImageDataUrl(sourceImagePath);
  const evidenceSvg = renderStructureLineEvidenceOverlaySvg({
    evidence: structureLineEvidence,
    imageDataUrl
  });
  const familySvg = renderStructureLineEvidenceOverlaySvg({
    evidence: structureLineEvidence,
    calibration: perspectiveCalibration,
    imageDataUrl
  });
  const truthSvg = renderTruthReviewOverlaySvg({
    groundTruth,
    report,
    imageDataUrl
  });
  const html = renderCalibrationBenchmarkHtml({
    groundTruth,
    structureLineEvidence,
    perspectiveCalibration,
    report,
    familySvg,
    truthSvg,
    topologySvg
  });
  return { evidenceSvg, familySvg, truthSvg, html };
}

export function renderCalibrationBenchmarkMarkdown(report) {
  return `# Calibration Benchmark

- sample: \`${report.sample_id}\`
- ground_truth_status: \`${report.ground_truth_status}\`
- structural_length_coverage_recall: \`${report.metrics.structural_length_coverage_recall}\`
- two_horizontal_families: \`${String(report.gates.two_horizontal_families)}\`
- spatial_support: \`${String(report.gates.spatial_support)}\`
- false_promotion_count: \`${report.false_promotion_count}\`
- conclusion: \`${report.conclusion}\`

${report.blockers.length ? `Blockers: ${report.blockers.map((blocker) => `\`${blocker}\``).join(', ')}` : 'No benchmark blockers.'}
`;
}

function flattenTruthLines(groundTruth, imageSize) {
  return groundTruth.axis_families.flatMap((family) => family.support_lines.map((supportLine) => ({
    id: supportLine.id,
    truth_family_id: family.id,
    truth_axis_label: family.axis_label,
    role: family.role,
    line_px: {
      a: [supportLine.line_norm.a[0] * imageSize.width, supportLine.line_norm.a[1] * imageSize.height],
      b: [supportLine.line_norm.b[0] * imageSize.width, supportLine.line_norm.b[1] * imageSize.height]
    }
  })));
}

function matchTruthLine({ truthLine, segments, policy }) {
  const truthAngle = lineAngle(truthLine.line_px);
  const truthLength = lineLength(truthLine.line_px);
  const matching = segments.filter((segment) => {
    if (acuteAngleDelta(truthAngle, segment.angle_deg) > policy.line_match_max_angle_deg) return false;
    if (symmetricLineDistance(truthLine.line_px, segment.line_px) > policy.line_match_max_perpendicular_distance_px) return false;
    return projectedOverlapRatio(truthLine.line_px, segment.line_px) >= policy.line_match_min_overlap_ratio;
  });
  const intervals = matching.map((segment) => projectedInterval(truthLine.line_px, segment.line_px));
  const coveredLength = mergedIntervalLength(intervals, 0, truthLength);
  return {
    truth_line_id: truthLine.id,
    truth_family_id: truthLine.truth_family_id,
    truth_axis_label: truthLine.truth_axis_label,
    truth_length_px: round(truthLength),
    covered_length_px: round(coveredLength),
    coverage_recall: round(truthLength ? coveredLength / truthLength : 0),
    matched_segment_ids: matching.map((segment) => segment.id)
  };
}

function assignTruthToPredictedFamilies({
  truthFamilies,
  predictedFamilies,
  imageSize,
  segmentById,
  policy
}) {
  const pairScores = [];
  for (const truthFamily of truthFamilies) {
    const truthLines = truthFamily.support_lines.map((supportLine) => ({
      id: supportLine.id,
      line_px: {
        a: [supportLine.line_norm.a[0] * imageSize.width, supportLine.line_norm.a[1] * imageSize.height],
        b: [supportLine.line_norm.b[0] * imageSize.width, supportLine.line_norm.b[1] * imageSize.height]
      }
    }));
    for (const predictedFamily of predictedFamilies) {
      let matchedLength = 0;
      let totalLength = 0;
      const residuals = [];
      for (const truthLine of truthLines) {
        const length = lineLength(truthLine.line_px);
        const residual = familyResidualAtLine(predictedFamily, truthLine.line_px);
        totalLength += length;
        residuals.push(residual);
        if (residual <= policy.line_match_max_angle_deg) matchedLength += length;
      }
      const directionalRecall = totalLength ? matchedLength / totalLength : 0;
      const support = predictedFamily.support_segment_ids
        .map((id) => segmentById.get(id))
        .filter(Boolean);
      const annotatedSupportMatches = support.filter((segment) => truthLines.some((truthLine) => (
        acuteAngleDelta(segment.angle_deg, lineAngle(truthLine.line_px)) <= policy.line_match_max_angle_deg
        && symmetricLineDistance(segment.line_px, truthLine.line_px) <= policy.line_match_max_perpendicular_distance_px
      ))).length;
      pairScores.push({
        truth_family_id: truthFamily.id,
        truth_axis_label: truthFamily.axis_label,
        predicted_family_id: predictedFamily.id,
        directional_recall: directionalRecall,
        median_directional_residual_deg: median(residuals),
        annotated_support_precision_lower_bound: support.length ? annotatedSupportMatches / support.length : 0,
        score: directionalRecall * 100 - median(residuals)
      });
    }
  }
  const assignments = [];
  const usedPredicted = new Set();
  for (const truthFamily of truthFamilies) {
    const candidates = pairScores
      .filter((pair) => pair.truth_family_id === truthFamily.id && !usedPredicted.has(pair.predicted_family_id))
      .sort((a, b) => b.score - a.score);
    const best = candidates[0] || pairScores
      .filter((pair) => pair.truth_family_id === truthFamily.id)
      .sort((a, b) => b.score - a.score)[0];
    if (!best) {
      assignments.push({
        truth_family_id: truthFamily.id,
        truth_axis_label: truthFamily.axis_label,
        predicted_family_id: null,
        directional_recall: 0,
        median_directional_residual_deg: 90,
        annotated_support_precision_lower_bound: 0
      });
      continue;
    }
    usedPredicted.add(best.predicted_family_id);
    assignments.push({
      truth_family_id: best.truth_family_id,
      truth_axis_label: best.truth_axis_label,
      predicted_family_id: best.predicted_family_id,
      directional_recall: round(best.directional_recall),
      median_directional_residual_deg: round(best.median_directional_residual_deg),
      annotated_support_precision_lower_bound: round(best.annotated_support_precision_lower_bound)
    });
  }
  return assignments;
}

function renderTruthReviewOverlaySvg({ groundTruth, report, imageDataUrl }) {
  const width = groundTruth.image_size.width;
  const height = groundTruth.image_size.height;
  const resultById = new Map(report.metrics.line_results.map((result) => [result.truth_line_id, result]));
  const colors = new Map([
    ['axis_family_1', '#e11d48'],
    ['axis_family_2', '#0891b2'],
    ['vertical_family', '#7c3aed']
  ]);
  const lines = groundTruth.axis_families.flatMap((family) => family.support_lines.map((supportLine) => {
    const a = [supportLine.line_norm.a[0] * width, supportLine.line_norm.a[1] * height];
    const b = [supportLine.line_norm.b[0] * width, supportLine.line_norm.b[1] * height];
    const result = resultById.get(supportLine.id);
    const color = colors.get(family.axis_label) || '#111827';
    const midpoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return `<g data-layer="truth-line" data-family="${family.axis_label}" data-truth-line-id="${supportLine.id}">
      <line x1="${round(a[0])}" y1="${round(a[1])}" x2="${round(b[0])}" y2="${round(b[1])}" stroke="#ffffff" stroke-width="6" stroke-opacity="0.9"/>
      <line x1="${round(a[0])}" y1="${round(a[1])}" x2="${round(b[0])}" y2="${round(b[1])}" stroke="${color}" stroke-width="3" stroke-dasharray="8 4"/>
      <circle cx="${round(a[0])}" cy="${round(a[1])}" r="4" fill="${color}" stroke="#fff"/>
      <circle cx="${round(b[0])}" cy="${round(b[1])}" r="4" fill="${color}" stroke="#fff"/>
      <text x="${round(midpoint[0] + 5)}" y="${round(midpoint[1] - 5)}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11" fill="#111827" stroke="#fff" stroke-width="3" paint-order="stroke">${escapeXml(`${supportLine.id} coverage=${result?.coverage_recall ?? 0}`)}</text>
    </g>`;
  })).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <image href="${imageDataUrl}" width="${width}" height="${height}" preserveAspectRatio="none"/>
  <g data-layer="truth-review">${lines}</g>
  <rect x="10" y="10" width="550" height="48" fill="#ffffff" fill-opacity="0.92" stroke="#111827"/>
  <text x="18" y="29" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13">truth=${escapeXml(groundTruth.review_status)} line_recall=${report.metrics.structural_length_coverage_recall}</text>
  <text x="18" y="48" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" fill="#991b1b">benchmark=${escapeXml(report.conclusion)} promotion_allowed=false</text>
</svg>`;
}

function renderCalibrationBenchmarkHtml({
  groundTruth,
  structureLineEvidence,
  perspectiveCalibration,
  report,
  familySvg,
  truthSvg,
  topologySvg
}) {
  const familyRows = perspectiveCalibration.direction_families.map((family) => `<tr><td>${escapeXml(family.id)}</td><td>${escapeXml(family.role)}</td><td>${escapeXml(family.vanishing_type)}</td><td>${family.support_count}</td><td>${family.spatial_cell_count}</td><td>${family.median_angular_residual_deg}</td></tr>`).join('');
  const metricRows = report.metrics.family_results.map((family) => `<tr><td>${escapeXml(family.truth_axis_label)}</td><td>${escapeXml(family.predicted_family_id || 'missing')}</td><td>${family.directional_recall}</td><td>${family.median_directional_residual_deg}</td></tr>`).join('');
  const modelOptions = perspectiveCalibration.camera_model_candidates.map((model) => `<option value="${escapeXml(model.id)}">${escapeXml(`${model.model} confidence=${model.confidence}`)}</option>`).join('');
  const reviewRows = perspectiveCalibration.direction_families.map((family) => `<tr><td>${escapeXml(family.id)}</td><td>${escapeXml(family.role)}</td><td><select data-family-assignment="${escapeXml(family.id)}"><option value="">axis_unknown</option><option value="x_red">x_red</option><option value="y_green">y_green</option><option value="z_blue">z_blue</option><option value="reject">reject</option></select></td></tr>`).join('');
  const hypothesesJson = JSON.stringify({
    source: 'perspective-calibration-hypotheses.json',
    family_ids: perspectiveCalibration.direction_families.map((family) => family.id)
  }).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Calibration benchmark: ${escapeXml(groundTruth.sample_id)}</title>
<style>
body{margin:0;font:14px/1.45 system-ui,-apple-system,sans-serif;color:#172033;background:#eef1f4}header{padding:16px 22px;background:#fff;border-bottom:1px solid #cbd5e1}h1{font-size:20px;margin:0 0 6px}main{max-width:1500px;margin:auto;padding:18px}.status{display:flex;gap:20px;flex-wrap:wrap}.status b{font-family:ui-monospace,monospace}.views{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px}.panel{background:#fff;border:1px solid #cbd5e1;border-radius:6px;overflow:hidden}.panel h2{font-size:15px;margin:0;padding:10px 12px;border-bottom:1px solid #e2e8f0}.canvas{overflow:auto;background:#111}.canvas svg{display:block;width:100%;height:auto}.controls{padding:10px 12px;display:flex;gap:12px;flex-wrap:wrap;border-bottom:1px solid #e2e8f0}table{width:100%;border-collapse:collapse}th,td{padding:7px 9px;border-bottom:1px solid #e2e8f0;text-align:left;font-size:12px}code{font-family:ui-monospace,monospace}@media(max-width:900px){.views{grid-template-columns:1fr}}
</style>
</head>
<body>
<header><h1>Calibration benchmark: ${escapeXml(groundTruth.sample_id)}</h1><div class="status"><span>truth <b>${escapeXml(groundTruth.review_status)}</b></span><span>raw/eligible/seed <b>${structureLineEvidence.summary.raw_segment_count}/${structureLineEvidence.summary.eligible_segment_count}/${structureLineEvidence.summary.seed_segment_count}</b></span><span>line recall <b>${report.metrics.structural_length_coverage_recall}</b></span><span>result <b>${escapeXml(report.conclusion)}</b></span><span>promotion <b>false</b></span></div></header>
<main>
<div class="views">
  <section class="panel"><h2>Predicted direction-family support</h2><div class="controls"><label><input type="checkbox" data-toggle="raw-segment"/> raw</label><label><input type="checkbox" checked data-toggle="eligible-segment"/> eligible</label><label><input type="checkbox" checked data-toggle="seed-segment"/> seeds</label><label><input type="checkbox" checked data-toggle="vp-family-support"/> family support</label></div><div class="canvas" id="family-canvas">${familySvg}</div></section>
  <section class="panel"><h2>User-reference truth draft</h2><div class="canvas">${truthSvg}</div></section>
  <section class="panel"><h2>Predicted families</h2><table><thead><tr><th>id</th><th>role</th><th>VP type</th><th>support</th><th>cells</th><th>median residual</th></tr></thead><tbody>${familyRows}</tbody></table></section>
  <section class="panel"><h2>Truth-family matching</h2><table><thead><tr><th>truth</th><th>prediction</th><th>directional recall</th><th>median residual</th></tr></thead><tbody>${metricRows}</tbody></table></section>
  ${topologySvg ? `<section class="panel"><h2>Accepted-calibration plane topology candidate</h2><div class="canvas">${topologySvg}</div></section>` : ''}
  <section class="panel"><h2>Calibration review export</h2><div class="controls"><label>Status <select id="review-status"><option value="not_accepted">not_accepted</option><option value="accepted_for_rectification">accepted_for_rectification</option></select></label><label>Camera model <select id="camera-model">${modelOptions}</select></label><button id="export-review" type="button">Export review JSON</button></div><table><thead><tr><th>direction family</th><th>role</th><th>axis decision</th></tr></thead><tbody>${reviewRows}</tbody></table><pre id="review-validation" style="margin:0;padding:10px 12px;white-space:pre-wrap;color:#991b1b">promotion_allowed=false compile_allowed=false</pre></section>
</div>
</main>
<script>
for(const input of document.querySelectorAll('[data-toggle]')){const update=()=>{const layer=input.dataset.toggle;for(const node of document.querySelectorAll('#family-canvas [data-layer="'+layer+'"]'))node.style.display=input.checked?'':'none'};input.addEventListener('change',update);update()}
const hypothesisMeta=${hypothesesJson};
window.buildCalibrationReviewDecision=()=>{const status=document.querySelector('#review-status').value;const familyDecisions=[...document.querySelectorAll('[data-family-assignment]')].map(select=>{const value=select.value;return{direction_family_id:select.dataset.familyAssignment,decision:value===''?'axis_unknown':value==='reject'?'reject':'assign_axis',assigned_axis:value===''||value==='reject'?null:value,reviewer_confidence:value===''?0:.9,reason:value===''?'pending_calibration_review':'review_workbench_export'}});return{kind:'perspective_calibration_review_decision_v1',version:1,source_perspective_calibration_hypotheses:hypothesisMeta.source,reviewer:'calibration-review-workbench',status,accepted_camera_model_candidate_id:status==='accepted_for_rectification'?document.querySelector('#camera-model').value:null,family_decisions:familyDecisions,fixture_only:false,promotion_allowed:false,compile_allowed:false,notes:['Exported from calibration benchmark workbench.','No geometry promotion is authorized by this review.']}};
document.querySelector('#export-review').addEventListener('click',()=>{const review=window.buildCalibrationReviewDecision();const assigned=review.family_decisions.filter(item=>item.decision==='assign_axis').map(item=>item.assigned_axis);const unique=new Set(assigned);const valid=review.status==='not_accepted'||assigned.length===3&&unique.size===3;if(!valid){document.querySelector('#review-validation').textContent='Accepted review requires one x_red, one y_green, and one z_blue assignment. promotion_allowed=false';return}document.querySelector('#review-validation').textContent='Review JSON exported. promotion_allowed=false compile_allowed=false';const blob=new Blob([JSON.stringify(review,null,2)+'\\n'],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='perspective-calibration-review.json';link.click();URL.revokeObjectURL(link.href)});
</script>
</body>
</html>`;
}

function familyResidualAtLine(family, line) {
  const midpoint = lineMidpoint(line);
  const truthAngle = lineAngle(line);
  if (family.vanishing_type === 'finite' && family.vanishing_point_px) {
    const vp = family.vanishing_point_px;
    return acuteAngleDelta(truthAngle, vectorAngle([vp[0] - midpoint[0], vp[1] - midpoint[1]]));
  }
  if (family.image_direction_px) {
    return acuteAngleDelta(truthAngle, vectorAngle(family.image_direction_px));
  }
  return 90;
}

function symmetricLineDistance(first, second) {
  return Math.min(
    (pointLineDistance(first.a, second) + pointLineDistance(first.b, second)) / 2,
    (pointLineDistance(second.a, first) + pointLineDistance(second.b, first)) / 2
  );
}

function pointLineDistance(point, line) {
  const dx = line.b[0] - line.a[0];
  const dy = line.b[1] - line.a[1];
  const denominator = Math.max(1e-9, Math.hypot(dx, dy));
  return Math.abs(dy * point[0] - dx * point[1] + line.b[0] * line.a[1] - line.b[1] * line.a[0]) / denominator;
}

function projectedOverlapRatio(first, second) {
  const firstLength = lineLength(first);
  const secondLength = lineLength(second);
  const firstInterval = projectedInterval(first, second);
  const overlap = Math.max(0, Math.min(firstLength, firstInterval[1]) - Math.max(0, firstInterval[0]));
  return overlap / Math.max(1, Math.min(firstLength, secondLength));
}

function projectedInterval(reference, candidate) {
  const length = lineLength(reference);
  const direction = [(reference.b[0] - reference.a[0]) / length, (reference.b[1] - reference.a[1]) / length];
  return [
    dot([candidate.a[0] - reference.a[0], candidate.a[1] - reference.a[1]], direction),
    dot([candidate.b[0] - reference.a[0], candidate.b[1] - reference.a[1]], direction)
  ].sort((a, b) => a - b);
}

function mergedIntervalLength(intervals, minimum, maximum) {
  const clipped = intervals
    .map(([start, end]) => [Math.max(minimum, start), Math.min(maximum, end)])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let active = null;
  for (const interval of clipped) {
    if (!active) {
      active = [...interval];
      continue;
    }
    if (interval[0] <= active[1]) {
      active[1] = Math.max(active[1], interval[1]);
    } else {
      total += active[1] - active[0];
      active = [...interval];
    }
  }
  if (active) total += active[1] - active[0];
  return total;
}

function lineAngle(line) {
  let angle = Math.atan2(line.b[1] - line.a[1], line.b[0] - line.a[0]) * 180 / Math.PI;
  while (angle >= 90) angle -= 180;
  while (angle < -90) angle += 180;
  return angle;
}

function vectorAngle(vector) {
  let angle = Math.atan2(vector[1], vector[0]) * 180 / Math.PI;
  while (angle >= 90) angle -= 180;
  while (angle < -90) angle += 180;
  return angle;
}

function lineLength(line) {
  return Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1]);
}

function lineMidpoint(line) {
  return [(line.a[0] + line.b[0]) / 2, (line.a[1] + line.b[1]) / 2];
}

function acuteAngleDelta(first, second) {
  let delta = Math.abs(first - second) % 180;
  if (delta > 90) delta = 180 - delta;
  return delta;
}

function dot(first, second) {
  return first[0] * second[0] + first[1] * second[1];
}

function median(values) {
  if (!values.length) return 90;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function round(value) {
  return Number(Number(value || 0).toFixed(3));
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
