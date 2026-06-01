#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SketchUpBridge } from '../../../src/bridge.mjs';
import { compilePartGraphFiles } from '../../../src/product-modeling/part-graph-compiler.mjs';
import { validatePartGraphPhysicalConsistency } from '../../../src/product-modeling/physical-consistency-qa.mjs';
import { validateGroundingV3 } from './lib/grounding-v3.mjs';
import { validateGeometryFit } from './validate-geometry-fit.mjs';
import { validateVisualRelations } from './validate-visual-relations.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

const DEFAULTS = {
  name: 'ambulance-proposal-applied',
  profile: 'examples/product-profiles/vehicle_ambulance.json',
  partGraph: 'projects/image-structured-modeler/examples/ambulance/part-graph.proposal-applied.json',
  code: 'projects/image-structured-modeler/examples/ambulance/output.proposal-applied.json',
  layoutSpec: 'examples/model-qa/ambulance-reference.json',
  referenceSpec: 'examples/reference-visual-qa/ambulance-reference.json',
  outputDir: 'output/image-structured-proposal-qa/ambulance'
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runtime = options.runtime || 'mock';
  const outputDir = resolveRepo(options.outputDir || DEFAULTS.outputDir);
  await fs.mkdir(outputDir, { recursive: true });

  const paths = {
    profile: options.profile || DEFAULTS.profile,
    partGraph: options.partGraph || DEFAULTS.partGraph,
    code: options.code || DEFAULTS.code,
    layoutSpec: options.layoutSpec || DEFAULTS.layoutSpec,
    referenceSpec: options.referenceSpec || DEFAULTS.referenceSpec,
    observations: options.observations || null,
    visualRelationsFixture: options.visualRelationsFixture || null,
    geometryFitFixture: options.geometryFitFixture || options.visualRelationsFixture || null
  };

  const [partGraph, codeDocument, layoutSpec, referenceSpec, observations, visualRelationsFixture, geometryFitFixture] = await Promise.all([
    readJson(paths.partGraph),
    readJson(paths.code),
    readJson(paths.layoutSpec),
    readJson(paths.referenceSpec),
    paths.observations ? readJson(paths.observations) : null,
    paths.visualRelationsFixture ? readJson(paths.visualRelationsFixture) : null,
    paths.geometryFitFixture ? readJson(paths.geometryFitFixture) : null
  ]);
  const compiled = await compilePartGraphFiles({
    profilePath: paths.profile,
    partGraphPath: paths.partGraph,
    repoRoot
  });
  const compiledMatchesOutput = JSON.stringify(compiled) === JSON.stringify(codeDocument);
  const code = JSON.stringify(codeDocument);
  const bridge = new SketchUpBridge();
  const layout = await bridge.validate_model({
    code,
    spec: layoutSpec,
    runtime,
    timeoutMs: options.timeoutMs,
    includePreview: false
  });
  const referenceVisual = await bridge.validate_reference_model({
    code,
    spec: referenceSpec,
    runtime,
    timeoutMs: options.timeoutMs,
    includePreview: false
  });
  const visualRelations = observations && visualRelationsFixture
    ? await validateVisualRelations({
      observations,
      fixture: visualRelationsFixture,
      code,
      runtime,
      timeoutMs: options.timeoutMs,
      mockSessionPath: path.join(outputDir, 'visual-relation-mock-session.json')
    })
    : null;
  const geometryFit = observations && geometryFitFixture
    ? await validateGeometryFit({
      observations,
      fixture: geometryFitFixture,
      code,
      runtime,
      timeoutMs: options.timeoutMs,
      mockSessionPath: path.join(outputDir, 'geometry-fit-mock-session.json')
    })
    : null;
  const groundingV3 = observations && geometryFitFixture
    ? validateGroundingV3({
      observations,
      fixture: geometryFitFixture,
      geometryFit,
      codeDocument
    })
    : null;
  const physicalConsistency = validatePartGraphPhysicalConsistency(partGraph);
  const qaOk = compiledMatchesOutput
    && layout.ok
    && referenceVisual.ok
    && (visualRelations?.ok ?? true)
    && (geometryFit?.ok ?? true)
    && (groundingV3?.ok ?? true)
    && physicalConsistency.ok;
  const groundingReviewRequired = (visualRelations?.verdict === 'review') || (geometryFit?.verdict === 'review') || (groundingV3?.verdict === 'review');
  const artifact = options.saveSkp || options.saveArtifact
    ? await bridge.save_model({
      path: resolveRepo(options.saveSkp || path.join(outputDir, `${options.name || DEFAULTS.name}.${runtime === 'queue' ? 'skp' : 'json'}`)),
      runtime,
      timeoutMs: options.timeoutMs
    })
    : null;

  const report = {
    kind: 'proposal_review_qa',
    name: options.name || DEFAULTS.name,
    runtime,
    timeout_ms: options.timeoutMs ?? null,
    ok: qaOk,
    review_required: !qaOk || groundingReviewRequired,
    grounding_review_required: groundingReviewRequired,
    compiled_matches_output: compiledMatchesOutput,
    source_paths: paths,
    part_graph: {
      id: partGraph.id,
      parts: partGraph.parts?.length || 0,
      evidence_summary: countBy(partGraph.parts || [], 'evidence_status')
    },
    layout: summarizeQa(layout),
    reference_visual: summarizeQa(referenceVisual),
    ...(visualRelations ? { visual_relations: summarizeVisualRelations(visualRelations) } : {}),
    ...(geometryFit ? { geometry_fit: summarizeGeometryFit(geometryFit) } : {}),
    ...(groundingV3 ? { grounding_v3: summarizeGroundingV3(groundingV3) } : {}),
    physical_consistency: summarizeQa(physicalConsistency, {
      checked_relations: physicalConsistency.summary.checked_relations
    }),
    artifact: artifact
      ? {
        path: artifact.file_path,
        size_bytes: artifact.file_size_bytes ?? artifact.snapshot?.artifact_size_bytes ?? null,
        totals: artifact.snapshot?.totals || null
      }
      : null
  };

  await fs.writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (visualRelations) await fs.writeFile(path.join(outputDir, 'visual-relation-report.json'), `${JSON.stringify(visualRelations, null, 2)}\n`, 'utf8');
  if (geometryFit) await fs.writeFile(path.join(outputDir, 'geometry-fit-report.json'), `${JSON.stringify(geometryFit, null, 2)}\n`, 'utf8');
  if (groundingV3) await fs.writeFile(path.join(outputDir, 'grounding-v3-report.json'), `${JSON.stringify(groundingV3, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(outputDir, 'report.md'), formatMarkdown(report), 'utf8');
  process.stdout.write(`${JSON.stringify({
    ok: report.ok,
    review_required: report.review_required,
    output_dir: path.relative(repoRoot, outputDir) || '.',
    runtime: report.runtime,
    compiled_matches_output: report.compiled_matches_output,
    layout: report.layout.verdict,
    reference_visual: report.reference_visual.verdict,
    visual_relations: report.visual_relations?.verdict || 'not_run',
    geometry_fit: report.geometry_fit?.verdict || 'not_run',
    grounding_v3: report.grounding_v3?.verdict || 'not_run',
    physical_consistency: report.physical_consistency.verdict,
    artifact: report.artifact?.path || null
  }, null, 2)}\n`);

  if (options.requirePass && !report.ok) process.exitCode = 1;
}

function summarizeQa(report, extra = {}) {
  return {
    ok: report.ok,
    verdict: report.verdict,
    level: report.level,
    issues: report.summary?.total || 0,
    errors: report.summary?.by_severity?.error || 0,
    warnings: report.summary?.by_severity?.warn || 0,
    ...extra
  };
}

function summarizeVisualRelations(report) {
  return {
    ok: report.ok,
    verdict: report.verdict,
    level: report.summary?.by_severity?.error > 0 ? 'error' : report.summary?.by_severity?.warn > 0 ? 'warn' : 'ok',
    issues: report.summary?.total_issues || 0,
    errors: report.summary?.by_severity?.error || 0,
    warnings: report.summary?.by_severity?.warn || 0,
    checked_relations: report.summary?.checked_relations || 0,
    checked_footprints: report.summary?.checked_footprints || 0,
    matched_footprints: report.summary?.matched_footprints || 0
  };
}

function summarizeGeometryFit(report) {
  return {
    ok: report.ok,
    verdict: report.verdict,
    level: report.summary?.by_severity?.error > 0 ? 'error' : report.summary?.by_severity?.warn > 0 ? 'warn' : 'ok',
    issues: report.summary?.total_issues || 0,
    errors: report.summary?.by_severity?.error || 0,
    warnings: report.summary?.by_severity?.warn || 0,
    checked_footprints: report.summary?.checked_footprints || 0,
    grounding_issues: report.summary?.grounding_issues || 0,
    checked_relations: report.summary?.checked_relations || 0,
    checked_scale_anchors: report.summary?.checked_scale_anchors || 0,
    checked_handedness_cases: report.summary?.checked_handedness_cases || 0,
    max_center_error: report.summary?.max_center_error || 0,
    max_extent_error: report.summary?.max_extent_error || 0,
    max_relation_error: report.summary?.max_relation_error || 0,
    max_scale_error: report.summary?.max_scale_error || 0,
    primary_structures_grounding_coverage: report.summary?.primary_structures_grounding_coverage || 0,
    dense_detail_helper_ratio: report.summary?.dense_detail_helper_ratio || 0,
    dense_detail_review_required: report.summary?.dense_detail_review_required || 0,
    photo_grade_eligible_ratio: report.summary?.photo_grade_eligible_ratio || 0,
    structural_grounding_issues: report.summary?.structural_grounding_issues || 0,
    site_region_unclassified_ratio: report.summary?.site_region_unclassified_ratio || 0,
    site_region_overlap_ratio: report.summary?.site_region_overlap_ratio || 0,
    internal_road_area_ratio: report.summary?.internal_road_area_ratio || 0,
    parking_grid_spacing_error_ratio: report.summary?.parking_grid_spacing_error_ratio || 0,
    floating_roof_features: report.summary?.floating_roof_features || 0,
    tank_ellipse_instances: report.summary?.tank_ellipse_instances || 0
  };
}

function summarizeGroundingV3(report) {
  return {
    ok: report.ok,
    verdict: report.verdict,
    level: report.summary?.by_severity?.error > 0 ? 'error' : report.summary?.by_severity?.warn > 0 ? 'warn' : 'ok',
    issues: report.summary?.total_issues || 0,
    errors: report.summary?.by_severity?.error || 0,
    warnings: report.summary?.by_severity?.warn || 0,
    checked_scale_anchors: report.summary?.checked_scale_anchors || 0,
    distinct_scale_anchor_families: report.summary?.distinct_scale_anchor_families || 0,
    checked_ground_regions: report.summary?.checked_ground_regions || 0,
    subdivision_overlap_ratio: report.summary?.subdivision_overlap_ratio || 0,
    subdivision_gap_ratio: report.summary?.subdivision_gap_ratio || 0,
    checked_line_fits: report.summary?.checked_line_fits || 0,
    checked_road_axes: report.summary?.checked_road_axes || 0,
    parking_grid_count_residual: report.summary?.parking_grid_count_residual || 0,
    top_view_overlay_mean_iou: report.summary?.top_view_overlay_mean_iou || 0,
    top_view_overlay_max_chamfer_error: report.summary?.top_view_overlay_max_chamfer_error || 0,
    promoted_geometry: report.summary?.promoted_geometry || 0,
    review_candidate: report.summary?.review_candidate || 0,
    helper_only: report.summary?.helper_only || 0,
    photo_grade_candidate: report.summary?.photo_grade_candidate || false
  };
}

function countBy(items, key) {
  const result = {};
  for (const item of items) {
    const value = item[key] ?? 'unknown';
    result[value] = (result[value] || 0) + 1;
  }
  return result;
}

function formatMarkdown(report) {
  const lines = [
    '# Proposal Review QA',
    '',
    `Runtime: ${report.runtime}`,
    `Acceptance ready: ${report.ok ? 'yes' : 'no'}`,
    `Review required: ${report.review_required ? 'yes' : 'no'}`,
    `Grounding review required: ${report.grounding_review_required ? 'yes' : 'no'}`,
    '',
    '| Gate | Verdict | Issues | Errors | Warnings |',
    '|---|---|---:|---:|---:|',
    formatGate('Compile freshness', report.compiled_matches_output ? 'pass' : 'stale', report.compiled_matches_output ? 0 : 1, report.compiled_matches_output ? 0 : 1, 0),
    formatGate('Layout QA', report.layout.verdict, report.layout.issues, report.layout.errors, report.layout.warnings),
    formatGate('Reference Visual QA', report.reference_visual.verdict, report.reference_visual.issues, report.reference_visual.errors, report.reference_visual.warnings),
    ...(report.visual_relations ? [formatGate('Visual Relation QA', report.visual_relations.verdict, report.visual_relations.issues, report.visual_relations.errors, report.visual_relations.warnings)] : []),
    ...(report.geometry_fit ? [formatGate('GeometryFit QA', report.geometry_fit.verdict, report.geometry_fit.issues, report.geometry_fit.errors, report.geometry_fit.warnings)] : []),
    ...(report.grounding_v3 ? [formatGate('Grounding v3 QA', report.grounding_v3.verdict, report.grounding_v3.issues, report.grounding_v3.errors, report.grounding_v3.warnings)] : []),
    formatGate('Physical Consistency', report.physical_consistency.verdict, report.physical_consistency.issues, report.physical_consistency.errors, report.physical_consistency.warnings),
    '',
    '## PartGraph',
    '',
    `- ID: \`${report.part_graph.id}\``,
    `- Parts: ${report.part_graph.parts}`,
    `- Evidence: ${Object.entries(report.part_graph.evidence_summary).map(([key, count]) => `${key} ${count}`).join(', ') || 'none'}`
  ];
  if (report.artifact) {
    const totals = report.artifact.totals
      ? ` (${report.artifact.totals.groups} groups / ${report.artifact.totals.faces} faces / ${report.artifact.totals.edges} edges)`
      : '';
    lines.push('', '## Artifact', '', `- \`${report.artifact.path}\`${totals}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function formatGate(name, verdict, issues, errors, warnings) {
  return `| ${name} | ${verdict} | ${issues} | ${errors} | ${warnings} |`;
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(resolveRepo(relativePath), 'utf8'));
}

function resolveRepo(value) {
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--name') options.name = argv[++index];
    else if (arg === '--profile') options.profile = argv[++index];
    else if (arg === '--part-graph') options.partGraph = argv[++index];
    else if (arg === '--code') options.code = argv[++index];
    else if (arg === '--layout-spec') options.layoutSpec = argv[++index];
    else if (arg === '--reference-spec') options.referenceSpec = argv[++index];
    else if (arg === '--observations') options.observations = argv[++index];
    else if (arg === '--visual-relations-fixture') options.visualRelationsFixture = argv[++index];
    else if (arg === '--geometry-fit-fixture') options.geometryFitFixture = argv[++index];
    else if (arg === '--output-dir') options.outputDir = argv[++index];
    else if (arg === '--runtime') options.runtime = argv[++index];
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else if (arg === '--save-skp') options.saveSkp = argv[++index];
    else if (arg === '--save-artifact') options.saveArtifact = true;
    else if (arg === '--require-pass') options.requirePass = true;
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
  node projects/image-structured-modeler/scripts/run-proposal-review-qa.mjs \\
    --runtime mock \\
    --output-dir output/image-structured-proposal-qa/ambulance

Use --runtime queue --timeout-ms 180000 --save-skp output/image-structured-ambulance-proposal-applied.skp
to build the currently accepted proposal-applied PartGraph in SketchUp and save a live artifact.
By default the script records review-gate results without failing when QA is not acceptance-ready.
Pass --observations plus --visual-relations-fixture or --geometry-fit-fixture to include image-space grounding gates.
Pass --require-pass when the proposal-applied graph must satisfy all gates.
`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
