import { sha256Canonical } from '../agent-contract.mjs';
import { normalizeTraditionalAssembly, assemblyError, PROJECT_RULES, TRADITIONAL_RENDER_VERSION } from './assembly-plan.mjs';
import { solveTraditionalLayout } from './layout.mjs';
import { TRADITIONAL_FAMILIES, buildFamily } from './families.mjs';
import { YfBuilder } from './solids.mjs';
import { DETAIL_MATERIALS } from '../detailed-modeling/recipes.mjs';

function connectionCheck(connection,results) {
  const lookup=name=>{const [id,key]=name.split('.'),part=results.get(id);if(!part||!Object.hasOwn(part.ports,key))assemblyError('PARAMETER_DEPENDENCY',`Connection port does not exist: ${name}.`);return part.ports[key];};
  const a=lookup(connection.from),b=lookup(connection.to),tolerance=connection.tolerance_mm??1;
  if(a.kind!==b.kind)assemblyError('PARAMETER_DEPENDENCY',`Incompatible ports: ${connection.from} -> ${connection.to}.`);
  if(a.kind==='point_set') {
    if(!a.points.length||!b.points.length)assemblyError('PARAMETER_DEPENDENCY','Empty connection point set.');
    const separation=Math.max(...b.points.map(q=>Math.min(...a.points.map(p=>Math.hypot(...p.map((v,i)=>v-q[i]))))));
    if(separation>tolerance)assemblyError('PARAMETER_DEPENDENCY',`Connection misses by ${separation.toFixed(2)} mm.`);
    return {...connection,tolerance_mm:tolerance,separation_mm:separation,evidence_level:'compiler_expected_coordinates'};
  }
  if(a.kind==='frame_support'&&(a.frame_id!==b.frame_id||Math.abs(a.height-b.height)>tolerance)||['roof_surface','eave_line'].includes(a.kind)&&a.roof_id!==b.roof_id)
    assemblyError('PARAMETER_DEPENDENCY','Connected assemblies were solved from different supports/surfaces.');
  return {...connection,tolerance_mm:tolerance,separation_mm:0,evidence_level:'shared_layout_contract'};
}
export function buildTraditionalAssemblyRecipe({id,assembly,parameters}) {
  const n=normalizeTraditionalAssembly(assembly,parameters),layout=solveTraditionalLayout(n.plan.layout,n.geometry_parameters);
  const b=new YfBuilder(id,PROJECT_RULES),results=new Map(),context={...n,layout};
  const duplicate=new Set();
  for(const part of n.plan.assemblies) {
    if(['frame_grid','path_frame','roof_unit','eave_unit'].includes(part.family)) {
      const kind=['frame_grid','path_frame'].includes(part.family)?'frame':part.family;
      if(duplicate.has(kind))assemblyError('UNSUPPORTED_TOPOLOGY','One frame/roof/eave solver per root; compose independent roots for separate buildings.');
      duplicate.add(kind);
    }
    const result=buildFamily(b,part,context);results.set(part.id,result);
  }
  const connections=n.plan.connections.map(connection=>connectionCheck(connection,results));
  const connected=(from,to,fromPort,toPort)=>n.plan.connections.some(c=>c.from===`${from}.${fromPort}`&&c.to===`${to}.${toPort}`);
  if(context.roof&&!connected(context.frame.id,context.roof.id,'bearing','bearing'))assemblyError('PARAMETER_DEPENDENCY','Roof must explicitly connect to its frame bearing.');
  for(const part of n.plan.assemblies)if(part.family==='eave_unit'&&!connected(context.roof.id,part.id,'roof_surface','roof_surface'))assemblyError('PARAMETER_DEPENDENCY','Eave must explicitly connect to the shared roof surface.');
  const children=[...results.values()].flatMap(r=>r.ref?[r.ref]:[]);
  if(!children.length)assemblyError('MISSING_INPUT','A semantic plan must generate at least one nonempty assembly.');
  b.group('root',()=>children,'traditional_semantic_assembly');
  const sources={...n.parameter_sources};
  const familySources=Object.fromEntries([...results.values()].map(result=> {
    const part=n.plan.assemblies.find(p=>p.id===result.id);
    return [result.id,Object.fromEntries(Object.entries(result.resolved_parameters||{}).map(([key,value])=> {
      const sourceKey=n.plan.parameter_bindings?.[result.id]?.[key];
      if(sourceKey)return [key,{...n.parameter_sources[sourceKey],value,source_parameter:sourceKey,geometry_unit:key.endsWith('_mm')?'mm':'explicit'}];
      const derived=key==='width_mm'&&part.parameters.segment_id!==undefined;
      const explicit=Object.hasOwn(part.parameters,key);
      return [key,{value,basis:derived?'derived':'selected',
        ...(!explicit&&!derived?{rule_binding:n.rule_binding}:{}),
        note:derived?'Clear bay width = declared bay length minus two column half-sections.':explicit?'Explicit family engineering input.':'Project engineering default; not a historical dimension.'}];
    }))];
  }));
  return {root_id:id,parts:b.parts,materials:[...DETAIL_MATERIALS,{name:'Detail_RoofTile',color:'#666461'}],
    required_voids:[...results.values()].flatMap(r=>r.required_voids||[]),recipe_signature:n.signature,
    rule_binding:n.rule_binding,layout,connections,parameter_sources:sources,family_parameter_sources:familySources,
    measurements:{kind:'compiler_expected_values',units:'mm',column_count:layout.columns?.length||0,total_path_length_mm:layout.segments.reduce((s,v)=>s+v.length,0),junction_count:layout.junction_count||0,layout_bounds_mm:layout.bounds},
    provenance:{rule_binding:n.rule_binding,contract_version:'traditional-assembly.v1',rendering_version:TRADITIONAL_RENDER_VERSION,
      mode:n.plan.mode,parameter_sources:sources,family_parameter_sources:familySources,source_plan_hash:sha256Canonical(assembly),
      simplifications:[...(n.plan.simplifications||[]),'Hidden mortises use declared contact/lap geometry.','Open surface/light tiles do not prove closed volume or structural capacity.'],
      historical_accuracy_certified:false,native_acceptance:'requires_current_model_evidence'},
    family_catalog:TRADITIONAL_FAMILIES};
}
