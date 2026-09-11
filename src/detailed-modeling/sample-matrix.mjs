import { buildDetailedRecipeSample, describeAssemblyOccurrences } from './scenes.mjs';
import { requirementsForOccurrences } from './requirements.mjs';
import { compilePartGraphToSketchUpDsl } from '../product-modeling/part-graph-compiler.mjs';
import { freezeDetailSpecification } from '../detail-quality.mjs';

const cases = [
  ['window',{width:1600,height:1300,depth:130},{width:1800,height:1450,depth:170}],
  ['door',{width:1020,height:2250,depth:150},{width:1120,height:2400,depth:190,open_angle:-35}],
  ['cabinet',{width:800,depth:600,height:870},{width:950,depth:660,height:920,drawer_extension:160}],
  ['sink',{width:740,depth:440,height:180},{width:820,depth:500,height:210}],
  ['railing',{length:2600,height:1050},{length:3200,height:1150}],
  ['wall_junction',{width:4800,height:2900,openings:[{x:320,y:0,width:1000,height:2200},{x:1800,y:1100,width:1600,height:1300}]},
    {width:5200,height:3100,openings:[{x:320,y:0,width:1100,height:2350},{x:1800,y:1100,width:1800,height:1450}]}],
  ['eaves_drainage',{width:4800,downpipe_height:2900},{width:5200,downpipe_height:3300}],
  ['paving',{width:3600,depth:2400,tile_width:600,tile_depth:400},{width:4200,depth:2800,tile_width:600,tile_depth:400}]
];

// These are acceptance fixtures, not evidence of a general agent-generated scene.
// Every variant gets a new task/specification. Existing frozen tasks are untouched.
export function buildDetailedSampleMatrix() {
  return cases.map(([kind,baseParameters,changedParameters])=>{
    const label=kind.replaceAll('_','-');
    const baseline=buildDetailedRecipeSample({kind,id:`matrix-${label}-base`,parameters:baseParameters});
    const resized=buildDetailedRecipeSample({kind,id:`matrix-${label}-resized`,parameters:changedParameters});
    const nested=buildDetailedRecipeSample({kind,id:`matrix-${label}-nested`,parameters:baseParameters});
    const graph=nested.part_graph,oldRoot=graph.roots[0],wrapper=`${oldRoot.part_id}-fixture`,child=`${oldRoot.part_id}-placed`;
    graph.parts.push({id:wrapper,name:wrapper,type:'assembly',role:'acceptance_nested_fixture',assembly:{children:[{part_id:oldRoot.part_id,instance_id:child,origin:[0,0,0],transform:{mirror:'x',rotateZ:27}}]}});
    graph.roots=[{part_id:wrapper,instance_id:`id-${wrapper}`,origin:[0,0,0]}];
    nested.parts_mapping=describeAssemblyOccurrences(graph);
    nested.detail_spec.required_parts=requirementsForOccurrences(graph.parts,nested.parts_mapping,nested.recipes[0].requirements);
    nested.detail_spec.required_voids=(nested.detail_spec.required_voids||[]).map(rule=>({...rule,instance_path:[`id-${wrapper}`,child,...rule.instance_path.slice(1)]}));
    const w=baseParameters.width??baseParameters.length??3000,h=baseParameters.height??baseParameters.downpipe_height??1100;
    nested.views=nested.views.map((view,i)=>({...view,target_id:wrapper,camera:{eye:[w*0.6,-w*(i?1.1:2.1),h*1.5],target:[-w*0.45,-w*0.15,h*0.45],up:[0,0,1],fov:i?38:42}}));
    nested.detail_spec.required_views=nested.views.map(view=>({id:view.id,kind:view.kind,min_width:1400,min_height:900}));
    nested.dsl=compilePartGraphToSketchUpDsl(graph,nested.profile);
    nested.dsl.operations.push(...nested.views.map(view=>({op:'scene',name:view.id,camera:view.camera})),{op:'camera',...nested.views[0].camera});
    nested.brief={...nested.brief,variation:'One additional assembly nesting level, local X reflection and 27 degree Z rotation; original constructive geometry is retained.'};
    for(const bundle of [baseline,resized,nested])freezeDetailSpecification(bundle.detail_spec);
    return {kind,baseline,resized,nested_mirrored:nested,acceptance:{native_verified:false,required_negative_cases:['missing_required_part','metadata_only_replacement',...(kind==='wall_junction'||kind==='cabinet'||kind==='sink'?['blocked_required_void']:[]),...(kind==='window'||kind==='sink'||kind==='paving'?['rounded_profile_replaced_with_rectangle']:[])]}};
  });
}

// One native model per family contains three independent fixtures. This keeps
// the complete variation matrix inspectable without retaining many MDI windows.
// It is a test fixture, never evidence that an Agent designed a complete scene.
export function buildDetailedSampleCohort(kind) {
  const entry=buildDetailedSampleMatrix().find(item=>item.kind===kind);
  if(!entry)throw new Error(`Unknown detailed sample family: ${kind}`);
  const samples=[entry.baseline,entry.resized,entry.nested_mirrored].map(sample=>structuredClone(sample));
  const id=`matrix-${kind.replaceAll('_','-')}-cohort`;
  const parts=samples.flatMap(sample=>sample.part_graph.parts);
  const roots=[],views=[];
  for(const [index,sample] of samples.entries()){
    const offset=[index*14000,0,0];
    roots.push(...sample.part_graph.roots.map(root=>({...root,origin:(root.origin||[0,0,0]).map((value,axis)=>value+offset[axis])})));
    if(kind==='paving'){
      const {width,depth}=sample.brief.parameters;
      const transform=point=>index===2?[-point[0]*Math.cos(27*Math.PI/180)-point[1]*Math.sin(27*Math.PI/180),-point[0]*Math.sin(27*Math.PI/180)+point[1]*Math.cos(27*Math.PI/180),point[2]]:point;
      sample.views=sample.views.map((view,i)=>({...view,camera:{eye:transform(i?[width*.65,depth*.65,Math.max(width,depth)*.5]:[width*1.4,-depth*1.3,Math.max(width,depth)*1.1]),target:transform(i?[width*.65,depth*.9,25]:[width/2,depth/2,25]),up:[0,0,1],fov:42}}));
    }
    views.push(...sample.views.map(view=>({...view,camera:{...view.camera,eye:view.camera.eye.map((value,axis)=>value+offset[axis]),target:view.camera.target.map((value,axis)=>value+offset[axis])}})));
  }
  const part_graph={...samples[0].part_graph,id,parts,roots};
  const profile=samples[0].profile;
  const detail_spec={...samples[0].detail_spec,scene_id:id,
    resource_budget:Object.fromEntries(Object.keys(samples[0].detail_spec.resource_budget).map(key=>[key,samples.reduce((total,sample)=>total+sample.detail_spec.resource_budget[key],0)])),
    required_parts:samples.flatMap(sample=>sample.detail_spec.required_parts),
    required_voids:samples.flatMap(sample=>sample.detail_spec.required_voids),
    required_views:samples.flatMap(sample=>sample.detail_spec.required_views)};
  freezeDetailSpecification(detail_spec);
  const dsl=compilePartGraphToSketchUpDsl(part_graph,profile);
  dsl.operations.push(...views.map(view=>({op:'scene',name:view.id,camera:view.camera})),{op:'camera',...views[0].camera});
  return {dsl,part_graph,profile,parts_mapping:describeAssemblyOccurrences(part_graph),detail_spec,views,
    recipes:samples.flatMap(sample=>sample.recipes),brief:{fixture_kind:kind,variation_cohort:true,agent_scene_evidence:false,variants:['baseline','resized','nested_mirrored']}};
}
