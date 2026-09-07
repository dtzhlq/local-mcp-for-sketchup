import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const repository = fileURLToPath(new URL('..', import.meta.url));
const tests = [
  ...['creation-scope', 'creation-scope-runtime', 'detail-quality', 'detail-quality-gateway', 'detail-quality-workflow-contract', 'detail-quality-coverage', 'detail-context-regions', 'detail-collision-review', 'detail-resource-budget', 'detail-recipe-regions',
    'detailed-modeling', 'detail-sample-matrix', 'curve-resolution', 'surface-wall-geometry', 'wall-layer-junction', 'hollow-downpipe-shoe', 'component-instance-mirror', 'native-appearance-operations', 'import-preserve-root',
    'asset-catalog', 'native-mesh-construction', 'detail-geometry-budget', 'furnishing-assets', 'compose-design', 'recompile-detailed-bundle', 'assembly-parameter-edit', 'scoped-assembly-edit',
    'detail-assembly-live-runner', 'inspect-created-detail', 'claim-live-submission', 'texture-transform-contract', 'appearance-presets', 'detail-appearance-live-runner'].map(name => ({ id: name, command: process.execPath, file: `test/${name}.mjs`, category: 'new_node' })),
  ...['detail_capture_test', 'detail_geometry_evidence_test', 'native_appearance_test', 'build_runtime_profile_test', 'native_texture_mapping_test', 'panel_edge_opening_test', 'panel_face_replacement_test', 'revision_snapshot_cost_test', 'scoped_recursive_index_test', 'detail_region_coordinates_test', 'detail_pair_separation_test', 'native_geometry_resources_test', 'constructive_identity_test'].map(name => ({ id: name, command: 'ruby', file: `test/ruby/${name}.rb`, category: 'new_ruby' })),
  ...['mock-validation', 'operation-contract', 'part-graph-compiler', 'agent-gateway', 'mcp-server', 'nested-entity-edit'].map(name => ({ id: name, command: process.execPath, file: `test/${name}.mjs`, category: 'existing_node_regression' })),
  ...['document_state_test', 'component_definition_replacement_test', 'boolean_postcondition_test', 'queue_atomicity_test', 'model_revision_merkle_test', 'model_revision_canonical_equivalence_test'].map(name => ({ id: name, command: 'ruby', file: `test/ruby/${name}.rb`, category: 'existing_ruby_regression' }))
];
if (process.argv.includes('--list')) { console.log(JSON.stringify(tests, null, 2)); process.exit(0); }
let requestedOutput;
for(let i=2;i<process.argv.length;i++){
  if(process.argv[i]==='--output-dir' && process.argv[i+1])requestedOutput=path.resolve(process.argv[++i]);
  else throw new Error(`Unknown or incomplete argument: ${process.argv[i]}`);
}
const outputBase=path.join(repository,'output');
await fs.mkdir(outputBase,{recursive:true});
const directory=requestedOutput || await fs.mkdtemp(path.join(outputBase,`detail-modeling-offline-${new Date().toISOString().replace(/[:.]/g,'-')}-`));
if(requestedOutput)await fs.mkdir(directory,{recursive:false});
const readOnlyEntries=['src','scripts','test','examples','schema','docs','projects','sketchup_plugin','bin','node_modules','package.json','package-lock.json'];
const hashFiles = async (roots,{includeAll=false}={}) => {
  const result={};
  const visit=async(relative)=>{
    const absolute=path.join(repository,relative),stat=await fs.stat(absolute);
    if(stat.isDirectory()){for(const name of (await fs.readdir(absolute)).sort())await visit(path.join(relative,name));}
    else if(includeAll||/\.(mjs|rb|json)$/.test(relative))result[relative]=crypto.createHash('sha256').update(await fs.readFile(absolute)).digest('hex');
  };
  for(const root of roots)await visit(root);
  return result;
};
const trackedRoots=['src','sketchup_plugin','examples/detailed-modeling','package.json','schema','scripts/lib/inspect-created-detail.mjs','scripts/run-detail-modeling-live.mjs',
  'scripts/run-detail-modeling-offline-tests.mjs','scripts/run-detail-assembly-edit-live.mjs','scripts/run-detail-appearance-live.mjs',...tests.map(test=>test.file)];
const beforeHashes=await hashFiles(trackedRoots);
const guardedPaths=['.session/mock-model.json',...['test-mcp-intent','test-mcp-iteration','test-mcp-iteration-from-intent','test-mcp-blocked-intent-iteration','test-mcp-build-report'].map(name=>`output/${name}`)];
const readGuardedHashes=async()=>{const existing=[];for(const name of guardedPaths){try{await fs.access(path.join(repository,name));existing.push(name);}catch(error){if(error.code!=='ENOENT')throw error;}}return hashFiles(existing,{includeAll:true});};
const guardedBefore=await readGuardedHashes();
await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(tests,null,2)+'\n',{flag:'wx'});
await fs.writeFile(path.join(directory,'source-hashes-before.json'),JSON.stringify(beforeHashes,null,2)+'\n',{flag:'wx'});
const started=new Date().toISOString();
console.log(JSON.stringify({kind:'detail_modeling_offline_regression_started',directory,test_count:tests.length,live_runtime_executed:false}));
const results=[];
async function run(test,index){
  const caseDirectory=path.join(directory,`${String(index+1).padStart(2,'0')}-${test.id}`),cwd=path.join(caseDirectory,'workspace');
  await fs.mkdir(cwd,{recursive:true});
  for(const entry of readOnlyEntries){try{await fs.symlink(path.join(repository,entry),path.join(cwd,entry));}catch(error){if(error.code!=='ENOENT')throw error;}}
  const temporary=path.join(caseDirectory,'temporary');await fs.mkdir(temporary);
  const environment={...process.env,TMPDIR:temporary,TMP:temporary,TEMP:temporary,
    ALMA_SKETCHUP_STATE_DIR:path.join(caseDirectory,'state'),ALMA_SKETCHUP_QUEUE_DIR:path.join(caseDirectory,'queue'),ALMA_SKETCHUP_RESPONSE_DIR:path.join(caseDirectory,'responses'),
    ALMA_SKETCHUP_MOCK_SESSION_PATH:path.join(caseDirectory,'mock-session.json'),ALMA_SKETCHUP_TEST_OUTPUT_DIR:path.join(cwd,'output')};
  const began=Date.now();
  const result=await new Promise(resolve=>{
    const child=spawn(test.command,[path.join(repository,test.file)],{cwd,env:environment,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',timedOut=false;
    const timeout=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},180000);
    child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
    child.on('error',error=>{clearTimeout(timeout);resolve({exit_code:null,stdout,stderr:stderr+error.stack,timed_out:timedOut});});
    child.on('close',(code,signal)=>{clearTimeout(timeout);resolve({exit_code:code,signal,stdout,stderr,timed_out:timedOut});});
  });
  await fs.writeFile(path.join(caseDirectory,'stdout.log'),result.stdout,{flag:'wx'});await fs.writeFile(path.join(caseDirectory,'stderr.log'),result.stderr,{flag:'wx'});
  const record={id:test.id,file:test.file,category:test.category,status:result.exit_code===0&&!result.timed_out?'pass':'fail',exit_code:result.exit_code,signal:result.signal||null,timed_out:result.timed_out,elapsed_ms:Date.now()-began,directory:caseDirectory};
  results[index]=record;
  console.log(JSON.stringify(record));
}
// Each process has its own cwd, outputs, temporary files and authority state.
let cursor=0;
await Promise.all(Array.from({length:2},async()=>{while(cursor<tests.length){const index=cursor++;await run(tests[index],index);}}));
const afterHashes=await hashFiles(trackedRoots);
const changed=Object.keys({...beforeHashes,...afterHashes}).filter(name=>beforeHashes[name]!==afterHashes[name]);
const guardedAfter=await readGuardedHashes();
const externalChanges=Object.keys({...guardedBefore,...guardedAfter}).filter(name=>guardedBefore[name]!==guardedAfter[name]);
const report={version:1,kind:'detail_modeling_offline_regression',started_at:started,finished_at:new Date().toISOString(),directory,
  execution_scope:'isolated_mock_numeric_ruby_fixtures_and_contract_tests',live_runtime_executed:false,release_acceptance:false,
  ok:results.every(result=>result.status==='pass')&&changed.length===0&&externalChanges.length===0,test_count:results.length,passed:results.filter(result=>result.status==='pass').length,
  failed:results.filter(result=>result.status==='fail').length,source_changed_during_run:changed,
  external_test_output_guard:{paths:guardedPaths,files_compared:Object.keys(guardedBefore).length,changed:externalChanges},
  results,
  not_verified:['SketchUp topology and appearance on this source revision','Actual native batch construction speed and memory','Native save/reopen and selective parametric changes','Two complete scenes and eight recipe categories accepted from local captures']};
await fs.writeFile(path.join(directory,'source-hashes-after.json'),JSON.stringify(afterHashes,null,2)+'\n',{flag:'wx'});
await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
const markdown=`# Detailed modeling offline regression\n\nStatus: ${report.ok?'PASS':'NOT ACCEPTED'}\n\n${report.passed}/${report.test_count} test processes passed. Native SketchUp was not executed. Release acceptance remains false.\n\n| Test | Category | Status | Milliseconds |\n| --- | --- | --- | ---: |\n${results.map(result=>`| ${result.id} | ${result.category} | ${result.status} | ${result.elapsed_ms} |`).join('\n')}\n\nSource files changed during run: ${changed.length?changed.join(', '):'none'}.\n\nExisting mock session and legacy test-output guard: ${externalChanges.length?externalChanges.join(', '):`${Object.keys(guardedBefore).length} files unchanged`}.\n\nNative follow-up remains required for:\n\n${report.not_verified.map(value=>`- ${value}`).join('\n')}\n`;
await fs.writeFile(path.join(directory,'report.md'),markdown,{flag:'wx'});
console.log(JSON.stringify({kind:'detail_modeling_offline_regression_finished',ok:report.ok,passed:report.passed,test_count:report.test_count,source_changed_during_run:changed,report:path.join(directory,'report.json')}));
if(!report.ok)process.exitCode=1;
