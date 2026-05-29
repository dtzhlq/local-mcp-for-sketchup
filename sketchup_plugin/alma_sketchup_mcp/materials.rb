# frozen_string_literal: true

module AlmaSketchupMCP
  extend self

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
    materials = active_model_or_new('ensure_material').materials
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

  def image_plane_material(operation, name, width, height)
    if operation['material']
      return ensure_material(operation['material'], '#ffffff')
    end
    image_path = operation['image'] || operation['texture']
    spec = {
      'name' => "#{name}_Image_Material",
      'color' => '#ffffff'
    }
    spec['alpha'] = operation['alpha'] if operation.key?('alpha')
    spec['texture'] = { 'path' => image_path, 'width' => model_units_to_mm(width), 'height' => model_units_to_mm(height) } if image_path
    ensure_material(spec, '#ffffff')
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
end
