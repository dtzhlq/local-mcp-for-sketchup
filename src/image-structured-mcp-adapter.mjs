import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { exportMcpModelingBriefCli } from '../projects/image-structured-modeler/scripts/export-mcp-modeling-brief.mjs';
import { compilePartGraphToSketchUpDsl } from './product-modeling/part-graph-compiler.mjs';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const IMAGE_SCHEMA_DIR = path.join(REPO_ROOT, 'projects', 'image-structured-modeler', 'schema');
const SCHEMA_DIR = path.join(REPO_ROOT, 'schema');

const PREPARE_SCHEMA_PATHS = {
  asset_set: path.join(IMAGE_SCHEMA_DIR, 'asset-set.schema.json'),
  observations: path.join(IMAGE_SCHEMA_DIR, 'image-set-observation.schema.json'),
  candidate_graph: path.join(IMAGE_SCHEMA_DIR, 'candidate-graph.schema.json'),
  modeling_brief: path.join(IMAGE_SCHEMA_DIR, 'modeling-brief.schema.json'),
  promotion_review: path.join(IMAGE_SCHEMA_DIR, 'candidate-promotion-review.schema.json'),
  source_package: path.join(IMAGE_SCHEMA_DIR, 'real-world-building-source-package.schema.json'),
  mcp_brief: path.join(IMAGE_SCHEMA_DIR, 'mcp-modeling-brief.schema.json')
};

const COMPILE_SCHEMA_PATHS = {
  mcp_brief: PREPARE_SCHEMA_PATHS.mcp_brief,
  promotion_review: PREPARE_SCHEMA_PATHS.promotion_review,
  part_graph: path.join(SCHEMA_DIR, 'part-graph.schema.json'),
  profile: path.join(SCHEMA_DIR, 'product-profile.schema.json')
};

export async function prepareImageModelingBrief(options = {}) {
  const inputDir = option(options, 'input_dir', 'inputDir');
  const baseDir = inputDir ? resolveRepo(inputDir) : null;
  const outputDir = resolveRepo(option(options, 'output_dir', 'outputDir') || baseDir || 'output/image-structured-mcp/brief');
  const outputJson = resolveRepo(option(options, 'output_json', 'outputJson') || path.join(outputDir, 'mcp-modeling-brief.json'));
  const outputMarkdown = resolveRepo(option(options, 'output_markdown', 'outputMarkdown') || path.join(outputDir, 'mcp-modeling-brief.md'));
  const gateReportPath = path.join(outputDir, 'prepare-gate-report.json');
  const paths = {
    asset_set: resolveInputPath(options, baseDir, ['asset_set_path', 'assetSetPath'], 'asset-set.json'),
    observations: resolveInputPath(options, baseDir, ['observations_path', 'observationsPath'], 'observations.json'),
    candidate_graph: resolveInputPath(options, baseDir, ['candidate_graph_path', 'candidateGraphPath'], 'candidate-graph.json'),
    modeling_brief: resolveInputPath(options, baseDir, ['modeling_brief_path', 'modelingBriefPath'], 'modeling-brief.json'),
    promotion_review: resolveOptionalInputPath(options, baseDir, ['promotion_review_path', 'promotionReviewPath'], 'candidate-promotion-review.draft.json'),
    source_package: resolveOptionalInputPath(options, baseDir, ['source_package_path', 'sourcePackagePath'], 'real-world-building-source-package.json')
  };

  await fs.mkdir(outputDir, { recursive: true });
  const schemaChecks = {};
  const blockers = [];
  for (const key of ['asset_set', 'observations', 'candidate_graph', 'modeling_brief']) {
    const check = await validatePathArtifact(key, paths[key], PREPARE_SCHEMA_PATHS[key]);
    schemaChecks[key] = check;
    if (!check.ok) blockers.push(...check.blockers);
  }
  for (const key of ['promotion_review', 'source_package']) {
    if (!paths[key] || !(await pathExists(paths[key]))) continue;
    const check = await validatePathArtifact(key, paths[key], PREPARE_SCHEMA_PATHS[key]);
    schemaChecks[key] = check;
    if (!check.ok) blockers.push(...check.blockers);
  }
  if (!paths.promotion_review || !(await pathExists(paths.promotion_review))) blockers.push('promotion_review_missing');

  if (blockers.some((reason) => reason.startsWith('missing_') || reason.includes('_schema_invalid'))) {
    const report = prepareGateReport({ paths, outputJson, outputMarkdown, schemaChecks, blockers, brief: null });
    await writeJson(gateReportPath, report);
    return { ...report, artifacts: { gate_report: gateReportPath } };
  }

  const exported = await exportMcpModelingBriefCli({
    inputDir: baseDir,
    assetSetPath: paths.asset_set,
    observationsPath: paths.observations,
    candidateGraphPath: paths.candidate_graph,
    modelingBriefPath: paths.modeling_brief,
    promotionReviewPath: paths.promotion_review,
    sourcePackagePath: paths.source_package,
    outputJson,
    outputMarkdown,
    maxCandidates: Number(option(options, 'max_candidates', 'maxCandidates') || 80)
  });
  const mcpBriefCheck = await validateDocument('mcp_brief', exported.brief, PREPARE_SCHEMA_PATHS.mcp_brief);
  schemaChecks.mcp_brief = mcpBriefCheck;
  if (!mcpBriefCheck.ok) blockers.push(...mcpBriefCheck.blockers);
  if (exported.brief.compile_permission?.can_generate_sketchup_dsl !== true) {
    blockers.push(...(exported.brief.compile_permission?.reasons || ['mcp_brief_compile_permission_denied']));
  }
  const report = prepareGateReport({ paths, outputJson, outputMarkdown, schemaChecks, blockers, brief: exported.brief });
  await writeJson(gateReportPath, report);
  return {
    ...report,
    brief: exported.brief,
    artifacts: {
      mcp_brief: outputJson,
      mcp_brief_markdown: outputMarkdown,
      gate_report: gateReportPath
    }
  };
}

export async function compileReviewedPartGraph(options = {}) {
  const outputDir = resolveRepo(option(options, 'output_dir', 'outputDir') || 'output/image-structured-mcp/compile');
  const dslPath = resolveRepo(option(options, 'output_dsl', 'outputDsl') || path.join(outputDir, 'sketchup-preview.dsl.json'));
  const gateReportPath = path.join(outputDir, 'compile-gate-report.json');
  const manifestPath = path.join(outputDir, 'manifest.json');
  const paths = {
    mcp_brief: resolveRequiredPath(options, ['mcp_brief_path', 'mcpBriefPath']),
    promotion_review: resolveRequiredPath(options, ['promotion_review_path', 'promotionReviewPath']),
    part_graph: resolveRequiredPath(options, ['part_graph_path', 'partGraphPath']),
    profile: resolveRequiredPath(options, ['profile_path', 'profilePath'])
  };
  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all([fs.rm(dslPath, { force: true }), fs.rm(manifestPath, { force: true })]);

  const documents = {};
  const schemaChecks = {};
  const blockers = [];
  for (const key of Object.keys(paths)) {
    const check = await validatePathArtifact(key, paths[key], COMPILE_SCHEMA_PATHS[key]);
    schemaChecks[key] = check;
    if (check.ok) documents[key] = check.document;
    else blockers.push(...check.blockers);
  }

  if (documents.mcp_brief?.compile_permission?.can_generate_sketchup_dsl !== true) {
    blockers.push('mcp_brief_compile_permission_denied', ...(documents.mcp_brief?.compile_permission?.reasons || []));
  }
  if (documents.promotion_review) {
    if (documents.promotion_review.promotion_allowed !== true) blockers.push('promotion_review_promotion_not_allowed');
    if (documents.promotion_review.compile_allowed !== true) blockers.push('promotion_review_compile_not_allowed');
    if (documents.promotion_review.verdict !== 'accepted_subset') blockers.push('promotion_review_verdict_not_accepted_subset');
  }
  if (documents.part_graph) blockers.push(...partGraphReviewBlockers(documents.part_graph));
  blockers.push(...identityAlignmentBlockers(documents));

  let dsl = null;
  if (unique(blockers).length === 0) {
    try {
      dsl = compilePartGraphToSketchUpDsl(documents.part_graph, documents.profile, {
        repoRoot: REPO_ROOT,
        partGraphPath: paths.part_graph,
        profilePath: paths.profile
      });
    } catch (error) {
      blockers.push(`part_graph_compiler_gate_failed:${error.message}`);
    }
  }

  const finalBlockers = unique(blockers);
  const allowed = finalBlockers.length === 0 && dsl !== null;
  const report = {
    version: 1,
    kind: 'image_structured_part_graph_compile_gate',
    ok: allowed,
    blocked: !allowed,
    preview_only: true,
    queue_called: false,
    compile_allowed: allowed,
    blockers: finalBlockers,
    inputs: relativePaths(paths),
    schema_checks: summarizeChecks(schemaChecks),
    part_graph_review: documents.part_graph ? summarizePartGraphReview(documents.part_graph) : null,
    output_dsl: allowed ? relativePath(dslPath) : null
  };
  if (allowed) await writeJson(dslPath, dsl);
  await writeJson(gateReportPath, report);

  if (allowed) {
    const manifest = {
      version: 1,
      kind: 'image_structured_mcp_compile_manifest',
      created_at: new Date().toISOString(),
      preview_only: true,
      queue_called: false,
      inputs: report.inputs,
      artifacts: {
        safe_json_dsl_preview: relativePath(dslPath),
        compile_gate_report: relativePath(gateReportPath)
      },
      summary: {
        operation_count: dsl.operations?.length || 0,
        profile_id: documents.profile.profile_id,
        part_graph_id: documents.part_graph.id
      }
    };
    await writeJson(manifestPath, manifest);
  }
  return {
    ...report,
    artifacts: {
      gate_report: gateReportPath,
      ...(allowed ? { safe_json_dsl_preview: dslPath, manifest: manifestPath } : {})
    }
  };
}

function prepareGateReport({ paths, outputJson, outputMarkdown, schemaChecks, blockers, brief }) {
  const finalBlockers = unique(blockers);
  const schemaValid = Object.values(schemaChecks).every((check) => check.ok);
  const compileAllowed = schemaValid && brief?.compile_permission?.can_generate_sketchup_dsl === true && finalBlockers.length === 0;
  return {
    version: 1,
    kind: 'image_modeling_brief_prepare_gate',
    ok: schemaValid && brief !== null,
    blocked: !compileAllowed,
    compile_allowed: compileAllowed,
    blockers: finalBlockers,
    inputs: relativePaths(paths),
    schema_checks: summarizeChecks(schemaChecks),
    outputs: brief ? { mcp_brief: relativePath(outputJson), mcp_brief_markdown: relativePath(outputMarkdown) } : {}
  };
}

async function validatePathArtifact(label, filePath, schemaPath) {
  if (!filePath || !(await pathExists(filePath))) {
    return { ok: false, label, path: filePath || null, blockers: [`missing_${label}_artifact`] };
  }
  let document;
  try {
    document = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    return { ok: false, label, path: filePath, blockers: [`${label}_json_invalid:${error.message}`] };
  }
  const check = await validateDocument(label, document, schemaPath);
  return { ...check, path: filePath, document };
}

async function validateDocument(label, document, schemaPath) {
  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const ok = validate(document);
  const errors = ok ? [] : (validate.errors || []).map((error) => `${error.instancePath || '/'} ${error.message}`);
  return {
    ok,
    label,
    schema: relativePath(schemaPath),
    errors,
    blockers: ok ? [] : [`${label}_schema_invalid`, ...errors.map((error) => `${label}_schema:${error}`)]
  };
}

function partGraphReviewBlockers(partGraph) {
  const blockers = [];
  if (!partGraph.review || typeof partGraph.review !== 'object') blockers.push('part_graph_review_missing');
  for (const part of partGraph.parts || []) {
    if (part.review_required === true) blockers.push(`part_graph_part_review_required:${part.id}`);
    if (part.qa?.part_graph_review_required === true) blockers.push(`part_graph_qa_review_required:${part.id}`);
  }
  for (const proposal of partGraph.review?.parameter_proposals || []) {
    if (proposal.review_required === true || proposal.status === 'needs_review') blockers.push(`part_graph_parameter_review_required:${proposal.path || proposal.parameter}`);
  }
  return blockers;
}

function summarizePartGraphReview(partGraph) {
  const blockers = partGraphReviewBlockers(partGraph);
  return {
    review_metadata_present: Boolean(partGraph.review && typeof partGraph.review === 'object'),
    parts: partGraph.parts?.length || 0,
    unresolved_review_markers: blockers.length,
    accepted: blockers.length === 0
  };
}

function identityAlignmentBlockers(documents) {
  const blockers = [];
  const profileIds = unique([
    documents.mcp_brief?.profile_id,
    documents.promotion_review?.profile_id,
    documents.part_graph?.profile_id,
    documents.profile?.profile_id
  ].filter(Boolean));
  if (profileIds.length > 1) blockers.push(`profile_id_mismatch:${profileIds.join(',')}`);
  const assetSetIds = unique([documents.mcp_brief?.asset_set_id, documents.promotion_review?.asset_set_id].filter(Boolean));
  if (assetSetIds.length > 1) blockers.push(`asset_set_id_mismatch:${assetSetIds.join(',')}`);
  return blockers;
}

function resolveInputPath(options, baseDir, aliases, defaultName) {
  const explicit = aliases.map((key) => options[key]).find((value) => value !== undefined);
  if (explicit) return resolveRepo(explicit);
  return baseDir ? path.join(baseDir, defaultName) : null;
}

function resolveOptionalInputPath(options, baseDir, aliases, defaultName) {
  return resolveInputPath(options, baseDir, aliases, defaultName);
}

function resolveRequiredPath(options, aliases) {
  const value = aliases.map((key) => options[key]).find((item) => item !== undefined);
  return value ? resolveRepo(value) : null;
}

function option(options, ...aliases) {
  return aliases.map((key) => options[key]).find((value) => value !== undefined);
}

function resolveRepo(value) {
  return path.isAbsolute(String(value)) ? path.resolve(String(value)) : path.resolve(REPO_ROOT, String(value));
}

function relativePaths(paths) {
  return Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, value ? relativePath(value) : null]));
}

function relativePath(value) {
  const relative = path.relative(REPO_ROOT, value);
  return relative && !relative.startsWith('..') ? relative : value;
}

function summarizeChecks(checks) {
  return Object.fromEntries(Object.entries(checks).map(([key, check]) => [key, {
    ok: check.ok,
    schema: check.schema || null,
    errors: check.errors || check.blockers || []
  }]));
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && String(value).trim() !== '').map(String))];
}
