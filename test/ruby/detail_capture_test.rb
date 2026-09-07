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
  attr_accessor :camera, :failure, :model, :change_state
  def initialize(camera); @camera = camera; end
  def refresh; true; end
  def write_image(options)
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
  attr_accessor :modified, :active_view
  def initialize(view); @active_view = view; @modified = false; view.model = self; end
  def bounds; CaptureFakeBounds.new; end
  def modified?; @modified; end
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
  def setup
    @directory = Dir.mktmpdir('detail-capture-test-')
    @original = Sketchup::Camera.new(Geom::Point3d.new(1, 2, 3), Geom::Point3d.new(0, 0, 0), Geom::Vector3d.new(0, 0, 1), false)
    @original.height = 123
    @view = CaptureFakeView.new(@original)
    @model = CaptureFakeModel.new(@view)
  end

  def teardown; FileUtils.remove_entry(@directory); end

  def with_model
    AlmaSketchupMCP.stub(:active_model_required, @model) do
      AlmaSketchupMCP.stub(:native_appearance_snapshot, { 'signature' => 'native-fixture' }) do
        AlmaSketchupMCP.stub(:session_model_revision_report, { 'model_revision' => 'sha256:fixture', 'complete' => true }) do
          AlmaSketchupMCP.stub(:bounds_hash, { 'min' => [0, 0, 0], 'max' => [100, 100, 100] }) { yield }
        end
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
