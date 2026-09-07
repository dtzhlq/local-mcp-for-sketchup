import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MockRuntime } from '../src/mock-runtime.mjs';
import { buildDetailedRecipeSample, buildDetailedScene } from '../src/detailed-modeling/scenes.mjs';
import { scanlineProfileTriangles, exportOfflineRegionRecords, offlineRegionQueries, evaluateOfflineRegionQueries } from './support/detail-region-offline-adapter.mjs';

const area=t=>Math.abs((t[1][0]-t[0][0])*(t[2][1]-t[0][1])-(t[1][1]-t[0][1])*(t[2][0]-t[0][0]))/2;
const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
assert.equal(scanlineProfileTriangles([rect(0,0,100,100),rect(30,40,20,30)]).reduce((sum,t)=>sum+area(t),0),9400);
assert.equal(scanlineProfileTriangles([rect(0,0,100,100),rect(30,0,20,80)]).reduce((sum,t)=>sum+area(t),0),8400);
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'detail-recipe-regions-'));
try {
  const mirroredEntry=buildDetailedScene({scene:'entry-facade'});
  const wallPlacement=mirroredEntry.dsl.operations.find(op=>op.op==='component_instance'&&op.id==='id-entry-wall');
  wallPlacement.origin=[0,308,0];wallPlacement.transform={mirror:['y']};
  const cases=[
    ['paving',buildDetailedRecipeSample({kind:'paving',id:'audit-paving',parameters:{depth:1500,tile_depth:300}})],
    ['cabinet',buildDetailedRecipeSample({kind:'cabinet',id:'audit-cabinet'})],
    ['cabinet-extended',buildDetailedRecipeSample({kind:'cabinet',id:'audit-cabinet-extended',parameters:{drawer_extension:160}})],
    ['sink',buildDetailedRecipeSample({kind:'sink',id:'audit-sink'})],
    ['wall',buildDetailedRecipeSample({kind:'wall_junction',id:'audit-wall',parameters:{width:4800,height:2900,openings:[{name:'Door',x:600,y:0,width:1000,height:2200},{name:'Window',x:2200,y:1100,width:1400,height:1100}]}})],
    ['eaves-drainage',buildDetailedRecipeSample({kind:'eaves_drainage',id:'audit-eaves'})],
    ['kitchen',buildDetailedScene({scene:'kitchen'})],
    ['kitchen-edited',buildDetailedScene({scene:'kitchen',variant:'edited'})],
    ['entry-facade',buildDetailedScene({scene:'entry-facade'})],
    ['entry-facade-edited',buildDetailedScene({scene:'entry-facade',variant:'edited'})],
    ['entry-wall-mirrored',mirroredEntry]
  ];
  const summaries=[],failures=[];
  for(const [id,bundle] of cases){
    const runtime=new MockRuntime({sessionPath:path.join(directory,`${id}.json`)});
    await runtime.buildModel(JSON.stringify(bundle.dsl));
    const exported=exportOfflineRegionRecords(bundle,await runtime.readModel()),queries=offlineRegionQueries(bundle,exported);
    if(id==='entry-wall-mirrored'){
      const lining=exported.records.find(r=>r.reference_path.at(-1)==='entry-wall-inner-lining');
      assert.ok(Math.abs(lining.min[1]-293)<1e-6&&Math.abs(lining.max[1]-308)<1e-6,'Offline transforms must actually reflect the wall, not silently ignore mirror');
      const corner=exported.records.filter(r=>r.reference_path.at(-1).endsWith('corner-return'));
      assert.ok(corner.every(r=>r.min[1]>=-1e-6),'The mirrored corner lies behind the facade and outside platform paving');
    }
    const results=evaluateOfflineRegionQueries(queries);
    if(id==='eaves-drainage'){
      const blocked=structuredClone(bundle);
      const removePenetration=operations=>operations.forEach(op=>{
        if(op.operations)removePenetration(op.operations);
        if(op.op==='profile_extrude'&&op.id?.endsWith('-soffit'))op.holes.pop();
      });
      removePenetration(blocked.dsl.operations);
      // Reconstruct only the old unperforated soffit in the geometric adapter;
      // retain the strengthened specification to expose the former false pass.
      const oldRecords=exportOfflineRegionRecords(blocked,await runtime.readModel());
      const waterway=offlineRegionQueries(blocked,oldRecords).find(entry=>entry.query.id.endsWith('assembled-downpipe-waterway'));
      const regression=evaluateOfflineRegionQueries([waterway])[0];
      assert.equal(regression.status,'fail','A pan hole must not hide a soffit blocking the assembled downpipe');
      assert.ok(regression.blocker_path.at(-1).endsWith('soffit'));
    }
    if(id==='paving'){
      const capped=structuredClone(queries.find(entry=>entry.query.id.endsWith('grate-0-waterway')));
      const tile=structuredClone(exported.records.find(record=>record.reference_path.at(-1).endsWith('tile-body')));
      const dy=1400-tile.min[1];
      tile.min[1]+=dy;tile.max[1]+=dy;
      tile.triangles=tile.triangles.map(triangle=>triangle.map(point=>[point[0],point[1]+dy,point[2]]));
      capped.records.push(tile);
      assert.notEqual(evaluateOfflineRegionQueries([capped])[0].status,'pass','A separate tile covering a grate must fail the assembled waterway even if the grate itself has holes');
    }
    if(id==='sink'){
      const previousClearance=structuredClone(bundle);
      previousClearance.detail_spec.required_voids.find(rule=>rule.id.endsWith('basin-interior')).bounds_mm.min[2]=4.2;
      const main=offlineRegionQueries(previousClearance,exported).find(entry=>entry.query.id.endsWith('basin-interior'));
      const regression=evaluateOfflineRegionQueries([main])[0];
      assert.equal(regression.status,'fail');assert.ok(regression.blocker_path.at(-1).endsWith('drain-flange'),'The former 4.2 mm clearance must still detect the actual flange');
      const floor=structuredClone(queries.find(entry=>entry.query.id.endsWith('basin-floor-support')));
      floor.records=floor.records.filter(record=>!record.reference_path.at(-1).endsWith('basin-bottom'));
      assert.notEqual(evaluateOfflineRegionQueries([floor])[0].status,'pass','Removing the actual basin floor must invalidate floor support');
    }
    if(id==='wall'){
      const layer=structuredClone(queries.find(entry=>entry.query.id.endsWith('opening-1-inner-lining-reveals')));
      layer.records=layer.records.filter(record=>!record.reference_path.at(-1).endsWith('inner-lining'));
      assert.notEqual(evaluateOfflineRegionQueries([layer])[0].status,'pass','Another wall layer must not stand in for the missing lining reveal');
    }
    if(id==='kitchen'){
      const lower=structuredClone(queries.find(entry=>entry.query.id==='kitchen-island-lower-open-shelf'));
      lower.records=lower.records.filter(record=>record.reference_path.at(-1)!=='kitchen-island-lower-shelf');
      assert.notEqual(evaluateOfflineRegionQueries([lower])[0].status,'pass','Missing island lower shelf must invalidate its real supporting boundary');
    }
    summaries.push({id,queries:queries.length,records:exported.records.length,triangles:exported.records.reduce((sum,r)=>sum+r.triangles.length,0),methods:exported.methods});
    failures.push(...results.filter(result=>result.status!=='pass').map(result=>({case:id,...result})));
    assert.ok(results.every(result=>result.evidence_source==='offline_constructive_adapter_not_sketchup_runtime'));
  }
  console.log(JSON.stringify({evidence:'offline_constructive_geometry_plus_native_numeric_algorithm_not_live',summaries,failures:failures.map(f=>({case:f.case,id:f.id,status:f.status,reason:f.reason,blocker_path:f.blocker_path,boundaries:f.boundary_results?.filter(b=>b.status!=='pass').map(b=>({side:b.side,status:b.status}))}))},null,2));
  assert.equal(failures.length,0,'Detailed recipe clearances and their claimed support slabs must pass the numeric geometry audit');
} finally {await fs.rm(directory,{recursive:true,force:true});}
