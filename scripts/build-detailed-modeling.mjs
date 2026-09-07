#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {buildDetailedScene,buildDetailedRecipeSample,recompileDetailedScene,DETAILED_SCENES} from '../src/detailed-modeling/scenes.mjs';

const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++){
  const key=args[i];if(key==='--all')options.all=true;
  else if(['--scene','--variant','--output-dir','--recipe'].includes(key))options[key.slice(2)]=args[++i];
  else throw new Error(`Unknown option: ${key}`);
}
if(!options['output-dir'])throw new Error('--output-dir is required; use a new directory to preserve prior captures and reviews');
const output=path.resolve(options['output-dir']);await fs.mkdir(output,{recursive:true});
const write=async(dir,name,value)=>fs.writeFile(path.join(dir,name),`${JSON.stringify(value,null,2)}\n`,{flag:'wx'});
if(options.recipe){
  const bundle=buildDetailedRecipeSample({kind:options.recipe});
  for(const [name,value] of Object.entries({'scene.dsl.json':bundle.dsl,'part-graph.json':bundle.part_graph,'profile.json':bundle.profile,'detail-spec.json':bundle.detail_spec,'parts-mapping.json':bundle.parts_mapping,'views.json':bundle.views,'brief.json':bundle.brief}))await write(output,name,value);
  process.stdout.write(JSON.stringify({output,recipe:options.recipe,parts:bundle.part_graph.parts.length,validation_scope:'compilation_only',live_verified:false},null,2)+'\n');
}else{
  const scenes=options.all?DETAILED_SCENES:[options.scene||'kitchen'];const written=[];
  for(const scene of scenes){
    const baseline=buildDetailedScene({scene});
    const bundle=options.variant==='edited'?recompileDetailedScene(baseline):baseline;
    const dir=scenes.length===1?output:path.join(output,scene);await fs.mkdir(dir,{recursive:true});
    for(const [filename,value] of Object.entries({'scene.dsl.json':bundle.dsl,'part-graph.json':bundle.part_graph,'profile.json':bundle.profile,'detail-spec.json':bundle.detail_spec,'views.json':bundle.views,'parts-mapping.json':bundle.parts_mapping,'brief.json':bundle.brief,'recipes.json':bundle.recipes,'parameter-changes.json':bundle.parameter_changes}))await write(dir,filename,value);
    if(bundle.recompile_report)await write(dir,'recompile-report.json',bundle.recompile_report);
    written.push({scene,variant:bundle.variant,output:dir,parts:bundle.part_graph.parts.length,leaf_occurrences:bundle.parts_mapping.length,required_parts:bundle.detail_spec.required_parts.length});
  }
  process.stdout.write(JSON.stringify({written,validation_scope:'compilation_only',live_verified:false},null,2)+'\n');
}
