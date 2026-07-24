#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_REAL_MODEL_RELIABILITY_SIDECAR_MANIFEST,
  loadRealModelReliabilitySidecars
} from '../src/real-model-reliability-sidecars.mjs';

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--manifest') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--manifest requires a workspace-relative JSON path.');
      options.manifestPath = value;
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      process.stdout.write([
        'Usage:',
        `  node scripts/validate-real-model-reliability-sidecars.mjs [--manifest ${DEFAULT_REAL_MODEL_RELIABILITY_SIDECAR_MANIFEST}]`,
        '',
        'This validator reads hash-bound JSON only. It never opens or copies SKP files, imports queue transport,',
        'authorizes a mutation, or upgrades readiness evidence into a live *.reliability.json contract.',
        ''
      ].join('\n'));
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  loadRealModelReliabilitySidecars(parseArgs(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${String(error?.message || error)}\n`);
      process.exitCode = 1;
    });
}
