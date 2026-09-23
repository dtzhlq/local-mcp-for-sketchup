import assert from 'node:assert/strict';
import { resolveYfParameters, yfUnits, roofSupportBacks, poZiLingDimensions, yfRuleBinding, assertYfRuleBinding } from '../src/traditional-timber/yf-rules.mjs';
import { reusable } from '../src/traditional-timber/roof.mjs';
import { juanshaEnvelope, bracketSeats, lowerAngOutline } from '../src/traditional-timber/brackets.mjs';

const p=resolveYfParameters({chi_mm:312}),u=yfUnits(p);
assert.deepEqual([u.chi,u.cun,u.chi_fen,u.li],[312,31.2,3.12,.312]);
assert.equal(u.fen*15,257.4); // second-grade cai height = .825 chi
assert.ok(Math.abs(u.subsidiary_fen*15-234)<1e-10); // third-grade cai height = .75 chi
assert.throws(()=>resolveYfParameters({chi_mm:0}),/chi_mm/);
const roof=roofSupportBacks([6,6,6,6,3.3],100,18.2);
assert.ok(Math.abs(roof[1].z-112.38)<1e-9); // ridge-to-eave straight line, minus first 1/10 rise
assert.equal(roof.at(-1).z,100);
assert.equal(bracketSeats().liaoyanBottom,75);
assert.equal(bracketSeats({subsidiary:true}).liaoyanBottom,54);
const cut=juanshaEnvelope(4,4);
assert.deepEqual([cut[0],cut.at(-1)],[[0,0],[16,9]]);
assert.equal(new Set(cut.slice(1).map(([x,z],i)=>(z-cut[i][1])/(x-cut[i][0]))).size,4);
const window=poZiLingDimensions(14);
assert.equal(window.count,25);
assert.ok(Math.abs(window.count*window.mullionWidthChi+(window.count-1)*window.gapChi+2*window.jambWidthChi-14)<1e-10);
assert.ok(Math.abs(window.clearHeightChi+2*window.embedChi-.98*window.heightChi)<1e-10);
assert.ok(Math.abs(window.outerHeightChi-window.clearHeightChi-.24*window.heightChi)<1e-10);
assert.deepEqual(assertYfRuleBinding(yfRuleBinding()),yfRuleBinding());
assert.throws(()=>assertYfRuleBinding({...yfRuleBinding(),version:0}),/YF_RULE_VERSION_MISMATCH/);
console.log('YF units, zero rejection, roof fold, gong cutting and window dependency passed; no native accuracy acceptance implied.');

// One corrected length convention and one affine-unit regression. The latter
// verifies shared native geometry reconstructs the supplied millimetre mesh.
const ang=lowerAngOutline(bracketSeats()),tail=ang[5];
assert.ok(Math.abs(Math.hypot(60-tail[0],tail[1]-48)-120)<1e-9);
const input={vertices:[[5,7,9],[5,207,49],[5,207,59],[5,7,19],[105,7,9],[105,207,49],[105,207,59],[105,7,19]],faces:[[0,1,2,3],[4,7,6,5]]};
let stored;const builder={mesh:(key,mesh)=>{stored=mesh;return {part_id:key};},at:(ref,id,origin)=>({...ref,instance_id:id,origin})};
const placed=reusable(builder,input,'fixture','wood','unit-regression','fixture-instance'),m=placed.transform.matrix;
for(const [i,q]of stored.vertices.entries())for(let j=0;j<3;j++)assert.ok(Math.abs(placed.origin[j]+q[0]*m[j]+q[1]*m[4+j]+q[2]*m[8+j]-input.vertices[i][j])<1e-5);

// The visible skin omits hidden backs; surface groups soften subdivisions while
// retaining the lap lip boundary. This is geometry, not a display-style trick.
const {lightTileSkin,tileRibbon}=await import('../src/traditional-timber/roof.mjs');
const point=(x,d)=>[x,d,0];
const skin=lightTileSkin(point,0,300,0,250,()=>0,x=>60*Math.sin(Math.PI*x/300),12,4);
assert.equal(skin.faces.length,16);
assert.equal(skin.cad_faces.length,skin.faces.length);
assert.equal(skin.smooth,'cad');
assert.equal(new Set(skin.cad_faces).size,2);
assert.equal(tileRibbon(point,0,300,0,250,()=>0,t=>60*Math.sin(Math.PI*t),18).faces.length,68);
assert.equal(resolveYfParameters({chi_mm:300}).tile_detail,'light');
assert.equal(resolveYfParameters({chi_mm:300,tile_detail:'detailed'}).tile_detail,'detailed');
console.log('Light tile skin keeps lap boundary and grouped curved surfaces with 16 versus 68 faces.');

// A narrow hip-cut first tile must not magnify an entire merged course.
const merged={vertices:[[0,0,0],[0,200,12],[0,200,0],[1,1,0],[1,200,12],[1,200,0],[10000,0,0]],faces:[[0,3,4],[0,4,1]]};
const course=reusable(builder,merged,'pan_tile_course','tile','hip-course-regression','course');
assert.equal(course.transform,undefined,'ill-conditioned course uses translation only');
for(const [i,q] of stored.vertices.entries())for(let j=0;j<3;j++)assert.ok(Math.abs(course.origin[j]+q[j]-merged.vertices[i][j])<1e-5);

// This real short course previously put its actual vertices near the gallery
// eave while SketchUp's transformed definition box reached 13 metres beyond.
const { buildYfRecipe }=await import('../src/traditional-timber/yf-recipe.mjs');
const hall=buildYfRecipe({parameters:{chi_mm:300,tile_detail:'light',middle_bay_chi:28}});
const clippedCourse=hall.parts.flatMap(part=>part.assembly?.children||[])
  .find(child=>child.instance_id?.endsWith('subsidiary-roof-north-pan-course-8-15'));
assert.ok(clippedCourse,'fixed hall must retain its clipped gallery course');
assert.equal(clippedCourse.transform,undefined,'short clipped course keeps tight native bounds');
