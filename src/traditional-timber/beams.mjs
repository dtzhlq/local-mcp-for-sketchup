import { juanshaEnvelope } from './brackets.mjs';
import { ringsMesh } from './solids.mjs';

// Visible beam-head silhouette; concealed mortises are intentionally omitted.
// Local X follows the beam span, Z is vertical. YF5:2b–3b distinguishes a
// 21-fen projecting head from the deeper body; a rectangular full-depth head
// would collide with the bracket layers before any joinery could be resolved.
export function moonBeam(b,key,start,end,bottom,height,fen){
  const length=end-start, run=Math.min(60*fen,length*.22), h=height*fen, head=21*fen;
  const cut=juanshaEnvelope(6,run/6,h-head);
  const neckRun=Math.min(68*fen,length*.25);
  const bottomPoints=[[start,0],[start+neckRun,0],[start+length*.5,6*fen],[end-neckRun,0],[end,0]];
  const topRight=cut.map(([x,z])=>[end-x,head+z]);
  const topLeft=cut.slice().reverse().map(([x,z])=>[start+x,head+z]);
  // Ten-fen necks enter the bearing dou. Extruding the entire moon beam
  // at its 25-fen body width would cut through the visible dou ears.
  const shoulder=juanshaEnvelope(4,Math.min(40*fen,length*.35)/4,7.5*fen),neck=Math.min(39*fen,length*.12);
  const leftWidth=[[start,5*fen],[start+neck,5*fen],...shoulder.slice(1).map(([x,z])=>[start+neck+x,5*fen+z])];
  const rightWidth=leftWidth.map(([x,w])=>[end-(x-start),w]).reverse();
  const widths=[...leftWidth,...rightWidth],tops=[...topLeft,...topRight].sort((a,b)=>a[0]-b[0]);
  const sample=(points,x)=>{
    if(x<=points[0][0])return points[0][1];
    for(let i=1;i<points.length;i++)if(x<=points[i][0]){
      const a=points[i-1],b=points[i],t=(x-a[0])/(b[0]-a[0]);return a[1]+t*(b[1]-a[1]);
    }
    return points.at(-1)[1];
  };
  const xs=[...new Set([...widths,...tops,...bottomPoints].map(p=>p[0]))].sort((a,b)=>a-b);
  const rings=xs.map(x=>{
    const w=sample(widths,x),lo=bottom+sample(bottomPoints,x),hi=bottom+sample(tops,x);
    return [[x,-w,lo],[x,w,lo],[x,w,hi],[x,-w,hi]];
  });
  return b.mesh(key,ringsMesh(rings),'mingfu','Detail_Oak','YF5:2b–3b; six-cut head,25fen body,10fen neck and four-cut shoulders; hidden joinery simplified');
}

// An open circular saddle in a beam's top profile. It is cut geometry, not a
// round purlin placed through a solid beam. Only locations on the flat body are
// allowed; callers must provide enough shoulder length for the whole socket.
export function saddleBeam(b,key,start,end,bottom,height,fen,seats=[],endHeight=null,endBottom=bottom){
  const bottomAt=x=>bottom+(endBottom-bottom)*(x-start)/(end-start);
  const topAt=x=>bottomAt(x)+height*fen;
  const top=topAt(end), radius=12.75*fen;
  const sorted=[...seats].sort((a,b)=>b.x-a.x), upper=[[end,endHeight===null?top:endBottom+endHeight*fen]];
  for(const seat of sorted){
    const lip=Math.min(topAt(seat.x),seat.z),dz=lip-seat.z;
    if(dz<=-radius)continue;
    if(seat.z-radius-bottomAt(seat.x)<10*fen)throw new Error(`YF_BEAM_SEAT_UNRESOLVED:${key}: purlin saddle has insufficient supporting timber`);
    const alpha=Math.asin(dz/radius),half=Math.sqrt(radius*radius-dz*dz);
    const right=seat.x+half,left=seat.x-half;
    if(right>=end||left<=start)throw new Error(`YF_BEAM_SEAT_UNRESOLVED:${key}: saddle shoulder reaches beam end`);
    // Open U-shaped bearing. Keeping a near-full circular tunnel in an
    // otherwise tall beam would conceal most of the purlin and its seat.
    const shoulderRight=right+Math.min(10*fen,(end-right)/2);
    upper.push([shoulderRight,topAt(shoulderRight)],[right,lip]);
    const endAngle=-Math.PI-alpha;
    for(let i=1;i<=24;i++){
      const angle=alpha+(endAngle-alpha)*i/24;
      upper.push([seat.x+radius*Math.cos(angle),seat.z+radius*Math.sin(angle)]);
    }
    const shoulderLeft=left-Math.min(10*fen,(left-start)/2);
    upper.push([shoulderLeft,topAt(shoulderLeft)]);
  }
  upper.push([start,endHeight===null?topAt(start):bottom+endHeight*fen]);
  return b.profile(key,[[start,bottom],[end,endBottom],...upper],30*fen,'caofu','YF5:beam and bao-tuan saddle; body/head transitions are project reconstruction choices');
}
