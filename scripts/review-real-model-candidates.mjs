import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  buildRealModelCandidateReview,
  renderRealModelCandidateReviewMarkdown,
  verifyRealModelCandidateReviewBindings
} from '../src/real-model-candidate-review.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = parseArgs(process.argv.slice(2));
const mappingPath = path.resolve(repoRoot, options.mappingFile);
const mapping = JSON.parse(await fs.readFile(mappingPath, 'utf8'));
const [mappingSchema, reportSchema] = await Promise.all([
  readJson('schema/real-model-candidate-semantic-mapping-v1.schema.json'),
  readJson('schema/real-model-candidate-review-report-v1.schema.json')
]);
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
ajv.addSchema(mappingSchema);
assertValid(ajv.compile(mappingSchema), mapping, 'semantic mapping');
const documents = await verifyRealModelCandidateReviewBindings({ mapping, rootDir: repoRoot });
const report = buildRealModelCandidateReview({
  mapping,
  inventory: documents.inventory,
  profile: documents.profile,
  liveEvidence: documents.live_evidence,
  manifest: documents.formal_manifest
});
assertValid(ajv.compile(reportSchema), report, 'candidate review report');

const outputDir = path.resolve(repoRoot, options.outputDir);
await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
const jsonPath = path.join(outputDir, 'real-model-candidate-review-report.v1.json');
const markdownPath = path.join(outputDir, 'real-model-candidate-review-report.v1.md');
await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
await fs.writeFile(markdownPath, renderRealModelCandidateReviewMarkdown(report), { encoding: 'utf8', mode: 0o600 });
process.stdout.write(`${JSON.stringify({
  ok: true,
  runtime: 'offline',
  live_queue_called: false,
  candidates: report.summary.candidates,
  semantically_mapped_cases: report.summary.semantically_mapped_cases,
  formal_cases: report.summary.formal_cases,
  formal_sidecars_ready: report.summary.formal_sidecars_ready,
  release_acceptance: report.safety.release_acceptance,
  output: {
    json: path.relative(repoRoot, jsonPath),
    markdown: path.relative(repoRoot, markdownPath)
  }
}, null, 2)}\n`);

function parseArgs(args) {
  const result = {
    mappingFile: 'docs/evidence/real-model-candidate-semantic-mapping-2026-07-20.json',
    outputDir: 'output/real-model-reliability/review'
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--mapping-file') result.mappingFile = take(args, ++index, arg);
    else if (arg === '--output-dir') result.outputDir = take(args, ++index, arg);
    else if (arg === '--help') {
      process.stdout.write('Usage: node scripts/review-real-model-candidates.mjs [--mapping-file path] [--output-dir path]\n');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function take(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
}

function assertValid(validate, value, label) {
  if (!validate(value)) throw new Error(`${label} failed schema validation: ${JSON.stringify(validate.errors)}`);
}
