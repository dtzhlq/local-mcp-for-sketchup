#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('..',import.meta.url));
const root=path.join(repo,'output/detail-modeling-implementation-2026-09-06');
const labels=process.argv.slice(2);
if(!labels.length||labels.some(label=>!/^matrix-[a-z-]+$/.test(label)))throw new Error('Explicit matrix sample labels are required');
if(labels.length!==1)throw new Error('Run exactly one sample per SketchUp session. Save and verify its evidence, then close its model window and quit SketchUp before starting the next sample. Multi-model batches are disabled to prevent retained native windows exhausting memory.');
const runDir=await fs.mkdtemp(path.join(root,'sample-batch-'));
const records=[];
for(const label of labels){
  const input=path.join(root,'prepared-inputs-v3',`${label}-bundle.json`);
  await fs.access(input);
  const stages=[['init',label],['reset-test',label],['create-from-bundle',label,input],['save',label,'batch-built']];
  for(const [index,args] of stages.entries()){
    const started=Date.now();
    const result=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[path.join(repo,'scripts/run-detail-modeling-live.mjs'),...args],{cwd:repo,stdio:['ignore','pipe','pipe']});
      let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
    });
    const record={label,action:args[0],elapsed_ms:Date.now()-started,...result};records.push(record);
    await fs.writeFile(path.join(runDir,`${label}-${index}.json`),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({label,action:args[0],exit_code:result.code,elapsed_ms:record.elapsed_ms,result:result.stdout.trim()}));
    if(result.code!==0)throw new Error(`Stopped at ${label}/${args[0]}; inspect ${runDir}. No cleanup or replay was attempted.`);
  }
}
await fs.writeFile(path.join(runDir,'execution-records.json'),JSON.stringify(records,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({batch_execution_finished:true,run_directory:runDir,quality_acceptance:'read_each_task_result_and_inspect_native_images'}));
