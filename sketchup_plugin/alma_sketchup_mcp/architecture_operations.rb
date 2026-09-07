# frozen_string_literal: true

module AlmaSketchupMCP
  extend self

  GEOMETRY_EPSILON = 1e-6 unless const_defined?(:GEOMETRY_EPSILON)

  def add_level(model, operation)
    name = operation.fetch('name')
    levels = document_state_array('levels', model)
    level = {
      'name' => name,
      'elevation' => finite_number(operation['elevation'] || 0, "#{name}.elevation")
    }
    level['height'] = positive_number(operation['height'], nil, "#{name}.height") if operation.key?('height')
    levels.reject! { |entry| entry.is_a?(Hash) && entry['name'].to_s == name.to_s }
    levels << level
    level
  end

  def add_floor_slab(parent_entities, operation)
    name = operation.fetch('name')
    origin = operation['origin'] || [0, 0, 0]
    width = positive_number(operation['width'], nil, "#{name}.width")
    depth = positive_number(operation['depth'], nil, "#{name}.depth")
    thickness = positive_number(operation['thickness'], 150, "#{name}.thickness")
    add_box(parent_entities, operation.merge('origin' => origin, 'size' => [width, depth, thickness]))
  end

  def add_footprint_slab(parent_entities, operation)
    name = operation.fetch('name')
    thickness = positive_number(operation['thickness'], nil, "#{name}.thickness")
    add_profile_extrude(parent_entities, operation.merge(
      'outer' => operation.fetch('points'),
      'holes' => operation['holes'] || [],
      'depth' => thickness,
      'plane' => 'xy',
      'kind' => 'footprint_slab'
    ))
  end

  def add_wall(parent_entities, operation)
    name = operation.fetch('name')
    start_point = vector(operation.fetch('start'), "#{name}.start")
    end_point = vector(operation.fetch('end'), "#{name}.end")
    height = positive_number(operation['height'], nil, "#{name}.height")
    thickness = positive_number(operation['thickness'], 120, "#{name}.thickness")
    dx = end_point[0] - start_point[0]
    dy = end_point[1] - start_point[1]
    length = Math.sqrt(dx**2 + dy**2)
    raise "#{name}.start and end must not be identical" if length <= GEOMETRY_EPSILON
    raise "#{name} wall endpoints must share an elevation" if (end_point[2] - start_point[2]).abs > GEOMETRY_EPSILON
    normalized_openings = normalize_wall_openings(operation['openings'] || [], [length], height, "#{name}.openings", false)
    panel_openings = normalized_openings.map { |o| { 'name' => o['name'], 'x' => o['offset'], 'y' => o['sill_height'], 'width' => o['width'], 'height' => o['height'] } }

    axis_aligned = dx.abs <= GEOMETRY_EPSILON || dy.abs <= GEOMETRY_EPSILON
    unless axis_aligned
      group = add_panel_with_openings(parent_entities, operation.merge('origin' => [0, -thickness / 2.0, 0], 'plane' => 'xz', 'size' => [length, height], 'thickness' => thickness, 'openings' => panel_openings, 'kind' => 'wall'))
      apply_transform(group, 'name' => name, 'transform' => { 'rotateZ' => Math.atan2(dy, dx) * 180.0 / Math::PI })
      apply_transform(group, 'name' => name, 'transform' => { 'translate' => start_point })
      apply_wall_placement_transform(group, operation)
      return group
    end

    if dx.abs >= dy.abs
      origin = [start_point[0], start_point[1], start_point[2]]
      origin[0] = [start_point[0], end_point[0]].min
      group = add_panel_with_openings(parent_entities, operation.merge('origin' => origin, 'plane' => 'xz', 'size' => [dx.abs, height], 'thickness' => thickness, 'openings' => panel_openings, 'kind' => 'wall'))
    else
      origin = [start_point[0], start_point[1], start_point[2]]
      origin[1] = [start_point[1], end_point[1]].min
      group = add_panel_with_openings(parent_entities, operation.merge('origin' => origin, 'plane' => 'yz', 'size' => [dy.abs, height], 'thickness' => thickness, 'openings' => panel_openings, 'kind' => 'wall'))
    end
    apply_wall_placement_transform(group, operation)
    group
  end

  def add_wall_path(parent_entities, operation)
    name = operation.fetch('name')
    path = operation.fetch('path')
    raise "#{name}.path must contain at least 2 [x, y, z] points" unless path.is_a?(Array) && path.length >= 2

    points = path.each_with_index.map { |point, index| vector(point, "#{name}.path[#{index}]") }
    assert_unique_3d_points(points, "#{name}.path")
    height = positive_number(operation['height'], nil, "#{name}.height")
    thickness = positive_number(operation['thickness'], 120, "#{name}.thickness")
    lengths = points.each_cons(2).map { |a, b| Math.sqrt((b[0] - a[0])**2 + (b[1] - a[1])**2) }
    openings = normalize_wall_openings(operation['openings'] || [], lengths, height, "#{name}.openings", true)
    mesh = build_joined_wall_mesh(points, height, thickness, openings, name)
    raw_operation = operation.reject { |key, _| %w[transform translation rotateZ].include?(key) }
    group = add_mesh(parent_entities, raw_operation.merge('vertices' => mesh['vertices'], 'faces' => mesh['faces'], 'kind' => operation['kind'] || 'wall_path'))
    apply_wall_placement_transform(group, operation)
    group
  end

  def apply_wall_placement_transform(group, operation)
    transform = operation['transform'] || {}
    angle = transform['rotateZ'] || transform['rotationZ'] || operation['rotateZ']
    translation = transform['translate'] || transform['translation'] || operation['translation']
    apply_transform(group, 'name' => operation['name'], 'transform' => { 'rotateZ' => angle }) if angle
    apply_transform(group, 'name' => operation['name'], 'transform' => { 'translate' => translation }) if translation
    group
  end

  def add_curved_wall(parent_entities, operation)
    name = operation.fetch('name')
    center = vector(operation.fetch('center'), "#{name}.center")
    radius = positive_number(operation['radius'], nil, "#{name}.radius")
    height = positive_number(operation['height'], nil, "#{name}.height")
    thickness = positive_number(operation['thickness'], 120, "#{name}.thickness")
    segments = integer_range(operation['segments'] || 12, 2, 96, "#{name}.segments")
    start_angle = finite_number(operation['start_angle'] || operation['startAngle'], "#{name}.start_angle")
    end_angle = finite_number(operation['end_angle'] || operation['endAngle'], "#{name}.end_angle")
    raise "#{name}.end_angle must differ from start_angle" if (end_angle - start_angle).abs <= GEOMETRY_EPSILON

    points = []
    (segments + 1).times do |index|
      t = index.to_f / segments
      angle = (start_angle + (end_angle - start_angle) * t) * Math::PI / 180.0
      points << [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle), center[2]]
    end
    add_wall_path(parent_entities, operation.merge('path' => points, 'height' => height, 'thickness' => thickness, 'kind' => 'curved_wall'))
  end

  def add_roof_footprint(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin")
    elevation = finite_number(operation['elevation'] || origin[2], "#{name}.elevation")
    thickness = positive_number(operation['thickness'], 100, "#{name}.thickness")
    add_profile_extrude(parent_entities, operation.merge(
      'origin' => [origin[0], origin[1], elevation - thickness],
      'outer' => operation.fetch('points'),
      'holes' => operation['holes'] || [],
      'depth' => thickness,
      'plane' => 'xy',
      'kind' => 'roof_footprint'
    ))
  end

  def add_hip_roof(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin")
    width = positive_number(operation['width'], nil, "#{name}.width")
    depth = positive_number(operation['depth'], nil, "#{name}.depth")
    rise = positive_number(operation['rise'], nil, "#{name}.rise")
    thickness = positive_number(operation['thickness'], 80, "#{name}.thickness")
    overhang = non_negative_number(operation['overhang'], 0, "#{name}.overhang")
    ridge_ratio = finite_number(operation['ridge_ratio'] || operation['ridgeRatio'] || 0.35, "#{name}.ridge_ratio")
    raise "#{name}.ridge_ratio must be greater than 0 and less than 1" if ridge_ratio <= 0 || ridge_ratio >= 1

    x, y, z = origin
    min_x = x - overhang
    min_y = y - overhang
    w = width + overhang * 2
    d = depth + overhang * 2
    ridge_length = w * ridge_ratio
    ridge_start = min_x + (w - ridge_length) / 2.0
    ridge_end = ridge_start + ridge_length
    top = [[min_x, min_y, z], [min_x + w, min_y, z], [min_x + w, min_y + d, z], [min_x, min_y + d, z], [ridge_start, min_y + d / 2.0, z + rise], [ridge_end, min_y + d / 2.0, z + rise]]
    bottom = top.map { |px, py, pz| [px, py, pz - thickness] }
    faces = [[0, 1, 5, 4], [3, 4, 5, 2], [0, 4, 3], [1, 2, 5], [6, 10, 11, 7], [9, 8, 11, 10], [6, 9, 10], [7, 11, 8], [0, 6, 7, 1], [1, 7, 8, 2], [2, 8, 9, 3], [3, 9, 6, 0]]
    add_mesh(parent_entities, operation.merge('vertices' => top + bottom, 'faces' => faces, 'kind' => 'hip_roof', 'smooth' => operation['smooth'] || 'coplanar'))
  end

  def add_parapet_path(parent_entities, operation)
    name = operation.fetch('name')
    path = operation['path']
    if path.nil?
      origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin")
      points = operation.fetch('points')
      raise "#{name}.points must contain at least 2 [x, y] points" unless points.is_a?(Array) && points.length >= 2
      path = points.each_with_index.map do |point, index|
        raise "#{name}.points[#{index}] must be [x, y]" unless point.is_a?(Array) && point.length == 2
        [origin[0] + finite_number(point[0], "#{name}.points[#{index}][0]"), origin[1] + finite_number(point[1], "#{name}.points[#{index}][1]"), origin[2]]
      end
    end
    normalized = path.each_with_index.map { |point, index| vector(point, "#{name}.path[#{index}]") }
    normalized << normalized.first if operation['closed'] && distance_between(normalized.first, normalized.last) > GEOMETRY_EPSILON
    height = positive_number(operation['height'], 600, "#{name}.height")
    thickness = positive_number(operation['thickness'], 180, "#{name}.thickness")
    vertices = []
    faces = []
    normalized.each_cons(2).with_index do |(start_point, end_point), index|
      offset = vertices.length
      vertices.concat(wall_segment_vertices(start_point, end_point, height, thickness, "#{name}.path[#{index}]"))
      faces.concat(cuboid_faces(offset))
    end
    add_mesh(parent_entities, operation.merge('vertices' => vertices, 'faces' => faces, 'kind' => 'parapet_path'))
  end

  def add_curtain_wall(parent_entities, operation)
    name = operation.fetch('name')
    path = operation['path'] || (operation['start'] && operation['end'] ? [operation['start'], operation['end']] : nil)
    raise "#{name}.path must contain at least 2 [x, y, z] points or start/end" unless path.is_a?(Array) && path.length >= 2

    points = path.each_with_index.map { |point, index| vector(point, "#{name}.path[#{index}]") }
    height = positive_number(operation['height'], nil, "#{name}.height")
    module_width = positive_number(operation['module_width'] || operation['moduleWidth'], 1200, "#{name}.module_width")
    mullion_width = positive_number(operation['mullion_width'] || operation['mullionWidth'], 80, "#{name}.mullion_width")
    thickness = positive_number(operation['thickness'], 50, "#{name}.thickness")
    panel_thickness = positive_number(operation['panel_thickness'] || operation['panelThickness'], [thickness / 2.0, 30].min, "#{name}.panel_thickness")
    rows = integer_range(operation['row_count'] || operation['rowCount'] || 1, 1, 20, "#{name}.row_count")
    mesh = curtain_wall_grid_mesh(points, height, module_width, mullion_width, thickness, panel_thickness, rows, name)
    add_mesh(parent_entities, operation.merge(
      'vertices' => mesh['vertices'],
      'faces' => mesh['faces'],
      'material' => operation['frame_material'] || operation['frameMaterial'] || operation['material'],
      'kind' => 'curtain_wall'
    ))
  end

  def add_column_grid(parent_entities, operation)
    name = operation.fetch('name')
    height = positive_number(operation['height'], nil, "#{name}.height")
    shape = operation['shape'] || 'rect'
    points = column_grid_points(operation)
    group = parent_entities.add_group
    group.name = name
    annotate_group(group, operation.merge('kind' => 'column_grid'), 'column_grid')
    points.each_with_index do |point, index|
      column_name = "#{name}_Column_#{index + 1}"
      if shape == 'round'
        add_cylinder(group.entities, 'name' => column_name, 'origin' => point, 'radius' => positive_number(operation['radius'], nil, "#{name}.radius"), 'height' => height, 'segments' => operation['segments'] || 12, 'material' => operation['material'], 'kind' => 'column')
      else
        size = operation['column_size'] || operation['columnSize'] || [300, 300]
        raise "#{name}.column_size must be [width, depth]" unless size.is_a?(Array) && size.length == 2
        width = positive_number(size[0], nil, "#{name}.column_size[0]")
        depth = positive_number(size[1], nil, "#{name}.column_size[1]")
        add_box(group.entities, 'name' => column_name, 'origin' => [point[0] - width / 2.0, point[1] - depth / 2.0, point[2]], 'size' => [width, depth, height], 'material' => operation['material'], 'kind' => 'column')
      end
    end
    apply_transform(group, operation)
    group
  end

  def add_path_surface(parent_entities, operation)
    name = operation.fetch('name')
    path = operation.fetch('path')
    raise "#{name}.path must contain at least 2 [x, y, z] points" unless path.is_a?(Array) && path.length >= 2
    points = path.each_with_index.map { |point, index| vector(point, "#{name}.path[#{index}]") }
    width = positive_number(operation['width'], nil, "#{name}.width")
    thickness = positive_number(operation['thickness'], 20, "#{name}.thickness")
    vertices = []
    faces = []
    points.each_cons(2).with_index do |(start_point, end_point), index|
      offset = vertices.length
      vertices.concat(ribbon_segment_vertices(start_point, end_point, width, thickness, "#{name}.path[#{index}]"))
      faces.concat(cuboid_faces(offset))
    end
    add_mesh(parent_entities, operation.merge('vertices' => vertices, 'faces' => faces, 'kind' => 'path_surface'))
  end

  def add_terrain_mesh(parent_entities, operation)
    faces = operation.fetch('faces').each_with_object([]) do |face, triangulated|
      raise "#{operation.fetch('name')}.faces must contain face index loops" unless face.is_a?(Array) && face.length >= 3

      if face.length == 3
        triangulated << face
      else
        (1...(face.length - 1)).each { |index| triangulated << [face[0], face[index], face[index + 1]] }
      end
    end
    add_mesh(parent_entities, operation.merge('faces' => faces, 'kind' => 'terrain_mesh'))
  end

  def add_parking_stall_array(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin")
    count = integer_range(operation['count'], 1, 500, "#{name}.count")
    stall_width = positive_number(operation['stall_width'] || operation['stallWidth'], nil, "#{name}.stall_width")
    stall_depth = positive_number(operation['stall_depth'] || operation['stallDepth'], nil, "#{name}.stall_depth")
    line_width = positive_number(operation['line_width'] || operation['lineWidth'], 100, "#{name}.line_width")
    line_height = positive_number(operation['line_height'] || operation['lineHeight'], 5, "#{name}.line_height")
    direction = operation['direction'] || 'x'
    vertices = []
    faces = []
    parking_line_rectangles(origin, count, stall_width, stall_depth, line_width, line_height, direction).each do |rect|
      offset = vertices.length
      vertices.concat(box_vertices(rect['origin'], rect['size']))
      faces.concat(cuboid_faces(offset))
    end
    add_mesh(parent_entities, operation.merge('vertices' => vertices, 'faces' => faces, 'kind' => 'parking_stall_array'))
  end

  def add_door(parent_entities, operation)
    add_vertical_panel(parent_entities, operation, 'door')
  end

  def add_window(parent_entities, operation)
    add_vertical_panel(parent_entities, operation, 'window')
  end

  def add_vertical_panel(parent_entities, operation, kind)
    name = operation.fetch('name')
    origin = operation['origin'] || [0, 0, 0]
    plane = operation['plane'] || 'xz'
    width = positive_number(operation['width'], nil, "#{name}.width")
    height = positive_number(operation['height'], nil, "#{name}.height")
    thickness = positive_number(operation['thickness'], kind == 'door' ? 40 : 24, "#{name}.thickness")
    if plane == 'xz'
      add_box(parent_entities, operation.merge('origin' => origin, 'size' => [width, thickness, height]))
    elsif plane == 'yz'
      add_box(parent_entities, operation.merge('origin' => origin, 'size' => [thickness, width, height]))
    else
      raise "#{name}.plane must be xz or yz"
    end
  end

  def add_stairs(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin")
    steps = integer_range(operation['steps'], 1, 200, "#{name}.steps")
    width = positive_number(operation['width'], nil, "#{name}.width")
    tread = positive_number(operation['tread_depth'] || operation['treadDepth'], nil, "#{name}.tread_depth")
    riser = positive_number(operation['riser_height'] || operation['riserHeight'], nil, "#{name}.riser_height")
    direction = operation['direction'] || 'y'
    x, y, z = origin
    steps.times do |index|
      step_name = "#{name}_Step_#{index + 1}"
      if direction == 'x'
        add_box(parent_entities, operation.merge('name' => step_name, 'origin' => [x + index * tread, y, z], 'size' => [tread, width, (index + 1) * riser], 'kind' => 'stair_step'))
      elsif direction == 'y'
        add_box(parent_entities, operation.merge('name' => step_name, 'origin' => [x, y + index * tread, z], 'size' => [width, tread, (index + 1) * riser], 'kind' => 'stair_step'))
      else
        raise "#{name}.direction must be x or y"
      end
    end
  end

  def add_railing(parent_entities, operation)
    name = operation.fetch('name')
    path = operation.fetch('path')
    raise "#{name}.path must contain at least 2 [x, y, z] points" unless path.is_a?(Array) && path.length >= 2

    points = path.each_with_index.map { |point, index| vector(point, "#{name}.path[#{index}]") }
    rail_height = positive_number(operation['height'], 900, "#{name}.height")
    rail_radius = positive_number(operation['rail_radius'] || operation['railRadius'], 40, "#{name}.rail_radius")
    post_radius = positive_number(operation['post_radius'] || operation['postRadius'], 35, "#{name}.post_radius")
    post_spacing = positive_number(operation['post_spacing'] || operation['postSpacing'], 900, "#{name}.post_spacing")
    rail_path = points.map { |x, y, z| [x, y, z + rail_height] }
    curve_options = operation.select { |key, _| %w[chord_tolerance_mm max_segments].include?(key) }
    add_pipe_between_points(parent_entities, curve_options.merge('name' => "#{name}_Top_Rail", 'points' => rail_path, 'radius' => rail_radius, 'segments' => operation['rail_segments'] || operation['segments'] || 32, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'all', 'kind' => 'railing_rail'))
    points_along_polyline(points, post_spacing).each_with_index do |point, index|
      add_cylinder(parent_entities, curve_options.merge('name' => "#{name}_Post_#{index + 1}", 'origin' => point, 'radius' => post_radius, 'height' => rail_height, 'segments' => operation['post_segments'] || operation['segments'] || 32, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'all', 'kind' => 'railing_post'))
    end
  end

  def points_along_polyline(path, spacing)
    points = [path.first]
    distance_since_post = 0.0
    path.each_cons(2) do |start_point, end_point|
      length = distance_between(start_point, end_point)
      cursor = spacing - distance_since_post
      while cursor < length
        t = cursor / length
        points << interpolate_point(start_point, end_point, t)
        cursor += spacing
      end
      distance_since_post = length - (cursor - spacing)
      distance_since_post = 0.0 if distance_since_post.abs < 1e-6
    end
    points << path.last if distance_between(points.last, path.last) > 1e-6
    points
  end

  def distance_between(a, b)
    Math.sqrt((b[0] - a[0])**2 + (b[1] - a[1])**2 + (b[2] - a[2])**2)
  end

  def interpolate_point(a, b, t)
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
  end

  def curtain_wall_grid_mesh(path, height, module_width, mullion_width, frame_thickness, panel_thickness, rows, name)
    vertices = []
    faces = []
    path.each_cons(2).with_index do |(start_point, end_point), index|
      length = distance_between(start_point, end_point)
      raise "#{name}.path[#{index}] segment length must be positive" if length <= GEOMETRY_EPSILON

      modules = [(length / module_width).ceil, 1].max
      actual_module_width = length / modules
      row_height = height / rows
      modules.times do |module_index|
        left = module_index * actual_module_width + mullion_width / 2.0
        right = (module_index + 1) * actual_module_width - mullion_width / 2.0
        next if right - left <= GEOMETRY_EPSILON

        rows.times do |row_index|
          bottom = row_index * row_height + mullion_width / 2.0
          panel_height = row_height - mullion_width
          next if panel_height <= GEOMETRY_EPSILON

          add_curtain_wall_cuboid(vertices, faces, start_point, end_point, length, left, right, bottom, panel_height, panel_thickness, "#{name}.panels[#{module_index},#{row_index}]")
        end
      end

      (modules + 1).times do |module_index|
        center = module_index * actual_module_width
        left = [0, center - mullion_width / 2.0].max
        right = [length, center + mullion_width / 2.0].min
        next if right - left <= GEOMETRY_EPSILON

        add_curtain_wall_cuboid(vertices, faces, start_point, end_point, length, left, right, 0, height, frame_thickness, "#{name}.mullions[#{module_index}]")
      end

      (rows + 1).times do |row_index|
        center = row_index * row_height
        bottom = if row_index.zero?
                   0
                 elsif row_index == rows
                   height - mullion_width
                 else
                   center - mullion_width / 2.0
                 end
        rail_height = [mullion_width, height - bottom].min
        next if rail_height <= GEOMETRY_EPSILON

        add_curtain_wall_cuboid(vertices, faces, start_point, end_point, length, 0, length, bottom, rail_height, frame_thickness, "#{name}.rails[#{row_index}]")
      end
    end
    { 'vertices' => vertices, 'faces' => faces }
  end

  def add_curtain_wall_cuboid(vertices, faces, path_start, path_end, path_length, offset_start, offset_end, z_offset, height, thickness, field_name)
    start_point = point_along_segment(path_start, path_end, path_length, offset_start)
    end_point = point_along_segment(path_start, path_end, path_length, offset_end)
    base_start = [start_point[0], start_point[1], start_point[2] + z_offset]
    base_end = [end_point[0], end_point[1], end_point[2] + z_offset]
    offset = vertices.length
    vertices.concat(wall_segment_vertices(base_start, base_end, height, thickness, field_name))
    faces.concat(cuboid_faces(offset))
  end

  def point_along_segment(start_point, end_point, length, offset)
    interpolate_point(start_point, end_point, offset / length)
  end

  def column_grid_points(operation)
    name = operation.fetch('name')
    if operation['points']
      points = operation['points']
      raise "#{name}.points must contain at least one [x, y, z] point" unless points.is_a?(Array) && points.any?
      return points.each_with_index.map { |point, index| vector(point, "#{name}.points[#{index}]") }
    end

    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin")
    x_count = integer_range(operation['x_count'] || operation['xCount'], 1, 100, "#{name}.x_count")
    y_count = integer_range(operation['y_count'] || operation['yCount'], 1, 100, "#{name}.y_count")
    spacing = operation['spacing'] || [1000, 1000]
    raise "#{name}.spacing must be [x, y]" unless spacing.is_a?(Array) && spacing.length == 2
    spacing_x = positive_number(spacing[0], nil, "#{name}.spacing[0]")
    spacing_y = positive_number(spacing[1], nil, "#{name}.spacing[1]")
    points = []
    x_count.times do |ix|
      y_count.times do |iy|
        points << [origin[0] + ix * spacing_x, origin[1] + iy * spacing_y, origin[2]]
      end
    end
    points
  end

  def ribbon_segment_vertices(start_point, end_point, width, thickness, field_name)
    dx = end_point[0] - start_point[0]
    dy = end_point[1] - start_point[1]
    planar_length = Math.sqrt(dx**2 + dy**2)
    raise "#{field_name} must have horizontal length" if planar_length <= GEOMETRY_EPSILON

    nx = -dy / planar_length
    ny = dx / planar_length
    half = width / 2.0
    bottom = [
      [start_point[0] + nx * half, start_point[1] + ny * half, start_point[2]],
      [start_point[0] - nx * half, start_point[1] - ny * half, start_point[2]],
      [end_point[0] - nx * half, end_point[1] - ny * half, end_point[2]],
      [end_point[0] + nx * half, end_point[1] + ny * half, end_point[2]]
    ]
    bottom + bottom.map { |x, y, z| [x, y, z + thickness] }
  end

  def box_vertices(origin, size)
    x, y, z = origin
    w, d, h = size
    [[x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z],
     [x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]]
  end

  def parking_line_rectangles(origin, count, stall_width, stall_depth, line_width, line_height, direction)
    x, y, z = origin
    rectangles = []
    if direction == 'x'
      rectangles << { 'origin' => [x, y, z], 'size' => [count * stall_width, line_width, line_height] }
      rectangles << { 'origin' => [x, y + stall_depth - line_width, z], 'size' => [count * stall_width, line_width, line_height] }
      (count + 1).times do |index|
        rectangles << { 'origin' => [x + index * stall_width - line_width / 2.0, y, z], 'size' => [line_width, stall_depth, line_height] }
      end
    elsif direction == 'y'
      rectangles << { 'origin' => [x, y, z], 'size' => [line_width, count * stall_width, line_height] }
      rectangles << { 'origin' => [x + stall_depth - line_width, y, z], 'size' => [line_width, count * stall_width, line_height] }
      (count + 1).times do |index|
        rectangles << { 'origin' => [x, y + index * stall_width - line_width / 2.0, z], 'size' => [stall_depth, line_width, line_height] }
      end
    else
      raise 'parking_stall_array.direction must be x or y'
    end
    rectangles
  end

  def add_wall_segment_mesh(parent_entities, operation)
    name = operation.fetch('name')
    add_mesh(parent_entities, operation.merge(
      'vertices' => wall_segment_vertices(operation.fetch('start'), operation.fetch('end'), operation.fetch('height'), operation.fetch('thickness'), name),
      'faces' => cuboid_faces(0)
    ))
  end

  def wall_segment_vertices(start_point, end_point, height, thickness, field_name)
    dx = end_point[0] - start_point[0]
    dy = end_point[1] - start_point[1]
    length = Math.sqrt(dx**2 + dy**2)
    raise "#{field_name} segment length must be positive" if length <= GEOMETRY_EPSILON

    nx = -dy / length
    ny = dx / length
    half = thickness / 2.0
    bottom = [
      [start_point[0] + nx * half, start_point[1] + ny * half, start_point[2]],
      [start_point[0] - nx * half, start_point[1] - ny * half, start_point[2]],
      [end_point[0] - nx * half, end_point[1] - ny * half, end_point[2]],
      [end_point[0] + nx * half, end_point[1] + ny * half, end_point[2]]
    ]
    bottom + bottom.map { |x, y, z| [x, y, z + height] }
  end

  def cuboid_faces(offset)
    [
      [offset, offset + 1, offset + 2, offset + 3],
      [offset + 4, offset + 7, offset + 6, offset + 5],
      [offset, offset + 4, offset + 5, offset + 1],
      [offset + 1, offset + 5, offset + 6, offset + 2],
      [offset + 2, offset + 6, offset + 7, offset + 3],
      [offset + 3, offset + 7, offset + 4, offset]
    ]
  end

  def normalize_wall_openings(openings, lengths, height, field_name, with_segment)
    raise "#{field_name} must be an array" unless openings.is_a?(Array)
    normalized = openings.each_with_index.map do |opening, index|
      raise "#{field_name}[#{index}] must be an object" unless opening.is_a?(Hash)
      segment = with_segment ? integer_range(opening['segment_index'] || opening['segmentIndex'], 0, lengths.length - 1, "#{field_name}[#{index}].segment_index") : 0
      offset = non_negative_number(opening['offset'] || opening['x'] || opening.dig('origin', 0), nil, "#{field_name}[#{index}].offset")
      sill = non_negative_number(opening['sill_height'] || opening['sillHeight'] || opening['y'] || opening['z'] || opening.dig('origin', 1), 0, "#{field_name}[#{index}].sill_height")
      width = positive_number(opening['width'], nil, "#{field_name}[#{index}].width")
      opening_height = positive_number(opening['height'], nil, "#{field_name}[#{index}].height")
      raise "#{field_name}[#{index}] must fit inside wall segment length" if offset + width > lengths[segment] + GEOMETRY_EPSILON
      raise "#{field_name}[#{index}] must fit inside wall height" if sill + opening_height > height + GEOMETRY_EPSILON
      result = { 'name' => opening['name'] || 'Opening', 'offset' => offset, 'sill_height' => sill, 'width' => width, 'height' => opening_height }
      result['segment_index'] = segment if with_segment
      result
    end
    normalized.combination(2).each do |a, b|
      next if with_segment && a['segment_index'] != b['segment_index']
      x_overlap = [a['offset'], b['offset']].max < [a['offset'] + a['width'], b['offset'] + b['width']].min - GEOMETRY_EPSILON
      z_overlap = [a['sill_height'], b['sill_height']].max < [a['sill_height'] + a['height'], b['sill_height'] + b['height']].min - GEOMETRY_EPSILON
      raise "#{field_name} must not overlap another opening" if x_overlap && z_overlap
    end
    normalized
  end

  def build_joined_wall_mesh(points, height, thickness, openings = [], name = 'wall_path')
    half = thickness / 2.0; tangents = []; normals = []; lengths = []
    points.each_cons(2) do |a, b|
      dx = b[0] - a[0]; dy = b[1] - a[1]; length = Math.sqrt(dx**2 + dy**2)
      raise "#{name} has a zero-length plan segment" if length <= GEOMETRY_EPSILON
      raise "#{name} wall path must share one elevation" if (a[2] - points.first[2]).abs > GEOMETRY_EPSILON || (b[2] - points.first[2]).abs > GEOMETRY_EPSILON
      lengths << length; tangents << [dx / length, dy / length]; normals << [-dy / length, dx / length]
    end
    offsets = points.each_index.map do |i|
      if i.zero?
        normals.first.map { |x| x * half }
      elsif i == points.length - 1
        normals.last.map { |x| x * half }
      else
        a = normals[i - 1]; b = normals[i]; denominator = 1 + a[0] * b[0] + a[1] * b[1]
        raise "#{name} has a reversing wall corner" if denominator <= 1e-8
        offset = a.each_with_index.map { |x, j| (x + b[j]) * half / denominator }
        raise "#{name} wall corner exceeds the safe miter limit" if Math.sqrt(offset[0]**2 + offset[1]**2) > thickness * 4
        offset
      end
    end
    left = points.each_with_index.map { |p, i| [p[0] + offsets[i][0], p[1] + offsets[i][1]] }
    right = points.each_with_index.map { |p, i| [p[0] - offsets[i][0], p[1] - offsets[i][1]] }
    assert_simple_polygon(left + right.reverse, "#{name}.joined_outline")
    z_cuts = ([0, height] + openings.flat_map { |o| [o['sill_height'], o['sill_height'] + o['height']] }).uniq.sort
    vertices = []; vertex_index = {}; faces_by_key = {}
    vertex = lambda do |p|
      key = p.map { |x| (x * 1e8).round }.join(':')
      unless vertex_index.key?(key)
        vertex_index[key] = vertices.length; vertices << p
      end
      vertex_index[key]
    end
    add_face = lambda do |face|
      key = face.sort.join(':')
      faces_by_key.key?(key) ? faces_by_key.delete(key) : faces_by_key[key] = face
    end
    lengths.each_with_index do |length, segment|
      start_point = points[segment]; t = tangents[segment]; n = normals[segment]
      segment_openings = openings.select { |o| o['segment_index'] == segment }
      start_shift = (offsets[segment][0] * t[0] + offsets[segment][1] * t[1]).abs
      end_shift = (offsets[segment + 1][0] * t[0] + offsets[segment + 1][1] * t[1]).abs
      segment_openings.each do |o|
        raise "#{name} opening intersects a mitered corner; move it inside the clear segment" if o['offset'] < start_shift - GEOMETRY_EPSILON || o['offset'] + o['width'] > length - end_shift + GEOMETRY_EPSILON
      end
      x_cuts = ([0, length] + segment_openings.flat_map { |o| [o['offset'], o['offset'] + o['width']] }).uniq.sort
      cross = lambda do |s, side, z|
        sign = side.zero? ? 1 : -1
        if s.abs < GEOMETRY_EPSILON
          [start_point[0] + sign * offsets[segment][0], start_point[1] + sign * offsets[segment][1], start_point[2] + z]
        elsif (s - length).abs < GEOMETRY_EPSILON
          finish = points[segment + 1]
          [finish[0] + sign * offsets[segment + 1][0], finish[1] + sign * offsets[segment + 1][1], finish[2] + z]
        else
          [start_point[0] + t[0] * s + sign * n[0] * half, start_point[1] + t[1] * s + sign * n[1] * half, start_point[2] + z]
        end
      end
      x_cuts.each_cons(2) do |x0, x1|
        z_cuts.each_cons(2) do |z0, z1|
          cx = (x0 + x1) / 2.0; cz = (z0 + z1) / 2.0
          next if segment_openings.any? { |o| cx > o['offset'] - GEOMETRY_EPSILON && cx < o['offset'] + o['width'] + GEOMETRY_EPSILON && cz > o['sill_height'] - GEOMETRY_EPSILON && cz < o['sill_height'] + o['height'] + GEOMETRY_EPSILON }
          cell = [cross.call(x0, 0, z0), cross.call(x0, 1, z0), cross.call(x1, 1, z0), cross.call(x1, 0, z0), cross.call(x0, 0, z1), cross.call(x0, 1, z1), cross.call(x1, 1, z1), cross.call(x1, 0, z1)].map { |p| vertex.call(p) }
          cuboid_faces(0).each { |face| add_face.call(face.map { |i| cell[i] }.reverse) }
        end
      end
    end
    { 'vertices' => vertices, 'faces' => faces_by_key.values }
  end

  def normalize_simple_polygon(points, field_name)
    raise "#{field_name} must contain at least 3 [x, y] points" unless points.is_a?(Array) && points.length >= 3

    normalized = points.each_with_index.map do |point, index|
      raise "#{field_name}[#{index}] must be [x, y]" unless point.is_a?(Array) && point.length == 2

      [finite_number(point[0], "#{field_name}[#{index}][0]"), finite_number(point[1], "#{field_name}[#{index}][1]")]
    end
    assert_unique_2d_points(normalized, field_name)
    assert_simple_polygon(normalized, field_name)
    area = polygon_signed_area(normalized)
    raise "#{field_name} must enclose non-zero area" if area.abs <= GEOMETRY_EPSILON
    area.positive? ? normalized : normalized.reverse
  end

  def extrusion_faces(count)
    bottom = (0...count).map { |index| count - 1 - index }
    top = (0...count).map { |index| count + index }
    faces = [bottom, top]
    count.times do |index|
      faces << [index, (index + 1) % count, count + ((index + 1) % count), count + index]
    end
    faces
  end

  def assert_unique_2d_points(points, field_name)
    seen = {}
    points.each_with_index do |point, index|
      key = point_key(point)
      raise "#{field_name}[#{index}] must not duplicate another point" if seen[key]

      seen[key] = true
    end
  end

  def assert_unique_3d_points(points, field_name)
    seen = {}
    points.each_with_index do |point, index|
      key = point_key(point)
      raise "#{field_name}[#{index}] must not duplicate another point" if seen[key]

      seen[key] = true
    end
  end

  def assert_simple_polygon(points, field_name)
    points.length.times do |a|
      b = (a + 1) % points.length
      ((a + 1)...points.length).each do |c|
        d = (c + 1) % points.length
        next if a == c || b == c || a == d

        raise "#{field_name} must not self-intersect" if segments_intersect?(points[a], points[b], points[c], points[d])
      end
    end
  end

  def segments_intersect?(a, b, c, d)
    o1 = orientation(a, b, c)
    o2 = orientation(a, b, d)
    o3 = orientation(c, d, a)
    o4 = orientation(c, d, b)
    return true if o1.abs <= GEOMETRY_EPSILON && on_segment?(a, c, b)
    return true if o2.abs <= GEOMETRY_EPSILON && on_segment?(a, d, b)
    return true if o3.abs <= GEOMETRY_EPSILON && on_segment?(c, a, d)
    return true if o4.abs <= GEOMETRY_EPSILON && on_segment?(c, b, d)

    (o1.positive? != o2.positive?) && (o3.positive? != o4.positive?)
  end

  def orientation(a, b, c)
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  end

  def on_segment?(a, b, c)
    b[0] >= [a[0], c[0]].min - GEOMETRY_EPSILON &&
      b[0] <= [a[0], c[0]].max + GEOMETRY_EPSILON &&
      b[1] >= [a[1], c[1]].min - GEOMETRY_EPSILON &&
      b[1] <= [a[1], c[1]].max + GEOMETRY_EPSILON
  end

  def polygon_signed_area(points)
    area = 0.0
    points.each_with_index do |point, index|
      following = points[(index + 1) % points.length]
      area += point[0] * following[1] - following[0] * point[1]
    end
    area / 2.0
  end

  def point_key(point)
    point.map { |value| format('%.6f', value) }.join(':')
  end
end
