import { YF_RULES } from './yf-rules.mjs';
import { ringsMesh } from './solids.mjs';

// YF4 4b–5a: intersect the successive straight cutting lines. In particular,
// four equally spaced points on ONE line are not four juansha facets.
export function juanshaEnvelope(facets, run, cut = 9) {
  const lines = Array.from({length:facets}, (_, i) => {
    const x = i * run, slope = (i + 1) * cut / facets / (facets * run - x);
    return { slope, intercept: -slope * x };
  });
  const points = [[0, 0]];
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1], b = lines[i], x = (a.intercept - b.intercept) / (b.slope - a.slope);
    points.push([x, a.slope * x + a.intercept]);
  }
  points.push([facets * run, cut]);
  return points;
}

export function gong(b, key, type, fen, { full = false, diagonal = false, bottomNotch = false, topNotch = true, length, minX = -Infinity, maxX = Infinity } = {}) {
  const r = YF_RULES.rules.gong.types[type], factor = diagonal ? Math.SQRT2 : 1;
  const half = (length ?? r.length) * factor / 2, height = full ? 21 : 15;
  const cut = juanshaEnvelope(r.facets, r.facet_run * factor);
  const run = r.facets * r.facet_run * factor;
  const bottom = cut.slice().reverse().map(([x,z]) => [-half + run - x,z]);
  if (bottomNotch) bottom.push([-10,0],[-10,5],[10,5],[10,0]);
  bottom.push(...cut.map(([x,z]) => [half - run + x,z]));
  // Exposed seats at the ends and middle; 3 fen gong eyes between them.
  const top = [[half,15],[half-12,15],[half-15,13],
    [13,height-3],[10,height],[4,height]];
  if(topNotch)top.push([4,height-10],[-4,height-10],[-4,height]);
  top.push([-10,height],[-13,height-3],[-half+15,13],[-half+12,15],[-half,15]);
  let outline=[...bottom,...top];
  for(const [bound,greater]of [[minX,true],[maxX,false]]){
    if(!Number.isFinite(bound))continue;
    const clipped=[];
    for(let i=0;i<outline.length;i++){
      const a=outline[i],z=outline[(i+1)%outline.length];
      const inside=p=>greater?p[0]>=bound:p[0]<=bound;
      if(inside(a))clipped.push(a);
      if(inside(a)!==inside(z)){const t=(bound-a[0])/(z[0]-a[0]);clipped.push([bound,a[1]+t*(z[1]-a[1])]);}
    }
    outline=clipped;
  }
  return b.profile(key,outline.map(p=>p.map(v=>v*fen)),10*fen,type,`YF4:gong:${type};FIG1:PDF378`);
}

export function dou(b,key,type,fen,{cross=true}={}) {
  const r=YF_RULES.rules.dou[type], scale=v=>v*fen;
  return b.group(key,()=>{
    const ring=(z,w,d)=>[[-w/2,-d/2,z],[w/2,-d/2,z],[w/2,d/2,z],[-w/2,d/2,z]].map(p=>p.map(scale));
    // A concave lower slope (one fen hollow) rather than an inverted pyramid.
    const core=b.mesh(`${key}-body`,ringsMesh([
      ring(0,r.width-2*r.inset,r.depth-2*r.inset),
      ring(r.incline/2,r.width-r.inset-2,r.depth-r.inset-2),
      ring(r.incline,r.width,r.depth),ring(r.incline+r.flat,r.width,r.depth)
    ]),'dou','Detail_Oak',`YF4:dou:${type}`);
    const children=[core], z=r.height-r.ear;
    for(const x of [-1,1])for(const y of cross?[-1,1]:[0]){
      const x0=x<0?-r.width/2:5, y0=y<0?-r.depth/2:y>0?5:-r.depth/2;
      const w=(r.width-10)/2,d=y===0?r.depth:(r.depth-10)/2;
      if(type!=='corner_ludou')children.push(b.box(`${key}-ear-${x}-${y}`,[x0,y0,z].map(scale),[w,d,r.ear].map(scale),'dou_ear','Detail_Oak',`YF4:dou:${type}`));
      else for(const side of [-1,1]){
        // The diagonal hua needs its own ten-fen-wide slot through the ears.
        // Simply placing it across four square ears causes exposed penetration.
        const polygon=[[x0,y0],[x0+w,y0],[x0+w,y0+d],[x0,y0+d]],out=[];
        const signed=p=>side*(p[0]-p[1])-5*Math.SQRT2;
        for(let i=0;i<polygon.length;i++){
          const a=polygon[i],b=polygon[(i+1)%polygon.length],da=signed(a),db=signed(b);
          if(da>=0)out.push(a);
          if((da>=0)!==(db>=0)){const t=da/(da-db);out.push(a.map((v,j)=>v+t*(b[j]-v)));}
        }
        if(out.length>=3)children.push(b.mesh(`${key}-ear-${x}-${y}-${side}`,ringsMesh([z,z+r.ear].map(h=>out.map(p=>[...p,h].map(scale)))),
          'dou_ear','Detail_Oak','YF4:corner ludou diagonal slot; hidden half-laps simplified'));
      }
    }
    return children;
  },type);
}

// Shared seat schedule, expressed in material fen above the ludou bottom.
// Xu Yitao, Palace Museum Journal, control-dimension study pp39–40:
// H = 12 + 21 * jumps + 21 to the UNDERside of liao-yan fang.
// A full cai already includes its qi; adding six again double-counts it.
export function bracketSeats({ subsidiary = false, intercolumn = false }={}) {
  const first = 12, huaHeight=intercolumn?15:21;
  const jump1=first+21, jump2=jump1+21;
  const last=subsidiary?jump1:jump2;
  return {first,huaHeight,jump1,jump2,last,liaoyanBottom:last+21,liaoyanBack:last+51,
    innerBeamBottom:last+21,jumps:subsidiary?1:2};
}

// CORNER_STUDY Fig3 explicitly excludes the exposed tip in four-, five-
// and six-puzuo member lengths. The selected knee is above jump one; solve
// the body centerline from the head shoulder to the concealed tail.
export function lowerAngOutline(seats,{length=120,slope=3/8,jump=30}={}){
 const shoulder=2*jump,bodyTop=seats.jump1+15;
 const A=1+slope*slope,B=-2*slope*slope*jump;
 const D=B*B-4*A*(slope*slope*jump*jump-length*length);
 if(D<=0)throw new Error('Ang body length cannot span its selected head and bearing');
 const run=(-B+Math.sqrt(D))/(2*A),tail=shoulder-run,tailTop=bodyTop+slope*(jump-tail);
 return [[shoulder,seats.last-6],[shoulder+9,seats.last-29],[shoulder+7,seats.last-31],
  [jump,seats.jump1],[tail,tailTop-15],[tail,tailTop],[jump,bodyTop]];
}

// Local +Y faces outwards. Main outside uses one hua and one descending ang;
// inside uses two hua. Subsidiary FIG13 has one hua and a single linggong.
export function bracket(b,key,fen,{subsidiary=false,intercolumn=false,corner=false,innerOnly=false,beamBearing=false}={}) {
  if(corner)return cornerBracket(b,key,fen,{subsidiary});
  const seats=bracketSeats({subsidiary,intercolumn}), s=v=>v*fen;
  return b.group(key,()=>{
    const c=[], at=(ref,name,x,y,z,angle=0)=>c.push(b.at(ref,`${key}-${name}`,[x,y,z].map(s),angle));
    const small=dou(b,`${key}-jiaohu`,'jiaohu',fen), sand=dou(b,`${key}-sandou`,'san',fen,{cross:false});
    at(dou(b,`${key}-ludou`,corner?'corner_ludou':'ludou',fen),'ludou',0,0,0);
    const lateral=(name,y,z,final=false)=>{
      at(gong(b,`${key}-${name}-gong`,final?'ling':y===0?'nidao':'guazi',fen),`${name}-gong`,0,y,z);
      for(const x of [-24,24])at(sand,`${name}-dou-${x}`,x,y,z+15);
      if(!final){
        at(gong(b,`${key}-${name}-man`,'man',fen),`${name}-man`,0,y,z+21);
        for(const x of [-38,38])at(sand,`${name}-upperdou-${x}`,x,y,z+36);
      }
    };
    lateral('wall',0,seats.first);
    at(gong(b,`${key}-hua1`,'hua',fen,{full:!intercolumn,bottomNotch:true,topNotch:false}),'hua1',0,0,seats.first,90);
    for(const sign of [-1,1]){
      at(small,`jump1-dou-${sign}`,0,sign*30,seats.jump1-6);
      if(!beamBearing || (!innerOnly&&sign>0))lateral(`jump1-${sign}`,sign*30,seats.jump1,subsidiary);
    }
    if(!subsidiary){
      // Full inner hua extends a second jump, seated into the first jump dou.
      if(!beamBearing){
        at(gong(b,`${key}-hua2`,'hua',fen,{full:true,topNotch:false,length:132,maxX:innerOnly?Infinity:18}),'hua2',0,0,seats.jump1,90);
        at(small,'inner2-dou',0,-60,seats.jump2-6);
        lateral('inner2',-60,seats.last,true);
      }
      // At riding beam heads the mingfu occupies the inner radial member and
      // crossing gong positions. Keep its first-jump bearing dou; do not bury
      // complete inner gongs in the moon beam. Other puzuo keep both inner jumps.

      if(!innerOnly){
        // The horizontal seat is separated from the sloping tail. The exposed
        // terminal follows the 23-fen drop and 2-fen retained tip in YF4 6a.
        const outline=lowerAngOutline(seats);
        // profile local X is radial Y after +90deg rotation.
        at(b.profile(`${key}-ang`,outline.map(p=>p.map(s)),s(10),'lower_ang','YF4:6a–7b;YF17:120fen; selected 3/8 published slope; 120fen body excluding tip'),'ang',0,0,0,90);
        at(b.profile(`${key}-huatouzi`,[[18,seats.jump1],[39,seats.jump1],[39,seats.jump1+4],[30,seats.jump1+15],[18,seats.jump1+15]].map(p=>p.map(s)),s(10),'huatouzi','YF4:6b'),'huatouzi',0,0,0,90);
      }
      if(!innerOnly||!beamBearing){
        at(small,'outer2-dou',0,60,seats.last-6);
        lateral('outer2',60,seats.last,true);
      }
    }
    const lastY=seats.jumps*30;
    for(const sign of [-1,1]){
      if(beamBearing&&(innerOnly||sign<0))continue;
      at(b.profile(`${key}-shuatou-${sign}`,[[0,0],[25,0],[30,3],[25,5],[30,15],[0,21]].map(p=>p.map(s)),s(10),'shuatou','YF4:9b–10a'),`shuatou-${sign}`,0,sign*lastY,seats.last,sign>0?90:-90);
    }
    return c;
  },corner?'corner_bracket':intercolumn?'intercolumn_bracket':subsidiary?'subsidiary_bracket':'column_bracket');
}


// Corner local +X and +Y are BOTH exterior. The four placements rotate this
// quadrant; they must never reuse the front/back orientation at the left end.
// Return members are assembled individually around one ludou. This avoids
// overlaying two complete ordinary puzuo at their shared wall/radial members.
export function cornerBracket(b,key,fen,{subsidiary=false}={}){
 const seats=bracketSeats({subsidiary}),s=v=>v*fen;
 return b.group(key,()=>{
  const c=[],at=(ref,name,x=0,y=0,z=0,angle=0)=>c.push(b.at(ref,`${key}-${name}`,[x,y,z].map(s),angle));
  const jiaohu=dou(b,`${key}-jiaohu`,'jiaohu',fen),sand=dou(b,`${key}-sandou`,'san',fen,{cross:false});
  at(dou(b,`${key}-ludou`,'corner_ludou',fen),'ludou');
  // The axial members combine the radial hua and returning wall gong. Their
  // shared centers are simplified concealed crossings, not duplicate members.
  const axial=gong(b,`${key}-hua-nidao`,'hua',fen,{full:true,topNotch:false,minX:-31});
  for(const angle of [0,90])at(axial,`hua-nidao-${angle}`,0,0,seats.first,angle);
  at(gong(b,`${key}-diagonal-hua`,'hua',fen,{full:true,diagonal:true,topNotch:false}),'diagonal-hua',0,0,seats.first,45);
  for(const axis of ['x','y']){
   const map=(t,r)=>axis==='y'?[t,r]:[r,t],angle=axis==='y'?0:90;
   const place=(ref,name,t,r,z,turn=angle)=>{const [x,y]=map(t,r);at(ref,`${axis}-${name}`,x,y,z,turn);};
   place(jiaohu,'first-bearing',0,30,seats.jump1-6);
   place(gong(b,`${key}-first-return`,subsidiary?'ling':'guazi',fen,{maxX:30}),'first-return',0,30,seats.jump1);
   for(const t of [-24,24])place(sand,`first-dou-${t}`,t,30,seats.jump1+15);
   if(!subsidiary){
    place(gong(b,`${key}-man-return`,'man',fen,{maxX:30}),'man-return',0,30,seats.jump1+21);
    for(const t of [-38,24])place(sand,`man-dou-${t}`,t,30,seats.jump1+36);
    // Return/cross ang are 75 fen members (YF18), not ordinary 120 fen ang.
    const outline=lowerAngOutline(seats,{length:75});
    place(b.profile(`${key}-cross-ang`,outline.map(p=>p.map(s)),s(10),'cross_ang','YF18:4b; selected 3/8 slope'),
      'cross-ang',30,0,0,axis==='y'?90:0);
    place(gong(b,`${key}-upper-inner-hua`,'hua',fen,{full:true,length:132,maxX:18,topNotch:false}),
      'upper-inner-hua',0,0,seats.jump1,axis==='y'?90:0);
    place(jiaohu,'inner-bearing',0,-60,seats.jump2-6);
    place(gong(b,`${key}-inner-ling`,'ling',fen),'inner-ling',0,-60,seats.last);
    for(const t of [-24,24])place(sand,`inner-dou-${t}`,t,-60,seats.last+15);
    // The outer return continues to the diagonal seat. Its scarf is concealed;
    // the selected extended span is recorded separately from YF18 body lengths.
    place(gong(b,`${key}-outer-return`,'ling',fen,{length:132,minX:-36,maxX:66}),
      'outer-return',0,60,seats.last);
    for(const t of [-24,30,60])place(sand,`outer-dou-${t}`,t,60,seats.last+15);
   }
  }
  at(jiaohu,'diagonal-first-bearing',30,30,seats.jump1-6,45);
  if(!subsidiary){
   const outline=lowerAngOutline(seats,{length:175,slope:3/8/Math.SQRT2,jump:30*Math.SQRT2});
   at(b.profile(`${key}-diagonal-ang`,outline.map(p=>p.map(s)),s(10),'diagonal_ang','YF18:5a 175fen; CORNER_STUDY selected body-length reading excluding tip'),'diagonal-ang',0,0,0,45);
   const q=60*Math.SQRT2, slope=3/8/Math.SQRT2,run=336/Math.hypot(1,slope),tip=q+9;
   const tail=q-run,top=x=>seats.last+slope*(q-x);
   const you=[[tip,top(tip)-15],[tail,top(tail)-15],[tail,top(tail)],[q,top(q)],[tip,top(tip)-12]];
   at(b.profile(`${key}-you-ang`,you.map(p=>p.map(s)),s(10),'you_ang','YF18:1b 336fen; selected body-length/slope interpretation excluding tip'),'you-ang',0,0,0,45);
   b.anchor(`${key}-youang-tail-local`,[tail/Math.SQRT2*fen,tail/Math.SQRT2*fen,top(tail)*fen]);
  }
  const end=seats.jumps*30*Math.SQRT2;
  at(b.profile(`${key}-diagonal-shuatou`,[[-84,0],[0,0],[6,3],[0,5],[6,15],[-84,21]].map(p=>p.map(s)),s(10),
    'corner_shuatou','YF18:1b 84fen body; selected concealed crossing'),'diagonal-shuatou',0,0,seats.last,45);
  if(subsidiary)at(gong(b,`${key}-diagonal-top`,'hua',fen,{full:true,diagonal:true,topNotch:false}),
    'diagonal-top',0,0,seats.last,45);
  b.anchor(`${key}-diagonal-bearing-local`,[end/Math.SQRT2*fen,end/Math.SQRT2*fen,seats.liaoyanBottom*fen]);
  return c;
 },subsidiary?'subsidiary_corner_bracket':'corner_bracket');
}
