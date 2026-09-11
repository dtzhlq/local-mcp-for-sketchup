#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PRODUCT_VERSION} from '../src/version.mjs';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const output=path.resolve(process.argv[2]||path.join(root,'out/image-release-unsigned'));
await fs.mkdir(output,{recursive:true});
const target=path.join(output,`local-mcp-for-sketchup-${PRODUCT_VERSION}-unsigned.rbz`);
try {await fs.access(target);throw new Error('Refusing to overwrite existing package');}catch(e){if(e.code!=='ENOENT')throw e;}
const stage=await fs.mkdtemp(path.join(os.tmpdir(),'image-release-plugin-'));
const nested=path.join(stage,'local_mcp_for_sketchup');await fs.mkdir(nested);
const source=path.join(root,'sketchup_plugin/alma_sketchup_mcp');
for(const entry of await fs.readdir(source,{withFileTypes:true})) {
 if(!entry.isFile() || !entry.name.endsWith('.rb'))throw new Error(`Unexpected plugin source ${entry.name}`);
 await fs.copyFile(path.join(source,entry.name),path.join(nested,entry.name));
}
// Relocation only: business logic is byte-identical except relative module paths.
const bridge=(await fs.readFile(path.join(root,'sketchup_plugin/alma_sketchup_mcp.rb'),'utf8'))
 .replaceAll("require_relative 'alma_sketchup_mcp/","require_relative '")
 .replaceAll("File.join(__dir__, 'alma_sketchup_mcp')","__dir__");
await fs.writeFile(path.join(nested,'bridge.rb'),bridge);
const loader=`# frozen_string_literal: true\nrequire 'sketchup.rb'\nrequire 'extensions.rb'\nmodule LocalMcpForSketchUp\n  unless file_loaded?(__FILE__)\n    extension = SketchupExtension.new('Local MCP for SketchUp', 'local_mcp_for_sketchup/bridge')\n    extension.version = '${PRODUCT_VERSION}'\n    extension.creator = 'zhanglinqi'\n    extension.description = 'Local MCP bridge with optional single-image structure assistance.'\n    Sketchup.register_extension(extension, true)\n    file_loaded(__FILE__)\n  end\nend\n`;
await fs.writeFile(path.join(stage,'local_mcp_for_sketchup.rb'),loader);
const files=['local_mcp_for_sketchup.rb',...(await fs.readdir(nested)).map(f=>'local_mcp_for_sketchup/'+f)].sort();
for(const file of files)execFileSync('ruby',['-c',path.join(stage,file)],{stdio:'pipe'});
execFileSync('/usr/bin/zip',['-X','-q',target,...files],{cwd:stage});
const bytes=await fs.readFile(target);
const inventory=await Promise.all(files.map(async file=>({file,sha256:crypto.createHash('sha256').update(await fs.readFile(path.join(stage,file))).digest('hex')})));
const report={version:PRODUCT_VERSION,path:target,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),size_bytes:bytes.length,officially_signed:false,release_acceptance:false,stage,files:inventory};
await fs.writeFile(target+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({path:target,sha256:report.sha256,file_count:files.length,officially_signed:false}));
