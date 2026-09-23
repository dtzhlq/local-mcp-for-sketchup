import fs from 'node:fs';
import crypto from 'node:crypto';
const bytes=fs.readFileSync(new URL('../../data/traditional-timber/yf-dian-5bay-10rafter-v1.json',import.meta.url));
export const YF_RULES=JSON.parse(bytes);
export const YF_RULES_HASH=`sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
export const YF_PRESET=YF_RULES.id;
export const YF_PARAMETER_RULES=Object.freeze({
 tile_detail:{type:'string',enum:['light','detailed'],default:'light',description:'Visual geometry only: light exposed tile skins grouped by course; detailed individual closed tiles.'},
 chi_mm:{type:'number',minimum:200,maximum:400,required:true,description:'Explicit chosen chi in mm; no claim of a unique historical Song chi.'},
 middle_bay_chi:{type:'number',minimum:18,maximum:36,default:27,description:'Selected central bay width in chi.'},
 side_bay_chi:{type:'number',minimum:12,maximum:24,default:18,description:'Each of four remaining bay widths in chi.'},
 step_chi:{type:'number',minimum:3,maximum:7.5,default:6,description:'Selected inner rafter bay horizontal run in chi.'},
 column_height_chi:{type:'number',minimum:18,maximum:32,default:26,description:'Main eave column nominal height in chi.'},
 subsidiary_width_chi:{type:'number',minimum:6,maximum:14,default:10,description:'Selected subsidiary-eave plan width in chi.'},
 subsidiary_column_height_chi:{type:'number',minimum:9,maximum:18,default:13,description:'Subsidiary eave column height in chi.'},
 door_height_chi:{type:'number',minimum:7,maximum:24,default:12,description:'Double board-door opening height in chi.'},
 window_width_chi:{type:'integer',minimum:10,maximum:14,default:14,description:'Selected nominal po-zi-ling panel width; height is derived from its mullion count, section and one-cun gaps.'}
});
export function resolveYfParameters(input={}){
 for(const key of Object.keys(input))if(!Object.hasOwn(YF_PARAMETER_RULES,key))throw new Error(`Unknown YF parameter: ${key}`);
 const p={};for(const [key,rule]of Object.entries(YF_PARAMETER_RULES)){
  const v=input[key]??rule.default;
  if(rule.enum){if(!rule.enum.includes(v))throw new Error(`${key} must be one of ${rule.enum.join(', ')}`);p[key]=v;continue;}
  if(!Number.isFinite(v)||(rule.type==='integer'&&!Number.isInteger(v))||v<rule.minimum||v>rule.maximum)throw new Error(`${key} requires an explicit ${rule.type} in [${rule.minimum}, ${rule.maximum}]`);
  p[key]=v;
 }
 if(p.door_height_chi>p.column_height_chi-4)throw new Error('Door must leave space below main framing');
 if(p.subsidiary_column_height_chi+p.subsidiary_width_chi/2+3>=p.column_height_chi)throw new Error('Subsidiary roof must fit below the main eave assembly');
 if(p.middle_bay_chi+4*p.side_bay_chi<=8*p.step_chi+6.6)throw new Error('The fixed longitudinal hip roof requires width greater than eave depth');
 if(p.window_width_chi+43.5*.055>=p.side_bay_chi)throw new Error('The selected window must fit between side-bay column shafts');
 return Object.freeze(p);
}
export function yfUnits(p){return Object.freeze({chi:p.chi_mm,cun:p.chi_mm/10,chi_fen:p.chi_mm/100,li:p.chi_mm/1000,fen:p.chi_mm*.055,subsidiary_fen:p.chi_mm*.05});}
// Ordered ridge-to-eave support backs. Each next point is on the previous
// support-to-eave line, minus the successively halved fold, per YF5 14a.
export function roofSupportBacks(runs,eaveBack,rise){
 const half=runs.reduce((a,b)=>a+b,0),result=[{distance:0,z:eaveBack+rise}];
 let x=0,z=eaveBack+rise;
 for(let i=0;i<runs.length;i++){
  const next=x+runs[i];
  z=i===runs.length-1?eaveBack:z+(eaveBack-z)*(next-x)/(half-x)-rise*.1/2**i;
  result.push({distance:next,z});x=next;
 }
 return result;
}
export function columnRiseChi(index){return [0.4,0.2,0,0,0.2,0.4][index];}
export function boardDoorBattens(heightChi){return heightChi<=7?5:heightChi<=13?7:heightChi<=19?9:heightChi<=22?11:13;}
// YF6:17 mullions at ten chi, two more per added chi; section width
// 0.056*height, jamb width 0.12*height, clear gap 0.1 chi. The chosen
// panel has two jambs and gaps BETWEEN mullions; no invented perimeter gaps.
export function poZiLingDimensions(widthChi){
 const count=17+2*(widthChi-10);
 const heightChi=(widthChi-(count-1)*.1)/(count*.056+2*.12);
 if(!Number.isInteger(widthChi)||widthChi<10||widthChi>14||heightChi<4||heightChi>8)throw new Error('Unsupported po-zi-ling panel');
 // Adopt nominal H as the proportional module. The .98H mullion embeds
 // two thirds of the .05H subframe section at each end. Total outer height
 // is therefore derived, not silently equated with this nominal module.
 const embedChi=heightChi*.05*2/3,clearHeightChi=.98*heightChi-2*embedChi;
 return {widthChi,heightChi,outerHeightChi:clearHeightChi+.24*heightChi,clearHeightChi,embedChi,count,mullionWidthChi:heightChi*.056,mullionDepthChi:heightChi*.028,jambWidthChi:heightChi*.12,gapChi:.1};
}

// Binding belongs to the server's persisted creation source. No parameter edit
// may replace it with whatever rule data happens to ship in a later release.
export function yfRuleBinding(){
 return Object.freeze({id:YF_PRESET,version:YF_RULES.version,sha256:YF_RULES_HASH});
}
export function assertYfRuleBinding(binding){
 const expected=yfRuleBinding();
 if(!binding||Object.keys(binding).length!==3||Object.entries(expected).some(([key,value])=>binding[key]!==value)){
  throw new Error('YF_RULE_VERSION_MISMATCH: this model requires its recorded rule package; an explicit migration or matching package is required');
 }
 return expected;
}
