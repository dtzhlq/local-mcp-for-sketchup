# frozen_string_literal: true

module AlmaSketchupMCP
  extend self

  # Read-only queries are supplied by the server from the frozen specification.
  # Bounding boxes only prune work; positive void evidence comes from native
  # triangle/prism intersections and point containment in closed native solids.
  def inspect_detail_regions(params = {})
    queries = params['queries']
    raise 'inspect_detail_regions requires 1..128 queries' unless queries.is_a?(Array) && queries.length.between?(1, 128)
    model = active_model_required('inspect_detail_regions')
    revision = session_model_revision_report(model)
    context = { face_meshes: {}, region_records: {} }
    results = queries.map do |query|
      begin
        raise 'A complete native model revision is required' unless revision['complete']
        if query['mode'] == 'pair_separation'
          paths = [query['instance_path'], query['comparison_instance_path']]
          raise 'Distinct explicit assembly paths are required' if paths.any? { |value| !value.is_a?(Array) || value.empty? } || paths[0] == paths[1]
          pair_records = paths.map do |path|
            pair_anchor, pair_transform = resolve_detail_region_anchor(model, path)
            key = ['pair_separation', path, pair_transform.to_a]
            context[:region_records][key] ||= detail_region_geometry_records(pair_anchor.definition.entities, pair_transform, context, [], path, pair_anchor)
          end
          next evaluate_detail_pair_records(*pair_records).merge('id' => query['id'], 'mode' => 'pair_separation',
            'instance_path' => paths[0], 'comparison_instance_path' => paths[1], 'coordinate_space' => 'model',
            'evidence_source' => 'sketchup_runtime', 'model_revision' => revision['model_revision'])
        end
        anchor, transform = resolve_detail_region_anchor(model, query['instance_path'] || [])
        validate_detail_transform!(transform)
        search_scope = query['search_scope'] || 'scene'
        raise 'search_scope must be assembly or scene' unless %w[assembly scene].include?(search_scope)
        raise 'exclude_instance_paths is not supported; query the explicit host assembly instead' if query.key?('exclude_instance_paths')
        entities = search_scope == 'assembly' && anchor ? anchor.definition.entities : model.entities
        coordinate_space = query['coordinate_space'] || 'anchor_local'
        raise 'Unsupported region coordinate_space' unless %w[anchor_local model].include?(coordinate_space)
        initial_transform = if coordinate_space == 'model'
                              search_scope == 'assembly' && anchor ? transform : Geom::Transformation.new
                            else
                              search_scope == 'assembly' && anchor ? Geom::Transformation.new : transform.inverse
                            end
        validate_detail_transform!(initial_transform)
        cache_key = [search_scope, anchor && anchor.object_id, initial_transform.to_a]
        records = context[:region_records][cache_key] ||= detail_region_geometry_records(entities, initial_transform, context,
          [], search_scope == 'assembly' ? (query['instance_path'] || []) : [], search_scope == 'assembly' ? anchor : nil)
        result = evaluate_detail_region(query, records)
        result.merge('id' => query['id'], 'instance_path' => query['instance_path'] || [], 'search_scope' => search_scope,
          'coordinate_space' => coordinate_space, 'bounds_mm' => query['bounds_mm'], 'boundary_checks' => query['boundary_checks'] || [],
          'evidence_source' => 'sketchup_runtime', 'model_revision' => revision['model_revision'])
      rescue StandardError => error
        { 'id' => query.is_a?(Hash) ? query['id'] : nil, 'status' => 'unverified', 'evidence_source' => 'sketchup_runtime',
          'model_revision' => revision['model_revision'], 'reason' => "#{error.class}: #{error.message}" }
      end
    end
    { 'version' => 'native-detail-regions.v1', 'model_revision' => revision['model_revision'],
      'model_revision_complete' => revision['complete'], 'results' => results, 'read_only' => true }
  end

  def resolve_detail_region_anchor(model, path)
    raise 'instance_path must be an array of nonempty references' unless path.is_a?(Array) && path.all? { |id| id.is_a?(String) && !id.empty? }
    entities = model.entities
    transform = Geom::Transformation.new
    selected = nil
    path.each do |reference|
      matches = entities.select do |entity|
        (entity.is_a?(Sketchup::Group) || entity.is_a?(Sketchup::ComponentInstance)) &&
          [entity_id(entity), entity.name, entity.persistent_id.to_s, "pid:#{entity.persistent_id}"].include?(reference)
      end
      raise "Region anchor is missing or ambiguous: #{reference}" unless matches.length == 1
      selected = matches.first
      transform *= selected.transformation
      entities = selected.definition.entities
    end
    [selected, transform]
  end

  # Separating actual leaf geometry avoids treating the whole assembly envelope
  # as occupied. Only verified absence of interior overlap passes. Uncertain
  # surfaces or solids remain unresolved; no installation label waives them.
  def evaluate_detail_pair_records(left, right)
    raise 'Both assemblies require measurable faces' if left.empty? || right.empty?
    raise 'Pair inspection exceeds its candidate budget' if left.length * right.length > 100_000
    epsilon_mm = 0.000001
    epsilon = mm_to_model_units(epsilon_mm)
    checked = 0
    contacts = 0
    left.each do |a|
      right.each do |b|
        low = 3.times.map { |axis| [a[:min][axis], b[:min][axis]].max }
        high = 3.times.map { |axis| [a[:max][axis], b[:max][axis]].min }
        widths = 3.times.map { |axis| high[axis] - low[axis] }
        next if widths.any? { |width| width < -epsilon }
        checked += 1
        if widths.any? { |width| width <= 2 * epsilon } && a[:solid] && b[:solid]
          contacts += 1
          next
        end
        empty = false
        if widths.all? { |width| width > 2 * epsilon }
          minimum = low.map { |value| value + epsilon }
          maximum = high.map { |value| value - epsilon }
          prism = detail_axis_aligned_prism(minimum, maximum)
          center = 3.times.map { |axis| (minimum[axis] + maximum[axis]) / 2.0 }
          empty = [a, b].any? do |record|
            !record[:triangles].any? { |triangle| triangle_intersects_opening_prism?(triangle, prism, 0.0) } &&
              detail_point_occupancy(center, record, epsilon) == :outside
          end
        end
        next if empty
        return { 'status' => 'unverified', 'reason' => 'possible_native_leaf_interior_overlap',
          'candidate_paths' => [a[:reference_path], b[:reference_path]],
          'candidate_bounds_mm' => { 'min' => low.map { |value| value * 25.4 }, 'max' => high.map { |value| value * 25.4 } },
          'numerical_tolerance_mm' => epsilon_mm }
      end
    end
    { 'status' => 'pass', 'reason' => 'native_leaf_interiors_are_disjoint', 'method' => 'native_leaf_separation.v1',
      'numerical_tolerance_mm' => epsilon_mm, 'leaf_counts' => [left.length, right.length],
      'candidate_pairs_checked' => checked, 'boundary_contact_pairs' => contacts }
  end

  def detail_region_geometry_records(entities, transform, context, ancestors = [], path = [], owner = nil, records = [])
    raise 'Region geometry exceeds the recursion budget' if ancestors.length > 64
    validate_detail_transform!(transform)
    own_faces = entities.select { |entity| entity.is_a?(Sketchup::Face) }
    unless own_faces.empty?
      triangles = own_faces.flat_map do |face|
        mesh = native_face_triangles(face, context)
        raise 'A native face has no measurable triangles' if mesh.empty?
        mesh.map { |triangle| triangle.map { |point| Geom::Point3d.new(point).transform(transform).to_a } }
      end
      points = triangles.flatten(1)
      raise 'Transformed region geometry is not finite' unless points.all? { |point| point.length == 3 && point.all? { |value| value.is_a?(Numeric) && value.finite? } }
      native_solid = owner && owner.respond_to?(:manifold?) && owner.manifold?
      records << { triangles: triangles, min: 3.times.map { |axis| points.map { |point| point[axis] }.min },
                   max: 3.times.map { |axis| points.map { |point| point[axis] }.max },
                   solid: native_solid, shell_count: native_solid ? detail_face_shell_count(own_faces) : nil, reference_path: path }
      raise 'Region geometry exceeds the triangle budget' if records.sum { |record| record[:triangles].length } > 500_000
    end
    entities.each do |entity|
      next unless entity.is_a?(Sketchup::Group) || entity.is_a?(Sketchup::ComponentInstance)
      definition = entity.definition
      raise 'Recursive definition cannot establish void evidence' if ancestors.include?(definition.object_id)
      detail_region_geometry_records(definition.entities, transform * entity.transformation, context,
        ancestors + [definition.object_id], path + [entity_id(entity) || entity.name || entity.persistent_id.to_s], entity, records)
    end
    records
  end

  def validate_detail_transform!(transform)
    matrix = transform.to_a
    raise 'Region transformations must be finite affine matrices' unless matrix.length == 16 && matrix.all? { |value| value.is_a?(Numeric) && value.finite? } && [3,7,11].all? { |index| matrix[index].abs < 1.0e-12 } && matrix[15].abs > 1.0e-12
    axes = [matrix[0,3], matrix[4,3], matrix[8,3]].map { |axis| axis.map { |value| value / matrix[15] } }
    magnitudes = axes.map { |axis| evidence_length(axis) }
    volume = evidence_dot(axes[0], evidence_cross(axes[1], axes[2])).abs
    raise 'Singular or ill-conditioned region transformation cannot prove a void' unless magnitudes.all? { |length| length > 1.0e-10 } && volume / magnitudes.reduce(:*) > 1.0e-10
  end

  def detail_face_shell_count(faces)
    # Manifold edge counts alone allow disconnected nested shells. Combining
    # their ray hits can cancel filled regions, so such containers stay unknown.
    pending = faces.each_with_object({}) { |face, index| index[face.object_id] = face }
    count = 0
    until pending.empty?
      stack = [pending.values.first]
      count += 1
      until stack.empty?
        face = stack.pop
        next unless pending.delete(face.object_id)
        face.edges.each { |edge| edge.faces.each { |neighbor| stack << neighbor if pending.key?(neighbor.object_id) } }
      end
    end
    count
  end

  def evaluate_detail_region(query, records)
    raise 'Region query requires a nonempty id' unless query.is_a?(Hash) && query['id'].is_a?(String) && !query['id'].empty?
    bounds = query['bounds_mm']
    raise 'Region bounds_mm require min and max vectors' unless bounds.is_a?(Hash) && %w[min max].all? { |key| bounds[key].is_a?(Array) && bounds[key].length == 3 && bounds[key].all? { |number| number.is_a?(Numeric) && number.finite? } }
    minimum, maximum = %w[min max].map { |key| bounds[key].map { |value| mm_to_model_units(value) } }
    raise 'Region dimensions must be positive' unless 3.times.all? { |axis| maximum[axis] > minimum[axis] }
    tolerance = mm_to_model_units(0.02)
    prism = detail_axis_aligned_prism(minimum, maximum)
    candidates = records.select { |record| 3.times.all? { |axis| record[:max][axis] >= minimum[axis] && record[:min][axis] <= maximum[axis] } }
    blocker = candidates.find { |record| record[:triangles].any? { |triangle| triangle_intersects_opening_prism?(triangle, prism, tolerance) } }
    if blocker
      return { 'status' => 'fail', 'reason' => 'native_surface_intersects_required_void', 'blocker_path' => blocker[:reference_path],
               'method' => 'native_triangles_clipped_to_closed_region.v1' }
    end
    center = 3.times.map { |axis| (minimum[axis] + maximum[axis]) / 2.0 }
    center_states = candidates.map { |record| [record, detail_point_occupancy(center, record, tolerance)] }
    filled = center_states.find { |_, state| state == :inside }
    return { 'status' => 'fail', 'reason' => 'required_void_inside_native_solid', 'blocker_path' => filled.first[:reference_path], 'method' => 'native_closed_solid_three_ray_signed_winding.v1' } if filled
    uncertain = center_states.find { |_, state| state == :unknown }
    return { 'status' => 'unverified', 'reason' => 'open_or_ambiguous_geometry_surrounds_void', 'blocker_path' => uncertain.first[:reference_path] } if uncertain
    checks = query['boundary_checks'] || []
    raise 'boundary_checks must be an array of at most six sides' unless checks.is_a?(Array) && checks.length <= 6
    boundary_results = checks.map do |check|
      side = check['side']
      raise 'Unsupported void boundary side' unless %w[min_x max_x min_y max_y min_z max_z].include?(side)
      offset_mm = check['offset_mm']
      raise 'Boundary offset_mm must be positive' unless offset_mm.is_a?(Numeric) && offset_mm.finite? && offset_mm > 0
      axis = %w[x y z].index(side[-1])
      position = side.start_with?('min') ? minimum[axis] - mm_to_model_units(offset_mm) : maximum[axis] + mm_to_model_units(offset_mm)
      point = center.dup
      point[axis] = position
      slab_min, slab_max = minimum.dup, maximum.dup
      half_width = mm_to_model_units([0.1, offset_mm / 10.0].min)
      slab_min[axis], slab_max[axis] = position - half_width, position + half_width
      slab = detail_axis_aligned_prism(slab_min, slab_max)
      states = records.map do |record|
        state = detail_point_occupancy(point, record, tolerance)
        next state unless state == :inside
        # Center occupancy alone is insufficient: a hole between sample rays
        # must not pass. A connected thin slab wholly inside one closed solid
        # has no native boundary triangle intersecting it.
        record[:triangles].any? { |triangle| triangle_intersects_opening_prism?(triangle, slab, tolerance) } ? :unknown : :inside
      end
      { 'side' => side, 'verified' => states.include?(:inside), 'method' => 'native_closed_solid_contained_boundary_slab.v1',
        'status' => states.include?(:inside) ? 'pass' : (states.include?(:unknown) ? 'unverified' : 'fail') }
    end
    failed_boundary = boundary_results.find { |boundary| boundary['status'] != 'pass' }
    { 'status' => failed_boundary ? failed_boundary['status'] : 'pass',
      'reason' => failed_boundary ? 'required_native_boundary_missing' : 'required_region_empty_with_measured_boundaries',
      'boundary_results' => boundary_results, 'inspected_geometry_records' => candidates.length,
      'method' => 'native_closed_region_triangles_and_solid_containment.v1' }
  end

  def detail_axis_aligned_prism(minimum, maximum)
    { origin: [0.0, 0.0, 0.0], x: [1.0, 0.0, 0.0], y: [0.0, 1.0, 0.0], z: [0.0, 0.0, 1.0],
      planes: [[1,0,0,-minimum[0]],[-1,0,0,maximum[0]],[0,1,0,-minimum[1]],[0,-1,0,maximum[1]],[0,0,1,-minimum[2]],[0,0,-1,maximum[2]]] }
  end

  def detail_point_occupancy(point, record, tolerance)
    return :outside unless 3.times.all? { |axis| point[axis] >= record[:min][axis] - tolerance && point[axis] <= record[:max][axis] + tolerance }
    return :unknown unless record[:solid] && record[:shell_count] == 1
    directions = [[1.0,0.37139,0.17321],[0.21931,1.0,0.41773],[0.31783,0.19117,1.0]]
    states = directions.map do |direction|
      hits = record[:triangles].map { |triangle| detail_ray_triangle_hit(point, direction, triangle) }.compact.select { |hit| hit[:distance] > tolerance }.sort_by { |hit| hit[:distance] }
      unique = []
      hits.each do |hit|
        if unique.empty? || (hit[:distance] - unique.last[:distance]).abs > tolerance * 0.01
          unique << { distance: hit[:distance], signs: [hit[:sign]] }
        else
          unique.last[:signs] |= [hit[:sign]]
        end
      end
      next :unknown if unique.any? { |hit| hit[:signs].length != 1 }
      # Signed crossings retain multiplicity. An actual connected swept shell
      # may intersect itself: two containing lobes have winding 2 and must not
      # cancel into a false empty region as an even/odd-only test would.
      winding = unique.sum { |hit| hit[:signs].first }
      winding.zero? ? :outside : :inside
    end
    states.uniq.length == 1 ? states.first : :unknown
  end

  def detail_ray_triangle_distance(origin, direction, triangle)
    hit = detail_ray_triangle_hit(origin, direction, triangle)
    hit && hit[:distance]
  end

  def detail_ray_triangle_hit(origin, direction, triangle)
    a, b, c = triangle
    edge1, edge2 = evidence_subtract(b, a), evidence_subtract(c, a)
    h = evidence_cross(direction, edge2)
    determinant = evidence_dot(edge1, h)
    return nil if determinant.abs < 1.0e-14
    inverse = 1.0 / determinant
    delta = evidence_subtract(origin, a)
    u = inverse * evidence_dot(delta, h)
    return nil unless u >= -1.0e-10 && u <= 1.0 + 1.0e-10
    q = evidence_cross(delta, edge1)
    v = inverse * evidence_dot(direction, q)
    return nil unless v >= -1.0e-10 && u + v <= 1.0 + 1.0e-10
    { distance: inverse * evidence_dot(edge2, q), sign: evidence_dot(evidence_cross(edge1, edge2), direction) > 0 ? 1 : -1 }
  end
end
