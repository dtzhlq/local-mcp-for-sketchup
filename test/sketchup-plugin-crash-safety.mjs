import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginPath = path.join(repoRoot, 'sketchup_plugin', 'alma_sketchup_mcp.rb');
const booleanPluginPath = path.join(repoRoot, 'sketchup_plugin', 'alma_sketchup_mcp', 'boolean_operations.rb');
const rubyAtomicityPath = path.join(repoRoot, 'test', 'ruby', 'queue_atomicity_test.rb');
const source = await fs.readFile(pluginPath, 'utf8');
const booleanSource = await fs.readFile(booleanPluginPath, 'utf8');

const processBody = methodBody(source, 'process_pending_requests', 'add_warning');
assert.match(source, /PROCESSING_DIR = File\.join\(STATE_DIR, 'processing'\)/);
assert.match(processBody, /processing_path = claim_request\(request_path\)/);
assert.match(processBody, /JSON\.parse\(File\.read\(processing_path\)\)/);
assert.match(processBody, /queue_error_payload\(error, request\)/);
assert.match(processBody, /response_persisted && File\.exist\?\(processing_path\)/);
assert.match(processBody, /break unless response_persisted && claim_released/);
assert.match(processBody, /return if Dir\[File\.join\(PROCESSING_DIR, '\*\.json'\)\]\.any\?/);

const claimBody = methodBody(source, 'claim_request', 'add_warning');
assert.match(claimBody, /File\.rename\(request_path, processing_path\)/);
assert.match(claimBody, /Refusing to replay claimed queue request/);

const resetBody = methodBody(source, 'reset_model', 'build_model');
assert.match(resetBody, /assert_model_reset_preconditions\(model\)/);
assert.match(resetBody, /with_atomic_model_transaction\(model, 'Alma Reset Model'\)/);

const buildBody = methodBody(source, 'build_model', 'save_model');
assert.match(buildBody, /with_atomic_model_transaction\(model, 'Alma Build Model'\)/);
assert.ok(buildBody.indexOf('snapshot(model)') < buildBody.indexOf('ensure'), 'build snapshot must be produced inside the transaction block');

const importBody = methodBody(source, 'import_model', 'export_model');
assert.match(importBody, /OPERATION_NOT_ALLOWED/);
assert.match(importBody, /with_atomic_model_transaction\(model, 'Alma Import Model'\)/);

const adoptBody = methodBody(source, 'adopt_open_model', 'adoption_result');
assert.match(adoptBody, /with_atomic_model_transaction\(model, 'Alma Adopt Open Model'\)/);

const transactionBody = methodBody(source, 'with_atomic_model_transaction', 'assert_queue_result_serializable!');
assert.ok(transactionBody.indexOf('assert_queue_result_serializable!(result)') < transactionBody.indexOf('model.commit_operation'), 'result serialization must precede commit');
assert.match(transactionBody, /commit_ok == true/);
assert.match(transactionBody, /commit_attempted = true/);
assert.match(transactionBody, /operation_started && !commit_attempted/);
assert.match(transactionBody, /error\.is_a\?\(BooleanOperationFailure\)/);
assert.match(transactionBody, /details\['operation_failure_code'\] = error\.operation_failure_code/);
assert.match(booleanSource, /BOOLEAN_OPERATION_FAILURE_CODES = BOOLEAN_OPERATION_FAILURE_MESSAGES\.keys\.freeze/);
assert.match(booleanSource, /rescue StandardError => error\s+raise normalize_boolean_operation_failure\(error\)/);
assert.doesNotMatch(booleanSource, /Failed to copy boolean input[^\n]*error\.message/);

const responseBody = methodBody(source, 'write_response', 'queue_response_path');
assert.match(responseBody, /File::WRONLY \| File::CREAT \| File::EXCL/);
assert.match(responseBody, /file\.flush/);
assert.match(responseBody, /file\.fsync/);
assert.match(responseBody, /File\.rename\(temporary, target\)/);
assert.match(responseBody, /QueueResponsePersistenceError/);

const saveBody = methodBody(source, 'save_model', 'save_model_version');
assert.doesNotMatch(saveBody, /persist_document_state/, 'save failure must not leave a sidecar mutation');
assert.match(saveBody, /save_ok == true && File\.file\?\(target\)/);
assert.match(saveBody, /assert_queue_result_serializable!\(result\)/);
const saveCopyBody = methodBody(source, 'save_model_copy', 'save_model_version');
assert.match(saveCopyBody, /model\.save_copy\(target\)/);
assert.match(saveCopyBody, /active_model_identity_preserved/);
assert.match(saveCopyBody, /save_ok == true && File\.file\?\(target\)/);
assert.match(saveCopyBody, /assert_save_copy_ancestor_chain!\(parent, require_parent: false\)/);
assert.match(saveCopyBody, /assert_save_copy_ancestor_chain!\(parent, require_parent: true\)/);
assert.match(saveCopyBody, /assert_save_copy_target_absent!\(target\)/);
const saveAncestorBody = methodBody(source, 'assert_save_copy_ancestor_chain!', 'assert_save_copy_target_absent!');
assert.match(saveAncestorBody, /File\.lstat\(current\)/);
assert.match(saveAncestorBody, /stat&\.symlink\?/);
assert.match(saveAncestorBody, /File\.realpath\(expanded_parent\)/);
const saveTargetBody = methodBody(source, 'assert_save_copy_target_absent!', 'open_model');
assert.match(saveTargetBody, /File\.exist\?\(target\) \|\| File\.symlink\?\(target\)/);
assert.match(saveTargetBody, /overwrite is forbidden/);
const saveVersionBody = methodBody(source, 'save_model_version', 'open_model');
assert.match(saveVersionBody, /keep_session[\s\S]*save_model_copy\(target\)/);

const dispatchBody = methodBody(source, 'dispatch', 'assert_transport_guard!');
assert.match(dispatchBody, /assert_transport_guard!\(method, params, transport_guard\)/);
const guardBody = methodBody(source, 'assert_transport_guard!', 'assert_transport_binding!');
assert.match(guardBody, /HANDSHAKE_REQUIRED/);
assert.match(guardBody, /HANDSHAKE_SESSION_MISMATCH/);
assert.match(guardBody, /HANDSHAKE_MODEL_REVISION_MISMATCH/);

const preflightBody = methodBody(source, 'assert_model_reset_preconditions', 'clear_model');
assert.match(preflightBody, /active_path/);
assert.match(preflightBody, /locked top-level entities/);

const clearBody = methodBody(source, 'clear_model', 'parse_dsl');
const pagesIndex = clearBody.indexOf('model.pages.to_a.each');
const entitiesIndex = clearBody.indexOf('model.entities.clear!');
assert.ok(pagesIndex >= 0 && entitiesIndex > pagesIndex, 'scenes must be erased before geometry to avoid dangling scene entity references');

const syntax = await execFileAsync('ruby', ['-c', pluginPath]);
assert.match(syntax.stdout, /Syntax OK/);
const rubyAtomicity = await execFileAsync('ruby', [rubyAtomicityPath], { cwd: repoRoot });
const rubyReport = JSON.parse(rubyAtomicity.stdout.trim());
assert.equal(rubyReport.ok, true);
assert.equal(rubyReport.precommit_serialization_abort, true);
assert.equal(rubyReport.boolean_precommit_failure_classified, true);
assert.equal(rubyReport.untrusted_failure_text_suppressed, true);
assert.equal(rubyReport.commit_return_checked, true);
assert.equal(rubyReport.mutation_receipt, true);
assert.equal(rubyReport.response_claim_retained, true);
assert.equal(rubyReport.replay_blocked, true);
assert.equal(rubyReport.save_result_checked, true);
assert.equal(rubyReport.save_ancestor_symlink_rejected, true);

process.stdout.write(`${JSON.stringify({ ok: true, source_shape_tests: 30, ruby_unit_tests: rubyReport.tests, ruby_syntax: true }, null, 2)}\n`);

function methodBody(document, name, nextName) {
  const start = document.indexOf(`  def ${name}`);
  const end = document.indexOf(`  def ${nextName}`, start + 1);
  assert.ok(start >= 0 && end > start, `missing Ruby method boundary for ${name}`);
  return document.slice(start, end);
}
