# frozen_string_literal: true

module AlmaSketchupMCP
  extend self

  def add_box(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation.fetch('origin'), "#{name}.origin").map { |value| mm_to_model_units(value) }
    size = vector(operation.fetch('size'), "#{name}.size").map { |value| mm_to_model_units(value) }
    raise "#{name}.size values must be positive" if size.any? { |value| value <= 0 }

    x, y, z = origin
    w, d, h = size
    group = parent_entities.add_group
    group.name = name
    annotate_group(group, operation, 'box')
    face = group.entities.add_face(
      Geom::Point3d.new(x, y, z),
      Geom::Point3d.new(x + w, y, z),
      Geom::Point3d.new(x + w, y + d, z),
      Geom::Point3d.new(x, y + d, z)
    )
    raise "Failed to create face for #{name}" unless face

    face.reverse! if face.normal.z < 0
    face.pushpull(h)

    material_name = operation['material']
    if material_name
      material = ensure_material(material_name, '#cccccc')
      group.entities.grep(Sketchup::Face).each do |group_face|
        group_face.material = material
        group_face.back_material = material
      end
    end
    apply_transform(group, operation)
    group
  end

  def add_image_plane(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation.fetch('origin'), "#{name}.origin").map { |value| mm_to_model_units(value) }
    size = size2(operation.fetch('size'), "#{name}.size").map { |value| mm_to_model_units(value) }
    plane = operation['plane'] || 'xy'
    raise "#{name}.plane must be one of xy, xz, yz" unless %w[xy xz yz].include?(plane)

    width, height = size
    group = parent_entities.add_group
    group.name = name
    annotate_group(group, operation, 'image_plane')
    points = [
      point_for_plane(origin, plane, 0, 0),
      point_for_plane(origin, plane, width, 0),
      point_for_plane(origin, plane, width, height),
      point_for_plane(origin, plane, 0, height)
    ]
    face = group.entities.add_face(points)
    raise "Failed to create face for #{name}" unless face

    material = image_plane_material(operation, name, width, height)
    if material
      face.material = material
      face.back_material = material
    end
    group.set_attribute('AlmaSketchupMCP', 'image', operation['image'] || operation['texture']) if operation['image'] || operation['texture']
    group.set_attribute('AlmaSketchupMCP', 'plane', plane)
    if operation['texture_transform']
      texture_transform = texture_transform_payload(operation['texture_transform'], "#{name}.texture_transform")
      write_texture_transform_attributes(group, texture_transform)
    end
    apply_transform(group, operation)
    group
  end

  def add_rounded_box(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin")
    size = vector(operation.fetch('size'), "#{name}.size")
    raise "#{name}.size values must be positive" if size.any? { |value| value <= 0 }

    radius = [non_negative_number(operation['radius'], 0, "#{name}.radius"), size[0] / 2.0, size[1] / 2.0].min
    segments = integer_range(operation['segments'] || 5, 1, 16, "#{name}.segments")
    x, y, z = origin
    w, d, h = size
    points = rounded_rect_points(x, y, w, d, radius, segments)
    bottom = points.map { |px, py| [px, py, z] }
    top = points.map { |px, py| [px, py, z + h] }
    count = points.length
    faces = [
      (0...count).to_a,
      (0...count).map { |index| count + count - 1 - index }
    ]
    (0...count).each do |index|
      faces << [index, (index + 1) % count, count + ((index + 1) % count), count + index]
    end
    add_mesh(parent_entities, operation.merge('vertices' => bottom + top, 'faces' => faces, 'smooth' => operation['smooth'] || 'all', 'kind' => operation['kind'] || 'rounded_box'))
  end

  def add_beveled_panel(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin")
    size = vector(operation.fetch('size'), "#{name}.size")
    raise "#{name}.size values must be positive" if size.any? { |value| value <= 0 }

    bevel = [non_negative_number(operation['bevel'], 0, "#{name}.bevel"), size[0] / 2.0, size[1] / 2.0].min
    x, y, z = origin
    w, d, h = size
    points = beveled_rect_points(x, y, w, d, bevel)
    add_footprint_extrusion_mesh(parent_entities, operation.merge('smooth' => operation['smooth'] || 'coplanar', 'kind' => 'beveled_panel'), points, z, h)
  end

  def add_fillet(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin")
    size = vector(operation.fetch('size'), "#{name}.size")
    raise "#{name}.size values must be positive" if size.any? { |value| value <= 0 }

    radius = [non_negative_number(operation['radius'], 0, "#{name}.radius"), size[0] / 2.0, size[1] / 2.0].min
    segments = integer_range(operation['segments'] || 5, 1, 32, "#{name}.segments")
    x, y, z = origin
    w, d, h = size
    points = rounded_rect_points(x, y, w, d, radius, segments)
    add_footprint_extrusion_mesh(parent_entities, operation.merge('smooth' => operation['smooth'] || 'all', 'kind' => 'fillet'), points, z, h)
    group = parent_entities.grep(Sketchup::Group).last
    group.set_attribute('AlmaSketchupMCP', 'segments', segments) if group&.respond_to?(:set_attribute)
  end

  def add_chamfer(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin")
    size = vector(operation.fetch('size'), "#{name}.size")
    raise "#{name}.size values must be positive" if size.any? { |value| value <= 0 }

    amount = [non_negative_number(operation['amount'] || operation['bevel'], 0, "#{name}.amount"), size[0] / 2.0, size[1] / 2.0].min
    x, y, z = origin
    w, d, h = size
    points = beveled_rect_points(x, y, w, d, amount)
    add_footprint_extrusion_mesh(parent_entities, operation.merge('smooth' => operation['smooth'] || 'coplanar', 'kind' => 'chamfer'), points, z, h)
  end

  def add_footprint_extrusion_mesh(parent_entities, operation, points, z, height)
    bottom = points.map { |px, py| [px, py, z] }
    top = points.map { |px, py| [px, py, z + height] }
    count = points.length
    faces = [
      (0...count).to_a,
      (0...count).map { |index| count + count - 1 - index }
    ]
    (0...count).each do |index|
      faces << [index, (index + 1) % count, count + ((index + 1) % count), count + index]
    end
    add_mesh(parent_entities, operation.merge('vertices' => bottom + top, 'faces' => faces))
  end

  def rounded_rect_points(x, y, width, depth, radius, segments)
    return [[x, y], [x + width, y], [x + width, y + depth], [x, y + depth]] if radius <= 0

    corners = [
      { cx: x + width - radius, cy: y + radius, start: -Math::PI / 2.0, finish: 0.0 },
      { cx: x + width - radius, cy: y + depth - radius, start: 0.0, finish: Math::PI / 2.0 },
      { cx: x + radius, cy: y + depth - radius, start: Math::PI / 2.0, finish: Math::PI },
      { cx: x + radius, cy: y + radius, start: Math::PI, finish: Math::PI * 1.5 }
    ]
    points = []
    corners.each do |corner|
      (0..segments).each do |index|
        t = index.to_f / segments
        angle = corner[:start] + (corner[:finish] - corner[:start]) * t
        points << [corner[:cx] + radius * Math.cos(angle), corner[:cy] + radius * Math.sin(angle)]
      end
    end
    dedupe_plan_points(points)
  end

  def dedupe_plan_points(points)
    unique = []
    points.each do |point|
      previous = unique.last
      unique << point if previous.nil? || Math.hypot(previous[0] - point[0], previous[1] - point[1]) > 1e-9
    end
    if unique.length > 1
      first = unique.first
      last = unique.last
      unique.pop if Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1e-9
    end
    unique
  end

  def beveled_rect_points(x, y, width, depth, bevel)
    return [[x, y], [x + width, y], [x + width, y + depth], [x, y + depth]] if bevel <= 0

    [
      [x + bevel, y],
      [x + width - bevel, y],
      [x + width, y + bevel],
      [x + width, y + depth - bevel],
      [x + width - bevel, y + depth],
      [x + bevel, y + depth],
      [x, y + depth - bevel],
      [x, y + bevel]
    ]
  end

  def add_recess(parent_entities, operation)
    name = operation.fetch('name')
    center = vector(operation['center'] || operation['origin'] || [0, 0, 0], "#{name}.center")
    width, depth = plan_size(operation.fetch('size'), "#{name}.size")
    recess_depth = positive_number(operation['depth'], nil, "#{name}.depth")
    radius = [non_negative_number(operation['radius'], 0, "#{name}.radius"), width / 2.0, depth / 2.0].min
    segments = integer_range(operation['segments'] || 5, 1, 32, "#{name}.segments")
    x, y, z = center
    points = rounded_rect_points(x - width / 2.0, y - depth / 2.0, width, depth, radius, segments)
    top = points.map { |px, py| [px, py, z] }
    bottom = points.map { |px, py| [px, py, z - recess_depth] }
    count = points.length
    faces = [(0...count).map { |index| count + count - 1 - index }]
    (0...count).each do |index|
      faces << [index, (index + 1) % count, count + ((index + 1) % count), count + index]
    end
    add_mesh(parent_entities, operation.merge('vertices' => top + bottom, 'faces' => faces, 'material' => operation['material'] || 'Recess_Dark', 'smooth' => operation['smooth'] || 'coplanar', 'kind' => 'recess'))
  end

  def add_engraved_line(parent_entities, operation)
    name = operation.fetch('name')
    points = operation.fetch('points')
    raise "#{name}.points must contain at least 2 [x, y, z] points" unless points.is_a?(Array) && points.length >= 2

    normalized_points = points.each_with_index.map { |point, index| vector(point, "#{name}.points[#{index}]") }
    line_width = positive_number(operation['width'], nil, "#{name}.width")
    line_depth = positive_number(operation['depth'], 1, "#{name}.depth")
    vertices = []
    faces = []
    (0...(normalized_points.length - 1)).each do |index|
      start_point = normalized_points[index]
      end_point = normalized_points[index + 1]
      dx = end_point[0] - start_point[0]
      dy = end_point[1] - start_point[1]
      length = Math.hypot(dx, dy)
      raise "#{name}.points[#{index}] and points[#{index + 1}] must not be identical in XY" if length <= 1e-9

      nx = (-dy / length) * (line_width / 2.0)
      ny = (dx / length) * (line_width / 2.0)
      z = start_point[2]
      base = vertices.length
      vertices.concat([
        [start_point[0] + nx, start_point[1] + ny, z], [end_point[0] + nx, end_point[1] + ny, z], [end_point[0] - nx, end_point[1] - ny, z], [start_point[0] - nx, start_point[1] - ny, z],
        [start_point[0] + nx, start_point[1] + ny, z - line_depth], [end_point[0] + nx, end_point[1] + ny, z - line_depth], [end_point[0] - nx, end_point[1] - ny, z - line_depth], [start_point[0] - nx, start_point[1] - ny, z - line_depth]
      ])
      faces.concat([[base + 4, base + 7, base + 6, base + 5], [base, base + 4, base + 5, base + 1], [base + 1, base + 5, base + 6, base + 2], [base + 2, base + 6, base + 7, base + 3], [base + 3, base + 7, base + 4, base]])
    end
    add_mesh(parent_entities, operation.merge('vertices' => vertices, 'faces' => faces, 'material' => operation['material'] || 'Groove_Dark', 'smooth' => operation['smooth'] || 'coplanar', 'kind' => 'engraved_line'))
  end

  def add_text_emboss(parent_entities, operation)
    name = operation.fetch('name')
    marker = text_marker_mesh(operation, name, 1)
    add_mesh(parent_entities, operation.merge('vertices' => marker[:vertices], 'faces' => marker[:faces], 'material' => operation['material'] || 'Text_Emboss_Light', 'smooth' => operation['smooth'] || 'coplanar', 'kind' => 'text_emboss'))
    group = parent_entities.grep(Sketchup::Group).last
    group.set_attribute('AlmaSketchupMCP', 'glyphs', marker[:glyphs]) if group&.respond_to?(:set_attribute)
  end

  def add_text_engrave(parent_entities, operation)
    name = operation.fetch('name')
    marker = text_marker_mesh(operation, name, -1)
    add_mesh(parent_entities, operation.merge('vertices' => marker[:vertices], 'faces' => marker[:faces], 'material' => operation['material'] || 'Text_Engrave_Dark', 'smooth' => operation['smooth'] || 'coplanar', 'kind' => 'text_engrave'))
    group = parent_entities.grep(Sketchup::Group).last
    group.set_attribute('AlmaSketchupMCP', 'glyphs', marker[:glyphs]) if group&.respond_to?(:set_attribute)
  end

  def text_marker_mesh(operation, name, direction)
    text = operation['text']
    raise "#{name}.text must be a non-empty string" unless text.is_a?(String) && !text.empty?

    anchor = vector(operation['center'] || operation['origin'] || [0, 0, 0], "#{name}.#{operation.key?('center') ? 'center' : 'origin'}")
    glyph_height = positive_number(operation['height'], nil, "#{name}.height")
    text_depth = positive_number(operation['depth'], 1, "#{name}.depth")
    spacing = non_negative_number(operation['spacing'], glyph_height * 0.2, "#{name}.spacing")
    glyph_width = positive_number(operation['width'], glyph_height * 0.6, "#{name}.width")
    align = operation['align'] || (operation.key?('center') ? 'center' : 'left')
    raise "#{name}.align must be one of left, center, right" unless %w[left center right].include?(align)

    characters = text.each_char.to_a
    total_width = (characters.length * glyph_width) + ([characters.length - 1, 0].max * spacing)
    start_x = case align
              when 'center' then anchor[0] - total_width / 2.0
              when 'right' then anchor[0] - total_width
              else anchor[0]
              end

    vertices = []
    faces = []
    cursor = start_x
    glyphs = 0
    characters.each do |character|
      unless character.match?(/\s/)
        z0 = direction.positive? ? anchor[2] : anchor[2] - text_depth
        base = vertices.length
        x0 = cursor
        x1 = cursor + glyph_width
        y0 = anchor[1]
        y1 = anchor[1] + glyph_height
        z1 = z0 + text_depth
        vertices.concat([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]])
        faces.concat([[base, base + 1, base + 2, base + 3], [base + 4, base + 7, base + 6, base + 5], [base, base + 4, base + 5, base + 1], [base + 1, base + 5, base + 6, base + 2], [base + 2, base + 6, base + 7, base + 3], [base + 3, base + 7, base + 4, base]])
        glyphs += 1
      end
      cursor += glyph_width + spacing
    end
    raise "#{name}.text must include at least one non-space character" if glyphs.zero?

    { vertices: vertices, faces: faces, glyphs: glyphs }
  end

  def add_slot(parent_entities, operation)
    name = operation.fetch('name')
    length = positive_number(operation['length'], nil, "#{name}.length")
    width = positive_number(operation['width'], nil, "#{name}.width")
    raise "#{name}.length must be greater than or equal to width" if length < width

    add_recess(parent_entities, operation.merge('size' => [length, width], 'radius' => width / 2.0, 'material' => operation['material'] || 'Slot_Dark', 'smooth' => operation['smooth'] || 'all', 'kind' => 'slot'))
    group = parent_entities.grep(Sketchup::Group).last
    annotate_group(group, operation.merge('kind' => 'slot'), 'slot') if group
  end

  def add_slot_array(parent_entities, operation)
    name = operation.fetch('name')
    count = integer_range(operation['count'], 1, 500, "#{name}.count")
    spacing = positive_number(operation['spacing'], nil, "#{name}.spacing")
    length = positive_number(operation['length'], nil, "#{name}.length")
    width = positive_number(operation['width'], nil, "#{name}.width")
    depth = positive_number(operation['depth'], nil, "#{name}.depth")
    raise "#{name}.length must be greater than or equal to width" if length < width

    direction = operation['direction'] || 'x'
    raise "#{name}.direction must be x or y" unless %w[x y].include?(direction)

    segments = integer_range(operation['segments'] || 8, 1, 16, "#{name}.segments")
    anchor = vector(operation['center'] || operation['origin'] || [0, 0, 0], "#{name}.#{operation.key?('center') ? 'center' : 'origin'}")
    start_offset = operation.key?('center') ? -((count - 1) * spacing) / 2.0 : 0
    vertices = []
    faces = []
    count.times do |index|
      offset = start_offset + (index * spacing)
      center = direction == 'x' ? [anchor[0] + offset, anchor[1], anchor[2]] : [anchor[0], anchor[1] + offset, anchor[2]]
      slot_vertices, slot_faces = slot_recess_mesh(center, length, width, depth, direction, segments)
      base = vertices.length
      vertices.concat(slot_vertices)
      faces.concat(slot_faces.map { |face| face.map { |face_index| face_index + base } })
    end
    add_mesh(parent_entities, operation.merge('vertices' => vertices, 'faces' => faces, 'material' => operation['material'] || 'Slot_Dark', 'smooth' => operation['smooth'] || 'all', 'kind' => 'slot_array'))
    group = parent_entities.grep(Sketchup::Group).last
    if group&.respond_to?(:set_attribute)
      group.set_attribute('AlmaSketchupMCP', 'count', count)
      group.set_attribute('AlmaSketchupMCP', 'segments', segments)
      group.set_attribute('AlmaSketchupMCP', 'direction', direction)
    end
  end

  def slot_recess_mesh(center, length, width, depth, direction, segments)
    x, y, z = center
    slot_width = direction == 'x' ? length : width
    slot_depth = direction == 'x' ? width : length
    points = rounded_rect_points(x - slot_width / 2.0, y - slot_depth / 2.0, slot_width, slot_depth, [slot_width, slot_depth].min / 2.0, segments)
    top = points.map { |px, py| [px, py, z] }
    bottom = points.map { |px, py| [px, py, z - depth] }
    point_count = points.length
    faces = [(0...point_count).map { |face_index| point_count + point_count - 1 - face_index }]
    (0...point_count).each do |face_index|
      faces << [face_index, (face_index + 1) % point_count, point_count + ((face_index + 1) % point_count), point_count + face_index]
    end
    [top + bottom, faces]
  end

  def add_rib(parent_entities, operation)
    name = operation.fetch('name')
    direction = operation['direction'] || 'x'
    raise "#{name}.direction must be x or y" unless %w[x y].include?(direction)

    length = positive_number(operation['length'], nil, "#{name}.length")
    height = positive_number(operation['height'], nil, "#{name}.height")
    thickness = positive_number(operation['thickness'], nil, "#{name}.thickness")
    size = direction == 'x' ? [length, thickness, height] : [thickness, length, height]
    add_box(parent_entities, operation.merge('size' => size, 'kind' => 'rib'))
    group = parent_entities.grep(Sketchup::Group).last
    annotate_group(group, operation.merge('kind' => 'rib'), 'rib') if group
  end

  def add_standoff_boss(parent_entities, operation)
    name = operation.fetch('name')
    center = vector(operation['center'] || operation['origin'] || [0, 0, 0], "#{name}.center")
    outer_radius = positive_number(operation['outer_radius'] || operation['outerRadius'], nil, "#{name}.outer_radius")
    inner_radius = positive_number(operation['inner_radius'] || operation['innerRadius'], nil, "#{name}.inner_radius")
    height = positive_number(operation['height'], nil, "#{name}.height")
    raise "#{name}.inner_radius must be smaller than outer_radius" if inner_radius >= outer_radius

    segments = integer_range(operation['segments'] || 16, 3, 96, "#{name}.segments")
    group = parent_entities.add_group
    group.name = name
    annotate_group(group, operation.merge('kind' => 'standoff_boss'), 'standoff_boss')
    add_cylinder(group.entities, 'name' => "#{name}_Outer_Post", 'origin' => center, 'radius' => outer_radius, 'height' => height, 'segments' => segments, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'all', 'kind' => 'standoff_boss_outer')
    add_cylinder(group.entities, 'name' => "#{name}_Hole_Marker", 'origin' => [center[0], center[1], center[2] + 0.2], 'radius' => inner_radius, 'height' => [height - 0.4, height * 0.8].max, 'segments' => segments, 'material' => operation['hole_material'] || operation['holeMaterial'] || 'Slot_Dark', 'smooth' => operation['smooth'] || 'all', 'kind' => 'standoff_boss_hole')
    group.set_attribute('AlmaSketchupMCP', 'segments', segments) if group.respond_to?(:set_attribute)
    apply_transform(group, operation)
    group
  end

  def add_button_on_panel(parent_entities, operation)
    name = operation.fetch('name')
    center = vector(operation['center'] || operation['origin'] || [0, 0, 0], "#{name}.center")
    height = positive_number(operation['height'], nil, "#{name}.height")
    segments = integer_range(operation['segments'] || 16, 3, 96, "#{name}.segments")
    x, y, z = center
    if operation.key?('size')
      width, depth = plan_size(operation['size'], "#{name}.size")
      corner_radius = operation['corner_radius'] || operation['cornerRadius'] || [width, depth].min / 2.0
      radius = [non_negative_number(corner_radius, 0, "#{name}.corner_radius"), width / 2.0, depth / 2.0].min
      add_rounded_box(parent_entities, operation.merge('origin' => [x - width / 2.0, y - depth / 2.0, z], 'size' => [width, depth, height], 'radius' => radius, 'segments' => segments, 'smooth' => operation['smooth'] || 'all', 'kind' => 'button_on_panel'))
    else
      add_cylinder(parent_entities, operation.merge('origin' => center, 'height' => height, 'segments' => segments, 'kind' => 'button_on_panel'))
    end
  end
end
