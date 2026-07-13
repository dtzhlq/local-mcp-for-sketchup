#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const DEFAULT_SAMPLE = 'projects/image-structured-modeler/examples/building-single-london-corner/sample.json';

export async function prepareFacadeDraftingStudySample({ sample = DEFAULT_SAMPLE, force = false } = {}) {
  const samplePath = path.resolve(repoRoot, sample);
  const config = JSON.parse(await fs.readFile(samplePath, 'utf8'));
  if (config.kind !== 'facade_drafting_study_sample_v1') {
    throw new Error(`Unsupported facade sample contract: ${config.kind || 'missing kind'}`);
  }
  const targetPath = path.resolve(repoRoot, config.source.local_path);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  let buffer = null;
  let reused = false;
  if (!force) {
    try {
      buffer = await fs.readFile(targetPath);
      reused = sha256(buffer) === config.source.sha256;
    } catch {
      buffer = null;
    }
  }
  if (!reused) {
    const response = await fetch(config.source.download_url, {
      headers: { 'user-agent': 'image-structured-modeler-facade-adapter/1.0' },
      signal: AbortSignal.timeout(60000)
    });
    if (!response.ok) throw new Error(`Facade sample download failed: HTTP ${response.status}`);
    buffer = Buffer.from(await response.arrayBuffer());
    const actual = sha256(buffer);
    if (actual !== config.source.sha256) {
      throw new Error(`Facade sample checksum mismatch: expected ${config.source.sha256}, received ${actual}`);
    }
    await fs.writeFile(targetPath, buffer);
  }

  const report = {
    kind: 'facade_drafting_study_sample_preparation_report_v1',
    version: 1,
    sample_id: config.sample_id,
    status: reused ? 'reused_verified_local_sample' : 'downloaded_and_verified',
    source_description_url: config.source.description_url,
    local_path: config.source.local_path,
    sha256: sha256(buffer),
    bytes: buffer.length,
    license: config.source.license,
    attribution: config.source.attribution,
    dataset_committed: false
  };
  const reportPath = path.resolve(
    repoRoot,
    'output/image-structured-modeler/dataset-preparation',
    `${config.sample_id}.json`
  );
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { config, targetPath, report, reportPath };
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--sample') options.sample = argv[++index];
    else if (arg === '--force') options.force = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareFacadeDraftingStudySample(parseArgs(process.argv.slice(2)))
    .then(({ report, reportPath }) => {
      process.stdout.write(`${JSON.stringify({ ok: true, ...report, report_path: reportPath }, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}
