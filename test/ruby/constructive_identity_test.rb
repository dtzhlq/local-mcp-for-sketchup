# frozen_string_literal: true
require 'minitest/autorun'
require_relative '../../sketchup_plugin/alma_sketchup_mcp/primitive_operations'
require_relative '../../sketchup_plugin/alma_sketchup_mcp/surface_operations'
module AlmaSketchupMCP
  class IdentityFixtureGroup
    def set_attribute(*args); end
  end
  def self.vector(value, _field); value; end
  def self.positive_number(value, _fallback, _field); value.to_f; end
  def self.curve_segments(operation, *args); operation['segments'] || 24; end
  def self.integer_range(value, *args); value.to_i; end
  def self.non_negative_number(value, *args); value.to_f; end
  def self.add_mesh(_entities, operation); @captured_identity_operation = operation; IdentityFixtureGroup.new; end
  def self.captured_identity_operation; @captured_identity_operation; end
end
class ConstructiveIdentityTest < Minitest::Test
  def test_cylinder_and_pipe_preserve_prepared_identity_and_placement
    common = { 'name' => 'human-readable', 'id' => 'server-frozen-id', 'guid' => 'server-frozen-guid',
      'radius' => 6, 'segments' => 32, 'transform' => { 'translate' => [11, 22, 33], 'rotateZ' => 27 },
      'texture_transform' => { 'projection' => 'planar', 'rotation' => 90 }, 'qa' => { 'role' => 'handle' } }
    result = AlmaSketchupMCP.add_pipe_between_points(nil, common.merge('start' => [0,0,0], 'end' => [100,0,0]))
    assert_instance_of AlmaSketchupMCP::IdentityFixtureGroup, result
    %w[id guid transform texture_transform qa].each { |key| assert_equal common[key], AlmaSketchupMCP.captured_identity_operation[key] }
    AlmaSketchupMCP.add_lofted_solid(nil, common.merge('profile' => [[0,5],[12,22],[38,37],[64,34],[83,14],[96,13]]))
    %w[id guid transform texture_transform qa].each { |key| assert_equal common[key], AlmaSketchupMCP.captured_identity_operation[key] }
    AlmaSketchupMCP.add_cylinder(nil, common.merge('height' => 100))
    %w[id guid transform texture_transform qa].each { |key| assert_equal common[key], AlmaSketchupMCP.captured_identity_operation[key] }
  end
end
