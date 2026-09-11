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
        next if dictionary.name == 'AlmaSketchupMCP' && %w[id kind qa object_transform_json].include?(key.to_s)

        values[key.to_s] = attribute_snapshot_value(value)
      end
      result[dictionary.name] = values unless values.empty?
    end
    result.empty? ? nil : result
  end

  def entity_object_transform(entity)
    return nil unless entity.respond_to?(:get_attribute)

    raw = entity.get_attribute('AlmaSketchupMCP', 'object_transform_json')
    return nil if raw.nil? || raw.to_s.empty?

    { 'object_transform' => JSON.parse(raw.to_s) }
  rescue JSON::ParserError
    nil
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

  # SketchUp's public Ruby API can enumerate loaded schemas and look up a
  # caller-supplied classification path, but it does not enumerate the schema
  # types assigned to a ComponentDefinition. Keep that distinction explicit:
  # no undocumented classification dictionaries are interpreted here.
  def classification_schema_catalog(model)
    raise 'SketchUp classification schema enumeration is unavailable' unless model.respond_to?(:classifications)

    schemas = []
    model.classifications.each do |schema|
      schemas << {
        'name' => schema.name.to_s,
        'namespace' => schema.namespace.nil? ? nil : schema.namespace.to_s
      }
    end
    schemas.sort_by { |schema| [schema['name'], schema['namespace'].to_s] }
  end

  def native_definition_classification_summary(definition, classification_schemas)
    dictionaries = definition_attribute_fingerprint_payload(definition)
    fingerprint = "sha256:#{Digest::SHA256.hexdigest(JSON.generate(dictionaries))}"
    lookup_supported = definition.respond_to?(:get_classification_value)
    blockers = ['assigned_schema_types_not_enumerable']
    blockers << 'classification_value_lookup_unavailable' unless lookup_supported
    {
      'version' => 'sketchup-native-classification-summary.v1',
      'source' => 'sketchup_component_definition',
      'trust' => 'untrusted_data',
      'policy_effect' => 'none',
      'loaded_schema_names' => classification_schemas.map { |schema| schema['name'] }.uniq.sort,
      'value_lookup_supported' => lookup_supported,
      'assignment_enumeration' => 'unsupported_by_sketchup_ruby_api',
      'assignment_presence' => 'unknown',
      'assigned_type_count' => nil,
      'definition_attribute_fingerprint' => fingerprint,
      'fingerprint_coverage' => 'all_definition_attribute_dictionaries',
      'attribute_dictionary_count' => dictionaries.length,
      'attribute_key_count' => dictionaries.sum { |dictionary| dictionary['entries'].length },
      'values_exposed' => false,
      'complete' => false,
      'blockers' => blockers.sort
    }
  end

  def definition_attribute_fingerprint_payload(definition)
    dictionaries = definition.respond_to?(:attribute_dictionaries) ? definition.attribute_dictionaries : nil
    return [] unless dictionaries

    dictionaries.map do |dictionary|
      entries = []
      dictionary.each_pair do |key, value|
        entries << [key.to_s, canonical_attribute_fingerprint_value(value)]
      end
      {
        'name' => dictionary.name.to_s,
        'entries' => entries.sort_by(&:first)
      }
    end.sort_by { |dictionary| dictionary['name'] }
  end

  def canonical_attribute_fingerprint_value(value)
    return value if value.nil? || value.is_a?(String) || value == true || value == false
    return value.finite? ? value : value.to_s if value.is_a?(Numeric)
    return value.utc.iso8601(6) if value.is_a?(Time)
    return value.map { |item| canonical_attribute_fingerprint_value(item) } if value.is_a?(Array)
    if value.is_a?(Hash)
      return value.keys.map(&:to_s).sort.each_with_object({}) do |key, result|
        original_key = value.keys.find { |candidate| candidate.to_s == key }
        result[key] = canonical_attribute_fingerprint_value(value[original_key])
      end
    end
    if value.respond_to?(:to_a) && %w[Geom::Point3d Geom::Vector3d].include?(value.class.name)
      return value.to_a.map { |item| canonical_attribute_fingerprint_value(item) }
    end

    { '$type' => value.class.name, '$value' => value.to_s }
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
    stored = entity.get_attribute('TextureTransform', 'payload_json')
    texture_transform.merge!(JSON.parse(stored)) if stored
    texture_transform['application'] = entity.get_attribute('TextureTransform', 'application_json') ? 'native_mapping_requested' : 'legacy_metadata_only'
    texture_transform['native_uv'] = native_texture_mapping_snapshot(entity, texture_transform.fetch('side', 'front')) if respond_to?(:native_texture_mapping_snapshot)
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
    parent.respond_to?(:entities) ? parent.entities : active_model_or_new('entity_parent_entities').entities
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
