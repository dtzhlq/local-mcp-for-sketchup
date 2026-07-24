import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { SketchUpBridge } from '../src/bridge.mjs';
import {
  QueueRuntime,
  cleanupOwnedQueueArtifacts,
  cleanupQueueArtifactsForPid,
  sweepInterruptedReadOnlyQueueArtifacts
} from '../src/queue-runtime.mjs';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sketchup-queue-runtime-'));
try {
  await testExclusiveLockSerializesIndependentInstances();
  await testExclusiveLockIsReentrantForOneInstance();
  await testFreshHandshakeProbeKeepsOneExclusiveScope();
  await testTimeoutRemovesPendingRequest();
  await testDiagnosticsReportsQueueState();
  await testFreshHandshakeRejectsResidualArtifacts();
  await testSessionContractLockDoesNotRemoveStaleLock();
  await testClaimedRequestTimeoutPreservesProcessingArtifact();
  await testPidCleanupPreservesClaimedArtifactsAndResponses();
  await testPidCleanupRemovesOnlyReadOnlyClaimedArtifacts();
  await testInterruptedReadOnlyLateResponseSweep();
  await testLightweightActiveModelIdentityProbe();
  await testExactOrphanResponseRecovery();
  await testOrphanResponseRecoveryFailsClosed();
  await testMutationTransportGuardIsBoundAndRevisionIsOneShot();
  await testSelectionDoesNotConsumeRevisionBeforeDriftedBuild();
  await testOpenModelInvalidatesGuardContext();
  await testBridgeRejectsQueueReplaceBeforeRuntimeDispatch();
  await testQueueRuntimeRejectsReplaceBeforeRequestCreation();
  await testMockRuntimeKeepsReplaceImport();
  await testObservedResponseCleansClaimedPair();
  await testSignalCleanupPreservesUnobservedClaimAndResponse();

  process.stdout.write(`${JSON.stringify({ ok: true, tests: 22 }, null, 2)}\n`);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

async function testBridgeRejectsQueueReplaceBeforeRuntimeDispatch() {
  const modelState = { document_id: 'valuable-document', revision: 7, entities: ['keep-me'] };
  const before = structuredClone(modelState);
  const runtimeCalls = [];
  const fakeQueueRuntime = {
    async importModel() {
      runtimeCalls.push('import_model');
      modelState.entities = [];
      modelState.revision += 1;
      return { snapshot: { totals: { groups: 0 } } };
    }
  };
  const bridge = new SketchUpBridge({
    queueRuntime: fakeQueueRuntime,
    liveMutationAuthorization: { operation: 'import_model', validated_at: new Date().toISOString() }
  });

  let rejection;
  try {
    await bridge.import_model({ runtime: 'queue', path: 'should-not-be-read.skp', mode: 'RePlAcE' });
  } catch (error) {
    rejection = error;
  }

  assert.equal(rejection?.code, 'OPERATION_NOT_ALLOWED');
  assert.equal(rejection?.retryable, false);
  assert.equal(rejection?.next_action?.action, 'prepare_new_plan');
  assert.deepEqual(rejection?.next_action?.allowed_queue_modes, ['append']);
  assert.deepEqual(rejection?.next_action?.alternatives, ['open_model']);
  assert.equal(rejection?.details?.model_state_preserved, true);
  assert.equal(rejection?.details?.queue_request_created, false);
  assert.deepEqual(runtimeCalls, [], 'bridge must reject before dispatching to the queue runtime');
  assert.deepEqual(modelState, before, 'rejected queue replace must not change the active model state');
}

async function testQueueRuntimeRejectsReplaceBeforeRequestCreation() {
  const root = path.join(tempRoot, 'replace-import-no-request');
  const queueDir = path.join(root, 'queue');
  const processingDir = path.join(root, 'processing');
  const responseDir = path.join(root, 'responses');
  const lockPath = path.join(root, 'queue-runtime.lock');
  const runtime = new QueueRuntime({
    queueDir,
    processingDir,
    responseDir,
    lockPath,
    timeoutMs: 20,
    lockTimeoutMs: 20,
    pollIntervalMs: 5
  });

  await assert.rejects(
    () => runtime.importModel({ path: 'missing-but-must-not-be-touched.skp', mode: 'replace' }),
    (error) => error.code === 'OPERATION_NOT_ALLOWED'
      && error.details?.queue_request_created === false
      && error.next_action?.action === 'prepare_new_plan'
  );
  assert.equal(await pathExists(queueDir), false, 'rejected replace must not initialize the queue directory');
  assert.equal(await pathExists(processingDir), false, 'rejected replace must not initialize the processing directory');
  assert.equal(await pathExists(responseDir), false, 'rejected replace must not initialize the response directory');
  assert.equal(await pathExists(lockPath), false, 'rejected replace must not acquire a queue lock');
}

async function testMockRuntimeKeepsReplaceImport() {
  const root = path.join(tempRoot, 'mock-replace-remains-supported');
  const bridge = new SketchUpBridge({ mock: { sessionPath: path.join(root, 'session.json') } });
  const source = await bridge.build_model({
    runtime: 'mock',
    code: JSON.stringify({ version: 1, units: 'mm', operations: [
      { op: 'reset' },
      { op: 'box', id: 'source-box', name: 'Source_Box', origin: [0, 0, 0], size: [100, 80, 60] }
    ] })
  });
  const artifactPath = path.join(root, 'source-model.json');
  await bridge.save_model({ runtime: 'mock', path: artifactPath, keep_session: true });
  const current = await bridge.build_model({
    runtime: 'mock',
    code: JSON.stringify({ version: 1, units: 'mm', operations: [
      { op: 'reset' },
      { op: 'box', id: 'current-box', name: 'Current_Box', origin: [200, 0, 0], size: [20, 20, 20] }
    ] })
  });
  assert.deepEqual(current.snapshot.groups.map((group) => group.name), ['Current_Box']);

  const imported = await bridge.import_model({ runtime: 'mock', path: artifactPath, mode: 'replace' });
  assert.equal(imported.mode, 'replace');
  assert.deepEqual(imported.snapshot.groups.map((group) => group.name), ['Source_Box']);
  assert.deepEqual(imported.snapshot.totals, source.snapshot.totals, 'mock replace must still restore the saved source model');
}

async function testSessionContractLockDoesNotRemoveStaleLock() {
  const root = path.join(tempRoot, 'session-contract-stale-lock');
  const queueDir = path.join(root, 'queue');
  const responseDir = path.join(root, 'responses');
  const lockPath = path.join(root, 'queue-runtime.lock');
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(lockPath, `${JSON.stringify({ pid: 999999, created_at: new Date(Date.now() - 60_000).toISOString() })}\n`, 'utf8');
  const oldTime = new Date(Date.now() - 60_000);
  await fs.utimes(lockPath, oldTime, oldTime);
  const runtime = new QueueRuntime({ queueDir, responseDir, lockPath, staleLockMs: 1000, lockTimeoutMs: 50, pollIntervalMs: 5 });

  await assert.rejects(
    runtime.withExclusiveAccess(async () => {}, { method: 'session-contract-test', failIfLocked: true }),
    (error) => error.code === 'QUEUE_STALE_LOCK'
  );
  assert.equal(await pathExists(lockPath), true, 'Session Contract authorization must not delete a stale lock automatically');
}

async function testFreshHandshakeRejectsResidualArtifacts() {
  const root = path.join(tempRoot, 'fresh-handshake-residue');
  const queueDir = path.join(root, 'queue');
  const processingDir = path.join(root, 'processing');
  const responseDir = path.join(root, 'responses');
  const lockPath = path.join(root, 'queue-runtime.lock');
  await fs.mkdir(queueDir, { recursive: true });
  await fs.mkdir(responseDir, { recursive: true });
  const runtime = new QueueRuntime({ queueDir, processingDir, responseDir, lockPath, staleLockMs: 1000, lockTimeoutMs: 50, pollIntervalMs: 5 });

  await fs.writeFile(path.join(queueDir, 'residual-request.json'), '{"id":"residual-request"}\n', 'utf8');
  await assert.rejects(() => runtime.createFreshHandshakeProbe(), (error) => error.code === 'QUEUE_REQUESTS_PENDING');
  await fs.rm(path.join(queueDir, 'residual-request.json'));

  await fs.mkdir(processingDir, { recursive: true });
  await fs.writeFile(path.join(processingDir, 'crashed-request.json'), '{"id":"crashed-request"}\n', 'utf8');
  await assert.rejects(() => runtime.createFreshHandshakeProbe(), (error) => error.code === 'QUEUE_REQUESTS_PENDING');
  await fs.rm(path.join(processingDir, 'crashed-request.json'));

  await fs.writeFile(path.join(responseDir, 'orphan-response.json'), '{"result":{}}\n', 'utf8');
  await assert.rejects(() => runtime.createFreshHandshakeProbe(), (error) => error.code === 'QUEUE_RESPONSES_PENDING');
  await fs.rm(path.join(responseDir, 'orphan-response.json'));

  await fs.writeFile(lockPath, '{"pid":123,"method":"build_model"}\n', 'utf8');
  await assert.rejects(() => runtime.createFreshHandshakeProbe(), (error) => error.code === 'QUEUE_LOCK_PRESENT');
  const staleDate = new Date(Date.now() - 5000);
  await fs.utimes(lockPath, staleDate, staleDate);
  await assert.rejects(() => runtime.createFreshHandshakeProbe(), (error) => error.code === 'QUEUE_STALE_LOCK');
}

async function testDiagnosticsReportsQueueState() {
  const root = path.join(tempRoot, 'diagnostics');
  const queueDir = path.join(root, 'queue');
  const processingDir = path.join(root, 'processing');
  const responseDir = path.join(root, 'responses');
  const lockPath = path.join(root, 'queue-runtime.lock');
  await fs.mkdir(queueDir, { recursive: true });
  await fs.mkdir(processingDir, { recursive: true });
  await fs.mkdir(responseDir, { recursive: true });
  await fs.writeFile(path.join(queueDir, 'request.json'), '{"id":"request"}\n', 'utf8');
  await fs.writeFile(path.join(processingDir, 'claimed.json'), '{"id":"claimed"}\n', 'utf8');
  await fs.writeFile(path.join(responseDir, 'response.json'), '{"result":{}}\n', 'utf8');
  await fs.writeFile(lockPath, '{"pid":123,"method":"build_model"}\n', 'utf8');
  const staleDate = new Date(Date.now() - 5000);
  await fs.utimes(lockPath, staleDate, staleDate);

  const runtime = new QueueRuntime({
    queueDir,
    processingDir,
    responseDir,
    lockPath,
    staleLockMs: 1000,
    lockTimeoutMs: 100,
    pollIntervalMs: 5
  });
  const diagnostics = await runtime.diagnostics({ includeFiles: true });
  assert.equal(diagnostics.kind, 'queue_diagnostics');
  assert.equal(diagnostics.queue.count, 1);
  assert.equal(diagnostics.processing.count, 1);
  assert.equal(diagnostics.responses.count, 1);
  assert.equal(diagnostics.lock.exists, true);
  assert.equal(diagnostics.lock.stale, true);
  assert.equal(diagnostics.lock.owner.method, 'build_model');
  assert.ok(diagnostics.recommendations.some((item) => item.includes('stale')));
  assert.ok(diagnostics.recommendations.some((item) => item.includes('will not be replayed')));
  assert.equal(diagnostics.queue.files[0].name, 'request.json');
  assert.equal(diagnostics.processing.files[0].name, 'claimed.json');
}

async function testClaimedRequestTimeoutPreservesProcessingArtifact() {
  const root = path.join(tempRoot, 'claimed-timeout-cleanup');
  const queueDir = path.join(root, 'queue');
  const processingDir = path.join(root, 'processing');
  const responseDir = path.join(root, 'responses');
  const lockPath = path.join(root, 'queue-runtime.lock');
  const runtime = new QueueRuntime({
    queueDir,
    processingDir,
    responseDir,
    lockPath,
    timeoutMs: 80,
    lockTimeoutMs: 100,
    staleLockMs: 10_000,
    pollIntervalMs: 5
  });

  const pending = runtime.getCapabilities();
  await waitFor(async () => (await jsonFiles(queueDir)).length === 1, 500);
  const [entry] = await jsonFiles(queueDir);
  await fs.mkdir(processingDir, { recursive: true });
  await fs.rename(path.join(queueDir, entry), path.join(processingDir, entry));
  await assert.rejects(pending, /Timed out waiting for SketchUp plugin response/);

  assert.deepEqual(await jsonFiles(queueDir), []);
  assert.deepEqual(await jsonFiles(processingDir), [entry], 'timed-out owner must retain its outcome-unknown claimed request');
  assert.equal(await pathExists(lockPath), false);
  await assert.rejects(
    () => runtime.createFreshHandshakeProbe(),
    (error) => error.code === 'QUEUE_REQUESTS_PENDING',
    'retained claimed request must block a fresh handshake'
  );
  await fs.rm(path.join(processingDir, entry));
}

async function testPidCleanupPreservesClaimedArtifactsAndResponses() {
  const root = path.join(tempRoot, 'pid-claimed-cleanup');
  const queueDir = path.join(root, 'queue');
  const processingDir = path.join(root, 'processing');
  const responseDir = path.join(root, 'responses');
  const lockPath = path.join(root, 'queue-runtime.lock');
  const pid = 424242;
  const queuedId = `${pid}-queued`;
  const claimedId = `${pid}-claimed`;
  const outcomeUnknownId = `${pid}-outcome-unknown`;
  await Promise.all([queueDir, processingDir, responseDir].map((directory) => fs.mkdir(directory, { recursive: true })));
  await fs.writeFile(path.join(queueDir, `${queuedId}.json`), `${JSON.stringify({ id: queuedId, client_pid: pid })}\n`, 'utf8');
  await fs.writeFile(path.join(processingDir, `${claimedId}.json`), `${JSON.stringify({ id: claimedId, client_pid: pid })}\n`, 'utf8');
  await fs.writeFile(path.join(processingDir, `${outcomeUnknownId}.json`), `${JSON.stringify({ id: outcomeUnknownId, client_pid: pid })}\n`, 'utf8');
  await fs.writeFile(path.join(responseDir, `${queuedId}.json`), '{"result":{}}\n', 'utf8');
  await fs.writeFile(path.join(responseDir, `${claimedId}.json`), '{"result":{}}\n', 'utf8');
  await fs.writeFile(path.join(processingDir, 'other-client.json'), '{"id":"other-client","client_pid":7}\n', 'utf8');
  await fs.writeFile(lockPath, `${JSON.stringify({ pid })}\n`, 'utf8');

  const result = await cleanupQueueArtifactsForPid(pid, { queueDir, processingDir, responseDir, lockPath });
  assert.deepEqual(result, {
    pid,
    removed_requests: 1,
    removed_processing: 0,
    preserved_processing: 2,
    removed_lock: true,
    removed_responses: 0,
    preserved_responses: 2
  });
  assert.deepEqual(await jsonFiles(queueDir), []);
  assert.deepEqual(await jsonFiles(responseDir), [`${claimedId}.json`, `${queuedId}.json`], 'unobserved responses are durable execution evidence');
  assert.deepEqual(await jsonFiles(processingDir), [`${claimedId}.json`, `${outcomeUnknownId}.json`, 'other-client.json']);
}

async function testPidCleanupRemovesOnlyReadOnlyClaimedArtifacts() {
  const root = path.join(tempRoot, 'pid-readonly-claimed-cleanup');
  const queueDir = path.join(root, 'queue');
  const processingDir = path.join(root, 'processing');
  const responseDir = path.join(root, 'responses');
  const lockPath = path.join(root, 'queue-runtime.lock');
  const pid = 434343;
  const readOnlyId = `${pid}-readonly`;
  const mutatingId = `${pid}-mutating`;
  await Promise.all([queueDir, processingDir, responseDir].map((directory) => fs.mkdir(directory, { recursive: true })));
  await fs.writeFile(
    path.join(processingDir, `${readOnlyId}.json`),
    `${JSON.stringify({ id: readOnlyId, client_pid: pid, method: 'get_session_state', params: {} })}\n`,
    'utf8'
  );
  await fs.writeFile(
    path.join(processingDir, `${mutatingId}.json`),
    `${JSON.stringify({ id: mutatingId, client_pid: pid, method: 'build_model', params: { code: '{}' } })}\n`,
    'utf8'
  );
  await fs.writeFile(path.join(responseDir, `${readOnlyId}.json`), '{"result":{"kind":"queue_session_state"}}\n', 'utf8');
  await fs.writeFile(path.join(responseDir, `${mutatingId}.json`), '{"result":{"kind":"model_snapshot"}}\n', 'utf8');
  await fs.writeFile(lockPath, `${JSON.stringify({ pid })}\n`, 'utf8');

  const result = await cleanupQueueArtifactsForPid(pid, {
    queueDir,
    processingDir,
    responseDir,
    lockPath,
    removeReadOnlyProcessing: true
  });
  assert.deepEqual(result, {
    pid,
    removed_requests: 0,
    removed_processing: 1,
    preserved_processing: 1,
    removed_lock: true,
    removed_responses: 1,
    preserved_responses: 1,
    pending_read_only_response_cleanup: 0
  });
  assert.deepEqual(await jsonFiles(processingDir), [`${mutatingId}.json`], 'mutation outcome evidence must remain');
  assert.deepEqual(await jsonFiles(responseDir), [`${mutatingId}.json`], 'only the read-only response may be removed');
}

async function testInterruptedReadOnlyLateResponseSweep() {
  const root = path.join(tempRoot, 'pid-readonly-late-response');
  const queueDir = path.join(root, 'queue');
  const processingDir = path.join(root, 'processing');
  const responseDir = path.join(root, 'responses');
  const cancellationDir = path.join(root, 'read-only-cancellations');
  const lockPath = path.join(root, 'queue-runtime.lock');
  const pid = 444444;
  const requestId = `${pid}-1784798952462-28dd71d8-591d-47e2-bb9d-b413b40353ff`;
  await Promise.all([queueDir, processingDir, responseDir].map((directory) => fs.mkdir(directory, { recursive: true })));
  await fs.writeFile(
    path.join(processingDir, `${requestId}.json`),
    `${JSON.stringify({ id: requestId, client_pid: pid, method: 'get_session_state', params: {} })}\n`,
    'utf8'
  );

  const interrupted = await cleanupQueueArtifactsForPid(pid, {
    queueDir,
    processingDir,
    responseDir,
    cancellationDir,
    lockPath,
    removeReadOnlyProcessing: true
  });
  assert.equal(interrupted.removed_processing, 1);
  assert.equal(interrupted.pending_read_only_response_cleanup, 1);
  assert.deepEqual(await jsonFiles(processingDir), []);
  assert.deepEqual(await jsonFiles(cancellationDir), [`${requestId}.json`]);

  await fs.writeFile(
    path.join(responseDir, `${requestId}.json`),
    '{"result":{"kind":"queue_session_state","runtime":"queue"}}\n',
    'utf8'
  );
  const swept = await sweepInterruptedReadOnlyQueueArtifacts({
    cancellationDir,
    processingDir,
    responseDir
  });
  assert.deepEqual(swept, {
    removed_processing: 0,
    removed_responses: 1,
    removed_markers: 1,
    pending_markers: 0
  });
  assert.deepEqual(await jsonFiles(responseDir), []);
  assert.deepEqual(await jsonFiles(cancellationDir), []);
}

async function testLightweightActiveModelIdentityProbe() {
  const root = path.join(tempRoot, 'active-model-identity-probe');
  const queueDir = path.join(root, 'queue');
  const processingDir = path.join(root, 'processing');
  const responseDir = path.join(root, 'responses');
  const runtime = new QueueRuntime({
    queueDir,
    processingDir,
    responseDir,
    timeoutMs: 500,
    lockTimeoutMs: 500,
    pollIntervalMs: 5
  });

  const pending = runtime.getActiveModelIdentity();
  await waitFor(async () => (await jsonFiles(queueDir)).length === 1, 500);
  const [entry] = await jsonFiles(queueDir);
  const request = JSON.parse(await fs.readFile(path.join(queueDir, entry), 'utf8'));
  assert.equal(request.method, 'get_active_model_identity');
  assert.deepEqual(request.params, {});

  await fs.mkdir(processingDir, { recursive: true });
  await fs.mkdir(responseDir, { recursive: true });
  await fs.rename(path.join(queueDir, entry), path.join(processingDir, entry));
  await fs.writeFile(
    path.join(responseDir, entry),
    `${JSON.stringify({ result: {
      kind: 'active_model_identity',
      model_identity: { source_path: '/tmp/disposable.skp' },
      activation_confirmed: true,
      pending_open: false
    } })}\n`,
    'utf8'
  );

  const result = await pending;
  assert.equal(result.kind, 'active_model_identity');
  assert.equal(result.model_identity.source_path, '/tmp/disposable.skp');
  assert.equal('model_revision' in result, false, 'lightweight activation probe must not require a global model revision');
  assert.deepEqual(await jsonFiles(processingDir), []);
  assert.deepEqual(await jsonFiles(responseDir), []);
}

async function testExactOrphanResponseRecovery() {
  const root = path.join(tempRoot, 'exact-orphan-response-recovery');
  const queueDir = path.join(root, 'queue');
  const processingDir = path.join(root, 'processing');
  const responseDir = path.join(root, 'responses');
  const lockPath = path.join(root, 'queue-runtime.lock');
  const requestId = '45590-1784548982275-97afa5c7-10e3-4781-bb9a-8f8f6f21db49';
  await Promise.all([queueDir, processingDir, responseDir].map((directory) => fs.mkdir(directory, { recursive: true })));
  await fs.writeFile(path.join(responseDir, `${requestId}.json`), `${JSON.stringify({ result: { kind: 'queue_session_state', runtime: 'queue', document_id: 'document-fixture' } })}\n`, 'utf8');
  const runtime = new QueueRuntime({ queueDir, processingDir, responseDir, lockPath });

  const recovered = await runtime.recoverOrphanResponse({
    requestId,
    expectedResultKind: 'queue_session_state',
    expectedClientPid: 45590
  });
  assert.equal(recovered.kind, 'queue_orphan_response_recovery');
  assert.equal(recovered.request_id, requestId);
  assert.equal(recovered.request_client_pid, 45590);
  assert.equal(recovered.expected_client_pid, 45590);
  assert.equal(recovered.response_removed, true);
  assert.equal(recovered.result.kind, 'queue_session_state');
  assert.equal(await pathExists(path.join(responseDir, `${requestId}.json`)), false);
  assert.deepEqual(await jsonFiles(queueDir), []);
  assert.deepEqual(await jsonFiles(processingDir), []);
  assert.equal(await pathExists(lockPath), false);

  const schema = JSON.parse(await fs.readFile(new URL('../schema/queue-response-recovery-v1.schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv2020({ allErrors: true, strict: false, validateFormats: false }).compile(schema);
  assert.equal(validate(recovered), true, JSON.stringify(validate.errors));
}

async function testOrphanResponseRecoveryFailsClosed() {
  const root = path.join(tempRoot, 'orphan-response-fail-closed');
  const queueDir = path.join(root, 'queue');
  const processingDir = path.join(root, 'processing');
  const responseDir = path.join(root, 'responses');
  const lockPath = path.join(root, 'queue-runtime.lock');
  const requestId = '45590-1784548982275-97afa5c7-10e3-4781-bb9a-8f8f6f21db49';
  const responsePath = path.join(responseDir, `${requestId}.json`);
  await Promise.all([queueDir, processingDir, responseDir].map((directory) => fs.mkdir(directory, { recursive: true })));
  const runtime = new QueueRuntime({ queueDir, processingDir, responseDir, lockPath, staleLockMs: 1000 });
  const recover = (overrides = {}) => runtime.recoverOrphanResponse({
    requestId,
    expectedResultKind: 'queue_session_state',
    expectedClientPid: 45590,
    ...overrides
  });
  const writeSuccess = () => fs.writeFile(responsePath, '{"result":{"kind":"queue_session_state","runtime":"queue"}}\n', 'utf8');

  await assert.rejects(() => recover({ requestId: '../response' }), (error) => error.code === 'INVALID_ARGUMENT');
  await assert.rejects(() => recover({ expectedClientPid: 7 }), (error) => error.code === 'INVALID_ARGUMENT');
  await assert.rejects(() => recover(), (error) => error.code === 'ARTIFACT_NOT_FOUND');

  await writeSuccess();
  const otherResponsePath = path.join(responseDir, '7-1784548982276-18bd8ebd-7f39-4ac2-bf22-d6a85939e4b1.json');
  await fs.writeFile(otherResponsePath, '{"result":{"kind":"queue_session_state","runtime":"queue"}}\n', 'utf8');
  await assert.rejects(
    () => recover(),
    (error) => error.code === 'QUEUE_RESPONSES_PENDING'
      && error.details?.response_count === 2
      && error.details?.response_removed === false
  );
  assert.equal(await pathExists(responsePath), true, 'ambiguous response set must preserve the target response');
  assert.equal(await pathExists(otherResponsePath), true, 'ambiguous response set must preserve every other response');
  await fs.rm(otherResponsePath);

  await fs.writeFile(path.join(queueDir, 'pending.json'), '{}\n', 'utf8');
  await assert.rejects(() => recover(), (error) => error.code === 'QUEUE_NOT_IDLE' && error.details?.response_removed === false);
  assert.equal(await pathExists(responsePath), true);
  await fs.rm(path.join(queueDir, 'pending.json'));

  await fs.writeFile(path.join(processingDir, 'claimed.json'), '{}\n', 'utf8');
  await assert.rejects(() => recover(), (error) => error.code === 'QUEUE_NOT_IDLE' && error.details?.processing_count === 1);
  assert.equal(await pathExists(responsePath), true);
  await fs.rm(path.join(processingDir, 'claimed.json'));

  await fs.writeFile(lockPath, '{"pid":7}\n', 'utf8');
  await assert.rejects(() => recover(), (error) => error.code === 'QUEUE_LOCK_PRESENT');
  assert.equal(await pathExists(responsePath), true);
  await fs.rm(lockPath);

  await fs.writeFile(responsePath, '{"result":', 'utf8');
  await assert.rejects(() => recover(), (error) => error.code === 'ARTIFACT_INTEGRITY_ERROR' && error.details?.reason === 'response_invalid_json');
  assert.equal(await pathExists(responsePath), true);

  await fs.writeFile(responsePath, '{"error":{"code":"INTERNAL_ERROR"}}\n', 'utf8');
  await assert.rejects(() => recover(), (error) => error.code === 'ARTIFACT_INTEGRITY_ERROR' && error.details?.reason === 'response_contains_error');
  assert.equal(await pathExists(responsePath), true);

  await fs.writeFile(responsePath, '{"result":{"kind":"model_snapshot"}}\n', 'utf8');
  await assert.rejects(() => recover(), (error) => error.code === 'ARTIFACT_INTEGRITY_ERROR' && error.details?.reason === 'result_kind_mismatch');
  assert.equal(await pathExists(responsePath), true);
}

async function testObservedResponseCleansClaimedPair() {
  const root = path.join(tempRoot, 'observed-response-cleanup');
  const queueDir = path.join(root, 'queue');
  const processingDir = path.join(root, 'processing');
  const responseDir = path.join(root, 'responses');
  const runtime = new QueueRuntime({
    queueDir,
    processingDir,
    responseDir,
    timeoutMs: 500,
    lockTimeoutMs: 500,
    pollIntervalMs: 5
  });

  const pending = runtime.getCapabilities();
  await waitFor(async () => (await jsonFiles(queueDir)).length === 1, 500);
  const [entry] = await jsonFiles(queueDir);
  await fs.mkdir(processingDir, { recursive: true });
  await fs.mkdir(responseDir, { recursive: true });
  await fs.rename(path.join(queueDir, entry), path.join(processingDir, entry));
  await fs.writeFile(path.join(responseDir, entry), '{"result":{"observed":true}}\n', 'utf8');

  assert.deepEqual(await pending, { observed: true });
  assert.deepEqual(await jsonFiles(processingDir), [], 'parsed atomic response must permit claimed-marker cleanup');
  assert.deepEqual(await jsonFiles(responseDir), [], 'parsed atomic response must permit response cleanup');
}

async function testSignalCleanupPreservesUnobservedClaimAndResponse() {
  const root = path.join(tempRoot, 'signal-preserves-evidence');
  const queueDir = path.join(root, 'queue');
  const processingDir = path.join(root, 'processing');
  const responseDir = path.join(root, 'responses');
  const lockPath = path.join(root, 'queue-runtime.lock');
  const runtime = new QueueRuntime({
    queueDir,
    processingDir,
    responseDir,
    lockPath,
    timeoutMs: 2500,
    lockTimeoutMs: 500,
    pollIntervalMs: 1000
  });

  const pending = runtime.getCapabilities();
  await waitFor(async () => (await jsonFiles(queueDir)).length === 1, 500);
  const [entry] = await jsonFiles(queueDir);
  await fs.mkdir(processingDir, { recursive: true });
  await fs.mkdir(responseDir, { recursive: true });
  await fs.rename(path.join(queueDir, entry), path.join(processingDir, entry));
  await fs.writeFile(path.join(responseDir, entry), '{"result":{"observed_after_shutdown":true}}\n', 'utf8');

  await cleanupOwnedQueueArtifacts();
  assert.deepEqual(await jsonFiles(queueDir), [], 'signal cleanup must remove only an unclaimed request path');
  assert.deepEqual(await jsonFiles(processingDir), [entry], 'signal cleanup must preserve the claimed execution marker');
  assert.deepEqual(await jsonFiles(responseDir), [entry], 'signal cleanup must preserve an unobserved durable response');
  assert.equal(await pathExists(lockPath), false, 'signal cleanup must release the owner lock');

  assert.deepEqual(await pending, { observed_after_shutdown: true });
  assert.deepEqual(await jsonFiles(processingDir), [], 'the still-running call may clean evidence only after parsing the response');
  assert.deepEqual(await jsonFiles(responseDir), [], 'the still-running call may clean the parsed response');
}

async function testMutationTransportGuardIsBoundAndRevisionIsOneShot() {
  const root = path.join(tempRoot, 'mutation-transport-guard');
  const queueDir = path.join(root, 'queue');
  const processingDir = path.join(root, 'processing');
  const responseDir = path.join(root, 'responses');
  const runtime = new QueueRuntime({
    queueDir,
    processingDir,
    responseDir,
    timeoutMs: 500,
    lockTimeoutMs: 500,
    staleLockMs: 10_000,
    pollIntervalMs: 5
  });
  const guard = {
    handshake_id: 'handshake-fixture',
    session_id: 'session-fixture',
    document_id: 'document-fixture',
    model_revision: `sha256:${'1'.repeat(64)}`,
    model_modified: false,
    plugin_version: '0.1.0-rc.2',
    capability_version: 'capabilities-fixture',
    manifest_version: 'manifest-fixture',
    dsl_version: 1
  };
  const requests = [];
  const responder = respondToRequests({ queueDir, responseDir, requests, count: 9 });

  await runtime.withMutationGuard(guard, async () => {
    await runtime.setSelection({ targets: ['entity-fixture'] });
    await runtime.adoptOpenModel({ read_only: true, recursive: true });
    await runtime.captureView({ outputPath: path.join(root, 'capture.png') });
    await runtime.adoptOpenModel({ read_only: true, recursive: true });
    await runtime.saveModel({ outputPath: path.join(root, 'saved.skp'), keepSession: true });
    await runtime.exportModel({ outputPath: path.join(root, 'export.obj'), format: 'obj' });
    await runtime.buildModel('{"version":1,"units":"mm","operations":[]}');
    await runtime.adoptOpenModel({ read_only: true, recursive: true });
    await runtime.resetModel();
  });
  await responder;

  assert.deepEqual(
    requests.map((request) => request.method),
    ['set_selection', 'adopt_open_model', 'capture_view', 'adopt_open_model', 'save_model', 'export_model', 'build_model', 'adopt_open_model', 'reset_model']
  );
  for (const request of requests) {
    assert.equal(request.params._session_guard.session_id, guard.session_id);
  }
  for (const request of requests.slice(0, 7)) {
    assert.equal(
      request.params._session_guard.model_revision,
      guard.model_revision,
      `${request.method} must preserve the starting revision until the first true model mutation`
    );
    assert.equal(
      request.params._session_guard.model_modified,
      guard.model_modified,
      `${request.method} must preserve the starting modified state until the first true model mutation`
    );
  }
  for (const request of requests.slice(7)) {
    assert.equal(
      request.params._session_guard.model_revision,
      undefined,
      'only a successful true model mutation consumes the one-shot starting revision'
    );
    assert.equal(
      request.params._session_guard.model_modified,
      undefined,
      'the pre-mutation modified state must be consumed with the starting revision'
    );
  }
}

async function testSelectionDoesNotConsumeRevisionBeforeDriftedBuild() {
  const root = path.join(tempRoot, 'selection-then-revision-drift');
  const queueDir = path.join(root, 'queue');
  const processingDir = path.join(root, 'processing');
  const responseDir = path.join(root, 'responses');
  const runtime = new QueueRuntime({
    queueDir,
    processingDir,
    responseDir,
    timeoutMs: 500,
    lockTimeoutMs: 500,
    staleLockMs: 10_000,
    pollIntervalMs: 5
  });
  const startingRevision = `sha256:${'2'.repeat(64)}`;
  const driftedRevision = `sha256:${'3'.repeat(64)}`;
  const guard = {
    handshake_id: 'handshake-selection-drift',
    session_id: 'session-selection-drift',
    document_id: 'document-selection-drift',
    model_revision: startingRevision,
    model_modified: false,
    plugin_version: '0.1.0-rc.2',
    capability_version: 'capabilities-fixture',
    manifest_version: 'manifest-fixture',
    dsl_version: 1
  };
  let activeRevision = startingRevision;
  const requests = [];
  const responder = respondToRequests({
    queueDir,
    responseDir,
    requests,
    count: 3,
    responseForRequest(request) {
      if (request.params?._session_guard?.model_revision !== activeRevision) {
        return {
          error: {
            code: 'HANDSHAKE_MODEL_REVISION_MISMATCH',
            message: 'The fake SketchUp model changed after selection and before build.',
            details: { field: 'model_revision' }
          }
        };
      }
      return { result: {} };
    }
  });

  await runtime.withMutationGuard(guard, async () => {
    await runtime.setSelection({ targets: ['entity-fixture'] });
    activeRevision = driftedRevision;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(
        () => runtime.buildModel('{"version":1,"units":"mm","operations":[]}'),
        (error) => error.code === 'HANDSHAKE_MODEL_REVISION_MISMATCH'
          && error.details?.field === 'model_revision'
      );
    }
  });
  await responder;

  assert.deepEqual(requests.map((request) => request.method), ['set_selection', 'build_model', 'build_model']);
  assert.equal(requests[0].params._session_guard.model_revision, startingRevision);
  assert.equal(requests[0].params._session_guard.model_modified, false);
  for (const request of requests.slice(1)) {
    assert.equal(
      request.params._session_guard.model_revision,
      startingRevision,
      'a rejected build must remain bound to the handshake revision and cannot unlock a retry'
    );
    assert.equal(
      request.params._session_guard.model_modified,
      false,
      'a rejected build must retain the handshake modified state for retry'
    );
  }
}

async function testOpenModelInvalidatesGuardContext() {
  const root = path.join(tempRoot, 'open-model-invalidates-guard');
  const queueDir = path.join(root, 'queue');
  const processingDir = path.join(root, 'processing');
  const responseDir = path.join(root, 'responses');
  const runtime = new QueueRuntime({
    queueDir,
    processingDir,
    responseDir,
    timeoutMs: 500,
    lockTimeoutMs: 500,
    staleLockMs: 10_000,
    pollIntervalMs: 5
  });
  const guard = {
    handshake_id: 'handshake-document-switch',
    session_id: 'session-document-switch',
    document_id: 'document-before-open',
    model_revision: `sha256:${'4'.repeat(64)}`,
    plugin_version: '0.1.0-rc.2',
    capability_version: 'capabilities-fixture',
    manifest_version: 'manifest-fixture',
    dsl_version: 1
  };
  const requests = [];
  const responder = respondToRequests({ queueDir, responseDir, requests, count: 1 });

  await assert.rejects(
    runtime.withMutationGuard(guard, async () => {
      await runtime.openModel({ inputPath: path.join(root, 'target.skp') });
      await runtime.buildModel('{"version":1,"units":"mm","operations":[]}');
    }),
    (error) => error.code === 'HANDSHAKE_DOCUMENT_MISMATCH'
      && error.details?.invalidated_by === 'open_model'
      && error.details?.queue_request_created === false
  );
  await responder;

  assert.deepEqual(requests.map((request) => request.method), ['open_model']);
  assert.equal(requests[0].params._session_guard.model_revision, guard.model_revision);
  assert.deepEqual(await jsonFiles(queueDir), [], 'no post-open request may be created under the invalidated guard');
}

async function testExclusiveLockSerializesIndependentInstances() {
  const root = path.join(tempRoot, 'serialize');
  const queueDir = path.join(root, 'queue');
  const responseDir = path.join(root, 'responses');
  const options = {
    queueDir,
    responseDir,
    lockTimeoutMs: 1000,
    staleLockMs: 10_000,
    pollIntervalMs: 5
  };
  const first = new QueueRuntime(options);
  const second = new QueueRuntime(options);
  const events = [];

  const firstRun = first.withExclusiveAccess(async () => {
    events.push('first:start');
    await sleep(80);
    events.push('first:end');
  });
  await sleep(10);
  const secondRun = second.withExclusiveAccess(async () => {
    events.push('second:start');
  });
  await Promise.all([firstRun, secondRun]);

  assert.deepEqual(events, ['first:start', 'first:end', 'second:start']);
}

async function testExclusiveLockIsReentrantForOneInstance() {
  const root = path.join(tempRoot, 'reentrant');
  const runtime = new QueueRuntime({
    queueDir: path.join(root, 'queue'),
    responseDir: path.join(root, 'responses'),
    lockTimeoutMs: 100,
    staleLockMs: 10_000,
    pollIntervalMs: 5
  });
  const events = [];

  await runtime.withExclusiveAccess(async () => {
    events.push('outer');
    await runtime.withExclusiveAccess(async () => {
      events.push('inner');
    });
  });

  assert.deepEqual(events, ['outer', 'inner']);
}

async function testFreshHandshakeProbeKeepsOneExclusiveScope() {
  const root = path.join(tempRoot, 'fresh-probe-exclusive-scope');
  const queueDir = path.join(root, 'queue');
  const responseDir = path.join(root, 'responses');
  const lockPath = path.join(root, 'queue-runtime.lock');
  const runtime = new QueueRuntime({
    queueDir,
    responseDir,
    lockPath,
    timeoutMs: 500,
    lockTimeoutMs: 500,
    staleLockMs: 10_000,
    pollIntervalMs: 5
  });
  const requests = [];
  const responder = respondToRequests({
    queueDir,
    responseDir,
    requests,
    count: 2,
    responseForRequest(request) {
      if (request.method === 'get_session_state') {
        return { result: { kind: 'queue_session_state', runtime: 'queue' } };
      }
      return { result: {} };
    }
  });
  let lockHeldDuringCallback = false;
  await runtime.withFreshHandshakeProbe(async (runtimeState) => {
    assert.equal(runtimeState.kind, 'queue_session_state');
    lockHeldDuringCallback = await pathExists(lockPath);
    await runtime.buildModel('{"version":1,"units":"mm","operations":[]}');
  }, { method: 'fresh-probe-test' });
  await responder;

  assert.equal(lockHeldDuringCallback, true, 'fresh probe callback must run before releasing the exclusive queue lock');
  assert.deepEqual(requests.map((request) => request.method), ['get_session_state', 'build_model']);
  assert.equal(await pathExists(lockPath), false, 'fresh probe exclusive lock must be released after the callback');
}

async function testTimeoutRemovesPendingRequest() {
  const root = path.join(tempRoot, 'timeout-cleanup');
  const queueDir = path.join(root, 'queue');
  const runtime = new QueueRuntime({
    queueDir,
    responseDir: path.join(root, 'responses'),
    timeoutMs: 20,
    lockTimeoutMs: 100,
    staleLockMs: 10_000,
    pollIntervalMs: 5
  });

  await assert.rejects(
    () => runtime.getCapabilities(),
    /Timed out waiting for SketchUp plugin response/
  );
  const queueFiles = await fs.readdir(queueDir);
  assert.deepEqual(queueFiles, []);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function jsonFiles(directory) {
  try {
    return (await fs.readdir(directory)).filter((entry) => entry.endsWith('.json')).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function waitFor(predicate, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return;
    await sleep(5);
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

async function respondToRequests({ queueDir, responseDir, requests, count, responseForRequest }) {
  const handled = new Set();
  await fs.mkdir(responseDir, { recursive: true });
  while (requests.length < count) {
    const entries = await jsonFiles(queueDir);
    const entry = entries.find((name) => !handled.has(name));
    if (!entry) {
      await sleep(5);
      continue;
    }
    handled.add(entry);
    const request = JSON.parse(await fs.readFile(path.join(queueDir, entry), 'utf8'));
    requests.push(request);
    await fs.rm(path.join(queueDir, entry), { force: true });
    const response = responseForRequest ? await responseForRequest(request) : { result: {} };
    await fs.writeFile(path.join(responseDir, entry), `${JSON.stringify(response)}\n`, 'utf8');
  }
}
