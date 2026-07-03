#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';

const DEFAULT_CODE_FILE = 'examples/python-sdk-official-api-expression-r3-fixture.py';
const DEFAULT_OUTPUT_FILE = 'output/python-sdk-official-api-expression-r3-mock.json';

const options = parseArgs(process.argv.slice(2));
const runtime = options.runtime || 'mock';
const timeoutMs = options.timeoutMs || (runtime === 'queue' ? 180000 : 20000);
const outputFile = options.outputFile || (runtime === 'queue' ? 'output/python-sdk-official-api-expression-r3-queue.json' : DEFAULT_OUTPUT_FILE);
const code = await fs.readFile(options.codeFile || DEFAULT_CODE_FILE, 'utf8');
const bridge = new SketchUpBridge();

const result = await bridge.evaluate_py({
  code,
  input_format: 'python_sdk',
  runtime,
  timeoutMs,
  pythonTimeoutMs: options.pythonTimeoutMs || 20000
});

await fs.mkdir(path.dirname(outputFile), { recursive: true });
await fs.writeFile(outputFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

let savedModel = null;
if (options.saveSkp) {
  const saved = await bridge.save_model({
    path: options.saveSkp,
    keep_session: true,
    runtime,
    timeoutMs
  });
  savedModel = saved.path || options.saveSkp;
}

const assertions = validateR3Result(result);
const summary = {
  ok: assertions.every((assertion) => assertion.ok),
  runtime,
  output_file: outputFile,
  saved_model: savedModel,
  operations: result.compiled?.python_sdk?.operations,
  totals: result.snapshot?.totals,
  warnings: result.snapshot?.warning_summary,
  selection: result.snapshot?.selection?.length || 0,
  scenes: result.snapshot?.scenes?.length || 0,
  assertions
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (!summary.ok) process.exitCode = 1;

function validateR3Result(result) {
  const snapshot = result.snapshot || {};
  const warnings = snapshot.warning_summary || {};
  const scene = snapshot.scenes?.[0] || {};
  const faceMin = result.runtime === 'queue' ? 10 : 16;
  const followme = snapshot.groups?.find((group) => {
    if (Array.isArray(group.geometry_input?.followme_realized) && group.geometry_input.followme_realized.length) return true;
    return group.id === 'sdk-r3-followme' && Number(group.bounding_box?.h) >= 38.1;
  });
  const uvFace = snapshot.groups?.find((group) => {
    if (Array.isArray(group.face_uvs) && group.face_uvs.some((entry) => entry.mapping?.length === 4)) return true;
    return Array.isArray(group.geometry_input?.faces) && group.geometry_input.faces.some((face) => face.position_material?.mapping?.length === 4);
  });
  const compiledResult = result.compiled?.result || {};
  return [
    assertEqual('compiled python sdk operations', result.compiled?.python_sdk?.operations, 12),
    assertEqual('snapshot groups', snapshot.totals?.groups, 5),
    assertAtLeast('snapshot faces', snapshot.totals?.faces, faceMin),
    assertEqual('warning total', warnings.total, 0),
    assertEqual('selection count', snapshot.selection?.length || 0, 1),
    assertEqual('scene count', snapshot.scenes?.length || 0, 1),
    assertEqual('scene transition_time', scene.transition_time, 1.5),
    assertTruthy('scene layer visibility', scene.layer_visibility?.length),
    assertTruthy('scene drawingelement visibility', scene.drawingelement_visibility?.length),
    assertTruthy('scene rendering options', scene.rendering_options?.edge_display_mode),
    assertEqual('scene shadow light', scene.shadow?.light, 60),
    assertTruthy('followme realized', followme),
    assertTruthy('face uv mapping', uvFace),
    assertEqual('result follow_ok', compiledResult.follow_ok, true),
    assertEqual('result texture_positioned', compiledResult.texture_positioned, true),
    assertEqual('result fill_ok', compiledResult.fill_ok, true)
  ];
}

function assertEqual(name, actual, expected) {
  return { name, ok: actual === expected, actual, expected };
}

function assertAtLeast(name, actual, expected_min) {
  return { name, ok: Number(actual) >= expected_min, actual, expected_min };
}

function assertTruthy(name, actual) {
  return { name, ok: Boolean(actual), actual: Boolean(actual) };
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--runtime') parsed.runtime = argv[++index];
    else if (arg === '--timeout-ms') parsed.timeoutMs = Number(argv[++index]);
    else if (arg === '--python-timeout-ms') parsed.pythonTimeoutMs = Number(argv[++index]);
    else if (arg === '--code-file') parsed.codeFile = argv[++index];
    else if (arg === '--output-file') parsed.outputFile = argv[++index];
    else if (arg === '--save-skp') parsed.saveSkp = argv[++index];
    else if (arg === '--help' || arg === '-h') usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function usage() {
  process.stdout.write(`Usage:
  node scripts/validate-official-api-expression-r3.mjs
  node scripts/validate-official-api-expression-r3.mjs --runtime queue --timeout-ms 180000 --save-skp output/python-sdk-official-api-expression-r3.skp
`);
  process.exit(0);
}
