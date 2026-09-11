# frozen_string_literal: true
require 'minitest/autorun'
require_relative '../../sketchup_plugin/alma_sketchup_mcp/geometry_evidence'
require_relative '../../sketchup_plugin/alma_sketchup_mcp/geometry_regions'
module AlmaSketchupMCP
  def self.mm_to_model_units(value); value / 25.4; end
end

class DetailPairSeparationTest < Minitest::Test
  def mesh(points, faces, name)
    points = points.map { |point| point.map { |number| number / 25.4 } }
    { triangles: faces.flat_map { |face| (1...face.length - 1).map { |i| [points[face[0]], points[face[i]], points[face[i + 1]]] } },
      min: 3.times.map { |axis| points.map { |p| p[axis] }.min }, max: 3.times.map { |axis| points.map { |p| p[axis] }.max },
      solid: true, shell_count: 1, reference_path: [name] }
  end
  def box(low, high, name = 'box')
    x,y,z = low; xx,yy,zz = high
    mesh([[x,y,z],[xx,y,z],[xx,yy,z],[x,yy,z],[x,y,zz],[xx,y,zz],[xx,yy,zz],[x,yy,zz]],
      [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]], name)
  end
  def tube
    points = [0,10].flat_map { |z| [[-10,-10,z],[10,-10,z],[10,10,z],[-10,10,z],[-5,-5,z],[5,-5,z],[5,5,z],[-5,5,z]] }
    faces = []
    4.times do |i|
      j = (i + 1) % 4
      faces += [[i,j,j+8,i+8],[i+4,i+12,j+12,j+4],[i+8,j+8,j+12,i+12],[i,i+4,j+4,j]]
    end
    mesh(points, faces, 'hollow-host')
  end
  def report(left, right)
    AlmaSketchupMCP.evaluate_detail_pair_records([left], [right])
  end
  def test_disjoint_and_boundary_contact_are_distinct_from_real_overlap
    host = box([0,0,0], [10,10,10])
    assert_equal 'pass', report(host, box([20,0,0], [30,10,10]))['status']
    contact = report(host, box([10,0,0], [20,10,10]))
    assert_equal 'pass', contact['status']
    assert_equal 1, contact['boundary_contact_pairs']
    assert_equal 'unverified', report(host, box([9.995,0,0], [20,10,10]))['status'], 'A 0.005 mm penetration must not become contact'
    assert_equal 'unverified', report(host, box([2,2,2], [8,8,8]))['status'], 'Full containment must not be mistaken for absence of crossing surfaces'
  end
  def test_hollow_geometry_and_open_geometry
    assert_equal 'pass', report(tube, box([-4,-4,1], [4,4,9]))['status'], 'Overlapping envelopes may contain disjoint actual geometry'
    assert_equal 'unverified', report(tube, box([4,-4,1], [6,4,9]))['status'], 'A bar penetrating the tube wall remains unresolved'
    open_host = tube.merge(solid: false)
    assert_equal 'unverified', report(open_host, box([-4,-4,1], [4,4,9]))['status'], 'An open surrounding shell cannot establish empty solid volume'
    assert_raises(RuntimeError) { AlmaSketchupMCP.evaluate_detail_pair_records([], [tube]) }
  end
end
