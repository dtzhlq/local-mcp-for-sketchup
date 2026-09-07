import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tubeMeshFromPath,parallelTransportFrames,addSweptPath,addPipeBetweenPoints} from '../src/surface-operations.mjs';
import {buildJoinedWallMesh,addWall,addWallPath} from '../src/architecture-operations.mjs';
import {emptyModel} from '../src/model-state.mjs';

const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function closedEdges(mesh){const counts=new Map();for(const face of mesh.faces)for(let i=0;i<face.length;i++){const key=[face[i],face[(i+1)%face.length]].sort((a,b)=>a-b).join(':');counts.set(key,(counts.get(key)||0)+1);}assert.ok([...counts.values()].every(n=>n===2),'Every actual mesh edge must have two incident faces');}
function volume(mesh){let sum=0;for(const f of mesh.faces)for(let i=1;i<f.length-1;i++)sum+=dot(mesh.vertices[f[0]],cross(mesh.vertices[f[i]],mesh.vertices[f[i+1]]))/6;return sum;}
function near(actual,expected,epsilon=1e-7){assert.ok(Math.abs(actual-expected)<=epsilon,`${actual} != ${expected}`);}
function parity(actual,expected){if(Array.isArray(actual)){assert.equal(actual.length,expected.length);actual.forEach((v,i)=>parity(v,expected[i]));}else if(typeof actual==='number')near(actual,expected,1e-7);else assert.equal(actual,expected);}
function rayIntersections(mesh,origin,direction){let count=0;for(const face of mesh.faces)for(let i=1;i<face.length-1;i++){
  const a=mesh.vertices[face[0]],b=mesh.vertices[face[i]],c=mesh.vertices[face[i+1]],e1=sub(b,a),e2=sub(c,a),h=cross(direction,e2),det=dot(e1,h);if(Math.abs(det)<1e-9)continue;
  const s=sub(origin,a),u=dot(s,h)/det;if(u<-1e-8||u>1+1e-8)continue;const q=cross(s,e1),v=dot(direction,q)/det;if(v<-1e-8||u+v>1+1e-8)continue;const t=dot(e2,q)/det;if(t>1e-8)count++;
}return count;}

const paths=[[[0,0,0],[0,0,1000]],[[0,0,0],[0,1000,0]],[[0,0,0],[40,0,80],[75,0,165],[95,0,265],[105,0,365]],[[0,0,0],[300,0,100],[500,300,250],[500,600,550],[700,800,650]],[[0,0,0],[1000,0,0],[1000,1000,0],[0,1000,0],[0,0,0]]];
const tubeCases=paths.map(path=>({path,radius:15,segments:24}));
for(const {path,radius,segments} of tubeCases){const mesh=tubeMeshFromPath(path,radius,segments);closedEdges(mesh);assert.ok(volume(mesh)>0);
  const count=mesh.closed?path.length-1:path.length;
  for(let ring=0;ring<count;ring++)for(let j=0;j<segments;j++){const offset=sub(mesh.vertices[ring*segments+j],path[ring]);near(Math.hypot(...offset),radius);near(dot(offset,mesh.frames[ring].tangent),0);}
  if(mesh.closed)parity(mesh.frames[0].u,mesh.frames.at(-1).u);
}
const thresholdFrames=parallelTransportFrames(paths[2]).frames;
for(let i=1;i<thresholdFrames.length;i++)assert.ok(dot(thresholdFrames[i-1].u,thresholdFrames[i].u)>0.99,'A tangent crossing the old global-axis threshold must not rotate the ring seam abruptly');
assert.throws(()=>parallelTransportFrames([[0,0,0],[0,0,0],[1,0,0]]),/repeated adjacent/);
assert.throws(()=>parallelTransportFrames([[0,0,0],[100,0,0],[0,0,0]]),/reversing cusp/);
const model=emptyModel();addSweptPath(model,{name:'vertical-sweep',path:paths[0],radius:15,segments:24});near(model.groups[0].bounding_box.w,30);near(model.groups[0].bounding_box.d,30);near(model.groups[0].bounding_box.h,1000);
addPipeBetweenPoints(model,{name:'transport-pipe',points:paths[2],radius:15,segments:24});parity(model.groups[1].vertices,tubeMeshFromPath(paths[2],15,24).vertices);

const wallCases=[
  {path:[[0,0,0],[2000,0,0],[2000,1500,0]],height:2800,thickness:180,openings:[]},
  {path:[[0,0,0],[2000,0,0],[2000,1500,0]],height:2800,thickness:180,openings:[{segment_index:0,offset:300,width:600,sill_height:800,height:900}]},
  {path:[[0,0,0],[2000,0,0],[2000,1500,0]],height:2800,thickness:180,openings:[{segment_index:0,offset:300,width:600,sill_height:0,height:2100}]},
  {path:[[0,0,120],[1600,1200,120],[900,2600,120],[2100,3800,120]],height:2800,thickness:180,openings:[{segment_index:1,offset:350,width:550,sill_height:850,height:1050}]}
];
for(const item of wallCases){const mesh=buildJoinedWallMesh(item.path,item.height,item.thickness,item.openings);closedEdges(mesh);assert.ok(volume(mesh)>0,'Joined wall normals must face outward');
  const length=item.path.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-item.path[i][0],p[1]-item.path[i][1]),0),openingArea=item.openings.reduce((sum,o)=>sum+o.width*o.height,0);
  near(volume(mesh),(length*item.height-openingArea)*item.thickness,0.001);
}
const opened=buildJoinedWallMesh(wallCases[1].path,2800,180,wallCases[1].openings);
assert.equal(rayIntersections(opened,[620,-500,1050],[0,1,0]),0,'A real ray must pass through the window void');
assert.ok(rayIntersections(opened,[160,-500,1050],[0,1,0])>=2,'The adjacent wall must remain solid');
const continuous=buildJoinedWallMesh(wallCases[0].path,2800,180,[]);assert.equal(continuous.faces.length,10,'The wall corner must share a miter seam, without two internal end caps');
assert.throws(()=>buildJoinedWallMesh([[0,0,0],[1000,0,0],[0,0,0]],2000,120),/reversing/);
assert.throws(()=>buildJoinedWallMesh([[0,0,0],[1000,0,20]],2000,120),/one elevation/);
assert.throws(()=>buildJoinedWallMesh(wallCases[0].path,2800,180,[{segment_index:0,offset:1850,width:130,sill_height:800,height:900}]),/mitered corner/);
const diagonal=emptyModel();addWall(diagonal,{name:'diagonal-opening',start:[100,200,0],end:[2100,2200,0],height:2800,thickness:180,openings:[{offset:400,width:700,sill_height:800,height:1000}]});assert.equal(diagonal.groups[0].openings[0].x,400);assert.equal(diagonal.groups[0].wall_frame.rotateZ,45);assert.equal(diagonal.groups[0].faces,10);
const pathModel=emptyModel();addWallPath(pathModel,{name:'joined-open-wall',path:wallCases[1].path,height:2800,thickness:180,openings:wallCases[1].openings});assert.equal(pathModel.groups[0].joinery,'mitered_continuous_mesh');parity(pathModel.groups[0].vertices,opened.vertices);

const rubySource=`require 'json'; require ${JSON.stringify(fileURLToPath(new URL('../sketchup_plugin/alma_sketchup_mcp/surface_operations.rb',import.meta.url)))}; require ${JSON.stringify(fileURLToPath(new URL('../sketchup_plugin/alma_sketchup_mcp/architecture_operations.rb',import.meta.url)))}; d=JSON.parse(STDIN.read); puts JSON.generate({'tubes'=>d['tubes'].map{|c| AlmaSketchupMCP.tube_mesh_from_path(c['path'],c['radius'],c['segments'])},'walls'=>d['walls'].map{|c| AlmaSketchupMCP.build_joined_wall_mesh(c['path'],c['height'],c['thickness'],c['openings'])}})`;
const ruby=spawnSync('ruby',['-e',rubySource],{input:JSON.stringify({tubes:tubeCases,walls:wallCases}),encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(ruby.status,0,ruby.stderr);const native=JSON.parse(ruby.stdout);
tubeCases.forEach((c,i)=>{const js=tubeMeshFromPath(c.path,c.radius,c.segments);parity(native.tubes[i].vertices,js.vertices);assert.deepEqual(native.tubes[i].faces,js.faces);});
wallCases.forEach((c,i)=>{const js=buildJoinedWallMesh(c.path,c.height,c.thickness,c.openings);parity(native.walls[i].vertices,js.vertices);assert.deepEqual(native.walls[i].faces,js.faces);});
console.log('surface-wall-geometry: 5 tube paths and 4 joined walls passed radius/normal/seam/manifold/volume/void-ray checks with Ruby-JS vertex and face parity; diagonal opening dispatch verified offline');
