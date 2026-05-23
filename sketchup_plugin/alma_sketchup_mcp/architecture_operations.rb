# frozen_string_literal: true

module AlmaSketchupMCP
  extend self

  def add_level(operation)
    name = operation.fetch('name')
    @levels ||= []
    level = {
      'name' => name,
      'elevation' => finite_number(operation['elevation'] || 0, "#{name}.elevation")
    }
    level['height'] = positive_number(operation['height'], nil, "#{name}.height") if operation.key?('height')
    @levels << level
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

  def add_wall(parent_entities, operation)
    name = operation.fetch('name')
    start_point = vector(operation.fetch('start'), "#{name}.start")
    end_point = vector(operation.fetch('end'), "#{name}.end")
    height = positive_number(operation['height'], nil, "#{name}.height")
    thickness = positive_number(operation['thickness'], 120, "#{name}.thickness")
    dx = end_point[0] - start_point[0]
    dy = end_point[1] - start_point[1]
    raise "#{name}.start and end must not be identical" if dx.zero? && dy.zero?
    raise "#{name} supports axis-aligned walls only in the MVP" if !dx.zero? && !dy.zero?

    if dx.abs >= dy.abs
      origin = [start_point[0], start_point[1], start_point[2]]
      origin[0] = [start_point[0], end_point[0]].min
      add_panel_with_openings(parent_entities, operation.merge('origin' => origin, 'plane' => 'xz', 'size' => [dx.abs, height], 'thickness' => thickness))
    else
      origin = [start_point[0], start_point[1], start_point[2]]
      origin[1] = [start_point[1], end_point[1]].min
      add_panel_with_openings(parent_entities, operation.merge('origin' => origin, 'plane' => 'yz', 'size' => [dy.abs, height], 'thickness' => thickness))
    end
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
    add_pipe_between_points(parent_entities, 'name' => "#{name}_Top_Rail", 'points' => rail_path, 'radius' => rail_radius, 'segments' => 8, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'all', 'kind' => 'railing_rail')
    points_along_polyline(points, post_spacing).each_with_index do |point, index|
      add_cylinder(parent_entities, 'name' => "#{name}_Post_#{index + 1}", 'origin' => point, 'radius' => post_radius, 'height' => rail_height, 'segments' => 8, 'material' => operation['material'], 'smooth' => operation['smooth'] || 'all', 'kind' => 'railing_post')
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
end
