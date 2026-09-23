import { ringsMesh } from './solids.mjs';
import { roofSurfaceLayout } from './roof.mjs';
import { subsidiaryLayout } from './subsidiary.mjs';

// Text fixes the selected five-bay heights/counts. Plain project silhouettes
// preserve head/body/wing/tail masses; facial and feather relief is omitted.
// These are explicitly not replicas of a particular excavated ceramic object.
export function buildTerminals(b,p,u,l){
 const C=u.chi,c=[];
 const ellipsoid=(key,center,radii,role)=>{
  const rings=Array.from({length:9},(_,j)=>{
   const a=-Math.PI/2+.015+(Math.PI-.03)*j/8;
   return Array.from({length:16},(_,i)=>{const t=i*Math.PI/8;return [center[0]+radii[0]*Math.cos(a)*Math.cos(t),center[1]+radii[1]*Math.cos(a)*Math.sin(t),center[2]+radii[2]*Math.sin(a)];});
  });
  return b.leaf(key,'mesh',{...ringsMesh(rings),construction:'bulk',smooth:'all'},role,'Detail_RoofTile','YF13:8b; project plain ceramic masses, relief omitted');
 };
 const beastOutline=[[0,0],[.88,0],[.9,.25],[1,.38],[.98,.62],[.84,.66],[.80,.86],[.66,1],[.49,.94],[.42,.67],[.38,.43],[.20,.56],[.05,.48],[.14,.29]];
 const beast=(key,height)=>b.leaf(key,'profile_extrude',{origin:[0,-height*.24,0],plane:'xz',outer:beastOutline.map(([x,z])=>[(x-.5)*height,z*height]),depth:height*.48},'seated_beast','Detail_RoofTile','YF13:8b; selected crouched quadruped silhouette, carved detail omitted');
 const seated=beast('corner-seated-beast',.8*C),ridgeBeast=beast('main-hip-ridge-beast',3.5*C);
 const bird=b.group('corner-pinga',()=>{
  const parts=[ellipsoid('pinga-body',[-.08*C,0,.40*C],[.36*C,.23*C,.32*C],'pinga_body'),
   ellipsoid('pinga-head',[.25*C,0,.97*C],[.17*C,.17*C,.23*C],'pinga_human_head')];
  for(const side of [-1,1])parts.push(b.leaf(`pinga-wing-${side}`,'profile_extrude',{origin:[0,side*.2*C,0],plane:'xz',outer:[[-.48,.12],[-.60,.55],[-.42,.82],[-.18,.64],[.12,.38],[.02,.23]].map(q=>q.map(v=>v*C)),depth:.055*C},'pinga_wing','Detail_RoofTile','YF13:pinga1.2chi; selected human-headed bird with plain wings'));
  parts.push(b.box('pinga-base',[-.25*C,-.22*C,0],[.5*C,.44*C,.12*C],'pinga_base','Detail_RoofTile','selected plain mounting base'));
  return parts;
 },'pinga');
 const sleeve=b.group('corner-beast-sleeve',()=>[
  ellipsoid('sleeve-head',[0,0,0],[.38*C,.4*C,.4*C],'beam_beast_head'),
  ellipsoid('sleeve-muzzle',[.3*C,0,-.03*C],[.18*C,.29*C,.23*C],'beam_beast_muzzle')
 ],'beam_beast_sleeve');
 const flame=b.leaf('corner-flame-pearl','profile_extrude',{origin:[0,-.09*C,0],plane:'xz',outer:[[-.24,0],[.24,0],[.30,.19],[.20,.32],[.22,.51],[.08,.42],[0,.6],[-.12,.37],[-.23,.45],[-.20,.29],[-.3,.18]].map(q=>q.map(v=>v*C)),depth:.18*C},'flame_pearl','Detail_RoofTile','YF13:8b .6chi fire pearl; project plain flame silhouette');
 for(const subsidiary of [false,true]){
  const layout=subsidiary?subsidiaryLayout(p,u,l):l;
  const {outer,localPoint,rafter,board,f}=roofSurfaceLayout(u,layout,{subsidiary});
  const layers=subsidiary?9:33,cover=rafter+board+.585*C;
  for(const sx of [-1,1])for(const sy of [-1,1]){
   const key=`${subsidiary?'sub':'main'}-terminal-${sx}-${sy}`,angle=Math.atan2(sy,sx)*180/Math.PI;
   const at=(ref,name,d,zOffset)=>{const q=localPoint(layout.ridgeHalf+d,d);c.push(b.at(ref,`${key}-${name}`,[sx*q[0],sy*q[1],q[2]+zOffset],angle));};
   at(sleeve,'sleeve',outer,-13*f);
   at(flame,'fire-pearl',outer,cover);
   at(bird,'pinga',outer-.55*C,cover+layers*.09*C+.325*C);
   for(let i=0;i<4;i++)at(seated,`seated-${i}`,outer-(1.5+i*.95)*C,cover+layers*.09*C+.325*C);
   if(!subsidiary)at(ridgeBeast,'ridge-beast',layout.ey,cover+layers*.09*C+.325*C);
  }
 }
 return b.group('eave-terminals',()=>c,'eave_terminals');
}
