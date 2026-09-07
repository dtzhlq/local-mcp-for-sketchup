import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { resolveCurveSegments } from '../src/curve-resolution.mjs';
import { tubeMeshFromPath } from '../src/surface-operations.mjs';
import { buildDetailedScene } from '../src/detailed-modeling/scenes.mjs';

const started=performance.now();
const curveCases=[];
for(const radius of [0.2,2,20,200,2000])for(const tolerance of [0.01,0.1,1]){
  const segments=resolveCurveSegments({chord_tolerance_mm:tolerance,max_segments:4096},radius);
  const error=radius*(1-Math.cos(Math.PI/segments));assert.ok(error<=tolerance+1e-9);
  if(segments>3)assert.ok(radius*(1-Math.cos(Math.PI/(segments-1)))>tolerance-1e-9,'Tessellation must not add avoidable segments');
  const path=Array.from({length:20},(_,i)=>[i*radius*5,Math.sin(i/5)*radius,Math.cos(i/5)*radius]);
  const mesh=tubeMeshFromPath(path,radius,segments);
  assert.equal(mesh.vertices.length,path.length*segments);
  assert.equal(mesh.faces.length,2*segments*(path.length-1)+2*(segments-2));
  curveCases.push({radius_mm:radius,tolerance_mm:tolerance,segments,faces:mesh.faces.length});
}
const sceneCases=[];
for(const scene of ['kitchen','entry-facade']){
  const bundle=buildDetailedScene({scene});
  const definitions=bundle.dsl.operations.filter(operation=>operation.op==='component_definition');
  const storedLeaves=definitions.reduce((sum,definition)=>sum+definition.operations.filter(o=>o.op!=='component_instance').length,0);
  assert.ok(storedLeaves<bundle.parts_mapping.length,'Repeated parts must reuse definitions instead of storing all occurrence geometry');
  assert.ok(bundle.dsl.operations.length<100,'Each authored benchmark fits one bounded top-level build request');
  assert.ok(definitions.every(definition=>definition.operations.length<250),'No one recipe hides an unbounded batch inside its definition');
  sceneCases.push({scene,top_level_operations:bundle.dsl.operations.length,definitions:definitions.length,stored_leaf_operations:storedLeaves,leaf_occurrences:bundle.parts_mapping.length});
}
console.log(JSON.stringify({ok:true,execution_scope:'offline_constructive_geometry_budget',native_geometry_verified:false,curve_cases:curveCases,scenes:sceneCases,elapsed_ms:performance.now()-started,timing_is_sketchup_performance:false}));
