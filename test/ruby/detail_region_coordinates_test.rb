# frozen_string_literal: true
require 'minitest/autorun'
require_relative '../../sketchup_plugin/alma_sketchup_mcp/geometry_regions'
module Geom
  class Transformation
    attr_reader :offset
    def initialize(offset = 0); @offset = offset; end
    def inverse; self.class.new(-offset); end
    def to_a; [1,0,0,0,0,1,0,0,0,0,1,0,offset,0,0,1]; end
  end
end
module AlmaSketchupMCP
  DefinitionFixture = Struct.new(:entities)
  AnchorFixture = Struct.new(:definition)
  ModelFixture = Struct.new(:entities)
  def self.active_model_required(*); ModelFixture.new(:scene); end
  def self.session_model_revision_report(*); { 'complete' => true, 'model_revision' => 'native-fixture' }; end
  def self.resolve_detail_region_anchor(*); [AnchorFixture.new(DefinitionFixture.new(:assembly)), Geom::Transformation.new(7)]; end
  def self.validate_detail_transform!(*); end
  def self.detail_region_geometry_records(entities, transform, *); [{ entities: entities, offset: transform.offset }]; end
  def self.evaluate_detail_region(query, records); { 'status' => 'pass', 'fixture_records' => records }; end
end
class DetailRegionCoordinatesTest < Minitest::Test
  def test_absolute_and_anchor_local_spaces_select_the_correct_native_transform
    [['assembly','anchor_local',:assembly,0],['assembly','model',:assembly,7],['scene','anchor_local',:scene,-7],['scene','model',:scene,0]].each do |scope,space,entities,offset|
      report = AlmaSketchupMCP.inspect_detail_regions('queries' => [{ 'id' => 'q', 'instance_path' => ['root'], 'search_scope' => scope, 'coordinate_space' => space }])
      result = report['results'].first
      assert_equal 'pass', result['status']; assert_equal space, result['coordinate_space']
      assert_equal [{ entities: entities, offset: offset }], result['fixture_records']
    end
    result = AlmaSketchupMCP.inspect_detail_regions('queries' => [{ 'id' => 'invalid', 'coordinate_space' => 'invented' }])['results'].first
    assert_equal 'unverified', result['status']
  end
end
