import {buildDetailedRecipe,DETAIL_MATERIALS,roundedRectangle} from './recipes.mjs';
import {compilePartGraphToSketchUpDsl} from '../product-modeling/part-graph-compiler.mjs';
import {requirementsForOccurrences,DETAIL_COVERAGE_VERSION} from './requirements.mjs';

export const DETAILED_SCENES = Object.freeze(['kitchen','entry-facade']);
export const DETAIL_SAMPLE_RESOURCE_BUDGET=Object.freeze({max_faces:50000,max_edges:120000,max_vertices:90000});
export const DETAIL_SCENE_RESOURCE_BUDGET=Object.freeze({max_faces:150000,max_edges:400000,max_vertices:300000});
function graphPart(id,primitive,parameters,material,role=id) {return {id,name:id,type:'detail_geometry',role,material,detail_level:'detailed',evidence_status:'manual_confirmed',fallback_state:'structured_primitive',shape:{primitive,parameters}};}
function camera(id,eye,target,kind='overview',target_id) {return {id,name:id,kind,...(target_id?{target_id}:{}),width:1600,height:1000,camera:{eye,target,up:[0,0,1],fov:kind==='closeup'?38:42}};}
function rect(w,h,x=0,y=0){return [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];}
function placedVoids(recipe,instanceId){return (recipe.required_voids||[]).map(v=>({...structuredClone(v),id:`${instanceId}:${v.id}`,instance_path:[instanceId,...v.instance_path.slice(1)]}));}

export function buildDetailedRecipeSample({kind='window',id=`sample-${kind}`,parameters={}}={}) {
  const recipe=buildDetailedRecipe(kind,{id,parameters});
  const graph={version:2,id:`detail-${id}`,profile_id:`detail-${kind}`,coordinate_system:'part_local',units:'mm',product:{type:kind,name:id},parts:recipe.parts,roots:[{part_id:id,instance_id:`id-${id}`,origin:[0,0,0]}]};
  const profile={version:1,profile_id:graph.profile_id,materials:structuredClone(DETAIL_MATERIALS)};
  const dsl=compilePartGraphToSketchUpDsl(graph,profile),parts_mapping=describeAssemblyOccurrences(graph);
  const dimensions={window:[parameters.width??1600,parameters.depth??130,parameters.height??1300],cabinet:[parameters.width??800,parameters.depth??600,parameters.height??870],door:[parameters.width??1020,parameters.depth??150,parameters.height??2250],sink:[parameters.width??740,parameters.depth??440,parameters.height??180]};
  const [w,d,h]=dimensions[kind]||[3000,500,1600];
  const views=[camera(`${id}-overview`,[w*1.4,-Math.max(w*1.9,1400),h*1.25],[w/2,d/2,h/2]),camera(`${id}-closeup`,[w*0.9,-Math.max(w*0.75,800),h*0.8],[w*0.65,d/2,h*0.6],'closeup',id)];
  dsl.operations.push(...views.map(v=>({op:'scene',name:v.id,camera:v.camera})),{op:'style',display_edges:true,profiles:false,face_style:'shaded_with_textures',background_color:'#eeeae2'},{op:'rendering_options',transparency:true,draw_hidden_geometry:false},{op:'camera',...views[0].camera});
  const required_parts=requirementsForOccurrences(graph.parts,parts_mapping,recipe.requirements);
  return {dsl,part_graph:graph,profile,parts_mapping,detail_spec:{version:1,coverage_version:DETAIL_COVERAGE_VERSION,scene_id:graph.id,detail_level:'detailed',resource_budget:structuredClone(DETAIL_SAMPLE_RESOURCE_BUDGET),required_parts,required_voids:placedVoids(recipe,`id-${id}`),required_views:views.map(v=>({id:v.id,kind:v.kind,min_width:1400,min_height:900})),max_iterations:6},views,brief:{id:`${id}-brief`,kind,parameters,source_type:'designed_benchmark_not_measured_project'},recipes:[recipe]};
}

export function buildDetailedScene({scene='kitchen',variant='baseline',detailLevel='detailed',parameters={},assemblyParameters={}}={}) {
  if(!DETAILED_SCENES.includes(scene))throw new Error(`Unknown detailed scene: ${scene}`);
  if(!['baseline','edited'].includes(variant))throw new Error(`Unknown detailed variant: ${variant}`);
  if(detailLevel!=='detailed')throw new Error('This benchmark requires detailed geometry; coarse substitutions are not accepted');
  const graph={version:2,id:`detailed-${scene}`,profile_id:`detailed-${scene}`,coordinate_system:'part_local',units:'mm',product:{type:scene,name:scene==='kitchen'?'Detailed joinery kitchen':'Detailed modern entry facade'},parts:[],roots:[]};
  const recipes=[],required=[],required_voids=[];
  const pendingAssemblyParameters=new Set(Object.keys(assemblyParameters));
  function add(kind,id,p,placements=[{instance_id:`id-${id}`,origin:[0,0,0]}]) {
    if(Object.hasOwn(assemblyParameters,id)){
      const overrides=assemblyParameters[id];
      if(!overrides||typeof overrides!=='object'||Array.isArray(overrides)||Object.keys(overrides).some(key=>!Object.hasOwn(p,key)))throw new Error(`Parameter is not supported by the base assembly binding ${id}`);
      p={...p,...overrides};pendingAssemblyParameters.delete(id);
    }
    const recipe=buildDetailedRecipe(kind,{id,parameters:p});recipes.push(recipe);graph.parts.push(...recipe.parts);
    for(const placement of placements){graph.roots.push({part_id:recipe.root_id,...placement});required_voids.push(...placedVoids(recipe,placement.instance_id||recipe.root_id));}
    required.push(...recipe.requirements.map(r=>({...r,recipe_id:id})));
    return recipe;
  }
  function objects(id,parts,origin=[0,0,0]) {
    graph.parts.push(...parts,{id,name:id,type:'assembly',role:id,evidence_status:'manual_confirmed',fallback_state:'structured_primitive',assembly:{children:parts.map(p=>({part_id:p.id}))}});
    graph.roots.push({part_id:id,instance_id:`id-${id}`,origin});
  }
  let views,brief,changes;
  if(scene==='kitchen'){
    changes=variant==='edited'?{drawer_extension:160,handle_material:'Detail_Brass'}:{drawer_extension:0,handle_material:'Detail_Stainless'};
    Object.assign(changes,parameters);
    add('wall_junction','kitchen-wall',{width:4300,height:2900,openings:[{name:'Kitchen_window_opening',x:1580,y:1300,width:1800,height:1150}]},[{instance_id:'id-kitchen-wall',origin:[0,3200,0]}]);
    add('window','kitchen-window',{width:1800,height:1150,depth:150,sill_back_edge:changes.window_sill_back_edge??-20},[{instance_id:'id-kitchen-window',origin:[1580,3220,1300]}]);
    add('door','kitchen-door',{width:980,height:2250,open_angle:-32},[{instance_id:'id-kitchen-door',origin:[0,1050,0],transform:{rotateZ:90}}]);
    objects('kitchen-return-wall',[
      graphPart('kitchen-return-wall-panel','panel_with_openings',{origin:[-308,0,0],plane:'yz',size:[2760,2900],thickness:308,
        openings:[{name:'Kitchen_door_opening',x:1050,y:0,width:980,height:2250}]},'Detail_Painted_Joinery','door_host_wall')
    ]);
    // Keep the open leaf outside this host-only reveal query. The passage
    // through the wall must be actual missing geometry, including its bottom.
    required_voids.push({id:'kitchen-door-host-opening',instance_path:['id-kitchen-return-wall'],search_scope:'assembly',
      bounds_mm:{min:[-300,1060,10],max:[-8,2020,2240]},boundary_checks:[{side:'min_y',offset_mm:15},{side:'max_y',offset_mm:15},{side:'max_z',offset_mm:15}]});
    add('cabinet','kitchen-cabinet-feature',{width:800,depth:620,height:870,...changes},[{instance_id:'id-kitchen-cabinet-feature',origin:[440,2520,0]}]);
    add('cabinet','kitchen-cabinet-common',{width:800,depth:620,height:870},[{instance_id:'id-kitchen-cabinet-common-left',origin:[1240,2520,0]},{instance_id:'id-kitchen-cabinet-common-right',origin:[2940,2520,0]}]);
    const sinkBase=[
      graphPart('kitchen-sink-base-left','box',{origin:[0,0,100],size:[18,620,770]},'Detail_Painted_Joinery','carcass_side'),
      graphPart('kitchen-sink-base-right','box',{origin:[882,0,100],size:[18,620,770]},'Detail_Painted_Joinery','carcass_side'),
      graphPart('kitchen-sink-base-bottom','box',{origin:[18,0,100],size:[864,620,18]},'Detail_Painted_Joinery','carcass_bottom'),
      graphPart('kitchen-sink-base-back','box',{origin:[18,610,118],size:[864,10,750]},'Detail_Painted_Joinery','carcass_back'),
      graphPart('kitchen-sink-base-toe','box',{origin:[25,80,0],size:[850,18,100]},'Detail_Gasket','toe_kick'),
      graphPart('kitchen-sink-door-left','profile_extrude',{origin:[3,-21,103],plane:'xz',outer:roundedRectangle(444,758,3),depth:21},'Detail_Oak','cabinet_door'),
      graphPart('kitchen-sink-door-right','profile_extrude',{origin:[453,-21,103],plane:'xz',outer:roundedRectangle(444,758,3),depth:21},'Detail_Oak','cabinet_door'),
      graphPart('kitchen-sink-pull-left','pipe_between_points',{start:[415,-48,450],end:[415,-48,610],radius:6,segments:32},'Detail_Stainless','handle'),
      graphPart('kitchen-sink-pull-right','pipe_between_points',{start:[485,-48,450],end:[485,-48,610],radius:6,segments:32},'Detail_Stainless','handle')
    ];objects('kitchen-sink-base',sinkBase,[2040,2520,0]);
    required_voids.push({id:'kitchen-sink-base-cavity',instance_path:['id-kitchen-sink-base'],search_scope:'scene',bounds_mm:{min:[20,5,120],max:[880,608,620]},boundary_checks:[{side:'min_x',offset_mm:5},{side:'max_x',offset_mm:5},{side:'min_z',offset_mm:5},{side:'max_y',offset_mm:5}]});
    add('sink','kitchen-sink',{width:740,depth:440,height:180},[{instance_id:'id-kitchen-sink',origin:[2090,2570,718]}]);
    objects('kitchen-worktop',[
      graphPart('kitchen-worktop-stone','profile_extrude',{origin:[400,2470,870],plane:'xy',outer:roundedRectangle(3400,730,7),depth:28,holes:[rect(704,404,1708,118)]},'Detail_Stone','worktop'),
      graphPart('kitchen-worktop-upstand','box',{origin:[400,3182,898],size:[3400,18,85]},'Detail_Stone','upstand')
    ]);
    required.push({id:'kitchen-worktop-stone',role:'worktop',material:'Detail_Stone',geometry_checks:[{type:'opening',min_count:1},{type:'profile',min_vertices:24}]});
    const floor=[];for(let row=0;row<13;row++)for(let col=0;col<4;col++)floor.push(graphPart(`kitchen-floor-${row}-${col}`,'profile_extrude',{origin:[col*1075,row*245,-22],plane:'xy',outer:roundedRectangle(1071,241,1.2,2),depth:22},row%3?'Detail_Oak':'Detail_Oak_Endgrain','floor_board'));
    objects('kitchen-floor',floor);
    const tiles=[];for(let row=0;row<3;row++)for(let col=0;col<13;col++)tiles.push(graphPart(`kitchen-backsplash-${row}-${col}`,'profile_extrude',{origin:[440+col*250+(row%2?125:0),3190,988+row*92],plane:'xz',outer:roundedRectangle(244,86,3),depth:8},'Detail_Painted_Joinery','backsplash_tile'));
    objects('kitchen-backsplash',tiles);
    const shelf=[graphPart('kitchen-open-shelf-board','profile_extrude',{origin:[450,2850,1780],plane:'xy',outer:roundedRectangle(960,320,4),depth:28},'Detail_Oak','shelf')];
    for(let i=0;i<2;i++)shelf.push(graphPart(`kitchen-shelf-bracket-${i}`,'profile_extrude',{origin:[560+i*630,3100,1530],plane:'yz',outer:[[0,0],[18,0],[18,238],[110,238],[110,254],[0,254]],depth:24},'Detail_Aluminium','shelf_bracket'));
    objects('kitchen-open-shelf',shelf,[0,-10,0]);
    // Additional counter island deliberately has open shelving and board thickness,
    // not an opaque carcass volume; the nearest side is visible in the hero view.
    objects('kitchen-island',[
      graphPart('kitchen-island-side-l','box',{origin:[1000,1050,0],size:[35,850,870]},'Detail_Oak','island_side'),
      graphPart('kitchen-island-side-r','box',{origin:[2565,1050,0],size:[35,850,870]},'Detail_Oak','island_side'),
      graphPart('kitchen-island-shelf','box',{origin:[1035,1080,250],size:[1530,780,28]},'Detail_Oak','island_shelf'),
      graphPart('kitchen-island-lower-shelf','box',{origin:[1035,1080,60],size:[1530,780,28]},'Detail_Oak','island_shelf'),
      graphPart('kitchen-island-worktop','profile_extrude',{origin:[950,1000,870],plane:'xy',outer:roundedRectangle(1700,950,12),depth:35},'Detail_Stone','island_worktop')
    ]);
    for(const [name,bottom,top] of [['lower',90,248],['upper',280,868]])required_voids.push({id:`kitchen-island-${name}-open-shelf`,instance_path:['id-kitchen-island'],search_scope:'scene',bounds_mm:{min:[1037,1082,bottom],max:[2563,1858,top]},boundary_checks:[{side:'min_x',offset_mm:5},{side:'max_x',offset_mm:5},{side:'min_z',offset_mm:3},{side:'max_z',offset_mm:3}]});
    views=[camera('kitchen-overview',[6500,-4500,3650],[2200,2250,1150]),camera('kitchen-front',[2180,-4600,1800],[2180,2720,1380]),camera('kitchen-sink-closeup',[2800,1950,1700],[2460,2800,915],'closeup','kitchen-sink'),camera('kitchen-cabinet-closeup',[1350,1510,1250],[820,2540,640],'closeup','kitchen-cabinet-feature'),camera('kitchen-window-closeup',[2800,2380,2080],[2480,3260,1820],'closeup','kitchen-window'),camera('kitchen-top',[2150,1650,8200],[2150,1651,0])];
    brief={id:'detailed-kitchen-brief-v1',scene:'kitchen',intent:'A joinery-focused kitchen whose basin, cabinet construction, hardware, reveals and window layers remain inspectable at close range.',dimensions_mm:[4300,3508,2900],required_features:['layered_wall_opening','double_glazed_window','hollow_cabinet_with_drawer_boxes','repeated_drawer_hardware','basin_walls_and_drain_hole','countertop_through_opening','board_thickness','island_open_shelves'],variant_change:'Only the feature cabinet top drawer extends 160 mm and its handle finish changes to brass; all other scene definitions remain unchanged.',source_type:'designed_benchmark_not_measured_project'};
  }else{
    changes=variant==='edited'?{window_width:1800,door_open_angle:-42}:{window_width:1600,door_open_angle:-18};Object.assign(changes,parameters);
    const ww=changes.window_width;
    add('wall_junction','entry-wall',{width:5200,height:3300,openings:[{name:'Entry_door_opening',x:610,y:0,width:1100,height:2350},{name:'Entry_window_opening',x:2400,y:1050,width:ww,height:1550}]},[{instance_id:'id-entry-wall',origin:[0,308,0],transform:{mirror:['y']}}]);
    add('door','entry-door',{width:1100,height:2350,depth:190,open_angle:changes.door_open_angle},[{instance_id:'id-entry-door',origin:[610,22,0]}]);
    add('window','entry-window',{width:ww,height:1550,depth:170,sill_back_edge:changes.window_sill_back_edge??-10},[{instance_id:'id-entry-window',origin:[2400,10,1050]}]);
    add('eaves_drainage','entry-eaves',{width:5300,downpipe_height:3300},[{instance_id:'id-entry-eaves',origin:[-50,-30,0]}]);
    add('railing','entry-railing',{length:2400,height:1050},[{instance_id:'id-entry-railing',origin:[2540,-1980,29]}]);
    add('paving','entry-paving',{width:5600,depth:2600,tile_width:560,tile_depth:400},[{instance_id:'id-entry-paving',origin:[-200,-2600,0]}]);
    const slats=[];for(let i=0;i<7;i++)slats.push(graphPart(`entry-slat-${i}`,'profile_extrude',{origin:[1840+i*55,-36,160],plane:'xy',outer:roundedRectangle(28,50,3),depth:2840},'Detail_Oak','facade_slat'));
    objects('entry-slats',slats,[60,-14,0]);
    objects('entry-canopy',[
      graphPart('entry-canopy-roof','profile_extrude',{origin:[460,-1220,2480],plane:'xy',outer:roundedRectangle(1430,1220,8),depth:48},'Detail_Aluminium','canopy_roof'),
      graphPart('entry-canopy-rear-beam','box',{origin:[460,-90,2410],size:[1430,65,70]},'Detail_Aluminium','canopy_beam'),
      graphPart('entry-canopy-stay-left','pipe_between_points',{start:[545,-1100,2530],end:[545,0,2870],radius:12,segments:32},'Detail_Stainless','canopy_stay'),
      graphPart('entry-canopy-stay-right','pipe_between_points',{start:[1795,-1100,2530],end:[1795,0,2870],radius:12,segments:32},'Detail_Stainless','canopy_stay')
    ],[0,-3.543675250191126,0]);
    views=[camera('entry-overview',[8500,-9800,5400],[2400,-300,1580]),camera('entry-front',[2600,-10800,1750],[2600,0,1650]),camera('entry-window-closeup',[4400,-2250,2290],[3200,60,1800],'closeup','entry-window'),camera('entry-door-closeup',[2000,-2000,1560],[1170,0,1250],'closeup','entry-door'),camera('entry-eaves-closeup',[6500,-1400,4150],[4780,-70,3300],'closeup','entry-eaves'),camera('entry-railing-closeup',[4300,-3550,1000],[3830,-1900,550],'closeup','entry-railing'),camera('entry-wall-junction-closeup',[-1200,-1500,1850],[-80,50,1700],'closeup','entry-wall'),camera('entry-paving-closeup',[2900,-4000,1500],[2600,-450,10],'closeup','entry-paving')];
    brief={id:'detailed-entry-brief-v1',scene:'entry-facade',intent:'A modern entrance with measurable window/door rebates, a layered wall corner, canopy, hollow drainpipe, ventilated soffit, railing fixings and drained paving.',dimensions_mm:[5600,2908,3570],required_features:['layered_wall_openings','window_thermal_break_and_double_glazing','framed_door_with_hinges','canopy_structure','hollow_downpipe','gutter_profile','soffit_vent_openings','railing_baseplate_fixings','paving_joints_and_grate_openings'],variant_change:'Window width increases 200 mm, including every host wall opening; the door opens a further 24 degrees.',source_type:'designed_benchmark_not_measured_project'};
  }
  const profile={version:1,profile_id:graph.profile_id,materials:structuredClone(DETAIL_MATERIALS),review:{scenes:views.map(v=>({name:v.id,camera:v.camera})),style:{display_edges:true,profiles:false,face_style:'shaded_with_textures',background_color:'#eeeae2',sky_color:'#dce7eb',ground_color:'#d8d4c9'},rendering_options:{draw_hidden_geometry:false,transparency:true,display_color_by_layer:false},shadow:{display:true,time:'2026-09-06T10:30:00+08:00',light:90,dark:25,use_sun_for_shading:true}}};
  const dsl=compilePartGraphToSketchUpDsl(graph,profile);
  // Keep the first overview active after creating all inspection scenes.
  dsl.operations.push({op:'camera',...views[0].camera});
  dsl.metadata={...dsl.metadata,detail_level:detailLevel,benchmark:true,variant};
  const parts_mapping=describeAssemblyOccurrences(graph);
  const required_parts=requirementsForOccurrences(graph.parts,parts_mapping,required.map(({recipe_id,...rule})=>rule));
  if(pendingAssemblyParameters.size)throw new Error(`Unknown base recipe assemblies: ${[...pendingAssemblyParameters].join(', ')}`);
  const detail_spec={version:1,coverage_version:DETAIL_COVERAGE_VERSION,scene_id:graph.id,detail_level:detailLevel,resource_budget:structuredClone(DETAIL_SCENE_RESOURCE_BUDGET),required_parts,required_voids,required_views:views.map(v=>({id:v.id,...(v.target_id?{target_id:v.target_id}:{}),min_width:1400,min_height:900,kind:v.kind})),max_iterations:6,source_type:'designed_benchmark_not_measured_project'};
  return {dsl,detail_spec,views,parts_mapping,part_graph:graph,profile,recipes:recipes.map(({parts,requirements,...r})=>r),variant,parameter_changes:changes,brief};
}

export function describeAssemblyOccurrences(graph) {
  const index=new Map(graph.parts.map(p=>[p.id,p])),result=[];
  const visit=(id,instancePath,definitionPath,stack=[])=>{
    if(stack.includes(id))throw new Error(`Assembly cycle while mapping: ${id}`);
    const part=index.get(id);if(!part)throw new Error(`Unknown assembly part: ${id}`);
    if(part.assembly){for(const child of part.assembly.children){const node=index.get(child.part_id);visit(child.part_id,[...instancePath,child.instance_id||node.id],[...definitionPath,`PG2_${id}`],[...stack,id]);}}
    else result.push({part_id:part.id,instance_path:instancePath,definition_path:definitionPath,role:part.role,material:part.material,primitive:part.shape?.primitive,local_geometry:structuredClone(part.shape?.parameters)});
  };
  for(const root of graph.roots)visit(root.part_id,[root.instance_id||root.part_id],[]);
  return result;
}

export function recompileDetailedScene(previous,{parameters={},variant='edited'}={}) {
  const next=buildDetailedScene({scene:previous.brief.scene,variant,parameters});
  const oldDefinitions=new Map(previous.dsl.operations.filter(x=>x.op==='component_definition').map(x=>[x.name,JSON.stringify(x)]));
  const changed_definitions=next.dsl.operations.filter(x=>x.op==='component_definition'&&oldDefinitions.get(x.name)!==JSON.stringify(x)).map(x=>x.name);
  return {...next,recompile_report:{previous_variant:previous.variant,variant,changed_definitions,preserved_part_ids:previous.part_graph.parts.filter(p=>next.part_graph.parts.some(n=>n.id===p.id)).length,stable_root_ids:JSON.stringify(previous.part_graph.roots.map(r=>r.instance_id))===JSON.stringify(next.part_graph.roots.map(r=>r.instance_id)),strategy:'rebuild_changed_definitions_from_parameters'}};
}
