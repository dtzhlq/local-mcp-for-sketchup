# frozen_string_literal: true

module AlmaSketchupMCP
  extend self

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

    material_name = operation['material'] || operation['f_material']
    back_material_name = operation['back_material'] || operation['b_material']
    if material_name || back_material_name
      material = material_name ? ensure_material(material_name, '#cccccc') : nil
      back_material = back_material_name ? ensure_material(back_material_name, '#cccccc') : material
      group.entities.grep(Sketchup::Face).each do |group_face|
        group_face.material = material if material
        group_face.back_material = back_material if back_material
      end
    end
    soften_edges(group, operation['smooth'])
    apply_transform(group, operation)
    group
  end

  def add_geometry_input(parent_entities, operation)
    name = operation.fetch('name')
    vertices = operation.fetch('vertices')
    raise "#{name}.vertices must contain [x, y, z] points" unless vertices.is_a?(Array) && vertices.length.positive?

    points = vertices.each_with_index.map do |vertex, index|
      x, y, z = vector(vertex, "#{name}.vertices[#{index}]").map { |value| mm_to_model_units(value) }
      Geom::Point3d.new(x, y, z)
    end
    group = parent_entities.add_group
    group.name = name
    annotate_group(group, operation, 'geometry_input')

    material = operation['material'] ? ensure_material(operation['material'], '#cccccc') : nil
    explicit_edges = operation['edges'] || []
    raise "#{name}.edges must be an array" unless explicit_edges.is_a?(Array)

    normalized_edges = []
    explicit_edges.each_with_index do |edge, edge_index|
      raise "#{name}.edges[#{edge_index}] must be [a, b] vertex indices" unless edge.is_a?(Array) && edge.length == 2

      a = integer_index(edge[0], "#{name}.edges[#{edge_index}][0]", points.length)
      b = integer_index(edge[1], "#{name}.edges[#{edge_index}][1]", points.length)
      normalized_edges << [a, b]
      group.entities.add_line(points[a], points[b])
    end

    faces = operation['faces'] || []
    raise "#{name}.faces must be an array" unless faces.is_a?(Array)

    face_records = []
    faces.each_with_index do |face_spec, face_index|
      face_record = geometry_input_face_record(face_spec, points.length, "#{name}.faces[#{face_index}]")
      outer = face_record['outer']
      holes = face_record['holes']
      face = group.entities.add_face(outer.map { |index| points[index] })
      raise "Failed to create geometry_input face #{face_index} for #{name}" unless face

      holes.each do |hole|
        hole_face = group.entities.add_face(hole.map { |index| points[index] })
        hole_face.erase! if hole_face && hole_face.valid?
      end
      face_records << [face, face_record]
    end
    group.entities.grep(Sketchup::Face).each { |face| face.material = material; face.back_material = material } if material
    face_records.each { |face, face_record| apply_geometry_input_face_metadata(face, face_record) }
    write_geometry_input_snapshot(group, face_records.map { |_face, record| record }, normalized_edges)
    soften_edges(group, operation['smooth'])
    apply_transform(group, operation)
    group
  end

  def add_curve(parent_entities, operation)
    name = operation.fetch('name')
    points_input = operation['points'] || operation['vertices']
    raise "#{name}.points must contain at least 2 [x, y, z] points" unless points_input.is_a?(Array) && points_input.length >= 2

    points = points_input.each_with_index.map do |point, index|
      x, y, z = vector(point, "#{name}.points[#{index}]").map { |value| mm_to_model_units(value) }
      Geom::Point3d.new(x, y, z)
    end
    group = parent_entities.add_group
    group.name = name
    annotate_group(group, operation.merge('kind' => operation['kind'] || 'curve'), 'curve')
    edges = if group.entities.respond_to?(:add_curve)
              group.entities.add_curve(points)
            else
              points.each_cons(2).map { |a, b| group.entities.add_line(a, b) }
            end
    group.entities.add_line(points.last, points.first) if operation['closed']
    if operation['material']
      material = ensure_material(operation['material'], '#cccccc')
      Array(edges).compact.each { |edge| edge.material = material if edge.respond_to?(:material=) }
    end
    apply_transform(group, operation)
    group
  end

  def add_arc_curve(parent_entities, operation)
    name = operation.fetch('name')
    center = vector(operation['center'] || [0, 0, 0], "#{name}.center")
    radius = positive_number(operation['radius'], nil, "#{name}.radius")
    start_angle = finite_number(operation['startAngle'] || operation['start_angle'] || 0, "#{name}.start_angle")
    end_angle = finite_number(operation['endAngle'] || operation['end_angle'] || 90, "#{name}.end_angle")
    segments = integer_range(operation['segments'] || 16, 2, 128, "#{name}.segments")
    plane = operation['plane'] || 'xy'
    raise "#{name}.plane must be one of xy, xz, yz" unless %w[xy xz yz].include?(plane)

    points = []
    (0..segments).each do |index|
      angle = (start_angle + (end_angle - start_angle) * index / segments.to_f) * Math::PI / 180.0
      u = Math.cos(angle) * radius
      v = Math.sin(angle) * radius
      points << case plane
                when 'xy' then [center[0] + u, center[1] + v, center[2]]
                when 'xz' then [center[0] + u, center[1], center[2] + v]
                when 'yz' then [center[0], center[1] + u, center[2] + v]
                end
    end
    group = add_curve(parent_entities, operation.merge('points' => points, 'kind' => 'arc_curve'))
    group.set_attribute('ArcCurve', 'center', JSON.generate(center)) if group.respond_to?(:set_attribute)
    group.set_attribute('ArcCurve', 'radius', radius) if group.respond_to?(:set_attribute)
    group.set_attribute('ArcCurve', 'start_angle', start_angle) if group.respond_to?(:set_attribute)
    group.set_attribute('ArcCurve', 'end_angle', end_angle) if group.respond_to?(:set_attribute)
    group.set_attribute('ArcCurve', 'plane', plane) if group.respond_to?(:set_attribute)
    group.set_attribute('ArcCurve', 'segments', segments) if group.respond_to?(:set_attribute)
    group
  end

  def geometry_input_face_record(face_spec, vertex_count, field_name)
    if face_spec.is_a?(Array)
      outer = face_spec.each_with_index.map { |item, index| integer_index(item, "#{field_name}.outer[#{index}]", vertex_count) }
      raise "#{field_name}.outer must contain at least 3 vertex indices" unless outer.length >= 3

      return geometry_input_face_record_from_loops(outer, [], {})
    end
    raise "#{field_name} must be an array or object" unless face_spec.is_a?(Hash)

    raw_outer = face_spec['outer'] || face_spec['loop'] || face_spec['vertices']
    raise "#{field_name}.outer must contain at least 3 vertex indices" unless raw_outer.is_a?(Array) && raw_outer.length >= 3

    outer = raw_outer.each_with_index.map { |item, index| integer_index(item, "#{field_name}.outer[#{index}]", vertex_count) }
    holes = (face_spec['holes'] || []).each_with_index.map do |hole, hole_index|
      raw_hole = hole.is_a?(Hash) ? (hole['outer'] || hole['loop'] || hole['vertices']) : hole
      raise "#{field_name}.holes[#{hole_index}] must contain at least 3 vertex indices" unless raw_hole.is_a?(Array) && raw_hole.length >= 3

      raw_hole.each_with_index.map { |item, index| integer_index(item, "#{field_name}.holes[#{hole_index}][#{index}]", vertex_count) }
    end
    geometry_input_face_record_from_loops(outer, holes, face_spec)
  end

  def geometry_input_face_record_from_loops(outer, holes, face_spec)
    {
      'outer' => outer,
      'holes' => holes,
      'id' => face_spec['id'] || face_spec['face_id'] || face_spec['faceId'],
      'material' => face_spec['material'],
      'back_material' => face_spec['back_material'] || face_spec['backMaterial'],
      'smooth' => face_spec['smooth'],
      'soft' => face_spec['soft'],
      'reversed' => !!(face_spec['reversed'] || face_spec['reverse']),
      'normal' => face_spec['normal'],
      'plane' => face_spec['plane'],
      'area' => face_spec['area'],
      'pushpull' => face_spec['pushpull'],
      'followme' => face_spec['followme'],
      'position_material' => face_spec['position_material'] || face_spec['positionMaterial'],
      'metadata' => face_spec['metadata']
    }
  end

  def apply_geometry_input_face_metadata(face, face_record)
    if face.respond_to?(:set_attribute)
      face.set_attribute('GeometryInputFace', 'id', face_record['id']) if face_record['id']
      face.set_attribute('GeometryInputFace', 'metadata_json', JSON.generate(face_record['metadata'])) if face_record['metadata']
    end
    face.reverse! if face_record['reversed'] && face.respond_to?(:reverse!)
    if face_record['material']
      face.material = ensure_material(face_record['material'], '#cccccc')
    end
    if face_record['back_material']
      face.back_material = ensure_material(face_record['back_material'], '#cccccc')
    end
    apply_geometry_input_position_material(face, face_record)
    if face_record['followme'].is_a?(Hash)
      apply_geometry_input_followme(face, face_record)
    else
      apply_geometry_input_pushpull(face, face_record)
    end
  end

  def apply_geometry_input_position_material(face, face_record)
    spec = face_record['position_material']
    return unless spec.is_a?(Hash)
    return unless face.respond_to?(:position_material)

    material_name = spec['material'] || face_record['material']
    material = material_name ? ensure_material(material_name, '#cccccc') : face.material
    return unless material

    front = spec.key?('front') ? boolean_value(spec['front'], 'geometry_input.position_material.front') : true
    face.material = material if front
    face.back_material = material unless front
    mapping = position_material_mapping(spec)
    return if mapping.length < 4

    if spec['direction']
      direction = vector(spec['direction'], 'geometry_input.position_material.direction')
      face.position_material(material, mapping, front, Geom::Vector3d.new(*direction))
    else
      face.position_material(material, mapping, front)
    end
  rescue StandardError => error
    add_warning('geometry.texture_position_failed', 'warn', "geometry_input position_material failed: #{error.message}", 'geometry_input.position_material')
  end

  def position_material_mapping(spec)
    raw_mapping = spec['mapping']
    if raw_mapping.is_a?(Array)
      result = []
      raw_mapping.each_with_index do |entry, index|
        raise "geometry_input.position_material.mapping[#{index}] must be an object" unless entry.is_a?(Hash)

        point = vector(entry['point'], "geometry_input.position_material.mapping[#{index}].point").map { |value| mm_to_model_units(value) }
        uv = uv_pair(entry['uv'], "geometry_input.position_material.mapping[#{index}].uv")
        result << Geom::Point3d.new(*point)
        result << Geom::Point3d.new(uv[0], uv[1], 0)
      end
      return result
    end
    []
  end

  def apply_geometry_input_followme(face, face_record)
    followme = face_record['followme']
    return unless followme.is_a?(Hash)
    return unless face.respond_to?(:followme)
    path = followme['path']
    return unless path.is_a?(Array) && path.length >= 2

    entities = face.parent if face.respond_to?(:parent) && face.parent.respond_to?(:add_line)
    return unless entities

    points = path.each_with_index.map do |point, index|
      x, y, z = vector(point, "geometry_input.followme.path[#{index}]").map { |value| mm_to_model_units(value) }
      Geom::Point3d.new(x, y, z)
    end
    edges = points.each_cons(2).map { |start_point, end_point| entities.add_line(start_point, end_point) }.compact
    return if edges.empty?

    face.followme(edges)
  rescue StandardError => error
    add_warning('geometry.followme_failed', 'warn', "geometry_input followme failed: #{error.message}", 'geometry_input.followme')
  end

  def apply_geometry_input_pushpull(face, face_record)
    pushpull = face_record['pushpull']
    return unless pushpull.is_a?(Hash)

    metadata_only = pushpull.key?('metadata_only') ? boolean_value(pushpull['metadata_only'], 'geometry_input.pushpull.metadata_only') : true
    return if metadata_only

    distance = finite_number(pushpull['distance'], 'geometry_input.pushpull.distance')
    copy = boolean_value(pushpull['copy'] || false, 'geometry_input.pushpull.copy')
    model_distance = mm_to_model_units(distance)
    copy ? face.pushpull(model_distance, true) : face.pushpull(model_distance)
  rescue StandardError => error
    add_warning('geometry.boolean_failed', 'warn', "geometry_input pushpull failed: #{error.message}", 'geometry_input.pushpull')
  end

  def write_geometry_input_snapshot(group, face_records, explicit_edges)
    return unless group.respond_to?(:set_attribute)

    geometry_input = {
      'faces' => face_records,
      'edges' => explicit_edges,
      'face_count' => face_records.length,
      'edge_count' => geometry_input_edge_count(face_records, explicit_edges),
      'loop_count' => face_records.sum { |record| 1 + record['holes'].length }
    }
    group.set_attribute('GeometryInput', 'geometry_input_json', JSON.generate(geometry_input))
  end

  def geometry_input_edge_count(face_records, explicit_edges)
    edges = {}
    explicit_edges.each { |edge| edges[geometry_input_edge_key(edge[0], edge[1])] = true }
    face_records.each do |record|
      geometry_input_add_loop_edges(edges, record['outer'])
      record['holes'].each { |hole| geometry_input_add_loop_edges(edges, hole) }
    end
    edges.length
  end

  def geometry_input_add_loop_edges(edge_map, loop)
    loop.each_with_index do |start_index, index|
      edge_map[geometry_input_edge_key(start_index, loop[(index + 1) % loop.length])] = true
    end
  end

  def geometry_input_edge_key(a, b)
    left, right = [a, b].sort
    "#{left}:#{right}"
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
    add_mesh(parent_entities, 'name' => name, 'id' => operation['id'], 'object_id' => operation['object_id'], 'objectId' => operation['objectId'], 'guid' => operation['guid'], 'vertices' => vertices, 'faces' => faces, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'all', 'kind' => operation['kind'] || 'cylinder', 'qa' => operation['qa'])
  end
end
