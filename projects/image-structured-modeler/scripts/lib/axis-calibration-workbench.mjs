import fs from 'node:fs/promises';
import path from 'node:path';
import { YELLOW_CORNER_CHAIN_TRUTH } from './calibration-first-graphs.mjs';
import { lineCandidatesFromDetectedStructureLines } from './detected-structure-lines.mjs';

export const AXIS_CALIBRATION_WORKBENCH_KIND = 'axis_calibration_workbench_v1';
export const AXIS_CALIBRATION_REVIEW_DECISION_KIND = 'axis_calibration_review_decision_v1';
export const AXIS_CALIBRATION_RESULT_KIND = 'axis_calibration_result_v1';

const AXES = ['x_red', 'y_green', 'z_blue'];

export function buildYellowAxisCalibrationWorkbench({
  detectedStructureLines,
  structuralProjection,
  sourceImage,
  profileId = 'building_single'
} = {}) {
  const imageSize = structuralProjection?.image_size || { width: 900, height: 589 };
  const source = sourceImage || structuralProjection?.source_image || '';
  const candidates = [];
  if (detectedStructureLines?.kind === 'detected_structure_lines_v1') {
    candidates.push(...lineCandidatesFromDetectedStructureLines(detectedStructureLines));
  }
  const cornerById = new Map(YELLOW_CORNER_CHAIN_TRUTH.corners.map((corner) => [corner.id, corner]));
  for (const edge of YELLOW_CORNER_CHAIN_TRUTH.edges) {
    const from = cornerById.get(edge.from);
    const to = cornerById.get(edge.to);
    candidates.push(makeLineCandidate({
      id: `candidate_corner_${edge.id}`,
      sourceImage: source,
      line: { a: from.point_px, b: to.point_px },
      sourceKind: 'corner_chain_line_candidate',
      familyHint: null,
      sourceEvidenceIds: [`yellow_corner_chain_edge_${edge.id}`],
      confidence: 0.62,
      notes: [
        `Seeded corner-chain edge ${edge.id}; axis assignment intentionally unknown until review.`,
        'Hint only. Do not infer red/green axis or VP clusters from topology alone.'
      ]
    }));
  }
  for (const line of structuralProjection?.lines || []) {
    if (!['vertical', 'primary_facade_width_axis', 'side_depth_axis'].includes(line.family)) continue;
    candidates.push(makeLineCandidate({
      id: `candidate_structural_${line.id}`,
      sourceImage: source,
      line: line.fitted_line_px || line.seed_line_px,
      sourceKind: 'structural_line_fit_candidate',
      familyHint: line.family,
      sourceEvidenceIds: [line.id],
      confidence: Number(line.support_score || 0),
      notes: [
        `seeded source role=${line.role || 'unknown'}`,
        'Hint only. Seeded line-fit family must not create red/green VP clusters.'
      ]
    }));
  }
  const lineCandidates = uniqueById(candidates);
  return {
    kind: AXIS_CALIBRATION_WORKBENCH_KIND,
    version: 1,
    profile_id: profileId,
    source_image: {
      id: 'source_image_1',
      source_image: source,
      width: Number(imageSize.width || 0),
      height: Number(imageSize.height || 0)
    },
    source_structure_evidence_graph: 'structure-evidence-graph.json',
    projection_model_candidates: [
      'two_point_vertical_parallel',
      'shifted_lens_off_axis',
      'post_rectified_unknown',
      'perspective_3vp'
    ],
    line_candidates: lineCandidates,
    origin_candidates: [
      {
        id: 'candidate_origin_C_or_reviewed_ground_corner',
        point_px: cornerById.get('C').point_px.map((value) => round(value)),
        review_required: true,
        notes: ['Candidate origin only; do not use until axis review is accepted.']
      }
    ],
    quality_policy: {
      min_lines_per_axis: {
        x_red: 2,
        y_green: 2,
        z_blue: 1
      },
      min_finite_axis_families: 2,
      vertical_parallel_allowed: true,
      required_before_topology: true,
      vp_clusters_must_come_from_detected_lines: true
    },
    review_policy: {
      status: lineCandidates.length ? 'needs_axis_review' : 'blocked_no_line_candidates',
      accepted_axis_review_required: true,
      review_required: true,
      derived_drafting_allowed: false,
      promotion_allowed: false,
      compile_allowed: false,
      blockers: [
        'accepted_axis_calibration_review_required',
        ...(detectedStructureLines?.qa?.usable_for_axis_calibration === true ? [] : ['detected_structure_vp_clusters_required']),
        'calibrated_view_graph_blocked_until_axis_review',
        'corner_chain_topology_blocked_until_axis_review'
      ]
    },
    summary: {
      line_candidate_count: lineCandidates.length,
      accepted_line_count: 0,
      review_required: true,
      derived_drafting_allowed: false,
      promotion_allowed: false,
      compile_allowed: false
    },
    detected_structure_lines: detectedStructureLines ? {
      source: 'detected-structure-lines.json',
      status: detectedStructureLines.qa?.status || 'unknown',
      usable_for_axis_calibration: detectedStructureLines.qa?.usable_for_axis_calibration === true,
      line_candidate_count: detectedStructureLines.summary?.line_candidate_count || 0,
      vp_cluster_count: detectedStructureLines.summary?.vp_cluster_count || 0,
      accepted_vp_cluster_count: detectedStructureLines.summary?.accepted_vp_cluster_count || 0,
      blockers: detectedStructureLines.qa?.blockers || []
    } : {
      source: null,
      status: 'not_available',
      usable_for_axis_calibration: false,
      line_candidate_count: 0,
      vp_cluster_count: 0,
      accepted_vp_cluster_count: 0,
      blockers: ['detected_structure_lines_missing']
    }
  };
}

export function buildPendingAxisCalibrationReviewDecision({ workbench } = {}) {
  return {
    kind: AXIS_CALIBRATION_REVIEW_DECISION_KIND,
    version: 1,
    source_axis_calibration_workbench: 'axis-calibration-workbench.json',
    reviewer: 'axis-calibration-template',
    status: 'not_accepted',
    accepted_projection_model: null,
    line_decisions: (workbench?.line_candidates || []).map((candidate) => ({
      line_candidate_id: candidate.id,
      decision: 'axis_unknown',
      assigned_axis: null,
      reviewer_confidence: 0,
      reason: 'pending_axis_review'
    })),
    origin_candidate_id: null,
    promotion_allowed: false,
    compile_allowed: false,
    blockers: ['accepted_axis_calibration_review_required'],
    notes: [
      'Template/pending review. Assign each line to x_red, y_green, z_blue, or reject before deriving any topology.'
    ]
  };
}

export function buildPreviousHardcodedYellowAxisReviewDecision({ workbench } = {}) {
  const red = new Set(['candidate_corner_AB', 'candidate_corner_CD']);
  const green = new Set(['candidate_corner_BC']);
  return {
    kind: AXIS_CALIBRATION_REVIEW_DECISION_KIND,
    version: 1,
    source_axis_calibration_workbench: 'axis-calibration-workbench.json',
    reviewer: 'previous-hardcoded-axis-example',
    status: 'accepted_for_calibration',
    accepted_projection_model: 'two_point_vertical_parallel',
    line_decisions: (workbench?.line_candidates || []).map((candidate) => {
      let assignedAxis = null;
      if (red.has(candidate.id)) assignedAxis = 'x_red';
      if (green.has(candidate.id)) assignedAxis = 'y_green';
      if (candidate.source_family_hint === 'vertical') assignedAxis = 'z_blue';
      return {
        line_candidate_id: candidate.id,
        decision: assignedAxis ? 'assign_axis' : 'reject',
        assigned_axis: assignedAxis,
        reviewer_confidence: assignedAxis ? 0.5 : 0.4,
        reason: assignedAxis
          ? 'previous_hardcoded_assignment_example_must_still_pass_support_gate'
          : 'not_used_in_previous_hardcoded_axis_assignment'
      };
    }),
    origin_candidate_id: 'candidate_origin_C_or_reviewed_ground_corner',
    promotion_allowed: false,
    compile_allowed: false,
    blockers: ['accepted_partgraph_promotion_review_required'],
    notes: [
      'This intentionally mirrors the earlier hard-coded AB/CD red and BC green assignment.',
      'The evaluator must block it because y_green has only one accepted line.'
    ]
  };
}

export function buildAcceptedAxisCalibrationReviewFixture({ workbench } = {}) {
  const red = new Set([
    'candidate_structural_yellow_primary_roof_front_edge',
    'candidate_structural_yellow_primary_street_base_edge'
  ]);
  const green = new Set([
    'candidate_structural_yellow_side_roof_front_edge',
    'candidate_structural_yellow_side_street_base_edge'
  ]);
  return {
    kind: AXIS_CALIBRATION_REVIEW_DECISION_KIND,
    version: 1,
    source_axis_calibration_workbench: 'axis-calibration-workbench.json',
    reviewer: 'axis-calibration-positive-fixture',
    status: 'accepted_for_calibration',
    accepted_projection_model: 'two_point_vertical_parallel',
    line_decisions: (workbench?.line_candidates || []).map((candidate) => {
      let assignedAxis = null;
      if (red.has(candidate.id)) assignedAxis = 'x_red';
      if (green.has(candidate.id)) assignedAxis = 'y_green';
      if (candidate.source_family_hint === 'vertical') assignedAxis = 'z_blue';
      return {
        line_candidate_id: candidate.id,
        decision: assignedAxis ? 'assign_axis' : 'reject',
        assigned_axis: assignedAxis,
        reviewer_confidence: assignedAxis ? 0.72 : 0.48,
        reason: assignedAxis
          ? 'fixture_accepts_two_or_more_lines_for_this_axis_family'
          : 'not_needed_for_positive_axis_calibration_fixture'
      };
    }),
    origin_candidate_id: 'candidate_origin_C_or_reviewed_ground_corner',
    promotion_allowed: false,
    compile_allowed: false,
    blockers: ['accepted_partgraph_promotion_review_required'],
    notes: [
      'Positive fixture for the gate mechanics only. It proves the route can pass when each axis family has enough accepted line support.'
    ]
  };
}

export function evaluateAxisCalibrationReview({ workbench, reviewDecision } = {}) {
  const candidateById = new Map((workbench?.line_candidates || []).map((candidate) => [candidate.id, candidate]));
  const acceptedByAxis = new Map(AXES.map((axis) => [axis, []]));
  for (const decision of reviewDecision?.line_decisions || []) {
    if (decision.decision !== 'assign_axis' || !decision.assigned_axis) continue;
    const candidate = candidateById.get(decision.line_candidate_id);
    if (!candidate) continue;
    acceptedByAxis.get(decision.assigned_axis)?.push(candidate);
  }
  const policy = workbench?.quality_policy?.min_lines_per_axis || { x_red: 2, y_green: 2, z_blue: 1 };
  const axisSupport = AXES.map((axis) => {
    const accepted = acceptedByAxis.get(axis) || [];
    const required = Number(policy[axis] || 0);
    const verticalInfinite = axis === 'z_blue' && workbench?.quality_policy?.vertical_parallel_allowed === true;
    const vanishingPoint = accepted.length >= 2 && !verticalInfinite
      ? lineIntersection(accepted[0].line_px, accepted[1].line_px)
      : null;
    return {
      axis,
      accepted_line_ids: accepted.map((candidate) => candidate.id),
      line_count: accepted.length,
      required_line_count: required,
      support_ok: accepted.length >= required,
      vanishing_type: verticalInfinite && accepted.length >= required ? 'infinite' : vanishingPoint ? 'finite' : 'unknown',
      vanishing_point_px: vanishingPoint ? vanishingPoint.map((value) => round(value)) : null
    };
  });
  const blockers = [];
  if (reviewDecision?.status !== 'accepted_for_calibration') {
    blockers.push('accepted_axis_calibration_review_required');
  }
  if (
    workbench?.quality_policy?.vp_clusters_must_come_from_detected_lines === true
    && workbench?.detected_structure_lines?.usable_for_axis_calibration !== true
  ) {
    blockers.push('accepted_vanishing_point_cluster_review_required');
  }
  for (const support of axisSupport) {
    if (!support.support_ok) {
      blockers.push(`insufficient_${support.axis}_axis_lines`);
    }
  }
  const finiteAxisCount = axisSupport.filter((support) => support.vanishing_type === 'finite').length;
  const minFinite = Number(workbench?.quality_policy?.min_finite_axis_families || 0);
  if (reviewDecision?.status === 'accepted_for_calibration' && finiteAxisCount < minFinite) {
    blockers.push('insufficient_finite_axis_families');
  }
  const uniqueBlockers = uniqueStrings(blockers);
  const accepted = reviewDecision?.status === 'accepted_for_calibration' && uniqueBlockers.length === 0;
  return {
    kind: AXIS_CALIBRATION_RESULT_KIND,
    version: 1,
    source_axis_calibration_workbench: 'axis-calibration-workbench.json',
    source_axis_calibration_review_decision: reviewDecision?.source_axis_calibration_workbench
      ? reviewDecisionPathForStatus(reviewDecision)
      : 'axis-calibration-review.pending.json',
    status: accepted
      ? 'accepted_for_derived_drafting'
      : reviewDecision?.status === 'accepted_for_calibration'
        ? 'blocked_insufficient_axis_support'
        : 'blocked_no_accepted_axis_review',
    accepted_projection_model: reviewDecision?.accepted_projection_model || null,
    axis_support: axisSupport,
    blockers: uniqueBlockers,
    derived_drafting_allowed: accepted,
    promotion_allowed: false,
    compile_allowed: false,
    summary: {
      accepted_line_count: axisSupport.reduce((sum, support) => sum + support.line_count, 0),
      review_required: true,
      derived_drafting_allowed: accepted,
      promotion_allowed: false,
      compile_allowed: false
    }
  };
}

export function buildCalibratedViewGraphFromAxisCalibrationReview({
  workbench,
  reviewDecision
} = {}) {
  const result = evaluateAxisCalibrationReview({ workbench, reviewDecision });
  const candidateById = new Map((workbench?.line_candidates || []).map((candidate) => [candidate.id, candidate]));
  const sourceImage = workbench?.source_image || { id: 'source_image_1', source_image: '', width: 0, height: 0 };
  const accepted = result.status === 'accepted_for_derived_drafting';
  const axisFamilies = result.axis_support.map((support) => {
    const candidates = support.accepted_line_ids.map((id) => candidateById.get(id)).filter(Boolean);
    return {
      id: `axis_family_${support.axis}`,
      axis: support.axis,
      label: axisLabel(support.axis),
      image_line_ids: support.accepted_line_ids,
      source_evidence_ids: candidates.flatMap((candidate) => candidate.source_evidence_ids || []),
      image_lines_px: candidates.map((candidate) => candidate.line_px),
      vanishing_type: support.vanishing_type,
      vanishing_point_px: support.vanishing_point_px,
      image_direction_px: support.axis === 'z_blue' && support.vanishing_type === 'infinite' ? { a: [0, 0], b: [0, 1] } : null,
      confidence: accepted && support.support_ok ? 0.72 : 0,
      review_required: true,
      promotion_allowed: false,
      notes: accepted
        ? ['Axis family comes from accepted axis calibration review.']
        : ['Blocked placeholder: axis family is not accepted for derived drafting.']
    };
  });
  return {
    kind: 'calibrated_view_graph_v1',
    version: 1,
    profile_id: workbench?.profile_id || 'building_single',
    coordinate_convention: 'image_x_right_y_down_world_z_up',
    source_structure_evidence_graph: workbench?.source_structure_evidence_graph || 'structure-evidence-graph.json',
    projection_model: accepted
      ? reviewDecision.accepted_projection_model
      : 'post_rectified_unknown',
    source_images: [sourceImage],
    axis_families: axisFamilies,
    horizon_line_px: horizonLineFromAxisSupport(result.axis_support),
    origin_candidates: workbench?.origin_candidates?.map((origin) => ({
      id: origin.id,
      source_image: sourceImage.source_image,
      point_px: origin.point_px,
      confidence: accepted ? 0.55 : 0,
      review_required: true
    })) || [],
    scale_anchors: [],
    projection_warnings: accepted
      ? ['axis_calibration_review_accepted_for_derived_drafting_only']
      : ['axis_calibration_review_missing_or_insufficient_do_not_derive_topology'],
    review_policy: {
      status: accepted ? 'accepted_for_derived_drafting' : 'needs_calibrated_view_review',
      accepted_calibrated_view_review_required: true,
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false,
      blockers: accepted
        ? ['accepted_partgraph_promotion_review_required']
        : result.blockers
    },
    summary: {
      axis_family_count: axisFamilies.length,
      finite_vanishing_point_count: axisFamilies.filter((axis) => axis.vanishing_type === 'finite').length,
      infinite_axis_count: axisFamilies.filter((axis) => axis.vanishing_type === 'infinite').length,
      projection_model: accepted ? reviewDecision.accepted_projection_model : 'post_rectified_unknown',
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false
    }
  };
}

export function buildBlockedCornerChainTopologyGate({ axisResult } = {}) {
  return {
    kind: 'corner_chain_topology_gate_report_v1',
    version: 1,
    status: 'blocked_axis_calibration_required',
    source_axis_calibration_result: 'axis-calibration-result.pending.json',
    blockers: [
      ...(axisResult?.blockers || []),
      'accepted_axis_calibration_review_required_before_corner_topology'
    ],
    corner_chain_topology_allowed: false,
    plan_projection_allowed: false,
    promotion_allowed: false,
    compile_allowed: false
  };
}

export function renderAxisCalibrationWorkbenchMarkdown(workbench) {
  return `# Axis Calibration Workbench

- kind: \`${workbench.kind}\`
- status: \`${workbench.review_policy.status}\`
- derived_drafting_allowed: \`${String(workbench.review_policy.derived_drafting_allowed === true)}\`
- promotion_allowed: \`${String(workbench.review_policy.promotion_allowed === true)}\`
- detected_structure_lines: \`${workbench.detected_structure_lines?.status || 'not_available'}\`
- detected_vp_clusters: \`${workbench.detected_structure_lines?.accepted_vp_cluster_count || 0}\`

## Quality Policy

- x_red minimum lines: \`${workbench.quality_policy.min_lines_per_axis.x_red}\`
- y_green minimum lines: \`${workbench.quality_policy.min_lines_per_axis.y_green}\`
- z_blue minimum lines: \`${workbench.quality_policy.min_lines_per_axis.z_blue}\`
- vertical_parallel_allowed: \`${String(workbench.quality_policy.vertical_parallel_allowed)}\`
- vp_clusters_must_come_from_detected_lines: \`${String(workbench.quality_policy.vp_clusters_must_come_from_detected_lines === true)}\`

## Line Candidates

| id | assignment | family hint | confidence | allowed axes |
| --- | --- | --- | ---: | --- |
${workbench.line_candidates.map((candidate) => `| ${candidate.id} | ${candidate.axis_assignment} | ${candidate.source_family_hint || 'none'} | ${candidate.confidence} | ${candidate.allowed_axes.join(', ')} |`).join('\n')}
`;
}

export function renderAxisCalibrationResultMarkdown(result) {
  return `# Axis Calibration Result

- status: \`${result.status}\`
- derived_drafting_allowed: \`${String(result.derived_drafting_allowed === true)}\`
- promotion_allowed: \`${String(result.promotion_allowed === true)}\`
- blockers: ${result.blockers.length ? result.blockers.map((blocker) => `\`${blocker}\``).join(', ') : 'none'}

| axis | lines | required | support ok | vanishing |
| --- | ---: | ---: | --- | --- |
${result.axis_support.map((support) => `| ${support.axis} | ${support.line_count} | ${support.required_line_count} | ${String(support.support_ok)} | ${support.vanishing_type} |`).join('\n')}
`;
}

export function renderAxisCalibrationWorkbenchOverlaySvg({ workbench, reviewDecision = null, sourceImagePath }) {
  const image = workbench.source_image;
  const dataUrl = imageDataUrl(sourceImagePath);
  const decisionByLine = new Map((reviewDecision?.line_decisions || []).map((decision) => [decision.line_candidate_id, decision]));
  const lines = workbench.line_candidates.map((candidate, index) => {
    const decision = decisionByLine.get(candidate.id);
    const axis = decision?.decision === 'assign_axis' ? decision.assigned_axis : 'axis_unknown';
    return lineSvg({
      line: candidate.line_px,
      color: axisColor(axis),
      width: axis === 'axis_unknown' ? 2.2 : 4,
      opacity: decision?.decision === 'reject' ? 0.25 : 0.86,
      dash: axis === 'axis_unknown' || decision?.decision === 'reject',
      label: `${candidate.id} -> ${axis}`,
      index
    });
  }).join('\n');
  const legend = `<g>
  <rect x="18" y="18" width="520" height="136" fill="white" fill-opacity="0.9" stroke="#cbd5e1"/>
  <text x="30" y="43" font-size="16" font-weight="700" fill="#111827" font-family="Arial, sans-serif">Axis Calibration Workbench</text>
  <text x="30" y="66" font-size="12" fill="#334155" font-family="Arial, sans-serif">All candidates start as axis_unknown; review assigns red/green/blue/reject.</text>
  <text x="30" y="88" font-size="12" fill="#334155" font-family="Arial, sans-serif">Gate: x_red >=2 lines, y_green >=2 lines, z_blue >=1 line.</text>
  <text x="30" y="110" font-size="12" fill="#334155" font-family="Arial, sans-serif">Single-line green-axis assignments stay blocked.</text>
  <text x="30" y="132" font-size="12" fill="#334155" font-family="Arial, sans-serif">No topology, plan, PartGraph, or SketchUp without accepted axis review.</text>
</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}" viewBox="0 0 ${image.width} ${image.height}">
<image href="${dataUrl}" width="${image.width}" height="${image.height}"/>
${lines}
${legend}
</svg>
`;
}

export function renderAxisCalibrationWorkbenchHtml({
  workbench,
  pendingResult,
  insufficientResult
}) {
  const rows = workbench.line_candidates.map((candidate) => `<tr>
    <td><code>${escapeXml(candidate.id)}</code></td>
    <td><code>${escapeXml(candidate.axis_assignment)}</code></td>
    <td>${escapeXml(candidate.source_family_hint || 'none')}</td>
    <td>${candidate.confidence}</td>
    <td>${candidate.allowed_axes.map((axis) => `<code>${axis}</code>`).join(' ')}</td>
  </tr>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Yellow Axis Calibration Workbench</title>
  <style>
    body { margin: 0; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #17202a; background: #f4f6f8; }
    header { padding: 22px 28px; background: #17202a; color: white; }
    main { padding: 22px 28px 40px; display: grid; gap: 18px; }
    img { width: min(100%, 1100px); border: 1px solid #cbd5e1; background: white; }
    table { border-collapse: collapse; width: min(100%, 1200px); background: white; }
    th, td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
    th { background: #edf2f7; }
    code { background: #edf2f7; padding: 1px 4px; border-radius: 3px; }
    .status { display: flex; gap: 8px; flex-wrap: wrap; }
    .tag { padding: 4px 8px; border-radius: 4px; background: #e2e8f0; }
    .bad { background: #fee2e2; color: #7f1d1d; }
  </style>
</head>
<body>
  <header>
    <h1>Yellow Axis Calibration Workbench</h1>
    <div class="status">
      <span class="tag bad">pending=${escapeXml(pendingResult.status)}</span>
      <span class="tag bad">previous-hardcoded=${escapeXml(insufficientResult.status)}</span>
      <span class="tag bad">detected-lines=${escapeXml(workbench.detected_structure_lines?.status || 'not_available')}</span>
      <span class="tag">topology_allowed=false</span>
      <span class="tag">promotion_allowed=false</span>
    </div>
  </header>
  <main>
    <section>
      <h2>Candidate Overlay</h2>
      <img src="../02-axis-calibration-workbench-overlay.png" alt="Axis calibration line candidates">
    </section>
    <section>
      <h2>Detected Structure Lines</h2>
      <p>VP clusters must come from raster-detected lines, not A/B/C/D or seeded line-fit hints. Status: <code>${escapeXml(workbench.detected_structure_lines?.status || 'not_available')}</code>; accepted VP clusters: <code>${workbench.detected_structure_lines?.accepted_vp_cluster_count || 0}</code>.</p>
      <p><a href="../detected-structure-lines.json">detected lines JSON</a> · <a href="../04-detected-structure-lines-overlay.png">detected lines overlay</a></p>
    </section>
    <section>
      <h2>Review Contracts</h2>
      <p>Single-line green-axis assignments stay blocked. Previous hardcoded blockers: <code>${escapeXml(insufficientResult.blockers.join(', ') || 'none')}</code>.</p>
      <p><a href="../axis-calibration-review.template.json">review template</a> · <a href="../axis-calibration-result.pending.json">pending result</a> · <a href="../axis-calibration-result.previous-hardcoded-example.json">previous hardcoded result</a></p>
    </section>
    <section>
      <h2>Line Candidates</h2>
      <table>
        <thead><tr><th>id</th><th>assignment</th><th>family hint</th><th>confidence</th><th>allowed axes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  </main>
</body>
</html>
`;
}

export async function prepareAxisCalibrationImageDataUrl(sourceImagePath) {
  const data = await fs.readFile(sourceImagePath);
  imageDataUrl.cache.set(sourceImagePath, data.toString('base64'));
}

function makeLineCandidate({
  id,
  sourceImage,
  line,
  sourceKind,
  familyHint,
  sourceEvidenceIds,
  confidence,
  notes = []
}) {
  return {
    id,
    source_image: sourceImage,
    line_px: normalizeLine(line),
    axis_assignment: 'axis_unknown',
    allowed_axes: ['x_red', 'y_green', 'z_blue', 'reject'],
    source_kind: sourceKind,
    source_family_hint: familyHint,
    source_evidence_ids: sourceEvidenceIds || [],
    confidence: round(confidence),
    review_required: true,
    promotion_allowed: false,
    notes
  };
}

function reviewDecisionPathForStatus(reviewDecision) {
  if (reviewDecision.reviewer === 'previous-hardcoded-axis-example') {
    return 'axis-calibration-review.previous-hardcoded-example.json';
  }
  if (reviewDecision.reviewer === 'axis-calibration-positive-fixture') {
    return 'axis-calibration-review.accepted-fixture.json';
  }
  return reviewDecision.status === 'accepted_for_calibration'
    ? 'axis-calibration-review.accepted.json'
    : 'axis-calibration-review.pending.json';
}

function uniqueById(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    output.push(item);
  }
  return output;
}

function uniqueStrings(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function normalizeLine(line = {}) {
  return {
    a: [round(line.a?.[0]), round(line.a?.[1])],
    b: [round(line.b?.[0]), round(line.b?.[1])]
  };
}

function lineIntersection(first, second) {
  const x1 = Number(first.a[0]);
  const y1 = Number(first.a[1]);
  const x2 = Number(first.b[0]);
  const y2 = Number(first.b[1]);
  const x3 = Number(second.a[0]);
  const y3 = Number(second.a[1]);
  const x4 = Number(second.b[0]);
  const y4 = Number(second.b[1]);
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denominator) < 1e-6) return null;
  const px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denominator;
  const py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denominator;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  return [px, py];
}

function horizonLineFromAxisSupport(axisSupport = []) {
  const red = axisSupport.find((support) => support.axis === 'x_red')?.vanishing_point_px;
  const green = axisSupport.find((support) => support.axis === 'y_green')?.vanishing_point_px;
  if (!red || !green) return null;
  return {
    a: red,
    b: green
  };
}

function lineSvg({ line, color, width = 3, opacity = 1, dash = false, label, index }) {
  const midpoint = [
    (Number(line.a[0]) + Number(line.b[0])) / 2,
    (Number(line.a[1]) + Number(line.b[1])) / 2
  ];
  return `<g data-layer="axis-calibration-line-candidate">
  <line x1="${round(line.a[0])}" y1="${round(line.a[1])}" x2="${round(line.b[0])}" y2="${round(line.b[1])}" stroke="${color}" stroke-width="${width}" stroke-opacity="${opacity}"${dash ? ' stroke-dasharray="8 6"' : ''}/>
  <text x="${round(midpoint[0] + 6)}" y="${round(midpoint[1] - 6)}" font-size="11" fill="${color}" stroke="white" stroke-width="3" paint-order="stroke">${index + 1}</text>
  <title>${escapeXml(label)}</title>
</g>`;
}

function axisColor(axis) {
  if (axis === 'x_red') return '#dc2626';
  if (axis === 'y_green') return '#16a34a';
  if (axis === 'z_blue') return '#2563eb';
  return '#111827';
}

function axisLabel(axis) {
  if (axis === 'x_red') return 'red axis / reviewed x direction';
  if (axis === 'y_green') return 'green axis / reviewed y direction';
  if (axis === 'z_blue') return 'blue axis / reviewed vertical direction';
  return 'unknown axis';
}

function imageDataUrl(sourceImagePath) {
  const extension = path.extname(sourceImagePath).toLowerCase();
  const mime = extension === '.jpg' || extension === '.jpeg' ? 'jpeg' : 'png';
  return `data:image/${mime};base64,${imageDataUrl.cache.get(sourceImagePath) || ''}`;
}
imageDataUrl.cache = new Map();

function round(value, digits = 3) {
  if (!Number.isFinite(Number(value))) return 0;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}
