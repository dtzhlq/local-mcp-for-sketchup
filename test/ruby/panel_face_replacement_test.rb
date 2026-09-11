require 'minitest/autorun'
require_relative '../../sketchup_plugin/alma_sketchup_mcp/profile_operations'
module Sketchup
  class Face
    attr_accessor :alive
    attr_reader :vertices
    def initialize(points); @alive=true; @vertices=points.map { |p| Struct.new(:position).new(p) }; end
    def valid?; @alive; end
    def erase!; @alive=false; end
  end
end
module AlmaSketchupMCP
  def self.mm_to_model_units(x); x; end
  def self.point_for_plane(*); raise 'stub required'; end
end
class PanelFaceReplacementTest < Minitest::Test
  class Entities
    def initialize(remnants); @remnants=remnants; @calls=0; end
    def add_face(points)
      @calls+=1
      if @calls==1
        @old=Sketchup::Face.new(points)
      else
        @old.alive=false
        Sketchup::Face.new(points)
      end
    end
    def grep(type); @remnants.grep(type); end
  end
  def test_edge_notch_reacquires_survivor_and_excludes_back_plane
    survivor=Sketchup::Face.new([[0,0,0],[10,0,0],[10,0,10]])
    back=Sketchup::Face.new([[0,2,0],[10,2,0],[10,2,10]])
    convert=->(origin,_plane,u,v) { [u,origin[1],v] }
    AlmaSketchupMCP.stub(:point_for_plane,convert) do
      args=[[0,0,0],'xz',[[0,0],[10,0],[10,10],[0,10]],[{'x'=>2,'y'=>0,'width'=>3,'height'=>5}],false]
      assert_same survivor,AlmaSketchupMCP.add_panel_face_with_holes(Entities.new([survivor,back]),*args)
      assert_nil AlmaSketchupMCP.add_panel_face_with_holes(Entities.new([back]),*args)
      assert_nil AlmaSketchupMCP.add_panel_face_with_holes(Entities.new([survivor,survivor.dup]),*args)
    end
  end
end
