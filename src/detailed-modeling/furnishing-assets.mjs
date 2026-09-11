import crypto from 'node:crypto';
import { DETAIL_MATERIALS, circlePoints, roundedRectangle } from './recipes.mjs';
import { describeAssemblyOccurrences } from './scenes.mjs';
import { requirementsForOccurrences, DETAIL_COVERAGE_VERSION } from './requirements.mjs';
import { compilePartGraphToSketchUpDsl } from '../product-modeling/part-graph-compiler.mjs';
import { tubeMeshFromPath } from '../surface-operations.mjs';

export const FURNISHING_ASSET_KINDS=Object.freeze(['reading_chair','side_table','pendant_light','potted_plant']);
export const FURNISHING_MATERIALS=Object.freeze([...DETAIL_MATERIALS,{name:'Detail_Fabric',color:'#c9beb0'}]);
const positive=(value,fallback,name,min)=>{const n=value??fallback;if(!Number.isFinite(n)||n<min)throw new Error(`${name} must be >= ${min} mm`);return n;};
const translated=(mesh,origin)=>({...mesh,vertices:mesh.vertices.map(p=>p.map((v,i)=>v+origin[i]))});

class AssetBuilder {
  constructor(kind,id,parameters){this.kind=kind;this.id=id;this.parameters=parameters;this.parts=[];this.requirements=[];}
  part(key,primitive,parameters,material,role=key,checks=[]){
    const id=`${this.id}-${key}`;
    this.parts.push({id,name:id,type:'detail_geometry',role,material,detail_level:'detailed',evidence_status:'manual_confirmed',fallback_state:'structured_primitive',shape:{primitive,parameters},qa:{asset_kind:this.kind}});
    const minimum=primitive==='mesh'?parameters.faces.length:primitive==='lofted_solid'?2*parameters.segments*(parameters.profile.length-1)+2*(parameters.segments-2):6;
    this.requirements.push({id,role,material,min_faces:minimum,geometry_checks:checks});return {part_id:id};
  }
  profile(key,origin,plane,outer,depth,material,holes=[],role=key){return this.part(key,'profile_extrude',{origin,plane,outer,depth,holes},material,role);}
  pipe(key,points,radius,material,segments=32,role=key){return this.part(key,'pipe_between_points',{points,radius,segments,smooth:'all'},material,role);}
  mesh(key,mesh,material,role=key){return this.part(key,'mesh',{vertices:mesh.vertices,faces:mesh.faces,smooth:'all',construction:'bulk'},material,role,[{type:'solid',expected:true}]);}
  assembly(key,children){const id=key==='root'?this.id:`${this.id}-${key}`;this.parts.push({id,name:id,type:'assembly',role:key==='root'?this.kind:key,detail_level:'detailed',evidence_status:'manual_confirmed',fallback_state:'structured_primitive',assembly:{children}});return {part_id:id};}
  finish(children){this.assembly('root',children);return {kind:this.kind,id:this.id,root_id:this.id,root:{part_id:this.id,instance_id:`id-${this.id}`,origin:[0,0,0]},parts:this.parts,materials:structuredClone(FURNISHING_MATERIALS),requirements:this.requirements,parameters:structuredClone(this.parameters),source:'project authored constructive furniture asset',license:'project source terms',units:'mm',recipe_signature:crypto.createHash('sha256').update(JSON.stringify({kind:this.kind,parts:this.parts})).digest('hex')};}
}

// Closed solid from ordered rings. Side triangles remain planar even when ring
// size or slope changes; cap polygons are restricted to planar rings.
function solidRings(rings){const n=rings[0].length,vertices=rings.flat(),faces=[Array.from({length:n},(_,i)=>n-1-i)];for(let r=0;r<rings.length-1;r++)for(let i=0;i<n;i++){const j=(i+1)%n,a=r*n+i,b=r*n+j,c=(r+1)*n+j,d=(r+1)*n+i;faces.push([a,b,c],[a,c,d]);}faces.push(Array.from({length:n},(_,i)=>(rings.length-1)*n+i));return {vertices,faces};}
function radialRing(radius,z,n=48){return circlePoints(radius,n).map(([x,y])=>[x,y,z]);}
function annularShell(profile,wall,n=64){
  const outer=profile.map(([z,r])=>radialRing(r,z,n)),inner=profile.map(([z,r])=>radialRing(r-wall,z,n));
  const vertices=[...outer.flat(),...inner.flat()],faces=[],offset=outer.length*n;
  for(let r=0;r<profile.length-1;r++)for(let i=0;i<n;i++){const j=(i+1)%n,a=r*n+i,b=r*n+j,c=(r+1)*n+j,d=(r+1)*n+i;faces.push([a,b,c],[a,c,d],[offset+a,offset+c,offset+b],[offset+a,offset+d,offset+c]);}
  for(let i=0;i<n;i++){const j=(i+1)%n,a=(profile.length-1)*n+i,b=(profile.length-1)*n+j;faces.push([i,offset+i,offset+j,j],[a,b,offset+b,offset+a]);}
  return {vertices,faces};
}
function cushion(width,depth,height,origin,tiltDegrees=0){
  const rings=[[0,12],[height*.16,2],[height*.7,0],[height,12]].map(([z,inset])=>roundedRectangle(width-2*inset,depth-2*inset,Math.min(42,(width-2*inset)/5,(depth-2*inset)/5),8).map(([x,y])=>[x+inset,y+inset,z]));
  const mesh=solidRings(rings),angle=tiltDegrees*Math.PI/180;
  mesh.vertices=mesh.vertices.map(([x,y,z])=>[x,y*Math.cos(angle)-z*Math.sin(angle),y*Math.sin(angle)+z*Math.cos(angle)]);
  return translated(mesh,origin);
}
function taperedLeg(start,end,bottomRadius,topRadius){
  const path=[start,end],mesh=tubeMeshFromPath(path,1,32);
  const rings=path.map((p,i)=>mesh.vertices.slice(i*32,(i+1)*32).map(q=>q.map((v,k)=>p[k]+(v-p[k])*(i?topRadius:bottomRadius))));
  return solidRings(rings);
}

function readingChair(b,p){
  const w=positive(p.width,760,'reading_chair.width',620),d=positive(p.depth,790,'reading_chair.depth',650),seat=positive(p.seat_height,440,'reading_chair.seat_height',360),back=positive(p.back_height,960,'reading_chair.back_height',800),c=[];
  if(back<seat+300)throw new Error('reading_chair.back_height must exceed seat_height by 300 mm');
  const cushionH=112,baseZ=seat-cushionH;
  const leg=b.assembly('leg',[
    b.mesh('leg-timber',taperedLeg([0,0,6],[26,18,baseZ+12],18,25),'Detail_Oak','chair_leg'),
    b.profile('leg-foot',[0,0,0],'xy',circlePoints(19,32),6,'Detail_Gasket',[],'floor_pad'),
    b.profile('leg-mount',[4,-6,baseZ-4],'xy',roundedRectangle(46,42,5),12,'Detail_Oak_Endgrain',[],'leg_mount')
  ]);
  for(const [i,x,y,angle] of [[0,85,90,0],[1,w-85,90,90],[2,w-85,d-105,180],[3,85,d-105,270]])c.push({...leg,instance_id:`${b.id}-leg-${i}`,origin:[x,y,0],transform:{rotateZ:angle}});
  c.push(b.profile('seat-support',[48,50,baseZ-20],'xy',roundedRectangle(w-96,d-142,18),30,'Detail_Oak',[roundedRectangle(w-150,d-196,12).map(([x,y])=>[x+27,y+27])],'seat_frame'));
  c.push(b.mesh('seat-cushion',cushion(w-96,d-175,cushionH,[48,48,baseZ]),'Detail_Fabric','seat_cushion'));
  const piping=roundedRectangle(w-108,d-187,37,8).map(([x,y])=>[x+54,y+54,seat-9]);piping.push(piping[0]);
  c.push(b.pipe('seat-piping',piping,2.2,'Detail_Oak_Endgrain',16,'upholstery_seam'));
  const backDepth=back-seat+22;
  c.push(b.mesh('back-cushion',cushion(w-132,backDepth,96,[66,d-172,seat-25],77),'Detail_Fabric','back_cushion'));
  const backSeam=roundedRectangle(w-144,backDepth-12,34,8).map(([x,y])=>{const yy=y+6,z=88,angle=77*Math.PI/180;return [x+72,d-172+yy*Math.cos(angle)-z*Math.sin(angle),seat-25+yy*Math.sin(angle)+z*Math.cos(angle)];});backSeam.push(backSeam[0]);
  c.push(b.pipe('back-piping',backSeam,2.2,'Detail_Oak_Endgrain',16,'upholstery_seam'));
  for(const [side,x] of [['left',40],['right',w-40]]){
    c.push(b.pipe(`back-support-${side}`,[[x,d-180,baseZ],[x,d-150,seat+180],[x,d-70,back-95]],16,'Detail_Oak',32,'back_support'));
    c.push(b.pipe(`arm-rest-${side}`,[[x,150,seat+125],[x,200,seat+160],[x,d-205,seat+170]],23,'Detail_Oak',40,'arm_rest'));
    c.push(b.pipe(`arm-post-${side}`,[[x,180,baseZ],[x,195,seat+158]],14,'Detail_Oak',32,'arm_post'));
  }
  return c;
}

function sideTable(b,p){
  const radius=positive(p.radius,310,'side_table.radius',220),h=positive(p.height,535,'side_table.height',420),c=[];
  c.push(b.profile('tray-bottom',[0,0,h-35],'xy',circlePoints(radius-3,64),13,'Detail_Oak',[],'table_bottom'));
  c.push(b.profile('tray-edge',[0,0,h-22],'xy',circlePoints(radius,64),22,'Detail_Oak_Endgrain',[circlePoints(radius-12,64)],'raised_table_rim'));
  c.push(b.profile('tray-insert',[0,0,h-22],'xy',circlePoints(radius-13.5,64),12,'Detail_Oak',[],'table_inset'));
  const legHeight=h-42;
  const leg=b.assembly('leg',[
    b.mesh('leg-timber',taperedLeg([0,0,6],[-42,0,legHeight],15,22),'Detail_Oak','table_leg'),
    b.profile('leg-pad',[0,0,0],'xy',circlePoints(16,32),6,'Detail_Gasket',[],'floor_pad'),
    b.profile('leg-mount',[-42,0,legHeight-2],'xy',circlePoints(38,40),7,'Detail_Stainless',[circlePoints(4,20,[-18,0]),circlePoints(4,20,[18,0])],'mounting_plate'),
    b.profile('leg-bolt-left',[-60,0,legHeight+5],'xy',circlePoints(6,6),5,'Detail_Stainless',[],'fixing'),
    b.profile('leg-bolt-right',[-24,0,legHeight+5],'xy',circlePoints(6,6),5,'Detail_Stainless',[],'fixing')
  ]);
  for(let i=0;i<3;i++){const angle=i*120*Math.PI/180;c.push({...leg,instance_id:`${b.id}-leg-${i}`,origin:[(radius-65)*Math.cos(angle),(radius-65)*Math.sin(angle),0],transform:{rotateZ:i*120}});}
  return c;
}

function pendantLight(b,p){
  const radius=positive(p.radius,235,'pendant_light.radius',150),shadeH=positive(p.shade_height,300,'pendant_light.shade_height',180),drop=positive(p.drop,900,'pendant_light.drop',500),c=[];
  if(drop<shadeH+150)throw new Error('pendant_light.drop must exceed shade_height by 150 mm');
  c.push(b.mesh('shade-shell',annularShell([[0,radius-4],[18,radius],[shadeH*.55,radius*.78],[shadeH,radius*.31]],3,64),'Detail_Fabric','lamp_shade'));
  const lower=circlePoints(radius-4,64).map(([x,y])=>[x,y,0]);lower.push(lower[0]);c.push(b.pipe('shade-bottom-trim',lower,3.2,'Detail_Brass',20,'shade_trim'));
  const upper=circlePoints(radius*.31,48).map(([x,y])=>[x,y,shadeH]);upper.push(upper[0]);c.push(b.pipe('shade-top-trim',upper,2.5,'Detail_Brass',20,'shade_trim'));
  for(let i=0;i<3;i++){const a=i*2*Math.PI/3;c.push(b.pipe(`shade-support-${i}`,[[radius*.30*Math.cos(a),radius*.30*Math.sin(a),shadeH],[0,0,shadeH-10]],2.5,'Detail_Brass',20,'shade_support'));}
  c.push(b.part('bulb','lofted_solid',{origin:[0,0,shadeH-160],profile:[[0,5],[12,22],[38,37],[64,34],[83,14],[96,13]],segments:48,smooth:'all'},'Detail_Painted_Joinery','lamp_bulb'));
  c.push(b.profile('socket',[0,0,shadeH-66],'xy',circlePoints(19,40),54,'Detail_Brass',[],'lamp_socket'));
  c.push(b.pipe('suspension',[[0,0,shadeH-10],[0,0,drop-14]],2.4,'Detail_Gasket',24,'suspension_cable'));
  c.push(b.profile('canopy',[0,0,drop-14],'xy',circlePoints(65,48),14,'Detail_Brass',[circlePoints(4,24)],'ceiling_canopy'));
  c.push(b.profile('strain-relief',[0,0,shadeH-10],'xy',circlePoints(8,32),22,'Detail_Brass',[circlePoints(3,24)],'strain_relief'));
  return c;
}

function leafMesh(length,width,rise){
  const vertices=[],faces=[],steps=10,thickness=1.2;
  for(let layer=0;layer<2;layer++)for(let i=0;i<=steps;i++){const t=i/steps,half=Math.max(2,Math.sin(Math.PI*t)**.8*width/2),z=t*rise+Math.sin(Math.PI*t)*30+layer*thickness;vertices.push([-half,t*length,z-5*Math.sin(Math.PI*t)],[0,t*length,z],[half,t*length,z-5*Math.sin(Math.PI*t)]);}
  const offset=(steps+1)*3;
  for(let i=0;i<steps;i++)for(let col=0;col<2;col++){const a=i*3+col,b=a+1,c=a+4,d=a+3;faces.push([a,c,b],[a,d,c],[offset+a,offset+b,offset+c],[offset+a,offset+c,offset+d]);}
  const boundary=[...Array.from({length:steps+1},(_,i)=>i*3),steps*3+1,...Array.from({length:steps+1},(_,i)=>(steps-i)*3+2),1];
  for(let i=0;i<boundary.length;i++){const a=boundary[i],b=boundary[(i+1)%boundary.length];faces.push([b,a,offset+a,offset+b]);}
  return {vertices,faces};
}
function pottedPlant(b,p){
  const height=positive(p.height,1250,'potted_plant.height',850),potH=positive(p.pot_height,370,'potted_plant.pot_height',220),radius=positive(p.pot_radius,195,'potted_plant.pot_radius',130),c=[];
  if(height<potH+400)throw new Error('potted_plant.height must exceed pot_height by 400 mm');
  c.push(b.mesh('pot-wall',annularShell([[8,radius*.78],[potH-18,radius],[potH,radius]],12,64),'Detail_Terracotta','planter_wall'));
  c.push(b.profile('pot-bottom',[0,0,8],'xy',circlePoints(radius*.78-1,64),14,'Detail_Terracotta',[circlePoints(8,24)],'planter_bottom'));
  c.push(b.profile('pot-foot',[0,0,0],'xy',circlePoints(radius*.70,48),8,'Detail_Gasket',[circlePoints(radius*.63,48)],'planter_foot'));
  c.push(b.profile('soil',[0,0,potH-30],'xy',circlePoints(radius-15,64),12,'Detail_Soil',[],'soil'));
  const stemTop=height-95;c.push(b.pipe('trunk',[[0,0,potH-20],[12,5,potH+250],[5,12,stemTop]],7,'Detail_Leaf',24,'plant_stem'));
  const leaves=[];
  for(const [key,length,width,rise] of [['large',310,140,95],['small',225,96,70]]){
    const vein=Array.from({length:11},(_,i)=>{const t=i/10;return [0,t*length,t*rise+Math.sin(Math.PI*t)*30+2.5];});
    leaves.push(b.assembly(`${key}-leaf`,[b.mesh(`${key}-leaf-skin`,leafMesh(length,width,rise),'Detail_Leaf','leaf_blade'),b.pipe(`${key}-leaf-vein`,vein,1.7,'Detail_Oak_Endgrain',12,'leaf_vein')]));
  }
  for(let i=0;i<10;i++){const angle=i*137.5,rad=angle*Math.PI/180,z=potH+95+(height-potH-260)*(i/9),leaf=leaves[i<6?0:1],origin=[18*Math.cos(rad),18*Math.sin(rad),z];c.push({...leaf,instance_id:`${b.id}-leaf-${i}`,origin,transform:{rotateZ:angle}});c.push(b.pipe(`branch-${i}`,[[7,7,z-40],origin],3,'Detail_Leaf',16,'branch'));}
  return c;
}

export function buildFurnishingAsset(kind,{id=kind,parameters={}}={}){
  if(!FURNISHING_ASSET_KINDS.includes(kind))throw new Error(`Unknown furnishing asset: ${kind}`);
  if(typeof id!=='string'||!id.trim())throw new Error('Furnishing asset id must be a nonempty string');
  const builder=new AssetBuilder(kind,id,parameters),constructors={reading_chair:readingChair,side_table:sideTable,pendant_light:pendantLight,potted_plant:pottedPlant};
  return builder.finish(constructors[kind](builder,parameters));
}

export function buildFurnishingAssetBundle({kind='reading_chair',id=`asset-${kind}`,parameters={},origin=[0,0,0]}={}){
  const asset=buildFurnishingAsset(kind,{id,parameters});
  const graph={version:2,id:`furnishing-${id}`,profile_id:`furnishing-${kind}`,coordinate_system:'part_local',units:'mm',product:{type:kind,name:id},parts:asset.parts,roots:[{...asset.root,origin}]};
  const profile={version:1,profile_id:graph.profile_id,materials:asset.materials};
  const dsl=compilePartGraphToSketchUpDsl(graph,profile),parts_mapping=describeAssemblyOccurrences(graph);
  const views=[{id:`${id}-overview`,kind:'overview',width:1600,height:1000,camera:{eye:[origin[0]+1600,origin[1]-2100,origin[2]+1550],target:[origin[0]+100,origin[1]+150,origin[2]+500],up:[0,0,1],fov:38}}];
  dsl.operations.push(...views.map(v=>({op:'scene',name:v.id,camera:v.camera})),{op:'camera',...views[0].camera});
  const detail_spec={version:1,coverage_version:DETAIL_COVERAGE_VERSION,scene_id:graph.id,required_parts:requirementsForOccurrences(graph.parts,parts_mapping,asset.requirements),required_views:views.map(v=>({id:v.id,min_width:1400,min_height:900})),max_iterations:6};
  return {...asset,part_graph:graph,profile,dsl,parts_mapping,detail_spec,views};
}
