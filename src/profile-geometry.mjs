import { parallelTransportFrames } from './surface-operations.mjs';
import { vector3, dot, cross, subtract, add, scaleVector, unitVector } from './geometry-matrix.mjs';
const EPS = 1e-8;
const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const area2=p=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0);
const inside=(p,a,b,c)=>orient(a,b,p)>=-EPS&&orient(b,c,p)>=-EPS&&orient(c,a,p)>=-EPS;
function segmentCross(a,b,c,d) {
  const v=[orient(a,b,c),orient(a,b,d),orient(c,d,a),orient(c,d,b)];
  if(v[0]*v[1]<-EPS && v[2]*v[3]<-EPS)return true;
  return [[v[0],c,a,b],[v[1],d,a,b],[v[2],a,c,d],[v[3],b,c,d]].some(([o,p,x,y])=>Math.abs(o)<EPS&&p.every((n,i)=>n>=Math.min(x[i],y[i])-EPS&&n<=Math.max(x[i],y[i])+EPS));
}
export function planarPolygon(points) {
  if(!Array.isArray(points)||points.length<3)throw new Error('Profile requires at least three points');
  const p=points.map(v=>vector3(v));
  if(Math.hypot(...subtract(p[0],p.at(-1)))<EPS)p.pop();
  if(p.length<3)throw new Error('Degenerate profile');
  const origin=p[0],u=unitVector(subtract(p[1],origin));
  let normal; for(let i=2;i<p.length;i++){const n=cross(u,subtract(p[i],origin));if(Math.hypot(...n)>EPS){normal=unitVector(n);break;}}
  if(!normal)throw new Error('Collinear profile');
  const v=cross(normal,u),projected=p.map(q=>{const d=subtract(q,origin);if(Math.abs(dot(d,normal))>1e-6)throw new Error('Profile must be planar');return [dot(d,u),dot(d,v)];});
  for(let i=0;i<p.length;i++) {
    if(Math.hypot(...subtract(p[i],p[(i+1)%p.length]))<EPS)throw new Error('Repeated adjacent profile point');
    for(let j=i+1;j<p.length;j++) if(j!==i+1&&!(i===0&&j===p.length-1)&&segmentCross(projected[i],projected[(i+1)%p.length],projected[j],projected[(j+1)%p.length]))throw new Error('Self-intersecting profile');
  }
  if(Math.abs(area2(projected))<EPS)throw new Error('Zero area profile');
  return {points:p,projected,normal};
}
export function triangulatePolygon(points) {
  const {projected:p}=planarPolygon(points),indices=p.map((_,i)=>i);
  if(area2(p)<0)indices.reverse();
  const triangles=[];
  while(indices.length>3){let found=false;
    for(let k=0;k<indices.length;k++){
      const a=indices[(k+indices.length-1)%indices.length],b=indices[k],c=indices[(k+1)%indices.length];
      if(orient(p[a],p[b],p[c])<=EPS)continue;
      if(indices.some(i=>i!==a&&i!==b&&i!==c&&inside(p[i],p[a],p[b],p[c])))continue;
      triangles.push([a,b,c]);indices.splice(k,1);found=true;break;
    }
    if(!found)throw new Error('Profile triangulation is degenerate or ambiguous');
  }
  triangles.push([...indices]);
  return triangles;
}
function budget(value,fallback,label){const n=value??fallback;if(!Number.isInteger(n)||n<3||n>100000)throw new Error(`${label} must be an integer in 3..100000`);return n;}
function stations(values,fallback,width){
  const list=values??[{t:0,value:fallback},{t:1,value:fallback}];
  if(!Array.isArray(list)||!list.length||list.length>1000)throw new Error('Invalid stations');
  const result=list.map(s=>({t:s.t,value:width?(Array.isArray(s.value)?s.value:[s.value,s.value]):s.value}));
  result.forEach((s,i)=>{if(!Number.isFinite(s.t)||s.t<0||s.t>1||(i&&s.t<=result[i-1].t)|| (width? s.value.length!==2||s.value.some(x=>!Number.isFinite(x)||x<=0):!Number.isFinite(s.value)))throw new Error('Invalid station time or value');});
  if(result[0].t!==0||result.at(-1).t!==1)throw new Error('Stations must include t=0 and t=1');
  return t=>{const b=result.findIndex(s=>s.t>=t);if(b<=0)return result[0].value;const a=result[b-1],z=result[b],f=(t-a.t)/(z.t-a.t);return width?a.value.map((x,i)=>x+f*(z.value[i]-x)):a.value+f*(z.value-a.value);};
}
function stitch(rings,{caps=true,closed=false,max_vertices=10000}={}){
  const n=rings[0].length,vertices=rings.flat(),faces=[];
  if(vertices.length>budget(max_vertices,10000,'max_vertices'))throw new Error('Geometry vertex budget exceeded');
  const spans=closed?rings.length:rings.length-1;
  for(let r=0;r<spans;r++){const a=r*n,b=((r+1)%rings.length)*n;for(let i=0;i<n;i++){const j=(i+1)%n;faces.push([a+i,a+j,b+j],[a+i,b+j,b+i]);}}
  if(caps&&!closed){for(const tri of triangulatePolygon(rings[0]))faces.push([...tri].reverse());for(const tri of triangulatePolygon(rings.at(-1)))faces.push(tri.map(i=>i+(rings.length-1)*n));}
  for(const f of faces)if(Math.hypot(...cross(subtract(vertices[f[1]],vertices[f[0]]),subtract(vertices[f[2]],vertices[f[0]])))<EPS)throw new Error('Degenerate generated triangle');
  // Orient closed meshes outward; open surfaces retain the supplied section order.
  if(caps||closed){const volume=faces.reduce((s,f)=>s+dot(vertices[f[0]],cross(vertices[f[1]],vertices[f[2]]))/6,0);if(Math.abs(volume)<EPS)throw new Error('Generated solid has zero volume');if(volume<0)faces.forEach(f=>f.reverse());}
  assertNoMeshIntersections(vertices,faces);
  return {vertices,faces};
}
export function sweepProfile(op){
  if(!Array.isArray(op.profile)||op.profile.some(p=>!Array.isArray(p)||p.length!==2))throw new Error('profile requires [u,v] pairs');
  const profile=planarPolygon(op.profile.map(p=>[...p,0])).points.map(p=>p.slice(0,2));
  if(area2(profile)<0)profile.reverse();
  if(!Array.isArray(op.path)||op.path.length*profile.length>budget(op.max_vertices,10000,'max_vertices')+profile.length)throw new Error('Geometry vertex budget exceeded');
  const path=op.path.map(p=>vector3(p)),{frames,closed}=parallelTransportFrames(path);
  const distances=[0];for(let i=1;i<path.length;i++)distances.push(distances.at(-1)+Math.hypot(...subtract(path[i],path[i-1])));
  const scales=stations(op.scale_stations,[1,1],true),twists=stations(op.twist_stations,0,false);
  if(closed&&(scales(0).some((x,i)=>Math.abs(x-scales(1)[i])>EPS)||Math.abs(Math.sin((twists(1)-twists(0))*Math.PI/360))>EPS))throw new Error('Closed sweep requires compatible end scale and twist');
  let offset=0;if(op.initial_up){const up=unitVector(vector3(op.initial_up)),f=frames[0],projected=subtract(up,scaleVector(f.tangent,dot(up,f.tangent)));const u=unitVector(projected);offset=Math.atan2(dot(u,f.v),dot(u,f.u));}
  const rings=frames.slice(0,closed?-1:undefined).map((f,i)=>{const t=distances[i]/distances.at(-1),s=scales(t),a=offset+twists(t)*Math.PI/180,c=Math.cos(a),sn=Math.sin(a);return profile.map(([x,y])=>add(path[i],add(scaleVector(f.u,x*s[0]*c-y*s[1]*sn),scaleVector(f.v,x*s[0]*sn+y*s[1]*c))));});
  return stitch(rings,{...op,closed});
}
function ringParameters(p){const ds=[0];for(let i=1;i<=p.length;i++)ds.push(ds.at(-1)+Math.hypot(...subtract(p[i%p.length],p[i-1])));return ds.map(d=>d/ds.at(-1));}
export function loftProfiles(op){
  if(!Array.isArray(op.profiles)||op.profiles.length<2)throw new Error('profiles requires at least two sections');
  let normal;
  const profiles=op.profiles.map((raw,i)=>{const section=planarPolygon(raw.points??raw);let p=section.points;const seam=op.seam_indices?.[i]??0;if(!Number.isInteger(seam)||seam<0||seam>=p.length)throw new Error('Invalid seam index');p=[...p.slice(seam),...p.slice(0,seam)];if(normal&&dot(normal,section.normal)<0)p=[p[0],...p.slice(1).reverse()];else normal=section.normal;return p;});
  const parameters=profiles.map(ringParameters),all=parameters.flat().filter(t=>t<1-EPS).sort((a,b)=>a-b).filter((t,i,a)=>i===0||t-a[i-1]>1e-12);
  const limit=budget(op.sample_budget,512,'sample_budget');if(all.length>limit)throw new Error('sample_budget cannot preserve all profile corners');
  const rings=profiles.map((p,i)=>all.map(t=>{const ds=parameters[i];let k=ds.findIndex((v,j)=>j>0&&v>=t-EPS)-1;k=Math.max(0,k);const f=Math.max(0,Math.min(1,(t-ds[k])/(ds[k+1]-ds[k])));return add(p[k],scaleVector(subtract(p[(k+1)%p.length],p[k]),f));}));
  return stitch(rings,op);
}
function segmentTriangle(p,q,a,b,c){const d=subtract(q,p),e1=subtract(b,a),e2=subtract(c,a),h=cross(d,e2),det=dot(e1,h);if(Math.abs(det)<EPS)return false;const s=subtract(p,a),u=dot(s,h)/det,v=dot(d,cross(s,e1))/det,t=dot(e2,cross(s,e1))/det;return u>=-EPS&&v>=-EPS&&u+v<=1+EPS&&t>EPS&&t<1-EPS;}
export function assertNoMeshIntersections(vertices,faces){
  const triangles=faces.map((f,index)=>({f,index,p:f.map(i=>vertices[i]),min:Math.min(...f.map(i=>vertices[i][0])),max:Math.max(...f.map(i=>vertices[i][0]))})).sort((a,b)=>a.min-b.min);
  let comparisons=0;
  for(let i=0;i<triangles.length;i++)for(let j=i+1;j<triangles.length&&triangles[j].min<=triangles[i].max+EPS;j++){
    const a=triangles[i],b=triangles[j];if(a.f.filter(x=>b.f.includes(x)).length>=2)continue;
    if([1,2].some(k=>Math.max(...a.p.map(p=>p[k]))<Math.min(...b.p.map(p=>p[k]))-EPS||Math.max(...b.p.map(p=>p[k]))<Math.min(...a.p.map(p=>p[k]))-EPS))continue;
    if(++comparisons>2000000)throw new Error('Self-intersection check budget exceeded');
    let hit=a.p.some((p,k)=>segmentTriangle(p,a.p[(k+1)%3],...b.p))||b.p.some((p,k)=>segmentTriangle(p,b.p[(k+1)%3],...a.p));
    const n=unitVector(cross(subtract(a.p[1],a.p[0]),subtract(a.p[2],a.p[0])));
    if(!hit&&b.p.every(p=>Math.abs(dot(subtract(p,a.p[0]),n))<EPS)){
      const axis=n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs))),project=p=>p.filter((_,k)=>k!==axis),aa=a.p.map(project),bb=b.p.map(project);
      const strictInside=(p,t)=>{const v=[orient(t[0],t[1],p),orient(t[1],t[2],p),orient(t[2],t[0],p)];return v.every(x=>x>EPS)||v.every(x=>x<-EPS);};
      hit=aa.some(p=>strictInside(p,bb))||bb.some(p=>strictInside(p,aa))||aa.some((p,i)=>bb.some((q,j)=>{const a=aa[(i+1)%3],b=bb[(j+1)%3];return orient(p,a,q)*orient(p,a,b)<-EPS&&orient(q,b,p)*orient(q,b,a)<-EPS;}));
    }
    if(hit)throw new Error(`Generated mesh self-intersection between triangles ${a.index} and ${b.index}`);
  }
}
export function expandProfileOperation(op){const geometry=op.op==='sweep_profile'?sweepProfile(op):loftProfiles(op);return {op:'mesh',name:op.name,id:op.id,object_id:op.object_id,objectId:op.objectId,guid:op.guid,material:op.material,smooth:op.smooth??false,transform:op.transform,...geometry};}
