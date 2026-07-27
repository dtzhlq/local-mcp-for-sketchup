# frozen_string_literal: true

module LocalMcpForSketchUp
  extend self

  BOOLEAN_OPERATION_FAILURE_MESSAGES = {
    'boolean_input_resolution_failed' => 'A reviewed Boolean input could not be resolved.',
    'boolean_input_not_group' => 'A reviewed Boolean input is not a SketchUp group.',
    'boolean_input_scope_mismatch' => 'The reviewed Boolean inputs do not share one editable entity scope.',
    'boolean_input_not_manifold' => 'A reviewed Boolean input is not a manifold solid.',
    'boolean_duplicate_input' => 'The reviewed Boolean target and tools must be distinct solids.',
    'boolean_result_identity_conflict' => 'The reviewed Boolean result identity is already in use.',
    'boolean_solid_operation_unavailable' => 'The requested SketchUp solid operation is unavailable.',
    'boolean_input_copy_failed' => 'A reviewed Boolean input could not be copied safely.',
    'boolean_split_result_count_mismatch' => 'The Boolean split did not return exactly 3 result pieces.',
    'boolean_split_result_type_invalid' => 'The Boolean split returned an invalid result piece type.',
    'boolean_solid_volume_invalid' => 'A Boolean solid does not expose a positive finite volume.',
    'boolean_target_volume_not_reduced' => 'The Boolean difference did not reduce target volume.',
    'boolean_solid_operation_failed' => 'The SketchUp solid operation did not return a result group.',
    'boolean_result_not_manifold' => 'The Boolean operation produced a non-manifold result.',
    'boolean_cleanup_failed' => 'Boolean temporary geometry cleanup failed.',
    'boolean_postcondition_failed' => 'A Boolean postcondition failed before commit.',
    'boolean_internal_failure' => 'The Boolean operation failed before commit.'
  }.freeze
  BOOLEAN_OPERATION_FAILURE_CODES = BOOLEAN_OPERATION_FAILURE_MESSAGES.keys.freeze

  class BooleanOperationFailure < StandardError
    attr_reader :operation_failure_code

    def initialize(operation_failure_code)
      code = operation_failure_code.to_s
      code = 'boolean_internal_failure' unless BOOLEAN_OPERATION_FAILURE_CODES.include?(code)
      @operation_failure_code = code
      super(BOOLEAN_OPERATION_FAILURE_MESSAGES.fetch(code))
    end
  end

  def raise_boolean_operation_failure(operation_failure_code)
    raise BooleanOperationFailure.new(operation_failure_code)
  end

  def normalize_boolean_operation_failure(error)
    return error if error.is_a?(BooleanOperationFailure)
    return error if defined?(QueueOperationError) && error.is_a?(QueueOperationError)

    BooleanOperationFailure.new('boolean_internal_failure')
  end

  def normalize_boolean_input_resolution_failure(error)
    return error if error.is_a?(BooleanOperationFailure)
    return error if defined?(QueueOperationError) && error.is_a?(QueueOperationError)

    BooleanOperationFailure.new('boolean_input_resolution_failed')
  end

  def assert_boolean_manifold_report!(report, operation_failure_code)
    return report if report.is_a?(Hash) && report['is_manifold'] == true

    raise_boolean_operation_failure(operation_failure_code)
  end

  def boolean_union(model, operation)
    apply_solid_boolean(model, operation, 'boolean_union', :union)
  end

  def boolean_difference(model, operation)
    apply_solid_boolean(model, operation, 'boolean_difference', :subtract)
  end

  def boolean_intersect(model, operation)
    apply_solid_boolean(model, operation, 'boolean_intersect', :intersect)
  end

  def manifold_check(model, operation)
    targets = manifold_targets(model, operation, 'manifold_check')
    reports = targets.map { |entity| manifold_report(entity) }
    manifold_checks = document_state_array('manifold_checks', model)
    check = {
      'id' => (operation['check_id'] || operation['checkId'] || "manifold_check_#{manifold_checks.length + 1}").to_s,
      'op' => 'manifold_check',
      'ok' => reports.all? { |report| report['is_manifold'] },
      'targets' => reports
    }
    manifold_checks << check
    targets.each { |entity| write_manifold_report(entity, reports.find { |report| report['id'] == (entity_id(entity) || entity.name) }) }
    if !check['ok'] && boolean_value(operation['fail_on_non_manifold'] || operation['failOnNonManifold'] || false, 'manifold_check.fail_on_non_manifold')
      failed = reports.reject { |report| report['is_manifold'] }.map { |report| report['name'] }.join(', ')
      raise "manifold_check failed: #{failed}"
    end
    check
  end

  def manifold_repair(model, operation)
    # A repair target is expected to be non-manifold. Reusing the Boolean
    # operand resolver here made every genuine repair fail before cleanup
    # because solid_boolean_target requires an already-manifold input.
    entity = manifold_repair_target(model, operation)
    strategy = (operation['strategy'] || 'cleanup').to_s.strip.downcase.tr('-', '_')
    raise 'manifold_repair.strategy must be cleanup or seal_bbox' unless %w[cleanup seal_bbox].include?(strategy)

    before = manifold_report(entity)
    repair_group_entities(entity, strategy)
    after = manifold_report(entity).merge('repaired' => true, 'repair_strategy' => strategy)
    write_manifold_report(entity, after)
    manifold_checks = document_state_array('manifold_checks', model)
    check = {
      'id' => (operation['repair_id'] || operation['repairId'] || "manifold_repair_#{manifold_checks.length + 1}").to_s,
      'op' => 'manifold_repair',
      'ok' => after['is_manifold'],
      'before' => before,
      'after' => after
    }
    manifold_checks << check
    if !after['is_manifold'] && boolean_value(operation['fail_on_non_manifold'] || operation['failOnNonManifold'] || false, 'manifold_repair.fail_on_non_manifold')
      raise "manifold_repair failed: #{entity.name} is still non-manifold"
    end
    check
  end

  def manifold_repair_target(model, operation)
    entity = begin
      find_referenced_entity(model, operation, 'manifold_repair')
    rescue StandardError => error
      raise normalize_boolean_input_resolution_failure(error)
    end
    raise_boolean_operation_failure('boolean_input_not_group') unless entity.is_a?(Sketchup::Group)

    entity
  end

  def apply_solid_boolean(model, operation, op_name, method_name)
    target = solid_boolean_target(model, operation, op_name)
    tools = solid_boolean_tools(model, operation, op_name, target)
    validate_distinct_boolean_inputs(target, tools, op_name)
    keep_tools = boolean_value(operation['keep_tools'] || operation['keepTools'] || false, "#{op_name}.keep_tools")
    keep_originals = boolean_value(operation['keep_originals'] || operation['keepOriginals'] || false, "#{op_name}.keep_originals")
    result_name = non_empty_string(operation['result_name'] || operation['resultName'] || operation['name'] || target.name, "#{op_name}.result_name")
    result_id = (operation['result_id'] || operation['resultId'] || result_name).to_s
    prior_operations = entity_boolean_operations(target)
    payload_method_name = op_name == 'boolean_difference' ? :split_difference : method_name
    payload = boolean_payload(operation, op_name, target, tools, payload_method_name)
    result_material_name = operation['material'] || first_group_material(target)
    parent_entities = editable_parent_entities(target)
    before_groups = parent_entities.grep(Sketchup::Group).dup
    assert_boolean_result_identity_available(
      before_groups,
      target,
      tools,
      result_id,
      result_name,
      keep_originals,
      keep_tools,
      op_name
    )

    working_target = keep_originals ? copy_boolean_group(model, target, "#{target.name}_Boolean_Work") : target
    working_tools = keep_tools ? tools.each_with_index.map { |tool, index| copy_boolean_group(model, tool, "#{tool.name}_Boolean_Tool_#{index + 1}") } : tools
    result = working_target
    working_tools.each do |tool|
      next_result = if op_name == 'boolean_difference'
                      solid_difference_result(result, tool, op_name)
                    else
                      ensure_solid_operation_available(result, method_name, op_name)
                      result.public_send(method_name, tool)
                    end
      raise_boolean_operation_failure('boolean_solid_operation_failed') unless next_result.is_a?(Sketchup::Group)

      result = next_result
    end

    result.name = result_name
    apply_material_to_entity(result, ensure_material(result_material_name, '#cccccc')) if result_material_name
    annotate_group(result, { 'op' => 'solid_boolean', 'name' => result_name, 'id' => result_id, 'kind' => 'solid_boolean' }, 'solid_boolean')
    record_boolean_operation(result, payload, prior_operations)
    result_manifold = manifold_report(result)
    assert_boolean_manifold_report!(result_manifold, 'boolean_result_not_manifold')

    write_manifold_report(result, result_manifold)
    cleanup_boolean_inputs(target, tools, working_target, working_tools, result, keep_originals, keep_tools)
    assert_boolean_postconditions(
      parent_entities,
      before_groups,
      target,
      tools,
      working_target,
      working_tools,
      result,
      keep_originals,
      keep_tools,
      op_name
    )
    result
  rescue StandardError => error
    raise normalize_boolean_operation_failure(error)
  end

  def solid_difference_result(target, tool, op_name)
    ensure_solid_operation_available(target, :split, op_name)
    target_volume_before = strict_boolean_volume(target, "#{op_name}.target_before_split")
    pieces = target.split(tool)
    raise_boolean_operation_failure('boolean_split_result_count_mismatch') unless pieces.is_a?(Array) && pieces.length == 3
    unless pieces.all? { |piece| piece.is_a?(Sketchup::Group) }
      raise_boolean_operation_failure('boolean_split_result_type_invalid')
    end

    # SketchUp's documented split order is Difference2 (other - self),
    # Difference1 (self - other), Intersection. The target difference is the
    # second result, not the first.
    difference_other, difference_self, intersection = pieces
    target_volume_after = strict_boolean_volume(difference_self, "#{op_name}.target_difference")
    assert_boolean_difference_volume_reduced(target_volume_before, target_volume_after, op_name)
    erase_entity_strict!(difference_other, "#{op_name}.difference_other")
    erase_entity_strict!(intersection, "#{op_name}.intersection")
    raise_boolean_operation_failure('boolean_solid_operation_failed') unless difference_self.is_a?(Sketchup::Group)

    difference_self
  end

  def strict_boolean_volume(entity, label)
    raise_boolean_operation_failure('boolean_solid_volume_invalid') unless entity.respond_to?(:volume)

    volume = entity.volume.to_f
    raise_boolean_operation_failure('boolean_solid_volume_invalid') unless volume.finite? && volume.positive?

    volume
  end

  def assert_boolean_difference_volume_reduced(before_volume, after_volume, op_name)
    tolerance = [before_volume.abs * 1.0e-9, 1.0e-6].max
    return if after_volume < before_volume - tolerance

    raise_boolean_operation_failure('boolean_target_volume_not_reduced')
  end

  def assert_boolean_result_identity_available(before_groups, target, tools, result_id, result_name, keep_originals, keep_tools, op_name)
    replaceable = []
    replaceable << target unless keep_originals
    replaceable.concat(tools) unless keep_tools
    collision = before_groups.find do |entity|
      next false if replaceable.include?(entity)

      entity_id(entity).to_s == result_id.to_s || entity.name.to_s == result_name.to_s
    end
    return unless collision

    raise_boolean_operation_failure('boolean_result_identity_conflict')
  end

  def solid_boolean_target(model, operation, op_name)
    entity = begin
      find_referenced_entity(model, operation, op_name)
    rescue StandardError => error
      raise normalize_boolean_input_resolution_failure(error)
    end
    raise_boolean_operation_failure('boolean_input_not_group') unless entity.is_a?(Sketchup::Group)
    assert_boolean_manifold_report!(manifold_report(entity), 'boolean_input_not_manifold')

    entity
  end

  def solid_boolean_tools(model, operation, op_name, target)
    raw = operation['tools'] || operation['tool_ids'] || operation['toolIds'] || operation['tool_id'] || operation['toolId']
    values = raw.is_a?(Array) ? raw : (raw.nil? ? [] : [raw])
    raise_boolean_operation_failure('boolean_input_resolution_failed') if values.empty?

    values.each_with_index.map do |value, index|
      entity = begin
        find_boolean_tool(model, value, "#{op_name}.tools[#{index}]", op_name, editable_parent_entities(target))
      rescue StandardError => error
        raise normalize_boolean_input_resolution_failure(error)
      end
      raise_boolean_operation_failure('boolean_input_not_group') unless entity.is_a?(Sketchup::Group)
      raise_boolean_operation_failure('boolean_input_scope_mismatch') unless editable_parent_entities(entity).equal?(editable_parent_entities(target))
      assert_boolean_manifold_report!(manifold_report(entity), 'boolean_input_not_manifold')

      entity
    end
  end

  def find_boolean_tool(model, value, field_name, op_name = field_name, scoped_entities = nil, allow_locked: false)
    if value.is_a?(Hash)
      begin
        return find_referenced_entity(model, value, op_name, allow_locked: allow_locked)
      rescue StandardError
        fallback = value['name'] || value['target'] || value['object'] || value['target_id'] || value['targetId'] || value['id']
        raise unless fallback && scoped_entities

        scoped = scoped_entities.grep(Sketchup::Group).find do |item|
          [entity_id(item), entity_persistent_id(item), item.name].compact.map(&:to_s).include?(fallback.to_s)
        end
        return assert_reference_entity_access!(scoped, op_name, allow_locked: allow_locked, role: field_name) if scoped

        raise
      end
    end
    key = non_empty_string(value.to_s, field_name)
    candidates = scoped_entities ? scoped_entities.grep(Sketchup::Group) : (model.entities.grep(Sketchup::Group) + model.entities.grep(Sketchup::ComponentInstance))
    entity = candidates.find do |item|
      [entity_id(item), entity_persistent_id(item), item.name].compact.include?(key)
    end
    raise "object not found: #{field_name} #{key}" unless entity

    assert_reference_entity_access!(entity, op_name, allow_locked: allow_locked, role: field_name)
  end

  def validate_distinct_boolean_inputs(target, tools, op_name)
    seen = { target.entityID => true }
    tools.each do |tool|
      raise_boolean_operation_failure('boolean_duplicate_input') if seen[tool.entityID]

      seen[tool.entityID] = true
    end
  end

  def ensure_solid_operation_available(entity, method_name, op_name)
    return if entity.respond_to?(method_name)

    raise_boolean_operation_failure('boolean_solid_operation_unavailable')
  end

  def copy_boolean_group(model, entity, name)
    raise_boolean_operation_failure('boolean_input_copy_failed') unless entity.respond_to?(:copy)

    copy = entity.copy
    copy.name = name
    copy
  rescue BooleanOperationFailure
    raise
  rescue StandardError
    raise_boolean_operation_failure('boolean_input_copy_failed')
  end

  def cleanup_boolean_inputs(target, tools, working_target, working_tools, result, keep_originals, keep_tools)
    erase_entity_strict!(working_target, 'boolean.working_target') if keep_originals && working_target != result
    working_tools.each_with_index { |tool, index| erase_entity_strict!(tool, "boolean.working_tools[#{index}]") } if keep_tools
    erase_entity_strict!(target, 'boolean.target') if !keep_originals && target != result
    tools.each_with_index { |tool, index| erase_entity_strict!(tool, "boolean.tools[#{index}]") } unless keep_tools
  end

  def assert_boolean_postconditions(parent_entities, before_groups, target, tools, working_target, working_tools, result, keep_originals, keep_tools, op_name)
    after_groups = parent_entities.grep(Sketchup::Group)
    expected_survivors = before_groups.reject do |entity|
      (!keep_originals && entity.equal?(target)) || (!keep_tools && tools.include?(entity))
    end
    missing = expected_survivors.reject { |entity| after_groups.include?(entity) && entity_valid?(entity) }
    raise_boolean_operation_failure('boolean_postcondition_failed') unless missing.empty?

    new_groups = after_groups.reject { |entity| expected_survivors.include?(entity) }
    unless new_groups.length == 1 && new_groups.first.equal?(result) && entity_valid?(result)
      raise_boolean_operation_failure('boolean_postcondition_failed')
    end
    raise_boolean_operation_failure('boolean_postcondition_failed') if keep_originals && !entity_valid?(target)
    raise_boolean_operation_failure('boolean_postcondition_failed') if keep_tools && tools.any? { |tool| !entity_valid?(tool) }
    raise_boolean_operation_failure('boolean_postcondition_failed') if keep_originals && !working_target.equal?(result) && entity_valid?(working_target)
    raise_boolean_operation_failure('boolean_postcondition_failed') if keep_tools && working_tools.any? { |tool| entity_valid?(tool) }
  end

  def entity_valid?(entity)
    return false unless entity
    return false if entity.respond_to?(:deleted?) && entity.deleted?

    !entity.respond_to?(:valid?) || entity.valid?
  end

  def erase_entity_strict!(entity, label)
    return unless entity_valid?(entity)

    entity.erase! if entity.respond_to?(:erase!)
    raise_boolean_operation_failure('boolean_cleanup_failed') if entity_valid?(entity)
  rescue BooleanOperationFailure
    raise
  rescue StandardError
    raise_boolean_operation_failure('boolean_cleanup_failed')
  end

  def erase_entity_if_valid(entity)
    return unless entity && (!entity.respond_to?(:valid?) || entity.valid?)
    return if entity.respond_to?(:deleted?) && entity.deleted?

    entity.erase! if entity.respond_to?(:erase!)
  rescue StandardError
    nil
  end

  def boolean_payload(operation, op_name, target, tools, method_name)
    {
      'op' => op_name,
      'id' => (operation['boolean_id'] || operation['booleanId'] || "#{target.name}_#{op_name}").to_s,
      'target_id' => entity_id(target) || target.name,
      'target_name' => target.name,
      'tool_ids' => tools.map { |tool| entity_id(tool) || tool.name },
      'tool_names' => tools.map(&:name),
      'method' => method_name.to_s,
      'runtime' => 'sketchup_solid_tools'
    }
  end

  def record_boolean_operation(entity, payload, prior_operations = nil)
    operations = prior_operations ? prior_operations.map(&:dup) : entity_boolean_operations(entity)
    operations << payload
    entity.set_attribute('LocalMcpBoolean', 'operations_json', JSON.generate(operations))
  end

  def entity_boolean_operations(entity)
    raw = compatible_attribute(entity, 'LocalMcpBoolean', 'operations_json')
    return [] if raw.nil? || raw.to_s.empty?

    parsed = JSON.parse(raw.to_s)
    parsed.is_a?(Array) ? parsed : []
  rescue JSON::ParserError
    []
  end

  def manifold_targets(model, operation, op_name)
    allow_locked = op_name == 'manifold_check'
    raw_targets = operation['targets'] || operation['target_ids'] || operation['targetIds']
    if raw_targets
      values = raw_targets.is_a?(Array) ? raw_targets : [raw_targets]
      return values.each_with_index.map { |value, index| find_boolean_tool(model, value, "#{op_name}.targets[#{index}]", op_name, nil, allow_locked: allow_locked) }
    end
    if operation['entity_path'] || operation['entityPath'] || operation['target_path'] || operation['targetPath'] ||
       operation['target_id'] || operation['targetId'] || operation['name'] || operation['target'] || operation['object']
      return [find_referenced_entity(model, operation, op_name, allow_locked: allow_locked)]
    end
    model.entities.grep(Sketchup::Group)
  end

  def manifold_report(entity)
    issues = []
    is_group = entity.is_a?(Sketchup::Group)
    issues << 'not_group' unless is_group
    faces = is_group ? count_faces(entity.entities) : 0
    edges = is_group ? count_edges(entity.entities) : 0
    vertices = is_group ? count_vertices(entity.entities) : 0
    issues << 'no_faces' if faces.zero?
    bounds = entity.respond_to?(:bounds) ? bounds_hash(entity.bounds) : nil
    positive_volume = bounds && bounds['w'].positive? && bounds['d'].positive? && bounds['h'].positive?
    issues << 'non_positive_volume' unless positive_volume
    manifold_api = entity.respond_to?(:manifold?) ? entity.manifold? : nil
    issues << 'sketchup_manifold_false' if manifold_api == false
    edge_counts = is_group ? manifold_edge_counts(entity.entities) : { boundary: 0, non_manifold: 0 }
    issues << 'boundary_edges' if edge_counts[:boundary].positive?
    issues << 'non_manifold_edges' if edge_counts[:non_manifold].positive?
    volume = entity.respond_to?(:volume) ? (entity.volume.to_f * (MM_PER_INCH**3)).round(6) : nil
    {
      'id' => entity_id(entity) || entity.name,
      'persistent_id' => entity_persistent_id(entity),
      'name' => entity.name,
      'kind' => is_group ? group_kind(entity) : nil,
      'is_manifold' => issues.empty?,
      'method' => manifold_api.nil? ? 'edge_fallback' : 'sketchup_manifold_api',
      'checked' => true,
      'faces' => faces,
      'edges' => edges,
      'vertices' => vertices,
      'volume' => volume,
      'checks' => {
        'positive_volume' => positive_volume,
        'has_faces' => faces.positive?,
        'closed_edges' => edge_counts[:boundary].zero? && edge_counts[:non_manifold].zero?,
        'sketchup_manifold' => manifold_api
      },
      'issues' => issues
    }
  end

  def manifold_edge_counts(entities)
    boundary = 0
    non_manifold = 0
    entities.grep(Sketchup::Edge).each do |edge|
      count = edge.faces.length
      boundary += 1 if count < 2
      non_manifold += 1 if count > 2
    end
    entities.grep(Sketchup::Group).each do |group|
      nested = manifold_edge_counts(group.entities)
      boundary += nested[:boundary]
      non_manifold += nested[:non_manifold]
    end
    { boundary: boundary, non_manifold: non_manifold }
  end

  def write_manifold_report(entity, report)
    entity.set_attribute('LocalMcpManifold', 'report_json', JSON.generate(report)) if entity.respond_to?(:set_attribute)
  end

  def entity_manifold_report(entity)
    raw = compatible_attribute(entity, 'LocalMcpManifold', 'report_json')
    return nil if raw.nil? || raw.to_s.empty?

    JSON.parse(raw.to_s)
  rescue JSON::ParserError
    nil
  end

  def repair_group_entities(entity, strategy)
    entity.entities.grep(Sketchup::Edge).each { |edge| edge.find_faces if edge.respond_to?(:find_faces) }
    entity.entities.grep(Sketchup::Edge).each { |edge| edge.erase! if edge.valid? && edge.faces.empty? }
    return unless strategy == 'seal_bbox' && !manifold_report(entity)['is_manifold']

    bounds = entity.bounds
    entity.entities.clear!
    add_bbox_solid(entity.entities, bounds)
  end

  def add_bbox_solid(entities, bounds)
    min = bounds.min
    max = bounds.max
    points = [
      Geom::Point3d.new(min.x, min.y, min.z),
      Geom::Point3d.new(max.x, min.y, min.z),
      Geom::Point3d.new(max.x, max.y, min.z),
      Geom::Point3d.new(min.x, max.y, min.z),
      Geom::Point3d.new(min.x, min.y, max.z),
      Geom::Point3d.new(max.x, min.y, max.z),
      Geom::Point3d.new(max.x, max.y, max.z),
      Geom::Point3d.new(min.x, max.y, max.z)
    ]
    [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7]
    ].each do |indexes|
      face = entities.add_face(indexes.map { |index| points[index] })
      face.reverse! if face && face.normal.length <= 0
    end
  end
end
