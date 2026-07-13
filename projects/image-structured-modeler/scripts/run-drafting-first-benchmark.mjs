#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  annotateObservationSetWithDraftingFirstGraphs,
  draftViewGraphSummary,
  objectSurfaceGraphSummary,
  structureEvidenceGraphSummary
} from './lib/drafting-first-graphs.mjs';
import { buildStructuredAssetIntake } from './intake-assets.mjs';
import { repoRoot } from './lib/image-analysis.mjs';
import { runFacadeDraftingStudy } from './run-facade-drafting-study.mjs';
import { runInteriorDraftingStudy } from './run-interior-drafting-study.mjs';
import { runObjectSurfaceStudy } from './run-object-surface-study.mjs';
import { runExternalBenchmarkAdapter, supportedExternalBenchmarkAdapters } from './lib/external-benchmark-adapter.mjs';

const scriptRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const DEFAULT_TIER1_MANIFEST = 'projects/image-structured-modeler/benchmarks/tier1-external-sample-manifest.json';

const TIER0_CASES = [
  {
    id: 'yellow_building_single',
    domain: 'building_single',
    mode: 'intake',
    input: 'projects/image-structured-modeler/examples/building-single-anime-yellow/input-visible-crop.png',
    objectType: 'building_single',
    objectName: 'Anime Yellow Building Visible Crop',
    viewHintsFile: 'projects/image-structured-modeler/examples/building-single-anime-yellow/view-hints.json',
    buildingSingleAnnotations: 'projects/image-structured-modeler/examples/building-single-anime-yellow/building-single-annotations.md',
    buildingSingleVlmCandidates: 'projects/image-structured-modeler/examples/building-single-anime-yellow/building-single-vlm-candidates.json'
  },
  {
    id: 'building_group',
    domain: 'building_group',
    mode: 'observations',
    observations: 'projects/image-structured-modeler/examples/building-group/observations.json'
  },
  {
    id: 'building_real_photo_smoke',
    domain: 'building_group',
    mode: 'observations',
    observations: 'projects/image-structured-modeler/examples/building-real-photo-smoke/observations.json'
  },
  {
    id: 'switch_controller',
    domain: 'product',
    mode: 'observations',
    observations: 'projects/image-structured-modeler/examples/switch-controller/observations.json'
  },
  {
    id: 'compact_remote',
    domain: 'product',
    mode: 'observations',
    observations: 'projects/image-structured-modeler/examples/compact-remote/observations.json'
  },
  {
    id: 'ambulance',
    domain: 'vehicle',
    mode: 'observations',
    observations: 'projects/image-structured-modeler/examples/ambulance/observations.json'
  },
  {
    id: 'ambulance_object_surface_reviewed_subset',
    domain: 'vehicle',
    mode: 'object_surface_study',
    sample: 'projects/image-structured-modeler/examples/ambulance/object-surface-study/sample.json'
  },
  {
    id: 'fuji_camera_profile_reference',
    domain: 'camera_product_profile',
    mode: 'profile_reference',
    profile: 'examples/product-profiles/camera_fuji_x_t10.json',
    partGraph: 'examples/part-graphs/fuji-camera-reference.part-graph.json'
  }
];

export async function runDraftingFirstBenchmark({
  tier = 'tier0',
  output = null,
  manifest = DEFAULT_TIER1_MANIFEST,
  outputDir = null
} = {}) {
  const resolvedOutput = path.resolve(repoRoot || scriptRoot, output || `output/image-structured-benchmark/${tier}/benchmark-report.json`);
  const resolvedOutputDir = outputDir
    ? path.resolve(repoRoot || scriptRoot, outputDir)
    : path.dirname(resolvedOutput);
  await fs.mkdir(resolvedOutputDir, { recursive: true });
  const report = tier === 'tier1'
    ? await runTier1({ manifest, resolvedOutputDir })
    : await runTier0({ resolvedOutputDir });
  await fs.writeFile(resolvedOutput, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(resolvedOutput.replace(/\.json$/u, '.md'), renderBenchmarkMarkdown(report), 'utf8');
  return { report, output: resolvedOutput };
}

async function runTier0({ resolvedOutputDir }) {
  const cases = [];
  for (const fixture of TIER0_CASES) {
    try {
      if (fixture.mode === 'intake') {
        const caseOutputDir = path.join(resolvedOutputDir, fixture.id);
        const intake = await buildStructuredAssetIntake({
          input: fixture.input,
          objectType: fixture.objectType,
          objectName: fixture.objectName,
          viewHintsFile: fixture.viewHintsFile,
          buildingSingleAnnotations: fixture.buildingSingleAnnotations,
          buildingSingleVlmCandidates: fixture.buildingSingleVlmCandidates,
          outputDir: path.relative(repoRoot, caseOutputDir),
          writeOverlays: false,
          writeReview: true,
          writeMcpBrief: true
        });
        cases.push(caseFromIntake(fixture, intake));
      } else if (fixture.mode === 'observations') {
        const observationSet = await readJson(fixture.observations);
        const drafting = annotateObservationSetWithDraftingFirstGraphs({ observationSet });
        cases.push(caseFromDraftingGraphs(fixture, drafting));
      } else if (fixture.mode === 'profile_reference') {
        cases.push(await caseFromProfileReference(fixture));
      } else if (fixture.mode === 'object_surface_study') {
        const caseOutputDir = path.join(resolvedOutputDir, fixture.id);
        const result = await runObjectSurfaceStudy({
          sample: fixture.sample,
          outputDir: caseOutputDir,
          acceptedReviewFixtures: true
        });
        cases.push(caseFromObjectSurfaceStudy(fixture, result, caseOutputDir));
      } else {
        throw new Error(`Unknown Tier0 fixture mode: ${fixture.mode}`);
      }
    } catch (error) {
      cases.push({
        id: fixture.id,
        domain: fixture.domain,
        source: fixture.input || fixture.observations || fixture.profile || fixture.sample || '',
        status: 'fail',
        artifacts: {},
        metrics: {
          error: error.message
        }
      });
    }
  }
  return benchmarkReport({
    tier: 'tier0',
    cases,
    datasetManifest: null,
    notes: [
      'Tier0 uses repository fixtures and writes only output/ benchmark artifacts.',
      'Live SketchUp is not part of the default benchmark gate.'
    ]
  });
}

async function runTier1({ manifest, resolvedOutputDir }) {
  const manifestPath = path.resolve(repoRoot || scriptRoot, manifest);
  const datasetManifest = await readJson(manifestPath);
  const cases = [];
  for (const sample of datasetManifest.samples || []) {
    const localPath = sample.local_path ? path.resolve(repoRoot || scriptRoot, sample.local_path) : null;
    const exists = localPath ? await pathExists(localPath) : false;
    if (sample.adapter === 'facade_drafting_study_adapter' && exists) {
      try {
        const caseOutputDir = path.join(resolvedOutputDir, sample.id);
        const result = await runFacadeDraftingStudy({
          sample: sample.sample_config,
          outputDir: caseOutputDir,
          acceptedStudyReviewFixture: true,
          acceptedLocalDetailReviewFixture: true
        });
        cases.push(caseFromFacadeDraftingStudy(sample, result, caseOutputDir));
      } catch (error) {
        cases.push({
          id: sample.id,
          domain: sample.domain || 'building_single',
          source: sample.dataset_url || sample.local_path || '',
          status: 'fail',
          artifacts: { adapter: sample.adapter, sample_config: sample.sample_config },
          metrics: { dataset_available: true, adapter_executed: true, false_promotion_count: 0, error: error.message }
        });
      }
      continue;
    }
    if (sample.adapter === 'interior_drafting_study_adapter' && exists) {
      try {
        const caseOutputDir = path.join(resolvedOutputDir, sample.id);
        const result = await runInteriorDraftingStudy({
          sample: sample.sample_config,
          outputDir: caseOutputDir,
          acceptedReviewFixtures: true
        });
        cases.push(caseFromInteriorDraftingStudy(sample, result, caseOutputDir));
      } catch (error) {
        cases.push({
          id: sample.id,
          domain: sample.domain || 'interior_room',
          source: sample.dataset_url || sample.local_path || '',
          status: 'fail',
          artifacts: { adapter: sample.adapter, sample_config: sample.sample_config },
          metrics: { dataset_available: true, adapter_executed: true, false_promotion_count: 0, error: error.message }
        });
      }
      continue;
    }
    if (supportedExternalBenchmarkAdapters().includes(sample.adapter) && exists) {
      const adapterReport = await runExternalBenchmarkAdapter({ sample, packageDir: localPath });
      const caseOutputDir = path.join(resolvedOutputDir, sample.id);
      await fs.mkdir(caseOutputDir, { recursive: true });
      await fs.writeFile(path.join(caseOutputDir, 'external-adapter-report.json'), `${JSON.stringify(adapterReport, null, 2)}\n`, 'utf8');
      cases.push({
        id: sample.id,
        domain: sample.domain || sample.dataset || 'external',
        source: sample.dataset_url || sample.local_path || '',
        status: adapterReport.status === 'ready_for_evidence_review'
          ? 'review'
          : adapterReport.status === 'blocked_sample_package_incomplete'
            ? 'blocked_external_dataset_unavailable'
            : 'fail',
        artifacts: {
          local_path: sample.local_path,
          dataset: sample.dataset,
          license_note: sample.license_note,
          adapter: sample.adapter,
          sample_package: path.join(sample.local_path, 'sample-package.json'),
          adapter_report: path.join(path.relative(repoRoot || scriptRoot, caseOutputDir), 'external-adapter-report.json')
        },
        metrics: { ...adapterReport.metrics, dataset_available: true, adapter_executed: true, adapter_status: adapterReport.status }
      });
      continue;
    }
    cases.push({
      id: sample.id,
      domain: sample.domain || sample.dataset || 'external',
      source: sample.dataset_url || sample.local_path || '',
      status: exists ? 'fail' : 'blocked_external_dataset_unavailable',
      artifacts: {
        local_path: sample.local_path || null,
        dataset: sample.dataset || null,
        license_note: sample.license_note || null,
        adapter: sample.adapter || null
      },
      metrics: {
        dataset_available: exists,
        adapter_executed: false,
        ...(exists ? { error: `Unsupported or unimplemented adapter: ${sample.adapter || 'missing'}` } : {}),
        expected_view_slots: sample.expected_view_slots || ['front', 'left_or_right_side', 'top', 'oblique_context'],
        false_promotion_count: 0
      }
    });
  }
  await fs.writeFile(path.join(resolvedOutputDir, 'tier1-external-sample-manifest.copy.json'), `${JSON.stringify(datasetManifest, null, 2)}\n`, 'utf8');
  return benchmarkReport({
    tier: 'tier1',
    cases,
    datasetManifest: path.relative(repoRoot || scriptRoot, manifestPath),
    notes: [
      'Tier1 is an adapter/manifest gate. It does not download external datasets.',
      'Prepare local external samples separately, then rerun this command.'
    ]
  });
}

function caseFromInteriorDraftingStudy(sample, result, caseOutputDir) {
  const relativeOutputDir = path.relative(repoRoot || scriptRoot, caseOutputDir);
  const report = result.report;
  const falsePromotionCount = Number(report.no_review_false_promotion_count || 0)
    + Number(result.detailPromotion?.false_promotion_count || 0);
  return {
    id: sample.id,
    domain: sample.domain || 'interior_room',
    source: sample.dataset_url || sample.local_path || '',
    status: report.model.qa_verdict === 'pass' && falsePromotionCount === 0 ? 'review' : 'fail',
    artifacts: {
      adapter: sample.adapter,
      sample_config: sample.sample_config,
      report: path.join(relativeOutputDir, 'interior-study-report.json'),
      comparison: path.join(relativeOutputDir, 'index.html'),
      structure_overlay: path.join(relativeOutputDir, '03-structure-calibration-overlay.png'),
      room_surface_graph: path.join(relativeOutputDir, '07-room-surface-graph.json'),
      room_review_overlay: path.join(relativeOutputDir, '17-room-surface-review-overlay.png'),
      part_graph: path.join(relativeOutputDir, '19-reviewed-visible-room-part-graph.json'),
      sketchup_dsl: path.join(relativeOutputDir, '20-sketchup-dsl.mock-study.json'),
      mock_qa: path.join(relativeOutputDir, '22-mock-qa.json'),
      license_note: sample.license_note || null
    },
    metrics: {
      dataset_available: true,
      adapter_executed: true,
      camera_model: result.calibrationReviewResult.accepted_camera_model,
      accepted_surface_count: result.surfaceReviewResult.accepted_surface_ids.length,
      accepted_detail_count: result.detailPromotion.accepted_details.length,
      excluded_region_count: result.coverageResult.excluded_regions.length,
      exclusion_geometry_compiled: false,
      part_graph_generated: report.model.part_graph_generated,
      sketchup_dsl_generated: report.model.sketchup_dsl_generated,
      mock_qa_verdict: report.model.qa_verdict,
      visual_status: report.completion_status.visual_status,
      release_status: report.completion_status.release_status,
      false_promotion_count: falsePromotionCount
    }
  };
}

function caseFromFacadeDraftingStudy(sample, result, caseOutputDir) {
  const relativeOutputDir = path.relative(repoRoot || scriptRoot, caseOutputDir);
  const report = result.report;
  const calibration = result.calibration;
  const falsePromotionCount = Number(report.no_review_false_promotion_count || 0)
    + Number(result.detailPromotion?.false_promotion_count || 0);
  return {
    id: sample.id,
    domain: sample.domain || 'building_single',
    source: sample.dataset_url || sample.local_path || '',
    status: report.model.qa_verdict === 'pass' && falsePromotionCount === 0 ? 'review' : 'fail',
    artifacts: {
      adapter: sample.adapter,
      sample_config: sample.sample_config,
      report: path.join(relativeOutputDir, 'facade-study-report.json'),
      comparison: path.join(relativeOutputDir, 'index.html'),
      perspective_overlay: path.join(relativeOutputDir, 'calibration/02-perspective-direction-families.png'),
      topology_overlay: path.join(relativeOutputDir, 'calibration/04-calibrated-plane-topology.png'),
      plane_local_evidence: path.join(relativeOutputDir, 'plane-local-evidence/index.html'),
      source_reprojection: path.join(relativeOutputDir, '11-source-reprojection.png'),
      part_graph: path.join(relativeOutputDir, '04-reviewed-visible-facade-part-graph.json'),
      sketchup_dsl: path.join(relativeOutputDir, '05-sketchup-dsl.mock-study.json'),
      mock_qa: path.join(relativeOutputDir, '07-mock-qa.json'),
      license_note: sample.license_note || null
    },
    metrics: {
      dataset_available: true,
      adapter_executed: true,
      calibration_line_recall: calibration.report.metrics.structural_length_coverage_recall,
      two_horizontal_families: calibration.report.gates.two_horizontal_families,
      accepted_visible_plane_count: report.accepted_plane_ids.length,
      unknown_axis_visible_plane_count: calibration.topologySeed.plane_spans.filter((span) => span.orientation_axis === 'unknown').length,
      rectified_plane_count: result.planeLocalEvidence.graph.summary.plane_count,
      plane_local_detail_proposal_count: result.planeLocalEvidence.graph.summary.detail_instance_proposal_count,
      accepted_partial_detail_count: result.detailPromotion.accepted_details.length,
      part_graph_generated: report.model.part_graph_generated,
      sketchup_dsl_generated: report.model.sketchup_dsl_generated,
      mock_qa_verdict: report.model.qa_verdict,
      visual_status: report.completion_status.visual_status,
      release_status: report.completion_status.release_status,
      false_promotion_count: falsePromotionCount
    }
  };
}

function caseFromIntake(fixture, intake) {
  const draftSummary = draftViewGraphSummary(intake.draftViewGraph);
  const structureSummary = structureEvidenceGraphSummary(intake.structureEvidenceGraph);
  const surfaceSummary = objectSurfaceGraphSummary(intake.objectSurfaceGraph);
  return {
    id: fixture.id,
    domain: fixture.domain,
    source: fixture.input,
    status: intake.promotionPatch?.apply_allowed === true ? 'fail' : 'review',
    artifacts: {
      intake_summary: intake.intakeSummary?.artifacts?.intake_summary || null,
      structure_evidence_graph: intake.intakeSummary?.artifacts?.structure_evidence_graph || null,
      draft_view_graph: intake.intakeSummary?.artifacts?.draft_view_graph || null,
      object_surface_graph: intake.intakeSummary?.artifacts?.object_surface_graph || null,
      mcp_modeling_brief: intake.intakeSummary?.artifacts?.mcp_modeling_brief || null
    },
    metrics: {
      structure_edges: structureSummary?.edge_evidence_count || 0,
      draft_observed_slots: draftSummary?.observed_slots || 0,
      draft_unknown_slots: draftSummary?.unknown_slots || 0,
      object_surfaces: surfaceSummary?.surface_count || 0,
      false_promotion_count: intake.promotionPatch?.apply_allowed === true ? 1 : 0
    }
  };
}

function caseFromDraftingGraphs(fixture, drafting) {
  const draftSummary = draftViewGraphSummary(drafting.draftViewGraph);
  const structureSummary = structureEvidenceGraphSummary(drafting.structureEvidenceGraph);
  const surfaceSummary = objectSurfaceGraphSummary(drafting.objectSurfaceGraph);
  const falsePromotionCount = 0;
  return {
    id: fixture.id,
    domain: fixture.domain,
    source: fixture.observations,
    status: draftSummary?.observed_slots > 0 ? 'review' : 'fail',
    artifacts: {
      observations: fixture.observations
    },
    metrics: {
      structure_edges: structureSummary?.edge_evidence_count || 0,
      structure_planes: structureSummary?.plane_hypothesis_count || 0,
      draft_observed_slots: draftSummary?.observed_slots || 0,
      draft_inferred_slots: draftSummary?.inferred_slots || 0,
      draft_unknown_slots: draftSummary?.unknown_slots || 0,
      object_surfaces: surfaceSummary?.surface_count || 0,
      surface_local_features: surfaceSummary?.feature_candidate_count || 0,
      false_promotion_count: falsePromotionCount
    }
  };
}

function caseFromObjectSurfaceStudy(fixture, result, caseOutputDir) {
  const relativeOutputDir = path.relative(repoRoot || scriptRoot, caseOutputDir);
  const report = result.report;
  const falsePromotionCount = Number(report.no_review_false_promotion_count || 0)
    + Number(result.featurePromotion?.false_promotion_count || 0);
  const draftSummary = draftViewGraphSummary(result.drafting.draftViewGraph);
  return {
    id: fixture.id,
    domain: fixture.domain,
    source: fixture.sample,
    status: report.model.qa_verdict === 'pass' && falsePromotionCount === 0 ? 'review' : 'fail',
    artifacts: {
      sample: fixture.sample,
      report: path.join(relativeOutputDir, 'object-surface-study-report.json'),
      comparison: path.join(relativeOutputDir, 'index.html'),
      draft_view_graph: path.join(relativeOutputDir, '02-draft-view-graph.json'),
      object_surface_graph: path.join(relativeOutputDir, '03-object-surface-graph.json'),
      feature_promotion: path.join(relativeOutputDir, '08-object-surface-feature-promotion.json'),
      part_graph: path.join(relativeOutputDir, '11-reviewed-feature-subset-part-graph.json'),
      sketchup_dsl: path.join(relativeOutputDir, '12-sketchup-dsl.mock-study.json'),
      mock_qa: path.join(relativeOutputDir, '14-mock-qa.json')
    },
    metrics: {
      draft_observed_slots: draftSummary?.observed_slots || 0,
      draft_unknown_slots: draftSummary?.unknown_slots || 0,
      accepted_surface_count: report.model.accepted_surface_count,
      accepted_feature_count: report.model.accepted_feature_count,
      accepted_target_part_count: report.model.accepted_target_part_count,
      context_only_surface_count: result.surfaceReviewResult.context_only_surface_ids.length,
      part_graph_generated: report.model.part_graph_generated,
      sketchup_dsl_generated: report.model.sketchup_dsl_generated,
      mock_qa_verdict: report.model.qa_verdict,
      release_allowed: report.model.release_allowed,
      false_promotion_count: falsePromotionCount
    }
  };
}

async function caseFromProfileReference(fixture) {
  const [profile, partGraph] = await Promise.all([
    readJson(fixture.profile),
    readJson(fixture.partGraph)
  ]);
  return {
    id: fixture.id,
    domain: fixture.domain,
    source: fixture.profile,
    status: 'review',
    artifacts: {
      profile: fixture.profile,
      reference_part_graph: fixture.partGraph
    },
    metrics: {
      profile_id: profile.profile_id || profile.id || 'unknown',
      reference_parts: Array.isArray(partGraph.parts) ? partGraph.parts.length : 0,
      draft_observed_slots: 0,
      draft_unknown_slots: 4,
      false_promotion_count: 0,
      note: 'Profile reference coverage only; no image evidence or promotion is generated.'
    }
  };
}

function benchmarkReport({ tier, cases, datasetManifest, notes }) {
  const summary = {
    case_count: cases.length,
    pass_count: cases.filter((item) => item.status === 'pass').length,
    review_count: cases.filter((item) => item.status === 'review').length,
    blocked_count: cases.filter((item) => item.status === 'blocked_external_dataset_unavailable').length,
    fail_count: cases.filter((item) => item.status === 'fail').length
  };
  const falsePromotionCount = cases.reduce((sum, item) => sum + Number(item.metrics?.false_promotion_count || 0), 0);
  return {
    kind: 'image_structured_benchmark_report',
    version: 1,
    tier,
    status: falsePromotionCount > 0 || summary.fail_count > 0
      ? 'fail'
      : summary.blocked_count > 0
        ? 'blocked_external_dataset_unavailable'
        : summary.review_count > 0
          ? 'review'
          : 'pass',
    generated_at: new Date().toISOString(),
    dataset_manifest: datasetManifest,
    cases,
    summary,
    false_promotion_count: falsePromotionCount,
    notes
  };
}

function renderBenchmarkMarkdown(report) {
  const lines = [
    '# Image Structured Benchmark',
    '',
    `- tier: \`${report.tier}\``,
    `- status: \`${report.status}\``,
    `- false_promotion_count: \`${report.false_promotion_count}\``,
    '',
    '| case | domain | status | draft observed | draft unknown | false promotions |',
    '| --- | --- | --- | ---: | ---: | ---: |'
  ];
  for (const item of report.cases || []) {
    lines.push(`| ${item.id} | ${item.domain} | ${item.status} | ${item.metrics?.draft_observed_slots ?? 'n/a'} | ${item.metrics?.draft_unknown_slots ?? 'n/a'} | ${item.metrics?.false_promotion_count || 0} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.resolve(repoRoot || scriptRoot, relativePath), 'utf8'));
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--tier') options.tier = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--output-dir') options.outputDir = argv[++index];
    else if (arg === '--manifest') options.manifest = argv[++index];
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/run-drafting-first-benchmark.mjs --tier tier0 --output output/image-structured-benchmark/tier0/benchmark-report.json
  node projects/image-structured-modeler/scripts/run-drafting-first-benchmark.mjs --tier tier1 --manifest projects/image-structured-modeler/benchmarks/tier1-external-sample-manifest.json
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runDraftingFirstBenchmark(parseArgs(process.argv.slice(2)))
    .then(({ report, output }) => {
      process.stdout.write(`${JSON.stringify({
        ok: report.status !== 'fail',
        status: report.status,
        tier: report.tier,
        cases: report.summary.case_count,
        false_promotion_count: report.false_promotion_count,
        output
      }, null, 2)}\n`);
      if (report.status === 'fail') process.exit(1);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exit(1);
    });
}
