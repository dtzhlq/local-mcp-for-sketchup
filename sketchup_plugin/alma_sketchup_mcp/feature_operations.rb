# frozen_string_literal: true

module AlmaSketchupMCP
  extend self

  ALLOWED_FEATURE_TARGET_KINDS = %w[box rounded_box panel_with_openings boolean_cutout floor_slab wall].freeze
  FEATURE_FACE_SPECS = {
    'top' => { axes: [0, 1], normal_axis: 2, outward: 1, surface: :max, normal: [0, 0, 1] },
    'bottom' => { axes: [0, 1], normal_axis: 2, outward: -1, surface: :min, normal: [0, 0, -1] },
    'front' => { axes: [0, 2], normal_axis: 1, outward: -1, surface: :min, normal: [0, -1, 0] },
    'back' => { axes: [0, 2], normal_axis: 1, outward: 1, surface: :max, normal: [0, 1, 0] },
    'left' => { axes: [1, 2], normal_axis: 0, outward: -1, surface: :min, normal: [-1, 0, 0] },
    'right' => { axes: [1, 2], normal_axis: 0, outward: 1, surface: :max, normal: [1, 0, 0] }
  }.freeze

  def cut_hole(model, operation)
    context = feature_context(model, operation, 'cut_hole')
    radius = positive_number(operation['radius'], nil, 'cut_hole.radius')
    segments = integer_range(operation['segments'] || 24, 8, 96, 'cut_hole.segments')
    validate_feature_fits(context, radius * 2.0, radius * 2.0, 'cut_hole')
    through = operation.key?('through') ? boolean_value(operation['through'], 'cut_hole.through') : true
    depth = through ? context[:thickness] : positive_number(operation['depth'], nil, 'cut_hole.depth')
    profile = circle_profile(context[:center], radius, segments)
    push_feature_profile(context, profile, -depth)
    record_feature_operation(context[:entity], feature_payload(operation, context, 'cut_hole').merge(
      'radius' => radius,
      'depth' => depth,
      'through' => through,
      'segments' => segments,
      'method' => 'face_pushpull'
    ))
  end

  def cut_slot(model, operation)
    context = feature_context(model, operation, 'cut_slot')
    length = positive_number(operation['length'], nil, 'cut_slot.length')
    width = positive_number(operation['width'], nil, 'cut_slot.width')
    raise 'cut_slot.length must be greater than or equal to width' if length < width

    segments = integer_range(operation['segments'] || 12, 4, 48, 'cut_slot.segments')
    validate_feature_fits(context, length, width, 'cut_slot')
    through = operation.key?('through') ? boolean_value(operation['through'], 'cut_slot.through') : true
    depth = through ? context[:thickness] : positive_number(operation['depth'], nil, 'cut_slot.depth')
    profile = rounded_rect_points(context[:center][0] - length / 2.0, context[:center][1] - width / 2.0, length, width, width / 2.0, segments)
    push_feature_profile(context, profile, -depth)
    record_feature_operation(context[:entity], feature_payload(operation, context, 'cut_slot').merge(
      'length' => length,
      'width' => width,
      'depth' => depth,
      'through' => through,
      'segments' => segments,
      'method' => 'face_pushpull'
    ))
  end

  def cut_recess(model, operation)
    context = feature_context(model, operation, 'cut_recess')
    width, height = size2(operation.fetch('size'), 'cut_recess.size')
    depth = positive_number(operation['depth'], nil, 'cut_recess.depth')
    radius = [non_negative_number(operation['radius'], 0, 'cut_recess.radius'), width / 2.0, height / 2.0].min
    segments = integer_range(operation['segments'] || 8, 1, 48, 'cut_recess.segments')
    validate_feature_fits(context, width, height, 'cut_recess')
    profile = rounded_rect_points(context[:center][0] - width / 2.0, context[:center][1] - height / 2.0, width, height, radius, segments)
    push_feature_profile(context, profile, -depth)
    record_feature_operation(context[:entity], feature_payload(operation, context, 'cut_recess').merge(
      'size' => [width, height],
      'radius' => radius,
      'depth' => depth,
      'through' => false,
      'segments' => segments,
      'method' => 'face_pushpull'
    ))
  end

  def add_boss(model, operation)
    context = feature_context(model, operation, 'add_boss')
    radius = positive_number(operation['radius'] || operation['outer_radius'] || operation['outerRadius'], nil, 'add_boss.radius')
    height = positive_number(operation['height'], nil, 'add_boss.height')
    segments = integer_range(operation['segments'] || 24, 8, 96, 'add_boss.segments')
    validate_feature_fits(context, radius * 2.0, radius * 2.0, 'add_boss')
    profile = circle_profile(context[:center], radius, segments)
    push_feature_profile(context, profile, height)
    record_feature_operation(context[:entity], feature_payload(operation, context, 'add_boss').merge(
      'radius' => radius,
      'height' => height,
      'segments' => segments,
      'method' => 'face_pushpull'
    ))
  end

  def add_raised_rib(model, operation)
    context = feature_context(model, operation, 'add_raised_rib')
    length = positive_number(operation['length'], nil, 'add_raised_rib.length')
    width = positive_number(operation['width'] || operation['thickness'], nil, 'add_raised_rib.width')
    height = positive_number(operation['height'], nil, 'add_raised_rib.height')
    direction = (operation['direction'] || 'u').to_s.strip.downcase
    raise 'add_raised_rib.direction must be u or v' unless %w[u v].include?(direction)

    footprint = direction == 'u' ? [length, width] : [width, length]
    validate_feature_fits(context, footprint[0], footprint[1], 'add_raised_rib')
    center_u, center_v = context[:center]
    profile = [
      [center_u - footprint[0] / 2.0, center_v - footprint[1] / 2.0],
      [center_u + footprint[0] / 2.0, center_v - footprint[1] / 2.0],
      [center_u + footprint[0] / 2.0, center_v + footprint[1] / 2.0],
      [center_u - footprint[0] / 2.0, center_v + footprint[1] / 2.0]
    ]
    push_feature_profile(context, profile, height)
    record_feature_operation(context[:entity], feature_payload(operation, context, 'add_raised_rib').merge(
      'length' => length,
      'width' => width,
      'height' => height,
      'direction' => direction,
      'method' => 'face_pushpull'
    ))
  end

  def feature_context(model, operation, op_name)
    entity = find_referenced_entity(model, operation, op_name)
    raise "#{op_name} can only edit SketchUp groups in this phase" unless entity.is_a?(Sketchup::Group)
    raise "#{op_name} currently requires an untransformed target group" unless identity_transformation?(entity.transformation)

    kind = group_kind(entity)
    unless ALLOWED_FEATURE_TARGET_KINDS.include?(kind)
      raise "#{op_name} supports #{ALLOWED_FEATURE_TARGET_KINDS.join(', ')} targets; got #{kind || 'unknown'} for #{entity.name}"
    end
    face = feature_face_name(operation['face'] || operation['plane'], op_name)
    spec = FEATURE_FACE_SPECS.fetch(face)
    bounds = feature_base_bounds(entity)
    center = feature_center(operation.fetch('center'), bounds, spec, "#{op_name}.center")
    extents = spec[:axes].map { |axis| model_units_to_mm(bounds[:max][axis] - bounds[:min][axis]) }
    thickness = model_units_to_mm(bounds[:max][spec[:normal_axis]] - bounds[:min][spec[:normal_axis]])
    { entity: entity, face: face, spec: spec, bounds: bounds, center: center, extents: extents, thickness: thickness }
  end

  def feature_face_name(value, op_name)
    raw = (value || 'top').to_s.strip.downcase.tr('-', '_')
    raw = { 'xy' => 'top', 'xz' => 'front', 'yz' => 'left' }[raw] || raw
    raise "#{op_name}.face must be one of top, bottom, front, back, left, right" unless FEATURE_FACE_SPECS.key?(raw)

    raw
  end

  def feature_bounds(entity)
    bounds = entity.bounds
    {
      min: [bounds.min.x, bounds.min.y, bounds.min.z].map { |value| feature_bound_model_units(value) },
      max: [bounds.max.x, bounds.max.y, bounds.max.z].map { |value| feature_bound_model_units(value) }
    }
  end

  def feature_base_bounds(entity)
    raw = entity.get_attribute('AlmaFeatures', 'base_bounds_json') if entity.respond_to?(:get_attribute)
    if raw && !raw.to_s.empty?
      parsed = JSON.parse(raw.to_s)
      return {
        min: feature_bound_tuple(parsed.fetch('min'), 'AlmaFeatures.base_bounds_json.min'),
        max: feature_bound_tuple(parsed.fetch('max'), 'AlmaFeatures.base_bounds_json.max')
      }
    end
    bounds = feature_bounds(entity)
    entity.set_attribute('AlmaFeatures', 'base_bounds_json', JSON.generate('min' => bounds[:min], 'max' => bounds[:max])) if entity.respond_to?(:set_attribute)
    bounds
  rescue JSON::ParserError, KeyError, ArgumentError
    feature_bounds(entity)
  end

  def feature_bound_tuple(value, field_name)
    raise "#{field_name} must contain three coordinates" unless value.is_a?(Array) && value.length == 3

    value.each_with_index.map { |item, index| feature_bound_model_units(item, "#{field_name}[#{index}]") }
  end

  def feature_bound_model_units(value, field_name = 'feature bound')
    number = value.to_f
    raise "#{field_name} must be numeric" unless number.finite?

    value.is_a?(String) && value.match?(/\bmm\b/i) ? mm_to_model_units(number) : number
  end

  def feature_center(value, bounds, spec, field_name)
    raise "#{field_name} must be [u, v] or [x, y, z]" unless value.is_a?(Array) && [2, 3].include?(value.length)

    numbers = value.each_with_index.map { |item, index| finite_number(item, "#{field_name}[#{index}]") }
    return numbers if numbers.length == 2

    spec[:axes].map { |axis| numbers[axis] - model_units_to_mm(bounds[:min][axis]) }
  end

  def validate_feature_fits(context, width, height, op_name)
    [width, height].each_with_index do |dimension, index|
      center = context[:center][index]
      extent = context[:extents][index]
      raise "#{op_name} feature footprint must fit inside target #{context[:face]} face bounds" if center - dimension / 2.0 < -1e-9 || center + dimension / 2.0 > extent + 1e-9
    end
  end

  def circle_profile(center, radius, segments)
    segments.times.map do |index|
      angle = Math::PI * 2.0 * index / segments
      [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)]
    end
  end

  def push_feature_profile(context, profile, depth_mm)
    points = profile.map { |u, v| feature_point(context, u, v) }
    face = context[:entity].entities.add_face(points)
    raise "Failed to create feature face on #{context[:entity].name}" unless face

    normal = Geom::Vector3d.new(*context[:spec][:normal])
    face.reverse! if face.normal.dot(normal) < 0
    face.pushpull(mm_to_model_units(depth_mm))
    face
  end

  def feature_point(context, u_mm, v_mm)
    spec = context[:spec]
    bounds = context[:bounds]
    coords = [0, 0, 0]
    coords[spec[:axes][0]] = bounds[:min][spec[:axes][0]] + mm_to_model_units(u_mm)
    coords[spec[:axes][1]] = bounds[:min][spec[:axes][1]] + mm_to_model_units(v_mm)
    coords[spec[:normal_axis]] = bounds[spec[:surface]][spec[:normal_axis]]
    Geom::Point3d.new(*coords)
  end

  def feature_payload(operation, context, op_name)
    {
      'op' => op_name,
      'id' => (operation['feature_id'] || operation['featureId'] || "#{context[:entity].name}_#{op_name}_#{entity_features(context[:entity]).length + 1}").to_s,
      'target_id' => entity_id(context[:entity]) || context[:entity].name,
      'target_name' => context[:entity].name,
      'face' => context[:face],
      'center' => context[:center]
    }
  end

  def record_feature_operation(entity, feature)
    features = entity_features(entity)
    features << feature
    entity.set_attribute('AlmaFeatures', 'operations_json', JSON.generate(features))
    entity
  end

  def entity_features(entity)
    return [] unless entity.respond_to?(:get_attribute)

    raw = entity.get_attribute('AlmaFeatures', 'operations_json')
    return [] if raw.nil? || raw.to_s.empty?

    parsed = JSON.parse(raw.to_s)
    parsed.is_a?(Array) ? parsed : []
  rescue JSON::ParserError
    []
  end

  def identity_transformation?(transformation)
    identity = Geom::Transformation.new.to_a
    transformation.to_a.each_with_index.all? { |value, index| (value - identity[index]).abs < 1e-9 }
  end
end
