# frozen_string_literal: true

module LocalMcpForSketchUp
  extend self

  def add_boolean_cutout(parent_entities, operation)
    name = operation.fetch('name')
    origin = operation['origin'] || [0, 0, 0]
    size = vector(operation.fetch('size'), "#{name}.size")
    raise "#{name}.size values must be positive" if size.any? { |value| value <= 0 }

    width, depth, thickness = size
    cutouts = normalize_boolean_cutouts(operation['cutouts'], width, depth, name)
    add_panel_with_openings(parent_entities, 'op' => 'boolean_cutout', 'name' => name, 'origin' => origin, 'plane' => 'xy', 'size' => [width, depth], 'thickness' => thickness, 'openings' => cutouts, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'coplanar', 'kind' => 'boolean_cutout')
  end

  def normalize_boolean_cutouts(cutouts, width, depth, name)
    raise "#{name}.cutouts must contain at least one cutout" unless cutouts.is_a?(Array) && cutouts.length.positive?

    cutouts.each_with_index.map do |cutout, index|
      raise "#{name}.cutouts[#{index}] must be an object" unless cutout.is_a?(Hash)

      size = cutout['size']
      raise "#{name}.cutouts[#{index}].size must be [width, depth]" unless size.is_a?(Array) && size.length == 2
      cutout_width = positive_number(size[0], nil, "#{name}.cutouts[#{index}].size[0]")
      cutout_depth = positive_number(size[1], nil, "#{name}.cutouts[#{index}].size[1]")
      center = cutout['center']
      raise "#{name}.cutouts[#{index}].center must be [x, y]" unless center.is_a?(Array) && center.length == 2
      center_x = center[0].to_f
      center_y = center[1].to_f
      raise "#{name}.cutouts[#{index}].center must contain finite numbers" unless center_x.finite? && center_y.finite?
      x = center_x - cutout_width / 2.0
      y = center_y - cutout_depth / 2.0
      raise "#{name}.cutouts[#{index}] must fit inside slab bounds" if x < 0 || y < 0 || x + cutout_width > width || y + cutout_depth > depth

      { 'name' => cutout['name'] || "Cutout_#{index + 1}", 'x' => x, 'y' => y, 'width' => cutout_width, 'height' => cutout_depth }
    end
  end

  def add_face_with_holes(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin").map { |value| mm_to_model_units(value) }
    plane = operation['plane'] || 'xy'
    raise "#{name}.plane must be one of xy, xz, yz" unless %w[xy xz yz].include?(plane)

    outer = normalize_profile_loop(operation.fetch('outer'), "#{name}.outer")
    holes = normalize_profile_holes(operation['holes'] || [], name, outer)
    group = parent_entities.add_group
    group.name = name
    annotate_group(group, operation, 'face_with_holes')
    face = add_profile_face_with_holes(group.entities, origin, plane, outer, holes, false)
    raise "Failed to create face for #{name}" unless face

    material_name = operation['material']
    if material_name
      material = ensure_material(material_name, '#cccccc')
      group.entities.grep(Sketchup::Face).each { |face| face.material = material; face.back_material = material }
    end
    apply_transform(group, operation)
    group
  end

  def add_profile_extrude(parent_entities, operation)
    name = operation.fetch('name')
    plane = operation['plane'] || 'xy'
    raise "#{name}.plane must be one of xy, xz, yz" unless %w[xy xz yz].include?(plane)

    outer = normalize_profile_loop(operation.fetch('outer'), "#{name}.outer")
    holes = normalize_profile_holes(operation['holes'] || [], name, outer)
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin").map { |value| mm_to_model_units(value) }
    model_depth = mm_to_model_units(positive_number(operation.fetch('depth'), nil, "#{name}.depth"))

    group = parent_entities.add_group
    group.name = name
    annotate_group(group, operation.merge('kind' => operation['kind'] || 'profile_extrude'), 'profile_extrude')
    front = add_profile_face_with_holes(group.entities, origin, plane, outer, holes, false)
    back = add_profile_face_with_holes(group.entities, offset_origin(origin, plane, model_depth), plane, outer.reverse, holes, true)
    raise "Failed to create profile extrusion faces for #{name}" unless front && back

    add_panel_side_faces(group.entities, origin, plane, outer, model_depth)
    holes.each { |hole| add_panel_side_faces(group.entities, origin, plane, hole, model_depth) }

    material_name = operation['material']
    if material_name
      material = ensure_material(material_name, '#cccccc')
      group.entities.grep(Sketchup::Face).each { |face| face.material = material; face.back_material = material }
    end
    soften_edges(group, operation['smooth'] || 'coplanar')
    apply_transform(group, operation)
    group
  end

  def add_profile_face_with_holes(entities, origin, plane, outer, holes, reverse_holes)
    face = entities.add_face(outer.map { |u, v| point_for_plane(origin, plane, mm_to_model_units(u), mm_to_model_units(v)) })
    return nil unless face

    holes.each do |hole|
      loop = reverse_holes ? hole.reverse : hole
      hole_face = entities.add_face(loop.map { |u, v| point_for_plane(origin, plane, mm_to_model_units(u), mm_to_model_units(v)) })
      hole_face.erase! if hole_face && hole_face.valid?
    end
    face
  end

  def normalize_profile_holes(holes, name, outer)
    raise "#{name}.holes must be an array" unless holes.is_a?(Array)

    normalized = holes.each_with_index.map do |hole, index|
      points = hole.is_a?(Hash) ? (hole['points'] || hole[:points]) : hole
      normalize_profile_loop(points, "#{name}.holes[#{index}]")
    end
    validate_profile_holes(outer, normalized, name)
    normalized
  end

  def normalize_profile_loop(points, field_name)
    raise "#{field_name} must be an array of [x, y] points" unless points.is_a?(Array)

    normalized = points.each_with_index.map do |point, index|
      raise "#{field_name}[#{index}] must be [x, y]" unless point.is_a?(Array) && point.length == 2
      [finite_number(point[0], "#{field_name}[#{index}][0]"), finite_number(point[1], "#{field_name}[#{index}][1]")]
    end
    normalized = normalized[0...-1] if normalized.length > 1 && profile_points_equal?(normalized.first, normalized.last)
    raise "#{field_name} must contain at least 3 distinct [x, y] points" unless normalized.length >= 3

    seen = {}
    normalized.each_with_index do |point, index|
      key = "#{point[0]}:#{point[1]}"
      raise "#{field_name}[#{index}] repeats a non-adjacent profile point" if seen[key]
      raise "#{field_name}[#{index}] creates a zero-length profile edge" if profile_points_equal?(point, normalized[(index + 1) % normalized.length])

      seen[key] = true
    end
    raise "#{field_name} must enclose non-zero area" if profile_signed_area(normalized).abs <= 1e-9

    validate_no_profile_self_intersections(normalized, field_name)
    normalized
  end

  def validate_profile_holes(outer, holes, name)
    holes.each_with_index do |hole, hole_index|
      hole.each do |point|
        unless point_strictly_inside_profile?(point, outer)
          raise "#{name}.holes[#{hole_index}] must fit inside outer profile without touching boundary"
        end
      end
      validate_profile_loops_do_not_intersect(outer, hole, "#{name}.holes[#{hole_index}] must fit inside outer profile without crossing boundary")
    end

    holes.each_with_index do |hole, index|
      ((index + 1)...holes.length).each do |other_index|
        other = holes[other_index]
        message = "#{name}.holes[#{index}] must not overlap #{name}.holes[#{other_index}]"
        validate_profile_loops_do_not_intersect(hole, other, message)
        raise message if point_strictly_inside_profile?(hole.first, other) || point_strictly_inside_profile?(other.first, hole)
      end
    end
  end

  def validate_no_profile_self_intersections(loop, field_name)
    loop.each_with_index do |start_point, index|
      end_point = loop[(index + 1) % loop.length]
      ((index + 1)...loop.length).each do |other_index|
        next if profile_edges_adjacent?(index, other_index, loop.length)

        other_start = loop[other_index]
        other_end = loop[(other_index + 1) % loop.length]
        raise "#{field_name} must not self-intersect" if segments_intersect_2d?(start_point, end_point, other_start, other_end)
      end
    end
  end

  def validate_profile_loops_do_not_intersect(loop, other_loop, message)
    loop.each_with_index do |start_point, index|
      end_point = loop[(index + 1) % loop.length]
      other_loop.each_with_index do |other_start, other_index|
        other_end = other_loop[(other_index + 1) % other_loop.length]
        raise message if segments_intersect_2d?(start_point, end_point, other_start, other_end)
      end
    end
  end

  def profile_edges_adjacent?(first_index, second_index, count)
    first_index == second_index || (first_index - second_index).abs == 1 || (first_index.zero? && second_index == count - 1) || (second_index.zero? && first_index == count - 1)
  end

  def profile_points_equal?(first, second)
    (first[0] - second[0]).abs <= 1e-9 && (first[1] - second[1]).abs <= 1e-9
  end

  def profile_signed_area(points)
    area = 0.0
    points.each_with_index do |point, index|
      next_point = points[(index + 1) % points.length]
      area += point[0] * next_point[1] - next_point[0] * point[1]
    end
    area / 2.0
  end

  def point_strictly_inside_profile?(point, polygon)
    return false if polygon.each_with_index.any? { |start_point, index| point_on_segment_2d?(point, start_point, polygon[(index + 1) % polygon.length]) }

    x, y = point
    inside = false
    previous = polygon.length - 1
    polygon.each_with_index do |current, index|
      xi, yi = current
      xj, yj = polygon[previous]
      inside = !inside if (yi > y) != (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
      previous = index
    end
    inside
  end

  def segments_intersect_2d?(a, b, c, d)
    return false if [a[0], b[0]].max + 1e-9 < [c[0], d[0]].min || [c[0], d[0]].max + 1e-9 < [a[0], b[0]].min
    return false if [a[1], b[1]].max + 1e-9 < [c[1], d[1]].min || [c[1], d[1]].max + 1e-9 < [a[1], b[1]].min

    o1 = orientation_2d(a, b, c)
    o2 = orientation_2d(a, b, d)
    o3 = orientation_2d(c, d, a)
    o4 = orientation_2d(c, d, b)
    return true if o1.abs <= 1e-9 && point_on_segment_2d?(c, a, b)
    return true if o2.abs <= 1e-9 && point_on_segment_2d?(d, a, b)
    return true if o3.abs <= 1e-9 && point_on_segment_2d?(a, c, d)
    return true if o4.abs <= 1e-9 && point_on_segment_2d?(b, c, d)

    (o1.positive? != o2.positive?) && (o3.positive? != o4.positive?)
  end

  def orientation_2d(a, b, c)
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  end

  def point_on_segment_2d?(point, start_point, end_point)
    orientation_2d(start_point, end_point, point).abs <= 1e-9 &&
      point[0] >= [start_point[0], end_point[0]].min - 1e-9 &&
      point[0] <= [start_point[0], end_point[0]].max + 1e-9 &&
      point[1] >= [start_point[1], end_point[1]].min - 1e-9 &&
      point[1] <= [start_point[1], end_point[1]].max + 1e-9
  end

  def add_panel_with_openings(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin").map { |value| mm_to_model_units(value) }
    plane = operation['plane'] || 'xz'
    raise "#{name}.plane must be one of xy, xz, yz" unless %w[xy xz yz].include?(plane)

    size = operation.fetch('size')
    raise "#{name}.size must be [width, height]" unless size.is_a?(Array) && size.length == 2

    width = positive_number(size[0], nil, "#{name}.size[0]")
    height = positive_number(size[1], nil, "#{name}.size[1]")
    thickness = positive_number(operation['thickness'], 120, "#{name}.thickness")
    model_thickness = mm_to_model_units(thickness)
    openings = validate_openings(operation['openings'] || [], width, height, name)

    group = parent_entities.add_group
    group.name = name
    annotate_group(group, operation, 'panel_with_openings')
    outer = [[0, 0], [width, 0], [width, height], [0, height]]
    front = add_panel_face_with_holes(group.entities, origin, plane, outer, openings, false)
    back_origin = offset_origin(origin, plane, model_thickness)
    back = add_panel_face_with_holes(group.entities, back_origin, plane, outer.reverse, openings, true)
    raise "Failed to create panel faces for #{name}" unless front && back

    add_panel_side_faces(group.entities, origin, plane, outer, model_thickness)
    openings.each do |opening|
      x = opening['x']; y = opening['y']; w = opening['width']; h = opening['height']
      hole = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
      add_panel_side_faces(group.entities, origin, plane, hole, model_thickness)
    end

    material_name = operation['material']
    if material_name
      material = ensure_material(material_name, '#cccccc')
      group.entities.grep(Sketchup::Face).each do |group_face|
        group_face.material = material
        group_face.back_material = material
      end
    end
    soften_edges(group, operation['smooth'] || 'coplanar')
    group
  end

  def add_panel_face_with_holes(entities, origin, plane, outer, openings, reverse_holes)
    face = entities.add_face(outer.map { |u, v| point_for_plane(origin, plane, mm_to_model_units(u), mm_to_model_units(v)) })
    return nil unless face

    openings.each do |opening|
      x = opening['x']; y = opening['y']; w = opening['width']; h = opening['height']
      hole = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
      hole.reverse! if reverse_holes
      hole_face = entities.add_face(hole.map { |u, v| point_for_plane(origin, plane, mm_to_model_units(u), mm_to_model_units(v)) })
      hole_face.erase! if hole_face && hole_face.valid?
    end
    face
  end

  def add_panel_side_faces(entities, origin, plane, loop, model_thickness)
    loop.each_with_index do |point, index|
      next_point = loop[(index + 1) % loop.length]
      p1 = point_for_plane(origin, plane, mm_to_model_units(point[0]), mm_to_model_units(point[1]))
      p2 = point_for_plane(origin, plane, mm_to_model_units(next_point[0]), mm_to_model_units(next_point[1]))
      p3 = offset_point(p2, plane, model_thickness)
      p4 = offset_point(p1, plane, model_thickness)
      entities.add_face(p1, p2, p3, p4)
    end
  end

  def validate_openings(openings, width, height, name)
    raise "#{name}.openings must be an array" unless openings.is_a?(Array)

    openings.each_with_index.map do |opening, index|
      raise "#{name}.openings[#{index}] must be an object" unless opening.is_a?(Hash)

      x = finite_number(opening['x'] || (opening['origin'] && opening['origin'][0]), "#{name}.openings[#{index}].x")
      y = finite_number(opening['y'] || opening['z'] || (opening['origin'] && opening['origin'][1]), "#{name}.openings[#{index}].y")
      opening_width = positive_number(opening['width'], nil, "#{name}.openings[#{index}].width")
      opening_height = positive_number(opening['height'], nil, "#{name}.openings[#{index}].height")
      if x.negative? || y.negative? || x + opening_width > width || y + opening_height > height
        raise "#{name}.openings[#{index}] must fit inside panel bounds"
      end
      { 'name' => opening['name'] || "Opening_#{index + 1}", 'x' => x, 'y' => y, 'width' => opening_width, 'height' => opening_height }
    end
  end

  def offset_origin(origin, plane, model_depth)
    x, y, z = origin
    case plane
    when 'xy'
      [x, y, z + model_depth]
    when 'xz'
      [x, y + model_depth, z]
    when 'yz'
      [x + model_depth, y, z]
    end
  end

  def offset_point(point, plane, model_depth)
    case plane
    when 'xy'
      Geom::Point3d.new(point.x, point.y, point.z + model_depth)
    when 'xz'
      Geom::Point3d.new(point.x, point.y + model_depth, point.z)
    when 'yz'
      Geom::Point3d.new(point.x + model_depth, point.y, point.z)
    end
  end

  def add_gable_roof(parent_entities, operation)
    name = operation.fetch('name')
    origin = operation['origin'] || [0, 0, 0]
    width = positive_number(operation['width'], nil, "#{name}.width")
    depth = positive_number(operation['depth'], nil, "#{name}.depth")
    rise = positive_number(operation['rise'], nil, "#{name}.rise")
    overhang = non_negative_number(operation['overhang'], 0, "#{name}.overhang")
    add_prism(parent_entities, 'name' => name, 'origin' => [origin[0].to_f - overhang, origin[1].to_f - overhang, origin[2].to_f], 'plane' => 'xz', 'points' => [[0, 0], [(width + 2 * overhang) / 2.0, rise], [width + 2 * overhang, 0]], 'depth' => depth + 2 * overhang, 'material' => operation['material'], 'kind' => 'gable_roof')
  end

  def add_shed_roof(parent_entities, operation)
    name = operation.fetch('name')
    origin = operation['origin'] || [0, 0, 0]
    width = positive_number(operation['width'], nil, "#{name}.width")
    depth = positive_number(operation['depth'], nil, "#{name}.depth")
    rise = positive_number(operation['rise'], nil, "#{name}.rise")
    overhang = non_negative_number(operation['overhang'], 0, "#{name}.overhang")
    x = origin[0].to_f - overhang; y = origin[1].to_f - overhang; z = origin[2].to_f
    w = width + 2 * overhang; d = depth + 2 * overhang; t = operation['thickness'] || 80
    add_mesh(parent_entities, 'name' => name, 'vertices' => [[x,y,z],[x+w,y,z+rise],[x+w,y+d,z+rise],[x,y+d,z],[x,y,z-t],[x+w,y,z+rise-t],[x+w,y+d,z+rise-t],[x,y+d,z-t]], 'faces' => [[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]], 'material' => operation['material'], 'smooth' => 'coplanar', 'kind' => 'shed_roof', 'qa' => operation['qa'])
  end
end
