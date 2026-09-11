# frozen_string_literal: true

module AlmaSketchupMCP
  extend self

  def add_image_reference(model, operation)
    name = non_empty_string(operation['name'], 'image_reference.name')
    path = non_empty_string(operation['path'] || operation['file'] || operation['filename'] || operation['image'], 'image_reference.path')
    payload = {
      'name' => name,
      'path' => File.expand_path(path)
    }
    payload['role'] = non_empty_string(operation['role'], 'image_reference.role') if operation.key?('role')
    payload['source'] = non_empty_string(operation['source'], 'image_reference.source') if operation.key?('source')
    payload['width'] = positive_number(operation['width'], nil, 'image_reference.width') if operation.key?('width')
    payload['height'] = positive_number(operation['height'], nil, 'image_reference.height') if operation.key?('height')
    payload['scale'] = positive_number(operation['scale'], nil, 'image_reference.scale') if operation.key?('scale')
    if operation.key?('metadata')
      raise 'image_reference.metadata must be an object' unless operation['metadata'].is_a?(Hash)

      payload['metadata'] = operation['metadata']
    end
    model.set_attribute('ImageReferences', name, JSON.generate(payload))
    payload
  end

  def set_face_uv(model, operation)
    entity = find_referenced_entity(model, operation, 'face_uv')
    payload = face_uv_payload(operation)
    payload['application'] = apply_face_uv_payload(entity, payload)
    entity.set_attribute('FaceUV', payload['id'], JSON.generate(payload))
    entity
  end

  def face_uv_payload(operation)
    id = non_empty_string(operation['uv_id'] || operation['uvId'] || operation['face'] || operation['face_id'] || 'default', 'face_uv.uv_id')
    uv = operation['uv'] || operation['coordinates'] || operation['coords']
    raise 'face_uv.uv must contain at least 3 [u,v] pairs' unless uv.is_a?(Array) && uv.length >= 3

    payload = {
      'id' => id,
      'selector' => face_uv_selector(operation['face_selector'] || operation['faceSelector'] || operation['face'] || operation['face_id']),
      'projection' => operation['projection'] || 'explicit',
      'uv' => uv.each_with_index.map { |point, index| uv_pair(point, "face_uv.uv[#{index}]") }
    }
    if operation['mapping']
      raise 'face_uv.mapping must be an array' unless operation['mapping'].is_a?(Array)

      payload['mapping'] = operation['mapping'].each_with_index.map do |entry, index|
        raise "face_uv.mapping[#{index}] must be an object" unless entry.is_a?(Hash)

        {
          'point' => vector(entry['point'], "face_uv.mapping[#{index}].point"),
          'uv' => uv_pair(entry['uv'], "face_uv.mapping[#{index}].uv")
        }
      end
    end
    material = operation['material'] || operation['material_name'] || operation['materialName']
    payload['material'] = non_empty_string(material, 'face_uv.material') unless material.nil?
    image_reference = operation['image_reference'] || operation['imageReference'] || operation['image']
    payload['image_reference'] = non_empty_string(image_reference, 'face_uv.image_reference') unless image_reference.nil?
    payload
  end

  def face_uv_selector(value)
    return { 'type' => 'all' } if value.nil?
    return { 'type' => 'named', 'value' => value } if value.is_a?(String)
    return { 'type' => 'index', 'value' => value.to_i } if value.is_a?(Numeric)
    raise 'face_uv.face_selector must be a string, number, or object' unless value.is_a?(Hash)

    value
  end

  def apply_face_uv_payload(entity, payload)
    faces = face_uv_target_faces(entity, payload['selector'])
    raise "face_uv #{payload['id']} matched no direct faces" if faces.empty?
    plans = faces.map do |face|
      material = texture_mapping_material(entity, face, payload['material'], true)
      mapping = face_uv_position_mapping(face, payload)
      raise 'face_uv requires 3 or 4 model/UV point pairs' unless [6, 8].include?(mapping.length)
      raise 'Native face UV positioning/readback is unsupported' unless face.respond_to?(:position_material) && face.respond_to?(:get_UVHelper)
      [face, material, mapping]
    end
    plans.each do |face, material, mapping|
      raise 'Native Face.position_material did not apply face_uv' unless face.position_material(material, mapping, true)
      points = mapping.each_slice(2).map { |pair| tm_xyz(pair[0]) }
      expected = mapping.each_slice(2).map { |pair| tm_xyz(pair[1]).first(2) }
      texture_mapping_verify(face, true, points, expected)
      face.set_attribute('FaceUV', payload['id'], JSON.generate(payload)) if face.respond_to?(:set_attribute)
    end
    { 'status' => 'applied', 'source' => 'native_face_uv', 'scope' => 'direct_faces_only',
      'applied_face_count' => faces.length, 'readback' => native_texture_mapping_snapshot(entity, 'front', faces) }
  end

  def face_uv_target_faces(entity, selector)
    faces = texture_mapping_direct_faces(entity)
    selector ||= { 'type' => 'all' }
    type = selector['type'] || selector[:type]
    value = selector['value'] || selector[:value]
    case type
    when 'all', nil
      faces
    when 'index'
      return [] unless value.is_a?(Numeric) && value.to_i == value && value >= 0
      face = faces[value.to_i]
      face ? [face] : []
    when 'named'
      faces.select { |face| face.respond_to?(:get_attribute) && face.get_attribute('GeometryInputFace', 'id').to_s == value.to_s }
    else
      []
    end
  end

  def face_uv_position_mapping(face, payload)
    if payload['mapping'].is_a?(Array)
      result = []
      payload['mapping'].each do |entry|
        point = entry['point'].map { |value| mm_to_model_units(value) }
        uv = entry['uv']
        result << Geom::Point3d.new(*point)
        result << Geom::Point3d.new(uv[0], uv[1], 0)
      end
      return result
    end
    vertices = face.vertices.map(&:position)
    raise 'face_uv UV count exceeds the face vertex count' if payload['uv'].length > vertices.length
    payload['uv'].zip(vertices).each_with_object([]) do |(uv, point), result|
      next unless uv && point

      result << point
      result << Geom::Point3d.new(uv[0], uv[1], 0)
    end
  end

  def entity_face_uvs(entity)
    return nil unless entity.respond_to?(:attribute_dictionary)

    dictionary = entity.attribute_dictionary('FaceUV', false)
    return nil unless dictionary

    dictionary.map do |key, value|
      payload = JSON.parse(value.to_s)
      payload['native_uv'] = native_texture_mapping_snapshot(entity, 'front', face_uv_target_faces(entity, payload['selector']))
      payload
    rescue JSON::ParserError
      { 'id' => key.to_s, 'raw' => value.to_s }
    end.sort_by { |entry| entry['id'].to_s }
  end

  def image_references_snapshot(model)
    dictionary = model.attribute_dictionary('ImageReferences', false)
    return [] unless dictionary

    dictionary.map do |key, value|
      JSON.parse(value.to_s)
    rescue JSON::ParserError
      { 'name' => key.to_s, 'raw' => value.to_s }
    end.sort_by { |entry| entry['name'].to_s }
  end

  def clear_image_references(model)
    dictionary = model.attribute_dictionary('ImageReferences', false)
    return unless dictionary

    keys = []
    dictionary.each_pair { |key, _value| keys << key.to_s }
    keys.each do |key|
      if model.respond_to?(:delete_attribute)
        model.delete_attribute('ImageReferences', key)
      end
      if dictionary.respond_to?(:delete_key)
        dictionary.delete_key(key)
      end
    end
  end
end
