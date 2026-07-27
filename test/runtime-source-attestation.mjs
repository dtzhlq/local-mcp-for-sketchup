import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import { BOOLEAN_OPERATIONS_SHA256, MODEL_REVISION_SOURCE_SHA256 } from '../src/runtime-source-attestation.mjs';
import { getRuntimeCapabilities } from '../src/capabilities.mjs';
import { SketchUpBridge } from '../src/bridge.mjs';

const execFileAsync = promisify(execFile);
const [booleanSource, modelRevisionSource, rubyManifest, rubyAttestation, rubyMain, packageSource] = await Promise.all([
  fs.readFile('sketchup_plugin/local_mcp_for_sketchup/boolean_operations.rb'),
  fs.readFile('sketchup_plugin/local_mcp_for_sketchup/model_revision.rb'),
  fs.readFile('sketchup_plugin/local_mcp_for_sketchup/runtime_source_manifest.rb', 'utf8'),
  fs.readFile('sketchup_plugin/local_mcp_for_sketchup/runtime_source_attestation.rb', 'utf8'),
  fs.readFile('sketchup_plugin/local_mcp_for_sketchup/bridge.rb', 'utf8'),
  fs.readFile('scripts/package-sketchup-plugin.mjs', 'utf8')
]);

const actual = crypto.createHash('sha256').update(booleanSource).digest('hex');
const actualModelRevision = crypto.createHash('sha256').update(modelRevisionSource).digest('hex');
assert.equal(BOOLEAN_OPERATIONS_SHA256, actual, 'server expectation must derive from the tracked runtime source manifest');
assert.equal(MODEL_REVISION_SOURCE_SHA256, actualModelRevision, 'server Model Revision expectation must derive from the tracked runtime source manifest');
assert.match(rubyManifest, new RegExp(`BOOLEAN_OPERATIONS_SHA256\\s*=\\s*'${actual}'`));
assert.match(rubyManifest, new RegExp(`MODEL_REVISION_SHA256\\s*=\\s*'${actualModelRevision}'`));
assert.equal(getRuntimeCapabilities('queue').boolean_operations_sha256, actual);
assert.equal(getRuntimeCapabilities('queue').model_revision_source_sha256, actualModelRevision);
assert.equal(getRuntimeCapabilities('mock').boolean_operations_sha256, undefined, 'source attestation applies only to the live Ruby queue runtime');
assert.equal(getRuntimeCapabilities('mock').model_revision_source_sha256, undefined, 'Model Revision source attestation applies only to the live Ruby queue runtime');

const legacyDescriptor = structuredClone(getRuntimeCapabilities('queue'));
delete legacyDescriptor.boolean_operations_sha256;
const legacyCapabilities = await new SketchUpBridge({
  queueRuntime: { async getCapabilities() { return legacyDescriptor; } }
}).get_capabilities({ runtime: 'queue' });
assert.equal(legacyCapabilities.runtime.compatibility.ok, false, 'a legacy live descriptor without source attestation must be incompatible');
assert.ok(legacyCapabilities.runtime.compatibility.issues.some((issue) =>
  issue.field === 'runtime.boolean_operations_sha256' && issue.severity === 'error'
));
const staleModelRevisionDescriptor = structuredClone(getRuntimeCapabilities('queue'));
delete staleModelRevisionDescriptor.model_revision_source_sha256;
const staleModelRevisionCapabilities = await new SketchUpBridge({
  queueRuntime: { async getCapabilities() { return staleModelRevisionDescriptor; } }
}).get_capabilities({ runtime: 'queue' });
assert.equal(staleModelRevisionCapabilities.runtime.compatibility.ok, false, 'a live descriptor without Model Revision source attestation must be incompatible');
assert.ok(staleModelRevisionCapabilities.runtime.compatibility.issues.some((issue) =>
  issue.field === 'runtime.model_revision_source_sha256' && issue.severity === 'error'
));
assert.match(rubyMain, /attest_model_revision!\([\s\S]*support_require\.call\('local_mcp_for_sketchup\/model_revision'\)/);
assert.match(rubyMain, /attest_boolean_operations!\([\s\S]*support_require\.call\('local_mcp_for_sketchup\/boolean_operations'\)/);
assert.match(rubyAttestation, /load_result = yield source_path/);
assert.match(rubyAttestation, /unless load_result == true/);

for (const fieldLocation of ['get_capabilities', 'get_session_state', 'assert_transport_guard!']) {
  const start = rubyMain.indexOf(`def ${fieldLocation}`);
  assert.ok(start >= 0, `missing Ruby method ${fieldLocation}`);
  assert.match(rubyMain.slice(start, start + 3200), /boolean_operations_sha256/, `${fieldLocation} must bind the loaded Boolean hash`);
  assert.match(rubyMain.slice(start, start + 3200), /model_revision_source_sha256/, `${fieldLocation} must bind the loaded Model Revision hash`);
}
for (const file of ['runtime_source_manifest.rb', 'runtime_source_attestation.rb']) {
  assert.ok(packageSource.includes(file), `plugin packaging must include ${file}`);
}

const ruby = await execFileAsync('ruby', ['test/ruby/runtime_source_attestation_test.rb']);
const rubyReport = JSON.parse(ruby.stdout.trim().split(/\r?\n/).at(-1));
assert.equal(rubyReport.ok, true);
assert.equal(rubyReport.boolean_operations_sha256, actual);
assert.equal(rubyReport.model_revision_source_sha256, actualModelRevision);
assert.equal(rubyReport.require_noop_rejected, true);
assert.equal(rubyReport.pre_load_drift_rejected, true);
assert.equal(rubyReport.load_boundary_drift_rejected, true);

process.stdout.write(`${JSON.stringify({
  ok: true,
  boolean_operations_sha256: actual,
  model_revision_source_sha256: actualModelRevision,
  capability_bound: true,
  legacy_capability_rejected: true,
  ruby_runtime_attested: true,
  require_noop_rejected: true,
  package_files_bound: true,
  live_queue_called: false,
  ruby_assertions: rubyReport.tests
}, null, 2)}\n`);
