import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import { FURNISHING_ASSET_KINDS, buildFurnishingAsset, buildFurnishingAssetBundle } from '../src/detailed-modeling/furnishing-assets.mjs';
import { MockRuntime } from '../src/mock-runtime.mjs';

const schema=JSON.parse(await fs.readFile(new URL('../schema/part-graph.schema.json',import.meta.url),'utf8'));
const validate=new Ajv({allErrors:true,strict:false}).compile(schema);
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'sketchup-furnishing-assets-'));
const sub=(a,b)=>a.map((v,i)=>v-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
function closedOutwardMesh({vertices,faces},label){
  const edges=new Map();let volume=0;
  for(const face of faces){
    assert.ok(face.length>=3);
    for(let i=0;i<face.length;i++){const a=face[i],b=face[(i+1)%face.length];assert.notEqual(a,b);const key=[a,b].sort((a,b)=>a-b).join(':');const old=edges.get(key)||{count:0,balance:0};old.count++;old.balance+=a<b?1:-1;edges.set(key,old);}
    const a=vertices[face[0]],b=vertices[face[1]],c=vertices[face[2]],normal=cross(sub(b,a),sub(c,a)),length=Math.hypot(...normal);
    assert.ok(length>1e-10,`${label}: degenerate face`);
    for(const index of face)assert.ok(Math.abs(dot(sub(vertices[index],a),normal))/length<1e-7,`${label}: every bulk face must be planar`);
    for(let i=1;i<face.length-1;i++)volume+=dot(vertices[face[0]],cross(vertices[face[i]],vertices[face[i+1]]))/6;
  }
  for(const edge of edges.values()){assert.equal(edge.count,2,`${label}: open or branching mesh edge`);assert.equal(edge.balance,0,`${label}: inconsistent face winding`);}
  assert.ok(volume>0,`${label}: material volume must face outward`);
  return volume;
}
const reports=[];
for(const kind of FURNISHING_ASSET_KINDS){
  const bundle=buildFurnishingAssetBundle({kind,id:`test-${kind}`});
  assert.equal(validate(bundle.part_graph),true,JSON.stringify(validate.errors));
  const materials=new Set(bundle.materials.map(material=>material.name));
  assert.ok(materials.has('Detail_Fabric'));
  for(const part of bundle.parts.filter(part=>part.shape)){assert.ok(materials.has(part.material));assert.ok(!part.shape.primitive.startsWith('cut_'));if(part.shape.primitive==='mesh')closedOutwardMesh(part.shape.parameters,part.id);}
  assert.equal(bundle.detail_spec.required_parts.length,bundle.parts_mapping.length);
  assert.equal(new Set(bundle.detail_spec.required_parts.map(rule=>rule.instance_path.join('/'))).size,bundle.parts_mapping.length);
  const snapshot=await new MockRuntime({sessionPath:path.join(temporary,`${kind}.json`)}).buildModel(JSON.stringify(bundle.dsl));
  assert.equal(snapshot.totals.instances,1);assert.equal(snapshot.totals.groups,0);
  assert.ok(snapshot.totals.faces>500);
  assert.ok(bundle.source.includes('project authored'));
  reports.push({kind,parts:bundle.parts.length,occurrences:bundle.parts_mapping.length,faces:snapshot.totals.faces,definitions:snapshot.component_definitions.length});
}
const chair=buildFurnishingAsset('reading_chair',{id:'chair'});
const wideChair=buildFurnishingAsset('reading_chair',{id:'chair',parameters:{width:840}});
assert.deepEqual(chair.parts.map(part=>part.id),wideChair.parts.map(part=>part.id),'Changing the chair width must preserve part identities');
assert.equal(chair.parts.find(part=>part.id==='chair').assembly.children.filter(child=>child.part_id==='chair-leg').length,4);
const cushion=chair.parts.find(part=>part.role==='seat_cushion').shape.parameters;
assert.ok(cushion.vertices.length>100);
assert.equal(Math.max(...cushion.vertices.map(p=>p[2]))-Math.min(...cushion.vertices.map(p=>p[2])),112);
assert.equal(chair.parts.filter(part=>part.role==='upholstery_seam').length,2);
const table=buildFurnishingAsset('side_table',{id:'table'});
assert.equal(table.parts.find(part=>part.id==='table').assembly.children.filter(child=>child.part_id==='table-leg').length,3);
assert.equal(table.parts.find(part=>part.role==='mounting_plate').shape.parameters.holes.length,2);
const lamp=buildFurnishingAsset('pendant_light',{id:'lamp'});
assert.ok(lamp.parts.some(part=>part.role==='lamp_bulb'));
assert.ok(lamp.parts.some(part=>part.role==='suspension_cable'));
const shade=lamp.parts.find(part=>part.role==='lamp_shade').shape.parameters;
assert.ok(shade.vertices.length>=512);
assert.ok(!shade.vertices.some(([x,y])=>Math.hypot(x,y)<50),'The shade has a real open center, not a solid cone');
const plant=buildFurnishingAsset('potted_plant',{id:'plant'});
assert.equal(plant.parts.find(part=>part.id==='plant').assembly.children.filter(child=>/-leaf$/.test(child.part_id)).length,10);
for(const leaf of plant.parts.filter(part=>part.role==='leaf_blade'))assert.ok(closedOutwardMesh(leaf.shape.parameters,leaf.id)>1000,'Leaves must have real material thickness');
assert.equal(plant.parts.find(part=>part.role==='planter_bottom').shape.parameters.holes.length,1);
assert.throws(()=>buildFurnishingAsset('reading_chair',{parameters:{width:50}}),/width must/);
assert.throws(()=>buildFurnishingAsset('pendant_light',{parameters:{drop:500,shade_height:450}}),/must exceed/);
assert.throws(()=>buildFurnishingAsset('potted_plant',{parameters:{height:850,pot_height:600}}),/must exceed/);
console.log(JSON.stringify({ok:true,execution_scope:'offline_constructive_mesh_and_mock',native_geometry_verified:false,assets:reports,checked:['schema','closed outward planar bulk meshes','real cushion and leaf thickness','reused legs and leaves','lamp shade void','mount and drain holes','material declarations','full occurrence requirements','stable parametric ids']}));
