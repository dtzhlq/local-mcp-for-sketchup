// Millimetre-only constructive geometry. Local coordinates belong to leaves;
// assembly placements hold transforms, matching PartGraph v2 semantics.
export const plus=(a,b)=>a.map((v,i)=>v+b[i]);
export const minus=(a,b)=>a.map((v,i)=>v-b[i]);
export const times=(a,s)=>a.map(v=>v*s);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=v=>times(v,1/Math.hypot(...v));
export function ringsMesh(rings){
 const n=rings[0].length;if(n<3||rings.some(r=>r.length!==n))throw new Error('Matching section rings required');
 const vertices=rings.flat(),faces=[];
 for(let i=1;i<n-1;i++){faces.push([0,i+1,i]);const a=(rings.length-1)*n;faces.push([a,a+i,a+i+1]);}
 for(let r=0;r<rings.length-1;r++)for(let i=0;i<n;i++){const a=r*n+i,d=r*n+(i+1)%n;faces.push([a,d,d+n],[a,d+n,a+n]);}
 return {vertices,faces};
}
export function beamMesh(a,b,width,height){
 const axis=minus(b,a);if(Math.hypot(...axis)<1e-6)throw new Error('Zero-length timber member');
 const ref=Math.hypot(axis[0],axis[1])<1e-8?[0,1,0]:[0,0,1],w=unit(cross(ref,axis)),h=unit(cross(axis,w));
 return ringsMesh([a,b].map(p=>[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>plus(p,plus(times(w,x*width/2),times(h,y*height/2))))));
}
export function slabMesh(top,thickness){return ringsMesh([top.map(v=>plus(v,[0,0,-thickness])),top]);}
export class YfBuilder{
 constructor(id,provenance){this.id=id;this.provenance=provenance;this.parts=[];this.keys=new Set();this.anchors={};}
 full(key){return key==='root'?this.id:`${this.id}-${key}`;}
 leaf(key,primitive,parameters,role,material='Detail_Oak',rule=''){
  const id=this.full(key);if(this.keys.has(key))return {part_id:id};this.keys.add(key);
  const geometryId=`${id}-geometry`;
  this.parts.push({id:geometryId,name:geometryId,type:'detail_geometry',role,material,detail_level:'detailed',evidence_status:'needs_review',fallback_state:'structured_primitive',shape:{primitive,parameters},qa:{rule_set:this.provenance.id,source_rule:rule}},
    {id,name:id,type:'assembly',role,detail_level:'detailed',evidence_status:'needs_review',fallback_state:'structured_primitive',assembly:{children:[{part_id:geometryId}]}});
  return {part_id:id};
 }
 mesh(key,mesh,role,material,rule){return this.leaf(key,'mesh',{...mesh,construction:'bulk',smooth:mesh.smooth||'coplanar'},role,material,rule);}
 box(key,origin,size,role,material,rule){if(size.some(v=>!Number.isFinite(v)||v<=0))throw new Error(`Nonpositive section ${key}`);return this.leaf(key,'box',{origin,size},role,material,rule);}
 beam(key,start,end,width,height,role,material,rule){return this.mesh(key,beamMesh(start,end,width,height),role,material,rule);}
 pipe(key,start,end,radius,role,material,rule){return this.leaf(key,'pipe_between_points',{start,end,radius,segments:16,smooth:'all'},role,material,rule);}
 profile(key,outer,depth,role,rule){return this.leaf(key,'profile_extrude',{origin:[0,-depth/2,0],plane:'xz',outer,depth},role,'Detail_Oak',rule);}
 group(key,make,role=key){const id=this.full(key);if(!this.keys.has(key)){this.keys.add(key);const children=make();this.parts.push({id,name:id,type:'assembly',role,detail_level:'detailed',evidence_status:'needs_review',fallback_state:'structured_primitive',assembly:{children}});}return {part_id:id};}
 at(ref,key,origin=[0,0,0],angle=0){return {...ref,instance_id:this.full(key),origin,...(angle?{transform:{rotateZ:angle}}:{})};}
 anchor(key,point){this.anchors[key]=point;return point;}
}
