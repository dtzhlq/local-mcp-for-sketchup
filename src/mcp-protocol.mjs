import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import { PRODUCT_VERSION } from './version.mjs';
import { TOOL_REGISTRY } from './tool-registry.mjs';
import { ToolInputValidator } from './tool-input-validator.mjs';
import { callTool } from './bridge.mjs';
import { compareSnapshots } from './snapshot-diff.mjs';
export const LEGACY_VERSIONS=['2025-11-25','2025-06-18'];
export const MODERN_VERSION='2026-07-28';
const VERSION='io.modelcontextprotocol/protocolVersion',CAPABILITIES='io.modelcontextprotocol/clientCapabilities';
const protocolError=(code,message,data)=>Object.assign(new Error(message),{rpcCode:code,details:data});
const capabilities={tools:{listChanged:false},resources:{listChanged:false}};
const info={name:'local-mcp-for-sketchup',version:PRODUCT_VERSION};
export class McpProtocol {
  constructor(bridge){this.bridge=bridge;this.inputs=new ToolInputValidator(TOOL_REGISTRY);this.files=new Map();this.legacyVersion=null;this.initialized=false;const ajv=new Ajv2020({strict:false,allErrors:true});this.outputs=new Map(TOOL_REGISTRY.map(t=>[t.name,ajv.compile(t.outputSchema)]));}
  async handle(request){
    let modern=false;
    try{
      if(!request||request.jsonrpc!=='2.0'||typeof request.method!=='string'||(request.id!==undefined&&!(typeof request.id==='string'||Number.isInteger(request.id))))throw protocolError(-32600,'Invalid JSON-RPC request');
      if(request.id===undefined){if(request.method==='notifications/initialized'&&this.legacyVersion)this.initialized=true;return null;}
      if(request.method==='initialize'){
        if(!request.params||typeof request.params.protocolVersion!=='string')throw protocolError(-32602,'initialize requires protocolVersion');
        this.legacyVersion=LEGACY_VERSIONS.includes(request.params.protocolVersion)?request.params.protocolVersion:LEGACY_VERSIONS[0];
        return {jsonrpc:'2.0',id:request.id,result:{protocolVersion:this.legacyVersion,capabilities,serverInfo:info}};
      }
      const meta=request.params?._meta??{},version=meta[VERSION];
      modern=version!==undefined||request.method==='server/discover'||!this.legacyVersion;
      if(modern){
        if(typeof version!=='string'||!meta[CAPABILITIES]||typeof meta[CAPABILITIES]!=='object'||Array.isArray(meta[CAPABILITIES]))throw protocolError(-32602,'Required per-request protocolVersion and clientCapabilities metadata are missing');
        if(version!==MODERN_VERSION)throw protocolError(-32022,'Unsupported protocol version',{supportedVersions:[MODERN_VERSION,...LEGACY_VERSIONS]});
      }else if(!this.initialized&&request.method!=='ping')throw protocolError(-32600,'Legacy client must send notifications/initialized');
      let result;
      if(request.method==='server/discover')result={supportedVersions:[MODERN_VERSION,...LEGACY_VERSIONS],capabilities,_meta:{'io.modelcontextprotocol/serverInfo':info}};
      else if(request.method==='ping')result={};
      else if(request.method==='tools/list')result={tools:TOOL_REGISTRY};
      else if(request.method==='resources/list')result={resources:[...this.files].map(([uri,f])=>({uri,name:f.name,mimeType:f.mimeType}))};
      else if(request.method==='resources/templates/list')result={resourceTemplates:[{uriTemplate:'geometry://{sha256}',name:'Immutable model geometry',mimeType:'application/json'}]};
      else if(request.method==='resources/read')result=await this.readResource(request.params?.uri);
      else if(request.method==='tools/call'){
        const name=request.params?.name,args=request.params?.arguments??{};
        this.inputs.validate(name,args);
        try{
          const raw=name==='compare_snapshots'?compareSnapshots(args.expected?.snapshot??args.expected,args.actual?.snapshot??args.actual,args):await callTool(name,args,this.bridge);
          const value=JSON.parse(JSON.stringify(raw)); // Validate the actual JSON wire value (omit undefined fields).
          if(!this.outputs.get(name)(value))throw Object.assign(new Error('Tool output does not match its declared schema'),{code:'OUTPUT_SCHEMA_MISMATCH',details:{tool:name,violations:this.outputs.get(name).errors}});
          result={content:await this.content(name,value),structuredContent:value};
        }catch(error){
          result={isError:true,content:[{type:'text',text:JSON.stringify({code:error.code??'TOOL_EXECUTION_FAILED',message:error.message,retryable:error.retryable??false,details:error.details??null,next_action:error.next_action??{action:'inspect_error_before_retry'}})}]};
        }
      }else throw protocolError(-32601,`Unknown method: ${request.method}`);
      return {jsonrpc:'2.0',id:request.id,result:modern?{...result,resultType:'complete'}:result};
    }catch(error){return {jsonrpc:'2.0',id:request?.id??null,error:{code:error.rpcCode??(error.code==='INVALID_ARGUMENT'?-32602:-32603),message:error.message,data:{...(error.details||{}),code:error.code??'PROTOCOL_ERROR',next_action:error.next_action??null}}};}
  }
  async content(name,value){
    const content=[{type:'text',text:JSON.stringify(value)}];
    if(value.resource_uri)content.push({type:'resource_link',uri:value.resource_uri,name:'Model geometry snapshot',mimeType:'application/json'});
    if(value.encoding==='base64'&&value.eof&&value.offset===0&&/^image\/(png|jpeg|webp)$/.test(value.media_type??''))content.push({type:'image',mimeType:value.media_type,data:value.content});
    if(['capture_view','save_model','save_model_version','export_model'].includes(name)){
      const file=value.file_path??value.path??value.image_path;
      if(typeof file==='string'){
        const ext=path.extname(file).toLowerCase(),mimeType={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.skp':'application/vnd.sketchup.skp','.json':'application/json'}[ext];
        if(mimeType){const real=await fs.realpath(file),stat=await fs.stat(real),digest=crypto.createHash('sha256').update(real+'\0'+stat.size+'\0'+stat.mtimeMs).digest('hex'),uri=`model-artifact://${digest}`;
          this.files.set(uri,{path:real,name:path.basename(real),mimeType,size:stat.size,mtime:stat.mtimeMs});content.push({type:'resource_link',uri,name:path.basename(real),mimeType});
          if(mimeType.startsWith('image/')&&stat.size<=2_000_000)content.push({type:'image',mimeType,data:(await fs.readFile(real)).toString('base64')});
        }
      }
    }
    return content;
  }
  async readResource(uri){
    if(typeof uri!=='string')throw protocolError(-32602,'Resource URI is required');
    if(/^geometry:\/\/[a-f0-9]{64}$/.test(uri)){const snapshot=await this.bridge.geometryService.load('geometry:'+uri.slice(11));return {contents:[{uri,mimeType:'application/json',text:JSON.stringify(snapshot)}]};}
    const f=this.files.get(uri);if(!f)throw protocolError(-32602,'Unknown resource URI');
    const stat=await fs.stat(f.path);if(stat.size!==f.size||stat.mtimeMs!==f.mtime)throw protocolError(-32602,'Resource changed; obtain a new artifact link');
    if(stat.size>64_000_000)throw protocolError(-32602,'Resource exceeds inline read budget; use the returned local artifact path');
    const bytes=await fs.readFile(f.path);return {contents:[{uri,mimeType:f.mimeType,...(f.mimeType==='application/json'?{text:bytes.toString('utf8')}:{blob:bytes.toString('base64')})}]};
  }
}
