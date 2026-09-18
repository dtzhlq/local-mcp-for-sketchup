import {sha256Canonical} from './agent-contract.mjs';

// Only this local heuristic warning may become background information. Errors,
// collisions, explicit requirements and missing/incomplete evidence stay blocking.
const eligible = issue => issue.type === 'layout.unanchored_detail' && issue.severity === 'warn' && typeof issue.item === 'string';
const digest = context => sha256Canonical(context);
export async function captureCreationQaBaseline(bridge, runtime, spec, timeoutMs) {
  if (Object.keys(spec || {}).length) return {version:1,available:false,reason:'explicit_layout_requirements'};
  try {
    const inspected=await bridge.inspect_model({runtime,includeSnapshot:true,timeoutMs});
    const qa=await bridge.validate_model({snapshot:inspected.snapshot,runtime,includePreview:false});
    const issues=(qa.issues||[]).filter(eligible);
    if(!issues.length)return {version:1,available:true,issues:[],reason:'no_existing_local_warnings'};
    const query=await bridge.query_model_geometry({runtime,detail:'full',max_vertices:100000,timeoutMs});
    if(!query.complete)return {version:1,available:false,reason:'baseline_geometry_incomplete'};
    // A concurrent edit between the two probes cannot establish a baseline.
    if(inspected.snapshot.model_revision && inspected.snapshot.model_revision!==query.model_revision)return {version:1,available:false,reason:'baseline_revision_changed'};
    return {version:1,available:true,issues,snapshot_handle:query.snapshot_handle,model_revision:query.model_revision,document_id:query.snapshot.document_id??null,model_identity:query.snapshot.model_identity??null,contexts:query.snapshot.contexts.map(c=>({entity_path:c.entity_path,name:c.name,digest:digest(c)}))};
  } catch(error) {return {version:1,available:false,reason:'baseline_probe_failed',error_code:error.code??null};}
}
export function scopeCreationQa(qa, baseline, current, expectedRevision) {
  const evidence={version:'creation-qa-scope.v1',baseline_available:baseline?.available===true,reason:'conservative_whole_model_check',background_count:0};
  const unchanged=baseline?.available && baseline.contexts?.length && current?.complete && (!expectedRevision||current.model_revision===expectedRevision) && (current.document_id??null)===baseline.document_id && sha256Canonical(current.model_identity??null)===sha256Canonical(baseline.model_identity);
  if(!unchanged)return {...qa,scope_evidence:evidence};
  const currentByPath=new Map(current.contexts.map(c=>[c.entity_path,c]));
  if(!baseline.contexts.every(c=>currentByPath.has(c.entity_path)&&digest(currentByPath.get(c.entity_path))===c.digest))return {...qa,scope_evidence:{...evidence,reason:'existing_geometry_changed'}};
  const signatures=new Set((baseline.issues||[]).map(sha256Canonical));
  const background=[],issues=[];
  for(const issue of qa.issues||[]){
    const matches=baseline.contexts.filter(c=>c.name===issue.item);
    if(eligible(issue)&&signatures.has(sha256Canonical(issue))&&matches.length===1&&current.contexts.filter(c=>c.name===issue.item).length===1)background.push(issue);else issues.push(issue);
  }
  const by_severity={error:0,warn:0,info:0},by_type={};
  for(const issue of issues){by_severity[issue.severity]=(by_severity[issue.severity]||0)+1;by_type[issue.type]=(by_type[issue.type]||0)+1;}
  const verdict=by_severity.error?'fail':by_severity.warn?'review':'pass';
  return {...qa,ok:by_severity.error===0,level:by_severity.error?'error':by_severity.warn?'warn':'ok',verdict,issues,background_issues:background,summary:{...qa.summary,total:issues.length,by_severity,by_type},scope_evidence:{...evidence,reason:'unchanged_pre_existing_local_warnings',baseline_revision:baseline.model_revision,current_revision:current.model_revision,background_count:background.length}};
}
export async function applyCreationQaScope(bridge,qa,creation,snapshot,timeoutMs){
  if(!creation.qa_baseline?.issues?.length)return {...qa,scope_evidence:{version:'creation-qa-scope.v1',background_count:0,reason:creation.qa_baseline?.reason??'no_trusted_precreation_baseline'}};
  try{const query=await bridge.query_model_geometry({runtime:creation.runtime,detail:'full',max_vertices:100000,timeoutMs});return scopeCreationQa(qa,creation.qa_baseline,query.snapshot,snapshot.model_revision);}
  catch(error){return {...qa,scope_evidence:{version:'creation-qa-scope.v1',background_count:0,reason:'readback_unavailable',error_code:error.code??null}};}
}
