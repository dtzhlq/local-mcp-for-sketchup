import crypto from 'node:crypto';
import { YF_RULES } from './yf-rules.mjs';
import { slabMesh, ringsMesh, plus } from './solids.mjs';

function clipX(polygon,bound,greater){
 const out=[];for(let i=0;i<polygon.length;i++){
  const a=polygon[i],b=polygon[(i+1)%polygon.length],inside=p=>greater?p[0]>=bound:p[0]<=bound;
  if(inside(a))out.push(a);
  if(inside(a)!==inside(b)){const t=(bound-a[0])/(b[0]-a[0]);out.push([bound,a[1]+t*(b[1]-a[1])]);}
 }return out;
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// Roof pieces remain a development draft until the frame bearing schedule is
// resolved. Every surface is sampled from the same layout, including hip cuts.
export function reusable(b,mesh,role,material,rule,name){
  const origin=mesh.vertices[0],relative=mesh.vertices.map(p=>p.map((v,i)=>v-origin[i]));
  let vertices=relative,transform;
  // Affine copies of the same tile/course share geometry even when roof slope,
  // width or direction changes. Keep the canonical primitive around 100 mm so
  // native SketchUp does not discard tiny prototype edges before scaling it.
  const a=relative[1],c=relative[3],d=relative[role.endsWith('_tile_course')?2:4];
  const cross=(u,v)=>[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  const dot=(u,v)=>u.reduce((s,x,i)=>s+x*v[i],0);
  // For exposed skins, the lower lip provides a stable third axis. The
  // adjacent top vertex can be almost coplanar and amplify native rounding.
  if(a&&c&&d){
    const cd=cross(c,d),da=cross(d,a),ac=cross(a,c),det=dot(a,cd);
    if(Math.abs(det)>1e-4){
      const canonical=relative.map(v=>[dot(v,cd),dot(v,da),dot(v,ac)].map(x=>x/det*100));
      // A nearly dependent tile-course basis can turn a short roof segment
      // into hundreds of metres of local coordinates. SketchUp then loses
      // enough precision to enlarge the native bounds. Keep those segments
      // in their original millimetre geometry with translation-only reuse.
      // SketchUp may transform the definition's axis-aligned box rather than
      // the occupied mesh. A skewed course can therefore expand its reported
      // bounds by metres even when every transformed vertex is in place.
      const span=(points,i)=>Math.max(...points.map(v=>v[i]))-Math.min(...points.map(v=>v[i]));
      const canonicalSpan=[0,1,2].map(i=>span(canonical,i));
      const actualSpan=[0,1,2].map(i=>span(relative,i));
      const boxSpan=[0,1,2].map(i=>(Math.abs(a[i])*canonicalSpan[0]+Math.abs(c[i])*canonicalSpan[1]+Math.abs(d[i])*canonicalSpan[2])/100);
      if(canonical.every(v=>v.every(x=>Number.isFinite(x)&&Math.abs(x)<=5000))
        && boxSpan.every((value,i)=>value<=actualSpan[i]+300)){
        vertices=canonical;
        transform={matrix:[...a.map(x=>x/100),0,...c.map(x=>x/100),0,...d.map(x=>x/100),0,0,0,0,1]};
      }
    }
  }
  const local={...mesh,vertices:vertices.map(p=>p.map(v=>Math.round(v*1e6)/1e6))};
  const key=`${role}-${crypto.createHash('sha256').update(JSON.stringify(local)).digest('hex').slice(0,20)}`;
  return {...b.at(b.mesh(key,local,role,material,rule),name,origin),...(transform?{transform}:{})};
}

// A closed curved ribbon, triangulated strip by strip. Fan-capping the concave
// pan-tile section would fill the drainage hollow, so no polygon fan is used.
export function tileRibbon(point,x0,width,d0,d1,limit,curve,thickness,{smooth=false,sections=8}={}){
  const vertices=[];
  for(let i=0;i<=sections;i++){
    const t=i/sections, x=x0+width*t;
    const near=Math.max(d0,limit(x)),far=d1;
    if(near>=far-1e-6)return null;
    const z=curve(t);
    for(const [d,dz]of [[near,z-thickness],[far,z-thickness],[far,z],[near,z]])vertices.push(plus(point(x,d),[0,0,dz]));
  }
  const faces=[[0,3,2],[0,2,1]],end=sections*4;
  faces.push([end,end+1,end+2],[end,end+2,end+3]);
  for(let i=0;i<sections;i++)for(let j=0;j<4;j++){
    const a=i*4+j,c=i*4+(j+1)%4;
    faces.push([a,c,c+4],[a,c+4,a+4]);
  }
  const cad_faces=[10,10,11,11];
  for(let i=0;i<sections;i++)for(let j=0;j<4;j++)cad_faces.push(j,j);
  return {vertices,faces,...(smooth?{smooth:'cad',cad_faces}:{})};
}

// Visible exposed skin plus its lower lap lip. The hidden .4-length overlap,
// backs and side walls are deliberately omitted in light representation.
export function lightTileSkin(point,x0,width,d0,d1,limit,curve,lip,sections){
 const vertices=[],faces=[],cad_faces=[];
 for(let i=0;i<=sections;i++){
  const x=x0+width*i/sections,near=Math.max(d0,limit(x));
  if(near>=d1-1e-6)return null;
  const z=curve(x);
  vertices.push(plus(point(x,near),[0,0,z]),plus(point(x,d1),[0,0,z+lip]),plus(point(x,d1),[0,0,z]));
 }
 for(let i=0;i<sections;i++){
  const a=i*3;
  faces.push([a,a+3,a+4],[a,a+4,a+1],[a+1,a+4,a+5],[a+1,a+5,a+2]);
  cad_faces.push(0,0,1,1);
 }
 return {vertices,faces,cad_faces,smooth:'cad'};
}
// Fast display representation: one continuous open flute follows the same
// shared roof surface from its hip cut to the eave. It deliberately omits the
// transverse tile laps; use light or detailed when those joints must be seen.
export function continuousTileSurface(point,x0,width,outer,limit,curve,segments,sections){
 const vertices=[],faces=[],cad_faces=[];
 for(let i=0;i<=sections;i++){
  const t=i/sections,x=x0+width*t,near=limit(x);
  if(near>=outer-.01)return null;
  for(let j=0;j<=segments;j++){
   const d=near+(outer-near)*j/segments;
   vertices.push(plus(point(x,d),[0,0,curve(t)]));
  }
 }
 const row=segments+1;
 for(let i=0;i<sections;i++)for(let j=0;j<segments;j++){
  const a=i*row+j,b=a+row;
  faces.push([a,b,b+1],[a,b+1,a+1]);cad_faces.push(0,0);
 }
 return {vertices,faces,cad_faces,smooth:'cad'};
}
function mergeTileSkins(meshes){
 const vertices=[],faces=[],cad_faces=[];
 for(const m of meshes){const offset=vertices.length;vertices.push(...m.vertices);faces.push(...m.faces.map(f=>f.map(i=>i+offset)));cad_faces.push(...m.cad_faces);}
 return {vertices,faces,cad_faces,smooth:'cad'};
}

export function roofSurfaceLayout(u,l,{subsidiary=false}={}){
  const C=u.chi,f=subsidiary?u.subsidiary_fen:u.fen,rafter=9.5*f,board=.08*C;
  const prefix=subsidiary?'subsidiary':'main',minimum=l.supports[0].distance;
  const spacing=(subsidiary?YF_RULES.rules.rafter.subsidiary_spacing_chi:YF_RULES.rules.rafter.spacing_chi)*C;
  const overhang=(subsidiary?3.75:4.25)*C,fly=.6*overhang,outer=l.ey+overhang+fly;
  const last=l.supports.at(-1),previous=l.supports.at(-2),slope=(last.z-previous.z)/(last.distance-previous.distance);
  const surface=(x,d,cornerOverride)=>{
    if(d<=l.ey)return l.roofZ(x,d);
    const t=(d-l.ey)/(overhang+fly),corner=cornerOverride??clamp((Math.abs(x)-(l.ex-9*C))/(9*C+overhang+fly),0,1);
    return last.z+slope*(d-l.ey)+l.riseAt(x)+rafter*corner*t*t;
  };
  const localPoint=(x,d,end=false)=>{
    const ext=end?d:l.ridgeHalf+d,corner=clamp((Math.abs(x)-(ext-9*C))/(9*C),0,1);
    const t=clamp((d-l.ey)/(overhang+fly),0,1),grow=.7*C*corner*t;
    return [x+Math.sign(x)*grow,d+grow,surface(end?l.ridgeHalf+d:x,d,corner)];
  };
  return {C,f,rafter,board,prefix,minimum,spacing,overhang,fly,outer,localPoint};
}

export function buildRoof(b,p,u,l,{subsidiary=false}={}){
  const {C,f,rafter,board,prefix,minimum,spacing,overhang,fly,outer,localPoint}=roofSurfaceLayout(u,l,{subsidiary});
  const c=[];
  const faces=[
    {key:'north',point:(x,d)=>localPoint(x,d),extent:d=>l.ridgeHalf+d,limit:x=>Math.max(0,Math.abs(x)-l.ridgeHalf),breaks:l.tops.map(t=>t.x)},
    {key:'south',point:(x,d)=>{const p=localPoint(x,d);return [-p[0],-p[1],p[2]];},extent:d=>l.ridgeHalf+d,limit:x=>Math.max(0,Math.abs(x)-l.ridgeHalf),breaks:l.tops.map(t=>t.x)},
    {key:'east',point:(x,d)=>{const p=localPoint(x,d,true);return [l.ridgeHalf+p[1],-p[0],p[2]];},extent:d=>d,limit:x=>Math.abs(x),breaks:[]},
    {key:'west',point:(x,d)=>{const p=localPoint(x,d,true);return [-l.ridgeHalf-p[1],p[0],p[2]];},extent:d=>d,limit:x=>Math.abs(x),breaks:[]}
  ];
  for(const face of faces){
    const key=`${prefix}-roof-${face.key}`, children=[];
    const intervals=[...l.supports.map(s=>s.distance),l.ey+overhang,outer];
    for(let k=1;k<intervals.length;k++){
      const a=intervals[k-1],d=intervals[k],ext0=face.extent(a),ext1=face.extent(d);
      const xs=[-ext1,...face.breaks.filter(x=>x>-ext1&&x<ext1),ext1];
      for(let j=1;j<xs.length;j++){
        let polygon=clipX(clipX([[-ext0,a],[ext0,a],[ext1,d],[-ext1,d]],xs[j-1],true),xs[j],false);
        polygon=polygon.filter((p,i)=>i===0||Math.hypot(p[0]-polygon[i-1][0],p[1]-polygon[i-1][1])>1e-6);
        if(polygon.length>2&&Math.hypot(...polygon[0].map((v,i)=>v-polygon.at(-1)[i]))<1e-6)polygon.pop();
        if(polygon.length<3)continue;
        const top=polygon.map(([x,y])=>plus(face.point(x,y),[0,0,rafter+board]));
        children.push(b.mesh(`${key}-boards-${k}-${j}`,slabMesh(top,board),'roof_board','Detail_Oak','YF6:wangban; selected .08chi; follows column rise breaks'));
      }
      // Both eave spans use the SAME terminal grid. In the corner zone,
      // interpolate from the bearing grid to that terminal grid; independently
      // sampling each span leaves flying rafters beside their round supports.
      const eave=a>=l.ey, sampleExtent=eave?face.extent(outer):ext1;
      const straightEnd=face.extent(l.ey)-9*C;
      const rafterX=(x,d)=>{
        if(!eave||Math.abs(x)<=straightEnd)return x;
        const t=(Math.abs(x)-straightEnd)/(sampleExtent-straightEnd);
        return Math.sign(x)*(straightEnd+t*(face.extent(d)-straightEnd));
      };
      const count=Math.max(1,Math.ceil(2*sampleExtent/spacing));
      for(let j=0;j<=count;j++){
        const x=-sampleExtent+2*sampleExtent*j/count;
        const near=eave?a:Math.max(a,face.limit(x)),far=d;
        if(far-near<rafter)continue;
        const A=face.point(rafterX(x,near),near),B=face.point(rafterX(x,far),far);
        if(k===intervals.length-1){
          const top=[[-.4*rafter,near],[.4*rafter,near],[.4*rafter,far],[-.4*rafter,far]]
            .map(([dx,y])=>plus(face.point(rafterX(x,y)+dx,y),[0,0,rafter]));
          children.push(reusable(b,slabMesh(top,.7*rafter),
            'fly_rafter','Detail_Oak','YF5:fly section .8/.7 diameter',`${key}-rafter-${k}-${j}`));
        }else{
          const start=plus(A,[0,0,rafter/2]),end=plus(B,[0,0,rafter/2]),delta=end.map((v,i)=>Math.round((v-start[i])*1e4)/1e4);
          const hash=crypto.createHash('sha256').update(JSON.stringify(delta)).digest('hex').slice(0,20);
          children.push(b.at(b.pipe(`round-rafter-${hash}`,[0,0,0],delta,rafter/2,'rafter','Detail_Oak',`YF5:round rafter diameter9.5fen; selected spacing <=${spacing/C}chi; corner fan uses shared eave grid`),`${key}-rafter-${k}-${j}`,start));
        }
      }
    }
    // Course exposure is .6 of each tile's length, not one common row count
    // for both 1.6-chi pan tiles and 1.4-chi covers.
    const point=(x,d)=>plus(face.point(x,d),[0,0,rafter+board+.10*C]);
    for(const type of ['pan','cover']){
      const length=(type==='pan'?1.6:1.4)*C,width=(type==='pan'?1:.65)*C,pitch=.95*C;
      if(p.tile_detail==='surface'){
        const ex=face.extent(outer),offset=type==='cover'?pitch/2:0,skins=[];
        const first=Math.ceil((-ex-width/2-offset)/pitch),last=Math.floor((ex+width/2-offset)/pitch);
        const curve=type==='pan'?t=>.20*C*(1-Math.sqrt(Math.max(0,1-(2*t-1)**2))):t=>.325*C*Math.sin(Math.PI*t)+.16*C;
        const segments=Math.max(8,Math.ceil((outer-minimum)/(1.5*C)));
        for(let j=first;j<=last;j++){
          const center=j*pitch+offset,start=Math.max(center-width/2,-ex),end=Math.min(center+width/2,ex);
          if(end-start<.1*C)continue;
          const mesh=continuousTileSurface(point,start,end-start,outer,x=>Math.max(minimum,face.limit(x)+.005*C),
            t=>curve(clamp((start+(end-start)*t-center+width/2)/width,0,1)),segments,type==='pan'?2:4);
          if(mesh)skins.push(mesh);
        }
        for(let start=0;start<skins.length;start+=8)children.push(reusable(b,mergeTileSkins(skins.slice(start,start+8)),`${type}_tile_surface`,
          'Detail_RoofTile','project fast display: continuous tile flutes follow YF roof; transverse laps and hidden backs omitted',`${key}-${type}-surface-${start/8}`));
        continue;
      }
      const sections=[...l.supports.map(s=>s.distance),outer];
      let d=outer,row=0;
      while(d>minimum+1e-6){
        let k=1;while(k<sections.length-1&&d>sections[k])k++;
        const low=sections[k-1],sample=Math.max(low,d-Math.min(C,d-low));
        const dz=point(0,d)[2]-point(0,sample)[2],cos=(d-sample)/Math.hypot(d-sample,dz)||1;
        const run=length*cos,ex=face.extent(d),n=Math.floor(2*ex/pitch),light=p.tile_detail==='light',skins=[];
        const offset=type==='cover'?pitch/2:0;
        const first=light?Math.ceil((-ex-width/2-offset)/pitch):0,last=light?Math.floor((ex+width/2-offset)/pitch):n;
        for(let j=first;j<=last;j++){
          const center=(light?j:j-n/2)*pitch+(type==='cover'?pitch/2:0);
          const start=Math.max(center-width/2,-ex),end=Math.min(center+width/2,ex);
          if(end-start<.1*C)continue;
          // Hip boundary cuts the tile longitudinally at every section point.
          const near=Math.max(minimum,d-run*(light?.6:1)),curve=type==='pan'
            ? t=>.20*C*(1-Math.sqrt(Math.max(0,1-(2*t-1)**2)))
            : t=>.325*C*Math.sin(Math.PI*t)+.16*C;
          const mesh=light?lightTileSkin(point,start,end-start,near,d,x=>face.limit(x)+.005*C,x=>curve(clamp((x-center+width/2)/width,0,1)),.04*C,type==='pan'?2:4)
            :tileRibbon(point,start,end-start,near,d,x=>face.limit(x)+.005*C,curve,(type==='pan'?.09:.06)*C,{smooth:!b.legacyRendering});
          if(light){if(mesh)skins.push(mesh);continue;}
          if(mesh)children.push(reusable(b,mesh,`${type}_tile`,'Detail_RoofTile',`YF13:installed ${type}; YF15:curved fired section; .4 length overlap`,`${key}-${type}-${row}-${j}`));
        }
        for(let start=0;start<skins.length;start+=8)children.push(reusable(b,mergeTileSkins(skins.slice(start,start+8)),`${type}_tile_course`,'Detail_RoofTile','YF13: .6 exposed length; shared short visible tile courses, hidden overlap and backs omitted',`${key}-${type}-course-${row}-${start/8}`));
        d-=Math.max(.1*C,.6*run);row++;
      }
    }
    const extent=face.extent(outer);
    for(let j=0,n=Math.ceil(2*extent/(2*C));j<n;j++){
      const x0=-extent+2*extent*j/n,x1=-extent+2*extent*(j+1)/n;
      children.push(b.beam(`${key}-lianyan-${j}`,plus(face.point(x0,outer),[0,0,.7*rafter]),plus(face.point(x1,outer),[0,0,.7*rafter]),4*f,8.5*f,'small_eave_fascia','Detail_Oak','YF5:small lianyan height8.5fen, thickness4fen'));
    }
    const bigD=l.ey+overhang,bigExtent=face.extent(bigD);
    for(let j=0,n=Math.ceil(2*bigExtent/(2*C));j<n;j++){
      const x0=-bigExtent+2*bigExtent*j/n,x1=-bigExtent+2*bigExtent*(j+1)/n;
      children.push(b.beam(`${key}-big-lianyan-${j}`,plus(face.point(x0,bigD),[0,0,rafter-5*f]),plus(face.point(x1,bigD),[0,0,rafter-5*f]),10*f,10*f,
        'big_eave_fascia','Detail_Oak','YF5:feikui; selected10x10fen within cai section'));
    }
    // Plain terminal disks close the first cover-tile course. Decorative relief
    // is intentionally omitted; their row/grid is identical to the cover tiles.
    const n=Math.floor(2*extent/(.95*C));
    for(let j=0;j<=n;j++){
      const x=(j-n/2)*.95*C+.95*C/2;
      if(Math.abs(x)+.325*C>extent)continue;
      const front=plus(face.point(x,outer),[0,0,rafter+board+.26*C]);
      const rear=plus(face.point(x,outer-.06*C),[0,0,rafter+board+.26*C]);
      const delta=front.map((v,i)=>Math.round((v-rear[i])*1e6)/1e6);
      const hash=crypto.createHash('sha256').update(JSON.stringify(delta)).digest('hex').slice(0,20);
      children.push(b.at(b.pipe(`tile-end-${hash}`,[0,0,0],delta,.325*C,'tile_end_disk','Detail_RoofTile','YF13:plain cover-tile end; selected thickness .06chi, relief omitted'),`${key}-tile-end-${j}`,rear));
    }
    c.push(b.group(key,()=>children,'roof_slope'));
  }
  // The lower main angle beam ends at the round-rafter eave. A narrower
  // child angle beam reaches the flying eave and laps into the main beam back
  // to the column line; upper hidden angle members use their own section.
  for(const sx of [-1,1])for(const sy of [-1,1]){
    const point=(d,offset=0)=>{const q=localPoint(l.ridgeHalf+d,d);return [sx*q[0],sy*q[1],q[2]-offset];};
    const path=[...l.supports.map(s=>s.distance),l.ey+overhang];
    for(let i=1;i<path.length;i++){
      const lower=i>=path.length-2,h=(lower?29:15)*f;
      c.push(b.beam(`${prefix}-hip-beam-${sx}-${sy}-${i}`,point(path[i-1],h/2),point(path[i],h/2),19*f,h,
        lower?'main_hip_beam':'hidden_hip_beam','Detail_Oak',lower?'YF5:main angle beam29x19fen; ends at round-rafter eave':'YF5:hidden angle beam15x19fen; follows upper support spans'));
    }
    const columnD=l.ey-(subsidiary?30:60)*f,childPath=[columnD,l.ey,l.ey+overhang,outer];
    for(let i=1;i<childPath.length;i++){
      const a=point(childPath[i-1]),z=point(childPath[i]);
      const length=Math.hypot(z[0]-a[0],z[1]-a[1]),normal=[-(z[1]-a[1])/length,(z[0]-a[0])/length];
      const terminal=i===childPath.length-1,stops=terminal?[0,Math.max(0,1-4*f/length),1]:[0,1];
      const rings=stops.map(t=>{
        const q=a.map((v,k)=>v+(z[k]-v)*t),tip=terminal&&t===1,w=tip?4*f:8*f,top=tip?-7*f:0;
        return [[-w,-19*f],[w,-19*f],[w,top],[-w,top]].map(([side,h])=>[q[0]+normal[0]*side,q[1]+normal[1]*side,q[2]+h]);
      });
      c.push(b.mesh(`${prefix}-child-hip-${sx}-${sy}-${i}`,ringsMesh(rings),'child_hip_beam','Detail_Oak',
        'YF5:child19x16fen; head sides cut4fen, upper cut7fen; embedded main-beam lap simplified'));
    }
    const end=point(outer);
    b.anchor(`${prefix}-hip-terminal-${sx}-${sy}`,end);
    c.push(b.box(`${prefix}-shengtou-${sx}-${sy}`,plus(end,[-10*f,-10*f,-rafter]),[20*f,20*f,rafter],'shengtou_wood','Detail_Oak','selected terminal interpolation; YF5:shengtou connection'));
  }
  return b.group(`${prefix}-roof`,()=>c,`${prefix}_roof`);
}
