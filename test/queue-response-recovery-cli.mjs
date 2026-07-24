import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sketchup-queue-recovery-cli-'));
const queueDir = path.join(tempRoot, 'queue');
const processingDir = path.join(tempRoot, 'processing');
const responseDir = path.join(tempRoot, 'responses');
const requestId = '45590-1784548982275-97afa5c7-10e3-4781-bb9a-8f8f6f21db49';

try {
  await Promise.all([queueDir, processingDir, responseDir].map((directory) => fs.mkdir(directory, { recursive: true })));
  await fs.writeFile(
    path.join(responseDir, `${requestId}.json`),
    '{"result":{"kind":"queue_session_state","runtime":"queue","document_id":"cli-fixture"}}\n',
    'utf8'
  );
  const env = {
    ...process.env,
    ALMA_SKETCHUP_STATE_DIR: tempRoot,
    ALMA_SKETCHUP_QUEUE_DIR: queueDir,
    ALMA_SKETCHUP_PROCESSING_DIR: processingDir,
    ALMA_SKETCHUP_RESPONSE_DIR: responseDir
  };
  const success = await runCli([
    'recover_queue_response',
    '--request-id', requestId,
    '--expected-result-kind', 'queue_session_state',
    '--expected-client-pid', '45590'
  ], env);
  assert.equal(success.code, 0, success.stderr);
  const recovered = JSON.parse(success.stdout);
  assert.equal(recovered.request_id, requestId);
  assert.equal(recovered.expected_result_kind, 'queue_session_state');
  assert.equal(recovered.expected_client_pid, 45590);
  assert.equal(recovered.result.document_id, 'cli-fixture');
  assert.deepEqual(await fs.readdir(responseDir), []);
  assert.deepEqual(await fs.readdir(queueDir), []);
  assert.deepEqual(await fs.readdir(processingDir), []);

  const missingExpectation = await runCli([
    'recover_queue_response',
    '--request-id', requestId
  ], env);
  assert.equal(missingExpectation.code, 1);
  assert.match(missingExpectation.stderr, /expected_result_kind must be an explicit stable result kind/);

  process.stdout.write(`${JSON.stringify({ ok: true, cli_cases: 2, queue_requests_created: 0 }, null, 2)}\n`);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repoRoot, 'src/cli.mjs'), ...args], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({
      code,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8')
    }));
  });
}
