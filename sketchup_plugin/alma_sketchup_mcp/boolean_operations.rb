# frozen_string_literal: true

module AlmaSketchupMCP
  extend self

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
    check = {
      'id' => (operation['check_id'] || operation['checkId'] || "manifold_check_#{(@manifold_checks || []).length + 1}").to_s,
      'op' => 'manifold_check',
      'ok' => reports.all? { |report| report['is_manifold'] },
      'targets' => reports
    }
    @manifold_checks ||= []
    @manifold_checks << check
    targets.each { |entity| write_manifold_report(entity, reports.find { |report| report['id'] == (entity_id(entity) || entity.name) }) }
    if !check['ok'] && boolean_value(operation['fail_on_non_manifold'] || operation['failOnNonManifold'] || false, 'manifold_check.fail_on_non_manifold')
      failed = reports.reject { |report| report['is_manifold'] }.map { |report| report['name'] }.join(', ')
      raise "manifold_check failed: #{failed}"
    end
    check
  end

  def manifold_repair(model, operation)
    entity = solid_boolean_target(model, operation, 'manifold_repair')
    strategy = (operation['strategy'] || 'cleanup').to_s.strip.downcase.tr('-', '_')
    raise 'manifold_repair.strategy must be cleanup or seal_bbox' unless %w[cleanup seal_bbox].include?(strategy)

    before = manifold_report(entity)
    repair_group_entities(entity, strategy)
    after = manifold_report(entity).merge('repaired' => true, 'repair_strategy' => strategy)
    write_manifold_report(entity, after)
    @manifold_checks ||= []
    check = {
      'id' => (operation['repair_id'] || operation['repairId'] || "manifold_repair_#{@manifold_checks.length + 1}").to_s,
      'op' => 'manifold_repair',
      'ok' => after['is_manifold'],
      'before' => before,
      'after' => after
    }
    @manifold_checks << check
    if !after['is_manifold'] && boolean_value(operation['fail_on_non_manifold'] || operation['failOnNonManifold'] || false, 'manifold_repair.fail_on_non_manifold')
      raise "manifold_repair failed: #{entity.name} is still non-manifold"
    end
    check
  end

  def apply_solid_boolean(model, operation, op_name, method_name)
    target = solid_boolean_target(model, operation, op_name)
    tools = solid_boolean_tools(model, operation, op_name)
    validate_distinct_boolean_inputs(target, tools, op_name)
    keep_tools = boolean_value(operation['keep_tools'] || operation['keepTools'] || false, "#{op_name}.keep_tools")
    keep_originals = boolean_value(operation['keep_originals'] || operation['keepOriginals'] || false, "#{op_name}.keep_originals")
    result_name = non_empty_string(operation['result_name'] || operation['resultName'] || operation['name'] || target.name, "#{op_name}.result_name")
    result_id = (operation['result_id'] || operation['resultId'] || result_name).to_s
    prior_operations = entity_boolean_operations(target)
    payload_method_name = op_name == 'boolean_difference' ? :split_difference : method_name
    payload = boolean_payload(operation, op_name, target, tools, payload_method_name)
    result_material_name = operation['material'] || first_group_material(target)

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
      raise "#{op_name} failed for #{result.name} and #{tool.name}" unless next_result.is_a?(Sketchup::Group)

      result = next_result
    end

    result.name = result_name
    apply_material_to_entity(result, ensure_material(result_material_name, '#cccccc')) if result_material_name
    annotate_group(result, { 'op' => 'solid_boolean', 'name' => result_name, 'id' => result_id, 'kind' => 'solid_boolean' }, 'solid_boolean')
    record_boolean_operation(result, payload, prior_operations)
    write_manifold_report(result, manifold_report(result))
    cleanup_boolean_inputs(target, tools, working_target, working_tools, result, keep_originals, keep_tools)
    result
  end

  def solid_difference_result(target, tool, op_name)
    ensure_solid_operation_available(target, :split, op_name)
    pieces = target.split(tool)
    raise "#{op_name} failed to split #{target.name} and #{tool.name}" unless pieces.is_a?(Array) && pieces.length >= 3

    difference_self, difference_other, intersection = pieces
    erase_entity_if_valid(difference_other)
    erase_entity_if_valid(intersection)
    raise "#{op_name} produced no remaining target solid for #{target.name}" unless difference_self.is_a?(Sketchup::Group)

    difference_self
  end

  def solid_boolean_target(model, operation, op_name)
    entity = find_referenced_entity(model, operation, op_name)
    raise "#{op_name} requires a top-level SketchUp group target" unless entity.is_a?(Sketchup::Group)
    raise "#{op_name}.target must be a manifold SketchUp solid: #{entity.name}" unless manifold_report(entity)['is_manifold']

    entity
  end

  def solid_boolean_tools(model, operation, op_name)
    raw = operation['tools'] || operation['tool_ids'] || operation['toolIds'] || operation['tool_id'] || operation['toolId']
    values = raw.is_a?(Array) ? raw : (raw.nil? ? [] : [raw])
    raise "#{op_name} requires tools, tool_ids, or tool_id" if values.empty?

    values.each_with_index.map do |value, index|
      entity = find_boolean_tool(model, value, "#{op_name}.tools[#{index}]")
      raise "#{op_name}.tools[#{index}] must resolve to a top-level SketchUp group" unless entity.is_a?(Sketchup::Group)
      raise "#{op_name}.tools[#{index}] must be a manifold SketchUp solid: #{entity.name}" unless manifold_report(entity)['is_manifold']

      entity
    end
  end

  def find_boolean_tool(model, value, field_name)
    if value.is_a?(Hash)
      operation = {}
      operation['target_id'] = value['target_id'] || value['targetId'] || value['id'] || value['object_id'] || value['objectId'] || value['guid']
      operation['name'] = value['name'] || value['target'] || value['object']
      return find_referenced_entity(model, operation, field_name)
    end
    key = non_empty_string(value.to_s, field_name)
    entity = (model.entities.grep(Sketchup::Group) + model.entities.grep(Sketchup::ComponentInstance)).find do |item|
      [entity_id(item), entity_persistent_id(item), item.name].compact.include?(key)
    end
    raise "object not found: #{field_name} #{key}" unless entity

    entity
  end

  def validate_distinct_boolean_inputs(target, tools, op_name)
    seen = { target.entityID => true }
    tools.each do |tool|
      raise "#{op_name} target/tools must be distinct solids" if seen[tool.entityID]

      seen[tool.entityID] = true
    end
  end

  def ensure_solid_operation_available(entity, method_name, op_name)
    return if entity.respond_to?(method_name)

    raise "#{op_name} requires SketchUp solid operation #{method_name}; this SketchUp build does not expose it"
  end

  def copy_boolean_group(model, entity, name)
    raise 'boolean keep_originals/keep_tools requires SketchUp entity copy support' unless entity.respond_to?(:copy)

    copy = entity.copy
    copy.name = name
    copy
  rescue StandardError => error
    raise "Failed to copy boolean input #{entity.name}: #{error.message}"
  end

  def cleanup_boolean_inputs(target, tools, working_target, working_tools, result, keep_originals, keep_tools)
    erase_entity_if_valid(working_target) if keep_originals && working_target != result
    working_tools.each { |tool| erase_entity_if_valid(tool) } if keep_tools
    erase_entity_if_valid(target) if !keep_originals && target != result
    tools.each { |tool| erase_entity_if_valid(tool) } unless keep_tools
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
    entity.set_attribute('AlmaBoolean', 'operations_json', JSON.generate(operations))
  end

  def entity_boolean_operations(entity)
    raw = entity.get_attribute('AlmaBoolean', 'operations_json') if entity.respond_to?(:get_attribute)
    return [] if raw.nil? || raw.to_s.empty?

    parsed = JSON.parse(raw.to_s)
    parsed.is_a?(Array) ? parsed : []
  rescue JSON::ParserError
    []
  end

  def manifold_targets(model, operation, op_name)
    raw_targets = operation['targets'] || operation['target_ids'] || operation['targetIds']
    if raw_targets
      values = raw_targets.is_a?(Array) ? raw_targets : [raw_targets]
      return values.each_with_index.map { |value, index| find_boolean_tool(model, value, "#{op_name}.targets[#{index}]") }
    end
    if operation['target_id'] || operation['targetId'] || operation['name'] || operation['target'] || operation['object']
      return [find_referenced_entity(model, operation, op_name)]
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
    entity.set_attribute('AlmaManifold', 'report_json', JSON.generate(report)) if entity.respond_to?(:set_attribute)
  end

  def entity_manifold_report(entity)
    raw = entity.get_attribute('AlmaManifold', 'report_json') if entity.respond_to?(:get_attribute)
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
