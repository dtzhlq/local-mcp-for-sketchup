# frozen_string_literal: true

require 'fileutils'
require 'json'
require 'tmpdir'

repo_root = File.expand_path('../..', __dir__)
support_dir = File.join(__dir__, 'support')
test_home = File.realpath(Dir.mktmpdir('alma-queue-atomicity-'))
ENV['HOME'] = test_home
$LOAD_PATH.unshift(support_dir)
require File.join(repo_root, 'sketchup_plugin', 'alma_sketchup_mcp')

def assert_equal(expected, actual, message)
  raise "#{message}: expected #{expected.inspect}, got #{actual.inspect}" unless expected == actual
end

def assert_truthy(value, message)
  raise message unless value
end

def assert_raises(error_class, message)
  yield
rescue error_class => error
  return error
else
  raise "#{message}: expected #{error_class}"
end

class FakeTransactionModel
  attr_accessor :value, :commit_result, :commit_error, :save_result, :write_saved_file
  attr_reader :events

  def initialize(value: 'before', commit_result: true, save_result: true, write_saved_file: true)
    @value = value
    @commit_result = commit_result
    @save_result = save_result
    @write_saved_file = write_saved_file
    @events = []
  end

  def start_operation(name, disable_ui)
    @events << ['start', name, disable_ui]
    @before_value = @value
    true
  end

  def commit_operation
    @events << ['commit']
    raise @commit_error if @commit_error

    @commit_result
  end

  def abort_operation
    @events << ['abort']
    @value = @before_value
    true
  end

  def save(path)
    @events << ['save']
    File.open(path, 'wb') { |file| file.write('fake-skp') } if @save_result && @write_saved_file
    @save_result
  end

  def save_copy(path)
    @events << ['save_copy']
    File.open(path, 'wb') { |file| file.write('fake-skp-copy') } if @save_result && @write_saved_file
    @save_result
  end
end

serialization_model = FakeTransactionModel.new
serialization_candidate = nil
serialization_error = assert_raises(AlmaSketchupMCP::QueueOperationError, 'non-JSON result must fail before commit') do
  AlmaSketchupMCP.with_atomic_model_transaction(serialization_model, 'Serialization Probe') do
    serialization_model.value = 'mutated'
    serialization_candidate = { 'snapshot' => { 'invalid_number' => Float::NAN } }
  end
end
assert_equal('before', serialization_model.value, 'serialization failure must restore the pre-operation value')
assert_equal([['start', 'Serialization Probe', true], ['abort']], serialization_model.events, 'serialization failure must abort without attempting commit')
assert_equal('precommit_serialization', serialization_error.details['phase'], 'serialization failure must identify its precommit phase')
assert_equal(true, serialization_error.details['abort_succeeded'], 'serialization failure must confirm fake rollback')
assert_equal(false, serialization_candidate.key?('mutation_receipt'), 'precommit failure must not receive a commit receipt')

generic_failure_model = FakeTransactionModel.new
generic_failure = assert_raises(AlmaSketchupMCP::QueueOperationError, 'generic precommit errors must retain the existing safe envelope') do
  AlmaSketchupMCP.with_atomic_model_transaction(generic_failure_model, 'Generic Failure Probe') do
    generic_failure_model.value = 'mutated'
    raise 'SECRET_ENTITY SECRET_MATERIAL /private/model.skp'
  end
end
assert_equal('MUTATION_EXECUTION_FAILED', generic_failure.code, 'generic precommit error code must remain stable')
assert_equal(false, generic_failure.details.key?('operation_failure_code'), 'non-Boolean failures must not fabricate a Boolean reason')
assert_equal(false, generic_failure.response_payload.to_s.include?('SECRET_'), 'generic precommit error must not echo native or model text')
assert_equal([['start', 'Generic Failure Probe', true], ['abort']], generic_failure_model.events, 'generic precommit failure must preserve abort semantics')

boolean_failure_model = FakeTransactionModel.new
boolean_failure = assert_raises(AlmaSketchupMCP::QueueOperationError, 'classified Boolean errors must retain the existing safe envelope') do
  AlmaSketchupMCP.with_atomic_model_transaction(boolean_failure_model, 'Boolean Failure Probe') do
    boolean_failure_model.value = 'mutated'
    raise AlmaSketchupMCP::BooleanOperationFailure.new('boolean_split_result_count_mismatch')
  end
end
assert_equal('MUTATION_EXECUTION_FAILED', boolean_failure.code, 'classified Boolean failure must retain the stable queue error code')
assert_equal('boolean_split_result_count_mismatch', boolean_failure.details['operation_failure_code'], 'classified Boolean failure must expose only its allowlisted reason')
assert_equal('precommit_execution', boolean_failure.details['phase'], 'classified Boolean failure must remain precommit')
assert_equal(true, boolean_failure.details['abort_succeeded'], 'classified Boolean failure must confirm rollback')
assert_equal([['start', 'Boolean Failure Probe', true], ['abort']], boolean_failure_model.events, 'classified Boolean failure must abort without committing')
assert_equal(false, boolean_failure.response_payload.to_s.include?('SECRET_'), 'classified Boolean response must not echo untrusted text')

commit_model = FakeTransactionModel.new(commit_result: false)
commit_candidate = nil
commit_error = assert_raises(AlmaSketchupMCP::QueueOperationError, 'false commit result must fail closed') do
  AlmaSketchupMCP.with_atomic_model_transaction(commit_model, 'Commit Probe') do
    commit_model.value = 'mutated'
    commit_candidate = { 'snapshot' => { 'value' => commit_model.value } }
  end
end
assert_equal('mutated', commit_model.value, 'false commit is outcome-unknown and must not be represented as rollback')
assert_equal([['start', 'Commit Probe', true], ['commit']], commit_model.events, 'false commit must never trigger a post-attempt abort')
assert_equal('commit', commit_error.details['phase'], 'false commit must report the commit phase')
assert_equal('outcome_unknown', commit_error.details['commit_state'], 'false commit must require inspection')
assert_equal(false, commit_candidate.key?('mutation_receipt'), 'unconfirmed commit must not receive a commit receipt')

commit_exception_model = FakeTransactionModel.new
commit_exception_model.commit_error = RuntimeError.new('/sensitive/path must not escape')
commit_exception_candidate = nil
commit_exception = assert_raises(AlmaSketchupMCP::QueueOperationError, 'commit exception must fail closed without abort') do
  AlmaSketchupMCP.with_atomic_model_transaction(commit_exception_model, 'Commit Exception Probe') do
    commit_exception_model.value = 'mutated'
    commit_exception_candidate = { 'snapshot' => { 'value' => commit_exception_model.value } }
  end
end
assert_equal([['start', 'Commit Exception Probe', true], ['commit']], commit_exception_model.events, 'commit exception must never trigger a post-attempt abort')
assert_equal('outcome_unknown', commit_exception.details['commit_state'], 'commit exception must require inspection')
assert_equal(false, commit_exception.response_payload.to_s.include?('/sensitive/path'), 'commit exception must not echo the raw error')
assert_equal(false, commit_exception_candidate.key?('mutation_receipt'), 'commit exception must not receive a commit receipt')

success_model = FakeTransactionModel.new
result = AlmaSketchupMCP.with_atomic_model_transaction(success_model, 'Success Probe') do
  success_model.value = 'after'
  { 'snapshot' => { 'value' => success_model.value } }
end
assert_equal('after', success_model.value, 'successful transaction must retain mutation')
assert_equal([['start', 'Success Probe', true], ['commit']], success_model.events, 'successful transaction must commit exactly once')
assert_equal('after', result.dig('snapshot', 'value'), 'successful transaction must return the prevalidated result')
assert_equal('mutation-receipt.v1', result.dig('mutation_receipt', 'version'), 'successful commit must return a stable receipt version')
assert_equal('sketchup_mutation_receipt', result.dig('mutation_receipt', 'kind'), 'successful commit must return a stable receipt kind')
assert_equal('Success Probe', result.dig('mutation_receipt', 'operation'), 'receipt must identify the bounded operation')
assert_equal('committed', result.dig('mutation_receipt', 'commit_state'), 'receipt must exist only for a confirmed commit')
assert_truthy(result.dig('mutation_receipt', 'committed_at').match?(/\A\d{4}-\d{2}-\d{2}T/), 'receipt must carry a JSON-safe timestamp')

original_active_model_or_new = AlmaSketchupMCP.method(:active_model_or_new)
original_persist_document_state = AlmaSketchupMCP.method(:persist_document_state)
original_snapshot = AlmaSketchupMCP.method(:snapshot)
save_model = FakeTransactionModel.new(save_result: false, write_saved_file: false)
AlmaSketchupMCP.define_singleton_method(:active_model_or_new) { |_method_name| save_model }
AlmaSketchupMCP.define_singleton_method(:persist_document_state) { |_model| raise 'save_model must not write sidecar state' }
AlmaSketchupMCP.define_singleton_method(:snapshot) { |model| { 'value' => model.value } }
save_target = File.join(test_home, 'saved', 'failure.skp')
save_error = assert_raises(AlmaSketchupMCP::QueueOperationError, 'save false must not be reported as success') do
  AlmaSketchupMCP.save_model(save_target, true)
end
assert_equal(false, File.exist?(save_target), 'failed save must not fabricate an artifact')
assert_equal(false, save_error.response_payload.to_s.include?(test_home), 'save error must not echo the sensitive target path')
assert_equal(false, save_error.response_payload['retryable'], 'save failure must not invite blind retry')

missing_file_model = FakeTransactionModel.new(save_result: true, write_saved_file: false)
AlmaSketchupMCP.define_singleton_method(:active_model_or_new) { |_method_name| missing_file_model }
missing_file_error = assert_raises(AlmaSketchupMCP::QueueOperationError, 'save true without a file must fail closed') do
  AlmaSketchupMCP.save_model(File.join(test_home, 'saved', 'missing.skp'), true)
end
assert_equal(false, missing_file_error.response_payload.to_s.include?(test_home), 'missing-file save error must not echo the target path')

copy_model = FakeTransactionModel.new
AlmaSketchupMCP.define_singleton_method(:active_model_or_new) { |_method_name| copy_model }
copy_result = AlmaSketchupMCP.save_model_version(
  'path' => File.join(test_home, 'saved', 'identity-preserved.skp'),
  'label' => 'reviewed-edit',
  'keep_session' => true
)
assert_equal([['save_copy']], copy_model.events, 'versioned keep-session saves must use save_copy instead of Save As')
assert_equal('copy', copy_result['save_mode'], 'versioned keep-session saves must report copy mode')
assert_equal(true, copy_result['active_model_identity_preserved'], 'versioned keep-session saves must preserve active model identity')
assert_truthy(File.file?(copy_result['file_path']), 'identity-preserving model copy must exist')

existing_copy_error = assert_raises(AlmaSketchupMCP::QueueOperationError, 'versioned save_copy must refuse an existing target') do
  AlmaSketchupMCP.save_model_version(
    'path' => File.join(test_home, 'saved', 'identity-preserved.skp'),
    'label' => 'reviewed-edit',
    'keep_session' => true
  )
end
assert_equal('save_copy_preflight', existing_copy_error.details['phase'], 'existing-copy refusal must identify its preflight phase')
assert_equal(false, existing_copy_error.details['target_absent'], 'existing-copy refusal must report that the target is occupied')
assert_equal([['save_copy']], copy_model.events, 'existing-copy refusal must happen before SketchUp save_copy is called again')
assert_equal(false, existing_copy_error.response_payload.to_s.include?(test_home), 'existing-copy refusal must not echo the sensitive target path')

symlink_victim = File.join(test_home, 'saved', 'symlink-victim.skp')
File.binwrite(symlink_victim, 'do-not-overwrite')
symlink_base = File.join(test_home, 'saved', 'symlink-target.skp')
symlink_final = File.join(test_home, 'saved', 'symlink-target-reviewed-edit.skp')
File.symlink(symlink_victim, symlink_final)
symlink_copy_error = assert_raises(AlmaSketchupMCP::QueueOperationError, 'versioned save_copy must refuse a symbolic-link target') do
  AlmaSketchupMCP.save_model_version(
    'path' => symlink_base,
    'label' => 'reviewed-edit',
    'keep_session' => true
  )
end
assert_equal('save_copy_preflight', symlink_copy_error.details['phase'], 'symlink refusal must identify its preflight phase')
assert_equal('do-not-overwrite', File.binread(symlink_victim), 'symlink refusal must preserve the linked file')
assert_equal([['save_copy']], copy_model.events, 'symlink refusal must happen before SketchUp save_copy is called')

ancestor_real_root = File.join(test_home, 'ancestor-real-root')
ancestor_real_parent = File.join(ancestor_real_root, 'nested')
FileUtils.mkdir_p(ancestor_real_parent)
ancestor_link_root = File.join(test_home, 'ancestor-link-root')
File.symlink(ancestor_real_root, ancestor_link_root)
ancestor_symlink_error = assert_raises(AlmaSketchupMCP::QueueOperationError, 'versioned save_copy must refuse a symlink anywhere in its ancestor chain') do
  AlmaSketchupMCP.save_model_version(
    'path' => File.join(ancestor_link_root, 'nested', 'ancestor-target.skp'),
    'label' => 'reviewed-edit',
    'keep_session' => true
  )
end
assert_equal('save_copy_preflight', ancestor_symlink_error.details['phase'], 'ancestor-symlink refusal must identify its preflight phase')
assert_equal(false, ancestor_symlink_error.details['ancestor_chain_verified'], 'ancestor-symlink refusal must report the failed chain verification')
assert_equal(false, File.exist?(File.join(ancestor_real_parent, 'ancestor-target-reviewed-edit.skp')), 'ancestor-symlink refusal must not write through the link')
assert_equal([['save_copy']], copy_model.events, 'ancestor-symlink refusal must happen before SketchUp save_copy is called')

copy_failure_model = FakeTransactionModel.new(save_result: false, write_saved_file: false)
AlmaSketchupMCP.define_singleton_method(:active_model_or_new) { |_method_name| copy_failure_model }
copy_failure = assert_raises(AlmaSketchupMCP::QueueOperationError, 'failed save_copy must fail closed') do
  AlmaSketchupMCP.save_model_version(
    'path' => File.join(test_home, 'saved', 'identity-preserved-failure.skp'),
    'label' => 'reviewed-edit',
    'keep_session' => true
  )
end
assert_equal('save_copy', copy_failure.details['phase'], 'copy failure must identify its persistence phase')
assert_equal(false, copy_failure.response_payload.to_s.include?(test_home), 'copy failure must not echo the sensitive target path')

AlmaSketchupMCP.define_singleton_method(:active_model_or_new, original_active_model_or_new)
AlmaSketchupMCP.define_singleton_method(:persist_document_state, original_persist_document_state)
AlmaSketchupMCP.define_singleton_method(:snapshot, original_snapshot)

FileUtils.mkdir_p(AlmaSketchupMCP::QUEUE_DIR)
FileUtils.mkdir_p(AlmaSketchupMCP::PROCESSING_DIR)
FileUtils.mkdir_p(AlmaSketchupMCP::RESPONSE_DIR)
dispatch_count = 0
original_dispatch = AlmaSketchupMCP.method(:dispatch)
AlmaSketchupMCP.define_singleton_method(:dispatch) do |_method, _params|
  dispatch_count += 1
  { 'mutation_count' => dispatch_count }
end

failed_id = '123-response-failure'
failed_request = File.join(AlmaSketchupMCP::QUEUE_DIR, "#{failed_id}.json")
File.write(failed_request, JSON.generate({ 'id' => failed_id, 'method' => 'build_model', 'params' => {} }))
original_file_rename = File.method(:rename)
File.define_singleton_method(:rename) do |source, destination|
  if destination.start_with?("#{AlmaSketchupMCP::RESPONSE_DIR}#{File::SEPARATOR}")
    raise Errno::EIO, 'injected response rename failure'
  end
  original_file_rename.call(source, destination)
end

AlmaSketchupMCP.process_pending_requests
failed_processing = File.join(AlmaSketchupMCP::PROCESSING_DIR, "#{failed_id}.json")
assert_equal(1, dispatch_count, 'response persistence failure must execute the claimed request at most once')
assert_truthy(File.file?(failed_processing), 'response persistence failure must retain the claimed request')
assert_equal(false, File.exist?(failed_request), 'claimed request must not be returned to queue for replay')
assert_equal([], Dir[File.join(AlmaSketchupMCP::RESPONSE_DIR, '*.json')], 'failed response must not expose a partial final file')
assert_equal([], Dir[File.join(AlmaSketchupMCP::RESPONSE_DIR, '.*.tmp')], 'failed response must remove its private temporary file')

later_id = '124-must-remain-unclaimed'
later_request = File.join(AlmaSketchupMCP::QUEUE_DIR, "#{later_id}.json")
File.write(later_request, JSON.generate({ 'id' => later_id, 'method' => 'build_model', 'params' => {} }))
AlmaSketchupMCP.process_pending_requests
assert_equal(1, dispatch_count, 'a retained claim must pause later queue execution across timer ticks')
assert_truthy(File.file?(later_request), 'later request must remain unclaimed while an outcome is unknown')

File.define_singleton_method(:rename, original_file_rename)
File.delete(failed_processing)
AlmaSketchupMCP.process_pending_requests
successful_response = File.join(AlmaSketchupMCP::RESPONSE_DIR, "#{later_id}.json")
assert_equal(2, dispatch_count, 'queue may resume only after the retained claim is explicitly cleared')
assert_truthy(File.file?(successful_response), 'successful response must be atomically visible at its final path')
assert_equal(false, File.exist?(File.join(AlmaSketchupMCP::PROCESSING_DIR, "#{later_id}.json")), 'processing marker must be removed only after response persistence')
assert_equal(2, JSON.parse(File.read(successful_response)).dig('result', 'mutation_count'), 'persisted response must contain the completed result')
assert_equal([], Dir[File.join(AlmaSketchupMCP::RESPONSE_DIR, '.*.tmp')], 'successful response must leave no temporary file')

AlmaSketchupMCP.define_singleton_method(:dispatch, original_dispatch)

report = {
  ok: true,
  tests: 49,
  precommit_serialization_abort: true,
  boolean_precommit_failure_classified: true,
  untrusted_failure_text_suppressed: true,
  commit_return_checked: true,
  mutation_receipt: true,
  response_claim_retained: true,
  replay_blocked: true,
  atomic_response: true,
  save_result_checked: true,
  identity_preserving_save_copy: true,
  save_ancestor_symlink_rejected: true
}
puts JSON.generate(report)
