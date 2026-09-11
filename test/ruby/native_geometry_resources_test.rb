# frozen_string_literal: true
require 'minitest/autorun'
require_relative '../../sketchup_plugin/alma_sketchup_mcp/snapshot'
module Sketchup
  class Face; end
  class Edge
    attr_reader :vertices
    def initialize(vertices); @vertices = vertices; end
  end
  class ComponentInstance
    attr_reader :definition
    def initialize(definition); @definition = definition; end
    def hidden?; true; end
  end
  class Group < ComponentInstance; end
end
class NativeGeometryResourcesTest < Minitest::Test
  Definition = Struct.new(:entities)
  Model = Struct.new(:entities, :definitions)
  def geometry
    vertices = 4.times.map { Object.new }
    [Sketchup::Face.new, *4.times.map { |i| Sketchup::Edge.new([vertices[i], vertices[(i + 1) % 4]]) }]
  end
  def test_hidden_shared_unused_and_loose_geometry_have_separate_storage_and_expansion_cost
    shared = Definition.new(geometry)
    unused = Definition.new(geometry)
    wrapper = Definition.new([Sketchup::Group.new(shared), Sketchup::ComponentInstance.new(shared)])
    model = Model.new([*geometry, Sketchup::ComponentInstance.new(wrapper), Sketchup::ComponentInstance.new(shared)], [shared, unused, wrapper])
    report = AlmaSketchupMCP.native_geometry_resource_totals(model)
    assert report['complete'], report.inspect
    assert_equal [3, 12, 12], report.values_at('faces', 'edges', 'vertices')
    assert_equal({ 'faces' => 4, 'edges' => 16, 'vertices' => 16 }, report['expanded_totals'])
    assert report['includes_hidden']
    assert report['includes_unused_definitions']
    assert_equal false, report['detail_score']
  end
  def test_cycles_do_not_return_partial_success
    cyclic = Definition.new([])
    cyclic.entities << Sketchup::ComponentInstance.new(cyclic)
    report = AlmaSketchupMCP.native_geometry_resource_totals(Model.new([Sketchup::ComponentInstance.new(cyclic)], [cyclic]))
    assert_equal false, report['complete']
    assert_match(/Cyclic/, report['error'])
    assert_nil report['faces']
  end
end
