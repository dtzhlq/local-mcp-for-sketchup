import { PROJECT_RULES, assemblyError } from './assembly-plan.mjs';
import { mergeMeshes, taggedBeam, boxMesh, boundsOf } from './assembly-mesh.mjs';
import { pathPoint } from './layout.mjs';
import { roofDimensions, buildRoofGeometry } from './roof-families.mjs';
import { plus } from './solids.mjs';

const D=PROJECT_RULES.defaults;
export const TRADITIONAL_FAMILIES=Object.freeze({
  frame_grid:{parameters:['column_height_mm','column_diameter_mm','beam_width_mm','beam_height_mm','purlin_width_mm','purlin_height_mm'],ports:['base','column_top','bearing']},
  path_frame:{parameters:['column_height_mm','column_diameter_mm','beam_width_mm','beam_height_mm','purlin_width_mm','purlin_height_mm'],ports:['base','column_top','bearing']},
  beam_purlin:{parameters:['start_mm','end_mm','width_mm','height_mm'],ports:['start','end','bearing']},
  roof_unit:{parameters:['type','storeys','plan_sides','rise_mm','eave_projection_mm','eave_lift_mm','rafter_width_mm','rafter_height_mm','rafter_spacing_mm','board_thickness_mm','tile_pitch_mm','tile_length_mm','tile_thickness_mm','tile_detail'],ports:['bearing','roof_surface','eave_line']},
  eave_unit:{parameters:[],ports:['roof_surface','eave_line']},
  bracket_or_seat:{parameters:['type','width_mm','depth_mm','height_mm'],ports:['bearing','top']},
  enclosure_opening:{parameters:['segment_id','bay_index','side','width_mm','height_mm','thickness_mm','opening','opening_width_mm','opening_height_mm','opening_base_mm'],ports:['base','top','opening']},
  joinery_panel:{parameters:['type','open_angle_deg','segment_id','bay_index','side','width_mm','height_mm','thickness_mm','base_mm','frame_width_mm','bars'],ports:['base','top']},
  rail_seat:{parameters:['type','side','height_mm','depth_mm','thickness_mm'],ports:['base','ends']},
  site_piece:{parameters:['type','width_mm','depth_mm','height_mm','wall_mm'],ports:['base','top']},
  explicit_geometry:{parameters:[],ports:[]}
});
function finite(p,key,value,min=1,max=12000) {
  const n=p[key]??value;if(!Number.isFinite(n)||n<min||n>max)assemblyError('INVALID_ARGUMENT',`${key} must be finite in [${min},${max}] mm.`);return n;
}
const value=(x,p)=>typeof x==='string'&&x.startsWith('$')?p[x.slice(1)]:Array.isArray(x)?x.map(v=>value(v,p)):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,value(v,p)])):x;
export function validateFamily(part) {
  const registry=TRADITIONAL_FAMILIES[part.family];
  for(const key of Object.keys(part.parameters||{}))if(!registry.parameters.includes(key))assemblyError('INVALID_ARGUMENT',`Unknown ${part.family} parameter ${key}; it cannot be silently ignored.`);
  if(part.shape&&part.family!=='explicit_geometry')assemblyError('INVALID_ARGUMENT','shape belongs only to explicit_geometry.');
  if(part.ports&&part.family!=='explicit_geometry')assemblyError('INVALID_ARGUMENT','Built-in family ports are solved from geometry; use explicit_geometry for declared custom ports.');
}
function makeResult(part,ref,ports,extra={}) {return {id:part.id,family:part.family,ref,ports,...extra};}
const locus=points=>({kind:'point_set',points});
function frameFamily(b,part,c) {
  const p=part.parameters,l=c.layout;
  if(!l.columns?.length)assemblyError('PARAMETER_DEPENDENCY','A frame needs a grid/path layout.');
  if(part.family==='frame_grid'&&l.kind!=='grid'||part.family==='path_frame'&&l.kind!=='path')assemblyError('PARAMETER_DEPENDENCY','Frame family must match declared layout.');
  const height=finite(p,'column_height_mm',2800,1600,6000),diameter=finite(p,'column_diameter_mm',D.column_diameter_mm,80,500);
  const bw=finite(p,'beam_width_mm',D.beam_width_mm,50,500),bh=finite(p,'beam_height_mm',D.beam_height_mm,80,700);
  const pw=finite(p,'purlin_width_mm',D.purlin_width_mm,40,400),ph=finite(p,'purlin_height_mm',D.purlin_height_mm,40,400);
  if(l.depth<diameter+400||l.segments.some(s=>s.bay_lengths.some(v=>v<diameter+400)))assemblyError('PARAMETER_DEPENDENCY','Negative or unusable clear span after column sections.');
  const columns=b.leaf(`${part.id}-column-prototype`,'cylinder',{origin:[0,0,0],radius:diameter/2,height,segments:16},'column','Detail_Oak','project selected section');
  const beams=[];
  for(const station of l.stations) {
    const ends=l.columns.filter(col=>col.station_id===station.id).map(col=>plus(col.point,[0,0,height-bh/2]));
    beams.push(taggedBeam(ends[0],ends[1],bw,bh));
  }
  for(const segment of l.segments)for(const side of [-1,1])for(let i=1;i<segment.stations.length;i++) {
    const A=l.columns.find(col=>col.station_id===segment.stations[i-1].id&&col.side===side).point;
    const B=l.columns.find(col=>col.station_id===segment.stations[i].id&&col.side===side).point;
    beams.push(taggedBeam(plus(A,[0,0,height-bh/2]),plus(B,[0,0,height-bh/2]),bw,bh));
  }
  const beam=b.mesh(`${part.id}-beams`,mergeMeshes(beams),'beam_frame','Detail_Oak','contact/lap, hidden mortises simplified');
  const ref=b.group(part.id,()=>[...l.columns.map(col=>b.at(columns,`${part.id}-${col.id}`,col.point)),beam],'frame');
  const context={id:part.id,height,diameter,beam_width:bw,beam_height:bh,purlin_width:pw,purlin_height:ph,layout:l};
  c.frame=context;
  return makeResult(part,ref,{base:locus(l.columns.map(v=>v.point)),column_top:locus(l.columns.map(v=>plus(v.point,[0,0,height]))),bearing:{kind:'frame_support',frame_id:part.id,height}}, {resolved_parameters:{...p,column_height_mm:height,column_diameter_mm:diameter,beam_width_mm:bw,beam_height_mm:bh,purlin_width_mm:pw,purlin_height_mm:ph},column_count:l.columns.length});
}
function roofFamily(b,part,c) {
  if(!c.frame)assemblyError('PARAMETER_DEPENDENCY','roof_unit requires a connected frame solved first.');
  const p=roofDimensions(part.parameters,c.frame),l=c.layout,f=c.frame;
  const detail=p.tile_detail??c.plan.representation.tile_detail;
  if(!['surface','light','detailed'].includes(detail))assemblyError('INVALID_ARGUMENT','tile_detail must be surface, light or detailed.');
  // Before allocating a tile mesh, reject a deliberately extreme declared plan.
  const area=l.segments.reduce((s,v)=>s+(v.length+2*p.eave_projection_mm)*(l.depth+2*p.eave_projection_mm),0);
  const estimated=area/(p.tile_pitch_mm*p.tile_length_mm)* (detail==='detailed'?120:detail==='light'?40:15);
  if(estimated>50000)assemblyError('RESOURCE_BUDGET','Declared tile sampling exceeds the ordinary task budget; reduce detail or split roots.', 'task.assembly.representation',{estimated_faces:Math.ceil(estimated)});
  const geometry=buildRoofGeometry(l,p,f,detail),bearing=[];
  if(p.type==='pyramidal') {
    const x=l.width/2;
    // Edge rafters share the same frame.height + purlin_height bearing as
    // pitched path roofs; the four corners must not hang above bare beams.
    const corners=[[0,-l.depth/2,f.height+f.purlin_height/2],[l.width,-l.depth/2,f.height+f.purlin_height/2],[l.width,l.depth/2,f.height+f.purlin_height/2],[0,l.depth/2,f.height+f.purlin_height/2]];
    for(let i=0;i<4;i++)bearing.push(taggedBeam(corners[i],corners[(i+1)%4],f.purlin_width,f.purlin_height));
    // Two tie beams support the selected centre strut. Their visible crossing
    // is a declared lap, rather than a floating apex post.
    bearing.push(taggedBeam([0,0,f.height-f.beam_height/2],[l.width,0,f.height-f.beam_height/2],f.beam_width,f.beam_height));
    bearing.push(taggedBeam([x,0,f.height],[x,0,f.height+p.rise_mm],f.purlin_width,f.purlin_width));
    bearing.push(boxMesh([x-f.purlin_width/2,-f.purlin_width/2,f.height+p.rise_mm],[f.purlin_width,f.purlin_width,f.purlin_height]));
  } else {
    for(const s of l.segments) {
      for(const side of [-1,0,1]) {
        const v=side*l.depth/2,[u0,u1]=[s.start_miter*v,s.length+s.end_miter*v];
        const z=f.height+p.rise_mm*(1-Math.abs(side))+f.purlin_height/2;
        bearing.push(taggedBeam(pathPoint(s,u0,v,z),pathPoint(s,u1,v,z),f.purlin_width,f.purlin_height));
      }
    }
    for(const station of l.stations)if(p.rise_mm>0)bearing.push(taggedBeam(plus(station.point,[0,0,f.height]),plus(station.point,[0,0,f.height+p.rise_mm]),f.purlin_width,f.purlin_width));
  }
  // A small plain ridge/hip cap follows the same surface, without copied
  // historical ornament. It closes the tile strip apex omitted by clipping.
  const ridges=[];
  if(p.type==='pyramidal')for(const sx of [-1,1])for(const sy of [-1,1])ridges.push(taggedBeam([l.width/2,0,geometry.surface.apex_mm+35],[l.width/2+sx*geometry.surface.outer,sy*geometry.surface.outer,geometry.surface.underside(geometry.surface.outer)+p.board_thickness_mm+35],65,65));
  else for(const s of l.segments)ridges.push(taggedBeam(pathPoint(s,0,0,geometry.surface.apex_mm+35),pathPoint(s,s.length,0,geometry.surface.apex_mm+35),65,65));
  const children=[
    b.mesh(`${part.id}-purlins`,mergeMeshes(bearing),'purlin_and_strut','Detail_Oak','project contact bearing'),
    b.mesh(`${part.id}-boards`,geometry.boards,'roof_board','Detail_Oak','shared roof sample'),
    b.mesh(`${part.id}-tiles`,geometry.tiles,'roof_tile_surface','Detail_RoofTile',`project ${detail} representation`),
    b.mesh(`${part.id}-ridge`,mergeMeshes(ridges),'plain_ridge','Detail_RoofTile','selected plain cover')
  ];
  const ref=b.group(part.id,()=>children,'roof');
  c.roof={id:part.id,p,geometry,frame_id:f.id,detail};
  return makeResult(part,ref,{bearing:{kind:'frame_support',frame_id:f.id,height:f.height},roof_surface:{kind:'roof_surface',roof_id:part.id},eave_line:{kind:'eave_line',roof_id:part.id}}, {resolved_parameters:p,roof_topology:p.type,rendering:detail});
}
function eaveFamily(b,part,c) {
  if(!c.roof)assemblyError('PARAMETER_DEPENDENCY','eave_unit needs a connected roof_unit.');
  const g=c.roof.geometry,ref=b.group(part.id,()=>[
    b.mesh(`${part.id}-rafters`,g.rafters,'rafter','Detail_Oak','shared board surface and bearing line'),
    b.mesh(`${part.id}-fascia`,g.fascia,'eave_fascia','Detail_Oak','shared eave line')
  ],'eave');
  return makeResult(part,ref,{roof_surface:{kind:'roof_surface',roof_id:c.roof.id},eave_line:{kind:'eave_line',roof_id:c.roof.id}});
}
function spanLocation(part,c) {
  const p=part.parameters;
  if(p.segment_id===undefined)return {width:finite(p,'width_mm',undefined),origin:part.origin_mm||[0,0,0],angle:part.rotation_z_deg||0};
  if(part.origin_mm||part.rotation_z_deg)assemblyError('INVALID_ARGUMENT','A layout-bound panel cannot also supply independent placement.');
  const s=c.layout.segments.find(s=>s.id===p.segment_id),i=p.bay_index,side=p.side??1;
  if(!s||!Number.isInteger(i)||i<0||i>=s.bay_lengths.length||![-1,1].includes(side))assemblyError('INVALID_ARGUMENT','Panel requires known segment_id, bay_index and side +1/-1.');
  if(!c.frame)assemblyError('PARAMETER_DEPENDENCY','Layout-bound enclosure needs a frame.');
  if(i===0&&s.start_miter||i===s.bay_lengths.length-1&&s.end_miter)assemblyError('UNSUPPORTED_TOPOLOGY','Enclosures on miter bays need a custom boundary; use an interior straight bay or explicit geometry.');
  const offset=c.frame.diameter/2,width=s.bay_lengths[i]-2*offset;
  return {width,origin:pathPoint(s,s.stations[i].distance+offset,side*c.layout.depth/2,0),angle:Math.atan2(s.direction[1],s.direction[0])*180/Math.PI};
}
function enclosureFamily(b,part,c) {
  const p=part.parameters,s=spanLocation(part,c),w=s.width,h=finite(p,'height_mm',2500),d=finite(p,'thickness_mm',D.wall_thickness_mm,50,600);
  const opening=p.opening??'none';
  if(!['none','rectangle','circle'].includes(opening))assemblyError('UNSUPPORTED_TOPOLOGY','Supported wall openings are actual rectangle/circle holes.');
  const holes=[],voids=[];
  if(opening!=='none') {
    const ow=finite(p,'opening_width_mm',Math.min(1800,w-300)),oh=opening==='circle'?ow:finite(p,'opening_height_mm',2100),base=finite(p,'opening_base_mm',100,20,1000);
    if(p.opening_height_mm!==undefined&&opening==='circle'&&p.opening_height_mm!==ow)assemblyError('PARAMETER_DEPENDENCY','A circular opening must have equal width and height.');
    if(ow>w-160||oh+base>h-150)assemblyError('PARAMETER_DEPENDENCY','Opening must retain 80 mm wall sides and 150 mm lintel.');
    const x=(w-ow)/2;
    holes.push(opening==='circle'?Array.from({length:32},(_,i)=>{const a=-2*Math.PI*i/32;return [w/2+ow/2*Math.cos(a),base+ow/2+ow/2*Math.sin(a)];}):[[x,base],[x,base+oh],[x+ow,base+oh],[x+ow,base]]);
    const margin=opening==='circle'?ow*.27:30;
    voids.push({id:`${part.id}-clear-opening`,instance_path:[b.id,b.full(part.id)],search_scope:'assembly',bounds_mm:{min:[x+margin,-d/2-5,base+margin],max:[x+ow-margin,d/2+5,base+oh-margin]}});
  }
  const leaf=b.leaf(`${part.id}-wall`,'profile_extrude',{origin:[0,-d/2,0],plane:'xz',outer:[[0,0],[w,0],[w,h],[0,h]],depth:d,...(holes.length?{holes}:{})},'wall_with_opening','Detail_Plaster','explicit wall, actual hole');
  const ref=b.group(part.id,()=>[leaf],'enclosure');
  // One local wrapper keeps frozen opening bounds independent of site heading.
  return makeResult(part,b.at(ref,part.id,s.origin,s.angle),{base:locus([[...s.origin]]),top:locus([plus(s.origin,[0,0,h])]),opening:{kind:'opening',shape:opening}}, {required_voids:voids,resolved_parameters:{...p,width_mm:w,height_mm:h,thickness_mm:d},placement:s});
}
function joineryFamily(b,part,c) {
  const p=part.parameters,s=spanLocation(part,c),w=s.width,h=finite(p,'height_mm',1200),d=finite(p,'thickness_mm',70,30,200),z=finite(p,'base_mm',800,0,2000),f=finite(p,'frame_width_mm',55,20,150),n=p.bars??6;
  const type=p.type??'lattice';
  if(!['lattice','double_board_door'].includes(type))assemblyError('UNSUPPORTED_TOPOLOGY','Joinery supports a regular lattice or two plain board leaves.');
  if(type==='double_board_door'&&p.bars!==undefined||type==='lattice'&&p.open_angle_deg!==undefined)assemblyError('INVALID_ARGUMENT','Door angle and lattice bars belong to their respective joinery type.');
  if(!Number.isInteger(n)||n<1||n>16||w<=2*f+50||h<=2*f+50||c.frame&&z+h>c.frame.height)assemblyError('PARAMETER_DEPENDENCY','Invalid joinery clear area/bars or panel above frame.');
  const meshes=[boxMesh([0,-d/2,z],[w,d,f]),boxMesh([0,-d/2,z+h-f],[w,d,f]),boxMesh([0,-d/2,z+f],[f,d,h-2*f]),boxMesh([w-f,-d/2,z+f],[f,d,h-2*f])];
  const leaves=[];
  if(type==='lattice')for(let i=1;i<=n;i++)meshes.push(boxMesh([f+(w-2*f)*i/(n+1)-12,-d/4,z+f],[24,d/2,h-2*f]));
  else {
    const angle=p.open_angle_deg??70,lw=(w-2*f)/2-4;
    if(!Number.isFinite(angle)||angle<0||angle>110)assemblyError('INVALID_ARGUMENT','Board door angle must be 0..110 degrees.');
    for(const side of [-1,1]) {
      const leaf=b.leaf(`${part.id}-leaf-${side===-1?'left':'right'}`,'box',{origin:[side===-1?0:-lw,-d/4,0],size:[lw,d/2,h-2*f-4]},'board_door_leaf','Detail_Oak','plain boards; concealed hinges simplified');
      leaves.push(b.at(leaf,`${part.id}-hinge-${side}`,[side===-1?f:w-f,0,z+f+2],side*angle));
    }
  }
  const ref=b.group(part.id,()=>[b.mesh(`${part.id}-frame`,mergeMeshes(meshes),type,'Detail_Oak','selected plain joinery'),...leaves],'joinery');
  return makeResult(part,b.at(ref,part.id,s.origin,s.angle),{base:locus([plus(s.origin,[0,0,z])]),top:locus([plus(s.origin,[0,0,z+h])])},{resolved_parameters:{...p,type,width_mm:w,height_mm:h}});
}
function railFamily(b,part,c) {
  const p=part.parameters,type=p.type??'seat',side=p.side??1,height=finite(p,'height_mm',type==='seat'?450:900,200,1600),depth=finite(p,'depth_mm',type==='seat'?380:60,30,600),thickness=finite(p,'thickness_mm',50,20,150);
  if(!['seat','rail'].includes(type)||![-1,1].includes(side)||!c.frame)assemblyError('PARAMETER_DEPENDENCY','Rail/seat needs a frame and one explicit side.');
  const meshes=[];
  for(const s of c.layout.segments)for(let i=1;i<s.stations.length;i++) {
    const A=c.layout.columns.find(v=>v.station_id===s.stations[i-1].id&&v.side===side).point,B=c.layout.columns.find(v=>v.station_id===s.stations[i].id&&v.side===side).point;
    const length=Math.hypot(...A.map((v,k)=>B[k]-v)),inset=c.frame.diameter/2;
    const at=t=>A.map((v,k)=>v+(B[k]-v)*t);
    const a=at(inset/length),z=at(1-inset/length);
    meshes.push(taggedBeam(plus(a,[0,0,height-thickness/2]),plus(z,[0,0,height-thickness/2]),depth,thickness));
    if(type==='seat')for(const t of [.2,.8]){const v=at(t);meshes.push(boxMesh(plus(v,[-35,-35,0]),[70,70,height-thickness]));}
    else {meshes.push(taggedBeam(plus(a,[0,0,120]),plus(z,[0,0,120]),40,40));for(let j=1,n=Math.ceil(length/400);j<n;j++)meshes.push(taggedBeam(plus(at(j/n),[0,0,120]),plus(at(j/n),[0,0,height-thickness]),30,30));}
  }
  return makeResult(part,b.group(part.id,()=>[b.mesh(`${part.id}-members`,mergeMeshes(meshes),type,'Detail_Oak','project selected simple rail/seat')],'rail_seat'),{base:locus(c.layout.columns.filter(v=>v.side===side).map(v=>v.point)),ends:locus(c.layout.columns.filter(v=>v.side===side).map(v=>v.point))},{resolved_parameters:{...p,type,height_mm:height}});
}
function siteFamily(b,part,c) {
  const p=part.parameters,type=p.type??'plinth',w=finite(p,'width_mm',1000),d=finite(p,'depth_mm',1000),h=finite(p,'height_mm',150,20,1500);
  if(!['plinth','step','planter','screen_wall'].includes(type))assemblyError('INVALID_ARGUMENT','Unknown site_piece type.');
  const meshes=[];
  if(type==='planter') {const t=finite(p,'wall_mm',80,30,200);if(w<=2*t||d<=2*t||h<=t)assemblyError('PARAMETER_DEPENDENCY','Planter needs positive cavity.');meshes.push(boxMesh([0,0,0],[w,d,t]),boxMesh([0,0,t],[w,t,h-t]),boxMesh([0,d-t,t],[w,t,h-t]),boxMesh([0,t,t],[t,d-2*t,h-t]),boxMesh([w-t,t,t],[t,d-2*t,h-t]));}
  else meshes.push(boxMesh([0,0,0],[w,d,h]));
  const ref=b.group(part.id,()=>[b.mesh(`${part.id}-body`,mergeMeshes(meshes),type,type==='screen_wall'?'Detail_Plaster':'Detail_Stone','project selected simple site geometry')],'site');
  const origin=part.origin_mm||[0,0,0];
  return makeResult(part,b.at(ref,part.id,origin,part.rotation_z_deg||0),{base:locus([origin]),top:locus([plus(origin,[0,0,h])])},{resolved_parameters:{...p,width_mm:w,depth_mm:d,height_mm:h}});
}
function explicitFamily(b,part,c) {
  const shape=value(part.shape,c.geometry_parameters);
  if(!shape||!['box','cylinder','profile_extrude','mesh','pipe_between_points'].includes(shape.primitive))assemblyError('INVALID_ARGUMENT','Explicit geometry uses only bounded existing shape primitives.');
  const serialized=JSON.stringify(shape);
  if(serialized.length>100000||/null/.test(serialized))assemblyError('RESOURCE_BUDGET','Explicit shape must be finite and under 100 KB.');
  const numbers=[];const visit=v=>{if(typeof v==='number')numbers.push(v);else if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')Object.values(v).forEach(visit);};visit(shape.parameters);
  if(numbers.some(v=>!Number.isFinite(v)||Math.abs(v)>60000))assemblyError('INVALID_ARGUMENT','Explicit geometry coordinates are finite mm with absolute values <=60000.');
  const ref=b.group(part.id,()=>[b.leaf(`${part.id}-body`,shape.primitive,shape.parameters,'explicit_geometry','Detail_Stone','declared approximation geometry')],'explicit_geometry');
  const ports=value(part.ports||{},c.geometry_parameters);
  for(const [name,port] of Object.entries(ports))if(!Array.isArray(port)||port.length!==3||!port.every(Number.isFinite))assemblyError('INVALID_ARGUMENT',`Explicit port ${name} must be a finite local point.`);
  const origin=part.origin_mm||[0,0,0],angle=(part.rotation_z_deg||0)*Math.PI/180;
  const toRoot=p=>plus([p[0]*Math.cos(angle)-p[1]*Math.sin(angle),p[0]*Math.sin(angle)+p[1]*Math.cos(angle),p[2]],origin);
  return makeResult(part,b.at(ref,part.id,origin,part.rotation_z_deg||0),Object.fromEntries(Object.entries(ports).map(([k,v])=>[k,locus([toRoot(v)])])),{resolved_parameters:shape.parameters});
}
export function buildFamily(b,part,c) {
  validateFamily(part);
  if(['frame_grid','path_frame','roof_unit','eave_unit','rail_seat'].includes(part.family)&&(part.origin_mm||part.rotation_z_deg))assemblyError('INVALID_ARGUMENT','Layout-driven families use the common root placement.');
  if(['frame_grid','path_frame'].includes(part.family))return frameFamily(b,part,c);
  if(part.family==='roof_unit')return roofFamily(b,part,c);
  if(part.family==='eave_unit')return eaveFamily(b,part,c);
  if(part.family==='enclosure_opening')return enclosureFamily(b,part,c);
  if(part.family==='joinery_panel')return joineryFamily(b,part,c);
  if(part.family==='rail_seat')return railFamily(b,part,c);
  if(part.family==='site_piece')return siteFamily(b,part,c);
  if(part.family==='explicit_geometry')return explicitFamily(b,part,c);
  if(part.family==='beam_purlin') {
    const p=part.parameters,a=p.start_mm,z=p.end_mm;
    if(![a,z].every(v=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(x)&&Math.abs(x)<=60000))||Math.hypot(...a.map((v,i)=>v-z[i]))<1)assemblyError('INVALID_ARGUMENT','Beam endpoints must be distinct finite vectors.');
    const w=finite(p,'width_mm',120),h=finite(p,'height_mm',180);
    const ref=b.group(part.id,()=>[b.beam(`${part.id}-body`,a,z,w,h,'beam','Detail_Oak','explicit engineering section')],'beam');
    return makeResult(part,ref,{start:locus([a]),end:locus([z]),bearing:locus([plus(a,[0,0,h/2]),plus(z,[0,0,h/2])])},{resolved_parameters:p});
  }
  const p=part.parameters,type=p.type??'none';
  if(type==='none')return makeResult(part,null,{},{simplification:'no bracket selected'});
  if(type!=='simple_seat')assemblyError('NEEDS_REFERENCE','Named historical bracket requires a compatible frozen local rule; decorative supports are not Song puzuo.');
  if(!c.frame)assemblyError('PARAMETER_DEPENDENCY','Simple seats need a frame.');
  const w=finite(p,'width_mm',240),d=finite(p,'depth_mm',240),h=finite(p,'height_mm',70),meshes=c.layout.columns.map(v=>boxMesh(plus(v.point,[-w/2,-d/2,c.frame.height-h]),[w,d,h]));
  return makeResult(part,b.group(part.id,()=>[b.mesh(`${part.id}-body`,mergeMeshes(meshes),'simple_seat','Detail_Oak','decorative engineering lap; not historical bracket')],'seat'),{bearing:{kind:'frame_support',frame_id:c.frame.id,height:c.frame.height},top:{kind:'frame_support',frame_id:c.frame.id,height:c.frame.height}},{resolved_parameters:{...p,width_mm:w,depth_mm:d,height_mm:h}});
}
