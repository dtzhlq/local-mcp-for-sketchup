import { YF_RULES } from './yf-rules.mjs';

// Comparative silhouette: the right ridge terminal in Zhao Ji's Ruihe Tu.
// This is a project-drawn outline, NOT a pixel-scaled survey. YF13 supplies
// height; width, depth and the omitted carved relief remain explicit choices.
export function buildChiwei(b,p,u,l){
 const C=u.chi,H=YF_RULES.rules.ridge.chiwei_height_chi*C,W=4.2*C,D=1.15*C;
 const outline=[[.16,0],[.86,0],[.94,.20],[.88,.42],[.84,.66],[.82,.79],[.72,.91],[.51,.96],[.03,1],
  [.12,.87],[.31,.82],[.52,.74],[.60,.62],[.57,.43],[.44,.38],[.25,.38],[.12,.32],[.14,.25],[.31,.20],[.17,.12]];
 const terminal=b.group('chiwei-terminal',()=>{
  const c=[b.leaf('chiwei-body','profile_extrude',{origin:[0,-D/2,0],plane:'xz',outer:outline.map(([x,z])=>[(x-.75)*W,z*H]),depth:D},'chiwei','Detail_RoofTile','YF13:height7–7.5chi, selected7.25; RuiheTu comparative outline; width/depth selected; relief omitted')];
  // Iron supports and the five-pronged bird deterrent prescribed for terminals
  // above three chi. Their cross-sections are selected assembly details.
  const z0=.45*H,z1=1.03*H,x=-.15*W;
  c.push(b.pipe('chiwei-iron-mast',[x,0,z0],[x,0,z1],.025*C,'chiwei_iron_support','Detail_Aluminium','YF13:6b–7a; selected iron section'));
  for(let i=-2;i<=2;i++)c.push(b.pipe(`chiwei-bird-fork-${i}`,[x,0,z1],[x+i*.13*C,0,z1+.35*C-Math.abs(i)*.05*C],.015*C,'chiwei_bird_deterrent','Detail_Aluminium','YF13:five-pronged deterrent; selected prong lengths'));
  for(const side of [-1,1])c.push(b.pipe(`chiwei-iron-brace-${side}`,[.1*W,side*D/2,.12*H],[x,side*D/2,.70*H],.025*C,'chiwei_iron_brace','Detail_Aluminium','YF13:iron supports; selected exposed brace'));
  return c;
 },'chiwei_terminal');
 const z=l.roofZ(l.ridgeHalf,0)+9.5*u.fen+.665*C;
 return b.group('chiwei',()=>[-1,1].map(sign=>b.at(terminal,`chiwei-${sign}`,[sign*l.ridgeHalf,0,z],sign>0?0:180)),'paired_chiwei');
}
