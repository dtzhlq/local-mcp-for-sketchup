# frozen_string_literal: true

module AlmaSketchupMCP
  def geometry_handle(entity)
    prefix = entity.is_a?(Sketchup::Vertex) ? 'v' : entity.is_a?(Sketchup::Edge) ? 'e' : 'f'
    "#{prefix}:#{entity.respond_to?(:persistent_id) ? entity.persistent_id : entity.entityID}"
  end

  def geometry_mm(point)
    point.to_a.map { |n| n.to_f * 25.4 }
  end

  def geometry_matrix_mm(transform)
    matrix = transform.to_a
    [12, 13, 14].each { |i| matrix[i] *= 25.4 }
    matrix
  end

  def geometry_normal(normal, transform)
    inverse = transform.inverse.to_a
    n = normal.to_a
    result = (0..2).map { |r| (0..2).sum { |k| inverse[r * 4 + k] * n[k] } }
    length = Math.sqrt(result.sum { |x| x * x })
    raise 'Singular geometry normal' if length < 1.0e-12
    result.map { |x| x / length }
  end

  def geometry_context(entities, entity_path, transform, instance = nil)
    edges = entities.grep(Sketchup::Edge)
    faces = entities.grep(Sketchup::Face)
    vertices = edges.flat_map(&:vertices).uniq
    {
      'entity_path' => entity_path,
      'name' => instance&.name,
      'definition_name' => instance&.definition&.name,
      'shared_definition' => instance ? instance.definition.instances.length > 1 : false,
      'transform' => geometry_matrix_mm(transform),
      'vertices' => vertices.map { |v| { 'handle' => geometry_handle(v), 'position' => geometry_mm(v.position), 'world_position' => geometry_mm(v.position.transform(transform)), 'edges' => v.edges.map { |e| geometry_handle(e) }, 'faces' => v.faces.map { |f| geometry_handle(f) } } },
      'edges' => edges.map { |e| { 'handle' => geometry_handle(e), 'vertices' => e.vertices.map { |v| geometry_handle(v) }, 'faces' => e.faces.map { |f| geometry_handle(f) }, 'length_mm' => e.length(transform).to_f * 25.4, 'soft' => e.soft?, 'smooth' => e.smooth? } },
      'faces' => faces.map do |face|
        mesh = face.mesh
        triangles = mesh.polygons.flat_map do |polygon|
          points = polygon.map { |index| geometry_mm(mesh.point_at(index.abs).transform(transform)) }
          (1...(points.length - 1)).map { |i| [points[0], points[i], points[i + 1]] }
        end
        { 'handle' => geometry_handle(face), 'normal' => face.normal.to_a, 'world_normal' => geometry_normal(face.normal, transform), 'area_mm2' => face.area(transform).to_f * 25.4**2,
          'loops' => face.loops.map { |loop| { 'outer' => loop.outer?, 'vertices' => loop.vertices.map { |v| geometry_handle(v) } } },
          'triangles' => triangles, 'material' => face.material&.name, 'back_material' => face.back_material&.name }
      end,
      'manifold' => !faces.empty? && edges.all? { |e| e.faces.length == 2 }
    }
  end

  def query_model_geometry(params = {})
    model = active_model_required('query_model_geometry')
    revision = session_model_revision_report(model)
    raise 'Incomplete model revision' unless revision['complete']
    roots = params['targets'] || ['model']
    limit = Integer(params['max_vertices'] || 10_000)
    context_limit = Integer(params['max_contexts'] || 256)
    raise 'Invalid geometry query budget' unless limit.between?(1, 100_000) && context_limit.between?(1, 2000) && roots.is_a?(Array) && roots.length.between?(1, 32)
    result = []; seen = {}; total = 0; truncated = false
    walk = lambda do |entities, paths, transform, instance, depth|
      key = paths.empty? ? 'model' : "pid:#{paths.map(&:persistent_id).join('.')}"
      next if seen[key]
      seen[key] = true
      count = entities.grep(Sketchup::Edge).flat_map(&:vertices).uniq.length
      if total + count > limit || result.length >= context_limit || depth > 64
        truncated = true
        next
      end
      total += count
      result << geometry_context(entities, key, transform, instance)
      if params.fetch('recursive', true)
        entities.each do |child|
          next unless child.is_a?(Sketchup::Group) || child.is_a?(Sketchup::ComponentInstance)
          walk.call(child.definition.entities, paths + [child], transform * child.transformation, child, depth + 1)
        end
      end
    end
    roots.each do |root|
      if root == 'model'
        walk.call(model.entities, [], Geom::Transformation.new, nil, 0)
      else
        raise 'Geometry target must be a canonical pid path' unless root.to_s.match?(/\Apid:[1-9]\d*(?:\.[1-9]\d*)*\z/)
        instance_path = model.instance_path_from_pid_path(root.delete_prefix('pid:'))
        raise "Geometry target not found: #{root}" unless instance_path&.valid?
        target = instance_path.to_a.last
        raise 'Geometry context target must be a group or component instance' unless target.respond_to?(:definition)
        walk.call(target.definition.entities, instance_path.to_a, instance_path.transformation, target, 0)
      end
    end
    { 'version' => 'model-geometry.v1', 'runtime' => 'queue', 'session_id' => bridge_session_id, 'document_id' => session_document_id(model), 'model_identity' => session_model_identity(model),
      'model_revision' => revision['model_revision'], 'complete' => !truncated, 'contexts' => result, 'vertex_count' => total, 'units' => 'mm' }
  end

  # Clone matching is geometric and must be unambiguous. Never fall back to ordinal.
  def geometry_signature(entity)
    point = lambda { |p| p.to_a.map { |x| x.to_f.round(9) } }
    data = if entity.is_a?(Sketchup::Vertex)
             ['vertex', point.call(entity.position), entity.edges.map { |e| e.vertices.map { |v| point.call(v.position) }.sort }.sort]
           elsif entity.is_a?(Sketchup::Edge)
             ['edge', entity.vertices.map { |v| point.call(v.position) }.sort]
           elsif entity.is_a?(Sketchup::Face)
             ['face', entity.loops.map { |l| [l.outer?, l.vertices.map { |v| point.call(v.position) }.sort] }.sort_by(&:to_s)]
           else
             [entity.class.name, entity.name, entity.transformation.to_a, entity.bounds.min.to_a, entity.bounds.max.to_a, entity.definition.name]
           end
    JSON.generate(data)
  end

  def geometry_isolate_path(model, path)
    original = model.instance_path_from_pid_path(path.delete_prefix('pid:'))
    raise 'Geometry edit target is unavailable' unless original&.valid?
    ancestors = original.to_a
    ancestors.each { |e| assert_reference_entity_access!(e, 'edit_geometry') }
    signatures = ancestors.map { |e| geometry_signature(e) }
    entities = model.entities; isolated = []
    ancestors.each_with_index do |source, index|
      candidates = entities.select { |e| e.respond_to?(:definition) && geometry_signature(e) == signatures[index] }
      target = candidates.include?(source) ? source : candidates.length == 1 ? candidates.first : nil
      raise 'Ambiguous instance mapping after isolation' unless target
      target.make_unique if target.definition.instances.length > 1
      isolated << target
      entities = target.definition.entities
    end
    [isolated, entities]
  end

  def geometry_edit_matrix(values)
    raise 'Expected affine matrix' unless values.is_a?(Array) && values.length == 16 && values.all? { |n| n.is_a?(Numeric) && n.finite? }
    raise 'Expected affine matrix' unless [3, 7, 11].all? { |i| values[i].abs < 1.0e-12 } && (values[15] - 1).abs < 1.0e-12
    matrix = values.dup
    [12, 13, 14].each { |i| matrix[i] /= 25.4 }
    transform = Geom::Transformation.new(matrix)
    transform.inverse # Singular transforms must fail before mutation.
    transform
  end

  def edit_model_geometry_operation(model, operation)
    raise 'Stale geometry snapshot' unless session_model_revision(model) == operation.fetch('snapshot_revision')
    reviewed_root = operation.fetch('entity_path')
    original_path = operation['context_path'] || reviewed_root
    raise 'Geometry context escapes reviewed root' unless original_path == reviewed_root || original_path.start_with?(reviewed_root + '.')
    source_path = model.instance_path_from_pid_path(original_path.delete_prefix('pid:'))
    raise 'Geometry context not found' unless source_path&.valid? && source_path.to_a.last.respond_to?(:definition)
    source_entities = source_path.to_a.last.definition.entities
    originals = source_entities.grep(Sketchup::Edge) + source_entities.grep(Sketchup::Face) + source_entities.grep(Sketchup::Edge).flat_map(&:vertices).uniq
    signatures = originals.to_h { |e| [geometry_handle(e), geometry_signature(e)] }
    paths, entities = geometry_isolate_path(model, original_path)
    current = entities.grep(Sketchup::Edge) + entities.grep(Sketchup::Face) + entities.grep(Sketchup::Edge).flat_map(&:vertices).uniq
    index = current.group_by { |e| geometry_signature(e) }
    mapped = signatures.to_h do |handle, signature|
      matches = index[signature] || []
      raise "Ambiguous topology mapping: #{handle}" unless matches.length == 1
      [handle, matches.first]
    end
    world = Sketchup::InstancePath.new(paths).transformation
    inverse = world.inverse
    resolve = lambda do |handle|
      entity = mapped[handle]
      raise "Stale or unknown topology handle: #{handle}" unless entity&.valid?
      entity
    end
    point = lambda do |value, space|
      raise 'Point requires three finite coordinates' unless value.is_a?(Array) && value.length == 3 && value.all? { |n| n.is_a?(Numeric) && n.finite? }
      p = Geom::Point3d.new(value.map { |n| n / 25.4 })
      space == 'world' ? p.transform(inverse) : p
    end
    edits = operation.fetch('edits')
    raise 'Geometry edit limit exceeded' unless edits.is_a?(Array) && edits.length.between?(1, 100)
    edit_results = []
    edits.each do |edit|
      space = edit.fetch('coordinate_space', 'local')
      raise 'Unsupported coordinate space' unless %w[local world].include?(space)
      case edit.fetch('op')
      when 'add_edges'
        created = entities.add_edges(edit.fetch('points').map { |p| point.call(p, space) })
        edit_results << { 'op' => edit['op'], 'created' => created.map { |e| geometry_handle(e) } }
      when 'add_face'
        face = entities.add_face(edit.fetch('points').map { |p| point.call(p, space) })
        raise 'Native face creation failed' unless face
        edit_results << { 'op' => edit['op'], 'created' => [geometry_handle(face)] }
      when 'move_vertices'
        vertices = edit.fetch('moves').map { |m| resolve.call(m.fetch('handle')) }
        raise 'move_vertices requires vertices' unless vertices.all? { |v| v.is_a?(Sketchup::Vertex) }
        vectors = edit['moves'].map do |m|
          v = Geom::Vector3d.new(m.fetch('delta').map { |n| Float(n) / 25.4 })
          space == 'world' ? v.transform(inverse) : v
        end
        entities.transform_by_vectors(vertices, vectors)
      when 'transform_entities'
        targets = edit.fetch('handles').map { |h| resolve.call(h) }
        t = geometry_edit_matrix(edit.fetch('matrix'))
        t = inverse * t * world if space == 'world'
        entities.transform_entities(t, targets)
      when 'pushpull_face'
        face = resolve.call(edit.fetch('handle'))
        raise 'pushpull_face requires a face' unless face.is_a?(Sketchup::Face)
        distance = Float(edit.fetch('distance')) / 25.4
        raise 'Pushpull distance must be finite and nonzero' unless distance.finite? && distance != 0
        distance /= face.normal.transform(world).length if space == 'world'
        face.pushpull(distance, false)
      when 'reverse_face'
        face = resolve.call(edit.fetch('handle'))
        raise 'reverse_face requires a face' unless face.is_a?(Sketchup::Face)
        face.reverse!
      when 'erase_entities'
        entities.erase_entities(edit.fetch('handles').map { |h| resolve.call(h) })
      when 'set_face_material'
        face = resolve.call(edit.fetch('handle'))
        raise 'set_face_material requires a face' unless face.is_a?(Sketchup::Face)
        material = model.materials[edit.fetch('material')]
        raise 'Material not found' unless material
        face.material = material if %w[front both].include?(edit.fetch('side', 'front'))
        face.back_material = material if %w[back both].include?(edit.fetch('side', 'front'))
      when 'set_edge_properties'
        edge = resolve.call(edit.fetch('handle'))
        raise 'set_edge_properties requires an edge' unless edge.is_a?(Sketchup::Edge)
        edge.soft = edit['soft'] if edit.key?('soft')
        edge.smooth = edit['smooth'] if edit.key?('smooth')
      else
        raise "Unsupported geometry edit: #{edit['op']}"
      end
    end
    after_entities = entities.grep(Sketchup::Edge) + entities.grep(Sketchup::Face) + entities.grep(Sketchup::Edge).flat_map(&:vertices).uniq
    new_entities = after_entities.reject { |e| current.include?(e) }.map { |e| geometry_handle(e) }
    after_path = "pid:#{paths.map(&:persistent_id).join('.')}"
    @geometry_edit_results ||= []
    @geometry_edit_results << { 'entity_path_before' => original_path, 'entity_path_after' => after_path, 'entities' => mapped.transform_values { |e| e.valid? ? geometry_handle(e) : nil }, 'created_entities' => new_entities, 'edits' => edit_results }
  end
end
