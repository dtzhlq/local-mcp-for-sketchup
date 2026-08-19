#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePartGraphToSketchUpDsl } from '../src/product-modeling/part-graph-compiler.mjs';
import { validatePartGraphSemanticContract } from '../src/product-modeling/semantic-contract-qa.mjs';
import {
  buildTraditionalHallSemanticFixture,
  traditionalHallProfile
} from '../test/fixtures/traditional-hall-semantic-fixture.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

export async function prepareTraditionalHallRuntimeLiveFixture({
  outputDir = 'output/image-structured-runtime-live-fixture',
  includeNativeMeshCheck = true
} = {}) {
  const absoluteOutputDir = path.resolve(repoRoot, outputDir);
  const relativeOutput = path.relative(repoRoot, absoluteOutputDir);
  if (relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) {
    throw new Error('Runtime fixture output directory must stay inside the repository');
  }
  await fs.mkdir(absoluteOutputDir, { recursive: true });
  const fixtureDir = path.join(absoluteOutputDir, `fixture-${timestampId()}-${includeNativeMeshCheck ? 'native-mesh' : 'four-truths'}`);
  await fs.mkdir(fixtureDir, { recursive: false, mode: 0o700 });

  const partGraph = buildTraditionalHallSemanticFixture();
  partGraph.id = `${partGraph.id}-${includeNativeMeshCheck ? 'native-mesh' : 'four-truths-runtime'}`;
  partGraph.semantic_contract.id = `${partGraph.semantic_contract.id}-${includeNativeMeshCheck ? 'native-mesh' : 'four-truths-runtime'}`;
  if (!includeNativeMeshCheck) {
    partGraph.parts = partGraph.parts.filter((part) => part.role !== 'roof_shell');
    partGraph.semantic_contract.assertions = partGraph.semantic_contract.assertions.filter((assertion) => assertion.type !== 'mesh_integrity');
  }
  const dsl = compilePartGraphToSketchUpDsl(partGraph, traditionalHallProfile(), { repoRoot });
  const semanticValidation = validatePartGraphSemanticContract(partGraph, { phase: 'postcompile', dsl });
  if (!semanticValidation.ok) {
    throw new Error(`Prepared runtime fixture failed semantic validation: ${semanticValidation.issues.map((issue) => issue.id).join(', ')}`);
  }
  if (partGraph.source_mode !== 'manual_authored' || dsl.metadata?.interpretation_eligible !== false) {
    throw new Error('Runtime fixture must remain manual_authored and excluded from image interpretation accuracy');
  }

  const partGraphPath = path.join(fixtureDir, 'part-graph.runtime-only.json');
  const dslPath = path.join(fixtureDir, 'safe-dsl.runtime-only.json');
  const partGraphBytes = `${JSON.stringify(partGraph, null, 2)}\n`;
  const dslBytes = `${JSON.stringify(dsl, null, 2)}\n`;
  await Promise.all([
    fs.writeFile(partGraphPath, partGraphBytes, { encoding: 'utf8', flag: 'wx', mode: 0o600 }),
    fs.writeFile(dslPath, dslBytes, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  ]);
  const manifest = {
    version: 1,
    kind: 'traditional_hall_runtime_live_fixture_manifest',
    claim_scope: 'semantic_runtime_only',
    source_mode: partGraph.source_mode,
    interpretation: {
      status: 'excluded',
      eligible: false,
      score: null,
      reason: 'manual_ground_truth_contract_fixture_not_image_interpretation'
    },
    structure: {
      semantic_contract_id: partGraph.semantic_contract.id,
      assertion_count: partGraph.semantic_contract.assertions.length,
      four_user_truths_in_scope: true,
      native_mesh_check_in_scope: includeNativeMeshCheck,
      validation_ok: semanticValidation.ok,
      semantic_digest: semanticValidation.semantic_digest
    },
    artifacts: {
      part_graph: { path: partGraphPath, sha256: sha256Bytes(partGraphBytes) },
      safe_json_dsl: { path: dslPath, sha256: sha256Bytes(dslBytes) }
    },
    release_ready: false
  };
  const manifestPath = path.join(fixtureDir, 'fixture-manifest.json');
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return { fixtureDir, partGraphPath, dslPath, manifestPath, manifest };
}

function sha256Bytes(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function timestampId() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--output-dir') options.outputDir = argv[++index];
    else if (argv[index] === '--exclude-native-mesh-check') options.includeNativeMeshCheck = false;
    else if (argv[index] === '--help' || argv[index] === '-h') {
      process.stdout.write('Usage: node scripts/prepare-traditional-hall-runtime-live-fixture.mjs [--output-dir <path>] [--exclude-native-mesh-check]\n');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  prepareTraditionalHallRuntimeLiveFixture(parseArgs(process.argv.slice(2))).then((result) => {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      fixture_dir: result.fixtureDir,
      part_graph: result.partGraphPath,
      dsl: result.dslPath,
      manifest: result.manifestPath,
      claim_scope: result.manifest.claim_scope,
      interpretation_status: result.manifest.interpretation.status,
      native_mesh_check_in_scope: result.manifest.structure.native_mesh_check_in_scope,
      release_ready: false
    }, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
