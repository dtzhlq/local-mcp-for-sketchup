import assert from 'node:assert/strict';
import { adoptAssemblySummary, rootPathsFromCommittedSnapshot } from '../src/model-accessibility-assembly-summary.mjs';
import { buildModelGraph, validateModelGraphSemantics } from '../src/model-graph.mjs';

const hash = digit => `sha256:${digit.repeat(64)}`;
let revision = hash('a'), subtree = hash('b'), reads = 0;
const root = () => ({ path:'pid:1', entity_path:'pid:1', parent_entity_path:null,
  path_segments:[{entity_type:'component_instance',persistent_id:'1',reference:'house'}],
  id:'house', reference:'house', persistent_id:'1', entity_type:'component_instance',
  entity_definition_name:'house', entity_definition_persistent_id:'10', entity_definition_occurrence_count:1,
  geometry_summary:{type:'assembly_merkle',version:1,subtree_digest:subtree,expanded_count:100000,leaf_entities_materialized:false} });
const bridge = { async adopt_open_model(options) {
  if(options.recursive) reads++;
  return { kind:'adopt_open_model',version:'fixture',runtime:'queue',read_only:true,
    assembly_summary_depth:2,recursive_projection:'assembly-merkle.v2',occurrence_contract:'canonical-assembly-path.v2',
    document_id:'doc-1',session_id:'session-1',model_identity:{runtime_object_id:'model-1'},
    model_revision:revision,model_revision_complete:true,model_revision_total_seen:100001,model_revision_indexed:100001,
    entities:[root()],snapshot:{groups:[],instances:[],materials:[],tags:[],scenes:[]},
    recursive:options.recursive,assembly_projection_complete:options.recursive,
    recursive_index:options.recursive?[root()]:null,recursive_total_seen:options.recursive?1:0,
    recursive_truncated:false,recursive_root_paths:options.recursive_roots || null };
} };
const first = await adoptAssemblySummary({bridge,rootPaths:['pid:1']});
assert.equal(first.snapshot.model_revision_complete,true);
assert.equal(first.snapshot.model_revision,revision);
const graph = buildModelGraph(first);
assert.equal(graph.completeness.assembly_scope_complete,true);
assert.equal(graph.completeness.complete,false);
assert.equal(graph.completeness.scope_complete,false);
assert.equal(validateModelGraphSemantics(graph),true);
first.recursive_index[0].geometry_summary.subtree_digest=hash('f');
assert.equal((await adoptAssemblySummary({bridge,rootPaths:['pid:1']})).recursive_index[0].geometry_summary.subtree_digest,hash('b'));
assert.equal(reads,1,'unchanged native revision reuses immutable server-owned summary');
revision=hash('c');subtree=hash('d');
const changed=await adoptAssemblySummary({bridge,rootPaths:['pid:1']});
assert.equal(reads,2,'native revision change cannot reuse previous geometry proof');
assert.equal(changed.recursive_index[0].geometry_summary.subtree_digest,hash('d'));
assert.equal(changed.snapshot.model_revision,revision,'delivery snapshot follows the fresh native revision');
const committedRoots=rootPathsFromCommittedSnapshot({instances:[{id:'house',persistent_id:'1'}]},['house']);
const beforeSingleRead=reads;
await adoptAssemblySummary({bridge,rootPaths:committedRoots,expectedRevision:revision});
assert.equal(reads,beforeSingleRead+1,'committed creation needs one complete native assembly read');
await assert.rejects(adoptAssemblySummary({bridge,rootPaths:committedRoots,expectedRevision:hash('e')}),
  error=>error.code==='MODEL_REVISION_MISMATCH');
console.log('Assembly summary coverage, immutable reuse and native revision invalidation passed.');

const {evaluateTimberQuality,TIMBER_QUALITY_SCOPE}=await import('../src/traditional-timber/quality.mjs');
const {freezeDetailSpecification}=await import('../src/detail-quality.mjs');
const frozen=freezeDetailSpecification({version:1,coverage_version:TIMBER_QUALITY_SCOPE,required_parts:[{id:'house',instance_path:['house'],require_visible:true}],required_views:[{id:'overview',min_width:1400,min_height:900}]});
const native=structuredClone(changed);native.recursive_index[0].bounding_box={min:[0,0,0],max:[100,200,300]};native.recursive_index[0].visible=true;
const creation={frozen_spec:frozen,identity_map:{}},captures=[{id:'overview',server_verified:true,model_revision:native.model_revision,width:1600,height:1000}];
assert.equal(evaluateTimberQuality({summary:native,creation,captures}).quality_status,'pass');
native.recursive_index=[];
assert.equal(evaluateTimberQuality({summary:native,creation,captures}).quality_status,'fail','rule expectations cannot replace missing native assemblies');
console.log('Bounded timber evidence rejects missing native assemblies.');
