import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {AgentContractError,sha256Canonical} from './agent-contract.mjs';
const cache=new Map();
const fields={sew:['inputs','solid'],box:['min','max'],cylinder:['radius','height','origin','axis'],nurbs_surface:['poles','weights','u_degree','v_degree','u_knots','v_knots','u_multiplicities','v_multiplicities'],fuse:['input','other'],cut:['input','other'],intersect:['input','other'],fillet:['input','radius','edges']};
const bad=message=>{throw new AgentContractError('INVALID_ARGUMENT','CAD_INVALID_ARGUMENT: '+message,{nextAction:{action:'correct_cad_recipe'}});};
const number=(n,min=-1e6,max=1e6)=>{if(!Number.isFinite(n)||n<min||n>max)bad('Number outside finite range');};
const point=p=>{if(!Array.isArray(p)||p.length!==3)bad('Expected three coordinates');p.forEach(x=>number(x));};
export function validateCadRecipe(recipe){
 if(!recipe||recipe.version!==1||Object.keys(recipe).some(k=>!['version','nodes','output'].includes(k))||!Array.isArray(recipe.nodes)||recipe.nodes.length<1||recipe.nodes.length>24)bad('Expected v1 recipe with 1..24 nodes');
 if(JSON.stringify(recipe).length>200000)bad('Recipe size budget exceeded');
 const ids=new Set();
 for(const n of recipe.nodes){
  if(!n||!fields[n.kind]||Object.keys(n).some(k=>!['id','kind',...fields[n.kind]].includes(k))||typeof n.id!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(n.id)||ids.has(n.id))bad('Invalid node, field or duplicate id');
  for(const k of ['input','other'])if(fields[n.kind].includes(k)&&!ids.has(n[k]))bad('Node references must address previous nodes');
  if(n.kind==='sew'){if(!Array.isArray(n.inputs)||n.inputs.length<2||n.inputs.length>24||new Set(n.inputs).size!==n.inputs.length||n.inputs.some(x=>!ids.has(x))||typeof n.solid!=='boolean')bad('Sew requires 2..24 prior faces/shells and solid boolean');}
  if(n.kind==='box'){point(n.min);point(n.max);if(n.min.some((x,i)=>x>=n.max[i]))bad('Box must have positive dimensions');}
  if(n.kind==='cylinder'){number(n.radius,0.01,1e5);number(n.height,0.01,1e5);if(n.origin)point(n.origin);if(n.axis){point(n.axis);if(Math.hypot(...n.axis)<1e-10)bad('Zero cylinder axis');}}
  if(n.kind==='fillet'){number(n.radius,0.01,1e5);if(n.edges&&(!Array.isArray(n.edges)||!n.edges.length||n.edges.length>256||new Set(n.edges).size!==n.edges.length||n.edges.some(i=>!Number.isInteger(i)||i<0)))bad('Invalid edge indices');}
  if(n.kind==='nurbs_surface'){
   if(!Array.isArray(n.poles)||n.poles.length<2||n.poles.length>32||!Array.isArray(n.poles[0])||n.poles[0].length<2||n.poles[0].length>32)bad('Control grid must be 2..32 by 2..32');
   n.poles.forEach(row=>{if(!Array.isArray(row)||row.length!==n.poles[0].length)bad('Ragged control grid');row.forEach(point);});
   if(n.weights){if(!Array.isArray(n.weights)||n.weights.length!==n.poles.length)bad('Weight grid mismatch');n.weights.forEach(row=>{if(!Array.isArray(row)||row.length!==n.poles[0].length)bad('Weight row mismatch');row.forEach(w=>number(w,1e-6,1e6));});}
   for(const [axis,count] of [['u',n.poles.length],['v',n.poles[0].length]]){
    const degree=n[axis+'_degree'],knots=n[axis+'_knots'],mult=n[axis+'_multiplicities'];
    if(!Number.isInteger(degree)||degree<1||degree>8||degree>=count)bad('Degree must be 1..8 and below pole count');
    if(!Array.isArray(knots)||knots.length<2||knots.length>32||!Array.isArray(mult)||mult.length!==knots.length)bad('Invalid knots/multiplicities');
    knots.forEach((k,i)=>{number(k);if(i&&k<=knots[i-1])bad('Knots must strictly increase');});
    if(mult.some((m,i)=>!Number.isInteger(m)||m<1||m>(i===0||i===mult.length-1?degree+1:degree))||mult[0]!==degree+1||mult.at(-1)!==degree+1||mult.reduce((a,b)=>a+b,0)!==count+degree+1)bad('Expected clamped nonperiodic knot multiplicities');
   }
  }
  ids.add(n.id);
 }
 if(!ids.has(recipe.output))bad('Missing output node');return recipe;
}
export function computeCadShape({recipe,tolerance=0.2,angular_tolerance=0.35,max_vertices=30000,max_faces=30000}){
 validateCadRecipe(recipe);number(tolerance,0.01,5);number(angular_tolerance,0.05,0.5);
 for(const n of [max_vertices,max_faces])if(!Number.isInteger(n)||n<3||n>50000)bad('Mesh budgets must be 3..50000');
 const request={recipe,tolerance,angular_tolerance,max_vertices,max_faces},key=sha256Canonical(request);
 if(cache.has(key))return structuredClone(cache.get(key));
 const result=spawnSync(process.execPath,['--max-old-space-size=256',fileURLToPath(new URL('./cad-kernel-worker.mjs',import.meta.url))],{input:JSON.stringify(request),encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024});
 if(result.error)throw new AgentContractError('INVALID_ARGUMENT','CAD_COMPUTE_FAILED: '+(result.error.code??'worker failed'),{nextAction:{action:'reduce_cad_complexity'}});
 let value;try{value=JSON.parse(result.stdout);}catch{throw new AgentContractError('INVALID_ARGUMENT','CAD_COMPUTE_FAILED: Invalid worker response',{nextAction:{action:'inspect_cad_kernel'}});}
 if(result.status!==0||!value.ok)throw new AgentContractError('INVALID_ARGUMENT','CAD_GEOMETRY_FAILED: '+(value.error??'kernel failure'),{nextAction:{action:'inspect_cad_recipe_or_radius'}});
 const cad={version:'cad-source.v1',kernel:'replicad-opencascadejs@1.1.0',recipe:structuredClone(recipe),tolerance,angular_tolerance,source_hash:sha256Canonical(recipe),evidence:value.evidence};
 const output={vertices:value.vertices,faces:value.faces,cad_faces:value.cad_faces,cad};
 if(cache.size>=4)cache.delete(cache.keys().next().value);cache.set(key,output);return structuredClone(output);
}
export function expandCadOperation(op){return {op:'mesh',name:op.name,id:op.id,object_id:op.object_id,material:op.material,transform:op.transform,smooth:'cad',construction:'bulk',...computeCadShape(op)};}
