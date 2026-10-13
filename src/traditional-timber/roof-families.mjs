import { assemblyError, PROJECT_RULES } from './assembly-plan.mjs';
import { pathPoint, pathLimits } from './layout.mjs';
import { continuousTileSurface, lightTileSkin, tileRibbon } from './roof.mjs';
import { mergeMeshes, taggedBeam, closedSurface, verticalRafter } from './assembly-mesh.mjs';
import { plus } from './solids.mjs';

const D=PROJECT_RULES.defaults, near=(a,b)=>Math.abs(a-b)<1e-6;
export function roofDimensions(parameters,frame) {
  const p={type:'gable',rise_mm:650,eave_projection_mm:D.eave_projection_mm,eave_lift_mm:D.eave_lift_mm,
    rafter_width_mm:D.rafter_width_mm,rafter_height_mm:D.rafter_height_mm,rafter_spacing_mm:D.rafter_spacing_mm,
    board_thickness_mm:D.board_thickness_mm,tile_pitch_mm:D.tile_pitch_mm,tile_length_mm:D.tile_length_mm,
    tile_thickness_mm:D.tile_thickness_mm,...parameters};
  if((p.storeys??1)!==1||(p.plan_sides??4)!==4)assemblyError('UNSUPPORTED_TOPOLOGY','Two-storey/hexagonal roof and support solvers are unavailable.', 'task.assembly',
    {gaps:['multi_storey_support','non_square_roof_junction'],proposal:{status:'approximation_proposed',roof:'pyramidal',storeys:1,plan_sides:4,requires_explicit_acceptance:true,execution_started:false}});
  if(!['gable','pyramidal','flat'].includes(p.type))assemblyError('UNSUPPORTED_TOPOLOGY',`Roof ${p.type} has no verified face/junction solver.`,'task.assembly',{gaps:[`roof_solver:${p.type}`],proposal:{status:'approximation_proposed',roof:'flat',storeys:1,eave_lift_mm:0,requires_explicit_acceptance:true,execution_started:false}});
  for(const key of ['rise_mm','eave_projection_mm','eave_lift_mm'])if(!Number.isFinite(p[key])||p[key]<0||p[key]>3000)assemblyError('INVALID_ARGUMENT',`${key} must be in [0,3000] mm.`);
  for(const key of ['rafter_width_mm','rafter_height_mm','rafter_spacing_mm','board_thickness_mm','tile_pitch_mm','tile_length_mm','tile_thickness_mm'])
    if(!Number.isFinite(p[key])||p[key]<1||p[key]>1000)assemblyError('INVALID_ARGUMENT',`Invalid roof section ${key}.`);
  if(p.rafter_spacing_mm<p.rafter_width_mm+20||p.tile_pitch_mm<80||p.tile_length_mm<150)assemblyError('RESOURCE_BUDGET','Use rafter spacing above section +20 mm, tile pitch >=80 mm and length >=150 mm.');
  if(p.eave_lift_mm>p.eave_projection_mm/2||p.eave_projection_mm>frame.layout.depth/2)assemblyError('PARAMETER_DEPENDENCY','Eave lift/projection exceeds the supported section.');
  p.rise_mm=p.type==='flat'?0:p.rise_mm;
  if(p.type!=='flat'&&p.rise_mm<100)assemblyError('PARAMETER_DEPENDENCY','Pitched roof needs rise >=100 mm.');
  return p;
}

// Each face supplies one downslope interval per transverse coordinate. All
// board, rafter, tile and fascia builders consume this same surface contract.
export function solveRoofFaces(layout,p,frame) {
  const half=layout.depth/2,outer=half+p.eave_projection_mm;
  const underside=(v)=>frame.height+frame.purlin_height+p.rafter_height_mm+p.rise_mm*(1-v/half)
    +p.eave_lift_mm*(Math.max(0,v-half)/Math.max(1,p.eave_projection_mm))**2;
  const faces=[];
  if(p.type==='pyramidal') {
    if(layout.kind!=='grid'||layout.segments.length!==1||layout.segments[0].bay_lengths.length!==1||!near(layout.width,layout.depth))
      assemblyError('UNSUPPORTED_TOPOLOGY','First pyramidal solver requires an explicit square four-post grid.');
    const center=[layout.width/2,0,0];
    for(const [id,normal,tangent] of [['north',[0,1,0],[1,0,0]],['east',[1,0,0],[0,-1,0]],['south',[0,-1,0],[-1,0,0]],['west',[-1,0,0],[0,1,0]]]) {
      faces.push({id,outer,extent:outer,near:u=>Math.abs(u),far:()=>outer,
        point:(u,v)=>[center[0]+tangent[0]*u+normal[0]*v,center[1]+tangent[1]*u+normal[1]*v,underside(v)],
        eave:[[-outer,outer],[outer,outer]],boundary_types:['hip','eave','hip'],support_half:half});
    }
  } else {
    for(const segment of layout.segments)for(const side of [-1,1]) {
      const terminalStart=segment.index===0?-p.eave_projection_mm:0;
      const terminalEnd=segment.index===layout.segments.length-1?p.eave_projection_mm:0;
      const minU=Math.min(terminalStart,segment.start_miter*side*outer),maxU=segment.length+Math.max(terminalEnd,segment.end_miter*side*outer);
      const limits=v=>{const [a,b]=pathLimits(segment,side*v);return [a+terminalStart,b+terminalEnd];};
      const nearAt=u=>{
        let min=0;
        if(segment.start_miter*side<0)min=Math.max(min,-(u-terminalStart));
        if(segment.end_miter*side>0)min=Math.max(min,u-segment.length-terminalEnd);
        return Math.max(0,min);
      };
      const farAt=u=>{
        let far=outer;
        if(segment.start_miter*side>0)far=Math.min(far,u-terminalStart);
        if(segment.end_miter*side<0)far=Math.min(far,segment.length+terminalEnd-u);
        return far;
      };
      const [e0,e1]=limits(outer);
      faces.push({id:`${segment.id}-${side===1?'left':'right'}`,outer,minU,maxU,extent:null,
        near:nearAt,far:farAt,point:(u,v)=>pathPoint(segment,u,side*v,underside(v)),eave:[[e0,outer],[e1,outer]],
        segment_id:segment.id,side,breaks:[terminalStart,segment.length+terminalEnd],boundary_types:['ridge',segment.start_miter?'miter':'gable','eave',segment.end_miter?'miter':'gable'],support_half:half});
    }
  }
  return {faces,half,outer,underside,apex_mm:underside(0)+p.board_thickness_mm};
}
function surfaceMesh(face,thickness) {
  const low=face.minU??-face.extent,high=face.maxU??face.extent;
  // Insert clipping breakpoints so the ridge/apex never becomes a rounded fan.
  const us=[low,high,0,...(face.breaks||[])];
  if(face.segment_id)us.push(high-face.outer,low+face.outer);
  const xs=[...new Set(us.filter(x=>x>=low&&x<=high))].sort((a,b)=>a-b);
  const vertices=[],faces=[];
  // Shared indexed vertices close board side walls at cell boundaries.
  const index=new Map(),at=(u,v)=>{
    const point=face.point(u,v),key=point.map(x=>Math.round(x*1e5)).join(',');
    if(!index.has(key)){index.set(key,vertices.length);vertices.push(point);}return index.get(key);
  };
  // Sample at common downslope levels. Interpolating each hip column's full
  // run independently makes a broad board triangle bridge the eave-lift kink
  // and rise through the tile skin near the corners.
  const levels=[0,face.support_half,...Array.from({length:6},(_,i)=>face.support_half+(face.outer-face.support_half)*(i+1)/6)];
  const clip=(polygon,bound,greater)=>{
    const out=[],inside=p=>greater?p[1]>=bound:p[1]<=bound;
    for(let i=0;i<polygon.length;i++) {
      const a=polygon[i],b=polygon[(i+1)%polygon.length];
      if(inside(a))out.push(a);
      if(inside(a)!==inside(b)){const t=(bound-a[1])/(b[1]-a[1]);out.push([a[0]+(b[0]-a[0])*t,bound]);}
    }
    return out;
  };
  for(let i=1;i<xs.length;i++)for(let j=1;j<levels.length;j++) {
    const a=xs[i-1],b=xs[i],A=[face.near(a),face.far(a)],B=[face.near(b),face.far(b)];
    if(A[1]<A[0]-1e-5||B[1]<B[0]-1e-5)continue;
    const polygon=clip(clip([[a,A[0]],[b,B[0]],[b,B[1]],[a,A[1]]],levels[j-1],true),levels[j],false);
    const cell=[];
    for(const [u,v] of polygon){const id=at(u,v);if(cell.at(-1)!==id)cell.push(id);}
    if(cell.length>1&&cell[0]===cell.at(-1))cell.pop();
    if(cell.length>=3)faces.push(cell);
  }
  // Tiny triangular apex strips are handled by the shared vertices, with no
  // epsilon gap between adjoining roof faces.
  return closedSurface(vertices.map(v=>plus(v,[0,0,thickness])),vertices,faces);
}
function tilesFor(face,p,detail) {
  const out=[],low=face.minU??-face.extent,high=face.maxU??face.extent,pitch=p.tile_pitch_mm;
  const point=(u,v)=>plus(face.point(u,v),[0,0,p.board_thickness_mm+p.tile_thickness_mm]);
  for(const type of ['pan','cover']) {
    const width=type==='pan'?pitch:.55*pitch,offset=type==='cover'?pitch/2:0;
    for(let j=Math.ceil((low-width/2-offset)/pitch);j<=Math.floor((high+width/2-offset)/pitch);j++) {
      const center=j*pitch+offset,start=Math.max(low,center-width/2),end=Math.min(high,center+width/2);
      if(end-start<2)continue;
      const curve=t=>type==='pan'?18*(1-Math.sqrt(Math.max(0,1-(2*t-1)**2))):30*Math.sin(Math.PI*t)+15;
      // Split at all clipping kinks. Within a strip the far edge may be a
      // miter, not the nominal eave, so map old tile helpers into normalized
      // downslope coordinates without extending across an adjacent roof.
      // At a square pyramid all three clipping kinks coincide at zero.
      // Keep one breakpoint so no zero-width tile strip reaches SketchUp.
      const cuts=[...new Set([start,end,...[0,low+face.outer,high-face.outer].filter(x=>x>start&&x<end)])].sort((a,b)=>a-b);
      for(let k=1;k<cuts.length;k++) {
        const a=cuts[k-1],b=cuts[k],span=b-a;
        const mapped=(u,t)=>point(u,face.near(u)+(face.far(u)-face.near(u))*t);
        const profile=t=>curve((a+span*t-center+width/2)/width);
        if(detail==='surface') {
          if([a,b,(a+b)/2].some(u=>face.far(u)-face.near(u)<.05))continue;
          out.push(continuousTileSurface(mapped,a,span,1,()=>0,profile,6,type==='pan'?2:4));
        } else {
          const run=Math.max(...[a,b,(a+b)/2].map(u=>face.far(u)-face.near(u)));
          const rows=Math.max(1,Math.ceil(run/(.6*p.tile_length_mm)));
          for(let row=0;row<rows;row++) {
            const t0=row/rows,t1=(row+1)/rows;
            out.push(detail==='light'?lightTileSkin(mapped,a,span,t0,t1,()=>t0,u=>profile((u-a)/span),p.tile_thickness_mm,type==='pan'?2:4)
              :tileRibbon(mapped,a,span,Math.max(0,t1-1/rows/.6),t1,()=>0,profile,p.tile_thickness_mm,{smooth:true,sections:4}));
          }
        }
      }
    }
  }
  return mergeMeshes(out);
}
export function buildRoofGeometry(layout,p,frame,detail) {
  const surface=solveRoofFaces(layout,p,frame),boards=[],rafters=[],fascia=[],tiles=[];
  for(const face of surface.faces) {
    boards.push(surfaceMesh(face,p.board_thickness_mm));tiles.push(tilesFor(face,p,detail));
    const low=face.minU??-face.extent,high=face.maxU??face.extent;
    const n=Math.ceil((high-low)/p.rafter_spacing_mm);
    for(let i=0;i<=n;i++) {
      const u=low+(high-low)*i/n,a=face.near(u),b=face.far(u);
      if(b-a<p.rafter_width_mm)continue;
      // Vertical-section rafters lap purlins at the shared support line.
      const stops=[a,...[face.support_half,face.support_half+(face.outer-face.support_half)/2].filter(v=>v>a&&v<b),b];
      for(let k=1;k<stops.length;k++)rafters.push(verticalRafter(face.point(u,stops[k-1]),face.point(u,stops[k]),p.rafter_width_mm,p.rafter_height_mm));
    }
    const [a,b]=face.eave.map(([u,v])=>plus(face.point(u,v),[0,0,-p.rafter_height_mm/2]));
    if(Math.hypot(...a.map((x,i)=>x-b[i]))>1)fascia.push(taggedBeam(a,b,40,p.rafter_height_mm));
  }
  // Hip supports are part of the same surface and meet the four frame corners.
  if(p.type==='pyramidal')for(const sx of [-1,1])for(const sy of [-1,1]) {
    const center=[layout.width/2,0,0],at=d=>[center[0]+sx*d,sy*d,surface.underside(d)];
    rafters.push(verticalRafter(at(0),at(surface.half),90,p.rafter_height_mm),verticalRafter(at(surface.half),at(surface.outer),90,p.rafter_height_mm));
  }
  return {surface,boards:mergeMeshes(boards),rafters:mergeMeshes(rafters),fascia:mergeMeshes(fascia),tiles:mergeMeshes(tiles)};
}
