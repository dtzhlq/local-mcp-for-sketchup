#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {compileDetailedAssemblyRecipe} from '../../src/product-modeling/parametric-recipe.mjs';
import {TIMBER_RECIPE_KINDS} from '../../src/traditional-timber/recipes.mjs';

const args=process.argv.slice(2), stage=args.shift()||'column_head';
const kind=`timber_${stage}`;
if(!TIMBER_RECIPE_KINDS.includes(kind))throw new Error(`Stage must be: ${TIMBER_RECIPE_KINDS.map(k=>k.slice(7)).join(', ')}`);
let id=`timber-${stage.replaceAll('_','-')}`,parameters={},out=path.resolve('output/traditional-timber',stage);
while(args.length){const flag=args.shift(),value=args.shift();if(!value)throw new Error(`Missing value for ${flag}`);if(flag==='--params')parameters=JSON.parse(await fs.readFile(value,'utf8'));else if(flag==='--out')out=path.resolve(value);else if(flag==='--id')id=value;else throw new Error(`Unknown flag ${flag}`);}
const bundle=compileDetailedAssemblyRecipe({kind,id,parameters});
await fs.mkdir(out,{recursive:true});
for(const [name,data]of Object.entries({'bundle.json':bundle,'model.dsl.json':bundle.safeJsonDsl,'parameters.json':bundle.parameters}))await fs.writeFile(path.join(out,name),JSON.stringify(data,null,2)+'\n');
console.log(JSON.stringify({output:out,...bundle.report},null,2));
