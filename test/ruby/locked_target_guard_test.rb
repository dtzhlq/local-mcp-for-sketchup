# frozen_string_literal: true

require 'fileutils'
require 'json'
require 'tmpdir'

repo_root = File.expand_path('../..', __dir__)
support_dir = File.join(__dir__, 'support')
test_home = File.realpath(Dir.mktmpdir('alma-locked-target-guard-'))
at_exit { FileUtils.rm_rf(test_home) if test_home && File.exist?(test_home) }
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

class LockedGuardGroup < Sketchup::Group
  attr_reader :name

  def initialize(id:, persistent_id:, name:, locked: false, valid: true)
    @id = id
    @persistent_id = persistent_id
    @name = name
    @locked = locked
    @valid = valid
  end

  def get_attribute(dictionary, key)
    return @id if dictionary == 'AlmaSketchupMCP' && key == 'id'

    nil
  end

  def persistent_id
    @persistent_id
  end

  def locked?
    @locked
  end

  def valid?
    @valid
  end
end

class LockedGuardModel
  attr_reader :entities, :definitions

  def initialize(entities, instance_path: nil)
    @entities = entities
    @instance_path = instance_path
    @definitions = {}
  end

  def active_entities
    @entities
  end

  def instance_path_from_pid_path(_pid_path)
    @instance_path
  end
end

class LockedGuardInstancePath
  def initialize(entities, valid: true)
    @entities = entities
    @valid = valid
  end

  def valid?
    @valid
  end

  def to_a
    @entities
  end
end

locked = LockedGuardGroup.new(id: 'locked', persistent_id: 101, name: 'Locked', locked: true)
unlocked = LockedGuardGroup.new(id: 'unlocked', persistent_id: 102, name: 'Unlocked')
invalid = LockedGuardGroup.new(id: 'invalid', persistent_id: 103, name: 'Invalid', valid: false)
model = LockedGuardModel.new([locked, unlocked, invalid])

mutating_operations = %w[
  delete rename set_material set_visibility assign_tag attribute remove_attribute
  classification texture_transform transform_object duplicate_entity
  replace_component_definition explode_entity erase_entities transform_entities
  set_face_material reverse_face pushpull_face set_edge_properties face_uv
  scene.drawingelement_visibility boolean_union boolean_difference
  boolean_intersect manifold_repair
]

mutating_operations.each do |op_name|
  error = assert_raises(RuntimeError, "#{op_name} must reject a locked target") do
    AlmaSketchupMCP.find_referenced_entity(model, { 'target_id' => '101' }, op_name)
  end
  assert_truthy(error.message.include?('locked'), "#{op_name} did not report the locked-target reason")
end

resolved_unlocked = AlmaSketchupMCP.find_referenced_entity(model, { 'target_id' => '102' }, 'transform_object')
assert_equal(unlocked, resolved_unlocked, 'unlocked mutation target should resolve')

invalid_error = assert_raises(RuntimeError, 'invalid targets must fail even for read-only lookup') do
  AlmaSketchupMCP.find_referenced_entity(model, { 'target_id' => '103' }, 'set_selection', allow_locked: true)
end
assert_truthy(invalid_error.message.include?('invalid'), 'invalid target reason was not retained')

selected_locked = AlmaSketchupMCP.find_selection_target(model, '101')
assert_equal(locked, selected_locked, 'set_selection must retain read-only access to locked targets')

checked_locked = AlmaSketchupMCP.manifold_targets(model, { 'target_id' => '101' }, 'manifold_check')
assert_equal([locked], checked_locked, 'manifold_check must retain read-only access to locked targets')

repairable_non_manifold = AlmaSketchupMCP.manifold_repair_target(
  model,
  { 'target_id' => '102' }
)
assert_equal(
  unlocked,
  repairable_non_manifold,
  'manifold_repair must accept an unlocked group before it becomes manifold'
)

repair_error = assert_raises(RuntimeError, 'manifold_repair must reject a locked target') do
  AlmaSketchupMCP.manifold_targets(model, { 'target_id' => '101' }, 'manifold_repair')
end
assert_truthy(repair_error.message.include?('locked'), 'manifold_repair did not report the locked-target reason')

leaf = LockedGuardGroup.new(id: 'leaf', persistent_id: 202, name: 'Leaf')
locked_path = LockedGuardInstancePath.new([locked, leaf])
path_model = LockedGuardModel.new([locked], instance_path: locked_path)
path_operation = {
  'entity_path' => 'pid:101.202',
  'edit_scope' => 'component_definition',
  'instance_policy' => 'definition_wide'
}
ancestor_error = assert_raises(RuntimeError, 'a locked occurrence ancestor must block nested mutation') do
  AlmaSketchupMCP.find_referenced_entity(path_model, path_operation, 'transform_object')
end
assert_truthy(ancestor_error.message.include?('ancestor[0] is locked'), 'locked ancestor path was not identified')

read_only_leaf = AlmaSketchupMCP.find_referenced_entity(
  path_model,
  path_operation,
  'manifold_check',
  allow_locked: true
)
assert_equal(leaf, read_only_leaf, 'read-only nested inspection should traverse a locked ancestor')

puts JSON.pretty_generate(
  ok: true,
  mutating_operations_guarded: mutating_operations.length,
  top_level_locked_rejected: true,
  locked_ancestor_rejected: true,
  invalid_target_rejected: true,
  selection_read_only_allowed: true,
  manifold_check_read_only_allowed: true,
  non_manifold_repair_target_allowed: true,
  manifold_repair_locked_rejected: true
)
