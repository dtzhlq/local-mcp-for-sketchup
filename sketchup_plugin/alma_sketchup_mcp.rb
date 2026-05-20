# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'time'
require 'sketchup.rb'

module AlmaSketchupMCP
  extend self

  STATE_DIR = File.expand_path('~/.sketchup-mcp-replica')
  QUEUE_DIR = File.join(STATE_DIR, 'queue')
  RESPONSE_DIR = File.join(STATE_DIR, 'responses')
  MM_PER_INCH = 25.4
  DEFAULT_OPERATION_LIMIT = 2000
  PLUGIN_VERSION = 'queue-plugin-0.1.0-handshake.1'
  CAPABILITY_MANIFEST_VERSION = '2026-05-phase2-pivot-editing-slice'
  RUNTIME_CAPABILITY_VERSION = '0.1.0-capabilities.1'
  DSL_VERSION = 1
  SUPPORTED_OPERATIONS = %w[
    reset material delete rename set_material set_visibility transform_object box rounded_box beveled_panel fillet chamfer recess engraved_line text_emboss text_engrave slot slot_array rib standoff_boss button_on_panel prism face_with_holes profile_extrude panel_with_openings boolean_cutout mesh gable_roof shed_roof
    cylinder loft_between_profiles shell_from_front_side_profiles lofted_solid face_on_cylinder analog_stick screw_hole pipe_between_points swept_path domed_surface bowed_panel level floor_slab wall door
    window stairs railing component_definition component_instance camera scene style shadow
    rendering_options room
  ].freeze
  PARTIAL_OPERATIONS = %w[material swept_path style shadow rendering_options].freeze

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
    %w[role part_id intent].each do |key|
      value = qa[key]
      sanitized[key] = value.to_s unless value.nil? || value.to_s.empty?
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

  def operation_support_descriptor
    SUPPORTED_OPERATIONS.each_with_object({}) do |operation, descriptor|
      descriptor[operation] = {
        'status' => PARTIAL_OPERATIONS.include?(operation) ? 'partial' : 'supported',
        'stability' => beta_operation?(operation) ? 'beta' : 'stable'
      }
    end
  end

  def beta_operation?(operation)
    %w[
      delete rename set_material set_visibility transform_object rounded_box beveled_panel fillet chamfer recess engraved_line text_emboss text_engrave slot slot_array rib standoff_boss button_on_panel boolean_cutout mesh loft_between_profiles shell_from_front_side_profiles lofted_solid face_on_cylinder analog_stick screw_hole pipe_between_points swept_path domed_surface bowed_panel railing
      component_definition component_instance style shadow rendering_options
    ].include?(operation)
  end

  def reset_model
    model = Sketchup.active_model
    model.start_operation('Alma Reset Model', true)
    clear_model(model)
    @warnings = []
    @scenes = []
    @levels = []
    @style_state = nil
    @shadow_state = nil
    @rendering_options_state = nil
    model.commit_operation
    snapshot
  end

  def build_model(code)
    document = parse_dsl(code)
    model = Sketchup.active_model
    @warnings = []
    @scenes ||= []
    @levels ||= []
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
    model = Sketchup.active_model
    target = path.to_s.strip
    target = File.join(STATE_DIR, 'alma-sketchup-model.skp') if target.empty?
    target = File.expand_path(target)
    FileUtils.mkdir_p(File.dirname(target))
    model.save(target)
    result = { 'file_path' => target, 'snapshot' => snapshot }
    reset_model unless keep_session
    result
  end


  def clear_model(model)
    model.entities.clear!
    if model.respond_to?(:pages) && model.pages.respond_to?(:erase)
      model.pages.to_a.each { |page| model.pages.erase(page) }
    end
    model.definitions.purge_unused if model.definitions.respond_to?(:purge_unused)
    model.materials.purge_unused if model.materials.respond_to?(:purge_unused)
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
      @view_state = nil
      @style_state = nil
      @shadow_state = nil
      @rendering_options_state = nil
    when 'material'
      ensure_material(operation)
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
    when 'floor_slab'
      add_floor_slab(model.entities, operation)
    when 'wall'
      add_wall(model.entities, operation)
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


  def delete_object(model, operation)
    entity = find_named_entity(model, operation.fetch('name'))
    entity.erase!
  end

  def rename_object(model, operation)
    entity = find_named_entity(model, operation.fetch('name'))
    entity.name = operation.fetch('new_name')
  end

  def set_object_material(model, operation)
    entity = find_named_entity(model, operation.fetch('name'))
    material = ensure_material(operation.fetch('material'), '#cccccc')
    apply_material_to_entity(entity, material)
  end

  def set_object_visibility(model, operation)
    entity = find_named_entity(model, operation.fetch('name'))
    visible = operation.key?('visible') ? boolean_value(operation['visible'], 'set_visibility.visible') : !boolean_value(operation['hidden'], 'set_visibility.hidden')
    entity.hidden = !visible if entity.respond_to?(:hidden=)
  end

  def transform_object(model, operation)
    entity = find_named_entity(model, operation.fetch('name'))
    transform = operation['transform'] || operation
    scale = transform['scale'] || 1
    scale_values = scale.is_a?(Array) ? vector(scale, "#{operation['name']}.scale") : [positive_number(scale, 1, "#{operation['name']}.scale")] * 3
    mirror = transform['mirror'] || []
    mirror_axes = mirror.is_a?(Array) ? mirror : [mirror]
    sx = scale_values[0] * (mirror_axes.include?('x') ? -1 : 1)
    sy = scale_values[1] * (mirror_axes.include?('y') ? -1 : 1)
    sz = scale_values[2] * (mirror_axes.include?('z') ? -1 : 1)
    pivot = transform_pivot(entity, transform['pivot'] || operation['pivot'], "#{operation['name']}.pivot")
    t = Geom::Transformation.scaling(pivot, sx, sy, sz)
    rx = transform['rotateX'] || transform['rotationX']
    ry = transform['rotateY'] || transform['rotationY']
    rz = transform['rotateZ'] || transform['rotationZ']
    t = Geom::Transformation.rotation(pivot, X_AXIS, rx.to_f.degrees) * t if rx
    t = Geom::Transformation.rotation(pivot, Y_AXIS, ry.to_f.degrees) * t if ry
    t = Geom::Transformation.rotation(pivot, Z_AXIS, rz.to_f.degrees) * t if rz
    translate = transform['translate'] || transform['translation']
    t = Geom::Transformation.translation(vector(translate, "#{operation['name']}.translate").map { |value| mm_to_model_units(value) }) * t if translate
    entity.transform!(t)
    entity
  end

  def transform_pivot(entity, raw_pivot, field_name)
    pivot = raw_pivot || 'origin'
    return Geom::Point3d.new(vector(pivot, field_name).map { |value| mm_to_model_units(value) }) if pivot.is_a?(Array)
    return ORIGIN if pivot == 'origin'
    if %w[center object_center objectCenter].include?(pivot)
      bounds = entity.bounds
      return Geom::Point3d.new(
        (bounds.min.x + bounds.max.x) / 2.0,
        (bounds.min.y + bounds.max.y) / 2.0,
        (bounds.min.z + bounds.max.z) / 2.0
      )
    end

    raise "#{field_name} must be origin, center, or a [x,y,z] vector"
  end

  def find_named_entity(model, name)
    entity = (model.entities.grep(Sketchup::Group) + model.entities.grep(Sketchup::ComponentInstance)).find { |item| item.name == name }
    raise "object not found: #{name}" unless entity

    entity
  end

  def apply_material_to_entity(entity, material)
    if entity.respond_to?(:material=)
      entity.material = material
    end
    entities = entity.respond_to?(:definition) ? entity.definition.entities : entity.entities
    entities.grep(Sketchup::Face).each do |face|
      face.material = material
      face.back_material = material
    end
  end

  def ensure_material(spec_or_name, color = nil)
    spec, update_existing = material_spec(spec_or_name, color)
    materials = Sketchup.active_model.materials
    material = materials[spec['name']]
    existed = !material.nil?
    material ||= materials.add(spec['name'])
    apply_material_spec(material, spec) if update_existing || !existed
    material
  end

  def material_spec(spec_or_name, color)
    update_existing = spec_or_name.is_a?(Hash)
    spec = update_existing ? spec_or_name.dup : { 'name' => spec_or_name.to_s }
    spec['color'] = color if color && !update_existing
    raise 'material operation requires a string name' unless spec['name'].is_a?(String) && !spec['name'].strip.empty?

    spec['color'] ||= '#cccccc'
    [spec, update_existing]
  end

  def apply_material_spec(material, spec)
    name = spec['name']
    material.color = spec['color'] if spec['color']
    material.alpha = number_in_range(spec['alpha'], 0.0, 1.0, "#{name}.alpha") if spec.key?('alpha')
    apply_base_texture(material, spec['texture'], "#{name}.texture") if spec.key?('texture')
    apply_colorize_type(material, spec['colorize_type'] || spec['colorizeType'], name)
    apply_workflow_and_pbr(material, spec)
  end

  def apply_base_texture(material, texture, field_name)
    properties = texture_properties(texture, field_name)
    return unless properties

    material.texture = properties
  rescue StandardError => error
    add_warning('material.missing_texture', 'warn', "#{field_name} could not be applied: #{error.message}", field_name)
  end

  def texture_properties(texture, field_name)
    if texture.is_a?(Hash)
      path = resolve_texture_path(texture['path'] || texture['file'] || texture['filename'], "#{field_name}.path")
      return nil unless path

      width = positive_number(texture['width'], nil, "#{field_name}.width") if texture.key?('width')
      height = positive_number(texture['height'], nil, "#{field_name}.height") if texture.key?('height')
      raise "#{field_name}.height requires width" if height && !width

      return [path, mm_to_model_units(width), mm_to_model_units(height)] if width && height
      return [path, mm_to_model_units(width)] if width
      path
    else
      resolve_texture_path(texture, field_name)
    end
  end

  def resolve_texture_path(value, field_name)
    path = value.to_s.strip
    raise "#{field_name} must be a non-empty texture path" if path.empty?

    expanded = File.expand_path(path)
    return expanded if File.exist?(expanded)

    add_warning('material.missing_texture', 'warn', "#{field_name} texture file not found: #{path}; skipped.", field_name)
    nil
  end

  def apply_colorize_type(material, colorize_type, name)
    return unless colorize_type
    return unless material.respond_to?(:colorize_type=)

    value = material_keyword(colorize_type, {
      'shift' => Sketchup::Material::COLORIZE_SHIFT,
      'tint' => Sketchup::Material::COLORIZE_TINT
    }, "#{name}.colorize_type")
    material.colorize_type = value
  end

  def apply_workflow_and_pbr(material, spec)
    name = spec['name']
    workflow_name = spec['workflow'] && normalized_material_keyword(spec['workflow'])
    pbr = spec['pbr']
    wants_pbr = workflow_name == 'pbr_metallic_roughness' || (pbr.is_a?(Hash) && !pbr.empty?)
    unless supports_pbr_materials?
      add_warning('material.pbr_unsupported', 'warn', "#{name} uses PBR material fields, but SketchUp 2025+ is required; skipped PBR settings.", name) if wants_pbr
      return
    end

    if workflow_name
      material.workflow = material_keyword(workflow_name, {
        'classic' => Sketchup::Material::WORKFLOW_CLASSIC,
        'pbr_metallic_roughness' => Sketchup::Material::WORKFLOW_PBR_METALLIC_ROUGHNESS
      }, "#{name}.workflow")
    elsif wants_pbr
      material.workflow = Sketchup::Material::WORKFLOW_PBR_METALLIC_ROUGHNESS
    end
    apply_pbr_settings(material, pbr, name) if pbr.is_a?(Hash)
  end

  def apply_pbr_settings(material, pbr, name)
    if pbr.key?('metallic_factor')
      material.metalness_enabled = true if material.respond_to?(:metalness_enabled=)
      material.metallic_factor = number_in_range(pbr['metallic_factor'], 0.0, 1.0, "#{name}.pbr.metallic_factor") if material.respond_to?(:metallic_factor=)
    end
    if pbr.key?('roughness_factor')
      material.roughness_enabled = true if material.respond_to?(:roughness_enabled=)
      material.roughness_factor = number_in_range(pbr['roughness_factor'], 0.0, 1.0, "#{name}.pbr.roughness_factor") if material.respond_to?(:roughness_factor=)
    end
    if pbr.key?('ao_strength')
      material.ao_enabled = true if material.respond_to?(:ao_enabled=)
      material.ao_strength = number_in_range(pbr['ao_strength'], 0.0, 1.0, "#{name}.pbr.ao_strength") if material.respond_to?(:ao_strength=)
    end
    material.normal_scale = positive_number(pbr['normal_scale'], nil, "#{name}.pbr.normal_scale") if pbr.key?('normal_scale') && material.respond_to?(:normal_scale=)
    apply_normal_style(material, pbr['normal_style'] || pbr['normalStyle'], name)
    apply_pbr_textures(material, pbr['textures'], name) if pbr['textures'].is_a?(Hash)
  end

  def apply_normal_style(material, normal_style, name)
    return unless normal_style && material.respond_to?(:normal_style=)

    material.normal_style = material_keyword(normal_style, {
      'opengl' => Sketchup::Material::NORMAL_STYLE_OPENGL,
      'directx' => Sketchup::Material::NORMAL_STYLE_DIRECTX
    }, "#{name}.pbr.normal_style")
  end

  def apply_pbr_textures(material, textures, name)
    {
      'metallic' => :metallic_texture=,
      'roughness' => :roughness_texture=,
      'normal' => :normal_texture=,
      'ao' => :ao_texture=,
      'opacity' => :opacity_texture=
    }.each do |key, setter|
      next unless textures.key?(key)

      path = resolve_texture_path(texture_path_value(textures[key]), "#{name}.pbr.textures.#{key}")
      next unless path && material.respond_to?(setter)

      material.public_send(setter, path)
      material.metalness_enabled = true if key == 'metallic' && material.respond_to?(:metalness_enabled=)
      material.roughness_enabled = true if key == 'roughness' && material.respond_to?(:roughness_enabled=)
      material.normal_enabled = true if key == 'normal' && material.respond_to?(:normal_enabled=)
      material.ao_enabled = true if key == 'ao' && material.respond_to?(:ao_enabled=)
    rescue StandardError => error
      add_warning('material.missing_texture', 'warn', "#{name}.pbr.textures.#{key} could not be applied: #{error.message}", name)
    end
  end

  def texture_path_value(value)
    value.is_a?(Hash) ? value['path'] || value['file'] || value['filename'] : value
  end

  def supports_pbr_materials?
    defined?(Sketchup::Material::WORKFLOW_PBR_METALLIC_ROUGHNESS) && Sketchup::Material.method_defined?(:workflow=)
  end

  def normalized_material_keyword(value)
    value.to_s.strip.downcase.gsub(/[ -]/, '_')
  end

  def material_keyword(value, allowed, field_name)
    normalized = normalized_material_keyword(value)
    raise "#{field_name} must be one of: #{allowed.keys.join(', ')}" unless allowed.key?(normalized)

    allowed[normalized]
  end

  def add_box(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation.fetch('origin'), "#{name}.origin").map { |value| mm_to_model_units(value) }
    size = vector(operation.fetch('size'), "#{name}.size").map { |value| mm_to_model_units(value) }
    raise "#{name}.size values must be positive" if size.any? { |value| value <= 0 }

    x, y, z = origin
    w, d, h = size
    group = parent_entities.add_group
    group.name = name
    annotate_group(group, operation, 'box')
    face = group.entities.add_face(
      Geom::Point3d.new(x, y, z),
      Geom::Point3d.new(x + w, y, z),
      Geom::Point3d.new(x + w, y + d, z),
      Geom::Point3d.new(x, y + d, z)
    )
    raise "Failed to create face for #{name}" unless face

    face.reverse! if face.normal.z < 0
    face.pushpull(h)

    material_name = operation['material']
    if material_name
      material = ensure_material(material_name, '#cccccc')
      group.entities.grep(Sketchup::Face).each do |group_face|
        group_face.material = material
        group_face.back_material = material
      end
    end
    apply_transform(group, operation)
    group
  end

  def add_rounded_box(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin")
    size = vector(operation.fetch('size'), "#{name}.size")
    raise "#{name}.size values must be positive" if size.any? { |value| value <= 0 }

    radius = [non_negative_number(operation['radius'], 0, "#{name}.radius"), size[0] / 2.0, size[1] / 2.0].min
    segments = integer_range(operation['segments'] || 5, 1, 16, "#{name}.segments")
    x, y, z = origin
    w, d, h = size
    points = rounded_rect_points(x, y, w, d, radius, segments)
    bottom = points.map { |px, py| [px, py, z] }
    top = points.map { |px, py| [px, py, z + h] }
    count = points.length
    faces = [
      (0...count).to_a,
      (0...count).map { |index| count + count - 1 - index }
    ]
    (0...count).each do |index|
      faces << [index, (index + 1) % count, count + ((index + 1) % count), count + index]
    end
    add_mesh(parent_entities, operation.merge('vertices' => bottom + top, 'faces' => faces, 'smooth' => operation['smooth'] || 'all', 'kind' => operation['kind'] || 'rounded_box'))
  end

  def add_beveled_panel(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin")
    size = vector(operation.fetch('size'), "#{name}.size")
    raise "#{name}.size values must be positive" if size.any? { |value| value <= 0 }

    bevel = [non_negative_number(operation['bevel'], 0, "#{name}.bevel"), size[0] / 2.0, size[1] / 2.0].min
    x, y, z = origin
    w, d, h = size
    points = beveled_rect_points(x, y, w, d, bevel)
    add_footprint_extrusion_mesh(parent_entities, operation.merge('smooth' => operation['smooth'] || 'coplanar', 'kind' => 'beveled_panel'), points, z, h)
  end

  def add_fillet(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin")
    size = vector(operation.fetch('size'), "#{name}.size")
    raise "#{name}.size values must be positive" if size.any? { |value| value <= 0 }

    radius = [non_negative_number(operation['radius'], 0, "#{name}.radius"), size[0] / 2.0, size[1] / 2.0].min
    segments = integer_range(operation['segments'] || 5, 1, 32, "#{name}.segments")
    x, y, z = origin
    w, d, h = size
    points = rounded_rect_points(x, y, w, d, radius, segments)
    add_footprint_extrusion_mesh(parent_entities, operation.merge('smooth' => operation['smooth'] || 'all', 'kind' => 'fillet'), points, z, h)
    group = parent_entities.grep(Sketchup::Group).last
    group.set_attribute('AlmaSketchupMCP', 'segments', segments) if group&.respond_to?(:set_attribute)
  end

  def add_chamfer(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin")
    size = vector(operation.fetch('size'), "#{name}.size")
    raise "#{name}.size values must be positive" if size.any? { |value| value <= 0 }

    amount = [non_negative_number(operation['amount'] || operation['bevel'], 0, "#{name}.amount"), size[0] / 2.0, size[1] / 2.0].min
    x, y, z = origin
    w, d, h = size
    points = beveled_rect_points(x, y, w, d, amount)
    add_footprint_extrusion_mesh(parent_entities, operation.merge('smooth' => operation['smooth'] || 'coplanar', 'kind' => 'chamfer'), points, z, h)
  end

  def add_footprint_extrusion_mesh(parent_entities, operation, points, z, height)
    bottom = points.map { |px, py| [px, py, z] }
    top = points.map { |px, py| [px, py, z + height] }
    count = points.length
    faces = [
      (0...count).to_a,
      (0...count).map { |index| count + count - 1 - index }
    ]
    (0...count).each do |index|
      faces << [index, (index + 1) % count, count + ((index + 1) % count), count + index]
    end
    add_mesh(parent_entities, operation.merge('vertices' => bottom + top, 'faces' => faces))
  end

  def rounded_rect_points(x, y, width, depth, radius, segments)
    return [[x, y], [x + width, y], [x + width, y + depth], [x, y + depth]] if radius <= 0

    corners = [
      { cx: x + width - radius, cy: y + radius, start: -Math::PI / 2.0, finish: 0.0 },
      { cx: x + width - radius, cy: y + depth - radius, start: 0.0, finish: Math::PI / 2.0 },
      { cx: x + radius, cy: y + depth - radius, start: Math::PI / 2.0, finish: Math::PI },
      { cx: x + radius, cy: y + radius, start: Math::PI, finish: Math::PI * 1.5 }
    ]
    points = []
    corners.each do |corner|
      (0..segments).each do |index|
        t = index.to_f / segments
        angle = corner[:start] + (corner[:finish] - corner[:start]) * t
        points << [corner[:cx] + radius * Math.cos(angle), corner[:cy] + radius * Math.sin(angle)]
      end
    end
    dedupe_plan_points(points)
  end

  def dedupe_plan_points(points)
    unique = []
    points.each do |point|
      previous = unique.last
      unique << point if previous.nil? || Math.hypot(previous[0] - point[0], previous[1] - point[1]) > 1e-9
    end
    if unique.length > 1
      first = unique.first
      last = unique.last
      unique.pop if Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1e-9
    end
    unique
  end

  def beveled_rect_points(x, y, width, depth, bevel)
    return [[x, y], [x + width, y], [x + width, y + depth], [x, y + depth]] if bevel <= 0

    [
      [x + bevel, y],
      [x + width - bevel, y],
      [x + width, y + bevel],
      [x + width, y + depth - bevel],
      [x + width - bevel, y + depth],
      [x + bevel, y + depth],
      [x, y + depth - bevel],
      [x, y + bevel]
    ]
  end

  def add_recess(parent_entities, operation)
    name = operation.fetch('name')
    center = vector(operation['center'] || operation['origin'] || [0, 0, 0], "#{name}.center")
    width, depth = plan_size(operation.fetch('size'), "#{name}.size")
    recess_depth = positive_number(operation['depth'], nil, "#{name}.depth")
    radius = [non_negative_number(operation['radius'], 0, "#{name}.radius"), width / 2.0, depth / 2.0].min
    segments = integer_range(operation['segments'] || 5, 1, 32, "#{name}.segments")
    x, y, z = center
    points = rounded_rect_points(x - width / 2.0, y - depth / 2.0, width, depth, radius, segments)
    top = points.map { |px, py| [px, py, z] }
    bottom = points.map { |px, py| [px, py, z - recess_depth] }
    count = points.length
    faces = [(0...count).map { |index| count + count - 1 - index }]
    (0...count).each do |index|
      faces << [index, (index + 1) % count, count + ((index + 1) % count), count + index]
    end
    add_mesh(parent_entities, operation.merge('vertices' => top + bottom, 'faces' => faces, 'material' => operation['material'] || 'Recess_Dark', 'smooth' => operation['smooth'] || 'coplanar', 'kind' => 'recess'))
  end

  def add_engraved_line(parent_entities, operation)
    name = operation.fetch('name')
    points = operation.fetch('points')
    raise "#{name}.points must contain at least 2 [x, y, z] points" unless points.is_a?(Array) && points.length >= 2

    normalized_points = points.each_with_index.map { |point, index| vector(point, "#{name}.points[#{index}]") }
    line_width = positive_number(operation['width'], nil, "#{name}.width")
    line_depth = positive_number(operation['depth'], 1, "#{name}.depth")
    vertices = []
    faces = []
    (0...(normalized_points.length - 1)).each do |index|
      start_point = normalized_points[index]
      end_point = normalized_points[index + 1]
      dx = end_point[0] - start_point[0]
      dy = end_point[1] - start_point[1]
      length = Math.hypot(dx, dy)
      raise "#{name}.points[#{index}] and points[#{index + 1}] must not be identical in XY" if length <= 1e-9

      nx = (-dy / length) * (line_width / 2.0)
      ny = (dx / length) * (line_width / 2.0)
      z = start_point[2]
      base = vertices.length
      vertices.concat([
        [start_point[0] + nx, start_point[1] + ny, z], [end_point[0] + nx, end_point[1] + ny, z], [end_point[0] - nx, end_point[1] - ny, z], [start_point[0] - nx, start_point[1] - ny, z],
        [start_point[0] + nx, start_point[1] + ny, z - line_depth], [end_point[0] + nx, end_point[1] + ny, z - line_depth], [end_point[0] - nx, end_point[1] - ny, z - line_depth], [start_point[0] - nx, start_point[1] - ny, z - line_depth]
      ])
      faces.concat([[base + 4, base + 7, base + 6, base + 5], [base, base + 4, base + 5, base + 1], [base + 1, base + 5, base + 6, base + 2], [base + 2, base + 6, base + 7, base + 3], [base + 3, base + 7, base + 4, base]])
    end
    add_mesh(parent_entities, operation.merge('vertices' => vertices, 'faces' => faces, 'material' => operation['material'] || 'Groove_Dark', 'smooth' => operation['smooth'] || 'coplanar', 'kind' => 'engraved_line'))
  end


  def add_text_emboss(parent_entities, operation)
    name = operation.fetch('name')
    marker = text_marker_mesh(operation, name, 1)
    add_mesh(parent_entities, operation.merge('vertices' => marker[:vertices], 'faces' => marker[:faces], 'material' => operation['material'] || 'Text_Emboss_Light', 'smooth' => operation['smooth'] || 'coplanar', 'kind' => 'text_emboss'))
    group = parent_entities.grep(Sketchup::Group).last
    group.set_attribute('AlmaSketchupMCP', 'glyphs', marker[:glyphs]) if group&.respond_to?(:set_attribute)
  end

  def add_text_engrave(parent_entities, operation)
    name = operation.fetch('name')
    marker = text_marker_mesh(operation, name, -1)
    add_mesh(parent_entities, operation.merge('vertices' => marker[:vertices], 'faces' => marker[:faces], 'material' => operation['material'] || 'Text_Engrave_Dark', 'smooth' => operation['smooth'] || 'coplanar', 'kind' => 'text_engrave'))
    group = parent_entities.grep(Sketchup::Group).last
    group.set_attribute('AlmaSketchupMCP', 'glyphs', marker[:glyphs]) if group&.respond_to?(:set_attribute)
  end

  def text_marker_mesh(operation, name, direction)
    text = operation['text']
    raise "#{name}.text must be a non-empty string" unless text.is_a?(String) && !text.empty?

    anchor = vector(operation['center'] || operation['origin'] || [0, 0, 0], "#{name}.#{operation.key?('center') ? 'center' : 'origin'}")
    glyph_height = positive_number(operation['height'], nil, "#{name}.height")
    text_depth = positive_number(operation['depth'], 1, "#{name}.depth")
    spacing = non_negative_number(operation['spacing'], glyph_height * 0.2, "#{name}.spacing")
    glyph_width = positive_number(operation['width'], glyph_height * 0.6, "#{name}.width")
    align = operation['align'] || (operation.key?('center') ? 'center' : 'left')
    raise "#{name}.align must be one of left, center, right" unless %w[left center right].include?(align)

    characters = text.each_char.to_a
    total_width = (characters.length * glyph_width) + ([characters.length - 1, 0].max * spacing)
    start_x = case align
              when 'center' then anchor[0] - total_width / 2.0
              when 'right' then anchor[0] - total_width
              else anchor[0]
              end

    vertices = []
    faces = []
    cursor = start_x
    glyphs = 0
    characters.each do |character|
      unless character.match?(/\s/)
        z0 = direction.positive? ? anchor[2] : anchor[2] - text_depth
        base = vertices.length
        x0 = cursor
        x1 = cursor + glyph_width
        y0 = anchor[1]
        y1 = anchor[1] + glyph_height
        z1 = z0 + text_depth
        vertices.concat([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]])
        faces.concat([[base, base + 1, base + 2, base + 3], [base + 4, base + 7, base + 6, base + 5], [base, base + 4, base + 5, base + 1], [base + 1, base + 5, base + 6, base + 2], [base + 2, base + 6, base + 7, base + 3], [base + 3, base + 7, base + 4, base]])
        glyphs += 1
      end
      cursor += glyph_width + spacing
    end
    raise "#{name}.text must include at least one non-space character" if glyphs.zero?

    { vertices: vertices, faces: faces, glyphs: glyphs }
  end

  def add_slot(parent_entities, operation)
    name = operation.fetch('name')
    length = positive_number(operation['length'], nil, "#{name}.length")
    width = positive_number(operation['width'], nil, "#{name}.width")
    raise "#{name}.length must be greater than or equal to width" if length < width

    add_recess(parent_entities, operation.merge('size' => [length, width], 'radius' => width / 2.0, 'material' => operation['material'] || 'Slot_Dark', 'smooth' => operation['smooth'] || 'all', 'kind' => 'slot'))
    group = parent_entities.grep(Sketchup::Group).last
    annotate_group(group, { 'kind' => 'slot' }, 'slot') if group
  end

  def add_slot_array(parent_entities, operation)
    name = operation.fetch('name')
    count = integer_range(operation['count'], 1, 500, "#{name}.count")
    spacing = positive_number(operation['spacing'], nil, "#{name}.spacing")
    length = positive_number(operation['length'], nil, "#{name}.length")
    width = positive_number(operation['width'], nil, "#{name}.width")
    depth = positive_number(operation['depth'], nil, "#{name}.depth")
    raise "#{name}.length must be greater than or equal to width" if length < width

    direction = operation['direction'] || 'x'
    raise "#{name}.direction must be x or y" unless %w[x y].include?(direction)

    segments = integer_range(operation['segments'] || 8, 1, 16, "#{name}.segments")
    anchor = vector(operation['center'] || operation['origin'] || [0, 0, 0], "#{name}.#{operation.key?('center') ? 'center' : 'origin'}")
    start_offset = operation.key?('center') ? -((count - 1) * spacing) / 2.0 : 0
    vertices = []
    faces = []
    count.times do |index|
      offset = start_offset + (index * spacing)
      center = direction == 'x' ? [anchor[0] + offset, anchor[1], anchor[2]] : [anchor[0], anchor[1] + offset, anchor[2]]
      slot_vertices, slot_faces = slot_recess_mesh(center, length, width, depth, direction, segments)
      base = vertices.length
      vertices.concat(slot_vertices)
      faces.concat(slot_faces.map { |face| face.map { |face_index| face_index + base } })
    end
    add_mesh(parent_entities, operation.merge('vertices' => vertices, 'faces' => faces, 'material' => operation['material'] || 'Slot_Dark', 'smooth' => operation['smooth'] || 'all', 'kind' => 'slot_array'))
    group = parent_entities.grep(Sketchup::Group).last
    if group&.respond_to?(:set_attribute)
      group.set_attribute('AlmaSketchupMCP', 'count', count)
      group.set_attribute('AlmaSketchupMCP', 'segments', segments)
      group.set_attribute('AlmaSketchupMCP', 'direction', direction)
    end
  end

  def slot_recess_mesh(center, length, width, depth, direction, segments)
    x, y, z = center
    slot_width = direction == 'x' ? length : width
    slot_depth = direction == 'x' ? width : length
    points = rounded_rect_points(x - slot_width / 2.0, y - slot_depth / 2.0, slot_width, slot_depth, [slot_width, slot_depth].min / 2.0, segments)
    top = points.map { |px, py| [px, py, z] }
    bottom = points.map { |px, py| [px, py, z - depth] }
    point_count = points.length
    faces = [(0...point_count).map { |face_index| point_count + point_count - 1 - face_index }]
    (0...point_count).each do |face_index|
      faces << [face_index, (face_index + 1) % point_count, point_count + ((face_index + 1) % point_count), point_count + face_index]
    end
    [top + bottom, faces]
  end

  def add_rib(parent_entities, operation)
    name = operation.fetch('name')
    direction = operation['direction'] || 'x'
    raise "#{name}.direction must be x or y" unless %w[x y].include?(direction)

    length = positive_number(operation['length'], nil, "#{name}.length")
    height = positive_number(operation['height'], nil, "#{name}.height")
    thickness = positive_number(operation['thickness'], nil, "#{name}.thickness")
    size = direction == 'x' ? [length, thickness, height] : [thickness, length, height]
    add_box(parent_entities, operation.merge('size' => size, 'kind' => 'rib'))
    group = parent_entities.grep(Sketchup::Group).last
    annotate_group(group, { 'kind' => 'rib' }, 'rib') if group
  end

  def add_standoff_boss(parent_entities, operation)
    name = operation.fetch('name')
    center = vector(operation['center'] || operation['origin'] || [0, 0, 0], "#{name}.center")
    outer_radius = positive_number(operation['outer_radius'] || operation['outerRadius'], nil, "#{name}.outer_radius")
    inner_radius = positive_number(operation['inner_radius'] || operation['innerRadius'], nil, "#{name}.inner_radius")
    height = positive_number(operation['height'], nil, "#{name}.height")
    raise "#{name}.inner_radius must be smaller than outer_radius" if inner_radius >= outer_radius

    segments = integer_range(operation['segments'] || 16, 3, 96, "#{name}.segments")
    group = parent_entities.add_group
    group.name = name
    annotate_group(group, operation.merge('kind' => 'standoff_boss'), 'standoff_boss')
    add_cylinder(group.entities, 'name' => "#{name}_Outer_Post", 'origin' => center, 'radius' => outer_radius, 'height' => height, 'segments' => segments, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'all', 'kind' => 'standoff_boss_outer')
    add_cylinder(group.entities, 'name' => "#{name}_Hole_Marker", 'origin' => [center[0], center[1], center[2] + 0.2], 'radius' => inner_radius, 'height' => [height - 0.4, height * 0.8].max, 'segments' => segments, 'material' => operation['hole_material'] || operation['holeMaterial'] || 'Slot_Dark', 'smooth' => operation['smooth'] || 'all', 'kind' => 'standoff_boss_hole')
    group.set_attribute('AlmaSketchupMCP', 'segments', segments) if group.respond_to?(:set_attribute)
    apply_transform(group, operation)
    group
  end

  def add_button_on_panel(parent_entities, operation)
    name = operation.fetch('name')
    center = vector(operation['center'] || operation['origin'] || [0, 0, 0], "#{name}.center")
    height = positive_number(operation['height'], nil, "#{name}.height")
    segments = integer_range(operation['segments'] || 16, 3, 96, "#{name}.segments")
    x, y, z = center
    if operation.key?('size')
      width, depth = plan_size(operation['size'], "#{name}.size")
      corner_radius = operation['corner_radius'] || operation['cornerRadius'] || [width, depth].min / 2.0
      radius = [non_negative_number(corner_radius, 0, "#{name}.corner_radius"), width / 2.0, depth / 2.0].min
      add_rounded_box(parent_entities, operation.merge('origin' => [x - width / 2.0, y - depth / 2.0, z], 'size' => [width, depth, height], 'radius' => radius, 'segments' => segments, 'smooth' => operation['smooth'] || 'all', 'kind' => 'button_on_panel'))
    else
      add_cylinder(parent_entities, operation.merge('origin' => center, 'height' => height, 'segments' => segments, 'kind' => 'button_on_panel'))
    end
  end

  def plan_size(value, field_name)
    raise "#{field_name} must be [width, depth]" unless value.is_a?(Array) && value.length == 2

    size = value.each_with_index.map do |item, index|
      number = item.to_f
      raise "#{field_name}[#{index}] must be a finite number" unless number.finite?

      number
    end
    raise "#{field_name} values must be positive" if size.any? { |number| number <= 0 }

    size
  end

  def annotate_group(group, operation, fallback_kind)
    kind = operation['kind'] || operation['op'] || fallback_kind
    if group.respond_to?(:set_attribute)
      group.set_attribute('AlmaSketchupMCP', 'kind', kind) if kind
      qa = qa_metadata(operation)
      group.set_attribute('AlmaSketchupMCP', 'qa', JSON.generate(qa)) if qa
    end
    group
  end

  def group_kind(group)
    return nil unless group.respond_to?(:get_attribute)

    group.get_attribute('AlmaSketchupMCP', 'kind')
  end

  def entity_qa(entity)
    return nil unless entity.respond_to?(:get_attribute)

    raw = entity.get_attribute('AlmaSketchupMCP', 'qa')
    return nil if raw.nil? || raw.to_s.empty?

    JSON.parse(raw)
  rescue JSON::ParserError
    nil
  end

  def add_level(operation)
    name = operation.fetch('name')
    @levels ||= []
    level = {
      'name' => name,
      'elevation' => finite_number(operation['elevation'] || 0, "#{name}.elevation")
    }
    level['height'] = positive_number(operation['height'], nil, "#{name}.height") if operation.key?('height')
    @levels << level
    level
  end

  def add_floor_slab(parent_entities, operation)
    name = operation.fetch('name')
    origin = operation['origin'] || [0, 0, 0]
    width = positive_number(operation['width'], nil, "#{name}.width")
    depth = positive_number(operation['depth'], nil, "#{name}.depth")
    thickness = positive_number(operation['thickness'], 150, "#{name}.thickness")
    add_box(parent_entities, operation.merge('origin' => origin, 'size' => [width, depth, thickness]))
  end

  def add_wall(parent_entities, operation)
    name = operation.fetch('name')
    start_point = vector(operation.fetch('start'), "#{name}.start")
    end_point = vector(operation.fetch('end'), "#{name}.end")
    height = positive_number(operation['height'], nil, "#{name}.height")
    thickness = positive_number(operation['thickness'], 120, "#{name}.thickness")
    dx = end_point[0] - start_point[0]
    dy = end_point[1] - start_point[1]
    raise "#{name}.start and end must not be identical" if dx.zero? && dy.zero?
    raise "#{name} supports axis-aligned walls only in the MVP" if !dx.zero? && !dy.zero?

    if dx.abs >= dy.abs
      origin = [start_point[0], start_point[1], start_point[2]]
      origin[0] = [start_point[0], end_point[0]].min
      add_panel_with_openings(parent_entities, operation.merge('origin' => origin, 'plane' => 'xz', 'size' => [dx.abs, height], 'thickness' => thickness))
    else
      origin = [start_point[0], start_point[1], start_point[2]]
      origin[1] = [start_point[1], end_point[1]].min
      add_panel_with_openings(parent_entities, operation.merge('origin' => origin, 'plane' => 'yz', 'size' => [dy.abs, height], 'thickness' => thickness))
    end
  end

  def add_door(parent_entities, operation)
    add_vertical_panel(parent_entities, operation, 'door')
  end

  def add_window(parent_entities, operation)
    add_vertical_panel(parent_entities, operation, 'window')
  end

  def add_vertical_panel(parent_entities, operation, kind)
    name = operation.fetch('name')
    origin = operation['origin'] || [0, 0, 0]
    plane = operation['plane'] || 'xz'
    width = positive_number(operation['width'], nil, "#{name}.width")
    height = positive_number(operation['height'], nil, "#{name}.height")
    thickness = positive_number(operation['thickness'], kind == 'door' ? 40 : 24, "#{name}.thickness")
    if plane == 'xz'
      add_box(parent_entities, operation.merge('origin' => origin, 'size' => [width, thickness, height]))
    elsif plane == 'yz'
      add_box(parent_entities, operation.merge('origin' => origin, 'size' => [thickness, width, height]))
    else
      raise "#{name}.plane must be xz or yz"
    end
  end

  def add_stairs(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin")
    steps = integer_range(operation['steps'], 1, 200, "#{name}.steps")
    width = positive_number(operation['width'], nil, "#{name}.width")
    tread = positive_number(operation['tread_depth'] || operation['treadDepth'], nil, "#{name}.tread_depth")
    riser = positive_number(operation['riser_height'] || operation['riserHeight'], nil, "#{name}.riser_height")
    direction = operation['direction'] || 'y'
    x, y, z = origin
    steps.times do |index|
      step_name = "#{name}_Step_#{index + 1}"
      if direction == 'x'
        add_box(parent_entities, operation.merge('name' => step_name, 'origin' => [x + index * tread, y, z], 'size' => [tread, width, (index + 1) * riser], 'kind' => 'stair_step'))
      elsif direction == 'y'
        add_box(parent_entities, operation.merge('name' => step_name, 'origin' => [x, y + index * tread, z], 'size' => [width, tread, (index + 1) * riser], 'kind' => 'stair_step'))
      else
        raise "#{name}.direction must be x or y"
      end
    end
  end

  def add_railing(parent_entities, operation)
    name = operation.fetch('name')
    path = operation.fetch('path')
    raise "#{name}.path must contain at least 2 [x, y, z] points" unless path.is_a?(Array) && path.length >= 2

    points = path.each_with_index.map { |point, index| vector(point, "#{name}.path[#{index}]") }
    rail_height = positive_number(operation['height'], 900, "#{name}.height")
    rail_radius = positive_number(operation['rail_radius'] || operation['railRadius'], 40, "#{name}.rail_radius")
    post_radius = positive_number(operation['post_radius'] || operation['postRadius'], 35, "#{name}.post_radius")
    post_spacing = positive_number(operation['post_spacing'] || operation['postSpacing'], 900, "#{name}.post_spacing")
    rail_path = points.map { |x, y, z| [x, y, z + rail_height] }
    add_pipe_between_points(parent_entities, 'name' => "#{name}_Top_Rail", 'points' => rail_path, 'radius' => rail_radius, 'segments' => 8, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'all', 'kind' => 'railing_rail')
    points_along_polyline(points, post_spacing).each_with_index do |point, index|
      add_cylinder(parent_entities, 'name' => "#{name}_Post_#{index + 1}", 'origin' => point, 'radius' => post_radius, 'height' => rail_height, 'segments' => 8, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'all', 'kind' => 'railing_post')
    end
  end

  def points_along_polyline(path, spacing)
    points = [path.first]
    distance_since_post = 0.0
    path.each_cons(2) do |start_point, end_point|
      length = distance_between(start_point, end_point)
      cursor = spacing - distance_since_post
      while cursor < length
        t = cursor / length
        points << interpolate_point(start_point, end_point, t)
        cursor += spacing
      end
      distance_since_post = length - (cursor - spacing)
      distance_since_post = 0.0 if distance_since_post.abs < 1e-6
    end
    points << path.last if distance_between(points.last, path.last) > 1e-6
    points
  end

  def distance_between(a, b)
    Math.sqrt((b[0] - a[0])**2 + (b[1] - a[1])**2 + (b[2] - a[2])**2)
  end

  def interpolate_point(a, b, t)
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
  end

  def add_boolean_cutout(parent_entities, operation)
    name = operation.fetch('name')
    origin = operation['origin'] || [0, 0, 0]
    size = vector(operation.fetch('size'), "#{name}.size")
    raise "#{name}.size values must be positive" if size.any? { |value| value <= 0 }

    width, depth, thickness = size
    cutouts = normalize_boolean_cutouts(operation['cutouts'], width, depth, name)
    add_panel_with_openings(parent_entities, 'op' => 'boolean_cutout', 'name' => name, 'origin' => origin, 'plane' => 'xy', 'size' => [width, depth], 'thickness' => thickness, 'openings' => cutouts, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'coplanar', 'kind' => 'boolean_cutout')
  end

  def normalize_boolean_cutouts(cutouts, width, depth, name)
    raise "#{name}.cutouts must contain at least one cutout" unless cutouts.is_a?(Array) && cutouts.length.positive?

    cutouts.each_with_index.map do |cutout, index|
      raise "#{name}.cutouts[#{index}] must be an object" unless cutout.is_a?(Hash)

      size = cutout['size']
      raise "#{name}.cutouts[#{index}].size must be [width, depth]" unless size.is_a?(Array) && size.length == 2
      cutout_width = positive_number(size[0], nil, "#{name}.cutouts[#{index}].size[0]")
      cutout_depth = positive_number(size[1], nil, "#{name}.cutouts[#{index}].size[1]")
      center = cutout['center']
      raise "#{name}.cutouts[#{index}].center must be [x, y]" unless center.is_a?(Array) && center.length == 2
      center_x = center[0].to_f
      center_y = center[1].to_f
      raise "#{name}.cutouts[#{index}].center must contain finite numbers" unless center_x.finite? && center_y.finite?
      x = center_x - cutout_width / 2.0
      y = center_y - cutout_depth / 2.0
      raise "#{name}.cutouts[#{index}] must fit inside slab bounds" if x < 0 || y < 0 || x + cutout_width > width || y + cutout_depth > depth

      { 'name' => cutout['name'] || "Cutout_#{index + 1}", 'x' => x, 'y' => y, 'width' => cutout_width, 'height' => cutout_depth }
    end
  end


  def add_face_with_holes(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin").map { |value| mm_to_model_units(value) }
    plane = operation['plane'] || 'xy'
    outer = normalize_rect_profile(operation.fetch('outer'), "#{name}.outer")
    holes = (operation['holes'] || []).each_with_index.map { |hole, index| normalize_rect_profile(hole['points'] || hole, "#{name}.holes[#{index}]") }
    group = parent_entities.add_group
    group.name = name
    annotate_group(group, operation, 'face_with_holes')
    openings = holes.map.with_index { |hole, index| rect_opening_from_profile(outer, hole, index, name) }
    add_panel_face_with_holes(group.entities, origin, plane, normalize_outer_to_panel(outer), openings, false)
    material_name = operation['material']
    if material_name
      material = ensure_material(material_name, '#cccccc')
      group.entities.grep(Sketchup::Face).each { |face| face.material = material; face.back_material = material }
    end
    apply_transform(group, operation)
    group
  end

  def add_profile_extrude(parent_entities, operation)
    name = operation.fetch('name')
    plane = operation['plane'] || 'xy'
    outer = normalize_rect_profile(operation.fetch('outer'), "#{name}.outer")
    holes = (operation['holes'] || []).each_with_index.map { |hole, index| normalize_rect_profile(hole['points'] || hole, "#{name}.holes[#{index}]") }
    bounds = rect_profile_bounds(outer)
    openings = holes.map.with_index { |hole, index| rect_opening_from_profile(outer, hole, index, name) }
    origin = operation['origin'] || [0, 0, 0]
    panel_origin = profile_panel_origin(origin, plane, bounds)
    add_panel_with_openings(parent_entities, operation.merge('origin' => panel_origin, 'plane' => plane, 'size' => [bounds[:max_x] - bounds[:min_x], bounds[:max_y] - bounds[:min_y]], 'thickness' => operation.fetch('depth'), 'openings' => openings, 'kind' => 'profile_extrude'))
    group = parent_entities.grep(Sketchup::Group).last
    annotate_group(group, { 'kind' => 'profile_extrude' }, 'profile_extrude') if group
    apply_transform(group, operation) if group
    group
  end

  def normalize_rect_profile(points, field_name)
    raise "#{field_name} must be a 4-point rectangular profile" unless points.is_a?(Array) && points.length == 4

    normalized = points.each_with_index.map do |point, index|
      raise "#{field_name}[#{index}] must be [x, y]" unless point.is_a?(Array) && point.length == 2
      [finite_number(point[0], "#{field_name}[#{index}][0]"), finite_number(point[1], "#{field_name}[#{index}][1]")]
    end
    raise "#{field_name} must be axis-aligned rectangle points" unless normalized.map(&:first).uniq.length == 2 && normalized.map { |point| point[1] }.uniq.length == 2

    normalized
  end

  def rect_profile_bounds(points)
    xs = points.map(&:first)
    ys = points.map { |point| point[1] }
    { min_x: xs.min, max_x: xs.max, min_y: ys.min, max_y: ys.max }
  end

  def normalize_outer_to_panel(points)
    bounds = rect_profile_bounds(points)
    [[0, 0], [bounds[:max_x] - bounds[:min_x], 0], [bounds[:max_x] - bounds[:min_x], bounds[:max_y] - bounds[:min_y]], [0, bounds[:max_y] - bounds[:min_y]]]
  end

  def rect_opening_from_profile(outer, hole, index, name)
    outer_bounds = rect_profile_bounds(outer)
    hole_bounds = rect_profile_bounds(hole)
    if hole_bounds[:min_x] <= outer_bounds[:min_x] || hole_bounds[:min_y] <= outer_bounds[:min_y] || hole_bounds[:max_x] >= outer_bounds[:max_x] || hole_bounds[:max_y] >= outer_bounds[:max_y]
      raise "#{name}.holes[#{index}] must fit inside outer profile without touching boundary"
    end
    { 'name' => "Hole_#{index + 1}", 'x' => hole_bounds[:min_x] - outer_bounds[:min_x], 'y' => hole_bounds[:min_y] - outer_bounds[:min_y], 'width' => hole_bounds[:max_x] - hole_bounds[:min_x], 'height' => hole_bounds[:max_y] - hole_bounds[:min_y] }
  end

  def profile_panel_origin(origin, plane, bounds)
    case plane
    when 'xy' then [origin[0].to_f + bounds[:min_x], origin[1].to_f + bounds[:min_y], origin[2].to_f]
    when 'xz' then [origin[0].to_f + bounds[:min_x], origin[1].to_f, origin[2].to_f + bounds[:min_y]]
    when 'yz' then [origin[0].to_f, origin[1].to_f + bounds[:min_x], origin[2].to_f + bounds[:min_y]]
    else raise 'profile_extrude.plane must be one of xy, xz, yz'
    end
  end

  def add_panel_with_openings(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin").map { |value| mm_to_model_units(value) }
    plane = operation['plane'] || 'xz'
    raise "#{name}.plane must be one of xy, xz, yz" unless %w[xy xz yz].include?(plane)

    size = operation.fetch('size')
    raise "#{name}.size must be [width, height]" unless size.is_a?(Array) && size.length == 2

    width = positive_number(size[0], nil, "#{name}.size[0]")
    height = positive_number(size[1], nil, "#{name}.size[1]")
    thickness = positive_number(operation['thickness'], 120, "#{name}.thickness")
    model_thickness = mm_to_model_units(thickness)
    openings = validate_openings(operation['openings'] || [], width, height, name)

    group = parent_entities.add_group
    group.name = name
    annotate_group(group, operation, 'panel_with_openings')
    outer = [[0, 0], [width, 0], [width, height], [0, height]]
    front = add_panel_face_with_holes(group.entities, origin, plane, outer, openings, false)
    back_origin = offset_origin(origin, plane, model_thickness)
    back = add_panel_face_with_holes(group.entities, back_origin, plane, outer.reverse, openings, true)
    raise "Failed to create panel faces for #{name}" unless front && back

    add_panel_side_faces(group.entities, origin, plane, outer, model_thickness)
    openings.each do |opening|
      x = opening['x']; y = opening['y']; w = opening['width']; h = opening['height']
      hole = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
      add_panel_side_faces(group.entities, origin, plane, hole, model_thickness)
    end

    material_name = operation['material']
    if material_name
      material = ensure_material(material_name, '#cccccc')
      group.entities.grep(Sketchup::Face).each do |group_face|
        group_face.material = material
        group_face.back_material = material
      end
    end
    soften_edges(group, operation['smooth'] || 'coplanar')
    group
  end

  def add_panel_face_with_holes(entities, origin, plane, outer, openings, reverse_holes)
    face = entities.add_face(outer.map { |u, v| point_for_plane(origin, plane, mm_to_model_units(u), mm_to_model_units(v)) })
    return nil unless face

    openings.each do |opening|
      x = opening['x']; y = opening['y']; w = opening['width']; h = opening['height']
      hole = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
      hole.reverse! if reverse_holes
      hole_face = entities.add_face(hole.map { |u, v| point_for_plane(origin, plane, mm_to_model_units(u), mm_to_model_units(v)) })
      hole_face.erase! if hole_face && hole_face.valid?
    end
    face
  end

  def add_panel_side_faces(entities, origin, plane, loop, model_thickness)
    loop.each_with_index do |point, index|
      next_point = loop[(index + 1) % loop.length]
      p1 = point_for_plane(origin, plane, mm_to_model_units(point[0]), mm_to_model_units(point[1]))
      p2 = point_for_plane(origin, plane, mm_to_model_units(next_point[0]), mm_to_model_units(next_point[1]))
      p3 = offset_point(p2, plane, model_thickness)
      p4 = offset_point(p1, plane, model_thickness)
      entities.add_face(p1, p2, p3, p4)
    end
  end

  def validate_openings(openings, width, height, name)
    raise "#{name}.openings must be an array" unless openings.is_a?(Array)

    openings.each_with_index.map do |opening, index|
      raise "#{name}.openings[#{index}] must be an object" unless opening.is_a?(Hash)

      x = finite_number(opening['x'] || (opening['origin'] && opening['origin'][0]), "#{name}.openings[#{index}].x")
      y = finite_number(opening['y'] || opening['z'] || (opening['origin'] && opening['origin'][1]), "#{name}.openings[#{index}].y")
      opening_width = positive_number(opening['width'], nil, "#{name}.openings[#{index}].width")
      opening_height = positive_number(opening['height'], nil, "#{name}.openings[#{index}].height")
      if x.negative? || y.negative? || x + opening_width > width || y + opening_height > height
        raise "#{name}.openings[#{index}] must fit inside panel bounds"
      end
      { 'name' => opening['name'] || "Opening_#{index + 1}", 'x' => x, 'y' => y, 'width' => opening_width, 'height' => opening_height }
    end
  end

  def offset_origin(origin, plane, model_depth)
    x, y, z = origin
    case plane
    when 'xy'
      [x, y, z + model_depth]
    when 'xz'
      [x, y + model_depth, z]
    when 'yz'
      [x + model_depth, y, z]
    end
  end

  def offset_point(point, plane, model_depth)
    case plane
    when 'xy'
      Geom::Point3d.new(point.x, point.y, point.z + model_depth)
    when 'xz'
      Geom::Point3d.new(point.x, point.y + model_depth, point.z)
    when 'yz'
      Geom::Point3d.new(point.x + model_depth, point.y, point.z)
    end
  end

  def add_mesh(parent_entities, operation)
    name = operation.fetch('name')
    vertices = operation.fetch('vertices')
    faces = operation.fetch('faces')
    raise "#{name}.vertices must contain at least 3 [x, y, z] points" unless vertices.is_a?(Array) && vertices.length >= 3
    raise "#{name}.faces must contain at least one face index loop" unless faces.is_a?(Array) && faces.length.positive?

    points = vertices.each_with_index.map do |vertex, index|
      x, y, z = vector(vertex, "#{name}.vertices[#{index}]").map { |value| mm_to_model_units(value) }
      Geom::Point3d.new(x, y, z)
    end

    group = parent_entities.add_group
    group.name = name
    annotate_group(group, operation, 'mesh')
    faces.each_with_index do |face_indices, face_index|
      raise "#{name}.faces[#{face_index}] must contain at least 3 vertex indices" unless face_indices.is_a?(Array) && face_indices.length >= 3

      face_points = face_indices.each_with_index.map do |item, item_index|
        index = integer_index(item, "#{name}.faces[#{face_index}][#{item_index}]", points.length)
        points[index]
      end
      face = group.entities.add_face(face_points)
      raise "Failed to create face #{face_index} for #{name}" unless face
    end

    material_name = operation['material']
    if material_name
      material = ensure_material(material_name, '#cccccc')
      group.entities.grep(Sketchup::Face).each do |group_face|
        group_face.material = material
        group_face.back_material = material
      end
    end
    soften_edges(group, operation['smooth'])
    apply_transform(group, operation)
    group
  end

  def add_prism(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin").map { |value| mm_to_model_units(value) }
    plane = operation['plane'] || 'xy'
    raise "#{name}.plane must be one of xy, xz, yz" unless %w[xy xz yz].include?(plane)

    points = operation.fetch('points')
    raise "#{name}.points must contain at least 3 [u, v] pairs" unless points.is_a?(Array) && points.length >= 3

    depth = positive_number(operation['depth'], nil, "#{name}.depth")
    model_depth = mm_to_model_units(depth)
    group = parent_entities.add_group
    group.name = name
    annotate_group(group, operation, 'prism')
    face_points = points.each_with_index.map do |point, index|
      raise "#{name}.points[#{index}] must be [u, v]" unless point.is_a?(Array) && point.length == 2

      u = mm_to_model_units(finite_number(point[0], "#{name}.points[#{index}][0]"))
      v = mm_to_model_units(finite_number(point[1], "#{name}.points[#{index}][1]"))
      point_for_plane(origin, plane, u, v)
    end
    face = group.entities.add_face(face_points)
    raise "Failed to create face for #{name}" unless face

    normal_axis = { 'xy' => 2, 'xz' => 1, 'yz' => 0 }.fetch(plane)
    face.reverse! if face.normal.to_a[normal_axis] < 0
    face.pushpull(model_depth)

    material_name = operation['material']
    if material_name
      material = ensure_material(material_name, '#cccccc')
      group.entities.grep(Sketchup::Face).each do |group_face|
        group_face.material = material
        group_face.back_material = material
      end
    end
    group
  end

  def point_for_plane(origin, plane, u, v)
    x, y, z = origin
    case plane
    when 'xy'
      Geom::Point3d.new(x + u, y + v, z)
    when 'xz'
      Geom::Point3d.new(x + u, y, z + v)
    when 'yz'
      Geom::Point3d.new(x, y + u, z + v)
    end
  end


  def add_gable_roof(parent_entities, operation)
    name = operation.fetch('name')
    origin = operation['origin'] || [0, 0, 0]
    width = positive_number(operation['width'], nil, "#{name}.width")
    depth = positive_number(operation['depth'], nil, "#{name}.depth")
    rise = positive_number(operation['rise'], nil, "#{name}.rise")
    overhang = non_negative_number(operation['overhang'], 0, "#{name}.overhang")
    add_prism(parent_entities, 'name' => name, 'origin' => [origin[0].to_f - overhang, origin[1].to_f - overhang, origin[2].to_f], 'plane' => 'xz', 'points' => [[0, 0], [(width + 2 * overhang) / 2.0, rise], [width + 2 * overhang, 0]], 'depth' => depth + 2 * overhang, 'material' => operation['material'], 'kind' => 'gable_roof')
  end

  def add_shed_roof(parent_entities, operation)
    name = operation.fetch('name')
    origin = operation['origin'] || [0, 0, 0]
    width = positive_number(operation['width'], nil, "#{name}.width")
    depth = positive_number(operation['depth'], nil, "#{name}.depth")
    rise = positive_number(operation['rise'], nil, "#{name}.rise")
    overhang = non_negative_number(operation['overhang'], 0, "#{name}.overhang")
    x = origin[0].to_f - overhang; y = origin[1].to_f - overhang; z = origin[2].to_f
    w = width + 2 * overhang; d = depth + 2 * overhang; t = operation['thickness'] || 80
    add_mesh(parent_entities, 'name' => name, 'vertices' => [[x,y,z],[x+w,y,z+rise],[x+w,y+d,z+rise],[x,y+d,z],[x,y,z-t],[x+w,y,z+rise-t],[x+w,y+d,z+rise-t],[x,y+d,z-t]], 'faces' => [[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]], 'material' => operation['material'], 'smooth' => 'coplanar', 'kind' => 'shed_roof', 'qa' => operation['qa'])
  end

  def add_cylinder(parent_entities, operation)
    name = operation.fetch('name')
    origin = operation['origin'] || [0, 0, 0]
    radius = positive_number(operation['radius'], nil, "#{name}.radius")
    height = positive_number(operation['height'], nil, "#{name}.height")
    segments = integer_range(operation['segments'] || 16, 3, 96, "#{name}.segments")
    vertices = []
    segments.times do |i|
      angle = Math::PI * 2.0 * i / segments
      vertices << [origin[0].to_f + radius * Math.cos(angle), origin[1].to_f + radius * Math.sin(angle), origin[2].to_f]
    end
    segments.times { |i| vertices << [vertices[i][0], vertices[i][1], origin[2].to_f + height] }
    faces = []
    (1...(segments - 1)).each { |i| faces << [0, i + 1, i] }
    (1...(segments - 1)).each { |i| faces << [segments, segments + i, segments + i + 1] }
    segments.times { |i| faces << [i, (i + 1) % segments, segments + ((i + 1) % segments), segments + i] }
    add_mesh(parent_entities, 'name' => name, 'vertices' => vertices, 'faces' => faces, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'all', 'kind' => operation['kind'] || 'cylinder', 'qa' => operation['qa'])
  end

  def add_loft_between_profiles(parent_entities, operation)
    name = operation.fetch('name')
    profiles = operation.fetch('profiles')
    raise "#{name}.profiles must contain at least 2 profile sections" unless profiles.is_a?(Array) && profiles.length >= 2

    sections = profiles.each_with_index.map { |section, index| normalize_loft_profile_section(section, "#{name}.profiles[#{index}]") }
    point_count = sections.first.length
    raise "#{name}.profiles[0].points must contain at least 3 points" if point_count < 3
    sections.each_with_index do |section, index|
      raise "#{name}.profiles[#{index}].points must contain #{point_count} points to match the first profile" unless section.length == point_count
    end

    vertices = sections.flatten(1)
    faces = []
    (0...(sections.length - 1)).each do |ring|
      base = ring * point_count
      top = (ring + 1) * point_count
      point_count.times do |i|
        nxt = (i + 1) % point_count
        faces << [base + i, base + nxt, top + nxt]
        faces << [base + i, top + nxt, top + i]
      end
    end
    (1...(point_count - 1)).each { |i| faces << [0, i + 1, i] }
    top_start = (sections.length - 1) * point_count
    (1...(point_count - 1)).each { |i| faces << [top_start, top_start + i, top_start + i + 1] }
    add_mesh(parent_entities, 'name' => name, 'vertices' => vertices, 'faces' => faces, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'all', 'transform' => operation['transform'], 'kind' => operation['kind'] || 'loft_between_profiles', 'qa' => operation['qa'])
    group = parent_entities.grep(Sketchup::Group).last
    group.set_attribute('AlmaSketchupMCP', 'segments_z', sections.length - 1) if group&.respond_to?(:set_attribute)
  end

  def normalize_loft_profile_section(section, field_name)
    if section.is_a?(Array)
      return section.each_with_index.map { |point, index| vector(point, "#{field_name}[#{index}]") }
    end
    raise "#{field_name} must be an array of points or an object with points" unless section.is_a?(Hash)

    origin = vector(section['origin'] || [0, 0, 0], "#{field_name}.origin")
    points = section['points']
    raise "#{field_name}.points must contain at least 3 points" unless points.is_a?(Array) && points.length >= 3
    plane = section['plane'] || 'xy'
    raise "#{field_name}.plane must be one of xy, xz, yz" unless %w[xy xz yz].include?(plane)

    points.each_with_index.map do |point, index|
      raise "#{field_name}.points[#{index}] must be [u, v]" unless point.is_a?(Array) && point.length == 2

      u = point[0].to_f
      v = point[1].to_f
      raise "#{field_name}.points[#{index}] must contain finite numbers" unless u.finite? && v.finite?
      case plane
      when 'xy' then [origin[0] + u, origin[1] + v, origin[2]]
      when 'xz' then [origin[0] + u, origin[1], origin[2] + v]
      else [origin[0], origin[1] + u, origin[2] + v]
      end
    end
  end

  def add_shell_from_front_side_profiles(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin")
    front_profile = normalize_2d_profile(operation['front_profile'] || operation['frontProfile'], "#{name}.front_profile", 'x', 'z')
    side_profile = normalize_2d_profile(operation['side_profile'] || operation['sideProfile'], "#{name}.side_profile", 'z', 'half_depth').sort_by { |point| point[0] }
    raise "#{name}.front_profile must contain at least 3 [x, z] points" if front_profile.length < 3
    raise "#{name}.side_profile must contain at least 2 [z, half_depth] points" if side_profile.length < 2
    (1...side_profile.length).each do |index|
      raise "#{name}.side_profile z values must be strictly increasing" if side_profile[index][0] <= side_profile[index - 1][0]
    end
    side_profile.each_with_index do |point, index|
      raise "#{name}.side_profile[#{index}][1] must be non-negative" if point[1] < 0
    end

    ox, oy, oz = origin
    front_vertices = front_profile.map do |x, z|
      [ox + x, oy - shell_depth_at(side_profile, z, name), oz + z]
    end
    back_vertices = front_profile.map do |x, z|
      [ox + x, oy + shell_depth_at(side_profile, z, name), oz + z]
    end
    count = front_profile.length
    faces = []
    (1...(count - 1)).each { |i| faces << [0, i, i + 1] }
    (1...(count - 1)).each { |i| faces << [count, count + i + 1, count + i] }
    count.times do |i|
      nxt = (i + 1) % count
      faces << [i, nxt, count + nxt]
      faces << [i, count + nxt, count + i]
    end
    add_mesh(parent_entities, 'name' => name, 'vertices' => front_vertices + back_vertices, 'faces' => faces, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'all', 'transform' => operation['transform'], 'kind' => operation['kind'] || 'shell_from_front_side_profiles', 'qa' => operation['qa'])
    group = parent_entities.grep(Sketchup::Group).last
    group.set_attribute('AlmaSketchupMCP', 'segments', count) if group&.respond_to?(:set_attribute)
  end

  def normalize_2d_profile(profile, field_name, first_label, second_label)
    raise "#{field_name} must be an array of [#{first_label}, #{second_label}] pairs" unless profile.is_a?(Array)

    profile.each_with_index.map do |point, index|
      raise "#{field_name}[#{index}] must be [#{first_label}, #{second_label}]" unless point.is_a?(Array) && point.length == 2

      first = point[0].to_f
      second = point[1].to_f
      raise "#{field_name}[#{index}] must contain finite numbers" unless first.finite? && second.finite?
      [first, second]
    end
  end

  def shell_depth_at(side_profile, z, name)
    return side_profile.first[1] if z <= side_profile.first[0]
    return side_profile.last[1] if z >= side_profile.last[0]

    (0...(side_profile.length - 1)).each do |index|
      z0, depth0 = side_profile[index]
      z1, depth1 = side_profile[index + 1]
      if z >= z0 && z <= z1
        raise "#{name}.side_profile z values must be strictly increasing" if (z1 - z0).abs <= 1e-9

        t = (z - z0) / (z1 - z0)
        return depth0 + (depth1 - depth0) * t
      end
    end
    side_profile.last[1]
  end

  def add_face_on_cylinder(parent_entities, operation)
    name = operation.fetch('name')
    cylinder_center = vector(operation['cylinder_center'] || operation['cylinderCenter'] || [0, 0, 0], "#{name}.cylinder_center")
    surface_center = vector(operation.fetch('center'), "#{name}.center")
    radius = positive_number(operation['cylinder_radius'] || operation['cylinderRadius'], nil, "#{name}.cylinder_radius")
    width = positive_number(operation['width'], nil, "#{name}.width")
    height = positive_number(operation['height'], nil, "#{name}.height")
    depth = positive_number(operation['depth'], 1, "#{name}.depth")
    theta = operation.key?('angle') ? operation['angle'].to_f : Math.atan2(surface_center[1] - cylinder_center[1], surface_center[0] - cylinder_center[0])
    raise "#{name}.angle must be a finite number" unless theta.finite?

    radial = [Math.cos(theta), Math.sin(theta), 0]
    tangent = [-Math.sin(theta), Math.cos(theta), 0]
    center_on_surface = [cylinder_center[0] + radial[0] * radius, cylinder_center[1] + radial[1] * radius, surface_center[2]]
    half_width = width / 2.0
    half_height = height / 2.0
    make_point = lambda do |tangent_offset, z_offset, radial_offset|
      [center_on_surface[0] + tangent[0] * tangent_offset + radial[0] * radial_offset, center_on_surface[1] + tangent[1] * tangent_offset + radial[1] * radial_offset, center_on_surface[2] + z_offset]
    end
    vertices = [
      make_point.call(-half_width, -half_height, 0), make_point.call(half_width, -half_height, 0), make_point.call(half_width, half_height, 0), make_point.call(-half_width, half_height, 0),
      make_point.call(-half_width, -half_height, depth), make_point.call(half_width, -half_height, depth), make_point.call(half_width, half_height, depth), make_point.call(-half_width, half_height, depth)
    ]
    faces = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]
    add_mesh(parent_entities, 'name' => name, 'vertices' => vertices, 'faces' => faces, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'coplanar', 'transform' => operation['transform'], 'kind' => operation['kind'] || 'face_on_cylinder', 'qa' => operation['qa'])
  end

  def add_lofted_solid(parent_entities, operation)
    name = operation.fetch('name')
    origin = operation['origin'] || [0, 0, 0]
    profile = operation.fetch('profile')
    raise "#{name}.profile must contain at least 2 [height, radius] pairs" unless profile.is_a?(Array) && profile.length >= 2

    segments = integer_range(operation['n'] || operation['segments'] || 10, 3, 96, "#{name}.segments")
    ox, oy, oz = origin.map(&:to_f)
    vertices = []
    profile.each_with_index do |profile_point, index|
      raise "#{name}.profile[#{index}] must be [height, radius]" unless profile_point.is_a?(Array) && profile_point.length == 2

      height = non_negative_number(profile_point[0], nil, "#{name}.profile[#{index}][0]")
      radius = positive_number(profile_point[1], nil, "#{name}.profile[#{index}][1]")
      segments.times do |i|
        angle = Math::PI * 2.0 * i / segments
        vertices << [ox + radius * Math.cos(angle), oy + radius * Math.sin(angle), oz + height]
      end
    end
    faces = []
    (0...(profile.length - 1)).each do |ring|
      base = ring * segments
      top = (ring + 1) * segments
      segments.times do |i|
        nxt = (i + 1) % segments
        faces << [base + i, base + nxt, top + nxt]
        faces << [base + i, top + nxt, top + i]
      end
    end
    (1...(segments - 1)).each { |i| faces << [0, i + 1, i] }
    top_start = (profile.length - 1) * segments
    (1...(segments - 1)).each { |i| faces << [top_start, top_start + i, top_start + i + 1] }
    add_mesh(parent_entities, 'name' => name, 'vertices' => vertices, 'faces' => faces, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'all', 'transform' => operation['transform'], 'kind' => operation['kind'] || 'lofted_solid', 'qa' => operation['qa'])
  end

  def add_analog_stick(parent_entities, operation)
    name = operation.fetch('name')
    height = positive_number(operation['height'], 125, "#{name}.height")
    shaft_height = positive_number(operation['shaft_height'] || operation['shaftHeight'], height * 0.45, "#{name}.shaft_height")
    raise "#{name}.shaft_height must be lower than height" if shaft_height >= height

    base_radius = positive_number(operation['base_radius'] || operation['baseRadius'], 135, "#{name}.base_radius")
    shaft_radius = positive_number(operation['shaft_radius'] || operation['shaftRadius'], 92, "#{name}.shaft_radius")
    cap_radius = positive_number(operation['cap_radius'] || operation['capRadius'], 180, "#{name}.cap_radius")
    top_radius = positive_number(operation['top_radius'] || operation['topRadius'], [shaft_radius, cap_radius * 0.72].max, "#{name}.top_radius")
    profile = operation['profile'] || [[0, base_radius], [shaft_height, shaft_radius], [height * 0.72, cap_radius], [height, top_radius]]
    add_lofted_solid(parent_entities, operation.merge('profile' => profile, 'kind' => 'analog_stick'))
  end

  def add_screw_hole(parent_entities, operation)
    name = operation.fetch('name')
    center = vector(operation['center'] || operation['origin'] || [0, 0, 0], "#{name}.center")
    radius = positive_number(operation['radius'], nil, "#{name}.radius")
    depth = positive_number(operation['depth'], 6, "#{name}.depth")
    head_radius = operation.key?('head_radius') || operation.key?('headRadius') ? positive_number(operation['head_radius'] || operation['headRadius'], nil, "#{name}.head_radius") : radius
    head_depth = operation.key?('head_depth') || operation.key?('headDepth') ? positive_number(operation['head_depth'] || operation['headDepth'], nil, "#{name}.head_depth") : [depth, [1, depth * 0.45].max].min
    clamped_head_depth = [head_depth, depth].min
    profile = if head_radius > radius
                [[0, head_radius], [clamped_head_depth, radius], [depth, radius]]
              else
                [[0, radius], [depth, radius]]
              end
    add_lofted_solid(parent_entities, operation.merge('origin' => [center[0], center[1], center[2] - depth], 'profile' => profile, 'material' => operation['material'] || 'Hole_Dark', 'kind' => 'screw_hole'))
  end

  def add_pipe_between_points(parent_entities, operation)
    name = operation.fetch('name')
    raw_path = operation['points'] || operation['path'] || (operation['start'] && operation['end'] ? [operation['start'], operation['end']] : nil)
    raise "#{name}.points must contain at least 2 [x, y, z] points" unless raw_path.is_a?(Array) && raw_path.length >= 2

    points = raw_path.each_with_index.map { |point, index| vector(point, "#{name}.points[#{index}]") }
    radius = positive_number(operation['radius'], nil, "#{name}.radius")
    segments = integer_range(operation['n'] || operation['segments'] || 8, 3, 96, "#{name}.segments")
    vertices = []
    points.each_with_index do |point, index|
      tangent = pipe_tangent(points, index, name)
      u_axis, v_axis = perpendicular_frame(tangent)
      x, y, z = point
      segments.times do |i|
        angle = Math::PI * 2.0 * i / segments
        cos = Math.cos(angle) * radius
        sin = Math.sin(angle) * radius
        vertices << [x + u_axis[0] * cos + v_axis[0] * sin, y + u_axis[1] * cos + v_axis[1] * sin, z + u_axis[2] * cos + v_axis[2] * sin]
      end
    end

    faces = []
    (0...(points.length - 1)).each do |ring|
      base = ring * segments
      top = (ring + 1) * segments
      segments.times do |i|
        nxt = (i + 1) % segments
        faces << [base + i, base + nxt, top + nxt]
        faces << [base + i, top + nxt, top + i]
      end
    end
    (1...(segments - 1)).each { |i| faces << [0, i + 1, i] }
    top_start = (points.length - 1) * segments
    (1...(segments - 1)).each { |i| faces << [top_start, top_start + i, top_start + i + 1] }
    add_mesh(parent_entities, 'name' => name, 'vertices' => vertices, 'faces' => faces, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'all', 'transform' => operation['transform'], 'kind' => operation['kind'] || 'pipe_between_points', 'qa' => operation['qa'])
    group = parent_entities.grep(Sketchup::Group).last
    group.set_attribute('AlmaSketchupMCP', 'segments', segments) if group&.respond_to?(:set_attribute)
  end

  def pipe_tangent(points, index, name)
    previous_point = points[[index - 1, 0].max]
    next_point = points[[index + 1, points.length - 1].min]
    delta = [next_point[0] - previous_point[0], next_point[1] - previous_point[1], next_point[2] - previous_point[2]]
    length = Math.sqrt(delta[0] * delta[0] + delta[1] * delta[1] + delta[2] * delta[2])
    raise "#{name}.points must not contain repeated adjacent points" if length <= 1e-9

    delta.map { |value| value / length }
  end

  def perpendicular_frame(tangent)
    reference = tangent[2].abs < 0.9 ? [0, 0, 1] : [0, 1, 0]
    u_axis = normalize_3(cross_3(reference, tangent))
    v_axis = normalize_3(cross_3(tangent, u_axis))
    [u_axis, v_axis]
  end

  def cross_3(a, b)
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  end

  def normalize_3(values)
    length = Math.sqrt(values[0] * values[0] + values[1] * values[1] + values[2] * values[2])
    raise 'Cannot normalize zero-length vector' if length <= 1e-9

    values.map { |value| value / length }
  end

  def add_swept_path(parent_entities, operation)
    name = operation.fetch('name')
    path = operation.fetch('path')
    raise "#{name}.path must contain at least 2 [x, y, z] points" unless path.is_a?(Array) && path.length >= 2

    points = path.each_with_index.map { |point, index| vector(point, "#{name}.path[#{index}]") }
    radius = positive_number(operation['radius'], nil, "#{name}.radius")
    segments = integer_range(operation['n'] || operation['segments'] || 8, 3, 96, "#{name}.segments")
    vertices = []
    points.each do |x, y, z|
      segments.times do |i|
        angle = Math::PI * 2.0 * i / segments
        vertices << [x, y + radius * Math.cos(angle), z + radius * Math.sin(angle)]
      end
    end
    faces = []
    (0...(points.length - 1)).each do |ring|
      base = ring * segments
      top = (ring + 1) * segments
      segments.times do |i|
        nxt = (i + 1) % segments
        faces << [base + i, base + nxt, top + nxt]
        faces << [base + i, top + nxt, top + i]
      end
    end
    (1...(segments - 1)).each { |i| faces << [0, i + 1, i] }
    top_start = (points.length - 1) * segments
    (1...(segments - 1)).each { |i| faces << [top_start, top_start + i, top_start + i + 1] }
    add_mesh(parent_entities, 'name' => name, 'vertices' => vertices, 'faces' => faces, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'all', 'transform' => operation['transform'], 'kind' => operation['kind'] || 'swept_path', 'qa' => operation['qa'])
  end

  def add_domed_surface(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin")
    width = positive_number(operation['width'], nil, "#{name}.width")
    depth = positive_number(operation['depth'], nil, "#{name}.depth")
    thickness = positive_number(operation['thickness'], nil, "#{name}.thickness")
    crown = non_negative_number(operation['crown_height'] || operation['crownHeight'], 0, "#{name}.crown_height")
    x_segments = integer_range(operation['nx'] || operation['segments_x'] || 8, 1, 96, "#{name}.segments_x")
    y_segments = integer_range(operation['ny'] || operation['segments_y'] || 8, 1, 96, "#{name}.segments_y")
    x0, y0, z0 = origin
    cols = x_segments + 1
    bottom_index = lambda { |ix, iy| (iy * cols + ix) * 2 }
    top_index = lambda { |ix, iy| bottom_index.call(ix, iy) + 1 }
    vertices = []
    (0..y_segments).each do |iy|
      (0..x_segments).each do |ix|
        u = ix.to_f / x_segments
        v = iy.to_f / y_segments
        x = x0 + u * width
        y = y0 + v * depth
        du = (u - 0.5) * 2.0
        dv = (v - 0.5) * 2.0
        dome = crown * [0, 1 - du * du].max * [0, 1 - dv * dv].max
        vertices << [x, y, z0]
        vertices << [x, y, z0 + thickness + dome]
      end
    end
    faces = []
    (0...y_segments).each do |iy|
      (0...x_segments).each do |ix|
        faces << [top_index.call(ix, iy), top_index.call(ix + 1, iy), top_index.call(ix + 1, iy + 1)]
        faces << [top_index.call(ix, iy), top_index.call(ix + 1, iy + 1), top_index.call(ix, iy + 1)]
        faces << [bottom_index.call(ix, iy), bottom_index.call(ix + 1, iy + 1), bottom_index.call(ix + 1, iy)]
        faces << [bottom_index.call(ix, iy), bottom_index.call(ix, iy + 1), bottom_index.call(ix + 1, iy + 1)]
      end
    end
    add_grid_skirt_faces(faces, bottom_index, top_index, x_segments, y_segments)
    add_mesh(parent_entities, 'name' => name, 'vertices' => vertices, 'faces' => faces, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'all', 'transform' => operation['transform'], 'kind' => operation['kind'] || 'domed_surface', 'qa' => operation['qa'])
  end

  def add_bowed_panel(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin")
    width = positive_number(operation['width'], nil, "#{name}.width")
    height = positive_number(operation['height'], nil, "#{name}.height")
    thickness = positive_number(operation['thickness'], nil, "#{name}.thickness")
    bow_depth = finite_number(operation['bow_depth'] || operation['bowDepth'] || 0, "#{name}.bow_depth")
    raise "#{name}.thickness + bow_depth must stay positive" if thickness + [0, bow_depth].min <= 0

    x_segments = integer_range(operation['nx'] || operation['segments_x'] || 8, 1, 96, "#{name}.segments_x")
    z_segments = integer_range(operation['nz'] || operation['segments_z'] || 8, 1, 96, "#{name}.segments_z")
    x0, y0, z0 = origin
    cols = x_segments + 1
    front_index = lambda { |ix, iz| (iz * cols + ix) * 2 }
    back_index = lambda { |ix, iz| front_index.call(ix, iz) + 1 }
    vertices = []
    (0..z_segments).each do |iz|
      (0..x_segments).each do |ix|
        u = ix.to_f / x_segments
        v = iz.to_f / z_segments
        x = x0 + u * width
        z = z0 + v * height
        du = (u - 0.5) * 2.0
        dv = (v - 0.5) * 2.0
        bow = bow_depth * [0, 1 - du * du].max * [0, 1 - dv * dv].max
        vertices << [x, y0, z]
        vertices << [x, y0 + thickness + bow, z]
      end
    end
    faces = []
    (0...z_segments).each do |iz|
      (0...x_segments).each do |ix|
        faces << [front_index.call(ix, iz), front_index.call(ix + 1, iz + 1), front_index.call(ix + 1, iz)]
        faces << [front_index.call(ix, iz), front_index.call(ix, iz + 1), front_index.call(ix + 1, iz + 1)]
        faces << [back_index.call(ix, iz), back_index.call(ix + 1, iz), back_index.call(ix + 1, iz + 1)]
        faces << [back_index.call(ix, iz), back_index.call(ix + 1, iz + 1), back_index.call(ix, iz + 1)]
      end
    end
    add_grid_skirt_faces(faces, front_index, back_index, x_segments, z_segments)
    add_mesh(parent_entities, 'name' => name, 'vertices' => vertices, 'faces' => faces, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'all', 'transform' => operation['transform'], 'kind' => operation['kind'] || 'bowed_panel', 'qa' => operation['qa'])
  end

  def add_grid_skirt_faces(faces, lower_index, upper_index, x_segments, y_segments)
    (0...x_segments).each do |ix|
      faces << [lower_index.call(ix, 0), lower_index.call(ix + 1, 0), upper_index.call(ix + 1, 0)]
      faces << [lower_index.call(ix, 0), upper_index.call(ix + 1, 0), upper_index.call(ix, 0)]
      faces << [lower_index.call(ix, y_segments), upper_index.call(ix, y_segments), upper_index.call(ix + 1, y_segments)]
      faces << [lower_index.call(ix, y_segments), upper_index.call(ix + 1, y_segments), lower_index.call(ix + 1, y_segments)]
    end
    (0...y_segments).each do |iy|
      faces << [lower_index.call(0, iy), upper_index.call(0, iy), upper_index.call(0, iy + 1)]
      faces << [lower_index.call(0, iy), upper_index.call(0, iy + 1), lower_index.call(0, iy + 1)]
      faces << [lower_index.call(x_segments, iy), lower_index.call(x_segments, iy + 1), upper_index.call(x_segments, iy + 1)]
      faces << [lower_index.call(x_segments, iy), upper_index.call(x_segments, iy + 1), upper_index.call(x_segments, iy)]
    end
  end

  def add_component_definition(model, operation)
    name = operation.fetch('name')
    definition = model.definitions[name] || model.definitions.add(name)
    definition.entities.clear!

    if operation.key?('operations')
      operations = operation['operations']
      raise "#{name}.operations must be an array" unless operations.is_a?(Array)

      operations.each { |child_operation| apply_component_definition_operation(definition.entities, child_operation, name) }
      return
    end

    size = vector(operation['size'] || [1000, 1000, 1000], "#{name}.size")
    material = operation['material']
    add_box(definition.entities, 'name' => "#{name}_Geometry", 'origin' => [0, 0, 0], 'size' => size, 'material' => material)
  end

  def apply_component_definition_operation(entities, operation, component_name)
    case operation['op']
    when 'material'
      ensure_material(operation)
    when 'box'
      add_box(entities, operation)
    when 'rounded_box'
      add_rounded_box(entities, operation)
    when 'beveled_panel'
      add_beveled_panel(entities, operation)
    when 'fillet'
      add_fillet(entities, operation)
    when 'chamfer'
      add_chamfer(entities, operation)
    when 'recess'
      add_recess(entities, operation)
    when 'engraved_line'
      add_engraved_line(entities, operation)
    when 'text_emboss'
      add_text_emboss(entities, operation)
    when 'text_engrave'
      add_text_engrave(entities, operation)
    when 'slot'
      add_slot(entities, operation)
    when 'slot_array'
      add_slot_array(entities, operation)
    when 'rib'
      add_rib(entities, operation)
    when 'standoff_boss'
      add_standoff_boss(entities, operation)
    when 'button_on_panel'
      add_button_on_panel(entities, operation)
    when 'floor_slab'
      add_floor_slab(entities, operation)
    when 'wall'
      add_wall(entities, operation)
    when 'door'
      add_door(entities, operation)
    when 'window'
      add_window(entities, operation)
    when 'stairs'
      add_stairs(entities, operation)
    when 'railing'
      add_railing(entities, operation)
    when 'panel_with_openings'
      add_panel_with_openings(entities, operation)
    when 'boolean_cutout'
      add_boolean_cutout(entities, operation)
    when 'mesh'
      add_mesh(entities, operation)
    when 'prism'
      add_prism(entities, operation)
    when 'face_with_holes'
      add_face_with_holes(entities, operation)
    when 'profile_extrude'
      add_profile_extrude(entities, operation)
    when 'gable_roof'
      add_gable_roof(entities, operation)
    when 'shed_roof'
      add_shed_roof(entities, operation)
    when 'cylinder'
      add_cylinder(entities, operation)
    when 'loft_between_profiles'
      add_loft_between_profiles(entities, operation)
    when 'shell_from_front_side_profiles'
      add_shell_from_front_side_profiles(entities, operation)
    when 'lofted_solid'
      add_lofted_solid(entities, operation)
    when 'face_on_cylinder'
      add_face_on_cylinder(entities, operation)
    when 'analog_stick'
      add_analog_stick(entities, operation)
    when 'screw_hole'
      add_screw_hole(entities, operation)
    when 'pipe_between_points'
      add_pipe_between_points(entities, operation)
    when 'swept_path'
      add_swept_path(entities, operation)
    when 'domed_surface'
      add_domed_surface(entities, operation)
    when 'bowed_panel'
      add_bowed_panel(entities, operation)
    else
      raise "#{component_name}.operations does not support op: #{operation['op']}"
    end
  end

  def add_component_instance(model, operation)
    name = operation.fetch('name')
    definition = model.definitions[operation.fetch('definition')]
    raise "#{name}.definition not found: #{operation['definition']}" unless definition

    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin").map { |value| mm_to_model_units(value) }
    transform = operation['transform'] || {}
    rotate_z = transform['rotateZ'] || transform['rotationZ'] || operation['rotateZ']
    rotation = rotate_z ? Geom::Transformation.rotation(ORIGIN, Z_AXIS, rotate_z.to_f.degrees) : Geom::Transformation.new
    instance = model.entities.add_instance(definition, rotation)
    instance.name = name
    qa = qa_metadata(operation)
    instance.set_attribute('AlmaSketchupMCP', 'qa', JSON.generate(qa)) if qa && instance.respond_to?(:set_attribute)
    translate = transform['translate'] || transform['translation'] || operation['translation'] || [0, 0, 0]
    extra_translate = vector(translate, "#{name}.transform.translate").map { |value| mm_to_model_units(value) }
    instance.transform!(Geom::Transformation.translation([
      origin[0] + extra_translate[0],
      origin[1] + extra_translate[1],
      origin[2] + extra_translate[2]
    ]))
    instance
  end

  def apply_transform(entity, operation)
    transform = operation['transform'] || {}
    translate = transform['translate'] || transform['translation'] || operation['translation']
    if translate
      vector_translate = vector(translate, "#{operation['name']}.transform.translate").map { |value| mm_to_model_units(value) }
      entity.transform!(Geom::Transformation.translation(vector_translate))
    end
    rotate_z = transform['rotateZ'] || transform['rotationZ'] || operation['rotateZ']
    return entity unless rotate_z

    angle = rotate_z.to_f.degrees
    entity.transform!(Geom::Transformation.rotation(ORIGIN, Z_AXIS, angle))
    entity
  end

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

  def add_demo_room(entities, operation)
    width = positive_number(operation['width'], 4500, 'room.width')
    depth = positive_number(operation['depth'], 3000, 'room.depth')
    height = positive_number(operation['height'], 2400, 'room.height')
    wall_thickness = positive_number(operation['wall_thickness'] || operation['wallThickness'], 120, 'room.wall_thickness')
    floor_thickness = positive_number(operation['floor_thickness'] || operation['floorThickness'], 100, 'room.floor_thickness')
    name = operation['name'] || 'Demo_Room'

    ensure_material('Floor_Oak', '#a87945')
    ensure_material('Wall_Paint', '#efe7dc')
    ensure_material('Door_Wood', '#7a4a2b')
    ensure_material('Window_Glass', '#8ecae6')
    ensure_material('Table_Wood', '#9b6b43')
    ensure_material('Chair_Fabric', '#315c8a')

    add_box(entities, 'name' => "#{name}_Floor", 'origin' => [0, 0, 0], 'size' => [width, depth, floor_thickness], 'material' => 'Floor_Oak')

    door_width = 900.0
    door_height = 2100.0
    door_x = (width - door_width) / 2.0
    wall_z = floor_thickness

    add_box(entities, 'name' => "#{name}_Wall_South_Left", 'origin' => [0, -wall_thickness, wall_z], 'size' => [door_x, wall_thickness, height], 'material' => 'Wall_Paint')
    add_box(entities, 'name' => "#{name}_Wall_South_Right", 'origin' => [door_x + door_width, -wall_thickness, wall_z], 'size' => [width - door_x - door_width, wall_thickness, height], 'material' => 'Wall_Paint')
    add_box(entities, 'name' => "#{name}_Wall_South_Header", 'origin' => [door_x, -wall_thickness, wall_z + door_height], 'size' => [door_width, wall_thickness, height - door_height], 'material' => 'Wall_Paint')
    add_box(entities, 'name' => "#{name}_Door_Panel", 'origin' => [door_x + 25, -wall_thickness - 25, wall_z], 'size' => [door_width - 50, 25, door_height], 'material' => 'Door_Wood')
    add_box(entities, 'name' => "#{name}_Wall_North", 'origin' => [0, depth, wall_z], 'size' => [width, wall_thickness, height], 'material' => 'Wall_Paint')
    add_box(entities, 'name' => "#{name}_Wall_West", 'origin' => [-wall_thickness, 0, wall_z], 'size' => [wall_thickness, depth, height], 'material' => 'Wall_Paint')
    add_box(entities, 'name' => "#{name}_Wall_East", 'origin' => [width, 0, wall_z], 'size' => [wall_thickness, depth, height], 'material' => 'Wall_Paint')
    add_box(entities, 'name' => "#{name}_Window_North_Glass", 'origin' => [width * 0.58, depth + wall_thickness + 6, wall_z + 1050], 'size' => [1050, 12, 750], 'material' => 'Window_Glass')

    table_x = width / 2.0 - 600
    table_y = depth / 2.0 - 400
    add_box(entities, 'name' => "#{name}_Table_Top", 'origin' => [table_x, table_y, 750], 'size' => [1200, 800, 75], 'material' => 'Table_Wood')
    [[0, 0], [1100, 0], [0, 700], [1100, 700]].each_with_index do |leg, index|
      add_box(entities, 'name' => "#{name}_Table_Leg_#{index + 1}", 'origin' => [table_x + leg[0], table_y + leg[1], 100], 'size' => [100, 100, 650], 'material' => 'Table_Wood')
    end
    add_box(entities, 'name' => "#{name}_Chair_Seat", 'origin' => [table_x + 300, table_y - 550, 450], 'size' => [600, 500, 75], 'material' => 'Chair_Fabric')
    add_box(entities, 'name' => "#{name}_Chair_Back", 'origin' => [table_x + 300, table_y - 600, 525], 'size' => [600, 75, 700], 'material' => 'Chair_Fabric')
    add_box(entities, 'name' => "#{name}_Chair_Leg_1", 'origin' => [table_x + 350, table_y - 500, 100], 'size' => [75, 75, 350], 'material' => 'Chair_Fabric')
    add_box(entities, 'name' => "#{name}_Chair_Leg_2", 'origin' => [table_x + 775, table_y - 500, 100], 'size' => [75, 75, 350], 'material' => 'Chair_Fabric')
    add_box(entities, 'name' => "#{name}_Chair_Leg_3", 'origin' => [table_x + 350, table_y - 150, 100], 'size' => [75, 75, 350], 'material' => 'Chair_Fabric')
    add_box(entities, 'name' => "#{name}_Chair_Leg_4", 'origin' => [table_x + 775, table_y - 150, 100], 'size' => [75, 75, 350], 'material' => 'Chair_Fabric')

    add_warning('info.limitation', 'info', 'Door opening is represented by segmented wall boxes in the MVP DSL.', 'demo_room')
    add_warning('info.limitation', 'info', 'Window is represented as glass marker geometry; true boolean wall cuts are left for refinement.', 'demo_room')
  end

  def snapshot
    model = Sketchup.active_model
    groups = model.entities.grep(Sketchup::Group).map do |group|
      bounds = group.bounds
      {
        'name' => group.name,
        'kind' => group_kind(group),
        'faces' => count_faces(group.entities),
        'edges' => count_edges(group.entities),
        'vertices' => count_vertices(group.entities),
        'bounding_box' => bounds_hash(bounds),
        'material' => first_entities_material(group.entities),
        'qa' => entity_qa(group)
      }
    end
    instances = model.entities.grep(Sketchup::ComponentInstance).map do |instance|
      {
        'name' => instance.name,
        'definition' => instance.definition.name,
        'faces' => count_faces(instance.definition.entities),
        'edges' => count_edges(instance.definition.entities),
        'vertices' => count_vertices(instance.definition.entities),
        'bounding_box' => bounds_hash(instance.bounds),
        'material' => first_entities_material(instance.definition.entities),
        'qa' => entity_qa(instance)
      }
    end
    visible_items = groups + instances
    totals = visible_items.each_with_object({ 'faces' => 0, 'edges' => 0, 'vertices' => 0, 'groups' => groups.length, 'instances' => instances.length }) do |item, acc|
      acc['faces'] += item['faces']
      acc['edges'] += item['edges']
      acc['vertices'] += (item['vertices'] || 0)
    end
    all_warnings = snapshot_warnings(visible_items)
    {
      'totals' => totals,
      'groups' => groups,
      'instances' => instances,
      'component_definitions' => model.definitions.reject { |definition| sketchup_group_definition?(definition) || definition.name.empty? }.map(&:name).sort,
      'scenes' => @scenes || [],
      'levels' => @levels || [],
      'materials' => model.materials.map { |material| material_snapshot(material) }.sort_by { |material| material['name'] },
      'material_names' => model.materials.map(&:name).reject(&:empty?).sort,
      'style_state' => @style_state,
      'shadow_state' => @shadow_state,
      'rendering_options' => @rendering_options_state,
      'bounding_box' => bounds_hash(model.bounds),
      'warnings' => all_warnings,
      'warning_messages' => all_warnings.map { |w| w['message'] },
      'warning_summary' => warning_summary(all_warnings),
      'view_state' => @view_state
    }
  end


  def sketchup_group_definition?(definition)
    definition.respond_to?(:group?) && definition.group?
  end

  def snapshot_warnings(groups)
    warnings = (@warnings || []).dup
    groups.each do |group|
      if group['faces'].zero?
        warnings << {
          'type' => 'geometry.degenerate',
          'severity' => 'error',
          'category' => 'geometry',
          'message' => "#{group['name']} has zero faces",
          'source' => "group:#{group['name']}"
        }
      end
    end
    groups.each_with_index do |group, index|
      groups[(index + 1)..].to_a.each do |other|
        if boxes_intersect?(group['bounding_box'], other['bounding_box'])
          warnings << {
            'type' => 'geometry.bbox_overlap',
            'severity' => 'warn',
            'category' => 'geometry',
            'message' => "Bounding boxes overlap: #{group['name']} intersects #{other['name']}",
            'source' => "group:#{group['name']};#{other['name']}"
          }
        end
      end
    end
    warnings
  end

  def warning_summary(warnings)
    summary = { 'total' => warnings.length, 'by_severity' => { 'error' => 0, 'warn' => 0, 'info' => 0 }, 'by_category' => {} }
    warnings.each do |w|
      summary['by_severity'][w['severity']] = (summary['by_severity'][w['severity']] || 0) + 1
      summary['by_category'][w['category']] = (summary['by_category'][w['category']] || 0) + 1
    end
    summary
  end

  def boxes_intersect?(a, b)
    a['min'][0] < b['max'][0] && a['max'][0] > b['min'][0] &&
      a['min'][1] < b['max'][1] && a['max'][1] > b['min'][1] &&
      a['min'][2] < b['max'][2] && a['max'][2] > b['min'][2]
  end

  def bounds_hash(bounds)
    min = bounds.min
    max = bounds.max
    {
      'min' => [model_units_to_mm(min.x), model_units_to_mm(min.y), model_units_to_mm(min.z)],
      'max' => [model_units_to_mm(max.x), model_units_to_mm(max.y), model_units_to_mm(max.z)],
      'w' => model_units_to_mm(max.x - min.x),
      'd' => model_units_to_mm(max.y - min.y),
      'h' => model_units_to_mm(max.z - min.z)
    }
  end

  def mm_to_model_units(value)
    value.to_f / MM_PER_INCH
  end

  def model_units_to_mm(value)
    (value.to_f * MM_PER_INCH).round(6)
  end

  def first_group_material(group)
    first_entities_material(group.entities)
  end

  def count_faces(entities)
    entities.grep(Sketchup::Face).length + entities.grep(Sketchup::Group).sum { |group| count_faces(group.entities) }
  end

  def count_edges(entities)
    entities.grep(Sketchup::Edge).length + entities.grep(Sketchup::Group).sum { |group| count_edges(group.entities) }
  end

  def count_vertices(entities)
    points = {}
    entities.grep(Sketchup::Edge).each do |edge|
      edge.vertices.each do |vertex|
        position = vertex.position
        key = [position.x, position.y, position.z].map { |value| model_units_to_mm(value) }.join(',')
        points[key] = true
      end
    end
    points.length + entities.grep(Sketchup::Group).sum { |group| count_vertices(group.entities) }
  end

  def first_entities_material(entities)
    face = entities.grep(Sketchup::Face).find { |item| item.material || item.back_material }
    material = face && (face.material || face.back_material)
    return material.name if material

    nested_group = entities.grep(Sketchup::Group).find { |group| first_entities_material(group.entities) }
    nested_group && first_entities_material(nested_group.entities)
  end

  def material_snapshot(material)
    snapshot = {
      'name' => material.name,
      'color' => color_to_hex(material.color)
    }
    snapshot['alpha'] = material.alpha if material.respond_to?(:alpha)
    snapshot['texture'] = texture_snapshot(material.texture) if material.respond_to?(:texture) && material.texture
    if supports_pbr_materials?
      snapshot['workflow'] = material.workflow == Sketchup::Material::WORKFLOW_PBR_METALLIC_ROUGHNESS ? 'pbr_metallic_roughness' : 'classic' if material.respond_to?(:workflow)
      pbr = {}
      pbr['metallic_factor'] = material.metallic_factor if material.respond_to?(:metallic_factor)
      pbr['roughness_factor'] = material.roughness_factor if material.respond_to?(:roughness_factor)
      pbr['ao_strength'] = material.ao_strength if material.respond_to?(:ao_strength)
      pbr['normal_scale'] = material.normal_scale if material.respond_to?(:normal_scale)
      pbr['normal_style'] = material.normal_style == Sketchup::Material::NORMAL_STYLE_DIRECTX ? 'directx' : 'opengl' if material.respond_to?(:normal_style)
      textures = {
        'metallic' => material_texture_path(material, :metallic_texture),
        'roughness' => material_texture_path(material, :roughness_texture),
        'normal' => material_texture_path(material, :normal_texture),
        'ao' => material_texture_path(material, :ao_texture),
        'opacity' => material_texture_path(material, :opacity_texture)
      }.compact
      pbr['textures'] = textures unless textures.empty?
      snapshot['pbr'] = pbr unless pbr.empty?
    end
    snapshot
  end

  def color_to_hex(color)
    '#%02x%02x%02x' % [color.red, color.green, color.blue]
  end

  def texture_snapshot(texture)
    snapshot = { 'path' => texture.filename }
    snapshot['width'] = model_units_to_mm(texture.width) if texture.respond_to?(:width)
    snapshot['height'] = model_units_to_mm(texture.height) if texture.respond_to?(:height)
    snapshot
  end

  def material_texture_path(material, getter)
    return nil unless material.respond_to?(getter)

    texture = material.public_send(getter)
    return nil unless texture

    texture.respond_to?(:filename) ? texture.filename : texture.to_s
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
