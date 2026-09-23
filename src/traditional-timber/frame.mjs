import { YF_RULES, columnRiseChi, roofSupportBacks } from './yf-rules.mjs';
import { ringsMesh } from './solids.mjs';
import { moonBeam, saddleBeam } from './beams.mjs';
import { bracket, bracketSeats } from './brackets.mjs';

export function hallLayout(p,u) {
  const widths=[p.side_bay_chi,p.side_bay_chi,p.middle_bay_chi,p.side_bay_chi,p.side_bay_chi].map(v=>v*u.chi);
  const width=widths.reduce((a,b)=>a+b,0), depth=8*p.step_chi*u.chi, height=p.column_height_chi*u.chi;
  const grid=[-width/2];for(const w of widths)grid.push(grid.at(-1)+w);
  const tops=grid.map((x,i)=>({x:x-Math.sign(x)*height*.01,z:height+columnRiseChi(i)*u.chi}));
  const y=depth/2-height*.008, projection=60*u.fen, ex=tops.at(-1).x+projection, ey=y+projection;
  const ridgeHalf=ex-ey, step=p.step_chi*u.chi;
  const seats=bracketSeats(), eave=height+seats.liaoyanBack*u.fen;
  const supports=roofSupportBacks([step,step,step,y-3*step,projection],eave,2*ey/3);
  const riseAt=x=>{
    x=Math.abs(x);const pts=tops.filter(t=>t.x>=0);
    if(x<=pts[0].x)return 0;
    for(let i=1;i<pts.length;i++)if(x<=pts[i].x)return pts[i-1].z-height+(pts[i].z-pts[i-1].z)*(x-pts[i-1].x)/(pts[i].x-pts[i-1].x);
    return pts.at(-1).z-height;
  };
  const roofZ=(x,y)=>{
    const d=Math.max(Math.abs(y),Math.abs(x)-ridgeHalf,0);
    let i=1;while(i<supports.length-1&&d>supports[i].distance)i++;
    const a=supports[i-1],z=supports[i];
    return a.z+(z.z-a.z)*(d-a.distance)/(z.distance-a.distance)+riseAt(x);
  };
  return {widths,width,depth,height,grid,tops,y,ex,ey,ridgeHalf,supports,roofZ,riseAt,seats,innerY:step};
}

function column(b,key,base,top,radius,fen,{corner=false}={}) {
  // Horizontal head and foot planes, with side-foot inclination in their
  // centers. The upper third is divided into thirds for the shuttle profile.
  const ludouFoot=(corner?28:24)*fen, shoulder=(ludouFoot+8*fen)/(2*radius);
  const tightAt=1-4*fen/(top[2]-base[2]);
  const sections=[[0,1],[2/3,1],[7/9,1-(1-shoulder)/3],
    [8/9,1-2*(1-shoulder)/3],[tightAt,shoulder],[1,ludouFoot/(2*radius)]];
  const rings=sections.map(([t,r])=>Array.from({length:20},(_,i)=>{
    const angle=2*Math.PI*i/20;
    return [base[0]+(top[0]-base[0])*t+radius*r*Math.cos(angle),base[1]+(top[1]-base[1])*t+radius*r*Math.sin(angle),base[2]+(top[2]-base[2])*t];
  }));
  const shaft=ringsMesh(rings);
  if(!b.legacyRendering){shaft.smooth='cad';shaft.cad_faces=shaft.faces.map((_,i)=>i<36?1+i%2:0);}
  const body=b.mesh(`${key}-shaft`,shaft,'shuttle_column','Detail_Oak','YF5:6a–7a;FIG:PDF380');
  const stone=b.leaf(`${key}-stone`,'lofted_solid',{origin:[base[0],base[1],-4*fen],profile:[[0,radius*1.4],[fen,radius*1.4],[2*fen,radius*1.2],[4*fen,radius*1.05]],segments:20,smooth:'all'},'column_stone','Detail_Stone','selected plain base profile; FIG13');
  return b.group(key,()=>[body,stone],'column');
}

export function buildFrame(b,p,u,l,{allowUnresolvedDraft=false}={}) {
  // Do not silently promote an unresolved seat schedule to a sourced hall.
  if(!allowUnresolvedDraft&&!['frozen','released'].includes(YF_RULES.status))throw new Error('YF_FRAME_UNRESOLVED: mingfu/caofu bearing schedule is not ready for a release model');
  const f=u.fen, s=u.subsidiary_fen, C=u.chi, c=[];
  const ordinary=bracket(b,'main-column-bracket',f);
  const riding=bracket(b,'main-riding-column-bracket',f,{beamBearing:true});
  const infill=bracket(b,'main-intercolumn-bracket',f,{intercolumn:true});
  const internal=bracket(b,'main-inner-bracket',f,{innerOnly:true,beamBearing:true});
  const corner=bracket(b,'main-corner-bracket',f,{corner:true});
  for(let i=0;i<l.grid.length;i++)for(const side of [-1,1]){
    const top=[l.tops[i].x,side*l.y,l.tops[i].z], key=`main-column-${i}-${side}`;
    c.push(b.at(column(b,key,[l.grid[i],side*l.depth/2,0],top,43.5*f/2,f,{corner:i===0||i===5}),key));
    c.push(b.at(i===0||i===5?corner:riding,`${key}-bracket`,top,(i===0||i===5)?(i===5?(side>0?0:270):(side>0?90:180)):(side>0?0:180)));
    b.anchor(`${key}-head`,top);
  }
  // One interior longitudinal column line, never a mirrored pair of lines.
  for(let i=1;i<5;i++){
    const x=l.tops[i].x, key=`inner-column-${i}`, top=[x,l.innerY,l.tops[i].z];
    c.push(b.at(column(b,key,[l.grid[i],l.innerY,0],top,43.5*f/2,f),key));
    c.push(b.at(internal,`${key}-bracket`,top));
  }
  for(const side of [-1,1])for(let i=0;i<5;i++){
    const a=l.tops[i],d=l.tops[i+1], key=`main-bay-${i}-${side}`;
    c.push(b.beam(`${key}-lane`,[a.x,side*l.y,a.z-15*f],[d.x,side*l.y,d.z-15*f],20*f,30*f,'lane','Detail_Oak','YF5:lan-e'));
    const n=i===2?2:1;
    for(let j=1;j<=n;j++){
      const t=j/(n+1), x=a.x+(d.x-a.x)*t, z=a.z+(d.z-a.z)*t;
      // All ludou bottoms share the column-head datum. The single-cai
      // intercolumn hua obtains its upper seat from its separate qi.
      c.push(b.at(infill,`${key}-intercolumn-${j}`,[x,side*l.y,z],side>0?0:180));
    }
  }
  for(const side of [-1,1]){
    const x=side*l.tops.at(-1).x, z=l.height+.4*C;
    c.push(b.beam(`end-lane-${side}`,[x,-l.y,z-15*f],[x,l.y,z-15*f],20*f,30*f,'lane','Detail_Oak','YF5:lan-e'));
    for(const y of [-2*p.step_chi*C,0,2*p.step_chi*C]){
      const key=`end-column-${side}-${y/C}`;
      c.push(b.at(column(b,key,[side*l.width/2,y,0],[x,y,z],43.5*f/2,f),key));
      c.push(b.at(ordinary,`${key}-bracket`,[x,y,z],side>0?-90:90));
    }
  }
  // The caofu datum is carried by real longitudinal members. The wall
  // man-gong/small-dou top is 54 fen; two 15-fen fangs bring it to 84.
  for(const [name,y]of [['front',l.y],['rear',-l.y],['inner',l.innerY]]){
    const first=name==='inner'?1:0,last=name==='inner'?4:5;
    for(let i=first;i<last;i++)for(const [role,base]of [['column_head_fang',54],['ya_cao_fang',69]]){
      const a=l.tops[i],z=l.tops[i+1];
      c.push(b.beam(`${name}-${role}-${i}`,[a.x,y,a.z+(base+7.5)*f],[z.x,y,z.z+(base+7.5)*f],10*f,15*f,role,'Detail_Oak','YF4:13a;YF5:4a; selected paired fang seat schedule'));
    }
  }
  for(const side of [-1,1])for(const [role,base]of [['column_head_fang',54],['ya_cao_fang',69]]){
    const x=side*l.tops.at(-1).x,z=l.height+.4*C+(base+7.5)*f;
    c.push(b.beam(`end-${role}-${side}`,[x,-l.y,z],[x,l.y,z],10*f,15*f,role,'Detail_Oak','YF5:4a; return of selected fang bearing'));
  }
  // Mingfu support the ceiling layer. Caofu above them bear the purlins;
  // their long/short split follows the single off-center column line.
  for(let i=1;i<5;i++){
    const x=l.tops[i].x,frameDatum=l.tops[i].z,mingTop=frameDatum+75*f;
    for(const [tag,a,d,h]of [['long',-l.y,l.innerY,42],['short',l.innerY,l.y,42]]){
      c.push(b.at(moonBeam(b,`mingfu-${i}-${tag}`,a,d,mingTop-h*f,h,f),`mingfu-${i}-${tag}-placed`,[x,0,0],90));
    }
    // Wall man-gong top 48 + small-dou body 6 + column-head fang 15
    // + selected ya-cao fang 15 = 84 fen. The short beam matches the opposing
    // main beam by YF5's same-depth provision. This is a declared reconstruction.
    const caobottom=frameDatum+84*f, z=caobottom+45*f;
    const seats=[-l.y,l.y].map(y=>({x:y,z:l.roofZ(x,y)-12.75*f}));
    c.push(b.at(saddleBeam(b,`caofu-${i}`,-l.ey,l.ey,caobottom,45,f,seats,21),`caofu-${i}-placed`,[x,0,0],90));
    b.anchor(`beam-layer-${i}`,[x,l.innerY,caobottom]);
    // Upper six-, four- and two-rafter beams stand on short posts rather
    // than being held by a single full-height ridge pillar.
    let below=z;
    for(let level=3;level>=1;level--){
      const d=l.supports[level].distance, purlinBack=l.supports[level].z+l.riseAt(x);
      const h=(level===1?30:42)*f, bottom=Math.max(below,purlinBack-25.5*f-h);
      if(Math.abs(x)>l.ridgeHalf+d)continue;
      for(const sign of [-1,1])if(bottom>below)c.push(b.beam(`shortpost-${i}-${level}-${sign}`,[x,sign*d,below],[x,sign*d,bottom],18*f,18*f,'short_post','Detail_Oak','YF5:shuzhu;FIG13'));
      c.push(b.at(saddleBeam(b,`upper-beam-${i}-${level}`,-d-20*f,d+20*f,bottom,h/f,f,
        [-d,d].map(y=>({x:y,z:purlinBack-12.75*f}))),`upper-beam-${i}-${level}-placed`,[x,0,0],90));
      below=bottom+h;
    }
    if(Math.abs(x)<=l.ridgeHalf){
      const ridgeBottom=l.roofZ(x,0)-25.5*f;
      c.push(b.beam(`ridge-post-${i}`,[x,0,below],[x,0,ridgeBottom],18*f,18*f,'ridge_post','Detail_Oak','FIG13'));
      for(const sign of [-1,1])c.push(b.beam(`ridge-fork-${i}-${sign}`,[x,sign*l.supports[1].distance,below],[x,sign*8*f,ridgeBottom],10*f,15*f,'ridge_fork_brace','Detail_Oak','YF5:tuojiao;FIG13'));
    }
  }
  // End-wall dingfu tie each end column into the nearest transverse frame.
  // Their bearing plane follows the same column rise as the longitudinal fang.
  // This closes the previously unsupported return roof instead of relying on
  // purlins and a long hip beam to span the whole end bay by themselves.
  for(const sx of [-1,1]){
    const frameIndex=sx>0?4:1,innerX=Math.abs(l.tops[frameIndex].x),outerX=l.tops.at(-1).x;
    const innerBottom=l.tops[frameIndex].z+84*f,outerBottom=l.tops.at(-1).z+84*f;
    const bottomAt=x=>innerBottom+(outerBottom-innerBottom)*(x-innerX)/(outerX-innerX);
    for(const y of [-2*p.step_chi*C,0,2*p.step_chi*C]){
      const endBottom=bottomAt(l.ex),key=`end-dingfu-${sx}-${y/C}`;
      const ref=saddleBeam(b,key,innerX,l.ex,innerBottom,45,f,
        [{x:outerX,z:l.roofZ(outerX,y)-12.75*f}],21,endBottom);
      c.push(b.at(ref,`${key}-placed`,[0,y,0],sx>0?0:180));
      for(let j=1;j<4;j++){
        const d=l.supports[j].distance,x=l.ridgeHalf+d;
        if(x<innerX||Math.abs(y)>d)continue;
        const foot=bottomAt(x)+45*f,top=l.roofZ(x,y)-25.5*f;
        if(top>foot)c.push(b.beam(`${key}-post-${j}`,[sx*x,y,foot],[sx*x,y,top],18*f,18*f,
          'end_roof_short_post','Detail_Oak','YF5:4a end dingfu; project-selected return purlin supports'));
      }
    }
    for(const sy of [-1,1]){
      const a=[sx*innerX,sy*l.y,l.tops[frameIndex].z+129*f],z=[sx*outerX,sy*2*p.step_chi*C,l.tops.at(-1).z+129*f];
      c.push(b.beam(`corner-tie-${sx}-${sy}`,a.map((v,i)=>i===2?v-9*f:v),z.map((v,i)=>i===2?v-9*f:v),20*f,18*f,
        'mojiao_fu','Detail_Oak','YF5:4a mojiao above end dingfu meeting transverse caofu; selected18x20fen'));
      const t=(l.y-innerX+l.ridgeHalf)/(outerX-innerX+l.y-2*p.step_chi*C);
      const cross=a.map((v,i)=>v+t*(z[i]-v));
      const roof=l.roofZ(cross[0],cross[1]),bearing=roof-15*f;
      if(bearing>cross[2])c.push(b.beam(`corner-bearing-${sx}-${sy}`,cross,[cross[0],cross[1],bearing],19*f,19*f,
        'hidden_hip_bearing','Detail_Oak','YF5:4a hidden corner bearing; height derived from shared roof surface'));
    }
  }
  // Purlin backs share the same coordinates as the roof surface. Liao-yan
  // fang takes the outermost position, with no duplicate round purlin there.
  for(const [j,pt]of l.supports.entries())for(const side of j===0?[1]:[-1,1]){
    const d=pt.distance, extent=l.ridgeHalf+d, y=side*d;
    const xs=[-extent,...l.tops.map(t=>t.x).filter(x=>Math.abs(x)<extent),extent];
    for(let k=1;k<xs.length;k++){
      const a=[xs[k-1],y,l.roofZ(xs[k-1],y)],z=[xs[k],y,l.roofZ(xs[k],y)];
      if(j===5)c.push(b.beam(`liaoyan-${side}-${k}`,a.map((v,i)=>i===2?v-15*f:v),z.map((v,i)=>i===2?v-15*f:v),10*f,30*f,'liaoyan_fang','Detail_Oak','YF5:liaoyan'));
      else c.push(b.pipe(`purlin-${j}-${side}-${k}`,a.map((v,i)=>i===2?v-12.75*f:v),z.map((v,i)=>i===2?v-12.75*f:v),12.75*f,'purlin','Detail_Oak','YF5:purlin selected diameter25.5fen'));
    }
    if(j>0)for(const end of [-1,1]){
      const x=end*extent, z=l.roofZ(x,d);
      if(j===5)c.push(b.beam(`end-liaoyan-${end}-${side}`,[x,side<0?-d:0,z-15*f],[x,side<0?0:d,z-15*f],10*f,30*f,'liaoyan_fang','Detail_Oak','YF5:liaoyan'));
      else c.push(b.pipe(`end-purlin-${j}-${end}-${side}`,[x,side<0?-d:0,z-12.75*f],[x,side<0?0:d,z-12.75*f],12.75*f,'purlin','Detail_Oak','YF5:purlin'));
    }
  }
  const gallery=p.subsidiary_width_chi*C, subheight=p.subsidiary_column_height_chi*C;
  const sub=bracket(b,'subsidiary-bracket',s,{subsidiary:true});
  const subcorner=bracket(b,'subsidiary-corner-bracket',s,{subsidiary:true,corner:true});
  const subgrid=[-l.width/2-gallery,...l.grid,l.width/2+gallery];
  for(const side of [-1,1])for(let i=0;i<subgrid.length;i++){
    const x=subgrid[i], y=side*(l.depth/2+gallery), key=`subsidiary-column-${i}-${side}`;
    const top=[x-Math.sign(x)*subheight*.01,y-side*subheight*.008,subheight];
    c.push(b.at(column(b,key,[x,y,0],top,43.5*s/2,s,{corner:i===0||i===subgrid.length-1}),key),b.at(i===0||i===subgrid.length-1?subcorner:sub,`${key}-bracket`,top,i===0?(side>0?90:180):i===subgrid.length-1?(side>0?0:270):side>0?0:180));
    if(i>0)c.push(b.beam(`${key}-lane`,[subgrid[i-1]-Math.sign(subgrid[i-1])*subheight*.01,top[1],subheight-15*s],[top[0],top[1],subheight-15*s],20*s,30*s,'subsidiary_lane','Detail_Oak','YF5'));
  }
  for(const side of [-1,1]){
    const x=side*(l.width/2+gallery-subheight*.01),extent=l.depth/2+gallery-subheight*.008;
    c.push(b.beam(`subsidiary-end-lane-${side}`,[x,-extent,subheight-15*s],[x,extent,subheight-15*s],20*s,30*s,'subsidiary_lane','Detail_Oak','YF5:lan-e; closed return at subsidiary corner columns'));
  }
  for(const side of [-1,1])for(const y of [-l.depth/2,0,l.depth/2]){
    const x=side*(l.width/2+gallery),key=`subsidiary-end-${side}-${y/C}`,top=[x-side*subheight*.01,y,subheight];
    c.push(b.at(column(b,key,[x,y,0],top,43.5*s/2,s),key),b.at(sub,`${key}-bracket`,top,side>0?-90:90));
  }
  return b.group('frame',()=>c,'timber_frame');
}
