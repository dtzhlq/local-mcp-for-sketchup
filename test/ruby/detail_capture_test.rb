# frozen_string_literal: true

require 'minitest/autorun'
require 'tmpdir'
$LOAD_PATH.unshift(File.join(__dir__, 'support'))
require_relative '../../sketchup_plugin/alma_sketchup_mcp'
require_relative '../../sketchup_plugin/alma_sketchup_mcp/environment_operations'
require_relative '../../sketchup_plugin/alma_sketchup_mcp/capture_detail_views'

module Geom
  Point3d = Struct.new(:x, :y, :z) unless const_defined?(:Point3d)
  Vector3d = Struct.new(:x, :y, :z) unless const_defined?(:Vector3d)
  class Transformation
    def initialize(values); @values = values.dup; end
    def to_a; @values.dup; end
  end unless const_defined?(:Transformation)
end

module Sketchup
  class Camera
    attr_accessor :eye, :target, :up, :aspect_ratio, :height, :fov
    def initialize(eye, target, up, perspective = true, fov = 30)
      @eye, @target, @up, @perspective, @fov = eye, target, up, perspective, fov
      @aspect_ratio = 0
      @height = 100
    end
    def perspective?; @perspective; end
    def fov_is_height?; true; end
  end
end

class CaptureFakeView
  attr_accessor :camera, :failure, :model, :change_state, :on_refresh, :on_write
  attr_reader :refreshes
  def initialize(camera); @camera = camera; @refreshes = 0; end
  def refresh; @refreshes += 1; @on_refresh.call(self) if @on_refresh; true; end
  def write_image(options)
    @on_write.call(self) if @on_write
    raise 'intentional image export failure' if @failure
    @model.modified = true if @change_state
    # Only a PNG header fixture: this test validates control flow and metadata,
    # and is never accepted as rendered or visual quality evidence.
    File.binwrite(options[:filename], "\x89PNG\r\n\x1A\n".b + [13].pack('N') + 'IHDR' + [options[:width], options[:height]].pack('NN'))
    true
  end
end

class CaptureFakeBounds
  def diagonal; 100.0; end
  def valid?; true; end
  def center; Geom::Point3d.new(0, 0, 0); end
end

class CaptureFakeModel
  attr_accessor :modified, :active_view, :entities, :definitions
  def initialize(view); @active_view = view; @modified = false; view.model = self; @entities = []; @definitions = []; end
  def bounds; CaptureFakeBounds.new; end
  def modified?; @modified; end
end

CaptureFacingBehavior = Struct.new(:facing) do
  def always_face_camera?; facing; end
end
CaptureFacingDefinition = Struct.new(:name, :persistent_id, :entities, :instances, :behavior)
class CaptureFacingEdge < Sketchup::Edge
  attr_reader :vertices
  def initialize; @vertices = [Struct.new(:position).new(Geom::Point3d.new(0, 0, 0)), Struct.new(:position).new(Geom::Point3d.new(1, 0, 0))]; end
  def persistent_id; 41157; end
  def length; @vertices.last.position.x; end
  def faces; []; end
  def soft?; false; end
  def smooth?; false; end
end
class CaptureFacingInstance < Sketchup::ComponentInstance
  attr_accessor :transformation, :parent, :definition, :persistent_id, :locked, :glue, :valid,
                :move_effect, :attribute_dictionaries, :move_return
  attr_reader :moves
  def initialize(model, definition, matrix)
    @parent, @definition, @persistent_id = model, definition, 41159
    @transformation = Geom::Transformation.new(matrix)
    @moves, @locked, @glue, @valid = [], false, nil, true
    @move_return = true
    definition.instances << self
    model.entities << self
  end
  def name; ''; end
  def locked?; @locked; end
  def glued_to; @glue; end
  def valid?; @valid; end
  def move!(transform)
    @moves << transform.to_a
    @transformation = transform
    @move_effect.call(self) if @move_effect.respond_to?(:call)
    @move_effect == :return_false ? false : @move_return
  end
end
CaptureFacingDictionary = Struct.new(:name, :values) do
  def each_pair(&block); values.each_pair(&block); end
end

class CaptureSceneEntities < Array
  attr_accessor :active_section_plane
end
CaptureSceneStyle = Struct.new(:selected_style, :active_style_changed)
CaptureScenePage = Struct.new(:name, :camera, :render_mode)
class CaptureScenePages < Array
  attr_reader :selected_page
  attr_accessor :model
  def selected_page=(page)
    @selected_page = page
    model.rendering_options['RenderMode'] = page.render_mode
    model.active_view.camera = page.camera
    model.modified = true
  end
end
class CaptureSceneModel < CaptureFakeModel
  attr_accessor :pages, :styles, :rendering_options, :shadow_info, :options, :entities
  def initialize(view)
    super
    @styles = CaptureSceneStyle.new('original-style', false)
    @rendering_options = { 'RenderMode' => 3 }
    @shadow_info = { 'Light' => 80 }
    @options = { 'PageOptions' => { 'ShowTransition' => true } }
    @entities = CaptureSceneEntities.new
    @pages = CaptureScenePages.new
    @pages.model = self
  end
  def definitions; []; end
  def layers; []; end
end

class DetailCaptureTest < Minitest::Test
  # Copied from the controlled native restoration-v2 diagnostic. These unit
  # fakes test exact restoration and fail-closed behavior, never live evidence.
  SREE_BEFORE = [0.8288563621805117, 0.5594614650473153, 0, 0,
    -0.5594614650473153, 0.8288563621805117, 0, 0, 0, 0, 1, 0,
    -13.886367731446388, -24.24832049445804, 0, 1].freeze
  SREE_AT_CAPTURE = [0.9284766908852599, 0.3713906763541025, 0, 0,
    -0.3713906763541025, 0.9284766908852599, 0, 0, 0, 0, 1, 0,
    -13.886367731446388, -24.24832049445804, 0, 1].freeze

  def setup
    @directory = Dir.mktmpdir('detail-capture-test-')
    @original = Sketchup::Camera.new(Geom::Point3d.new(1, 2, 3), Geom::Point3d.new(0, 0, 0), Geom::Vector3d.new(0, 0, 1), false)
    @original.height = 123
    @view = CaptureFakeView.new(@original)
    @model = CaptureFakeModel.new(@view)
  end

  def teardown; FileUtils.remove_entry(@directory); end

  def with_model(revision_reader = nil)
    AlmaSketchupMCP.stub(:active_model_required, @model) do
      AlmaSketchupMCP.stub(:native_appearance_snapshot, { 'signature' => 'native-fixture' }) do
        AlmaSketchupMCP.stub(:session_model_revision_report, revision_reader || { 'model_revision' => 'sha256:fixture', 'complete' => true }) do
          AlmaSketchupMCP.stub(:bounds_hash, { 'min' => [0, 0, 0], 'max' => [100, 100, 100] }) { yield }
        end
      end
    end
  end

  def with_facing_model
    @facing_edge = CaptureFacingEdge.new
    definition = CaptureFacingDefinition.new('Sree', 41158, [@facing_edge], [], CaptureFacingBehavior.new(true))
    @model.definitions << definition
    @facing = CaptureFacingInstance.new(@model, definition, SREE_BEFORE)
    @guard_metadata = { 'totals' => { 'instances' => 1 }, 'materials' => [], 'classification_schemas' => [], 'native_appearance' => { 'signature' => 'native-fixture' } }
    actual_revision = AlmaSketchupMCP.method(:session_model_revision_report)
    reader = ->(model) { actual_revision.call(model, @guard_metadata) }
    AlmaSketchupMCP.stub(:snapshot, ->(_model, **_options) { @guard_metadata }) do
      with_model(reader) { yield }
    end
  end

  def facing_capture(id = 'facing')
    AlmaSketchupMCP.capture_detail_views({ 'output_dir' => @directory, 'views' => [{ 'id' => id,
      'eye' => [1362, -2210, 1626], 'target' => [450, 70, 600], 'width' => 800, 'height' => 500 }] })
  end

  def set_facing_matrix(matrix)
    @facing.transformation = Geom::Transformation.new(matrix)
  end

  def test_exact_sree_rotation_restores_once_and_preserves_actual_revision_and_dirty_flag
    with_facing_model do
      before = AlmaSketchupMCP.session_model_revision_report(@model)
      @view.on_refresh = ->(view) { set_facing_matrix(SREE_AT_CAPTURE) if view.refreshes == 1 }
      result = facing_capture
      assert result['restored']
      assert_equal [SREE_BEFORE], @facing.moves
      assert_equal SREE_BEFORE, @facing.transformation.to_a
      assert_equal before['model_revision'], result['restoration']['model_revision_after']
      assert_equal 'restored_exact_native_matrices', result['restoration']['camera_facing_recovery']['status']
      assert_equal 1, result['restoration']['camera_facing_recovery']['restored_instances']
      refute @model.modified?
      capture = result['captures'].first
      assert_equal before['model_revision'], capture['model_revision']
      assert_equal 'restored_source_revision', capture['model_revision_binding']
      refute_equal before['model_revision'], capture['capture_model_revision']
      assert_equal capture['capture_model_revision_before_export'], capture['capture_model_revision']
    end
  end

  def test_failed_export_still_restores_only_observed_camera_rotation
    with_facing_model do
      @view.on_write = ->(_view) { set_facing_matrix(SREE_AT_CAPTURE) }
      @view.failure = true
      error = assert_raises(RuntimeError) { facing_capture }
      assert_match(/intentional image export failure/, error.message)
      assert_equal [SREE_BEFORE], @facing.moves
      assert_equal SREE_BEFORE, @facing.transformation.to_a
      refute @model.modified?
    end
  end

  def test_unexpected_translation_scale_mirror_shear_or_yaw_never_gets_rewritten
    mutations = {
      translation: ->(matrix) { matrix[12] += 1 },
      z_translation: ->(matrix) { matrix[14] += 1 },
      scale: ->(matrix) { matrix[0] *= 1.1; matrix[1] *= 1.1 },
      mirror: ->(matrix) { matrix[4] *= -1; matrix[5] *= -1 },
      shear: ->(matrix) { matrix[4] += 0.01 },
      yaw: ->(matrix) { matrix[0] = 1; matrix[1] = 0; matrix[4] = 0; matrix[5] = 1 }
    }
    mutations.each do |name, mutate|
      @model = CaptureFakeModel.new(@view)
      with_facing_model do
        changed = SREE_AT_CAPTURE.dup
        mutate.call(changed)
        @view.on_write = ->(_view) { set_facing_matrix(changed) }
        assert_raises(RuntimeError, name.to_s) { facing_capture(name.to_s) }
        assert_empty @facing.moves, name.to_s
        assert_equal changed, @facing.transformation.to_a, name.to_s
      end
    end
  end

  def test_preservation_guard_refuses_other_geometry_attributes_materials_or_membership_before_any_write
    mutations = {
      attributes: -> { @facing.attribute_dictionaries = [CaptureFacingDictionary.new('Real edit', { 'value' => 5 })] },
      geometry: -> { @facing_edge.vertices.last.position.x = 2 },
      material: -> { @guard_metadata['materials'] << { 'name' => 'New real material' } },
      membership: -> { @model.entities.delete(@facing) },
      definition: -> { @facing.definition.name = 'Edited definition' },
      other_transform: lambda do
        other = CaptureFacingInstance.new(@model, @facing.definition, SREE_BEFORE)
        other.persistent_id = 50000
      end,
      modified: -> { @model.modified = true }
    }
    mutations.each do |name, mutate|
      @model = CaptureFakeModel.new(@view)
      with_facing_model do
        @view.on_write = ->(_view) { set_facing_matrix(SREE_AT_CAPTURE); mutate.call }
        assert_raises(RuntimeError, name.to_s) { facing_capture(name.to_s) }
        assert_empty @facing.moves, name.to_s
        assert_equal SREE_AT_CAPTURE, @facing.transformation.to_a, name.to_s
      end
    end
  end

  def test_matrix_changed_between_controlled_calls_is_not_overwritten_even_if_it_is_another_valid_yaw
    with_facing_model do
      revision = AlmaSketchupMCP.session_model_revision_report(@model)
      plan = AlmaSketchupMCP.detail_capture_facing_restore_plan(@model, nil, revision, false)
      camera = Sketchup::Camera.new(Geom::Point3d.new(1362, -2210, 1626), Geom::Point3d.new(450, 70, 600), Geom::Vector3d.new(0, 0, 1))
      AlmaSketchupMCP.detail_capture_facing_step(@model, plan, camera, 'write_image') { set_facing_matrix(SREE_AT_CAPTURE) }
      manual = SREE_BEFORE.dup
      manual[0], manual[1], manual[4], manual[5] = 1, 0, 0, 1
      set_facing_matrix(manual)
      result = AlmaSketchupMCP.restore_detail_capture_facing_instances(@model, plan)
      assert_equal 'refused', result['status']
      assert_match(/outside_controlled_draw/, result['reason'])
      assert_empty @facing.moves
      assert_equal manual, @facing.transformation.to_a
    end
  end

  def test_move_dirty_flag_false_return_or_inexact_readback_fail_without_retry
    effects = {
      dirty: ->(_entity) { @model.modified = true },
      false_return: :return_false,
      inexact: lambda do |entity|
        matrix = entity.transformation.to_a
        matrix[0] += 1e-14
        entity.transformation = Geom::Transformation.new(matrix)
      end
    }
    effects.each do |name, effect|
      @model = CaptureFakeModel.new(@view)
      with_facing_model do
        @view.on_write = ->(_view) { set_facing_matrix(SREE_AT_CAPTURE) }
        @facing.move_effect = effect
        result = facing_capture(name.to_s)
        refute result['restored'], name.to_s
        assert_equal 'restoration_failed', result['status']
        assert_equal 'failed', result['restoration']['camera_facing_recovery']['status']
        assert_equal 1, @facing.moves.length
        write = result['restoration']['camera_facing_recovery']['native_writes'].first
        assert_equal(name == :false_return ? 'FalseClass' : 'TrueClass', write['return_class'])
        assert_equal(name != :false_return, write['return_value'])
        assert_equal(name != :inexact, write['exact_readback'])
        assert_equal SREE_BEFORE, write['expected_transformation']
        assert_equal @facing.transformation.to_a, write['immediate_transformation']
      end
    end
  end

  def test_non_boolean_native_return_is_bounded_diagnostic_and_never_relaxes_success_gate
    with_facing_model do
      @view.on_write = ->(_view) { set_facing_matrix(SREE_AT_CAPTURE) }
      @facing.move_return = 'opaque-native-return-' * 30
      result = facing_capture
      refute result['restored']
      write = result['restoration']['camera_facing_recovery']['native_writes'].first
      assert_equal 'String', write['return_class']
      assert_equal @facing.move_return[0, 160], write['return_value']
      assert write['exact_readback']
      assert_equal SREE_BEFORE, write['immediate_transformation']
      assert result['restoration']['model_revision_restored']
      refute result['restoration']['model_modified_changed']
      assert_equal 1, @facing.moves.length
    end
  end

  def test_native_same_receiver_return_is_accepted_only_with_all_existing_restoration_checks
    with_facing_model do
      @view.on_write = ->(_view) { set_facing_matrix(SREE_AT_CAPTURE) }
      @facing.move_return = @facing
      result = facing_capture
      assert result['restored']
      write = result['restoration']['camera_facing_recovery']['native_writes'].first
      assert_equal 'CaptureFacingInstance', write['return_class']
      assert write['returned_same_instance']
      assert write['exact_readback']
      assert result['restoration']['model_revision_restored']
      refute result['restoration']['model_modified_changed']
      assert_equal 2, result['restoration']['stability']['consecutive_matches']
      assert_equal 1, @facing.moves.length
    end
  end

  def test_other_same_class_native_instance_or_nil_return_is_rejected
    [nil, :other_instance].each do |value|
      @model = CaptureFakeModel.new(@view)
      with_facing_model do
        @view.on_write = ->(_view) { set_facing_matrix(SREE_AT_CAPTURE) }
        @facing.move_return = value == :other_instance ? CaptureFacingInstance.allocate : value
        result = facing_capture(value.to_s.empty? ? 'nil-return' : value.to_s)
        refute result['restored']
        write = result['restoration']['camera_facing_recovery']['native_writes'].first
        refute write['returned_same_instance']
        assert write['exact_readback']
        assert result['restoration']['model_revision_restored']
        assert_equal 1, @facing.moves.length
      end
    end
  end

  def test_unsupported_billboards_fail_preflight_before_camera_or_image_export
    modifications = {
      nested: -> { @model.entities.delete(@facing); @facing.parent = @facing.definition },
      locked: -> { @facing.locked = true },
      glued: -> { @facing.glue = Object.new },
      invalid: -> { @facing.valid = false },
      tilted: -> { matrix = SREE_BEFORE.dup; matrix[2] = 0.01; set_facing_matrix(matrix) },
      duplicate_pid: -> { @model.entities << CaptureFacingInstance.new(@model, @facing.definition, SREE_BEFORE) }
    }
    modifications.each do |name, modify|
      @model = CaptureFakeModel.new(@view)
      with_facing_model do
        modify.call
        before_refreshes = @view.refreshes
        error = assert_raises(RuntimeError, name.to_s) { facing_capture(name.to_s) }
        assert_match(/camera_facing_unsupported/, error.message)
        assert_empty @facing.moves
        assert_equal before_refreshes, @view.refreshes
        assert_empty Dir.children(@directory)
      end
    end
  end

  def test_multiple_cameras_restore_original_orthographic_camera_and_modified_flag
    with_model do
      result = AlmaSketchupMCP.capture_detail_views({ 'output_dir' => @directory, 'views' => [
        { 'id' => 'front', 'name' => 'Front', 'kind' => 'detail', 'target_id' => 'metadata-only', 'width' => 640, 'height' => 480, 'min_width' => 800, 'min_height' => 600,
          'camera' => { 'eye' => [0, -1000, 200], 'target' => [0, 0, 200], 'up' => [0, 0, 1], 'fov' => 35 } },
        { 'id' => 'overview', 'projection' => 'orthographic' }
      ] })
      assert_equal 'captured_and_restored', result['status']
      assert result['restored']
      assert_equal @original.eye, @view.camera.eye
      assert_equal @original.target, @view.camera.target
      assert_equal 123, @view.camera.height
      assert_equal false, result['restoration']['model_modified_after']
      assert_equal [800, 600], result['captures'].first.values_at('width', 'height')
      assert_equal 35, result['captures'].first['camera']['fov']
      assert_equal 'sha256:fixture', result['captures'].first['model_revision']
      assert_equal false, result['captures'].last['camera']['perspective']
    end
  end

  def test_export_exception_still_restores_camera
    @view.failure = true
    with_model do
      error = assert_raises(RuntimeError) { AlmaSketchupMCP.capture_detail_views({ 'output_dir' => @directory, 'views' => [{ 'id' => 'broken' }] }) }
      assert_match(/intentional image export failure/, error.message)
      assert_equal @original.eye, @view.camera.eye
    end
  end

  def test_restores_pose_when_view_camera_is_a_live_handle
    original_eye = @view.camera.eye.dup
    original_target = @view.camera.target.dup
    def @view.camera=(value)
      @camera.eye = value.eye
      @camera.target = value.target
      @camera.up = value.up
      @camera.aspect_ratio = value.aspect_ratio
      @camera.height = value.height
      @camera.fov = value.fov
      @camera.instance_variable_set(:@perspective, value.perspective?)
    end
    with_model do
      result = AlmaSketchupMCP.capture_detail_views({ 'output_dir' => @directory, 'views' => [{ 'id' => 'live-handle' }] })
      assert result['restored']
      assert_equal original_eye, @view.camera.eye
      assert_equal original_target, @view.camera.target
    end
  end

  def test_dirty_state_is_not_reported_as_restored
    @view.change_state = true
    with_model do
      result = AlmaSketchupMCP.capture_detail_views({ 'output_dir' => @directory, 'views' => [{ 'id' => 'changed' }] })
      assert_equal 'restoration_failed', result['status']
      refute result['restored']
      assert_equal false, result['restoration']['model_modified_before']
      assert_equal true, result['restoration']['model_modified_after']
    end
  end

  def test_delayed_native_revision_restoration_needs_two_complete_redraw_matches
    revision = 'sha256:fixture'
    @view.on_refresh = lambda do |view|
      revision = view.refreshes < 3 ? 'sha256:camera-facing-pending' : 'sha256:fixture'
    end
    reader = ->(_model) { { 'model_revision' => revision, 'complete' => true } }
    with_model(reader) do
      result = AlmaSketchupMCP.capture_detail_views({ 'output_dir' => @directory, 'views' => [{ 'id' => 'delayed' }] })
      assert result['restored']
      stability = result['restoration']['stability']
      assert_equal [false, true, true], stability['observations'].map { |entry| entry['all_conditions_matched'] }
      assert_equal 2, stability['consecutive_matches']
      assert_equal 'sha256:fixture', result['restoration']['model_revision_after']
    end
  end

  def test_persistent_geometry_change_is_never_waived_by_redraw_retries
    revision = 'sha256:fixture'
    @view.on_refresh = ->(_view) { revision = 'sha256:real-geometry-change' }
    reader = ->(_model) { { 'model_revision' => revision, 'complete' => true } }
    with_model(reader) do
      result = AlmaSketchupMCP.capture_detail_views({ 'output_dir' => @directory, 'views' => [{ 'id' => 'geometry-change' }] })
      refute result['restored']
      refute result['restoration']['model_revision_restored']
      assert_equal 3, result['restoration']['stability']['observations'].length
      assert_equal 'sha256:real-geometry-change', result['restoration']['model_revision_after']
    end
  end

  def test_one_transient_match_does_not_establish_stable_restoration
    revision = 'sha256:fixture'
    @view.on_refresh = lambda do |view|
      revision = view.refreshes == 2 ? 'sha256:fixture' : 'sha256:unsettled'
    end
    reader = ->(_model) { { 'model_revision' => revision, 'complete' => true } }
    with_model(reader) do
      result = AlmaSketchupMCP.capture_detail_views({ 'output_dir' => @directory, 'views' => [{ 'id' => 'transient' }] })
      refute result['restored']
      assert_equal [true, false, false], result['restoration']['stability']['observations'].map { |entry| entry['all_conditions_matched'] }
    end
  end

  def setup_scene_model
    @model = CaptureSceneModel.new(@view)
    @page_a = CaptureScenePage.new('Neutral', AlmaSketchupMCP.detached_detail_camera(@original), 3)
    @page_b = CaptureScenePage.new('Alternative', Sketchup::Camera.new(Geom::Point3d.new(30, 20, 10), Geom::Point3d.new(0, 0, 0), Geom::Vector3d.new(0, 0, 1)), 4)
    @model.pages.push(@page_a, @page_b)
    @model.pages.selected_page = @page_a
    @model.modified = false
  end

  def test_controlled_scene_capture_restores_native_state_and_reports_modified_change
    setup_scene_model
    with_model do
      result = AlmaSketchupMCP.capture_detail_views({ 'output_dir' => @directory,
        'views' => [{ 'id' => 'scene-b', 'scene_ref' => 'Alternative' }] })
      assert result['restored']
      assert_equal 'controlled_scene_inspection', result['capture_scope']
      assert_equal 'Alternative', result['captures'].first['scene_ref']
      assert_same @page_a, @model.pages.selected_page
      assert_equal 3, @model.rendering_options['RenderMode']
      assert_equal true, @model.options['PageOptions']['ShowTransition']
      assert_equal @original.eye, @view.camera.eye
      assert result['restoration']['model_modified_changed']
      assert_equal false, result['restoration']['model_modified_before']
      assert_equal true, result['restoration']['model_modified_after']
    end
  end

  def test_scene_export_failure_restores_scene_display_and_transition
    setup_scene_model
    @view.failure = true
    with_model do
      assert_raises(RuntimeError) { AlmaSketchupMCP.capture_detail_views({ 'output_dir' => @directory,
        'views' => [{ 'id' => 'scene-b', 'scene_ref' => 'Alternative' }] }) }
      assert_same @page_a, @model.pages.selected_page
      assert_equal 3, @model.rendering_options['RenderMode']
      assert_equal true, @model.options['PageOptions']['ShowTransition']
      assert_equal @original.eye, @view.camera.eye
    end
  end

  def test_unsaved_style_blocks_scene_switch_before_mutation
    setup_scene_model
    @model.styles.active_style_changed = true
    with_model do
      error = assert_raises(RuntimeError) { AlmaSketchupMCP.capture_detail_views({ 'output_dir' => @directory,
        'views' => [{ 'id' => 'scene-b', 'scene_ref' => 'Alternative' }] }) }
      assert_match(/scene_capture_unsaved_style/, error.message)
      assert_same @page_a, @model.pages.selected_page
      refute @model.modified?
      assert_empty Dir.children(@directory)
    end
  end

  def test_preflight_rejects_scene_switches_duplicates_unsafe_names_and_degenerate_camera
    with_model do
      [
        [{ 'id' => 'unsafe', 'scene' => 'Would discard edits' }],
        [{ 'id' => '../escape' }],
        [{ 'id' => 'same' }, { 'id' => 'same' }],
        [{ 'id' => 'bad', 'eye' => [0, 0, 0], 'target' => [0, 0, 1] }],
        [{ 'id' => 'bad', 'eye' => [0, 0, 0] }]
      ].each do |views|
        assert_raises(RuntimeError) { AlmaSketchupMCP.capture_detail_views({ 'output_dir' => @directory, 'views' => views }) }
        assert_same @original, @view.camera
      end
    end
  end
end
