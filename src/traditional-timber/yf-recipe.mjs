import { YF_RULES, YF_RULES_HASH, YF_PRESET, resolveYfParameters, yfUnits } from './yf-rules.mjs';
import { YfBuilder } from './solids.mjs';
import { hallLayout, buildFrame } from './frame.mjs';
import { buildEnclosure } from './joinery.mjs';
import { buildRoof } from './roof.mjs';
import { buildSubsidiary } from './subsidiary.mjs';
import { buildRidges } from './ridges.mjs';
import { buildTerminals } from './terminals.mjs';
import { buildChiwei } from './chiwei.mjs';
import { DETAIL_MATERIALS } from '../detailed-modeling/recipes.mjs';

export function buildYfRecipe({id=YF_PRESET,parameters={},allowUnresolvedDraft=false,legacyRendering=false}={}){
 if(!/^[A-Za-z0-9_-]+$/.test(id))throw new Error('Invalid YF assembly id');
 if(!['frozen','released'].includes(YF_RULES.status)&&!allowUnresolvedDraft)throw new Error('YF_RULES_NOT_RELEASE_READY: bearing and corner construction remain under source reconciliation');
 const p=resolveYfParameters(parameters),u=yfUnits(p),l=hallLayout(p,u),b=new YfBuilder(id,YF_RULES);
 b.legacyRendering=legacyRendering;
 const frame=buildFrame(b,p,u,l,{allowUnresolvedDraft}),enclosure=buildEnclosure(b,p,u,l),roof=buildRoof(b,p,u,l);
 const subsidiary=buildSubsidiary(b,p,u,l),ridges=buildRidges(b,p,u,l),chiwei=buildChiwei(b,p,u,l),terminals=buildTerminals(b,p,u,l);
 b.group('root',()=>[frame,enclosure,roof,subsidiary,ridges,chiwei,terminals],'yingzao_fashi_dian');
 return {root_id:id,parts:b.parts,parameters:p,materials:[...DETAIL_MATERIALS,{name:'Detail_RoofTile',color:'#666461'}],
  anchors:b.anchors,measurements:{kind:'rule_expected_values',chi_mm:u.chi,main_fen_mm:u.fen,
   subsidiary_fen_mm:u.subsidiary_fen,main_column_grid_width_mm:l.width,main_column_grid_depth_mm:l.depth,
   main_liaoyan_back_mm:l.height+l.seats.liaoyanBack*u.fen,middle_bay_width_mm:p.middle_bay_chi*u.chi},
  provenance:{rule_id:YF_PRESET,rule_version:YF_RULES.version,rule_hash:YF_RULES_HASH,status:YF_RULES.status,
   parameters:p,rendering_version:legacyRendering?'timber-render.v1':'timber-render.v2',tile_representation:p.tile_detail,side_elevation:YF_RULES.side_elevation,accuracy:'source_bounded_reconstruction_with_declared_choices',native_acceptance:'requires_current_model_evidence'},
  recipe_signature:YF_RULES_HASH};
}
