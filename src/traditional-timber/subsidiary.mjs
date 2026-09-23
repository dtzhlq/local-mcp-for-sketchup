import { bracketSeats, dou } from './brackets.mjs';
import { buildRoof } from './roof.mjs';
import { moonBeam } from './beams.mjs';

// The subsidiary roof is an annulus, never a second complete hip roof hidden
// inside the main hall. These selected supports remain development geometry
// until their wall bearing construction is reconciled with FIG13.
export function subsidiaryLayout(p,u,l){
 const C=u.chi,f=u.subsidiary_fen,h=p.subsidiary_column_height_chi*C;
 const inner=l.depth/2, columnY=inner+p.subsidiary_width_chi*C-h*.008;
 const ey=columnY+30*f,ridgeHalf=(l.width-l.depth)/2-h*.002;
 const low=h+bracketSeats({subsidiary:true}).liaoyanBack*f;
 const span=ey-inner,high=low+span/2;
 const supports=[{distance:inner,z:high},{distance:inner+span/2,z:(high+low)/2-.1*(high-low)},{distance:ey,z:low}];
 const roofZ=(x,y)=>{
  const d=Math.max(Math.abs(y),Math.abs(x)-ridgeHalf,inner);
  const a=d<supports[1].distance?supports[0]:supports[1],b=d<supports[1].distance?supports[1]:supports[2];
  return a.z+(b.z-a.z)*(d-a.distance)/(b.distance-a.distance);
 };
 return {ey,ex:ridgeHalf+ey,ridgeHalf,supports,roofZ,riseAt:()=>0,tops:l.tops,columnY,inner,height:h};
}

export function buildSubsidiary(b,p,u,l){
 const s=subsidiaryLayout(p,u,l),f=u.subsidiary_fen,c=[];
 for(const [i,pt]of s.supports.entries())for(const side of [-1,1]){
  const e=s.ridgeHalf+pt.distance,back=pt.z;
  for(const end of [-1,1]){
   const a=end<0?[-e,side*pt.distance,back]:[side*e,-pt.distance,back];
   const z=end<0?[e,side*pt.distance,back]:[side*e,pt.distance,back];
   if(i===2)c.push(b.beam(`sub-liaoyan-${side}-${end}`,a.map((v,k)=>k===2?v-15*f:v),z.map((v,k)=>k===2?v-15*f:v),10*f,30*f,'subsidiary_liaoyan','Detail_Oak','YF5:liaoyan; FIG13 subsidiary bearing'));
   else c.push(b.pipe(`sub-purlin-${i}-${side}-${end}`,a.map((v,k)=>k===2?v-12.75*f:v),z.map((v,k)=>k===2?v-12.75*f:v),12.75*f,'subsidiary_purlin','Detail_Oak','YF5:purlin; selected subsidiary support interval'));
  }
 }
 // Transverse gallery beams run into the main wall-side bearing. Their
 // radial geometry is shared by front/back and the end galleries.
 const addBay=(key,map)=>{
  const start=s.inner,end=s.columnY-30*f,bottom=s.height+33*f,bodyTop=bottom+30*f;
  const beam=moonBeam(b,'subsidiary-transverse-beam',start,end,bottom,30,f);
  c.push(b.at(beam,`${key}-beam`,map.origin,map.angle));
  const point=(d,z)=>{const a=map.angle*Math.PI/180;return [map.origin[0]+d*Math.cos(a),map.origin[1]+d*Math.sin(a),z];};
  // Wall-end support is visible beneath the beam. Its concealed tenon
  // enters the main column; the exposed stub/dou is the selected FIG13 reading.
  const corbel=b.profile('subsidiary-wall-corbel',[[s.inner-16*f,bottom-18*f],[s.inner+24*f,bottom-18*f],
    [s.inner+28*f,bottom-12*f],[s.inner+24*f,bottom-6*f],[s.inner-16*f,bottom-6*f]],10*f,'wall_corbel','FIG13:wall-mounted subsidiary bearing; selected visible shoulder, hidden tenon simplified');
  c.push(b.at(corbel,`${key}-wall-corbel`,map.origin,map.angle));
  c.push(b.at(dou(b,'subsidiary-wall-bearing-dou','jiaohu',f),`${key}-wall-dou`,point(s.inner+12*f,bottom-6*f),map.angle));
  for(const [i,pt]of s.supports.entries()){
   if(i===2)continue; // outer liaoyan is carried by the four-puzuo head
   const foot=i===0?bottom+21*f:bodyTop,top=pt.z-25.5*f;
   if(top<=foot)throw new Error('YF_SUBSIDIARY_BEARING_UNRESOLVED: purlin does not clear its beam');
   c.push(b.beam(`${key}-post-${i}`,point(pt.distance,foot),point(pt.distance,top),16*f,16*f,'subsidiary_short_post','Detail_Oak','FIG13:subsidiary beam/post topology; selected support seats'));
  }
 };
 for(const side of [-1,1])for(let i=0;i<l.grid.length;i++)addBay(`sub-bay-${side}-${i}`,{origin:[l.grid[i]-Math.sign(l.grid[i])*s.height*.01,0,0],angle:side*90});
 for(const side of [-1,1])for(const y of [-l.depth/2,0,l.depth/2])addBay(`sub-end-bay-${side}-${y}`,{origin:[side*s.ridgeHalf,y,0],angle:side>0?0:180});
 // Rafters, fly rafters, boards and tiles all consume this one support surface.
 c.push(buildRoof(b,p,u,s,{subsidiary:true}));
 b.anchor('subsidiary-inner-roof-back',[0,s.inner,s.supports[0].z]);
 b.anchor('subsidiary-outer-roof-back',[0,s.ey,s.supports.at(-1).z]);
 return b.group('subsidiary-roof-frame',()=>c,'subsidiary_roof_frame');
}
