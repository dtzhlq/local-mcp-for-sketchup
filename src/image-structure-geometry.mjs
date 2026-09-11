// Construct the same offline primitives used by MockRuntime, without touching a session.
// This validates geometry only. It is not visual or live SketchUp acceptance.
import * as product from './product-operations.mjs';
import * as primitive from './primitive-operations.mjs';
import * as profile from './profile-operations.mjs';
import * as surface from './surface-operations.mjs';
import { addComponentDefinition, addComponentInstance } from './component-operations.mjs';
import { ensureMaterial } from './material-operations.mjs';
import { emptyModel } from './model-state.mjs';
import { createSnapshot } from './snapshot.mjs';
const implementations={...product,...primitive,...profile,...surface};
export function validateImageGeometry(document) {
  const model=emptyModel();
  for (const operation of document.operations) {
    if (operation.op==='material') {ensureMaterial(model,operation);continue;}
    if (operation.op==='component_definition') {addComponentDefinition(model,operation);continue;}
    if (operation.op==='component_instance') {addComponentInstance(model,operation);continue;}
    if (operation.op==='mesh') validateMeshPlanes(operation);
    const name='add'+operation.op.split('_').map(p=>p[0].toUpperCase()+p.slice(1)).join('');
    const apply=implementations[name];
    if (typeof apply!=='function') throw new Error(`No constructive geometry validator for ${operation.op}`);
    apply(model,operation);
  }
  const snapshot=createSnapshot(model);
  return {evidence_level:'offline_geometry_only',bounding_box:snapshot.bounding_box,object_count:model.groups.length,objects:model.groups.map(g=>({id:g.id,name:g.name,kind:g.kind,bounding_box:g.bounding_box}))};
}

// Native SketchUp requires every submitted face loop to be planar. The offline
// mesh primitive stores loops without this check, so enforce it at this adapter.
export function validateMeshPlanes(operation) {
  const vertices=operation.vertices || [];
  for (const [faceIndex,indices] of (operation.faces || []).entries()) {
    const points=indices.map(i=>vertices[i]);
    if(points.some(p=>!Array.isArray(p)||p.length!==3)) throw new Error(`Part ${operation.name}: invalid mesh face ${faceIndex}`);
    const origin=points[0];let normal=null;
    for(let i=1;i<points.length-1;i++) {
      const a=points[i].map((x,k)=>x-origin[k]),b=points[i+1].map((x,k)=>x-origin[k]);
      const n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],length=Math.hypot(...n);
      if(length>1e-10){normal=n.map(x=>x/length);break;}
    }
    if(!normal) throw new Error(`Part ${operation.name}: degenerate mesh face ${faceIndex}`);
    if(points.some(p=>Math.abs(p.reduce((sum,x,k)=>sum+(x-origin[k])*normal[k],0))>1e-6))
      throw new Error(`Part ${operation.name}: mesh face ${faceIndex} is not planar; submit explicit planar faces or triangles`);
  }
}
