import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { modelRevisionForAdoption } from '../src/existing-model-editing.mjs';

// One tiny mock fixture: an expired undecided review can be renewed without
// staging/replacing geometry, altering its plan, or granting authorization.
const root=await fs.mkdtemp(path.join(os.tmpdir(),'assembly-review-recovery-'));
try {
  const bridge=new SketchUpBridge({mock:{sessionPath:path.join(root,'mock.json')},agentContract:{rootDir:path.join(root,'tasks')},approval:{stateDir:path.join(root,'approvals')},executionPolicy:{allowed_runtimes:['mock'],auto_approve_risks:[]}});
  await bridge.build_model({runtime:'mock',code:JSON.stringify({version:1,units:'mm',operations:[{op:'box',id:'review-box',name:'Review_Box',origin:[0,0,0],size:[100,100,100]}]})});
  const before=await bridge.adopt_open_model({runtime:'mock',recursive:true});
  const face=before.recursive_index.find(row=>row.entity_type==='face');
  const target={entity_path:face.entity_path,edit_scope:'instance_path',instance_policy:'definition_wide'};
  const response=await bridge.start_agent_task({intent:'reviewed_existing_model_edit',instruction:'Mock fixture only: move one face by 5 mm.',idempotency_key:'expired-review-fixture',inputs:{runtime:'mock',save_model:false,targets:[target],operations:[{op:'pushpull_face',...target,distance:5}]}});
  const original=await bridge.taskStore.getTask(response.task_id,{includePrivate:true});
  const expired={...original.result.approval_challenge,expires_at:new Date(Date.now()-1000).toISOString()};
  await fs.writeFile(bridge.approvalAuthority.challengePath(expired.challenge_id),JSON.stringify(expired));
  await bridge.taskStore.update(original.task_id,{result:{...original.result,approval_challenge:expired}});
  const resumed=await bridge.resume_agent_task({task_id:original.task_id});
  const renewed=await bridge.taskStore.getTask(original.task_id,{includePrivate:true});
  assert.equal(resumed.task_state,'awaiting_review');
  assert.equal(renewed.private.existing_edit_plan.plan_hash,original.private.existing_edit_plan.plan_hash);
  assert.notEqual(renewed.result.approval_challenge.challenge_id,expired.challenge_id);
  assert.equal(renewed.result.approval_challenge.review_context_hash,expired.review_context_hash);
  assert.deepEqual(renewed.result.approval_challenge.allowed_operations,expired.allowed_operations);
  assert.ok(Date.parse(renewed.result.approval_challenge.expires_at)>Date.now());
  assert.equal(await bridge.approvalAuthority.readDecision(renewed.result.approval_challenge.challenge_id,{allowMissing:true}),null);
  await assert.rejects(bridge.verify_agent_task_authorization_ready({task_id:original.task_id}),error=>error.code==='APPROVAL_REQUIRED');
  const second=await bridge.resume_agent_task({task_id:original.task_id});
  assert.equal(second.task_state,'awaiting_review');
  assert.equal((await bridge.taskStore.getTask(original.task_id)).result.approval_challenge.challenge_id,renewed.result.approval_challenge.challenge_id);
  assert.equal(modelRevisionForAdoption(await bridge.adopt_open_model({runtime:'mock',recursive:true})),modelRevisionForAdoption(before));
  console.log('Expired undecided review renewed with identical plan/context, no geometry change, no approval and stable resume.');
} finally {await fs.rm(root,{recursive:true,force:true});}
