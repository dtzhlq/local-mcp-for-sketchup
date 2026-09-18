// Shared output contracts. Open extension maps are deliberate: SketchUp attributes,
// capability versions and user-program results are not a closed vocabulary.
const str={type:'string'},num={type:'number'},bool={type:'boolean'},integer={type:'integer'};
const json={$ref:'#/$defs/json'},arr=items=>({type:'array',items}),nullable=s=>({anyOf:[s,{type:'null'}]});
const obj=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:json});
const map={type:'object',additionalProperties:json};
const point=arr(num);point.minItems=3;point.maxItems=3;
const bbox=nullable(obj({min:point,max:point,size:point,center:point}));
const warning=obj({code:str,type:str,severity:str,message:str,source:nullable(str)});
const entity=obj({id:str,persistent_id:{type:['string','number']},name:nullable(str),entity_path:str,entity_type:str,kind:str,definition:nullable(str),visible:bool,locked:bool,faces:integer,edges:integer,vertices:integer,bounding_box:bbox,material:nullable(str),tag:nullable(str),attributes:nullable(map),transform:nullable(map),shared_definition:bool,allowed_operations:arr(str)});
const runtime=obj({name:str,version:str,plugin_version:str,capability_version:str,platform:str,operations:arr(json),compatibility:obj({ok:bool,issues:arr(json)})});
const snapshot=obj({totals:obj({faces:integer,edges:integer,vertices:integer}),groups:arr(entity),instances:arr(entity),bounding_box:bbox,material_names:arr(str),component_definitions:arr(str),tags:arr(json),scenes:arr(json),warnings:arr(warning),runtime,geometry_edits:arr(obj({entity_path_before:str,entity_path_after:str,entities:{type:'object',additionalProperties:nullable(str)},created_entities:arr(str),edits:arr(json)}))});
const document=obj({version:integer,units:str,operations:arr(obj({op:str},['op']))},['operations']);
const compiled=obj({code:str,document,expert:map,python_sdk:map,result:json},['code','document']);
const next=nullable(obj({action:str,tool:str,reason:str,task_id:str,handle:str,offset:integer,cursor:str}));
const error=nullable(obj({code:str,message:str,retryable:bool,details:json,next_action:next},['code','message']));
const artifact=obj({handle:str,name:str,kind:str,media_type:str,sha256:str,size_bytes:integer,encoding:str,content:str,offset:integer,next_offset:nullable(integer),total_chars:integer,eof:bool,truncated:bool,next_action:next});
const envelope=obj({contract_version:str,kind:{const:'agent_result_envelope'},ok:bool,task_id:nullable(str),task_state:nullable(str),task_version:nullable(integer),retryable:bool,idempotent_replay:bool,result:json,data:json,warnings:arr(warning),error,next_action:next,artifacts:arr(artifact)},['contract_version','kind','ok','task_id','task_state','retryable','idempotent_replay','result','data','warnings','error','next_action','artifacts']);
const report=obj({ok:bool,level:str,verdict:str,summary:map,issues:arr(json),diffs:arr(json),top_issues:arr(json),recommendations:arr(json),tolerance_mm:num,topology_tolerance:map,budgets:map});
const receipt=obj({request_id:str,status:str,outcome:str,model_revision:str});
const file=obj({kind:str,runtime:str,file_path:str,file_size_bytes:integer,format:str,mode:str,snapshot,import:map,mutation_receipt:receipt},['file_path']);
const build=obj({snapshot,compiled:obj({document,expert:map,python_sdk:map,result:json},['document']),mutation_receipt:receipt},['snapshot']);
const modelInfo=obj({kind:str,runtime:str,units:str,source_path:nullable(str),path:nullable(str),totals:map,bounding_box:bbox,counts:map,warning_summary:map,material_names:arr(str),component_definitions:arr(str),component_definition_summaries:arr(json),classification_schemas:arr(json),tags:arr(json),scenes:arr(json)});
const plan=obj({kind:str,plan_id:str,task_id:nullable(str),created_at:str,plan_hash:str,model_revision:str,model_key:str,runtime:str,instruction:str,risk_level:str,targets:arr(entity),dsl_document:document,blockers:arr(json),budgets:map,artifacts:map,auto_approval_eligible:bool,review_required:bool,user_action_required:bool,target_validation:map,execution_contract:map,operation_contracts:arr(json),affected_instance_count:integer});
const contracts={
 get_docs:obj({name:str,version:str,description:str,tools:json,operations:json,examples:json,workflows:json}),
 get_workflow_bundle:obj({version:str,kind:str,tools:json,workflows:json,gateway_tools:map,entrypoints:map}),
 get_capabilities:obj({runtime},['runtime']),
 create_queue_handshake:obj({kind:{const:'create_queue_handshake'},runtime:{const:'queue'},mutates_model:{const:false},session_contract:map},['kind','runtime','mutates_model','session_contract']),
 queue_diagnostics:obj({kind:str,queue_dir:str,ok:bool,status:str,requests:json,responses:json,locks:json,recovery:json,next_action:next}),
 compile_expert:compiled,compile_python_sdk:compiled,
 build_model:build,build_expert_model:build,reset_model:build,
 save_model:file,save_model_version:file,open_model:file,import_model:file,export_model:file,
 get_model_info:modelInfo,
 list_entities:obj({kind:str,runtime:str,entities:arr(entity)},['entities']),
 inspect_model:obj({kind:str,runtime:str,model_info:modelInfo,entities:arr(entity),selection:arr(entity),snapshot}),
 adopt_open_model:obj({kind:str,runtime:str,read_only:bool,model_revision:str,model_revision_complete:bool,model_revision_total_seen:integer,model_revision_indexed:integer,model_identity:map,recursive_index:arr(entity),recursive_truncated:bool,recursive_total_seen:integer,recursive_root_paths:arr(str),entities:arr(entity),snapshot,structural_groups:obj({version:str,entries:arr(entity),limit:integer,returned:integer,total_seen:integer,truncated:bool})}),
 resolve_model_targets:obj({kind:str,runtime:str,targets:arr(entity),matches:arr(entity),resolved:arr(json),unresolved:arr(json),warnings:arr(json),complete:bool}),
 get_selection:obj({kind:str,runtime:str,selection:arr(entity),count:integer}),
 set_selection:obj({kind:str,runtime:str,selection:arr(entity),count:integer,mode:str,mutation_receipt:receipt}),
 analyze_selection_geometry:obj({kind:str,runtime:str,selection:arr(entity),analysis:map,summary:map,geometry:map}),
 plan_modification_intent:obj({kind:str,runtime:str,intent:json,targets:arr(json),operations:arr(json),plan:map,blockers:arr(json),next_action:next}),
 prepare_existing_model_edit:plan,
 apply_reviewed_model_edit:obj({kind:str,plan_id:str,plan_hash:str,runtime:str,status:str,review:map,authorization:map,iteration:map,snapshot,artifacts:map,geometry_edits:arr(json)}),
 start_agent_task:envelope,resume_agent_task:envelope,submit_agent_task_input:envelope,read_agent_artifact:envelope,edit_model_geometry:envelope,run_model_program:envelope,
 capture_view:obj({kind:str,runtime:str,file_path:str,path:str,image_path:str,width:integer,height:integer,format:str,view:str,snapshot}),
 capture_detail_views:obj({kind:str,runtime:str,views:arr(json),captures:arr(json),artifacts:arr(artifact),output_dir:str}),
 inspect_detail_regions:obj({kind:str,runtime:str,results:arr(json),queries:arr(json),regions:arr(json),complete:bool,model_revision:str}),
 query_assets:obj({kind:str,version:str,query:json,results:arr(json),assets:arr(json),matches:arr(json),total:integer,truncated:bool,warnings:arr(json)}),
 run_ruby_expert:obj({kind:str,runtime:str,enabled:bool,blocked:bool,executed:bool,reason:str,result:json,snapshot,audit_path:str}),
 evaluate_py:obj({kind:{const:'evaluate_py'},runtime:str,input_format:str,started_at:str,finished_at:str,code_sha256:str,compatibility_mode:str,executed:bool,blocked:bool,reason:str,snapshot,compiled:obj({document,expert:map,python_sdk:map,result:json}),ruby_expert:map,mutation_receipt:receipt},['kind','runtime','compatibility_mode','executed','blocked']),
 build_report:obj({kind:str,runtime:str,output_dir:str,snapshot,report,qa:report,artifacts:map,files:map,status:str}),
 iterate_model:obj({kind:str,runtime:str,status:str,output_dir:str,before:snapshot,after:snapshot,snapshot,diff:report,report,artifacts:map,geometry_edits:arr(json),targets:arr(json)}),
 compare_snapshots:report,compare_model:obj({snapshot,report,comparison:report,diff:report,ok:bool}),
 validate_model:obj({snapshot,report,qa:report,ok:bool,issues:arr(json),summary:map}),
 validate_reference_model:obj({snapshot,report,qa:report,ok:bool,issues:arr(json),summary:map}),
 prepare_image_modeling_brief:obj({version:integer,kind:str,asset_set_id:str,profile_id:str,status:str,source:json,compile_permission:obj({can_generate_sketchup_dsl:bool,can_promote_candidates:bool,reasons:arr(str)}),source_assets:arr(obj({id:str,path:str,media_type:str,view:str,quality:str})),evidence_summary:map,source_package_gate:nullable(map),source_request_response_gate:nullable(map)}),
 compile_reviewed_part_graph:obj({kind:str,status:str,code:str,document,compiled:json,report,validation:map,artifacts:map,blocked:bool,reasons:arr(json)})
};
// Variant payloads are explicit; arbitrary program data and SketchUp dictionary
// attributes remain JSON-valued extension maps rather than undocumented objects.
Object.assign(contracts.get_docs.properties,{topic:str,detail:str,max_chars:integer,returned_chars:integer,total_chars:integer,truncated:bool,available_topics:arr(str),next_action:next,content:str,docs:str});
Object.assign(contracts.get_workflow_bundle.properties,{scope:str,default_client_profile:str,first_use:map,interface_levels:map});
Object.assign(contracts.resolve_model_targets.properties,{query:json,strategy:str,ok:bool,requires_confirmation:bool,candidate_count:integer,candidates:arr(map),selected_targets:arr(map),selected:arr(map)});
Object.assign(contracts.analyze_selection_geometry.properties,{ok:bool,source:map,entities:arr(map),aggregate:map,uncertainties:arr(json)});
Object.assign(contracts.plan_modification_intent.properties,{version:str,intent_id:str,created_at:str,ok:bool,instruction:nullable(str),action:str,parameters:map,selection:arr(json),geometry_facts:json,proposed_actions:arr(map),evidence:json,confidence:num,safe_to_execute:bool,requires_confirmation:bool,confirmation:map,limitations:arr(json),uncertainties:arr(json),target_resolution:nullable(map),selection_geometry:nullable(map),patch:nullable(document),patch_sha256:nullable(str),selection_mode:str});
Object.assign(contracts.queue_diagnostics.properties,{runtime:str,state_dir:str,processing_dir:str,response_dir:str,lock_path:str,timeout_ms:num,lock_timeout_ms:num,stale_lock_ms:num,queue:map,processing:map,lock:nullable(map),recommendations:arr(str)});
Object.assign(contracts.compare_model.properties,{expected_runtime:str,actual_runtime:str,reset_first:bool,expected:snapshot,actual:snapshot});
const qa=obj({kind:str,ok:bool,level:str,verdict:str,summary:map,issues:arr(warning),accepted_warnings:arr(json),correction_suggestions:arr(json),preview:nullable(obj({kind:str,views:arr(map),html:str}))},['kind','ok','summary','issues']);
contracts.validate_model=qa;contracts.validate_reference_model=qa;
const gate=obj({version:integer,kind:str,ok:bool,blocked:bool,compile_allowed:bool,blockers:arr(str),inputs:map,schema_checks:map,outputs:map,brief:map,artifacts:map,gate:map},['kind','ok','blocked','blockers','artifacts']);
contracts.prepare_image_modeling_brief=gate;contracts.compile_reviewed_part_graph=gate;
Object.assign(plan.properties,{version:str,execution_mode:str,trusted_scope_approval_required:bool,destructive_side_effects:map,trusted_model_copy_auto_approval:map,copy_fast_session:map,source_proposal:map});
Object.assign(contracts.apply_reviewed_model_edit.properties,{ok:bool,reviewed_by:str,risk_level:str,model_key:str,model_revision_before:str,execution_target_validation:map,session_contract:map});
Object.assign(contracts.iterate_model.properties,{version:str,iteration_id:str,label:str,input_format:str,started_at:str,finished_at:str,code_sha256:str,resolved_code_sha256:str,target_resolution:nullable(map),target_selection:arr(map),before:map,after:map,change_summary:map,snapshot_diff:map,model_qa:nullable(map),reference_qa:nullable(map),saved_model:nullable(map),capture:nullable(map),modification_intent:nullable(map),evaluation:map,target_validation:nullable(map)});
const required={get_docs:['topic','content','truncated'],get_workflow_bundle:['kind','version','gateway_tools'],queue_diagnostics:['kind','queue_dir','queue','processing','responses','lock'],get_model_info:['kind','runtime','totals'],inspect_model:['kind','model_info'],adopt_open_model:['runtime','model_identity'],resolve_model_targets:['kind','ok','candidate_count','candidates','selected_targets'],get_selection:['selection'],set_selection:['selection'],analyze_selection_geometry:['kind','ok','entities','aggregate'],plan_modification_intent:['kind','ok','proposed_actions','patch'],prepare_existing_model_edit:['kind','plan_id','plan_hash','model_revision','dsl_document','blockers'],apply_reviewed_model_edit:['kind','ok','plan_id','iteration'],capture_detail_views:['captures'],query_assets:['version','kind','assets','policy'],run_ruby_expert:['kind','enabled','blocked'],build_report:['kind','artifacts'],iterate_model:['kind','artifacts'],compare_snapshots:['ok','summary','diffs'],compare_model:['expected_runtime','actual_runtime','report']};
contracts.query_assets.properties.policy=obj({purchases:bool,automatic_downloads:bool,license_unknown_is_usable_proof:bool});
for(const [name,fields] of Object.entries(required))contracts[name].required=fields;
export function legacyToolOutputSchema(name){
 const schema=contracts[name];if(!schema)throw new Error(`No explicit output contract for ${name}`);
 return {...schema,$defs:{json:{anyOf:[{type:['string','number','boolean','null']},{type:'array',items:{$ref:'#/$defs/json'}},{type:'object',additionalProperties:{$ref:'#/$defs/json'}}]}}};
}
