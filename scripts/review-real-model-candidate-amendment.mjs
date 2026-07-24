#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  buildRealModelCandidateReviewAggregate,
  verifyRealModelCandidateReviewAmendmentBindings
} from '../src/real-model-candidate-review-amendment.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaults = Object.freeze({
  amendment: 'docs/evidence/real-model-candidate-semantic-mapping-amendment-2026-07-20.json',
  outputDir: 'output/real-model-reliability/review-amendment'
});

function parseArgs(argv) {
  const options = {};
  const takeValue = (index, name) => {
    const value = argv[index + 1];
    if (value === undefined || value === '' || value.startsWith('--')) throw new Error(`${name} requires a value.`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--amendment') options.amendment = takeValue(index++, arg);
    else if (arg === '--output-dir') options.outputDir = takeValue(index++, arg);
    else if (arg === '--help' || arg === '-h') return usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  process.stdout.write([
    'Usage:',
    `  node scripts/review-real-model-candidate-amendment.mjs [--amendment ${defaults.amendment}] [--output-dir ${defaults.outputDir}]`,
    '',
    'This command is offline-only. It verifies every amendment binding and derives a conservative 6-candidate / 7-case aggregate.',
    'It never calls SketchUp, confirms target roles, writes a formal reliability sidecar, or grants release acceptance.',
    ''
  ].join('\n'));
  process.exit(0);
}

async function run(options = {}, internal = {}) {
  const evidenceRoot = path.resolve(internal.rootDir || repoRoot);
  const amendmentPath = resolveWithinRoot(evidenceRoot, options.amendment || defaults.amendment);
  const outputDir = resolveWithinRoot(evidenceRoot, options.outputDir || defaults.outputDir);
  const amendment = JSON.parse(await fs.readFile(amendmentPath, 'utf8'));
  await validate(amendment, path.join(repoRoot, 'schema/real-model-candidate-semantic-mapping-amendment-v1.schema.json'), 'semantic mapping amendment');
  const bound = await verifyRealModelCandidateReviewAmendmentBindings({ amendment, rootDir: evidenceRoot });
  const aggregate = buildRealModelCandidateReviewAggregate({
    amendment,
    baseMapping: bound.base_mapping,
    baseInventory: bound.base_inventory,
    baseProfile: bound.base_profile,
    baseLiveEvidence: bound.base_live_evidence,
    manifest: bound.formal_manifest,
    candidateInventory: bound.candidate_inventory,
    targetReview: bound.target_review
  });
  await validate(aggregate, path.join(repoRoot, 'schema/real-model-candidate-review-aggregate-v1.schema.json'), 'candidate review aggregate');
  await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
  const jsonPath = path.join(outputDir, 'real-model-candidate-review-aggregate.v1.json');
  const markdownPath = path.join(outputDir, 'real-model-candidate-review-aggregate.v1.md');
  await writeAtomic(jsonPath, `${JSON.stringify(aggregate, null, 2)}\n`);
  await writeAtomic(markdownPath, renderMarkdown(aggregate));
  return { aggregate, jsonPath, markdownPath };
}

function renderMarkdown(report) {
  const product = report.case_reviews.find((entry) => entry.case_id === 'product-boolean-manifold');
  return [
    '# Real-model candidate review aggregate v1',
    '',
    `- Confirmed candidates: ${report.summary.confirmed_candidates} / ${report.summary.candidates}`,
    `- Semantically mapped formal cases: ${report.summary.semantically_mapped_cases} / ${report.summary.formal_cases}`,
    `- Formal sidecars ready: ${report.summary.formal_sidecars_ready} / ${report.summary.formal_cases}`,
    `- Target roles confirmed: ${report.target_review.target_roles_confirmed}`,
    `- Release acceptance: ${report.safety.release_acceptance}`,
    '',
    '## Product case blockers',
    '',
    ...(product?.blockers || []).map((entry) => `- ${entry}`),
    '',
    'The Trimble S6 mapping is user-confirmed semantic routing only. Read-only target suggestions are non-authoritative and no model mutation, approval token, formal sidecar, or release acceptance is implied.',
    ''
  ].join('\n');
}

function resolveWithinRoot(root, value) {
  const resolved = path.resolve(root, String(value));
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Configured path must stay inside the repository.');
  return resolved;
}

async function validate(value, schemaPath, label) {
  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const validateValue = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
  if (!validateValue(value)) throw new Error(`${label} schema validation failed: ${JSON.stringify(validateValue.errors)}`);
}

async function writeAtomic(targetPath, contents) {
  const temporaryPath = `${targetPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.rename(temporaryPath, targetPath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  run(parseArgs(process.argv.slice(2)))
    .then(({ aggregate, jsonPath, markdownPath }) => {
      process.stdout.write(`${JSON.stringify({
        ok: true,
        live_queue_called: false,
        confirmed_candidates: aggregate.summary.confirmed_candidates,
        semantically_mapped_cases: aggregate.summary.semantically_mapped_cases,
        formal_sidecars_ready: aggregate.summary.formal_sidecars_ready,
        target_roles_confirmed: aggregate.target_review.target_roles_confirmed,
        release_acceptance: aggregate.safety.release_acceptance,
        json_path: jsonPath,
        markdown_path: markdownPath
      }, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${String(error?.message || error)}\n`);
      process.exitCode = 1;
    });
}

export { run as runRealModelCandidateAmendmentReview };
