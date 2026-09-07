# frozen_string_literal: true
require 'minitest/autorun'
require_relative '../../sketchup_plugin/alma_sketchup_mcp/profile_operations'

class PanelEdgeOpeningTest < Minitest::Test
  Vertex = Struct.new(:position)
  Loop = Struct.new(:vertices)
  Face = Struct.new(:loops)
  class Entities
    attr_reader :faces
    def initialize; @faces = []; end
    def add_face(*points); @faces << points; points; end
  end

  def test_actual_notch_boundary_does_not_create_a_cap_across_door_bottom
    boundary = [[0,0,0],[300,0,0],[300,0,1800],[700,0,1800],[700,0,0],[1000,0,0],[1000,0,2000],[0,0,2000]]
    face = Face.new([Loop.new(boundary.map { |p| Vertex.new(p) })])
    entities = Entities.new
    AlmaSketchupMCP.stub(:offset_point, ->(point, _plane, depth) { [point[0], point[1]+depth, point[2]] }) do
      AlmaSketchupMCP.add_panel_native_boundary_sides(entities, face, 'xz', 200)
    end
    assert_equal 8, entities.faces.length
    refute entities.faces.any? { |points| points.all? { |p| p[2] == 0 } && points.map(&:first).min < 500 && points.map(&:first).max > 500 }
    assert entities.faces.any? { |points| points.all? { |p| p[0] == 300 } && points.map(&:last).max == 1800 }
    assert entities.faces.any? { |points| points.all? { |p| p[2] == 1800 } }
  end

  def test_boundary_face_failure_is_not_counted_as_a_successful_panel
    face = Face.new([Loop.new([[0,0,0],[10,0,0],[0,0,10]].map { |p| Vertex.new(p) })])
    entities = Object.new
    def entities.add_face(*); false; end
    AlmaSketchupMCP.stub(:offset_point, ->(point, _plane, depth) { [point[0], point[1]+depth, point[2]] }) do
      assert_raises(RuntimeError) { AlmaSketchupMCP.add_panel_native_boundary_sides(entities, face, 'xz', 2) }
    end
  end
end
