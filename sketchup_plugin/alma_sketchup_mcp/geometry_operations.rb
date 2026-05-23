# frozen_string_literal: true

module AlmaSketchupMCP
  extend self

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
      id = object_id(operation, group.name || fallback_kind)
      assert_entity_identity_available(group, id, group.name)
      group.set_attribute('AlmaSketchupMCP', 'id', id)
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

  def entity_tag_name(entity)
    tag = entity.respond_to?(:layer) ? entity.layer : nil
    return nil unless tag && tag.respond_to?(:name)
    return nil if tag.name.to_s.empty? || %w[Untagged Layer0].include?(tag.name)

    tag.name
  end

  def entity_attributes(entity)
    return nil unless entity.respond_to?(:attribute_dictionaries) && entity.attribute_dictionaries

    result = {}
    entity.attribute_dictionaries.each do |dictionary|
      values = {}
      dictionary.each_pair do |key, value|
        next if dictionary.name == 'AlmaSketchupMCP' && %w[id kind qa].include?(key.to_s)

        values[key.to_s] = attribute_snapshot_value(value)
      end
      result[dictionary.name] = values unless values.empty?
    end
    result.empty? ? nil : result
  end

  def entity_classification(entity)
    return nil unless entity.respond_to?(:get_attribute)

    system = entity.get_attribute('Classification', 'system')
    type = entity.get_attribute('Classification', 'type')
    return nil if system.nil? && type.nil?

    classification = {
      'system' => system,
      'type' => type
    }
    name = entity.get_attribute('Classification', 'name')
    identifier = entity.get_attribute('Classification', 'identifier')
    attributes_json = entity.get_attribute('Classification', 'attributes_json')
    classification['name'] = name unless name.nil?
    classification['identifier'] = identifier unless identifier.nil?
    if attributes_json && !attributes_json.to_s.empty?
      classification['attributes'] = JSON.parse(attributes_json)
    end
    classification
  rescue JSON::ParserError
    classification
  end

  def entity_texture_transform(entity)
    return nil unless entity.respond_to?(:get_attribute)

    projection = entity.get_attribute('TextureTransform', 'projection')
    return nil unless projection

    texture_transform = {
      'projection' => projection,
      'offset' => [
        entity.get_attribute('TextureTransform', 'offset_u') || 0,
        entity.get_attribute('TextureTransform', 'offset_v') || 0
      ],
      'scale' => [
        entity.get_attribute('TextureTransform', 'scale_u') || 1,
        entity.get_attribute('TextureTransform', 'scale_v') || 1
      ],
      'rotation' => entity.get_attribute('TextureTransform', 'rotation') || 0
    }
    material = entity.get_attribute('TextureTransform', 'material')
    texture_transform['material'] = material unless material.nil?
    texture_transform
  end

  def attribute_snapshot_value(value)
    return value if value.nil? || value.is_a?(String) || value == true || value == false
    return value if value.is_a?(Numeric)
    return value.map { |item| attribute_snapshot_value(item) } if value.is_a?(Array)
    return value.transform_values { |item| attribute_snapshot_value(item) } if value.is_a?(Hash)

    value.to_s
  end

  def assert_entity_identity_available(entity, id, name)
    siblings = entity_parent_entities(entity)
    entities = siblings.grep(Sketchup::Group) + siblings.grep(Sketchup::ComponentInstance)
    duplicate_id = entities.find { |item| item != entity && [entity_id(item), entity_persistent_id(item)].compact.include?(id) }
    duplicate_name = entities.find { |item| item != entity && item.name == name }
    if duplicate_id || duplicate_name
      entity.erase! if entity.respond_to?(:erase!)
      raise(duplicate_id ? "object id already exists: #{id}" : "object name already exists: #{name}")
    end
  end

  def entity_parent_entities(entity)
    parent = entity.respond_to?(:parent) ? entity.parent : nil
    parent.respond_to?(:entities) ? parent.entities : Sketchup.active_model.entities
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
end
