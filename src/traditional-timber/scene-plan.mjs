import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256Canonical, AgentContractError } from '../agent-contract.mjs';
import { compileModelAccessibilityTask } from '../model-accessibility-tasks.mjs';
import { freezeDetailSpecification } from '../detail-quality.mjs';
import { adoptAssemblySummary } from '../model-accessibility-assembly-summary.mjs';
import { buildModelGraph } from '../model-graph.mjs';
import { compareDesignBindingFingerprints } from '../design-intent-graph.mjs';
import { modelIdentityForAdoption, modelKeyForIdentity } from '../model-identity.mjs';
import { traditionalAssemblyRuleBinding, assertTraditionalAssemblyRuleBinding, TRADITIONAL_RENDER_VERSION } from './assembly-plan.mjs';
import { DETAIL_SAMPLE_RESOURCE_BUDGET } from '../detailed-modeling/scenes.mjs';

const copy=v=>structuredClone(v),fail=message=>{throw new AgentContractError('INVALID_ARGUMENT',message);};
export function compileTraditionalScenePlan(input) {
  const plan=copy(input);
  if(plan?.version!==1||plan.units!=='mm'||!/^[-A-Za-z0-9_]{1,96}$/.test(plan.id||''))fail('scene_plan requires version=1, stable id and units=mm.');
  if(Object.keys(plan).some(k=>!['version','id','units','roots','connections','notes','view'].includes(k)))fail('Unknown scene_plan field.');
  if(!Array.isArray(plan.roots)||plan.roots.length<1||plan.roots.length>8)fail('First scene slice supports 1..8 independently created top-level roots.');
  const view=plan.view;
  if(!view||!/^[-A-Za-z0-9_]{1,96}$/.test(view.id||'')||!view.camera||Object.keys(view).some(k=>!['id','camera'].includes(k)))fail('Scene plan requires one explicitly authored overview view.');
  if(Object.keys(view.camera).some(k=>!['eye','target','up','projection','fov'].includes(k))||view.camera.projection&&!['perspective','orthographic'].includes(view.camera.projection)||view.camera.fov!==undefined&&(!Number.isFinite(view.camera.fov)||view.camera.fov<1||view.camera.fov>120))fail('Scene camera uses the native eye/target/up, perspective|orthographic projection and optional fov in [1,120].');
  const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
  const {eye,target,up=[0,0,1]}=view.camera;
  if(![eye,target,up].every(vector)||Math.hypot(...eye.map((v,i)=>v-target[i]))<1||Math.hypot(...up)<.001)fail('Scene camera requires finite, non-degenerate eye/target/up vectors.');
  const direction=target.map((v,i)=>v-eye[i]),cross=[direction[1]*up[2]-direction[2]*up[1],direction[2]*up[0]-direction[0]*up[2],direction[0]*up[1]-direction[1]*up[0]];
  if(Math.hypot(...cross)<.001)fail('Scene camera up vector is parallel to its viewing direction.');
  const ids=new Set(),jobs=[],materials=new Map();
  for(const original of plan.roots) {
    const task=copy(original);
    if(task.assembly)task.assembly.representation={...task.assembly.representation,overview_scope:'scene',scene_id:plan.id};
    if(task.kind!=='traditional_assembly'||task.instances?.length>1)fail('Each scene member must be one public traditional_assembly task/root.');
    if(ids.has(task.id))fail('Scene root IDs must be distinct.');ids.add(task.id);
    const compiled=compileModelAccessibilityTask(task,{limits:{max_operations:100,max_affected_instances:200}});
    if(compiled.bundle.part_graph.roots.length!==1)fail('Each scene job must generate exactly one root.');
    for(const m of compiled.bundle.profile.materials) {
      if(materials.has(m.name)&&sha256Canonical(materials.get(m.name))!==sha256Canonical(m))fail('Conflicting scene material definitions.');
      materials.set(m.name,m);
    }
    jobs.push({root_id:task.id,task:copy(task),input_hash:sha256Canonical(task),
      source_plan_hash:sha256Canonical(task.assembly),resource_estimate:compiled.preflight.normalized.resource_estimate,
      operation_count:compiled.preflight.normalized.operation_count,
      placement:copy(compiled.bundle.part_graph.roots[0])});
  }
  for(const link of plan.connections||[]) {
    if(!ids.has(link.from_root)||!ids.has(link.to_root)||link.from_root===link.to_root||!['walkway','alignment'].includes(link.relation))fail('Scene connections require two distinct declared roots and walkway/alignment relation.');
    if(!Array.isArray(link.from_mm)||!Array.isArray(link.to_mm)||![link.from_mm,link.to_mm].every(v=>v.length===3&&v.every(Number.isFinite)))fail('Scene links require explicit world endpoints.');
    if(Math.abs(link.from_mm[2]-link.to_mm[2])>1)fail('This first slice requires equal explicit walkway levels.');
    if(link.relation==='alignment'&&Math.hypot(...link.from_mm.map((v,i)=>v-link.to_mm[i]))>1)fail('Aligned scene endpoints differ.');
    if(link.relation==='walkway'&&(!ids.has(link.via_root)||Math.hypot(...link.from_mm.map((v,i)=>v-link.to_mm[i]))>2000))fail('A walkway needs an explicit site root and gap <=2000 mm.');
  }
  const resource_estimate=Object.fromEntries(['faces','edges','vertices'].map(key=>[key,jobs.reduce((sum,job)=>sum+job.resource_estimate[key],0)]));
  for(const [key,max] of Object.entries(DETAIL_SAMPLE_RESOURCE_BUDGET))if(resource_estimate[key.replace('max_','')]>max)throw new AgentContractError('RESOURCE_BUDGET','Combined scene estimate exceeds the ordinary budget; reduce tile detail or scene size.',{details:{resource_estimate,budget:DETAIL_SAMPLE_RESOURCE_BUDGET}});
  return {version:'traditional-scene-plan.v1',scene_id:plan.id,scene_plan_hash:sha256Canonical(plan),plan,jobs,
    resource_estimate,
    execution_started:false,quality_accepted:false,edit_scope:'one selected top-level source root',
    connections:copy(plan.connections||[]),atomic_all_scene_update:false};
}

// Public Gateway tasks remain the only model creation/edit entry. This helper
// merely persists their scene membership and creation order, never replays a
// root to edit a completed scene. The input is immutable after first dispatch.
export async function startTraditionalScene({gateway,scenePlan,runtime='mock',timeoutMs=120000}={}) {
  if(!gateway?.start||!gateway.taskStore)fail('A configured AgentGateway is required.');
  if(!['mock','queue'].includes(runtime))fail('Use explicit mock/queue runtime.');
  const compiled=compileTraditionalScenePlan(scenePlan),file=path.join(gateway.taskStore.rootDir,'traditional-scenes-v1',compiled.scene_id+'.json');
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const sign=async body=>({...body,integrity_hmac:await gateway.taskStore.mutationReceiptLedger.sign(body)});
  let state;
  try {
    const {integrity_hmac,...body}=JSON.parse(await fs.readFile(file,'utf8'));
    if(integrity_hmac!==await gateway.taskStore.mutationReceiptLedger.sign(body))fail('Scene record integrity mismatch.');
    if(body.scene_plan_hash!==compiled.scene_plan_hash||body.runtime!==runtime)fail('A created scene plan is immutable; use parameter edits on its recorded creation tasks.');
    state=body;
  } catch(error) {
    if(error.code!=='ENOENT')throw error;
    state={version:compiled.version,scene_id:compiled.scene_id,scene_plan_hash:compiled.scene_plan_hash,runtime,plan:compiled.plan,roots:[],state:'prepared'};
    await fs.writeFile(file,JSON.stringify(await sign(state)),{flag:'wx',mode:0o600});
  }
  const persist=async()=>{const tmp=file+`.${process.pid}.${Date.now()}.pending`;await fs.writeFile(tmp,JSON.stringify(await sign(state)),{flag:'wx',mode:0o600});await fs.rename(tmp,file);};
  for(const job of compiled.jobs) {
    let entry=state.roots.find(r=>r.root_id===job.root_id),result;
    if(entry)result=await gateway.resume({task_id:entry.creation_task_id});
    else {
      // Create a durable public task with immutable inputs first. An expired
      // connection is supplied through that task, never by replaying creation
      // with a new input hash or idempotency key.
      result=await gateway.start({intent:'create_model',instruction:'Create this source-bound engineering assembly, preserving every existing root.',
        idempotency_key:`${compiled.scene_id}:${job.root_id}:create-v1`,
        inputs:{runtime,task:job.task,timeout_ms:timeoutMs}});
      entry={root_id:job.root_id,input_hash:job.input_hash,creation_task_id:result.task_id};state.roots.push(entry);
      await persist();
    }
    let source=await gateway.taskStore.getTask(entry.creation_task_id,{includePrivate:true});
    const connectionCodes=['HANDSHAKE_REQUIRED','HANDSHAKE_EXPIRED','HANDSHAKE_INVALID','SESSION_MISMATCH','MODEL_REVISION_MISMATCH'];
    if(runtime==='queue'&&!source.private?.creation?.round?.snapshot&&source.state==='awaiting_input'&&connectionCodes.includes(source.last_error?.code)) {
      const connection=await gateway.start({intent:'discover',instruction:'Connect for one independent traditional scene root.',idempotency_key:`${compiled.scene_id}:${job.root_id}:connect:${Date.now()}`,inputs:{topic:'connect',runtime,timeout_ms:timeoutMs}});
      if(!connection.ok){state.state='connection_required';await persist();return {...state,next_action:connection.next_action};}
      result=await gateway.submit({task_id:entry.creation_task_id,idempotency_key:`${compiled.scene_id}:${job.root_id}:connection:${connection.task_id}`,input:{connection_task_id:connection.task_id}});
      source=await gateway.taskStore.getTask(entry.creation_task_id,{includePrivate:true});
    }
    entry.state=source.state;entry.geometry_created=Boolean(source.private?.creation?.round?.snapshot);entry.quality_accepted=source.result?.quality_accepted===true;
    entry.parameter_edit_support=copy(source.private?.creation?.parameter_edit_support||null);entry.logical_root=job.placement.instance_id;
    entry.actual_root=source.private?.creation?.identity_map?.[job.placement.instance_id]||null;
    entry.parameter_source_hash=source.private?.creation?.parameter_source?.source_record_hash||null;
    await persist();
    if(!entry.geometry_created){state.state='root_requires_input';await persist();return {...state,next_action:result.next_action};}
  }
  const sourceHash=sha256Canonical(state.roots.map(r=>({task_id:r.creation_task_id,source:r.parameter_source_hash})));
  if(runtime==='queue') {
    let verified;
    if(state.verification_task_id&&state.verification_source_hash===sourceHash)verified=await gateway.resume({task_id:state.verification_task_id});
    else verified=await gateway.start({intent:'verify_model',instruction:'Verify the recorded independent traditional roots and one scene overview without rebuilding.',idempotency_key:`${compiled.scene_id}:verify:${sourceHash}`,inputs:{runtime,scene_id:compiled.scene_id,timeout_ms:timeoutMs}});
    state.verification_task_id=verified.task_id;state.verification_source_hash=sourceHash;
    const verification=await gateway.taskStore.getTask(verified.task_id);
    state.quality_accepted=verification.result?.quality_accepted===true;
    state.state=state.quality_accepted?'completed':'geometry_created_quality_pending';
    state.next_action=verification.next_action;
  } else {state.state='mock_geometry_created';state.quality_accepted=false;}
  state.geometry_created=true;
  await persist();return copy(state);
}

async function readScene(gateway,id) {
  if(!/^[-A-Za-z0-9_]{1,96}$/.test(id||''))fail('A recorded scene_id is required.');
  const file=path.join(gateway.taskStore.rootDir,'traditional-scenes-v1',id+'.json');
  let saved;try {saved=JSON.parse(await fs.readFile(file,'utf8'));} catch(error){if(error.code==='ENOENT')fail('Scene is not recorded; create it through inputs.scene_plan first.');throw error;}
  const {integrity_hmac,...state}=saved;
  if(integrity_hmac!==await gateway.taskStore.mutationReceiptLedger.sign(state))fail('Scene record integrity mismatch.');
  const compiled=compileTraditionalScenePlan(state.plan);
  if(state.scene_plan_hash!==compiled.scene_plan_hash||state.runtime!=='queue'||state.roots.length!==compiled.jobs.length)fail('Native scene verification requires all immutable recorded roots.');
  return {state,compiled};
}

// A scene verification freezes current, trusted child sources. It does not
// grant mutation authority and cannot replace a changed/manual root baseline.
export async function verifyTraditionalScene(gateway,task) {
  if(Object.keys(task.inputs).some(k=>!['scene_id','runtime','timeout_ms','reverify','views','session_contract'].includes(k))||task.inputs.runtime!=='queue'||(task.inputs.views||task.inputs.session_contract)&&!task.private?.traditional_scene_verification)fail('Scene verification accepts only its recorded scene_id and queue read settings; views and connection are server-owned.');
  const {state,compiled}=await readScene(gateway,task.inputs.scene_id),sources=[];
  if(task.inputs.views&&sha256Canonical(task.inputs.views)!==sha256Canonical([compiled.plan.view]))fail('Scene view is server-owned and frozen by the recorded plan.');
  for(const entry of state.roots) {
    const source=await gateway.taskStore.getTask(entry.creation_task_id,{includePrivate:true}),creation=source.private?.creation,record=creation?.parameter_source;
    if(source.intent!=='create_model'||source.inputs.task?.kind!=='traditional_assembly'||!record||record.entries.length!==1||record.runtime!=='queue'||creation.parameter_edit_support?.baseline_captured!==true)fail('Each scene root needs its own trusted native creation source.');
    const {source_record_hash,...body}=record;
    if(source_record_hash!==sha256Canonical(body)||record.entries[0].source.task.assembly.representation?.scene_id!==compiled.scene_id)fail('Scene source binding changed or belongs to a different scene.');
    assertTraditionalAssemblyRuleBinding(record.entries[0].source.rule_binding);
    if(record.entries[0].source.rendering_version!==TRADITIONAL_RENDER_VERSION)fail('Scene rendering version requires an explicit migration.');
    sources.push({source,creation,record,entry});
  }
  const timeoutMs=task.inputs.timeout_ms??120000;
  if(!Number.isInteger(timeoutMs)||timeoutMs<5000||timeoutMs>900000)fail('Scene timeout must be 5000..900000 ms.');
  const adoption=await adoptAssemblySummary({bridge:gateway.bridge,rootPaths:sources.map(s=>s.record.entries[0].target.entity_path),recursiveLimit:5000,timeoutMs});
  const graph=buildModelGraph(adoption),modelKey=modelKeyForIdentity(modelIdentityForAdoption(adoption));
  for(const {record} of sources) {
    if(record.model_key!==modelKey)throw new AgentContractError('MODEL_IDENTITY_MISMATCH','Recorded scene roots belong to a different native document.');
    const drift=record.entries.flatMap(e=>compareDesignBindingFingerprints(e.design_graph,graph));
    if(drift.length)throw new AgentContractError('MODEL_REVISION_MISMATCH','A scene root diverged from its trusted source; reconcile it before scene verification.',{details:{divergence:drift}});
  }
  // Dispatch has no caller connection. Bind later delivery to a server-created
  // connection for the exact native summary just checked, rather than guessing
  // identity from a child's pre-creation connection or the current UI title.
  const sessionContract=(await gateway.bridge.create_queue_handshake({timeoutMs,expires_in_ms:300000})).session_contract;
  if(sessionContract.session_id!==adoption.session_id||sessionContract.document_id!==adoption.document_id
    ||sessionContract.model_revision!==adoption.model_revision
    ||modelKeyForIdentity(modelIdentityForAdoption({kind:'adopt_open_model',runtime:'queue',document_id:sessionContract.document_id,model_identity:sessionContract.model_identity}))!==modelKey) {
    throw new AgentContractError('MODEL_REVISION_MISMATCH','The scene document or revision changed before its delivery connection was recorded.');
  }
  const specs=sources.map(s=>compileModelAccessibilityTask(s.record.entries[0].source.task).bundle.detail_spec);
  const spec={...copy(specs[0]),scene_id:compiled.scene_id,deferred_scene_overview:false,
    required_parts:specs.flatMap(s=>s.required_parts),required_voids:specs.flatMap(s=>s.required_voids),
    connection_checks:specs.flatMap(s=>s.connection_checks),compiler_expected_values:specs.map(s=>s.compiler_expected_values),
    native_joint_checks:specs.flatMap(s=>s.native_joint_checks||[]),
    required_views:[{id:compiled.plan.view.id,kind:'overview',min_width:1400,min_height:900}]};
  const frozen=freezeDetailSpecification(spec),identity_map={},occurrence_path_map={};
  for(const {creation} of sources) {
    for(const [key,value] of Object.entries(creation.identity_map)) {if(identity_map[key]&&identity_map[key]!==value)fail('Ambiguous scene logical identity.');identity_map[key]=value;}
    Object.assign(occurrence_path_map,creation.occurrence_path_map||{});
  }
  const body={version:'traditional-scene-verification.v1',scene_id:compiled.scene_id,scene_plan_hash:compiled.scene_plan_hash,
    specification_hash:frozen.hash,model_revision:adoption.model_revision,model_key:modelKey,
    members:sources.map(s=>({creation_task_id:s.source.task_id,source_record_hash:s.record.source_record_hash}))};
  const proof={...body,integrity_hmac:await gateway.taskStore.mutationReceiptLedger.sign(body)};
  const previous=task.private?.creation,same=previous?.round?.snapshot?.model_revision===adoption.model_revision&&previous?.frozen_spec?.hash===frozen.hash;
  const creation={runtime:'queue',timber_rule_binding:traditionalAssemblyRuleBinding(),identity_map,occurrence_path_map,
    material_map:{},frozen_spec:frozen,rounds:[],per_part_failure_streak:{},
    round:{phase:'verification_snapshot',iteration:0,source_hash:sha256Canonical(body),snapshot:{...adoption.snapshot,model_revision:adoption.model_revision,model_revision_complete:true},
      captures:same?copy(previous.round.captures||[]):[],...(same?{capture_attempts:previous.round.capture_attempts||0}: {})}};
  task=await gateway.taskStore.update(task.task_id,{inputs:{...task.inputs,session_contract:sessionContract,views:[copy(compiled.plan.view)]},private:{...task.private,creation,traditional_scene_verification:proof}});
  if(task.state!=='verifying')task=await gateway.taskStore.transition(task.task_id,'verifying',{reason:'verify_recorded_traditional_scene'});
  task=await gateway.finalizeCreationQuality(task);
  return gateway.taskStore.update(task.task_id,{result:{...task.result,kind:'verify_scene_result',scene_id:compiled.scene_id,geometry_built:false},
    next_action:task.result.quality_accepted?{action:'connect_for_delivery',source_task_id:task.task_id}:task.next_action});
}

export async function dispatchTraditionalScene(gateway,task) {
  if(Object.keys(task.inputs).some(k=>!['scene_plan','runtime','timeout_ms','reverify'].includes(k))||!['mock','queue'].includes(task.inputs.runtime))fail('Scene creation uses only an explicit scene_plan, runtime and timeout.');
  const state=await startTraditionalScene({gateway,scenePlan:task.inputs.scene_plan,runtime:task.inputs.runtime,timeoutMs:task.inputs.timeout_ms??120000});
  const done=state.quality_accepted===true||state.state==='mock_geometry_created';
  return gateway.taskStore.transition(task.task_id,done?'completed':'awaiting_input',{reason:'traditional_scene_children_dispatched',patch:{
    result:{kind:'traditional_scene_dispatch',...state,evidence_level:state.quality_accepted?'live_runtime':'scene_tasks_only'},
    next_action:state.quality_accepted?{action:'connect_for_delivery',source_task_id:state.verification_task_id}:state.next_action||{action:'resume_scene_dispatch',task_id:task.task_id,quality_accepted:false}}});
}

export async function assertTraditionalSceneVerification({source,taskStore}) {
  const proof=source.private?.traditional_scene_verification;
  if(!proof)fail('Scene verification has no server proof.');
  const {integrity_hmac,...body}=proof;
  if(proof.version!=='traditional-scene-verification.v1'||integrity_hmac!==await taskStore.mutationReceiptLedger.sign(body)||proof.model_revision!==source.private?.creation?.round?.snapshot?.model_revision||proof.specification_hash!==source.private.creation.frozen_spec.hash)fail('Scene verification proof changed.');
  const {compiled,state}=await readScene({taskStore},proof.scene_id);
  if(compiled.scene_plan_hash!==proof.scene_plan_hash||proof.members.length!==state.roots.length)fail('Scene verification membership changed.');
  for(const member of proof.members) {
    if(!state.roots.some(r=>r.creation_task_id===member.creation_task_id))fail('Unknown scene member.');
    const child=await taskStore.getTask(member.creation_task_id,{includePrivate:true});
    const record=child.private?.creation?.parameter_source;
    if(!record)fail('Scene source disappeared.');
    const {source_record_hash,...recordBody}=record;
    if(source_record_hash!==member.source_record_hash||source_record_hash!==sha256Canonical(recordBody))fail('Scene parameters changed after verification; verify the scene again.');
  }
  return true;
}
