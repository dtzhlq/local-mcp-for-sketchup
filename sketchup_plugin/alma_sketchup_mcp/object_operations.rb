# frozen_string_literal: true

module AlmaSketchupMCP
  extend self

  def delete_object(model, operation)
    entity = find_referenced_entity(model, operation, 'delete')
    entity.erase!
  end

  def rename_object(model, operation)
    entity = find_referenced_entity(model, operation, 'rename')
    new_name = operation.fetch('new_name')
    duplicate = (model.entities.grep(Sketchup::Group) + model.entities.grep(Sketchup::ComponentInstance)).find { |item| item != entity && item.name == new_name }
    raise "rename target already exists: #{new_name}" if duplicate

    entity.name = new_name
  end

  def set_object_material(model, operation)
    entity = find_referenced_entity(model, operation, 'set_material')
    material = ensure_material(operation.fetch('material'), '#cccccc')
    apply_material_to_entity(entity, material)
  end

  def set_object_visibility(model, operation)
    entity = find_referenced_entity(model, operation, 'set_visibility')
    visible = operation.key?('visible') ? boolean_value(operation['visible'], 'set_visibility.visible') : !boolean_value(operation['hidden'], 'set_visibility.hidden')
    entity.hidden = !visible if entity.respond_to?(:hidden=)
  end

  def add_tag(model, operation)
    name = non_empty_string(operation['name'], 'tag.name')
    tag = model.layers[name] || model.layers.add(name)
    tag.color = sketchup_color(color_hex(operation['color'], 'tag.color')) if operation.key?('color') && tag.respond_to?(:color=)
    tag.visible = boolean_value(operation['visible'], 'tag.visible') if operation.key?('visible') && tag.respond_to?(:visible=)
    tag
  end

  def assign_tag(model, operation)
    entity = find_referenced_entity(model, operation, 'assign_tag')
    tag_name = non_empty_string(operation['tag'] || operation['tag_name'] || operation['tagName'], 'assign_tag.tag')
    tag = model.layers[tag_name] || model.layers.add(tag_name)
    entity.layer = tag if entity.respond_to?(:layer=)
    entity
  end

  def set_object_attribute(model, operation)
    entity = find_referenced_entity(model, operation, 'attribute')
    dictionary = non_empty_string(operation['dictionary'] || operation['namespace'] || 'AlmaSketchupMCP', 'attribute.dictionary')
    updates = attribute_updates(operation, dictionary)
    updates.each { |key, value| entity.set_attribute(dictionary, key, value) }
    entity
  end

  def set_object_classification(model, operation)
    entity = find_referenced_entity(model, operation, 'classification')
    classification = classification_payload(operation)
    entity.set_attribute('Classification', 'system', classification['system'])
    entity.set_attribute('Classification', 'type', classification['type'])
    entity.set_attribute('Classification', 'name', classification['name']) if classification.key?('name')
    entity.set_attribute('Classification', 'identifier', classification['identifier']) if classification.key?('identifier')
    entity.set_attribute('Classification', 'attributes_json', JSON.generate(classification['attributes'])) if classification.key?('attributes')
    entity
  end

  def set_object_texture_transform(model, operation)
    entity = find_referenced_entity(model, operation, 'texture_transform')
    texture_transform = texture_transform_payload(operation, 'texture_transform')
    write_texture_transform_attributes(entity, texture_transform)
    entity
  end

  def transform_object(model, operation)
    reference = object_reference(operation, 'transform_object')
    entity = find_referenced_entity(model, operation, 'transform_object')
    label = operation['name'] || reference_label(reference)
    transform = operation['transform'] || operation
    scale = transform['scale'] || 1
    scale_values = scale.is_a?(Array) ? vector(scale, "#{label}.scale") : [positive_number(scale, 1, "#{label}.scale")] * 3
    mirror = transform['mirror'] || []
    mirror_axes = mirror.is_a?(Array) ? mirror : [mirror]
    sx = scale_values[0] * (mirror_axes.include?('x') ? -1 : 1)
    sy = scale_values[1] * (mirror_axes.include?('y') ? -1 : 1)
    sz = scale_values[2] * (mirror_axes.include?('z') ? -1 : 1)
    pivot = transform_pivot(entity, transform['pivot'] || operation['pivot'], "#{label}.pivot")
    t = Geom::Transformation.scaling(pivot, sx, sy, sz)
    rx = transform['rotateX'] || transform['rotationX']
    ry = transform['rotateY'] || transform['rotationY']
    rz = transform['rotateZ'] || transform['rotationZ']
    t = Geom::Transformation.rotation(pivot, X_AXIS, rx.to_f.degrees) * t if rx
    t = Geom::Transformation.rotation(pivot, Y_AXIS, ry.to_f.degrees) * t if ry
    t = Geom::Transformation.rotation(pivot, Z_AXIS, rz.to_f.degrees) * t if rz
    axis_rotation = axis_rotation_transform(transform, label)
    t = Geom::Transformation.rotation(pivot, Geom::Vector3d.new(*axis_rotation[:axis]), axis_rotation[:angle].degrees) * t if axis_rotation
    local_rotation = local_axis_rotation_transform(entity, transform, label)
    t = Geom::Transformation.rotation(pivot, local_rotation[:axis], local_rotation[:angle].degrees) * t if local_rotation
    matrix_values = transform_matrix_metadata_values(transform, label)
    local_matrix_values = local_matrix_metadata_values(transform, label)
    local_matrix = local_matrix_transform(entity, transform, pivot, label)
    t = local_matrix * t if local_matrix
    translate = transform['translate'] || transform['translation']
    t = Geom::Transformation.translation(vector(translate, "#{label}.translate").map { |value| mm_to_model_units(value) }) * t if translate
    matrix = transform_matrix(transform, label)
    t = Geom::Transformation.new(matrix) * t if matrix
    entity.transform!(t)
    write_object_transform_metadata(entity, object_transform_metadata(transform, label, scale_values, mirror_axes, pivot, axis_rotation, local_rotation, matrix_values, local_matrix_values))
    entity
  end

  def axis_rotation_transform(transform, label)
    raw = transform['rotate_axis'] || transform['rotateAxis'] || transform['axis_rotation'] || transform['axisRotation'] || {}
    axis = raw['axis'] || transform['axis']
    angle = raw.key?('angle') ? raw['angle'] : transform['angle']
    return nil if axis.nil? && angle.nil?
    raise "#{label}.axis and #{label}.angle must be provided together" if axis.nil? || angle.nil?

    values = vector(axis, "#{label}.axis")
    length = Math.sqrt(values.map { |value| value**2 }.sum)
    raise "#{label}.axis must be non-zero" if length <= 1e-9

    { axis: values.map { |value| value / length }, angle: finite_number(angle, "#{label}.angle") }
  end

  def local_axis_rotation_transform(entity, transform, label)
    rotate = transform['rotate'] || transform['rotation'] || {}
    raw = transform['rotate_local'] || transform['rotateLocal'] || transform['local_rotation'] || transform['localRotation'] || rotate['local'] || {}
    axis = raw['axis'] || transform['local_axis'] || transform['localAxis'] || rotate['local_axis'] || rotate['localAxis']
    angle = raw.key?('angle') ? raw['angle'] : (transform.key?('local_angle') ? transform['local_angle'] : (transform.key?('localAngle') ? transform['localAngle'] : (rotate.key?('local_angle') ? rotate['local_angle'] : rotate['localAngle'])))
    return nil if axis.nil? && angle.nil?
    raise "#{label}.local_axis and #{label}.local_angle must be provided together" if axis.nil? || angle.nil?

    local_axis = normalize_local_axis(axis, label)
    transformation = entity.respond_to?(:transformation) ? entity.transformation : Geom::Transformation.new
    x_axis = transformation.xaxis
    y_axis = transformation.yaxis
    z_axis = transformation.zaxis
    model_axis = Geom::Vector3d.new(
      x_axis.x * local_axis[0] + y_axis.x * local_axis[1] + z_axis.x * local_axis[2],
      x_axis.y * local_axis[0] + y_axis.y * local_axis[1] + z_axis.y * local_axis[2],
      x_axis.z * local_axis[0] + y_axis.z * local_axis[1] + z_axis.z * local_axis[2]
    )
    raise "#{label}.local_axis resolved to zero model vector" if model_axis.length <= 1e-9
    model_axis.normalize!

    {
      axis: model_axis,
      local_axis: local_axis,
      model_axis: [model_axis.x, model_axis.y, model_axis.z],
      angle: finite_number(angle, "#{label}.local_angle")
    }
  end

  def normalize_local_axis(axis, label)
    if axis.is_a?(String)
      case axis.downcase
      when 'x'
        return [1.0, 0.0, 0.0]
      when 'y'
        return [0.0, 1.0, 0.0]
      when 'z'
        return [0.0, 0.0, 1.0]
      else
        raise "#{label}.local_axis must be x, y, z, or a [x,y,z] vector"
      end
    end

    values = vector(axis, "#{label}.local_axis")
    length = Math.sqrt(values.map { |value| value**2 }.sum)
    raise "#{label}.local_axis must be non-zero" if length <= 1e-9

    values.map { |value| value / length }
  end

  def transform_matrix(transform, label)
    raw = transform['matrix'] || transform['matrix4x4']
    return nil if raw.nil?

    transform_matrix_values(raw, label, 'matrix')
  end

  def transform_matrix_metadata_values(transform, label)
    raw = transform['matrix'] || transform['matrix4x4']
    return nil if raw.nil?

    transform_matrix_values(raw, label, 'matrix', convert_translation: false)
  end

  def local_matrix_transform(entity, transform, pivot, label)
    raw = local_matrix_raw(transform)
    return nil if raw.nil?

    local_matrix = Geom::Transformation.new(transform_matrix_values(raw, label, 'local_matrix'))
    entity_transform = entity.respond_to?(:transformation) ? entity.transformation : Geom::Transformation.new
    local_to_model = Geom::Transformation.axes(pivot, entity_transform.xaxis, entity_transform.yaxis, entity_transform.zaxis)
    local_to_model * local_matrix * local_to_model.inverse
  end

  def local_matrix_metadata_values(transform, label)
    raw = local_matrix_raw(transform)
    return nil if raw.nil?

    transform_matrix_values(raw, label, 'local_matrix', convert_translation: false)
  end

  def local_matrix_raw(transform)
    transform['local_matrix'] || transform['localMatrix'] || transform['matrix_local'] || transform['matrixLocal']
  end

  def transform_matrix_values(raw, label, field_name, convert_translation: true)
    values = if raw.is_a?(Array) && raw.length == 4 && raw.all? { |row| row.is_a?(Array) && row.length == 4 }
               raw.flatten
             else
               raw
             end
    raise "#{label}.#{field_name} must be a 16-number SketchUp-compatible transform array" unless values.is_a?(Array) && values.length == 16

    values.each_with_index.map do |value, index|
      number = finite_number(value, "#{label}.#{field_name}[#{index}]")
      convert_translation && [12, 13, 14].include?(index) ? mm_to_model_units(number) : number
    end
  end

  def object_transform_metadata(transform, label, scale_values, mirror_axes, pivot, axis_rotation, local_rotation, matrix_values, local_matrix_values)
    translate = transform['translate'] || transform['translation']
    {
      'translate' => translate ? vector(translate, "#{label}.translate") : [0, 0, 0],
      'rotateX' => finite_number(transform['rotateX'] || transform['rotationX'] || 0, "#{label}.rotateX"),
      'rotateY' => finite_number(transform['rotateY'] || transform['rotationY'] || 0, "#{label}.rotateY"),
      'rotateZ' => finite_number(transform['rotateZ'] || transform['rotationZ'] || 0, "#{label}.rotateZ"),
      'axis' => axis_rotation ? axis_rotation[:axis] : nil,
      'angle' => axis_rotation ? axis_rotation[:angle] : 0,
      'local_axis' => local_rotation ? local_rotation[:local_axis] : nil,
      'local_angle' => local_rotation ? local_rotation[:angle] : 0,
      'local_model_axis' => local_rotation ? local_rotation[:model_axis] : nil,
      'matrix' => matrix_values,
      'matrix_decomposition' => transform_matrix_decomposition(matrix_values),
      'local_matrix' => local_matrix_values,
      'local_matrix_decomposition' => transform_matrix_decomposition(local_matrix_values),
      'scale' => scale_values,
      'mirror' => mirror_axes.compact,
      'pivot' => [model_units_to_mm(pivot.x), model_units_to_mm(pivot.y), model_units_to_mm(pivot.z)]
    }
  end

  def transform_matrix_decomposition(values)
    return nil if values.nil?

    x_column = [values[0], values[1], values[2]]
    y_column = [values[4], values[5], values[6]]
    z_column = [values[8], values[9], values[10]]
    determinant = vector_dot(x_column, vector_cross(y_column, z_column))
    x_axis = normalize_matrix_axis(x_column)
    y_axis = normalize_matrix_axis(y_column)
    z_axis = normalize_matrix_axis(z_column)
    shear = {
      'xy' => vector_dot(x_axis, y_axis),
      'xz' => vector_dot(x_axis, z_axis),
      'yz' => vector_dot(y_axis, z_axis)
    }
    non_affine_reasons = transform_matrix_non_affine_reasons(values)
    rotation_compatible = non_affine_reasons.empty? &&
                          determinant.abs > 1e-12 &&
                          shear.values.all? { |value| value.abs <= 1e-6 } &&
                          determinant.positive?
    {
      'translate' => [values[12], values[13], values[14]],
      'scale' => [vector_length(x_column), vector_length(y_column), vector_length(z_column)],
      'x_axis' => x_axis,
      'y_axis' => y_axis,
      'z_axis' => z_axis,
      'shear' => shear,
      'determinant' => determinant,
      'mirrored' => determinant.negative?,
      'affine' => non_affine_reasons.empty?,
      'non_affine_reasons' => non_affine_reasons,
      'homogeneous' => {
        'perspective' => [values[3], values[7], values[11]],
        'w' => values[15]
      },
      'rotation_euler_order' => rotation_compatible ? 'XYZ' : nil,
      'rotation_euler_degrees' => rotation_compatible ? euler_xyz_degrees_from_axes(x_axis, y_axis, z_axis) : nil
    }
  end

  def transform_matrix_non_affine_reasons(values)
    reasons = []
    reasons << 'perspective_terms' if values.values_at(3, 7, 11).any? { |value| value.abs > 1e-9 }
    reasons << 'homogeneous_w_not_one' if (values[15] - 1).abs > 1e-9
    reasons
  end

  def euler_xyz_degrees_from_axes(x_axis, y_axis, z_axis)
    r = [
      [x_axis[0], y_axis[0], z_axis[0]],
      [x_axis[1], y_axis[1], z_axis[1]],
      [x_axis[2], y_axis[2], z_axis[2]]
    ]
    sy = [[r[0][2], -1.0].max, 1.0].min
    y = Math.asin(sy)
    if Math.cos(y).abs > 1e-9
      x = Math.atan2(-r[1][2], r[2][2])
      z = Math.atan2(-r[0][1], r[0][0])
    else
      x = Math.atan2(r[2][1], r[1][1])
      z = 0.0
    end
    [x, y, z].map { |radians| normalize_small_number(radians * 180.0 / Math::PI) }
  end

  def normalize_small_number(value)
    value.abs <= 1e-9 ? 0.0 : value
  end

  def normalize_matrix_axis(axis)
    length = vector_length(axis)
    return [0, 0, 0] if length <= 1e-12

    axis.map { |value| value / length }
  end

  def vector_length(axis)
    Math.sqrt(axis.map { |value| value * value }.sum)
  end

  def vector_dot(a, b)
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  end

  def vector_cross(a, b)
    [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ]
  end

  def write_object_transform_metadata(entity, metadata)
    return entity unless entity.respond_to?(:set_attribute)

    entity.set_attribute('AlmaSketchupMCP', 'object_transform_json', JSON.generate(metadata))
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

  def attribute_updates(operation, dictionary)
    has_attributes = operation.key?('attributes')
    has_key_value = operation.key?('key') || operation.key?('attr_key') || operation.key?('attrKey') || operation.key?('value')
    raise 'attribute requires attributes or key/value' unless has_attributes || has_key_value
    if has_attributes
      raise 'attribute.attributes must be an object' unless operation['attributes'].is_a?(Hash)

      updates = operation['attributes'].dup
    else
      updates = {}
    end
    if has_key_value
      key = non_empty_string(operation['key'] || operation['attr_key'] || operation['attrKey'], 'attribute.key')
      updates[key] = operation['value']
    end
    updates.each do |key, value|
      non_empty_string(key, "attribute.#{dictionary}.key")
      raise "attribute.#{dictionary}.#{key} must be a JSON value" unless json_value?(value)
    end
    updates
  end

  def classification_payload(operation)
    system = non_empty_string(operation['system'] || operation['schema'] || 'IFC', 'classification.system')
    type = non_empty_string(operation['type'] || operation['classification'] || operation['ifc_class'] || operation['ifcClass'] || operation['class'], 'classification.type')
    payload = {
      'system' => system,
      'type' => type
    }
    name = operation['class_name'] || operation['className'] || operation['label']
    identifier = operation['identifier'] || operation['id_value'] || operation['idValue']
    payload['name'] = non_empty_string(name, 'classification.name') unless name.nil?
    payload['identifier'] = non_empty_string(identifier, 'classification.identifier') unless identifier.nil?
    unless operation['attributes'].nil?
      raise 'classification.attributes must be an object' unless operation['attributes'].is_a?(Hash)

      operation['attributes'].each do |key, value|
        non_empty_string(key, 'classification.attributes.key')
        raise "classification.attributes.#{key} must be a JSON value" unless json_value?(value)
      end
      payload['attributes'] = operation['attributes']
    end
    payload
  end

  def texture_transform_payload(operation, field_name)
    projection = material_keyword(operation['projection'] || 'planar', {
      'planar' => 'planar',
      'box' => 'box'
    }, "#{field_name}.projection")
    offset = operation['offset'] ? uv_pair(operation['offset'], "#{field_name}.offset") : [
      finite_number(operation['offset_u'] || operation['offsetU'] || 0, "#{field_name}.offset_u"),
      finite_number(operation['offset_v'] || operation['offsetV'] || 0, "#{field_name}.offset_v")
    ]
    scale = operation['scale'] ? uv_pair(operation['scale'], "#{field_name}.scale") : [
      positive_number(operation['scale_u'] || operation['scaleU'], 1, "#{field_name}.scale_u"),
      positive_number(operation['scale_v'] || operation['scaleV'], 1, "#{field_name}.scale_v")
    ]
    rotation = finite_number(operation['rotation'] || operation['rotation_degrees'] || operation['rotationDegrees'] || 0, "#{field_name}.rotation")
    payload = {
      'projection' => projection,
      'offset' => offset,
      'scale' => scale,
      'rotation' => rotation
    }
    material = operation['material'] || operation['material_name'] || operation['materialName']
    payload['material'] = non_empty_string(material, "#{field_name}.material") unless material.nil?
    payload
  end

  def write_texture_transform_attributes(entity, texture_transform)
    entity.set_attribute('TextureTransform', 'projection', texture_transform['projection'])
    entity.set_attribute('TextureTransform', 'offset_u', texture_transform['offset'][0])
    entity.set_attribute('TextureTransform', 'offset_v', texture_transform['offset'][1])
    entity.set_attribute('TextureTransform', 'scale_u', texture_transform['scale'][0])
    entity.set_attribute('TextureTransform', 'scale_v', texture_transform['scale'][1])
    entity.set_attribute('TextureTransform', 'rotation', texture_transform['rotation'])
    entity.set_attribute('TextureTransform', 'material', texture_transform['material']) if texture_transform.key?('material')
  end
end
