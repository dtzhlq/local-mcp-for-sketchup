# frozen_string_literal: true
require_relative 'geometry_regions'

module AlmaSketchupMCP
  extend self

  # Evidence is reconstructed from native entities on every snapshot. Operation
  # attributes and declared feature lists are deliberately not used as proof.
  def geometry_occurrences(model)
    results = []
    context = { measurements: {}, face_meshes: {}, texture_writer: nil }
    visit = lambda do |entities, logical_path, persistent_path, ancestors, inherited_material, inherited_visible|
      entities.each do |entity|
        next unless entity.is_a?(Sketchup::Group) || entity.is_a?(Sketchup::ComponentInstance)
        definition = entity.definition
        next if ancestors.include?(definition.object_id)
        identifier = entity_id(entity) || (entity.name.to_s.empty? ? "pid:#{entity.persistent_id}" : entity.name)
        path = logical_path + [identifier]
        pids = persistent_path + [entity.persistent_id.to_s]
        visible = inherited_visible && entity_visible_for_detail?(entity)
        results << {
          'id' => identifier, 'part_id' => identifier,
          'name' => entity.name, 'instance_path' => path,
          'persistent_path' => pids, 'entity_path' => path.join('/'),
          'definition_name' => definition.name,
          'visible' => visible,
          'geometry_evidence' => measured_entity_geometry(entity, inherited_material, context, inherited_visible)
        }
        visit.call(definition.entities, path, pids, ancestors + [definition.object_id], entity.material || inherited_material, visible)
      end
    end
    visit.call(model.entities, [], [], [], nil, true)
    results
  end

  def measured_entity_geometry(entity, inherited_material = nil, context = nil, inherited_visible = true)
    context ||= { measurements: {}, face_meshes: {}, texture_writer: nil }
    effective_material = entity.material || inherited_material
    effective_visible = inherited_visible && entity_visible_for_detail?(entity)
    cache_key = [entity.definition.object_id, effective_material&.object_id, effective_visible]
    if context[:measurements].key?(cache_key)
      return geometry_with_repair_veto(context[:measurements][cache_key], entity)
    end
    faces = []
    edges = []
    repairs = []
    collect = lambda do |entities, transform, ancestors, material, visible|
      entities.each do |child|
        if child.is_a?(Sketchup::Face)
          faces << [child, transform, child.material || material, visible && entity_visible_for_detail?(child)]
        elsif child.is_a?(Sketchup::Edge)
          edges << [child, transform]
        elsif child.is_a?(Sketchup::Group) || child.is_a?(Sketchup::ComponentInstance)
          definition = child.definition
          next if ancestors.include?(definition.object_id)
          repairs << entity_manifold_report(child)&.dig('repair_strategy')
          collect.call(definition.entities, transform * child.transformation, ancestors + [definition.object_id], child.material || material, visible && entity_visible_for_detail?(child))
        end
      end
    end
    collect.call(entity.definition.entities, Geom::Transformation.new, [entity.definition.object_id], effective_material, effective_visible)
    bounds = Geom::BoundingBox.new
    edges.each { |edge, transform| edge.vertices.each { |vertex| bounds.add(vertex.position.transform(transform)) } }
    loops = faces.flat_map do |face, transform|
      face.loops.reject(&:outer?).map do |loop|
        points = loop.vertices.map { |vertex| vertex.position.transform(transform) }
        plane = Geom.fit_plane_to_points(points)
        { points: points, normal: Geom::Vector3d.new(plane.first(3)).normalize,
          face: face, edges: loop.edges, transform: transform }
      end
    end
    holes = measured_through_holes(loops, faces, context)
    textures = faces.map do |face, transform, material|
      next unless material && material.texture
      context[:texture_writer] ||= Sketchup.create_texture_writer
      helper = face.get_UVHelper(true, false, context[:texture_writer])
      points = face.outer_loop.vertices.first(4).map do |vertex|
        uvq = helper.get_front_UVQ(vertex.position)
        { 'point_mm' => vertex.position.transform(transform).to_a.map { |v| model_units_to_mm(v) },
          'uv' => [uvq.x / uvq.z, uvq.y / uvq.z] }
      end
      { 'face_pid' => face.persistent_id.to_s, 'material' => material.name,
        'texture_width_mm' => model_units_to_mm(material.texture.width),
        'texture_height_mm' => model_units_to_mm(material.texture.height), 'samples' => points }
    end.compact
    face_polygons = faces.map { |face, transform| face.loops.map { |loop| loop.vertices.map { |vertex| vertex.position.transform(transform).to_a } } }
    largest_outer = native_coplanar_outer_profiles(face_polygons).max_by(&:length)
    measurement = {
      'source' => 'sketchup_runtime', 'measured' => true, 'complete' => true,
      'face_count' => faces.length, 'edge_count' => edges.length,
      'visible_face_count' => faces.count { |_, _, _, visible| visible },
      'bounds_mm' => bounds.valid? ? bounds_hash(bounds) : nil,
      'closed_solid' => entity.respond_to?(:manifold?) ? entity.manifold? : nil,
      'profile_vertex_count' => faces.flat_map { |face, _| face.loops.map { |loop| loop.vertices.length } }.max || 0,
      'profile_outer_vertex_count' => largest_outer&.length || 0,
      'profile_outer_max_turn_degrees' => largest_outer ? maximum_outer_profile_turn(largest_outer) : nil,
      'material_names' => faces.map { |_, _, material| material&.name }.compact.uniq.sort,
      'repair_strategies' => repairs.compact.uniq,
      'through_holes' => holes, 'face_textures' => textures,
      'measurement_method' => 'native_faces_edges_and_convex_extrusion_tunnels.v2'
    }
    context[:measurements][cache_key] = measurement
    geometry_with_repair_veto(measurement, entity)
  rescue StandardError => error
    { 'source' => 'sketchup_runtime', 'measured' => false, 'complete' => false,
      'error' => "#{error.class}: #{error.message}" }
  end

  # SketchUp may triangulate a planar cap. Reconstruct each coplanar patch's
  # actual perimeter, cancelling internal edges, without counting inner holes.
  def native_coplanar_outer_profiles(face_loops)
    patches = {}
    face_loops.each do |loops|
      outer = loops.first
      next unless outer && outer.length >= 3
      normal = nil
      outer.drop(1).each_cons(2) do |a, b|
        candidate = evidence_cross(evidence_subtract(a, outer.first), evidence_subtract(b, outer.first))
        length = Math.sqrt(evidence_dot(candidate, candidate))
        if length > 1.0e-12
          normal = candidate.map { |v| v / length }
          break
        end
      end
      next unless normal
      normal = normal.map { |v| -v } if normal.find { |v| v.abs > 1.0e-8 } < 0
      plane = [*normal, -evidence_dot(normal, outer.first)]
      key = plane.map { |v| (v * 1.0e7).round }
      patch = patches[key] ||= { normal: normal, edges: {}, points: {} }
      loops.each do |loop|
        loop.each_with_index do |point, i|
          next_point = loop[(i + 1) % loop.length]
          a, b = [point, next_point].map { |p| p.map { |v| (v * 1.0e7).round }.join(':') }
          patch[:points][a] = point; patch[:points][b] = next_point
          edge = [a, b].sort
          patch[:edges][edge] = (patch[:edges][edge] || 0) + 1
        end
      end
    end
    patches.values.map do |patch|
      boundary = patch[:edges].select { |_, count| count == 1 }.keys
      neighbors = Hash.new { |h, k| h[k] = [] }
      boundary.each { |a, b| neighbors[a] << b; neighbors[b] << a }
      next if neighbors.empty? || neighbors.values.any? { |list| list.length != 2 }
      remaining = neighbors.keys.to_h { |key| [key, true] }
      loops = []
      until remaining.empty?
        start = remaining.keys.first; current = start; previous = nil; points = []
        loop do
          points << patch[:points][current]; remaining.delete(current)
          following = neighbors[current].find { |candidate| candidate != previous }
          previous, current = current, following
          break if current == start
          raise 'Invalid coplanar boundary cycle' unless remaining[current]
        end
        loops << points
      end
      # For an annular patch, its largest-area loop is the exterior. A round
      # internal opening cannot substitute for a rounded outer profile.
      loops.max_by do |points|
        points.each_with_index.sum { |point, i| evidence_dot(evidence_cross(point, points[(i + 1) % points.length]), patch[:normal]) }.abs
      end
    end.compact
  end

  def entity_visible_for_detail?(entity)
    return false if entity.respond_to?(:hidden?) && entity.hidden?
    tag = entity.respond_to?(:layer) ? entity.layer : nil
    return false if tag && tag.respond_to?(:visible?) && !tag.visible?
    folder = tag && tag.respond_to?(:folder) ? tag.folder : nil
    seen = {}
    while folder && !seen[folder.object_id]
      seen[folder.object_id] = true
      return false if folder.respond_to?(:visible?) && !folder.visible?
      folder = folder.respond_to?(:folder) ? folder.folder : (folder.respond_to?(:parent) ? folder.parent : nil)
    end
    true
  end

  def maximum_outer_profile_turn(points)
    points.each_with_index.map do |point, index|
      before = evidence_subtract(point, points[(index - 1) % points.length])
      after = evidence_subtract(points[(index + 1) % points.length], point)
      denominator = evidence_length(before) * evidence_length(after)
      next 0.0 if denominator <= 1.0e-20
      Math.acos([[evidence_dot(before, after) / denominator, -1.0].max, 1.0].min) * 180.0 / Math::PI
    end.max || 0.0
  end

  def geometry_with_repair_veto(measurement, entity)
    strategy = entity_manifold_report(entity)&.dig('repair_strategy')
    measurement.merge('repair_strategy' => strategy,
                      'repair_strategies' => (measurement['repair_strategies'] + [strategy]).compact.uniq)
  end

  # Only simple convex extrusion tunnels are positively verified. Ring pairs
  # without native connecting side faces, concave profiles, or any geometry
  # intersecting the full closed opening prism receive no verified receipt.
  def measured_through_holes(loops, faces, context = nil)
    context ||= { face_meshes: {} }
    verified = []
    consumed = {}
    tolerance = mm_to_model_units(0.02)
    loops.each_with_index do |first, index|
      next if consumed[index]
      loops.each_with_index do |other, other_index|
        next if other_index <= index || consumed[other_index]
        next unless first[:face] && other[:face] && first[:face].parent == other[:face].parent
        next unless first[:transform].to_a == other[:transform].to_a
        next unless first[:points].length == other[:points].length
        normal = first[:normal]
        next unless normal.parallel?(other[:normal])
        depth = (other[:points].first - first[:points].first).dot(normal)
        next if depth.abs <= tolerance
        translation = normal.clone
        translation.length = depth.abs
        translation.reverse! if depth < 0
        next unless first[:points].all? { |point| other[:points].any? { |target| point.offset(translation).distance(target) <= tolerance } }
        sides = extrusion_tunnel_sides(first, other, translation, tolerance)
        next unless sides
        prism = convex_opening_prism(first[:points].map(&:to_a), translation.to_a, tolerance)
        next unless prism
        excluded = [first[:face], other[:face], *sides]
        tunnel_points = first[:points].flat_map { |point| [point.to_a, point.offset(translation).to_a] }
        tunnel_min = 3.times.map { |axis| tunnel_points.map { |point| point[axis] }.min }
        tunnel_max = 3.times.map { |axis| tunnel_points.map { |point| point[axis] }.max }
        next if faces.any? do |face, transform|
          next false if excluded.include?(face) && transform.to_a == first[:transform].to_a
          mesh = transformed_face_mesh_for_detail(face, transform, context)
          next false if mesh[:triangles].empty?
          # Conservative broad phase only. Every candidate still uses the same
          # exact prism clipping; bounding boxes never establish a valid hole.
          next false if 3.times.any? { |axis| mesh[:max][axis] < tunnel_min[axis] - tolerance || mesh[:min][axis] > tunnel_max[axis] + tolerance }
          mesh[:triangles].any? do |triangle|
            triangle_intersects_opening_prism?(triangle, prism, tolerance)
          end
        end
        box = Geom::BoundingBox.new
        first[:points].each { |point| box.add(point) }
        verified << { 'verified' => true, 'depth_mm' => model_units_to_mm(depth.abs),
                      'axis' => normal.to_a, 'profile_bounds_mm' => bounds_hash(box),
                      'profile_vertices' => first[:points].length,
                      'method' => 'native_convex_extrusion_topology_and_clear_closed_prism.v2' }
        consumed[index] = consumed[other_index] = true
        break
      end
    end
    verified
  end

  # Scoped to one fresh snapshot, so manual edits cannot reuse stale meshes.
  def transformed_face_mesh_for_detail(face, transform, context)
    cache = context[:transformed_face_meshes] ||= {}
    key = [face.object_id, transform.to_a]
    cache[key] ||= begin
      triangles = native_face_triangles(face, context).map do |triangle|
        triangle.map { |point| Geom::Point3d.new(point).transform(transform).to_a }
      end
      points = triangles.flatten(1)
      { triangles: triangles,
        min: 3.times.map { |axis| points.map { |point| point[axis] }.min },
        max: 3.times.map { |axis| points.map { |point| point[axis] }.max } }
    end
  end

  def extrusion_tunnel_sides(first, other, translation, tolerance)
    return nil unless first[:edges]&.length == first[:points].length && other[:edges]&.length == other[:points].length
    sides = first[:edges].map do |edge|
      adjacent = edge.faces.reject { |face| face == first[:face] }
      return nil unless adjacent.length == 1
      shifted = edge.vertices.map { |vertex| vertex.position.transform(first[:transform]).offset(translation) }
      opposite = other[:edges].find do |candidate|
        next false unless candidate.faces.reject { |face| face == other[:face] } == adjacent
        endpoints = candidate.vertices.map { |vertex| vertex.position.transform(other[:transform]) }
        shifted.all? { |point| endpoints.any? { |target| point.distance(target) <= tolerance } }
      end
      return nil unless opposite
      side = adjacent.first
      return nil unless side.parent == first[:face].parent && side.loops.length == 1
      expected_vertices = (edge.vertices + opposite.vertices).uniq
      return nil unless expected_vertices.length == 4 && side.outer_loop.vertices.length == 4 && (side.outer_loop.vertices - expected_vertices).empty?
      side
    end
    sides.uniq.length == first[:edges].length ? sides : nil
  end

  def native_face_triangles(face, context)
    context[:face_meshes][face.object_id] ||= begin
      mesh = face.mesh(0)
      mesh.polygons.flat_map do |polygon|
        vertices = polygon.map { |index| mesh.point_at(index.abs).to_a }
        (1...(vertices.length - 1)).map { |index| [vertices.first, vertices[index], vertices[index + 1]] }
      end
    end
  end

  def convex_opening_prism(points, translation, tolerance)
    return nil if points.length < 3
    depth = evidence_length(translation)
    return nil if depth <= tolerance
    z_axis = translation.map { |value| value / depth }
    origin = points.first
    x_axis = evidence_subtract(points[1], origin)
    length = evidence_length(x_axis)
    return nil if length <= 1.0e-10
    x_axis = x_axis.map { |value| value / length }
    y_axis = evidence_cross(z_axis, x_axis)
    return nil if evidence_length(y_axis) < 0.999999
    project = lambda { |point| delta = evidence_subtract(point, origin); [evidence_dot(delta, x_axis), evidence_dot(delta, y_axis), evidence_dot(delta, z_axis)] }
    profile = points.map { |point| project.call(point) }
    return nil unless profile.all? { |point| point[2].abs <= tolerance }
    signed_area = profile.each_with_index.sum { |point, index| other = profile[(index + 1) % profile.length]; point[0] * other[1] - other[0] * point[1] }
    return nil if signed_area.abs <= tolerance * tolerance
    profile.reverse! if signed_area < 0
    planes = [[0.0, 0.0, 1.0, 0.0], [0.0, 0.0, -1.0, depth]]
    profile.each_with_index do |point, index|
      other = profile[(index + 1) % profile.length]
      dx, dy = other[0] - point[0], other[1] - point[1]
      edge_length = Math.sqrt(dx * dx + dy * dy)
      return nil if edge_length <= 1.0e-10
      plane = [-dy / edge_length, dx / edge_length, 0.0, (dy * point[0] - dx * point[1]) / edge_length]
      return nil unless profile.all? { |candidate| evidence_plane_distance(candidate, plane) >= -1.0e-9 }
      planes << plane
    end
    { origin: origin, x: x_axis, y: y_axis, z: z_axis, planes: planes }
  end

  def triangle_intersects_opening_prism?(triangle, prism, tolerance)
    polygon = triangle.map do |point|
      delta = evidence_subtract(point, prism[:origin])
      [evidence_dot(delta, prism[:x]), evidence_dot(delta, prism[:y]), evidence_dot(delta, prism[:z])]
    end
    prism[:planes].each do |plane|
      clipped = []
      polygon.each_with_index do |point, index|
        previous = polygon[(index - 1) % polygon.length]
        distance = evidence_plane_distance(point, plane)
        previous_distance = evidence_plane_distance(previous, plane)
        inside = distance >= -1.0e-10
        previous_inside = previous_distance >= -1.0e-10
        if inside != previous_inside
          ratio = previous_distance / (previous_distance - distance)
          clipped << 3.times.map { |axis| previous[axis] + ratio * (point[axis] - previous[axis]) }
        end
        clipped << point if inside
      end
      polygon = clipped
      return false if polygon.length < 3
    end
    area = (1...(polygon.length - 1)).sum do |index|
      evidence_length(evidence_cross(evidence_subtract(polygon[index], polygon.first), evidence_subtract(polygon[index + 1], polygon.first))) / 2.0
    end
    area > tolerance * tolerance
  end

  def evidence_subtract(a, b); 3.times.map { |axis| a[axis] - b[axis] }; end
  def evidence_dot(a, b); 3.times.sum { |axis| a[axis] * b[axis] }; end
  def evidence_cross(a, b); [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; end
  def evidence_length(vector); Math.sqrt(evidence_dot(vector, vector)); end
  def evidence_plane_distance(point, plane); evidence_dot(point, plane) + plane[3]; end
end
