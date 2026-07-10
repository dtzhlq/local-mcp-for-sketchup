#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  buildAcceptedAxisCalibrationReviewFixture,
  buildBlockedCornerChainTopologyGate,
  buildCalibratedViewGraphFromAxisCalibrationReview,
  buildPendingAxisCalibrationReviewDecision,
  buildPreviousHardcodedYellowAxisReviewDecision,
  buildYellowAxisCalibrationWorkbench,
  evaluateAxisCalibrationReview,
  prepareAxisCalibrationImageDataUrl,
  renderAxisCalibrationResultMarkdown,
  renderAxisCalibrationWorkbenchHtml,
  renderAxisCalibrationWorkbenchMarkdown,
  renderAxisCalibrationWorkbenchOverlaySvg
} from './lib/axis-calibration-workbench.mjs';
import { renderCalibratedViewGraphMarkdown } from './lib/calibration-first-graphs.mjs';
import {
  buildDetectedStructureLines,
  prepareDetectedStructureLineImageDataUrl,
  renderDetectedStructureLinesMarkdown,
  renderDetectedStructureLinesOverlaySvg
} from './lib/detected-structure-lines.mjs';
import { buildYellowBuildingStructuralProjection } from './lib/yellow-building-structural-projection.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const DEFAULT_OUTPUT_DIR = 'output/image-structured-modeler/yellow-axis-calibration';
const YELLOW_SOURCE = 'projects/image-structured-modeler/examples/building-single-anime-yellow/input-visible-crop.png';

export async function generateYellowAxisCalibrationWorkbench(options = {}) {
  const outputDir = path.resolve(repoRoot, options.outputDir || DEFAULT_OUTPUT_DIR);
  const outputRel = path.relative(repoRoot, outputDir);
  const sourceAbs = path.resolve(repoRoot, YELLOW_SOURCE);
  await fs.mkdir(path.join(outputDir, 'review'), { recursive: true });
  await fs.copyFile(sourceAbs, path.join(outputDir, '01-original.png'));

  const structuralProjection = await buildYellowBuildingStructuralProjection({
    sourceImagePath: sourceAbs,
    sourceImage: YELLOW_SOURCE,
    targetWidth: 900,
    targetHeight: 589
  });
  const detectedStructureLines = await buildDetectedStructureLines({
    sourceImagePath: sourceAbs,
    sourceImage: YELLOW_SOURCE
  });
  const workbench = buildYellowAxisCalibrationWorkbench({
    detectedStructureLines,
    structuralProjection,
    sourceImage: YELLOW_SOURCE,
    profileId: 'building_single'
  });
  const pendingReview = buildPendingAxisCalibrationReviewDecision({ workbench });
  const pendingResult = evaluateAxisCalibrationReview({
    workbench,
    reviewDecision: pendingReview
  });
  const previousHardcodedReview = buildPreviousHardcodedYellowAxisReviewDecision({ workbench });
  const previousHardcodedResult = evaluateAxisCalibrationReview({
    workbench,
    reviewDecision: previousHardcodedReview
  });
  const acceptedFixtureReview = buildAcceptedAxisCalibrationReviewFixture({ workbench });
  const acceptedFixtureResult = evaluateAxisCalibrationReview({
    workbench,
    reviewDecision: acceptedFixtureReview
  });
  const pendingCalibratedViewGraph = buildCalibratedViewGraphFromAxisCalibrationReview({
    workbench,
    reviewDecision: pendingReview
  });
  const previousHardcodedCalibratedViewGraph = buildCalibratedViewGraphFromAxisCalibrationReview({
    workbench,
    reviewDecision: previousHardcodedReview
  });
  const acceptedFixtureCalibratedViewGraph = buildCalibratedViewGraphFromAxisCalibrationReview({
    workbench,
    reviewDecision: acceptedFixtureReview
  });
  const topologyGate = buildBlockedCornerChainTopologyGate({ axisResult: pendingResult });
  const report = buildYellowAxisCalibrationReport({
    outputRel,
    workbench,
    pendingResult,
    previousHardcodedResult,
    acceptedFixtureResult,
    detectedStructureLines,
    topologyGate
  });

  await writeJson(path.join(outputDir, 'detected-structure-lines.json'), detectedStructureLines);
  await fs.writeFile(
    path.join(outputDir, 'detected-structure-lines.md'),
    renderDetectedStructureLinesMarkdown(detectedStructureLines),
    'utf8'
  );
  await writeJson(path.join(outputDir, 'axis-calibration-workbench.json'), workbench);
  await fs.writeFile(
    path.join(outputDir, 'axis-calibration-workbench.md'),
    renderAxisCalibrationWorkbenchMarkdown(workbench),
    'utf8'
  );
  await writeJson(path.join(outputDir, 'axis-calibration-review.template.json'), pendingReview);
  await writeJson(path.join(outputDir, 'axis-calibration-review.pending.json'), pendingReview);
  await writeJson(path.join(outputDir, 'axis-calibration-result.pending.json'), pendingResult);
  await fs.writeFile(
    path.join(outputDir, 'axis-calibration-result.pending.md'),
    renderAxisCalibrationResultMarkdown(pendingResult),
    'utf8'
  );
  await writeJson(path.join(outputDir, 'axis-calibration-review.previous-hardcoded-example.json'), previousHardcodedReview);
  await writeJson(path.join(outputDir, 'axis-calibration-result.previous-hardcoded-example.json'), previousHardcodedResult);
  await fs.writeFile(
    path.join(outputDir, 'axis-calibration-result.previous-hardcoded-example.md'),
    renderAxisCalibrationResultMarkdown(previousHardcodedResult),
    'utf8'
  );
  await writeJson(path.join(outputDir, 'axis-calibration-review.accepted-fixture.json'), acceptedFixtureReview);
  await writeJson(path.join(outputDir, 'axis-calibration-result.accepted-fixture.json'), acceptedFixtureResult);
  await fs.writeFile(
    path.join(outputDir, 'axis-calibration-result.accepted-fixture.md'),
    renderAxisCalibrationResultMarkdown(acceptedFixtureResult),
    'utf8'
  );
  await writeJson(path.join(outputDir, 'calibrated-view-graph.pending.blocked.json'), pendingCalibratedViewGraph);
  await fs.writeFile(
    path.join(outputDir, 'calibrated-view-graph.pending.blocked.md'),
    renderCalibratedViewGraphMarkdown(pendingCalibratedViewGraph),
    'utf8'
  );
  await writeJson(path.join(outputDir, 'calibrated-view-graph.previous-hardcoded.blocked.json'), previousHardcodedCalibratedViewGraph);
  await writeJson(path.join(outputDir, 'calibrated-view-graph.accepted-fixture.json'), acceptedFixtureCalibratedViewGraph);
  await writeJson(path.join(outputDir, 'corner-chain-topology-gate.pending.blocked.json'), topologyGate);
  await writeJson(path.join(outputDir, 'judgment-report.json'), report);
  await fs.writeFile(
    path.join(outputDir, 'judgment-report.md'),
    renderYellowAxisCalibrationReportMarkdown(report),
    'utf8'
  );

  await prepareAxisCalibrationImageDataUrl(sourceAbs);
  await prepareDetectedStructureLineImageDataUrl(sourceAbs);
  const detectedLinesSvg = renderDetectedStructureLinesOverlaySvg(detectedStructureLines, sourceAbs);
  await writeSvgAndPng(
    path.join(outputDir, '04-detected-structure-lines-overlay.svg'),
    path.join(outputDir, '04-detected-structure-lines-overlay.png'),
    detectedLinesSvg
  );
  const overlaySvg = renderAxisCalibrationWorkbenchOverlaySvg({
    workbench,
    reviewDecision: pendingReview,
    sourceImagePath: sourceAbs
  });
  await writeSvgAndPng(
    path.join(outputDir, '02-axis-calibration-workbench-overlay.svg'),
    path.join(outputDir, '02-axis-calibration-workbench-overlay.png'),
    overlaySvg
  );
  const previousSvg = renderAxisCalibrationWorkbenchOverlaySvg({
    workbench,
    reviewDecision: previousHardcodedReview,
    sourceImagePath: sourceAbs
  });
  await writeSvgAndPng(
    path.join(outputDir, '03-previous-hardcoded-axis-overlay.svg'),
    path.join(outputDir, '03-previous-hardcoded-axis-overlay.png'),
    previousSvg
  );
  await fs.writeFile(
    path.join(outputDir, 'review', 'index.html'),
    renderAxisCalibrationWorkbenchHtml({
      workbench,
      pendingResult,
      insufficientResult: previousHardcodedResult
    }),
    'utf8'
  );
  return {
    ok: true,
    outputDir,
    detectedStructureLines,
    workbench,
    pendingReview,
    pendingResult,
    previousHardcodedReview,
    previousHardcodedResult,
    acceptedFixtureReview,
    acceptedFixtureResult,
    pendingCalibratedViewGraph,
    topologyGate,
    report
  };
}

function buildYellowAxisCalibrationReport({
  outputRel,
  workbench,
  pendingResult,
  previousHardcodedResult,
  acceptedFixtureResult,
  detectedStructureLines,
  topologyGate
}) {
  return {
    version: 1,
    kind: 'yellow_axis_calibration_workbench_report',
    generated_at: new Date().toISOString(),
    sample: {
      id: 'building-single-anime-yellow',
      source_image: YELLOW_SOURCE,
      output_dir: outputRel
    },
    route_status: 'axis_review_required',
    artifact_links: {
      workbench: `${outputRel}/axis-calibration-workbench.json`,
      workbench_overlay_png: `${outputRel}/02-axis-calibration-workbench-overlay.png`,
      detected_structure_lines: `${outputRel}/detected-structure-lines.json`,
      detected_structure_lines_overlay_png: `${outputRel}/04-detected-structure-lines-overlay.png`,
      review_template: `${outputRel}/axis-calibration-review.template.json`,
      pending_result: `${outputRel}/axis-calibration-result.pending.json`,
      previous_hardcoded_review: `${outputRel}/axis-calibration-review.previous-hardcoded-example.json`,
      previous_hardcoded_result: `${outputRel}/axis-calibration-result.previous-hardcoded-example.json`,
      previous_hardcoded_overlay_png: `${outputRel}/03-previous-hardcoded-axis-overlay.png`,
      accepted_fixture_result: `${outputRel}/axis-calibration-result.accepted-fixture.json`,
      blocked_calibrated_view_graph: `${outputRel}/calibrated-view-graph.pending.blocked.json`,
      topology_gate: `${outputRel}/corner-chain-topology-gate.pending.blocked.json`,
      review_workbench: `${outputRel}/review/index.html`
    },
    gate_results: {
      detected_structure_lines: {
        status: detectedStructureLines.qa.status,
        usable_for_axis_calibration: detectedStructureLines.qa.usable_for_axis_calibration,
        blockers: detectedStructureLines.qa.blockers,
        line_candidate_count: detectedStructureLines.summary.line_candidate_count,
        accepted_vp_cluster_count: detectedStructureLines.summary.accepted_vp_cluster_count
      },
      pending_review: {
        status: pendingResult.status,
        blockers: pendingResult.blockers,
        derived_drafting_allowed: pendingResult.derived_drafting_allowed
      },
      previous_hardcoded_assignment: {
        status: previousHardcodedResult.status,
        blockers: previousHardcodedResult.blockers,
        derived_drafting_allowed: previousHardcodedResult.derived_drafting_allowed,
        expected_blocked: true
      },
      accepted_fixture: {
        status: acceptedFixtureResult.status,
        blockers: acceptedFixtureResult.blockers,
        derived_drafting_allowed: acceptedFixtureResult.derived_drafting_allowed,
        fixture_only: true
      }
    },
    default_lane: {
      axis_candidate_count: workbench.line_candidates.length,
      calibrated_view_graph_allowed: false,
      corner_chain_topology_allowed: topologyGate.corner_chain_topology_allowed,
      plan_projection_allowed: topologyGate.plan_projection_allowed,
      partgraph_promotion_allowed: false,
      sketchup_promotion_allowed: false
    },
    conclusion: 'Axis calibration now separates raster-detected lines from seeded hints. Detected VP clusters are candidates requiring review; seeded AB/CD red plus BC green remains blocked and cannot create red/green axes.'
  };
}

function renderYellowAxisCalibrationReportMarkdown(report) {
  return `# Yellow Axis Calibration Workbench Report

- route_status: \`${report.route_status}\`
- detected_structure_lines: \`${report.gate_results.detected_structure_lines.status}\`
- pending_review: \`${report.gate_results.pending_review.status}\`
- previous_hardcoded_assignment: \`${report.gate_results.previous_hardcoded_assignment.status}\`
- line_count_fixture: \`${report.gate_results.accepted_fixture.status}\` fixture-only
- topology_allowed_by_default: \`${String(report.default_lane.corner_chain_topology_allowed === true)}\`
- promotion_allowed_by_default: \`${String(report.default_lane.partgraph_promotion_allowed === true)}\`

${report.conclusion}
`;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeSvgAndPng(svgPath, pngPath, svg) {
  await fs.writeFile(svgPath, svg, 'utf8');
  await sharp(Buffer.from(svg)).png().toFile(pngPath);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  generateYellowAxisCalibrationWorkbench(options)
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        ok: true,
        output_dir: result.outputDir,
        pending_status: result.pendingResult.status,
        detected_status: result.detectedStructureLines.qa.status,
        previous_hardcoded_status: result.previousHardcodedResult.status,
        line_count_fixture_status: result.acceptedFixtureResult.status,
        topology_allowed: result.topologyGate.corner_chain_topology_allowed,
        review_workbench: path.relative(repoRoot, path.join(result.outputDir, 'review', 'index.html'))
      }, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--output-dir') {
      options.outputDir = args[index + 1];
      index += 1;
    }
  }
  return options;
}
