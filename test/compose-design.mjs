import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildDetailedScene } from '../src/detailed-modeling/scenes.mjs';
import { composeDesign, saveComposedDesign, bindRecipeVoidsToInstances } from '../src/detailed-modeling/compose-design.mjs';
import { freezeDetailSpecification } from '../src/detail-quality.mjs';
import { buildDetailedRecipe } from '../src/detailed-modeling/recipes.mjs';
import { MockRuntime } from '../src/mock-runtime.mjs';

const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'sketchup-composed-design-'));
const plans=[['kitchen','kitchen-living-plan.json'],['entry-facade','entry-court-plan.json']];
const reports=[];let kitchen,plan,composition;
for(const [scene,file] of plans){
  const base=buildDetailedScene({scene}),sourcePlan=JSON.parse(await fs.readFile(new URL(`../examples/detailed-modeling/agent-compositions/${file}`,import.meta.url),'utf8'));
  const baseBefore=JSON.stringify(base),planBefore=JSON.stringify(sourcePlan);
  const bundle=composeDesign(base,sourcePlan);
  assert.equal(JSON.stringify(base),baseBefore,'Composition must not change the frozen base bundle');
  assert.equal(JSON.stringify(sourcePlan),planBefore,'Composition must preserve the agent decision input');
  assert.deepEqual(bundle.part_graph.parts.slice(0,base.part_graph.parts.length),base.part_graph.parts);
  assert.deepEqual(bundle.part_graph.roots.slice(0,base.part_graph.roots.length),base.part_graph.roots);
  assert.equal(bundle.views[0].id,sourcePlan.views[0].id);
  assert.ok(base.views.filter(view=>view.kind==='closeup').every(view=>bundle.views.some(candidate=>candidate.id===view.id)),'All baseline closeups must survive the new overview');
  assert.equal(bundle.detail_spec.required_parts.length,bundle.parts_mapping.length);
  assert.deepEqual(bundle.composition_plan,sourcePlan);
  assert.deepEqual(bundle.brief.design_decisions,sourcePlan.brief.decisions);
  assert.equal(bundle.profile.materials.filter(material=>material.name==='Detail_Fabric').length,1);
  for(const addition of sourcePlan.additions){const roots=bundle.part_graph.roots.filter(root=>root.part_id===addition.id);assert.equal(roots.length,addition.instances.length);assert.deepEqual(roots.map(root=>root.origin),addition.instances.map(instance=>instance.origin));}
  for(const part of sourcePlan.explicit_parts){const compiled=bundle.part_graph.parts.find(candidate=>candidate.id===part.id);assert.deepEqual(compiled.shape,part.shape,'Explicit shape parameters must be compiled from the supplied plan');}
  const snapshot=await new MockRuntime({sessionPath:path.join(temporary,`${scene}.json`)}).buildModel(JSON.stringify(bundle.dsl));
  assert.equal(snapshot.totals.groups,0);assert.equal(snapshot.totals.instances,bundle.part_graph.roots.length);
  reports.push({scene,added_parts:bundle.composition_report.added_part_count,root_instances:snapshot.totals.instances,leaf_occurrences:bundle.parts_mapping.length,faces:snapshot.totals.faces,views:bundle.views.length});
  if(scene==='kitchen'){kitchen=base;plan=sourcePlan;composition=bundle;}
}
const wider=structuredClone(plan);wider.additions.find(addition=>addition.asset_kind==='reading_chair').parameters.width=840;
const variant=composeDesign(kitchen,wider);
assert.deepEqual(variant.part_graph.parts.map(part=>part.id),composition.part_graph.parts.map(part=>part.id));
assert.notDeepEqual(variant.part_graph.parts.find(part=>part.role==='seat_cushion').shape,composition.part_graph.parts.find(part=>part.role==='seat_cushion').shape,'Agent-supplied furniture parameters must change actual geometry');
const texturedBase=structuredClone(kitchen);texturedBase.profile.materials.find(material=>material.name==='Detail_Oak').texture={path:'local/project-oak.png',width:800,height:800};
assert.deepEqual(composeDesign(texturedBase,plan).profile.materials.find(material=>material.name==='Detail_Oak').texture,{path:'local/project-oak.png',width:800,height:800},'Recipe default palettes must preserve the base material mapping');
const localVoid={id:'source-clearance',instance_path:['fixture-root','fixture-child'],search_scope:'assembly',bounds_mm:{min:[1,2,3],max:[30,40,50]},boundary_checks:[{side:'max_z',offset_mm:2}]};
const sourceVoids=[localVoid],voidsBefore=JSON.stringify(sourceVoids);
const boundVoids=bindRecipeVoidsToInstances(sourceVoids,'fixture-root',[{instance_id:'placed-a',origin:[300,0,0]},{instance_id:'placed-b',origin:[800,200,0],transform:{rotateZ:90}}]);
assert.deepEqual(boundVoids.map(rule=>rule.id),['placed-a:source-clearance','placed-b:source-clearance']);
assert.deepEqual(boundVoids.map(rule=>rule.instance_path),[['placed-a','fixture-child'],['placed-b','fixture-child']]);
assert.deepEqual(boundVoids[1].bounds_mm,localVoid.bounds_mm,'Bounds remain in anchor local coordinates; native context applies root rotation and translation');
assert.equal(JSON.stringify(sourceVoids),voidsBefore);
assert.throws(()=>bindRecipeVoidsToInstances([{...localVoid,instance_path:['wrong-root']}],'fixture-root',[]),/anchored/);
assert.throws(()=>bindRecipeVoidsToInstances([localVoid,localVoid],'fixture-root',[]),/Duplicate recipe/);
const voidBase=structuredClone(kitchen),baseVoid={...structuredClone(localVoid),id:'base-region',instance_path:[kitchen.part_graph.roots[0].instance_id]};
voidBase.detail_spec.required_voids=[...(voidBase.detail_spec.required_voids||[]),baseVoid];
const voidPlan=structuredClone(plan);voidPlan.required_voids=[{...structuredClone(localVoid),id:'planned-region',instance_path:[plan.additions[0].instances[0].id]}];
const voidComposition=composeDesign(voidBase,voidPlan);
assert.deepEqual(voidComposition.detail_spec.required_voids.slice(0,voidBase.detail_spec.required_voids.length),voidBase.detail_spec.required_voids,'Base void requirements must be preserved without replacement');
assert.deepEqual(voidComposition.detail_spec.required_voids.at(-1),voidPlan.required_voids[0]);
const frozenVoidSpec=freezeDetailSpecification(voidComposition.detail_spec);
for(const mutate of [spec=>{spec.required_voids.pop();},spec=>{spec.required_voids.at(-1).bounds_mm.max[0]+=1;},spec=>{spec.required_voids.at(-1).instance_path=[];},spec=>{spec.required_voids.at(-1).search_scope='scene';},spec=>{spec.required_voids.at(-1).boundary_checks=[];}]){
  const edited=structuredClone(voidComposition.detail_spec);mutate(edited);assert.throws(()=>freezeDetailSpecification(edited,frozenVoidSpec),/frozen/);
}
for(const mutate of [value=>{value.required_voids.push(baseVoid);},value=>{value.required_voids.push(value.required_voids[0]);},value=>{value.required_voids[0].bounds_mm.max[0]=0;},value=>{value.required_voids[0].exclude_instance_paths=[];},value=>{value.required_voids[0].instance_path=['absent-root'];},value=>{value.required_voids[0].boundary_checks=[{side:'min_z',offset_mm:0}];}]){
  const invalid=structuredClone(voidPlan);mutate(invalid);assert.throws(()=>composeDesign(voidBase,invalid),/unique|bounds|exclusion|unknown occurrence|boundaries/i);
}
voidPlan.required_voids[0].bounds_mm.min[0]=999;
assert.equal(frozenVoidSpec.specification.required_voids.at(-1).bounds_mm.min[0],1,'Later plan mutation must not change the frozen field values');
const repeatedPlan=structuredClone(plan);repeatedPlan.additions.push({family:'sink',id:'added-sink',instances:[{id:'added-sink-a',origin:[8000,0,0]},{id:'added-sink-b',origin:[9000,0,0],transform:{mirror:'x',rotateZ:90}}]});
const repeatedRecipe=buildDetailedRecipe('sink',{id:'added-sink'}),repeatedComposition=composeDesign(kitchen,repeatedPlan);
assert.ok(repeatedRecipe.required_voids.length>0,'Actual recipe must declare authored voids for this binding test');
for(const instance of repeatedPlan.additions.at(-1).instances)for(const source of repeatedRecipe.required_voids){
  const bound=repeatedComposition.detail_spec.required_voids.find(rule=>rule.id===`${instance.id}:${source.id}`);
  assert.deepEqual(bound,{...source,id:`${instance.id}:${source.id}`,instance_path:[instance.id,...source.instance_path.slice(1)]},'Each actual repeated recipe must retain its independent local void requirements, including mirrored instances');
}
const unmirroredPlan=structuredClone(repeatedPlan);delete unmirroredPlan.additions.at(-1).instances[1].transform.mirror;
const unmirrored=composeDesign(kitchen,unmirroredPlan);
assert.deepEqual(repeatedComposition.parts_mapping,unmirrored.parts_mapping,'Reflection must not rename or exchange logical leaf instance paths');
assert.deepEqual(repeatedComposition.detail_spec.required_voids,unmirrored.detail_spec.required_voids,'Reflection is handled by native anchor transforms, not by rewriting local void bounds');
assert.deepEqual(repeatedComposition.dsl.operations.find(operation=>operation.id==='added-sink-b').transform,{mirror:['x'],rotateZ:90});
assert.ok(!repeatedComposition.dsl.operations.some(operation=>operation.op==='transform_object'),'Mirror remains constructive component placement, not a scope-bypassing edit');
const duplicateRecipeVoid=structuredClone(repeatedPlan);duplicateRecipeVoid.required_voids=[repeatedComposition.detail_spec.required_voids.find(rule=>rule.id.startsWith('added-sink-b:'))];
assert.throws(()=>composeDesign(kitchen,duplicateRecipeVoid),/unique/);
const collision=structuredClone(plan);collision.additions[0].instances[0].id=kitchen.part_graph.roots[0].instance_id;
assert.throws(()=>composeDesign(kitchen,collision),/root id already exists/);
const duplicate=structuredClone(plan);duplicate.additions[0].id=kitchen.part_graph.parts.at(-1).id;
assert.throws(()=>composeDesign(kitchen,duplicate),/part id already exists/);
const noPlacement=structuredClone(plan);delete noPlacement.additions[0].instances;
assert.throws(()=>composeDesign(kitchen,noPlacement),/instances must explicitly place/);
const noViews=structuredClone(plan);noViews.views=[];
assert.throws(()=>composeDesign(kitchen,noViews),/views must explicitly/);
const badMaterial=structuredClone(plan);badMaterial.explicit_parts[0].material='Undeclared_Finish';
assert.throws(()=>composeDesign(kitchen,badMaterial),/declared material/);
const conflicting=structuredClone(plan);conflicting.materials=[{name:'Detail_Oak',color:'#010203'}];
assert.throws(()=>composeDesign(kitchen,conflicting),/Conflicting material declaration/);
const invalidTransform=structuredClone(plan);invalidTransform.additions[0].instances[0].transform={scale:[0,0,0]};
assert.throws(()=>composeDesign(kitchen,invalidTransform),/supports translate, rotateZ and mirror/);
for(const mirror of [{axis:'x'},['x','x'],'other']){const invalid=structuredClone(plan);invalid.additions[0].instances[0].transform={mirror};assert.throws(()=>composeDesign(kitchen,invalid),/distinct/);}
const attemptedCut=structuredClone(plan);attemptedCut.explicit_parts[0].shape={primitive:'cut_hole',parameters:{target_id:kitchen.part_graph.parts[0].id,radius:10}};
assert.throws(()=>composeDesign(kitchen,attemptedCut),/unsupported|does not support|Unknown|primitive/i);
assert.throws(()=>composeDesign({dsl:kitchen.dsl},plan),/PartGraph v2 baseBundle/);
const output=path.join(temporary,'reviewable-composition');await saveComposedDesign(composition,output);
assert.deepEqual(JSON.parse(await fs.readFile(path.join(output,'composition-plan.json'),'utf8')),plan);
assert.deepEqual(JSON.parse(await fs.readFile(path.join(output,'brief.json'),'utf8')),composition.brief);
await assert.rejects(()=>saveComposedDesign(composition,output),/EEXIST/);
console.log(JSON.stringify({ok:true,execution_scope:'offline_plan_compilation_and_mock',live_runtime_executed:false,cases:reports,checked:['agent-authored plans','actual parameter geometry','shared definitions and placements','explicit graph shapes','base closeup preservation','material declaration merge','input immutability','collision and unsupported edits reject','create-new review bundle']}));
