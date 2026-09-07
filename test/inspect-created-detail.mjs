import assert from 'node:assert/strict';
import { inspectCreatedDetail } from '../scripts/lib/inspect-created-detail.mjs';
import { freezeDetailSpecification } from '../src/detail-quality.mjs';

const frozen = freezeDetailSpecification({ version: 1,
  required_parts: [{ id: 'leaf', instance_path: ['root', 'leaf'], min_faces: 6 }],
  required_views: [{ id: 'near', target_id: 'leaf', min_width: 100, min_height: 100 }] });
for (const mode of ['valid', 'missing', 'drift', 'capture-error', 'restore-error', 'forged-spec', 'wrong-model']) {
  const task = { intent: 'create_model', state: 'failed', inputs: { views: [{ id: 'near', eye: [1, 2, 3] }],
    snapshot: { forged: true } }, private: { creation: { runtime: 'queue', frozen_spec: structuredClone(frozen),
    identity_map: { root: 'native_root', leaf: 'native_leaf' }, round: { phase: 'executing' } } } };
  if (mode === 'forged-spec') task.private.creation.frozen_spec.hash = 'forged';
  const original = structuredClone(task);
  let reads = 0, captures = 0;
  const bridge = {
    taskStore: { getTask: async () => task },
    inspect_model: async () => { reads++; return { snapshot: { model_revision: mode === 'drift' && reads > 1 ? 'changed' : 'revision', model_revision_complete: true,
      geometry_occurrences: mode === 'missing' ? [] : [{ part_id: 'native_leaf', instance_path: ['native_root', 'native_leaf'],
        geometry_evidence: { source: 'sketchup_runtime', measured: true, complete: true, face_count: 6 } }] } }; },
    validate_model: async ({ snapshot }) => { assert.equal(snapshot.forged, undefined); return { ok: true, verdict: 'pass' }; },
    create_queue_handshake: async () => ({ session_contract: { fresh: true } }),
    capture_detail_views: async request => {
      captures++;
      assert.equal(request.views[0].target_id, 'native_leaf');
      assert.equal(request.session_contract.fresh, true);
      if (mode === 'capture-error') throw new Error('capture failed');
      return { restored: mode !== 'restore-error', captures: [{ id: 'near', model_revision: 'revision', server_verified: true, width: 100, height: 100 }] };
    }
  };
  const execute = () => inspectCreatedDetail({ bridge, taskId: 'source', outputDir: '/test-only',
    assertActive: async () => { if (mode === 'wrong-model') throw new Error('Wrong active test model'); } });
  if (['forged-spec', 'wrong-model'].includes(mode)) {
    await assert.rejects(execute);
    assert.equal(reads, 0); assert.equal(captures, 0);
  } else {
    const result = await execute();
    assert.equal(result.quality_accepted, mode === 'valid', mode);
    assert.equal(result.original_execution_recovered, false);
    assert.equal(result.source_execution_state, 'failed');
    assert.equal(reads, 2);
  }
  assert.deepEqual(task, original, 'Independent inspection cannot rewrite the failed task or its frozen requirements');
}
console.log('inspect-created-detail: fresh mapped inspection, missing parts, revision drift, failed capture/restoration, frozen integrity and model guard passed (offline fixtures)');

for (const mode of ['valid', 'missing', 'different-root', 'changed-root-pid', 'unknown-logical', 'defective-geometry']) {
  const task = { intent:'create_model', state:'failed', inputs:{}, private:{creation:{runtime:'queue',
    frozen_spec:freezeDetailSpecification({version:1,required_parts:[{id:'leaf',instance_path:['root','leaf'],min_faces:6}]}),
    identity_map:{root:'native_root',leaf:'old_leaf'},round:{snapshot:{geometry_occurrences:[{instance_path:['native_root'],persistent_path:[123]}]}}}}};
  const original=structuredClone(task);
  const snapshot={model_revision:'fresh',model_revision_complete:true,geometry_occurrences:[
    {instance_path:['native_root'],persistent_path:[mode==='changed-root-pid'?999:123]},
    ...(mode==='missing'?[]:[{instance_path:['native_root','new_leaf'],persistent_path:[123,456],part_id:'new_leaf',
      geometry_evidence:{source:'sketchup_runtime',measured:true,complete:true,face_count:mode==='defective-geometry'?0:6}}])
  ]};
  const bridge={taskStore:{getTask:async()=>task},inspect_model:async()=>({snapshot}),validate_model:async()=>({ok:true,verdict:'pass'})};
  const binding = {[JSON.stringify(['root',mode==='unknown-logical'?'unknown':'leaf'])]:[mode==='different-root'?'other_root':'native_root','new_leaf']};
  const inspect=()=>inspectCreatedDetail({bridge,taskId:'original',assertActive:async()=>{},observedOccurrencePathMap:binding});
  if (['valid','defective-geometry'].includes(mode)) {
    const result=await inspect();assert.equal(result.quality_accepted,mode==='valid');
    assert.equal(result.binding_scope,'independent_inspection_only');assert.equal(result.original_execution_recovered,false);
    assert.equal(result.specification_hash,task.private.creation.frozen_spec.hash);
  } else await assert.rejects(inspect);
  assert.deepEqual(task,original,'Observed inspection cannot authorize an edit or change original task bindings');
}
console.log('observed binding inspection: stable native root, complete original requirements, missing/forged/defective negatives passed');
