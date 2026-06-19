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
      } else {
        throw new Error(`Unknown Tier0 fixture mode: ${fixture.mode}`);
      }
    } catch (error) {
      cases.push({
        id: fixture.id,
        domain: fixture.domain,
        source: fixture.input || fixture.observations || fixture.profile || '',
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
    cases.push({
      id: sample.id,
      domain: sample.domain || sample.dataset || 'external',
      source: sample.dataset_url || sample.local_path || '',
      status: exists ? 'review' : 'blocked_external_dataset_unavailable',
      artifacts: {
        local_path: sample.local_path || null,
        dataset: sample.dataset || null,
        license_note: sample.license_note || null,
        adapter: sample.adapter || null
      },
      metrics: {
        dataset_available: exists,
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
