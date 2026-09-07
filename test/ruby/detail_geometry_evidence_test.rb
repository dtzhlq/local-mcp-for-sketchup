# frozen_string_literal: true

# Offline numeric/topology fixtures. These do not emulate SketchUp rendering
# and are never presented as live geometry acceptance evidence.
require 'minitest/autorun'
require 'matrix'
require_relative '../../sketchup_plugin/alma_sketchup_mcp/geometry_evidence'

module Geom
  class Vector3d
    def initialize(*values); @values = values.flatten.map(&:to_f); end
    def to_a; @values.dup; end
    def dot(other); @values.zip(other.to_a).sum { |a, b| a * b }; end
    def length; Math.sqrt(dot(self)); end
    def length=(value); scale = value / length; @values.map! { |item| item * scale }; end
    def normalize; self.class.new(@values.map { |value| value / length }); end
    def reverse!; @values.map! { |value| -value }; self; end
    def parallel?(other); (dot(other).abs - length * other.length).abs < 1.0e-8; end
    def initialize_copy(other); @values = other.to_a; end
  end
  class Point3d
    def initialize(*values); @values = values.flatten.map(&:to_f); end
    def to_a; @values.dup; end
    def [](index); @values[index]; end
    def -(other); Vector3d.new(@values.zip(other.to_a).map { |a, b| a - b }); end
    def offset(vector); self.class.new(@values.zip(vector.to_a).map { |a, b| a + b }); end
    def distance(other); (self - other).length; end
    def transform(transform); self.class.new(transform.respond_to?(:apply_point) ? transform.apply_point(@values) : @values); end
  end
  class Transformation
    def to_a; [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; end
    def *(other); other; end
    def inverse; self; end
  end
  class BoundingBox
    attr_reader :points
    def initialize; @points = []; end
    def add(point); @points << point; end
    def valid?; !@points.empty?; end
  end
end

class EvidenceAffineTransform
  def initialize(matrix); @matrix = matrix; end
  def to_a; 4.times.flat_map { |index| @matrix.column(index).to_a }; end
  def *(other); self.class.new(@matrix * Matrix.columns(other.to_a.each_slice(4).to_a)); end
  def inverse; self.class.new(@matrix.inverse); end
  def apply_point(point)
    result = (@matrix * Vector.elements(point + [1])).to_a
    result.first(3).map { |value| value / result.last }
  end
end

class DetailContextRegionTest < Minitest::Test
  def test_triangulated_cap_perimeter_and_round_inner_hole_are_distinguished
    circle = 24.times.map { |i| angle = i * Math::PI * 2 / 24; [18 * Math.cos(angle), 18 * Math.sin(angle), 100.0] }
    triangles = (1...23).map { |i| [[circle[0], circle[i], circle[i + 1]]] }
    profiles = AlmaSketchupMCP.native_coplanar_outer_profiles(triangles)
    assert_equal 24, profiles.first.length
    assert_in_delta 15, AlmaSketchupMCP.maximum_outer_profile_turn(profiles.first), 1.0e-6
    outer = [[-30,-30,100],[30,-30,100],[30,30,100],[-30,30,100]]
    rectangular_with_round_hole = AlmaSketchupMCP.native_coplanar_outer_profiles([[outer, circle]])
    assert_equal 4, rectangular_with_round_hole.first.length
    assert_in_delta 90, AlmaSketchupMCP.maximum_outer_profile_turn(rectangular_with_round_hole.first), 1.0e-6
  end

  def box_record(minimum, maximum, path = ['box'])
    points = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map do |unit|
      3.times.map { |axis| minimum[axis] + unit[axis] * (maximum[axis] - minimum[axis]) }
    end
    faces = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]
    { min: minimum, max: maximum, triangles: faces.flat_map { |a,b,c,d| [[points[a],points[b],points[c]],[points[a],points[c],points[d]]] }, solid: true, shell_count: 1, reference_path: path }
  end

  def query
    { 'id' => 'door-gap', 'instance_path' => ['wall'], 'search_scope' => 'assembly',
      'bounds_mm' => { 'min' => [2,2,2], 'max' => [98,28,198] },
      'boundary_checks' => %w[min_x max_x max_z].map { |side| { 'side' => side, 'offset_mm' => 5 } } }
  end

  def door_records
    [box_record([-20,0,0],[0,30,200],['wall','left']), box_record([100,0,0],[120,30,200],['wall','right']),
     box_record([-20,0,200],[120,30,220],['wall','lintel'])]
  end

  def test_native_geometry_proves_bottom_edge_opening_and_full_depth_boundaries
    result = AlmaSketchupMCP.evaluate_detail_region(query, door_records)
    assert_equal 'pass', result['status'], result.inspect
    assert_equal 3, result['boundary_results'].length
    assert result['boundary_results'].all? { |boundary| boundary['verified'] }
    missing_jamb = AlmaSketchupMCP.evaluate_detail_region(query, door_records.drop(1))
    assert_equal 'fail', missing_jamb['status']
    assert_equal 'required_native_boundary_missing', missing_jamb['reason']
  end

  def test_parent_and_off_center_partial_caps_fail_actual_region_intersection
    cap = box_record([10,3,100],[20,27,101],['parent','extra-cap'])
    result = AlmaSketchupMCP.evaluate_detail_region(query, door_records + [cap])
    assert_equal 'fail', result['status']
    assert_equal 'native_surface_intersects_required_void', result['reason']
    assert_equal ['parent','extra-cap'], result['blocker_path']
  end

  def test_whole_cabinet_and_sink_solid_fills_fail_even_without_surface_crossing
    %w[cabinet-fill basin-bbox-replacement].each do |name|
      filled = box_record([-20,-20,-20],[120,50,220],[name])
      result = AlmaSketchupMCP.evaluate_detail_region(query, [filled])
      assert_equal 'fail', result['status']
      assert_equal 'required_void_inside_native_solid', result['reason']
      assert_equal [name], result['blocker_path']
    end
  end

  def test_unclosed_shell_is_unverified_and_cannot_use_a_solid_claim
    shell = box_record([-20,-20,-20],[120,50,220])
    shell[:solid] = false
    result = AlmaSketchupMCP.evaluate_detail_region(query, [shell])
    assert_equal 'unverified', result['status']
    assert_equal 'open_or_ambiguous_geometry_surrounds_void', result['reason']
  end

  def test_a_narrow_hole_between_boundary_samples_does_not_pass
    # Two jamb segments leave a small missing band, away from the former 3x3
    # sample positions. Neither solid contains the continuous boundary slab.
    split = [box_record([-20,0,0],[0,30,50]), box_record([-20,0,51],[0,30,200])]
    result = AlmaSketchupMCP.evaluate_detail_region(query, split + door_records.drop(1))
    assert_equal 'unverified', result['status']
    refute result['boundary_results'].first['verified']
  end

  def test_records_read_native_faces_and_owner_manifold_even_when_hidden
    box = box_record([-20,-20,-20],[120,50,220])
    face = EvidenceFace.new(Object.new, [], box[:triangles])
    group = EvidenceGroup.new(Struct.new(:name,:entities).new('solid', [face]), 'hidden-fill')
    group.hidden = true
    group.define_singleton_method(:manifold?) { true }
    records = AlmaSketchupMCP.detail_region_geometry_records(group.definition.entities, Geom::Transformation.new, { face_meshes: {} }, [], ['hidden-fill'], group)
    assert_equal true, records.first[:solid]
    result = AlmaSketchupMCP.evaluate_detail_region(query, records)
    assert_equal 'required_void_inside_native_solid', result['reason']
  end

  def test_native_query_uses_exact_anchor_and_retains_measured_blocker_report
    box = box_record([-20,-20,-20],[120,50,220])
    group = EvidenceGroup.new(Struct.new(:name,:entities).new('solid', [EvidenceFace.new(Object.new, [], box[:triangles])]), 'wall')
    group.define_singleton_method(:manifold?) { true }
    model = Struct.new(:entities).new([group])
    api = AlmaSketchupMCP
    api.define_singleton_method(:active_model_required) { |_operation| model }
    api.define_singleton_method(:session_model_revision_report) { |_model| { 'complete' => true, 'model_revision' => 'offline-fixture-revision' } }
    result = api.inspect_detail_regions('queries' => [query])
    assert_equal true, result['read_only']
    assert_equal 'fail', result['results'].first['status']
    assert_equal ['wall'], result['results'].first['blocker_path']
    assert_equal query['bounds_mm'], result['results'].first['bounds_mm']
    rejected = api.inspect_detail_regions('queries' => [query.merge('exclude_instance_paths' => [['wall']])])
    assert_equal 'unverified', rejected['results'].first['status']
    missing = api.inspect_detail_regions('queries' => [query.merge('instance_path' => ['missing'])])
    assert_equal 'unverified', missing['results'].first['status']
  ensure
    api.singleton_class.send(:remove_method, :active_model_required) if api
    api.singleton_class.send(:remove_method, :session_model_revision_report) if api
  end

  def test_disconnected_nested_closed_shells_cannot_cancel_into_false_void_evidence
    first = box_record([-20,-20,-20],[120,50,220])
    second = box_record([-10,-10,-10],[110,40,210])
    faces = [first,second].map { |record| EvidenceFace.new(Object.new, [], record[:triangles]) }
    group = EvidenceGroup.new(Struct.new(:entities).new(faces), 'nested-shells')
    group.define_singleton_method(:manifold?) { true }
    records = AlmaSketchupMCP.detail_region_geometry_records(faces, Geom::Transformation.new, { face_meshes: {} }, [], ['nested-shells'], group)
    assert_equal 2, records.first[:shell_count]
    assert_equal :inside, AlmaSketchupMCP.detail_point_occupancy([50,15,100], records.first.merge(shell_count: 1), 0.02), 'signed winding retains both containing shells, while disconnected-shell provenance still stays conservative'
    assert_equal 'unverified', AlmaSketchupMCP.evaluate_detail_region(query, records)['status']
  end

  def test_shared_nested_anchor_uses_each_actual_transform_and_hidden_blocker
    empty = Struct.new(:entities).new([])
    nested = EvidenceGroup.new(empty, 'nested')
    shared = Struct.new(:entities).new([nested])
    first, second = EvidenceGroup.new(shared,'first'), EvidenceGroup.new(shared,'second')
    # Rotation, translation, reflection and nonuniform scale all contribute.
    placement = EvidenceAffineTransform.new(Matrix[[0,-3,0,1000],[-2,0,0,2000],[0,0,0.5,300],[0,0,0,1]])
    distant = EvidenceAffineTransform.new(Matrix[[1,0,0,10000],[0,1,0,20000],[0,0,1,30000],[0,0,0,1]])
    first.define_singleton_method(:transformation) { placement }
    second.define_singleton_method(:transformation) { distant }
    cap = box_record([10,3,100],[20,27,101])
    blocker = EvidenceGroup.new(Struct.new(:entities).new([EvidenceFace.new(Object.new, [], cap[:triangles])]),'external-cap')
    blocker.define_singleton_method(:transformation) { placement }
    blocker.define_singleton_method(:manifold?) { true }
    blocker.hidden = true
    model = Struct.new(:entities).new([first,second,blocker])
    api = AlmaSketchupMCP
    api.define_singleton_method(:active_model_required) { |_operation| model }
    api.define_singleton_method(:session_model_revision_report) { |_model| { 'complete' => true, 'model_revision' => 'offline-transform-revision' } }
    local = query.merge('boundary_checks' => [], 'search_scope' => 'scene')
    # Query the clear instance first to catch cache aliasing between two native
    # occurrences whose nested definition entity is the same Ruby object.
    result = api.inspect_detail_regions('queries' => [local.merge('id' => 'clear', 'instance_path' => %w[second nested]), local.merge('id' => 'blocked', 'instance_path' => %w[first nested])])
    assert_equal %w[pass fail], result['results'].map { |item| item['status'] }, result.inspect
    assert_equal ['external-cap'], result['results'].last['blocker_path']
    host_only = api.inspect_detail_regions('queries' => [local.merge('instance_path' => %w[first nested], 'search_scope' => 'assembly')])
    assert_equal 'pass', host_only['results'].first['status'], 'assembly intentionally checks its exact host subtree, while scene also checks external design geometry'
  ensure
    api.singleton_class.send(:remove_method, :active_model_required) if api
    api.singleton_class.send(:remove_method, :session_model_revision_report) if api
  end

  def test_singular_and_projective_transforms_cannot_silently_query_the_wrong_location
    invalid = [Matrix[[0,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]], Matrix[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0.01,0,0,1]]]
    invalid.each do |matrix|
      assert_raises(RuntimeError) { AlmaSketchupMCP.validate_detail_transform!(EvidenceAffineTransform.new(matrix)) }
    end
  end

  def test_one_connected_self_crossing_tube_cannot_cancel_two_filled_lobes
    count, sides, radius = 96, 16, 2.0
    points = count.times.flat_map do |station|
      angle = station * 2 * Math::PI / count
      center = [20 * Math.sin(angle),20 * Math.sin(angle) * Math.cos(angle),0]
      tangent = [20 * Math.cos(angle),20 * Math.cos(2 * angle)]
      length = Math.sqrt(tangent.sum { |value| value * value })
      perpendicular = [-tangent[1] / length,tangent[0] / length,0]
      sides.times.map do |side|
        theta = side * 2 * Math::PI / sides
        [center[0] + radius * Math.cos(theta) * perpendicular[0],center[1] + radius * Math.cos(theta) * perpendicular[1],radius * Math.sin(theta)]
      end
    end
    faces = count.times.flat_map do |station|
      sides.times.flat_map do |side|
        a, b, c, d = station*sides+side, ((station+1)%count)*sides+side, ((station+1)%count)*sides+(side+1)%sides, station*sides+(side+1)%sides
        [[a,b,c],[a,c,d]]
      end
    end
    edge_counts = Hash.new(0)
    faces.each { |face| face.each_with_index { |vertex,index| edge_counts[[vertex,face[(index+1)%3]].sort] += 1 } }
    assert edge_counts.values.all? { |value| value == 2 }, 'the constructed closed tube has manifold edge connectivity even at its geometric self-crossing'
    record = { triangles: faces.map { |face| face.map { |index| points[index] } }, min: 3.times.map { |axis| points.map { |p| p[axis] }.min }, max: 3.times.map { |axis| points.map { |p| p[axis] }.max }, solid: true, shell_count: 1, reference_path: ['crossing-tube'] }
    local = { 'id' => 'overlap', 'bounds_mm' => { 'min' => [-0.2,-0.2,-0.2], 'max' => [0.2,0.2,0.2] } }
    result = AlmaSketchupMCP.evaluate_detail_region(local, [record])
    assert_equal 'fail', result['status'], result.inspect
    assert_equal 'required_void_inside_native_solid', result['reason']
  end
end

module AlmaSketchupMCP
  def entity_id(entity); entity.respond_to?(:id) ? entity.id : nil; end
  def entity_manifold_report(entity); entity.respond_to?(:repair) ? entity.repair : nil; end
  def mm_to_model_units(value); value.to_f; end
  def model_units_to_mm(value); value.to_f; end
  def bounds_hash(bounds)
    { 'min' => 3.times.map { |axis| bounds.points.map { |point| point[axis] }.min },
      'max' => 3.times.map { |axis| bounds.points.map { |point| point[axis] }.max } }
  end
end

EvidenceVertex = Struct.new(:position)
EvidenceEdge = Struct.new(:vertices, :faces)
EvidenceLoop = Struct.new(:vertices, :edges) { def outer?; true; end }
class EvidenceMesh
  def initialize(triangles); @points = triangles.flatten(1); end
  def polygons; (0...@points.length).each_slice(3).map { |indexes| indexes.map { |index| index + 1 } }; end
  def point_at(index); Geom::Point3d.new(@points[index - 1]); end
end
class EvidenceFace
  attr_accessor :parent, :loops, :outer_loop, :triangles, :hidden, :layer
  def initialize(parent, vertices = [], triangles = [])
    @parent = parent
    @outer_loop = EvidenceLoop.new(vertices, [])
    @loops = [@outer_loop]
    @triangles = triangles
  end
  def mesh(_flags); EvidenceMesh.new(@triangles); end
  def edges; @loops.flat_map(&:edges).uniq; end
  def hidden?; @hidden || false; end
  def material; nil; end
end

class EvidenceGroup
  attr_accessor :definition, :id, :hidden, :layer
  def initialize(definition, id); @definition, @id = definition, id; end
  def hidden?; @hidden || false; end
  def material; nil; end
  def name; @id; end
  def persistent_id; object_id; end
  def transformation; Geom::Transformation.new; end
  def manifold?; false; end
end
module Sketchup
  Face = EvidenceFace
  Group = EvidenceGroup
  class ComponentInstance; end
  class Edge; end
end

class DetailGeometryEvidenceTest < Minitest::Test
  def setup
    @api = AlmaSketchupMCP
    @transform = Geom::Transformation.new
    @points = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]]
  end

  def tunnel
    container = Object.new
    first_vertices = @points.map { |point| EvidenceVertex.new(Geom::Point3d.new(point)) }
    second_vertices = @points.map { |x, y, z| EvidenceVertex.new(Geom::Point3d.new(x, y, z + 5)) }
    first_face = EvidenceFace.new(container)
    second_face = EvidenceFace.new(container)
    first_edges = []
    second_edges = []
    sides = []
    4.times do |index|
      next_index = (index + 1) % 4
      side = EvidenceFace.new(container, [first_vertices[index], first_vertices[next_index], second_vertices[next_index], second_vertices[index]])
      first_edges << EvidenceEdge.new([first_vertices[index], first_vertices[next_index]], [first_face, side])
      second_edges << EvidenceEdge.new([second_vertices[index], second_vertices[next_index]], [second_face, side])
      sides << side
    end
    first = { points: first_vertices.map(&:position), normal: Geom::Vector3d.new(0, 0, 1), edges: first_edges, face: first_face, transform: @transform }
    second = { points: second_vertices.map(&:position), normal: Geom::Vector3d.new(0, 0, -1), edges: second_edges, face: second_face, transform: @transform }
    [[first, second], [first_face, second_face, *sides].map { |face| [face, @transform] }]
  end

  def test_connected_convex_tunnel_passes
    loops, faces = tunnel
    holes = @api.measured_through_holes(loops, faces)
    assert_equal 1, holes.length
    assert_equal 5, holes.first['depth_mm']
    assert holes.first['verified']
  end

  def test_far_faces_skip_clipping_but_an_actual_cap_still_blocks
    loops, faces = tunnel
    far = 100.times.map do |index|
      x = 100 + index * 20
      [EvidenceFace.new(Object.new, [], [[[x, 0, 2], [x + 10, 0, 2], [x, 10, 2]]]), @transform]
    end
    calls = 0
    original = @api.method(:triangle_intersects_opening_prism?)
    @api.stub(:triangle_intersects_opening_prism?, ->(*args) { calls += 1; original.call(*args) }) do
      assert_equal 1, @api.measured_through_holes(loops, faces + far).length
      assert_equal 0, calls, 'remote geometry must not undergo prism clipping'
      cap = EvidenceFace.new(Object.new, [], [[[1, 1, 2], [2, 1, 2], [1, 2, 2]]])
      assert_empty @api.measured_through_holes(loops, faces + far + [[cap, @transform]])
      assert_equal 1, calls, 'the actual cap must still be tested and rejected'
    end
  end

  def test_transformed_mesh_cache_is_local_to_snapshot_and_transform
    face = EvidenceFace.new(Object.new, [], [[[0, 0, 0], [1, 0, 0], [0, 1, 0]]])
    context = { face_meshes: {} }
    first = @api.transformed_face_mesh_for_detail(face, @transform, context)
    assert_same first, @api.transformed_face_mesh_for_detail(face, @transform, context)
    shifted = EvidenceAffineTransform.new(Matrix[[1,0,0,20],[0,1,0,0],[0,0,1,0],[0,0,0,1]])
    other = @api.transformed_face_mesh_for_detail(face, shifted, context)
    assert_equal 20, other[:min][0]
    refute_same first, other
    refute_same first, @api.transformed_face_mesh_for_detail(face, @transform, { face_meshes: {} })
  end

  def test_both_endpoint_caps_are_rejected
    [0, 5].each do |z|
      loops, faces = tunnel
      cap = EvidenceFace.new(Object.new, [], [[[0, 0, z], [10, 0, z], [10, 10, z]], [[0, 0, z], [10, 10, z], [0, 10, z]]])
      assert_empty @api.measured_through_holes(loops, faces + [[cap, @transform]])
    end
  end

  def test_off_center_partial_cap_is_rejected
    loops, faces = tunnel
    cap = EvidenceFace.new(Object.new, [], [[[1, 1, 2], [2, 1, 2], [1, 2, 2]]])
    assert_empty @api.measured_through_holes(loops, faces + [[cap, @transform]])
  end

  def test_oblique_blocker_crossing_prism_with_all_vertices_outside_is_rejected
    loops, faces = tunnel
    cap = EvidenceFace.new(Object.new, [], [[[-10, 5, 2], [5, -10, 2], [20, 20, 2]]])
    assert_empty @api.measured_through_holes(loops, faces + [[cap, @transform]])
  end

  def test_isolated_double_rings_do_not_prove_a_tunnel
    loops, faces = tunnel
    loops.each { |loop| loop[:edges].each { |edge| edge.faces = [loop[:face]] } }
    assert_empty @api.measured_through_holes(loops, faces.first(2))
  end

  def test_distinct_containers_and_incomplete_sidewalls_are_rejected
    loops, faces = tunnel
    loops.last[:face].parent = Object.new
    assert_empty @api.measured_through_holes(loops, faces)
    loops, faces = tunnel
    loops.first[:edges].first.faces.last.outer_loop.vertices.pop
    assert_empty @api.measured_through_holes(loops, faces)
  end

  def test_concave_profiles_remain_unverified
    concave = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [5, 3, 0], [0, 10, 0]]
    assert_nil @api.convex_opening_prism(concave, [0, 0, 5], 0.02)
  end

  def test_whole_prism_clipping_retains_only_nonzero_intersections
    prism = @api.convex_opening_prism(@points, [0, 0, 5], 0.02)
    assert @api.triangle_intersects_opening_prism?([[1, 1, 0], [2, 1, 0], [1, 2, 0]], prism, 0.02)
    refute @api.triangle_intersects_opening_prism?([[-2, -2, 2], [-1, -2, 2], [-2, -1, 2]], prism, 0.02)
    refute @api.triangle_intersects_opening_prism?([[1, 1, 6], [2, 1, 6], [1, 2, 6]], prism, 0.02)
    refute @api.triangle_intersects_opening_prism?([[-2, 0, 2], [0, 0, 2], [-2, 2, 2]], prism, 0.02)
  end

  def test_finely_segmented_convex_profile_is_not_rejected_for_short_edges
    circle = 512.times.map { |index| angle = index * Math::PI * 2 / 512; [Math.cos(angle), Math.sin(angle), 0] }
    refute_nil @api.convex_opening_prism(circle, [0, 0, 1], 0.02)
  end

  def test_definition_and_material_cache_does_not_reuse_entity_repair_claims
    entity_list = Object.new
    traversals = 0
    entity_list.define_singleton_method(:each) { |&_block| traversals += 1 }
    definition = Struct.new(:entities).new(entity_list)
    klass = Struct.new(:definition, :material, :repair) { def manifold?; false; end }
    first = klass.new(definition, nil, { 'repair_strategy' => 'seal_bbox' })
    second = klass.new(definition, nil, nil)
    context = { measurements: {}, face_meshes: {}, texture_writer: nil }
    measured = @api.measured_entity_geometry(first, nil, context)
    assert measured['measured'], measured.inspect
    assert_equal 'seal_bbox', measured['repair_strategy']
    assert_nil @api.measured_entity_geometry(second, nil, context)['repair_strategy']
    assert_equal 1, traversals
    @api.measured_entity_geometry(second, Object.new, context)
    assert_equal 2, traversals, 'another inherited material needs a separate measured result'
  end

  def test_hidden_parent_and_hidden_tag_propagate_to_every_required_descendant
    vertices = @points.map { |point| EvidenceVertex.new(Geom::Point3d.new(point)) }
    face = EvidenceFace.new(Object.new, vertices)
    definition = Struct.new(:name, :entities)
    child = EvidenceGroup.new(definition.new('leaf', [face]), 'child')
    parent = EvidenceGroup.new(definition.new('assembly', [child]), 'parent')
    model = Struct.new(:entities).new([parent])
    visible = @api.geometry_occurrences(model)
    assert visible.all? { |item| item['visible'] && item['geometry_evidence']['visible_face_count'] == 1 }
    parent.hidden = true
    hidden = @api.geometry_occurrences(model)
    assert hidden.all? { |item| item['visible'] == false && item['geometry_evidence']['visible_face_count'] == 0 }
    parent.hidden = false
    tag = Object.new
    tag.define_singleton_method(:visible?) { false }
    parent.layer = tag
    assert @api.geometry_occurrences(model).all? { |item| item['visible'] == false }
    parent.layer = nil
    face.hidden = true
    hidden_face = @api.geometry_occurrences(model)
    assert hidden_face.all? { |item| item['visible'] && item['geometry_evidence']['face_count'] == 1 && item['geometry_evidence']['visible_face_count'] == 0 }
  end

  def test_outer_turn_getter_distinguishes_rounded_profiles_from_subdivided_rectangles
    circle = 32.times.map { |index| angle = index * Math::PI * 2 / 32; [Math.cos(angle), Math.sin(angle), 0] }
    assert_in_delta 11.25, @api.maximum_outer_profile_turn(circle), 1.0e-8
    subdivided_rectangle = [[0,0,0],[5,0,0],[10,0,0],[10,5,0],[10,10,0],[5,10,0],[0,10,0],[0,5,0]]
    assert_in_delta 90, @api.maximum_outer_profile_turn(subdivided_rectangle), 1.0e-8
  end
end
