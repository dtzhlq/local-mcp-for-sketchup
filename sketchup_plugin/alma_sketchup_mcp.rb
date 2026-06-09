# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'time'
begin
  require 'sketchup.rb'
rescue LoadError
  sketchup_rb = if defined?(Sketchup) && Sketchup.respond_to?(:find_support_file)
                  Sketchup.find_support_file('sketchup.rb', 'Tools')
                end
  raise unless sketchup_rb && File.exist?(sketchup_rb)

  $LOAD_PATH.unshift(File.dirname(sketchup_rb)) unless $LOAD_PATH.include?(File.dirname(sketchup_rb))
  require sketchup_rb
end
require_relative 'alma_sketchup_mcp/operation_registry'
require_relative 'alma_sketchup_mcp/materials'
require_relative 'alma_sketchup_mcp/object_operations'
require_relative 'alma_sketchup_mcp/geometry_operations'
require_relative 'alma_sketchup_mcp/primitive_operations'
require_relative 'alma_sketchup_mcp/product_operations'
require_relative 'alma_sketchup_mcp/profile_operations'
require_relative 'alma_sketchup_mcp/surface_operations'
require_relative 'alma_sketchup_mcp/feature_operations'
require_relative 'alma_sketchup_mcp/boolean_operations'
require_relative 'alma_sketchup_mcp/demo_operations'
require_relative 'alma_sketchup_mcp/architecture_operations'
require_relative 'alma_sketchup_mcp/component_operations'
require_relative 'alma_sketchup_mcp/view_operations'
require_relative 'alma_sketchup_mcp/snapshot'

module AlmaSketchupMCP
  extend self

  STATE_DIR = File.expand_path('~/.sketchup-mcp-replica')
  QUEUE_DIR = File.join(STATE_DIR, 'queue')
  RESPONSE_DIR = File.join(STATE_DIR, 'responses')
  MM_PER_INCH = 25.4
  DEFAULT_OPERATION_LIMIT = 2000
  PLUGIN_VERSION = 'queue-plugin-0.1.0-queue-diagnostics.1'
  CAPABILITY_MANIFEST_VERSION = '2026-06-building-geometry-r2-aggressive'
  RUNTIME_CAPABILITY_VERSION = '0.1.0-capabilities.7'
  DSL_VERSION = 1

  def start
    FileUtils.mkdir_p(QUEUE_DIR)
    FileUtils.mkdir_p(RESPONSE_DIR)
    stop if @timer_id
    @timer_id = UI.start_timer(1.0, true) { process_pending_requests }
    UI.messagebox('Alma SketchUp MCP Bridge is running.')
  end

  def stop
    return unless @timer_id

    UI.stop_timer(@timer_id)
    @timer_id = nil
    UI.messagebox('Alma SketchUp MCP Bridge stopped.')
  end

  def process_pending_requests
    Dir[File.join(QUEUE_DIR, '*.json')].sort.each do |request_path|
      request = JSON.parse(File.read(request_path))
      result = dispatch(request['method'], request['params'] || {})
      write_response(request['id'], { result: result })
    rescue StandardError => error
      request_id = begin
        request && request['id']
      rescue StandardError
        File.basename(request_path, '.json')
      end
      write_response(request_id, { error: error.message }) if request_id
    ensure
      File.delete(request_path) if request_path && File.exist?(request_path)
    end
  end

  def add_warning(type, severity, message, source = nil)
    @warnings << {
      'type' => type,
      'severity' => severity,
      'category' => type.split('.').first,
      'message' => message,
      'source' => source
    }
  end

  def qa_metadata(operation)
    qa = operation['qa']
    return nil unless qa.is_a?(Hash)

    sanitized = {}
    %w[role part_id intent evidence_status fallback_state parent_part_id].each do |key|
      value = qa[key]
      sanitized[key] = value.to_s unless value.nil? || value.to_s.empty?
    end
    %w[evidence_sources feature_intents].each do |key|
      value = qa[key]
      sanitized[key] = value if value.is_a?(Array) || value.is_a?(Hash)
    end
    contacts = qa['expected_contacts'] || qa['expectedContacts']
    if contacts.is_a?(Array)
      sanitized['expected_contacts'] = contacts.each_with_object([]) do |contact, list|
        next unless contact.is_a?(Hash)

        with_name = contact['with'] || contact['object'] || contact['name']
        bucket = contact['bucket']
        next if with_name.to_s.empty? || bucket.to_s.empty?

        entry = { 'with' => with_name.to_s, 'bucket' => bucket.to_s }
        entry['note'] = contact['note'].to_s unless contact['note'].nil? || contact['note'].to_s.empty?
        list << entry
      end
    end
    sanitized.empty? ? nil : sanitized
  end

  def object_id(operation, fallback_name)
    raw = operation['id'] || operation['object_id'] || operation['objectId'] || operation['guid'] || fallback_name
    raw.to_s
  end

  def dispatch(method, params)
    case method
    when 'get_capabilities'
      get_capabilities
    when 'reset_model'
      reset_model
    when 'build_model'
      build_model(params.fetch('code'))
    when 'save_model'
      save_model(params['path'], params.fetch('keep_session', true))
    when 'capture_view'
      capture_view(params)
    else
      raise "Unknown method: #{method}"
    end
  end

  def write_response(id, body)
    FileUtils.mkdir_p(RESPONSE_DIR)
    File.write(File.join(RESPONSE_DIR, "#{id}.json"), JSON.pretty_generate(body))
  end

  def get_capabilities
    {
      'name' => 'queue',
      'version' => PLUGIN_VERSION,
      'capability_version' => RUNTIME_CAPABILITY_VERSION,
      'manifest_version' => CAPABILITY_MANIFEST_VERSION,
      'dsl_version' => DSL_VERSION,
      'supported_operations' => SUPPORTED_OPERATIONS,
      'operation_support' => operation_support_descriptor,
      'plugin' => {
        'name' => 'Alma SketchUp MCP Bridge',
        'version' => PLUGIN_VERSION,
        'sketchup_version' => Sketchup.version,
        'ruby_version' => RUBY_VERSION
      },
      'handshake' => {
        'transport' => 'file_queue',
        'state_dir' => STATE_DIR,
        'queue_dir' => QUEUE_DIR,
        'response_dir' => RESPONSE_DIR,
        'checked_at' => Time.now.utc.iso8601
      },
      'notes' => 'Live capabilities reported by the installed SketchUp Ruby plugin.'
    }
  end

  def reset_model
    model = active_model_or_new('reset_model')
    model.start_operation('Alma Reset Model', true)
    clear_model(model)
    @warnings = []
    @scenes = []
    @levels = []
    @manifold_checks = []
    @style_state = nil
    @shadow_state = nil
    @rendering_options_state = nil
    model.commit_operation
    snapshot
  end

  def build_model(code)
    document = parse_dsl(code)
    model = active_model_or_new('build_model')
    @warnings = []
    @scenes ||= []
    @levels ||= []
    @manifold_checks ||= []
    @style_state ||= nil
    @shadow_state ||= nil
    @rendering_options_state ||= nil
    model.start_operation('Alma Build Model', true)
    document.fetch('operations').each do |operation|
      apply_operation(model, operation)
    end
    model.commit_operation
    snapshot
  rescue StandardError
    model.abort_operation if model
    raise
  end

  def save_model(path, keep_session)
    model = active_model_or_new('save_model')
    target = path.to_s.strip
    target = File.join(STATE_DIR, 'alma-sketchup-model.skp') if target.empty?
    target = File.expand_path(target)
    FileUtils.mkdir_p(File.dirname(target))
    model.save(target)
    result = { 'file_path' => target, 'snapshot' => snapshot }
    reset_model unless keep_session
    result
  end

  def capture_view(params)
    model = active_model_or_new('capture_view')
    view_name = (params['view'] || 'current').to_s
    width = positive_integer(params['width'] || 1280, 'capture_view.width')
    height = positive_integer(params['height'] || 720, 'capture_view.height')
    antialias = params.key?('antialias') ? !!params['antialias'] : true
    compression = params.key?('compression') ? params['compression'].to_f : 1.0
    raise 'capture_view.compression must be between 0 and 1' if compression.negative? || compression > 1

    target = params['path'].to_s.strip
    if target.empty?
      stamp = Time.now.utc.strftime('%Y%m%dT%H%M%SZ')
      target = File.join(STATE_DIR, 'captures', "capture-#{stamp}.png")
    end
    target = File.expand_path(target)
    FileUtils.mkdir_p(File.dirname(target))

    apply_capture_camera(model, view_name, params.fetch('zoom_extents', true))
    view = model.active_view
    view.refresh if view.respond_to?(:refresh)
    ok = view.write_image(target, width, height, antialias, compression)
    raise "Failed to capture SketchUp view to #{target}" unless ok && File.exist?(target)

    model_snapshot = snapshot
    {
      'kind' => 'capture_view',
      'runtime' => 'queue',
      'file_path' => target,
      'view' => view_name,
      'width' => width,
      'height' => height,
      'antialias' => antialias,
      'compression' => compression,
      'camera' => camera_snapshot(view.camera),
      'model_summary' => {
        'totals' => model_snapshot['totals'],
        'bounding_box' => model_snapshot['bounding_box'],
        'warning_summary' => model_snapshot['warning_summary'],
        'visible_object_count' => model_snapshot['totals']['groups'] + model_snapshot['totals']['instances'],
        'total_object_count' => model_snapshot['groups'].length + model_snapshot['instances'].length
      }
    }
  end

  def active_model_or_new(method_name = 'queue runtime')
    model = Sketchup.active_model
    return model if editable_model?(model)

    Sketchup.new_model if Sketchup.respond_to?(:new_model)
    model = Sketchup.active_model
    return model if editable_model?(model)

    raise "#{method_name} requires an editable SketchUp active model. Open or create a model, then start the Alma SketchUp MCP Bridge again."
  end

  def editable_model?(model)
    model && model.respond_to?(:entities) && model.respond_to?(:start_operation)
  end

  def apply_capture_camera(model, view_name, zoom_extents)
    view = model.active_view
    normalized = view_name.downcase
    return if normalized == 'current'

    bounds = model.bounds
    valid_bounds = bounds.respond_to?(:valid?) ? bounds.valid? : !model.entities.empty?
    return unless valid_bounds

    center = bounds.center
    distance = [bounds.diagonal * 1.8, mm_to_model_units(1000)].max
    camera_vectors = {
      'top' => [[0, 0, distance], [0, 1, 0]],
      'front' => [[0, -distance, 0], [0, 0, 1]],
      'back' => [[0, distance, 0], [0, 0, 1]],
      'right' => [[distance, 0, 0], [0, 0, 1]],
      'left' => [[-distance, 0, 0], [0, 0, 1]],
      'iso' => [[distance, -distance, distance], [0, 0, 1]]
    }
    vector_pair = camera_vectors[normalized]
    raise 'capture_view.view must be current, top, front, back, right, left, or iso' unless vector_pair

    eye_offset, up_vector = vector_pair
    eye = Geom::Point3d.new(center.x + eye_offset[0], center.y + eye_offset[1], center.z + eye_offset[2])
    view.camera = Sketchup::Camera.new(eye, center, Geom::Vector3d.new(*up_vector), true)
    view.zoom_extents if zoom_extents && view.respond_to?(:zoom_extents)
  end

  def camera_snapshot(camera)
    {
      'eye' => point_snapshot(camera.eye),
      'target' => point_snapshot(camera.target),
      'up' => [camera.up.x, camera.up.y, camera.up.z],
      'fov' => camera.respond_to?(:fov) ? camera.fov : nil
    }
  end

  def point_snapshot(point)
    [model_units_to_mm(point.x), model_units_to_mm(point.y), model_units_to_mm(point.z)]
  end

  def positive_integer(value, field_name)
    number = Integer(value)
    raise "#{field_name} must be positive" unless number.positive?

    number
  rescue ArgumentError, TypeError
    raise "#{field_name} must be a positive integer"
  end


  def clear_model(model)
    model.entities.clear!
    if model.respond_to?(:pages) && model.pages.respond_to?(:erase)
      model.pages.to_a.each { |page| model.pages.erase(page) }
    end
    model.definitions.purge_unused if model.definitions.respond_to?(:purge_unused)
    model.materials.purge_unused if model.materials.respond_to?(:purge_unused)
    model.layers.purge_unused if model.layers.respond_to?(:purge_unused)
    model.layers.purge_unused_folders if model.layers.respond_to?(:purge_unused_folders)
  end

  def parse_dsl(code)
    raise 'build_model requires a non-empty JSON DSL string' if code.to_s.strip.empty?

    document = JSON.parse(code)
    raise 'DSL version must be 1' unless document['version'] == 1
    raise 'Only millimeter units are supported in the MVP' if document['units'] && document['units'] != 'mm'
    raise 'DSL requires operations array' unless document['operations'].is_a?(Array)

    max_operations = operation_limit
    if document['operations'].length > max_operations
      raise "DSL operation limit exceeded: max #{max_operations} operations. Set ALMA_SKETCHUP_MAX_OPERATIONS before launching SketchUp to raise this for trusted large models."
    end

    document
  rescue JSON::ParserError => error
    raise "build_model accepts JSON DSL only: #{error.message}"
  end

  def operation_limit
    raw = ENV['ALMA_SKETCHUP_MAX_OPERATIONS'].to_s.strip
    return DEFAULT_OPERATION_LIMIT if raw.empty?

    limit = Integer(raw)
    raise 'ALMA_SKETCHUP_MAX_OPERATIONS must be a positive integer' unless limit.positive?

    limit
  rescue ArgumentError
    raise 'ALMA_SKETCHUP_MAX_OPERATIONS must be a positive integer'
  end

  def apply_operation(model, operation)
    case operation['op']
    when 'reset'
      clear_model(model)
      @warnings = []
      @scenes = []
      @levels = []
      @manifold_checks = []
      @view_state = nil
      @style_state = nil
      @shadow_state = nil
      @rendering_options_state = nil
    when 'material'
      ensure_material(operation)
    when 'tag'
      add_tag(model, operation)
    when 'assign_tag'
      assign_tag(model, operation)
    when 'attribute'
      set_object_attribute(model, operation)
    when 'classification'
      set_object_classification(model, operation)
    when 'texture_transform'
      set_object_texture_transform(model, operation)
    when 'uv_project_planar'
      set_object_texture_transform(model, operation.merge('projection' => 'planar'))
    when 'uv_project_box'
      set_object_texture_transform(model, operation.merge('projection' => 'box'))
    when 'delete'
      delete_object(model, operation)
    when 'rename'
      rename_object(model, operation)
    when 'set_material'
      set_object_material(model, operation)
    when 'set_visibility'
      set_object_visibility(model, operation)
    when 'transform_object'
      transform_object(model, operation)
    when 'level'
      add_level(operation)
    when 'box'
      add_box(model.entities, operation)
    when 'rounded_box'
      add_rounded_box(model.entities, operation)
    when 'beveled_panel'
      add_beveled_panel(model.entities, operation)
    when 'fillet'
      add_fillet(model.entities, operation)
    when 'chamfer'
      add_chamfer(model.entities, operation)
    when 'recess'
      add_recess(model.entities, operation)
    when 'engraved_line'
      add_engraved_line(model.entities, operation)
    when 'text_emboss'
      add_text_emboss(model.entities, operation)
    when 'text_engrave'
      add_text_engrave(model.entities, operation)
    when 'text_3d'
      add_text_3d(model.entities, operation)
    when 'slot'
      add_slot(model.entities, operation)
    when 'slot_array'
      add_slot_array(model.entities, operation)
    when 'rib'
      add_rib(model.entities, operation)
    when 'standoff_boss'
      add_standoff_boss(model.entities, operation)
    when 'button_on_panel'
      add_button_on_panel(model.entities, operation)
    when 'cut_hole'
      cut_hole(model, operation)
    when 'cut_slot'
      cut_slot(model, operation)
    when 'cut_recess'
      cut_recess(model, operation)
    when 'add_boss'
      add_boss(model, operation)
    when 'add_raised_rib'
      add_raised_rib(model, operation)
    when 'boolean_union'
      boolean_union(model, operation)
    when 'boolean_difference'
      boolean_difference(model, operation)
    when 'boolean_intersect'
      boolean_intersect(model, operation)
    when 'manifold_check'
      manifold_check(model, operation)
    when 'manifold_repair'
      manifold_repair(model, operation)
    when 'image_plane'
      add_image_plane(model.entities, operation)
    when 'floor_slab'
      add_floor_slab(model.entities, operation)
    when 'footprint_slab'
      add_footprint_slab(model.entities, operation)
    when 'wall'
      add_wall(model.entities, operation)
    when 'wall_path'
      add_wall_path(model.entities, operation)
    when 'curved_wall'
      add_curved_wall(model.entities, operation)
    when 'roof_footprint'
      add_roof_footprint(model.entities, operation)
    when 'hip_roof'
      add_hip_roof(model.entities, operation)
    when 'parapet_path'
      add_parapet_path(model.entities, operation)
    when 'curtain_wall'
      add_curtain_wall(model.entities, operation)
    when 'column_grid'
      add_column_grid(model.entities, operation)
    when 'path_surface'
      add_path_surface(model.entities, operation)
    when 'terrain_mesh'
      add_terrain_mesh(model.entities, operation)
    when 'parking_stall_array'
      add_parking_stall_array(model.entities, operation)
    when 'door'
      add_door(model.entities, operation)
    when 'window'
      add_window(model.entities, operation)
    when 'stairs'
      add_stairs(model.entities, operation)
    when 'railing'
      add_railing(model.entities, operation)
    when 'panel_with_openings'
      add_panel_with_openings(model.entities, operation)
    when 'boolean_cutout'
      add_boolean_cutout(model.entities, operation)
    when 'mesh'
      add_mesh(model.entities, operation)
    when 'prism'
      add_prism(model.entities, operation)
    when 'face_with_holes'
      add_face_with_holes(model.entities, operation)
    when 'profile_extrude'
      add_profile_extrude(model.entities, operation)
    when 'gable_roof'
      add_gable_roof(model.entities, operation)
    when 'shed_roof'
      add_shed_roof(model.entities, operation)
    when 'cylinder'
      add_cylinder(model.entities, operation)
    when 'loft_between_profiles'
      add_loft_between_profiles(model.entities, operation)
    when 'shell_from_front_side_profiles'
      add_shell_from_front_side_profiles(model.entities, operation)
    when 'lofted_solid'
      add_lofted_solid(model.entities, operation)
    when 'face_on_cylinder'
      add_face_on_cylinder(model.entities, operation)
    when 'analog_stick'
      add_analog_stick(model.entities, operation)
    when 'screw_hole'
      add_screw_hole(model.entities, operation)
    when 'pipe_between_points'
      add_pipe_between_points(model.entities, operation)
    when 'swept_path'
      add_swept_path(model.entities, operation)
    when 'domed_surface'
      add_domed_surface(model.entities, operation)
    when 'bowed_panel'
      add_bowed_panel(model.entities, operation)
    when 'component_definition'
      add_component_definition(model, operation)
    when 'component_instance'
      add_component_instance(model, operation)
    when 'camera'
      set_camera(model, operation)
    when 'scene'
      add_scene(model, operation)
    when 'style'
      set_style(model, operation)
    when 'shadow'
      set_shadow(model, operation)
    when 'rendering_options'
      set_rendering_options(model, operation)
    when 'room'
      add_demo_room(model.entities, operation)
    else
      raise "Unsupported operation: #{operation['op']}"
    end
  end

  def object_reference(operation, op_name)
    raw_id = operation['target_id'] || operation['targetId'] || operation['id'] || operation['object_id'] || operation['objectId'] || operation['guid']
    raw_name = operation['name'] || operation['target'] || operation['object']
    reference = {}
    reference['id'] = raw_id.to_s unless raw_id.nil? || raw_id.to_s.empty?
    reference['name'] = raw_name.to_s unless raw_name.nil? || raw_name.to_s.empty?
    raise "#{op_name} requires target_id or name" if reference.empty?

    reference
  end

  def reference_label(reference)
    [reference['id'] ? "id:#{reference['id']}" : nil, reference['name'] ? "name:#{reference['name']}" : nil].compact.join(' ')
  end

  def find_referenced_entity(model, operation, op_name)
    reference = object_reference(operation, op_name)
    entity = (model.entities.grep(Sketchup::Group) + model.entities.grep(Sketchup::ComponentInstance)).find { |item| entity_matches_reference(item, reference) }
    raise "object not found: #{reference_label(reference)}" unless entity

    entity
  end

  def entity_matches_reference(entity, reference)
    id_matches = !reference['id'] || [entity_id(entity), entity_persistent_id(entity)].compact.include?(reference['id'])
    name_matches = !reference['name'] || entity.name == reference['name']
    id_matches && name_matches
  end

  def entity_id(entity)
    return nil unless entity.respond_to?(:get_attribute)

    raw = entity.get_attribute('AlmaSketchupMCP', 'id')
    raw.nil? || raw.to_s.empty? ? nil : raw.to_s
  end

  def entity_persistent_id(entity)
    entity.respond_to?(:persistent_id) ? entity.persistent_id.to_s : nil
  end

  def integer_index(value, field_name, length)
    number = value.to_i
    raise "#{field_name} must be a valid vertex index" unless number.to_s == value.to_s && number >= 0 && number < length

    number
  end

  def soften_edges(group, mode)
    return unless mode

    group.entities.grep(Sketchup::Edge).each do |edge|
      if mode == 'coplanar'
        faces = edge.faces
        next unless faces.length == 2

        dot = faces[0].normal.dot(faces[1].normal)
        next unless dot > 0.999
      end
      edge.soft = true
      edge.smooth = true
    end
  end


  def boolean_value(value, field_name)
    return value if value == true || value == false
    if value.is_a?(String)
      normalized = value.strip.downcase
      return true if normalized == 'true'
      return false if normalized == 'false'
    end
    raise "#{field_name} must be a boolean"
  end

  def non_empty_string(value, field_name)
    raise "#{field_name} must be a non-empty string" unless value.is_a?(String) && !value.strip.empty?

    value
  end

  def json_value?(value)
    return true if value.nil? || value.is_a?(String) || value == true || value == false
    return value.finite? if value.is_a?(Numeric)
    return value.all? { |item| json_value?(item) } if value.is_a?(Array)
    return value.values.all? { |item| json_value?(item) } if value.is_a?(Hash)

    false
  end

  def color_hex(value, field_name)
    raise "#{field_name} must be a #rrggbb color" unless value.is_a?(String) && value.match?(/\A#[0-9a-fA-F]{6}\z/)

    value.downcase
  end

  def sketchup_color(value)
    hex = value.delete_prefix('#')
    Sketchup::Color.new(hex[0, 2].to_i(16), hex[2, 2].to_i(16), hex[4, 2].to_i(16))
  end

  def finite_number(value, field_name)
    number = value.to_f
    raise "#{field_name} must be a finite number" unless number.finite?

    number
  end

  def number_in_range(value, min, max, field_name)
    number = finite_number(value, field_name)
    raise "#{field_name} must be a number from #{min} to #{max}" if number < min || number > max

    number
  end

  def vector(value, field_name)
    raise "#{field_name} must be [x, y, z]" unless value.is_a?(Array) && value.length == 3

    value.each_with_index.map do |item, index|
      number = item.to_f
      raise "#{field_name}[#{index}] must be a finite number" unless number.finite?

      number
    end
  end

  def size2(value, field_name)
    raise "#{field_name} must be [width, height]" unless value.is_a?(Array) && value.length == 2

    value.each_with_index.map do |item, index|
      positive_number(item, nil, "#{field_name}[#{index}]")
    end
  end

  def uv_pair(value, field_name)
    raise "#{field_name} must be [u, v]" unless value.is_a?(Array) && value.length == 2

    value.each_with_index.map do |item, index|
      finite_number(item, "#{field_name}[#{index}]")
    end
  end

  def non_negative_number(value, fallback, field_name)
    number = value.nil? ? fallback : value.to_f
    raise "#{field_name} must be a non-negative number" unless number.respond_to?(:finite?) && number.finite? && number >= 0

    number
  end

  def integer_range(value, min, max, field_name)
    number = value.to_i
    raise "#{field_name} must be an integer from #{min} to #{max}" unless number.to_s == value.to_s && number >= min && number <= max

    number
  end

  def positive_number(value, fallback, field_name)
    number = value.nil? ? fallback : value.to_f
    raise "#{field_name} must be a positive number" unless number.respond_to?(:finite?) && number.finite? && number.positive?

    number
  end

  unless file_loaded?(__FILE__)
    menu = UI.menu('Plugins').add_submenu('Alma SketchUp MCP')
    menu.add_item('Start Bridge') { start }
    menu.add_item('Stop Bridge') { stop }
    file_loaded(__FILE__)
  end
end
