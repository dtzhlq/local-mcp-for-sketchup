# frozen_string_literal: true

module AlmaSketchupMCP
  extend self

  # Without scene_ref this remains camera-only. Scene inspection is an explicit
  # controlled mutation and rejects unsaved style edits before switching.
  def capture_detail_views(params)
    model = active_model_required('capture_detail_views')
    requested = params['views']
    raise 'capture_detail_views.views must contain 1 to 24 views' unless requested.is_a?(Array) && (1..24).cover?(requested.length)
    directory = non_empty_string(params['output_dir'], 'capture_detail_views.output_dir').strip
    raise 'capture_detail_views.output_dir must be a local directory' if directory.match?(/\A[a-z][a-z0-9+.-]*:/i) && !directory.match?(/\A[a-z]:[\\\/]/i)
    raise 'capture_detail_views.output_dir contains invalid characters' if directory.match?(/[\0\r\n]/)
    directory = File.expand_path(directory)
    plans = requested.map { |spec| detail_capture_plan(model, spec, directory) }
    raise 'capture_detail_views view IDs must be unique' unless plans.map { |plan| plan[:id] }.uniq.length == plans.length
    scene_state = plans.any? { |plan| plan[:page] } ? detail_scene_restore_plan(model) : nil

    view = model.active_view
    camera_before = detail_camera_snapshot(view.camera)
    original_camera = detached_detail_camera(view.camera)
    state_before = detail_capture_state(model)
    revision_before = session_model_revision_report(model)
    camera_facing_before = detail_capture_camera_facing_state(model)
    modified_before = model.respond_to?(:modified?) ? model.modified? : nil
    facing_plan = detail_capture_facing_restore_plan(model, scene_state, revision_before, modified_before)
    captures = []
    FileUtils.mkdir_p(directory)
    begin
      model.options['PageOptions']['ShowTransition'] = false if scene_state
      plans.each do |plan|
        if plan[:page]
          model.pages.selected_page = plan[:page]
          raise "detail_scene_activation_failed: #{plan[:page].name}" unless model.pages.selected_page == plan[:page]
        end
        detail_capture_facing_step(model, facing_plan, plan[:camera], 'camera_assignment') { view.camera = plan[:camera] }
        detail_capture_facing_step(model, facing_plan, plan[:camera], 'refresh') { view.refresh }
        camera_at_capture = detail_camera_snapshot(view.camera)
        revision_at_capture = scene_state ? session_model_revision_report(model) : revision_before
        render_revision_before = session_model_revision_report(model)
        ok = detail_capture_facing_step(model, facing_plan, plan[:camera], 'write_image') do
          view.write_image(filename: plan[:path], width: plan[:width], height: plan[:height], antialias: true, compression: 1.0, transparent: false)
        end
        render_revision_after = session_model_revision_report(model)
        raise "detail_capture_failed: #{plan[:id]}" unless ok && File.file?(plan[:path])
        actual_size = detail_capture_png_size(plan[:path])
        raise "detail_capture_size_mismatch: #{plan[:id]}" unless actual_size == [plan[:width], plan[:height]]
        raise "detail_capture_camera_changed_during_capture: #{plan[:id]}" unless appearance_values_equal?(camera_at_capture, detail_camera_snapshot(view.camera))

        captures << {
          'id' => plan[:id], 'file_path' => plan[:path], 'width' => actual_size[0], 'height' => actual_size[1],
          'sha256' => Digest::SHA256.file(plan[:path]).hexdigest, 'camera' => camera_at_capture,
          'instance_path' => plan[:instance_path], 'bounds_mm' => plan[:bounds_mm],
          'native_appearance_signature' => native_appearance_snapshot(model)['signature'],
          'model_revision' => revision_at_capture['model_revision'], 'model_revision_complete' => revision_at_capture['complete'],
          'model_revision_binding' => scene_state ? 'scene_capture_revision' : 'restored_source_revision',
          'capture_model_revision_before_export' => render_revision_before['model_revision'],
          'capture_model_revision' => render_revision_after['model_revision'],
          'capture_model_revision_complete' => render_revision_after['complete'],
          'scene_ref' => plan[:page] ? plan[:page].name.to_s : nil,
          'native_appearance' => scene_state ? native_appearance_snapshot(model) : nil,
          'evidence' => 'native_view_write_image', 'captured_at' => Time.now.utc.iso8601,
          'capture_method' => 'standard_export', 'camera_stable_during_export' => true
        }
      end
    ensure
      # View#camera returns a live handle in SketchUp. Restore an independently
      # constructed camera; retaining the original handle loses its old pose.
      begin
        restore_detail_scene_state(model, scene_state) if scene_state
      ensure
        if facing_plan && !facing_plan[:failure]
          begin
            detail_capture_facing_step(model, facing_plan, original_camera, 'restore_camera') { view.camera = original_camera }
            detail_capture_facing_step(model, facing_plan, original_camera, 'restore_refresh') { view.refresh }
          rescue StandardError
            # A failed preservation check never prevents restoring the camera.
            # It does prevent all subsequent entity writes.
            view.camera = original_camera
          end
        else
          view.camera = original_camera
        end
        facing_recovery = restore_detail_capture_facing_instances(model, facing_plan)
        restoration = settle_detail_capture_restoration(model, view,
          camera_before: camera_before, state_before: state_before, revision_before: revision_before,
          modified_before: modified_before, scene_state: scene_state)
        restoration['camera_facing_recovery'] = facing_recovery
        restoration['restored'] &&= facing_recovery['status'] != 'refused' && facing_recovery['status'] != 'failed'
      end
    end
    restored = restoration.delete('restored')
    {
      'kind' => 'capture_detail_views', 'runtime' => 'queue', 'captures' => captures,
      'status' => restored ? 'captured_and_restored' : 'restoration_failed', 'restored' => restored,
      'capture_scope' => scene_state ? 'controlled_scene_inspection' : 'camera_only',
      'restoration' => restoration.merge('camera_facing_before' => camera_facing_before,
        'camera_facing_after' => detail_capture_camera_facing_state(model))
    }
  end

  # Restoring a camera handle is not proof that view-dependent native state has
  # settled. Force bounded redraws and require two consecutive complete matches
  # of the original model revision and every existing restoration condition.
  # This is the actual, unmodified revision algorithm, including every native
  # transform. The scoped guard below is never substituted for this check.
  def settle_detail_capture_restoration(model, view, camera_before:, state_before:, revision_before:, modified_before:, scene_state:)
    observations = []
    consecutive_matches = 0
    final = nil
    3.times do |attempt|
      view.refresh
      camera_after = detail_camera_snapshot(view.camera)
      state_after = detail_capture_state(model)
      revision_after = session_model_revision_report(model)
      modified_after = model.respond_to?(:modified?) ? model.modified? : nil
      camera_restored = appearance_values_equal?(camera_before, camera_after)
      native_state_restored = state_before == state_after
      revision_restored = revision_before['complete'] == true && revision_after['complete'] == true && revision_before['model_revision'] == revision_after['model_revision']
      display_restored = !scene_state || detail_scene_display_matches?(model, scene_state)
      matched = !!(camera_restored && native_state_restored && revision_restored && display_restored && (scene_state || modified_before == modified_after))
      consecutive_matches = matched ? consecutive_matches + 1 : 0
      observations << { 'attempt' => attempt + 1, 'model_revision' => revision_after['model_revision'],
        'model_revision_complete' => revision_after['complete'], 'all_conditions_matched' => matched }
      final = {
        'restored' => consecutive_matches >= 2,
        'camera_restored' => camera_restored, 'native_state_restored' => native_state_restored,
        'model_revision_restored' => revision_restored, 'display_state_restored' => display_restored,
        'camera_before' => camera_before, 'camera_after' => camera_after,
        'state_before' => state_before, 'state_after' => state_after,
        'model_revision_before' => revision_before['model_revision'], 'model_revision_after' => revision_after['model_revision'],
        'model_modified_before' => modified_before, 'model_modified_after' => modified_after,
        'model_modified_changed' => modified_before != modified_after,
        'stability' => { 'method' => 'bounded_native_redraw_and_strict_revision.v1',
          'max_attempts' => 3, 'required_consecutive_matches' => 2, 'consecutive_matches' => consecutive_matches,
          'observations' => observations }
      }
      break if final['restored']
    end
    final
  end

  # SketchUp can update an always-face-camera instance's native transform while
  # drawing without setting modified?. Camera restoration alone does not undo
  # that update. Pre-register the narrow native case we can restore exactly;
  # nested, locked, glued and non-planar instances remain unsupported.
  def detail_capture_facing_restore_plan(model, scene_state, revision_before, modified_before)
    return nil unless model.respond_to?(:definitions)
    candidates = model.definitions.flat_map do |definition|
      next [] unless definition.respond_to?(:behavior) && definition.behavior.respond_to?(:always_face_camera?) && definition.behavior.always_face_camera?
      definition.instances.to_a
    end
    return nil if candidates.empty?
    raise 'detail_capture_camera_facing_unsupported: scene inspection' if scene_state
    raise 'detail_capture_camera_facing_unsupported: incomplete revision or modified state' unless revision_before['complete'] == true && [true, false].include?(modified_before)
    raise 'detail_capture_camera_facing_unsupported: instance limit' if candidates.length > 32
    roots = model.entities.to_a
    records = candidates.map do |instance|
      pid = entity_persistent_id(instance).to_s
      supported = instance.is_a?(Sketchup::ComponentInstance) && !instance.is_a?(Sketchup::Group) &&
        roots.include?(instance) && instance.respond_to?(:parent) && instance.respond_to?(:move!) &&
        instance.respond_to?(:locked?) && !instance.locked? && instance.respond_to?(:glued_to) && instance.glued_to.nil? &&
        instance.respond_to?(:valid?) && instance.valid? && pid.match?(/\A[1-9][0-9]*\z/) &&
        roots.count { |entry| entity_persistent_id(entry).to_s == pid } == 1
      matrix = revision_local_transformation(instance)
      raise 'detail_capture_camera_facing_unsupported: requires a unique, unlocked, unglued root instance with planar positive axes' unless supported && detail_capture_planar_facing_matrix?(matrix)
      { entity: instance, persistent_id: pid, definition: instance.definition, parent: instance.parent,
        original: matrix.dup.freeze, observed: matrix.dup, changes: 0 }
    end
    raise 'detail_capture_camera_facing_unsupported: duplicate native instance' unless records.map { |entry| entry[:entity].object_id }.uniq.length == records.length
    plan = { records: records, modified: modified_before, failure: nil, observations: [] }
    plan[:preservation_signature] = detail_capture_facing_preservation_signature(model, records)
    plan
  end

  def detail_capture_planar_facing_matrix?(matrix)
    return false unless matrix.is_a?(Array) && matrix.length == 16 && matrix.all? { |value| value.is_a?(Numeric) && value.finite? }
    return false unless [2, 3, 6, 7, 8, 9, 11].all? { |index| matrix[index] == 0 } && matrix[15] == 1 && matrix[10].positive?
    x_length = Math.hypot(matrix[0], matrix[1])
    y_length = Math.hypot(matrix[4], matrix[5])
    x_length.positive? && y_length.positive? && matrix[0] * matrix[5] - matrix[1] * matrix[4] > 0 &&
      (matrix[0] * matrix[4] + matrix[1] * matrix[5]).abs <= x_length * y_length * 1e-12
  end

  def detail_capture_expected_facing_rotation?(original, current, camera)
    return false unless detail_capture_planar_facing_matrix?(current)
    return false unless ((0...16).to_a - [0, 1, 4, 5]).all? { |index| original[index] == current[index] }
    dx = camera.eye.x.to_f - camera.target.x.to_f
    dy = camera.eye.y.to_f - camera.target.y.to_f
    length = Math.hypot(dx, dy)
    return false unless length.positive?
    original_x = Math.hypot(original[0], original[1])
    original_y = Math.hypot(original[4], original[5])
    expected = [-dy / length * original_x, dx / length * original_x, -dx / length * original_y, -dy / length * original_y]
    current.values_at(0, 1, 4, 5).zip(expected).all? { |actual, target| (actual - target).abs <= [1.0, target.abs].max * 1e-12 }
  end

  # A separate, internal preservation guard, never a model revision. It hashes
  # the same native model metadata and exact entity/definition payloads used by
  # the revision code. Only the pre-registered root matrices are substituted;
  # definitions, geometry, other transforms, attributes and membership are not.
  # This check must pass BEFORE any restorative move!, not just afterwards.
  def detail_capture_facing_preservation_signature(model, records)
    model_snapshot = snapshot(model, include_detail_evidence: false)
    state = {
      'unique_entity_limit' => MODEL_REVISION_UNIQUE_ENTITY_LIMIT, 'unique_entities' => 0,
      'reachable_definitions' => 0, 'definition_reports' => {}, 'definition_keys_by_object' => {},
      'definition_objects_by_key' => {}, 'classification_schemas' => model_snapshot['classification_schemas'] || [],
      'native_classification_by_definition' => {}, 'complete' => true, 'blockers' => []
    }
    # Run the ordinary traversal first, including its identity, recursion and
    # coverage checks. Reuse its child-definition reports for the scoped root
    # payload so the guard does not traverse every definition twice.
    revision_entities_report(model.entities, state, [])
    raise 'detail_capture_camera_facing_guard_incomplete' unless state['complete'] == true
    enrolled = records.to_h { |record| [record[:entity].object_id, record] }
    entries = model.entities.to_a.select { |entity| selectable_entity?(entity) }.sort_by { |entity| revision_entity_sort_key(entity) }.map do |entity|
      payload = revision_entity_payload(entity, revision_child_definition_report(entity, state, []))
      payload['local_transformation'] = 'registered_camera_facing_matrix' if enrolled.key?(entity.object_id)
      [entity.object_id, entity.respond_to?(:parent) ? entity.parent.object_id : nil, payload]
    end
    raise 'detail_capture_camera_facing_guard_incomplete' unless state['complete'] == true
    source = %w[totals materials native_appearance tags scenes section_planes classification_schemas component_definition_summaries image_references].to_h { |key| [key, model_snapshot[key]] }
    source['entities'] = entries
    source['definitions'] = model.definitions.map do |definition|
      behavior = definition.respond_to?(:behavior) ? definition.behavior : nil
      [definition.object_id, entity_persistent_id(definition), definition.name.to_s,
       entity_attributes(definition), behavior && behavior.respond_to?(:always_face_camera?) ? behavior.always_face_camera? : nil]
    end.sort_by(&:first)
    source['model_attributes'] = entity_attributes(model)
    Digest::SHA256.hexdigest(revision_json(source))
  end

  def detail_capture_facing_assert_preserved!(model, plan)
    raise "detail_capture_camera_facing_refused: #{plan[:failure]}" if plan[:failure]
    roots = model.entities.to_a
    plan[:records].each do |record|
      instance = record[:entity]
      unchanged_identity = instance.valid? && roots.include?(instance) && instance.parent.equal?(record[:parent]) &&
        instance.definition.equal?(record[:definition]) && entity_persistent_id(instance).to_s == record[:persistent_id] &&
        roots.count { |entry| entity_persistent_id(entry).to_s == record[:persistent_id] } == 1 &&
        !instance.locked? && instance.glued_to.nil? && instance.definition.behavior.always_face_camera?
      raise 'native_instance_identity_changed' unless unchanged_identity
    end
    raise 'model_modified_changed' unless model.modified? == plan[:modified]
    raise 'non_camera_facing_model_state_changed' unless detail_capture_facing_preservation_signature(model, plan[:records]) == plan[:preservation_signature]
  end

  def detail_capture_facing_step(model, plan, camera, phase)
    return yield unless plan
    begin
      detail_capture_facing_assert_preserved!(model, plan)
      raise 'matrix_changed_outside_controlled_draw' unless plan[:records].all? { |record| revision_local_transformation(record[:entity]) == record[:observed] }
    rescue StandardError => error
      plan[:failure] ||= error.message
      raise
    end
    begin
      yield
    ensure
      begin
        detail_capture_facing_assert_preserved!(model, plan)
        changes = []
        plan[:records].each do |record|
          current = revision_local_transformation(record[:entity])
          next if current == record[:observed]
          raise 'matrix_change_not_expected_camera_rotation' unless detail_capture_expected_facing_rotation?(record[:original], current, camera)
          changes << [record, current]
        end
        changes.each do |record, matrix|
          record[:observed] = matrix.dup
          record[:changes] += 1
        end
        plan[:observations] << { 'phase' => phase, 'changed_instances' => changes.length }
      rescue StandardError => error
        plan[:failure] ||= error.message
        raise
      end
    end
  end

  def restore_detail_capture_facing_instances(model, plan)
    return { 'status' => 'not_needed', 'restored_instances' => 0 } unless plan
    restored = 0
    attempted = 0
    native_writes = []
    begin
      detail_capture_facing_assert_preserved!(model, plan)
      # Check every target before the first native write. A changed matrix may
      # have been a real edit after export, even when it is also a pure yaw.
      raise 'matrix_changed_outside_controlled_draw' unless plan[:records].all? { |record| revision_local_transformation(record[:entity]) == record[:observed] }
      plan[:records].each do |record|
        next if record[:observed] == record[:original]
        raise 'camera_rotation_not_observed' unless record[:changes].positive?
        detail_capture_facing_assert_preserved!(model, plan)
        raise 'matrix_changed_before_restore' unless revision_local_transformation(record[:entity]) == record[:observed]
        # move! assigns an absolute transform without adding an undo operation.
        # Its return value, exact readback and modified? are all checked; there
        # is no undo/abort assumption, retry, behavior toggle or dirty-flag reset.
        attempted += 1
        ok = record[:entity].move!(Geom::Transformation.new(record[:original]))
        immediate = revision_local_transformation(record[:entity])
        native_writes << { 'persistent_id' => record[:persistent_id], 'return_class' => ok.class.name,
          'return_value' => [true, false, nil].include?(ok) || ok.is_a?(Numeric) ? ok : ok.to_s.each_char.take(160).join,
          'returned_same_instance' => ok.equal?(record[:entity]),
          'exact_readback' => immediate == record[:original],
          'expected_transformation' => record[:original], 'immediate_transformation' => immediate }
        # The public API documents Boolean. The controlled macOS SketchUp 2026
        # v4 diagnostic returned the very same native ComponentInstance instead.
        # Accept only that exact receiver as the observed compatibility case;
        # truthy values, other instances, nil and false remain failures.
        acknowledged = ok == true || ok.equal?(record[:entity])
        raise 'native_matrix_restore_failed' unless acknowledged && immediate == record[:original]
        restored += 1
        record[:observed] = record[:original].dup
      end
      detail_capture_facing_assert_preserved!(model, plan)
      { 'status' => restored.positive? ? 'restored_exact_native_matrices' : 'not_needed',
        'restored_instances' => restored, 'observations' => plan[:observations], 'native_writes' => native_writes }
    rescue StandardError => error
      { 'status' => attempted.positive? ? 'failed' : 'refused', 'restored_instances' => restored,
        'reason' => error.message, 'observations' => plan[:observations], 'native_writes' => native_writes }
    end
  end

  # Diagnostic only. The full revision gate above remains authoritative; this
  # bounded native read helps distinguish camera-facing placement drift from a
  # real edit without ignoring either or changing component behavior.
  def detail_capture_camera_facing_state(model)
    return { 'complete' => true, 'instances' => [] } unless model.respond_to?(:definitions)
    instances = []
    model.definitions.each do |definition|
      next unless definition.respond_to?(:behavior) && definition.behavior.respond_to?(:always_face_camera?) && definition.behavior.always_face_camera?
      definition.instances.each do |instance|
        return { 'complete' => false, 'limit' => 32, 'instances' => instances } if instances.length >= 32
        instances << { 'persistent_id' => entity_persistent_id(instance),
          'definition' => definition.name.to_s, 'transformation' => instance.transformation.to_a }
      end
    end
    { 'complete' => true, 'instances' => instances }
  rescue StandardError => error
    { 'complete' => false, 'error' => error.class.name, 'instances' => instances || [] }
  end

  def detached_detail_camera(camera)
    if camera.respond_to?(:is_2d?) && camera.is_2d?
      raise 'Detail capture cannot restore a two-point perspective or PhotoMatch camera through the public Ruby API; use a standard perspective or orthographic view.'
    end
    copy = Sketchup::Camera.new(
      Geom::Point3d.new(*camera.eye.to_a), Geom::Point3d.new(*camera.target.to_a),
      Geom::Vector3d.new(*camera.up.to_a), camera.perspective?
    )
    copy.aspect_ratio = camera.aspect_ratio
    copy.image_width = camera.image_width if camera.respond_to?(:image_width) && copy.respond_to?(:image_width=)
    copy.description = camera.description if camera.respond_to?(:description) && copy.respond_to?(:description=)
    camera.perspective? ? copy.fov = camera.fov : copy.height = camera.height
    copy
  end

  def detail_capture_plan(model, spec, directory)
    raise 'capture_detail_views view must be an object' unless spec.is_a?(Hash)
    unknown = spec.keys - %w[id name kind target_id instance_path eye target up projection min_width min_height width height camera scene_ref]
    raise "capture_detail_views unsupported view fields: #{unknown.join(', ')}" unless unknown.empty?
    if spec.key?('camera')
      source_camera = spec['camera']
      raise 'capture_detail_views.camera must be an object' unless source_camera.is_a?(Hash)
      raise 'capture_detail_views.camera contains unsupported fields' unless (source_camera.keys - %w[eye target up projection fov]).empty?
      spec = source_camera.merge(spec.reject { |key, _| key == 'camera' })
    end
    id = non_empty_string(spec['id'], 'capture_detail_views.view.id')
    raise 'capture_detail_views view.id must be a safe filename token' unless id.match?(/\A[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\z/)
    width = [positive_integer(spec['width'] || 1280, 'capture_detail_views.width'), positive_integer(spec['min_width'] || 64, 'capture_detail_views.min_width')].max
    height = [positive_integer(spec['height'] || 960, 'capture_detail_views.height'), positive_integer(spec['min_height'] || 64, 'capture_detail_views.min_height')].max
    raise 'capture_detail_views image dimensions must be between 64 and 4096' unless [width, height].all? { |value| (64..4096).cover?(value) }
    target_path = File.join(directory, "#{id}.png")
    raise "capture_detail_views output already exists: #{target_path}" if File.exist?(target_path)
    page = nil
    if spec.key?('scene_ref')
      reference = non_empty_string(spec['scene_ref'], 'capture_detail_views.scene_ref')
      matches = model.pages.select { |entry| entry.name.to_s == reference }
      raise "capture_detail_views.scene_ref must resolve uniquely: #{reference}" unless matches.length == 1
      page = matches.first
    end
    projection = spec['projection'] || 'perspective'
    raise 'capture_detail_views projection must be perspective or orthographic' unless %w[perspective orthographic].include?(projection)
    bounds = detail_capture_bounds(model, spec['instance_path'])
    explicit = spec.key?('eye') || spec.key?('target')
    raise 'capture_detail_views requires eye and target together' if explicit && !(spec.key?('eye') && spec.key?('target'))
    radius = [bounds.diagonal.to_f / 2.0, mm_to_model_units(1)].max
    aspect = width.to_f / height
    if explicit
      eye_values = detail_capture_vector(spec['eye'], 'eye')
      target_values = detail_capture_vector(spec['target'], 'target')
      eye = Geom::Point3d.new(*eye_values.map { |value| mm_to_model_units(value) })
      target = Geom::Point3d.new(*target_values.map { |value| mm_to_model_units(value) })
    else
      target = bounds.center
      half_angle = Math.atan(Math.tan(15 * Math::PI / 180) * [aspect, 1.0 / aspect, 1.0].min)
      distance = radius / Math.sin(half_angle) * 1.2
      direction = [1.0, -1.0, 0.8]
      scale = distance / Math.sqrt(direction.sum { |value| value * value })
      eye = Geom::Point3d.new(target.x + scale, target.y - scale, target.z + scale * 0.8)
    end
    up_values = detail_capture_vector(spec['up'] || [0, 0, 1], 'up')
    direction = [target.x - eye.x, target.y - eye.y, target.z - eye.z]
    cross = [direction[1] * up_values[2] - direction[2] * up_values[1], direction[2] * up_values[0] - direction[0] * up_values[2], direction[0] * up_values[1] - direction[1] * up_values[0]]
    raise 'capture_detail_views eye/target/up must define a valid camera' if cross.sum { |value| value * value } < 1e-16
    fov = spec.key?('fov') ? number_in_range(spec['fov'], 1, 120, 'capture_detail_views.camera.fov') : 30.0
    camera = Sketchup::Camera.new(eye, target, Geom::Vector3d.new(*up_values), projection == 'perspective', fov)
    camera.aspect_ratio = aspect
    camera.height = radius * 2.4 / [aspect, 1.0].min if projection == 'orthographic'
    camera = detached_detail_camera(page.camera) if page && !explicit
    camera.aspect_ratio = aspect
    { id: id, path: target_path, width: width, height: height, camera: camera, page: page,
      instance_path: spec['instance_path'], bounds_mm: bounds_hash(bounds) }
  end

  def detail_scene_restore_plan(model, validate = true)
    raise 'scene_capture_unsaved_style: save the active style before scene inspection' if validate && model.styles.active_style_changed
    page = model.pages.selected_page
    raise 'scene_capture_no_selected_page: select a scene before scene inspection' unless page
    environment = model.respond_to?(:environments) ? model.environments.current : nil
    if model.respond_to?(:environments) && !environment && !native_environment_clear_supported?
      raise 'scene_capture_environment_restore_unsupported: SketchUp 2025.0.2 or newer is required'
    end
    options = model.options['PageOptions']
    raise 'scene_capture_transition_control_unsupported' unless options && options.keys.include?('ShowTransition')
    collections = [model.entities] + model.definitions.map(&:entities)
    drawing_elements = collections.flat_map(&:to_a).select { |entity| entity.respond_to?(:hidden?) && entity.respond_to?(:hidden=) }.uniq
    {
      page: page, style: model.styles.selected_style, environment: environment,
      transition: options['ShowTransition'],
      rendering: model.rendering_options.keys.to_h { |key| [key, model.rendering_options[key]] },
      shadow: model.shadow_info.keys.to_h { |key| [key, model.shadow_info[key]] },
      layers: model.layers.map { |layer| [layer, layer.visible?] },
      hidden: drawing_elements.map { |entity| [entity, entity.hidden?] },
      sections: collections.map { |entities| [entities, entities.active_section_plane] },
      axes: model.respond_to?(:axes) ? [model.axes.origin, model.axes.xaxis, model.axes.yaxis, model.axes.zaxis] : nil
    }
  end

  def restore_detail_scene_state(model, state)
    errors = []
    attempt = lambda do |label, &action|
      action.call
    rescue StandardError => error
      errors << "#{label}: #{error.message}"
    end
    attempt.call('scene') { model.pages.selected_page = state[:page] }
    attempt.call('style') { model.styles.selected_style = state[:style] }
    attempt.call('environment') { model.environments.current = state[:environment] } if model.respond_to?(:environments)
    state[:rendering].each do |key, value|
      attempt.call("rendering.#{key}") { model.rendering_options[key] = value unless detail_capture_value(model.rendering_options[key]) == detail_capture_value(value) }
    end
    # Derived sun fields are read-only. Restore their inputs, then compare all
    # getters (including derived values) in detail_scene_display_matches?.
    state[:shadow].each do |key, value|
      next if %w[SunDirection SunRise SunRise_time_t SunSet SunSet_time_t DayOfYear ShadowTime_time_t].include?(key)
      attempt.call("shadow.#{key}") { model.shadow_info[key] = value unless detail_capture_value(model.shadow_info[key]) == detail_capture_value(value) }
    end
    state[:layers].each { |layer, visible| attempt.call('layer') { layer.visible = visible unless layer.visible? == visible } }
    state[:hidden].each { |entity, hidden| attempt.call('hidden') { entity.hidden = hidden unless entity.hidden? == hidden } }
    state[:sections].each { |entities, plane| attempt.call('section') { entities.active_section_plane = plane unless entities.active_section_plane == plane } }
    if state[:axes]
      current_axes = [model.axes.origin, model.axes.xaxis, model.axes.yaxis, model.axes.zaxis]
      attempt.call('axes') { model.axes.set(*state[:axes]) unless detail_capture_value(current_axes) == detail_capture_value(state[:axes]) }
    end
    attempt.call('transition') { model.options['PageOptions']['ShowTransition'] = state[:transition] }
    raise "scene_capture_restoration_failed: #{errors.join('; ')}" unless errors.empty?
  end

  def detail_scene_display_matches?(model, state)
    current = detail_scene_restore_plan(model, false)
    %i[page style environment transition].all? { |key| current[key] == state[key] } &&
      %i[rendering shadow].all? { |key| current[key].keys == state[key].keys && current[key].all? { |name, value| detail_capture_value(value) == detail_capture_value(state[key][name]) } } &&
      %i[layers hidden sections].all? { |key| current[key] == state[key] } &&
      detail_capture_value(current[:axes]) == detail_capture_value(state[:axes])
  end

  def detail_capture_vector(value, field)
    raise "capture_detail_views.#{field} must be three finite numbers" unless value.is_a?(Array) && value.length == 3 && value.all? { |item| item.is_a?(Numeric) && item.finite? }
    value
  end

  def detail_capture_bounds(model, path)
    return model.bounds if path.nil? && model.bounds.valid?
    raise 'capture_detail_views requires valid model bounds or an instance_path' if path.nil?
    raise 'capture_detail_views.instance_path must contain 1 to 64 IDs' unless path.is_a?(Array) && (1..64).cover?(path.length)
    entities = model.entities
    transform = Geom::Transformation.new
    leaf = nil
    path.each do |reference|
      raise 'capture_detail_views.instance_path IDs must be strings' unless reference.is_a?(String) && !reference.empty?
      matches = entities.select do |entity|
        next false unless entity.is_a?(Sketchup::Group) || entity.is_a?(Sketchup::ComponentInstance)
        [entity_id(entity), entity.name, entity.persistent_id.to_s, "pid:#{entity.persistent_id}"].include?(reference)
      end
      raise "capture_detail_views.instance_path must resolve uniquely: #{reference}" unless matches.length == 1
      leaf = matches.first
      raise "capture_detail_views.instance_path is hidden: #{reference}" if leaf.hidden? || (leaf.layer && !leaf.layer.visible?)
      transform *= leaf.transformation
      entities = leaf.definition.entities
    end
    bounds = Geom::BoundingBox.new
    local = leaf.definition.bounds
    raise 'capture_detail_views target bounds are empty' unless local.valid?
    8.times { |index| bounds.add(local.corner(index).transform(transform)) }
    bounds
  end

  def detail_camera_snapshot(camera)
    result = camera_snapshot(camera)
    %w[perspective? aspect_ratio fov_is_height? is_2d?].each { |key| result[key.delete('?')] = camera.public_send(key) if camera.respond_to?(key) }
    result['height_mm'] = model_units_to_mm(camera.height) if camera.respond_to?(:perspective?) && !camera.perspective? && camera.respond_to?(:height)
    %w[center_2d scale_2d].each { |key| result[key] = detail_capture_value(camera.public_send(key)) if camera.respond_to?(key) }
    result
  end

  def detail_capture_state(model)
    page = model.respond_to?(:pages) && model.pages.respond_to?(:selected_page) ? model.pages.selected_page : nil
    result = { 'native_appearance_signature' => native_appearance_snapshot(model)['signature'], 'selected_page' => page ? page.name.to_s : nil }
    if model.respond_to?(:shadow_info)
      result['shadow_info'] = model.shadow_info.keys.sort.each_with_object({}) { |key, state| state[key] = detail_capture_value(model.shadow_info[key]) }
    end
    result
  end

  def detail_capture_value(value)
    return value.utc.iso8601(6) if value.is_a?(Time)
    return value.map { |item| detail_capture_value(item) } if value.is_a?(Array)
    return [value.x.to_f, value.y.to_f, value.z.to_f] if value.respond_to?(:x) && value.respond_to?(:y) && value.respond_to?(:z)
    return [value.red, value.green, value.blue, value.alpha] if value.respond_to?(:red) && value.respond_to?(:alpha)
    value
  end

  def detail_capture_png_size(path)
    header = File.binread(path, 24)
    raise 'detail_capture_invalid_png' unless header.byteslice(0, 8) == "\x89PNG\r\n\x1A\n".b && header.byteslice(12, 4) == 'IHDR'
    header.byteslice(16, 8).unpack('NN')
  end
end
