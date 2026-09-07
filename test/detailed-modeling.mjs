import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import {MockRuntime} from '../src/mock-runtime.mjs';
import {compilePartGraphToSketchUpDsl} from '../src/product-modeling/part-graph-compiler.mjs';
import {compileDetailedAssemblyRecipe} from '../src/product-modeling/parametric-recipe.mjs';
import {buildDetailedRecipe,DETAILED_RECIPE_KINDS} from '../src/detailed-modeling/recipes.mjs';
import {buildDetailedScene,recompileDetailedScene} from '../src/detailed-modeling/scenes.mjs';

const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'sketchup-detailed-modeling-test-'));
const ajv=new Ajv({strict:false,allErrors:true});
const schema=JSON.parse(await fs.readFile(new URL('../schema/part-graph.schema.json',import.meta.url),'utf8'));
const validate=ajv.compile(schema),results=[];
const read=async(p)=>JSON.parse(await fs.readFile(new URL(`../${p}`,import.meta.url),'utf8'));
function schemaPass(graph){assert.equal(validate(graph),true,JSON.stringify(validate.errors));}
function safeDefinitions(dsl){
  for(const def of dsl.operations.filter(o=>o.op==='component_definition')){
    assert.ok(def.operations.length>0);
    assert.ok(def.operations.every(o=>!/^cut_|^boolean_(difference|union|intersect)$|image_plane|component_definition/.test(o.op)),`${def.name} must contain supported constructive geometry or existing nested instances`);
    assert.equal(new Set(def.operations.map(o=>o.id||o.name)).size,def.operations.length,`${def.name} local ids must be unique`);
  }
}
async function build(name,dsl){
  // A fresh explicit temporary session per case is essential: these tests must
  // never load or overwrite the user's default .session/mock-model.json.
  const runtime=new MockRuntime({sessionPath:path.join(temporary,`${name}.json`)});
  const snapshot=await runtime.buildModel(JSON.stringify(dsl));
  const model=await runtime.readModel();
  return {snapshot,model};
}

for(const kind of DETAILED_RECIPE_KINDS){
  const compiled=compileDetailedAssemblyRecipe({id:`test-${kind}`,kind});schemaPass(compiled.partGraph);safeDefinitions(compiled.safeJsonDsl);
  const {snapshot,model}=await build(`recipe-${kind}`,compiled.safeJsonDsl);
  assert.ok(snapshot.totals.faces>20,`${kind} should contain real constructive subparts`);
  assert.ok(Object.keys(model.component_definitions).length>=1);
  results.push({case:`recipe-${kind}`,status:'pass',faces:snapshot.totals.faces,definitions:Object.keys(model.component_definitions).length});
}
const sink=buildDetailedRecipe('sink',{id:'mesh-test'});
const door=buildDetailedRecipe('door',{id:'hinge-test'});
for(const plate of door.parts.filter(part=>part.role==='hinge_plate')){
  const {origin,size}=plate.shape.parameters;
  assert.ok(origin[1]<0 && origin[1]+size[1]<=0,'Hinge plate must remain outside the stile front plane, not hidden inside the solid');
}
for(const barrel of door.parts.filter(part=>/^hinge-\d+$/.test(part.role))){
  const {start,end}=barrel.shape.parameters;
  assert.deepEqual(start.slice(0,2),[0,0],'Hinge must rotate about its own barrel axis');
  assert.deepEqual(end.slice(0,2),[0,0]);
}
const shell=sink.parts.find(p=>p.id==='mesh-test-basin-walls').shape.parameters;
const edgeCounts=new Map();for(const face of shell.faces)for(let i=0;i<face.length;i++){const edge=[face[i],face[(i+1)%face.length]].sort((a,b)=>a-b).join(':');edgeCounts.set(edge,(edgeCounts.get(edge)||0)+1);}
assert.ok([...edgeCounts.values()].every(n=>n===2),'Basin wall ring must be a closed mesh solid with every edge incident to exactly two faces');
assert.equal(sink.parts.find(p=>p.id==='mesh-test-basin-bottom').shape.parameters.holes.length,1,'Basin bottom has a real through drain, not a black painted disk');

for(const scene of ['kitchen','entry-facade']){
  const baseline=buildDetailedScene({scene}),edited=recompileDetailedScene(baseline);schemaPass(baseline.part_graph);schemaPass(edited.part_graph);
  assert.deepEqual(baseline.brief,await read(`examples/detailed-modeling/${scene}/brief.json`),'Frozen design brief must not drift silently');
  assert.deepEqual(baseline.detail_spec,await read(`examples/detailed-modeling/${scene}/detail-spec-${scene==='entry-facade'?'v7':'v6'}.json`),'The new coverage specification must match its own immutable fixture');
  const previousCoverage=await read(`examples/detailed-modeling/${scene}/detail-spec-v2.json`);
  for(const prior of previousCoverage.required_parts){
    const actual=baseline.detail_spec.required_parts.find(rule=>rule.id===prior.id&&JSON.stringify(rule.instance_path)===JSON.stringify(prior.instance_path));
    if(prior.id.endsWith('-corner-return')){
      assert.ok(actual.geometry_checks.some(check=>check.type==='profile'),'Corner layers require their actual L profile');
      assert.deepEqual({...actual,bounds_mm:prior.bounds_mm,geometry_checks:prior.geometry_checks},prior,'Corner revision preserves all other requirements');
    }else if(prior.id==='entry-eaves-soffit'){
      const strengthened=structuredClone(prior);
      strengthened.geometry_checks.find(check=>check.type==='opening').min_count++;
      assert.deepEqual(actual,strengthened,'Soffit penetration adds one real hole without removing any prior check');
    }else if(prior.id.includes('-base-bolt-')){
      assert.deepEqual(actual.bounds_mm.size,[16,8*Math.sqrt(3),7],'New specifications measure the actual six-sided bolt, not its circumscribed circle');
      assert.deepEqual({...actual,bounds_mm:prior.bounds_mm},prior,'Only the documented authoring error may change in the new specification');
    }else assert.deepEqual(actual,prior,'The pivot addition must not weaken any frozen requirement');
  }
  const priorSpecification=await read(`examples/detailed-modeling/${scene}/detail-spec.json`);
  for(const prior of priorSpecification.required_parts)assert.ok(baseline.detail_spec.required_parts.some(rule=>rule.id===prior.id&&JSON.stringify(rule.instance_path)===JSON.stringify(prior.instance_path)),'Coverage v2 must retain every previously required occurrence');
  assert.deepEqual(baseline.views,await read(`examples/detailed-modeling/${scene}/views.json`));
  assert.ok(edited.recompile_report.changed_definitions.length>0);
  assert.equal(edited.recompile_report.stable_root_ids,true);
  assert.equal(edited.recompile_report.preserved_part_ids,baseline.part_graph.parts.length);
  if(scene==='kitchen')assert.ok(edited.recompile_report.changed_definitions.every(name=>name.startsWith('PG2_kitchen-cabinet-feature')),'A single cabinet parameter edit must preserve unrelated definition bytes');
  for(const bundle of [baseline,edited]){
    safeDefinitions(bundle.dsl);
    assert.ok(bundle.parts_mapping.length>200);
    assert.equal(bundle.detail_spec.required_parts.length,bundle.parts_mapping.length);
    for(const rule of bundle.detail_spec.required_parts){assert.ok(bundle.parts_mapping.some(p=>p.part_id===rule.id && JSON.stringify(p.instance_path)===JSON.stringify(rule.instance_path)));assert.ok(rule.geometry_checks.length || rule.bounds_mm || rule.min_faces>6);assert.equal(rule.require_visible,true);}
    const {snapshot,model}=await build(`${scene}-${bundle.variant}`,bundle.dsl);
    assert.ok(snapshot.totals.faces>5000);
    assert.ok(model.instances.length>=8);
    assert.ok(Object.values(model.component_definitions).some(d=>d.instances.length>1),'Scenes must use actual nested component instances');
    results.push({case:`scene-${scene}-${bundle.variant}`,status:'pass',faces:snapshot.totals.faces,definitions:Object.keys(model.component_definitions).length,root_instances:model.instances.length,leaf_occurrences:bundle.parts_mapping.length,required_parts:bundle.detail_spec.required_parts.length,changed_definitions:bundle.recompile_report?.changed_definitions||[]});
  }
}

// Version 1 parent is still descriptive. It must never start grouping legacy
// parts into new definitions simply because a parent string is present.
const v1={version:1,id:'legacy',profile_id:'legacy',units:'mm',product:{type:'test',name:'legacy'},parts:[
  {id:'a',name:'a',shape:{primitive:'box',parameters:{origin:[0,0,0],size:[10,10,10]}}},
  {id:'b',name:'b',parent:'a',shape:{primitive:'box',parameters:{origin:[20,0,0],size:[10,10,10]}}}
]};
assert.deepEqual(compilePartGraphToSketchUpDsl(v1,{}).operations.map(o=>o.op),['reset','box','box']);
for(const [graphFile,profileFile,expectedFile] of [
  ['examples/part-graphs/ambulance-reference.part-graph.json','examples/product-profiles/vehicle_ambulance.json','examples/acceptance-ambulance-reference.json'],
  ['examples/part-graphs/switch-controller-reference.part-graph.json','examples/product-profiles/game_controller_switch.json','examples/acceptance-switch-controller.json'],
  ['examples/part-graphs/fuji-camera-reference.part-graph.json','examples/product-profiles/camera_fuji_x_t10.json','examples/acceptance-fuji-camera.json']
]){
  const compiled=compilePartGraphToSketchUpDsl(await read(graphFile),await read(profileFile));
  assert.deepEqual(compiled.operations,(await read(expectedFile)).operations,`${graphFile} v1 output must remain unchanged`);
}
const base=compileDetailedAssemblyRecipe({id:'guards',kind:'cabinet'}).partGraph;
const cyclic=structuredClone(base);cyclic.parts.find(p=>p.id==='guards').assembly.children.push({part_id:'guards'});
assert.throws(()=>compilePartGraphToSketchUpDsl(cyclic,{}),/Cyclic/);
const missing=structuredClone(base);missing.roots[0].part_id='absent';assert.throws(()=>compilePartGraphToSketchUpDsl(missing,{}),/Unknown assembly/);
const duplicate=structuredClone(base);duplicate.roots.push({...duplicate.roots[0]});assert.throws(()=>compilePartGraphToSketchUpDsl(duplicate,{}),/Duplicate assembly root/);
const cut=structuredClone(base);cut.parts.find(p=>p.shape).feature_intents=[{operation:'cut_hole',face:'top',parameters:{radius:2}}];assert.throws(()=>compilePartGraphToSketchUpDsl(cut,{}),/editing feature_intents/);
assert.throws(()=>buildDetailedScene({detailLevel:'coarse'}),/requires detailed/);
assert.throws(()=>buildDetailedRecipe('unknown'),/Unknown detailed recipe/);
assert.throws(()=>buildDetailedRecipe('window',{parameters:{width:100}}),/window.width/);
results.push({case:'v1-compatibility-and-invalid-v2-guards',status:'pass'});
const report={version:1,ok:true,execution_scope:'offline_mock_and_constructive_mesh_checks',live_geometry_verified:false,temporary_session_root:temporary,cases:results};
const reportArg=process.argv.indexOf('--report');if(reportArg>=0)await fs.writeFile(process.argv[reportArg+1],JSON.stringify(report,null,2)+'\n',{flag:'wx'});
process.stdout.write(JSON.stringify(report,null,2)+'\n');
