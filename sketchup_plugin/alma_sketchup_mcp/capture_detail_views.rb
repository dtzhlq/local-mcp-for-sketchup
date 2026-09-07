# frozen_string_literal: true

module AlmaSketchupMCP
  extend self

  # Without scene_ref this remains camera-only. Scene inspection is an explicit
  # controlled mutation and rejects unsaved style edits before switching.
  def capture_detail_views(params)
    model = active_model_required('capture_detail_views')
    requested = params['views']
    raise 'capture_detail_views.views must contain 1 to 24 views' unless requested.is_a?(Array) && (1..24).cover?(requested.length)
    directory = non_empty_string(params['output_dir'], 'capture_detail_views.output_dir').strip
    raise 'capture_detail_views.output_dir must be a local directory' if directory.match?(/\A[a-z][a-z0-9+.-]*:/i) && !directory.match?(/\A[a-z]:[\\\/]/i)
    raise 'capture_detail_views.output_dir contains invalid characters' if directory.match?(/[\0\r\n]/)
    directory = File.expand_path(directory)
    plans = requested.map { |spec| detail_capture_plan(model, spec, directory) }
    raise 'capture_detail_views view IDs must be unique' unless plans.map { |plan| plan[:id] }.uniq.length == plans.length
    scene_state = plans.any? { |plan| plan[:page] } ? detail_scene_restore_plan(model) : nil

    view = model.active_view
    camera_before = detail_camera_snapshot(view.camera)
    original_camera = detached_detail_camera(view.camera)
    state_before = detail_capture_state(model)
    revision_before = session_model_revision_report(model)
    modified_before = model.respond_to?(:modified?) ? model.modified? : nil
    captures = []
    FileUtils.mkdir_p(directory)
    begin
      model.options['PageOptions']['ShowTransition'] = false if scene_state
      plans.each do |plan|
        if plan[:page]
          model.pages.selected_page = plan[:page]
          raise "detail_scene_activation_failed: #{plan[:page].name}" unless model.pages.selected_page == plan[:page]
        end
        view.camera = plan[:camera]
        view.refresh
        camera_at_capture = detail_camera_snapshot(view.camera)
        revision_at_capture = scene_state ? session_model_revision_report(model) : revision_before
        ok = view.write_image(filename: plan[:path], width: plan[:width], height: plan[:height], antialias: true, compression: 1.0, transparent: false)
        raise "detail_capture_failed: #{plan[:id]}" unless ok && File.file?(plan[:path])
        actual_size = detail_capture_png_size(plan[:path])
        raise "detail_capture_size_mismatch: #{plan[:id]}" unless actual_size == [plan[:width], plan[:height]]
        raise "detail_capture_camera_changed_during_capture: #{plan[:id]}" unless appearance_values_equal?(camera_at_capture, detail_camera_snapshot(view.camera))

        captures << {
          'id' => plan[:id], 'file_path' => plan[:path], 'width' => actual_size[0], 'height' => actual_size[1],
          'sha256' => Digest::SHA256.file(plan[:path]).hexdigest, 'camera' => camera_at_capture,
          'instance_path' => plan[:instance_path], 'bounds_mm' => plan[:bounds_mm],
          'native_appearance_signature' => native_appearance_snapshot(model)['signature'],
          'model_revision' => revision_at_capture['model_revision'], 'model_revision_complete' => revision_at_capture['complete'],
          'scene_ref' => plan[:page] ? plan[:page].name.to_s : nil,
          'native_appearance' => scene_state ? native_appearance_snapshot(model) : nil,
          'evidence' => 'native_view_write_image', 'captured_at' => Time.now.utc.iso8601,
          'capture_method' => 'standard_export', 'camera_stable_during_export' => true
        }
      end
    ensure
      # View#camera returns a live handle in SketchUp. Restore an independently
      # constructed camera; retaining the original handle loses its old pose.
      begin
        restore_detail_scene_state(model, scene_state) if scene_state
      ensure
        view.camera = original_camera
        view.refresh
      end
    end
    camera_after = detail_camera_snapshot(view.camera)
    state_after = detail_capture_state(model)
    revision_after = session_model_revision_report(model)
    modified_after = model.respond_to?(:modified?) ? model.modified? : nil
    camera_restored = appearance_values_equal?(camera_before, camera_after)
    native_state_restored = state_before == state_after
    revision_restored = revision_before['complete'] == true && revision_after['complete'] == true && revision_before['model_revision'] == revision_after['model_revision']
    display_restored = !scene_state || detail_scene_display_matches?(model, scene_state)
    restored = camera_restored && native_state_restored && revision_restored && display_restored && (scene_state || modified_before == modified_after)
    restored = !!restored
    {
      'kind' => 'capture_detail_views', 'runtime' => 'queue', 'captures' => captures,
      'status' => restored ? 'captured_and_restored' : 'restoration_failed', 'restored' => restored,
      'capture_scope' => scene_state ? 'controlled_scene_inspection' : 'camera_only',
      'restoration' => {
        'camera_restored' => camera_restored, 'native_state_restored' => native_state_restored,
        'model_revision_restored' => revision_restored,
        'display_state_restored' => display_restored,
        'camera_before' => camera_before, 'camera_after' => camera_after,
        'state_before' => state_before, 'state_after' => state_after,
        'model_revision_before' => revision_before['model_revision'], 'model_revision_after' => revision_after['model_revision'],
        'model_modified_before' => modified_before, 'model_modified_after' => modified_after,
        'model_modified_changed' => modified_before != modified_after
      }
    }
  end

  def detached_detail_camera(camera)
    if camera.respond_to?(:is_2d?) && camera.is_2d?
      raise 'Detail capture cannot restore a two-point perspective or PhotoMatch camera through the public Ruby API; use a standard perspective or orthographic view.'
    end
    copy = Sketchup::Camera.new(
      Geom::Point3d.new(*camera.eye.to_a), Geom::Point3d.new(*camera.target.to_a),
      Geom::Vector3d.new(*camera.up.to_a), camera.perspective?
    )
    copy.aspect_ratio = camera.aspect_ratio
    copy.image_width = camera.image_width if camera.respond_to?(:image_width) && copy.respond_to?(:image_width=)
    copy.description = camera.description if camera.respond_to?(:description) && copy.respond_to?(:description=)
    camera.perspective? ? copy.fov = camera.fov : copy.height = camera.height
    copy
  end

  def detail_capture_plan(model, spec, directory)
    raise 'capture_detail_views view must be an object' unless spec.is_a?(Hash)
    unknown = spec.keys - %w[id name kind target_id instance_path eye target up projection min_width min_height width height camera scene_ref]
    raise "capture_detail_views unsupported view fields: #{unknown.join(', ')}" unless unknown.empty?
    if spec.key?('camera')
      source_camera = spec['camera']
      raise 'capture_detail_views.camera must be an object' unless source_camera.is_a?(Hash)
      raise 'capture_detail_views.camera contains unsupported fields' unless (source_camera.keys - %w[eye target up projection fov]).empty?
      spec = source_camera.merge(spec.reject { |key, _| key == 'camera' })
    end
    id = non_empty_string(spec['id'], 'capture_detail_views.view.id')
    raise 'capture_detail_views view.id must be a safe filename token' unless id.match?(/\A[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\z/)
    width = [positive_integer(spec['width'] || 1280, 'capture_detail_views.width'), positive_integer(spec['min_width'] || 64, 'capture_detail_views.min_width')].max
    height = [positive_integer(spec['height'] || 960, 'capture_detail_views.height'), positive_integer(spec['min_height'] || 64, 'capture_detail_views.min_height')].max
    raise 'capture_detail_views image dimensions must be between 64 and 4096' unless [width, height].all? { |value| (64..4096).cover?(value) }
    target_path = File.join(directory, "#{id}.png")
    raise "capture_detail_views output already exists: #{target_path}" if File.exist?(target_path)
    page = nil
    if spec.key?('scene_ref')
      reference = non_empty_string(spec['scene_ref'], 'capture_detail_views.scene_ref')
      matches = model.pages.select { |entry| entry.name.to_s == reference }
      raise "capture_detail_views.scene_ref must resolve uniquely: #{reference}" unless matches.length == 1
      page = matches.first
    end
    projection = spec['projection'] || 'perspective'
    raise 'capture_detail_views projection must be perspective or orthographic' unless %w[perspective orthographic].include?(projection)
    bounds = detail_capture_bounds(model, spec['instance_path'])
    explicit = spec.key?('eye') || spec.key?('target')
    raise 'capture_detail_views requires eye and target together' if explicit && !(spec.key?('eye') && spec.key?('target'))
    radius = [bounds.diagonal.to_f / 2.0, mm_to_model_units(1)].max
    aspect = width.to_f / height
    if explicit
      eye_values = detail_capture_vector(spec['eye'], 'eye')
      target_values = detail_capture_vector(spec['target'], 'target')
      eye = Geom::Point3d.new(*eye_values.map { |value| mm_to_model_units(value) })
      target = Geom::Point3d.new(*target_values.map { |value| mm_to_model_units(value) })
    else
      target = bounds.center
      half_angle = Math.atan(Math.tan(15 * Math::PI / 180) * [aspect, 1.0 / aspect, 1.0].min)
      distance = radius / Math.sin(half_angle) * 1.2
      direction = [1.0, -1.0, 0.8]
      scale = distance / Math.sqrt(direction.sum { |value| value * value })
      eye = Geom::Point3d.new(target.x + scale, target.y - scale, target.z + scale * 0.8)
    end
    up_values = detail_capture_vector(spec['up'] || [0, 0, 1], 'up')
    direction = [target.x - eye.x, target.y - eye.y, target.z - eye.z]
    cross = [direction[1] * up_values[2] - direction[2] * up_values[1], direction[2] * up_values[0] - direction[0] * up_values[2], direction[0] * up_values[1] - direction[1] * up_values[0]]
    raise 'capture_detail_views eye/target/up must define a valid camera' if cross.sum { |value| value * value } < 1e-16
    fov = spec.key?('fov') ? number_in_range(spec['fov'], 1, 120, 'capture_detail_views.camera.fov') : 30.0
    camera = Sketchup::Camera.new(eye, target, Geom::Vector3d.new(*up_values), projection == 'perspective', fov)
    camera.aspect_ratio = aspect
    camera.height = radius * 2.4 / [aspect, 1.0].min if projection == 'orthographic'
    camera = detached_detail_camera(page.camera) if page && !explicit
    camera.aspect_ratio = aspect
    { id: id, path: target_path, width: width, height: height, camera: camera, page: page,
      instance_path: spec['instance_path'], bounds_mm: bounds_hash(bounds) }
  end

  def detail_scene_restore_plan(model, validate = true)
    raise 'scene_capture_unsaved_style: save the active style before scene inspection' if validate && model.styles.active_style_changed
    page = model.pages.selected_page
    raise 'scene_capture_no_selected_page: select a scene before scene inspection' unless page
    environment = model.respond_to?(:environments) ? model.environments.current : nil
    if model.respond_to?(:environments) && !environment && !native_environment_clear_supported?
      raise 'scene_capture_environment_restore_unsupported: SketchUp 2025.0.2 or newer is required'
    end
    options = model.options['PageOptions']
    raise 'scene_capture_transition_control_unsupported' unless options && options.keys.include?('ShowTransition')
    collections = [model.entities] + model.definitions.map(&:entities)
    drawing_elements = collections.flat_map(&:to_a).select { |entity| entity.respond_to?(:hidden?) && entity.respond_to?(:hidden=) }.uniq
    {
      page: page, style: model.styles.selected_style, environment: environment,
      transition: options['ShowTransition'],
      rendering: model.rendering_options.keys.to_h { |key| [key, model.rendering_options[key]] },
      shadow: model.shadow_info.keys.to_h { |key| [key, model.shadow_info[key]] },
      layers: model.layers.map { |layer| [layer, layer.visible?] },
      hidden: drawing_elements.map { |entity| [entity, entity.hidden?] },
      sections: collections.map { |entities| [entities, entities.active_section_plane] },
      axes: model.respond_to?(:axes) ? [model.axes.origin, model.axes.xaxis, model.axes.yaxis, model.axes.zaxis] : nil
    }
  end

  def restore_detail_scene_state(model, state)
    errors = []
    attempt = lambda do |label, &action|
      action.call
    rescue StandardError => error
      errors << "#{label}: #{error.message}"
    end
    attempt.call('scene') { model.pages.selected_page = state[:page] }
    attempt.call('style') { model.styles.selected_style = state[:style] }
    attempt.call('environment') { model.environments.current = state[:environment] } if model.respond_to?(:environments)
    state[:rendering].each do |key, value|
      attempt.call("rendering.#{key}") { model.rendering_options[key] = value unless detail_capture_value(model.rendering_options[key]) == detail_capture_value(value) }
    end
    # Derived sun fields are read-only. Restore their inputs, then compare all
    # getters (including derived values) in detail_scene_display_matches?.
    state[:shadow].each do |key, value|
      next if %w[SunDirection SunRise SunRise_time_t SunSet SunSet_time_t DayOfYear ShadowTime_time_t].include?(key)
      attempt.call("shadow.#{key}") { model.shadow_info[key] = value unless detail_capture_value(model.shadow_info[key]) == detail_capture_value(value) }
    end
    state[:layers].each { |layer, visible| attempt.call('layer') { layer.visible = visible unless layer.visible? == visible } }
    state[:hidden].each { |entity, hidden| attempt.call('hidden') { entity.hidden = hidden unless entity.hidden? == hidden } }
    state[:sections].each { |entities, plane| attempt.call('section') { entities.active_section_plane = plane unless entities.active_section_plane == plane } }
    if state[:axes]
      current_axes = [model.axes.origin, model.axes.xaxis, model.axes.yaxis, model.axes.zaxis]
      attempt.call('axes') { model.axes.set(*state[:axes]) unless detail_capture_value(current_axes) == detail_capture_value(state[:axes]) }
    end
    attempt.call('transition') { model.options['PageOptions']['ShowTransition'] = state[:transition] }
    raise "scene_capture_restoration_failed: #{errors.join('; ')}" unless errors.empty?
  end

  def detail_scene_display_matches?(model, state)
    current = detail_scene_restore_plan(model, false)
    %i[page style environment transition].all? { |key| current[key] == state[key] } &&
      %i[rendering shadow].all? { |key| current[key].keys == state[key].keys && current[key].all? { |name, value| detail_capture_value(value) == detail_capture_value(state[key][name]) } } &&
      %i[layers hidden sections].all? { |key| current[key] == state[key] } &&
      detail_capture_value(current[:axes]) == detail_capture_value(state[:axes])
  end

  def detail_capture_vector(value, field)
    raise "capture_detail_views.#{field} must be three finite numbers" unless value.is_a?(Array) && value.length == 3 && value.all? { |item| item.is_a?(Numeric) && item.finite? }
    value
  end

  def detail_capture_bounds(model, path)
    return model.bounds if path.nil? && model.bounds.valid?
    raise 'capture_detail_views requires valid model bounds or an instance_path' if path.nil?
    raise 'capture_detail_views.instance_path must contain 1 to 64 IDs' unless path.is_a?(Array) && (1..64).cover?(path.length)
    entities = model.entities
    transform = Geom::Transformation.new
    leaf = nil
    path.each do |reference|
      raise 'capture_detail_views.instance_path IDs must be strings' unless reference.is_a?(String) && !reference.empty?
      matches = entities.select do |entity|
        next false unless entity.is_a?(Sketchup::Group) || entity.is_a?(Sketchup::ComponentInstance)
        [entity_id(entity), entity.name, entity.persistent_id.to_s, "pid:#{entity.persistent_id}"].include?(reference)
      end
      raise "capture_detail_views.instance_path must resolve uniquely: #{reference}" unless matches.length == 1
      leaf = matches.first
      raise "capture_detail_views.instance_path is hidden: #{reference}" if leaf.hidden? || (leaf.layer && !leaf.layer.visible?)
      transform *= leaf.transformation
      entities = leaf.definition.entities
    end
    bounds = Geom::BoundingBox.new
    local = leaf.definition.bounds
    raise 'capture_detail_views target bounds are empty' unless local.valid?
    8.times { |index| bounds.add(local.corner(index).transform(transform)) }
    bounds
  end

  def detail_camera_snapshot(camera)
    result = camera_snapshot(camera)
    %w[perspective? aspect_ratio fov_is_height? is_2d?].each { |key| result[key.delete('?')] = camera.public_send(key) if camera.respond_to?(key) }
    result['height_mm'] = model_units_to_mm(camera.height) if camera.respond_to?(:perspective?) && !camera.perspective? && camera.respond_to?(:height)
    %w[center_2d scale_2d].each { |key| result[key] = detail_capture_value(camera.public_send(key)) if camera.respond_to?(key) }
    result
  end

  def detail_capture_state(model)
    page = model.respond_to?(:pages) && model.pages.respond_to?(:selected_page) ? model.pages.selected_page : nil
    result = { 'native_appearance_signature' => native_appearance_snapshot(model)['signature'], 'selected_page' => page ? page.name.to_s : nil }
    if model.respond_to?(:shadow_info)
      result['shadow_info'] = model.shadow_info.keys.sort.each_with_object({}) { |key, state| state[key] = detail_capture_value(model.shadow_info[key]) }
    end
    result
  end

  def detail_capture_value(value)
    return value.utc.iso8601(6) if value.is_a?(Time)
    return value.map { |item| detail_capture_value(item) } if value.is_a?(Array)
    return [value.x.to_f, value.y.to_f, value.z.to_f] if value.respond_to?(:x) && value.respond_to?(:y) && value.respond_to?(:z)
    return [value.red, value.green, value.blue, value.alpha] if value.respond_to?(:red) && value.respond_to?(:alpha)
    value
  end

  def detail_capture_png_size(path)
    header = File.binread(path, 24)
    raise 'detail_capture_invalid_png' unless header.byteslice(0, 8) == "\x89PNG\r\n\x1A\n".b && header.byteslice(12, 4) == 'IHDR'
    header.byteslice(16, 8).unpack('NN')
  end
end
