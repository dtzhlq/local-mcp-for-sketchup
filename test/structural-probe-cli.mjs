import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { emptyModel } from '../src/model-state.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-structural-probe-cli-'));
const sessionPath = path.join(root, 'mock-session.json');
const plainOutput = path.join(root, 'plain-adoption.json');
const structuralOutput = path.join(root, 'structural-adoption.json');
const invalidOutput = path.join(root, 'must-not-exist.json');
let assertions = 0;

try {
  const model = emptyModel();
  model.groups.push({
    id: 'fixture-group',
    persistent_id: '101',
    name: 'Fixture Group',
    kind: 'box',
    faces: 6,
    edges: 12,
    vertices: 8,
    visible: true,
    locked: false,
    bounding_box: {
      min: [0, 0, 0],
      max: [10, 20, 30],
      w: 10,
      d: 20,
      h: 30
    }
  });
  await fs.writeFile(sessionPath, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
  const before = await fs.readFile(sessionPath, 'utf8');
  const env = { ...process.env, ALMA_SKETCHUP_MOCK_SESSION_PATH: sessionPath };

  await runCli([
    'adopt_open_model', '--runtime', 'mock', '--read-only', '--output-file', plainOutput
  ], env);
  const plain = JSON.parse(await fs.readFile(plainOutput, 'utf8'));
  assert.equal(plain.read_only, true); assertions += 1;
  assert.equal(Object.hasOwn(plain, 'structural_groups'), false); assertions += 1;

  await runCli([
    'adopt_open_model', '--runtime', 'mock', '--read-only', '--structural-groups',
    '--output-file', structuralOutput
  ], env);
  const structural = JSON.parse(await fs.readFile(structuralOutput, 'utf8'));
  assert.equal(structural.read_only, true); assertions += 1;
  assert.equal(structural.structural_groups.version, 'structural-groups.v1'); assertions += 1;
  assert.equal(structural.structural_groups.limit, 500); assertions += 1;
  assert.deepEqual(structural.structural_groups.entries.map((entry) => entry.entity_path), ['pid:101']); assertions += 1;

  await assert.rejects(runCli([
    'adopt_open_model', '--runtime', 'mock', '--read-only', '--structural-group-limit', '25',
    '--output-file', invalidOutput
  ], env), /structural_group_limit requires structural_groups=true/); assertions += 1;
  assert.equal(await exists(invalidOutput), false); assertions += 1;
  assert.equal(await fs.readFile(sessionPath, 'utf8'), before); assertions += 1;

  process.stdout.write(`${JSON.stringify({
    ok: true,
    assertions,
    cli_default_limit: structural.structural_groups.limit,
    queue_requests_created: 0,
    live_queue_called: false
  }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

function runCli(args, env) {
  return execFileAsync(process.execPath, [path.join(repoRoot, 'src/cli.mjs'), ...args], {
    cwd: repoRoot,
    env
  });
}

async function exists(target) {
  return fs.access(target).then(() => true, () => false);
}
