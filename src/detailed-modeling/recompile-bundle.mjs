import {buildDetailedRecipeSample,buildDetailedScene,recompileDetailedScene,describeAssemblyOccurrences} from './scenes.mjs';
import {composeDesign} from './compose-design.mjs';
import {compilePartGraphToSketchUpDsl} from '../product-modeling/part-graph-compiler.mjs';

// Older cabinet recipes put coordinates into foot IDs. Preserve each declared
// corner's existing identity across a dimension edit; never match arbitrary
// descendants by their names or bounding boxes during native verification.
function preserveCabinetFootIdentities(previous,base){
  const aliases=new Map();
  const feet=(graph,root)=>{
    const index=new Map(graph.parts.map(part=>[part.id,part]));
    const parts=(root.assembly?.children||[]).map(child=>index.get(child.part_id)).filter(part=>part?.role==='adjustable_foot');
    if(parts.length!==4||parts.some(part=>part.shape?.primitive!=='cylinder'))throw new Error('Cabinet foot identity requires the declared four-cylinder topology');
    const xs=[...new Set(parts.map(part=>part.shape.parameters.origin[0]))].sort((a,b)=>a-b),ys=[...new Set(parts.map(part=>part.shape.parameters.origin[1]))].sort((a,b)=>a-b);
    if(xs.length!==2||ys.length!==2)throw new Error('Cabinet foot identity requires four distinct corner slots');
    return xs.flatMap(x=>ys.map(y=>{const matches=parts.filter(part=>part.shape.parameters.origin[0]===x&&part.shape.parameters.origin[1]===y);if(matches.length!==1)throw new Error('Ambiguous cabinet foot corner');return matches[0];}));
  };
  for(const root of base.part_graph.parts.filter(part=>part.role==='cabinet'&&part.assembly)){
    const old=previous.part_graph.parts.find(part=>part.id===root.id&&part.role==='cabinet'&&part.assembly);
    if(!old)continue;
    const before=feet(previous.part_graph,old),after=feet(base.part_graph,root);
    after.forEach((part,index)=>{if(part.id!==before[index].id)aliases.set(part.id,before[index].id);});
  }
  if(!aliases.size)return base;
  const remap=value=>typeof value==='string'?(aliases.get(value)||value):Array.isArray(value)?value.map(remap):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,remap(item)])):value;
  return {...base,part_graph:remap(base.part_graph),detail_spec:remap(base.detail_spec)};
}

export function recompileDetailedBundle(previous,{partId,parameters,associatedPartIds=[]}={}){
  if(!parameters||typeof parameters!=='object'||Array.isArray(parameters)||!Object.keys(parameters).length)throw new Error('Explicit parameter changes are required');
  if(previous.composition_plan){
    if(!partId||!previous.part_graph.roots.some(root=>root.part_id===partId))throw new Error('A composed design parameter edit requires an explicit root part');
    const plan=structuredClone(previous.composition_plan);
    const addition=plan.additions?.find(item=>item.id===partId);
    const explicit=plan.explicit_parts?.find(item=>`${item.id}-assembly`===partId);
    const scene=previous.composition_report.base_scene_id.replace(/^detailed-/,'');
    const baseParameters={...previous.base_parameters};
    const baseAssemblyParameters=structuredClone(previous.base_assembly_parameters||{});
    if(explicit){
      if(Object.keys(parameters).some(key=>key!=='base_elevation')||!Number.isFinite(parameters.base_elevation))throw new Error('Explicit box edits require a finite base_elevation; the top stays fixed');
      if(!Array.isArray(associatedPartIds)||associatedPartIds.some(id=>typeof id!=='string')||new Set([partId,...associatedPartIds]).size!==associatedPartIds.length+1)throw new Error('Associated explicit part IDs must be distinct');
      for(const id of [partId,...associatedPartIds]){
        const item=plan.explicit_parts.find(item=>`${item.id}-assembly`===id);
        if(!item||item.shape?.primitive!=='box')throw new Error(`Explicit height edit requires a declared box assembly: ${id}`);
        const shape=item.shape.parameters;
        if(!Array.isArray(shape.origin)||!Array.isArray(shape.size)||shape.origin.length!==3||shape.size.length!==3||![...shape.origin,...shape.size].every(Number.isFinite)||shape.size.some(v=>v<=0)||shape.origin[2]+shape.size[2]<=parameters.base_elevation)throw new Error(`Explicit height edit produces invalid box bounds: ${id}`);
        shape.size[2]=shape.origin[2]+shape.size[2]-parameters.base_elevation;
        shape.origin[2]=parameters.base_elevation;
      }
    }
    else if(addition)addition.parameters={...addition.parameters,...parameters};
    else{
      const allowed=scene==='kitchen'&&partId==='kitchen-cabinet-feature'
        ?['drawer_extension','handle_material','handle_length','width','depth','height','front_gap']
        :scene==='kitchen'&&partId==='kitchen-window'?['window_sill_back_edge']
        :scene==='entry-facade'&&partId==='entry-window'?['window_width','door_open_angle','window_sill_back_edge']
        :scene==='entry-facade'&&['entry-wall','entry-door'].includes(partId)?['window_width','door_open_angle']:[];
      if(Object.keys(parameters).every(field=>allowed.includes(field)))Object.assign(baseParameters,parameters);
      else {
        if(associatedPartIds.length)throw new Error('Base recipe-local parameters require one explicit assembly; associated dependencies need a declared scene parameter');
        baseAssemblyParameters[partId]={...baseAssemblyParameters[partId],...parameters};
      }
    }
    const base=preserveCabinetFootIdentities(previous,buildDetailedScene({scene,variant:previous.base_variant||'baseline',parameters:baseParameters,assemblyParameters:baseAssemblyParameters}));
    const next=composeDesign(base,plan);
    return {...next,base_parameters:baseParameters,base_assembly_parameters:baseAssemblyParameters,base_variant:previous.base_variant||'baseline'};
  }
  if(previous.brief?.kind){
    const generated=buildDetailedRecipeSample({kind:previous.brief.kind,id:previous.part_graph.roots[0].part_id,parameters:{...previous.brief.parameters,...parameters}});
    const next=preserveCabinetFootIdentities(previous,generated);
    if(next===generated)return generated;
    // Recompile every downstream reference from the identity-preserving graph;
    // updating the specification alone would leave stale names in the DSL.
    const display=new Set(['scene','camera','style','rendering_options','shadow']);
    const dsl=compilePartGraphToSketchUpDsl(next.part_graph,next.profile);
    dsl.operations.push(...generated.dsl.operations.filter(operation=>display.has(operation.op)));
    return {...next,dsl,parts_mapping:describeAssemblyOccurrences(next.part_graph)};
  }
  return recompileDetailedScene(previous,{variant:previous.variant||'baseline',parameters:{...previous.parameter_changes,...parameters}});
}
