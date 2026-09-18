import { AgentContractError } from './agent-contract.mjs';
const fail=message=>{throw new AgentContractError('INVALID_ARGUMENT',message);};
export function decodeGeometryCursor(cursor){
  if(typeof cursor!=='string'||cursor.length>300)fail('Invalid geometry cursor');
  let value;try{value=JSON.parse(Buffer.from(cursor,'base64url').toString());}catch{fail('Invalid geometry cursor');}
  if(!/^geometry:[a-f0-9]{64}$/.test(value.handle)||!Number.isSafeInteger(value.offset)||value.offset<0||!Number.isSafeInteger(value.size)||value.size<1||value.size>10000)fail('Invalid geometry cursor');
  return value;
}
export function geometryPage(snapshot,handle,{cursor,page_size=1000}={}){
  const decoded=cursor?decodeGeometryCursor(cursor):{handle,offset:0,size:page_size};
  if(decoded.handle!==handle)fail('Cursor belongs to another snapshot');
  if(!Number.isSafeInteger(decoded.size)||decoded.size<1||decoded.size>10000)fail('page_size must be 1..10000 topology records');
  const total=snapshot.contexts.reduce((n,c)=>n+c.vertices.length+c.edges.length+c.faces.length,0);
  if(decoded.offset>total)fail('Cursor exceeds snapshot');
  let index=0;const contexts=[];
  for(const c of snapshot.contexts){const entry={...c,vertices:[],edges:[],faces:[]};for(const kind of ['vertices','edges','faces'])for(const value of c[kind]){if(index>=decoded.offset&&index<decoded.offset+decoded.size)entry[kind].push(value);index++;}if(entry.vertices.length+entry.edges.length+entry.faces.length)contexts.push(entry);}
  const end=Math.min(total,decoded.offset+decoded.size),next=end<total?Buffer.from(JSON.stringify({handle,offset:end,size:decoded.size})).toString('base64url'):null;
  return {snapshot:{...snapshot,contexts,complete:snapshot.complete&&decoded.offset===0&&!next,partial:true},page:{offset:decoded.offset,returned:end-decoded.offset,total_records:total,page_size:decoded.size,has_more:!!next,next_cursor:next,snapshot_complete:snapshot.complete}};
}
