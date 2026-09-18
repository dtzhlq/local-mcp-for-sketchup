require 'minitest/autorun'
require 'json'
require 'digest'
module Sketchup
  Edge = Struct.new(:signature, :soft?, :smooth?)
  Face = Struct.new(:signature, :normal, :material, :back_material)
end
require_relative '../../sketchup_plugin/alma_sketchup_mcp/model_geometry'
class CadFingerprintTest < Minitest::Test
  include AlmaSketchupMCP
  def geometry_signature(entity); entity.signature; end
  def test_saved_float_roundoff_does_not_invalidate_source
    a = [Sketchup::Face.new('face', [0.3, 0.4, 0.5], nil, nil)]
    b = [Sketchup::Face.new('face', [0.3 + 2e-16, 0.4, 0.5], nil, nil)]
    assert_equal cad_geometry_digest(a), cad_geometry_digest(b)
    b[0].normal[0] += 0.01
    refute_equal cad_geometry_digest(a), cad_geometry_digest(b)
  end
  def test_geometry_and_edge_flags_still_invalidate_source
    edge = Sketchup::Edge.new('before', false, false)
    before = cad_geometry_digest([edge]); edge.signature = 'after'
    refute_equal before, cad_geometry_digest([edge])
    edge.signature = 'before'; edge[:smooth?] = true
    refute_equal before, cad_geometry_digest([edge])
  end
end
