import assert from 'node:assert/strict';
import { buildDetailedRecipe, hollowPipeMesh, downpipeShoePath } from '../src/detailed-modeling/recipes.mjs';
import { parallelTransportFrames } from '../src/surface-operations.mjs';

const subtract=(a,b)=>a.map((value,index)=>value-b[index]);
const dot=(a,b)=>a.reduce((sum,value,index)=>sum+value*b[index],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const near=(actual,expected,tolerance=1e-7)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} differs from ${expected}`);
function intersection(mesh,start,end){
  const direction=subtract(end,start);
  for(const face of mesh.faces){
    const [a,b,c]=face.map(index=>mesh.vertices[index]),ab=subtract(b,a),ac=subtract(c,a),h=cross(direction,ac),det=dot(ab,h);
    if(Math.abs(det)<1e-10)continue;
    const s=subtract(start,a),u=dot(s,h)/det,q=cross(s,ab),v=dot(direction,q)/det,t=dot(ac,q)/det;
    if(u>=-1e-8&&v>=-1e-8&&u+v<=1+1e-8&&t>1e-8&&t<1-1e-8)return true;
  }
  return false;
}
const results=[];
for(const width of [1200,4800,5600]){
  const recipe=buildDetailedRecipe('eaves_drainage',{id:'test-drain',parameters:{width}});
  const mesh=recipe.parts.find(part=>part.id==='test-drain-shoe').shape.parameters;
  const downpipe=recipe.parts.find(part=>part.id==='test-drain-downpipe').shape.parameters;
  const centers=downpipeShoePath(width-130),frames=parallelTransportFrames(centers).frames,segments=40,offset=centers.length*segments;
  assert.deepEqual(mesh,hollowPipeMesh(centers,42,39));
  assert.deepEqual(centers.at(-1),[width-130,-180,55]);
  const edges=new Map();let volume=0;
  for(const face of mesh.faces){
    assert.equal(face.length,3,'Every bent surface patch is explicitly planar');
    const [a,b,c]=face.map(index=>mesh.vertices[index]),normal=cross(subtract(b,a),subtract(c,a));
    assert.ok(Math.hypot(...normal)>1e-4,'No degenerate or collapsed wall triangle');
    volume+=dot(a,cross(b,c))/6;
    for(let index=0;index<3;index++){
      const a=face[index],b=face[(index+1)%3],key=[a,b].sort((x,y)=>x-y).join(':');
      const entry=edges.get(key)||{count:0,balance:0};entry.count++;entry.balance+=a<b?1:-1;edges.set(key,entry);
    }
  }
  assert.ok(volume>0,'The hollow wall must be a positive-volume, consistently oriented solid');
  assert.ok([...edges.values()].every(edge=>edge.count===2&&edge.balance===0),'All walls and annular rims share exactly two opposite-oriented faces per edge');
  for(let ring=0;ring<centers.length;ring++)for(let index=0;index<segments;index++){
    const outer=mesh.vertices[ring*segments+index],inner=mesh.vertices[offset+ring*segments+index];
    near(Math.hypot(...subtract(outer,centers[ring])),42);near(Math.hypot(...subtract(inner,centers[ring])),39);
    near(Math.hypot(...subtract(outer,inner)),3);near(dot(subtract(outer,centers[ring]),frames[ring].tangent),0);
  }
  for(let index=0;index<segments;index++){
    near(mesh.vertices[index][2],160);near(mesh.vertices[segments+index][2],152);
    const expected=downpipe.outer[index].map((value,axis)=>value+downpipe.origin[axis]);expected.push(downpipe.origin[2]);
    assert.ok(mesh.vertices.slice(0,segments).some(point=>Math.hypot(...subtract(point,expected))<1e-7),'Shoe outer inlet must exactly match the straight downpipe XY polygon');
    const innerExpected=downpipe.holes[0][index].map((value,axis)=>value+downpipe.origin[axis]);innerExpected.push(downpipe.origin[2]);
    assert.ok(mesh.vertices.slice(offset,offset+segments).some(point=>Math.hypot(...subtract(point,innerExpected))<1e-7),'The inner inlet must have the same radius and ring seam as the downpipe');
  }
  for(let ring=1;ring<centers.length;ring++){
    assert.ok(dot(frames[ring-1].u,frames[ring].u)>0.99,'The seam must not twist at the bend');
    assert.ok(dot(frames[ring-1].tangent,frames[ring].tangent)>0.98,'The bend must change direction in small increments');
    assert.equal(intersection(mesh,centers[ring-1],centers[ring]),false,'The centerline waterway must remain unblocked through every span');
  }
  const top=centers[0],bottom=centers.at(-1),lastTangent=frames.at(-1).tangent;
  assert.equal(intersection(mesh,top.map((value,axis)=>value-frames[0].tangent[axis]*2),top.map((value,axis)=>value+frames[0].tangent[axis]*2)),false,'No inlet cap covers the center');
  assert.equal(intersection(mesh,bottom.map((value,axis)=>value-lastTangent[axis]*2),bottom.map((value,axis)=>value+lastTangent[axis]*2)),false,'No outlet cap covers the center');
  results.push({width,rings:centers.length,vertices:mesh.vertices.length,faces:mesh.faces.length,closed_wall_volume_mm3:volume});
}
assert.throws(()=>hollowPipeMesh([[0,0,0],[0,0,0]],42,39),/repeated/);
assert.throws(()=>hollowPipeMesh([[0,0,0],[0,0,10]],39,42),/wall thickness/);
console.log(JSON.stringify({ok:true,scope:'offline constructive mesh numeric checks',live_runtime_executed:false,cases:results}));
