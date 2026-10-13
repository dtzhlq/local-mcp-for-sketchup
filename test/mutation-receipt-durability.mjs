import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TaskMutationReceiptLedger } from '../src/task-mutation-receipt-ledger.mjs';

const root=await fs.mkdtemp(path.join(os.tmpdir(),'receipt-durability-'));
const open=fs.open,platform=Object.getOwnPropertyDescriptor(process,'platform');
let attempt=0;
async function signWithFault({host,stage,code}) {
  const dir=path.join(root,`case-${++attempt}`),ledger=new TaskMutationReceiptLedger({rootDir:dir});
  Object.defineProperty(process,'platform',{...platform,value:host});
  fs.open=async function(location,...args) {
    if(stage==='directory'&&location===dir) throw Object.assign(new Error('injected directory-sync failure'),{code});
    const handle=await open.call(fs,location,...args);
    if(stage==='file'&&String(location).endsWith('.tmp')) handle.sync=async()=>{throw Object.assign(new Error('injected file-sync failure'),{code});};
    return handle;
  };
  try {return {signature:await ledger.sign({value:'durable'}),dir};}
  finally {fs.open=open;Object.defineProperty(process,'platform',platform);}
}
try {
  const win=await signWithFault({host:'win32',stage:'directory',code:'EPERM'});
  assert.equal(await new TaskMutationReceiptLedger({rootDir:win.dir}).sign({value:'durable'}),win.signature,'persisted secret must retain proof identity across ledger instances');
  await assert.rejects(signWithFault({host:'darwin',stage:'directory',code:'EPERM'}),{code:'EPERM'});
  await assert.rejects(signWithFault({host:'win32',stage:'file',code:'EPERM'}),{code:'EPERM'});
  await assert.rejects(signWithFault({host:'win32',stage:'directory',code:'EIO'}),{code:'EIO'});
  console.log('Receipt durability: Windows directory-sync EPERM tolerated after file sync; file failures, other I/O failures and non-Windows permission failures remain fatal.');
} finally {fs.open=open;Object.defineProperty(process,'platform',platform);await fs.rm(root,{recursive:true,force:true});}
