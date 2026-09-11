import crypto from 'node:crypto';
import { resolveCurveSegments } from '../curve-resolution.mjs';
import { parallelTransportFrames } from '../surface-operations.mjs';

export const DETAILED_RECIPE_KINDS = Object.freeze(['window','door','cabinet','sink','railing','wall_junction','eaves_drainage','paving']);
export const DETAIL_MATERIALS = Object.freeze([
  {name:'Detail_Plaster',color:'#e6e0d4'}, {name:'Detail_Concrete',color:'#b6b4aa'},
  {name:'Detail_Oak',color:'#aa794a'}, {name:'Detail_Oak_Endgrain',color:'#8c603d'},
  {name:'Detail_Painted_Joinery',color:'#e8e5db'}, {name:'Detail_Aluminium',color:'#39474c'},
  {name:'Detail_Stainless',color:'#aab5b6'}, {name:'Detail_Brass',color:'#b48b45'},
  {name:'Detail_Gasket',color:'#292c29'}, {name:'Detail_Glass',color:'#adcbd1',alpha:0.32},
  {name:'Detail_Stone',color:'#cbc6b8'}, {name:'Detail_Grout',color:'#6a6961'},
  {name:'Detail_Insulation',color:'#d6be80'}, {name:'Detail_Waterproofing',color:'#454b47'},
  {name:'Detail_Terracotta',color:'#996f55'}, {name:'Detail_Soil',color:'#655343'},
  {name:'Detail_Leaf',color:'#6f825b'}
]);

const clone = (x) => structuredClone(x);
const rectangle = (w,h,x=0,y=0) => [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
export function circlePoints(radius, count=32, center=[0,0]) {
  return Array.from({length:count},(_,i)=>[center[0]+radius*Math.cos(i*2*Math.PI/count),center[1]+radius*Math.sin(i*2*Math.PI/count)]);
}
export function roundedRectangle(w,h,r=4,n=5) {
  if (r <= 0 || r*2 >= Math.min(w,h)) throw new Error('Rounded rectangle radius must fit its profile');
  const result=[];
  for (const [cx,cy,start] of [[w-r,r,-90],[w-r,h-r,0],[r,h-r,90],[r,r,180]]) {
    for(let i=0;i<=n;i++){const angle=(start+i*90/n)*Math.PI/180;result.push([cx+r*Math.cos(angle),cy+r*Math.sin(angle)]);}
  }
  return result;
}

export function hollowPipeMesh(path,outerRadius,innerRadius,count=40) {
  if(!Array.isArray(path)||!path.every(point=>Array.isArray(point)&&point.length===3&&point.every(Number.isFinite)))throw new Error('Hollow pipe path requires finite 3D points');
  if(!(innerRadius>0&&outerRadius>innerRadius)||!Number.isInteger(count)||count<8)throw new Error('Hollow pipe requires positive wall thickness and at least eight ring segments');
  const {frames,closed}=parallelTransportFrames(path,'hollow pipe');
  if(closed)throw new Error('Hollow outlet path must have two open ends');
  const vertices=[],faces=[],ringCount=path.length,innerOffset=ringCount*count;
  for(const radius of [outerRadius,innerRadius])for(let ring=0;ring<ringCount;ring++){
    const {u,v}=frames[ring];
    for(let i=0;i<count;i++){const angle=i*2*Math.PI/count;vertices.push(path[ring].map((coordinate,axis)=>coordinate+radius*(u[axis]*Math.cos(angle)+v[axis]*Math.sin(angle))));}
  }
  for(let ring=0;ring<ringCount-1;ring++)for(let i=0;i<count;i++){
    const j=(i+1)%count,a=ring*count,b=(ring+1)*count;
    faces.push([a+i,a+j,b+j],[a+i,b+j,b+i]);
    faces.push([innerOffset+a+i,innerOffset+b+j,innerOffset+a+j],[innerOffset+a+i,innerOffset+b+i,innerOffset+b+j]);
  }
  // Annular end rims seal the wall material without covering either waterway.
  const end=(ringCount-1)*count;
  for(let i=0;i<count;i++){const j=(i+1)%count;faces.push([i,innerOffset+i,innerOffset+j],[i,innerOffset+j,j],[end+i,end+j,innerOffset+end+j],[end+i,innerOffset+end+j,innerOffset+end+i]);}
  return {vertices,faces,smooth:'all',construction:'bulk'};
}

export function downpipeShoePath(x,y=-80,top=160){
  const angle=70*Math.PI/180,lead=16,dy=100,dz=105;
  const radius=(dz-lead-dy/Math.tan(angle))/(Math.sin(angle)-(1-Math.cos(angle))/Math.tan(angle));
  const path=[[x,y,top],[x,y,top-lead/2],[x,y,top-lead]];
  for(let i=1;i<=14;i++){const theta=angle*i/14;path.push([x,y-radius*(1-Math.cos(theta)),top-lead-radius*Math.sin(theta)]);}
  path.push([x,y-dy,top-dz]);
  return path;
}

class RecipeBuilder {
  constructor(kind,id,parameters) {this.kind=kind;this.id=id;this.parameters=parameters;this.parts=[];this.requirements=[];this.required_voids=[];}
  void(key,bounds_mm,{instance_path=[this.id],search_scope='scene',boundary_checks=[]}={}) {
    this.required_voids.push({id:`${this.id}-${key}`,instance_path,search_scope,bounds_mm,boundary_checks});
  }
  part(key,op,parameters,material,role=key,checks=[]) {
    const id=`${this.id}-${key}`;
    this.parts.push({id,name:id,type:'detail_geometry',role,material,material_role:role,detail_level:'detailed',evidence_status:'manual_confirmed',fallback_state:'structured_primitive',shape:{primitive:op,parameters},qa:{recipe_kind:this.kind}});
    if(checks.length)this.requirements.push({id,role,material,geometry_checks:checks});
    return {part_id:id};
  }
  box(key,origin,size,material,role=key,checks=[]) {
    const reference=this.part(key,'box',{origin,size},material,role,checks);
    if(!checks.length && /carcass|drawer_|stretcher|shelf|door_jamb|toe_kick/.test(role)) this.requirements.push({id:reference.part_id,role,material,bounds_mm:{size:clone(size),tolerance_mm:0.5},geometry_checks:[]});
    return reference;
  }
  profile(key,origin,plane,outer,depth,material,holes=[],role=key,checks=[]) {return this.part(key,'profile_extrude',{origin,plane,outer,depth,holes},material,role,checks);}
  pipe(key,start,end,radius,material,segments=32) {return this.part(key,'pipe_between_points',{start,end,radius,segments,smooth:'all'},material,key);}
  assembly(key,children) {
    const id=key==='root'?this.id:`${this.id}-${key}`;
    this.parts.push({id,name:id,type:'assembly',role:key==='root'?this.kind:key,detail_level:'detailed',evidence_status:'manual_confirmed',fallback_state:'structured_primitive',assembly:{children}});
    return {part_id:id};
  }
  finish(children) {
    this.assembly('root',children);
    return {kind:this.kind,id:this.id,root_id:this.id,parts:this.parts,requirements:this.requirements,required_voids:clone(this.required_voids),parameters:clone(this.parameters),recipe_signature:crypto.createHash('sha256').update(JSON.stringify({kind:this.kind,parameters:this.parameters,parts:this.parts})).digest('hex')};
  }
}
function positive(value, fallback, label, min=1) {const n=value??fallback;if(!Number.isFinite(n)||n<min)throw new Error(`${label} must be >= ${min}`);return n;}
function boundsCheck(size,tolerance=0.5){return {type:'bounds',size,tolerance_mm:tolerance};}
const opening = () => ({type:'opening',min_count:1});
const profileDetail = (n=8) => ({type:'profile',min_vertices:n});

function hardwareHandle(b,key,length=160,material='Detail_Stainless') {
  const children=[b.pipe(`${key}-bar`,[0,-32,0],[length,-32,0],6,material),b.pipe(`${key}-post-l`,[12,0,0],[12,-32,0],5,material),b.pipe(`${key}-post-r`,[length-12,0,0],[length-12,-32,0],5,material)];
  for (let i=0;i<2;i++) children.push(b.profile(`${key}-screw-${i}`,[i*(length-24)+12,-2,-4],'xz',circlePoints(4,20),3,material,[], 'fixing'));
  return b.assembly(key,children);
}

function windowRecipe(b,p) {
  const w=positive(p.width,1600,'window.width',500),h=positive(p.height,1300,'window.height',500),d=positive(p.depth,130,'window.depth',80);
  const sillBackEdge = p.sill_back_edge ?? 150;
  if (!Number.isFinite(sillBackEdge) || Math.abs(sillBackEdge) > 1000) throw new Error('window.sill_back_edge must be a finite millimeter offset within 1000 mm');
  const c=[];
  c.push(b.profile('outer-frame',[0,0,0],'xz',rectangle(w,h),d,'Detail_Aluminium',[rectangle(w-110,h-110,55,55)],'frame',[opening(),profileDetail(4)]));
  c.push(b.profile('thermal-break',[18,18,18],'xz',rectangle(w-36,h-36),16,'Detail_Gasket',[rectangle(w-124,h-124,44,44)],'thermal_break',[opening()]));
  c.push(b.profile('outer-rebate',[8,-10,8],'xz',rectangle(w-16,h-16),12,'Detail_Aluminium',[rectangle(w-102,h-102,43,43)],'rebate',[opening()]));
  const sw=(w-128)/2;
  const sash=[];
  sash.push(b.profile('sash-frame',[0,0,0],'xz',rectangle(sw,h-128),58,'Detail_Aluminium',[rectangle(sw-64,h-192,32,32)],'sash_frame',[opening()]));
  sash.push(b.profile('sash-gasket',[24,-3,24],'xz',rectangle(sw-48,h-176),4,'Detail_Gasket',[rectangle(sw-62,h-190,7,7)],'glazing_gasket',[opening()]));
  sash.push(b.box('glass-outer',[32,7,32],[sw-64,6,h-192],'Detail_Glass','glazing'));
  sash.push(b.box('glass-inner',[32,31,32],[sw-64,6,h-192],'Detail_Glass','glazing'));
  sash.push(b.profile('glazing-spacer',[32,13,32],'xz',rectangle(sw-64,h-192),18,'Detail_Stainless',[rectangle(sw-80,h-208,8,8)],'spacer',[opening()]));
  const handle=hardwareHandle(b,'window-handle',110);
  sash.push({...handle,instance_id:`${b.id}-sash-handle`,origin:[sw-55,-8,h/2-65],transform:{rotateZ:0}});
  const sashRoot=b.assembly('sash',sash);
  c.push({...sashRoot,instance_id:`${b.id}-left-sash`,origin:[61,-4,64]});
  c.push({...sashRoot,instance_id:`${b.id}-right-sash`,origin:[67+sw,-4,64]});
  c.push(b.box('central-mullion',[w/2-18,0,55],[36,d,h-110],'Detail_Aluminium','mullion'));
  c.push(b.profile('projecting-sill',[-35,sillBackEdge-270,-25],'yz',[[0,0],[270,0],[270,28],[42,20],[36,8],[0,8]],w+70,'Detail_Stone',[],'sill',[profileDetail(6)]));
  return c;
}

function doorRecipe(b,p) {
  const w=positive(p.width,1020,'door.width',650),h=positive(p.height,2250,'door.height',1900),d=positive(p.depth,150,'door.depth',80);const c=[];
  c.push(b.box('jamb-left',[0,0,0],[60,d,h],'Detail_Oak','door_jamb'));
  c.push(b.box('jamb-right',[w-60,0,0],[60,d,h],'Detail_Oak','door_jamb'));
  c.push(b.box('head',[60,0,h-60],[w-120,d,60],'Detail_Oak','door_head'));
  c.push(b.box('jamb-rebate-left',[46,-10,0],[14,36,h-60],'Detail_Oak_Endgrain','rebate'));
  c.push(b.box('jamb-rebate-right',[w-60,-10,0],[14,36,h-60],'Detail_Oak_Endgrain','rebate'));
  c.push(b.profile('threshold',[50,-30,0],'yz',[[0,0],[210,0],[210,18],[160,18],[155,27],[35,27],[30,12],[0,12]],w-100,'Detail_Aluminium',[],'threshold',[profileDetail(8)]));
  const lw=w-128,lh=h-94,leaf=[];
  leaf.push(b.profile('leaf-stiles-rails',[0,0,0],'xz',rectangle(lw,lh),46,'Detail_Oak',[rectangle(lw-176,lh-210,88,105)],'door_leaf',[opening()]));
  leaf.push(b.profile('leaf-inset-panel',[80,11,97],'xz',roundedRectangle(lw-160,lh-194,6),22,'Detail_Oak_Endgrain',[],'raised_panel',[profileDetail(20)]));
  leaf.push(b.box('leaf-horizontal-rail',[60,-4,lh/2-35],[lw-120,12,70],'Detail_Oak','rail'));
  const handle=hardwareHandle(b,'door-handle',150,'Detail_Brass');leaf.push({...handle,instance_id:`${b.id}-handle`,origin:[lw-200,0,1040]});
  leaf.push(b.profile('lock-escutcheon',[lw-92,-5,930],'xz',roundedRectangle(30,70,7),5,'Detail_Brass',[circlePoints(5,20,[15,28])],'lock_escutcheon',[opening(),profileDetail(20)]));
  // The leaf rotates about its local origin. Keep the hinge barrel on that
  // axis and the plate outside the front skin instead of buried in the stile.
  for(let i=0;i<3;i++){leaf.push(b.pipe(`hinge-${i}`,[0,0,220+i*720],[0,0,310+i*720],7,'Detail_Brass'));leaf.push(b.box(`hinge-leaf-${i}`,[1,-3,235+i*720],[24,3,58],'Detail_Brass','hinge_plate'));}
  const leafRoot=b.assembly('leaf',leaf);c.push({...leafRoot,instance_id:`${b.id}-leaf-instance`,origin:[64,-4,30],transform:{rotateZ:p.open_angle??-18}});
  return c;
}

function cabinetRecipe(b,p) {
  const w=positive(p.width,800,'cabinet.width',500),d=positive(p.depth,600,'cabinet.depth',450),h=positive(p.height,870,'cabinet.height',600),t=18,gap=positive(p.front_gap,3,'front_gap',1),toe=100;const c=[];
  c.push(b.box('side-left',[0,0,toe],[t,d,h-toe],'Detail_Painted_Joinery','carcass_side'));
  c.push(b.box('side-right',[w-t,0,toe],[t,d,h-toe],'Detail_Painted_Joinery','carcass_side'));
  c.push(b.box('bottom',[t,0,toe],[w-2*t,d,t],'Detail_Painted_Joinery','carcass_bottom'));
  c.push(b.box('back',[t,d-9,toe+t],[w-2*t,9,h-toe-t],'Detail_Painted_Joinery','carcass_back'));
  c.push(b.box('top-stretcher-front',[t,0,h-40],[w-2*t,65,40],'Detail_Painted_Joinery','stretcher'));
  c.push(b.box('top-stretcher-back',[t,d-65,h-40],[w-2*t,65,40],'Detail_Painted_Joinery','stretcher'));
  c.push(b.box('toe-kick',[20,70,10],[w-40,18,toe-10],'Detail_Gasket','toe_kick'));
  for(const x of [45,w-45])for(const y of [80,d-70])c.push(b.part(`leg-${x}-${y}`,'cylinder',{origin:[x,y,0],radius:18,height:toe,segments:24},'Detail_Gasket','adjustable_foot'));
  const dh=(h-toe-3*gap)/3,drawer=[];
  drawer.push(b.profile('drawer-front',[gap,-21,0],'xz',roundedRectangle(w-2*gap,dh-gap,3),21,'Detail_Oak',[],'drawer_front',[profileDetail(20)]));
  drawer.push(b.box('drawer-bottom',[32,15,10],[w-64,d-90,12],'Detail_Painted_Joinery','drawer_bottom'));
  drawer.push(b.box('drawer-left-side',[32,15,22],[12,d-90,dh-55],'Detail_Painted_Joinery','drawer_side'));
  drawer.push(b.box('drawer-right-side',[w-44,15,22],[12,d-90,dh-55],'Detail_Painted_Joinery','drawer_side'));
  drawer.push(b.box('drawer-back',[44,d-87,22],[w-88,12,dh-55],'Detail_Painted_Joinery','drawer_back'));
  const handle=hardwareHandle(b,'drawer-handle',p.handle_length??190,p.handle_material??'Detail_Stainless');drawer.push({...handle,instance_id:`${b.id}-drawer-handle-instance`,origin:[w/2-(p.handle_length??190)/2,-21,dh-40]});
  const drawerRoot=b.assembly('drawer',drawer);
  for(let i=0;i<3;i++){
    c.push({...drawerRoot,instance_id:`${b.id}-drawer-${i+1}`,origin:[0,i===2?-(p.drawer_extension??0):0,toe+gap+i*dh]});
    b.void(`drawer-${i+1}-interior`,{min:[46,18,25],max:[w-46,d-90,dh-36]}, {
      instance_path:[b.id,`${b.id}-drawer-${i+1}`],
      boundary_checks:[{side:'min_x',offset_mm:5},{side:'max_x',offset_mm:5},{side:'min_y',offset_mm:25},{side:'max_y',offset_mm:5},{side:'min_z',offset_mm:5}]
    });
    for(const [suffix,x] of [['left',20],['right',w-28]])c.push(b.profile(`runner-${i}-${suffix}`,[x,12,toe+30+i*dh],'xz',[[0,0],[8,0],[8,25],[6,25],[6,3],[2,3],[2,25],[0,25]],d-60,'Detail_Stainless',[],'drawer_runner',[profileDetail(8)]));
  }
  return c;
}

function sinkRecipe(b,p) {
  const w=positive(p.width,740,'sink.width',400),d=positive(p.depth,440,'sink.depth',300),h=positive(p.height,180,'sink.height',100),wall=2.2;const c=[];
  const outer=roundedRectangle(w,d,24,8),inner=roundedRectangle(w-36,d-36,18,8).map(([x,y])=>[x+18,y+18]);
  c.push(b.profile('rim',[0,0,h],'xy',outer,3,'Detail_Stainless',[inner],'sink_rim',[opening(),profileDetail(24)]));
  // Tapered watertight wall ring: top and bottom rings, inner and outer skins.
  const bottom=roundedRectangle(w-84,d-84,28,8).map(([x,y])=>[x+42,y+42]);
  const innerBottom=roundedRectangle(w-84-2*wall,d-84-2*wall,28-wall,8).map(([x,y])=>[x+42+wall,y+42+wall]);
  const innerTop=inner.map(([x,y])=>[x+wall*(x<w/2?1:-1),y+wall*(y<d/2?1:-1)]);
  const n=inner.length,vertices=[...inner.map(([x,y])=>[x,y,h]),...bottom.map(([x,y])=>[x,y,0]),...innerTop.map(([x,y])=>[x,y,h]),...innerBottom.map(([x,y])=>[x,y,wall])],faces=[];
  for(let i=0;i<n;i++){const j=(i+1)%n;faces.push([i,j,n+j,n+i],[2*n+j,2*n+i,3*n+i,3*n+j],[i,2*n+i,2*n+j,j],[n+j,3*n+j,3*n+i,n+i]);}
  c.push(b.part('basin-walls','mesh',{vertices,faces,smooth:'all'},'Detail_Stainless','basin_wall',[{type:'solid',expected:true}]));
  c.push(b.profile('basin-bottom',[0,0,0],'xy',bottom,wall,'Detail_Stainless',[circlePoints(24,40,[w/2,d/2])],'basin_bottom',[opening(),profileDetail(24)]));
  c.push(b.profile('drain-flange',[w/2,d/2,wall],'xy',circlePoints(34,40),3,'Detail_Stainless',[circlePoints(23,40)],'drain',[opening(),profileDetail(32)]));
  c.push(b.profile('drain-tail',[w/2,d/2,-85],'xy',circlePoints(25,40),85,'Detail_Stainless',[circlePoints(22,40)],'drain_pipe',[opening()]));
  b.void('basin-interior',{min:[60,60,wall+5],max:[w-60,d-60,h-2]});
  b.void('basin-floor-support',{min:[60,60,5],max:[w/2-40,d-60,h-2]}, {boundary_checks:[{side:'min_z',offset_mm:4}]});
  b.void('continuous-drain-bore',{min:[w/2-12,d/2-12,-86],max:[w/2+12,d/2+12,wall+6]});
  const faucet=[];faucet.push(b.part('faucet-base','cylinder',{origin:[0,0,0],radius:24,height:12,segments:40},'Detail_Stainless','tap_base'));
  const arc=[],arcSegments=resolveCurveSegments({chord_tolerance_mm:0.15,max_segments:256},85,{sweepDegrees:180});
  for(let i=0;i<=arcSegments;i++){const a=i*Math.PI/arcSegments;arc.push([0,-85+85*Math.cos(a),250+85*Math.sin(a)]);}
  faucet.push(b.part('faucet-spout','pipe_between_points',{points:[[0,0,10],...arc,[0,-170,220]],radius:13,segments:40,smooth:'all'},'Detail_Stainless','continuous_curved_spout',[{type:'solid',expected:true}]));
  faucet.push(b.profile('faucet-aerator',[0,-170,217],'xy',circlePoints(13,32),3,'Detail_Stainless',[circlePoints(9,32)],'aerator',[opening()]));
  faucet.push(b.pipe('faucet-lever-pivot',[0,0,45],[27,0,45],10,'Detail_Stainless',32));
  faucet.push(b.pipe('faucet-lever',[24,0,45],[70,0,95],5,'Detail_Stainless',24));
  const faucetRoot=b.assembly('faucet',faucet);c.push({...faucetRoot,instance_id:`${b.id}-faucet-instance`,origin:[w/2,d+55,h+3]});
  return c;
}

function railingRecipe(b,p) {
  const length=positive(p.length,2600,'railing.length',900),h=positive(p.height,1050,'railing.height',700);const c=[];
  const post=[];
  post.push(b.profile('post-base',[0,0,0],'xy',roundedRectangle(110,110,6),12,'Detail_Stainless',[[20,20],[90,20],[90,90],[20,90]].map(center=>circlePoints(5,20,center)),'baseplate',[{type:'opening',min_count:4},profileDetail(20)]));
  post.push(b.part('post-tube','profile_extrude',{origin:[55,55,12],plane:'xy',outer:circlePoints(21,32),depth:h-45,holes:[circlePoints(18,32)],smooth:'all'},'Detail_Stainless','hollow_post',[opening(),profileDetail(32)]));
  post.push(b.part('rail-post-connector','cylinder',{origin:[55,55,h-40],radius:17,height:22,segments:32},'Detail_Stainless','rail_connector'));
  for(const [x,y] of [[20,20],[90,20],[90,90],[20,90]])post.push(b.part(`base-bolt-${x}-${y}`,'cylinder',{origin:[x,y,12],radius:8,height:7,segments:6,smooth:'coplanar'},'Detail_Stainless','bolt'));
  const postRoot=b.assembly('post',post),count=Math.max(2,Math.ceil(length/1100)+1),spacing=length/(count-1);
  for(let i=0;i<count;i++)c.push({...postRoot,instance_id:`${b.id}-post-${i+1}`,origin:[i*spacing,0,0]});
  const bend=160,bendSegments=resolveCurveSegments({chord_tolerance_mm:0.25,max_segments:256},bend,{sweepDegrees:90}),railPath=[];
  for(let i=0;i<=bendSegments;i++){const a=Math.PI-i*Math.PI/2/bendSegments;railPath.push([55+bend*Math.cos(a),55-bend+bend*Math.sin(a),h]);}
  for(let i=0;i<=bendSegments;i++){const a=Math.PI/2-i*Math.PI/2/bendSegments;railPath.push([length+55+bend*Math.cos(a),55-bend+bend*Math.sin(a),h]);}
  c.push(b.part('top-rail','pipe_between_points',{points:railPath,radius:24,segments:40,smooth:'all'},'Detail_Stainless','continuous_curved_rail',[{type:'solid',expected:true}]));
  for(let i=0;i<count-1;i++){
    c.push(b.box(`glass-panel-${i}`,[i*spacing+90,49,150],[spacing-70,12,h-250],'Detail_Glass','guard_panel'));
    for(const x of [i*spacing+75,(i+1)*spacing+20])for(const z of [220,h-200])c.push(b.box(`glass-clamp-${i}-${x}-${z}`,[x,34,z],[32,42,42],'Detail_Stainless','glass_clamp'));
  }
  return c;
}

function wallRecipe(b,p) {
  const w=positive(p.width,4800,'wall.width',800),h=positive(p.height,2900,'wall.height',1600),openings=clone(p.openings??[]);const c=[];
  const layers=[['inner-lining',0,15,'Detail_Plaster'],['service-layer',15,35,'Detail_Waterproofing'],['structure',50,150,'Detail_Concrete'],['insulation',200,90,'Detail_Insulation'],['outer-render',290,18,'Detail_Plaster']];
  const interiorCount=openings.filter(o=>o.x>0&&o.y>0&&o.x+o.width<w&&o.y+o.height<h).length;
  for(const [key,y,thickness,material] of layers)c.push(b.part(key,'panel_with_openings',{origin:[0,y,0],plane:'xz',size:[w,h],thickness,openings},material,key,interiorCount?[{type:'opening',min_count:interiorCount}]:[]));
  openings.forEach((o,i)=>{
    b.void(`opening-${i+1}-through-depth`,{min:[o.x+2,-1,o.y+2],max:[o.x+o.width-2,309,o.y+o.height-2]}, {search_scope:'assembly'});
    const sides=[...(o.x>0?['min_x']:[]),...(o.x+o.width<w?['max_x']:[]),...(o.y>0?['min_z']:[]),...(o.y+o.height<h?['max_z']:[])];
    for(const [key,y,thickness] of layers)b.void(`opening-${i+1}-${key}-reveals`,{min:[o.x+2,y+1,o.y+2],max:[o.x+o.width-2,y+thickness-1,o.y+o.height-2]}, {search_scope:'assembly',boundary_checks:sides.map(side=>({side,offset_mm:5}))});
  });
  // Exposed corner return makes the layered junction inspectable without relying
  // on a semantic claim hidden in one monolithic wall box.
  for(const [key,y,thickness,material] of layers){
    const outer=y+thickness;
    // Each layer wraps the outside corner up to its matching straight panel.
    // Nested L profiles share only boundaries, never overlapping wall volumes.
    const profile=y===0?[[-outer,-440],[0,-440],[0,outer],[-outer,outer]]
      :[[-outer,-440],[-y,-440],[-y,y],[0,y],[0,outer],[-outer,outer]];
    c.push(b.profile(`${key}-corner-return`,[0,0,0],'xy',profile,h,material,[],'corner_return'));
  }
  const floorGaps=openings.filter(o=>o.y<112).map(o=>[Math.max(0,o.x),Math.min(w,o.x+o.width)]).sort((a,b)=>a[0]-b[0]);
  const spans=[];let cursor=0;
  for(const [left,right] of floorGaps){if(left>cursor)spans.push([cursor,left]);cursor=Math.max(cursor,right);}if(cursor<w)spans.push([cursor,w]);
  spans.forEach(([left,right],i)=>c.push(b.profile(i===0?'skirting':`skirting-${i+1}`,[left,-19,0],'yz',[[0,0],[19,0],[19,105],[15,112],[8,112],[8,18],[0,18]],right-left,'Detail_Oak',[],'skirting',[profileDetail(7)])));
  return c;
}

function eavesRecipe(b,p) {
  const w=positive(p.width,4800,'eaves.width',1200),h=positive(p.downpipe_height,2900,'downpipe.height',1000);const c=[];
  c.push(b.profile('fascia',[0,0,h],'yz',[[0,0],[35,0],[35,180],[26,180],[26,35],[0,35]],w,'Detail_Aluminium',[],'fascia',[profileDetail(6)]));
  const x=w-130;
  const ventCount=Math.floor(w/220),soffitHoles=Array.from({length:ventCount},(_,i)=>rectangle(140,90,i*220+40,90));
  // The downpipe crosses the soffit: a hole in the outlet pan alone does not
  // establish an unobstructed drain through the assembled construction.
  soffitHoles.push(circlePoints(43,40,[x,340]));
  c.push(b.profile('soffit',[0,-420,h+8],'xy',rectangle(w,420),18,'Detail_Oak',soffitHoles,'soffit',[{type:'opening',min_count:ventCount+1}]));
  for(let i=0;i<Math.floor(w/220);i++)c.push(b.profile(`vent-${i}`,[i*220+40,-330,h+4],'xy',rectangle(140,90),5,'Detail_Aluminium',[rectangle(124,10,8,12),rectangle(124,10,8,35),rectangle(124,10,8,58)],'soffit_vent',[{type:'opening',min_count:3}]));
  const gutterProfile=[];for(let i=0;i<=24;i++){const a=Math.PI+i*Math.PI/24;gutterProfile.push([85+85*Math.cos(a),90+85*Math.sin(a)]);}for(let i=24;i>=0;i--){const a=Math.PI+i*Math.PI/24;gutterProfile.push([85+82*Math.cos(a),90+82*Math.sin(a)]);}
  c.push(b.profile('half-round-gutter',[0,-176,h+90],'yz',gutterProfile,x-45,'Detail_Aluminium',[],'gutter',[profileDetail(40)]));
  c.push(b.profile('gutter-outlet-return',[x+45,-176,h+90],'yz',gutterProfile,w-x-45,'Detail_Aluminium',[],'gutter',[profileDetail(40)]));
  c.push(b.profile('outlet-pan',[x-45,-176,h+93],'xy',rectangle(90,170),3,'Detail_Aluminium',[circlePoints(39,40,[45,96])],'gutter_outlet',[opening()]));
  c.push(b.box('outlet-back',[x-45,-9,h+96],[90,3,84],'Detail_Aluminium','outlet_wall'));
  c.push(b.box('outlet-front',[x-45,-176,h+96],[90,3,84],'Detail_Aluminium','outlet_wall'));
  const gutterCap=gutterProfile.slice(0,25);
  c.push(b.profile('gutter-endcap-left',[0,-176,h+90],'yz',gutterCap,3,'Detail_Aluminium',[],'gutter_endcap'));
  c.push(b.profile('gutter-endcap-right',[w-3,-176,h+90],'yz',gutterCap,3,'Detail_Aluminium',[],'gutter_endcap'));
  for(let i=0;i<=Math.floor(w/600);i++)c.push(b.box(`gutter-bracket-${i}`,[Math.min(i*600,w-20),-90,h+25],[18,125,8],'Detail_Stainless','gutter_bracket'));
  c.push(b.profile('downpipe',[x,-80,160],'xy',circlePoints(42,40),h-67,'Detail_Aluminium',[circlePoints(39,40)],'downpipe',[opening(),profileDetail(32)]));
  for(const z of [380,h/2,h-220]){
    c.push(b.profile(`pipe-clamp-${z}`,[x,-80,z],'xy',circlePoints(47,40),20,'Detail_Stainless',[circlePoints(43,40)],'pipe_clamp',[opening()]));
    c.push(b.box(`pipe-clamp-stand-${z}`,[x-12,-32,z+3],[24,62,14],'Detail_Stainless','pipe_clamp_stand'));
  }
  c.push(b.part('shoe','mesh',hollowPipeMesh(downpipeShoePath(x),42,39),'Detail_Aluminium','hollow_outlet_shoe',[{type:'solid',expected:true}]));
  b.void('assembled-downpipe-waterway',{min:[x-8,-88,170],max:[x+8,-72,h+100]});
  return c;
}

function pavingRecipe(b,p) {
  const w=positive(p.width,5200,'paving.width',600),d=positive(p.depth,2600,'paving.depth',600),tw=positive(p.tile_width,600,'paving.tile_width',100),td=positive(p.tile_depth,400,'paving.tile_depth',100),gap=positive(p.joint,5,'paving.joint',1);const c=[];
  c.push(b.box('substrate',[0,0,-110],[w,d,80],'Detail_Concrete','paving_substrate'));
  c.push(b.box('bedding',[0,0,-30],[w,d,24],'Detail_Grout','paving_bedding'));
  const tile=b.assembly('tile',[b.profile('tile-body',[0,0,0],'xy',roundedRectangle(tw-gap,td-gap,2.5),35,'Detail_Stone',[],'paver',[profileDetail(20)])]);
  // Reserve the channel before laying tiles, including a cut final course.
  // A full tile must never cap the measured openings in the separate grate.
  const pavedDepth=d-137;
  for(let y=0;y<pavedDepth;y+=td){
    const courseDepth=Math.min(td,pavedDepth-y);
    if(courseDepth<=gap+5)continue;
    const course=courseDepth===td?tile:b.assembly(`tile-cut-${y}`,[b.profile(`tile-cut-body-${y}`,[0,0,0],'xy',roundedRectangle(tw-gap,courseDepth-gap,2.5),35,'Detail_Stone',[],'paver',[profileDetail(20)])]);
    for(let x=0;x+tw<=w;x+=tw)c.push({...course,instance_id:`${b.id}-tile-${x}-${y}`,origin:[x+gap/2,y+gap/2,-6]});
  }
  c.push(b.box('channel-bed',[0,d-130,-12],[w,115,12],'Detail_Aluminium','drain_channel'));
  c.push(b.box('channel-wall-front',[0,d-132,0],[w,5,30],'Detail_Stainless','drain_channel'));
  c.push(b.box('channel-wall-back',[0,d-17,0],[w,5,30],'Detail_Stainless','drain_channel'));
  const grate=b.assembly('grate',[b.profile('grate-frame',[0,0,0],'xy',rectangle(290,100),12,'Detail_Stainless',Array.from({length:8},(_,i)=>rectangle(15,74,12+i*33,13)),'grate',[{type:'opening',min_count:8}])]);
  for(let i=0;i<Math.floor(w/300);i++){
    c.push({...grate,instance_id:`${b.id}-grate-${i}`,origin:[i*300,d-125,16]});
    b.void(`grate-${i}-waterway`,{min:[i*300+14,d-110,1],max:[i*300+25,d-40,31]},{search_scope:'assembly'});
  }
  return c;
}

const BUILDERS={window:windowRecipe,door:doorRecipe,cabinet:cabinetRecipe,sink:sinkRecipe,railing:railingRecipe,wall_junction:wallRecipe,eaves_drainage:eavesRecipe,paving:pavingRecipe};
export function buildDetailedRecipe(kind,{id=kind,parameters={}}={}) {
  if(!BUILDERS[kind])throw new Error(`Unknown detailed recipe: ${kind}`);
  if(!/^[A-Za-z0-9_-]+$/.test(id))throw new Error('Recipe id must use letters, numbers, underscore or hyphen');
  const b=new RecipeBuilder(kind,id,clone(parameters));return b.finish(BUILDERS[kind](b,parameters));
}
