import { beamMesh, ringsMesh } from './solids.mjs';

// CAD tags apply inside one newly generated leaf only. Different skins, true
// folds, end caps and opening boundaries never share a smoothing tag.
export function mergeMeshes(meshes) {
  const vertices=[],faces=[],cad_faces=[];let tag=0;
  for(const mesh of meshes.filter(Boolean)) {
    const offset=vertices.length, tags=new Map();
    vertices.push(...mesh.vertices);
    for(const [i,face] of mesh.faces.entries()) {
      faces.push(face.map(v=>v+offset));
      const key=mesh.cad_faces?.[i] ?? i;
      if(!tags.has(key))tags.set(key,++tag);
      cad_faces.push(tags.get(key));
    }
  }
  return {vertices,faces,cad_faces,smooth:'cad'};
}
export function taggedBeam(a,b,width,height) {
  const mesh=beamMesh(a,b,width,height);
  mesh.cad_faces=[0,0,1,1,...Array.from({length:8},(_,i)=>2+Math.floor(i/2))];
  return mesh;
}
export function verticalRafter(a,b,width,height) {
  const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
  const side=[-dy/length*width/2,dx/length*width/2,0];
  const mesh=ringsMesh([a,b].map(p=>[[-1,-height],[1,-height],[1,0],[-1,0]].map(([s,z])=>[p[0]+s*side[0],p[1]+s*side[1],p[2]+z])));
  mesh.cad_faces=[0,0,1,1,...Array.from({length:8},(_,i)=>2+Math.floor(i/2))];return mesh;
}
export function boxMesh(origin,size) {
  const [x,y,z]=origin,[w,d,h]=size;
  const mesh=ringsMesh([z,z+h].map(Z=>[[x,y,Z],[x+w,y,Z],[x+w,y+d,Z],[x,y+d,Z]]));
  mesh.cad_faces=[0,0,1,1,...Array.from({length:8},(_,i)=>2+Math.floor(i/2))];
  return mesh;
}
export function closedSurface(top,bottom,faces) {
  const vertices=[...top,...bottom],n=top.length,edges=new Map(),output=[],tags=[];
  for(const [i,face] of faces.entries()) {
    const A=top[face[0]],B=top[face[1]],C=top[face[2]],u=B.map((v,k)=>v-A[k]),v=C.map((v,k)=>v-A[k]);
    const N=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const nonplanar=face.length===4&&Math.abs(N.reduce((sum,x,k)=>sum+x*(top[face[3]][k]-A[k]),0))/Math.hypot(...N)>.001;
    const cells=nonplanar?[[face[0],face[1],face[2]],[face[0],face[2],face[3]]]:[face];
    for(const cell of cells){output.push(cell,[...cell].reverse().map(v=>v+n));tags.push(0,1);}
    for(let k=0;k<face.length;k++) {
      const a=face[k],b=face[(k+1)%face.length],key=[a,b].sort((a,b)=>a-b).join(',');
      const row=edges.get(key)||{a,b,count:0};row.count++;edges.set(key,row);
    }
  }
  let tag=2;
  for(const {a,b,count} of edges.values())if(count===1){output.push([a,b,b+n,a+n]);tags.push(++tag);}
  return {vertices,faces:output,cad_faces:tags,smooth:'cad'};
}
export const boundsOf = points => ({min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i])))});
