import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveCurveSegments } from '../src/curve-resolution.mjs';
import { addCylinder, addArcCurve } from '../src/primitive-operations.mjs';
import { addPipeBetweenPoints, addSweptPath } from '../src/surface-operations.mjs';
import { emptyModel } from '../src/model-state.mjs';

assert.equal(resolveCurveSegments({}, 500), 16);
const cases = [
  { radius: 500, sweep: 360, tolerance: 0.5 },
  { radius: 30, sweep: 90, tolerance: 0.1 },
  { radius: 2000, sweep: -180, tolerance: 1 },
  { radius: 1, sweep: 360, tolerance: 2 }
];
const expected = cases.map(item => {
  const count = resolveCurveSegments({ chord_tolerance_mm: item.tolerance }, item.radius, { sweepDegrees: item.sweep });
  const actualSagitta = item.radius * (1 - Math.cos(Math.abs(item.sweep) * Math.PI / 180 / count / 2));
  assert.ok(actualSagitta <= item.tolerance + 1e-10, 'real polygon sagitta must satisfy the requested tolerance');
  return count;
});
assert.throws(() => resolveCurveSegments({ chord_tolerance_mm: 0.001, max_segments: 20 }, 1000), /requires.*segments/);
assert.throws(() => resolveCurveSegments({ chord_tolerance_mm: 0 }, 100), /finite and positive/);
assert.throws(() => resolveCurveSegments({ chord_tolerance_mm: 0.1, max_segments: 999999 }, 100), /4096/);
const ruby = spawnSync('ruby', ['-rjson', '-e', `require ${JSON.stringify(fileURLToPath(new URL('../sketchup_plugin/alma_sketchup_mcp/primitive_operations.rb', import.meta.url)))}; puts JSON.generate(JSON.parse(STDIN.read).map { |c| AlmaSketchupMCP.curve_segments({'chord_tolerance_mm'=>c['tolerance']},c['radius'],c['sweep'],16,3,96) })`], { input: JSON.stringify(cases), encoding: 'utf8' });
assert.equal(ruby.status, 0, ruby.stderr);
assert.deepEqual(JSON.parse(ruby.stdout), expected, 'Ruby and JS must allocate identical tessellation');
const model = emptyModel();
addCylinder(model, { name: 'C', origin: [0, 0, 0], radius: 500, height: 10, chord_tolerance_mm: 0.5 });
assert.equal(model.groups[0].segments, expected[0]);
addArcCurve(model, { name: 'A', radius: 500, end_angle: 90, chord_tolerance_mm: 0.5 });
addPipeBetweenPoints(model, { name: 'P', points: [[0,0,0],[100,0,0]], radius: 500, chord_tolerance_mm: 0.5 });
assert.equal(model.groups[2].segments, expected[0]);
addSweptPath(model, { name: 'S', path: [[0,0,0],[100,0,0]], radius: 500, chord_tolerance_mm: 0.5 });
assert.ok(model.groups[3].vertices.length >= expected[0] * 2);
console.log('curve-resolution: measured sagitta, explicit budgets, native/JS numeric parity and four construction integrations passed');
