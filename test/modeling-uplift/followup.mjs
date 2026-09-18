import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SketchUpBridge} from '../../src/bridge.mjs';
import {editMockGeometry} from '../../src/mock-model-geometry.mjs';
import {TOOL_REGISTRY} from '../../src/tool-registry.mjs';
import Ajv from 'ajv/dist/2020.js';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'uplift-followup-'));
const b=new SketchUpBridge({mock:{sessionPath:path.join(root,'model.json')},approval:{stateDir:path.join(root,'approval')},agentContract:{rootDir:path.join(root,'tasks')}});
const q=await b.query_model_geometry({detail:'full',targets:['model'],recursive:false});
assert.equal(q.snapshot.contexts[0].entity_path,'model');
const args={snapshot_handle:q.snapshot_handle,entity_path:'model',edits:[{op:'add_face',points:[[0,0,0],[10,0,0],[10,10,0],[0,10,0]]}],idempotency_key:'root'};
const review=await b.edit_model_geometry(args);assert.equal(review.ok,true,JSON.stringify(review));assert.equal(review.task_state,'awaiting_review');
const m=await b.mockRuntime.readModel();editMockGeometry(m,{entity_path:'model',snapshot_revision:q.model_revision,edits:args.edits});await b.mockRuntime.writeModel(m);
const full=await b.query_model_geometry({detail:'full',targets:['model'],recursive:false});
let page=await b.query_model_geometry({detail:'full',targets:['model'],recursive:false,page_size:2}),records=[],handle=page.snapshot_handle;
while(true){for(const c of page.snapshot.contexts)for(const k of ['vertices','edges','faces'])records.push(...c[k].map(v=>v.handle));if(!page.page.next_cursor)break;page=await b.query_model_geometry({cursor:page.page.next_cursor,detail:'full'});assert.equal(page.snapshot_handle,handle);}
assert.equal(records.length,9);assert.equal(new Set(records).size,9);
await assert.rejects(()=>b.query_model_geometry({snapshot_handle:q.snapshot_handle,cursor:Buffer.from(JSON.stringify({handle,offset:2,size:2})).toString('base64url')}),/another snapshot/);
await b.build_model({code:JSON.stringify({version:1,units:'mm',operations:[{op:'box',name:'unrelated',origin:[0,0,0],size:[10,10,10]}]})});
assert.equal((await b.query_model_geometry({snapshot_handle:handle,page_size:2})).model_revision,full.model_revision);
await assert.rejects(()=>b.edit_model_geometry({...args,snapshot_handle:handle,idempotency_key:'stale-root'}),/stale/);
const ajv=new Ajv({strict:false});for(const tool of TOOL_REGISTRY){const check=ajv.compile(tool.outputSchema);assert.ok(tool.outputSchema.properties,tool.name);if(tool.outputSchema.properties.snapshot)assert.equal(check({snapshot:42}),false);}
console.log(JSON.stringify({ok:true,checks:10,root_review:true,paging:true,schemas:48}));
