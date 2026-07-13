#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCalibrationBenchmark } from './run-calibration-benchmark.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const DEFAULT_OUTPUT_DIR = 'output/image-structured-modeler/yellow-visible-effect';

const LEGACY_GEOMETRY_ARTIFACTS = [
  '01-original.png',
  '02-structure-overlay.svg',
  '02-structure-overlay.png',
  '02b-structural-projection-overlay.svg',
  '02b-structural-projection-overlay.png',
  '02c-calibrated-view-overlay.svg',
  '02c-calibrated-view-overlay.png',
  '02d-corner-chain-topology-overlay.svg',
  '02d-corner-chain-topology-overlay.png',
  '03-draft-view-graph.svg',
  '03-draft-view-graph.png',
  '03b-facade-projection.svg',
  '03b-facade-projection.png',
  '03c-plan-projection.svg',
  '03c-plan-projection.png',
  '04-plane-review-overlay.svg',
  '04-plane-review-overlay.png',
  '05-partgraph-preview.json',
  '06-sketchup-dsl.preview.json',
  '07-sketchup-mock-preview.svg',
  '07-sketchup-mock-preview.png',
  '07-sketchup-mock-summary.json',
  '08-sketchup-live-summary.json',
  'candidate-promotion-review.accepted.yellow.json',
  'candidate-promotion-patch.accepted.yellow.json',
  'candidate-promotion-review.calibration-topology-promotion-blocked.yellow.json',
  'candidate-promotion-patch.calibration-topology-promotion-blocked.yellow.json',
  'candidate-promotion-patch.no-review.blocked.json',
  'no-review-promotion-blocked.json',
  'forged-ready-patch.fail-closed.json',
  'mock-session.json',
  'perspective-critique-report.json',
  'perspective-critique-report.md',
  'yellow-calibrated-view-graph.json',
  'yellow-calibrated-view-graph.md',
  'yellow-calibrated-view-review.accepted.json',
  'yellow-corner-chain-topology.json',
  'yellow-corner-chain-topology.md',
  'yellow-corner-chain-topology-review.accepted.json',
  'yellow-structural-projection.json',
  'yellow-structural-methodology.md',
  'comparison',
  'intake'
];

export async function generateYellowVisibleEffect(options = {}) {
  const outputDirOption = options.outputDir || DEFAULT_OUTPUT_DIR;
  const outputDir = path.resolve(repoRoot, outputDirOption);
  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all(LEGACY_GEOMETRY_ARTIFACTS.map((name) => fs.rm(path.join(outputDir, name), { force: true, recursive: true })));

  const calibration = await runCalibrationBenchmark({
    outputDir: outputDirOption,
    truth: options.truth,
    topologySeed: options.topologySeed
  });
  const report = {
    kind: 'yellow_visible_effect_judgment_v2',
    version: 2,
    status: 'calibration_and_topology_review_required',
    authoritative_pipeline: [
      'structure_line_evidence_v2',
      'perspective_calibration_hypotheses_v1',
      'perspective_calibration_review_result_v1',
      'facade_plane_graph_v1',
      'corner_chain_topology_v1',
      'draft_view_graph_v1'
    ],
    rejected_legacy_path: {
      status: 'retired',
      reasons: [
        'screenshot_space_corner_coordinates_were_mapped_into_the_source_crop',
        'single_BC_line_was_used_as_green_axis_support',
        'hardcoded_plan_depth_ratio_was_presented_as_image_derived'
      ]
    },
    line_evidence: {
      backend: calibration.structureLineEvidence.backend.id,
      raw_segment_count: calibration.structureLineEvidence.summary.raw_segment_count,
      eligible_segment_count: calibration.structureLineEvidence.summary.eligible_segment_count,
      seed_segment_count: calibration.structureLineEvidence.summary.seed_segment_count,
      structural_length_coverage_recall: calibration.report.metrics.structural_length_coverage_recall
    },
    perspective: {
      camera_model_candidate: calibration.perspectiveCalibration.camera_model_candidates[0]?.model || 'unknown',
      horizontal_family_count: calibration.perspectiveCalibration.summary.horizontal_family_count,
      vertical_family_count: calibration.perspectiveCalibration.summary.vertical_family_count,
      pending_review_status: calibration.pendingReviewResult.status,
      accepted_fixture_status: calibration.acceptedReviewFixtureResult.status,
      promotion_allowed: false
    },
    plane_topology: {
      candidate_plane_ids: calibration.facadePlaneGraph.planes.map((plane) => plane.id),
      pending_review_status: calibration.pendingTopologyReviewResult.status,
      accepted_fixture_status: calibration.acceptedTopologyReviewFixtureResult.status,
      draft_view_status: calibration.acceptedTopologyDraftViewGraph.review_policy.status,
      detail_candidate_count: calibration.facadePlaneGraph.plane_local_detail_candidates.length,
      unassigned_detail_ids: calibration.facadePlaneGraph.plane_local_detail_candidates
        .filter((detail) => detail.candidate_plane_ids.length === 0)
        .map((detail) => detail.id),
      metric_depth_status: 'unknown_single_view',
      promotion_allowed: false
    },
    geometry_output: {
      part_graph_generated: false,
      sketchup_dsl_generated: false,
      live_sketchup_run: false,
      false_promotion_count: 0,
      blockers: [
        'accepted_user_perspective_calibration_review_required',
        'accepted_user_corner_chain_topology_review_required',
        'accepted_draft_view_review_required',
        'accepted_facade_plane_review_required',
        'accepted_local_detail_review_required',
        'accepted_partgraph_promotion_review_required'
      ]
    },
    judgment: {
      visible_delta: 'drafting_evidence_obvious_geometry_intentionally_absent',
      conclusion: 'The calibration-first artifacts now expose the two horizontal vanishing families and the LA-AB-BC-CD side-plus-recess topology. Geometry remains fail-closed because all accepted reviews are fixtures, not user decisions.'
    },
    artifacts: {
      structure_line_evidence: 'structure-line-evidence.json',
      perspective_calibration: 'perspective-calibration-hypotheses.json',
      direction_family_overlay: '02-perspective-direction-families.png',
      plane_topology_overlay: '04-calibrated-plane-topology.png',
      facade_plane_graph: 'facade-plane-graph.accepted-calibration.candidates.json',
      draft_view_graph: 'draft-view-graph.accepted-topology-fixture.json',
      mcp_modeling_brief: 'mcp-modeling-brief.md',
      review_workbench: 'index.html'
    }
  };
  await fs.writeFile(path.join(outputDir, 'judgment-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(outputDir, 'judgment-report.md'), renderJudgmentMarkdown(report), 'utf8');
  return { ...calibration, report };
}

function renderJudgmentMarkdown(report) {
  return `# Yellow Calibration-First Judgment

- status: \`${report.status}\`
- backend: \`${report.line_evidence.backend}\`
- raw / eligible / seed: \`${report.line_evidence.raw_segment_count} / ${report.line_evidence.eligible_segment_count} / ${report.line_evidence.seed_segment_count}\`
- structural line recall: \`${report.line_evidence.structural_length_coverage_recall}\`
- horizontal direction families: \`${report.perspective.horizontal_family_count}\`
- camera model candidate: \`${report.perspective.camera_model_candidate}\`
- plane candidates: \`${report.plane_topology.candidate_plane_ids.join(', ')}\`
- metric depth: \`${report.plane_topology.metric_depth_status}\`
- false promotion count: \`${report.geometry_output.false_promotion_count}\`
- PartGraph generated: \`${report.geometry_output.part_graph_generated}\`
- SketchUp DSL generated: \`${report.geometry_output.sketchup_dsl_generated}\`

## Judgment

${report.judgment.conclusion}

## Retired Legacy Path

${report.rejected_legacy_path.reasons.map((reason) => `- \`${reason}\``).join('\n')}
`;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--output-dir') options.outputDir = args[++index];
    else if (args[index] === '--truth') options.truth = args[++index];
    else if (args[index] === '--topology-seed') options.topologySeed = args[++index];
    else if (args[index] === '--live') throw new Error('--live is retired: yellow calibration review does not generate SketchUp geometry');
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateYellowVisibleEffect(parseArgs(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        ok: true,
        output_dir: result.outputDir,
        status: result.report.status,
        horizontal_families: result.report.perspective.horizontal_family_count,
        plane_candidates: result.report.plane_topology.candidate_plane_ids.length,
        part_graph_generated: false,
        sketchup_dsl_generated: false,
        false_promotion_count: 0
      }, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}
