# frozen_string_literal: true

require 'minitest/autorun'
$LOAD_PATH.unshift(File.join(__dir__, 'support'))
require_relative '../../sketchup_plugin/alma_sketchup_mcp'
require_relative '../../sketchup_plugin/alma_sketchup_mcp/texture_mapping'

module Geom
  Point3d = Struct.new(:x, :y, :z) unless const_defined?(:Point3d)
end
def Sketchup.create_texture_writer; Object.new; end

class MappingFace < Sketchup::Face
  attr_accessor :material, :back_material, :reject, :wrong_readback
  attr_reader :normal, :vertices, :writes, :model
  def initialize(model, material, points = [[0, 0, 0], [2, 0, 0], [2, 1, 0], [0, 1, 0]], normal = [0, 0, 1])
    @model, @material, @back_material = model, material, material
    @vertices = points.map { |point| Struct.new(:position).new(Geom::Point3d.new(*point)) }
    @normal = Geom::Point3d.new(*normal)
    @writes, @maps, @attributes = [], {}, {}
  end
  def persistent_id; object_id; end
  def set_attribute(dictionary, key, value); @attributes[[dictionary, key]] = value; end
  def get_attribute(dictionary, key, default = nil); @attributes.fetch([dictionary, key], default); end
  def position_material(material, mapping, front)
    @writes << [material, mapping, front]
    return false if @reject
    front ? self.material = material : self.back_material = material
    @maps[front] = mapping
    self
  end
  def get_UVHelper(_front, _back, _writer); self; end
  def get_front_UVQ(point); uvq(point, true); end
  def get_back_UVQ(point); uvq(point, false); end
  def uvq(point, front)
    mapping = @maps.fetch(front)
    p0, t0, p1, t1, p2, t2 = mapping
    xyz = ->(p) { [p.x, p.y, p.z] }
    sub = ->(a, b) { xyz.call(a).zip(xyz.call(b)).map { |x, y| x - y } }
    dot = ->(a, b) { a.zip(b).sum { |x, y| x * y } }
    a, b, c = sub.call(p1, p0), sub.call(p2, p0), sub.call(point, p0)
    aa, bb, ab = dot.call(a, a), dot.call(b, b), dot.call(a, b)
    s = (dot.call(c, a) * bb - dot.call(c, b) * ab) / (aa * bb - ab * ab).to_f
    t = (dot.call(c, b) * aa - dot.call(c, a) * ab) / (aa * bb - ab * ab).to_f
    u = t0.x + (t1.x - t0.x) * s + (t2.x - t0.x) * t
    v = t0.y + (t1.y - t0.y) * s + (t2.y - t0.y) * t
    # Homogeneous coordinates deliberately use Q=2, as native UVQ may.
    Geom::Point3d.new(2 * u + (@wrong_readback ? 1 : 0), 2 * v, 2)
  end
end

class MappingGroup < Sketchup::Group
  attr_accessor :material
  attr_reader :entities, :model
  def initialize(model, entities); @model, @entities, @attributes = model, entities, {}; end
  def set_attribute(dictionary, key, value); @attributes[[dictionary, key]] = value; end
  def get_attribute(dictionary, key, default = nil); @attributes.fetch([dictionary, key], default); end
end
class MappingInstance < Sketchup::ComponentInstance
  attr_reader :definition
  def initialize(entities); @definition = Struct.new(:entities).new(entities); end
end

class NativeTextureMappingTest < Minitest::Test
  def setup
    @api = AlmaSketchupMCP
    @texture = Struct.new(:width, :height).new(1.0, 1.0)
    @material = Struct.new(:name, :texture).new('Wood', @texture)
    @model = Struct.new(:materials).new({ 'Wood' => @material })
    @face = MappingFace.new(@model, @material)
    @group = MappingGroup.new(@model, [@face])
  end
  def payload(values = {}); @api.texture_transform_payload(values, 'texture_transform'); end
  def assert_uv(expected, point = [1, 0, 0], front = true)
    actual = @api.texture_mapping_uv_samples(@face, front, [point]).first
    expected.zip(actual).each { |wanted, value| assert_in_delta wanted, value, 1.0e-8 }
  end

  def test_physical_dimensions_repeat_and_native_readback
    result = @api.apply_native_texture_transform(@group, payload('texture_size_mm' => [25.4, 50.8], 'scale' => [3, 2], 'offset' => [0.25, -0.5]))
    assert_uv [3.25, 0.5], [1, 1, 0]
    assert_equal 'native_face_uv', result['source']
    assert_equal 'readback', result['readback'][0]['status']
    assert_equal [1.0, 1.0], [@texture.width, @texture.height], 'per-face positioning must not mutate the shared material size'
  end

  def test_positive_rotation_rotates_texture_counterclockwise
    @api.apply_native_texture_transform(@group, payload('rotation' => 90))
    assert_uv [0, -1]
    assert_uv [1, 0], [0, 1, 0]
  end

  def test_both_sides_and_box_vertical_axes
    @face = MappingFace.new(@model, @material, [[0, 0, 0], [2, 0, 0], [2, 0, 1], [0, 0, 1]], [0, -1, 0])
    @group = MappingGroup.new(@model, [@face])
    result = @api.apply_native_texture_transform(@group, payload('projection' => 'box', 'side' => 'both'))
    assert_uv [2, 1], [2, 0, 1], true
    assert_uv [2, 1], [2, 0, 1], false
    assert_equal 2, result['applied_side_count']
  end

  def test_sloped_box_rejected_before_any_face_changes
    sloped = MappingFace.new(@model, @material, [[0, 0, 0], [1, 0, 1], [1, 1, 1]], [-Math.sqrt(0.5), 0, Math.sqrt(0.5)])
    @group.entities << sloped
    assert_match(/axis-aligned/, assert_raises(RuntimeError) { @api.apply_native_texture_transform(@group, payload('projection' => 'box')) }.message)
    assert_empty @face.writes
  end

  def test_shared_descendants_are_not_touched
    child = MappingFace.new(@model, @material)
    shared = MappingInstance.new([child])
    @group.entities << shared
    @api.apply_native_texture_transform(@group, payload)
    assert_equal 1, @face.writes.length
    assert_empty child.writes
    empty = MappingGroup.new(@model, [shared])
    assert_match(/no direct faces/, assert_raises(RuntimeError) { @api.apply_native_texture_transform(empty, payload) }.message)
  end

  def test_missing_material_and_missing_texture_reject_without_metadata_success
    assert_raises(RuntimeError) { @api.write_texture_transform_attributes(@group, payload('material' => 'Missing')) }
    assert_nil @group.get_attribute('TextureTransform', 'projection')
    @material.texture = nil
    assert_match(/textured material/, assert_raises(RuntimeError) { @api.apply_native_texture_transform(@group, payload) }.message)
    assert_empty @face.writes
  end

  def test_failed_native_apply_and_bad_readback_reject
    @face.reject = true
    assert_match(/did not apply/, assert_raises(RuntimeError) { @api.apply_native_texture_transform(@group, payload) }.message)
    @face.reject = false
    @face.wrong_readback = true
    assert_match(/readback did not match/, assert_raises(RuntimeError) { @api.apply_native_texture_transform(@group, payload) }.message)
  end

  def test_snapshot_reads_current_native_uv_not_stored_request
    @api.write_texture_transform_attributes(@group, payload)
    before = @api.entity_texture_transform(@group)['native_uv']
    @api.apply_native_texture_transform(@group, payload('scale' => [4, 1]))
    after = @api.entity_texture_transform(@group)
    assert_equal [1, 1], after['scale']
    refute_equal before, after['native_uv']
  end

  def test_explicit_uv_applies_and_missing_selectors_do_not_silently_skip
    explicit = @api.face_uv_payload('uv' => [[0, 0], [4, 0], [4, 2], [0, 2]], 'material' => 'Wood')
    result = @api.apply_face_uv_payload(@group, explicit)
    assert_equal 'applied', result['status']
    assert_uv [2, 0]
    explicit['selector'] = { 'type' => 'named', 'value' => 'missing' }
    assert_match(/matched no direct faces/, assert_raises(RuntimeError) { @api.apply_face_uv_payload(@group, explicit) }.message)
    explicit['selector'] = { 'type' => 'all' }; explicit['material'] = 'Missing'
    assert_match(/does not exist/, assert_raises(RuntimeError) { @api.apply_face_uv_payload(@group, explicit) }.message)
  end

  def test_creation_placement_hook_applies_mapping_to_completed_leaf
    @api.apply_transform(@group, 'name' => 'New board', 'texture_transform' => { 'scale' => [2, 1] })
    assert_uv [2, 0]
    assert_equal 'native_mapping_requested', @api.entity_texture_transform(@group)['application']
  end

  def test_invalid_dimensions_and_negative_array_scale_rejected
    assert_raises(RuntimeError) { payload('scale' => [-1, 1]) }
    assert_raises(RuntimeError) { payload('texture_size_mm' => [0, 50]) }
    assert_raises(RuntimeError) { payload('side' => 'inside') }
  end
end
