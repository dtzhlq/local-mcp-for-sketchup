#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareExternalBenchmarkSamplePackage, runExternalBenchmarkAdapter } from './lib/external-benchmark-adapter.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const DEFAULT_MANIFEST = 'projects/image-structured-modeler/benchmarks/tier1-external-sample-manifest.json';

export async function prepareExternalBenchmarkSubset(options = {}) {
  const manifestPath = path.resolve(repoRoot, options.manifest || DEFAULT_MANIFEST);
  const benchmarkManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const sample = (benchmarkManifest.samples || []).find((item) => item.id === options.sampleId);
  if (!sample) throw new Error(`Unknown Tier1 sample id: ${options.sampleId}`);
  const packageDir = path.resolve(repoRoot, options.packageDir || sample.local_path);
  const prepared = await prepareExternalBenchmarkSamplePackage({ sample, packageDir, files: options.files, createdAt: options.createdAt });
  const adapterReport = await runExternalBenchmarkAdapter({ sample, packageDir });
  const reportPath = path.join(packageDir, 'adapter-preflight-report.json');
  await fs.writeFile(reportPath, `${JSON.stringify(adapterReport, null, 2)}\n`, 'utf8');
  return { sample, packageDir, packageManifest: prepared.packageManifest, packageManifestPath: prepared.output, adapterReport, adapterReportPath: reportPath };
}

function parseArgs(argv) {
  const options = { files: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--sample-id') options.sampleId = argv[++index];
    else if (arg === '--manifest') options.manifest = argv[++index];
    else if (arg === '--package-dir') options.packageDir = argv[++index];
    else if (arg === '--created-at') options.createdAt = argv[++index];
    else if (arg === '--file') {
      const [role, ...pathParts] = String(argv[++index] || '').split('=');
      if (!role || !pathParts.length) throw new Error('--file requires role=relative/path');
      options.files[role] = pathParts.join('=');
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.sampleId) throw new Error('--sample-id is required');
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareExternalBenchmarkSubset(parseArgs(process.argv.slice(2)))
    .then((result) => process.stdout.write(`${JSON.stringify({
      ok: result.adapterReport.status === 'ready_for_evidence_review',
      sample_id: result.sample.id,
      package_manifest: result.packageManifestPath,
      adapter_report: result.adapterReportPath,
      status: result.adapterReport.status
    }, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exit(1);
    });
}
