// Convenience plans use the public semantic contract. Their type names are
// labels only; compilation has no whole-building preset switch.
export function straightCorridorTask(id='assembly-corridor') {
  return {version:1,kind:'traditional_assembly',id,units:'mm',
    parameters:{bay_lengths_mm:[3000,3000,3000,3000],width_mm:2000,column_height_mm:2800,rise_mm:650,eave_mm:450},
    assembly:{version:1,mode:'contemporary_chinese',
      layout:{kind:'path',width_parameter:'width_mm',segments:[{id:'run',direction_deg:0,bay_lengths_parameter:'bay_lengths_mm'}]},
      assemblies:[{id:'frame',family:'path_frame'},{id:'roof',family:'roof_unit',parameters:{type:'gable'}},{id:'eave',family:'eave_unit'},{id:'seat',family:'rail_seat',parameters:{type:'seat',side:1}}],
      connections:[{from:'frame.bearing',to:'roof.bearing',relation:'contact'},{from:'roof.roof_surface',to:'eave.roof_surface',relation:'alignment'}],
      parameter_bindings:{frame:{column_height_mm:'column_height_mm'},roof:{rise_mm:'rise_mm',eave_projection_mm:'eave_mm'}},
      parameter_sources:{bay_lengths_mm:{basis:'selected',note:'Four engineering trial bays; change only index 1 to 3300 mm for sample A.'}},
      representation:{tile_detail:'surface'},simplifications:['Selected contemporary corridor; no historical period claimed.']},
    placement:{origin_mm:[0,0,0]}};
}
export function squarePavilionTask(id='assembly-pavilion') {
  const task=straightCorridorTask(id);
  task.parameters={bay_lengths_mm:[3600],width_mm:3600,column_height_mm:2800,rise_mm:1100,eave_mm:500};
  task.assembly.layout={kind:'grid',x_bays_parameter:'bay_lengths_mm',depth_parameter:'width_mm'};
  task.assembly.assemblies[0].family='frame_grid';task.assembly.assemblies[1].parameters.type='pyramidal';
  task.assembly.assemblies.push({id:'rail',family:'rail_seat',parameters:{type:'rail',side:-1}});
  task.assembly.parameter_sources={};return task;
}
export function cornerCorridorTask(id='assembly-corner') {
  const task=straightCorridorTask(id);task.parameters.bay_lengths_mm=[3000,3000];task.parameters.return_bays_mm=[3000,3000];
  task.assembly.layout.segments.push({id:'return',direction_deg:90,bay_lengths_parameter:'return_bays_mm'});
  task.assembly.simplifications.push('Equal-height/width 90-degree roof miter is a project-selected node.');return task;
}
export function moonWallTask(id='assembly-moon-wall') {
  return {version:1,kind:'traditional_assembly',id,units:'mm',parameters:{width_mm:4200,opening_mm:2100},
    assembly:{version:1,mode:'contemporary_chinese',layout:{kind:'free'},
      assemblies:[{id:'wall',family:'enclosure_opening',parameters:{height_mm:2600,thickness_mm:180,opening:'circle',opening_base_mm:100}}],
      connections:[],parameter_bindings:{wall:{width_mm:'width_mm',opening_width_mm:'opening_mm'}},representation:{tile_detail:'surface'}},
    placement:{origin_mm:[0,0,0]}};
}
export function roofedGateTask(id='assembly-gate') {
  const task=straightCorridorTask(id);
  task.parameters={bay_lengths_mm:[3000],width_mm:1400,column_height_mm:2800,rise_mm:550,eave_mm:350,opening_mm:1600};
  task.assembly.layout={kind:'grid',x_bays_parameter:'bay_lengths_mm',depth_parameter:'width_mm'};
  task.assembly.assemblies[0].family='frame_grid';
  task.assembly.assemblies=task.assembly.assemblies.filter(p=>p.family!=='rail_seat');
  task.assembly.assemblies.push({id:'gate-wall',family:'enclosure_opening',parameters:{segment_id:'grid',bay_index:0,side:1,height_mm:2600,opening:'rectangle',opening_height_mm:2100,opening_base_mm:100}});
  task.assembly.parameter_bindings['gate-wall']={opening_width_mm:'opening_mm'};return task;
}

export function houseUnitTask(id='assembly-house') {
  const task=straightCorridorTask(id);
  task.parameters={bay_lengths_mm:[3000,3000],width_mm:3600,column_height_mm:2800,rise_mm:900,eave_mm:450};
  task.assembly.layout={kind:'grid',x_bays_parameter:'bay_lengths_mm',depth_parameter:'width_mm'};
  task.assembly.assemblies[0].family='frame_grid';
  task.assembly.assemblies=task.assembly.assemblies.filter(p=>p.family!=='rail_seat');
  // More widely spaced tile ribs keep the composed courtyard below the
  // ordinary stored-geometry budget, including one retained gate definition.
  task.assembly.assemblies[1].parameters.tile_pitch_mm=300;
  task.assembly.assemblies.push(
    {id:'front-wall',family:'enclosure_opening',parameters:{segment_id:'grid',bay_index:0,side:-1,height_mm:2600,opening:'rectangle',opening_width_mm:1800,opening_height_mm:2200,opening_base_mm:100}},
    {id:'window-wall',family:'enclosure_opening',parameters:{segment_id:'grid',bay_index:1,side:-1,height_mm:2600,opening:'rectangle',opening_width_mm:1800,opening_height_mm:1300,opening_base_mm:850}},
    {id:'board-door',family:'joinery_panel',parameters:{type:'double_board_door',width_mm:1800,height_mm:2200,base_mm:100,open_angle_deg:90},origin_mm:[600,-1800,0]},
    {id:'window',family:'joinery_panel',parameters:{type:'lattice',width_mm:1800,height_mm:1300,base_mm:850,bars:5},origin_mm:[3600,-1800,0]}
  );
  task.assembly.simplifications=['Open side/back house unit for scheme expression; not an enclosed habitable building or historical reconstruction.','Plain board leaves and regular window lattice; hardware and carved details simplified.'];
  return task;
}

export function referenceTask(id='assembly-reference',origin=[0,0,0]) {
  return {version:1,kind:'traditional_assembly',id,units:'mm',parameters:{},
    assembly:{version:1,mode:'contemporary_chinese',layout:{kind:'free'},assemblies:[{id:'reference',family:'explicit_geometry',shape:{primitive:'box',parameters:{origin:[0,0,0],size:[500,500,500]}}}],connections:[]},placement:{origin_mm:origin}};
}

export function courtyardScenePlan(id='courtyard-c') {
  const main=houseUnitTask(`${id}-main`);main.placement.origin_mm=[0,9500,0];
  const west=houseUnitTask(`${id}-west`);west.placement={origin_mm:[-3500,2000,0],rotation_z_deg:90};
  const corridor=cornerCorridorTask(`${id}-corridor`);corridor.parameters.return_bays_mm=[2500,2500];corridor.placement.origin_mm=[0,1500,0];
  corridor.assembly.assemblies[1].parameters.tile_pitch_mm=300;
  const pavilion=squarePavilionTask(`${id}-pavilion`);pavilion.placement.origin_mm=[8000,9500,0];
  pavilion.assembly.assemblies[1].parameters.tile_pitch_mm=300;
  const gate=roofedGateTask(`${id}-gate`);gate.placement.origin_mm=[1000,-1800,0];
  const moon=moonWallTask(`${id}-moon-wall`);moon.placement.origin_mm=[-4000,-4000,0];
  const site={version:1,kind:'traditional_assembly',id:`${id}-site`,units:'mm',parameters:{},assembly:{version:1,mode:'contemporary_chinese',layout:{kind:'free'},assemblies:[
    {id:'gate-walk',family:'site_piece',parameters:{type:'plinth',width_mm:800,depth_mm:1600,height_mm:100},origin_mm:[2100,-1100,-100]},
    {id:'house-walk',family:'site_piece',parameters:{type:'plinth',width_mm:1800,depth_mm:1200,height_mm:100},origin_mm:[5000,6500,-100]},
    {id:'planter',family:'site_piece',parameters:{type:'planter',width_mm:1200,depth_mm:800,height_mm:500},origin_mm:[2000,6000,0]}],connections:[]},placement:{origin_mm:[0,0,0]}};
  return {version:1,id,units:'mm',roots:[main,west,corridor,pavilion,gate,moon,site,referenceTask(`${id}-reference`,[12000,-4000,0])],
    connections:[{from_root:gate.id,to_root:corridor.id,relation:'walkway',from_mm:[2500,-1100,0],to_mm:[2500,500,0],via_root:site.id},
      {from_root:corridor.id,to_root:main.id,relation:'walkway',from_mm:[5900,6500,0],to_mm:[5900,7700,0],via_root:site.id}],
    view:{id:`${id}-overview`,camera:{eye:[26000,-31000,23500],target:[3500,4000,1500],up:[0,0,1],projection:'perspective'}},
    notes:['Engineering trial courtyard with eight independent roots; edit only gate opening_mm from 1600 to 1900.','Walk slabs have top at z=0; the door/wall threshold is an explicit simplified 100 mm sill.','The L roof ends before the main-house roof; the declared open walkway bridges the 1200 mm floor gap.']};
}

export function unpresetScenePlan(id='unpreset-d') {
  const pavilion=squarePavilionTask(`${id}-pavilion`),corridor=straightCorridorTask(`${id}-seating-corridor`),moon=moonWallTask(`${id}-moon-wall`);
  corridor.parameters.bay_lengths_mm=[3000,3000];corridor.placement.origin_mm=[4600,0,0];
  corridor.assembly.assemblies.push({id:'link-deck',family:'site_piece',parameters:{type:'plinth',width_mm:1000,depth_mm:2000,height_mm:100},origin_mm:[-1000,-1000,-100]});
  moon.placement.origin_mm=[5000,4000,0];
  return {version:1,id,units:'mm',roots:[pavilion,corridor,moon],
    connections:[{from_root:pavilion.id,to_root:corridor.id,relation:'walkway',from_mm:[3600,0,0],to_mm:[4600,0,0],via_root:corridor.id}],
    view:{id:`${id}-overview`,camera:{eye:[17000,-14000,11000],target:[5000,1500,1500],up:[0,0,1],projection:'perspective'}},
    notes:['方亭接带坐凳的廊，旁设月洞景墙：decomposed into the same public families; no new whole-building preset.','An explicit open deck bridges the 1000 mm floor gap; the two roof envelopes meet only at their boundary.']};
}

export function unsupportedHexagonalTask(id='unpreset-d-unsupported') {
  const task=squarePavilionTask(id);
  Object.assign(task.assembly.assemblies[1].parameters,{type:'xieshan',storeys:2,plan_sides:6});
  task.assembly.open_questions=['Two-storey hexagonal xieshan requires unavailable support, roof and corner solvers.'];
  return task;
}
