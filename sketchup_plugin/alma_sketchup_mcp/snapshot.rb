# frozen_string_literal: true

module AlmaSketchupMCP
  extend self

  def snapshot
    model = active_model_or_new('snapshot')
    groups = model.entities.grep(Sketchup::Group).map do |group|
      bounds = group.bounds
      {
        'id' => entity_id(group) || group.name,
        'persistent_id' => entity_persistent_id(group),
        'name' => group.name,
        'kind' => group_kind(group),
        'faces' => count_faces(group.entities),
        'edges' => count_edges(group.entities),
        'vertices' => count_vertices(group.entities),
        'bounding_box' => bounds_hash(bounds),
        'material' => first_entities_material(group.entities),
        'tag' => entity_tag_name(group),
        'classification' => entity_classification(group),
        'texture_transform' => entity_texture_transform(group),
        'image' => group.respond_to?(:get_attribute) ? group.get_attribute('AlmaSketchupMCP', 'image') : nil,
        'attributes' => entity_attributes(group),
        'features' => entity_features(group),
        'boolean_operations' => entity_boolean_operations(group),
        'manifold' => entity_manifold_report(group),
        'transform' => entity_object_transform(group),
        'visible' => group.respond_to?(:hidden?) ? !group.hidden? : true,
        'qa' => entity_qa(group)
      }
    end
    instances = model.entities.grep(Sketchup::ComponentInstance).map do |instance|
      {
        'id' => entity_id(instance) || instance.name,
        'persistent_id' => entity_persistent_id(instance),
        'name' => instance.name,
        'definition' => instance.definition.name,
        'faces' => count_faces(instance.definition.entities),
        'edges' => count_edges(instance.definition.entities),
        'vertices' => count_vertices(instance.definition.entities),
        'bounding_box' => bounds_hash(instance.bounds),
        'material' => first_entities_material(instance.definition.entities),
        'tag' => entity_tag_name(instance),
        'classification' => entity_classification(instance),
        'texture_transform' => entity_texture_transform(instance),
        'attributes' => entity_attributes(instance),
        'features' => entity_features(instance),
        'boolean_operations' => entity_boolean_operations(instance),
        'manifold' => entity_manifold_report(instance),
        'transform' => entity_object_transform(instance),
        'visible' => instance.respond_to?(:hidden?) ? !instance.hidden? : true,
        'qa' => entity_qa(instance)
      }
    end
    visible_groups = groups.reject { |group| group['visible'] == false }
    visible_instances = instances.reject { |instance| instance['visible'] == false }
    visible_items = visible_groups + visible_instances
    totals = visible_items.each_with_object({ 'faces' => 0, 'edges' => 0, 'vertices' => 0, 'groups' => visible_groups.length, 'instances' => visible_instances.length }) do |item, acc|
      acc['faces'] += item['faces']
      acc['edges'] += item['edges']
      acc['vertices'] += (item['vertices'] || 0)
    end
    all_warnings = snapshot_warnings(visible_items)
    {
      'totals' => totals,
      'groups' => groups,
      'instances' => instances,
      'manifold_checks' => @manifold_checks || [],
      'component_definitions' => model.definitions.reject { |definition| sketchup_group_definition?(definition) || sketchup_temp_definition?(definition) || definition.name.empty? }.map(&:name).sort,
      'scenes' => @scenes || [],
      'levels' => @levels || [],
      'tags' => model.layers.reject { |layer| layer.name.to_s.empty? || %w[Untagged Layer0].include?(layer.name) }.map { |layer| tag_snapshot(layer) }.sort_by { |tag| tag['name'] },
      'materials' => model.materials.map { |material| material_snapshot(material) }.sort_by { |material| material['name'] },
      'material_names' => model.materials.map(&:name).reject(&:empty?).sort,
      'style_state' => @style_state,
      'shadow_state' => @shadow_state,
      'rendering_options' => @rendering_options_state,
      'bounding_box' => merge_bounds_hashes(visible_items.map { |item| item['bounding_box'] }),
      'warnings' => all_warnings,
      'warning_messages' => all_warnings.map { |w| w['message'] },
      'warning_summary' => warning_summary(all_warnings),
      'view_state' => @view_state
    }
  end


  def sketchup_group_definition?(definition)
    definition.respond_to?(:group?) && definition.group?
  end

  def sketchup_temp_definition?(definition)
    definition.name.to_s.match?(/\ATempInstance#\d+\z/)
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

  def merge_bounds_hashes(boxes)
    valid_boxes = boxes.compact
    return { 'min' => [0, 0, 0], 'max' => [0, 0, 0], 'w' => 0, 'd' => 0, 'h' => 0 } if valid_boxes.empty?

    min = [Float::INFINITY, Float::INFINITY, Float::INFINITY]
    max = [-Float::INFINITY, -Float::INFINITY, -Float::INFINITY]
    valid_boxes.each do |box|
      3.times do |axis|
        min[axis] = [min[axis], box['min'][axis]].min
        max[axis] = [max[axis], box['max'][axis]].max
      end
    end
    { 'min' => min, 'max' => max, 'w' => max[0] - min[0], 'd' => max[1] - min[1], 'h' => max[2] - min[2] }
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

  def tag_snapshot(layer)
    snapshot = { 'name' => layer.name }
    snapshot['color'] = color_to_hex(layer.color) if layer.respond_to?(:color) && layer.color
    snapshot['visible'] = layer.visible? if layer.respond_to?(:visible?)
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

end
