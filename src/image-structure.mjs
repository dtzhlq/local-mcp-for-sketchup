import Ajv2020 from 'ajv/dist/2020.js';
import { validateImageGeometry } from './image-structure-geometry.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { AgentContractError, sha256Canonical } from './agent-contract.mjs';
import { compilePartGraphToSketchUpDsl } from './product-modeling/part-graph-compiler.mjs';
import { validateExpertDocument } from './expert-compiler.mjs';
import { prepareTaskOwnedCreationDsl } from './agent-dsl-policy.mjs';
import { OPERATION_REGISTRY } from './capabilities.mjs';
import { grayscale, autoEdgeThreshold, sobelEdges, percentileBounds, traceObjectContour } from './image-structure-edges.mjs';

const inputSchema=JSON.parse(await fs.readFile(new URL('../schema/image-structure-input-v1.schema.json',import.meta.url),'utf8'));
const validateInput=new Ajv2020({strict:false,allErrors:true}).compile(inputSchema);
const fail = (message, details) => { throw new AgentContractError('INVALID_ARGUMENT', message, { details }); };
const copy = value => structuredClone(value);
const SHAPES = new Set(['box','rounded_box','mesh','prism','cylinder','rib','slot','slot_array','recess','engraved_line','text_3d','text_emboss','text_engrave','button_on_panel','analog_stick','screw_hole','standoff_boss','domed_surface','bowed_panel','loft_between_profiles','shell_from_front_side_profiles','face_on_cylinder','panel_with_openings','face_with_holes','profile_extrude','gable_roof','shed_roof','pipe_between_points','lofted_solid','beveled_panel']);
const RESERVED = new Set(['op','id','object_id','objectId','guid','name','qa','operations','target','target_id','target_ids','entity_path','entity_id','tool_ids','definition','texture','source','source_path','image','skm_path','asset_path','file_path','url','uri','parent','parent_id','material','tag','__proto__','constructor','prototype']);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function text(value, label) { if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a nonempty string`); return value; }
function fields(value, allowed, label) { if (!object(value)) fail(`${label} must be an object`); for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label}.${key} is not supported`); }
function safeNumbers(value, label) {
  if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 1e8)) fail(`${label} contains an invalid or excessive number`);
  if (Array.isArray(value)) { if (value.length > 100000) fail(`${label} is too large`); value.forEach(v=>safeNumbers(v,label)); }
  else if (object(value)) for (const [k,v] of Object.entries(value)) { if (RESERVED.has(k)) fail(`${label}.${k} is reserved`); safeNumbers(v,`${label}.${k}`); }
}

export async function runImageStructureHelper(method, buffer) {
  if (method === 'lines') {
    const { buildLegacyDetectedStructureLines } = await import('./image-structure-lines.mjs');
    const result = await buildLegacyDetectedStructureLines({ sourceImagePath: buffer, sourceImage: 'immutable-source', maxWidth: 600 });
    return { method, status: 'ok', coordinate_space: result.image_size, lines: result.line_candidates.slice(0,48), interpretation: 'line candidates only; no required camera solution' };
  }
  if (!['contours','boundaries'].includes(method)) fail(`Unknown helper: ${method}`);
  const {data,info} = await sharp(buffer).rotate().resize({width:600,height:600,fit:'inside',withoutEnlargement:true}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const gray = grayscale(data,info.width,info.height);
  const edges = sobelEdges(gray,info.width,info.height,autoEdgeThreshold(gray));
  const bounds = percentileBounds(edges,info.width,info.height);
  return { method, status: bounds ? 'ok' : 'no_evidence', coordinate_space: {width:info.width,height:info.height},
    ...(method === 'boundaries' ? {bounds} : {contour: bounds ? traceObjectContour(edges,bounds,info.width,info.height) : []}), interpretation: 'sampled raster evidence, not semantic object boundaries' };
}

export function mergeImageUnderstanding(inputs, previous = null) {
  if (!['building','interior','product'].includes(inputs.domain ?? previous?.domain)) fail('domain must be building, interior, or product');
  const source = text(inputs.image_handle ?? previous?.image_handle,'image_handle');
  if (previous && previous.image_handle !== source) fail('Previous understanding belongs to another image');
  const scale = inputs.scale_mode ?? previous?.scale_mode ?? 'relative';
  if (!['relative','known'].includes(scale)) fail('scale_mode must be relative or known');
  const candidates = copy(previous?.candidates || []);
  const active = {...previous?.active_instances};
  const seen = new Set();
  for (const submitted of inputs.observations || []) {
    const observation=copy(submitted);
    fields(observation,['instance_id','role','evidence','parameters','description'],'observation');
    const id = text(observation.instance_id,'instance_id');
    if (seen.has(id)) fail(`Duplicate instance_id in submission: ${id}`);
    seen.add(id); text(observation.role,'role');
    if (!object(observation.evidence) || observation.evidence.image_handle !== source || !observation.evidence.description) fail(`Instance ${id} requires source-bound evidence and description`);
    for (const [key,p] of Object.entries(observation.parameters || {})) {
      if (!object(p) || !Object.hasOwn(p,'provenance')) {
        observation.parameters[key]={value:copy(p),provenance:'inferred',reason:'Unclassified model-supplied estimate; not an observed measurement'};
      } else if (!['observed','inferred','assumed'].includes(p.provenance) || !Object.hasOwn(p,'value') || !p.reason) fail(`Parameter ${id}.${key} requires value, provenance, and reason`);
    }
    const prior = active[id] || null;
    const old = candidates.find(c=>c.candidate_id===prior);
    if (old && sha256Canonical(Object.fromEntries(Object.entries(old).filter(([k])=>!['candidate_id','replaces'].includes(k))))===sha256Canonical(observation)) continue;
    const core = {...copy(observation), replaces: prior};
    const candidate_id = sha256Canonical(core);
    candidates.push({...core,candidate_id}); active[id] = candidate_id;
  }
  const assumptions = copy(inputs.assumptions ?? previous?.assumptions ?? []);
  if (!Array.isArray(assumptions)) fail('assumptions must be an array');
  for (const assumption of assumptions) {
    fields(assumption,['id','instance_id','parameter','value','reason'],'assumption');
    text(assumption.id,'assumption.id');text(assumption.reason,'assumption.reason');
    if (assumption.instance_id && !active[assumption.instance_id]) fail('Assumption references an unknown instance');
  }
  return {version:'image-understanding.v1', image_handle:source, domain:inputs.domain ?? previous.domain, scale_mode:scale,
    scale_reference:copy(inputs.scale_reference ?? previous?.scale_reference ?? null), candidates,active_instances:active,
    assumptions, review_history:copy(previous?.review_history || []), diagnostics:copy(previous?.diagnostics || []),
    unknowns:copy(inputs.unknowns ?? previous?.unknowns ?? []), part_graph:copy(inputs.part_graph ?? previous?.part_graph ?? null)};
}

export function compileImageModel(understanding) {
  const graph = understanding.part_graph;
  fields(graph,['version','profile_id','units','parts','roots','materials','contacts'],'part_graph');
  if (![1,2].includes(graph.version ?? 1) || (graph.units && graph.units !== 'mm')) fail('PartGraph requires version 1 or 2 and nominal mm units');
  if (!Array.isArray(graph.parts) || !graph.parts.length || graph.parts.length > 1500) fail('PartGraph must contain 1–1500 explicit parts');
  if (understanding.scale_mode === 'known' && !(understanding.scale_reference?.millimeters_per_unit > 0 && understanding.scale_reference?.evidence)) fail('Known scale requires millimeters_per_unit and evidence');
  const assumptions = understanding.assumptions;
  const suppliedIds=graph.parts.map(p=>p.instance_id||p.id);
  if (new Set(suppliedIds).size!==suppliedIds.length) fail('Duplicate part instance id');
  const missing=Object.keys(understanding.active_instances).filter(id=>!suppliedIds.includes(id));
  if (missing.length) fail(`Complete model is missing instances: ${missing.join(', ')}`);
  const parts = graph.parts.map(part => {
    fields(part,['id','instance_id','name','role','shape','assembly','parameter_provenance','material'],'part');
    const id = text(part.instance_id || part.id,'part.instance_id');
    if (part.id && part.id !== id) fail('part.id and instance_id must agree');
    const candidate = understanding.candidates.find(c=>c.candidate_id === understanding.active_instances[id]);
    if (!candidate) fail(`Part ${id} has no active source-bound observation`);
    if (part.assembly) {
      fields(part.assembly,['children'],'assembly');
      return {id,name:id,role:candidate.role,assembly:copy(part.assembly)};
    }
    fields(part.shape,['primitive','parameters'],`part ${id}.shape`);
    if (!SHAPES.has(part.shape.primitive)) fail(`Part ${id}: unsupported constructive shape ${part.shape.primitive}`);
    if (!object(part.shape.parameters)) fail(`Part ${id}: explicit shape parameters required; no bounding-box fallback`);
    safeNumbers(part.shape.parameters,`part ${id}.parameters`);
    const definition = OPERATION_REGISTRY[part.shape.primitive];
    const allowed = new Set([...(definition.schema.required||[]),...(definition.schema.optional||[])].map(k=>k.split('.')[0]));
    for (const [key,value] of Object.entries(part.shape.parameters)) {
      if (!allowed.has(key)) fail(`Part ${id}: unknown shape parameter ${key}`);
      if (key==='transform') fields(value,['translate','rotateZ'],`Part ${id}.transform`);
      const provenance = part.parameter_provenance?.[key];
      if (!['observed','inferred','assumed'].includes(provenance)) fail(`Part ${id}.${key}: parameter_provenance is required`);
      if (provenance === 'observed' && !(candidate.parameters?.[key]?.provenance==='observed' && sha256Canonical(candidate.parameters[key].value)===sha256Canonical(value))) fail(`Part ${id}.${key}: observation must support observed value`);
      if (provenance === 'assumed' && !assumptions.some(a=>a.instance_id===id && a.parameter===key && sha256Canonical(a.value)===sha256Canonical(value))) fail(`Part ${id}.${key}: matching explicit assumption required`);
      if (['size','radius','height','depth','width','thickness','length'].includes(key) && (Array.isArray(value)?value:[value]).some(n=>typeof n!=='number'||n<=0)) fail(`Part ${id}.${key} must be positive`);
    }
    return {id,name:id,role:candidate.role,shape:copy(part.shape),...(part.material?{material:part.material}:{}),evidence_sources:[understanding.image_handle],evidence_status:'needs_review'};
  });
  const materials=(graph.materials||[]).map(m=> {fields(m,['name','color','alpha'],'material');return copy(m);});
  const normalized={version:graph.version||1,profile_id:'image-neutral-v1',units:'mm',parts,...(graph.roots?{roots:copy(graph.roots)}:{})};
  if (graph.roots) for (const ref of [...graph.roots,...parts.flatMap(p=>p.assembly?.children||[])]) {
    fields(ref,['part_id','instance_id','origin','transform'],'assembly reference');
    if (!parts.some(p=>p.id===ref.part_id)) fail('External assembly reference is forbidden');
    safeNumbers(ref.origin,'assembly origin');safeNumbers(ref.transform,'assembly transform');
  }
  if (normalized.version===2) {
    const reached=new Set();const visit=id=>{if(reached.has(id))return;reached.add(id);for(const ref of parts.find(p=>p.id===id)?.assembly?.children||[])visit(ref.part_id);};
    for(const ref of normalized.roots||[])visit(ref.part_id);
    if(parts.some(p=>!reached.has(p.id))) fail('PartGraph has unreachable parts; complete output cannot drop them');
  }
  const document=compilePartGraphToSketchUpDsl(normalized,{profile_id:'image-neutral-v1',units:'mm',materials},{includeReset:false});
  const contacts=graph.contacts || [];
  if (!Array.isArray(contacts) || contacts.length>5000) fail('contacts must contain at most 5000 explicit pairs');
  for (const contact of contacts) {
    fields(contact,['instance_id','with_instance_id','assumption_id'],'contact');
    const a=parts.find(p=>p.id===contact.instance_id), b=parts.find(p=>p.id===contact.with_instance_id);
    if (!a || !b || a.id===b.id || a.assembly || b.assembly) fail('Contact must bind two distinct geometric instances in this PartGraph');
    const assumption=assumptions.find(x=>x.id===contact.assumption_id && x.instance_id===a.id && x.parameter==='contact' && x.value===b.id);
    if (!assumption) fail('Contact requires a matching explicit contact assumption and reason');
    const operation=document.operations.find(o=>o.name===a.id);
    if (!operation) fail('Contact instance must resolve to an emitted geometric operation');
    operation.qa={...operation.qa,expected_contacts:[...(operation.qa?.expected_contacts||[]),{with:b.id,bucket:'image_assumed_contact',note:assumption.reason}]};
  }
  validateExpertDocument(document,{maxOperations:1500,maxOutputBytes:2*1024*1024});
  prepareTaskOwnedCreationDsl(JSON.stringify(document),{taskId:'task_00000000-0000-0000-0000-000000000000',iteration:0});
  const geometry_preview=validateImageGeometry(document);
  return {geometry_preview,version:'image-model-plan.v1',image_handle:understanding.image_handle,part_graph:copy(graph),assumptions:copy(assumptions),scale_mode:understanding.scale_mode,scale_reference:copy(understanding.scale_reference),document,
    completeness:'candidate_requires_visual_acceptance',limitations:understanding.unknowns};
}

async function sourceRecord(gateway, reference) {
  fields(reference,['task_id','artifact_handle','content_hash'],'source reference');
  const task=await gateway.taskStore.getTask(reference.task_id,{includePrivate:true});
  const stored=task.private?.image_structure;
  if (!stored || stored.artifact.handle !== reference.artifact_handle || stored.content_hash !== reference.content_hash || sha256Canonical(stored.understanding)!==stored.content_hash) fail('Image understanding reference does not match server-frozen artifact');
  await gateway.imageArtifactStore.inspect(stored.understanding.image_handle);
  const review_history=[...(stored.understanding.review_history||[])];
  for (const review of task.private.image_structure_reviews||[]) {
    const decision=await gateway.bridge.approvalAuthority.readDecision(review.challenge_id,{allowMissing:true});
    if(decision)review_history.push({...review,decision:copy(decision)});
  }
  return {task,stored,review_history};
}

export async function prepareImageStructure(gateway,task) {
  const inputs=task.inputs;
  if(!validateInput(inputs)) fail('Invalid image structure input',{issues:validateInput.errors});
  const priorSource=inputs.source_understanding ? await sourceRecord(gateway,inputs.source_understanding) : null;
  const previous=priorSource ? {...priorSource.stored.understanding,review_history:priorSource.review_history} : task.private?.image_structure?.understanding || null;
  const understanding=mergeImageUnderstanding(inputs,previous);
  const {buffer}=await gateway.imageArtifactStore.resolve(understanding.image_handle);
  const methods=inputs.helpers || [];
  if (!Array.isArray(methods) || methods.some(m=>!['lines','contours','boundaries'].includes(m)) || new Set(methods).size!==methods.length) fail('helpers must contain unique selected methods: lines, contours, boundaries');
  for (const method of methods.filter(m=>!task.private?.image_structure?.helpers_completed?.includes(m))) {
    try {understanding.diagnostics.push(await (gateway.imageStructureHelper || runImageStructureHelper)(method,buffer));}
    catch(error) {understanding.diagnostics.push({method,status:'failed',message:String(error.message).slice(0,300)});}
  }
  const goal=inputs.goal || 'understanding';
  if (!['understanding','complete_model'].includes(goal)) fail('goal must be understanding or complete_model');
  let plan=null;const gaps=[];
  if (goal==='complete_model') try {plan=compileImageModel(understanding);} catch(error) {gaps.push({kind:'geometry_input',message:error.message});understanding.diagnostics.push({method:'geometry_compile',status:'failed',message:error.message});}
  if (!Object.keys(understanding.active_instances).length && !methods.length && !previous) gaps.push({kind:'understanding',message:'Submit observations or request helpers'});
  const content_hash=sha256Canonical(understanding);
  const dir=path.join(gateway.taskStore.rootDir,'task-artifacts',task.task_id,'image-structure');
  await fs.mkdir(dir,{recursive:true});
  const file=path.join(dir,`${content_hash.slice(7)}.json`);
  await fs.writeFile(file,JSON.stringify(understanding,null,2));
  const artifact=await gateway.taskStore.registerArtifact(task.task_id,{filePath:file,label:'image-understanding',kind:'json'});
  const current=await gateway.taskStore.getTask(task.task_id,{includePrivate:true});
  const stored={understanding,content_hash,artifact,helpers_completed:[...new Set([...(task.private?.image_structure?.helpers_completed||[]),...methods])],...(plan?{plan,plan_hash:sha256Canonical(plan)}:{})};
  return gateway.taskStore.transition(task.task_id,gaps.length?'awaiting_input':'completed',{reason:gaps.length?'image_goal_missing_input':'image_understanding_available',patch:{
    private:{...current.private,image_structure:stored,bound_image_handles:[...new Set([...(current.private?.bound_image_handles||[]),understanding.image_handle])]},
    result:{kind:'image_structure',goal,source_understanding:{task_id:task.task_id,artifact_handle:artifact.handle,content_hash},...(plan?{source_image_model:{task_id:task.task_id,artifact_handle:artifact.handle,content_hash},plan_hash:stored.plan_hash,preview:plan}:{}),instance_count:Object.keys(understanding.active_instances).length,diagnostics:understanding.diagnostics,unknowns:understanding.unknowns,goal_gaps:gaps,assumptions:understanding.assumptions,complete_model_delivered:false},
    next_action:gaps.length?{action:'submit_task_input',gaps}:plan?{action:'start_agent_task',intent:'create_model',required:['source_image_model','runtime']}:null}});
}

export async function prepareImageModelCreation(gateway,task) {
  if (task.private?.image_model_creation?.approved) return task;
  if (['code','task','refinement_code','spec','detail_spec'].some(k=>Object.hasOwn(task.inputs,k))) fail('source_image_model cannot be combined with caller geometry or quality overrides');
  if (!['mock','queue'].includes(task.inputs.runtime)) fail('source_image_model requires explicit runtime');
  const {stored}=await sourceRecord(gateway,task.inputs.source_image_model);
  if (!stored.plan || sha256Canonical(stored.plan)!==stored.plan_hash) fail('Source has no valid frozen complete-model plan');
  const plan=stored.plan;
  const capabilities=await gateway.bridge.get_capabilities({runtime:task.inputs.runtime});
  const supported=capabilities.runtime?.supported_operations || capabilities.supported_operations;
  if (!Array.isArray(supported)) fail('Runtime did not advertise supported operations');
  const required=new Set();
  const visit=ops=>ops.forEach(o=>{required.add(o.op);if(o.operations)visit(o.operations);});visit(plan.document.operations);
  const unsupported=[...required].filter(op=>!supported.includes(op));
  if (unsupported.length) fail(`Runtime cannot create these parts: ${unsupported.join(', ')}`);
  const review={kind:'image_model_review',source_image:plan.image_handle,part_graph:plan.part_graph,assumptions:plan.assumptions,scale_mode:plan.scale_mode,scale_reference:plan.scale_reference,operation_count:plan.document.operations.length,scope:'Create new independently editable parts; source image is not a measurement of hidden geometry.'};
  const binding={task_id:task.task_id,plan_id:`image-${stored.plan_hash.slice(7,31)}`,plan_hash:stored.plan_hash,model_revision:`new-objects:${task.task_id}`,risk_level:'S2',allowed_operations:[...new Set(plan.document.operations.map(o=>o.op))],review_context_hash:sha256Canonical(review)};
  const challenge=await gateway.bridge.approvalAuthority.createChallenge({taskId:binding.task_id,planId:binding.plan_id,planHash:binding.plan_hash,modelRevision:binding.model_revision,riskLevel:binding.risk_level,allowedOperations:binding.allowed_operations,reviewContext:review,idempotencyKey:`image-model:${task.task_id}:${binding.plan_hash}`});
  const sourceTask=await gateway.taskStore.getTask(task.inputs.source_image_model.task_id,{includePrivate:true});
  const links=sourceTask.private.image_structure_reviews||[];
  if(!links.some(r=>r.challenge_id===challenge.challenge_id)) await gateway.taskStore.update(sourceTask.task_id,{private:{...sourceTask.private,image_structure_reviews:[...links,{challenge_id:challenge.challenge_id,plan_hash:stored.plan_hash,candidate_ids:Object.values(stored.understanding.active_instances)}]}});
  return gateway.taskStore.transition(task.task_id,'awaiting_review',{reason:'image_model_plan_review_required',patch:{private:{...task.private,image_model_creation:{plan:copy(plan),binding,challenge}},result:{kind:'image_model_review',approval_challenge:challenge,plan_hash:stored.plan_hash,preview:review,complete_model_delivered:false},next_action:gateway.approvalNextAction(challenge)}});
}

export async function approveImageModelCreation(gateway,task,input) {
  fields(input,['runtime','session_contract','connection_task_id','note'],'image model approval submission');
  if (input.runtime && input.runtime!==task.inputs.runtime) fail('Reviewed runtime cannot change');
  const record=task.private.image_model_creation;
  const {stored}=await sourceRecord(gateway,task.inputs.source_image_model);
  if (sha256Canonical(record.plan)!==record.binding.plan_hash || stored.plan_hash!==record.binding.plan_hash) fail('Reviewed image plan changed');
  const auth=await gateway.resolveTrustedApproval(record.challenge,record.binding);
  await gateway.bridge.approvalAuthority.consumeToken(auth.approval_token,record.binding);
  task=await gateway.taskStore.transition(task.task_id,'approved',{reason:'image_model_plan_approved',patch:{inputs:{...task.inputs,...input,code:JSON.stringify(record.plan.document)},private:{...task.private,image_model_creation:{...record,approved:true}}}});
  return gateway.createModel(task);
}

export async function assertFrozenImageCreation(gateway,task) {
  const record=task.private?.image_model_creation;
  if (!record?.approved) fail('Image plan is not approved');
  const {stored}=await sourceRecord(gateway,task.inputs.source_image_model);
  if(stored.plan_hash!==record.binding.plan_hash || sha256Canonical(record.plan)!==record.binding.plan_hash || task.inputs.code!==JSON.stringify(record.plan.document) || task.inputs.refinement_code) fail('Image plan geometry changed after confirmation; prepare a new source plan');
}

// The same frozen plan defines delivery requirements; no caller QA overrides or
// new geometry are accepted. Explicit paths disambiguate native root summaries.
export function imageModelDetailSpecification(plan) {
  return {version:1,required_parts:plan.document.operations
    .filter(o=>!['material','component_definition'].includes(o.op))
    .map(o=>({id:o.id||o.name,instance_path:[o.id||o.name],min_faces:1}))};
}
