import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { QueueRuntime } from '../src/queue-runtime.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-publication-'));
const queueDir = path.join(root, 'queue'), responseDir = path.join(root, 'responses');
const writeFile = fs.writeFile;
let partialObserved = false;
try {
  // Force a filesystem write to pause halfway, as happens for large assemblies.
  fs.writeFile = async function(file, data, options) {
    if (path.dirname(String(file)) !== queueDir) return writeFile.call(this, file, data, options);
    const bytes = Buffer.from(data), half = Math.floor(bytes.length / 2);
    const handle = await fs.open(file, 'wx');
    try {
      await handle.write(bytes.subarray(0, half));
      partialObserved = true;
      assert.deepEqual((await fs.readdir(queueDir)).filter(name => name.endsWith('.json')), [], 'Bridge must not see an incomplete request');
      await handle.write(bytes.subarray(half));
    } finally { await handle.close(); }
  };
  const runtime = new QueueRuntime({queueDir, responseDir, pollIntervalMs: 5, timeoutMs: 5000});
  const call = runtime.call('get_capabilities', {payload: 'x'.repeat(1024 * 1024)});
  const consumer = (async () => {
    for (let i = 0; i < 500; i++) {
      const files = await fs.readdir(queueDir).catch(() => []);
      const file = files.find(name => name.endsWith('.json'));
      if (file) {
        const request = JSON.parse(await fs.readFile(path.join(queueDir, file), 'utf8'));
        assert.equal(request.params.payload.length, 1024 * 1024);
        await writeFile(path.join(responseDir, file), JSON.stringify({result: {complete: true}}));
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('Request was not published');
  })();
  const [result] = await Promise.all([call, consumer]);
  assert.equal(partialObserved, true);
  assert.deepEqual(result, {complete: true});
  assert.deepEqual(await fs.readdir(queueDir), []);
  console.log('PASS complete queue request publication');
  fs.writeFile = writeFile;
  const id = `12345-${Date.now()}-11111111-1111-4111-8111-111111111111`;
  const responseFile = path.join(responseDir, `${id}.json`);
  const snapshot = {instances: [{id: 'task-root', definition: 'task-definition'}], component_definitions: ['task-definition'],
    model_revision: `sha256:${'a'.repeat(64)}`, model_revision_complete: true,
    mutation_receipt: {version: 'mutation-receipt.v1', kind: 'sketchup_mutation_receipt', operation: 'Alma Build Model', commit_state: 'committed', committed_at: new Date().toISOString()}};
  await writeFile(responseFile, JSON.stringify({result: snapshot}));
  runtime.getSessionState = async () => ({model_revision: snapshot.model_revision, model_revision_complete: true, session_id: 'session', document_id: 'doc'});
  const recovery = {session: {session_id: 'session', document_id: 'doc'}, roots: [{id: 'task-root', definition: 'task-definition'}], definitions: ['task-definition'], startedAt: new Date(Date.now() - 1000).toISOString()};
  await assert.rejects(runtime.recoverCommittedCreation({...recovery, roots: [{id: 'wrong', definition: 'task-definition'}]}), /expectation/);
  await fs.stat(responseFile);
  let persisted = false;
  await runtime.recoverCommittedCreation({...recovery, persist: async result => {
    await fs.stat(responseFile);
    assert.deepEqual(result.snapshot, snapshot);
    persisted = true;
  }});
  assert.equal(persisted, true);
  await assert.rejects(fs.stat(responseFile), {code: 'ENOENT'});
  console.log('PASS late creation recovery persists before response consumption; no model write');
const captureRoot=await fs.mkdtemp(path.join(os.tmpdir(),'timber-overview-recovery-'));
try {
 const {recoverTimberOverview}=await import('../src/traditional-timber/quality.mjs');
 const output=path.join(captureRoot,'attempt-1');await fs.mkdir(output);
 const responseDir=path.join(captureRoot,'responses');await fs.mkdir(responseDir);
 const runtime=new QueueRuntime({queueDir:path.join(captureRoot,'queue'),processingDir:path.join(captureRoot,'processing'),responseDir,lockPath:path.join(captureRoot,'runtime.lock')});
 const file=path.join(output,'whole-hall.png'),png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(1400,16);png.writeUInt32BE(900,20);await fs.writeFile(file,png);
 const revision=`sha256:${'b'.repeat(64)}`,summary={session_id:'s',document_id:'d',model_revision:revision};
 const result={kind:'capture_view',file_path:file,read_only_attestation:{session_id:'s',document_id:'d',state_unchanged:true,model_revision_complete_before:true,model_revision_complete_after:true,model_revision_before:revision,model_revision_after:revision}};
 const response=path.join(responseDir,`12345-${Date.now()}-11111111-1111-4111-8111-111111111111.json`);await fs.writeFile(response,JSON.stringify({result}));
 const opts={bridge:{selectRuntime:()=>runtime},taskStore:{mutationReceiptLedger:{sign:async value=>JSON.stringify(value)}},taskId:'task-test',view:{id:'overview'},priorOutputDirs:[output],summary};
 await assert.rejects(recoverTimberOverview({...opts,summary:{...summary,document_id:'other'}}),/document/);
 assert.ok(await fs.stat(response));
 const recovered=await recoverTimberOverview(opts);assert.equal(recovered.captures.length,1);await assert.rejects(fs.stat(response),{code:'ENOENT'});
 assert.deepEqual(await recoverTimberOverview(opts),recovered);
 console.log('PASS exact late overview recovery and authenticated replay without capture');
} finally {await fs.rm(captureRoot,{recursive:true,force:true});}

} finally {
  fs.writeFile = writeFile;
  await fs.rm(root, {recursive: true, force: true});
}
