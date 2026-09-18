import {computeCadShape} from './cad-kernel.mjs';
import fs from 'node:fs/promises';
import {decodeGeometryCursor,geometryPage} from './geometry-pages.mjs';
import path from 'node:path';
import { AgentContractError, sha256Canonical, serverPolicyAutoApprovalMode } from './agent-contract.mjs';
import { dot, cross, subtract, add, scaleVector } from './geometry-matrix.mjs';
import { validateGeometryEdits } from './model-geometry-contract.mjs';
const fail=(code,message)=>{throw new AgentContractError(code,message);};
export class ModelGeometryService {
  constructor(bridge){this.bridge=bridge;this.root=path.join(bridge.taskStore.rootDir,'geometry-snapshots-v1');}
  async load(handle){
    if(typeof handle!=='string'||!/^geometry:[a-f0-9]{64}$/.test(handle))fail('INVALID_ARGUMENT','Invalid geometry snapshot handle');
    let value;try{value=JSON.parse(await fs.readFile(path.join(this.root,handle.slice(9)+'.json'),'utf8'));}catch(error){if(error.code==='ENOENT')fail('ARTIFACT_NOT_FOUND','Geometry snapshot not found');throw error;}
    if(sha256Canonical(value).slice(7)!==handle.slice(9))fail('ARTIFACT_INTEGRITY_ERROR','Geometry snapshot hash mismatch');return value;
  }
  async query(options={}){
    const cursor=options.cursor?decodeGeometryCursor(options.cursor):null;
    if(cursor&&options.snapshot_handle&&cursor.handle!==options.snapshot_handle)fail('INVALID_ARGUMENT','Cursor belongs to another snapshot');
    if(cursor)options={...options,snapshot_handle:cursor.handle};
    const paged=!!cursor||options.page_size!==undefined;
    const runtime=options.runtime??'mock';
    const snapshot=options.snapshot_handle?await this.load(options.snapshot_handle):await this.bridge.selectRuntime(runtime,{timeoutMs:options.timeoutMs}).queryModelGeometry({targets:options.targets,recursive:options.recursive??true,max_vertices:paged?2000000:(options.max_vertices??10000),max_contexts:options.max_contexts??256});
    if(snapshot.runtime==='mock'&&!options.snapshot_handle)snapshot.model_identity={session_path:path.resolve(this.bridge.mockRuntime.sessionPath)};
    const digest=sha256Canonical(snapshot).slice(7),handle=`geometry:${digest}`;
    await fs.mkdir(this.root,{recursive:true,mode:0o700});
    try{await fs.writeFile(path.join(this.root,digest+'.json'),JSON.stringify(snapshot),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
    const page=paged?geometryPage(snapshot,handle,options):null;
    return {kind:'query_model_geometry',runtime:snapshot.runtime,snapshot_handle:handle,resource_uri:`geometry://${digest}`,model_revision:snapshot.model_revision,complete:snapshot.complete&&(!page||!page.page.has_more),units:'mm',frozen:!!options.snapshot_handle,
      contexts:snapshot.contexts.map(c=>({entity_path:c.entity_path,name:c.name,...(c.cad?{cad:{current:c.cad.current,source_hash:c.cad.source_hash,kernel:c.cad.kernel}}:{}),shared_definition:c.shared_definition,vertices:c.vertices.length,edges:c.edges.length,faces:c.faces.length,manifold:c.manifold})),
      ...(page?{page:page.page}:{}),...(options.detail==='full'?{snapshot:page?.snapshot??snapshot}:{}),next_action:page?.page.next_cursor?{action:'query_model_geometry',cursor:page.page.next_cursor}:snapshot.complete?null:{action:'query_smaller_scope_or_increase_budget'}};
  }
  async freshSnapshot(options){const result=await this.query({...options,detail:'full'});return result.snapshot;}
  async measure(options={}){
    const queries=options.queries;
    if(!Array.isArray(queries)||!queries.length||queries.length>100)fail('INVALID_ARGUMENT','queries must contain 1..100 measurements');
    const targets=[...new Set(queries.flatMap(q=>[q.entity_path,q.other?.entity_path].filter(Boolean)))];
    const snapshot=options.snapshot_handle?await this.load(options.snapshot_handle):await this.freshSnapshot({...options,targets:targets.length?targets:undefined});
    if(!snapshot.complete)fail('MODEL_REVISION_INCOMPLETE','Cannot measure a truncated geometry snapshot');
    return {kind:'measure_model_geometry',runtime:snapshot.runtime,model_revision:snapshot.model_revision,results:queries.map(q=>measure(snapshot,q,options.max_pairs??200000))};
  }
  async edit(options={}){
    if(!options.idempotency_key)fail('INVALID_ARGUMENT','A stable idempotency_key is required');
    const fingerprint=sha256Canonical({...options,session_contract:undefined});
    const journalPath=path.join(this.root,'edit-'+sha256Canonical(options.idempotency_key)+'.json');
    let journal;try{journal=JSON.parse(await fs.readFile(journalPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    if(journal){if(journal.fingerprint!==fingerprint)fail('IDEMPOTENCY_CONFLICT','Edit key is bound to different arguments');return this.advanceAutomaticEdit(await this.bridge.start_agent_task(journal.request),options,journal.request.inputs.runtime);}
    validateGeometryEdits(options.edits);
    const snapshot=await this.load(options.snapshot_handle);
    if(!snapshot.complete)fail('MODEL_REVISION_INCOMPLETE','Cannot edit a truncated snapshot');
    if(options.runtime&&options.runtime!==snapshot.runtime)fail('INVALID_ARGUMENT','Snapshot runtime mismatch');
    const context=snapshot.contexts.find(c=>c.entity_path===options.entity_path);
    if(!context||! /^(model|pid:[1-9]\d*(?:\.[1-9]\d*)*)$/.test(context.entity_path))fail('INVALID_ARGUMENT','An exact model, group or instance context is required');
    const fresh=await this.freshSnapshot({runtime:snapshot.runtime,targets:[context.entity_path],recursive:false,max_vertices:100000});
    if(fresh.model_revision!==snapshot.model_revision||sha256Canonical(fresh.model_identity)!==sha256Canonical(snapshot.model_identity)||fresh.document_id!==snapshot.document_id)fail('MODEL_REVISION_MISMATCH','Geometry snapshot is stale or belongs to another document');
    const handles=new Set([...context.vertices,...context.edges,...context.faces].map(e=>e.handle));
    for(const e of options.edits)for(const h of [...(e.handles??[]),...(e.moves??[]).map(m=>m.handle),...(e.handle?[e.handle]:[])])if(!handles.has(h))fail('INVALID_ARGUMENT',`Handle is outside the selected context: ${h}`);
    const edits=options.edits.map(e=>{if(e.op!=='replace_cad')return e;if(options.edits.length!==1||context.entity_path==='model'||!context.cad?.current)fail('INVALID_ARGUMENT','CAD replacement requires one current parametric context and a sole edit');return {...e,mesh:computeCadShape(e)};});
    const root=context.review_root??context.entity_path.split('.')[0];
    const operation={op:'edit_geometry',entity_path:root,context_path:context.entity_path,edit_scope:'instance_path',instance_policy:'definition_wide',snapshot_revision:snapshot.model_revision,edits};
    const request={intent:'reviewed_existing_model_edit',instruction:options.instruction||'Apply the specified local geometry edits and preserve other occurrences.',idempotency_key:options.idempotency_key,inputs:{runtime:snapshot.runtime,operations:[operation],targets:[{entity_path:root,edit_scope:'instance_path',instance_policy:'definition_wide'}],...(root==='model'?{}:{recursive_roots:[root]}),recursive_limit:this.bridge.executionPolicy.resource_limits.max_recursive_entities,save_model:false}};
    await fs.mkdir(this.root,{recursive:true,mode:0o700});
    try{await fs.writeFile(journalPath,JSON.stringify({fingerprint,request}),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;const winner=JSON.parse(await fs.readFile(journalPath,'utf8'));if(winner.fingerprint!==fingerprint)fail('IDEMPOTENCY_CONFLICT','Concurrent edit key conflict');return this.bridge.start_agent_task(winner.request);}
    return this.advanceAutomaticEdit(await this.bridge.start_agent_task(request),options,snapshot.runtime);
  }
  async advanceAutomaticEdit(result,options,runtime){
    const taskId=result.task_id??result.task?.task_id;
    if(!taskId)return result;
    const task=await this.bridge.taskStore.getTask(taskId,{includePrivate:true});
    const plan=task.private?.existing_edit_plan;
    // Never replay an executing/unknown-outcome task. Only submit a reviewed plan.
    if(!['awaiting_review','approved'].includes(task.state)||!plan||!serverPolicyAutoApprovalMode(plan,this.bridge.executionPolicy))return result;
    const contract=options.session_contract??(runtime==='queue'?(await this.bridge.create_queue_handshake()).session_contract:undefined);
    return this.bridge.submit_agent_task_input({task_id:taskId,idempotency_key:options.idempotency_key+':apply:'+plan.plan_id,input:{...(contract?{session_contract:contract}:{})}});
  }
}
function feature(snapshot,ref){const c=snapshot.contexts.find(c=>c.entity_path===ref.entity_path);if(!c)throw new Error('Geometry context not found');if(!ref.handle)return {context:c,faces:c.faces,edges:c.edges,vertices:c.vertices};const found=[...c.vertices,...c.edges,...c.faces].find(x=>x.handle===ref.handle);if(!found)throw new Error('Geometry handle not found');return {context:c,faces:ref.handle.startsWith('f:')?[found]:[],edges:ref.handle.startsWith('e:')?[found]:[],vertices:ref.handle.startsWith('v:')?[found]:[],selected:found};}
function primitives(f){const byId=new Map(f.context.vertices.map(v=>[v.handle,v.world_position]));return {points:f.vertices.map(v=>v.world_position),segments:f.edges.map(e=>e.vertices.map(h=>byId.get(h))),triangles:f.faces.flatMap(face=>face.triangles)};}
function measure(snapshot,q,maxPairs){
  try{
    const f=feature(snapshot,q);let value,units,method;
    if(q.kind==='length'){if(!f.edges.length)throw new Error('Length requires edges');value=f.edges.reduce((s,e)=>s+e.length_mm,0);units='mm';method='world_edge_lengths';}
    else if(q.kind==='area'){if(!f.faces.length)throw new Error('Area requires faces');value=f.faces.reduce((s,e)=>s+e.area_mm2,0);units='mm2';method='world_face_areas';}
    else if(q.kind==='volume'){if(q.handle||!f.context.manifold)throw new Error('Volume requires a complete closed manifold context');value=Math.abs(f.faces.flatMap(e=>e.triangles).reduce((s,t)=>s+dot(t[0],cross(t[1],t[2]))/6,0));units='mm3';method='oriented_native_mesh_volume';}
    else if(q.kind==='distance'){value=geometryDistance(primitives(f),primitives(feature(snapshot,q.other)),maxPairs);units='mm';method='minimum_world_geometry_distance';}
    else if(q.kind==='angle'){const direction=f=>{if(f.faces.length===1)return f.faces[0].world_normal;if(f.edges.length===1){const p=primitives(f).segments[0];return subtract(p[1],p[0]);}throw new Error('Angle requires a single edge or face per operand');};const a=direction(f),b=direction(feature(snapshot,q.other));value=Math.acos(Math.max(-1,Math.min(1,dot(a,b)/(Math.hypot(...a)*Math.hypot(...b)))))*180/Math.PI;units='degrees';method='world_direction_angle';}
    else throw new Error('Unsupported measurement kind');
    if(!Number.isFinite(value))throw new Error('Measurement is not finite');
    return {query:q,status:'available',value,units,method};
  }catch(error){return {query:q,status:'unavailable',reason:error.message};}
}
const norm2=v=>dot(v,v);
function pointSegment(p,a,b){const d=subtract(b,a),t=Math.max(0,Math.min(1,dot(subtract(p,a),d)/(norm2(d)||1)));return norm2(subtract(p,add(a,scaleVector(d,t))));}
function segmentSegment(p,q,a,b){const u=subtract(q,p),v=subtract(b,a),w=subtract(p,a),aa=dot(u,u),bb=dot(u,v),cc=dot(v,v),dd=dot(u,w),ee=dot(v,w),den=aa*cc-bb*bb;let best=Math.min(pointSegment(p,a,b),pointSegment(q,a,b),pointSegment(a,p,q),pointSegment(b,p,q));if(Math.abs(den)>1e-15){const s=(bb*ee-cc*dd)/den,t=(aa*ee-bb*dd)/den;if(s>=0&&s<=1&&t>=0&&t<=1)best=Math.min(best,norm2(subtract(add(p,scaleVector(u,s)),add(a,scaleVector(v,t)))));}return best;}
function pointTriangle(p,a,b,c){const u=subtract(b,a),v=subtract(c,a),n=cross(u,v),n2=norm2(n);if(n2<1e-20)return Math.min(pointSegment(p,a,b),pointSegment(p,b,c),pointSegment(p,c,a));const d=dot(subtract(p,a),n)/n2,projection=subtract(p,scaleVector(n,d));if([dot(cross(subtract(b,a),subtract(projection,a)),n),dot(cross(subtract(c,b),subtract(projection,b)),n),dot(cross(subtract(a,c),subtract(projection,c)),n)].every(x=>x>=-1e-10))return d*d*n2;return Math.min(pointSegment(p,a,b),pointSegment(p,b,c),pointSegment(p,c,a));}
function segmentTriangle(p,q,t){const n=cross(subtract(t[1],t[0]),subtract(t[2],t[0])),u=subtract(q,p),den=dot(n,u);if(Math.abs(den)>1e-14){const s=dot(n,subtract(t[0],p))/den;if(s>=0&&s<=1&&pointTriangle(add(p,scaleVector(u,s)),...t)<1e-14)return 0;}return Math.min(pointTriangle(p,...t),pointTriangle(q,...t),...t.map((v,i)=>segmentSegment(p,q,v,t[(i+1)%3])));}
export function geometryDistance(a,b,maxPairs=200000){
  const features=g=>[...g.points.map(p=>({p})),...g.segments.map(s=>({s})),...g.triangles.map(t=>({t}))];
  const aa=features(a),bb=features(b);if(!aa.length||!bb.length)throw new Error('No measurable geometry');if(aa.length*bb.length>maxPairs)throw new Error('Distance computation budget exceeded');let best=Infinity;
  for(const a of aa)for(const b of bb){let d;if(a.p&&b.p)d=norm2(subtract(a.p,b.p));else if(a.p&&b.s)d=pointSegment(a.p,...b.s);else if(a.s&&b.p)d=pointSegment(b.p,...a.s);else if(a.p&&b.t)d=pointTriangle(a.p,...b.t);else if(a.t&&b.p)d=pointTriangle(b.p,...a.t);else if(a.s&&b.s)d=segmentSegment(...a.s,...b.s);else if(a.s&&b.t)d=segmentTriangle(...a.s,b.t);else if(a.t&&b.s)d=segmentTriangle(...b.s,a.t);else d=Math.min(...a.t.map((p,i)=>segmentTriangle(p,a.t[(i+1)%3],b.t)),...b.t.map((p,i)=>segmentTriangle(p,b.t[(i+1)%3],a.t)));best=Math.min(best,d);if(best<1e-16)return 0;}
  return Math.sqrt(best);
}
