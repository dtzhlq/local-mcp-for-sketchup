# frozen_string_literal: true

module LocalMcpForSketchUp
  extend self

  STRUCTURAL_GROUPS_VERSION = 'structural-groups.v1'
  DEFAULT_STRUCTURAL_GROUP_LIMIT = 500
  MAX_STRUCTURAL_GROUP_LIMIT = 5_000
  MAX_FRESH_MANIFOLD_PATHS = 20
  CANONICAL_STRUCTURAL_PID_PATH = /\Apid:[1-9]\d*(?:\.[1-9]\d*)*\z/.freeze

  def normalize_structural_probe_options(params, read_only:)
    structural_groups_provided = params.key?('structural_groups') || params.key?('structuralGroups')
    structural_limit_provided = params.key?('structural_group_limit') || params.key?('structuralGroupLimit')
    fresh_paths_provided = params.key?('fresh_manifold_paths') || params.key?('freshManifoldPaths')
    structural_groups = if structural_groups_provided
                          params.key?('structural_groups') ? params['structural_groups'] : params['structuralGroups']
                        else
                          false
                        end
    unless structural_groups == true || structural_groups == false
      raise 'adopt_open_model.structural_groups must be a boolean'
    end
    if structural_limit_provided && !structural_groups
      raise 'adopt_open_model.structural_group_limit requires structural_groups=true'
    end
    requested = structural_groups || structural_limit_provided || fresh_paths_provided
    if requested && !read_only
      raise 'adopt_open_model structural probe options require read_only=true'
    end

    limit = if structural_limit_provided
              params.key?('structural_group_limit') ? params['structural_group_limit'] : params['structuralGroupLimit']
            else
              DEFAULT_STRUCTURAL_GROUP_LIMIT
            end
    unless limit.is_a?(Integer) && limit.positive? && limit <= MAX_STRUCTURAL_GROUP_LIMIT
      raise "adopt_open_model.structural_group_limit must be an integer from 1 to #{MAX_STRUCTURAL_GROUP_LIMIT}"
    end

    fresh_paths = if fresh_paths_provided
                    params.key?('fresh_manifold_paths') ? params['fresh_manifold_paths'] : params['freshManifoldPaths']
                  else
                    []
                  end
    raise 'adopt_open_model.fresh_manifold_paths must be an array' unless fresh_paths.is_a?(Array)
    if fresh_paths.length > MAX_FRESH_MANIFOLD_PATHS
      raise "adopt_open_model.fresh_manifold_paths accepts at most #{MAX_FRESH_MANIFOLD_PATHS} paths"
    end
    fresh_paths.each_with_index do |path, index|
      unless path.is_a?(String) && path.match?(CANONICAL_STRUCTURAL_PID_PATH)
        raise "adopt_open_model.fresh_manifold_paths[#{index}] must be a canonical pid path"
      end
    end
    raise 'adopt_open_model.fresh_manifold_paths must not contain duplicates' unless fresh_paths.uniq.length == fresh_paths.length
    if fresh_paths.any? && !structural_groups
      raise 'adopt_open_model.fresh_manifold_paths requires structural_groups=true'
    end

    {
      'requested' => requested,
      'structural_groups' => structural_groups,
      'structural_group_limit' => limit,
      'fresh_manifold_paths' => fresh_paths
    }
  end

  def structural_group_probe(model, limit:, fresh_paths:, model_revision:)
    state = {
      'entries' => [],
      'total_seen' => 0,
      'truncated' => false,
      'halted' => false,
      'fresh_requested' => fresh_paths.each_with_object({}) { |path, result| result[path] = true },
      'fresh_matched' => {}
    }
    walk_structural_containers(
      model.entities,
      [],
      [],
      state,
      limit,
      model_revision,
      true,
      false
    )
    unmatched_paths = fresh_paths.reject { |path| state['fresh_matched'][path] }
    {
      'version' => STRUCTURAL_GROUPS_VERSION,
      'total_seen' => state['total_seen'],
      'total_seen_exact' => !state['truncated'],
      'returned' => state['entries'].length,
      'truncated' => state['truncated'],
      'limit' => limit,
      'fresh_manifold_requested' => fresh_paths.length,
      'fresh_manifold_matched' => state['fresh_matched'].length,
      'fresh_manifold_unmatched' => unmatched_paths.length,
      'fresh_manifold_unmatched_paths' => unmatched_paths,
      'entries' => state['entries']
    }
  end

  def walk_structural_containers(entities, ancestors, definition_stack, state, limit, model_revision,
                                 ancestor_visible, ancestor_locked)
    structural_containers(entities).each do |container|
      return false if state['halted']

      path_entities = ancestors + [container]
      own_visible = structural_entity_visible?(container)
      own_locked = container.respond_to?(:locked?) && container.locked?
      effective_visible = ancestor_visible && own_visible
      effective_locked = ancestor_locked || own_locked
      if container.is_a?(Sketchup::Group)
        state['total_seen'] += 1
        if state['total_seen'] > limit
          state['truncated'] = true
          state['halted'] = true
          return false
        end
        state['entries'] << structural_group_entry(
          container,
          path_entities,
          state,
          model_revision,
          own_visible,
          own_locked,
          effective_visible,
          effective_locked,
          ancestor_visible,
          ancestor_locked
        )
      end

      definition = container.definition
      definition_key = entity_persistent_id(definition) || definition.name.to_s
      next if definition_stack.include?(definition_key)

      complete = walk_structural_containers(
        definition.entities,
        path_entities,
        definition_stack + [definition_key],
        state,
        limit,
        model_revision,
        effective_visible,
        effective_locked
      )
      return false unless complete
    end
    true
  end

  def structural_containers(entities)
    entities.grep(Sketchup::Group) + entities.grep(Sketchup::ComponentInstance)
  end

  def structural_group_entry(group, path_entities, state, model_revision, own_visible, own_locked,
                             effective_visible, effective_locked, ancestor_visible, ancestor_locked)
    instance_path = Sketchup::InstancePath.new(path_entities)
    persistent_id_path = instance_path.persistent_id_path.to_s
    entity_path = "pid:#{persistent_id_path}"
    parent_entity_path = if path_entities.length > 1
                           "pid:#{Sketchup::InstancePath.new(path_entities[0...-1]).persistent_id_path.to_s}"
                         end
    parent_container = path_entities.length > 1 ? path_entities[-2] : nil
    parent_definition = parent_container&.definition
    affected_instance_count = structural_definition_instance_count(parent_definition)
    direct_counts = structural_direct_counts(group.entities)
    world_transform = instance_path.transformation
    material_name = group.respond_to?(:material) && group.material ? group.material.name.to_s : nil
    tag_name = entity_tag_name(group)
    safe_name = structural_untrusted_display(group.name)
    safe_material = structural_untrusted_display(material_name)
    safe_tag = structural_untrusted_display(tag_name)
    ancestor_transformation = if path_entities.length > 1
                                Sketchup::InstancePath.new(path_entities[0...-1]).transformation
                              end
    {
      'entity_path' => entity_path,
      'parent_entity_path' => parent_entity_path,
      'scope_path' => parent_entity_path || 'model',
      'persistent_id' => structural_persistent_id(group),
      'path_segments' => structural_path_segments(path_entities),
      'entity_type' => 'group',
      'name' => safe_name,
      'material' => safe_material,
      'tag' => safe_tag,
      'untrusted_display' => {
        'trust' => 'untrusted_data',
        'name' => safe_name,
        'material' => safe_material,
        'tag' => safe_tag
      },
      'visible' => own_visible,
      'locked' => own_locked,
      'effective_visible' => effective_visible,
      'effective_locked' => effective_locked,
      'hidden_by_ancestor' => !ancestor_visible,
      'locked_by_ancestor' => ancestor_locked,
      'faces' => direct_counts['faces'],
      'edges' => direct_counts['edges'],
      'vertices' => direct_counts['vertices'],
      'direct_counts' => direct_counts,
      'parent_bounding_box' => bounds_hash(group.bounds),
      'world_bounding_box' => structural_world_bounds(group, world_transform),
      'world_transform' => world_transform.to_a,
      'affected_instance_count' => affected_instance_count,
      'shared_definition' => affected_instance_count > 1,
      'instance_policy_required' => !parent_definition.nil?,
      'instance_policy' => {
        'required' => !parent_definition.nil?,
        'allowed' => parent_definition ? %w[definition_wide make_unique] : [],
        'recommended' => affected_instance_count > 1 ? 'make_unique' : nil
      },
      'editable' => false,
      'edit_scope' => 'read_only_structural_probe',
      'manifold_attestation' => structural_manifold_attestation(
        group,
        entity_path,
        state,
        model_revision,
        ancestor_transformation
      )
    }
  end

  def structural_path_segments(path_entities)
    path_entities.map do |entity|
      persistent_id = structural_persistent_id(entity)
      {
        'entity_type' => entity.is_a?(Sketchup::Group) ? 'group' : 'component_instance',
        'persistent_id' => persistent_id,
        'reference' => persistent_id
      }
    end
  end

  def structural_persistent_id(entity)
    value = entity_persistent_id(entity)
    normalized = value.nil? ? '' : value.to_s
    raise 'structural group probe requires positive decimal persistent ids' unless normalized.match?(/\A[1-9]\d*\z/)

    normalized
  end

  def structural_untrusted_display(value)
    return nil if value.nil?

    value.to_s.gsub(/[\x00-\x1f\x7f]/, ' ')[0, 200]
  end

  def structural_entity_visible?(entity)
    entity_visible = !entity.respond_to?(:hidden?) || !entity.hidden?
    layer = entity.respond_to?(:layer) ? entity.layer : nil
    layer_visible = !layer || !layer.respond_to?(:visible?) || layer.visible?
    entity_visible && layer_visible
  end

  def structural_definition_instance_count(definition)
    return 1 unless definition && definition.respond_to?(:instances)

    [definition.instances.length, 1].max
  end

  def structural_direct_counts(entities)
    edges = entities.grep(Sketchup::Edge)
    {
      'faces' => entities.grep(Sketchup::Face).length,
      'edges' => edges.length,
      'vertices' => edges.flat_map(&:vertices).uniq.length,
      'groups' => entities.grep(Sketchup::Group).length,
      'component_instances' => entities.grep(Sketchup::ComponentInstance).length
    }
  end

  def structural_world_bounds(group, transformation)
    bounds = group.definition.bounds
    points = 8.times.map { |index| bounds.corner(index).transform(transformation) }
    min = [0, 1, 2].map { |axis| points.map { |point| point[axis] }.min }
    max = [0, 1, 2].map { |axis| points.map { |point| point[axis] }.max }
    {
      'min' => min.map { |value| model_units_to_mm(value) },
      'max' => max.map { |value| model_units_to_mm(value) },
      'w' => model_units_to_mm(max[0] - min[0]),
      'd' => model_units_to_mm(max[1] - min[1]),
      'h' => model_units_to_mm(max[2] - min[2])
    }
  end

  def structural_manifold_attestation(group, entity_path, state, model_revision, ancestor_transformation)
    unless state['fresh_requested'][entity_path]
      return {
        'status' => 'not_requested',
        'fresh' => false,
        'matched' => false,
        'entity_path' => entity_path,
        'model_revision' => nil,
        'is_manifold' => nil
      }
    end

    report = manifold_report(group)
    occurrence_report = structural_occurrence_manifold_report(report, entity_path, model_revision, ancestor_transformation)
    state['fresh_matched'][entity_path] = true
    {
      'status' => 'fresh_matched',
      'fresh' => true,
      'matched' => true,
      'entity_path' => entity_path,
      'model_revision' => model_revision,
      'is_manifold' => report['is_manifold'],
      'report' => occurrence_report
    }
  end

  def structural_occurrence_manifold_report(report, entity_path, model_revision, ancestor_transformation)
    ancestor_scale = ancestor_transformation ? structural_volume_scale(ancestor_transformation) : 1.0
    volume = report['volume']
    {
      'entity_path' => entity_path,
      'model_revision' => model_revision,
      'persistent_id' => report['persistent_id'],
      'name' => structural_untrusted_display(report['name']),
      'is_manifold' => report['is_manifold'],
      'method' => report['method'],
      'checked' => report['checked'],
      'faces' => report['faces'],
      'edges' => report['edges'],
      'vertices' => report['vertices'],
      'volume' => volume.nil? ? nil : (volume.to_f * ancestor_scale).round(6),
      'checks' => report['checks'],
      'issues' => report['issues']
    }
  end

  def structural_volume_scale(transformation)
    matrix = transformation.to_a
    determinant = matrix[0] * ((matrix[5] * matrix[10]) - (matrix[9] * matrix[6])) -
                  matrix[4] * ((matrix[1] * matrix[10]) - (matrix[9] * matrix[2])) +
                  matrix[8] * ((matrix[1] * matrix[6]) - (matrix[5] * matrix[2]))
    determinant.abs
  end
end
