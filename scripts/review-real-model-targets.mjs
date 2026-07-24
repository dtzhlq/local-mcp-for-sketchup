#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_REAL_MODEL_TARGET_CANDIDATE,
  DEFAULT_REAL_MODEL_TARGET_REVIEW_OUTPUT,
  runRealModelTargetReview,
  sanitizeCandidateError
} from '../src/real-model-target-review.mjs';

function parseArgs(argv) {
  const options = {};
  const takeValue = (index, name) => {
    const value = argv[index + 1];
    if (value === undefined || value === '' || value.startsWith('--')) throw new Error(`${name} requires a value.`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--runtime') options.runtime = takeValue(index++, arg);
    else if (arg === '--queue-required') options.queueRequired = true;
    else if (arg === '--input-root') options.inputRoot = takeValue(index++, arg);
    else if (arg === '--output-dir') options.outputDir = takeValue(index++, arg);
    else if (arg === '--candidate') options.candidate = takeValue(index++, arg);
    else if (arg === '--case-id') options.caseId = takeValue(index++, arg);
    else if (arg === '--max-file-bytes') options.maxFileBytes = Number(takeValue(index++, arg));
    else if (arg === '--target-candidate-limit') options.targetCandidateLimit = Number(takeValue(index++, arg));
    else if (arg === '--timeout-ms') options.timeoutMs = Number(takeValue(index++, arg));
    else if (arg === '--cross-version-status') options.crossVersionStatus = takeValue(index++, arg);
    else if (arg === '--help' || arg === '-h') return usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  process.stdout.write([
    'Usage:',
    `  node scripts/review-real-model-targets.mjs [--runtime offline] [--candidate "${DEFAULT_REAL_MODEL_TARGET_CANDIDATE}"] [--output-dir ${DEFAULT_REAL_MODEL_TARGET_REVIEW_OUTPUT}]`,
    `  node scripts/review-real-model-targets.mjs --runtime queue --queue-required --candidate "${DEFAULT_REAL_MODEL_TARGET_CANDIDATE}" [--timeout-ms 240000]`,
    '',
    'Offline is the default. It performs stable intake and exact candidate selection without creating or reading queue state.',
    'Queue mode switches SketchUp to one disposable copy and performs one read-only adoption. It does not save, select, capture, or mutate model content.',
    'Target names/materials/tags are untrusted data. Pair suggestions are non-authoritative and cannot issue approval or target bindings.',
    ''
  ].join('\n'));
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runRealModelTargetReview(parseArgs(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        ok: result.ok,
        runtime: result.runtime,
        live_queue_called: result.live_queue_called,
        candidate_id: result.selected_candidate.candidate_id,
        source_sha256: result.selected_candidate.source.sha256,
        inventory_path: result.inventory_path,
        review_path: result.review_path,
        target_review: result.review
          ? {
            top_level_entities: result.review.structure.top_level_entities,
            returned_candidates: result.review.target_review.returned,
            pair_suggestions: result.review.target_review.pair_suggestions.length,
            target_roles_confirmed: result.review.target_review.target_roles_confirmed,
            formal_sidecar_ready: result.review.target_review.formal_sidecar_ready,
            blockers: result.review.target_review.blockers
          }
          : null
      }, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${sanitizeCandidateError(error)}\n`);
      process.exitCode = 1;
    });
}
