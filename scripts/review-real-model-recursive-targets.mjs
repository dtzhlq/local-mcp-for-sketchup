#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runRealModelRecursiveTargetReview,
  runRealModelRecursiveTargetReviewV3
} from '../src/real-model-recursive-target-review.mjs';

function parseArgs(argv) {
  const options = {};
  const takeValue = (index, name) => {
    const value = argv[index + 1];
    if (value === undefined || value === '' || value.startsWith('--')) throw new Error(`${name} requires a value.`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--adoption-file') options.adoptionFile = takeValue(index++, arg);
    else if (arg === '--source-sha256') options.sourceSha256 = takeValue(index++, arg);
    else if (arg === '--model-revision') options.modelRevision = takeValue(index++, arg);
    else if (arg === '--contract-version') options.contractVersion = takeValue(index++, arg);
    else if (arg === '--case-id') options.caseId = takeValue(index++, arg);
    else if (arg === '--boolean-operations-sha256') options.booleanOperationsSha256 = takeValue(index++, arg);
    else if (arg === '--model-revision-source-sha256') options.modelRevisionSourceSha256 = takeValue(index++, arg);
    else if (arg === '--negative-trial-file') options.negativeAtomicTrialFile = takeValue(index++, arg);
    else if (arg === '--output') options.output = takeValue(index++, arg);
    else if (arg === '--help' || arg === '-h') return usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  for (const [name, value] of Object.entries({
    '--adoption-file': options.adoptionFile,
    '--source-sha256': options.sourceSha256,
    '--model-revision': options.modelRevision,
    '--output': options.output
  })) {
    if (!value) throw new Error(`${name} is required.`);
  }
  options.contractVersion ||= 'v2';
  if (options.contractVersion !== 'v2' && options.contractVersion !== 'v3') {
    throw new Error('--contract-version must be v2 or v3.');
  }
  if (options.contractVersion === 'v3') {
    for (const [name, value] of Object.entries({
      '--case-id': options.caseId,
      '--boolean-operations-sha256': options.booleanOperationsSha256,
      '--model-revision-source-sha256': options.modelRevisionSourceSha256
    })) {
      if (!value) throw new Error(`${name} is required for --contract-version v3.`);
    }
  }
  return options;
}

function usage() {
  process.stdout.write([
    'Usage:',
    '  node scripts/review-real-model-recursive-targets.mjs --adoption-file <adoption.json> --source-sha256 <sha256:...> --model-revision <sha256:...> --output <review.json>',
    '  node scripts/review-real-model-recursive-targets.mjs --contract-version v3 --adoption-file <adoption.json> --source-sha256 <sha256:...> --model-revision <sha256:...> --case-id <id> --boolean-operations-sha256 <sha256:...> --model-revision-source-sha256 <sha256:...> [--negative-trial-file <lineage.json>] --output <review.json>',
    '',
    'This command is always offline. It reads one adoption artifact and writes one analysis-only review.',
    'It never reads or writes SketchUp queue state and never opens or mutates a model.',
    ''
  ].join('\n'));
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  const runner = options.contractVersion === 'v3'
    ? runRealModelRecursiveTargetReviewV3
    : runRealModelRecursiveTargetReview;
  const runOptions = options.contractVersion === 'v3'
    ? {
      adoptionFile: options.adoptionFile,
      sourceSha256: options.sourceSha256,
      modelRevision: options.modelRevision,
      caseId: options.caseId,
      runtimeSourceHashes: {
        boolean_operations_sha256: options.booleanOperationsSha256,
        model_revision_source_sha256: options.modelRevisionSourceSha256
      },
      negativeAtomicTrialFile: options.negativeAtomicTrialFile,
      output: options.output
    }
    : options;
  runner(runOptions)
    .then((result) => {
      const isV3 = result.review.version === 'real-model-recursive-target-review.v3';
      const recommended = result.review.review.recommended_proposal;
      process.stdout.write(`${JSON.stringify({
        ok: result.ok,
        version: result.review.version,
        runtime: result.runtime,
        live_queue_called: result.live_queue_called,
        output_path: result.output_path,
        status: result.review.review.status,
        candidates: isV3
          ? result.review.geometry_attestations.length
          : result.review.review.candidate_count,
        pair_evaluations: isV3
          ? result.review.review.pair_decisions.length
          : result.review.review.pair_evaluations_considered,
        manifold_probe_paths: isV3
          ? result.review.base_review.review.manifold_probe_paths
          : result.review.review.manifold_probe_paths,
        recommended_proposal: recommended
          ? {
            operation: recommended.operation,
            target: isV3 ? recommended.target_path : recommended.target.occurrence_path,
            tool: isV3 ? recommended.tool_path : recommended.tool.occurrence_path,
            status: recommended.status,
            authorized: recommended.authorized
          }
          : null,
        runtime_delta_requires_review: isV3
          ? result.review.next_action.runtime_delta_requires_review
          : false,
        negative_source_evidence_bytes_verified: isV3
          ? result.review.safety.negative_source_evidence_bytes_verified
          : false,
        blockers: result.review.review.blockers
      }, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${sanitizeError(error)}\n`);
      process.exitCode = 1;
    });
}

function sanitizeError(error) {
  return String(error?.message || error || 'Unknown error')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 2_000);
}
