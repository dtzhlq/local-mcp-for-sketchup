import assert from 'node:assert/strict';
import { TaskMutationReceiptLedger, TASK_MUTATION_FINALIZER_VERSION, trustedBridgeReceipt } from '../src/task-mutation-receipt-ledger.mjs';
import { AgentGateway } from '../src/agent-gateway.mjs';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {SketchUpBridge} from '../src/bridge.mjs';
import {prepareExistingModelEdit,applyReviewedExistingModelEdit} from '../src/existing-model-editing.mjs';
const hash=d=>`sha256:${d.repeat(64)}`; let revision=hash('a');
const row=(id,name)=>({path:`pid:${id}`,entity_path:`pid:${id}`,parent_entity_path:null,path_segments:[{entity_type:'component_instance',persistent_id:String(id),reference:`root${id}`}],id:`root${id}`,reference:`root${id}`,persistent_id:String(id),entity_type:'component_instance',entity_definition_name:name,definition_name:name,entity_definition_persistent_id:String(id+10),entity_definition_occurrence_count:1,allowed_operations:['replace_component_definition'],geometry_summary:{type:'assembly_merkle',version:1,subtree_digest:hash(String(id)),expanded_count:1000,leaf_entities_materialized:false}});
let rows=[row(1,'original'),row(2,'original')];const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yf-compact-'));
const bridge=new SketchUpBridge({agentContract:{rootDir:dir},approval:{stateDir:path.join(dir,'approval'),secret:'test-compact-secret-with-32-characters'},executionPolicy:{allowed_runtimes:['queue'],allow_queue_mutation:true}});
let lastAdoptOptions;
bridge.adopt_open_model=async options=>(lastAdoptOptions=options,{kind:'adopt_open_model',runtime:'queue',read_only:true,assembly_summary_depth:2,recursive_projection:'assembly-merkle.v2',occurrence_contract:'canonical-assembly-path.v2',document_id:'doc1',session_id:'session1',model_identity:{runtime_object_id:'model1'},model_revision:revision,model_revision_complete:true,model_revision_total_seen:2002,model_revision_indexed:2002,entities:structuredClone(rows),snapshot:{groups:[],instances:[],materials:[],tags:[],scenes:[],component_definitions:['original','replacement']},recursive:options.recursive,assembly_projection_complete:options.recursive,recursive_index:options.recursive?structuredClone(rows):null,recursive_total_seen:options.recursive?2:0,recursive_truncated:false,recursive_root_paths:options.recursive_roots||null});
const target={entity_path:'pid:1',edit_scope:'instance_path',instance_policy:'definition_wide'};
const prepared=await prepareExistingModelEdit({bridge,runtime:'queue',instruction:'Update selected root',targets:[target],operations:[{op:'replace_component_definition',...target,definition:'replacement'}],recursive_roots:['pid:1'],readback_projection:'assembly-merkle.v2',output_dir:dir,execution_contract:{save_model:false,capture_view:false}});
assert.deepEqual(prepared.plan.blockers, []); assert.equal(prepared.plan.target_validation.leaf_entities_materialized, false);
bridge.approvalAuthority.consumeToken=async()=>({approved_by:'fixture',approved_at:new Date().toISOString()});
let writes=0; bridge.build_model=async(options)=>{assert.equal(options.snapshot_detail,false);writes++;revision=hash('b');rows[0]=row(1,'replacement');return {snapshot:{model_revision:revision,model_revision_complete:true},mutation_receipt:{version:'mutation-receipt.v1',kind:'sketchup_mutation_receipt',operation:'build_model',commit_state:'committed',committed_at:new Date().toISOString()}};};

const taskId='task_12345678-abcd-4321-aaaa-123456789abc';
const ledger=new TaskMutationReceiptLedger({rootDir:path.join(dir,'ledger')});
let task={task_id:taskId,state:'executing',intent:'reviewed_existing_model_edit',inputs:{runtime:'queue',timeout_ms:300000},private:{existing_edit_plan:prepared.plan},artifacts:[]};
const claim={filePath:path.join(dir,`${'a'.repeat(64)}.json`),record:{operation:'submit_agent_task_input',fingerprint:hash('c'),task_id:taskId,task_state_at_claim:'awaiting_review',task_version_at_claim:2}};
await assert.rejects(applyReviewedExistingModelEdit({bridge,runtime:'queue',plan:prepared.plan,approval_token:'fixture',save_model:false,capture_view:false,output_dir:dir,
 trusted_commit_observer:async({applied,model_revision_after})=>{
  assert.equal(applied.ok,false);
  await ledger.record({task,claim,binding:{plan_id:prepared.plan.plan_id,plan_hash:prepared.plan.plan_hash,model_key:prepared.plan.model_key,
   model_revision_before:prepared.plan.model_revision,model_revision_after,risk_level:prepared.plan.risk_level,runtime:'queue'},
   bridgeReceipt:trustedBridgeReceipt({runtime:'queue',nativeReceipt:applied.mutation_receipt}),
   finalizer:{version:TASK_MUTATION_FINALIZER_VERSION,kind:'committed_assembly_replacement',applied_result:applied}});
  throw new Error('simulated process loss before report/readback');
 }}),/simulated process loss/);
const recoveredLedger=new TaskMutationReceiptLedger({rootDir:path.join(dir,'ledger')});
const receipt=await recoveredLedger.load(taskId);assert.equal(receipt.finalizer.applied_result.verification_pending,true);
const gateway={bridge,taskStore:{loadTaskMutationReceipt:id=>recoveredLedger.load(id),getTask:async()=>structuredClone(task),
 transition:async(id,state,{patch={}}={})=>(task={...task,...patch,state}),update:async(id,patch)=>(task={...task,...patch})},
 registerArtifacts:async()=>{},markMutationReceiptFinalized:AgentGateway.prototype.markMutationReceiptFinalized};
// Even on recovery, an unexpected change to an untouched shared instance blocks acceptance.
rows[1].geometry_summary.subtree_digest=hash('d');revision=hash('e');
await assert.rejects(AgentGateway.prototype.finalizeReviewedMutationReceipt.call(gateway,receipt),/revision differs/);
revision=hash('b'); // Fault fixture also checks scope independently of the revision guard.
await assert.rejects(AgentGateway.prototype.finalizeReviewedMutationReceipt.call(gateway,receipt),/outside the selected/);
rows[1].geometry_summary.subtree_digest=hash('2');
// Clear this fixture's revision cache by using a fresh bridge object, as after a process restart.
gateway.bridge={adopt_open_model:bridge.adopt_open_model};
const done=await AgentGateway.prototype.finalizeReviewedMutationReceipt.call(gateway,receipt);
assert.equal(done.state,'completed');assert.equal(done.result.ok,true);assert.equal(writes,1,'recovery must not replay the committed replacement');
assert.equal(lastAdoptOptions.timeoutMs,300000,'post-commit readback must honor the task timeout');
assert.equal(rows[1].definition_name,'original');
await fs.rm(dir,{recursive:true});
console.log('Assembly replacement: compact readback, scope guard, durable early receipt and recovery without replay passed.');

// The same bounded update can reuse an unchanged child without cloning it.
const {compileVersionedAssemblyRebuild}=await import('../src/detailed-modeling/assembly-edit.mjs');
const {validateCreationScopeAgainstModel}=await import('../src/agent-dsl-policy.mjs');
const previousDsl={version:1,units:'mm',operations:[
 {op:'component_definition',name:'fixed',operations:[{op:'box',id:'fixed-box',origin:[0,0,0],size:[10,10,10]}]},
 {op:'component_definition',name:'variable',operations:[{op:'box',id:'variable-box',origin:[0,0,0],size:[20,10,10]}]},
 {op:'component_definition',name:'root',operations:[{op:'component_instance',id:'fixed-instance',definition:'fixed',origin:[0,0,0]},{op:'component_instance',id:'variable-instance',definition:'variable',origin:[10,0,0]}]}]};
const nextDsl=structuredClone(previousDsl);nextDsl.operations[1].operations[0].size[0]=30;
const stage=compileVersionedAssemblyRebuild({previousDsl,nextDsl,selections:[{logical_definition:'root',target:{entity_path:'pid:1'}}],scope:'single',taskId,
 existingDefinitionMap:{fixed:'native-fixed',variable:'native-variable',root:'native-root'},existingIdentityMap:{'fixed-box':'native-fixed-box'},expectedModelRevision:hash('a')});
assert.equal(stage.copied_definition_count,2);assert.equal(stage.reused_definition_count,1);
assert.equal(stage.identity_map['fixed-box'],'native-fixed-box');
validateCreationScopeAgainstModel(stage.creation_document,{model_revision:hash('a'),component_definitions:['native-fixed','native-variable','native-root']});
assert.throws(()=>validateCreationScopeAgainstModel(stage.creation_document,{model_revision:hash('b'),component_definitions:['native-fixed']}),/revision/);
console.log('Dependency update stages 2 changed definitions, reuses 1; stale revision refused.');

// A slow source check must not spend the write connection's lifetime. Refresh
// under the authenticated document binding before entering the native guard.
const {deliverModelAccessibilityTask}=await import('../src/model-accessibility-delivery.mjs');
const {freezeDetailSpecification}=await import('../src/detail-quality.mjs');
const deliveryDir=await fs.mkdtemp(path.join(os.tmpdir(),'yf-delivery-connection-'));
const sourceId='task_12345678-abcd-4321-aaaa-123456789abd';
const connection={runtime:'queue',session_id:'s',document_id:'d',model_identity:{runtime_object_id:'m'},model_revision:hash('a')};
const spec=freezeDetailSpecification({version:1,required_parts:[{id:'root'}],required_views:[]});
const accepted={quality_status:'pass',quality_accepted:true,evidence_level:'live_runtime',remaining:[],specification_hash:spec.hash};
const source={intent:'create_model',state:'completed',inputs:{session_contract:connection},private:{creation:{runtime:'queue',frozen_spec:spec,round:{snapshot:{model_revision:hash('a'),model_revision_complete:true}}}},result:{kind:'create_model_result',...accepted,quality:accepted,snapshot:{model_revision:hash('a')}}};
const store={rootDir:deliveryDir,mutationReceiptLedger:{},getTask:async id=>id===sourceId?source:{intent:'deliver_model',inputs:{source_task_id:sourceId,session_contract:connection}}};
const order=[];
const deliveryBridge={sessionContractAuthority:{verify:async()=>order.push('authenticate')},
 create_queue_handshake:async()=>{order.push('refresh');return {session_contract:{...connection,handshake_id:'fresh'}};},
 withAgentGatewayExecution:async(_,callback)=>callback({withLiveMutationAuthorization:async options=>{order.push('guard');assert.equal(options.session_contract.handshake_id,'fresh');throw new Error('fixture stops before save');}})};
await assert.rejects(deliverModelAccessibilityTask({bridge:deliveryBridge,taskStore:store,taskId,sourceTaskId:sourceId,sessionContract:connection}),/fixture stops before save/);
assert.deepEqual(order,['authenticate','refresh','guard']);
deliveryBridge.create_queue_handshake=async()=>({session_contract:{...connection,document_id:'different'}});
await assert.rejects(deliverModelAccessibilityTask({bridge:deliveryBridge,taskStore:store,taskId,sourceTaskId:sourceId,sessionContract:connection}),/source changed/);
await fs.rm(deliveryDir,{recursive:true});
console.log('Delivery refresh preserves authenticated document binding before any save.');
