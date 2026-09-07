import assert from 'node:assert/strict';
import path from 'node:path';
import { parseDetailAssemblyArguments, detailLiveModelPath, assemblyInspectionViews, DETAIL_LIVE_ROOT } from '../scripts/run-detail-assembly-edit-live.mjs';

// Importing this runner and parsing arguments must never construct a bridge or
// enqueue native work. The live guard is separately exercised by the operator.
assert.deepEqual(parseDetailAssemblyArguments(['--help']), { help: true });
const sourceViews={views:[{id:'overview',kind:'overview',camera:{eye:[1,2,3]}},{id:'unrelated-window',kind:'closeup'}]};
const target={reference:'measured-cabinet',bounding_box:{min:[100,200,0],max:[900,800,870]}};
const inspection=assemblyInspectionViews(sourceViews,[target]);
assert.equal(inspection.length,2);
assert.deepEqual(inspection[1].instance_path,['measured-cabinet']);
assert.deepEqual(inspection[1].camera.target,[500,500,435]);
for (const max of [[900,800,870],[120,220,2600],[4100,220,40]]) {
  const bounds={min:[100,200,0],max};
  const view=assemblyInspectionViews(sourceViews,[{reference:'framing-target',bounding_box:bounds}])[1];
  const radius=Math.hypot(...max.map((value,i)=>value-bounds.min[i]))/2;
  const distance=Math.hypot(...view.camera.eye.map((value,i)=>value-view.camera.target[i]));
  const angularRadius=Math.asin(radius/distance);
  const narrowHalfAngle=Math.atan(Math.tan(view.camera.fov*Math.PI/360)/(view.width/view.height));
  assert.ok(angularRadius<narrowHalfAngle,'Tall doors and wide railings must fit the narrower image axis');
}
const frozenCamera=structuredClone(inspection[1].camera);
target.bounding_box.max[0]=840;
assert.deepEqual(inspection[1].camera,frozenCamera,'Capture plan is frozen before editing, not recomputed at the new size');
assert.equal(sourceViews.views.length,2,'Original full-scene requirements remain intact');
assert.throws(()=>assemblyInspectionViews(sourceViews,[{reference:'unknown',bounding_box:{min:[0,0,0],max:[NaN,1,1]}}]),/measured native bounds/);
const valid = parseDetailAssemblyArguments(['run', 'sample-window', 'width-1800', '--parameters', '{"width":1800}', '--scope', 'single', '--pair-offset', '2200,0,0', '--expect-instances', '2']);
assert.equal(valid.scope, 'single'); assert.deepEqual(valid.parameters, { width: 1800 });
assert.deepEqual(valid.pairOffset, [2200, 0, 0]); assert.equal(valid.expectedInstances, 2);
assert.equal(detailLiveModelPath(valid.modelName), path.join(DETAIL_LIVE_ROOT, 'models/sample-window.skp'));
assert.equal(parseDetailAssemblyArguments(['reopen', 'sample-window', 'width-1800']).action, 'reopen');
const resumed = parseDetailAssemblyArguments(['run', 'sample-window', 'again', '--parameters', '{"width":1900}', '--scope', 'all', '--source-run', 'width-1800', '--model-name', 'sample-window-width-1800.skp']);
assert.equal(resumed.sourceRun, 'width-1800'); assert.equal(resumed.scope, 'all');
for (const argv of [
  ['run', '../private', 'a', '--parameters', '{"width":1}', '--scope', 'single'],
  ['run', 'sample-window', 'a', '--parameters', '{"width":1}'],
  ['run', 'sample-window', 'a', '--parameters', '{}', '--scope', 'single'],
  ['run', 'sample-window', 'a', '--parameters', '{"width":null}', '--scope', 'single'],
  ['run', 'sample-window', 'a', '--parameters', '{"width":1800}', '--scope', 'single', '--model-name', 'other.skp'],
  ['run', 'sample-window', 'a', '--parameters', '{"width":1800}', '--scope', 'single', '--model-name', '../sample-window.skp'],
  ['run', 'sample-window', 'a', '--parameters', '{"width":1800}', '--scope', 'single', '--pair-offset', '0,0,0'],
  ['run', 'sample-window', 'a', '--parameters', '{"width":1800}', '--scope', 'single', '--expect-instances', '11'],
  ['run', 'sample-window', 'a', '--parameters', '{"width":1800}', '--scope', 'single', '--recursive-limit', '100001'],
  ['run', 'sample-window', 'a', '--parameters', '{"width":1800}', '--scope', 'single', '--scope', 'all']
]) assert.throws(() => parseDetailAssemblyArguments(argv));
assert.throws(() => detailLiveModelPath('/tmp/user-project.skp'));
console.log('detail assembly live runner guards: passed (offline only)');
