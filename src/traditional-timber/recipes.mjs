import crypto from 'node:crypto';
import fs from 'node:fs';

export const TIMBER_RECIPE_KINDS = Object.freeze(['timber_column_head','timber_straight_eave','timber_corner_eave','timber_bay','timber_hall']);
export const TIMBER_RULES = JSON.parse(fs.readFileSync(new URL('../../data/traditional-timber/song-study-v1.json', import.meta.url), 'utf8'));
const dimensions = TIMBER_RULES.dimensions_fen;
const defaults = Object.freeze({fen_mm:10,column_height_fen:300,bay_width_fen:360,depth_fen:480,step_fen:60,pitch:0.35,rafter_spacing_fen:15,rafter_diameter_fen:8,shengchu_fen:24,shengtou_fen:9,corner_width_fen:150});
export function resolveTimberParameters(input={}) {
  for(const key of Object.keys(input)) if(!Object.hasOwn(defaults,key)) throw new Error(`Unknown timber parameter: ${key}`);
  const p={...defaults,...input};
  for(const [key,value] of Object.entries(p)) if(!Number.isFinite(value)||value<0||(!['shengchu_fen','shengtou_fen'].includes(key)&&value===0)) throw new Error(`${key} must be a finite ${key==='shengchu_fen'||key==='shengtou_fen'?'non-negative':'positive'} number`);
  if(p.fen_mm<1||p.fen_mm>50)throw new Error('fen_mm must be between 1 and 50 mm for this study');
  if(p.pitch>1||p.shengtou_fen>p.step_fen*0.4)throw new Error('Pitch or shengtou exceeds this study range');
  if(p.rafter_spacing_fen<p.rafter_diameter_fen*1.1)throw new Error('Rafter spacing must leave a gap between rafters');
  if(p.corner_width_fen<=p.step_fen+p.rafter_diameter_fen*2)throw new Error('Corner fan must have enough width at its inner support');
  if(p.bay_width_fen<2*p.corner_width_fen+20||p.depth_fen<2*p.corner_width_fen+20)throw new Error('Bay width and depth must accommodate the corner transitions');
  if(p.column_height_fen<30)throw new Error('Column height must leave room for the study capital');
  if(p.bay_width_fen>1000||p.depth_fen>1000||p.column_height_fen>1000)throw new Error('Study dimensions exceed the supported bounded range');
  return Object.freeze(p);
}
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const mul=(a,s)=>a.map(v=>v*s);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>mul(a,1/Math.hypot(...a));

// Closed ruled solids: matching counterclockwise section rings, outward caps.
function ringMesh(rings) {
  const n=rings[0].length, vertices=rings.flat(), faces=[];
  for(let i=1;i<n-1;i++){faces.push([0,i+1,i]);const k=(rings.length-1)*n;faces.push([k,k+i,k+i+1]);}
  for(let r=0;r<rings.length-1;r++)for(let i=0;i<n;i++){const a=r*n+i,b=r*n+(i+1)%n,c=b+n,d=a+n;faces.push([a,b,c,d]);}
  return {vertices,faces};
}
function beamMesh(a,b,width,height) {
  const axis=sub(b,a), reference=Math.hypot(axis[0],axis[1])<1e-8?[0,1,0]:[0,0,1];
  const w=unit(cross(reference,axis)), h=unit(cross(axis,w));
  return ringMesh([a,b].map(c=>[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>add(c,add(mul(w,x*width/2),mul(h,y*height/2))))));
}
function squareRing(z,width){return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>[x*width/2,y*width/2,z]);}

class Builder {
  constructor(id,p){this.id=id;this.p=p;this.parts=[];this.groups=new Set();this.measurements={};}
  part(key,primitive,parameters,role=key){const id=`${this.id}-${key}`;this.parts.push({id,name:id,type:'detail_geometry',role,material:'Detail_Oak',detail_level:'detailed',evidence_status:'needs_review',fallback_state:'structured_primitive',shape:{primitive,parameters},qa:{rule_set:TIMBER_RULES.id,source_status:'research_study'}});return {part_id:id};}
  mesh(key,m,role=key){return this.part(key,'mesh',{vertices:m.vertices.map(v=>mul(v,this.p.fen_mm)),faces:m.faces,construction:'bulk',smooth:'coplanar'},role);}
  box(key,o,size,role=key){return this.part(key,'box',{origin:mul(o,this.p.fen_mm),size:mul(size,this.p.fen_mm)},role);}
  beam(key,a,c,w,h,role=key){return this.mesh(key,beamMesh(a,c,w,h),role);}
  pipe(key,a,c,r,role=key){return this.part(key,'pipe_between_points',{start:mul(a,this.p.fen_mm),end:mul(c,this.p.fen_mm),radius:r*this.p.fen_mm,segments:12,smooth:'all'},role);}
  group(key,make){const id=key==='root'?this.id:`${this.id}-${key}`;if(!this.groups.has(id)){this.groups.add(id);const children=make();this.parts.push({id,name:id,type:'assembly',role:key,detail_level:'detailed',evidence_status:'needs_review',fallback_state:'structured_primitive',assembly:{children}});}return {part_id:id};}
  at(ref,key,origin=[0,0,0],angle=0){return {...ref,instance_id:`${this.id}-${key}`,origin:mul(origin,this.p.fen_mm),...(angle?{transform:{rotateZ:angle}}:{})};}
}

function gong(b,key,length,height=15,bottomNotch=0,topNotch=0) {
  // Four explicit juansha facets; the seat plateau and interlock are preserved.
  const half=length/2, run=16;
  const bottom=[[-half,9],[-half+4,6.75],[-half+8,4.5],[-half+12,2.25],[-half+run,0]];
  const profile=[...bottom,[-5,0],...bottomNotch?[[-5,bottomNotch],[5,bottomNotch]]:[],[5,0],...bottom.slice().reverse().map(([x,z])=>[-x,z])];
  const top=topNotch?[[half,height],[5,height],[5,height-topNotch],[-5,height-topNotch],[-5,height],[-half,height]]:[[half,height],[-half,height]];
  // xz profile, positive extrusion normal is chosen by the existing profile helper.
  return b.part(key,'profile_extrude',{origin:[0,-5*b.p.fen_mm,0],plane:'xz',outer:[...profile,...top].map(v=>mul(v,b.p.fen_mm)),depth:10*b.p.fen_mm},'gong');
}
function dou(b,key,width=14,height=10,ears=false) {
  return b.group(key,()=>{
    const core=height-(ears?10:0), c=[b.mesh(`${key}-body`,ringMesh([squareRing(0,width*.68),squareRing(core*.4,width*.68),squareRing(core,width)]),'dou')];
    if(ears)for(const x of [-1,1])for(const y of [-1,1])c.push(b.box(`${key}-ear-${x}-${y}`,[x<0?-width/2:5,y<0?-width/2:5,core],[width/2-5,width/2-5,10],'dou_ear'));
    return c;
  });
}
function node(b,withColumn=true){
  const bracket=b.group('bracket',()=>{
    const c=[b.at(dou(b,'ludou',dimensions.ludou_width,24,true),'ludou')];
    const ni=b.group('nidao',()=>[gong(b,'nidao-body',dimensions.nidao_length,15,0,5)]);
    const hua=b.group('huagong',()=>[gong(b,'huagong-body',dimensions.huagong_length,21,5)]);
    c.push(b.at(ni,'nidao',[0,0,14]),b.at(hua,'huagong',[0,0,19],90));
    const small=dou(b,'sandou'), ling=b.group('linggong',()=>[gong(b,'linggong-body',dimensions.linggong_length)]);
    for(const sign of [-1,1]){
      c.push(b.at(small,`sandou-${sign}`,[0,sign*31,40]),b.at(ling,`linggong-${sign}`,[0,sign*31,50]));
      for(const x of [-31,31])c.push(b.at(small,`upper-dou-${sign}-${x}`,[x,sign*31,65]));
      c.push(b.beam(`timu-${sign}`,[-52,sign*31,81],[52,sign*31,81],10,12,'timu'));
      if(withColumn)c.push(b.pipe(`purlin-${sign}`,[-80,sign*31,95],[80,sign*31,95],8,'purlin'));
    }
    for(const x of [-26,26])c.push(b.at(small,`nidao-dou-${x}`,[x,0,29]));
    const man=b.group('mangong',()=>[gong(b,'mangong-body',dimensions.mangong_length)]);
    c.push(b.at(man,'mangong',[0,0,39]));
    return c;
  });
  if(!withColumn)return bracket;
  return b.group('node',()=>[b.part('column','lofted_solid',{origin:[0,0,0],profile:[[0,15],[100,15],[116,13],[120,12]].map(v=>mul(v,b.p.fen_mm)),segments:24,smooth:'all'},'column'),b.at(bracket,'bracket',[0,0,120])]);
}

function slab(b,key,top,thickness,role='board') {
  // Top is ordered CCW from above; triangulated nonplanar strips are intentional.
  const m=ringMesh([top.map(v=>add(v,[0,0,-thickness])),top]);return b.mesh(key,m,role);
}
function straight(b,width=b.p.bay_width_fen,pitch=b.p.pitch,key='straight'){
  return b.group(key,()=>{
    const p=b.p,B=p.step_fen,R=B*.6,F=R*.6,total=R+F,r=p.rafter_diameter_fen/2;
    const n=Math.floor((width-2*r)/p.rafter_spacing_fen)+1, actual=n>1?(width-2*r)/(n-1):0,c=[];
    const single=b.group(`${key}-rafter-pair`,()=>[
      b.pipe(`${key}-rafter`,[0,-B,B*pitch],[0,R,-R*pitch],r,'rafter'),
      b.beam(`${key}-fly`,[0,R*.4,-R*.4*pitch+(r+2.8)/Math.sqrt(1+pitch*pitch)],[0,total,-total*pitch+(r+2.8)/Math.sqrt(1+pitch*pitch)],5.6,5.6,'flying_rafter')
    ]);
    for(let i=0;i<n;i++)c.push(b.at(single,`${key}-pair-${i}`,[n===1?0:-width/2+r+i*actual,0,0]));
    const z=y=>-pitch*y+(r+5.6)/Math.sqrt(1+pitch*pitch)+1;
    // Explicit rear packing supports the raised board plane behind the fly tail.
    // This is a study detail, not a sourced historical member prescription.
    for(const [i,y]of [-B+2,-B/2,0].entries())c.push(b.beam(`${key}-packing-${i}`,[-width/2,y,-pitch*y+(r+2.8)/Math.sqrt(1+pitch*pitch)],[width/2,y,-pitch*y+(r+2.8)/Math.sqrt(1+pitch*pitch)],4,5.6/Math.sqrt(1+pitch*pitch),'study_board_packing'));
    c.push(slab(b,`${key}-wangban`,[[-width/2,-B,z(-B)],[width/2,-B,z(-B)],[width/2,total,z(total)],[-width/2,total,z(total)]],1));
    for(const [label,y] of [['dalianyan',R],['xiaolianyan',total]])c.push(b.beam(`${key}-${label}`,[-width/2,y,z(y)+2],[width/2,y,z(y)+2],3,4,label));
    return c;
  });
}

function corner(b,pitch=b.p.pitch,key='corner'){
  return b.group(key,()=>{
    const p=b.p,B=p.step_fen,W=p.corner_width_fen,E=B*.96,r=p.rafter_diameter_fen/2,S=p.shengchu_fen,H=p.shengtou_fen;
    // Nonintersecting fan: each rafter remains straight. Its eave rise derives
    // from the higher support, rather than bending the flying-rafter back.
    const point=(t,y)=>[-W+W*t+t*y,y,-pitch*y+H*t*t*(1+y/B)];
    const lift=(t,v)=>v*Math.sqrt(1+t*t)/Math.sqrt(1+t*t+(-pitch+H*t*t/B)**2);
    const n=Math.max(2,Math.floor(Math.min(W/p.rafter_spacing_fen,(W-B)/(2*r*1.15)))),c=[];
    for(const mirror of [false,true]){
      const tr=v=>mirror?[v[1],v[0],v[2]]:v;
      const tag=mirror?'side':'front';
      for(let i=0;i<n;i++){
        const t=i/n,total=E+S*t*t,raf=total/1.6;
        c.push(b.pipe(`${key}-${tag}-rafter-${i}`,tr(point(t,-B)),tr(point(t,raf)),r,'corner_rafter'));
        c.push(b.beam(`${key}-${tag}-fly-${i}`,tr(add(point(t,raf*.4),[0,0,lift(t,r+2.8)])),tr(add(point(t,total),[0,0,lift(t,r+2.8)])),5.6,5.6,'corner_flying_rafter'));
      }
      for(let i=0;i<n;i++){
        const t=i/n,u=(i+1)/n,pa=(t,y)=>tr(add(point(t,y),[0,0,lift(t,r+5.6)+1]));
        let top=[pa(t,-B),pa(u,-B),pa(u,E+S*u*u),pa(t,E+S*t*t)];if(mirror)top.reverse();
        c.push(slab(b,`${key}-${tag}-board-${i}`,top,1));
        for(const [j,y]of [-B+2,-B/2,0].entries())c.push(b.beam(`${key}-${tag}-packing-${i}-${j}`,tr(add(point(t,y),[0,0,lift(t,r+2.8)])),tr(add(point(u,y),[0,0,lift(u,r+2.8)])),4,(lift(t,5.6)+lift(u,5.6))/2,'study_board_packing'));
        for(const [label,fraction] of [['dalianyan',.625],['xiaolianyan',1]]) c.push(b.beam(`${key}-${tag}-${label}-${i}`,add(pa(t,(E+S*t*t)*fraction),[0,0,2]),add(pa(u,(E+S*u*u)*fraction),[0,0,2]),3,4,label));
        c.push(b.beam(`${key}-${tag}-shengtou-${i}`,tr([-W+W*t,0,H*t*t/2]),tr([-W+W*u,0,H*u*u/2]),10,Math.max(.5,H*(t*t+u*u)/2),'shengtoumu'));
      }
    }
    c.push(b.beam(`${key}-hip-beam`,point(1,-B),point(1,E+S),12,12,'hip_beam'));
    return c;
  });
}

function building(b,bays){
  const p=b.p,L=bays*p.bay_width_fen,D=p.depth_fen,C=p.column_height_fen,W=p.corner_width_fen;
  if(L<=D)throw new Error('This longitudinal hip-roof study requires total width greater than depth');
  const Z=C+103, rise=D/3, mid=rise*.4, pitch=mid/(D/4), eaveZ=Z+8;
  const bracket=node(b,false),c=[];
  const col=b.group('full-column',()=>[b.part('full-column-body','lofted_solid',{origin:[0,0,0],profile:[[0,15],[C*.78,15],[C-4,12.8],[C,12]].map(v=>mul(v,p.fen_mm)),segments:16,smooth:'all'},'column')]);
  for(let i=0;i<=bays;i++)for(const side of [-1,1]){
    const x=-L/2+i*p.bay_width_fen,y=side*D/2;
    c.push(b.at(col,`column-${i}-${side}`,[x,y,0]),b.at(bracket,`bracket-${i}-${side}`,[x,y,C],side<0?180:0));
    c.push(b.beam(`purlin-seat-${i}-${side}`,[x,y-31,C+85],[x,y+31,C+85],10,20,'purlin_seat'));
  }
  for(let i=0;i<bays;i++)for(const side of [-1,1])c.push(b.beam(`lane-${i}-${side}`,[-L/2+i*p.bay_width_fen,side*D/2,C-10],[-L/2+(i+1)*p.bay_width_fen,side*D/2,C-10],10,20,'lane'));
  for(const x of [-L/2,L/2])c.push(b.beam(`end-lane-${x}`,[x,-D/2,C-10],[x,D/2,C-10],10,20,'lane'));
  // A bounded hip-roof study with discrete purlin heights and straight rafters.
  const ridgeHalf=Math.max(0,(L-D)/2), levels=[{y:D/2,z:eaveZ,x:L/2},{y:D/4,z:eaveZ+mid,x:(L/2+ridgeHalf)/2},{y:0,z:eaveZ+rise,x:ridgeHalf}];
  for(const side of [-1,1]){
    for(let j=0;j<2;j++){
      const a=levels[j],d=levels[j+1],count=Math.max(2,Math.ceil(2*a.x/p.rafter_spacing_fen));
      for(let i=0;i<=count;i++){const t=-1+2*i/count;c.push(b.pipe(`roof-rafter-${side}-${j}-${i}`,[t*a.x,side*a.y,a.z],[t*d.x,side*d.y,d.z],4,'roof_rafter'));}
      let top=[[-a.x,side*a.y,a.z+7],[a.x,side*a.y,a.z+7],[d.x,side*d.y,d.z+7],[-d.x,side*d.y,d.z+7]];if(side>0)top.reverse();
      c.push(slab(b,`roof-board-${side}-${j}`,top,1.5,'roof_board'));
    }
    for(const [i,l]of levels.entries())if(i<2)c.push(b.pipe(`main-purlin-${side}-${i}`,[-l.x,side*l.y,l.z-8],[l.x,side*l.y,l.z-8],8,'purlin'));
  }
  c.push(b.pipe('ridge',[-ridgeHalf,0,eaveZ+rise-8],[ridgeHalf,0,eaveZ+rise-8],8,'ridge_purlin'));
  for(const side of [-1,1]){
    const x=side*L/2;
    for(let j=0;j<2;j++){
      const a=levels[j],d=levels[j+1];
      let top=[[side*a.x,-a.y,a.z+7],[side*a.x,a.y,a.z+7],[side*d.x,d.y,d.z+7],...(d.y?[[side*d.x,-d.y,d.z+7]]:[])];if(side<0)top.reverse();
      c.push(slab(b,`hip-roof-board-${side}-${j}`,top,1.5,'roof_board'));
      const count=Math.max(2,Math.ceil(2*a.y/p.rafter_spacing_fen));
      for(let i=0;i<=count;i++){const t=-1+2*i/count;c.push(b.pipe(`end-roof-rafter-${side}-${j}-${i}`,[side*a.x,t*a.y,a.z],[side*d.x,t*d.y,d.z],4,'roof_rafter'));}
      for(const sign of [-1,1])c.push(b.beam(`roof-hip-${side}-${sign}-${j}`,[side*a.x,sign*a.y,a.z-3],[side*d.x,sign*d.y,d.z-3],12,12,'roof_hip_beam'));
    }
    c.push(b.pipe(`end-purlin-${side}`,[x,-D/2,eaveZ-8],[x,D/2,eaveZ-8],8,'purlin'));
  }
  for(let i=0;i<=bays;i++){
    const x=-L/2+i*p.bay_width_fen;
    c.push(b.beam(`cross-beam-${i}`,[x,-D/2,C+65],[x,D/2,C+65],18,24,'cross_beam'));
    if(Math.abs(x)<=ridgeHalf)c.push(b.beam(`ridge-strut-${i}`,[x,0,C+77],[x,0,eaveZ+rise-16],12,12,'strut'));
    for(const sign of [-1,1])if(Math.abs(x)<=levels[1].x)c.push(b.beam(`purlin-strut-${i}-${sign}`,[x,sign*D/4,C+77],[x,sign*D/4,eaveZ+mid-16],12,12,'strut'));
  }
  if(bays===1){
    c.push(b.beam('ridge-tie',[-L/2,0,C+65],[L/2,0,C+65],18,24,'ridge_tie'));
    c.push(b.beam('central-strut',[0,0,C+77],[0,0,eaveZ+rise-16],12,12,'strut'));
  }
  const front=straight(b,L-2*W,pitch,'front-eave'),end=straight(b,D-2*W,pitch,'end-eave'),wing=corner(b,pitch);
  c.push(b.at(front,'front-eave',[0,D/2,eaveZ]),b.at(front,'back-eave',[0,-D/2,eaveZ],180));
  c.push(b.at(end,'right-eave',[L/2,0,eaveZ],-90),b.at(end,'left-eave',[-L/2,0,eaveZ],90));
  for(const [x,y,a]of [[L/2,D/2,0],[-L/2,D/2,90],[-L/2,-D/2,180],[L/2,-D/2,270]])c.push(b.at(wing,`wing-${a}`,[x,y,eaveZ],a));
  c.push(b.box('platform',[-L/2-50,-D/2-50,-15],[L+100,D+100,15],'platform'));
  b.measurements={bay_width_mm:p.bay_width_fen*p.fen_mm,column_height_mm:C*p.fen_mm,ridge_height_mm:(eaveZ+rise+7)*p.fen_mm,bay_count:bays};
  return c;
}

export function buildTraditionalTimberRecipe(kind,{id=kind,parameters={}}={}) {
  if(!TIMBER_RECIPE_KINDS.includes(kind))throw new Error(`Unknown timber recipe: ${kind}`);
  if(!/^[A-Za-z0-9_-]+$/.test(id))throw new Error('Invalid timber recipe id');
  const p=resolveTimberParameters(kind==='timber_bay'?{depth_fen:320,...parameters}:parameters),b=new Builder(id,p);
  const root=b.group('root',()=>{
    if(kind==='timber_column_head'){b.measurements={dou_width_mm:dimensions.ludou_width*p.fen_mm,nidao_length_mm:dimensions.nidao_length*p.fen_mm,huagong_length_mm:dimensions.huagong_length*p.fen_mm,assembly_height_mm:223*p.fen_mm,purlin_bottom_mm:207*p.fen_mm};return [b.at(node(b),'node')];}
    if(kind==='timber_straight_eave')return [b.at(straight(b),'straight')];
    if(kind==='timber_corner_eave')return [b.at(corner(b),'corner')];
    return building(b,kind==='timber_bay'?1:3);
  });
  return {kind,id,root_id:root.part_id,parts:b.parts,parameters:p,requirements:[],required_voids:[],measurements:b.measurements,provenance:structuredClone(TIMBER_RULES),recipe_signature:crypto.createHash('sha256').update(JSON.stringify({kind,p,parts:b.parts})).digest('hex')};
}
