import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {compileDetailedAssemblyRecipe} from '../src/product-modeling/parametric-recipe.mjs';
import {TIMBER_RECIPE_KINDS,resolveTimberParameters} from '../src/traditional-timber/recipes.mjs';
import {compileVersionedAssemblyRebuild} from '../src/detailed-modeling/assembly-edit.mjs';
import {MockRuntime} from '../src/mock-runtime.mjs';

const temp=await fs.mkdtemp(path.join(os.tmpdir(),'timber-'));
try{
  assert.throws(()=>resolveTimberParameters({fen_mm:0}),/fen_mm/);
  const base=compileDetailedAssemblyRecipe({kind:'timber_column_head',id:'node'});
  const next=compileDetailedAssemblyRecipe({kind:'timber_column_head',id:'node',parameters:{fen_mm:12}});
  // Independent constants from the limited source-backed dimension table.
  assert.deepEqual([base.measurements.dou_width_mm,base.measurements.nidao_length_mm,base.measurements.huagong_length_mm],[320,620,720]);
  assert.deepEqual([next.measurements.dou_width_mm,next.measurements.nidao_length_mm,next.measurements.huagong_length_mm],[384,744,864]);
  assert.ok(base.safeJsonDsl.operations.every(o=>o.op!=='reset'));
  const edit=compileVersionedAssemblyRebuild({previousDsl:base.safeJsonDsl,nextDsl:next.safeJsonDsl,selections:[{logical_definition:'PG2_node',target:{target_id:'id-node'}}],scope:'single',taskId:`task_${'a'.repeat(32)}`});
  assert.equal(edit.operations.length,1);assert.equal(edit.operations[0].target_id,'id-node');
  assert.notEqual(edit.operations[0].definition,'PG2_node');
  // One bounded build per stage catches malformed constructive output. This is
  // compiler/mock coverage, deliberately not a native-geometry acceptance claim.
  for(const kind of TIMBER_RECIPE_KINDS){
    const b=compileDetailedAssemblyRecipe({kind,id:'test'}),runtime=new MockRuntime({sessionPath:path.join(temp,`${kind}.json`)});
    const s=await runtime.buildModel(JSON.stringify(b.safeJsonDsl));
    assert.ok(s.totals.faces>0);console.log(`${kind}: ${b.partGraph.parts.length} parts; mock compilation passed`);
  }
  console.log('Unit conversion, source dimensions, zero rejection and single-target replacement compilation passed. Native validation is separate.');
}finally{await fs.rm(temp,{recursive:true,force:true});}
