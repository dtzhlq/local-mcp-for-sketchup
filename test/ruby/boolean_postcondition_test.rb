# frozen_string_literal: true

require 'tmpdir'

repo_root = File.expand_path('../..', __dir__)
support_dir = File.join(__dir__, 'support')
ENV['HOME'] = Dir.mktmpdir('alma-boolean-postcondition-')
$LOAD_PATH.unshift(support_dir)
require File.join(repo_root, 'sketchup_plugin', 'alma_sketchup_mcp')

def assert_truthy(value, message)
  raise message unless value
end

def assert_equal(expected, actual, message)
  raise "#{message}: expected #{expected.inspect}, got #{actual.inspect}" unless expected == actual
end

def assert_raises(message, pattern = nil)
  yield
rescue StandardError => error
  raise "#{message}: #{error.message.inspect} did not match #{pattern.inspect}" if pattern && !error.message.match?(pattern)

  error
else
  raise "#{message}: expected an exception"
end

class FakeBooleanEntities < Array; end

class FakeBooleanGroup < Sketchup::Group
  attr_accessor :name, :split_result, :volume
  attr_reader :entityID, :persistent_id

  def initialize(parent:, name:, id:, erase_error: nil, volume: 1.0)
    @parent = parent
    @name = name
    @alma_id = id
    @entityID = id.hash
    @persistent_id = @entityID.abs
    @erase_error = erase_error
    @volume = volume
    @deleted = false
    parent << self
  end

  def get_attribute(dictionary, key)
    return @alma_id if dictionary == 'AlmaSketchupMCP' && key == 'id'

    nil
  end

  def valid?
    !@deleted
  end

  def deleted?
    @deleted
  end

  def erase!
    raise @erase_error if @erase_error

    @deleted = true
    @parent.delete(self)
    true
  end

  def split(_tool)
    @split_result
  end
end

class FakeBooleanTransactionModel
  attr_reader :events

  def initialize
    @events = []
  end

  def start_operation(*_args)
    @events << 'start'
    true
  end

  def commit_operation
    @events << 'commit'
    true
  end

  def abort_operation
    @events << 'abort'
    true
  end
end

tests = 0

expected_failure_codes = %w[
  boolean_input_resolution_failed
  boolean_input_not_group
  boolean_input_scope_mismatch
  boolean_input_not_manifold
  boolean_duplicate_input
  boolean_result_identity_conflict
  boolean_solid_operation_unavailable
  boolean_input_copy_failed
  boolean_split_result_count_mismatch
  boolean_split_result_type_invalid
  boolean_solid_volume_invalid
  boolean_target_volume_not_reduced
  boolean_solid_operation_failed
  boolean_result_not_manifold
  boolean_cleanup_failed
  boolean_postcondition_failed
  boolean_internal_failure
]
tests += 1; assert_equal(expected_failure_codes, AlmaSketchupMCP::BOOLEAN_OPERATION_FAILURE_CODES, 'Boolean failure codes must remain a stable ordered allowlist')
tests += 1; assert_truthy(AlmaSketchupMCP::BOOLEAN_OPERATION_FAILURE_CODES.frozen?, 'Boolean failure-code allowlist must be frozen')

secret_error = RuntimeError.new('SECRET_ENTITY SECRET_MATERIAL /private/model.skp')
internal_failure = AlmaSketchupMCP.normalize_boolean_operation_failure(secret_error)
tests += 1; assert_equal('boolean_internal_failure', internal_failure.operation_failure_code, 'unknown Boolean exceptions must use the bounded internal fallback')
tests += 1; assert_equal(false, internal_failure.message.include?('SECRET_') || internal_failure.message.include?('/private/'), 'internal fallback must not echo an exception message')
invalid_code_failure = AlmaSketchupMCP::BooleanOperationFailure.new('SECRET_ENUM')
tests += 1; assert_equal('boolean_internal_failure', invalid_code_failure.operation_failure_code, 'unknown failure-code values must fail closed to the internal fallback')

entities = FakeBooleanEntities.new
target = FakeBooleanGroup.new(parent: entities, name: 'Target', id: 'target')
tool = FakeBooleanGroup.new(parent: entities, name: 'Tool', id: 'tool')
collision = FakeBooleanGroup.new(parent: entities, name: 'Result', id: 'result')
tests += 1
collision_error = assert_raises('a kept result identity collision must fail closed') do
  AlmaSketchupMCP.assert_boolean_result_identity_available(
    entities.dup, target, [tool], 'result', 'Result', true, true, 'boolean_difference'
  )
end
tests += 1; assert_equal('boolean_result_identity_conflict', collision_error.operation_failure_code, 'result identity collision must be classified')
collision.erase!

split_parent = FakeBooleanEntities.new
split_target = FakeBooleanGroup.new(parent: split_parent, name: 'SplitTarget', id: 'split-target')
split_tool = FakeBooleanGroup.new(parent: split_parent, name: 'SplitTool', id: 'split-tool')
split_target.split_result = 4.times.map do |index|
  FakeBooleanGroup.new(parent: split_parent, name: "Piece#{index}", id: "piece-#{index}")
end
tests += 1
split_count_error = assert_raises('extra split pieces must never be ignored', /exactly 3 result pieces/) do
  AlmaSketchupMCP.solid_difference_result(split_target, split_tool, 'boolean_difference')
end
tests += 1; assert_equal('boolean_split_result_count_mismatch', split_count_error.operation_failure_code, 'split-piece count mismatch must be classified')
tests += 1; assert_equal(false, split_count_error.message.include?('SplitTarget') || split_count_error.message.include?('SplitTool'), 'split-piece count failure must not echo entity names')

exact_parent = FakeBooleanEntities.new
exact_target = FakeBooleanGroup.new(parent: exact_parent, name: 'ExactTarget', id: 'exact-target', volume: 100.0)
exact_tool = FakeBooleanGroup.new(parent: exact_parent, name: 'ExactTool', id: 'exact-tool', volume: 25.0)
difference_other = FakeBooleanGroup.new(parent: exact_parent, name: 'OtherMinusTarget', id: 'other', volume: 1.0)
difference = FakeBooleanGroup.new(parent: exact_parent, name: 'TargetMinusOther', id: 'difference', volume: 75.0)
intersection = FakeBooleanGroup.new(parent: exact_parent, name: 'Intersection', id: 'intersection', volume: 25.0)
exact_target.split_result = [difference_other, difference, intersection]
returned = AlmaSketchupMCP.solid_difference_result(exact_target, exact_tool, 'boolean_difference')
tests += 1; assert_truthy(returned.equal?(difference), 'the second documented split piece must be the target difference result')
tests += 1; assert_truthy(difference_other.deleted?, 'Difference2 (other - target) must be strictly erased')
tests += 1; assert_truthy(intersection.deleted?, 'the intersection piece must be strictly erased')

no_reduction_parent = FakeBooleanEntities.new
no_reduction_target = FakeBooleanGroup.new(parent: no_reduction_parent, name: 'NoReductionTarget', id: 'no-reduction-target', volume: 100.0)
no_reduction_tool = FakeBooleanGroup.new(parent: no_reduction_parent, name: 'NoReductionTool', id: 'no-reduction-tool', volume: 25.0)
no_reduction_other = FakeBooleanGroup.new(parent: no_reduction_parent, name: 'OtherMinusTarget', id: 'no-reduction-other', volume: 1.0)
no_reduction_result = FakeBooleanGroup.new(parent: no_reduction_parent, name: 'UnchangedTarget', id: 'unchanged-target', volume: 100.0)
no_reduction_intersection = FakeBooleanGroup.new(parent: no_reduction_parent, name: 'Intersection', id: 'no-reduction-intersection', volume: 25.0)
no_reduction_target.split_result = [no_reduction_other, no_reduction_result, no_reduction_intersection]
tests += 1
no_reduction_error = assert_raises('a no-op target difference must fail before commit', /did not reduce target volume/) do
  AlmaSketchupMCP.solid_difference_result(no_reduction_target, no_reduction_tool, 'boolean_difference')
end
tests += 1; assert_equal('boolean_target_volume_not_reduced', no_reduction_error.operation_failure_code, 'no-op target difference must be classified')

input_manifold_error = assert_raises('a non-manifold reviewed input must be classified') do
  AlmaSketchupMCP.assert_boolean_manifold_report!({ 'is_manifold' => false, 'name' => 'SECRET_ENTITY' }, 'boolean_input_not_manifold')
end
tests += 1; assert_equal('boolean_input_not_manifold', input_manifold_error.operation_failure_code, 'input manifold failure must use the input code')
tests += 1; assert_equal(false, input_manifold_error.message.include?('SECRET_ENTITY'), 'input manifold failure must not echo report data')
result_manifold_error = assert_raises('a non-manifold Boolean result must be classified') do
  AlmaSketchupMCP.assert_boolean_manifold_report!({ 'is_manifold' => false, 'name' => 'SECRET_RESULT' }, 'boolean_result_not_manifold')
end
tests += 1; assert_equal('boolean_result_not_manifold', result_manifold_error.operation_failure_code, 'result manifold failure must use the result code')
tests += 1; assert_equal(false, result_manifold_error.message.include?('SECRET_RESULT'), 'result manifold failure must not echo report data')

copy_failure = assert_raises('copy failures must be classified without native error text') do
  AlmaSketchupMCP.copy_boolean_group(nil, no_reduction_target, 'SECRET_COPY_NAME')
end
tests += 1; assert_equal('boolean_input_copy_failed', copy_failure.operation_failure_code, 'copy failure must use the bounded copy code')
tests += 1; assert_equal(false, copy_failure.message.include?('SECRET_COPY_NAME'), 'copy failure must not echo the requested copy name')

failing_parent = FakeBooleanEntities.new
failing_erase = FakeBooleanGroup.new(parent: failing_parent, name: 'SECRET_CANNOT_ERASE', id: 'cannot-erase', erase_error: 'SECRET_NATIVE_ERASE_FAILURE')
tests += 1
cleanup_error = assert_raises('cleanup erase errors must propagate to the model transaction') do
  AlmaSketchupMCP.erase_entity_strict!(failing_erase, 'boolean.failure_probe')
end
tests += 1; assert_equal('boolean_cleanup_failed', cleanup_error.operation_failure_code, 'cleanup failure must use the bounded cleanup code')
tests += 1; assert_equal(false, cleanup_error.message.include?('SECRET_'), 'cleanup failure must not echo entity or native exception text')

post_parent = FakeBooleanEntities.new
post_target = FakeBooleanGroup.new(parent: post_parent, name: 'OriginalTarget', id: 'original-target')
post_tool = FakeBooleanGroup.new(parent: post_parent, name: 'OriginalTool', id: 'original-tool')
before_groups = post_parent.dup
working_target = FakeBooleanGroup.new(parent: post_parent, name: 'WorkingTarget', id: 'working-target')
working_tool = FakeBooleanGroup.new(parent: post_parent, name: 'WorkingTool', id: 'working-tool')
result = FakeBooleanGroup.new(parent: post_parent, name: 'ReviewedResult', id: 'reviewed-result')
AlmaSketchupMCP.cleanup_boolean_inputs(
  post_target, [post_tool], working_target, [working_tool], result, true, true
)
AlmaSketchupMCP.assert_boolean_postconditions(
  post_parent, before_groups, post_target, [post_tool], working_target, [working_tool], result,
  true, true, 'boolean_difference'
)
tests += 1; assert_equal([post_target, post_tool, result], post_parent, 'keep-both must leave two originals plus exactly one result')
tests += 1; assert_truthy(post_target.valid? && post_tool.valid?, 'keep-both must preserve both original identities')
tests += 1; assert_truthy(working_target.deleted? && working_tool.deleted?, 'working copies must not survive cleanup')

unexpected = FakeBooleanGroup.new(parent: post_parent, name: 'UnexpectedTemp', id: 'unexpected-temp')
tests += 1
postcondition_error = assert_raises('an undeclared temporary group must fail the postcondition') do
  AlmaSketchupMCP.assert_boolean_postconditions(
    post_parent, before_groups, post_target, [post_tool], working_target, [working_tool], result,
    true, true, 'boolean_difference'
  )
end
tests += 1; assert_equal('boolean_postcondition_failed', postcondition_error.operation_failure_code, 'postcondition failure must use the bounded postcondition code')
unexpected.erase!

transaction_model = FakeBooleanTransactionModel.new
transaction_temp = FakeBooleanGroup.new(parent: post_parent, name: 'TransactionTemp', id: 'transaction-temp')
tests += 1
assert_raises('a boolean postcondition failure must abort the SketchUp transaction', /transaction failed before commit/) do
  AlmaSketchupMCP.with_atomic_model_transaction(transaction_model, 'Boolean Postcondition Probe') do
    AlmaSketchupMCP.assert_boolean_postconditions(
      post_parent, before_groups, post_target, [post_tool], working_target, [working_tool], result,
      true, true, 'boolean_difference'
    )
  end
end
tests += 1; assert_equal(%w[start abort], transaction_model.events, 'postcondition failure must abort and must not attempt commit')
transaction_temp.erase!

AlmaSketchupMCP::BOOLEAN_OPERATION_FAILURE_CODES.each do |failure_code|
  classified_model = FakeBooleanTransactionModel.new
  classified_error = assert_raises("#{failure_code} must retain QueueOperationError semantics") do
    AlmaSketchupMCP.with_atomic_model_transaction(classified_model, 'Boolean Classified Failure Probe') do
      raise AlmaSketchupMCP::BooleanOperationFailure.new(failure_code)
    end
  end
  tests += 1; assert_equal('MUTATION_EXECUTION_FAILED', classified_error.code, "#{failure_code} must retain the stable queue error code")
  tests += 1; assert_equal(failure_code, classified_error.details['operation_failure_code'], "#{failure_code} must be exposed only as an allowlisted detail")
  tests += 1; assert_equal('precommit_execution', classified_error.details['phase'], "#{failure_code} must remain a precommit failure")
  tests += 1; assert_equal(true, classified_error.details['abort_succeeded'], "#{failure_code} must preserve abort evidence")
  tests += 1; assert_equal(%w[start abort], classified_model.events, "#{failure_code} must abort without committing")
end

source = File.read(File.join(repo_root, 'sketchup_plugin', 'alma_sketchup_mcp', 'boolean_operations.rb'))
tests += 1; assert_truthy(source.include?('produced a non-manifold result'), 'boolean apply must reject a non-manifold result before commit')
tests += 1; assert_truthy(source.include?('assert_boolean_postconditions('), 'boolean apply must run exact postcondition checks before returning')
tests += 1; assert_truthy(source.include?('difference_other, difference_self, intersection = pieces'), 'boolean difference must use SketchUp documented split order')
tests += 1; assert_truthy(source.include?('assert_boolean_difference_volume_reduced'), 'boolean difference must reject no-op volume before commit')
tests += 1; assert_truthy(source.include?("normalize_boolean_operation_failure(error)"), 'Boolean apply must map unexpected failures to its bounded internal fallback')
manifold_repair_source = source[/def manifold_repair\(model, operation\).*?^  end$/m]
tests += 1; assert_truthy(manifold_repair_source.include?('manifold_repair_target(model, operation)'), 'manifold repair must use its non-manifold-capable target resolver')
tests += 1; assert_truthy(!manifold_repair_source.match?(/\bsolid_boolean_target\s*\(/), 'manifold repair must not require an already-manifold Boolean operand')

puts({
  ok: true,
  assertions: tests,
  exact_split_piece_count_required: true,
  documented_split_order_enforced: true,
  no_op_difference_rejected_before_commit: true,
  cleanup_errors_propagate: true,
  stable_operation_failure_codes: AlmaSketchupMCP::BOOLEAN_OPERATION_FAILURE_CODES.length,
  untrusted_failure_text_suppressed: true,
  keep_both_exact_result: true,
  result_identity_collision_rejected: true,
  non_manifold_result_rejected: true
}.to_json)
