// Offline constructive geometry adapter. Native triangle/solid algorithms are
// exercised numerically; no records from this file are native runtime receipts.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyTransform } from '../../src/operation-utils.mjs';
import { boxVertices } from '../../src/object-identity.mjs';

const boxFaces = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sub = (a,b) => a.map((x,i)=>x-b[i]);
const area = triangle => Math.hypot(...cross(sub(triangle[1],triangle[0]),sub(triangle[2],triangle[0]))) / 2;
const triangles = (vertices, faces) => faces.flatMap(face=>face.slice(1,-1).map((_,i)=>[vertices[face[0]],vertices[face[i+1]],vertices[face[i+2]]])).filter(triangle=>area(triangle)>1e-9);
const bounds = points => ({min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i])))});
const matrix = placement => {
  const a=(placement?.rotateZ||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  const mirror=Array.isArray(placement?.mirror)?placement.mirror:[placement?.mirror];
  const [x,y,z]=['x','y','z'].map(axis=>mirror.includes(axis)?-1:1);
  return {linear:[[c*x,-s*y,0],[s*x,c*y,0],[0,0,z]],t:placement?.translate||[0,0,0]};
};
const transform = (point,m) => m.linear.map((row,i)=>row.reduce((sum,v,j)=>sum+v*point[j],m.t[i]));
const compose = (a,b) => ({linear:a.linear.map(row=>[0,1,2].map(j=>row.reduce((sum,v,k)=>sum+v*b.linear[k][j],0))),t:transform(b.t,a)});
// Component placement here is rotation/reflection plus translation. The inverse
// of its orthogonal basis is its transpose, including negative determinants.
const inverse = m => {const linear=[0,1,2].map(i=>m.linear.map(row=>row[i]));return {linear,t:linear.map(row=>-row.reduce((sum,v,i)=>sum+v*m.t[i],0))};};

// Within every band between profile vertex Y coordinates, each boundary is
// linear and parity intervals form exact trapezoids. This respects concavity,
// holes and openings that touch the outer boundary, unlike a polygon fan.
export function scanlineProfileTriangles(loops) {
  const bands=[...new Set(loops.flat().map(p=>p[1]))].sort((a,b)=>a-b),result=[];
  for(let band=1;band<bands.length;band++){
    const y0=bands[band-1],y1=bands[band],mid=(y0+y1)/2;if(y1-y0<1e-9)continue;
    const edges=loops.flatMap(loop=>loop.flatMap((a,i)=>{
      const b=loop[(i+1)%loop.length];if((a[1]>mid)===(b[1]>mid))return[];
      const x=y=>a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]);return[{x0:x(y0),x1:x(y1),mid:x(mid)}];
    })).sort((a,b)=>a.mid-b.mid);
    if(edges.length%2)throw new Error('Profile scanline has odd boundary crossings');
    for(let i=0;i<edges.length;i+=2){const a=edges[i],b=edges[i+1];
      result.push([[a.x0,y0],[b.x0,y0],[b.x1,y1]],[[a.x0,y0],[b.x1,y1],[a.x1,y1]]);
    }
  }
  return result.filter(t=>Math.abs((t[1][0]-t[0][0])*(t[2][1]-t[0][1])-(t[1][1]-t[0][1])*(t[2][0]-t[0][0]))>1e-9);
}

function profileTriangles(operation) {
  let outer=operation.outer,holes=operation.holes||[],depth=operation.depth;
  if(operation.op==='panel_with_openings'){
    const [w,h]=operation.size;outer=[[0,0],[w,0],[w,h],[0,h]];depth=operation.thickness;
    holes=(operation.openings||[]).map(o=>[[o.x,o.y],[o.x+o.width,o.y],[o.x+o.width,o.y+o.height],[o.x,o.y+o.height]]);
  }
  if(!outer||!depth)throw new Error(`Unsupported constructive profile: ${operation.name}`);
  const loops=[outer,...holes.map(h=>h.points||h)].map((loop,index)=>{
    const signed=loop.reduce((sum,p,i)=>{const q=loop[(i+1)%loop.length];return sum+p[0]*q[1]-q[0]*p[1];},0);
    return (signed>0)===(index===0)?loop:[...loop].reverse();
  }),origin=operation.origin||[0,0,0];
  const p=(uv,d)=>{const [u,v]=uv;const point=operation.plane==='xz'?[u,d,v]:operation.plane==='yz'?[d,u,v]:[u,v,d];return point.map((x,i)=>x+origin[i]);};
  const result=scanlineProfileTriangles(loops).flatMap(t=>[t.map(uv=>p(uv,0)).reverse(),t.map(uv=>p(uv,depth))]);
  for(const loop of loops)for(let i=0;i<loop.length;i++){
    const a=loop[i],b=loop[(i+1)%loop.length];result.push([p(a,0),p(b,0),p(b,depth)],[p(a,0),p(b,depth),p(a,depth)]);
  }
  return result.map(t=>applyTransform(t,operation));
}

export function exportOfflineRegionRecords(bundle,model) {
  const source=new Map();
  const index=operations=>operations.forEach(op=>{if(op.operations)index(op.operations);else if(op.id||op.name)source.set(op.id||op.name,op);});index(bundle.dsl.operations);
  const records=[],anchors=new Map(),methods={};
  const walk=(container,parent,chain)=>{
    for(const group of container.groups||[]){
      const op=source.get(group.id)||source.get(group.name);let mesh,method;
      if(group.mesh_faces){mesh=triangles(applyTransform(group.vertices,{transform:group.transform}),group.mesh_faces);method='mock_exported_mesh';}
      else if(op?.op==='box'){mesh=triangles(applyTransform(boxVertices(op.origin,op.size),op),boxFaces);method='constructive_box';}
      else if(['profile_extrude','panel_with_openings'].includes(op?.op)){mesh=profileTriangles(op);method='constructive_profile_scanlines';}
      else throw new Error(`Offline region adapter has no exact geometry for ${group.id} (${op?.op||group.kind})`);
      const world=mesh.map(t=>t.map(p=>transform(p,parent))),points=world.flat();
      records.push({triangles:world,...bounds(points),solid:true,shell_count:1,reference_path:[...chain,group.id],offline_geometry_method:method});
      methods[method]=(methods[method]||0)+1;
    }
    for(const instance of container.instances||[]){const world=compose(parent,matrix(instance.transform)),chainNext=[...chain,instance.id];anchors.set(JSON.stringify(chainNext),world);walk(model.component_definitions[instance.definition],world,chainNext);}
  };
  walk(model,matrix(),[]);
  return {records,anchors,methods,evidence:'offline_constructive_geometry_not_native_manifold_proof'};
}

export function offlineRegionQueries(bundle,exported) {
  return (bundle.detail_spec.required_voids||[]).map(query=>{
    const anchor=exported.anchors.get(JSON.stringify(query.instance_path));if(!anchor)throw new Error(`Missing offline anchor: ${query.instance_path}`);
    const inverseAnchor=inverse(anchor),scope=query.search_scope||'scene',offset=Math.max(1,...(query.boundary_checks||[]).map(check=>check.offset_mm+1));
    const minimum=query.bounds_mm.min.map(value=>value-offset),maximum=query.bounds_mm.max.map(value=>value+offset);
    const records=exported.records.flatMap(record=>{
      if(scope==='assembly'&&!query.instance_path.every((id,i)=>record.reference_path[i]===id))return[];
      const localBox=bounds(boxVertices(record.min,record.max.map((v,i)=>v-record.min[i])).map(p=>transform(p,inverseAnchor)));
      if([0,1,2].some(i=>localBox.max[i]<minimum[i]||localBox.min[i]>maximum[i]))return[];
      const transformed=record.triangles.map(t=>t.map(p=>transform(p,inverseAnchor)));
      return[{...record,triangles:transformed,...bounds(transformed.flat())}];
    });
    return {query,records};
  });
}

export function evaluateOfflineRegionQueries(cases) {
  const rubyPath=fileURLToPath(new URL('../../sketchup_plugin/alma_sketchup_mcp/geometry_evidence.rb',import.meta.url));
  const ruby=`require 'json';require ${JSON.stringify(rubyPath)}; module AlmaSketchupMCP; def self.mm_to_model_units(value);value.to_f;end;end; cases=JSON.parse(STDIN.read);puts JSON.generate(cases.map{|entry| records=entry['records'].map{|r|{triangles:r['triangles'],min:r['min'],max:r['max'],solid:r['solid'],shell_count:r['shell_count'],reference_path:r['reference_path']}}; result=AlmaSketchupMCP.evaluate_detail_region(entry['query'],records);result.merge('id'=>entry['query']['id'],'evidence_source'=>'offline_constructive_adapter_not_sketchup_runtime')})`;
  const result=spawnSync('ruby',['-e',ruby],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:8*1024*1024,timeout:60000});
  if(result.status!==0)throw new Error(`Offline Ruby region evaluation failed: ${result.stderr||result.error}`);
  return JSON.parse(result.stdout);
}
