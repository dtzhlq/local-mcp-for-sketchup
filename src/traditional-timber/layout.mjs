import { assemblyError } from './assembly-plan.mjs';

const add = (a,b)=>a.map((v,i)=>v+b[i]);
const times = (a,k)=>a.map(v=>v*k);
const cross = (a,b)=>a[0]*b[1]-a[1]*b[0];
const dot = (a,b)=>a[0]*b[0]+a[1]*b[1];
function positive(value,name,max=60000) {if(!Number.isFinite(value)||value<1||value>max)assemblyError('INVALID_ARGUMENT',`${name} must be finite in [1,${max}] mm.`,`task.parameters.${name}`);return value;}
function bays(values,name) {if(!Array.isArray(values)||!values.length||values.length>16)assemblyError('INVALID_ARGUMENT',`${name} needs 1..16 explicit positive bay lengths.`);values.forEach(v=>positive(v,name,10000));return values;}
export function solveTraditionalLayout(layout,parameters) {
  if(layout.kind==='free')return {kind:'free',segments:[],stations:[],width:0,depth:0,bounds:{min:[0,0,0],max:[0,0,0]}};
  const depth=positive(parameters[layout.kind==='path'?layout.width_parameter:layout.depth_parameter],layout.kind==='path'?layout.width_parameter:layout.depth_parameter,12000);
  const definitions=layout.kind==='grid'?[{id:'grid',direction_deg:0,bay_lengths_parameter:layout.x_bays_parameter}]:layout.segments;
  const seen=new Set(),segments=[],stations=[];let origin=[0,0,0];
  for(const [index,definition] of definitions.entries()) {
    if(seen.has(definition.id))assemblyError('INVALID_ARGUMENT','Path segment IDs must be unique.');seen.add(definition.id);
    const angle=definition.direction_deg*Math.PI/180;
    if(!Number.isFinite(angle)||Math.abs(definition.direction_deg/90-Math.round(definition.direction_deg/90))>1e-8)assemblyError('UNSUPPORTED_TOPOLOGY','This contract supports local cardinal straight/90-degree paths; use placement rotation for the site heading.');
    const direction=[Math.round(Math.cos(angle)),Math.round(Math.sin(angle)),0],normal=[-direction[1],direction[0],0];
    if(index){const previous=segments.at(-1);if(Math.abs(dot(previous.direction,direction))>1e-8)assemblyError('UNSUPPORTED_TOPOLOGY','Adjacent segments must turn 90 degrees; merge collinear segments and reject reversals.');}
    const lengths=bays(parameters[definition.bay_lengths_parameter],definition.bay_lengths_parameter),length=lengths.reduce((s,v)=>s+v,0);
    positive(length,'total_path_length',60000);
    const segment={id:definition.id,index,origin:[...origin],direction,normal,length,bay_lengths:[...lengths],width:depth,stations:[],start_miter:0,end_miter:0};
    let distance=0;
    for(let i=0;i<=lengths.length;i++) {
      const point=add(origin,times(direction,distance));
      const id=i===0&&index?`joint-${segments.at(-1).id}-${definition.id}`:i===lengths.length&&index<definitions.length-1?`joint-${definition.id}-${definitions[index+1].id}`:`${definition.id}-station-${i}`;
      const station={id,point,distance,normal:[...normal],segment_id:definition.id};segment.stations.push(station);
      if(!stations.some(s=>s.id===id))stations.push(station);
      distance+=lengths[i]||0;
    }
    segments.push(segment);origin=add(origin,times(direction,length));
  }
  for(let i=0;i<segments.length-1;i++) {
    const a=segments[i],b=segments[i+1],turn=cross(a.direction,b.direction);
    a.end_miter=-turn;b.start_miter=turn;
    const station=stations.find(s=>s.id===`joint-${a.id}-${b.id}`);
    station.normal=add(a.normal,b.normal);station.junction=true;
    if(Math.min(a.bay_lengths.at(-1),b.bay_lengths[0])<depth/2+500)assemblyError('PARAMETER_DEPENDENCY','A corner needs enough adjoining bay length for its miter and eave projection.');
  }
  const columns=stations.flatMap(s=>[-1,1].map(side=>({id:`column-${s.id}-${side===1?'left':'right'}`,point:add(s.point,times(s.normal,side*depth/2)),station_id:s.id,side})));
  // Reject self-crossing and overlapping non-adjacent bays before generating geometry.
  for(let i=0;i<segments.length;i++)for(let j=i+2;j<segments.length;j++){
    const a=segments[i],b=segments[j],aEnd=add(a.origin,times(a.direction,a.length)),bEnd=add(b.origin,times(b.direction,b.length));
    const bounds=s=>[0,1].map(k=>[Math.min(s.origin[k],s.end[k])-depth/2,Math.max(s.origin[k],s.end[k])+depth/2]);
    const A=bounds({...a,end:aEnd}),B=bounds({...b,end:bEnd});
    if(A.every((v,k)=>Math.min(v[1],B[k][1])-Math.max(v[0],B[k][0])>0))assemblyError('UNSUPPORTED_TOPOLOGY','This first slice rejects crossing or overlapping corridor branches.');
  }
  return {kind:layout.kind,segments,stations,columns,width:segments[0].length,depth,bounds:{min:[Math.min(...columns.map(c=>c.point[0])),Math.min(...columns.map(c=>c.point[1])),0],max:[Math.max(...columns.map(c=>c.point[0])),Math.max(...columns.map(c=>c.point[1])),0]},junction_count:segments.length-1};
}
export function pathPoint(segment,u,v=0,z=0) {return add(add(segment.origin,times(segment.direction,u)),add(times(segment.normal,v),[0,0,z]));}
export function pathLimits(segment,v) {return [segment.start_miter*v,segment.length+segment.end_miter*v];}
