#!/usr/bin/env node
// Bounded parameter-generation comparison. Does not execute model output itself.
// Native execution of accepted new programs is a separate, recorded QA phase.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {compileModelProgramSource} from '../src/expert-compiler.mjs';
import {SketchUpBridge} from '../src/bridge.mjs';
const original='/Users/07zhang/Library/CloudStorage/OneDrive-个人/work/项目/sketchup-mcp-replica';
const {requestAlmaMessage}=await import(pathToFileURL(path.join(original,'scripts/model-accessibility/alma-provider.mjs')));
const config=JSON.parse(await fs.readFile(path.join(original,'output/model-accessibility-live-2026-09-08/glm-provider.json'),'utf8'));
const out=path.resolve('output/modeling-uplift/glm');await fs.mkdir(out,{recursive:true});
const tasks=[
 {id:'generation',request:'Create a capped rectangular-section beam (20 by 12 mm) along the 3D polyline [[0,700,0],[0,700,80],[35,725,130]]. Name the new object GLM_Generation. Preserve existing objects.'},
 {id:'local-edit',request:'Find the existing root loose solid at x=810..830 mm, y=0..20 mm. Move only its top vertices upward 5 mm. Preserve all other geometry. Do not recreate or replace the solid.'},
 {id:'readback',request:'Create a 60 by 40 mm horizontal face at x=1000..1060,y=200..240,z=0 named GLM_Readback. Split it at x=1030. Read the actual resulting faces, then pushpull only the right half upward 25 mm. Keep the left half at z=0.'}
];
const oldDocs=execFileSync('git',['show','1d27e9c8:src/capabilities.mjs'],{encoding:'utf8'});
const operationNames=[...oldDocs.matchAll(/op: '([^']+)'/g)].map(m=>m[1]);
const {SketchUpBridge:BaselineBridge}=await import(pathToFileURL(path.join(out,'baseline/src/bridge.mjs')));
const summaries=[];
for(const task of tasks)for(const version of ['baseline','uplift']){
 const file=path.join(out,task.id+'-'+version+'.json');try{const existing=JSON.parse(await fs.readFile(file));summaries.push(existing.summary);continue;}catch(e){if(e.code!=='ENOENT')throw e;}
 const prompt=version==='uplift'?`Return JSON only: {"stages":[{"kind":"create" or "edit","language":"expert","code":"..."}]}. Up to 3 sequential stages. Expert code is bounded JS with arrays/find/filter/map/loops and Math. Each stage receives fresh snapshot.contexts [{entity_path,name,vertices:[{handle,position,world_position}],faces:[{handle,normal,loops:[{outer,vertices:handle[]}]}],edges}], previous, parameters. A create stage's final expression is {operations:[DSL operations],result:JSON}. An edit stage's final expression is {entity_path:context.entity_path,edits:[typed edits],result:JSON}. Next stage gets native readback and previous=result. Allowed edit operations: move_vertices {moves:[{handle,delta:[x,y,z]}],coordinate_space:'world'}, add_edges {points:[[x,y,z],...]}, pushpull_face {handle,distance}. DSL mesh {op:'mesh',name,vertices:[[x,y,z],...],faces:[[vertexIndices]]}; sweep_profile {op:'sweep_profile',name,profile:[[x,y],...],path:[[x,y,z],...],initial_up:[x,y,z]}. Create coordinates mm. Scope may include context entity_path='model' for root loose geometry. Do not claim output already executed.`:`Return JSON only: {"code":"restricted Expert JS producing a DSL operations array or {version:1,units:'mm',operations:[]} as its final expression"}. This is published v0.2.0 compile_expert -> build_model. Arrays, loops, Math supported; no access to a live model or later native readback within code. DSL mesh {op:'mesh',name,vertices:[[x,y,z],...],faces:[[vertexIndices]]}. Existing operations: ${operationNames.join(',')}. If the requested existing-topology access is unavailable, return {"unsupported":"reason"}. Do not invent tools or recreate objects when asked to edit.`;
 let record={task:task.request,version,request_model:config.model,prompt,attempts:[]},messages=[{role:'user',content:prompt+'\nTask: '+task.request}];
 for(let attempt=0;attempt<(version==='uplift'?2:1);attempt++){
  let response;try{response=await requestAlmaMessage({...config,timeoutMs:120000,body:{model:config.model,messages,max_tokens:2500,stream:false}});}catch(e){record.transport_error={code:e.code,message:e.message,details:e.details};break;}
  const text=response.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');let parsed,error;
  try{parsed=JSON.parse(text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));if(!parsed.unsupported){if(version==='uplift'){if(!Array.isArray(parsed.stages)||parsed.stages.length>3||!parsed.stages.length)throw new Error('1..3 stages required');for(const s of parsed.stages){if(!['create','edit'].includes(s.kind)||typeof s.code!=='string')throw new Error('Invalid stage');}}else {const b=new BaselineBridge({mock:{sessionPath:path.join(out,'baseline-model.json')}});const compiled=await b.compile_expert({code:parsed.code});await b.build_model({code:compiled.code});}}}catch(e){error=e.message;}
  record.attempts.push({response,parsed,error:error??null});
  if(!error||attempt===1||version==='baseline')break;
  messages.push({role:'assistant',content:text},{role:'user',content:'The response failed validation: '+error+'. Correct it once; return JSON only.'});
 }
 const last=record.attempts.at(-1)??{};record.summary={task:task.id,version,requests:record.attempts.length,corrections:record.attempts.length-1,parameter_result:record.transport_error?'transport_unknown':last.error?'invalid':last.parsed?.unsupported?'unsupported':'accepted',native_executed:false,usage:record.attempts.map(a=>a.response.usage),served_model_verified:false};
 await fs.writeFile(file,JSON.stringify(record,null,2));summaries.push(record.summary);console.log(JSON.stringify(record.summary));
}
await fs.writeFile(path.join(out,'summary.json'),JSON.stringify({kind:'bounded_parameter_comparison',model:config.model,not_end_to_end_success_rate:true,results:summaries},null,2));
