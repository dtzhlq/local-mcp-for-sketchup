# frozen_string_literal: true

require 'minitest/autorun'
require 'tmpdir'
$LOAD_PATH.unshift(File.join(__dir__, 'support'))
require_relative '../../sketchup_plugin/alma_sketchup_mcp'
require_relative '../../sketchup_plugin/alma_sketchup_mcp/environment_operations'

module Sketchup
  class << self
    attr_accessor :test_version
    def version; @test_version || '26.0.428'; end
    def platform; :platform_osx; end
  end

  # Official-shaped fake deliberately has a read-only workflow. It rejects
  # AO/normal activation before a texture, as the native API does.
  class Material
    attr_accessor :name, :metallic_factor, :roughness_factor, :ao_strength, :normal_scale, :normal_style, :texture, :alpha
    attr_reader :events, :ao_texture, :normal_texture, :metallic_texture, :roughness_texture
    def initialize
      @name = 'Native Surface'
      @events = []
      @enabled = {}
      @alpha = 1
      @normal_style = NORMAL_STYLE_OPENGL
    end
    def color; Struct.new(:red, :green, :blue).new(150, 140, 130); end
    def set_attribute(dictionary, key, value); (@attributes ||= {})[[dictionary, key]] = value; end
    def get_attribute(dictionary, key); (@attributes ||= {})[[dictionary, key]]; end
    def workflow; @enabled.values.any? ? WORKFLOW_PBR_METALLIC_ROUGHNESS : WORKFLOW_CLASSIC; end
    %w[metalness roughness normal ao].each do |channel|
      define_method("#{channel}_enabled?") { @enabled[channel] || false }
      define_method("#{channel}_enabled=") do |value|
        raise ArgumentError, "#{channel} texture required first" if value && %w[ao normal].include?(channel) && !instance_variable_get("@#{channel}_texture")
        @events << ["#{channel}_enabled", value]
        @enabled[channel] = value
      end
    end
    %w[metallic roughness normal ao].each do |channel|
      define_method("#{channel}_texture=") do |path|
        @events << ["#{channel}_texture", path]
        instance_variable_set("@#{channel}_texture", Struct.new(:filename).new(path))
        @enabled[channel] = true if %w[normal ao].include?(channel)
      end
    end
  end
end

module Geom
  Point3d = Struct.new(:x, :y, :z) unless const_defined?(:Point3d)
end

class AppearanceEnvironment
  attr_accessor :name, :description, :path, :rotation, :skydome_exposure, :reflection_exposure, :linked_sun_position
  def initialize(name, path)
    @name, @path = name, path
    @description = ''
    @rotation = 0
    @skydome_exposure = @reflection_exposure = 1
    @linked_sun_position = Geom::Point3d.new(0, 0, 0)
    @attrs = {}
  end
  %w[linked_sun use_as_skydome use_for_reflections].each do |field|
    define_method("#{field}=") { |value| instance_variable_set("@#{field}", value) }
    define_method("#{field}?") { instance_variable_get("@#{field}") || false }
  end
  def get_attribute(dictionary, key); @attrs[[dictionary, key]]; end
  def set_attribute(dictionary, key, value); @attrs[[dictionary, key]] = value; end
end

class AppearanceEnvironments < Array
  attr_accessor :current
  def add(name, path)
    environment = AppearanceEnvironment.new(name, path)
    push(environment)
    environment
  end
end

AppearanceStyle = Struct.new(:name, :path, :guid)
class AppearanceStyles < Array
  attr_accessor :selected_style
  def add_style(path, activate)
    style = AppearanceStyle.new('Native file style name', path, "style-#{length}")
    push(style)
    @selected_style = style if activate
    Sketchup.version.to_i >= 26 ? style : true
  end
  def active_style_changed; false; end
end

class AppearancePage
  attr_accessor :name, :environment, :style
  attr_reader :rendering_options
  def initialize
    @name = 'View A'
    @rendering_options = { 'RenderMode' => 3 }
  end
  def use_environment=(value); @use_environment = value; end
  def use_environment?; !!@use_environment; end
  def use_style=(value)
    raise ArgumentError, 'Style object required' unless value.is_a?(AppearanceStyle)
    @style = value
  end
  def use_style?; !@style.nil?; end
  def use_rendering_options?; use_style?; end
end

AppearanceModel = Struct.new(:environments, :styles, :pages, :materials, :rendering_options, :active_view)

class AppearanceMaterials < Array
  attr_accessor :load_existing
  def [](key); key.is_a?(String) ? find { |material| material.name == key } : super; end
  def load(_path)
    return @load_existing if @load_existing
    material = Sketchup::Material.new
    material.name = 'Embedded native name'
    material.roughness_enabled = true
    push(material)
    material
  end
end

class NativeAppearanceTest < Minitest::Test
  def test_texture_pixels_are_measured_not_inferred_from_filename
    image = Struct.new(:width, :height, :bits_per_pixel, :row_padding, :data).new(2, 1, 24, 0, 'abcdef'.b)
    texture = Object.new
    texture.define_singleton_method(:image_rep) { |_colorized| image }
    before = AlmaSketchupMCP.native_texture_pixel_fingerprint(texture)
    assert_equal Digest::SHA256.hexdigest('abcdef'.b), before['sha256']
    image.data = 'abcdeg'.b
    refute_equal before['sha256'], AlmaSketchupMCP.native_texture_pixel_fingerprint(texture)['sha256']
    image.data = nil
    assert_nil AlmaSketchupMCP.native_texture_pixel_fingerprint(texture)
    large = Object.new
    large.define_singleton_method(:image_width) { 10_000 }
    large.define_singleton_method(:image_height) { 10_000 }
    large.define_singleton_method(:image_rep) { |_colorized| raise 'Must not allocate an oversized copy' }
    assert_nil AlmaSketchupMCP.native_texture_pixel_fingerprint(large)
  end

  def test_explicit_color_and_alpha_survive_base_texture_loading
    material = Sketchup::Material.new
    material.define_singleton_method(:texture=) { |value| @texture = value; @requested_color = 'texture average'; @alpha = 1 }
    material.define_singleton_method(:color=) { |value| @requested_color = value }
    material.define_singleton_method(:requested_color) { @requested_color }
    Dir.mktmpdir do |directory|
      image = File.join(directory, 'base.png')
      File.write(image, 'test texture')
      AlmaSketchupMCP.apply_material_spec(material, { 'name' => 'Tint', 'texture' => image, 'color' => '#67452d', 'alpha' => 0.35 })
      assert_equal '#67452d', material.requested_color
      assert_equal 0.35, material.alpha
    end
  end

  def setup
    @directory = Dir.mktmpdir('native-appearance-test-')
    @hdr = File.join(@directory, 'fixture.hdr')
    @texture = File.join(@directory, 'texture.png')
    @style_path = File.join(@directory, 'fixture.style')
    @skm_path = File.join(@directory, 'fixture.skm')
    [@hdr, @texture, @style_path, @skm_path].each { |path| File.write(path, 'fake API input; not a real render asset') }
    @model = AppearanceModel.new(AppearanceEnvironments.new, AppearanceStyles.new, [], [], { 'RenderMode' => 3 }, Struct.new(:graphics_engine).new(:graphics_engine_2024))
    Sketchup.test_version = '26.0.428'
  end

  def teardown
    FileUtils.remove_entry(@directory)
  end

  def test_workflow_is_getter_and_ao_texture_is_installed_first
    material = Sketchup::Material.new
    refute material.respond_to?(:workflow=)
    assert AlmaSketchupMCP.supports_pbr_materials?
    AlmaSketchupMCP.apply_workflow_and_pbr(material, { 'name' => material.name, 'workflow' => 'pbr_metallic_roughness', 'pbr' => {
      'ao_strength' => 0.6, 'normal_scale' => 0, 'textures' => { 'normal' => @texture, 'ao' => @texture }
    } })
    assert_equal Sketchup::Material::WORKFLOW_PBR_METALLIC_ROUGHNESS, material.workflow
    assert_equal 0, material.normal_scale
    assert_operator material.events.index(['ao_texture', @texture]), :<, material.events.index(['ao_enabled', true])
    snapshot = AlmaSketchupMCP.material_snapshot(material)
    assert_equal true, snapshot['pbr']['ao_enabled']
    assert_equal @texture, snapshot['pbr']['textures']['normal']
  end

  def test_classic_disables_native_channels_and_rejects_conflicting_settings
    material = Sketchup::Material.new
    material.metalness_enabled = true
    AlmaSketchupMCP.apply_workflow_and_pbr(material, { 'name' => material.name, 'workflow' => 'classic' })
    assert_equal Sketchup::Material::WORKFLOW_CLASSIC, material.workflow
    assert_raises(RuntimeError) { AlmaSketchupMCP.apply_workflow_and_pbr(material, { 'name' => material.name, 'workflow' => 'classic', 'pbr' => { 'metallic_factor' => 0.7 } }) }
  end

  def test_ao_without_texture_fails_explicitly
    material = Sketchup::Material.new
    error = assert_raises(RuntimeError) { AlmaSketchupMCP.apply_pbr_settings(material, { 'ao_strength' => 0.6 }, material.name) }
    assert_match(/requires an AO texture/, error.message)
  end

  def test_environment_asset_identity_validation_and_readback
    created = AlmaSketchupMCP.environment_define(@model, { 'name' => 'Indoor', 'id' => 'indoor', 'path' => @hdr, 'rotation' => 90, 'linked_sun_position' => [0.1, -0.5] })
    assert_equal 90, created['rotation']
    assert_equal [0.1, -0.5, 0], created['linked_sun_position']
    assert_equal Digest::SHA256.file(@hdr).hexdigest, created['source_sha256']
    assert_raises(RuntimeError) { AlmaSketchupMCP.environment_define(@model, { 'name' => 'Other', 'id' => 'indoor', 'path' => @hdr }) }
    assert_raises(RuntimeError) { AlmaSketchupMCP.environment_define(@model, { 'name' => 'Bad', 'path' => @texture }) }
    assert_raises(RuntimeError) { AlmaSketchupMCP.environment_define(@model, { 'name' => 'Bad', 'path' => 'https://example.com/a.hdr' }) }
    assert_raises(RuntimeError) { AlmaSketchupMCP.environment_define(@model, { 'name' => 'Bad', 'path' => 'https:remote.hdr' }) }
    AlmaSketchupMCP.environment_update(@model, { 'environment_ref' => 'Indoor', 'skydome_exposure' => 4 })
    assert_equal 4, @model.environments.first.skydome_exposure
    assert_raises(RuntimeError) { AlmaSketchupMCP.environment_update(@model, { 'environment_ref' => 'Indoor', 'path' => @hdr }) }
  end

  def test_version_boundaries_for_clearing_environment
    AlmaSketchupMCP.environment_define(@model, { 'name' => 'Indoor', 'path' => @hdr })
    AlmaSketchupMCP.environment_activate(@model, { 'environment_ref' => 'Indoor' })
    Sketchup.test_version = '25.0.570'
    assert_raises(RuntimeError) { AlmaSketchupMCP.environment_activate(@model, { 'environment_ref' => nil }) }
    refute_nil @model.environments.current
    Sketchup.test_version = '25.0.633'
    assert_nil AlmaSketchupMCP.environment_activate(@model, { 'environment_ref' => nil })
    assert_nil @model.environments.current
  end

  def test_native_scene_binding_and_signature_detect_external_environment_edits
    AlmaSketchupMCP.environment_define(@model, { 'name' => 'Indoor', 'path' => @hdr })
    AlmaSketchupMCP.style_load(@model, { 'name' => 'Verified', 'path' => @style_path })
    page = AppearancePage.new
    @model.pages << page
    AlmaSketchupMCP.apply_scene_native_appearance(@model, page, { 'environment_ref' => 'Indoor', 'style_ref' => 'Verified' })
    before = AlmaSketchupMCP.native_appearance_snapshot(@model)
    assert_equal 'Indoor', before['scenes'][0]['environment_ref']
    assert_equal 'Verified', before['scenes'][0]['style_native']['name']
    @model.environments.first.rotation = 180
    after = AlmaSketchupMCP.native_appearance_snapshot(@model)
    refute_equal before['signature'], after['signature']
    assert_equal 180, after['environments'][0]['rotation']
    assert_equal after['signature'], AlmaSketchupMCP.native_appearance_snapshot(@model)['signature']
  end

  def test_style_import_accepts_boolean_2025_return
    Sketchup.test_version = '25.0.633'
    result = AlmaSketchupMCP.style_load(@model, { 'name' => 'Legacy', 'path' => @style_path, 'activate' => false })
    assert_equal 'Legacy', result['name']
    assert_nil @model.styles.selected_style
    AlmaSketchupMCP.style_activate(@model, { 'style_ref' => 'Legacy' })
    assert_equal 'Legacy', @model.styles.selected_style.name
  end

  def test_style_import_cannot_rename_a_reused_native_style
    existing = AppearanceStyle.new('Existing user style', @style_path, 'existing-style')
    @model.styles << existing
    @model.styles.selected_style = existing
    @model.styles.define_singleton_method(:add_style) { |_path, _activate| existing }
    assert_raises(RuntimeError) { AlmaSketchupMCP.style_load(@model, { 'name' => 'New requested name', 'path' => @style_path }) }
    assert_equal 'Existing user style', existing.name
    assert_equal existing, @model.styles.selected_style
    assert_equal 1, @model.styles.length
  end

  def test_style_capture_commits_native_display_without_changing_existing_style
    options = @model.rendering_options
    options['RenderMode'] = 6
    @model.styles.define_singleton_method(:selected_style=) do |style|
      @selected_style = style
      options['RenderMode'] = 3
    end
    @model.styles.define_singleton_method(:update_selected_style) { @committed_display = options.dup; nil }
    @model.styles.define_singleton_method(:committed_display) { @committed_display }
    result = AlmaSketchupMCP.style_load(@model, { 'name' => 'Captured', 'path' => @style_path, 'capture_current_display' => true })
    assert_equal 'Captured', result['name']
    assert_equal 6, options['RenderMode']
    assert_equal 6, @model.styles.committed_display['RenderMode']
    assert_raises(RuntimeError) { AlmaSketchupMCP.style_load(@model, { 'name' => 'Rejected', 'path' => @style_path, 'capture_current_display' => true, 'activate' => false }) }
    assert_equal 1, @model.styles.length
  end

  def test_style_capture_rejects_missing_commit_support_before_import
    assert_raises(RuntimeError) { AlmaSketchupMCP.style_load(@model, { 'name' => 'Unsupported', 'path' => @style_path, 'capture_current_display' => true }) }
    assert_empty @model.styles
  end

  def test_skm_import_preserves_native_appearance_and_never_renames_an_existing_return
    @model.materials = AppearanceMaterials.new
    AlmaSketchupMCP.stub(:active_model_or_new, @model) do
      imported = AlmaSketchupMCP.ensure_material({ 'name' => 'Imported', 'skm_path' => @skm_path })
      assert_equal 'Imported', imported.name
      assert_equal Sketchup::Material::WORKFLOW_PBR_METALLIC_ROUGHNESS, imported.workflow
      assert_equal '#968c82', AlmaSketchupMCP.material_snapshot(imported)['color']
      assert_equal @skm_path, AlmaSketchupMCP.material_snapshot(imported)['native_asset_source']['skm_path']
      assert_raises(RuntimeError) { AlmaSketchupMCP.ensure_material({ 'name' => 'Imported', 'skm_path' => @skm_path }) }
      @model.materials.load_existing = imported
      error = assert_raises(RuntimeError) { AlmaSketchupMCP.ensure_material({ 'name' => 'Alias', 'skm_path' => @skm_path }) }
      assert_match(/returned_existing/, error.message)
      assert_equal 'Imported', imported.name
      assert_nil @model.materials['Alias']
    end
  end

  def test_capabilities_probe_actual_methods_and_version_floor_without_mutation
    @model.materials << Sketchup::Material.new
    capability = AlmaSketchupMCP.native_appearance_capabilities(@model)
    assert_equal true, capability['workflow_getter']
    assert_equal true, capability['pbr_channels']['normal']['write']
    assert_equal true, capability['pbr_channels']['ao']['write']
    assert_equal true, capability['environments']['clear_current']
    assert_equal Sketchup::Material::NORMAL_STYLE_OPENGL, capability['normal_style_constants']['opengl']
    assert_equal Sketchup::Material::NORMAL_STYLE_DIRECTX, capability['normal_style_constants']['directx']
    Sketchup.test_version = '25.0.570'
    assert_equal false, AlmaSketchupMCP.native_appearance_capabilities(@model)['environments']['clear_current']
    assert_empty @model.environments
  end

  def test_revision_includes_native_appearance_changes
    graph = { 'root_digest' => 'fixture', 'logical_occurrences' => 0, 'unique_entities' => 0, 'reachable_definitions' => 0, 'complete' => true, 'blockers' => [] }
    AlmaSketchupMCP.stub(:model_revision_merkle_graph, graph) do
      before = AlmaSketchupMCP.session_model_revision(@model, { 'native_appearance' => { 'current_environment' => 'Day' } })
      after = AlmaSketchupMCP.session_model_revision(@model, { 'native_appearance' => { 'current_environment' => 'Evening' } })
      refute_equal before, after
    end
  end

  def test_rendering_options_snapshot_keeps_all_actual_keys_and_changes_signature
    @model.rendering_options['FuturePhotorealOption'] = true
    @model.rendering_options['NativeColor'] = Struct.new(:red, :green, :blue, :alpha).new(1, 2, 3, 128)
    before = AlmaSketchupMCP.native_appearance_snapshot(@model)
    assert_equal true, before['rendering_options']['FuturePhotorealOption']
    assert_equal [1, 2, 3, 128], before['rendering_options']['NativeColor']
    @model.rendering_options['FuturePhotorealOption'] = false
    refute_equal before['signature'], AlmaSketchupMCP.native_appearance_snapshot(@model)['signature']
  end
end
