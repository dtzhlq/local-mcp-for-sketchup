#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';

const options = parseArgs(process.argv.slice(2));
const runtime = options.runtime || 'mock';
const timeoutMs = options.timeoutMs || (runtime === 'queue' ? 180000 : 20000);
const outputFile = options.outputFile || `output/python-sdk-high-value-${runtime}.json`;
const code = await fs.readFile(options.codeFile || 'examples/python-sdk-high-value-api-fixture.py', 'utf8');
const bridge = new SketchUpBridge();
const result = await bridge.evaluate_py({ code, input_format: 'python_sdk', runtime, timeoutMs, pythonTimeoutMs: 20000 });

await fs.mkdir(path.dirname(outputFile), { recursive: true });
await fs.writeFile(outputFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
let savedModel = null;
if (options.saveSkp) {
  const saved = await bridge.save_model({ path: options.saveSkp, keep_session: true, runtime, timeoutMs });
  savedModel = saved.path || options.saveSkp;
}

const moving = result.snapshot?.groups?.find((group) => group.id === 'sdk-high-value-moving-box');
const assertions = [
  check('compiled operations', result.compiled?.python_sdk?.operations === 8, result.compiled?.python_sdk?.operations),
  check('moving box remains', Boolean(moving), Boolean(moving)),
  check('moving box translated', Number(moving?.bounding_box?.min?.[0]) === 50.8, moving?.bounding_box?.min?.[0]),
  check('deleted box absent', !result.snapshot?.groups?.some((group) => group.id === 'sdk-high-value-deleted-box'), result.snapshot?.groups?.some((group) => group.id === 'sdk-high-value-deleted-box')),
  check('page update flags', result.snapshot?.scenes?.[0]?.update_flags === 17, result.snapshot?.scenes?.[0]?.update_flags),
  check('front UVQ result', JSON.stringify(result.compiled?.result?.front_uvq) === JSON.stringify([1, 1, 1]), result.compiled?.result?.front_uvq),
  check('warnings', result.snapshot?.warning_summary?.total === 0, result.snapshot?.warning_summary?.total)
];
const summary = { ok: assertions.every((item) => item.ok), runtime, output_file: outputFile, saved_model: savedModel, assertions };
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (!summary.ok) process.exitCode = 1;

function check(name, ok, actual) {
  return { name, ok, actual };
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--runtime') parsed.runtime = argv[++index];
    else if (arg === '--timeout-ms') parsed.timeoutMs = Number(argv[++index]);
    else if (arg === '--code-file') parsed.codeFile = argv[++index];
    else if (arg === '--output-file') parsed.outputFile = argv[++index];
    else if (arg === '--save-skp') parsed.saveSkp = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}
