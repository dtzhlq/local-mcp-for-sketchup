# frozen_string_literal: true

require 'digest'
require 'json'

module AlmaSketchupMCP
  extend self

  ENVIRONMENT_NUMBER_FIELDS = { 'rotation' => [0, 360], 'skydome_exposure' => [0, 20], 'reflection_exposure' => [0, 10] }.freeze
  ENVIRONMENT_BOOLEAN_FIELDS = %w[use_as_skydome use_for_reflections linked_sun].freeze

  def environment_define(model, operation)
    collection = native_environment_collection!(model)
    name = non_empty_string(operation['name'], 'environment_define.name')
    id = non_empty_string(operation['id'] || name, 'environment_define.id')
    path = native_appearance_asset_path(operation['path'], %w[.hdr .exr .ske], 'environment_define.path')
    settings = normalize_environment_settings(operation)
    raise 'environment_define identity already exists' if collection.any? { |entry| entry.name == name || native_environment_id(entry) == id }

    environment = collection.add(name, path)
    raise 'environment_define native load returned no environment' unless environment

    environment.set_attribute('AlmaEnvironment', 'id', id)
    environment.set_attribute('AlmaEnvironment', 'source_sha256', Digest::SHA256.file(path).hexdigest)
    apply_environment_settings(environment, settings)
    native_environment_snapshot(environment)
  end

  def environment_update(model, operation)
    raise 'environment_update cannot replace an asset; define a new environment' if operation.key?('path')

    environment = resolve_native_environment(model, operation['environment_ref'])
    apply_environment_settings(environment, normalize_environment_settings(operation))
    native_environment_snapshot(environment)
  end

  def environment_activate(model, operation)
    raise 'environment_activate requires environment_ref (null disables the environment)' unless operation.key?('environment_ref')

    collection = native_environment_collection!(model)
    reference = operation['environment_ref']
    if reference.nil? && !native_environment_clear_supported?
      raise 'environment_clear_unsupported: disabling an environment requires SketchUp 2025.0.2 or newer'
    end
    environment = reference.nil? ? nil : resolve_native_environment(model, reference)
    collection.current = environment
    actual = collection.current
    raise 'environment_activate native readback mismatch' unless actual == environment

    actual ? native_environment_snapshot(actual) : nil
  end

  def native_environment_collection!(model)
    raise 'environment_unsupported: SketchUp 2025 or newer is required' unless model.respond_to?(:environments)

    model.environments
  end

  def native_environment_clear_supported?
    major, minor, build = Sketchup.version.to_s.split('.').map(&:to_i)
    minimum_build = Sketchup.respond_to?(:platform) && Sketchup.platform == :platform_win ? 634 : 633
    major > 25 || (major == 25 && (minor.to_i.positive? || build.to_i >= minimum_build))
  end

  def native_appearance_capabilities(model)
    environment = model.respond_to?(:environments) ? model.environments.first : nil
    environment_class = defined?(Sketchup::Environment) ? Sketchup::Environment : nil
    page = model.respond_to?(:pages) ? model.pages.first : nil
    page_class = defined?(Sketchup::Page) ? Sketchup::Page : nil
    material = model.respond_to?(:materials) ? model.materials.first : nil
    supports = lambda do |object, klass, method|
      object ? object.respond_to?(method) : !!(klass && klass.method_defined?(method))
    end
    material_class = defined?(Sketchup::Material) ? Sketchup::Material : nil
    {
      'evidence' => 'native_api_probe', 'sketchup_version' => Sketchup.version.to_s,
      'normal_style_constants' => {
        'opengl' => defined?(Sketchup::Material::NORMAL_STYLE_OPENGL) ? Sketchup::Material::NORMAL_STYLE_OPENGL : nil,
        'directx' => defined?(Sketchup::Material::NORMAL_STYLE_DIRECTX) ? Sketchup::Material::NORMAL_STYLE_DIRECTX : nil
      },
      'recommended_minimum' => '2025.0.2', 'workflow_getter' => supports.call(material, material_class, :workflow),
      'pbr_channels' => %w[metalness roughness normal ao].each_with_object({}) do |channel, result|
        result[channel] = { 'read' => supports.call(material, material_class, "#{channel}_enabled?"),
                            'write' => supports.call(material, material_class, "#{channel}_enabled=") }
      end,
      'environments' => {
        'supported' => model.respond_to?(:environments),
        'clear_current' => model.respond_to?(:environments) && model.environments.respond_to?(:current=) && native_environment_clear_supported?,
        'settings' => (ENVIRONMENT_NUMBER_FIELDS.keys + ENVIRONMENT_BOOLEAN_FIELDS + %w[description linked_sun_position]).each_with_object({}) do |field, result|
          result[field] = supports.call(environment, environment_class, "#{field}=")
        end
      },
      'scene_environment' => supports.call(page, page_class, :environment=) && supports.call(page, page_class, :use_environment=),
      'scene_style' => supports.call(page, page_class, :use_style=),
      'style_load' => model.respond_to?(:styles) && model.styles.respond_to?(:add_style),
      'style_capture_current_display' => model.respond_to?(:styles) && model.styles.respond_to?(:update_selected_style),
      'camera_capture_restore' => model.respond_to?(:active_view) && model.active_view.respond_to?(:camera=),
      'graphics_engine' => model.respond_to?(:active_view) && model.active_view.respond_to?(:graphics_engine) ? model.active_view.graphics_engine.to_s : nil,
      'photoreal_render_mode' => 'requires_verified_native_style; no undocumented rendering option is assigned'
    }
  end

  def native_appearance_asset_path(value, extensions, field)
    path = non_empty_string(value, field).strip
    windows_drive = path.match?(/\A[a-z]:[\\\/]/i)
    raise "#{field} must be a local asset path" if (!windows_drive && path.match?(/\A[a-z][a-z0-9+.-]*:/i)) || path.match?(/[\0\r\n]/)
    raise "#{field} must use #{extensions.join(', ')}" unless extensions.include?(File.extname(path).downcase)

    expanded = File.expand_path(path)
    raise "#{field} asset not found: #{expanded}" unless File.file?(expanded)

    expanded
  end

  def normalize_environment_settings(operation)
    settings = {}
    ENVIRONMENT_NUMBER_FIELDS.each do |field, range|
      settings[field] = number_in_range(operation[field], range[0], range[1], "environment.#{field}") if operation.key?(field)
    end
    ENVIRONMENT_BOOLEAN_FIELDS.each do |field|
      settings[field] = boolean_value(operation[field], "environment.#{field}") if operation.key?(field)
    end
    if operation.key?('description')
      raise 'environment.description must be a string' unless operation['description'].is_a?(String)
      settings['description'] = operation['description']
    end
    if operation.key?('linked_sun_position')
      value = operation['linked_sun_position']
      raise 'environment.linked_sun_position must be [u, v] or [u, v, 0]' unless value.is_a?(Array) && [2, 3].include?(value.length)
      raise 'environment.linked_sun_position[2] must be 0' if value.length == 3 && value[2] != 0
      settings['linked_sun_position'] = [number_in_range(value[0], 0, 1, 'environment.linked_sun_position[0]'), number_in_range(value[1], -1, 1, 'environment.linked_sun_position[1]'), 0]
    end
    settings
  end

  def apply_environment_settings(environment, settings)
    settings.each_key do |field|
      raise "environment_setting_unsupported: #{field}" unless environment.respond_to?("#{field}=")
    end
    settings.each do |field, value|
      native_value = field == 'linked_sun_position' ? Geom::Point3d.new(*value) : value
      environment.public_send("#{field}=", native_value)
    end
    actual = native_environment_snapshot(environment)
    settings.each do |field, expected|
      raise "environment_setting_readback_mismatch: #{field}" unless appearance_values_equal?(actual[field], expected)
    end
    actual
  end

  def appearance_values_equal?(actual, expected)
    return (actual.to_f - expected.to_f).abs <= 1e-6 if actual.is_a?(Numeric) && expected.is_a?(Numeric)
    return actual.length == expected.length && actual.zip(expected).all? { |a, e| appearance_values_equal?(a, e) } if actual.is_a?(Array) && expected.is_a?(Array)
    return actual.keys.sort == expected.keys.sort && actual.all? { |key, value| appearance_values_equal?(value, expected[key]) } if actual.is_a?(Hash) && expected.is_a?(Hash)

    actual == expected
  end

  def native_environment_id(environment)
    environment.get_attribute('AlmaEnvironment', 'id') || environment.name.to_s
  end

  def resolve_native_environment(model, reference)
    reference = non_empty_string(reference, 'environment_ref')
    matches = native_environment_collection!(model).select { |entry| native_environment_id(entry) == reference || entry.name == reference }
    raise "environment_ref must resolve uniquely: #{reference}" unless matches.length == 1

    matches.first
  end

  def native_environment_snapshot(environment)
    result = { 'id' => native_environment_id(environment), 'name' => environment.name.to_s, 'evidence' => 'native_api' }
    result['persistent_id'] = environment.persistent_id.to_s if environment.respond_to?(:persistent_id)
    %w[path description rotation skydome_exposure reflection_exposure].each do |field|
      result[field] = environment.public_send(field) if environment.respond_to?(field)
    end
    ENVIRONMENT_BOOLEAN_FIELDS.each do |field|
      result[field] = environment.public_send("#{field}?") if environment.respond_to?("#{field}?")
    end
    if environment.respond_to?(:linked_sun_position)
      point = environment.linked_sun_position
      result['linked_sun_position'] = [point.x.to_f, point.y.to_f, point.z.to_f]
    end
    source_hash = environment.get_attribute('AlmaEnvironment', 'source_sha256')
    result['source_sha256'] = source_hash if source_hash
    result
  end

  def style_load(model, operation)
    name = non_empty_string(operation['name'], 'style_load.name')
    path = native_appearance_asset_path(operation['path'], %w[.style], 'style_load.path')
    activate = operation.key?('activate') ? boolean_value(operation['activate'], 'style_load.activate') : true
    capture = operation.key?('capture_current_display') ? boolean_value(operation['capture_current_display'], 'style_load.capture_current_display') : false
    raise 'style_load capture_current_display requires activate' if capture && !activate
    raise 'style_load cannot commit current display on this runtime' if capture && !model.styles.respond_to?(:update_selected_style)
    raise "style_load identity already exists: #{name}" if model.styles.any? { |style| style.name == name }
    # Preserve native values, including runtime-specific render modes, without
    # inventing enum values. The donor still supplies non-rendering style data.
    display = model.rendering_options.to_a.to_h if capture

    before = model.styles.to_a
    loaded = model.styles.add_style(path, false)
    raise 'style_load native load failed' unless loaded
    # 2025 returns Boolean, 2026 returns Style. Resolve the newly added object
    # instead of assuming that a truthy result is itself a Style.
    added = model.styles.to_a.reject { |style| before.include?(style) }
    style = loaded.respond_to?(:name) ? loaded : added.length == 1 ? added.first : nil
    raise 'style_load could not identify the imported native style' unless style
    raise 'style_load refused to rename an existing native style' unless added.include?(style)

    style.name = name
    model.styles.selected_style = style if activate
    if capture
      display.each { |key, value| model.rendering_options[key] = value unless model.rendering_options[key] == value }
      model.styles.update_selected_style
      raise 'style_load current display commit failed' if model.styles.active_style_changed
      raise 'style_load current display readback mismatch' unless native_rendering_options_snapshot(model.rendering_options) == native_rendering_options_snapshot(display)
    end
    native_style_snapshot(style)
  end

  def resolve_native_style(model, reference)
    reference = non_empty_string(reference, 'style_ref')
    matches = model.styles.select { |style| style.name == reference }
    raise "style_ref must resolve uniquely: #{reference}" unless matches.length == 1

    matches.first
  end

  def style_activate(model, operation)
    style = resolve_native_style(model, operation['style_ref'])
    model.styles.selected_style = style
    raise 'style_activate native readback mismatch' unless model.styles.selected_style == style

    native_style_snapshot(style)
  end

  def native_style_snapshot(style)
    return nil unless style

    result = { 'name' => style.name.to_s }
    result['guid'] = style.guid.to_s if style.respond_to?(:guid)
    result['path'] = style.path.to_s if style.respond_to?(:path)
    result
  end

  def apply_scene_native_appearance(model, page, operation)
    if operation.key?('environment_ref')
      raise 'scene_environment_unsupported' unless page.respond_to?(:environment=)
      raise 'scene.environment_ref must name an environment; use_environment=false disables scene restoration' if operation['environment_ref'].nil?

      page.environment = resolve_native_environment(model, operation['environment_ref'])
      page.use_environment = true
    end
    if operation.key?('use_environment')
      raise 'scene_environment_unsupported' unless page.respond_to?(:use_environment=)
      page.use_environment = boolean_value(operation['use_environment'], 'scene.use_environment')
    end
    page.use_style = resolve_native_style(model, operation['style_ref']) if operation.key?('style_ref')
    native_scene_appearance(page)
  end

  def native_scene_appearance(page)
    result = {}
    result['use_environment'] = page.use_environment? if page.respond_to?(:use_environment?)
    result['environment_ref'] = page.environment ? native_environment_id(page.environment) : nil if page.respond_to?(:environment)
    result['style_native'] = native_style_snapshot(page.style) if page.respond_to?(:style)
    result['use_style'] = page.use_style? if page.respond_to?(:use_style?)
    result['use_rendering_options'] = page.use_rendering_options? if page.respond_to?(:use_rendering_options?)
    result['rendering_options_native'] = native_rendering_options_snapshot(page.rendering_options) if page.respond_to?(:rendering_options)
    result
  end

  def native_rendering_options_snapshot(options)
    options.keys.sort_by(&:to_s).each_with_object({}) do |key, result|
      value = options[key]
      result[key.to_s] = native_appearance_serializable_value(value)
    end
  end

  def native_appearance_serializable_value(value)
    return [value.red, value.green, value.blue, value.respond_to?(:alpha) ? value.alpha : 255] if value.respond_to?(:red) && value.respond_to?(:green) && value.respond_to?(:blue)
    return value.map { |item| native_appearance_serializable_value(item) } if value.is_a?(Array)
    return value.keys.sort_by(&:to_s).each_with_object({}) { |key, result| result[key.to_s] = native_appearance_serializable_value(value[key]) } if value.is_a?(Hash)
    return value.getutc.iso8601(6) if value.is_a?(Time)
    return { 'unsupported_nonfinite_number' => value.to_s } if value.is_a?(Float) && !value.finite?
    return [value.x.to_f, value.y.to_f, value.z.to_f] if value.respond_to?(:x) && value.respond_to?(:y) && value.respond_to?(:z)
    return value if value.nil? || value == true || value == false || value.is_a?(String) || value.is_a?(Numeric)

    { 'unsupported_native_value_class' => value.class.name }
  end

  def native_appearance_snapshot(model)
    result = { 'version' => 'native-appearance.v1', 'evidence' => 'native_api', 'environments_supported' => model.respond_to?(:environments) }
    if model.respond_to?(:environments)
      result['environments'] = model.environments.map { |entry| native_environment_snapshot(entry) }.sort_by { |entry| entry['id'] }
      result['current_environment'] = model.environments.current ? native_environment_id(model.environments.current) : nil
      result['environment_clear_supported'] = native_environment_clear_supported?
    end
    if model.respond_to?(:styles)
      result['selected_style'] = native_style_snapshot(model.styles.selected_style)
      result['active_style_changed'] = model.styles.active_style_changed if model.styles.respond_to?(:active_style_changed)
    end
    result['rendering_options'] = native_rendering_options_snapshot(model.rendering_options) if model.respond_to?(:rendering_options)
    result['materials'] = model.materials.map { |material| material_snapshot(material) }.sort_by { |entry| entry['name'] } if model.respond_to?(:materials) && respond_to?(:material_snapshot)
    result['graphics_engine'] = model.active_view.graphics_engine.to_s if model.respond_to?(:active_view) && model.active_view.respond_to?(:graphics_engine)
    result['scenes'] = model.pages.map { |page| { 'name' => page.name.to_s }.merge(native_scene_appearance(page)) }.sort_by { |entry| entry['name'] } if model.respond_to?(:pages)
    result['signature'] = Digest::SHA256.hexdigest(JSON.generate(appearance_canonical_value(result)))
    result
  end

  def appearance_canonical_value(value)
    return value.keys.sort.each_with_object({}) { |key, result| result[key] = appearance_canonical_value(value[key]) } if value.is_a?(Hash)
    return value.map { |item| appearance_canonical_value(item) } if value.is_a?(Array)

    value
  end
end
