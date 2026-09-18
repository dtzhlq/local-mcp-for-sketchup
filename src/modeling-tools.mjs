import { GEOMETRY_EDIT_SCHEMA } from './model-geometry-contract.mjs';
const runtime={type:'string',enum:['mock','queue'],default:'mock'};
const targets={type:'array',minItems:1,maxItems:32,uniqueItems:true,items:{type:'string',pattern:'^(model|pid:[1-9][0-9]*(\\.[1-9][0-9]*)*)$'}};
const handle={type:'string',pattern:'^geometry:[a-f0-9]{64}$'};
const shared={runtime,timeoutMs:{type:'integer',minimum:100,maximum:120000},max_vertices:{type:'integer',minimum:1,maximum:100000},max_contexts:{type:'integer',minimum:1,maximum:2000}};
const ref={type:'object',additionalProperties:false,required:['entity_path'],properties:{entity_path:{type:'string'},handle:{type:'string',pattern:'^[vef]:[A-Za-z0-9_-]+$'}}};
export const MODELING_TOOL_DEFINITIONS=[
  {name:'query_model_geometry',description:'Read revision-bound vertices, edges, faces, loops and occurrence transforms for specified model contexts. Returns a compact summary and immutable resource handle; detail=full is explicit. Read-only.',inputSchema:{type:'object',additionalProperties:false,properties:{...shared,targets,snapshot_handle:handle,recursive:{type:'boolean',default:true},detail:{enum:['summary','full'],default:'summary'}}}},
  {name:'measure_model_geometry',description:'Measure actual geometry length, area, closed volume, minimum distance or direction angle. Returns units, method and revision. Invalid or over-budget measurements are unavailable, never bbox substitutes.',inputSchema:{type:'object',additionalProperties:false,required:['queries'],properties:{...shared,snapshot_handle:handle,max_pairs:{type:'integer',minimum:1,maximum:2000000},queries:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,required:['kind','entity_path'],properties:{...ref.properties,kind:{enum:['length','area','volume','distance','angle']},other:ref}}}}}},
  {name:'edit_model_geometry',description:'Submit one revision-bound local topology batch: add edges/faces, move vertices, transform, pushpull, reverse, erase or set properties. Preserves sibling instances through isolation. Uses existing reviewed tasks and receipts; returns approval steps when required.',inputSchema:{type:'object',additionalProperties:false,required:['snapshot_handle','entity_path','edits','idempotency_key'],properties:{runtime,snapshot_handle:handle,entity_path:{type:'string',pattern:'^pid:[1-9][0-9]*(\\.[1-9][0-9]*)*$'},edits:{type:'array',minItems:1,maxItems:100,items:GEOMETRY_EDIT_SCHEMA},idempotency_key:{type:'string',minLength:1,maxLength:200},instruction:{type:'string'}}}},
  {name:'run_model_program',description:'Run or resume up to three bounded create/edit stages with real geometry snapshots, computation, reviewed execution and native readback. Expert JS receives snapshot/previous/parameters/stage; Python SDK also receives these bindings. No arbitrary process execution.',inputSchema:{type:'object',additionalProperties:false,properties:{runtime,task_id:{type:'string',pattern:'^task_[0-9a-f-]+$'},idempotency_key:{type:'string',minLength:1,maxLength:200},instruction:{type:'string'},targets,snapshot_handle:handle,max_vertices:shared.max_vertices,parameters:{type:'object'},budget:{type:'object',additionalProperties:false,properties:{max_operations:{type:'integer',minimum:1,maximum:100},max_loop_iterations:{type:'integer',minimum:1,maximum:10000},max_statements:{type:'integer',minimum:1,maximum:20000},max_output_bytes:{type:'integer',minimum:1,maximum:1000000}}},connection_task_id:{type:'string'},stages:{type:'array',minItems:1,maxItems:3,items:{type:'object',additionalProperties:false,required:['kind','code'],properties:{kind:{enum:['create','edit']},language:{enum:['expert','python_sdk'],default:'expert'},code:{type:'string',minLength:1,maxLength:200000}}}}},oneOf:[{required:['task_id'],not:{anyOf:[{required:['stages']},{required:['idempotency_key']}]}},{required:['stages','idempotency_key'],not:{required:['task_id']}}]}}
];
export function toolOutputSchema(name) {
  const object = { type: 'object', additionalProperties: true };
  const properties = {
    kind: { type: 'string' }, runtime: { type: 'string' }, snapshot: object,
    model_revision: { type: 'string' }, next_action: { type: ['object', 'null'] }
  };
  if (name === 'query_model_geometry') {
    return { ...object, required: ['kind', 'runtime', 'snapshot_handle', 'model_revision', 'complete', 'contexts'],
      properties: { ...properties, snapshot_handle: handle, complete: { type: 'boolean' }, contexts: { type: 'array', items: object }, resource_uri: { type: 'string' } }
    };
  }
  if (name === 'measure_model_geometry') {
    const measurement = { ...object, required: ['query', 'status'], properties: {
      status: { enum: ['available', 'unavailable'] }, value: { type: 'number' }, reason: { type: 'string' }, units: { type: 'string' }, method: { type: 'string' }
    }};
    return { ...object, required: ['kind', 'runtime', 'model_revision', 'results'], properties: { ...properties, results: { type: 'array', items: measurement } } };
  }
  if (['start_agent_task', 'resume_agent_task', 'submit_agent_task_input', 'edit_model_geometry', 'run_model_program'].includes(name)) {
    return { ...object, properties: { ok: { type: 'boolean' }, task_id: { type: 'string' }, data: {type:['object','null']}, error: { type: ['object', 'null'] }, next_action: { type: ['object', 'null'] } } };
  }
  return { ...object, properties };
}
