import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const [bundleArg, reportArg] = process.argv.slice(2);
assert.equal(process.platform,'win32'); assert.equal(process.arch,'x64');
const bundle=path.resolve(bundleArg), app=path.join(bundle,'app');
const meta=JSON.parse(await fs.readFile(path.join(bundle,'bundle.json'),'utf8'));
assert.equal(meta.target,'win32-x64');
assert.equal(path.resolve(process.execPath).toLowerCase(),path.join(bundle,'node','node.exe').toLowerCase());
const {PRODUCT_VERSION}=await import(pathToFileURL(path.join(app,'src/version.mjs')));
assert.equal(PRODUCT_VERSION,meta.version);
const protocol=await new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[path.join(app,'src/mcp-server.mjs')],{cwd:bundle,env:{...process.env,NODE_PATH:'',ALMA_SKETCHUP_AGENT_ALLOWED_RUNTIMES:'mock',ALMA_SKETCHUP_AGENT_ALLOW_QUEUE_MUTATION:'0'},stdio:['pipe','pipe','pipe']});
 let buf='',err='',server;
 const timer=setTimeout(()=>{child.kill();reject(Error('MCP timeout: '+err.slice(-1000)));},20000);
 const fail=e=>{clearTimeout(timer);child.kill();reject(e);};
 child.on('error',fail);child.stderr.on('data',d=>err+=d);
 child.stdout.on('data',d=>{try{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+1);if(!line.trim())continue;const m=JSON.parse(line);if(m.error)throw Error(JSON.stringify(m.error));if(m.id===1){server=m.result.serverInfo;assert.equal(server.version,meta.version);child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})+'\n');}if(m.id===2){assert.equal(m.result.tools.length,44);assert.ok(m.result.tools.some(t=>t.name==='start_agent_task'));clearTimeout(timer);child.stdin.end();resolve({server,tool_count:m.result.tools.length});}}}catch(e){fail(e);}});
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'windows-installed-check',version:'1'}}})+'\n');
});
// The focused six-scenario test runs against installed src and native sharp, never the source checkout.
await fs.mkdir(path.join(app,'test'),{recursive:true});
await fs.copyFile(new URL('../test/image-structure.mjs',import.meta.url),path.join(app,'test/image-structure.mjs'));
const scenarios=await new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[path.join(app,'test/image-structure.mjs')],{cwd:app,stdio:['ignore','pipe','pipe']});let out='',err='';
 const timer=setTimeout(()=>{child.kill();reject(Error('Focused test timeout'));},120000);
 child.on('error',e=>{clearTimeout(timer);reject(e);});child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
 child.on('exit',code=>{clearTimeout(timer);if(code!==0)return reject(Error(err+'\n'+out));try{resolve(JSON.parse(out.trim().split('\n').at(-1)));}catch(e){reject(e);}});
});
const report={schema_version:'windows-installed-check.v1',passed:true,platform:process.platform,arch:process.arch,node:process.version,product_version:meta.version,installed_bundled_node:true,unicode_space_path:true,mcp:protocol,image_scenarios:scenarios.scenarios,live_sketchup_verified:false,release_acceptance:false,scope:'Windows server installation, native dependencies and offline image integration; SketchUp application unavailable on CI runner.'};
await fs.writeFile(reportArg,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
