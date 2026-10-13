import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SketchUpBridge} from '../src/bridge.mjs';
import {createResultEnvelope} from '../src/agent-contract.mjs';
import {createAgentResponsePolicy, presentAgentResultEnvelope} from '../src/agent-response-projection.mjs';

// Eight saved sources reproduce the actual guided-response overflow without
// any native model, save, authorization or geometry claim.
const root=await fs.mkdtemp(path.join(os.tmpdir(),'parameter-source-projection-'));
try {
 const bridge=new SketchUpBridge({agentContract:{rootDir:root},executionPolicy:{allowed_runtimes:['mock'],auto_approve_risks:[]}});
 const ids=Array.from({length:8},(_,i)=>`task_${String(i+1).repeat(8)}-${String(i+1).repeat(4)}-4${String(i+1).repeat(3)}-8${String(i+1).repeat(3)}-${String(i+1).repeat(12)}`);
 const saved=ids.map((id,i)=>({creation_task_id:id,saved_delivery_task_id:'task_99999999-9999-4999-8999-999999999999',roots:[{name:'fixture-root-'+i,target:{entity_path:`pid:${i+1}`}}],baseline_rebind_required:true,current_geometry_rechecked:false,next_action:'Include saved_delivery_task_id with the parameter edit. The server must verify saved bytes, complete current revision and all original subtree fingerprints before rebinding identity.'}));
 for(const limit of [4096,2048]){
  const responsePolicy=createAgentResponsePolicy({trustedPolicy:{max_context_chars:{guided:limit}}});
  const {task}=await bridge.taskStore.createTask({intent:'discover',instruction:'Exercise saved parameter source response limits.',responsePolicy,inputs:{runtime:'mock',topic:'parameter_sources'}});
  const result={kind:'parameter_source_discovery',topic:'parameter_sources',current_model:'fresh_identity_checked',evidence_level:'trusted_creation_source_index',sources:[],saved_source_continuations:structuredClone(saved),geometry_rechecked:false,note:'Only this active document or its verified saved delivery is listed; no filesystem paths are exposed.',source_path:path.join(root,'private.skp')};
  if(limit===2048)result.saved_source_continuations.forEach(s=>s.roots[0].name+='-long-name'.repeat(12));
  const envelope=createResultEnvelope({task,data:result});
  const shown=await presentAgentResultEnvelope({envelope,task,taskStore:bridge.taskStore});
  assert.ok(JSON.stringify(shown).length<=limit);assert.equal(shown.presentation.projected,true);
  assert.equal(shown.result.returned_saved_source_count,8);assert.equal(shown.result.returned_source_count,0);assert.equal(shown.result.geometry_rechecked,false);
  assert.equal(JSON.stringify(shown).includes(root),false);
  if(limit===4096)assert.equal(shown.result.saved_source_continuations[0].roots[0].target.entity_path,'pid:1');
  if(limit===2048)assert.equal(shown.result.saved_source_continuations,undefined,'The smallest fallback must not reuse the overflowing compact list.');
  let handle=shown.presentation.full_result_artifact,offset=0,content='',pages=0;
  while(true){
   const page=await bridge.read_agent_artifact({task_id:task.task_id,handle,offset,max_chars:1500});
   assert.ok(JSON.stringify(page).length<=limit);assert.equal(page.presentation.projected,false);
   const artifact=page.data.artifact;assert.equal(typeof artifact.content,'string');content+=artifact.content;pages++;
   if(artifact.eof)break;
   assert.ok(artifact.next_offset>offset);handle=artifact.handle;offset=artifact.next_offset;assert.ok(pages<1000);
  }
  const full=JSON.parse(content);assert.deepEqual(full.result.saved_source_continuations.map(s=>s.creation_task_id),ids);assert.equal(full.result.geometry_rechecked,false);assert.equal(content.includes(root),false);
  const again=await presentAgentResultEnvelope({envelope,task,taskStore:bridge.taskStore});assert.equal(again.presentation.full_result_artifact,shown.presentation.full_result_artifact);
 }
 console.log('Parameter source responses: eight saved sources fit 4096/2048 character envelopes; all IDs and targets survive opaque artifact pagination without geometry or privilege claims.');
}finally{await fs.rm(root,{recursive:true,force:true});}
