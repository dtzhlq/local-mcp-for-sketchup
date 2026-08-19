import { constants as fsConstants } from 'node:fs';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { exportMcpModelingBriefCli } from './image-modeling-brief-exporter.mjs';
import { renderMcpModelingBriefMarkdown } from './image-modeling-brief.mjs';
import { compilePartGraphToSketchUpDsl } from './product-modeling/part-graph-compiler.mjs';
import {
  deriveImageStructuredReviewGate,
  verifyImageStructuredSourceAssets,
  verifyImageStructuredCompileBundle
} from './image-structured-provenance.mjs';
import { validatePartGraphSemanticContract } from './product-modeling/semantic-contract-qa.mjs';
import { expandArchitecturalPrimitives } from './product-modeling/architectural-primitives.mjs';
import { validatePartGraphPhysicalConsistency } from './product-modeling/physical-consistency-qa.mjs';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const IMAGE_SCHEMA_DIR = path.join(REPO_ROOT, 'schema', 'image-modeling');
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
  asset_set: PREPARE_SCHEMA_PATHS.asset_set,
  observations: PREPARE_SCHEMA_PATHS.observations,
  candidate_graph: PREPARE_SCHEMA_PATHS.candidate_graph,
  mcp_brief: PREPARE_SCHEMA_PATHS.mcp_brief,
  promotion_review: PREPARE_SCHEMA_PATHS.promotion_review,
  promotion_patch: path.join(IMAGE_SCHEMA_DIR, 'candidate-promotion-patch.schema.json'),
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

  await ensureSafeRepoOutputDirectory(outputDir);
  const schemaChecks = {};
  const documents = {};
  const blockers = [];
  for (const key of ['asset_set', 'observations', 'candidate_graph', 'modeling_brief']) {
    const check = await validatePathArtifact(key, paths[key], PREPARE_SCHEMA_PATHS[key]);
    schemaChecks[key] = check;
    if (check.ok) documents[key] = check.document;
    else blockers.push(...check.blockers);
  }
  for (const key of ['promotion_review', 'source_package']) {
    if (!paths[key] || !(await pathExists(paths[key]))) continue;
    const check = await validatePathArtifact(key, paths[key], PREPARE_SCHEMA_PATHS[key]);
    schemaChecks[key] = check;
    if (check.ok) documents[key] = check.document;
    else blockers.push(...check.blockers);
  }
  if (!paths.promotion_review || !(await pathExists(paths.promotion_review))) blockers.push('promotion_review_missing');

  if (Object.values(schemaChecks).some((check) => check.ok !== true)) {
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
    maxCandidates: Number(option(options, 'max_candidates', 'maxCandidates') || 80),
    writeOutputs: false
  });
  const reviewGate = deriveImageStructuredReviewGate({
    assetSet: documents.asset_set,
    observations: documents.observations,
    candidateGraph: documents.candidate_graph,
    promotionReview: documents.promotion_review
  });
  const sourceAssetVerification = await verifyImageStructuredSourceAssets({
    assetSet: documents.asset_set,
    repoRoot: REPO_ROOT
  });
  blockers.push(...sourceAssetVerification.blockers);
  const sourceAndReviewOk = reviewGate.ok && sourceAssetVerification.ok;
  exported.brief.compile_permission = {
    can_generate_sketchup_dsl: sourceAndReviewOk,
    can_promote_candidates: sourceAndReviewOk,
    reasons: sourceAndReviewOk
      ? ['part_graph_compiler_gate_required']
      : unique([...reviewGate.blockers, ...sourceAssetVerification.blockers])
  };
  exported.brief.provenance_gate = {
    kind: reviewGate.kind,
    ok: sourceAndReviewOk,
    signatures: reviewGate.signatures,
    accepted_candidate_ids: reviewGate.accepted_candidate_ids,
    source_asset_binding_hash: sourceAssetVerification.binding_hash,
    source_assets_verified: sourceAssetVerification.ok
  };
  await writeJson(outputJson, exported.brief);
  await writeText(outputMarkdown, renderMcpModelingBriefMarkdown(exported.brief));
  const mcpBriefCheck = await validateDocument('mcp_brief', exported.brief, PREPARE_SCHEMA_PATHS.mcp_brief);
  schemaChecks.mcp_brief = mcpBriefCheck;
  if (!mcpBriefCheck.ok) blockers.push(...mcpBriefCheck.blockers);
  blockers.push(...reviewGate.blockers);
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

export async function prepareImageCompileReview(options = {}) {
  const approvalAuthority = options.approvalAuthority;
  if (!approvalAuthority || typeof approvalAuthority.createChallenge !== 'function') {
    throw new Error('prepareImageCompileReview requires the server ApprovalAuthority');
  }
  const paths = compileInputPaths(options);
  const documents = {};
  const schemaChecks = {};
  const blockers = [];
  for (const key of Object.keys(paths)) {
    const check = await validatePathArtifact(key, paths[key], COMPILE_SCHEMA_PATHS[key]);
    schemaChecks[key] = check;
    if (check.ok) documents[key] = check.document;
    else blockers.push(...check.blockers);
  }
  const sourceAssetVerification = documents.asset_set
    ? await verifyImageStructuredSourceAssets({ assetSet: documents.asset_set, repoRoot: REPO_ROOT })
    : null;
  if (sourceAssetVerification) blockers.push(...sourceAssetVerification.blockers);
  const provenanceGate = Object.keys(paths).every((key) => documents[key])
    ? verifyImageStructuredCompileBundle({
      assetSet: documents.asset_set,
      observations: documents.observations,
      candidateGraph: documents.candidate_graph,
      promotionReview: documents.promotion_review,
      promotionPatch: documents.promotion_patch,
      partGraph: documents.part_graph,
      mcpBrief: documents.mcp_brief,
      sourceAssetVerification,
      requireSourceAssetVerification: true
    })
    : null;
  if (provenanceGate) blockers.push(...provenanceGate.blockers);
  if (documents.part_graph) blockers.push(...partGraphReviewBlockers(documents.part_graph));
  const expandedPartGraph = documents.part_graph ? expandArchitecturalPrimitives(documents.part_graph) : null;
  const semanticGate = expandedPartGraph
    ? validatePartGraphSemanticContract(expandedPartGraph, { phase: 'precompile' })
    : null;
  if (semanticGate && !semanticGate.ok) blockers.push(...semanticGate.issues.map((issue) => `semantic_contract:${issue.id}`));
  const physicalGate = expandedPartGraph ? validatePartGraphPhysicalConsistency(expandedPartGraph) : null;
  if (physicalGate && !physicalGate.ok) blockers.push(...physicalGate.issues.map((issue) => `physical_consistency:${issue.id}`));
  blockers.push(...identityAlignmentBlockers(documents));
  const finalBlockers = unique(blockers);
  if (finalBlockers.length > 0 || !provenanceGate?.ok) {
    return {
      version: 1,
      kind: 'image_structured_compile_review_preparation',
      ok: false,
      blocked: true,
      review_ready: false,
      compile_allowed: false,
      approval_required: true,
      queue_called: false,
      blockers: finalBlockers,
      inputs: relativePaths(paths),
      schema_checks: summarizeChecks(schemaChecks),
      provenance_gate: provenanceGate,
      source_asset_verification: sourceAssetVerification,
      semantic_gate: semanticGate,
      physical_gate: physicalGate,
      approval: null
    };
  }
  const expectation = approvalExpectation(provenanceGate);
  const challenge = await approvalAuthority.createChallenge({
    planId: expectation.plan_id,
    planHash: expectation.plan_hash,
    modelRevision: expectation.model_revision,
    riskLevel: expectation.risk_level,
    allowedOperations: expectation.allowed_operations,
    reviewContext: {
      kind: 'image_structured_compile_review',
      part_graph_id: documents.part_graph.id,
      source_mode: documents.part_graph.source_mode,
      accepted_candidate_ids: provenanceGate.accepted_candidate_ids,
      artifact_signatures: provenanceGate.signatures,
      source_asset_binding_hash: provenanceGate.binding.source_asset_binding_hash,
      interpretation_eligible: provenanceGate.interpretation_eligible
    }
  });
  return {
    version: 1,
    kind: 'image_structured_compile_review_preparation',
    ok: true,
    blocked: false,
    review_ready: true,
    compile_allowed: false,
    approval_required: true,
    queue_called: false,
    blockers: [],
    inputs: relativePaths(paths),
    provenance_gate: provenanceGate,
    source_asset_verification: sourceAssetVerification,
    semantic_gate: semanticGate,
    physical_gate: physicalGate,
    approval: {
      challenge_id: challenge.challenge_id,
      approval_url: approvalAuthority.approvalUrl(challenge.challenge_id),
      status: challenge.status,
      expires_at: challenge.expires_at,
      binding_hash: provenanceGate.binding.binding_hash
    }
  };
}

export async function compileReviewedPartGraph(options = {}) {
  const approvalAuthority = options.approvalAuthority;
  const receiptAuthority = options.imageStructuredReceiptAuthority;
  const outputDir = resolveRepo(option(options, 'output_dir', 'outputDir') || 'output/image-structured-mcp/compile');
  const requestedDslPath = option(options, 'output_dsl', 'outputDsl');
  let dslPath = requestedDslPath ? resolveRepo(requestedDslPath) : null;
  let manifestPath = null;
  let successGateReportPath = null;
  const paths = compileInputPaths(options);
  await ensureSafeRepoOutputDirectory(outputDir);

  const documents = {};
  const schemaChecks = {};
  const blockers = [];
  for (const key of Object.keys(paths)) {
    const check = await validatePathArtifact(key, paths[key], COMPILE_SCHEMA_PATHS[key]);
    schemaChecks[key] = check;
    if (check.ok) documents[key] = check.document;
    else blockers.push(...check.blockers);
  }
  const sourceAssetVerification = documents.asset_set
    ? await verifyImageStructuredSourceAssets({ assetSet: documents.asset_set, repoRoot: REPO_ROOT })
    : null;
  if (sourceAssetVerification) blockers.push(...sourceAssetVerification.blockers);

  const provenanceGate = Object.keys(paths).every((key) => documents[key])
    ? verifyImageStructuredCompileBundle({
      assetSet: documents.asset_set,
      observations: documents.observations,
      candidateGraph: documents.candidate_graph,
      promotionReview: documents.promotion_review,
      promotionPatch: documents.promotion_patch,
      partGraph: documents.part_graph,
      mcpBrief: documents.mcp_brief,
      sourceAssetVerification,
      requireSourceAssetVerification: true
    })
    : null;
  if (provenanceGate) blockers.push(...provenanceGate.blockers);
  if (documents.part_graph) blockers.push(...partGraphReviewBlockers(documents.part_graph));
  const expandedPartGraph = documents.part_graph ? expandArchitecturalPrimitives(documents.part_graph) : null;
  const semanticGate = expandedPartGraph
    ? validatePartGraphSemanticContract(expandedPartGraph, { phase: 'precompile' })
    : null;
  if (semanticGate && !semanticGate.ok) blockers.push(...semanticGate.issues.map((issue) => `semantic_contract:${issue.id}`));
  const physicalGate = expandedPartGraph ? validatePartGraphPhysicalConsistency(expandedPartGraph) : null;
  if (physicalGate && !physicalGate.ok) blockers.push(...physicalGate.issues.map((issue) => `physical_consistency:${issue.id}`));
  blockers.push(...identityAlignmentBlockers(documents));

  if (provenanceGate?.binding) {
    const bindingId = provenanceGate.binding.binding_hash.slice('sha256:'.length, 'sha256:'.length + 16);
    dslPath ||= path.join(outputDir, `sketchup-preview.${bindingId}.dsl.json`);
    manifestPath = path.join(outputDir, `manifest.${bindingId}.json`);
    successGateReportPath = path.join(outputDir, `compile-gate-report.${bindingId}.json`);
    if (await pathExists(dslPath)) blockers.push(`output_dsl_already_exists:${relativePath(dslPath)}`);
    if (await pathExists(manifestPath)) blockers.push(`output_manifest_already_exists:${relativePath(manifestPath)}`);
    if (await pathExists(successGateReportPath)) blockers.push(`output_gate_report_already_exists:${relativePath(successGateReportPath)}`);
  }

  let approvalAuthorization = null;
  let precompileReceipt = null;
  let compileReceipt = null;
  let trustedCompilePublicKey = null;
  const approvalChallengeId = option(options, 'approval_challenge_id', 'approvalChallengeId');
  if (unique(blockers).length === 0) {
    if (!approvalChallengeId) blockers.push('image_structured_compile_approval_challenge_missing');
    else if (!approvalAuthority || !receiptAuthority) blockers.push('image_structured_compile_authority_missing');
    else {
      try {
        approvalAuthorization = await approvalAuthority.readStoredApprovalAuthorization(
          approvalChallengeId,
          approvalExpectation(provenanceGate)
        );
        precompileReceipt = await receiptAuthority.issue({
          binding: provenanceGate.binding,
          authorization: approvalAuthorization.authorization
        });
        trustedCompilePublicKey = await receiptAuthority.publicKeyPem();
      } catch (error) {
        blockers.push(`image_structured_compile_approval_invalid:${error.code || error.message}`);
      }
    }
  }

  let dsl = null;
  if (unique(blockers).length === 0) {
    try {
      dsl = compilePartGraphToSketchUpDsl(documents.part_graph, documents.profile, {
        repoRoot: REPO_ROOT,
        partGraphPath: paths.part_graph,
        profilePath: paths.profile,
        provenanceBundle: {
          assetSet: documents.asset_set,
          observations: documents.observations,
          candidateGraph: documents.candidate_graph,
          promotionReview: documents.promotion_review,
          promotionPatch: documents.promotion_patch,
          partGraph: documents.part_graph,
          mcpBrief: documents.mcp_brief,
          sourceAssetVerification,
          requireSourceAssetVerification: true
        },
        compileReceipt: precompileReceipt,
        trustedCompilePublicKey
      });
    } catch (error) {
      blockers.push(`part_graph_compiler_gate_failed:${error.message}`);
    }
  }

  let dslText = dsl === null ? null : jsonText(dsl);
  let dslSha256 = dslText === null ? null : sha256Text(dslText);
  if (dsl !== null && approvalAuthorization) {
    try {
      compileReceipt = await receiptAuthority.issue({
        binding: provenanceGate.binding,
        authorization: approvalAuthorization.authorization,
        dslSha256
      });
    } catch (error) {
      blockers.push(`image_structured_compile_output_receipt_failed:${error.code || error.message}`);
      dsl = null;
      dslText = null;
      dslSha256 = null;
    }
  }

  if (dsl !== null && approvalAuthorization) {
    try {
      await approvalAuthority.consumeToken(
        approvalAuthorization.approval_token,
        approvalExpectation(provenanceGate)
      );
    } catch (error) {
      blockers.push(`image_structured_compile_approval_consume_failed:${error.code || error.message}`);
      dsl = null;
    }
  }

  const finalBlockers = unique(blockers);
  const allowed = finalBlockers.length === 0 && dsl !== null;
  const gateReportPath = allowed
    ? successGateReportPath
    : path.join(outputDir, `compile-gate-report.blocked.${crypto.randomUUID()}.json`);
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
    provenance_gate: provenanceGate ? {
      ok: provenanceGate.ok,
      blockers: provenanceGate.blockers,
      binding: provenanceGate.binding,
      interpretation_eligible: provenanceGate.interpretation_eligible
    } : null,
    source_asset_verification: sourceAssetVerification,
    compile_receipt: allowed ? compileReceipt : null,
    semantic_gate: semanticGate,
    physical_gate: physicalGate,
    part_graph_review: documents.part_graph ? summarizePartGraphReview(documents.part_graph) : null,
    output_dsl: allowed ? relativePath(dslPath) : null,
    output_dsl_sha256: allowed ? dslSha256 : null
  };
  if (allowed) await writeText(dslPath, dslText, { exclusive: true });
  await writeJsonExclusive(gateReportPath, report);

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
        safe_json_dsl_sha256: dslSha256,
        compile_gate_report: relativePath(gateReportPath)
      },
      summary: {
        operation_count: dsl.operations?.length || 0,
        profile_id: documents.profile.profile_id,
        part_graph_id: documents.part_graph.id,
        source_mode: documents.part_graph.source_mode || 'manual_authored',
        interpretation_eligible: provenanceGate?.interpretation_eligible === true,
        provenance_binding_hash: provenanceGate?.binding?.binding_hash || null,
        source_asset_binding_hash: provenanceGate?.binding?.source_asset_binding_hash || null
      },
      compile_receipt: compileReceipt
    };
    await writeJsonExclusive(manifestPath, manifest);
  }
  return {
    ...report,
    artifacts: {
      gate_report: gateReportPath,
      ...(allowed ? { safe_json_dsl_preview: dslPath, manifest: manifestPath } : {})
    }
  };
}

function compileInputPaths(options) {
  return {
    asset_set: resolveRequiredPath(options, ['asset_set_path', 'assetSetPath']),
    observations: resolveRequiredPath(options, ['observations_path', 'observationsPath']),
    candidate_graph: resolveRequiredPath(options, ['candidate_graph_path', 'candidateGraphPath']),
    mcp_brief: resolveRequiredPath(options, ['mcp_brief_path', 'mcpBriefPath']),
    promotion_review: resolveRequiredPath(options, ['promotion_review_path', 'promotionReviewPath']),
    promotion_patch: resolveRequiredPath(options, ['promotion_patch_path', 'promotionPatchPath']),
    part_graph: resolveRequiredPath(options, ['part_graph_path', 'partGraphPath']),
    profile: resolveRequiredPath(options, ['profile_path', 'profilePath'])
  };
}

function approvalExpectation(provenanceGate) {
  return {
    plan_id: provenanceGate.binding.part_graph_id,
    plan_hash: provenanceGate.binding.binding_hash,
    model_revision: provenanceGate.signatures.part_graph,
    risk_level: 'S2',
    allowed_operations: ['compile_reviewed_part_graph']
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
  let handle;
  try {
    await assertRepoFilePath(filePath);
    const lexicalStat = await fs.lstat(filePath);
    handle = await fs.open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    const openedStat = await handle.stat();
    if (!openedStat.isFile() || openedStat.ino !== lexicalStat.ino || openedStat.dev !== lexicalStat.dev) {
      throw new Error('artifact_open_race');
    }
    if (openedStat.size > 32 * 1024 * 1024) throw new Error('artifact_too_large');
    const contents = await handle.readFile('utf8');
    const [finalOpenedStat, finalLexicalStat] = await Promise.all([handle.stat(), fs.lstat(filePath)]);
    await assertRepoFilePath(filePath);
    if (!sameFileSnapshot(openedStat, finalOpenedStat)
      || finalLexicalStat.isSymbolicLink()
      || finalLexicalStat.ino !== openedStat.ino
      || finalLexicalStat.dev !== openedStat.dev) {
      throw new Error('artifact_open_race');
    }
    document = JSON.parse(contents);
  } catch (error) {
    if (['artifact_symlink_path', 'artifact_outside_repo', 'artifact_not_regular', 'artifact_open_race', 'artifact_too_large'].includes(error?.message)) {
      return { ok: false, label, path: filePath, blockers: [`${label}_artifact_unsafe:${error.message}`] };
    }
    if (error instanceof SyntaxError) {
      return { ok: false, label, path: filePath, blockers: [`${label}_json_invalid:${error.message}`] };
    }
    return { ok: false, label, path: filePath, blockers: [`${label}_artifact_unsafe:artifact_unreadable`] };
  } finally {
    await handle?.close();
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
  else if (!['accepted', 'approved', 'manual_confirmed'].includes(partGraph.review.status)) blockers.push('part_graph_review_status_not_accepted');
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
  const resolved = path.isAbsolute(String(value)) ? path.resolve(String(value)) : path.resolve(REPO_ROOT, String(value));
  if (!isWithinRepo(resolved)) throw new Error('Image-structured artifact paths must stay inside the repository');
  return resolved;
}

async function assertRepoFilePath(filePath) {
  if (!isWithinRepo(filePath)) throw new Error('artifact_outside_repo');
  const relative = path.relative(REPO_ROOT, filePath);
  let cursor = REPO_ROOT;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const stat = await fs.lstat(cursor);
    if (stat.isSymbolicLink()) throw new Error('artifact_symlink_path');
  }
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('artifact_not_regular');
  const [canonicalRoot, canonicalFile] = await Promise.all([fs.realpath(REPO_ROOT), fs.realpath(filePath)]);
  const relativeCanonical = path.relative(canonicalRoot, canonicalFile);
  if (relativeCanonical.startsWith('..') || path.isAbsolute(relativeCanonical)) throw new Error('artifact_outside_repo');
}

async function ensureSafeRepoOutputDirectory(directoryPath) {
  if (!isWithinRepo(directoryPath)) throw new Error('Image-structured output paths must stay inside the repository');
  await assertNoExistingOutputSymlink(directoryPath);
  await fs.mkdir(directoryPath, { recursive: true });
  await assertRepoOutputDirectory(directoryPath);
}

async function assertNoExistingOutputSymlink(candidate) {
  const relative = path.relative(REPO_ROOT, candidate);
  let cursor = REPO_ROOT;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      const stat = await fs.lstat(cursor);
      if (stat.isSymbolicLink()) throw new Error('Image-structured output paths must not traverse symbolic links');
      if (!stat.isDirectory() && cursor !== candidate) {
        throw new Error('Image-structured output ancestors must be directories');
      }
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }
}

async function assertRepoOutputDirectory(directoryPath) {
  await assertNoExistingOutputSymlink(directoryPath);
  const stat = await fs.lstat(directoryPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Image-structured output path must be a real directory');
  const [canonicalRoot, canonicalDirectory] = await Promise.all([fs.realpath(REPO_ROOT), fs.realpath(directoryPath)]);
  const relativeCanonical = path.relative(canonicalRoot, canonicalDirectory);
  if (relativeCanonical.startsWith('..') || path.isAbsolute(relativeCanonical)) {
    throw new Error('Image-structured output paths must stay inside the repository');
  }
}

function isWithinRepo(candidate) {
  const relative = path.relative(REPO_ROOT, path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function sameFileSnapshot(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
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
  await writeText(filePath, jsonText(value));
}

async function writeJsonExclusive(filePath, value) {
  await writeText(filePath, jsonText(value), { exclusive: true });
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256Text(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

async function writeText(filePath, content, { exclusive = false } = {}) {
  if (!isWithinRepo(filePath)) throw new Error('Image-structured output paths must stay inside the repository');
  const parent = path.dirname(filePath);
  await ensureSafeRepoOutputDirectory(parent);
  if (exclusive) {
    const handle = await fs.open(
      filePath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW || 0),
      0o600
    );
    try {
      await handle.writeFile(content, 'utf8');
    } finally {
      await handle.close();
    }
    return;
  }

  try {
    const existing = await fs.lstat(filePath);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new Error('Image-structured output target must be a regular non-symlink file');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const temporaryPath = path.join(parent, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(
      temporaryPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW || 0),
      0o600
    );
    await handle.writeFile(content, 'utf8');
    await handle.close();
    handle = null;
    await assertRepoOutputDirectory(parent);
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await handle?.close();
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && String(value).trim() !== '').map(String))];
}
