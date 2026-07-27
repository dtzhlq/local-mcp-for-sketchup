import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const source = await fs.readFile(new URL('../sketchup_plugin/local_mcp_for_sketchup/bridge.rb', import.meta.url), 'utf8');

const startAt = source.indexOf('  def start\n');
const stopAt = source.indexOf('  def stop\n', startAt);
const announceAt = source.indexOf('  def announce_bridge_state(message)\n', stopAt);
const processingAt = source.indexOf('  def process_pending_requests\n', announceAt);

assert.ok(startAt >= 0 && stopAt > startAt && announceAt > stopAt && processingAt > announceAt);

const startBody = source.slice(startAt, stopAt);
const stopBody = source.slice(stopAt, announceAt);
const announceBody = source.slice(announceAt, processingAt);
const lifecycle = source.slice(startAt, processingAt);

assert.doesNotMatch(lifecycle, /UI\.messagebox/, 'bridge lifecycle feedback must remain non-modal');
assert.doesNotMatch(startBody, /\bstop if @timer_id\b/, 'restart must not enter the public stop path');
assert.doesNotMatch(startBody, /UI\.stop_timer/, 'repeated Start must preserve the live timer and session');
assert.match(startBody, /if @timer_id[\s\S]*already running[\s\S]*return @timer_id/);
assert.match(startBody, /@timer_id = UI\.start_timer\(1\.0, true\) \{ process_pending_requests \}/);
assert.ok(
  startBody.indexOf('@timer_id = UI.start_timer') < startBody.indexOf("announce_bridge_state('Local MCP for SketchUp Bridge is running.')"),
  'the poller must be installed before non-modal status feedback'
);
assert.match(stopBody, /return unless @timer_id/);
assert.match(stopBody, /announce_bridge_state\('Local MCP for SketchUp Bridge stopped\.'\)/);
assert.match(announceBody, /Sketchup\.status_text = message/);
assert.match(announceBody, /rescue StandardError/);

const ruby = await execFileAsync('ruby', [fileURLToPath(new URL('./ruby/bridge_lifecycle_test.rb', import.meta.url))]);
const rubyReport = JSON.parse(ruby.stdout.trim().split(/\r?\n/).at(-1));
assert.equal(rubyReport.ok, true);
assert.equal(rubyReport.start_idempotent, true);
assert.equal(rubyReport.session_preserved_on_repeated_start, true);
assert.equal(rubyReport.stop_idempotent, true);
assert.equal(rubyReport.modal_feedback, false);

console.log(JSON.stringify({
  modal_lifecycle_feedback: false,
  idempotent_start_path: true,
  poller_installed_before_feedback: true,
  non_modal_status_feedback: true,
  ruby_lifecycle_tests: rubyReport.tests
}, null, 2));
