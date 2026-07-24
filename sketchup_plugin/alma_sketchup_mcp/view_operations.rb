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
    set_document_state_value('view_state', { 'camera' => { 'eye' => operation['eye'], 'target' => operation['target'], 'up' => operation['up'] || [0, 0, 1], 'fov' => operation['fov'] || 35 } }, model)
  end

  def add_scene(model, operation)
    name = operation.fetch('name')
    if operation['camera']
      set_camera(model, operation['camera'])
      view_state = document_state_value('view_state', model)
      view_state['scene'] = name if view_state
    end
    page = model.pages.add(name)
    use_camera = operation.key?('use_camera') ? boolean_value(operation['use_camera'], 'scene.use_camera') : operation.key?('useCamera') ? boolean_value(operation['useCamera'], 'scene.useCamera') : true
    page.use_camera = use_camera if page.respond_to?(:use_camera=)
    page.camera = model.active_view.camera if use_camera && page.respond_to?(:camera=)
    if operation.key?('transition_time') || operation.key?('transitionTime')
      page.transition_time = finite_number(operation['transition_time'] || operation['transitionTime'], 'scene.transition_time') if page.respond_to?(:transition_time=)
    end
    apply_scene_layer_visibility(model, page, operation['layer_visibility'] || operation['layerVisibility'])
    apply_scene_drawingelement_visibility(model, page, operation['drawingelement_visibility'] || operation['drawingElementVisibility'])
    scene_rendering_options = operation['rendering_options'] || operation['renderingOptions']
    scene_shadow = operation['shadow'] || operation['shadow_info'] || operation['shadowInfo']
    scene_style = operation['style']
    apply_page_rendering_options(page, scene_rendering_options) if scene_rendering_options.is_a?(Hash)
    apply_page_shadow_info(page, scene_shadow) if scene_shadow.is_a?(Hash)
    scenes = document_state_array('scenes', model)
    view_state = document_state_value('view_state', model)
    scene = { 'name' => name }
    scene['camera'] = view_state['camera'] if view_state && view_state['camera']
    scene['transition_time'] = operation['transition_time'] || operation['transitionTime'] if operation.key?('transition_time') || operation.key?('transitionTime')
    scene['use_camera'] = use_camera
    scene['layer_visibility'] = normalize_scene_layer_visibility(operation['layer_visibility'] || operation['layerVisibility']) if operation['layer_visibility'] || operation['layerVisibility']
    scene['drawingelement_visibility'] = normalize_scene_drawingelement_visibility(operation['drawingelement_visibility'] || operation['drawingElementVisibility']) if operation['drawingelement_visibility'] || operation['drawingElementVisibility']
    scene['rendering_options'] = normalize_scene_nested_operation(scene_rendering_options) if scene_rendering_options.is_a?(Hash)
    scene['shadow'] = normalize_scene_nested_operation(scene_shadow) if scene_shadow.is_a?(Hash)
    scene['style'] = normalize_scene_nested_operation(scene_style) if scene_style.is_a?(Hash)
    scene['update_flags'] = operation['update_flags'] || operation['updateFlags'] if operation.key?('update_flags') || operation.key?('updateFlags')
    scenes.reject! { |entry| entry.is_a?(Hash) && entry['name'].to_s == name.to_s }
    scenes << scene
    update_flags = operation['update_flags'] || operation['updateFlags']
    page.update(update_flags.to_i) if update_flags && page.respond_to?(:update)
    page
  end

  def apply_scene_layer_visibility(model, page, entries)
    normalize_scene_layer_visibility(entries).each do |entry|
      layer = model.layers[entry['layer']] || model.layers.add(entry['layer'])
      page.set_visibility(layer, entry['visible']) if page.respond_to?(:set_visibility)
    rescue StandardError => error
      add_warning('rendering.apply_failed', 'warn', "Scene layer visibility could not be applied: #{error.message}", 'scene.layer_visibility')
    end
  end

  def apply_scene_drawingelement_visibility(model, page, entries)
    normalize_scene_drawingelement_visibility(entries).each do |entry|
      next unless page.respond_to?(:set_drawingelement_visibility)

      entity = find_referenced_entity(model, entry, 'scene.drawingelement_visibility')
      page.set_drawingelement_visibility(entity, entry['visible'])
    rescue StandardError => error
      add_warning('rendering.apply_failed', 'warn', "Scene drawingelement visibility could not be applied: #{error.message}", 'scene.drawingelement_visibility')
    end
  end

  def normalize_scene_layer_visibility(entries)
    return [] unless entries
    raise 'scene.layer_visibility must be an array' unless entries.is_a?(Array)

    entries.map.with_index do |entry, index|
      raise "scene.layer_visibility[#{index}] must be an object" unless entry.is_a?(Hash)

      {
        'layer' => non_empty_string(entry['layer'] || entry['tag'] || entry['name'], "scene.layer_visibility[#{index}].layer"),
        'visible' => boolean_value(entry['visible'], "scene.layer_visibility[#{index}].visible")
      }
    end
  end

  def normalize_scene_drawingelement_visibility(entries)
    return [] unless entries
    raise 'scene.drawingelement_visibility must be an array' unless entries.is_a?(Array)

    entries.map.with_index do |entry, index|
      raise "scene.drawingelement_visibility[#{index}] must be an object" unless entry.is_a?(Hash)

      normalized = {
        'target_id' => entry['target_id'] || entry['targetId'] || entry['id'] || entry['object_id'] || entry['objectId'] || entry['guid'],
        'name' => entry['name'] || entry['target'] || entry['object'],
        'visible' => boolean_value(entry['visible'], "scene.drawingelement_visibility[#{index}].visible")
      }.compact
      raise "scene.drawingelement_visibility[#{index}] requires target_id or name" unless normalized['target_id'] || normalized['name']

      normalized
    end
  end

  def normalize_scene_nested_operation(operation)
    operation.reject { |key, _value| key == 'op' }
  end

  def apply_page_rendering_options(page, operation)
    return unless page.respond_to?(:rendering_options)

    options = page.rendering_options
    rendering_option_map.each do |field, config|
      next unless operation.key?(field) || operation.key?(config[:alias])

      value = operation.key?(field) ? operation[field] : operation[config[:alias]]
      normalized = normalize_rendering_value(value, config[:type], "scene.rendering_options.#{field}", config[:range])
      safe_set_rendering_option(options, config[:key], rendering_option_value(normalized, config[:type]))
    end
  end

  def apply_page_shadow_info(page, operation)
    return unless page.respond_to?(:shadow_info)

    shadow_info = page.shadow_info
    set_shadow_info_from_scene(shadow_info, operation)
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
    set_document_state_value('style_state', state, model)
    state
  end

  def set_shadow(model, operation)
    state = {}
    shadow_info = model.shadow_info
    set_shadow_info_from_scene(shadow_info, operation, state)
    set_document_state_value('shadow_state', state, model)
    state
  rescue ArgumentError => error
    raise "shadow.time must be an ISO-8601 date/time string: #{error.message}"
  end

  def set_shadow_info_from_scene(shadow_info, operation, state = nil)
    if operation.key?('display')
      value = boolean_value(operation['display'], 'shadow.display')
      state['display'] = value if state
      safe_set_shadow_info(shadow_info, 'DisplayShadows', value)
    end
    if operation.key?('time')
      value = Time.parse(non_empty_string(operation['time'], 'shadow.time'))
      state['time'] = value.iso8601 if state
      safe_set_shadow_info(shadow_info, 'ShadowTime', value)
    end
    if operation.key?('light')
      value = number_in_range(operation['light'], 0.0, 100.0, 'shadow.light')
      state['light'] = value if state
      safe_set_shadow_info(shadow_info, 'Light', value)
    end
    if operation.key?('dark')
      value = number_in_range(operation['dark'], 0.0, 100.0, 'shadow.dark')
      state['dark'] = value if state
      safe_set_shadow_info(shadow_info, 'Dark', value)
    end
    if operation.key?('use_sun_for_shading') || operation.key?('useSunForShading')
      value = operation.key?('use_sun_for_shading') ? operation['use_sun_for_shading'] : operation['useSunForShading']
      normalized = boolean_value(value, 'shadow.use_sun_for_shading')
      state['use_sun_for_shading'] = normalized if state
      safe_set_shadow_info(shadow_info, 'UseSunForAllShading', normalized)
    end
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
    set_document_state_value('rendering_options_state', state, model)
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
