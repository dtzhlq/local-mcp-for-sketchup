# frozen_string_literal: true

module AlmaSketchupMCP
  extend self

  def snapshot(model = nil, include_detail_evidence: true)
    model ||= active_model_or_new('snapshot')
    state = document_state(model)
    classification_schemas = classification_schema_catalog(model)
    native_classification_by_definition = {}
    native_classification_for = lambda do |definition|
      next nil unless definition

      native_classification_by_definition[definition.object_id] ||= native_definition_classification_summary(definition, classification_schemas)
    end
    component_definition_summaries = model.definitions.reject { |definition| sketchup_temp_definition?(definition) }.map do |definition|
      {
        'name' => definition.name.to_s,
        'persistent_id' => entity_persistent_id(definition),
        'native_classification' => native_classification_for.call(definition)
      }
    end.sort_by { |summary| [summary['name'], summary['persistent_id'].to_s] }
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
        'native_classification' => native_classification_for.call(group.definition),
        'texture_transform' => entity_texture_transform(group),
        'face_uvs' => entity_face_uvs(group),
        'geometry_input' => entity_geometry_input(group),
        'image' => group.respond_to?(:get_attribute) ? group.get_attribute('AlmaSketchupMCP', 'image') : nil,
        'attributes' => entity_attributes(group),
        'features' => entity_features(group),
        'boolean_operations' => entity_boolean_operations(group),
        'manifold' => entity_manifold_report(group),
        'transform' => entity_object_transform(group),
        'visible' => group.respond_to?(:hidden?) ? !group.hidden? : true,
        'locked' => group.respond_to?(:locked?) ? group.locked? : false,
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
        'native_classification' => native_classification_for.call(instance.definition),
        'texture_transform' => entity_texture_transform(instance),
        'face_uvs' => entity_face_uvs(instance),
        'attributes' => entity_attributes(instance),
        'features' => entity_features(instance),
        'boolean_operations' => entity_boolean_operations(instance),
        'manifold' => entity_manifold_report(instance),
        'transform' => entity_object_transform(instance),
        'visible' => instance.respond_to?(:hidden?) ? !instance.hidden? : true,
        'locked' => instance.respond_to?(:locked?) ? instance.locked? : false,
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
    all_warnings = snapshot_warnings(visible_items, model)
    {
      'totals' => totals,
      'resource_totals' => include_detail_evidence ? native_geometry_resource_totals(model) : nil,
      'groups' => groups,
      'instances' => instances,
      'geometry_occurrences' => include_detail_evidence ? geometry_occurrences(model) : nil,
      'manifold_checks' => state['manifold_checks'] || [],
      'component_definitions' => model.definitions.reject { |definition| sketchup_group_definition?(definition) || sketchup_temp_definition?(definition) || definition.name.empty? }.map(&:name).sort,
      'component_definition_summaries' => component_definition_summaries,
      'classification_schemas' => classification_schemas,
      'scenes' => snapshot_scenes(model, state),
      'section_planes' => native_section_planes_snapshot(model),
      'levels' => state['levels'] || [],
      'tags' => model.layers.reject { |layer| layer.name.to_s.empty? || %w[Untagged Layer0].include?(layer.name) }.map { |layer| tag_snapshot(layer) }.sort_by { |tag| tag['name'] },
      'materials' => model.materials.map { |material| material_snapshot(material) }.sort_by { |material| material['name'] },
      'native_appearance' => respond_to?(:native_appearance_snapshot) ? native_appearance_snapshot(model) : nil,
      'material_names' => model.materials.map(&:name).reject(&:empty?).sort,
      'image_references' => image_references_snapshot(model),
      'style_state' => state['style_state'],
      'shadow_state' => state['shadow_state'],
      'rendering_options' => state['rendering_options_state'],
      'bounding_box' => merge_bounds_hashes(visible_items.map { |item| item['bounding_box'] }),
      'selection' => selection_snapshot(model),
      'warnings' => all_warnings,
      'warning_messages' => all_warnings.map { |w| w['message'] },
      'warning_summary' => warning_summary(all_warnings),
      'view_state' => snapshot_view_state(model, state)
    }
  end

  # Storage counts include hidden and unused definitions and loose root geometry.
  # Expanded counts charge each placed occurrence, so shared definitions remain
  # distinguishable from physically duplicated geometry. Neither is a detail score.
  def native_geometry_resource_totals(model)
    direct = lambda do |entities|
      vertices = {}
      edges = entities.grep(Sketchup::Edge)
      edges.each { |edge| edge.vertices.each { |vertex| vertices[vertex.object_id] = true } }
      { 'faces' => entities.grep(Sketchup::Face).length, 'edges' => edges.length, 'vertices' => vertices.length }
    end
    add = lambda { |sum, counts| %w[faces edges vertices].each { |field| sum[field] += counts[field] }; sum }
    cache = {}
    direct_for = lambda { |entities| cache[entities.object_id] ||= direct.call(entities) }
    definitions = model.definitions.to_a.uniq { |definition| definition.object_id }
    stored = direct_for.call(model.entities).dup
    definitions.each { |definition| add.call(stored, direct_for.call(definition.entities)) }
    expanded_cache = {}
    expand = nil
    expand = lambda do |entities, ancestors|
      raise 'Geometry resource recursion limit exceeded' if ancestors.length > 64
      counts = direct_for.call(entities).dup
      entities.each do |entity|
        next unless entity.is_a?(Sketchup::Group) || entity.is_a?(Sketchup::ComponentInstance)
        definition = entity.definition
        raise 'Cyclic geometry resources cannot be counted' if ancestors.include?(definition.object_id)
        nested = expanded_cache[definition.object_id] ||= expand.call(definition.entities, ancestors + [definition.object_id])
        add.call(counts, nested)
      end
      counts
    end
    stored.merge('complete' => true, 'scope' => 'all_native_stored_geometry', 'definition_count' => definitions.length,
      'expanded_totals' => expand.call(model.entities, []), 'includes_hidden' => true, 'includes_unused_definitions' => true,
      'evidence_source' => 'sketchup_runtime', 'detail_score' => false)
  rescue StandardError => error
    { 'complete' => false, 'scope' => 'all_native_stored_geometry', 'evidence_source' => 'sketchup_runtime',
      'error' => "#{error.class}: #{error.message}", 'detail_score' => false }
  end

  def selection_snapshot(model)
    model.selection.to_a.select { |entity| selectable_entity?(entity) }.map { |entity| selection_entity_summary(entity) }
  rescue StandardError
    []
  end


  def sketchup_group_definition?(definition)
    definition.respond_to?(:group?) && definition.group?
  end

  def sketchup_temp_definition?(definition)
    definition.name.to_s.match?(/\ATempInstance#\d+\z/)
  end

  def snapshot_warnings(groups, model = nil)
    warnings = document_state_array('warnings', model).dup
    groups.each do |group|
      if group['faces'].zero? && !zero_face_allowed?(group)
        group_ref = snapshot_item_reference(group)
        warnings << {
          'type' => 'geometry.degenerate',
          'severity' => 'error',
          'category' => 'geometry',
          'message' => "#{group_ref} has zero faces",
          'source' => "group:#{group_ref}"
        }
      end
    end
    groups.each_with_index do |group, index|
      groups[(index + 1)..].to_a.each do |other|
        if boxes_intersect?(group['bounding_box'], other['bounding_box'])
          group_ref = snapshot_item_reference(group)
          other_ref = snapshot_item_reference(other)
          warnings << {
            'type' => 'geometry.bbox_overlap',
            'severity' => 'warn',
            'category' => 'geometry',
            'message' => "Bounding boxes overlap: #{group_ref} intersects #{other_ref}",
            'source' => "group:#{group_ref};#{other_ref}"
          }
        end
      end
    end
    warnings
  end

  def snapshot_item_reference(item)
    name = item['name'].to_s
    return name unless name.empty?

    id = item['id'].to_s
    return id unless id.empty?

    persistent_id = item['persistent_id'].to_s
    return "pid:#{persistent_id}" unless persistent_id.empty?

    'anonymous'
  end

  def zero_face_allowed?(group)
    %w[curve arc_curve].include?(group['kind'])
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

  # SketchUp can return different Ruby Entities wrappers for the same native
  # definition. Cache by definition identity, retaining references for this read.
  def snapshot_definition_key(definition)
    pid = entity_persistent_id(definition)
    pid ? [:definition, pid] : definition
  end

  def count_faces(entities, memo = {}, key = entities)
    return memo[key] if memo.key?(key)
    memo[key] = entities.grep(Sketchup::Face).length + nested_geometry_entities(entities).sum do |child|
      definition = child.definition
      count_faces(definition.entities, memo, snapshot_definition_key(definition))
    end
  end

  def count_edges(entities, memo = {}, key = entities)
    return memo[key] if memo.key?(key)
    memo[key] = entities.grep(Sketchup::Edge).length + nested_geometry_entities(entities).sum do |child|
      definition = child.definition
      count_edges(definition.entities, memo, snapshot_definition_key(definition))
    end
  end

  def count_vertices(entities, memo = {}, key = entities)
    return memo[key] if memo.key?(key)
    points = {}
    entities.grep(Sketchup::Edge).each do |edge|
      edge.vertices.each do |vertex|
        position = vertex.position
        position_key = [position.x, position.y, position.z].map { |value| model_units_to_mm(value) }.join(',')
        points[position_key] = true
      end
    end
    memo[key] = points.length + nested_geometry_entities(entities).sum do |child|
      definition = child.definition
      count_vertices(definition.entities, memo, snapshot_definition_key(definition))
    end
  end

  def nested_geometry_entities(entities)
    entities.select { |entity| entity.is_a?(Sketchup::Group) || entity.is_a?(Sketchup::ComponentInstance) }
  end

  def first_entities_material(entities)
    face = entities.grep(Sketchup::Face).find { |item| item.material || item.back_material }
    material = face && (face.material || face.back_material)
    return material.name if material

    nested_group = nested_geometry_entities(entities).find { |group| first_entities_material(group.definition.entities) }
    nested_group && first_entities_material(nested_group.definition.entities)
  end

  def material_snapshot(material)
    snapshot = {
      'name' => material.name,
      'color' => color_to_hex(material.color)
    }
    snapshot['alpha'] = material.alpha if material.respond_to?(:alpha)
    snapshot['texture'] = texture_snapshot(material.texture) if material.respond_to?(:texture) && material.texture
    if material.respond_to?(:get_attribute)
      source_path = material.get_attribute('AlmaMaterialSource', 'skm_path')
      snapshot['native_asset_source'] = { 'skm_path' => source_path, 'source_sha256' => material.get_attribute('AlmaMaterialSource', 'source_sha256') } if source_path
    end
    if supports_pbr_materials?
      snapshot['workflow'] = material.workflow == Sketchup::Material::WORKFLOW_PBR_METALLIC_ROUGHNESS ? 'pbr_metallic_roughness' : 'classic' if material.respond_to?(:workflow)
      pbr = {}
      %w[metalness_enabled roughness_enabled normal_enabled ao_enabled].each do |field|
        pbr[field] = material.public_send("#{field}?") if material.respond_to?("#{field}?")
      end
      pbr['metallic_factor'] = material.metallic_factor if material.respond_to?(:metallic_factor)
      pbr['roughness_factor'] = material.roughness_factor if material.respond_to?(:roughness_factor)
      pbr['ao_strength'] = material.ao_strength if material.respond_to?(:ao_strength)
      pbr['normal_scale'] = material.normal_scale if material.respond_to?(:normal_scale)
      pbr['normal_style'] = material.normal_style == Sketchup::Material::NORMAL_STYLE_DIRECTX ? 'directx' : 'opengl' if material.respond_to?(:normal_style)
      textures = {
        'metallic' => material_texture_path(material, :metallic_texture),
        'roughness' => material_texture_path(material, :roughness_texture),
        'normal' => material_texture_path(material, :normal_texture),
        'ao' => material_texture_path(material, :ao_texture)
      }.compact
      pbr['textures'] = textures unless textures.empty?
      pixels = {}
      textures.each_key do |channel|
        fingerprint = native_texture_pixel_fingerprint(material.public_send("#{channel}_texture"))
        pixels[channel] = fingerprint if fingerprint
      end
      pbr['texture_pixels'] = pixels unless pixels.empty?
      snapshot['pbr'] = pbr unless pbr.empty?
    end
    snapshot
  end

  def entity_geometry_input(entity)
    return nil unless entity.respond_to?(:get_attribute)

    raw = entity.get_attribute('GeometryInput', 'geometry_input_json')
    return nil if raw.nil? || raw.to_s.empty?

    JSON.parse(raw.to_s)
  rescue JSON::ParserError
    nil
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

  def native_texture_pixel_fingerprint(texture)
    return nil unless texture.respond_to?(:image_rep)
    # Bound the native copy for unexpectedly large assets. Missing evidence
    # never becomes a successful pixel comparison.
    if texture.respond_to?(:image_width) && texture.respond_to?(:image_height)
      return nil if texture.image_width * texture.image_height > 16_777_216
    end
    image = texture.image_rep(false)
    return nil unless image && image.width.positive? && image.height.positive?
    return nil if image.width * image.height > 16_777_216
    data = image.data
    return nil unless data.is_a?(String) && !data.empty?
    return nil unless image.bits_per_pixel.positive? && image.row_padding >= 0
    row_bytes = (image.width * image.bits_per_pixel + 7) / 8 + image.row_padding
    return nil unless data.bytesize == row_bytes * image.height
    { 'evidence' => 'native_texture_pixels_v1', 'width' => image.width, 'height' => image.height,
      'bits_per_pixel' => image.bits_per_pixel, 'row_padding' => image.row_padding,
      'platform' => Sketchup.platform.to_s, 'sha256' => Digest::SHA256.hexdigest(data) }
  rescue StandardError
    nil
  end

end
