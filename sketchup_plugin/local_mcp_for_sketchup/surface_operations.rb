# frozen_string_literal: true

module LocalMcpForSketchUp
  extend self

  def add_loft_between_profiles(parent_entities, operation)
    name = operation.fetch('name')
    profiles = operation.fetch('profiles')
    raise "#{name}.profiles must contain at least 2 profile sections" unless profiles.is_a?(Array) && profiles.length >= 2

    sections = profiles.each_with_index.map { |section, index| normalize_loft_profile_section(section, "#{name}.profiles[#{index}]") }
    point_count = sections.first.length
    raise "#{name}.profiles[0].points must contain at least 3 points" if point_count < 3
    sections.each_with_index do |section, index|
      raise "#{name}.profiles[#{index}].points must contain #{point_count} points to match the first profile" unless section.length == point_count
    end

    vertices = sections.flatten(1)
    faces = []
    (0...(sections.length - 1)).each do |ring|
      base = ring * point_count
      top = (ring + 1) * point_count
      point_count.times do |i|
        nxt = (i + 1) % point_count
        faces << [base + i, base + nxt, top + nxt]
        faces << [base + i, top + nxt, top + i]
      end
    end
    (1...(point_count - 1)).each { |i| faces << [0, i + 1, i] }
    top_start = (sections.length - 1) * point_count
    (1...(point_count - 1)).each { |i| faces << [top_start, top_start + i, top_start + i + 1] }
    add_mesh(parent_entities, 'name' => name, 'vertices' => vertices, 'faces' => faces, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'all', 'transform' => operation['transform'], 'kind' => operation['kind'] || 'loft_between_profiles', 'qa' => operation['qa'])
    group = parent_entities.grep(Sketchup::Group).last
    group.set_attribute('LocalMcpForSketchUp', 'segments_z', sections.length - 1) if group&.respond_to?(:set_attribute)
  end

  def normalize_loft_profile_section(section, field_name)
    if section.is_a?(Array)
      return section.each_with_index.map { |point, index| vector(point, "#{field_name}[#{index}]") }
    end
    raise "#{field_name} must be an array of points or an object with points" unless section.is_a?(Hash)

    origin = vector(section['origin'] || [0, 0, 0], "#{field_name}.origin")
    points = section['points']
    raise "#{field_name}.points must contain at least 3 points" unless points.is_a?(Array) && points.length >= 3
    plane = section['plane'] || 'xy'
    raise "#{field_name}.plane must be one of xy, xz, yz" unless %w[xy xz yz].include?(plane)

    points.each_with_index.map do |point, index|
      raise "#{field_name}.points[#{index}] must be [u, v]" unless point.is_a?(Array) && point.length == 2

      u = point[0].to_f
      v = point[1].to_f
      raise "#{field_name}.points[#{index}] must contain finite numbers" unless u.finite? && v.finite?
      case plane
      when 'xy' then [origin[0] + u, origin[1] + v, origin[2]]
      when 'xz' then [origin[0] + u, origin[1], origin[2] + v]
      else [origin[0], origin[1] + u, origin[2] + v]
      end
    end
  end

  def add_shell_from_front_side_profiles(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin")
    front_profile = normalize_2d_profile(operation['front_profile'] || operation['frontProfile'], "#{name}.front_profile", 'x', 'z')
    side_profile = normalize_2d_profile(operation['side_profile'] || operation['sideProfile'], "#{name}.side_profile", 'z', 'half_depth').sort_by { |point| point[0] }
    raise "#{name}.front_profile must contain at least 3 [x, z] points" if front_profile.length < 3
    raise "#{name}.side_profile must contain at least 2 [z, half_depth] points" if side_profile.length < 2
    (1...side_profile.length).each do |index|
      raise "#{name}.side_profile z values must be strictly increasing" if side_profile[index][0] <= side_profile[index - 1][0]
    end
    side_profile.each_with_index do |point, index|
      raise "#{name}.side_profile[#{index}][1] must be non-negative" if point[1] < 0
    end

    ox, oy, oz = origin
    front_vertices = front_profile.map do |x, z|
      [ox + x, oy - shell_depth_at(side_profile, z, name), oz + z]
    end
    back_vertices = front_profile.map do |x, z|
      [ox + x, oy + shell_depth_at(side_profile, z, name), oz + z]
    end
    count = front_profile.length
    faces = []
    (1...(count - 1)).each { |i| faces << [0, i, i + 1] }
    (1...(count - 1)).each { |i| faces << [count, count + i + 1, count + i] }
    count.times do |i|
      nxt = (i + 1) % count
      faces << [i, nxt, count + nxt]
      faces << [i, count + nxt, count + i]
    end
    add_mesh(parent_entities, 'name' => name, 'vertices' => front_vertices + back_vertices, 'faces' => faces, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'all', 'transform' => operation['transform'], 'kind' => operation['kind'] || 'shell_from_front_side_profiles', 'qa' => operation['qa'])
    group = parent_entities.grep(Sketchup::Group).last
    group.set_attribute('LocalMcpForSketchUp', 'segments', count) if group&.respond_to?(:set_attribute)
  end

  def normalize_2d_profile(profile, field_name, first_label, second_label)
    raise "#{field_name} must be an array of [#{first_label}, #{second_label}] pairs" unless profile.is_a?(Array)

    profile.each_with_index.map do |point, index|
      raise "#{field_name}[#{index}] must be [#{first_label}, #{second_label}]" unless point.is_a?(Array) && point.length == 2

      first = point[0].to_f
      second = point[1].to_f
      raise "#{field_name}[#{index}] must contain finite numbers" unless first.finite? && second.finite?
      [first, second]
    end
  end

  def shell_depth_at(side_profile, z, name)
    return side_profile.first[1] if z <= side_profile.first[0]
    return side_profile.last[1] if z >= side_profile.last[0]

    (0...(side_profile.length - 1)).each do |index|
      z0, depth0 = side_profile[index]
      z1, depth1 = side_profile[index + 1]
      if z >= z0 && z <= z1
        raise "#{name}.side_profile z values must be strictly increasing" if (z1 - z0).abs <= 1e-9

        t = (z - z0) / (z1 - z0)
        return depth0 + (depth1 - depth0) * t
      end
    end
    side_profile.last[1]
  end

  def add_face_on_cylinder(parent_entities, operation)
    name = operation.fetch('name')
    cylinder_center = vector(operation['cylinder_center'] || operation['cylinderCenter'] || [0, 0, 0], "#{name}.cylinder_center")
    surface_center = vector(operation.fetch('center'), "#{name}.center")
    radius = positive_number(operation['cylinder_radius'] || operation['cylinderRadius'], nil, "#{name}.cylinder_radius")
    width = positive_number(operation['width'], nil, "#{name}.width")
    height = positive_number(operation['height'], nil, "#{name}.height")
    depth = positive_number(operation['depth'], 1, "#{name}.depth")
    theta = operation.key?('angle') ? operation['angle'].to_f : Math.atan2(surface_center[1] - cylinder_center[1], surface_center[0] - cylinder_center[0])
    raise "#{name}.angle must be a finite number" unless theta.finite?

    radial = [Math.cos(theta), Math.sin(theta), 0]
    tangent = [-Math.sin(theta), Math.cos(theta), 0]
    center_on_surface = [cylinder_center[0] + radial[0] * radius, cylinder_center[1] + radial[1] * radius, surface_center[2]]
    half_width = width / 2.0
    half_height = height / 2.0
    make_point = lambda do |tangent_offset, z_offset, radial_offset|
      [center_on_surface[0] + tangent[0] * tangent_offset + radial[0] * radial_offset, center_on_surface[1] + tangent[1] * tangent_offset + radial[1] * radial_offset, center_on_surface[2] + z_offset]
    end
    vertices = [
      make_point.call(-half_width, -half_height, 0), make_point.call(half_width, -half_height, 0), make_point.call(half_width, half_height, 0), make_point.call(-half_width, half_height, 0),
      make_point.call(-half_width, -half_height, depth), make_point.call(half_width, -half_height, depth), make_point.call(half_width, half_height, depth), make_point.call(-half_width, half_height, depth)
    ]
    faces = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]
    add_mesh(parent_entities, 'name' => name, 'vertices' => vertices, 'faces' => faces, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'coplanar', 'transform' => operation['transform'], 'kind' => operation['kind'] || 'face_on_cylinder', 'qa' => operation['qa'])
  end

  def add_lofted_solid(parent_entities, operation)
    name = operation.fetch('name')
    origin = operation['origin'] || [0, 0, 0]
    profile = operation.fetch('profile')
    raise "#{name}.profile must contain at least 2 [height, radius] pairs" unless profile.is_a?(Array) && profile.length >= 2

    segments = integer_range(operation['n'] || operation['segments'] || 10, 3, 96, "#{name}.segments")
    ox, oy, oz = origin.map(&:to_f)
    vertices = []
    profile.each_with_index do |profile_point, index|
      raise "#{name}.profile[#{index}] must be [height, radius]" unless profile_point.is_a?(Array) && profile_point.length == 2

      height = non_negative_number(profile_point[0], nil, "#{name}.profile[#{index}][0]")
      radius = positive_number(profile_point[1], nil, "#{name}.profile[#{index}][1]")
      segments.times do |i|
        angle = Math::PI * 2.0 * i / segments
        vertices << [ox + radius * Math.cos(angle), oy + radius * Math.sin(angle), oz + height]
      end
    end
    faces = []
    (0...(profile.length - 1)).each do |ring|
      base = ring * segments
      top = (ring + 1) * segments
      segments.times do |i|
        nxt = (i + 1) % segments
        faces << [base + i, base + nxt, top + nxt]
        faces << [base + i, top + nxt, top + i]
      end
    end
    (1...(segments - 1)).each { |i| faces << [0, i + 1, i] }
    top_start = (profile.length - 1) * segments
    (1...(segments - 1)).each { |i| faces << [top_start, top_start + i, top_start + i + 1] }
    add_mesh(parent_entities, 'name' => name, 'vertices' => vertices, 'faces' => faces, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'all', 'transform' => operation['transform'], 'kind' => operation['kind'] || 'lofted_solid', 'qa' => operation['qa'])
  end

  def add_analog_stick(parent_entities, operation)
    name = operation.fetch('name')
    height = positive_number(operation['height'], 125, "#{name}.height")
    shaft_height = positive_number(operation['shaft_height'] || operation['shaftHeight'], height * 0.45, "#{name}.shaft_height")
    raise "#{name}.shaft_height must be lower than height" if shaft_height >= height

    base_radius = positive_number(operation['base_radius'] || operation['baseRadius'], 135, "#{name}.base_radius")
    shaft_radius = positive_number(operation['shaft_radius'] || operation['shaftRadius'], 92, "#{name}.shaft_radius")
    cap_radius = positive_number(operation['cap_radius'] || operation['capRadius'], 180, "#{name}.cap_radius")
    top_radius = positive_number(operation['top_radius'] || operation['topRadius'], [shaft_radius, cap_radius * 0.72].max, "#{name}.top_radius")
    profile = operation['profile'] || [[0, base_radius], [shaft_height, shaft_radius], [height * 0.72, cap_radius], [height, top_radius]]
    add_lofted_solid(parent_entities, operation.merge('profile' => profile, 'kind' => 'analog_stick'))
  end

  def add_screw_hole(parent_entities, operation)
    name = operation.fetch('name')
    center = vector(operation['center'] || operation['origin'] || [0, 0, 0], "#{name}.center")
    radius = positive_number(operation['radius'], nil, "#{name}.radius")
    depth = positive_number(operation['depth'], 6, "#{name}.depth")
    head_radius = operation.key?('head_radius') || operation.key?('headRadius') ? positive_number(operation['head_radius'] || operation['headRadius'], nil, "#{name}.head_radius") : radius
    head_depth = operation.key?('head_depth') || operation.key?('headDepth') ? positive_number(operation['head_depth'] || operation['headDepth'], nil, "#{name}.head_depth") : [depth, [1, depth * 0.45].max].min
    clamped_head_depth = [head_depth, depth].min
    profile = if head_radius > radius
                [[0, head_radius], [clamped_head_depth, radius], [depth, radius]]
              else
                [[0, radius], [depth, radius]]
              end
    add_lofted_solid(parent_entities, operation.merge('origin' => [center[0], center[1], center[2] - depth], 'profile' => profile, 'material' => operation['material'] || 'Hole_Dark', 'kind' => 'screw_hole'))
  end

  def add_pipe_between_points(parent_entities, operation)
    name = operation.fetch('name')
    raw_path = operation['points'] || operation['path'] || (operation['start'] && operation['end'] ? [operation['start'], operation['end']] : nil)
    raise "#{name}.points must contain at least 2 [x, y, z] points" unless raw_path.is_a?(Array) && raw_path.length >= 2

    points = raw_path.each_with_index.map { |point, index| vector(point, "#{name}.points[#{index}]") }
    radius = positive_number(operation['radius'], nil, "#{name}.radius")
    segments = integer_range(operation['n'] || operation['segments'] || 8, 3, 96, "#{name}.segments")
    vertices = []
    points.each_with_index do |point, index|
      tangent = pipe_tangent(points, index, name)
      u_axis, v_axis = perpendicular_frame(tangent)
      x, y, z = point
      segments.times do |i|
        angle = Math::PI * 2.0 * i / segments
        cos = Math.cos(angle) * radius
        sin = Math.sin(angle) * radius
        vertices << [x + u_axis[0] * cos + v_axis[0] * sin, y + u_axis[1] * cos + v_axis[1] * sin, z + u_axis[2] * cos + v_axis[2] * sin]
      end
    end

    faces = []
    (0...(points.length - 1)).each do |ring|
      base = ring * segments
      top = (ring + 1) * segments
      segments.times do |i|
        nxt = (i + 1) % segments
        faces << [base + i, base + nxt, top + nxt]
        faces << [base + i, top + nxt, top + i]
      end
    end
    (1...(segments - 1)).each { |i| faces << [0, i + 1, i] }
    top_start = (points.length - 1) * segments
    (1...(segments - 1)).each { |i| faces << [top_start, top_start + i, top_start + i + 1] }
    add_mesh(parent_entities, 'name' => name, 'vertices' => vertices, 'faces' => faces, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'all', 'transform' => operation['transform'], 'kind' => operation['kind'] || 'pipe_between_points', 'qa' => operation['qa'])
    group = parent_entities.grep(Sketchup::Group).last
    group.set_attribute('LocalMcpForSketchUp', 'segments', segments) if group&.respond_to?(:set_attribute)
  end

  def pipe_tangent(points, index, name)
    previous_point = points[[index - 1, 0].max]
    next_point = points[[index + 1, points.length - 1].min]
    delta = [next_point[0] - previous_point[0], next_point[1] - previous_point[1], next_point[2] - previous_point[2]]
    length = Math.sqrt(delta[0] * delta[0] + delta[1] * delta[1] + delta[2] * delta[2])
    raise "#{name}.points must not contain repeated adjacent points" if length <= 1e-9

    delta.map { |value| value / length }
  end

  def perpendicular_frame(tangent)
    reference = tangent[2].abs < 0.9 ? [0, 0, 1] : [0, 1, 0]
    u_axis = normalize_3(cross_3(reference, tangent))
    v_axis = normalize_3(cross_3(tangent, u_axis))
    [u_axis, v_axis]
  end

  def cross_3(a, b)
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  end

  def normalize_3(values)
    length = Math.sqrt(values[0] * values[0] + values[1] * values[1] + values[2] * values[2])
    raise 'Cannot normalize zero-length vector' if length <= 1e-9

    values.map { |value| value / length }
  end

  def add_swept_path(parent_entities, operation)
    name = operation.fetch('name')
    path = operation.fetch('path')
    raise "#{name}.path must contain at least 2 [x, y, z] points" unless path.is_a?(Array) && path.length >= 2

    points = path.each_with_index.map { |point, index| vector(point, "#{name}.path[#{index}]") }
    radius = positive_number(operation['radius'], nil, "#{name}.radius")
    segments = integer_range(operation['n'] || operation['segments'] || 8, 3, 96, "#{name}.segments")
    vertices = []
    points.each do |x, y, z|
      segments.times do |i|
        angle = Math::PI * 2.0 * i / segments
        vertices << [x, y + radius * Math.cos(angle), z + radius * Math.sin(angle)]
      end
    end
    faces = []
    (0...(points.length - 1)).each do |ring|
      base = ring * segments
      top = (ring + 1) * segments
      segments.times do |i|
        nxt = (i + 1) % segments
        faces << [base + i, base + nxt, top + nxt]
        faces << [base + i, top + nxt, top + i]
      end
    end
    (1...(segments - 1)).each { |i| faces << [0, i + 1, i] }
    top_start = (points.length - 1) * segments
    (1...(segments - 1)).each { |i| faces << [top_start, top_start + i, top_start + i + 1] }
    add_mesh(parent_entities, 'name' => name, 'vertices' => vertices, 'faces' => faces, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'all', 'transform' => operation['transform'], 'kind' => operation['kind'] || 'swept_path', 'qa' => operation['qa'])
  end

  def add_domed_surface(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin")
    width = positive_number(operation['width'], nil, "#{name}.width")
    depth = positive_number(operation['depth'], nil, "#{name}.depth")
    thickness = positive_number(operation['thickness'], nil, "#{name}.thickness")
    crown = non_negative_number(operation['crown_height'] || operation['crownHeight'], 0, "#{name}.crown_height")
    x_segments = integer_range(operation['nx'] || operation['segments_x'] || 8, 1, 96, "#{name}.segments_x")
    y_segments = integer_range(operation['ny'] || operation['segments_y'] || 8, 1, 96, "#{name}.segments_y")
    x0, y0, z0 = origin
    cols = x_segments + 1
    bottom_index = lambda { |ix, iy| (iy * cols + ix) * 2 }
    top_index = lambda { |ix, iy| bottom_index.call(ix, iy) + 1 }
    vertices = []
    (0..y_segments).each do |iy|
      (0..x_segments).each do |ix|
        u = ix.to_f / x_segments
        v = iy.to_f / y_segments
        x = x0 + u * width
        y = y0 + v * depth
        du = (u - 0.5) * 2.0
        dv = (v - 0.5) * 2.0
        dome = crown * [0, 1 - du * du].max * [0, 1 - dv * dv].max
        vertices << [x, y, z0]
        vertices << [x, y, z0 + thickness + dome]
      end
    end
    faces = []
    (0...y_segments).each do |iy|
      (0...x_segments).each do |ix|
        faces << [top_index.call(ix, iy), top_index.call(ix + 1, iy), top_index.call(ix + 1, iy + 1)]
        faces << [top_index.call(ix, iy), top_index.call(ix + 1, iy + 1), top_index.call(ix, iy + 1)]
        faces << [bottom_index.call(ix, iy), bottom_index.call(ix + 1, iy + 1), bottom_index.call(ix + 1, iy)]
        faces << [bottom_index.call(ix, iy), bottom_index.call(ix, iy + 1), bottom_index.call(ix + 1, iy + 1)]
      end
    end
    add_grid_skirt_faces(faces, bottom_index, top_index, x_segments, y_segments)
    add_mesh(parent_entities, 'name' => name, 'vertices' => vertices, 'faces' => faces, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'all', 'transform' => operation['transform'], 'kind' => operation['kind'] || 'domed_surface', 'qa' => operation['qa'])
  end

  def add_bowed_panel(parent_entities, operation)
    name = operation.fetch('name')
    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin")
    width = positive_number(operation['width'], nil, "#{name}.width")
    height = positive_number(operation['height'], nil, "#{name}.height")
    thickness = positive_number(operation['thickness'], nil, "#{name}.thickness")
    bow_depth = finite_number(operation['bow_depth'] || operation['bowDepth'] || 0, "#{name}.bow_depth")
    raise "#{name}.thickness + bow_depth must stay positive" if thickness + [0, bow_depth].min <= 0

    x_segments = integer_range(operation['nx'] || operation['segments_x'] || 8, 1, 96, "#{name}.segments_x")
    z_segments = integer_range(operation['nz'] || operation['segments_z'] || 8, 1, 96, "#{name}.segments_z")
    x0, y0, z0 = origin
    cols = x_segments + 1
    front_index = lambda { |ix, iz| (iz * cols + ix) * 2 }
    back_index = lambda { |ix, iz| front_index.call(ix, iz) + 1 }
    vertices = []
    (0..z_segments).each do |iz|
      (0..x_segments).each do |ix|
        u = ix.to_f / x_segments
        v = iz.to_f / z_segments
        x = x0 + u * width
        z = z0 + v * height
        du = (u - 0.5) * 2.0
        dv = (v - 0.5) * 2.0
        bow = bow_depth * [0, 1 - du * du].max * [0, 1 - dv * dv].max
        vertices << [x, y0, z]
        vertices << [x, y0 + thickness + bow, z]
      end
    end
    faces = []
    (0...z_segments).each do |iz|
      (0...x_segments).each do |ix|
        faces << [front_index.call(ix, iz), front_index.call(ix + 1, iz + 1), front_index.call(ix + 1, iz)]
        faces << [front_index.call(ix, iz), front_index.call(ix, iz + 1), front_index.call(ix + 1, iz + 1)]
        faces << [back_index.call(ix, iz), back_index.call(ix + 1, iz), back_index.call(ix + 1, iz + 1)]
        faces << [back_index.call(ix, iz), back_index.call(ix + 1, iz + 1), back_index.call(ix, iz + 1)]
      end
    end
    add_grid_skirt_faces(faces, front_index, back_index, x_segments, z_segments)
    add_mesh(parent_entities, 'name' => name, 'vertices' => vertices, 'faces' => faces, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'all', 'transform' => operation['transform'], 'kind' => operation['kind'] || 'bowed_panel', 'qa' => operation['qa'])
  end

  def add_grid_skirt_faces(faces, lower_index, upper_index, x_segments, y_segments)
    (0...x_segments).each do |ix|
      faces << [lower_index.call(ix, 0), lower_index.call(ix + 1, 0), upper_index.call(ix + 1, 0)]
      faces << [lower_index.call(ix, 0), upper_index.call(ix + 1, 0), upper_index.call(ix, 0)]
      faces << [lower_index.call(ix, y_segments), upper_index.call(ix, y_segments), upper_index.call(ix + 1, y_segments)]
      faces << [lower_index.call(ix, y_segments), upper_index.call(ix + 1, y_segments), lower_index.call(ix + 1, y_segments)]
    end
    (0...y_segments).each do |iy|
      faces << [lower_index.call(0, iy), upper_index.call(0, iy), upper_index.call(0, iy + 1)]
      faces << [lower_index.call(0, iy), upper_index.call(0, iy + 1), lower_index.call(0, iy + 1)]
      faces << [lower_index.call(x_segments, iy), lower_index.call(x_segments, iy + 1), upper_index.call(x_segments, iy + 1)]
      faces << [lower_index.call(x_segments, iy), upper_index.call(x_segments, iy + 1), upper_index.call(x_segments, iy)]
    end
  end
end
