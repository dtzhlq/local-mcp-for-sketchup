import { AgentContractError, sha256Canonical } from './agent-contract.mjs';
import { compileModelProgramSource } from './expert-compiler.mjs';
import { compilePythonSdkScript } from './python-sdk-compiler.mjs';

export async function continueModelProgram(gateway,task){
  if(['completed','failed','cancelled','expired'].includes(task.state))return task;
  const input=task.inputs,runtime=input.runtime??'mock',stages=input.stages;
  if(!Array.isArray(stages)||stages.length<1||stages.length>3)throw new AgentContractError('INVALID_ARGUMENT','A program requires 1..3 stages');
  for(const s of stages)if(!['create','edit'].includes(s.kind)||!['expert','python_sdk'].includes(s.language??'expert')||typeof s.code!=='string'||s.code.length>200000)throw new AgentContractError('INVALID_ARGUMENT','Each stage requires kind, supported language, and bounded code');
  const limits={maxOperations:input.budget?.max_operations??100,maxLoopIterations:input.budget?.max_loop_iterations??10000,maxStatements:input.budget?.max_statements??20000,maxOutputBytes:input.budget?.max_output_bytes??1000000};
  for(const [key,max] of Object.entries({maxOperations:100,maxLoopIterations:10000,maxStatements:20000,maxOutputBytes:1000000}))if(!Number.isInteger(limits[key])||limits[key]<1||limits[key]>max)throw new AgentContractError('INVALID_ARGUMENT','Invalid program execution budget');
  if(task.state==='awaiting_input')task=await gateway.taskStore.transition(task.task_id,'understanding',{reason:'resume_model_program'});
  let journal=task.private?.model_program??{source_hash:sha256Canonical({stages,targets:input.targets,parameters:input.parameters,runtime,snapshot_handle:input.snapshot_handle,budget:input.budget}),stages:[],index:0,previous:null};
  if(journal.source_hash!==sha256Canonical({stages,targets:input.targets,parameters:input.parameters,runtime,snapshot_handle:input.snapshot_handle,budget:input.budget}))throw new AgentContractError('PLAN_HASH_MISMATCH','Program source is frozen after start');
  const persist=async()=>{const current=await gateway.taskStore.getTask(task.task_id,{includePrivate:true});task=await gateway.taskStore.update(task.task_id,{private:{...current.private,model_program:journal}});};
  while(journal.index<stages.length){
    const index=journal.index,stage=stages[index];
    let record=journal.stages[index];
    if(!record){
      const query=await gateway.bridge.query_model_geometry({runtime,targets:journal.targets??input.targets,recursive:true,max_vertices:input.max_vertices??10000,detail:'full',...(index===0&&input.snapshot_handle?{snapshot_handle:input.snapshot_handle,budget:input.budget}:{})});
      if(!query.complete)throw new AgentContractError('MODEL_REVISION_INCOMPLETE','Program snapshot must be complete; reduce scope');
      if(index===0 && input.snapshot_handle){
        const fresh=await gateway.bridge.query_model_geometry({runtime,targets:journal.targets??input.targets,max_vertices:input.max_vertices??10000});
        if(fresh.model_revision!==query.model_revision)throw new AgentContractError('MODEL_REVISION_MISMATCH','Initial program snapshot is stale');
      }
      const bindings={snapshot:query.snapshot,previous:journal.previous,parameters:input.parameters??{},stage:index};
      let output;
      try {
      if(stage.language==='python_sdk'){
        const compiled=compilePythonSdkScript(stage.code,{bindings,...limits});
        output=stage.kind==='create'?{operations:compiled.document.operations,result:compiled.result??null}:compiled.result;
      }else output=compileModelProgramSource(stage.code,{bindings,...limits});
      } catch(error) { throw new AgentContractError('INVALID_ARGUMENT',error.message,{nextAction:{action:'correct_program_stage',stage:index,committed_stages:journal.index}}); }
      if(!output||typeof output!=='object')throw new AgentContractError('INVALID_ARGUMENT','Program must return a structured stage result');
      if((stage.kind==='create'?output.operations?.length:output.edits?.length)>limits.maxOperations)throw new AgentContractError('INVALID_ARGUMENT','Stage operation budget exceeded');
      record={snapshot_handle:query.snapshot_handle,model_revision:query.model_revision,output,output_hash:sha256Canonical(output),idempotency_key:`${task.task_id}:stage:${index}`};
      journal.stages[index]=record;await persist();
    }
    if(!record.child_task_id){
      let child;
      if(stage.kind==='edit')child=await gateway.bridge.edit_model_geometry({runtime,snapshot_handle:record.snapshot_handle,entity_path:record.output.entity_path,edits:record.output.edits,instruction:task.instruction,idempotency_key:record.idempotency_key});
      else child=await gateway.start({intent:'create_model',instruction:task.instruction,idempotency_key:record.idempotency_key,inputs:{runtime,code:JSON.stringify({version:1,units:'mm',operations:record.output.operations}),...(input.connection_task_id?{connection_task_id:input.connection_task_id}:{}),...(input.session_contract?{session_contract:input.session_contract}:{})}});
      record.child_task_id=child.task_id??child.task?.task_id;
      if(!record.child_task_id)throw new AgentContractError('INTERNAL_ERROR','Stage did not produce a recoverable child task');
      await persist();
    }
    const child=await gateway.taskStore.getTask(record.child_task_id,{includePrivate:true});
    if(child.state!=='completed'){
      if(['failed','cancelled','expired'].includes(child.state))return gateway.taskStore.transition(task.task_id,'failed',{reason:'model_program_stage_failed',patch:{result:{kind:'model_program',stage:index,child_task_id:child.task_id,state:child.state},last_error:child.last_error,next_action:child.next_action}});
      return gateway.taskStore.transition(task.task_id,'awaiting_input',{reason:'model_program_stage_pending',patch:{result:{kind:'model_program',stage:index,child_task_id:child.task_id,source_hash:journal.source_hash},next_action:{action:'complete_child_task_then_resume_program',child_task_id:child.task_id,child_next_action:child.next_action,then_tool:'resume_agent_task',arguments:{task_id:task.task_id}}}});
    }
    journal.targets=rebindProgramTargets(journal.targets??input.targets,child.result?.geometry_edits??[]);
    const readback=await gateway.bridge.query_model_geometry({runtime,targets:journal.targets??input.targets,max_vertices:input.max_vertices??10000});
    if(!readback.complete)throw new AgentContractError('MODEL_REVISION_INCOMPLETE','Stage readback exceeded its budget; reduce scope before continuing');
    record.readback_handle=readback.snapshot_handle;record.model_revision_after=readback.model_revision;record.completed=true;
    journal.previous=record.output.result??null;journal.index++;await persist();
  }
  return gateway.taskStore.transition(task.task_id,'completed',{reason:'model_program_complete',patch:{result:{kind:'model_program',source_hash:journal.source_hash,stages:journal.stages.map(({output,...record})=>record),result:journal.previous},next_action:null}});
}

export function rebindProgramTargets(targets,mappings){
  if(!targets)return targets;
  return targets.map(target=>{
    for(const mapping of mappings){
      const before=mapping.entity_path_before,after=mapping.entity_path_after;
      if(!before||!after)continue;
      if(target===before||target.startsWith(before+'.'))return after+target.slice(before.length);
      if(before.startsWith(target+'.'))return after.split('.').slice(0,target.split('.').length).join('.');
    }
    return target;
  });
}
