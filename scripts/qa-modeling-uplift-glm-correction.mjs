import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';
const original='/Users/07zhang/Library/CloudStorage/OneDrive-个人/work/项目/sketchup-mcp-replica';
const {requestAlmaMessage}=await import(pathToFileURL(path.join(original,'scripts/model-accessibility/alma-provider.mjs')));
const config=JSON.parse(await fs.readFile(path.join(original,'output/model-accessibility-live-2026-09-08/glm-provider.json'),'utf8'));
const old=JSON.parse(await fs.readFile('output/modeling-uplift/glm/readback-uplift.json'));
const output='output/modeling-uplift/qa-scope/glm-correction.json';
try{await fs.access(output);throw new Error('Existing correction evidence; do not replay');}catch(e){if(e.code!=='ENOENT')throw e;}
const prompt=old.prompt+'\nTask: Create a new 60 by 40 mm horizontal face named GLM_QAFix at x=1200..1260,y=200..240,z=0. Split it at x=1230, read the real new faces, and pushpull only the right half upward 25 mm. Preserve all existing objects. This is a translated fresh test copy to avoid colliding with the prior test.';
const prior=JSON.stringify(old.attempts[0].parsed);
const response=await requestAlmaMessage({...config,timeoutMs:120000,body:{model:config.model,messages:[{role:'user',content:prompt},{role:'assistant',content:prior},{role:'user',content:'The prior stage 2 references an undefined variable contexts. Only snapshot, previous, parameters and stage are supplied bindings. Correct the complete three-stage program once and use the fresh name/coordinates in this task. Return JSON only.'}],max_tokens:2500,stream:false}});
const text=response.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');const parsed=JSON.parse(text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));await fs.writeFile(output,JSON.stringify({prompt,response,parsed,correction_count:1,source:'GLM response without manual code edits'},null,2));console.log(JSON.stringify({ok:true,stages:parsed.stages.length,usage:response.usage}));
