import assert from 'node:assert/strict';
import { parseDetailAppearanceArguments } from '../scripts/run-detail-appearance-live.mjs';

assert.deepEqual(parseDetailAppearanceArguments(['--help']), { help: true });
const parsed = parseDetailAppearanceArguments(['preview', 'sample-window', 'pbr-v1', '--style-path', '/tmp/Photoreal.style', '--assignments-file', '/tmp/materials.json']);
assert.equal(parsed.action, 'preview'); assert.equal(parsed.swatches, true); assert.deepEqual(parsed.swatchOrigin, [8000, 0, 0]);
assert.equal(parsed.captureCurrentDisplay, false);
assert.equal(parseDetailAppearanceArguments(['preview', 'sample-window', 'capture-v1', '--style-path', '/tmp/donor.style', '--capture-current-display', 'true']).captureCurrentDisplay, true);
assert.match(parsed.catalogPath, /catalog-v2.json$/);
assert.equal(parseDetailAppearanceArguments(['apply', 'sample-window', 'pbr-v1']).action, 'apply');
assert.equal(parseDetailAppearanceArguments(['capture', 'sample-window', 'pbr-v1']).action, 'capture');
assert.equal(parseDetailAppearanceArguments(['reopen', 'sample-window', 'pbr-v1']).action, 'reopen');
for (const args of [
  ['preview', '../private', 'x', '--style-path', '/tmp/a.style'],
  ['preview', 'sample-window', 'x'],
  ['preview', 'sample-window', 'x', '--style-path', 'a.style'],
  ['preview', 'sample-window', 'x', '--style-path', '/tmp/a.skp'],
  ['preview', 'sample-window', 'x', '--style-path', '/tmp/a.style', '--swatches', 'yes'],
  ['preview', 'sample-window', 'x', '--style-path', '/tmp/a.style', '--capture-current-display', 'yes'],
  ['preview', 'sample-window', 'x', '--style-path', '/tmp/a.style', '--model-name', 'private.skp'],
  ['preview', 'sample-window', 'x', '--style-path', '/tmp/a.style', '--swatch-origin', '1,NaN,0'],
  ['preview', 'sample-window', 'x', '--style-path', '/tmp/a.style', '--catalog-file', 'relative.json'],
  ['apply', 'sample-window', 'x', '--style-path', '/tmp/replacement.style']
]) assert.throws(() => parseDetailAppearanceArguments(args));
console.log('detail appearance live runner argument guards: passed; import and tests do not construct a bridge or invoke queue');
