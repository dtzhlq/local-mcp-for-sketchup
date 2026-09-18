import { sha256Canonical } from './agent-contract.mjs';
import { mockStructuralPersistentId } from './mock-structural-identity.mjs';
import { findModelObject, mockPersistentEntityPath } from './object-identity.mjs';
import { identityMatrix, matrixFromTransform, multiplyMatrices, transformPoint, transformNormal, transformVector, inverseMatrix, dot, cross, subtract, unitVector } from './geometry-matrix.mjs';
import { triangulatePolygon } from './profile-geometry.mjs';
import { boundingBoxForVertices } from './snapshot.mjs';
import { validateGeometryEdits } from './model-geometry-contract.mjs';
export function mockGeometryRevision(model){return sha256Canonical(model);}
export function mockGeometrySnapshot(model,{targets=['model'],recursive=true,max_vertices=10000,max_contexts=256}={}){
  const contexts=[];let count=0,complete=true;
  function walk(groups,instances,parents,matrix,depth,reviewRoot){
    if(depth>64){complete=false;return;}
    for(const [type,items] of [['group',groups],['component_instance',instances]])for(const item of items||[]){
      const pid=mockStructuralPersistentId(item,type,parents),path=[...parents,pid],entity_path=`pid:${path.join('.')}`,world=multiplyMatrices(matrix,matrixFromTransform(item.transform||{}));
      const reviewedRoot=reviewRoot??mockPersistentEntityPath([{entity_type:type,reference:item.id||item.name}]);
      const selected=targets.includes('model')||targets.some(t=>entity_path===t||recursive&&entity_path.startsWith(t+'.'));
      if(selected){
        if(contexts.length>=max_contexts||count+(item.vertices?.length||0)>max_vertices){complete=false;continue;}
        const vertices=(item.vertices||[]).map((p,i)=>({handle:`v:${i}`,position:[...p],world_position:transformPoint(world,p),edges:[],faces:[]}));
        const loops=item.mesh_faces||(item.geometry_input?.faces||[]).map(f=>f.outer||f.vertices||[]);
        const edgeMap=new Map();
        const faces=loops.map((loop,i)=>{
          const h=`f:${i}`;const ps=loop.map(j=>vertices[j]?.world_position);if(ps.some(p=>!p))throw new Error('Mock topology lacks explicit mesh data');
          const triangles=triangulatePolygon(ps).map(t=>t.map(j=>ps[j]));
          loop.forEach((j,k)=>{vertices[j].faces.push(h);const ids=[j,loop[(k+1)%loop.length]].sort((a,b)=>a-b),key=ids.join(':');if(!edgeMap.has(key))edgeMap.set(key,{handle:`e:${edgeMap.size}`,vertices:ids.map(j=>`v:${j}`),faces:[]});edgeMap.get(key).faces.push(h);});
          const local=loop.slice(0,3).map(j=>vertices[j].position);
          const normal=unitVector(cross(subtract(local[1],local[0]),subtract(local[2],local[0])));
          const worldNormal=transformNormal(world,normal);
          return {handle:h,loops:[{outer:true,vertices:loop.map(j=>`v:${j}`)}],world_normal:worldNormal,normal,area_mm2:triangles.reduce((s,t)=>s+Math.hypot(...cross(subtract(t[1],t[0]),subtract(t[2],t[0])))/2,0),triangles,material:item.material};
        });
        const edges=[...edgeMap.values()];edges.forEach(e=>{const vs=e.vertices.map(h=>vertices[Number(h.slice(2))]);vs.forEach(v=>v.edges.push(e.handle));e.length_mm=Math.hypot(...subtract(vs[0].world_position,vs[1].world_position));});
        contexts.push({entity_path,review_root:reviewedRoot,name:item.name,...(item.cad?{cad:{...item.cad,current:item.cad_mesh_hash===JSON.stringify([item.vertices,item.mesh_faces])}}:{}),transform:world,vertices,edges,faces,manifold:faces.length>0&&edges.every(e=>e.faces.length===2),complete:!(item.faces>0&&!faces.length),shared_definition:type==='component_instance'});count+=vertices.length;
      }
      const def=type==='component_instance'?model.component_definitions?.[item.definition]:item;
      if(def&&(recursive||!selected))walk(def.groups||[],def.instances||[],path,world,depth+1,reviewedRoot);
    }
  }
  if(!(targets.length===1&&targets[0]==='model'&&!recursive))walk(model.groups,model.instances,[],identityMatrix(),0);
  if(targets.includes('model')){
    const root=model.root_geometry||{id:'root_geometry',name:'Model loose geometry',vertices:[],mesh_faces:[],faces:0,edges:0};
    // Reuse the same topology materializer, with an isolated synthetic holder.
    const start=contexts.length;
    walk([root],[],[],identityMatrix(),0,'model');
    if(contexts[start]){contexts[start].entity_path='model';contexts[start].review_root='model';}
  }
  if(targets.some(t=>t!=='model'&&!contexts.some(c=>c.entity_path===t)))throw new Error('Geometry target not found');
  return {version:'model-geometry.v1',runtime:'mock',model_revision:mockGeometryRevision(model),complete:complete&&contexts.every(c=>c.complete),contexts,vertex_count:count,units:'mm'};
}
export function editMockGeometry(model,operation){
  if(mockGeometryRevision(model)!==operation.snapshot_revision)throw new Error('Stale geometry snapshot');
  validateGeometryEdits(operation.edits,{internal:true});
  const target=operation.context_path||operation.entity_path;
  const before=mockGeometrySnapshot(model,{targets:[target],recursive:false}).contexts[0];
  const item=target==='model'?(model.root_geometry||={id:'root_geometry',name:'Model loose geometry',vertices:[],mesh_faces:[],faces:0,edges:0}):findModelObject(model,{entity_path:target,instance_policy:'make_unique'},true).item;
  if(!item.vertices||!item.mesh_faces)throw new Error('Mock topology edits require an explicit mesh');
  for(const edit of operation.edits){
    const world=edit.coordinate_space==='world',inverse=inverseMatrix(before.transform);
    const vertex=h=>{if(!/^v:\d+$/.test(h)||!item.vertices[Number(h.slice(2))])throw new Error('Unknown vertex handle');return Number(h.slice(2));};
    const face=h=>{if(!/^f:\d+$/.test(h)||!item.mesh_faces[Number(h.slice(2))])throw new Error('Unknown face handle');return Number(h.slice(2));};
    if(edit.op==='replace_cad'){if(target==='model'||!before.cad?.current)throw new Error('CAD source is unavailable or stale');item.vertices=structuredClone(edit.mesh.vertices);item.mesh_faces=structuredClone(edit.mesh.faces);item.cad=structuredClone(edit.mesh.cad);item.cad_mesh_hash=JSON.stringify([item.vertices,item.mesh_faces]);}
    else if(edit.op==='move_vertices')for(const m of edit.moves){const i=vertex(m.handle),delta=world?transformVector(inverse,m.delta):m.delta;item.vertices[i]=item.vertices[i].map((x,j)=>x+delta[j]);}
    else if(edit.op==='transform_entities'){
      const indices=new Set(edit.handles.flatMap(h=>h.startsWith('v:')?[vertex(h)]:h.startsWith('f:')?item.mesh_faces[face(h)]:before.edges.find(e=>e.handle===h)?.vertices.map(vertex)??[]));
      const matrix=world?multiplyMatrices(inverse,multiplyMatrices(edit.matrix,before.transform)):edit.matrix;
      for(const i of indices)item.vertices[i]=transformPoint(matrix,item.vertices[i]);
    }else if(edit.op==='add_face'){
      const indices=edit.points.map(p=>{const local=world?transformPoint(inverse,p):p;let i=item.vertices.findIndex(v=>Math.hypot(...subtract(v,local))<1e-8);if(i<0){i=item.vertices.length;item.vertices.push(local);}return i;});triangulatePolygon(indices.map(i=>item.vertices[i]));item.mesh_faces.push(indices);
    }else if(edit.op==='reverse_face')item.mesh_faces[face(edit.handle)].reverse();
    else if(edit.op==='erase_entities'){const ids=edit.handles.map(face).sort((a,b)=>b-a);for(const i of ids)item.mesh_faces.splice(i,1);}
    else throw new Error(`Native-only topology behavior in mock: ${edit.op}`);
  }
  item.faces=item.mesh_faces.length;
  const edgeSet=new Set();for(const f of item.mesh_faces)f.forEach((v,i)=>edgeSet.add([v,f[(i+1)%f.length]].sort((a,b)=>a-b).join(':')));item.edges=edgeSet.size;
  item.bounding_box=boundingBoxForVertices(item.vertices.map(p=>transformPoint(matrixFromTransform(item.transform||{}),p)));
  return {entity_path_before:target,entity_path_after:target};
}
