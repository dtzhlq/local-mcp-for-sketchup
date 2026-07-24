#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_REAL_MODEL_RELIABILITY_PLAN_OUTPUT_ROOT,
  REAL_MODEL_RELIABILITY_PLAN_FILE,
  hashRealModelReliabilityFileBytes,
  prepareRealModelReliabilityExecutionPlan
} from '../src/real-model-reliability-plan.mjs';

const REQUEST_VERSION = 'real-model-reliability-plan-request.v1';
const REQUEST_KEYS = new Set([
  'version', 'case_id', 'candidate_id', 'evidence', 'model_revision',
  'server_recommended_proposal', 'allowed_output_root'
]);
const EVIDENCE_KEYS = Object.freeze([
  'candidate_inventory', 'semantic_mapping', 'target_review', 'recursive_review'
]);
const REVISION_KEYS = new Set([
  'strategy', 'hash', 'complete', 'unique_entity_limit', 'unique_entities',
  'reachable_definitions', 'logical_occurrences', 'document_id', 'model_identity_sha256',
  'model_revision_source_sha256', 'model_modified'
]);

export async function runPrepareRealModelReliabilityCase({ request, outputDir } = {}) {
  const workspaceRoot = await fs.realpath(process.cwd());
  const requestEntry = await readWorkspaceJson({ workspaceRoot, relativePath: request, label: 'request' });
  const document = requestEntry.document;
  assertExactObjectKeys(document, REQUEST_KEYS, 'request');
  assert(document.version === REQUEST_VERSION, `request.version must be ${REQUEST_VERSION}`);
  assert(document.case_id === 'product-boolean-manifold', 'request.case_id must be product-boolean-manifold');
  assert(/^candidate_[0-9a-f]{24}$/.test(String(document.candidate_id || '')), 'request.candidate_id is invalid');
  assertExactObjectKeys(document.evidence, new Set(EVIDENCE_KEYS), 'request.evidence');
  assertExactObjectKeys(document.model_revision, REVISION_KEYS, 'request.model_revision');

  const loaded = {};
  const evidenceBindings = {};
  for (const key of EVIDENCE_KEYS) {
    const entry = await readWorkspaceJson({
      workspaceRoot,
      relativePath: document.evidence[key],
      label: `request.evidence.${key}`
    });
    loaded[key] = entry.document;
    evidenceBindings[key] = {
      path: entry.relativePath,
      sha256: hashRealModelReliabilityFileBytes(entry.bytes)
    };
  }

  const plan = await prepareRealModelReliabilityExecutionPlan({
    candidateInventory: loaded.candidate_inventory,
    candidateId: document.candidate_id,
    semanticMapping: loaded.semantic_mapping,
    targetReview: loaded.target_review,
    recursiveReview: loaded.recursive_review,
    evidenceBindings,
    modelRevision: document.model_revision,
    ...(Object.hasOwn(document, 'server_recommended_proposal')
      ? { serverRecommendedProposal: document.server_recommended_proposal }
      : {}),
    allowedOutputRoot: document.allowed_output_root || DEFAULT_REAL_MODEL_RELIABILITY_PLAN_OUTPUT_ROOT
  });

  const allowedRootRelative = normalizeWorkspaceRelativePath(
    plan.execution_scope.allowed_output_root,
    'allowed_output_root'
  );
  const outputRelative = normalizeWorkspaceRelativePath(outputDir || allowedRootRelative, 'outputDir');
  assert(isWithinRelativeRoot(allowedRootRelative, outputRelative),
    'outputDir must be within the plan allowed_output_root');
  const allowedRoot = path.resolve(workspaceRoot, allowedRootRelative);
  const targetDirectory = path.resolve(workspaceRoot, outputRelative);
  assert(isPathInside(workspaceRoot, allowedRoot), 'allowed_output_root escapes the workspace');
  assert(isPathInside(allowedRoot, targetDirectory), 'outputDir escapes allowed_output_root');
  await fs.mkdir(targetDirectory, { recursive: true, mode: 0o700 });
  const realTargetDirectory = await fs.realpath(targetDirectory);
  assert(isPathInside(workspaceRoot, realTargetDirectory), 'outputDir resolves outside the workspace');
  assert(isPathInside(await fs.realpath(allowedRoot), realTargetDirectory),
    'outputDir resolves outside allowed_output_root');
  const outputPath = path.join(realTargetDirectory, REAL_MODEL_RELIABILITY_PLAN_FILE);
  await writeJsonAtomic(outputPath, plan);
  return {
    ok: true,
    runtime: 'offline',
    live_queue_called: false,
    mutation_authorized: false,
    release_acceptance: false,
    plan,
    output_path: outputPath
  };
}

function parseArgs(argv) {
  const options = {};
  const takeValue = (index, name) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--request') options.request = takeValue(index++, argument);
    else if (argument === '--output-dir') options.outputDir = takeValue(index++, argument);
    else if (argument === '--help' || argument === '-h') return usage();
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.request) throw new Error('--request is required.');
  return options;
}

function usage() {
  process.stdout.write([
    'Usage:',
    '  node scripts/prepare-real-model-reliability-case.mjs --request <workspace-relative-request.json> [--output-dir <workspace-relative-output-dir>]',
    '',
    'This command is offline and prepare-only. It reads hash-bound JSON evidence and writes one staged S3 plan.',
    'It does not import a queue runtime, contact SketchUp, authorize mutation, store credentials, or grant release acceptance.',
    ''
  ].join('\n'));
  process.exit(0);
}

async function readWorkspaceJson({ workspaceRoot, relativePath, label }) {
  const normalized = normalizeWorkspaceRelativePath(relativePath, label);
  const lexicalPath = path.resolve(workspaceRoot, normalized);
  assert(isPathInside(workspaceRoot, lexicalPath), `${label} escapes the workspace`);
  const stat = await fs.lstat(lexicalPath);
  assert(stat.isFile() && !stat.isSymbolicLink(), `${label} must be a regular non-symbolic-link JSON file`);
  const realPath = await fs.realpath(lexicalPath);
  assert(isPathInside(workspaceRoot, realPath), `${label} resolves outside the workspace`);
  const bytes = await fs.readFile(realPath);
  let document;
  try {
    document = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  return { document, bytes, relativePath: normalized, realPath };
}

function normalizeWorkspaceRelativePath(value, label) {
  assert(typeof value === 'string' && value.length > 0 && value.length <= 500, `${label} is invalid`);
  assert(!path.posix.isAbsolute(value) && !path.win32.isAbsolute(value), `${label} must be workspace-relative`);
  assert(!value.includes('\\') && !value.includes('\u0000'), `${label} is invalid`);
  const segments = value.split('/');
  assert(segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..'),
    `${label} cannot contain traversal or empty segments`);
  const normalized = path.posix.normalize(value);
  assert(normalized === value, `${label} must be normalized`);
  return normalized;
}

function assertExactObjectKeys(value, expected, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  for (const key of Object.keys(value)) assert(expected.has(key), `${label} contains unsupported field ${key}`);
  for (const key of expected) {
    if (label === 'request' && key === 'server_recommended_proposal') continue;
    assert(Object.hasOwn(value, key), `${label}.${key} is required`);
  }
}

function isWithinRelativeRoot(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function writeJsonAtomic(targetPath, value) {
  const temporaryPath = `${targetPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    });
    await fs.rename(temporaryPath, targetPath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(`Real-model reliability prepare CLI rejected: ${message}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runPrepareRealModelReliabilityCase(parseArgs(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        ok: result.ok,
        runtime: result.runtime,
        live_queue_called: result.live_queue_called,
        mutation_authorized: result.mutation_authorized,
        release_acceptance: result.release_acceptance,
        plan_id: result.plan.plan_id,
        preparation_status: result.plan.execution_scope.disposition,
        output_path: result.output_path
      }, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${String(error?.message || error)}\n`);
      process.exitCode = 1;
    });
}
