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
end
