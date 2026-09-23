import { boardDoorBattens, poZiLingDimensions } from './yf-rules.mjs';
import { ringsMesh } from './solids.mjs';

export function boardDoor(b,key,heightChi,chi){
  const H=heightChi*chi,W=.9*H,leafW=W/2,jamb=.07*H,depth=.03*H;
  return b.group(key,()=>{
    const c=[], board=(name,o,size,role)=>c.push(b.box(`${key}-${name}`,o,size,role,'Detail_Oak','YF6:board door 1b–4a'));
    for(const sign of [-1,1]){
      const x=sign<0?-W/2:0,hingeX=sign*(W/2-.05*H),strip=.1*H;
      // The assembly is closed. Each leaf comprises the pivot stile and
      // multiple body boards, rather than a single unarticulated box.
      board(`pivot-stile-${sign}`,[sign<0?x:x+leafW-strip,-depth/2,0],[strip,depth,H],'door_pivot_stile');
      const panelStart=sign<0?x+strip:x, panelWidth=leafW-strip;
      const boards=4,gap=.0008*H,plankWidth=(panelWidth-(boards-1)*gap)/boards;
      for(let i=0;i<boards;i++)board(`leaf-${sign}-board-${i}`,[panelStart+i*(plankWidth+gap),-.01*H,0],[plankWidth,.02*H,H],'door_body_board');
      const n=boardDoorBattens(heightChi),barW=.92*leafW;
      for(let i=0;i<n;i++)board(`leaf-${sign}-batten-${i}`,[x+(leafW-barW)/2,.01*H,(i+.5)*H/n-.04*H],[barW,.05*H,.08*H],'door_batten');
      c.push(b.pipe(`${key}-pivot-${sign}`,[hingeX,0,-.035*H],[hingeX,0,H+.06*H],.018*H,'door_pivot','Detail_Oak','YF6:retained upper and lower pivots'));
      board(`jamb-${sign}`,[sign<0?-W/2-jamb:W/2,-depth/2,0],[jamb,depth,H],'door_jamb');
      c.push(b.box(`${key}-pivot-block-${sign}`,[hingeX-.045*H,-.105*H,-.06*H],[.09*H,.21*H,.06*H],'door_pivot_block','Detail_Stone','YF6:menzhen selected stone'));
      // Iron ring on the outer side; simple sectional hardware, not carving.
      const ringRadius=.055*H,ringX=sign*.12*H,ringZ=.46*H;
      for(let j=0;j<12;j++){
        const a=j*Math.PI/6,d=(j+1)*Math.PI/6;
        c.push(b.pipe(`${key}-ring-${sign}-${j}`,[ringX+ringRadius*Math.cos(a),-.04*H,ringZ+ringRadius*Math.sin(a)],[ringX+ringRadius*Math.cos(d),-.04*H,ringZ+ringRadius*Math.sin(d)],.004*H,'door_pull','Detail_Aluminium','selected simple ring hardware'));
      }
    }
    board('lintel',[-W/2-jamb,-depth/2,H],[W+2*jamb,depth,.08*H],'door_lintel');
    board('threshold',[-W/2-jamb,-depth/2,-.07*H],[W+2*jamb,depth,.07*H],'door_threshold');
    board('jiximu',[-W/2-jamb,-.02*H,H-.02*H],[W+2*jamb,.03*H,.06*H],'door_jiximu');
    for(let i=0;i<4;i++)board(`menzan-${i}`,[-W/2+(i+.5)*W/4-.02*H,-.09*H,H+.02*H],[.04*H,.18*H,.04*H],'door_menzan');
    const barD=(.4+Math.max(0,heightChi-10)*.015)*chi;
    c.push(b.pipe(`${key}-locking-bar`,[-.42*W,.07*H,.5*H],[.42*W,.07*H,.5*H],barD/2,'door_locking_bar','Detail_Oak','YF6:door bar diameter'));
    return c;
  },'double_board_door');
}

export function poZiLingWindow(b,key,widthChi,chi){
  const d=poZiLingDimensions(widthChi),H=d.heightChi*chi,W=widthChi*chi,J=d.jambWidthChi*chi;
  const barWidth=d.mullionWidthChi*chi,barDepth=d.mullionDepthChi*chi,outerH=d.outerHeightChi*chi;
  return b.group(key,()=>{
    const c=[], box=(name,o,size,role)=>c.push(b.box(`${key}-${name}`,o,size,role,'Detail_Oak','YF6:7b–8b'));
    for(const sign of [-1,1])box(`jamb-${sign}`,[sign<0?-W/2:W/2-J,-.025*H,0],[J,.05*H,outerH],'window_jamb');
    box('head',[-W/2,-.025*H,outerH-.12*H],[W,.05*H,.12*H],'window_head');
    box('waist',[-W/2,-.025*H,0],[W,.05*H,.12*H],'window_waist');
    // A recessed subframe preserves the already-derived horizontal gaps.
    // This nominal-height convention is a declared project interpretation.
    const clearBottom=.12*H,clearTop=outerH-.12*H;
    box('lower-subframe',[-W/2+J,-.04*H,clearBottom-.05*H],[W-2*J,.04*H,.05*H],'window_subframe');
    box('upper-subframe',[-W/2+J,-.04*H,clearTop],[W-2*J,.04*H,.05*H],'window_subframe');
    const z0=clearBottom-d.embedChi*chi,z1=clearTop+d.embedChi*chi;
    const section=[[-barWidth/2,0],[barWidth/2,0],[0,-barDepth]];
    const ref=b.mesh(`${key}-triangular-mullion`,ringsMesh([z0,z1].map(z=>section.map(([x,y])=>[x,y,z]))),'po_zi_ling','Detail_Oak','YF6:diagonally split square; triangular section');
    for(let i=0;i<d.count;i++)c.push(b.at(ref,`${key}-mullion-${i}`,[-W/2+J+barWidth/2+i*(barWidth+.1*chi),0,0]));
    return c;
  },'po_zi_ling_window');
}

export function buildEnclosure(b,p,u,l){
  const C=u.chi,doorH=p.door_height_chi*C,window=poZiLingDimensions(p.window_width_chi);
  const c=[],wallDepth=.5*C, front=-l.depth/2;
  const door=boardDoor(b,'front-door',p.door_height_chi,C),win=poZiLingWindow(b,'front-window',p.window_width_chi,C);
  const infill=(key,x0,x1,z0,z1,y=front)=>{
    if(x1>x0&&z1>z0)c.push(b.box(key,[x0,y-wallDepth/2,z0],[x1-x0,wallDepth,z1-z0],'plain_infill','Detail_Plaster','selected project enclosure layout'));
  };
  const jambAddition=.07*doorH,doorWidth=.9*doorH+2*jambAddition;
  for(let i=0;i<5;i++){
    const a=l.grid[i]+21.75*u.fen,d=l.grid[i+1]-21.75*u.fen,center=(a+d)/2;
    const w=i===2?doorWidth:p.window_width_chi*C;
    const top=doorH*1.08,bottom=i===2?0:top-window.outerHeightChi*C;
    if(bottom<0||w>d-a)throw new Error('Selected front opening does not fit its chosen bay');
    c.push(b.at(i===2?door:win,`front-opening-${i}`,[center,front,bottom]));
    infill(`front-left-${i}`,a,center-w/2,0,l.height-30*u.fen);
    infill(`front-right-${i}`,center+w/2,d,0,l.height-30*u.fen);
    infill(`front-top-${i}`,center-w/2,center+w/2,top,l.height-30*u.fen);
    if(i!==2)infill(`front-apron-${i}`,center-w/2,center+w/2,0,bottom);
    infill(`rear-infill-${i}`,a,d,0,l.height-30*u.fen,l.depth/2);
  }
  for(const sign of [-1,1])c.push(b.box(`side-infill-${sign}`,[sign*l.width/2-wallDepth/2,-l.depth/2,0],[wallDepth,l.depth,l.height-30*u.fen],'plain_infill','Detail_Plaster','selected project layout; gallery remains open'));
  return b.group('enclosure',()=>c,'door_window_enclosure');
}
