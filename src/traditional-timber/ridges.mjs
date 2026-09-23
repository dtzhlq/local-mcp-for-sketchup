import { ringsMesh } from './solids.mjs';
import { reusable, tileRibbon, roofSurfaceLayout } from './roof.mjs';
import { YF_RULES } from './yf-rules.mjs';
import { subsidiaryLayout } from './subsidiary.mjs';

// Layer counts, taper and width are prescribed/selected independently. A layer
// is NOT a material fen. The selected fired tile thickness plus mortar joint
// below is recorded separately, because YF13 counts layers rather than giving
// the resulting total millimetre height.
export function buildRidges(b,p,u,l){
 const C=u.chi,f=u.fen,c=[],pitch=.09*C,tile=.08*C;
 const roofCover=9.5*f+.08*C+.10*C+.485*C;
 const make=(key,path,layers,width,taper)=>{
  const children=[];
  for(let layer=0;layer<layers;layer++){
   const w=layer===0?width+.7*C:width*(1-taper*layer/(layers-1));
   for(let j=1;j<path.length;j++){
    const a=path[j-1],z=path[j],length=Math.hypot(z[0]-a[0],z[1]-a[1]);
    const n=Math.max(1,(p.tile_detail==='detailed'?Math.ceil(length/(1.3*C)):1));
    const normal=[-(z[1]-a[1])/length,(z[0]-a[0])/length];
    for(let k=0;k<n;k++){
     const point=t=>a.map((v,i)=>v+(z[i]-v)*t);
     const A=point(k/n),B=point((k+1)/n),bottom=layer*pitch;
     const ring=v=>[[-1,0],[1,0],[1,tile],[-1,tile]].map(([side,h])=>[v[0]+side*normal[0]*w/2,v[1]+side*normal[1]*w/2,v[2]+bottom+h]);
     children.push(reusable(b,ringsMesh([ring(A),ring(B)]),'ridge_course','Detail_RoofTile','YF13:4b–5b layer count/taper; selected .08chi tile + .01chi mortar',`${key}-course-${layer}-${j}-${k}`));
    }
   }
  }
  for(let j=1;j<path.length;j++){
   const a=path[j-1],z=path[j],length=Math.hypot(z[0]-a[0],z[1]-a[1]);
   const tangent=[(z[0]-a[0])/length,(z[1]-a[1])/length],normal=[-tangent[1],tangent[0]];
   const point=(x,d)=>[a[0]+d*tangent[0]+x*normal[0],a[1]+d*tangent[1]+x*normal[1],a[2]+(z[2]-a[2])*d/length+layers*pitch];
   for(let d=0,k=0;d<length;d+=.84*C,k++){
    const cap=tileRibbon(point,-.325*C,.65*C,d,Math.min(length,d+1.4*C),()=>0,t=>.325*C*Math.sin(Math.PI*t),.06*C,{smooth:!b.legacyRendering,sections:p.tile_detail==='detailed'?8:4});
    if(cap)children.push(reusable(b,cap,'ridge_cap_tile','Detail_RoofTile','YF13:matching cover tile above ridge courses',`${key}-cap-${j}-${k}`));
   }
   for(const [name,level,w]of [['lower',pitch,width+.7*C],['upper',layers*pitch,width*(1-taper)]]){
    const ring=p=>[[-1,0],[1,0],[1,.01*C],[-1,.01*C]].map(([side,h])=>[p[0]+side*normal[0]*w/2,p[1]+side*normal[1]*w/2,p[2]+level-.01*C+h]);
    children.push(reusable(b,ringsMesh([ring(a),ring(z)]),'ridge_white_mortar','Detail_Plaster','YF13:white courses above xiandao and below ridge cap; selected .01chi joint',`${key}-white-${name}-${j}`));
   }
  }
  return b.group(key,()=>children,'tiled_ridge');
 };
 const topAt=(x,y)=>l.roofZ(x,y)+roofCover;
 const xs=[-l.ridgeHalf,...l.tops.map(t=>t.x).filter(x=>Math.abs(x)<l.ridgeHalf),l.ridgeHalf];
 c.push(make('main-ridge',xs.map(x=>[x,0,topAt(x,0)]),YF_RULES.rules.ridge.main_layers,.9*C,.2));
 // Match the roof's terminal growth and uplift; cover the cut-tile seam all
 // the way to the corner, including the outer fly-rafter segment.
 for(const subsidiary of [false,true]){
  const layout=subsidiary?subsidiaryLayout(p,u,l):l;
  const {outer,overhang,localPoint,rafter,board}=roofSurfaceLayout(u,layout,{subsidiary});
  const cover=rafter+board+.585*C,layers=subsidiary?9:YF_RULES.rules.ridge.hip_layers;
  for(const sx of [-1,1])for(const sy of [-1,1]){
   const ds=[...layout.supports.map(v=>v.distance),layout.ey+overhang,outer];
   const path=ds.map(d=>{const q=localPoint(layout.ridgeHalf+d,d);return [sx*q[0],sy*q[1],q[2]+cover];});
   c.push(make(`${subsidiary?'subsidiary-':''}hip-ridge-${sx}-${sy}`,path,layers,subsidiary?.5*C:.7*C,.1));
  }
 }
 b.anchor('main-ridge-top',[0,0,topAt(0,0)+YF_RULES.rules.ridge.main_layers*pitch]);
 return b.group('ridges',()=>c,'roof_ridges');
}
