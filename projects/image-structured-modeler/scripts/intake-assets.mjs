#!/usr/bin/env node
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeImage,
  applyViewHints,
  assignViewKinds,
  inferObjectProfile,
  makeImageSetObservation,
  renderObservationOverlay,
  repoRoot,
  subprojectRoot
} from './lib/image-analysis.mjs';
import {
  discoverRealWorldBuildingSourceMetadata,
  viewHintsForImageAnalysis
} from './lib/real-world-building-source-metadata.mjs';
import { annotateObservationSetWithBirdEyeLandCoverV1 } from './lib/bird-eye-land-cover.mjs';
import { annotateObservationSetWithBoundaryGraphV1 } from './lib/boundary-graph-v1.mjs';
import { annotateObservationSetWithHighContrastEdgeV1 } from './lib/high-contrast-edge-v1.mjs';
import { annotateObservationSetWithOpenCvEdgeV1 } from './lib/opencv-edge-v1.mjs';
import { parseDocumentAssets } from './lib/document-asset-parser.mjs';
import {
  buildMcpModelingBrief,
  renderMcpModelingBriefMarkdown
} from './lib/mcp-modeling-brief.mjs';
import {
  annotateObservationSetWithVisionEvidenceSetV1,
  buildAcceptedVisionEvidenceReviewDecision,
  buildVisionEvidenceReviewPatch,
  renderVisionEvidenceReviewPatchMarkdown,
  renderVisionEvidenceReviewWorkbenchHtml,
  visionEvidenceSetReport
} from './lib/vision-evidence-set-v1.mjs';
import {
  annotateObservationSetWithBuildingSingleSemanticEvidenceV1,
  buildBuildingSingleReviewHelperOutput,
  renderBuildingSingleSemanticEvidenceMarkdown
} from './lib/building-single-semantic-evidence.mjs';
import {
  buildFacadePlaneGraphV1,
  buildFacadePlaneReviewOverlay,
  facadePlaneGraphSummary,
  renderFacadePlaneGraphMarkdown
} from './lib/facade-plane-graph.mjs';
import {
  annotateObservationSetWithDraftingFirstGraphs,
  buildDefaultDraftViewReviewDecision,
  buildDefaultLocalDetailReviewDecision,
  draftViewGraphSummary,
  objectSurfaceGraphSummary,
  renderDraftViewGraphMarkdown,
  renderDraftViewGraphSvg,
  renderObjectSurfaceGraphMarkdown,
  renderStructureEvidenceGraphMarkdown,
  structureEvidenceGraphSummary
} from './lib/drafting-first-graphs.mjs';
import {
  assessRealWorldBuildingSourcePackage,
  buildRealWorldBuildingUploadManifestTemplate,
  buildRealWorldBuildingSourcePackageGateResult,
  renderRealWorldBuildingSourcePackageMarkdown,
  renderRealWorldBuildingSourceRequestMarkdown
} from './lib/real-world-building-source-package.mjs';
import { buildCandidatePromotionPatch } from './build-candidate-promotion-patch.mjs';
import { prepareRealWorldBuildingReleaseSampleCli } from './prepare-real-world-building-release-sample.mjs';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);
const PDF_EXTENSIONS = new Set(['.pdf']);
const CAD_EXTENSIONS = new Set(['.dwg', '.dxf', '.ifc', '.step', '.stp', '.skp']);

export async function buildStructuredAssetIntake({
  input,
  objectType = 'unknown',
  objectName = 'Unspecified Asset',
  outputDir = null,
  overlayDir = null,
  viewHintsFile = null,
  maxDimension = 900,
  edgeThreshold = undefined,
  parseDocuments = false,
  writeOverlays = true,
  writeReview = true,
  writeMcpBrief = true,
  writeReviewHelper = true,
  buildingSingleAnnotations = null,
  buildingSingleVlmCandidates = null,
  writeRealWorldBuildingReleaseDraft = false,
  releaseDraftOutput = null,
  releaseDraftReviewer = null,
  releaseDraftAcceptedAt = null,
  releaseDraftNotes = null,
  sourcePackageGateOutput = null,
  requireSourceInputReady = false,
  requireSourceReleaseReady = false
} = {}) {
  if (!input) throw new Error('input is required');
  const absoluteInput = path.resolve(repoRoot, input);
  const assetFiles = await listAssetFiles(absoluteInput);
  if (!assetFiles.length) throw new Error(`No supported asset files found in ${absoluteInput}`);
  const imageFiles = assetFiles.filter((asset) => asset.mediaType === 'image').map((asset) => asset.path);
  const sourceMetadata = await discoverRealWorldBuildingSourceMetadata({
    input: absoluteInput,
    viewHintsFile
  });

  const analyses = [];
  for (const imageFile of imageFiles) {
    analyses.push(await analyzeImage(imageFile, {
      maxDimension: Number(maxDimension || 900),
      edgeThreshold: edgeThreshold ? Number(edgeThreshold) : undefined
    }));
  }

  const viewHints = viewHintsForImageAnalysis(sourceMetadata);
  const profile = inferObjectProfile(objectType);
  const resolvedOverlayDir = overlayDir
    ? path.resolve(repoRoot, overlayDir)
    : outputDir
      ? path.resolve(repoRoot, outputDir, 'review-overlays')
      : null;
  let observationSet;
  let documentParseReport = null;
  if (analyses.length) {
    const assignedViews = applyViewHints(assignViewKinds(analyses), viewHints);
    observationSet = makeImageSetObservation({
      objectType,
      objectName,
      analyses,
      assignedViews,
      overlayDir: resolvedOverlayDir,
      sourceMetadata
    });
    observationSet = await annotateObservationSetWithBirdEyeLandCoverV1(observationSet);
    observationSet = await annotateObservationSetWithBoundaryGraphV1(observationSet);
  } else if (parseDocuments) {
    const parsed = await parseDocumentAssets({
      assetFiles,
      objectType,
      objectName,
      profile
    });
    observationSet = parsed.observationSet;
    documentParseReport = parsed.report;
  } else {
    observationSet = makeNonImageObservationSet({
      objectType,
      objectName,
      profile,
      assetFiles
    });
  }

  let buildingSingleSemanticEvidence = null;
  let buildingSingleReviewHelperOutput = null;
  let structureEvidenceGraph = null;
  let draftViewGraph = null;
  let objectSurfaceGraph = null;
  let facadePlaneGraph = null;
  let facadePlaneReviewOverlay = null;
  if (observationSet.object?.profile === 'building_single') {
    const semanticResult = await annotateObservationSetWithBuildingSingleSemanticEvidenceV1(observationSet, {
      input: absoluteInput,
      annotationsPath: buildingSingleAnnotations,
      vlmCandidatesPath: buildingSingleVlmCandidates
    });
    observationSet = semanticResult.observationSet;
    buildingSingleSemanticEvidence = semanticResult.semanticEvidence;
    buildingSingleReviewHelperOutput = buildingSingleSemanticEvidence && writeReviewHelper
      ? buildBuildingSingleReviewHelperOutput({ semanticEvidence: buildingSingleSemanticEvidence, observationSet })
      : null;
  }

  ({
    observationSet,
    structureEvidenceGraph,
    draftViewGraph,
    objectSurfaceGraph,
    facadePlaneGraph,
    facadePlaneReviewOverlay
  } = refreshDraftingFirstGraphs({
    observationSet,
    buildingSingleSemanticEvidence,
    structureEvidenceGraph,
    draftViewGraph,
    objectSurfaceGraph,
    facadePlaneGraph,
    facadePlaneReviewOverlay
  }));

  let assetSet = makeAssetSet({ input: absoluteInput, assetFiles, analyses, observationSet, objectType, objectName, profile, documentParseReport });
  let candidateGraph = makeCandidateGraph({ assetSet, observationSet });
  let modelingBrief = makeModelingBrief({ assetSet, observationSet, candidateGraph });
  let promotionReview = buildDefaultCandidatePromotionReview({
    assetSet,
    candidateGraph,
    modelingBrief,
    draftViewGraph,
    objectSurfaceGraph,
    facadePlaneGraph
  });
  let promotionPatch = buildCandidatePromotionPatch({ assetSet, candidateGraph, modelingBrief, promotionReview });
  let realWorldBuildingReleaseDraft = null;
  let sourcePackageAssessment = null;
  let sourcePackageGateResult = null;
  let sourcePackageGateOutputPath = null;
  let mcpModelingBrief = null;
  let intakeSummary = null;
  let visionEvidenceReport = null;
  let visionEvidenceReviewPatch = null;

  if (outputDir) {
    const absoluteOutputDir = path.resolve(repoRoot, outputDir);
    await fs.mkdir(absoluteOutputDir, { recursive: true });
    if (shouldBuildVisionEvidenceForIntake(observationSet)) {
      const visionEvidenceDir = path.join(absoluteOutputDir, 'vision-evidence');
      observationSet = await annotateObservationSetWithHighContrastEdgeV1(observationSet, { outputDir: visionEvidenceDir });
      observationSet = await annotateObservationSetWithOpenCvEdgeV1(observationSet, {
        output: path.join(visionEvidenceDir, 'opencv-edge-v1-report.json'),
        outputDir: visionEvidenceDir
      });
      observationSet = annotateObservationSetWithVisionEvidenceSetV1(observationSet, { force: true });
      visionEvidenceReport = visionEvidenceSetReport(observationSet.vision_evidence_set_v1);
      visionEvidenceReviewPatch = buildVisionEvidenceReviewPatch({
        visionEvidenceSet: observationSet.vision_evidence_set_v1,
        source: `${path.join(toRepoRelative(absoluteOutputDir), 'observations.json')}#vision_evidence_set_v1`
      });
      await writeJson(path.join(absoluteOutputDir, 'vision-evidence-v1-report.json'), visionEvidenceReport);
      await writeJson(path.join(absoluteOutputDir, 'vision-evidence-review-patch.json'), visionEvidenceReviewPatch);
      await fs.writeFile(
        path.join(absoluteOutputDir, 'vision-evidence-review-patch.md'),
        renderVisionEvidenceReviewPatchMarkdown(visionEvidenceReviewPatch),
        'utf8'
      );
      const visionReviewDir = path.join(absoluteOutputDir, 'vision-evidence-review');
      await fs.mkdir(visionReviewDir, { recursive: true });
      await fs.writeFile(
        path.join(visionReviewDir, 'index.html'),
        renderVisionEvidenceReviewWorkbenchHtml({
          reviewPatch: visionEvidenceReviewPatch,
          initialDecision: buildAcceptedVisionEvidenceReviewDecision({
            reviewPatch: visionEvidenceReviewPatch,
            reviewer: 'vision-evidence-workbench',
            acceptedAt: '2026-06-17',
            sourceReviewPatch: path.join(toRepoRelative(absoluteOutputDir), 'vision-evidence-review-patch.json')
          }),
          title: 'Vision Evidence Review Workbench'
        }),
        'utf8'
      );
    }
    ({
      observationSet,
      structureEvidenceGraph,
      draftViewGraph,
      objectSurfaceGraph,
      facadePlaneGraph,
      facadePlaneReviewOverlay
    } = refreshDraftingFirstGraphs({
      observationSet,
      buildingSingleSemanticEvidence,
      structureEvidenceGraph,
      draftViewGraph,
      objectSurfaceGraph,
      facadePlaneGraph,
      facadePlaneReviewOverlay
    }));
    assetSet = makeAssetSet({ input: absoluteInput, assetFiles, analyses, observationSet, objectType, objectName, profile, documentParseReport });
    candidateGraph = makeCandidateGraph({ assetSet, observationSet });
    modelingBrief = makeModelingBrief({ assetSet, observationSet, candidateGraph });
    promotionReview = buildDefaultCandidatePromotionReview({
      assetSet,
      candidateGraph,
      modelingBrief,
      draftViewGraph,
      objectSurfaceGraph,
      facadePlaneGraph
    });
    promotionPatch = buildCandidatePromotionPatch({ assetSet, candidateGraph, modelingBrief, promotionReview });
    await writeJson(path.join(absoluteOutputDir, 'structure-evidence-graph.json'), structureEvidenceGraph);
    await fs.writeFile(path.join(absoluteOutputDir, 'structure-evidence-graph.md'), renderStructureEvidenceGraphMarkdown(structureEvidenceGraph), 'utf8');
    await writeJson(path.join(absoluteOutputDir, 'draft-view-graph.json'), draftViewGraph);
    await fs.writeFile(path.join(absoluteOutputDir, 'draft-view-graph.md'), renderDraftViewGraphMarkdown(draftViewGraph), 'utf8');
    await fs.writeFile(path.join(absoluteOutputDir, 'draft-view-graph.svg'), renderDraftViewGraphSvg(draftViewGraph), 'utf8');
    await writeJson(path.join(absoluteOutputDir, 'draft-view-review-overlay.json'), draftViewGraph.review_overlay);
    if (objectSurfaceGraph) {
      await writeJson(path.join(absoluteOutputDir, 'object-surface-graph.json'), objectSurfaceGraph);
      await fs.writeFile(path.join(absoluteOutputDir, 'object-surface-graph.md'), renderObjectSurfaceGraphMarkdown(objectSurfaceGraph), 'utf8');
    }
    if (buildingSingleSemanticEvidence) {
      if (buildingSingleSemanticEvidence.vlm_cache?.source) {
        buildingSingleSemanticEvidence.vlm_cache.artifact = path.join(toRepoRelative(absoluteOutputDir), 'building-single-vlm-candidates.cache.json');
        await writeJson(path.join(absoluteOutputDir, 'building-single-vlm-candidates.cache.json'), {
          kind: 'building_single_vlm_candidates_cache',
          version: 1,
          source: buildingSingleSemanticEvidence.vlm_cache.source,
          candidate_count: buildingSingleSemanticEvidence.vlm_cache.candidate_count,
          regions: (buildingSingleSemanticEvidence.images || [])
            .flatMap((image) => image.regions.map((region) => ({
              source_image: image.source_image,
              view: image.view,
              role: region.role,
              bbox_px: region.bbox_px,
              polygon_px: region.polygon_px,
              projection_model: region.projection_model,
              image_space_geometry: region.image_space_geometry,
              polygon_derivation: region.polygon_derivation,
              orthographic_projection_allowed: region.orthographic_projection_allowed === true,
              confidence: region.confidence,
              source: region.source,
              selected_for_candidate_graph: region.selected_for_candidate_graph
            })))
            .filter((region) => region.source === 'vlm_candidate')
        });
      }
      await writeJson(path.join(absoluteOutputDir, 'building-single-semantic-evidence.json'), buildingSingleSemanticEvidence);
      await fs.writeFile(
        path.join(absoluteOutputDir, 'building-single-semantic-evidence.md'),
        renderBuildingSingleSemanticEvidenceMarkdown(buildingSingleSemanticEvidence),
        'utf8'
      );
      if (facadePlaneGraph) {
        await writeJson(path.join(absoluteOutputDir, 'facade-plane-graph.json'), facadePlaneGraph);
        await fs.writeFile(
          path.join(absoluteOutputDir, 'facade-plane-graph.md'),
          renderFacadePlaneGraphMarkdown(facadePlaneGraph),
          'utf8'
        );
      }
      if (facadePlaneReviewOverlay) {
        await writeJson(path.join(absoluteOutputDir, 'facade-plane-review-overlay.json'), facadePlaneReviewOverlay);
      }
      if (buildingSingleReviewHelperOutput) {
        await writeJson(path.join(absoluteOutputDir, 'review-helper-output.json'), buildingSingleReviewHelperOutput);
      }
    }
    await writeJson(path.join(absoluteOutputDir, 'asset-set.json'), assetSet);
    await writeJson(path.join(absoluteOutputDir, 'observations.json'), observationSet);
    await writeJson(path.join(absoluteOutputDir, 'candidate-graph.json'), candidateGraph);
    await writeJson(path.join(absoluteOutputDir, 'modeling-brief.json'), modelingBrief);
    await writeJson(path.join(absoluteOutputDir, 'candidate-promotion-review.draft.json'), promotionReview);
    await writeJson(path.join(absoluteOutputDir, 'candidate-promotion-patch.blocked.json'), promotionPatch);
    if (writeRealWorldBuildingReleaseDraft) {
      realWorldBuildingReleaseDraft = await prepareRealWorldBuildingReleaseSampleCli({
        intakeDir: toRepoRelative(absoluteOutputDir),
        manifestOutput: releaseDraftOutput || path.join(toRepoRelative(absoluteOutputDir), 'real-world-building-release', 'manifest.draft.json'),
        review: {
          ...(releaseDraftReviewer ? { reviewer: releaseDraftReviewer } : {}),
          ...(releaseDraftAcceptedAt ? { accepted_at: releaseDraftAcceptedAt } : {}),
          ...(releaseDraftNotes ? { notes: releaseDraftNotes } : {})
        }
      });
    }
    sourcePackageAssessment = maybeAssessRealWorldBuildingSourcePackage({
      assetSet,
      observationSet,
      candidateGraph,
      checklist: realWorldBuildingReleaseDraft?.checklist || null
    });
    if (sourcePackageAssessment) {
      await writeJson(path.join(absoluteOutputDir, 'real-world-building-source-package.json'), sourcePackageAssessment);
      await fs.writeFile(
        path.join(absoluteOutputDir, 'real-world-building-source-package.md'),
        renderRealWorldBuildingSourcePackageMarkdown(sourcePackageAssessment),
        'utf8'
      );
      await writeJson(path.join(absoluteOutputDir, 'real-world-building-source-request.json'), sourcePackageAssessment.source_request);
      await fs.writeFile(
        path.join(absoluteOutputDir, 'real-world-building-source-request.md'),
        renderRealWorldBuildingSourceRequestMarkdown(sourcePackageAssessment.source_request),
        'utf8'
      );
      await writeJson(path.join(absoluteOutputDir, 'upload-manifest.template.json'), buildRealWorldBuildingUploadManifestTemplate({
        sourceRequest: sourcePackageAssessment.source_request,
        profileId: sourcePackageAssessment.profile_id,
        generatedAt: sourcePackageAssessment.generated_at
      }));
    }
    mcpModelingBrief = buildMcpModelingBrief({
      assetSet,
      observationSet,
      candidateGraph,
      modelingBrief,
      promotionReview,
      sourcePackageAssessment,
      source: intakeArtifactSourceMap(absoluteOutputDir, {
        hasStructureEvidenceGraph: Boolean(structureEvidenceGraph),
        hasDraftViewGraph: Boolean(draftViewGraph),
        hasObjectSurfaceGraph: Boolean(objectSurfaceGraph),
        hasVisionEvidence: Boolean(visionEvidenceReport),
        hasBuildingSingleSemanticEvidence: Boolean(buildingSingleSemanticEvidence),
        hasFacadePlaneGraph: Boolean(facadePlaneGraph)
      })
    });
    if (writeMcpBrief) {
      await writeJson(path.join(absoluteOutputDir, 'mcp-modeling-brief.json'), mcpModelingBrief);
      await fs.writeFile(path.join(absoluteOutputDir, 'mcp-modeling-brief.md'), renderMcpModelingBriefMarkdown(mcpModelingBrief), 'utf8');
    }
    if (documentParseReport) await writeJson(path.join(absoluteOutputDir, 'document-parse-report.json'), documentParseReport);
    if (writeReview) {
      const reviewPath = path.join(absoluteOutputDir, 'review', 'index.html');
      await fs.mkdir(path.dirname(reviewPath), { recursive: true });
      await fs.writeFile(reviewPath, buildAssetReviewHtml({
        assetSet,
        observationSet,
        candidateGraph,
        modelingBrief,
        mcpModelingBrief,
        promotionReview,
        structureEvidenceGraph,
        draftViewGraph,
        objectSurfaceGraph,
        visionEvidenceReport,
        visionEvidenceReviewPatch,
        buildingSingleSemanticEvidence,
        buildingSingleReviewHelperOutput,
        facadePlaneGraph,
        facadePlaneReviewOverlay,
        sourcePackageAssessment,
        realWorldBuildingReleaseDraft,
        outputDir: absoluteOutputDir,
        overlayDir: writeOverlays ? resolvedOverlayDir : null,
        mcpBriefLinks: writeMcpBrief
      }), 'utf8');
    }
    if (writeOverlays && resolvedOverlayDir) {
      await fs.mkdir(resolvedOverlayDir, { recursive: true });
      for (const observation of observationSet.images) {
        const base = path.basename(observation.image.path).replace(/\.[^.]+$/, '');
        await renderObservationOverlay(observation, path.join(resolvedOverlayDir, `${base}-overlay.png`));
      }
    }
  }

  if (!sourcePackageAssessment) {
    sourcePackageAssessment = maybeAssessRealWorldBuildingSourcePackage({
      assetSet,
      observationSet,
      candidateGraph,
      checklist: realWorldBuildingReleaseDraft?.checklist || null
    });
  }

  const sourcePackageGateRequested = sourcePackageGateOutput || requireSourceInputReady || requireSourceReleaseReady;
  if (sourcePackageAssessment || sourcePackageGateRequested) {
    const sourcePackageBaseDir = outputDir ? toRepoRelative(path.resolve(repoRoot, outputDir)) : null;
    sourcePackageGateResult = buildRealWorldBuildingSourcePackageGateResult({
      report: sourcePackageAssessment,
      requireInputReady: requireSourceInputReady,
      requireReleaseReady: requireSourceReleaseReady,
      sourcePackagePath: sourcePackageBaseDir && sourcePackageAssessment
        ? path.join(sourcePackageBaseDir, 'real-world-building-source-package.json')
        : null,
      sourcePackageMarkdownPath: sourcePackageBaseDir && sourcePackageAssessment
        ? path.join(sourcePackageBaseDir, 'real-world-building-source-package.md')
        : null
    });
    if (sourcePackageGateOutput || (outputDir && sourcePackageGateRequested)) {
      const resolvedGateOutput = sourcePackageGateOutput
        ? path.resolve(repoRoot, sourcePackageGateOutput)
        : path.join(path.resolve(repoRoot, outputDir), 'real-world-building-source-package.gate-result.json');
      await writeJson(resolvedGateOutput, sourcePackageGateResult);
      sourcePackageGateOutputPath = toRepoRelative(resolvedGateOutput);
    }
  }

  if (!mcpModelingBrief) {
    mcpModelingBrief = buildMcpModelingBrief({
      assetSet,
      observationSet,
      candidateGraph,
      modelingBrief,
      promotionReview,
      sourcePackageAssessment,
      source: outputDir ? intakeArtifactSourceMap(path.resolve(repoRoot, outputDir), {
        hasStructureEvidenceGraph: Boolean(structureEvidenceGraph),
        hasDraftViewGraph: Boolean(draftViewGraph),
        hasObjectSurfaceGraph: Boolean(objectSurfaceGraph),
        hasVisionEvidence: Boolean(visionEvidenceReport),
        hasBuildingSingleSemanticEvidence: Boolean(buildingSingleSemanticEvidence),
        hasFacadePlaneGraph: Boolean(facadePlaneGraph)
      }) : {}
    });
  }

  intakeSummary = buildStructuredAssetIntakeSummary({
    assetSet,
    observationSet,
    candidateGraph,
    modelingBrief,
    promotionReview,
    promotionPatch,
    mcpModelingBrief,
    visionEvidenceReport,
    visionEvidenceReviewPatch,
    structureEvidenceGraph,
    draftViewGraph,
    objectSurfaceGraph,
    buildingSingleSemanticEvidence,
    buildingSingleReviewHelperOutput,
    facadePlaneGraph,
    facadePlaneReviewOverlay,
    sourcePackageAssessment,
    sourcePackageGateResult,
    sourcePackageGateOutput: sourcePackageGateOutputPath,
    documentParseReport,
    realWorldBuildingReleaseDraft,
    outputDir,
    writeMcpBrief,
    writeReview
  });
  if (outputDir) {
    await writeJson(path.join(path.resolve(repoRoot, outputDir), 'intake-summary.json'), intakeSummary);
  }

  return {
    assetSet,
    observationSet,
    candidateGraph,
    modelingBrief,
    promotionReview,
    promotionPatch,
    mcpModelingBrief,
    visionEvidenceReport,
    visionEvidenceReviewPatch,
    structureEvidenceGraph,
    draftViewGraph,
    objectSurfaceGraph,
    buildingSingleSemanticEvidence,
    buildingSingleReviewHelperOutput,
    facadePlaneGraph,
    facadePlaneReviewOverlay,
    sourcePackageAssessment,
    sourcePackageGateResult,
    sourcePackageGateOutput: sourcePackageGateOutputPath,
    intakeSummary,
    documentParseReport,
    realWorldBuildingReleaseDraft
  };
}

function refreshDraftingFirstGraphs({
  observationSet,
  buildingSingleSemanticEvidence = null
}) {
  const drafting = annotateObservationSetWithDraftingFirstGraphs({
    observationSet,
    buildingSingleSemanticEvidence
  });
  let nextObservationSet = drafting.observationSet;
  const facadePlaneGraph = nextObservationSet.object?.profile === 'building_single'
    ? buildFacadePlaneGraphV1({
      semanticEvidence: buildingSingleSemanticEvidence,
      observationSet: nextObservationSet,
      structureEvidenceGraph: drafting.structureEvidenceGraph,
      draftViewGraph: drafting.draftViewGraph
    })
    : null;
  const facadePlaneReviewOverlay = facadePlaneGraph ? buildFacadePlaneReviewOverlay({ facadePlaneGraph }) : null;
  if (facadePlaneGraph) nextObservationSet = { ...nextObservationSet, facade_plane_graph_v1: facadePlaneGraph };
  if (facadePlaneReviewOverlay) nextObservationSet = { ...nextObservationSet, facade_plane_review_overlay_v1: facadePlaneReviewOverlay };
  return {
    observationSet: nextObservationSet,
    structureEvidenceGraph: drafting.structureEvidenceGraph,
    draftViewGraph: drafting.draftViewGraph,
    objectSurfaceGraph: drafting.objectSurfaceGraph,
    facadePlaneGraph,
    facadePlaneReviewOverlay
  };
}

function shouldBuildVisionEvidenceForIntake(observationSet = {}) {
  return Array.isArray(observationSet.images)
    && observationSet.images.some((image) => image.image?.path && !/^synthetic:\/\//u.test(image.image.path));
}

function maybeAssessRealWorldBuildingSourcePackage({
  assetSet,
  observationSet,
  candidateGraph,
  checklist
}) {
  const profile = observationSet?.object?.profile || assetSet?.profile_routing?.selected_profile;
  if (!['building_single', 'building_group'].includes(profile)) return null;
  return assessRealWorldBuildingSourcePackage({
    assetSet,
    observationSet,
    candidateGraph,
    checklist
  });
}

function buildStructuredAssetIntakeSummary({
  assetSet,
  observationSet,
  candidateGraph,
  modelingBrief,
  promotionReview,
  promotionPatch,
  mcpModelingBrief,
  visionEvidenceReport,
  visionEvidenceReviewPatch,
  structureEvidenceGraph,
  draftViewGraph,
  objectSurfaceGraph,
  buildingSingleSemanticEvidence,
  buildingSingleReviewHelperOutput,
  facadePlaneGraph,
  facadePlaneReviewOverlay,
  sourcePackageAssessment,
  sourcePackageGateResult,
  sourcePackageGateOutput,
  documentParseReport,
  realWorldBuildingReleaseDraft,
  outputDir,
  writeMcpBrief,
  writeReview
}) {
  const relativeOutputDir = outputDir ? toRepoRelative(path.resolve(repoRoot, outputDir)) : null;
  const artifact = (fileName) => relativeOutputDir ? path.join(relativeOutputDir, fileName) : null;
  const sourceGate = sourcePackageGateResult ? {
    ok: sourcePackageGateResult.ok,
    status: sourcePackageGateResult.status,
    input_ready_for_release_work: sourcePackageGateResult.input_ready_for_release_work,
    release_ready: sourcePackageGateResult.release_ready,
    required_gates: sourcePackageGateResult.required_gates,
    failed_requirements: sourcePackageGateResult.failed_requirements,
    blockers: sourcePackageGateResult.blockers
  } : null;
  return {
    version: 1,
    kind: 'structured_asset_intake_summary',
    generated_at: new Date().toISOString(),
    ok: sourcePackageGateResult ? sourcePackageGateResult.ok : true,
    profile: observationSet.object?.profile || assetSet.profile_routing?.selected_profile || 'unknown_object',
    status: modelingBrief.status,
    compile_allowed: modelingBrief.compile_allowed,
    asset_set_id: assetSet.id,
    assets: assetSet.assets.length,
    candidates: candidateGraph.summary?.candidate_count || candidateGraph.candidates?.length || 0,
    missing_inputs: modelingBrief.missing_inputs || [],
    gates: {
      asset_gate_can_compile_geometry: assetSet.gates?.can_compile_geometry === true,
      mcp_can_generate_sketchup_dsl: mcpModelingBrief?.compile_permission?.can_generate_sketchup_dsl === true,
      source_package: sourceGate
    },
    artifacts: {
      intake_summary: artifact('intake-summary.json'),
      asset_set: artifact('asset-set.json'),
      observation_set: artifact('observations.json'),
      candidate_graph: artifact('candidate-graph.json'),
      modeling_brief: artifact('modeling-brief.json'),
      candidate_promotion_review: artifact('candidate-promotion-review.draft.json'),
      candidate_promotion_patch: artifact('candidate-promotion-patch.blocked.json'),
      mcp_modeling_brief: writeMcpBrief ? artifact('mcp-modeling-brief.json') : null,
      mcp_modeling_brief_markdown: writeMcpBrief ? artifact('mcp-modeling-brief.md') : null,
      review_workbench: writeReview ? artifact(path.join('review', 'index.html')) : null,
      structure_evidence_graph: structureEvidenceGraph ? artifact('structure-evidence-graph.json') : null,
      structure_evidence_graph_markdown: structureEvidenceGraph ? artifact('structure-evidence-graph.md') : null,
      draft_view_graph: draftViewGraph ? artifact('draft-view-graph.json') : null,
      draft_view_graph_markdown: draftViewGraph ? artifact('draft-view-graph.md') : null,
      draft_view_graph_svg: draftViewGraph ? artifact('draft-view-graph.svg') : null,
      draft_view_review_overlay: draftViewGraph ? artifact('draft-view-review-overlay.json') : null,
      object_surface_graph: objectSurfaceGraph ? artifact('object-surface-graph.json') : null,
      object_surface_graph_markdown: objectSurfaceGraph ? artifact('object-surface-graph.md') : null,
      vision_evidence_report: visionEvidenceReport ? artifact('vision-evidence-v1-report.json') : null,
      vision_evidence_review_patch: visionEvidenceReviewPatch ? artifact('vision-evidence-review-patch.json') : null,
      vision_evidence_review_patch_markdown: visionEvidenceReviewPatch ? artifact('vision-evidence-review-patch.md') : null,
      vision_evidence_review_workbench: visionEvidenceReviewPatch ? artifact(path.join('vision-evidence-review', 'index.html')) : null,
      building_single_semantic_evidence: buildingSingleSemanticEvidence ? artifact('building-single-semantic-evidence.json') : null,
      building_single_semantic_evidence_markdown: buildingSingleSemanticEvidence ? artifact('building-single-semantic-evidence.md') : null,
      building_single_vlm_candidates_cache: buildingSingleSemanticEvidence?.vlm_cache?.artifact || null,
      facade_plane_graph: facadePlaneGraph ? artifact('facade-plane-graph.json') : null,
      facade_plane_graph_markdown: facadePlaneGraph ? artifact('facade-plane-graph.md') : null,
      facade_plane_review_overlay: facadePlaneReviewOverlay ? artifact('facade-plane-review-overlay.json') : null,
      review_helper_output: buildingSingleReviewHelperOutput ? artifact('review-helper-output.json') : null,
      source_package: sourcePackageAssessment ? artifact('real-world-building-source-package.json') : null,
      source_package_markdown: sourcePackageAssessment ? artifact('real-world-building-source-package.md') : null,
      source_request: sourcePackageAssessment ? artifact('real-world-building-source-request.json') : null,
      source_request_markdown: sourcePackageAssessment ? artifact('real-world-building-source-request.md') : null,
      upload_manifest_template: sourcePackageAssessment ? artifact('upload-manifest.template.json') : null,
      source_package_gate_result: sourcePackageGateOutput,
      document_parse_report: documentParseReport ? artifact('document-parse-report.json') : null,
      real_world_building_release_manifest_draft: realWorldBuildingReleaseDraft?.manifestOutput || null,
      real_world_building_release_contract_summary: realWorldBuildingReleaseDraft?.contractSummaryOutput || null,
      real_world_building_release_checklist: realWorldBuildingReleaseDraft?.checklistOutput || null,
      real_world_building_release_checklist_markdown: realWorldBuildingReleaseDraft?.checklistMarkdownOutput || null,
      real_world_building_release_work_order: realWorldBuildingReleaseDraft?.workOrderOutput || null,
      real_world_building_release_work_order_markdown: realWorldBuildingReleaseDraft?.workOrderMarkdownOutput || null
    },
    real_world_building_source_package: sourcePackageAssessment ? {
      status: sourcePackageAssessment.status,
      input_ready_for_release_work: sourcePackageAssessment.input_ready_for_release_work,
      release_ready: sourcePackageAssessment.release_ready
    } : null,
    vision_evidence: visionEvidenceSummaryForIntake({ visionEvidenceReport, visionEvidenceReviewPatch }),
    structure_evidence_graph: structureEvidenceGraphSummary(structureEvidenceGraph),
    draft_view_graph: draftViewGraphSummary(draftViewGraph),
    object_surface_graph: objectSurfaceGraphSummary(objectSurfaceGraph),
    facade_plane_graph: facadePlaneGraphSummary(facadePlaneGraph),
    building_single_semantic_evidence: buildingSingleSemanticSummaryForIntake(buildingSingleSemanticEvidence, buildingSingleReviewHelperOutput),
    real_world_building_release_draft: releaseDraftSummary(realWorldBuildingReleaseDraft),
    document_parse_status: documentParseReport?.status || null
  };
}

function visionEvidenceSummaryForIntake({ visionEvidenceReport = null, visionEvidenceReviewPatch = null } = {}) {
  if (!visionEvidenceReport) return null;
  return {
    ok: visionEvidenceReport.ok === true,
    verdict: visionEvidenceReport.verdict || 'unknown',
    masks: visionEvidenceReport.summary?.masks || 0,
    edges: visionEvidenceReport.summary?.edges || 0,
    regions: visionEvidenceReport.summary?.regions || 0,
    relations: visionEvidenceReport.summary?.relations || 0,
    default_heavy_model_required: visionEvidenceReport.summary?.default_heavy_model_required === true,
    review_patch_status: visionEvidenceReviewPatch?.status || null,
    review_items: visionEvidenceReviewPatch?.summary?.total_items || 0,
    ground_plane_review_items: visionEvidenceReviewPatch?.summary?.ground_plane_items || 0,
    edge_class_review_items: visionEvidenceReviewPatch?.summary?.edge_class_items || 0,
    semantic_candidate_review_items: visionEvidenceReviewPatch?.summary?.semantic_candidate_items || 0
  };
}

function buildingSingleSemanticSummaryForIntake(semanticEvidence = null, reviewHelperOutput = null) {
  if (!semanticEvidence) return null;
  return {
    kind: semanticEvidence.kind,
    region_count: semanticEvidence.summary?.region_count || 0,
    selected_region_count: semanticEvidence.summary?.selected_region_count || 0,
    roles: semanticEvidence.summary?.roles || [],
    sources: semanticEvidence.summary?.sources || [],
    critical_roles_present: semanticEvidence.summary?.critical_roles_present || [],
    missing_critical_roles: semanticEvidence.summary?.missing_critical_roles || [],
    compile_allowed: semanticEvidence.summary?.compile_allowed === true,
    geometry_promotion_allowed: semanticEvidence.summary?.geometry_promotion_allowed === true,
    review_helper: reviewHelperOutput ? {
      model_status: reviewHelperOutput.model_status,
      compile_allowed: reviewHelperOutput.compile_allowed === true,
      geometry_promotion_allowed: reviewHelperOutput.geometry_promotion_allowed === true,
      operations: reviewHelperOutput.operations?.length || 0
    } : null
  };
}

async function listAssetFiles(inputPath) {
  const absoluteInput = path.resolve(inputPath);
  const stat = await fs.stat(absoluteInput);
  if (stat.isFile()) return [await assetDescriptor(absoluteInput)];

  const entries = await fs.readdir(absoluteInput, { withFileTypes: true });
  const assets = await Promise.all(entries
    .filter((entry) => entry.isFile())
    .map((entry) => assetDescriptor(path.join(absoluteInput, entry.name))));
  return assets
    .filter((asset) => asset.mediaType !== 'unknown')
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function assetDescriptor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    path: filePath,
    mediaType: mediaTypeForExtension(extension),
    extension,
    contentSha256: await contentHash(filePath)
  };
}

async function contentHash(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function mediaTypeForExtension(extension) {
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (PDF_EXTENSIONS.has(extension)) return 'pdf';
  if (CAD_EXTENSIONS.has(extension)) return 'cad';
  return 'unknown';
}

function makeNonImageObservationSet({ objectType, objectName, profile, assetFiles }) {
  const sourceAssets = assetFiles.map((asset) => toRepoRelative(asset.path));
  const mediaTypes = Array.from(new Set(assetFiles.map((asset) => asset.mediaType)));
  return {
    version: 1,
    object: {
      type: objectType,
      name: objectName,
      profile,
      source_images: sourceAssets
    },
    image_set_quality: 'low',
    views_detected: ['unknown'],
    missing_views: requiredViewsForProfile(profile),
    images: [
      {
        version: 1,
        image: {
          path: sourceAssets[0],
          width: 0,
          height: 0,
          analysis_width: 0,
          analysis_height: 0
        },
        detected_view: {
          kind: 'unknown',
          confidence: 0,
          notes: ['Non-image asset placeholder; parser output required before geometry observation.']
        },
        observations: [
          {
            id: 'non_image_asset_requires_parser',
            kind: 'manual_review',
            source_view: 'unknown',
            component_hint: 'source_document',
            confidence: 0,
            note: `Non-image asset types detected: ${mediaTypes.join(', ')}.`
          }
        ],
        quality_report: {
          usable_for_modeling: false,
          risks: parserRisksForAssetTypes(mediaTypes),
          missing_views: requiredViewsForProfile(profile)
        }
      }
    ],
    scale_calibration: {
      units: 'mm',
      strategy: 'non_image_asset_requires_parser',
      default_scale: {},
      measurements: [],
      confidence: 0,
      missing_views: requiredViewsForProfile(profile),
      notes: [
        'PDF/CAD assets are accepted into AssetSet, but geometry extraction is blocked until a parser produces observations.'
      ]
    },
    visual_relation_graph: {
      version: 1,
      coordinate_convention: 'image_x_right_y_down',
      relation_types: [],
      source_images: sourceAssets,
      relations: [],
      summary: {
        relations: 0,
        parser_required: true
      },
      open_questions: [
        'Run PDF/CAD extraction before candidate promotion.'
      ]
    },
    evidence_graph: {
      version: 1,
      image_count: 0,
      views_detected: ['unknown'],
      missing_views: requiredViewsForProfile(profile),
      parts: [],
      part_matches: [],
      visual_relations: [],
      scale_calibration: {
        units: 'mm',
        strategy: 'non_image_asset_requires_parser',
        default_scale: {},
        measurements: [],
        confidence: 0,
        missing_views: requiredViewsForProfile(profile)
      },
      open_questions: [
        'PDF/CAD parser output is required before PartGraph promotion.'
      ]
    },
    quality_report: {
      usable_for_modeling: false,
      risks: parserRisksForAssetTypes(mediaTypes),
      notes: [
        'Non-image assets are tracked but not parsed by the current release gate.'
      ]
    },
    review: {
      overlay_dir: null,
      open_questions: [
        'Attach parser-derived dimensions, layers, pages, or drawing views before geometry promotion.'
      ]
    }
  };
}

export function buildDefaultCandidatePromotionReview({
  assetSet,
  candidateGraph,
  modelingBrief,
  draftViewGraph = null,
  objectSurfaceGraph = null,
  facadePlaneGraph = null,
  reviewer = 'intake-workbench'
}) {
  const blockers = Array.from(new Set([
    ...(assetSet.gates?.reasons || []),
    ...(modelingBrief.missing_inputs || [])
  ]));
  const draftSlotCount = Number(draftViewGraph?.summary?.observed_slots || 0)
    + Number(draftViewGraph?.summary?.inferred_slots || 0)
    + Number(draftViewGraph?.summary?.partial_slots || 0);
  const surfaceCount = Number(objectSurfaceGraph?.summary?.surface_count || 0);
  const detailCount = Number(objectSurfaceGraph?.summary?.feature_candidate_count || 0)
    + Number(facadePlaneGraph?.summary?.detail_candidate_count || 0);
  const requiresDraftViewReview = draftSlotCount > 0;
  const requiresLocalDetailReview = requiresDraftViewReview && (surfaceCount > 0 || detailCount > 0);
  const requiresFacadePlaneReview = candidateGraph.profile_id === 'building_single'
    && (
      Number(facadePlaneGraph?.summary?.plane_count || 0) > 0
      || (candidateGraph.candidates || []).some((candidate) => {
        const role = candidate.role || '';
        return role.startsWith('visible_plane_')
          || candidate.promotion?.blockers?.includes('accepted_facade_plane_review_required')
          || candidate.blockers?.includes?.('accepted_facade_plane_review_required');
      })
    );
  return {
    version: 1,
    kind: 'candidate_promotion_review',
    asset_set_id: assetSet.id,
    profile_id: candidateGraph.profile_id,
    source_candidate_graph: 'candidate-graph.json',
    reviewer,
    verdict: blockers.length ? 'blocked' : 'needs_review',
    compile_allowed: false,
    promotion_allowed: false,
    missing_inputs: modelingBrief.missing_inputs || [],
    blockers,
    resolved_blockers: [],
    profile_confirmation: {
      selected_profile: assetSet.profile_routing.selected_profile,
      status: assetSet.profile_routing.status === 'needs_profile' ? 'needs_profile' : 'routed_unconfirmed'
    },
    scale_confirmation: {
      status: 'needs_scale_confirmation',
      units: 'mm'
    },
    draft_view_review: requiresDraftViewReview ? buildDefaultDraftViewReviewDecision({
      draftViewGraph,
      reviewer,
      accepted: false
    }) : null,
    local_detail_review: requiresLocalDetailReview ? buildDefaultLocalDetailReviewDecision({
      objectSurfaceGraph,
      facadePlaneGraph,
      reviewer,
      accepted: false
    }) : null,
    facade_plane_review: requiresFacadePlaneReview ? {
      source_facade_plane_graph: 'facade-plane-graph.json',
      status: 'not_accepted',
      accepted_plane_ids: [],
      promotion_allowed: false,
      blockers: ['accepted_facade_plane_review_required']
    } : null,
    accepted_candidates: [],
    held_candidates: candidateGraph.candidates.map(candidateReviewItem),
    notes: '',
    instructions: [
      'This review artifact is not a SketchUp compile input.',
      'Accepted candidates may only become PartGraph promotion patches after profile, scale, view, and blocker review.',
      'If blockers are present, keep verdict=blocked and request missing inputs before geometry promotion.'
    ]
  };
}

export function buildAssetReviewHtml({
  assetSet,
  observationSet,
  candidateGraph,
  modelingBrief,
  mcpModelingBrief = null,
  promotionReview,
  structureEvidenceGraph = null,
  draftViewGraph = null,
  objectSurfaceGraph = null,
  visionEvidenceReport = null,
  visionEvidenceReviewPatch = null,
  buildingSingleSemanticEvidence = null,
  buildingSingleReviewHelperOutput = null,
  facadePlaneGraph = null,
  facadePlaneReviewOverlay = null,
  sourcePackageAssessment = null,
  realWorldBuildingReleaseDraft = null,
  outputDir,
  overlayDir = null,
  mcpBriefLinks = true
}) {
  const statusClass = modelingBrief.compile_allowed ? 'good' : 'bad';
  const overlayLinks = new Map();
  if (overlayDir && outputDir) {
    for (const image of observationSet.images || []) {
      const base = path.basename(image.image.path).replace(/\.[^.]+$/, '');
      const overlayPath = path.join(overlayDir, `${base}-overlay.png`);
      overlayLinks.set(image.image.path, path.relative(path.join(outputDir, 'review'), overlayPath));
    }
  }
  const assetRows = assetSet.assets.map((asset) => {
    const overlay = overlayLinks.get(asset.path);
    return `<tr>
      <td><code>${escapeHtml(asset.id)}</code></td>
      <td>${escapeHtml(asset.detected_view || 'unknown')}</td>
      <td>${escapeHtml(asset.quality || 'review')}</td>
      <td><code>${escapeHtml(asset.path)}</code>${overlay ? `<br><a href="${escapeHtml(overlay)}">overlay</a>` : ''}</td>
    </tr>`;
  }).join('\n');
  const candidateRows = candidateGraph.candidates.map((candidate) => {
    const blockers = candidate.promotion.blockers.length
      ? candidate.promotion.blockers.map((blocker) => `<span class="tag warn">${escapeHtml(blocker)}</span>`).join('')
      : '<span class="tag good">no blockers</span>';
    return `<tr>
      <td><input type="checkbox" class="candidate-select" data-candidate-id="${escapeHtml(candidate.id)}" aria-label="Select ${escapeHtml(candidate.id)}"></td>
      <td><code>${escapeHtml(candidate.id)}</code></td>
      <td>${escapeHtml(candidate.role)}</td>
      <td>${escapeHtml(candidate.view)}</td>
      <td>${Number(candidate.confidence || 0).toFixed(3)}</td>
      <td><span class="tag ${candidate.promotion.status === 'eligible' ? 'good' : candidate.promotion.status === 'blocked' ? 'bad' : 'warn'}">${escapeHtml(candidate.promotion.status)}</span></td>
      <td>${blockers}</td>
    </tr>`;
  }).join('\n');
  const missingItems = modelingBrief.missing_inputs.length
    ? modelingBrief.missing_inputs.map((item) => `<li><code>${escapeHtml(item)}</code></li>`).join('\n')
    : '<li>No missing inputs recorded.</li>';
  const gateReasons = assetSet.gates.reasons.length
    ? assetSet.gates.reasons.map((item) => `<span class="tag bad">${escapeHtml(item)}</span>`).join('')
    : '<span class="tag good">can_compile_geometry</span>';
  const intakeSummarySection = outputDir ? `<section class="section">
      <h2>Intake Summary</h2>
      <p class="subtle">Machine-readable upload status and artifact map for UI, queue, API, and CI consumers.</p>
      <p><a id="download-intake-summary" href="../intake-summary.json" download>intake-summary.json</a></p>
    </section>` : '';
  const buildingSingleSemanticSection = buildingSingleSemanticEvidence ? `<section class="section">
      <h2>Building Single Semantic Evidence</h2>
      <p><span class="tag warn">model_status=${escapeHtml(buildingSingleSemanticEvidence.review_policy?.model_status || 'review_only')}</span><span class="tag bad">geometry_promotion_allowed=${String(buildingSingleSemanticEvidence.review_policy?.geometry_promotion_allowed === true)}</span><span class="tag warn">selected_regions=${String(buildingSingleSemanticEvidence.summary?.selected_region_count || 0)}</span></p>
      <p><a id="download-building-single-semantic-evidence" href="../building-single-semantic-evidence.json" download>building-single-semantic-evidence.json</a> · <a id="download-building-single-semantic-evidence-md" href="../building-single-semantic-evidence.md" download>building-single-semantic-evidence.md</a>${buildingSingleReviewHelperOutput ? ' · <a id="download-review-helper-output" href="../review-helper-output.json" download>review-helper-output.json</a>' : ''}</p>
    </section>` : '';
  const draftViewRows = draftViewGraph?.view_slots?.length
    ? draftViewGraph.view_slots.map((slot) => `<tr>
        <td><code>${escapeHtml(slot.slot_id)}</code></td>
        <td><span class="tag ${slot.status === 'observed' ? 'good' : slot.status === 'unknown' ? 'bad' : 'warn'}">${escapeHtml(slot.status)}</span></td>
        <td>${Number(slot.confidence || 0).toFixed(3)}</td>
        <td>${(slot.source_image_ids || []).map((value) => `<code>${escapeHtml(value)}</code>`).join('<br>') || 'none'}</td>
        <td>${String(slot.promotion_allowed === true)}</td>
      </tr>`).join('\n')
    : '';
  const draftingFirstSection = draftViewGraph ? `<section class="section">
      <h2>Draft View Graph</h2>
      <p><span class="tag warn">status=${escapeHtml(draftViewGraph.review_policy?.status || 'unknown')}</span><span class="tag bad">accepted_draft_view_review_required=${String(draftViewGraph.review_policy?.accepted_draft_view_review_required === true)}</span><span class="tag bad">promotion_allowed=${String(draftViewGraph.review_policy?.promotion_allowed === true)}</span></p>
      <div class="scroll">
        <table>
          <thead><tr><th>Slot</th><th>Status</th><th>Confidence</th><th>Source Images</th><th>Promotion Allowed</th></tr></thead>
          <tbody>${draftViewRows || '<tr><td colspan="5">No draft view slots.</td></tr>'}</tbody>
        </table>
      </div>
      <p><a id="download-structure-evidence-graph" href="../structure-evidence-graph.json" download>structure-evidence-graph.json</a> · <a id="download-draft-view-graph" href="../draft-view-graph.json" download>draft-view-graph.json</a> · <a id="download-draft-view-graph-svg" href="../draft-view-graph.svg" download>draft-view-graph.svg</a> · <a id="download-draft-view-review-overlay" href="../draft-view-review-overlay.json" download>draft-view-review-overlay.json</a></p>
    </section>` : '';
  const objectSurfaceRows = objectSurfaceGraph?.surfaces?.length
    ? objectSurfaceGraph.surfaces.map((surface) => `<tr>
        <td><code>${escapeHtml(surface.id)}</code></td>
        <td>${escapeHtml(surface.role)}</td>
        <td>${escapeHtml(surface.draft_view_slot_id)}</td>
        <td><span class="tag warn">${escapeHtml(surface.status)}</span></td>
      </tr>`).join('\n')
    : '';
  const objectSurfaceSection = objectSurfaceGraph ? `<section class="section">
      <h2>Object Surface Graph</h2>
      <p><span class="tag warn">domain=${escapeHtml(objectSurfaceGraph.domain || 'unknown')}</span><span class="tag bad">promotion_allowed=${String(objectSurfaceGraph.review_policy?.promotion_allowed === true)}</span><span class="tag warn">features=${String(objectSurfaceGraph.summary?.feature_candidate_count || 0)}</span></p>
      <div class="scroll">
        <table>
          <thead><tr><th>Surface</th><th>Role</th><th>Draft View</th><th>Status</th></tr></thead>
          <tbody>${objectSurfaceRows || '<tr><td colspan="4">No object surfaces.</td></tr>'}</tbody>
        </table>
      </div>
      <p><a id="download-object-surface-graph" href="../object-surface-graph.json" download>object-surface-graph.json</a> · <a id="download-object-surface-graph-md" href="../object-surface-graph.md" download>object-surface-graph.md</a></p>
    </section>` : '';
  const facadePlaneRows = facadePlaneGraph?.planes?.length
    ? facadePlaneGraph.planes.map((plane) => `<tr>
        <td><code>${escapeHtml(plane.id)}</code></td>
        <td>${escapeHtml(plane.orientation_hint?.kind || 'unknown')}</td>
        <td>${escapeHtml(plane.occlusion_order?.relation_to_camera || 'unknown')}</td>
        <td>${(plane.must_not_merge_with || []).map((value) => `<span class="tag bad">${escapeHtml(value)}</span>`).join('')}</td>
        <td><code>${escapeHtml((plane.visible_quad_px || []).map((point) => point.join(',')).join(';'))}</code></td>
      </tr>`).join('\n')
    : '';
  const facadePlaneDetailRows = facadePlaneGraph?.plane_local_detail_candidates?.length
    ? facadePlaneGraph.plane_local_detail_candidates.map((detail) => `<tr>
        <td><code>${escapeHtml(detail.id)}</code></td>
        <td>${escapeHtml(detail.role)}</td>
        <td>${(detail.candidate_plane_ids || []).map((value) => `<span class="tag warn">${escapeHtml(value)}</span>`).join('')}</td>
        <td>${escapeHtml(detail.attachment_hint || '')}</td>
      </tr>`).join('\n')
    : '';
  const facadePlaneGraphSection = facadePlaneGraph ? `<section class="section">
      <h2>Facade Plane Graph</h2>
      <p><span class="tag warn">status=${escapeHtml(facadePlaneGraph.review_policy?.status || 'unknown')}</span><span class="tag bad">accepted_plane_review_required=${String(facadePlaneGraph.review_policy?.accepted_plane_review_required === true)}</span><span class="tag bad">promotion_allowed=${String(facadePlaneGraph.review_policy?.promotion_allowed === true)}</span><span class="tag warn">details=${String(facadePlaneGraph.summary?.detail_candidate_count || 0)}</span></p>
      <div class="scroll">
        <table>
          <thead><tr><th>Plane</th><th>Orientation</th><th>Occlusion</th><th>Must Not Merge With</th><th>Visible Quad</th></tr></thead>
          <tbody>${facadePlaneRows || '<tr><td colspan="5">No visible planes.</td></tr>'}</tbody>
        </table>
      </div>
      ${facadePlaneDetailRows ? `<h3>Plane-Local Details</h3>
      <div class="scroll">
        <table>
          <thead><tr><th>Detail</th><th>Role</th><th>Candidate Planes</th><th>Attachment Hint</th></tr></thead>
          <tbody>${facadePlaneDetailRows}</tbody>
        </table>
      </div>` : ''}
      <p><a id="download-facade-plane-graph" href="../facade-plane-graph.json" download>facade-plane-graph.json</a> · <a id="download-facade-plane-graph-md" href="../facade-plane-graph.md" download>facade-plane-graph.md</a>${facadePlaneReviewOverlay ? ' · <a id="download-facade-plane-review-overlay" href="../facade-plane-review-overlay.json" download>facade-plane-review-overlay.json</a>' : ''}</p>
    </section>` : '';
  const sourceRequestResponseGate = mcpModelingBrief?.source_request_response_gate || null;
  const sourceRequestResponseGateSummary = sourceRequestResponseGate
    ? `<p><span class="tag ${sourceRequestResponseGate.ok ? 'good' : 'bad'}">source_request_response=${escapeHtml(sourceRequestResponseGate.status)}</span><span class="tag ${sourceRequestResponseGate.unsatisfied_check_ids?.length ? 'bad' : 'good'}">unsatisfied_checks=${String(sourceRequestResponseGate.unsatisfied_check_ids?.length || 0)}</span></p>
      ${sourceRequestResponseGate.unsatisfied_check_ids?.length ? `<p class="subtle">Unsatisfied response checks: ${escapeHtml(sourceRequestResponseGate.unsatisfied_check_ids.join(', '))}</p>` : ''}`
    : '';
  const mcpDisambiguationRows = mcpModelingBrief?.candidate_disambiguation?.length
    ? mcpModelingBrief.candidate_disambiguation.map((item) => `<tr>
        <td><code>${escapeHtml(item.candidate_id)}</code></td>
        <td>${escapeHtml(item.role)}</td>
        <td>${escapeHtml(item.modeling_decision)}</td>
        <td>${(item.blocked_interpretations || []).map((value) => `<span class="tag bad">${escapeHtml(value)}</span>`).join('')}</td>
        <td>${(item.required_confirmations || []).map((value) => `<div>${escapeHtml(value)}</div>`).join('')}</td>
      </tr>`).join('\n')
    : '';
  const mcpDisambiguationSection = mcpDisambiguationRows
    ? `<h3>Candidate Disambiguation</h3>
      <div id="candidate-disambiguation-table" class="scroll">
        <table>
          <thead><tr><th>Candidate</th><th>Role</th><th>Modeling Decision</th><th>Blocked Interpretations</th><th>Required Confirmations</th></tr></thead>
          <tbody>${mcpDisambiguationRows}</tbody>
        </table>
      </div>`
    : '';
  const mcpConstraintRows = mcpModelingBrief?.modeling_constraint_summary?.constraints?.length
    ? mcpModelingBrief.modeling_constraint_summary.constraints.map((item) => `<tr>
        <td>${escapeHtml(item.role)}</td>
        <td><span class="tag ${item.priority === 'critical' ? 'bad' : 'warn'}">${escapeHtml(item.priority)}</span></td>
        <td>${Number(item.candidate_count || 0)}</td>
        <td>${Number(item.evidence_instance_count || 0)}</td>
        <td>${escapeHtml(item.modeling_decision)}</td>
        <td>${(item.blocked_interpretations || []).map((value) => `<span class="tag bad">${escapeHtml(value)}</span>`).join('')}</td>
      </tr>`).join('\n')
    : '';
  const mcpConstraintSection = mcpConstraintRows
    ? `<h3>Modeling Constraint Summary</h3>
      <p class="subtle">Role-level constraints for MCP/modeling agents, deduped from candidate evidence and VisionEvidence handoff.</p>
      <div id="modeling-constraint-summary-table" class="scroll">
        <table>
          <thead><tr><th>Role</th><th>Priority</th><th>Candidates</th><th>Evidence</th><th>Decision</th><th>Blocked Interpretations</th></tr></thead>
          <tbody>${mcpConstraintRows}</tbody>
        </table>
      </div>`
    : '';
  const mcpBriefSection = mcpModelingBrief ? `<section class="section">
      <h2>MCP Brief</h2>
      <p class="subtle">Structured text for MCP/modeling agents. It stays fail-closed while compile gates are unresolved.</p>
      <p><span class="tag ${mcpModelingBrief.compile_permission.can_generate_sketchup_dsl ? 'good' : 'bad'}">can_generate_sketchup_dsl=${String(mcpModelingBrief.compile_permission.can_generate_sketchup_dsl)}</span><span class="tag ${mcpModelingBrief.compile_permission.can_promote_candidates ? 'good' : 'bad'}">can_promote_candidates=${String(mcpModelingBrief.compile_permission.can_promote_candidates)}</span></p>
      ${sourceRequestResponseGateSummary}
      ${mcpConstraintSection}
      ${mcpDisambiguationSection}
      ${mcpBriefLinks ? `<p><a id="download-mcp-brief-json" href="../mcp-modeling-brief.json" download>mcp-modeling-brief.json</a> · <a id="download-mcp-brief-markdown" href="../mcp-modeling-brief.md" download>mcp-modeling-brief.md</a></p>` : ''}
    </section>` : '';
  const visionReviewRoles = Array.from(new Set((visionEvidenceReviewPatch?.review_items || [])
    .filter((item) => item.evidence_type === 'semantic_candidate_policy')
    .map((item) => item.current_value?.role || item.current_value?.class || item.id)));
  const visionEvidenceSection = visionEvidenceReport ? `<section class="section">
      <h2>Vision Evidence</h2>
      <p class="subtle">Unified visual evidence contract for image structure. Review decisions remain policy-only and cannot promote geometry or emit SketchUp DSL.</p>
      <p><span class="tag ${visionEvidenceReport.ok ? 'good' : 'warn'}">verdict=${escapeHtml(visionEvidenceReport.verdict || 'unknown')}</span><span class="tag ${visionEvidenceReport.summary?.default_heavy_model_required ? 'bad' : 'good'}">default_heavy_model_required=${String(visionEvidenceReport.summary?.default_heavy_model_required === true)}</span><span class="tag ${visionEvidenceReviewPatch?.summary?.review_required ? 'warn' : 'good'}">review_items=${String(visionEvidenceReviewPatch?.summary?.total_items || 0)}</span><span class="tag ${visionEvidenceReviewPatch?.summary?.semantic_candidate_items ? 'warn' : 'good'}">semantic_candidate_items=${String(visionEvidenceReviewPatch?.summary?.semantic_candidate_items || 0)}</span></p>
      ${visionReviewRoles.length ? `<p>${visionReviewRoles.map((role) => `<span class="tag warn">${escapeHtml(role)}</span>`).join('')}</p>` : ''}
      <p><a id="download-vision-evidence-report" href="../vision-evidence-v1-report.json" download>vision-evidence-v1-report.json</a>${visionEvidenceReviewPatch ? ` · <a id="download-vision-evidence-review-patch" href="../vision-evidence-review-patch.json" download>vision-evidence-review-patch.json</a> · <a id="download-vision-evidence-review-patch-markdown" href="../vision-evidence-review-patch.md" download>vision-evidence-review-patch.md</a> · <a id="open-vision-evidence-review-workbench" href="../vision-evidence-review/index.html">vision-evidence-review/index.html</a>` : ''}</p>
    </section>` : '';
  const sourcePackageBlockers = sourcePackageAssessment?.blockers?.length
    ? sourcePackageAssessment.blockers.map((blocker) => `<span class="tag bad">${escapeHtml(blocker)}</span>`).join('')
    : '<span class="tag good">no source-package blockers</span>';
  const sourcePackageActions = sourcePackageAssessment?.next_actions?.length
    ? sourcePackageAssessment.next_actions.map((action) => `<li>${escapeHtml(action)}</li>`).join('\n')
    : '<li>No source-package actions recorded.</li>';
  const sourceRequestStatus = sourcePackageAssessment?.source_request?.status || 'none';
  const sourcePackageSection = sourcePackageAssessment ? `<section class="section">
      <h2>Real-World Building Source Package</h2>
      <p class="subtle">Input-quality assessment for release-positive building work. This is separate from final release readiness.</p>
      <p><span class="tag ${sourcePackageAssessment.input_ready_for_release_work ? 'good' : 'bad'}">input_ready_for_release_work=${String(sourcePackageAssessment.input_ready_for_release_work === true)}</span><span class="tag ${sourcePackageAssessment.release_ready ? 'good' : 'bad'}">release_ready=${String(sourcePackageAssessment.release_ready === true)}</span><span class="tag ${sourcePackageAssessment.status === 'input_ready_for_release_work' ? 'good' : 'warn'}">status=${escapeHtml(sourcePackageAssessment.status)}</span><span class="tag ${sourceRequestStatus === 'release_ready' ? 'good' : 'warn'}">source_request=${escapeHtml(sourceRequestStatus)}</span></p>
      <p>${sourcePackageBlockers}</p>
      <ul>${sourcePackageActions}</ul>
      <p><a id="download-real-world-building-source-package" href="../real-world-building-source-package.json" download>real-world-building-source-package.json</a> · <a id="download-real-world-building-source-package-markdown" href="../real-world-building-source-package.md" download>real-world-building-source-package.md</a> · <a id="download-real-world-building-source-request" href="../real-world-building-source-request.json" download>real-world-building-source-request.json</a> · <a id="download-real-world-building-source-request-markdown" href="../real-world-building-source-request.md" download>real-world-building-source-request.md</a> · <a id="download-real-world-building-upload-manifest-template" href="../upload-manifest.template.json" download>upload-manifest.template.json</a></p>
    </section>` : '';
  const releaseDraftBlockers = realWorldBuildingReleaseDraft?.checklist?.blockers?.length
    ? realWorldBuildingReleaseDraft.checklist.blockers.map((blocker) => `<span class="tag bad">${escapeHtml(blocker)}</span>`).join('')
    : '<span class="tag good">no release blockers</span>';
  const releaseDraftActions = realWorldBuildingReleaseDraft?.checklist?.next_actions?.length
    ? realWorldBuildingReleaseDraft.checklist.next_actions.map((action) => `<li>${escapeHtml(action)}</li>`).join('\n')
    : '<li>No release actions recorded.</li>';
  const releaseWorkOrder = realWorldBuildingReleaseDraft?.workOrder || null;
  const releaseWorkOrderBlockers = releaseWorkOrder?.blockers?.length
    ? releaseWorkOrder.blockers.map((blocker) => `<span class="tag bad">${escapeHtml(blocker)}</span>`).join('')
    : '<span class="tag good">no required work-order blockers</span>';
  const releaseWorkOrderRows = releaseWorkOrder?.tasks?.length
    ? releaseWorkOrder.tasks.map((task) => `<tr>
        <td><code>${escapeHtml(task.id)}</code></td>
        <td><span class="tag ${task.status === 'pass' ? 'good' : task.status === 'review' ? 'warn' : 'bad'}">${escapeHtml(task.status)}</span></td>
        <td>${task.required ? 'yes' : 'no'}</td>
        <td>${escapeHtml(task.summary || '')}${task.command ? `<br><code>${escapeHtml(task.command)}</code>` : ''}</td>
      </tr>`).join('\n')
    : '<tr><td colspan="4">No release work-order tasks recorded.</td></tr>';
  const releaseDraftCheckRows = realWorldBuildingReleaseDraft?.checklist?.checks?.length
    ? realWorldBuildingReleaseDraft.checklist.checks.map((check) => {
      const items = Array.isArray(check.items) && check.items.length
        ? `<ul>${check.items.map((item) => {
          const label = item.role || item.path || 'item';
          const exists = item.exists === undefined ? '' : ` exists=${String(item.exists)}`;
          const generated = item.generated_path_blocker ? ' generated_path_blocker=true' : '';
          return `<li><code>${escapeHtml(label)}</code>${exists}${generated}${item.path && item.role ? ` <code>${escapeHtml(item.path)}</code>` : ''}</li>`;
        }).join('')}</ul>`
        : '';
      return `<tr>
        <td><code>${escapeHtml(check.id)}</code></td>
        <td><span class="tag ${check.status === 'pass' ? 'good' : check.status === 'review' ? 'warn' : 'bad'}">${escapeHtml(check.status)}</span></td>
        <td>${check.required ? 'yes' : 'no'}</td>
        <td>${escapeHtml(check.message || '')}${items}</td>
      </tr>`;
    }).join('\n')
    : '<tr><td colspan="4">No release checklist checks recorded.</td></tr>';
  const releaseDraftSection = realWorldBuildingReleaseDraft ? `<section class="section">
      <h2>Real-World Building Release Draft</h2>
      <p class="subtle">Release-positive manifest draft and checklist. This does not grant compile or release permission.</p>
      <p><span class="tag ${realWorldBuildingReleaseDraft.checklist?.release_ready ? 'good' : 'bad'}">release_ready=${String(realWorldBuildingReleaseDraft.checklist?.release_ready === true)}</span><span class="tag ${realWorldBuildingReleaseDraft.checklist?.can_promote_to_release_manifest ? 'good' : 'bad'}">can_promote_to_release_manifest=${String(realWorldBuildingReleaseDraft.checklist?.can_promote_to_release_manifest === true)}</span><span class="tag ${realWorldBuildingReleaseDraft.validation?.ok ? 'good' : 'bad'}">validation_status=${escapeHtml(realWorldBuildingReleaseDraft.validation?.status || 'not_run')}</span></p>
      <p>${releaseDraftBlockers}</p>
      <ul>${releaseDraftActions}</ul>
      ${releaseWorkOrder ? `<p><span class="tag ${releaseWorkOrder.can_promote_to_release_manifest ? 'good' : 'bad'}">work_order=${escapeHtml(releaseWorkOrder.status)}</span><span class="tag ${releaseWorkOrder.blocked_required_task_count ? 'bad' : 'good'}">blocked_required_tasks=${String(releaseWorkOrder.blocked_required_task_count || 0)}</span></p>
      <p>${releaseWorkOrderBlockers}</p>
      <div class="scroll">
        <table>
          <thead><tr><th>Task</th><th>Status</th><th>Required</th><th>Details</th></tr></thead>
          <tbody>${releaseWorkOrderRows}</tbody>
        </table>
      </div>` : ''}
      <div class="scroll">
        <table>
          <thead><tr><th>Check</th><th>Status</th><th>Required</th><th>Details</th></tr></thead>
          <tbody>${releaseDraftCheckRows}</tbody>
        </table>
      </div>
      <p><a id="download-real-world-building-contract-summary" href="${escapeHtml(reviewRelativeRepoPath(outputDir, realWorldBuildingReleaseDraft.contractSummaryOutput))}" download>manifest-contract-summary.json</a> · <a id="download-real-world-building-manifest-draft" href="${escapeHtml(reviewRelativeRepoPath(outputDir, realWorldBuildingReleaseDraft.manifestOutput))}" download>manifest.draft.json</a> · <a id="download-real-world-building-release-checklist" href="${escapeHtml(reviewRelativeRepoPath(outputDir, realWorldBuildingReleaseDraft.checklistOutput))}" download>release-checklist.json</a> · <a id="download-real-world-building-release-checklist-markdown" href="${escapeHtml(reviewRelativeRepoPath(outputDir, realWorldBuildingReleaseDraft.checklistMarkdownOutput))}" download>release-checklist.md</a> · <a id="download-real-world-building-release-work-order" href="${escapeHtml(reviewRelativeRepoPath(outputDir, realWorldBuildingReleaseDraft.workOrderOutput))}" download>release-work-order.json</a> · <a id="download-real-world-building-release-work-order-markdown" href="${escapeHtml(reviewRelativeRepoPath(outputDir, realWorldBuildingReleaseDraft.workOrderMarkdownOutput))}" download>release-work-order.md</a></p>
    </section>` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Structured Asset Intake Review</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #1f2933;
      --muted: #667085;
      --line: #d7dde7;
      --panel: #ffffff;
      --soft: #f5f7fa;
      --good: #0f766e;
      --warn: #995c00;
      --bad: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: var(--soft);
      line-height: 1.45;
    }
    header {
      padding: 24px 32px 18px;
      background: var(--panel);
      border-bottom: 1px solid var(--line);
    }
    main {
      max-width: 1440px;
      margin: 0 auto;
      padding: 22px 32px 44px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 26px;
      line-height: 1.15;
      letter-spacing: 0;
    }
    h2 {
      margin: 0 0 12px;
      font-size: 17px;
      letter-spacing: 0;
    }
    h3 {
      margin: 16px 0 10px;
      font-size: 14px;
      letter-spacing: 0;
    }
    p { margin: 0; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.92em;
    }
    .subtle { color: var(--muted); }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .metric, .section {
      background: var(--panel);
      border: 1px solid var(--line);
    }
    .metric {
      min-height: 92px;
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
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0 0 12px;
      align-items: center;
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
      background: var(--good);
      border-color: var(--good);
      color: #fff;
    }
    input,
    textarea {
      width: 100%;
      border: 1px solid var(--line);
      background: #fff;
      color: var(--ink);
      padding: 7px 9px;
      font: inherit;
      font-size: 13px;
    }
    input[type="checkbox"] {
      width: auto;
      min-width: 16px;
      min-height: 16px;
    }
    textarea {
      margin: 6px 0 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      resize: vertical;
    }
    .review-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 12px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      text-align: left;
      vertical-align: top;
      padding: 8px 10px;
      border-bottom: 1px solid var(--line);
    }
    th {
      color: var(--muted);
      font-weight: 700;
      background: #f9fafb;
    }
    .tag {
      display: inline-block;
      margin: 0 5px 5px 0;
      padding: 2px 7px;
      border: 1px solid var(--line);
      background: #fff;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .tag.good {
      border-color: #9bd6ce;
      background: #e8f7f4;
      color: var(--good);
    }
    .tag.warn {
      border-color: #e8c57f;
      background: #fff6e6;
      color: var(--warn);
    }
    .tag.bad {
      border-color: #efb2ac;
      background: #fff1f0;
      color: var(--bad);
    }
    .scroll {
      overflow: auto;
      border: 1px solid var(--line);
    }
    @media (max-width: 900px) {
      header, main { padding-left: 16px; padding-right: 16px; }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .review-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <header>
    <h1>Structured Asset Intake Review</h1>
    <p class="subtle">${escapeHtml(assetSet.profile_routing.object_name || 'Unspecified Asset')} · <code>${escapeHtml(assetSet.profile_routing.selected_profile)}</code></p>
  </header>
  <main>
    <section class="grid">
      <div class="metric"><span class="subtle">Status</span><strong class="${statusClass}">${escapeHtml(modelingBrief.status)}</strong></div>
      <div class="metric"><span class="subtle">Compile Allowed</span><strong>${String(modelingBrief.compile_allowed)}</strong></div>
      <div class="metric"><span class="subtle">Assets</span><strong>${assetSet.assets.length}</strong></div>
      <div class="metric"><span class="subtle">Candidates</span><strong>${candidateGraph.summary.candidate_count}</strong></div>
    </section>
    <section class="section">
      <h2>Gates</h2>
      <p>${gateReasons}</p>
      <ul>${missingItems}</ul>
    </section>
    ${intakeSummarySection}
    ${draftingFirstSection}
    ${objectSurfaceSection}
    ${facadePlaneGraphSection}
    ${buildingSingleSemanticSection}
    ${visionEvidenceSection}
    ${mcpBriefSection}
    ${sourcePackageSection}
    ${releaseDraftSection}
    <section class="section">
      <h2>Assets</h2>
      <div class="scroll">
        <table>
          <thead><tr><th>ID</th><th>View</th><th>Quality</th><th>Source</th></tr></thead>
          <tbody>${assetRows}</tbody>
        </table>
      </div>
    </section>
    <section class="section">
      <h2>Candidates</h2>
      <div class="toolbar">
        <button type="button" id="select-review-required">Select Reviewable</button>
        <button type="button" id="clear-selection">Clear</button>
      </div>
      <div class="scroll">
        <table>
          <thead><tr><th>Select</th><th>ID</th><th>Role</th><th>View</th><th>Confidence</th><th>Status</th><th>Blockers</th></tr></thead>
          <tbody>${candidateRows}</tbody>
        </table>
      </div>
    </section>
    <section class="section">
      <h2>Promotion Review</h2>
      <p class="subtle">Exported review JSON stays blocked while profile, scale, view, or candidate blockers remain unresolved.</p>
      <div class="review-grid">
        <label>Reviewer<br><input id="reviewer-name" value="intake-workbench"></label>
        <label>Known width mm<br><input id="known-width" type="number" min="0" step="1" placeholder="optional"></label>
        <label>Known depth mm<br><input id="known-depth" type="number" min="0" step="1" placeholder="optional"></label>
        <label>Known height mm<br><input id="known-height" type="number" min="0" step="1" placeholder="optional"></label>
      </div>
      <div class="toolbar" aria-label="Review confirmations">
        <label><input id="confirm-profile" type="checkbox"> Confirm profile</label>
        <label><input id="confirm-scale" type="checkbox"> Confirm scale</label>
        <label><input id="resolve-missing-inputs" type="checkbox"> Resolve missing inputs</label>
        <label><input id="resolve-candidate-blockers" type="checkbox"> Resolve selected blockers</label>
        <label><input id="accept-draft-view-review" type="checkbox"> Accept draft views</label>
        <label><input id="accept-local-detail-review" type="checkbox"> Accept local surfaces/details</label>
        <label><input id="accept-facade-plane-review" type="checkbox"> Accept facade planes</label>
      </div>
      <label>Review notes<br><textarea id="review-notes" rows="4" placeholder="Profile, scale, facade/recess/duct/shadow decisions"></textarea></label>
      <div class="toolbar">
        <button type="button" id="refresh-promotion-review" class="primary">Refresh Review JSON</button>
        <button type="button" id="copy-promotion-review">Copy JSON</button>
        <button type="button" id="download-promotion-review">Download JSON</button>
      </div>
      <textarea id="accepted-candidates-json" rows="12" spellcheck="false"></textarea>
    </section>
  </main>
  <script id="asset-set-data" type="application/json">${scriptJson(assetSet)}</script>
  <script id="candidate-graph-data" type="application/json">${scriptJson(candidateGraph)}</script>
  <script id="modeling-brief-data" type="application/json">${scriptJson(modelingBrief)}</script>
  ${mcpModelingBrief ? `<script id="mcp-modeling-brief-data" type="application/json">${scriptJson(mcpModelingBrief)}</script>` : ''}
  ${structureEvidenceGraph ? `<script id="structure-evidence-graph-data" type="application/json">${scriptJson(structureEvidenceGraph)}</script>` : ''}
  ${draftViewGraph ? `<script id="draft-view-graph-data" type="application/json">${scriptJson(draftViewGraph)}</script>` : ''}
  ${objectSurfaceGraph ? `<script id="object-surface-graph-data" type="application/json">${scriptJson(objectSurfaceGraph)}</script>` : ''}
  ${facadePlaneGraph ? `<script id="facade-plane-graph-data" type="application/json">${scriptJson(facadePlaneGraph)}</script>` : ''}
  ${visionEvidenceReport ? `<script id="vision-evidence-report-data" type="application/json">${scriptJson(visionEvidenceReport)}</script>` : ''}
  ${visionEvidenceReviewPatch ? `<script id="vision-evidence-review-patch-data" type="application/json">${scriptJson(visionEvidenceReviewPatch)}</script>` : ''}
  ${buildingSingleSemanticEvidence ? `<script id="building-single-semantic-evidence-data" type="application/json">${scriptJson(buildingSingleSemanticEvidence)}</script>` : ''}
  ${buildingSingleReviewHelperOutput ? `<script id="review-helper-output-data" type="application/json">${scriptJson(buildingSingleReviewHelperOutput)}</script>` : ''}
  ${sourcePackageAssessment ? `<script id="real-world-building-source-package-data" type="application/json">${scriptJson(sourcePackageAssessment)}</script>` : ''}
  ${sourcePackageAssessment?.source_request ? `<script id="real-world-building-source-request-data" type="application/json">${scriptJson(sourcePackageAssessment.source_request)}</script>` : ''}
  ${realWorldBuildingReleaseDraft ? `<script id="real-world-building-release-summary-data" type="application/json">${scriptJson(realWorldBuildingReleaseDraft.validation?.summary || null)}</script>` : ''}
  ${realWorldBuildingReleaseDraft ? `<script id="real-world-building-release-checklist-data" type="application/json">${scriptJson(realWorldBuildingReleaseDraft.checklist || null)}</script>` : ''}
  ${realWorldBuildingReleaseDraft ? `<script id="real-world-building-release-work-order-data" type="application/json">${scriptJson(realWorldBuildingReleaseDraft.workOrder || null)}</script>` : ''}
  <script id="candidate-promotion-review-data" type="application/json">${scriptJson(promotionReview)}</script>
  <script>
    const assetSet = JSON.parse(document.getElementById('asset-set-data').textContent);
    const candidateGraph = JSON.parse(document.getElementById('candidate-graph-data').textContent);
    const modelingBrief = JSON.parse(document.getElementById('modeling-brief-data').textContent);
    const draftPromotionReview = JSON.parse(document.getElementById('candidate-promotion-review-data').textContent);
    const readOptionalJson = (id) => {
      const node = document.getElementById(id);
      return node ? JSON.parse(node.textContent) : null;
    };
    const draftViewGraph = readOptionalJson('draft-view-graph-data');
    const objectSurfaceGraph = readOptionalJson('object-surface-graph-data');
    const facadePlaneGraph = readOptionalJson('facade-plane-graph-data');
    const candidateById = new Map(candidateGraph.candidates.map((candidate) => [candidate.id, candidate]));
    const selectedInputs = () => Array.from(document.querySelectorAll('.candidate-select:checked'));
    const candidateReviewItem = (candidate) => ({
      candidate_id: candidate.id,
      role: candidate.role,
      view: candidate.view,
      source_image: candidate.source_image,
      source_observation_id: candidate.source_observation_id,
      confidence: candidate.confidence,
      promotion_status: candidate.promotion.status,
      blockers: candidate.promotion.blockers || [],
      reviewer_note: ''
    });
    const numericValue = (id) => {
      const value = Number(document.getElementById(id).value);
      return Number.isFinite(value) && value > 0 ? value : undefined;
    };
    const isChecked = (id) => document.getElementById(id)?.checked === true;
    function buildDraftViewReviewDecision() {
      if (!draftPromotionReview.draft_view_review) return null;
      const accepted = isChecked('accept-draft-view-review');
      const slots = (draftViewGraph?.view_slots || []).filter((slot) => slot.status !== 'unknown');
      const acceptedSlotIds = accepted ? slots.map((slot) => slot.slot_id) : [];
      return {
        ...draftPromotionReview.draft_view_review,
        status: acceptedSlotIds.length ? 'accepted' : 'not_accepted',
        accepted_view_slot_ids: acceptedSlotIds,
        accepted_plane_hypothesis_ids: accepted ? slots.flatMap((slot) => slot.visible_regions || []).map((region) => region.id) : [],
        promotion_allowed: acceptedSlotIds.length > 0,
        blockers: acceptedSlotIds.length ? [] : Array.from(new Set([...(draftPromotionReview.draft_view_review.blockers || []), 'accepted_draft_view_review_required'])),
        reviewer_note: acceptedSlotIds.length ? 'Reviewer accepted DraftViewGraph slots in intake UI.' : ''
      };
    }
    function buildLocalDetailReviewDecision() {
      if (!draftPromotionReview.local_detail_review) return null;
      const accepted = isChecked('accept-local-detail-review');
      const surfaces = objectSurfaceGraph?.surfaces || [];
      const details = [
        ...(objectSurfaceGraph?.surface_local_feature_candidates || []),
        ...(facadePlaneGraph?.plane_local_detail_candidates || [])
      ];
      const acceptedSurfaceIds = accepted ? surfaces.map((surface) => surface.id) : [];
      const acceptedDetailIds = accepted ? details.map((detail) => detail.id) : [];
      return {
        ...draftPromotionReview.local_detail_review,
        status: acceptedSurfaceIds.length || acceptedDetailIds.length ? 'accepted' : 'not_accepted',
        accepted_surface_ids: acceptedSurfaceIds,
        accepted_detail_ids: acceptedDetailIds,
        detail_bindings: acceptedDetailIds.map((detailId) => ({
          detail_id: detailId,
          target_surface_id: acceptedSurfaceIds[0] || null,
          target_plane_id: facadePlaneGraph?.planes?.[0]?.id || null,
          status: 'accepted'
        })),
        promotion_allowed: acceptedSurfaceIds.length > 0 || acceptedDetailIds.length > 0,
        blockers: acceptedSurfaceIds.length || acceptedDetailIds.length ? [] : Array.from(new Set([...(draftPromotionReview.local_detail_review.blockers || []), 'accepted_local_detail_review_required'])),
        reviewer_note: acceptedSurfaceIds.length || acceptedDetailIds.length ? 'Reviewer accepted surface-local and plane-local detail bindings in intake UI.' : ''
      };
    }
    function buildFacadePlaneReviewDecision() {
      if (!draftPromotionReview.facade_plane_review) return null;
      const accepted = isChecked('accept-facade-plane-review');
      const acceptedPlaneIds = accepted ? (facadePlaneGraph?.planes || []).map((plane) => plane.id) : [];
      return {
        ...draftPromotionReview.facade_plane_review,
        status: acceptedPlaneIds.length ? 'accepted' : 'not_accepted',
        accepted_plane_ids: acceptedPlaneIds,
        promotion_allowed: acceptedPlaneIds.length > 0,
        blockers: acceptedPlaneIds.length ? [] : Array.from(new Set([...(draftPromotionReview.facade_plane_review.blockers || []), 'accepted_facade_plane_review_required'])),
        reviewer_note: acceptedPlaneIds.length ? 'Reviewer accepted FacadePlaneGraph planes in intake UI.' : ''
      };
    }
    function buildPromotionReview() {
      const selected = selectedInputs()
        .map((input) => candidateById.get(input.dataset.candidateId))
        .filter(Boolean);
      const resolveCandidateBlockers = document.getElementById('resolve-candidate-blockers').checked;
      const resolveMissingInputs = document.getElementById('resolve-missing-inputs').checked;
      const acceptedCandidates = selected.map((candidate) => {
        const item = candidateReviewItem(candidate);
        return resolveCandidateBlockers
          ? { ...item, promotion_status: 'review_required', blockers: [], reviewer_note: 'Reviewer resolved selected candidate blockers in UI.' }
          : item;
      });
      const selectedBlockers = selected.flatMap((candidate) => candidate.promotion?.blockers || []);
      const unresolvedMissingInputs = resolveMissingInputs ? [] : (modelingBrief.missing_inputs || []);
      const unresolvedSelectedBlockers = resolveCandidateBlockers ? [] : selectedBlockers;
      const draftViewReview = buildDraftViewReviewDecision();
      const localDetailReview = buildLocalDetailReviewDecision();
      const facadePlaneReview = buildFacadePlaneReviewDecision();
      const reviewContractBlockers = [
        ...(draftViewReview?.blockers || []),
        ...(localDetailReview?.blockers || []),
        ...(facadePlaneReview?.blockers || [])
      ];
      const blockers = Array.from(new Set([...unresolvedMissingInputs, ...unresolvedSelectedBlockers, ...reviewContractBlockers]));
      const resolvedBlockers = Array.from(new Set([
        ...(resolveMissingInputs ? (modelingBrief.missing_inputs || []) : []),
        ...(resolveCandidateBlockers ? selectedBlockers : [])
      ]));
      const scale = {
        status: document.getElementById('confirm-scale').checked && (numericValue('known-width') || numericValue('known-depth') || numericValue('known-height')) ? 'confirmed' : 'needs_scale_confirmation',
        units: 'mm',
        note: 'Entered in intake review workbench.'
      };
      const width = numericValue('known-width');
      const depth = numericValue('known-depth');
      const height = numericValue('known-height');
      if (width) scale.known_width = width;
      if (depth) scale.known_depth = depth;
      if (height) scale.known_height = height;
      const profileConfirmed = document.getElementById('confirm-profile').checked && assetSet.profile_routing.status === 'routed' && assetSet.profile_routing.selected_profile !== 'unknown_object';
      return {
        ...draftPromotionReview,
        reviewer: document.getElementById('reviewer-name').value || 'intake-workbench',
        verdict: blockers.length ? 'blocked' : selected.length ? 'accepted_subset' : 'needs_review',
        compile_allowed: false,
        promotion_allowed: blockers.length === 0 && selected.length > 0,
        resolved_blockers: resolvedBlockers,
        blockers,
        profile_confirmation: {
          selected_profile: assetSet.profile_routing.selected_profile,
          status: profileConfirmed ? 'confirmed' : assetSet.profile_routing.status === 'routed' ? 'routed_unconfirmed' : 'needs_profile'
        },
        scale_confirmation: scale,
        draft_view_review: draftViewReview,
        local_detail_review: localDetailReview,
        facade_plane_review: facadePlaneReview,
        accepted_candidates: acceptedCandidates,
        held_candidates: candidateGraph.candidates
          .filter((candidate) => !selected.some((item) => item.id === candidate.id))
          .map(candidateReviewItem),
        notes: document.getElementById('review-notes').value || ''
      };
    }
    function refreshPromotionReview() {
      document.getElementById('accepted-candidates-json').value = JSON.stringify(buildPromotionReview(), null, 2);
    }
    document.getElementById('select-review-required').addEventListener('click', () => {
      for (const input of document.querySelectorAll('.candidate-select')) {
        const candidate = candidateById.get(input.dataset.candidateId);
        input.checked = candidate?.promotion?.status !== 'eligible';
      }
      refreshPromotionReview();
    });
    document.getElementById('clear-selection').addEventListener('click', () => {
      for (const input of document.querySelectorAll('.candidate-select')) input.checked = false;
      refreshPromotionReview();
    });
    document.getElementById('refresh-promotion-review').addEventListener('click', refreshPromotionReview);
    document.getElementById('copy-promotion-review').addEventListener('click', async () => {
      refreshPromotionReview();
      await navigator.clipboard.writeText(document.getElementById('accepted-candidates-json').value);
    });
    document.getElementById('download-promotion-review').addEventListener('click', () => {
      refreshPromotionReview();
      const blob = new Blob([document.getElementById('accepted-candidates-json').value + '\\n'], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'candidate-promotion-review.json';
      anchor.click();
      URL.revokeObjectURL(url);
    });
    refreshPromotionReview();
  </script>
</body>
</html>
`;
}

function makeAssetSet({ input, assetFiles, analyses, observationSet, objectType, objectName, profile, documentParseReport = null }) {
  const reasons = [];
  if (profile === 'unknown_object') reasons.push('unknown_profile');
  if (!observationSet.quality_report.usable_for_modeling) reasons.push('observation_quality_not_compilable');
  if ((observationSet.scale_calibration?.confidence || 0) < 0.7) reasons.push('scale_confidence_below_publish_gate');
  const mediaTypes = new Set((assetFiles || []).map((asset) => asset.mediaType));
  if (mediaTypes.has('pdf') && !documentParserParsed(documentParseReport, 'pdf')) reasons.push('pdf_extractor_required');
  if (mediaTypes.has('cad') && !documentParserParsed(documentParseReport, 'cad')) reasons.push('cad_extractor_required');
  return {
    version: 1,
    kind: 'asset_set',
    id: stableId('asset-set', input),
    source_input: toRepoRelative(input),
    assets: (assetFiles || analyses.map((analysis) => ({ path: analysis.path, mediaType: 'image' }))).map((asset, index) => {
      const analysisIndex = analyses.findIndex((item) => path.resolve(item.path) === path.resolve(asset.path));
      const analysis = analysisIndex >= 0 ? analyses[analysisIndex] : null;
      const observed = (observationSet.images || []).find((image) => path.resolve(repoRoot, image.image.path) === path.resolve(asset.path));
      return {
        id: `asset_${index + 1}`,
        path: toRepoRelative(asset.path),
        media_type: asset.mediaType || 'unknown',
        ...(analysis ? {
          width: analysis.sourceWidth || analysis.width,
          height: analysis.sourceHeight || analysis.height
        } : {}),
        detected_view: analysis ? (observed?.detected_view?.kind || 'unknown') : 'unknown',
        quality: analysis && observed?.quality_report?.usable_for_modeling ? 'usable' : 'review',
        content_sha256: asset.contentSha256 || null
      };
    }),
    profile_routing: {
      object_type: objectType,
      object_name: objectName,
      selected_profile: profile,
      status: profile === 'unknown_object' ? 'needs_profile' : 'routed',
      risks: observationSet.quality_report.risks || []
    },
    gates: {
      can_compile_geometry: reasons.length === 0,
      reasons
    }
  };
}

function requiredViewsForProfile(profile) {
  if (profile === 'building_single') return ['oblique', 'front', 'left', 'top'];
  if (profile === 'building_group') return ['top', 'oblique'];
  if (profile === 'vehicle_ambulance') return ['front', 'left', 'rear', 'top'];
  if (profile === 'switch_controller') return ['front', 'rear', 'right'];
  if (profile === 'compact_remote') return ['front', 'right'];
  return ['profile', 'scale', 'views'];
}

function parserRisksForAssetTypes(mediaTypes) {
  const risks = ['non_image_asset_requires_parser'];
  if (mediaTypes.includes('pdf')) risks.push('pdf_extractor_required');
  if (mediaTypes.includes('cad')) risks.push('cad_extractor_required');
  return risks;
}

function makeCandidateGraph({ assetSet, observationSet }) {
  const candidates = [];
  for (const image of observationSet.images || []) {
    for (const observation of image.observations || []) {
      if (!observation.component_hint && observation.kind !== 'silhouette') continue;
      const blockers = promotionBlockers({ assetSet, observationSet, observation });
      candidates.push({
        id: `${image.detected_view.kind}_${observation.id}`,
        role: observation.component_hint || observation.kind,
        source_image: image.image.path,
        source_observation_id: observation.id,
        view: image.detected_view.kind,
        ...(observation.bbox ? { bbox: observation.bbox } : {}),
        ...(observation.points ? { polygon_px: observation.points } : {}),
        ...(observation.grounding?.semantic_evidence_id ? { semantic_evidence_id: observation.grounding.semantic_evidence_id } : {}),
        ...(observation.grounding?.semantic_source ? { semantic_source: observation.grounding.semantic_source } : {}),
        ...(observation.grounding?.semantic_source_priority !== undefined ? { semantic_source_priority: observation.grounding.semantic_source_priority } : {}),
        ...(observation.grounding?.projection_model ? { projection_model: observation.grounding.projection_model } : {}),
        ...(observation.grounding?.perspective_strength ? { perspective_strength: observation.grounding.perspective_strength } : {}),
        ...(observation.grounding?.image_space_geometry ? { image_space_geometry: observation.grounding.image_space_geometry } : {}),
        ...(observation.grounding?.polygon_derivation ? { polygon_derivation: observation.grounding.polygon_derivation } : {}),
        ...(observation.grounding?.orthographic_projection_allowed !== undefined ? { orthographic_projection_allowed: observation.grounding.orthographic_projection_allowed === true } : {}),
        ...(observation.grounding?.blocked_interpretations ? { blocked_interpretations: observation.grounding.blocked_interpretations } : {}),
        ...(observation.grounding?.allowed_semantics ? { allowed_semantics: observation.grounding.allowed_semantics } : {}),
        ...(observation.grounding?.geometry_promotion_allowed !== undefined ? { geometry_promotion_allowed: observation.grounding.geometry_promotion_allowed === true } : {}),
        confidence: observation.confidence || 0,
        promotion: {
          status: blockers.length ? 'blocked' : 'review_required',
          blockers
        }
      });
    }
  }
  candidates.sort((a, b) => Number(b.semantic_source_priority || 0) - Number(a.semantic_source_priority || 0)
    || Number(b.confidence || 0) - Number(a.confidence || 0)
    || String(a.role || '').localeCompare(String(b.role || ''))
    || String(a.id || '').localeCompare(String(b.id || '')));
  return {
    version: 1,
    kind: 'candidate_graph',
    asset_set_id: assetSet.id,
    profile_id: observationSet.object.profile,
    candidates,
    summary: {
      candidate_count: candidates.length,
      eligible_count: candidates.filter((candidate) => candidate.promotion.status === 'eligible').length,
      blocked_count: candidates.filter((candidate) => candidate.promotion.status === 'blocked').length
    }
  };
}

function promotionBlockers({ assetSet, observationSet, observation }) {
  const blockers = [];
  if (assetSet.profile_routing.selected_profile === 'unknown_object') blockers.push('unknown_profile');
  if (assetSet.gates?.reasons?.includes('pdf_extractor_required')) blockers.push('pdf_extractor_required');
  if (assetSet.gates?.reasons?.includes('cad_extractor_required')) blockers.push('cad_extractor_required');
  if (observation.review_required === true || observation.grounding?.review_required === true) blockers.push('review_required');
  if ((observationSet.scale_calibration?.confidence || 0) < 0.7) blockers.push('scale_confidence_below_publish_gate');
  if (observation.grounding?.promotion_blockers?.length) blockers.push(...observation.grounding.promotion_blockers);
  return Array.from(new Set(blockers));
}

function documentParserParsed(report, mediaType) {
  if (!report) return false;
  return (report.assets || []).some((asset) => asset.media_type === mediaType && asset.status === 'parsed');
}

function makeModelingBrief({ assetSet, observationSet, candidateGraph }) {
  const missingInputs = Array.from(new Set([
    ...assetSet.gates.reasons,
    ...(observationSet.missing_views || []).map((view) => `missing_${view}_view`)
  ]));
  const status = assetSet.profile_routing.selected_profile === 'unknown_object'
    ? 'blocked'
    : assetSet.gates.can_compile_geometry
      ? 'ready_for_promotion_review'
      : 'review_required';
  return {
    version: 1,
    kind: 'modeling_brief',
    asset_set_id: assetSet.id,
    profile_id: observationSet.object.profile,
    status,
    compile_allowed: false,
    candidate_count: candidateGraph.summary.candidate_count,
    missing_inputs: missingInputs,
    instructions: [
      'Do not generate SketchUp DSL directly from this brief.',
      'Promote candidates only after profile routing, scale evidence, and review/correction gates pass.',
      'Use this brief to ask for missing views, dimensions, or semantic confirmations before modeling.'
    ]
  };
}

function intakeArtifactSourceMap(absoluteOutputDir, {
  hasStructureEvidenceGraph = false,
  hasDraftViewGraph = false,
  hasObjectSurfaceGraph = false,
  hasVisionEvidence = false,
  hasBuildingSingleSemanticEvidence = false,
  hasFacadePlaneGraph = false
} = {}) {
  const relativeOutputDir = toRepoRelative(absoluteOutputDir);
  const source = {
    asset_set: path.join(relativeOutputDir, 'asset-set.json'),
    observation_set: path.join(relativeOutputDir, 'observations.json'),
    candidate_graph: path.join(relativeOutputDir, 'candidate-graph.json'),
    modeling_brief: path.join(relativeOutputDir, 'modeling-brief.json'),
    source_package: path.join(relativeOutputDir, 'real-world-building-source-package.json'),
    promotion_review: path.join(relativeOutputDir, 'candidate-promotion-review.draft.json')
  };
  if (hasStructureEvidenceGraph) {
    source.structure_evidence_graph = path.join(relativeOutputDir, 'structure-evidence-graph.json');
    source.structure_evidence_graph_markdown = path.join(relativeOutputDir, 'structure-evidence-graph.md');
  }
  if (hasDraftViewGraph) {
    source.draft_view_graph = path.join(relativeOutputDir, 'draft-view-graph.json');
    source.draft_view_graph_markdown = path.join(relativeOutputDir, 'draft-view-graph.md');
    source.draft_view_graph_svg = path.join(relativeOutputDir, 'draft-view-graph.svg');
    source.draft_view_review_overlay = path.join(relativeOutputDir, 'draft-view-review-overlay.json');
  }
  if (hasObjectSurfaceGraph) {
    source.object_surface_graph = path.join(relativeOutputDir, 'object-surface-graph.json');
    source.object_surface_graph_markdown = path.join(relativeOutputDir, 'object-surface-graph.md');
  }
  if (hasVisionEvidence) {
    source.vision_evidence_report = path.join(relativeOutputDir, 'vision-evidence-v1-report.json');
    source.vision_evidence_review_patch = path.join(relativeOutputDir, 'vision-evidence-review-patch.json');
    source.vision_evidence_review_workbench = path.join(relativeOutputDir, 'vision-evidence-review', 'index.html');
  }
  if (hasBuildingSingleSemanticEvidence) {
    source.building_single_semantic_evidence = path.join(relativeOutputDir, 'building-single-semantic-evidence.json');
    source.building_single_semantic_evidence_markdown = path.join(relativeOutputDir, 'building-single-semantic-evidence.md');
    source.building_single_review_helper_output = path.join(relativeOutputDir, 'review-helper-output.json');
  }
  if (hasFacadePlaneGraph) {
    source.facade_plane_graph = path.join(relativeOutputDir, 'facade-plane-graph.json');
    source.facade_plane_graph_markdown = path.join(relativeOutputDir, 'facade-plane-graph.md');
    source.facade_plane_review_overlay = path.join(relativeOutputDir, 'facade-plane-review-overlay.json');
  }
  return source;
}

function candidateReviewItem(candidate) {
  return {
    candidate_id: candidate.id,
    role: candidate.role,
    view: candidate.view,
    source_image: candidate.source_image,
    source_observation_id: candidate.source_observation_id,
    semantic_evidence_id: candidate.semantic_evidence_id || '',
    semantic_source: candidate.semantic_source || '',
    confidence: candidate.confidence || 0,
    promotion_status: candidate.promotion?.status || 'review_required',
    blockers: candidate.promotion?.blockers || [],
    reviewer_note: ''
  };
}

function stableId(prefix, value) {
  const relative = toRepoRelative(value);
  const base = relative.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'asset';
  return `${prefix}-${base}-${hashString(relative)}`;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 8);
}

function toRepoRelative(value) {
  const absolute = path.resolve(value);
  return path.relative(repoRoot, absolute) || '.';
}

function reviewRelativeRepoPath(outputDir, repoRelativePath) {
  if (!repoRelativePath) return '#';
  return path.relative(path.join(outputDir, 'review'), path.resolve(repoRoot, repoRelativePath));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.input = argv[++index];
    else if (arg === '--output-dir') options.outputDir = argv[++index];
    else if (arg === '--object-type') options.objectType = argv[++index];
    else if (arg === '--object-name') options.objectName = argv[++index];
    else if (arg === '--overlay-dir') options.overlayDir = argv[++index];
    else if (arg === '--view-hints-file') options.viewHintsFile = argv[++index];
    else if (arg === '--building-single-annotations') options.buildingSingleAnnotations = argv[++index];
    else if (arg === '--building-single-vlm-candidates') options.buildingSingleVlmCandidates = argv[++index];
    else if (arg === '--max-dimension') options.maxDimension = argv[++index];
    else if (arg === '--edge-threshold') options.edgeThreshold = argv[++index];
    else if (arg === '--parse-documents') options.parseDocuments = true;
    else if (arg === '--real-world-building-release-draft') options.writeRealWorldBuildingReleaseDraft = true;
    else if (arg === '--release-draft-output') options.releaseDraftOutput = argv[++index];
    else if (arg === '--release-reviewer') options.releaseDraftReviewer = argv[++index];
    else if (arg === '--release-accepted-at') options.releaseDraftAcceptedAt = argv[++index];
    else if (arg === '--release-notes') options.releaseDraftNotes = argv[++index];
    else if (arg === '--source-package-gate-output') options.sourcePackageGateOutput = argv[++index];
    else if (arg === '--require-source-input-ready') options.requireSourceInputReady = true;
    else if (arg === '--require-source-release-ready') options.requireSourceReleaseReady = true;
    else if (arg === '--no-overlays') options.writeOverlays = false;
    else if (arg === '--no-review') options.writeReview = false;
    else if (arg === '--no-mcp-brief') options.writeMcpBrief = false;
    else if (arg === '--no-review-helper') options.writeReviewHelper = false;
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
  node projects/image-structured-modeler/scripts/intake-assets.mjs \\
    --input test/建筑单体 \\
    --object-type building_single \\
    --output-dir projects/image-structured-modeler/examples/building-single-anime-yellow/intake

Options:
  --object-type <type>       Optional routing hint. Omit it to keep unknown_object fail-closed.
  --object-name <name>       Human-readable target name.
  --view-hints-file <path>   Optional view hints.
  --building-single-annotations <path>
                             Optional building-single semantic annotation markdown.
  --building-single-vlm-candidates <path>
                             Optional schema-validated building-single VLM candidate fixture JSON.
  --parse-documents          Parse supported PDF/CAD metadata and DXF outlines into review-gated observations.
  --real-world-building-release-draft
                             Also write a real-world building manifest draft/checklist from this intake directory.
  --release-draft-output <path>
                             Optional manifest.draft.json output path for the release draft.
  --release-reviewer <name>  Optional reviewer name for the release draft.
  --release-accepted-at <date>
                             Optional accepted_at date for the release draft.
  --release-notes <text>     Optional review notes for the release draft.
  --source-package-gate-output <path>
                             Optional source-package gate-result JSON path.
  --require-source-input-ready
                             Exit non-zero unless the real-world building source package is input-ready.
  --require-source-release-ready
                             Exit non-zero unless the real-world building source package is release-ready.
  --no-overlays              Skip overlay images.
  --no-review                Skip review/index.html generation.
  --no-mcp-brief             Skip mcp-modeling-brief.json/md generation.
  --no-review-helper         Skip building-single review-helper-output.json generation.
`);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function scriptJson(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function releaseDraftSummary(realWorldBuildingReleaseDraft) {
  if (!realWorldBuildingReleaseDraft) return null;
  const checklist = realWorldBuildingReleaseDraft.checklist || {};
  const checklistChecks = (checklist.checks || []).map((check) => ({
    id: check.id,
    status: check.status,
    required: check.required === true
  }));
  const requiredChecklistChecks = checklistChecks.filter((check) => check.required);
  return {
    validation_status: realWorldBuildingReleaseDraft.validation?.status || null,
    validation_ok: realWorldBuildingReleaseDraft.validation?.ok === true,
    release_ready: checklist.release_ready === true,
    can_promote_to_release_manifest: checklist.can_promote_to_release_manifest === true,
    blockers: checklist.blockers || [],
    work_order_status: realWorldBuildingReleaseDraft.workOrder?.status || null,
    work_order_blocked_required_tasks: realWorldBuildingReleaseDraft.workOrder?.blocked_required_task_count ?? null,
    work_order_next_actions: realWorldBuildingReleaseDraft.workOrder?.next_actions || [],
    checklist_required_check_ids: uniqueChecklistIds(requiredChecklistChecks.map((check) => check.id)),
    checklist_failed_required_check_ids: uniqueChecklistIds(requiredChecklistChecks.filter((check) => check.status === 'fail').map((check) => check.id)),
    checklist_review_required_check_ids: uniqueChecklistIds(requiredChecklistChecks.filter((check) => check.status === 'review').map((check) => check.id)),
    checklist_checks: checklistChecks,
    next_actions: checklist.next_actions || []
  };
}

function uniqueChecklistIds(values) {
  return Array.from(new Set(values.filter((value) => typeof value === 'string' && value.length > 0))).sort();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  buildStructuredAssetIntake(options)
    .then(({ assetSet, observationSet, candidateGraph, modelingBrief, sourcePackageAssessment, sourcePackageGateResult, sourcePackageGateOutput, intakeSummary, documentParseReport, structureEvidenceGraph, draftViewGraph, objectSurfaceGraph, buildingSingleSemanticEvidence, buildingSingleReviewHelperOutput, facadePlaneGraph, realWorldBuildingReleaseDraft }) => {
      const ok = sourcePackageGateResult ? sourcePackageGateResult.ok : true;
      process.stdout.write(`${JSON.stringify({
        ok,
        profile: observationSet.object.profile,
        assets: assetSet.assets.length,
        candidates: candidateGraph.summary.candidate_count,
        compile_allowed: modelingBrief.compile_allowed,
        status: modelingBrief.status,
        missing_inputs: modelingBrief.missing_inputs,
        intake_summary: intakeSummary?.artifacts?.intake_summary || null,
        mcp_modeling_brief: options.outputDir && options.writeMcpBrief !== false ? path.join(options.outputDir, 'mcp-modeling-brief.json') : null,
        structure_evidence_graph: structureEvidenceGraph ? {
          kind: structureEvidenceGraph.kind,
          edges: structureEvidenceGraph.qa?.edge_evidence_count || 0,
          corners: structureEvidenceGraph.qa?.corner_evidence_count || 0,
          planes: structureEvidenceGraph.qa?.plane_hypothesis_count || 0,
          artifact: intakeSummary?.artifacts?.structure_evidence_graph || null
        } : null,
        draft_view_graph: draftViewGraph ? {
          kind: draftViewGraph.kind,
          status: draftViewGraph.review_policy?.status || 'unknown',
          observed_slots: draftViewGraph.summary?.observed_slots || 0,
          inferred_slots: draftViewGraph.summary?.inferred_slots || 0,
          unknown_slots: draftViewGraph.summary?.unknown_slots || 0,
          artifact: intakeSummary?.artifacts?.draft_view_graph || null,
          overlay: intakeSummary?.artifacts?.draft_view_review_overlay || null
        } : null,
        object_surface_graph: objectSurfaceGraph ? {
          kind: objectSurfaceGraph.kind,
          surfaces: objectSurfaceGraph.summary?.surface_count || 0,
          feature_candidates: objectSurfaceGraph.summary?.feature_candidate_count || 0,
          artifact: intakeSummary?.artifacts?.object_surface_graph || null
        } : null,
        building_single_semantic_evidence: buildingSingleSemanticEvidence ? {
          kind: buildingSingleSemanticEvidence.kind,
          selected_regions: buildingSingleSemanticEvidence.summary?.selected_region_count || 0,
          critical_roles_present: buildingSingleSemanticEvidence.summary?.critical_roles_present || [],
          geometry_promotion_allowed: buildingSingleSemanticEvidence.summary?.geometry_promotion_allowed === true,
          artifact: intakeSummary?.artifacts?.building_single_semantic_evidence || null,
          review_helper_output: buildingSingleReviewHelperOutput ? intakeSummary?.artifacts?.review_helper_output || null : null
        } : null,
        facade_plane_graph: facadePlaneGraph ? {
          kind: facadePlaneGraph.kind,
          status: facadePlaneGraph.review_policy?.status || 'unknown',
          planes: facadePlaneGraph.summary?.plane_count || 0,
          detail_candidates: facadePlaneGraph.summary?.detail_candidate_count || 0,
          promotion_allowed: facadePlaneGraph.summary?.promotion_allowed === true,
          artifact: intakeSummary?.artifacts?.facade_plane_graph || null,
          review_overlay: intakeSummary?.artifacts?.facade_plane_review_overlay || null
        } : null,
        real_world_building_source_package: sourcePackageAssessment ? {
          status: sourcePackageAssessment.status,
          input_ready_for_release_work: sourcePackageAssessment.input_ready_for_release_work,
          report: options.outputDir ? path.join(options.outputDir, 'real-world-building-source-package.json') : null
        } : null,
        real_world_building_source_package_gate_result: sourcePackageGateResult ? {
          ok: sourcePackageGateResult.ok,
          failed_requirements: sourcePackageGateResult.failed_requirements,
          output: sourcePackageGateOutput
        } : null,
        real_world_building_release_draft: realWorldBuildingReleaseDraft ? {
          manifest: realWorldBuildingReleaseDraft.manifestOutput,
          contract_summary: realWorldBuildingReleaseDraft.contractSummaryOutput,
          checklist: realWorldBuildingReleaseDraft.checklistOutput,
          checklist_markdown: realWorldBuildingReleaseDraft.checklistMarkdownOutput,
          work_order: realWorldBuildingReleaseDraft.workOrderOutput,
          work_order_markdown: realWorldBuildingReleaseDraft.workOrderMarkdownOutput,
          ...releaseDraftSummary(realWorldBuildingReleaseDraft)
        } : null,
        document_parse_status: documentParseReport?.status || null
      }, null, 2)}\n`);
      if (!ok) process.exit(1);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exit(1);
    });
}
