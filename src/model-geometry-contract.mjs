import {CAD_MESH_OPTIONS} from './cad-contract.mjs';
import {validateCadRecipe} from './cad-kernel.mjs';
import { AgentContractError } from './agent-contract.mjs';
import { affineMatrix, inverseMatrix, vector3 } from './geometry-matrix.mjs';
const point = {type:'array',items:{type:'number'},minItems:3,maxItems:3};
const handle = {type:'string',pattern:'^[vef]:[A-Za-z0-9_-]+$'};
const space = {type:'string',enum:['local','world'],default:'local'};
const variant=(op,properties,required)=>({type:'object',additionalProperties:false,properties:{op:{const:op},coordinate_space:space,...properties},required:['op',...required]});
export const GEOMETRY_EDIT_SCHEMA={oneOf:[
  variant('replace_cad',{...CAD_MESH_OPTIONS,coordinate_space:{const:'local'}},['recipe']),
  variant('add_edges',{points:{type:'array',items:point,minItems:2,maxItems:10000}},['points']),
  variant('add_face',{points:{type:'array',items:point,minItems:3,maxItems:10000}},['points']),
  variant('move_vertices',{moves:{type:'array',minItems:1,maxItems:10000,items:{type:'object',additionalProperties:false,properties:{handle,delta:point},required:['handle','delta']}}},['moves']),
  variant('transform_entities',{handles:{type:'array',items:handle,minItems:1,maxItems:10000},matrix:{type:'array',items:{type:'number'},minItems:16,maxItems:16}},['handles','matrix']),
  variant('pushpull_face',{handle,distance:{type:'number'}},['handle','distance']),
  variant('reverse_face',{handle},['handle']),
  variant('erase_entities',{handles:{type:'array',items:handle,minItems:1,maxItems:10000}},['handles']),
  variant('set_face_material',{handle,material:{type:'string',minLength:1},side:{enum:['front','back','both']}},['handle','material']),
  {...variant('set_edge_properties',{handle,soft:{type:'boolean'},smooth:{type:'boolean'}},['handle']),anyOf:[{required:['soft']},{required:['smooth']}]}
]};
export function validateGeometryEdits(edits,{internal=false}={}){
  try{
    if(!Array.isArray(edits)||edits.length<1||edits.length>100)throw new Error('edits must contain 1..100 operations');
    let total=0;
    for(const e of edits){
      const schema=GEOMETRY_EDIT_SCHEMA.oneOf.find(s=>s.properties.op.const===e?.op);
      if(!schema||Object.keys(e).some(k=>!Object.hasOwn(schema.properties,k)&&!(internal&&e.op==='replace_cad'&&k==='mesh'))||schema.required.some(k=>e[k]===undefined))throw new Error('Unknown edit, field, or missing required argument');
      if(e.op==='replace_cad'){validateCadRecipe(e.recipe);if(e.coordinate_space&&e.coordinate_space!=='local')throw new Error('CAD updates require local coordinates');}
      if(e.coordinate_space&&!['local','world'].includes(e.coordinate_space))throw new Error('Invalid coordinate_space');
      if(e.points){if(e.points.length<(e.op==='add_face'?3:2))throw new Error('Insufficient points');e.points.forEach(p=>vector3(p));total+=e.points.length;}
      if(e.moves){if(!Array.isArray(e.moves)||!e.moves.length)throw new Error('moves required');e.moves.forEach(m=>{if(Object.keys(m).some(k=>!['handle','delta'].includes(k)))throw new Error('Unexpected move field');vector3(m.delta);});if(new Set(e.moves.map(m=>m.handle)).size!==e.moves.length)throw new Error('Duplicate vertex move');total+=e.moves.length;}
      const hs=[...(e.handles??[]),...(e.moves??[]).map(m=>m.handle),...(e.handle?[e.handle]:[])];
      if(hs.some(h=>typeof h!=='string'||!new RegExp(handle.pattern).test(h)))throw new Error('Invalid topology handle');
      if(e.handles&&(!Array.isArray(e.handles)||!e.handles.length||new Set(e.handles).size!==e.handles.length))throw new Error('Invalid handles');
      if(e.matrix)inverseMatrix(affineMatrix(e.matrix));
      if(e.op==='pushpull_face'&&(!Number.isFinite(e.distance)||e.distance===0))throw new Error('Nonzero finite distance required');
      if(e.op==='set_face_material'&&(typeof e.material!=='string'||!e.material.trim()||e.side&&!['front','back','both'].includes(e.side)))throw new Error('Invalid face material');
      if(e.op==='set_edge_properties'&&(['soft','smooth'].some(k=>e[k]!==undefined&&typeof e[k]!=='boolean')||e.soft===undefined&&e.smooth===undefined))throw new Error('An edge property is required');
      total+=hs.length;
    }
    if(total>20000)throw new Error('Geometry edit element budget exceeded');
  }catch(e){throw new AgentContractError('INVALID_ARGUMENT',e.message);}
  return edits;
}
