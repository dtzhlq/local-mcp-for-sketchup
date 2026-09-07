# frozen_string_literal: true

module AlmaSketchupMCP
  extend self

  MODEL_REVISION_STRATEGY = 'definition-merkle.v2'.freeze
  MODEL_REVISION_UNIQUE_ENTITY_LIMIT = 1_000_000
  MODEL_REVISION_SAFE_INTEGER_MAX = 9_007_199_254_740_991

  def session_model_revision(model, model_snapshot = nil)
    session_model_revision_report(model, model_snapshot)['model_revision']
  end

  def session_model_revision_report(model, model_snapshot = nil)
    model_snapshot ||= snapshot(model, include_detail_evidence: false)
    graph = model_revision_merkle_graph(model, model_snapshot)
    source = {
      'strategy' => MODEL_REVISION_STRATEGY,
      'root_digest' => graph['root_digest'],
      'logical_occurrences' => graph['logical_occurrences'],
      'unique_entities' => graph['unique_entities'],
      'reachable_definitions' => graph['reachable_definitions'],
      'complete' => graph['complete'],
      'blockers' => graph['blockers'],
      'totals' => model_snapshot['totals'],
      'materials' => model_snapshot['materials'],
      'native_appearance' => model_snapshot['native_appearance'],
      'tags' => model_snapshot['tags'],
      'scenes' => model_snapshot['scenes'],
      'section_planes' => model_snapshot['section_planes'],
      'classification_schemas' => model_snapshot['classification_schemas'],
      'component_definition_summaries' => model_snapshot['component_definition_summaries'],
      'image_references' => model_snapshot['image_references']
    }
    logical_occurrences = graph['logical_occurrences']
    {
      'model_revision' => "sha256:#{Digest::SHA256.hexdigest(revision_json(source))}",
      'strategy' => MODEL_REVISION_STRATEGY,
      'complete' => graph['complete'],
      'recursive_total_seen' => logical_occurrences,
      'recursive_indexed' => graph['complete'] ? logical_occurrences : [graph['unique_entities'], logical_occurrences].min,
      'unique_entities' => graph['unique_entities'],
      'reachable_definitions' => graph['reachable_definitions'],
      'blockers' => graph['blockers']
    }
  end

  def model_revision_merkle_graph(model, model_snapshot = nil, unique_entity_limit: MODEL_REVISION_UNIQUE_ENTITY_LIMIT)
    model_snapshot ||= snapshot(model, include_detail_evidence: false)
    limit = unique_entity_limit.to_i
    raise 'model revision unique entity limit must be positive' unless limit.positive?

    state = {
      'unique_entity_limit' => limit,
      'unique_entities' => 0,
      'reachable_definitions' => 0,
      'definition_reports' => {},
      'definition_keys_by_object' => {},
      'definition_objects_by_key' => {},
      'classification_schemas' => model_snapshot['classification_schemas'] || [],
      'native_classification_by_definition' => {},
      'complete' => true,
      'blockers' => []
    }
    root = revision_entities_report(model.entities, state, [])
    {
      'strategy' => MODEL_REVISION_STRATEGY,
      'root_digest' => root['digest'],
      'logical_occurrences' => root['expanded_count'],
      'unique_entities' => state['unique_entities'],
      'reachable_definitions' => state['reachable_definitions'],
      'complete' => state['complete'] == true,
      'blockers' => state['blockers'].uniq.sort
    }
  end

  def revision_entities_report(entities, state, definition_stack)
    entries = entities.to_a.select { |entity| selectable_entity?(entity) }
    entries.sort_by! { |entity| revision_entity_sort_key(entity) }
    entry_digest = Digest::SHA256.new
    hashed_entries = 0
    expanded_count = 0
    previous_identity = nil
    entries.each do |entity|
      identity_kind, identity_value = revision_stable_entity_identity(entity)
      current_identity = [identity_kind, identity_value]
      mark_revision_incomplete(state, 'entity_identity_unavailable') if identity_kind == 'unavailable'
      if identity_kind != 'unavailable' && current_identity == previous_identity
        mark_revision_incomplete(state, 'duplicate_entity_identity')
      end
      previous_identity = current_identity
      child_report = revision_child_definition_report(entity, state, definition_stack)
      expanded_count = safe_revision_count_add(expanded_count, 1, state)
      expanded_count = safe_revision_count_add(expanded_count, child_report ? child_report['expanded_count'] : 0, state)
      state['unique_entities'] += 1
      if state['unique_entities'] > state['unique_entity_limit']
        mark_revision_incomplete(state, 'unique_entity_limit_exceeded')
        next
      end

      payload = revision_entity_payload(entity, child_report)
      entry_digest.update(revision_json([
        revision_entity_sort_key(entity),
        Digest::SHA256.hexdigest(revision_json(payload))
      ]))
      entry_digest.update("\n")
      hashed_entries += 1
    end
    digest_source = {
      'entries_digest' => "sha256:#{entry_digest.hexdigest}",
      'entry_count' => entries.length,
      'hashed_entry_count' => hashed_entries,
      'complete' => state['complete'] == true
    }
    {
      'digest' => "sha256:#{Digest::SHA256.hexdigest(revision_json(digest_source))}",
      'expanded_count' => expanded_count
    }
  end

  def revision_child_definition_report(entity, state, definition_stack)
    return nil unless entity.is_a?(Sketchup::Group) || entity.is_a?(Sketchup::ComponentInstance)
    return nil unless entity.respond_to?(:definition) && entity.definition

    revision_definition_report(entity.definition, state, definition_stack)
  end

  def revision_definition_report(definition, state, definition_stack)
    key = revision_definition_key(definition, state)
    cached = state['definition_reports'][key]
    return cached if cached

    if definition_stack.include?(key)
      mark_revision_incomplete(state, 'recursive_definition_cycle')
      return {
        'key' => key,
        'digest' => "sha256:#{Digest::SHA256.hexdigest(revision_json({ 'cycle' => key }))}",
        'expanded_count' => 0
      }
    end

    state['reachable_definitions'] += 1
    entities_report = revision_entities_report(definition.entities, state, definition_stack + [key])
    native_classification = state['native_classification_by_definition'][definition.object_id] ||=
      native_definition_classification_summary(definition, state['classification_schemas'])
    payload = {
      'key' => key,
      'name' => definition.respond_to?(:name) ? definition.name.to_s : nil,
      'persistent_id' => entity_persistent_id(definition),
      'native_classification' => native_classification,
      'entities_digest' => entities_report['digest'],
      'expanded_entity_count' => entities_report['expanded_count']
    }
    report = {
      'key' => key,
      'digest' => "sha256:#{Digest::SHA256.hexdigest(revision_json(payload))}",
      'expanded_count' => entities_report['expanded_count']
    }
    state['definition_reports'][key] = report
    report
  end

  def revision_definition_key(definition, state)
    cached = state['definition_keys_by_object'][definition.object_id]
    return cached if cached

    persistent_id = entity_persistent_id(definition).to_s
    reference = entity_id(definition).to_s
    key = if !persistent_id.empty?
            "persistent_id:#{persistent_id}"
          elsif !reference.empty?
            "reference:#{reference}"
          else
            mark_revision_incomplete(state, 'definition_identity_unavailable')
            "runtime:#{definition.object_id}"
          end
    existing_object = state['definition_objects_by_key'][key]
    if existing_object && existing_object != definition.object_id
      mark_revision_incomplete(state, 'duplicate_definition_identity')
    else
      state['definition_objects_by_key'][key] = definition.object_id
    end
    state['definition_keys_by_object'][definition.object_id] = key
  end

  def revision_entity_payload(entity, child_report)
    entity_type = revision_entity_type(entity)
    identity_kind, identity_value = revision_stable_entity_identity(entity)
    {
      'version' => 'model-revision-entity.v2',
      'entity_type' => entity_type,
      'stable_identity' => {
        'kind' => identity_kind,
        'value' => identity_value
      },
      'persistent_id' => entity_persistent_id(entity),
      'reference' => entity_id(entity),
      'name' => entity.respond_to?(:name) ? entity.name.to_s : nil,
      'visible' => entity.respond_to?(:hidden?) ? !entity.hidden? : true,
      'locked' => entity.respond_to?(:locked?) ? entity.locked? : false,
      'material' => revision_material_name(entity, :material),
      'back_material' => entity.is_a?(Sketchup::Face) ? revision_material_name(entity, :back_material) : nil,
      'tag' => entity_tag_name(entity),
      'classification' => entity_classification(entity),
      'attributes' => entity_attributes(entity),
      'texture_transform' => entity_texture_transform(entity),
      'face_uvs' => entity_face_uvs(entity),
      'object_transform' => entity_object_transform(entity),
      'features' => entity_features(entity),
      'local_transformation' => revision_local_transformation(entity),
      'geometry' => revision_geometry_summary(entity),
      'child_definition_key' => child_report && child_report['key'],
      'child_definition_digest' => child_report && child_report['digest']
    }
  end

  def revision_entity_sort_key(entity)
    identity_kind, identity_value = revision_stable_entity_identity(entity)
    [
      identity_kind,
      identity_value,
      revision_entity_type(entity),
      entity.respond_to?(:name) ? entity.name.to_s : ''
    ]
  end

  def revision_stable_entity_identity(entity)
    persistent_id = entity_persistent_id(entity).to_s
    return ['persistent_id', persistent_id] unless persistent_id.empty?

    reference = entity_id(entity).to_s
    return ['reference', reference] unless reference.empty?

    ['unavailable', '']
  end

  def revision_entity_type(entity)
    return 'group' if entity.is_a?(Sketchup::Group)
    return 'component_instance' if entity.is_a?(Sketchup::ComponentInstance)
    return 'face' if entity.is_a?(Sketchup::Face)

    'edge'
  end

  def revision_geometry_summary(entity)
    summary = occurrence_geometry_summary(entity)
    return nil unless summary.is_a?(Hash)

    revision_canonical_geometry_summary(summary)
  end

  def revision_canonical_geometry_summary(summary)
    canonical = summary.dup
    case canonical['type']
    when 'face'
      canonical['outer_loop'] = revision_canonical_ring(canonical['outer_loop'])
      canonical['holes'] = Array(canonical['holes'])
        .map { |ring| revision_canonical_ring(ring) }
        .sort_by { |ring| revision_json(ring) }
    when 'edge'
      canonical['endpoints'] = Array(canonical['endpoints'])
        .map { |point| revision_canonical_value(point) }
        .sort_by { |point| revision_json(point) }
    end
    canonical
  end

  # SketchUp may choose a different loop start vertex or edge direction after
  # save/reopen. A face reversal still changes its normal, which is hashed
  # separately; this normalization removes only representation-order drift.
  def revision_canonical_ring(points)
    normalized = Array(points).map { |point| revision_canonical_value(point) }
    return normalized if normalized.length < 2

    candidates = []
    # The first point determines the lexicographic minimum unless tied. Avoid
    # serializing every full rotation of a large loop just to find that point.
    point_keys = normalized.map { |point| revision_json(point) }
    first_key = point_keys.min
    [normalized, normalized.reverse].each do |sequence|
      sequence.length.times do |offset|
        next unless revision_json(sequence[offset]) == first_key
        candidates << sequence.rotate(offset)
      end
    end
    candidates.min_by { |candidate| revision_json(candidate) }
  end

  def revision_json(value)
    JSON.generate(revision_canonical_value(value))
  end

  def revision_canonical_value(value)
    case value
    when Hash
      pairs = value.map { |key, child| [key.to_s, revision_canonical_value(child)] }
      # Normal native dictionaries have unique string keys. Serializing every
      # subtree as a secondary sort key was redundant for that common case.
      duplicate_keys = pairs.map(&:first).uniq.length != pairs.length
      if duplicate_keys
        pairs.sort_by! { |key, child| [key, JSON.generate(child)] }
        { '$pairs' => pairs }
      else
        pairs.sort_by!(&:first)
        pairs.each_with_object({}) { |(key, child), result| result[key] = child }
      end
    when Array
      value.map { |child| revision_canonical_value(child) }
    when Numeric
      value.respond_to?(:finite?) && !value.finite? ? value.to_s : value
    when Time
      value.utc.iso8601(6)
    when NilClass, String, TrueClass, FalseClass
      value
    else
      value.to_s
    end
  end

  def revision_local_transformation(entity)
    return nil unless entity.respond_to?(:transformation) && entity.transformation

    entity.transformation.to_a.map { |value| value.is_a?(Numeric) && value.finite? ? value : value.to_s }
  end

  def revision_material_name(entity, method_name)
    return nil unless entity.respond_to?(method_name)

    material = entity.public_send(method_name)
    material && material.respond_to?(:name) ? material.name.to_s : nil
  end

  def safe_revision_count_add(left, right, state)
    value = left + right
    return value if value <= MODEL_REVISION_SAFE_INTEGER_MAX

    mark_revision_incomplete(state, 'logical_occurrence_count_overflow')
    MODEL_REVISION_SAFE_INTEGER_MAX
  end

  def mark_revision_incomplete(state, blocker)
    state['complete'] = false
    state['blockers'] << blocker unless state['blockers'].include?(blocker)
  end
end
