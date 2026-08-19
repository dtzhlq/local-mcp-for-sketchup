#!/usr/bin/env node
import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { SketchUpBridge } from '../src/bridge.mjs';
import {
  ImageStructuredCompileReceiptAuthority,
  verifyImageStructuredCompileReceipt
} from '../src/image-structured-compile-receipts.mjs';
import {
  verifyImageStructuredCompileBundle,
  verifyImageStructuredSourceAssets
} from '../src/image-structured-provenance.mjs';
import {
  buildImageStructuredBenchmarkReport,
  evaluateImageStructuredBenchmarkMethod,
  evaluateRouterInterpretationAgainstGroundTruth
} from '../src/product-modeling/image-structured-benchmark.mjs';
import { compilePartGraphToSketchUpDsl } from '../src/product-modeling/part-graph-compiler.mjs';
import { validatePartGraphSemanticContract } from '../src/product-modeling/semantic-contract-qa.mjs';
import {
  buildTraditionalHallSemanticFixture,
  semanticViewEvidence,
  traditionalHallProfile
} from '../test/fixtures/traditional-hall-semantic-fixture.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

export async function runImageStructuredMainBenchmark({
  outputDir,
  runtimeEvidence = null,
  trustedCompileReceiptPublicKeyPem = null
} = {}) {
  if (!outputDir) throw new Error('outputDir is required');
  const absoluteOutputDir = path.resolve(repoRoot, outputDir);
  await fs.mkdir(absoluteOutputDir, { recursive: true });
  const profile = traditionalHallProfile();
  const viewEvidence = semanticViewEvidence();
  const [groundTruth, routerObservation] = await Promise.all([
    readJson('test/fixtures/xieshan-hall-semantic-ground-truth.v1.json'),
    readJson('test/fixtures/xieshan-hall-building-single-router-observation.v1.json')
  ]);
  const runtimeContract = runtimeEvidence
    ? await loadRuntimeContractArtifacts(runtimeEvidence, { trustedCompileReceiptPublicKeyPem })
    : null;
  const contractPartGraph = runtimeContract?.partGraph
    || nonInterpretationVariant(buildTraditionalHallSemanticFixture(), 'manual_authored');
  const contractDsl = runtimeContract?.dsl
    || compilePartGraphToSketchUpDsl(contractPartGraph, profile, { repoRoot });
  const semanticReport = validatePartGraphSemanticContract(contractPartGraph, { phase: 'postcompile', dsl: contractDsl, viewEvidence });

  const reverseWrapped = nonInterpretationVariant(contractPartGraph, 'dsl_reverse_wrapped');
  const reverseDsl = compilePartGraphToSketchUpDsl(reverseWrapped, profile, { repoRoot });
  const imported = nonInterpretationVariant(contractPartGraph, 'imported_geometry');
  const importedDsl = compilePartGraphToSketchUpDsl(imported, profile, { repoRoot });

  const reviewedContractMethod = runtimeContract?.claimScope === 'image_structured_full'
    ? {
        id: 'reviewed_image_structured_contract',
        partGraph: contractPartGraph,
        provenanceReport: runtimeContract.provenanceReport,
        dsl: contractDsl,
        groundTruth
      }
    : {
        id: 'reviewed_truth_contract_fixture',
        partGraph: contractPartGraph,
        provenanceReport: null,
        dsl: contractDsl,
        interpretationAssessment: {
          status: 'excluded',
          eligible: false,
          score: null,
          reason: 'manually_constructed_ground_truth_contract_fixture_not_image_interpretation',
          provenance_verified: false,
          face_count_used: false
        }
      };
  const methodInputs = [
    reviewedContractMethod,
    { id: 'direct_multimodal_dsl_reverse_wrapped', partGraph: reverseWrapped, provenanceReport: null, dsl: reverseDsl },
    { id: 'imported_geometry_baseline', partGraph: imported, provenanceReport: null, dsl: importedDsl }
  ];
  const methods = [evaluateRouterInterpretationAgainstGroundTruth({
    id: 'observed_building_single_router',
    routerObservation,
    groundTruth
  })];
  for (const method of methodInputs) {
    const mockSession = path.join(absoluteOutputDir, `${method.id}.mock-session.json`);
    const bridge = new SketchUpBridge({ mock: { sessionPath: mockSession } });
    const mockBuild = await bridge.build_model({ runtime: 'mock', code: JSON.stringify(method.dsl) });
    methods.push(evaluateImageStructuredBenchmarkMethod({
      ...method,
      semanticReport,
      groundTruth: method.groundTruth || null,
      runtimeEvidence: method.id === 'reviewed_truth_contract_fixture'
        || method.id === 'reviewed_image_structured_contract'
        ? { ...(runtimeEvidence || {}), mock_build_ok: mockBuild.snapshot?.warning_summary?.by_severity?.error === 0 }
        : { mock_build_ok: mockBuild.snapshot?.warning_summary?.by_severity?.error === 0 },
      interpretationAssessment: method.interpretationAssessment
    }));
  }
  const report = buildImageStructuredBenchmarkReport({ methods });
  const reportSchema = await readJson('schema/image-structured-main-benchmark-report.schema.json');
  const validateReport = new Ajv2020({ allErrors: true, strict: false }).compile(reportSchema);
  if (!validateReport(report)) throw new Error(`Image-structured benchmark report failed its schema: ${JSON.stringify(validateReport.errors)}`);
  await fs.writeFile(
    path.join(absoluteOutputDir, 'image-structured-main-benchmark-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx' }
  );
  return report;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(path.resolve(repoRoot, filePath), 'utf8'));
}

export async function loadRuntimeContractArtifacts(runtimeEvidence, {
  trustedCompileReceiptPublicKeyPem = null
} = {}) {
  const liveSchema = await readJson('schema/image-structured-semantic-live-gate-report.schema.json');
  const validateLive = new Ajv2020({ allErrors: true, strict: false }).compile(liveSchema);
  if (!validateLive(runtimeEvidence)) {
    throw new Error(`Runtime evidence failed semantic live report schema: ${JSON.stringify(validateLive.errors)}`);
  }
  await verifyLiveEvidenceFileBindings(runtimeEvidence);
  const partGraphArtifact = await readBoundRuntimeArtifact(runtimeEvidence.inputs.part_graph, 'PartGraph');
  const dslArtifact = await readBoundRuntimeArtifact(runtimeEvidence.inputs.dsl, 'safe JSON DSL');
  const partGraph = partGraphArtifact.document;
  const dsl = dslArtifact.document;
  assertFixedHallSemanticBinding({ runtimeEvidence, partGraph, dsl });
  if (runtimeEvidence.claim_scope === 'semantic_runtime_only') {
    if (runtimeEvidence.inputs?.source_mode === 'image_structured'
      || runtimeEvidence.inputs?.interpretation_eligible !== false
      || partGraph.source_mode === 'image_structured'
      || dsl.metadata?.interpretation_eligible !== false) {
      throw new Error('Runtime-only benchmark evidence must remain excluded from image interpretation');
    }
    return { partGraph, dsl, claimScope: runtimeEvidence.claim_scope, provenanceReport: null };
  }
  if (runtimeEvidence.claim_scope !== 'image_structured_full') {
    throw new Error(`Unsupported semantic live claim scope: ${runtimeEvidence.claim_scope}`);
  }
  const provenanceReport = await verifyFullImageStructuredRuntimeContract({
    runtimeEvidence,
    partGraphArtifact,
    dslArtifact,
    trustedCompileReceiptPublicKeyPem
  });
  return { partGraph, dsl, claimScope: runtimeEvidence.claim_scope, provenanceReport };
}

export async function readTrustedCompileReceiptPublicKey(filePath) {
  const { bytes } = await readRepoRegularFile(filePath, 'trusted compile receipt public key');
  const publicKeyPem = bytes.toString('utf8');
  if (!publicKeyPem.includes('BEGIN PUBLIC KEY')) {
    throw new Error('Trusted compile receipt public key is not a PEM public key');
  }
  const publicKey = crypto.createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Trusted compile receipt public key must be Ed25519');
  }
  return publicKeyPem;
}

async function readBoundRuntimeArtifact(artifact, label) {
  if (!artifact?.path || !/^sha256:[a-f0-9]{64}$/.test(String(artifact.sha256 || ''))) {
    throw new Error(`${label} runtime artifact binding is incomplete`);
  }
  const { absolutePath, bytes } = await readRepoRegularFile(artifact.path, label);
  const actualHash = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
  if (actualHash !== artifact.sha256) throw new Error(`${label} runtime artifact hash mismatch`);
  return { absolutePath, sha256: actualHash, document: parseJson(bytes, label) };
}

async function verifyFullImageStructuredRuntimeContract({
  runtimeEvidence,
  partGraphArtifact,
  dslArtifact,
  trustedCompileReceiptPublicKeyPem
}) {
  if (runtimeEvidence.inputs?.source_mode !== 'image_structured'
    || runtimeEvidence.inputs?.interpretation_eligible !== true
    || partGraphArtifact.document.source_mode !== 'image_structured'
    || dslArtifact.document.metadata?.interpretation_eligible !== true) {
    throw new Error('Full image-structured benchmark evidence is not interpretation-eligible');
  }
  const manifestArtifact = await readBoundRuntimeArtifact(runtimeEvidence.inputs.compile_manifest, 'compile manifest');
  const manifest = manifestArtifact.document;
  if (manifest.kind !== 'image_structured_mcp_compile_manifest'
    || manifest.preview_only !== true
    || manifest.queue_called !== false) {
    throw new Error('Full benchmark compile manifest is not a preview-only image-structured manifest');
  }
  const manifestDslPath = resolveRepoArtifactPath(manifest.artifacts?.safe_json_dsl_preview, 'manifest safe JSON DSL');
  const manifestPartGraphPath = resolveRepoArtifactPath(manifest.inputs?.part_graph, 'manifest PartGraph');
  if (manifestDslPath !== dslArtifact.absolutePath || manifestPartGraphPath !== partGraphArtifact.absolutePath) {
    throw new Error('Full benchmark report and compile manifest do not bind the same PartGraph/DSL paths');
  }
  if (manifest.artifacts?.safe_json_dsl_sha256 !== dslArtifact.sha256
    || manifest.summary?.part_graph_id !== partGraphArtifact.document.id
    || manifest.summary?.source_mode !== 'image_structured'
    || manifest.summary?.interpretation_eligible !== true) {
    throw new Error('Full benchmark compile manifest summary does not bind the exact PartGraph/DSL bytes');
  }

  const inputKeys = ['asset_set', 'observations', 'candidate_graph', 'mcp_brief', 'promotion_review', 'promotion_patch', 'profile'];
  const documents = {};
  for (const key of inputKeys) {
    documents[key] = (await readRepoJsonPath(manifest.inputs?.[key], `manifest ${key}`)).document;
  }
  await validateFullBundleSchemas({ ...documents, part_graph: partGraphArtifact.document });
  const sourceAssetVerification = await verifyImageStructuredSourceAssets({
    assetSet: documents.asset_set,
    repoRoot
  });
  const provenanceReport = verifyImageStructuredCompileBundle({
    assetSet: documents.asset_set,
    observations: documents.observations,
    candidateGraph: documents.candidate_graph,
    promotionReview: documents.promotion_review,
    promotionPatch: documents.promotion_patch,
    partGraph: partGraphArtifact.document,
    mcpBrief: documents.mcp_brief,
    sourceAssetVerification,
    requireSourceAssetVerification: true
  });
  if (!provenanceReport.ok) {
    throw new Error(`Full benchmark provenance bundle is invalid: ${provenanceReport.blockers.join(', ')}`);
  }
  const dsl = dslArtifact.document;
  const receipt = manifest.compile_receipt;
  if (documents.profile.profile_id !== partGraphArtifact.document.profile_id
    || manifest.summary?.profile_id !== documents.profile.profile_id
    || manifest.summary?.provenance_binding_hash !== provenanceReport.binding?.binding_hash
    || manifest.summary?.source_asset_binding_hash !== provenanceReport.binding?.source_asset_binding_hash
    || runtimeEvidence.inputs?.provenance_binding_hash !== provenanceReport.binding?.binding_hash
    || runtimeEvidence.inputs?.source_asset_binding_hash !== provenanceReport.binding?.source_asset_binding_hash
    || runtimeEvidence.inputs?.compile_receipt_id !== receipt?.receipt_id
    || dsl.metadata?.provenance_binding_hash !== provenanceReport.binding?.binding_hash
    || dsl.metadata?.source_asset_binding_hash !== provenanceReport.binding?.source_asset_binding_hash) {
    throw new Error('Full benchmark provenance, profile, receipt, report, manifest, and DSL bindings disagree');
  }
  const publicKeyPem = trustedCompileReceiptPublicKeyPem
    || await new ImageStructuredCompileReceiptAuthority().publicKeyPem();
  const historicalVerificationTime = Date.parse(receipt?.issued_at);
  if (!Number.isFinite(historicalVerificationTime)
    || !Number.isFinite(Date.parse(receipt?.expires_at))
    || Date.parse(receipt.expires_at) <= historicalVerificationTime) {
    throw new Error('Full benchmark compile receipt has an invalid signed lifetime');
  }
  verifyImageStructuredCompileReceipt(receipt, {
    binding: provenanceReport.binding,
    publicKeyPem,
    dslSha256: dslArtifact.sha256,
    expectedPhase: 'compiled_dsl',
    now: historicalVerificationTime
  });
  return provenanceReport;
}

function assertFixedHallSemanticBinding({ runtimeEvidence, partGraph, dsl }) {
  if (partGraph.source_mode !== runtimeEvidence.inputs?.source_mode
    || dsl.metadata?.source_mode !== partGraph.source_mode
    || dsl.metadata?.part_graph_id !== partGraph.id
    || dsl.metadata?.semantic_contract?.id !== partGraph.semantic_contract?.id
    || runtimeEvidence.inputs?.semantic_contract_id !== partGraph.semantic_contract?.id
    || !String(partGraph.semantic_contract?.id || '').startsWith('xieshan-hall-four-truths-v1')) {
    throw new Error('Runtime evidence PartGraph/DSL semantic binding is incompatible with the fixed hall benchmark');
  }
}

async function verifyLiveEvidenceFileBindings(runtimeEvidence) {
  const sourceHash = await sha256RegularFile(runtimeEvidence.source_model?.path, 'source model');
  if (sourceHash !== runtimeEvidence.source_model?.sha256) throw new Error('Runtime evidence source model hash mismatch');
  if (runtimeEvidence.saved_model) {
    const savedHash = await sha256RegularFile(runtimeEvidence.saved_model.path, 'saved model');
    if (savedHash !== runtimeEvidence.saved_model.sha256) throw new Error('Runtime evidence saved model hash mismatch');
  }
  const stepCaptures = (runtimeEvidence.steps || []).filter((step) => step.kind === 'capture_view');
  for (const capture of runtimeEvidence.captures || []) {
    const captureHash = await sha256RegularFile(capture.path, `${capture.view} capture`);
    if (captureHash !== capture.sha256) throw new Error(`Runtime evidence ${capture.view} capture hash mismatch`);
    const step = stepCaptures.find((item) => item.view === capture.view);
    if (!step || step.path !== capture.path || step.sha256 !== capture.sha256
      || step.server_visual_capture !== true || step.read_only_attestation_verified !== true) {
      throw new Error(`Runtime evidence ${capture.view} capture step binding mismatch`);
    }
  }
}

async function validateFullBundleSchemas(documents) {
  const schemas = {
    asset_set: 'schema/image-modeling/asset-set.schema.json',
    observations: 'schema/image-modeling/image-set-observation.schema.json',
    candidate_graph: 'schema/image-modeling/candidate-graph.schema.json',
    mcp_brief: 'schema/image-modeling/mcp-modeling-brief.schema.json',
    promotion_review: 'schema/image-modeling/candidate-promotion-review.schema.json',
    promotion_patch: 'schema/image-modeling/candidate-promotion-patch.schema.json',
    part_graph: 'schema/part-graph.schema.json',
    profile: 'schema/product-profile.schema.json'
  };
  for (const [key, schemaPath] of Object.entries(schemas)) {
    const schema = await readJson(schemaPath);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    if (!validate(documents[key])) {
      throw new Error(`Full benchmark ${key} failed schema validation: ${JSON.stringify(validate.errors)}`);
    }
  }
}

async function readRepoJsonPath(filePath, label) {
  const { absolutePath, bytes } = await readRepoRegularFile(filePath, label);
  return { absolutePath, document: parseJson(bytes, label) };
}

async function readRepoRegularFile(filePath, label) {
  const absolutePath = resolveRepoArtifactPath(filePath, label);
  await assertNoRepoSymlinkComponents(absolutePath);
  const lexicalStat = await fs.lstat(absolutePath);
  if (!lexicalStat.isFile() || lexicalStat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  let handle;
  try {
    handle = await fs.open(absolutePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    const openedStat = await handle.stat();
    if (!sameFileSnapshot(openedStat, lexicalStat) || openedStat.size > 32 * 1024 * 1024) {
      throw new Error(`${label} is unsafe or exceeds the JSON artifact size limit`);
    }
    const bytes = await handle.readFile();
    const [finalOpenedStat, finalLexicalStat] = await Promise.all([handle.stat(), fs.lstat(absolutePath)]);
    if (!sameFileSnapshot(openedStat, finalOpenedStat) || !sameFileSnapshot(openedStat, finalLexicalStat)) {
      throw new Error(`${label} changed while being read`);
    }
    return { absolutePath, bytes };
  } finally {
    await handle?.close();
  }
}

async function sha256RegularFile(filePath, label) {
  if (!filePath) throw new Error(`${label} path is missing`);
  const absolutePath = path.resolve(filePath);
  const lexicalStat = await fs.lstat(absolutePath);
  if (!lexicalStat.isFile() || lexicalStat.isSymbolicLink() || lexicalStat.size > 2 * 1024 * 1024 * 1024) {
    throw new Error(`${label} must be a bounded regular non-symlink file`);
  }
  let handle;
  try {
    handle = await fs.open(absolutePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    const openedStat = await handle.stat();
    if (!sameFileSnapshot(openedStat, lexicalStat)) throw new Error(`${label} changed before hashing`);
    const digest = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < openedStat.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, openedStat.size - position), position);
      if (bytesRead < 1) throw new Error(`${label} changed while hashing`);
      digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const [finalOpenedStat, finalLexicalStat] = await Promise.all([handle.stat(), fs.lstat(absolutePath)]);
    if (!sameFileSnapshot(openedStat, finalOpenedStat) || !sameFileSnapshot(openedStat, finalLexicalStat)) {
      throw new Error(`${label} changed while hashing`);
    }
    return `sha256:${digest.digest('hex')}`;
  } finally {
    await handle?.close();
  }
}

function resolveRepoArtifactPath(filePath, label) {
  if (!filePath) throw new Error(`${label} path is missing`);
  const absolutePath = path.resolve(repoRoot, filePath);
  const relativePath = path.relative(repoRoot, absolutePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`${label} leaves the repository`);
  }
  return absolutePath;
}

async function assertNoRepoSymlinkComponents(absolutePath) {
  const relative = path.relative(repoRoot, absolutePath);
  let cursor = repoRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const stat = await fs.lstat(cursor);
    if (stat.isSymbolicLink()) throw new Error(`Runtime artifact path crosses a symlink: ${cursor}`);
  }
}

function sameFileSnapshot(left, right) {
  return left.isFile() && right.isFile()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function nonInterpretationVariant(partGraph, sourceMode) {
  const next = structuredClone(partGraph);
  next.source_mode = sourceMode;
  delete next.provenance;
  delete next.content_signature;
  return next;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runtimeEvidence = options.runtimeEvidencePath
    ? (await readRepoJsonPath(options.runtimeEvidencePath, 'runtime evidence report')).document
    : null;
  const trustedCompileReceiptPublicKeyPem = options.trustedCompileReceiptPublicKeyPath
    ? await readTrustedCompileReceiptPublicKey(options.trustedCompileReceiptPublicKeyPath)
    : null;
  const report = await runImageStructuredMainBenchmark({
    outputDir: options.outputDir,
    runtimeEvidence,
    trustedCompileReceiptPublicKeyPem
  });
  process.stdout.write(`${JSON.stringify({
    ok: report.methods.length >= 3,
    output: path.resolve(repoRoot, options.outputDir, 'image-structured-main-benchmark-report.json'),
    live_status: report.live_status,
    verdict: report.verdict,
    release_ready: report.release_ready
  }, null, 2)}\n`);
}

function parseArgs(argv) {
  const options = { outputDir: 'output/image-structured-main-benchmark' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--output-dir') options.outputDir = argv[++index];
    else if (argv[index] === '--runtime-evidence') options.runtimeEvidencePath = argv[++index];
    else if (argv[index] === '--trusted-compile-receipt-public-key') options.trustedCompileReceiptPublicKeyPath = argv[++index];
    else if (argv[index] === '--help' || argv[index] === '-h') {
      process.stdout.write('Usage: node scripts/run-image-structured-main-benchmark.mjs [--output-dir <path>] [--runtime-evidence <semantic-live-gate-report.json>] [--trusted-compile-receipt-public-key <ed25519-public-key.pem>]\n');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
