#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_REAL_MODEL_CANDIDATE_OUTPUT,
  DEFAULT_REAL_MODEL_CANDIDATE_ROOT,
  runRealModelCandidateIntake,
  sanitizeCandidateError
} from '../src/real-model-candidate-intake.mjs';

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
    else if (arg === '--max-file-bytes') options.maxFileBytes = Number(takeValue(index++, arg));
    else if (arg === '--recursive-limit') options.recursiveLimit = Number(takeValue(index++, arg));
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
    `  node scripts/intake-real-model-corpus.mjs [--runtime offline] [--input-root "${DEFAULT_REAL_MODEL_CANDIDATE_ROOT}"] [--output-dir ${DEFAULT_REAL_MODEL_CANDIDATE_OUTPUT}]`,
    '  node scripts/intake-real-model-corpus.mjs --runtime queue --queue-required --input-root /path/to/models --cross-version-status deferred_by_user [--timeout-ms 240000]',
    '',
    'The default offline mode hashes and inventories regular .skp files only. It never calls the SketchUp queue.',
    'Queue mode preflights all files, opens disposable copies, and performs read-only structural profiling. It does not save or edit models.',
    ''
  ].join('\n'));
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runRealModelCandidateIntake(parseArgs(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        ok: result.ok,
        runtime: result.runtime,
        live_queue_called: result.live_queue_called,
        candidates: result.inventory.summary.candidate_count,
        inventory_path: result.inventory_path,
        profile_path: result.profile_path,
        profile_summary: result.profile?.summary || null
      }, null, 2)}\n`);
      if (!result.ok) process.exitCode = 1;
    })
    .catch((error) => {
      process.stderr.write(`${sanitizeCandidateError(error)}\n`);
      process.exitCode = 1;
    });
}
