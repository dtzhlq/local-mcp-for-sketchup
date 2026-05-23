# frozen_string_literal: true

module AlmaSketchupMCP
  extend self

  def set_camera(model, operation)
    eye = vector(operation['eye'], 'camera.eye').map { |value| mm_to_model_units(value) }
    target = vector(operation['target'], 'camera.target').map { |value| mm_to_model_units(value) }
    up = vector(operation['up'] || [0, 0, 1], 'camera.up')
    camera = Sketchup::Camera.new(Geom::Point3d.new(*eye), Geom::Point3d.new(*target), Geom::Vector3d.new(*up), true)
    camera.fov = (operation['fov'] || 35).to_f
    model.active_view.camera = camera
    @view_state = { 'camera' => { 'eye' => operation['eye'], 'target' => operation['target'], 'up' => operation['up'] || [0, 0, 1], 'fov' => operation['fov'] || 35 } }
  end

  def add_scene(model, operation)
    name = operation.fetch('name')
    if operation['camera']
      set_camera(model, operation['camera'])
      @view_state['scene'] = name if @view_state
    end
    page = model.pages.add(name)
    page.use_camera = true if page.respond_to?(:use_camera=)
    page.camera = model.active_view.camera if page.respond_to?(:camera=)
    @scenes ||= []
    scene = { 'name' => name }
    scene['camera'] = @view_state['camera'] if @view_state && @view_state['camera']
    @scenes << scene
    page
  end

  def set_style(model, operation)
    state = {}
    state['name'] = non_empty_string(operation['name'], 'style.name') if operation.key?('name')
    state['display_edges'] = boolean_value(operation['display_edges'], 'style.display_edges') if operation.key?('display_edges')
    state['profiles'] = boolean_value(operation['profiles'], 'style.profiles') if operation.key?('profiles')
    state['display_watermarks'] = boolean_value(operation['display_watermarks'], 'style.display_watermarks') if operation.key?('display_watermarks')
    state['draw_ground'] = boolean_value(operation['draw_ground'], 'style.draw_ground') if operation.key?('draw_ground')
    state['draw_sky'] = boolean_value(operation['draw_sky'], 'style.draw_sky') if operation.key?('draw_sky')
    state['profile_width'] = positive_number(operation['profile_width'] || operation['profileWidth'], nil, 'style.profile_width') if operation.key?('profile_width') || operation.key?('profileWidth')
    state['face_style'] = material_keyword(operation['face_style'] || operation['faceStyle'], style_face_modes.keys.to_h { |key| [key, key] }, 'style.face_style') if operation.key?('face_style') || operation.key?('faceStyle')
    state['background_color'] = color_hex(operation['background_color'] || operation['backgroundColor'], 'style.background_color') if operation.key?('background_color') || operation.key?('backgroundColor')
    state['sky_color'] = color_hex(operation['sky_color'] || operation['skyColor'], 'style.sky_color') if operation.key?('sky_color') || operation.key?('skyColor')
    state['ground_color'] = color_hex(operation['ground_color'] || operation['groundColor'], 'style.ground_color') if operation.key?('ground_color') || operation.key?('groundColor')

    options = model.rendering_options
    safe_set_rendering_option(options, 'EdgeDisplayMode', state['display_edges'] ? 1 : 0) if state.key?('display_edges')
    safe_set_rendering_option(options, 'DrawSilhouettes', state['profiles']) if state.key?('profiles')
    safe_set_rendering_option(options, 'SilhouetteWidth', state['profile_width']) if state.key?('profile_width')
    safe_set_rendering_option(options, 'DisplayWatermarks', state['display_watermarks']) if state.key?('display_watermarks')
    safe_set_rendering_option(options, 'RenderMode', style_face_modes[state['face_style']]) if state.key?('face_style')
    safe_set_rendering_option(options, 'BackgroundColor', sketchup_color(state['background_color'])) if state.key?('background_color')
    safe_set_rendering_option(options, 'SkyColor', sketchup_color(state['sky_color'])) if state.key?('sky_color')
    safe_set_rendering_option(options, 'GroundColor', sketchup_color(state['ground_color'])) if state.key?('ground_color')
    safe_set_rendering_option(options, 'DrawGround', state['draw_ground']) if state.key?('draw_ground')
    safe_set_rendering_option(options, 'DrawHorizon', state['draw_sky']) if state.key?('draw_sky')
    @style_state = state
    state
  end

  def set_shadow(model, operation)
    state = {}
    shadow_info = model.shadow_info
    if operation.key?('display')
      state['display'] = boolean_value(operation['display'], 'shadow.display')
      safe_set_shadow_info(shadow_info, 'DisplayShadows', state['display'])
    end
    if operation.key?('time')
      state['time'] = Time.parse(non_empty_string(operation['time'], 'shadow.time')).iso8601
      safe_set_shadow_info(shadow_info, 'ShadowTime', Time.parse(state['time']))
    end
    if operation.key?('light')
      state['light'] = number_in_range(operation['light'], 0.0, 100.0, 'shadow.light')
      safe_set_shadow_info(shadow_info, 'Light', state['light'])
    end
    if operation.key?('dark')
      state['dark'] = number_in_range(operation['dark'], 0.0, 100.0, 'shadow.dark')
      safe_set_shadow_info(shadow_info, 'Dark', state['dark'])
    end
    if operation.key?('use_sun_for_shading') || operation.key?('useSunForShading')
      value = operation.key?('use_sun_for_shading') ? operation['use_sun_for_shading'] : operation['useSunForShading']
      state['use_sun_for_shading'] = boolean_value(value, 'shadow.use_sun_for_shading')
      safe_set_shadow_info(shadow_info, 'UseSunForAllShading', state['use_sun_for_shading'])
    end
    @shadow_state = state
    state
  rescue ArgumentError => error
    raise "shadow.time must be an ISO-8601 date/time string: #{error.message}"
  end

  def set_rendering_options(model, operation)
    state = {}
    options = model.rendering_options
    rendering_option_map.each do |field, config|
      next unless operation.key?(field) || operation.key?(config[:alias])

      value = operation.key?(field) ? operation[field] : operation[config[:alias]]

      normalized = normalize_rendering_value(value, config[:type], "rendering_options.#{field}", config[:range])
      state[field] = normalized
      if field == 'transparency'
        safe_set_rendering_option(options, 'MaterialTransparency', normalized)
        safe_set_rendering_option(options, 'ModelTransparency', normalized)
      else
        safe_set_rendering_option(options, config[:key], rendering_option_value(normalized, config[:type]))
      end
    end
    @rendering_options_state = state
    state
  end

  def style_face_modes
    {
      'wireframe' => 0,
      'hidden_line' => 1,
      'shaded' => 2,
      'shaded_with_textures' => 3,
      'monochrome' => 4
    }
  end

  def rendering_option_map
    {
      'edge_display_mode' => { key: 'EdgeDisplayMode', type: :number, range: [0.0, 10.0], alias: 'edgeDisplayMode' },
      'draw_hidden_geometry' => { key: 'DrawHiddenGeometry', type: :boolean, alias: 'drawHiddenGeometry' },
      'display_color_by_layer' => { key: 'DisplayColorByLayer', type: :boolean, alias: 'displayColorByLayer' },
      'transparency' => { key: 'Transparency', type: :boolean, alias: 'transparency' },
      'draw_back_edges' => { key: 'DrawBackEdges', type: :boolean, alias: 'drawBackEdges' },
      'draw_hidden' => { key: 'DrawHidden', type: :boolean, alias: 'drawHidden' },
      'draw_ground' => { key: 'DrawGround', type: :boolean, alias: 'drawGround' },
      'draw_horizon' => { key: 'DrawHorizon', type: :boolean, alias: 'drawHorizon' },
      'render_mode' => { key: 'RenderMode', type: :number, range: [0.0, 10.0], alias: 'renderMode' },
      'face_color_mode' => { key: 'FaceColorMode', type: :number, range: [0.0, 10.0], alias: 'faceColorMode' },
      'model_transparency' => { key: 'ModelTransparency', type: :number, range: [0.0, 3.0], alias: 'modelTransparency' },
      'material_transparency' => { key: 'MaterialTransparency', type: :number, range: [0.0, 3.0], alias: 'materialTransparency' },
      'background_color' => { key: 'BackgroundColor', type: :color, alias: 'backgroundColor' },
      'sky_color' => { key: 'SkyColor', type: :color, alias: 'skyColor' },
      'ground_color' => { key: 'GroundColor', type: :color, alias: 'groundColor' }
    }
  end

  def normalize_rendering_value(value, type, field_name, range = nil)
    case type
    when :boolean
      boolean_value(value, field_name)
    when :number
      number_in_range(value, range[0], range[1], field_name)
    when :color
      color_hex(value, field_name)
    end
  end

  def rendering_option_value(value, type)
    type == :color ? sketchup_color(value) : value
  end

  def safe_set_shadow_info(shadow_info, key, value)
    shadow_info[key] = value
  rescue StandardError => error
    add_warning('rendering.apply_failed', 'warn', "Shadow option #{key} could not be applied: #{error.message}", key.to_s)
  end

  def safe_set_rendering_option(options, key, value)
    if options.respond_to?(:keys) && !options.keys.include?(key)
      add_warning('rendering.unsupported_option', 'info', "Rendering option #{key} is not available in this SketchUp version.", key.to_s)
      return
    end
    options[key] = value
  rescue StandardError => error
    add_warning('rendering.apply_failed', 'warn', "Rendering option #{key} could not be applied: #{error.message}", key.to_s)
  end
end
