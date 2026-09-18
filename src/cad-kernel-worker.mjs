// Isolated CAD computation. This process receives data only, never user code.
import fs from 'node:fs';
import init from 'replicad-opencascadejs';
import {setOC,cast,makeBox,makeCylinder,makeSolid,weldShellsAndFaces,measureShapeVolumeProperties} from 'replicad';
const oc=await init();setOC(oc);
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const shapes=new Map();
function array(C,values){const a=new C(1,values.length);values.forEach((x,i)=>a.SetValue(i+1,x));return a;}
function nurbs(n){
 const pts=new oc.NCollection_Array2_gp_Pnt(1,n.poles.length,1,n.poles[0].length), weights=new oc.NCollection_Array2_double(1,n.poles.length,1,n.poles[0].length);
 n.poles.forEach((row,i)=>row.forEach((p,j)=>{const point=new oc.gp_Pnt(...p);pts.SetValue(i+1,j+1,point);weights.SetValue(i+1,j+1,n.weights?.[i]?.[j]??1);point.delete();}));
 const surface=new oc.Geom_BSplineSurface(pts,weights,array(oc.NCollection_Array1_double,n.u_knots),array(oc.NCollection_Array1_double,n.v_knots),array(oc.NCollection_Array1_int,n.u_multiplicities),array(oc.NCollection_Array1_int,n.v_multiplicities),n.u_degree,n.v_degree,false,false);
 return cast(new oc.BRepBuilderAPI_MakeFace(surface,1e-7).Face());
}
try{
 for(const n of input.recipe.nodes){
  const source=shapes.get(n.input);let shape;
  if(n.kind==='sew'){const inputs=n.inputs.map(id=>shapes.get(id));const shell=weldShellsAndFaces(inputs);if(n.solid&&!shell.wrapped.Closed())throw new Error('Cannot make solid from an open shell');shape=n.solid?makeSolid([shell]):shell;}
  else if(n.kind==='box')shape=makeBox(n.min,n.max);
  else if(n.kind==='cylinder')shape=makeCylinder(n.radius,n.height,n.origin??[0,0,0],n.axis??[0,0,1]);
  else if(n.kind==='nurbs_surface')shape=nurbs(n);
  else if(['fuse','cut','intersect'].includes(n.kind))shape=source[n.kind](shapes.get(n.other));
  else if(n.kind==='fillet'){
   if(!source.fillet)throw new Error('Fillet requires a solid or shell');
   const edges=source.edges;
   if(n.edges&&n.edges.some(i=>i>=edges.length))throw new Error('Selected CAD edge does not exist');
   shape=source.fillet(n.edges?(edge=>n.edges.some(i=>edges[i].isSame(edge))?n.radius:0):n.radius);
  }
  const check=new oc.BRepCheck_Analyzer(shape.wrapped,true,false,true);
  if(!check.IsValid())throw new Error('CAD topology is invalid at node '+n.id);
  check.delete();shapes.set(n.id,shape);
 }
 const shape=shapes.get(input.recipe.output);
 const bounds=shape.boundingBox.bounds;
 if(Math.hypot(...bounds[1].map((x,i)=>x-bounds[0][i]))/input.tolerance>200000||shape.faces.length>2000)throw new Error('CAD meshing complexity budget exceeded');
 const mesh=shape.mesh({tolerance:input.tolerance,angularTolerance:input.angular_tolerance});
 if(mesh.triangles.length<3||mesh.vertices.some(x=>!Number.isFinite(x)))throw new Error('CAD output has no finite surface mesh');
 if(mesh.vertices.length/3>input.max_vertices||mesh.triangles.length/3>input.max_faces)throw new Error('CAD tessellation budget exceeded');
 const vertices=[],faces=[],indices=[],seen=new Map(),cad_faces=[];
 for(const [id,g] of mesh.faceGroups.entries())for(let k=g.start/3;k<(g.start+g.count)/3;k++)cad_faces[k]=id;
 for(let i=0;i<mesh.vertices.length;i+=3){const p=mesh.vertices.slice(i,i+3);const key=p.map(x=>Math.round(x/1e-8)).join(',');let index=seen.get(key);if(index===undefined){index=vertices.length;seen.set(key,index);vertices.push(p);}indices.push(index);}
 for(let i=0;i<mesh.triangles.length;i+=3){const f=mesh.triangles.slice(i,i+3).map(j=>indices[j]);if(new Set(f).size!==3)throw new Error('Tessellation produced degenerate triangles');faces.push(f);}
 const edges=shape.edges.map((e,index)=>({index,type:e.geomType,length:e.length,start:e.startPoint.toTuple(),end:e.endPoint.toTuple()}));
 let volume=null;if(shape.solids.length)volume=measureShapeVolumeProperties(shape).volume;
 process.stdout.write(JSON.stringify({ok:true,vertices,faces,cad_faces,evidence:{kernel:'OpenCascade/replicad-opencascadejs@1.1.0',valid:true,faces:shape.faces.length,edges,volume_mm3:volume,tolerance_mm:input.tolerance,angular_tolerance:input.angular_tolerance},brep:shape.serialize()}));
}catch(error){process.stdout.write(JSON.stringify({ok:false,error:String(error?.message??error)}));process.exitCode=1;}
