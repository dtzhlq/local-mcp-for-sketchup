import fs from 'node:fs';
import Ajv from 'ajv';
import { AgentContractError, ERROR_CODE_REGISTRY, sha256Canonical } from '../agent-contract.mjs';

export const TRADITIONAL_ASSEMBLY_VERSION = 'traditional-assembly.v1';
export const TRADITIONAL_RENDER_VERSION = 'traditional-render.v1';
export const PROJECT_RULES = JSON.parse(fs.readFileSync(new URL('../../data/traditional-timber/contemporary-chinese-v1.json', import.meta.url)));
const validate = new Ajv({allErrors:true,strict:false}).compile(JSON.parse(fs.readFileSync(new URL('../../schema/traditional-assembly-v1.schema.json', import.meta.url))));
const clone = value => structuredClone(value);
export function assemblyError(code, message, path = 'task.assembly', extra = {}) {
  // Keep the public gateway error registry stable; semantic diagnostics retain
  // their specific code in details and in the task's preflight issues.
  const gatewayCode=Object.hasOwn(ERROR_CODE_REGISTRY,code)?code:'INVALID_ARGUMENT';
  throw new AgentContractError(gatewayCode, message, {details:{path,domain_code:code,execution_started:false,quality_accepted:false,...extra}});
}
export function traditionalAssemblyRuleBinding() {
  return {rule_id:PROJECT_RULES.id,rule_version:PROJECT_RULES.version,rule_hash:sha256Canonical(PROJECT_RULES),contract_version:TRADITIONAL_ASSEMBLY_VERSION};
}
export function assertTraditionalAssemblyRuleBinding(binding) {
  if (sha256Canonical(binding) !== sha256Canonical(traditionalAssemblyRuleBinding())) assemblyError('RULE_BINDING_MISMATCH','Stored assembly rules differ; use the matching package or an explicit migration.');
}
export function normalizeTraditionalAssembly(assembly, inputParameters = {}) {
  if (!validate(assembly)) assemblyError('INVALID_ARGUMENT','Invalid traditional assembly plan.', 'task.assembly', {issues:clone(validate.errors)});
  const plan = clone(assembly), parameters = clone(inputParameters);
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) assemblyError('INVALID_ARGUMENT','parameters must be an explicit object.','task.parameters');
  for (const [key,value] of Object.entries(parameters)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,95}$/.test(key) || ['__proto__','constructor','prototype'].includes(key)) assemblyError('INVALID_ARGUMENT','Invalid parameter name.',`task.parameters.${key}`);
    if (!(typeof value === 'string' && value.length <= 120 || typeof value === 'boolean' || Number.isFinite(value) || Array.isArray(value) && value.length > 0 && value.length <= 32 && value.every(Number.isFinite))) assemblyError('INVALID_ARGUMENT','Use finite numbers, short numeric arrays, booleans or declared enums.',`task.parameters.${key}`);
  }
  const geometry_parameters=Object.fromEntries(Object.entries(parameters).map(([key,value])=>[key,plan.parameter_units?.[key]==='fen'?(Array.isArray(value)?value.map(v=>v*parameters.fen_mm):value*parameters.fen_mm):clone(value)]));
  const used = new Set(), ids = new Set();
  const use = key => {if (!Object.hasOwn(parameters,key)) assemblyError('MISSING_INPUT',`Missing explicit parameter ${key}.`,`task.parameters.${key}`);used.add(key);};
  if (plan.layout.kind === 'path') {
    if (!plan.layout.segments || !plan.layout.width_parameter) assemblyError('MISSING_INPUT','A path needs segments and width_parameter.');
    use(plan.layout.width_parameter);
    for (const segment of plan.layout.segments) use(segment.bay_lengths_parameter);
  } else if (plan.layout.kind === 'grid') {
    if (!plan.layout.x_bays_parameter || !plan.layout.depth_parameter) assemblyError('MISSING_INPUT','A grid needs x_bays_parameter and depth_parameter.');
    use(plan.layout.x_bays_parameter);use(plan.layout.depth_parameter);
  }
  for (const part of plan.assemblies) {
    if (ids.has(part.id)) assemblyError('INVALID_ARGUMENT',`Duplicate semantic assembly ID: ${part.id}.`);
    ids.add(part.id);
    const bindings = plan.parameter_bindings?.[part.id] || {};
    for (const key of Object.values(bindings)) use(key);
    part.parameters = {...part.parameters,...Object.fromEntries(Object.entries(bindings).map(([local,key])=>[local,clone(geometry_parameters[key])]))};
    const references=value=>{if(typeof value==='string'&&value.startsWith('$'))use(value.slice(1));else if(Array.isArray(value))value.forEach(references);else if(value&&typeof value==='object')Object.values(value).forEach(references);};
    references(part.shape);references(part.ports);
  }
  for (const id of Object.keys(plan.parameter_bindings || {})) if (!ids.has(id)) assemblyError('INVALID_ARGUMENT',`Parameter binding targets unknown assembly ${id}.`);
  const knownRule = traditionalAssemblyRuleBinding();
  for (const rule of plan.rule_bindings || []) if (rule.id !== knownRule.rule_id || rule.version !== knownRule.rule_version || rule.hash && rule.hash !== knownRule.rule_hash) assemblyError('RULE_BINDING_MISMATCH',`Unsupported or changed rule package: ${rule.id}.`);
  if (plan.mode === 'song_informed' && !Number.isFinite(parameters.fen_mm)) assemblyError('MISSING_INPUT','Song-informed dimensions require explicit fen_mm; no universal historical scale is assumed.','task.parameters.fen_mm');
  if (plan.mode === 'song_informed') used.add('fen_mm');
  // Every declared design value must participate; no silently ignored knobs.
  for (const key of Object.keys(parameters)) if (!used.has(key)) assemblyError('INVALID_ARGUMENT',`Parameter ${key} has no declared layout/family binding.`,`task.parameters.${key}`);
  plan.rule_bindings = [{id:knownRule.rule_id,version:knownRule.rule_version,hash:knownRule.rule_hash}];
  plan.representation = {tile_detail:'surface',...plan.representation,version:TRADITIONAL_RENDER_VERSION};
  if(plan.representation.overview_scope==='scene'&&!plan.representation.scene_id)assemblyError('MISSING_INPUT','A deferred overview requires a recorded scene_id.');
  for(const key of Object.keys(plan.parameter_sources||{}))if(!Object.hasOwn(parameters,key))assemblyError('INVALID_ARGUMENT',`Source targets undeclared parameter ${key}.`);
  for(const [key,unit] of Object.entries(plan.parameter_units||{}))if(!Object.hasOwn(parameters,key)||unit==='fen'&&plan.mode!=='song_informed')assemblyError('INVALID_ARGUMENT','Material fen units require song_informed mode and an explicit fen_mm scale.');
  const sources = Object.fromEntries(Object.entries(parameters).map(([key,value])=> {
    const source=plan.parameter_sources?.[key],unit=plan.parameter_units?.[key]||(key.endsWith('_deg')?'degrees':typeof value==='number'||Array.isArray(value)?'mm':'dimensionless');
    if(source?.basis==='documented'&&!source.source_refs?.length)assemblyError('MISSING_INPUT','Documented parameters require a specific source reference.',`task.assembly.parameter_sources.${key}`);
    return [key,{...source,value:clone(value),unit,...(['mm','fen'].includes(unit)?{converted_mm:clone(geometry_parameters[key])}:{geometry_value:clone(geometry_parameters[key])}),basis:source?.basis||'selected',note:source?.note||'Explicit user/project engineering input.'}];
  }));
  if (plan.mode === 'song_informed') {
    if (!(parameters.fen_mm>0&&parameters.fen_mm<=50)) assemblyError('INVALID_ARGUMENT','fen_mm must be in (0,50].','task.parameters.fen_mm');
    plan.simplifications = [...(plan.simplifications || []),'Song-informed mode uses only declared scale/ratios; the assembly is not an authenticated Song reconstruction.'];
  }
  return {plan,parameters,geometry_parameters,parameter_sources:sources,rule_binding:knownRule,signature:sha256Canonical({assembly,parameters,rule_binding:knownRule})};
}
export function traditionalParameterContract(assembly, parameters = {}) {
  const normalized = normalizeTraditionalAssembly(assembly, parameters);
  const bays=new Set([assembly.layout.x_bays_parameter,...(assembly.layout.segments||[]).map(s=>s.bay_lengths_parameter)]);
  return Object.fromEntries(Object.entries(normalized.parameters).map(([key,value])=>[key,{
    type:Array.isArray(value)?'array':typeof value,
    ...(Array.isArray(value)?{items:{type:'number',minimum:bays.has(key)?1:-60000,maximum:60000},minItems:value.length,maxItems:value.length}:typeof value==='number'?{minimum:-60000,maximum:1000000}:typeof value==='string'?{enum:[value]}:{}),
    units:assembly.parameter_units?.[key]|| (key.endsWith('_mm')?'mm':key.endsWith('_deg')?'degrees':'explicit'),
    description:'Parameter bound to the stored semantic plan; topology changes require a separate rebuild proposal.'
  }]));
}
export function parameterImpactSet(assembly, changes) {
  const changed = new Set(Object.keys(changes)), affected = new Set();
  const layoutKeys = [assembly.layout.width_parameter,assembly.layout.depth_parameter,assembly.layout.x_bays_parameter,...(assembly.layout.segments || []).map(s=>s.bay_lengths_parameter)];
  if (layoutKeys.some(key=>changed.has(key))) for (const part of assembly.assemblies) if (!['site_piece','explicit_geometry'].includes(part.family)) affected.add(part.id);
  for (const [id,bindings] of Object.entries(assembly.parameter_bindings || {})) if (Object.values(bindings).some(key=>changed.has(key))) affected.add(id);
  const referencesChanged=value=>typeof value==='string'?value.startsWith('$')&&changed.has(value.slice(1)):Array.isArray(value)?value.some(referencesChanged):value&&typeof value==='object'?Object.values(value).some(referencesChanged):false;
  for(const part of assembly.assemblies)if(referencesChanged(part.shape)||referencesChanged(part.ports))affected.add(part.id);
  let grew;
  do {grew=false;for(const connection of assembly.connections){const a=connection.from.split('.')[0],b=connection.to.split('.')[0];if(affected.has(a)&&!affected.has(b)){affected.add(b);grew=true;}}} while(grew);
  return [...affected].sort();
}
