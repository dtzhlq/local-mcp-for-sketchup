import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = path.join(repoRoot, 'sketchup_plugin');
const mainPath = path.join(pluginDir, 'alma_sketchup_mcp.rb');
const moduleDir = path.join(pluginDir, 'alma_sketchup_mcp');
const statePath = path.join(moduleDir, 'document_state.rb');
const snapshotPath = path.join(moduleDir, 'snapshot.rb');
const packagePath = path.join(repoRoot, 'scripts', 'package-sketchup-plugin.mjs');
const rubyUnitPath = path.join(repoRoot, 'test', 'ruby', 'document_state_test.rb');

const [main, state, snapshot, packageSource] = await Promise.all([
  fs.readFile(mainPath, 'utf8'),
  fs.readFile(statePath, 'utf8'),
  fs.readFile(snapshotPath, 'utf8'),
  fs.readFile(packagePath, 'utf8')
]);

assert.match(main, /require_relative 'alma_sketchup_mcp\/document_state'/);
assert.match(packageSource, /alma_sketchup_mcp\/document_state\.rb/);

const forbiddenSidecarGlobals = /@(warnings|scenes|levels|manifold_checks|view_state|style_state|shadow_state|rendering_options_state)\b/;
const rubyFiles = [mainPath, ...(await fs.readdir(moduleDir)).filter((name) => name.endsWith('.rb')).map((name) => path.join(moduleDir, name))];
for (const rubyPath of rubyFiles) {
  const source = await fs.readFile(rubyPath, 'utf8');
  assert.doesNotMatch(source, forbiddenSidecarGlobals, `${path.basename(rubyPath)} must not use process-global document sidecar fields`);
}

assert.match(state, /class DocumentActivationObserver < Sketchup::AppObserver/);
assert.match(state, /def onActivateModel\(model\)/);
assert.match(state, /record_activated_model\(model\)/);
assert.match(state, /def onOpenModel\(model\)\s+AlmaSketchupMCP\.record_opened_model\(model\)/);
assert.match(state, /def queue_active_model/);
const queueActiveBody = methodBody(state, 'queue_active_model', 'reconcile_queue_active_model');
const reconcileBody = methodBody(state, 'reconcile_queue_active_model', 'document_model_alive?');
assert.match(queueActiveBody, /return request_model if document_model_alive\?\(request_model\)/);
assert.match(queueActiveBody, /reconcile_queue_active_model/);
assert.ok(
  reconcileBody.indexOf('active = Sketchup.active_model') < reconcileBody.indexOf('observed = @observed_active_model'),
  'current Sketchup.active_model must be authoritative over the observer hint'
);
assert.match(reconcileBody, /record_activated_model\(active\) unless @observed_active_model\.equal\?\(active\)/);
assert.match(state, /model\.get_attribute\(DOCUMENT_STATE_DICTIONARY, DOCUMENT_STATE_ATTRIBUTE\)/);
assert.match(state, /model\.set_attribute\(DOCUMENT_STATE_DICTIONARY, DOCUMENT_STATE_ATTRIBUTE, encoded\)/);
assert.match(state, /DOCUMENT_STATE_MAX_BYTES = 1_000_000/);
assert.match(state, /DOCUMENT_STATE_ARRAY_FIELDS = %w\[warnings scenes levels manifold_checks\]/);

const openBody = methodBody(main, 'open_model', 'import_model');
assert.doesNotMatch(openBody, /active_model\.path did not switch/);
assert.match(openBody, /'open_status' => activated \? 'activated' : 'pending_mdi_activation'/);
assert.match(openBody, /'mutation_ready' => false/);
assert.match(openBody, /'requires_fresh_session' => true/);
assert.match(openBody, /@pending_open_request/);
const pendingBranch = openBody.slice(openBody.indexOf("@pending_open_request = {"));
assert.doesNotMatch(pendingBranch, /\['snapshot'\]|'snapshot'\s*=>/, 'pending MDI response must not snapshot the callback-local source document');

const dispatchBody = methodBody(main, 'dispatch', 'assert_transport_guard!');
const activeIdentityBody = methodBody(main, 'get_active_model_identity', 'reset_model');
assert.match(dispatchBody, /when 'get_active_model_identity'\s+get_active_model_identity/);
assert.match(activeIdentityBody, /pending_target_active = pending_before && pending_open_target_active\?\(model\)/);
assert.match(activeIdentityBody, /@pending_open_request = nil if pending_target_active/);
assert.match(activeIdentityBody, /'activation_confirmed' => !pending_before \|\| pending_target_active/);
assert.doesNotMatch(activeIdentityBody, /session_model_revision|snapshot\(/, 'active-model identity probe must stay O(1) with respect to model size');

const guardBody = methodBody(main, 'assert_transport_guard!', 'assert_pending_open_target!');
assert.ok(
  dispatchBody.indexOf('@queue_request_model = reconcile_queue_active_model') < dispatchBody.indexOf('assert_transport_guard!'),
  'dispatch must latch the focused document before checking the Session Contract guard'
);
assert.match(dispatchBody, /ensure\s+@queue_request_model = nil/);
assert.ok(
  guardBody.indexOf('assert_pending_open_target!(method, model)') < guardBody.indexOf("assert_transport_binding!(guard, 'session_id'"),
  'pending MDI activation must block before an otherwise-still-valid source-document guard is accepted'
);
assert.match(main, /@pending_open_request = nil if pending_open_target_active\?\(model\)/);
assert.ok(
  guardBody.indexOf('@pending_open_request = nil') > guardBody.lastIndexOf('assert_transport_binding!'),
  'pending open may clear only after the target document fresh guard passes every binding'
);

assert.match(snapshot, /'scenes' => snapshot_scenes\(model, state\)/);
assert.match(snapshot, /'view_state' => snapshot_view_state\(model, state\)/);

const rubyUnit = await execFileAsync('ruby', [rubyUnitPath], { cwd: repoRoot });
const rubyUnitReport = JSON.parse(rubyUnit.stdout.trim());
assert.equal(rubyUnitReport.ok, true);
assert.equal(rubyUnitReport.persistence, true);
assert.equal(rubyUnitReport.isolation, true);

for (const rubyPath of rubyFiles) {
  const syntax = await execFileAsync('ruby', ['-c', rubyPath], { cwd: repoRoot });
  assert.match(syntax.stdout, /Syntax OK/);
}

process.stdout.write(`${JSON.stringify({ ok: true, source_shape_tests: 30, ruby_unit_tests: rubyUnitReport.tests, ruby_syntax_files: rubyFiles.length }, null, 2)}\n`);

function methodBody(document, name, nextName) {
  const start = document.indexOf(`  def ${name}`);
  const end = document.indexOf(`  def ${nextName}`, start + 1);
  assert.ok(start >= 0 && end > start, `missing Ruby method boundary for ${name}`);
  return document.slice(start, end);
}
