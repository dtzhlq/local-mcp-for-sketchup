import { sha256Canonical, AgentContractError } from '../agent-contract.mjs';
import { adoptAssemblySummary, rootPathsFromCommittedSnapshot } from '../model-accessibility-assembly-summary.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const TIMBER_QUALITY_SCOPE='timber-assembly-summary.v1';
// The detail-capture path preserves always-face-camera instances while exporting.
// A plain View#write_image can rotate SketchUp's template person and change the
// full native revision even though the hall itself was untouched.
export async function captureTimberOverview({bridge, view, outputDir, modelRevision, timeoutMs, sessionContract}) {
 const file=path.join(outputDir,`${view.id}.png`);
 const result=await bridge.capture_detail_views({runtime:'queue',output_dir:outputDir,
  views:[{id:view.id,kind:'overview',width:Math.max(1400,view.min_width||0),height:Math.max(900,view.min_height||0)}],
  timeoutMs,session_contract:sessionContract});
 return proveTimberOverview({result, view, file, modelRevision});
}
async function proveTimberOverview({result, view, file, modelRevision}) {
 const capture=result?.captures?.[0],restore=result?.restoration;
 if(result?.kind!=='capture_detail_views'||result?.runtime!=='queue'||result?.status!=='captured_and_restored'
   ||result?.restored!==true||result?.capture_scope!=='camera_only'||result.captures.length!==1
   ||capture?.id!==view.id||path.resolve(capture?.file_path||'')!==path.resolve(file)
   ||capture?.model_revision_binding!=='restored_source_revision'||capture?.model_revision_complete!==true
   ||capture?.model_revision!==modelRevision||restore?.model_revision_before!==modelRevision
   ||restore?.model_revision_after!==modelRevision||restore?.model_revision_restored!==true
   ||restore?.camera_restored!==true||restore?.native_state_restored!==true
   ||!['not_needed','restored_exact_native_matrices'].includes(restore?.camera_facing_recovery?.status))
   throw new AgentContractError('MODEL_REVISION_MISMATCH','Overview was not restored to the accepted native revision.',{
    details:{expected_revision:modelRevision,revision_before:restore?.model_revision_before,
      revision_after:restore?.model_revision_after,capture_revision:capture?.model_revision,
      camera_facing_recovery:restore?.camera_facing_recovery?.status,restored:result?.restored}});
 const bytes=await fs.readFile(file);
 if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Native overview is not a PNG');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 if(width!==capture.width||height!==capture.height||createHash('sha256').update(bytes).digest('hex')!==capture.sha256)
  throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR','Native overview bytes do not match the restored capture receipt.');
 return {kind:'timber_overview',restored:true,captures:[{id:view.id,path:file,width,height,
  sha256:createHash('sha256').update(bytes).digest('hex'),model_revision:modelRevision,server_verified:true,
  evidence:'native_view_write_image',evidence_level:'live_runtime',restoration:restore}]};
}

// A screenshot may finish just after the queue deadline. Recover only this
// task's exact output, with a fresh complete model revision and native identity.
// Persist an authenticated receipt before consuming the native response.
export async function recoverTimberOverview({bridge, taskStore, taskId, view, priorOutputDirs, summary, timeoutMs}) {
 const runtime=bridge.selectRuntime('queue',{timeoutMs});
 const state=await runtime.getSessionState();
 if(state?.session_id!==summary.session_id||state?.document_id!==summary.document_id
   ||state?.model_revision_complete!==true||state?.model_revision!==summary.model_revision)
  throw new AgentContractError('MODEL_REVISION_MISMATCH','Late overview recovery requires the same live document and accepted revision.');
 const paths=priorOutputDirs.map(dir=>path.resolve(dir,`${view.id}.png`));
 const validate=async result=>{
  if(result?.kind!=='capture_detail_views'||!paths.includes(path.resolve(result.captures?.[0]?.file_path||''))
    ||result?.restoration?.model_revision_before!==summary.model_revision)
   throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR','Late overview is not bound to this task and native document.');
  return proveTimberOverview({result,view,file:result.captures[0].file_path,modelRevision:summary.model_revision});
 };
 const names=(await fs.readdir(runtime.responseDir)).filter(n=>n.endsWith('.json'));
 if(names.length===1){
  const responsePath=path.join(runtime.responseDir,names[0]),stat=await fs.lstat(responsePath);
  if(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<1024*1024){
   const candidate=JSON.parse(await fs.readFile(responsePath,'utf8'))?.result;
   if(candidate?.kind==='capture_detail_views'&&paths.includes(path.resolve(candidate.captures?.[0]?.file_path||''))){
    let captured;
    await runtime.recoverOrphanResponse({requestId:names[0].slice(0,-5),expectedResultKind:'capture_detail_views',
     validate:async result=>{captured=await validate(result);},
     persist:async result=>{
      const body={version:'timber-overview-recovery.v1',task_id:taskId,result,image_sha256:captured.captures[0].sha256};
      const proof={...body,integrity_hmac:await taskStore.mutationReceiptLedger.sign(body)};
      const receipt=path.join(path.dirname(result.captures[0].file_path),'native-overview-receipt.json');
      const tmp=receipt+'.pending';await fs.writeFile(tmp,JSON.stringify(proof),{mode:0o600});await fs.rename(tmp,receipt);
     }});
    return captured;
   }
  }
 }
 if(names.length) return null;
 for(const dir of priorOutputDirs){
  let proof;try{proof=JSON.parse(await fs.readFile(path.join(dir,'native-overview-receipt.json'),'utf8'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
  const {integrity_hmac,...body}=proof;
  if(body.version!=='timber-overview-recovery.v1'||body.task_id!==taskId||integrity_hmac!==await taskStore.mutationReceiptLedger.sign(body))
   throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR','Saved overview recovery receipt failed authentication.');
  const captured=await validate(body.result);
  if(captured.captures[0].sha256!==body.image_sha256)throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR','Recovered overview image changed after its receipt.');
  return captured;
 }
 return null;
}

export function timberDetailSpecification(graph,views,ruleBinding){
 const index=new Map(graph.parts.map(part=>[part.id,part]));
 const required_parts=graph.roots.flatMap(root=>index.get(root.part_id).assembly.children.map(child=>({
  id:child.part_id,role:index.get(child.part_id).role,instance_path:[root.instance_id,child.instance_id||child.part_id],
  require_visible:true
 })));
 return {version:1,coverage_version:TIMBER_QUALITY_SCOPE,scene_id:graph.id,detail_level:'detailed',rule_binding:ruleBinding,
  required_parts,required_voids:[],required_views:views.map(v=>({id:v.id,kind:v.kind,instance_path:v.instance_path,min_width:1400,min_height:900})),max_iterations:1};
}
export async function readTimberQualitySummary({bridge,creation,timeoutMs}){
 const spec=creation.frozen_spec?.specification;
 if(spec?.coverage_version!==TIMBER_QUALITY_SCOPE||creation.runtime!=='queue')throw new AgentContractError('INVALID_ARGUMENT','Timber quality requires its frozen native assembly contract.');
 const roots=[...new Set(spec.required_parts.map(part=>(creation.occurrence_path_map?.[JSON.stringify(part.instance_path)]||part.instance_path.map(id=>creation.identity_map[id]||id))[0]))];
 return adoptAssemblySummary({bridge,rootPaths:rootPathsFromCommittedSnapshot(creation.round.snapshot,roots),
  expectedRevision:creation.round.snapshot.model_revision,timeoutMs,
  recursiveLimit:Math.min(5000,bridge.executionPolicy?.resource_limits?.max_recursive_entities||5000)});
}
// This deliberately reports only the measured assembly contract. It makes no
// claim about every face, hidden joinery or collision-free historical accuracy.
export function evaluateTimberQuality({summary,creation,captures=[]}){
 const spec=creation.frozen_spec?.specification,issues=[],measurements=[];
 if(spec?.coverage_version!==TIMBER_QUALITY_SCOPE||sha256Canonical(spec)!==creation.frozen_spec.hash
   ||summary?.runtime!=='queue'||summary.read_only!==true||summary.assembly_projection_complete!==true||summary.recursive_truncated!==false
   ||summary.assembly_summary_depth!==2||summary.recursive_projection!=='assembly-merkle.v2'||summary.model_revision_complete!==true){
  throw new AgentContractError('MODEL_REVISION_INCOMPLETE','A complete native timber assembly summary is required.');
 }
 const rows=summary.recursive_index,byPath=new Map(rows.map(row=>[row.entity_path,row]));
 const byIdentity=new Map();
 for(const row of rows){const key=JSON.stringify(row.path_segments.map(segment=>String(segment.reference||segment.persistent_id)));const items=byIdentity.get(key)||[];items.push(row);byIdentity.set(key,items);}
 for(const part of spec.required_parts){
  const path=creation.occurrence_path_map?.[JSON.stringify(part.instance_path)]||part.instance_path.map(id=>creation.identity_map[id]||id);
  const matches=byIdentity.get(JSON.stringify(path))||[];
  const fail=reason=>issues.push({type:reason,part_id:part.id,part_key:JSON.stringify(part.instance_path),status:'fail'});
  if(matches.length!==1){fail('timber.required_assembly_missing_or_ambiguous');continue;}
  const row=matches[0],box=row.bounding_box;
  let current=row,visible=true;while(current){if(current.visible!==true)visible=false;current=byPath.get(current.parent_entity_path);}
  if(!visible){fail('timber.required_assembly_hidden');continue;}
  if(row.geometry_summary?.type!=='assembly_merkle'||!(row.geometry_summary.expanded_count>0)||!box?.min||!box?.max||box.max.some((v,i)=>!Number.isFinite(v)||v<=box.min[i])){fail('timber.required_assembly_empty_or_unmeasured');continue;}
  measurements.push({part_id:part.id,entity_path:row.entity_path,kind:'native_measured_values',bounds_mm:box,subtree_digest:row.geometry_summary.subtree_digest});
 }
 for(const view of spec.required_views)if(!captures.some(c=>c.id===view.id&&c.server_verified===true&&c.model_revision===summary.model_revision&&c.width>=view.min_width&&c.height>=view.min_height))issues.push({type:'timber.overview_unverified',view_id:view.id,status:'unverified'});
 const status=issues.some(i=>i.status==='fail')?'fail':issues.length?'unverified':'pass';
 return {version:TIMBER_QUALITY_SCOPE,quality_status:status,quality_accepted:status==='pass',evidence_level:'live_runtime',
  specification_hash:creation.frozen_spec.hash,model_revision:summary.model_revision,required_parts:spec.required_parts.length,
  measured_parts:measurements.length,measurements,issues,remaining:issues,
  validation_scope:'required_major_assemblies_present_visible_nonempty_and_one_overview',
  visible_joint_review:'not_inferred_from_bounds_or_hashes',historical_accuracy_certified:false};
}
