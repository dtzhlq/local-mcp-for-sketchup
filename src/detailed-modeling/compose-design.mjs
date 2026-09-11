import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { buildDetailedRecipe, DETAIL_MATERIALS } from './recipes.mjs';
import { buildFurnishingAsset } from './furnishing-assets.mjs';
import { describeAssemblyOccurrences } from './scenes.mjs';
import { requirementsForOccurrences, DETAIL_COVERAGE_VERSION } from './requirements.mjs';
import { compilePartGraphToSketchUpDsl } from '../product-modeling/part-graph-compiler.mjs';
import { freezeDetailSpecification } from '../detail-quality.mjs';
import { normalizeComponentMirror } from '../component-operations.mjs';

const clone=value=>structuredClone(value);
const named=(value,label)=>{if(typeof value!=='string'||!value.trim())throw new Error(`${label} must be a nonempty string`);return value;};
function vector(value,label){if(!Array.isArray(value)||value.length!==3||!value.every(Number.isFinite))throw new Error(`${label} must contain three finite millimeter values`);return clone(value);}
function placement(value,label){
  if(!value||typeof value!=='object')throw new Error(`${label} must be an instance placement`);
  const result={instance_id:named(value.id??value.instance_id,`${label}.id`),origin:vector(value.origin??[0,0,0],`${label}.origin`)};
  if(value.transform!==undefined){
    if(!value.transform||typeof value.transform!=='object'||Array.isArray(value.transform))throw new Error(`${label}.transform must be an object`);
    const allowed=new Set(['translate','translation','rotateZ','rotationZ','mirror']);
    for(const key of Object.keys(value.transform))if(!allowed.has(key))throw new Error(`${label}.transform supports translate, rotateZ and mirror only; use constructive shape coordinates for other orientations`);
    for(const key of ['translate','translation'])if(value.transform[key]!==undefined)vector(value.transform[key],`${label}.transform.${key}`);
    for(const key of ['rotateZ','rotationZ'])if(value.transform[key]!==undefined&&!Number.isFinite(value.transform[key]))throw new Error(`${label}.transform.${key} must be finite`);
    result.transform=clone(value.transform);
    if(value.transform.mirror!==undefined)result.transform.mirror=normalizeComponentMirror(value.transform.mirror,`${label}.transform.mirror`);
  }
  return result;
}

/** Bind authored local void requirements to each concrete root occurrence. */
export function bindRecipeVoidsToInstances(requiredVoids,rootId,instances){
  if(requiredVoids===undefined)return [];
  if(!Array.isArray(requiredVoids))throw new Error(`Recipe ${rootId}.required_voids must be an array`);
  const ids=new Set();
  for(const rule of requiredVoids){
    named(rule?.id,`Recipe ${rootId}.required_voids.id`);
    if(ids.has(rule.id))throw new Error(`Duplicate recipe required void id: ${rule.id}`);ids.add(rule.id);
    if(!Array.isArray(rule.instance_path)||rule.instance_path[0]!==rootId)throw new Error(`Recipe void ${rule.id} must be anchored to recipe root ${rootId}`);
  }
  return instances.flatMap(instance=>requiredVoids.map(rule=>({...clone(rule),id:`${instance.instance_id}:${rule.id}`,instance_path:[instance.instance_id,...rule.instance_path.slice(1)]})));
}

/** Compile an explicit agent-authored composition plan; never infer a layout. */
export function composeDesign(baseBundle,compositionPlan){
  const plan=typeof compositionPlan==='string'?JSON.parse(compositionPlan):clone(compositionPlan);
  if(!plan||plan.version!==1)throw new Error('Composition plan requires version 1');
  const id=named(plan.id,'composition_plan.id');
  if(!baseBundle?.part_graph||baseBundle.part_graph.version!==2)throw new Error('composeDesign requires a PartGraph v2 baseBundle, not prebuilt DSL');
  if(!Array.isArray(plan.views)||!plan.views.length)throw new Error('composition_plan.views must explicitly describe the composition cameras');
  if(plan.additions!==undefined&&!Array.isArray(plan.additions))throw new Error('composition_plan.additions must be an array');
  if(plan.explicit_parts!==undefined&&!Array.isArray(plan.explicit_parts))throw new Error('composition_plan.explicit_parts must be an array');
  if(plan.required_voids!==undefined&&!Array.isArray(plan.required_voids))throw new Error('composition_plan.required_voids must be an array');
  const graph=clone(baseBundle.part_graph);
  graph.id=id;graph.profile_id=`${id}-profile`;graph.product={type:'design_composition',name:plan.brief?.title||id};
  const partIds=new Set();for(const part of graph.parts){if(partIds.has(part.id))throw new Error(`Duplicate base part: ${part.id}`);partIds.add(part.id);}
  const rootIds=new Set();for(const root of graph.roots){const rootId=root.instance_id||root.part_id;if(rootIds.has(rootId))throw new Error(`Duplicate base root: ${rootId}`);rootIds.add(rootId);}
  const materials=new Map(),explicitRequirements=clone(baseBundle.detail_spec?.required_parts||[]),requiredVoids=clone(baseBundle.detail_spec?.required_voids||[]),summaries=[];
  const mergeMaterials=(specs,label,defaults=false)=>{for(const spec of specs||[]){named(spec.name,`${label}.material.name`);if(defaults&&materials.has(spec.name))continue;if(materials.has(spec.name)&&!isDeepStrictEqual(materials.get(spec.name),spec))throw new Error(`Conflicting material declaration: ${spec.name}; assign a distinct material name`);materials.set(spec.name,clone(spec));}};
  mergeMaterials(baseBundle.profile?.materials||baseBundle.materials||[],'base');
  const addParts=(parts,label)=>{for(const part of parts){named(part.id,`${label}.id`);if(partIds.has(part.id))throw new Error(`Composition part id already exists: ${part.id}`);partIds.add(part.id);graph.parts.push(clone(part));}};
  const addInstances=(partId,instances,label)=>{
    if(!Array.isArray(instances)||!instances.length)throw new Error(`${label}.instances must explicitly place at least one instance`);
    const placements=[];
    for(const [index,instance] of instances.entries()){const placed=placement(instance,`${label}.instances[${index}]`);if(rootIds.has(placed.instance_id))throw new Error(`Composition root id already exists: ${placed.instance_id}`);rootIds.add(placed.instance_id);graph.roots.push({part_id:partId,...placed});placements.push(placed);}
    return placements;
  };
  for(const [index,addition] of (plan.additions||[]).entries()){
    const label=`composition_plan.additions[${index}]`;
    const family=addition.asset_kind?(addition.family||'furnishing'):'recipe';
    const kind=named(addition.asset_kind||addition.family,`${label}.asset_kind/family`),assetId=named(addition.id,`${label}.id`);
    if(!['furnishing','recipe'].includes(family))throw new Error(`${label}.family must be furnishing or recipe`);
    const asset=family==='furnishing'?buildFurnishingAsset(kind,{id:assetId,parameters:addition.parameters||{}}):buildDetailedRecipe(kind,{id:assetId,parameters:addition.parameters||{}});
    addParts(asset.parts,label);mergeMaterials(asset.materials||DETAIL_MATERIALS,label,true);explicitRequirements.push(...clone(asset.requirements||[]));
    const placements=addInstances(asset.root_id,addition.instances,label);
    requiredVoids.push(...bindRecipeVoidsToInstances(asset.required_voids,asset.root_id,placements));
    summaries.push({family,asset_kind:kind,id:assetId,parameters:clone(addition.parameters||{}),instances:clone(addition.instances),recipe_signature:asset.recipe_signature});
  }
  mergeMaterials(plan.materials||[],'composition_plan');
  for(const [index,input] of (plan.explicit_parts||[]).entries()){
    const label=`composition_plan.explicit_parts[${index}]`,partId=named(input.id,`${label}.id`);
    if(!input.shape?.primitive||!input.shape.parameters||input.assembly||input.operations)throw new Error(`${label} requires one constructive graph shape with parameters`);
    const wrapperId=`${partId}-assembly`;
    const part={id:partId,name:input.name||partId,type:'detail_geometry',role:input.role||partId,material:input.material,detail_level:'detailed',evidence_status:'manual_confirmed',fallback_state:'structured_primitive',shape:clone(input.shape),...(input.qa?{qa:clone(input.qa)}:{})};
    const wrapper={id:wrapperId,name:wrapperId,type:'assembly',role:input.role||'explicit_asset',detail_level:'detailed',evidence_status:'manual_confirmed',fallback_state:'structured_primitive',assembly:{children:[{part_id:partId}]}};
    addParts([part,wrapper],label);addInstances(wrapperId,input.instances||[{id:`id-${partId}`,origin:[0,0,0]}],label);
    explicitRequirements.push({id:partId,min_faces:input.min_faces??(input.shape.primitive==='mesh'?input.shape.parameters.faces?.length:6),geometry_checks:clone(input.geometry_checks||[])});
  }
  for(const part of graph.parts.filter(part=>part.shape))if(!part.material||!materials.has(part.material))throw new Error(`Part ${part.id} requires a declared material: ${part.material}`);
  const viewIds=new Set();
  const authoredViewIds=new Set(plan.views.map(view=>view.id??view.name));
  const requestedViews=[...plan.views,...(baseBundle.views||[]).filter(view=>view.kind==='closeup'&&!authoredViewIds.has(view.id))];
  const views=requestedViews.map((input,index)=>{
    const viewId=named(input.id??input.name,`composition_plan.views[${index}].id`);if(viewIds.has(viewId))throw new Error(`Duplicate composition view: ${viewId}`);viewIds.add(viewId);
    const camera=clone(input.camera);if(!camera)throw new Error(`View ${viewId} requires an explicit camera`);
    const eye=vector(camera.eye,`${viewId}.eye`),target=vector(camera.target,`${viewId}.target`),up=vector(camera.up??[0,0,1],`${viewId}.up`);
    const direction=target.map((v,i)=>v-eye[i]);if(Math.hypot(...direction)<1e-6||Math.hypot(...up)<1e-6)throw new Error(`View ${viewId} camera is degenerate`);
    const cross=[direction[1]*up[2]-direction[2]*up[1],direction[2]*up[0]-direction[0]*up[2],direction[0]*up[1]-direction[1]*up[0]];if(Math.hypot(...cross)<1e-6)throw new Error(`View ${viewId} up vector is parallel to its viewing direction`);
    if(input.target_id&&!partIds.has(input.target_id)&&!rootIds.has(input.target_id))throw new Error(`View ${viewId} references an unknown target: ${input.target_id}`);
    return {...clone(input),id:viewId,name:viewId,kind:input.kind||'overview',width:input.width??1600,height:input.height??1000,camera:{...camera,eye,target,up}};
  });
  const profile={...clone(baseBundle.profile||{}),version:1,profile_id:graph.profile_id,materials:[...materials.values()],review:{...clone(baseBundle.profile?.review||{}),scenes:views.map(view=>({name:view.id,camera:view.camera}))}};
  const dsl=compilePartGraphToSketchUpDsl(graph,profile);dsl.operations.push({op:'camera',...views[0].camera});
  const parts_mapping=describeAssemblyOccurrences(graph);
  requiredVoids.push(...clone(plan.required_voids||[]));
  const detail_spec={...clone(baseBundle.detail_spec||{}),version:1,coverage_version:DETAIL_COVERAGE_VERSION,scene_id:id,required_parts:requirementsForOccurrences(graph.parts,parts_mapping,explicitRequirements),...(requiredVoids.length||plan.required_voids!==undefined||baseBundle.detail_spec?.required_voids!==undefined?{required_voids:requiredVoids}:{}),required_views:views.map(view=>({id:view.id,kind:view.kind,...(view.target_id?{target_id:view.target_id}:{}),min_width:view.min_width??1400,min_height:view.min_height??900})),max_iterations:plan.max_iterations??baseBundle.detail_spec?.max_iterations??6};
  // Reuse the gate's field validation. The trusted task freezes this specification
  // separately; compilation is not a native receipt or a quality acceptance.
  freezeDetailSpecification(detail_spec);
  const occurrencePrefixes=new Set([JSON.stringify([]),...parts_mapping.flatMap(occurrence=>occurrence.instance_path.map((_,index)=>JSON.stringify(occurrence.instance_path.slice(0,index+1))))]);
  for(const rule of requiredVoids)if(!occurrencePrefixes.has(JSON.stringify(rule.instance_path)))throw new Error(`Required void ${rule.id} references an unknown occurrence path`);
  const brief={...clone(plan.brief||{}),id:`${id}-brief`,base_scene_id:baseBundle.part_graph.id,source_type:'agent_authored_composition_plan',additions:summaries,explicit_parts:(plan.explicit_parts||[]).map(part=>({id:part.id,role:part.role,instances:clone(part.instances||[{id:`id-${part.id}`,origin:[0,0,0]}])})),design_decisions:clone(plan.design_decisions||plan.brief?.decisions||[])};
  return {dsl,part_graph:graph,profile,detail_spec,parts_mapping,views,brief,composition_plan:plan,composition_report:{base_scene_id:baseBundle.part_graph.id,added_part_count:graph.parts.length-baseBundle.part_graph.parts.length,added_root_count:graph.roots.length-baseBundle.part_graph.roots.length,material_count:materials.size,view_count:views.length}};
}

export async function saveComposedDesign(bundle,outputDirectory){
  const target=path.resolve(outputDirectory);await fs.mkdir(path.dirname(target),{recursive:true});await fs.mkdir(target,{recursive:false});
  const files={ 'scene.dsl.json':bundle.dsl,'part-graph.json':bundle.part_graph,'profile.json':bundle.profile,'detail-spec.json':bundle.detail_spec,'views.json':bundle.views,'parts-mapping.json':bundle.parts_mapping,'brief.json':bundle.brief,'composition-plan.json':bundle.composition_plan,'composition-report.json':bundle.composition_report };
  for(const [name,value] of Object.entries(files))await fs.writeFile(path.join(target,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  return {directory:target,files:Object.keys(files),live_runtime_executed:false};
}
