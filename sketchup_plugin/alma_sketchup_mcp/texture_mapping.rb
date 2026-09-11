# frozen_string_literal: true

module AlmaSketchupMCP
  extend self

  # Mapping is in the target's own coordinates. Never descend into child
  # definitions: selecting a container must not repaint shared descendants.
  def texture_mapping_direct_faces(entity)
    return [entity] if entity.is_a?(Sketchup::Face)
    entities = if entity.is_a?(Sketchup::Group)
                 entity.entities
               elsif entity.is_a?(Sketchup::ComponentInstance)
                 entity.definition.entities
               end
    entities ? entities.grep(Sketchup::Face) : []
  end

  def texture_mapping_material(entity, face, name, front)
    model = entity.respond_to?(:model) ? entity.model : active_model_or_new
    material = name ? model.materials[name] : (front ? face.material : face.back_material)
    material ||= entity.material if !name && entity.respond_to?(:material)
    raise "Texture mapping material does not exist: #{name}" unless material
    raise "Texture mapping requires a textured material: #{material.name}" unless material.respond_to?(:texture) && material.texture
    material
  end

  def apply_native_texture_transform(entity, payload)
    faces = face_uv_target_faces(entity, payload['face_selector'])
    raise 'texture_transform matched no direct faces; explicitly select a leaf component or face' if faces.empty?
    sides = payload.fetch('side', 'front') == 'both' ? [true, false] : [payload.fetch('side', 'front') == 'front']
    # Preflight every face before the first native write.
    plans = faces.flat_map do |face|
      raise 'Native face UV positioning/readback is unsupported' unless face.respond_to?(:position_material) && face.respond_to?(:get_UVHelper)
      normal = tm_unit(tm_xyz(face.normal))
      u, v = texture_mapping_axes(normal, payload['projection'])
      anchor = face.vertices.map { |vertex| tm_xyz(vertex.position) }.min
      raise 'Texture mapping face has no vertices' unless anchor
      sides.map do |front|
        material = texture_mapping_material(entity, face, payload['material'], front)
        size = payload['texture_size_mm'] ? payload['texture_size_mm'].map { |value| mm_to_model_units(value) } : [material.texture.width.to_f, material.texture.height.to_f]
        raise 'Texture mapping physical tile dimensions must be positive' unless size.all? { |value| value.finite? && value > 0 }
        points = [anchor, tm_add(anchor, tm_mul(u, size[0])), tm_add(anchor, tm_mul(v, size[1]))]
        angle = payload['rotation'] * Math::PI / 180.0
        uv = points.map do |point|
          s, t = tm_dot(point, u) / size[0], tm_dot(point, v) / size[1]
          [(s * Math.cos(angle) + t * Math.sin(angle)) * payload['scale'][0] + payload['offset'][0],
           (-s * Math.sin(angle) + t * Math.cos(angle)) * payload['scale'][1] + payload['offset'][1]]
        end
        { face: face, material: material, front: front, points: points, uv: uv }
      end
    end
    plans.each do |plan|
      mapping = plan[:points].zip(plan[:uv]).flat_map { |point, uv| [Geom::Point3d.new(*point), Geom::Point3d.new(uv[0], uv[1], 0)] }
      result = plan[:face].position_material(plan[:material], mapping, plan[:front])
      raise 'Native Face.position_material did not apply the texture mapping' unless result
      texture_mapping_verify(plan[:face], plan[:front], plan[:points], plan[:uv])
    end
    { 'status' => 'applied', 'source' => 'native_face_uv', 'scope' => 'direct_faces_only',
      'applied_face_count' => faces.length, 'applied_side_count' => plans.length,
      'readback' => native_texture_mapping_snapshot(entity, payload.fetch('side', 'front'), faces) }
  end

  def texture_mapping_axes(normal, projection)
    if projection == 'box'
      axis = normal.each_with_index.max_by { |value, _index| value.abs }[1]
      raise 'box texture projection requires axis-aligned faces; use planar for sloped or curved faces' if normal[axis].abs < 1.0 - 1.0e-7
      return [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]] if axis == 2
      return [[1.0, 0.0, 0.0], [0.0, 0.0, 1.0]] if axis == 1
      return [[0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
    end
    reference = normal[0].abs < 0.999999 ? [1.0, 0.0, 0.0] : [0.0, 1.0, 0.0]
    u = tm_unit(tm_add(reference, tm_mul(normal, -tm_dot(reference, normal))))
    [u, tm_unit(tm_cross(normal, u))]
  end

  def texture_mapping_verify(face, front, points, expected)
    actual = texture_mapping_uv_samples(face, front, points)
    raise 'Native texture UV readback did not match the requested mapping' unless actual.zip(expected).all? { |uv, target| uv.zip(target).all? { |value, wanted| (value - wanted).abs <= 1.0e-5 } }
    actual
  end

  def texture_mapping_uv_samples(face, front, points)
    helper = face.get_UVHelper(front, !front, Sketchup.create_texture_writer)
    points.map do |point|
      native = Geom::Point3d.new(*point)
      uvq = front ? helper.get_front_UVQ(native) : helper.get_back_UVQ(native)
      values = tm_xyz(uvq)
      raise 'Native texture UV readback returned invalid homogeneous coordinates' unless values.all?(&:finite?) && values[2].abs > 1.0e-12
      [values[0] / values[2], values[1] / values[2]]
    end
  end

  # Always read current UVs. Stored parameters alone are never evidence that
  # SketchUp is using them (or that later manual edits preserved them).
  def native_texture_mapping_snapshot(entity, side = 'front', faces = nil)
    sides = side == 'both' ? [true, false] : [side == 'front']
    (faces || texture_mapping_direct_faces(entity)).each_with_index.flat_map do |face, index|
      sides.map do |front|
        material = front ? face.material : face.back_material
        base = { 'face_index' => index, 'side' => front ? 'front' : 'back',
                 'persistent_id' => face.respond_to?(:persistent_id) ? face.persistent_id.to_s : nil,
                 'material' => material ? material.name : nil }
        next base.merge('status' => 'untextured') unless material && material.respond_to?(:texture) && material.texture
        points = face.vertices.map { |vertex| tm_xyz(vertex.position) }.sort.first(4)
        base.merge('status' => 'readback', 'samples' => points.zip(texture_mapping_uv_samples(face, front, points)).map do |point, uv|
          { 'point_mm' => point.map { |value| model_units_to_mm(value).round(8) }, 'uv' => uv.map { |value| value.round(10) } }
        end)
      rescue StandardError => error
        base.merge('status' => 'readback_failed', 'error' => error.message)
      end
    end
  end

  def tm_xyz(value); [value.x.to_f, value.y.to_f, value.z.to_f]; end
  def tm_dot(a, b); a.zip(b).sum { |x, y| x * y }; end
  def tm_mul(a, factor); a.map { |value| value * factor }; end
  def tm_add(a, b); a.zip(b).map { |x, y| x + y }; end
  def tm_cross(a, b); [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; end
  def tm_unit(value)
    length = Math.sqrt(tm_dot(value, value))
    raise 'Texture mapping requires a non-degenerate planar face' unless length.finite? && length > 1.0e-12
    tm_mul(value, 1.0 / length)
  end
end
