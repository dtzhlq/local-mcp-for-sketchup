import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('..', import.meta.url));
const tests = [
  'model-accessibility-tasks', 'model-accessibility-workflows', 'model-accessibility-workflow-guidance', 'model-accessibility-gateway',
  'model-accessibility-connection', 'model-accessibility-benchmark', 'model-accessibility-alma-provider',
  'model-accessibility-delivery', 'model-accessibility-delivery-gateway', 'model-accessibility-fixtures',
  'model-accessibility-asset-catalog', 'model-accessibility-runtime-preflight', 'model-accessibility-response-state',
  'model-accessibility-parameter-edit', 'model-accessibility-parameter-boundaries',
  'model-accessibility-parameter-gateway', 'model-accessibility-parameter-reopen',
  'model-accessibility-verification-inputs', 'model-accessibility-appearance', 'model-accessibility-appearance-receipt',
  'model-accessibility-asset-edit', 'model-accessibility-native-asset-development',
  'model-accessibility-saved-lifecycle', 'model-accessibility-reopen',
  'model-accessibility-host-provisioning', 'model-accessibility-approval-loop',
  'model-accessibility-parameter-fixture', 'model-accessibility-parameter-fixture-state',
  'model-accessibility-scoped-readback', 'model-accessibility-parameter-batched', 'model-accessibility-native-asset-hierarchy',
  'agent-contract', 'agent-gateway-production-capabilities', 'agent-gateway-mutation-recovery',
  'agent-contract-mutation-recovery-evidence', 'session-contract',
  'ruby/native_asset_operations_test.rb', 'ruby/saved_model_lifecycle_test.rb', 'ruby/detail_capture_test.rb', 'ruby/host_creation_metadata_test.rb',
  'ruby/model_revision_canonical_equivalence_test.rb', 'ruby/model_revision_merkle_test.rb'
];
const testFile = name => `test/${name.endsWith('.rb') ? name : `${name}.mjs`}`;
const sourceFolders = ['src', 'schema', 'sketchup_plugin'];
const accessibilityFolders = ['scripts/model-accessibility', 'benchmarks', 'examples/model-accessibility'];
const sourceFiles = ['package.json', 'scripts/run-model-accessibility-offline-tests.mjs', ...tests.map(testFile)];
const directory = process.argv[2] ? path.resolve(process.argv[2]) : path.join(repository, 'output', `model-accessibility-offline-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await fs.mkdir(directory, { recursive: false });
const hashes = async () => {
  const result = {};
  for (const folder of [...sourceFolders, ...accessibilityFolders]) {
    for (const relative of await fs.readdir(path.join(repository, folder), { recursive: true })) {
      const name = path.join(folder, relative);
      if (sourceFolders.includes(folder) && !/\.(mjs|rb|json)$/.test(name)) continue;
      if (!(await fs.lstat(path.join(repository, name))).isFile()) continue;
      result[name] = crypto.createHash('sha256').update(await fs.readFile(path.join(repository, name))).digest('hex');
    }
  }
  for (const name of sourceFiles) result[name] = crypto.createHash('sha256').update(await fs.readFile(path.join(repository, name))).digest('hex');
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
};
const before = await hashes();
const results = [];
for (const name of tests) {
  const work = path.join(directory, name.replaceAll('/', '-'));
  await fs.mkdir(work);
  for (const entry of ['src', 'test', 'scripts', 'examples', 'schema', 'docs', 'projects', 'sketchup_plugin', 'node_modules', 'package.json', 'benchmarks']) await fs.symlink(path.join(repository, entry), path.join(work, entry));
  await fs.mkdir(path.join(work, 'tmp'));
  const start = Date.now();
  const result = await new Promise(resolve => {
    const child = spawn(name.endsWith('.rb') ? 'ruby' : process.execPath, [path.join(repository, testFile(name))], { cwd: work,
      env: { ...process.env, TMPDIR: path.join(work, 'tmp'), ALMA_SKETCHUP_STATE_DIR: path.join(work, 'state'), ALMA_SKETCHUP_MOCK_SESSION_PATH: path.join(work, 'model.json'), ALMA_SKETCHUP_QUEUE_DIR: path.join(work, 'queue'), ALMA_SKETCHUP_RESPONSE_DIR: path.join(work, 'responses'), ALMA_SKETCHUP_TEST_OUTPUT_DIR: path.join(work, 'output') }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    child.on('error', error => resolve({ exit_code: null, stdout, stderr: String(error) }));
    child.on('close', exit_code => resolve({ exit_code, stdout, stderr }));
  });
  await fs.writeFile(path.join(work, 'stdout.log'), result.stdout, { flag: 'wx' });
  await fs.writeFile(path.join(work, 'stderr.log'), result.stderr, { flag: 'wx' });
  results.push({ name, passed: result.exit_code === 0, exit_code: result.exit_code, elapsed_ms: Date.now() - start });
  console.log(JSON.stringify(results.at(-1)));
}
const after = await hashes();
const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(name => before[name] !== after[name]);
const report = { version: 'model-accessibility-offline.v1', ok: results.every(item => item.passed) && changed.length === 0,
  evidence_level: 'offline_contract_fixtures', live_runtime_executed: false, real_model_calls: 0,
  cross_model_acceptance: false, release_acceptance: false, results,
  source_unchanged: changed.length === 0, changed_sources: changed,
  source_hash_scope: { source_directories: sourceFolders, source_extensions: ['.mjs', '.rb', '.json'],
    complete_regular_file_directories: accessibilityFolders, individual_files: sourceFiles }, source_hashes: before };
await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ report: path.join(directory, 'report.json'), passed: results.filter(item => item.passed).length, total: results.length, ok: report.ok }));
if (!report.ok) process.exitCode = 1;
