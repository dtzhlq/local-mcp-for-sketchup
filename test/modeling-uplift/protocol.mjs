import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SketchUpBridge} from '../../src/bridge.mjs';
import {McpProtocol,MODERN_VERSION} from '../../src/mcp-protocol.mjs';
import {TOOL_REGISTRY} from '../../src/tool-registry.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'modeling-protocol-'));
const bridge=new SketchUpBridge({approval:{stateDir:path.join(root,'approvals')},mock:{sessionPath:path.join(root,'model.json')},agentContract:{rootDir:path.join(root,'tasks')}});
const protocol=new McpProtocol(bridge),modern={ 'io.modelcontextprotocol/protocolVersion':MODERN_VERSION,'io.modelcontextprotocol/clientCapabilities':{} };
let id=0;const call=(method,params={})=>protocol.handle({jsonrpc:'2.0',id:++id,method,params});
assert.equal((await call('server/discover')).error.code,-32602);
assert.equal((await call('server/discover',{_meta:{...modern,'io.modelcontextprotocol/protocolVersion':'future'}})).error.code,-32022);
assert.equal((await call('server/discover',{_meta:modern})).result.resultType,'complete');
assert.equal((await call('tools/list',{_meta:modern})).result.tools.length,48);
assert.equal((await call('initialize',{protocolVersion:'unknown'})).result.protocolVersion,'2025-11-25');
assert.equal(await protocol.handle({jsonrpc:'2.0',method:'notifications/initialized'}),null);
assert.equal((await call('tools/list')).result.tools.length,48);
for(const tool of TOOL_REGISTRY){assert.equal(tool.inputSchema.additionalProperties,false);assert.ok(tool.outputSchema);assert.equal(typeof tool.annotations.readOnlyHint,'boolean');assert.deepEqual(protocol.inputs.schemaFor(tool.name),tool.inputSchema);}
const queried=await call('tools/call',{_meta:modern,name:'query_model_geometry',arguments:{}});assert.equal(queried.result.isError,undefined,JSON.stringify(queried));
const uri=queried.result.structuredContent.resource_uri;assert.equal((await call('resources/read',{_meta:modern,uri})).result.contents[0].mimeType,'application/json');
assert.equal((await call('tools/call',{_meta:modern,name:'query_model_geometry',arguments:{unexpected:true}})).error.code,-32602);
assert.equal((await call('unknown',{_meta:modern})).error.code,-32601);
assert.equal(await protocol.handle({jsonrpc:'2.0',method:'unknown'}),null);


for(const protocolVersion of ['2025-06-18','2025-11-25']){const p=new McpProtocol(bridge);const r=await p.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion}});assert.equal(r.result.protocolVersion,protocolVersion);await p.handle({jsonrpc:'2.0',method:'notifications/initialized'});assert.equal((await p.handle({jsonrpc:'2.0',id:2,method:'tools/list'})).result.tools.length,48);}

console.log(JSON.stringify({ok:true,group:'tool-protocol',tools:48,checks:14}));
