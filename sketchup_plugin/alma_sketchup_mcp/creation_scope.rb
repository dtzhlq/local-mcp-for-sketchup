# frozen_string_literal: true

module AlmaSketchupMCP
  extend self

  # Invoke inside with_atomic_model_transaction and before applying any operation.
  # This validates actual runtime absence, including unused named resources. Scope
  # is never a cross-request permission or a substitute for the Session Contract.
  def validate_creation_scope!(model, document)
    scope = document['creation_scope']
    return unless scope

    reject = lambda { |reason| raise "Creation scope rejected: #{reason}" }
    reject.call('invalid contract') unless scope['version'] == 'creation-scope.v1' && scope['namespace'].to_s.match?(/\Aalma_[0-9a-f]{20}_\z/)
    reference = scope['definition_references']
    reused = []
    used_references = []
    if reference
      reject.call('invalid immutable definition references') unless reference.is_a?(Hash) && reference.keys.sort == %w[model_revision names version] && reference['version'] == 'immutable-definition-references.v1' && reference['model_revision'].to_s.match?(/\Asha256:[0-9a-f]{64}\z/)
      reused = reference['names']
      reject.call('invalid immutable definition names') unless reused.is_a?(Array) && !reused.empty? && reused.length <= 50_000 && reused.uniq.length == reused.length && reused.all? { |name| name.is_a?(String) && !name.empty? }
      reject.call('immutable definition missing') unless reused.all? { |name| model.definitions[name] }
      revision = session_model_revision_report(model)
      reject.call('immutable definition revision mismatch') unless revision['complete'] == true && revision['model_revision'] == reference['model_revision']
    end
    namespace = scope['namespace']
    host_metadata = scope['host_metadata']
    metadata_operations = %w[attribute tag assign_tag]
    definitions = []
    materials = []
    cuts = %w[cut_hole cut_slot cut_recess]
    cut_hosts = %w[box rounded_box beveled_panel panel_with_openings]
    forbidden = %w[reset tag image_reference camera scene style shadow rendering_options selection material_preset kitchen_component fixture_embed presentation_camera]
    targets = %w[target_id targetId target object entity_path entityPath target_path targetPath edit_scope editScope instance_policy instancePolicy instance_id instanceId confirmed]
    material_fields = %w[material back_material backMaterial front_material frontMaterial f_material b_material frame_material frameMaterial panel_material panelMaterial hole_material holeMaterial]
    inspect_materials = nil
    inspect_materials = lambda do |value|
      if value.is_a?(Array)
        value.each { |item| inspect_materials.call(item) }
      elsif value.is_a?(Hash)
        # These explicitly declared inert dictionaries are not material specs.
        # Their complete literal-only schema and target closure are checked below.
        next if host_metadata && metadata_operations.include?(value['op'])
        value.each do |key, item|
          if material_fields.include?(key)
            reject.call('inline mutable material') if item.is_a?(Hash)
            reject.call('material references must be strings') unless item.nil? || item.is_a?(String)
            if item.is_a?(String) && !Array(scope['materials']).include?(item) && !model.materials[item]
              reject.call("material is neither declared nor already present: #{item}")
            end
          end
          inspect_materials.call(item)
        end
      end
    end
    inspect_materials.call(document['operations'])
    root_objects = []
    visit = nil
    visit = lambda do |operations, nested|
      reject.call('operations must be an array') unless operations.is_a?(Array)
      objects = {}
      operations.each do |operation|
        reject.call('invalid operation') unless operation.is_a?(Hash)
        op = operation['op']
        name = operation['name']
        if host_metadata && metadata_operations.include?(op)
          reject.call('host metadata must be top-level') if nested
          next
        end
        if op == 'material'
          reject.call('material must be a fresh top-level resource') if nested || !name.to_s.start_with?(namespace) || materials.include?(name) || model.materials[name]
          materials << name
          next
        end
        if op == 'component_definition'
          reject.call('definition must be a fresh top-level resource') if nested || !name.to_s.start_with?(namespace) || definitions.include?(name) || reused.include?(name) || model.definitions[name]
          reject.call('mutable definition material') if operation['material'].is_a?(Hash)
          visit.call(operation['operations'] || [], true)
          definitions << name
          next
        end
        if cuts.include?(op)
          host = objects[operation['target_id']]
          reject.call('cut target must be an earlier untransformed local Group') if nested || !host || !cut_hosts.include?(host['op']) || host['transform']
          reject.call('cut aliases are forbidden') if targets.any? { |key| key != 'target_id' && operation.key?(key) }
          next
        end
        # Creation allowlist is independent of the full registry: no existing edit
        # becomes allowed merely because it has a registered dispatch handler.
        allowed = %w[box rounded_box beveled_panel fillet chamfer recess engraved_line text_emboss text_engrave text_3d slot slot_array rib standoff_boss button_on_panel prism panel_with_openings boolean_cutout face_with_holes profile_extrude mesh geometry_input curve arc_curve gable_roof shed_roof cylinder loft_between_profiles shell_from_front_side_profiles lofted_solid face_on_cylinder analog_stick screw_hole pipe_between_points swept_path domed_surface bowed_panel floor_slab footprint_slab wall wall_path curved_wall roof_footprint hip_roof parapet_path curtain_wall column_grid path_surface terrain_mesh parking_stall_array door window stairs railing component_instance room]
        reject.call("unsupported operation #{op}") if forbidden.include?(op) || !allowed.include?(op)
        reject.call('existing references or hidden operations') if targets.any? { |key| operation.key?(key) } || operation.key?('operations')
        reject.call('inline mutable material') if material_fields.any? { |key| operation[key].is_a?(Hash) }
        if op == 'component_instance' && !definitions.include?(operation['definition'])
          reject.call('instance references an undeclared or forward definition') unless reused.include?(operation['definition'])
          used_references << operation['definition']
        end
        id = operation['id']
        reject.call('fresh unique object id required') unless id.to_s.start_with?(namespace) && !objects.key?(id)
        objects[id] = operation
        root_objects << operation unless nested
      end
    end
    visit.call(document['operations'], false)
    reject.call('unused definition reference') unless (reused - used_references).empty?
    validate_creation_host_metadata!(model, document, root_objects, reject)
    reject.call('resource declaration mismatch') unless definitions == scope['definitions'] && materials == scope['materials']
    model.entities.each do |entity|
      next unless entity.respond_to?(:name)
      id = entity.respond_to?(:get_attribute) ? entity.get_attribute('AlmaSketchupMCP', 'id') : nil
      reject.call('root object already exists') if root_objects.any? { |operation| operation['id'] == id || operation['name'] == entity.name }
    end
    true
  end

  # This validates closure and literal values, not identity. Host authorization
  # remains the server-private packet/brand plus guarded build authority; a
  # declaration by itself never grants permission to alter existing objects.
  def validate_creation_host_metadata!(model, document, root_objects, reject)
    scope = document['creation_scope']
    declaration = scope['host_metadata']
    return unless declaration

    metadata_ops = %w[attribute tag assign_tag]
    exact_keys = lambda do |value, allowed|
      reject.call('unexpected host metadata fields') unless value.is_a?(Hash) && (value.keys - allowed).empty? && (allowed - value.keys).empty?
    end
    exact_keys.call(declaration, %w[version root_ids tags])
    reject.call('invalid host metadata version') unless declaration['version'] == 'new-root-metadata.v1'
    valid_list = lambda do |items|
      items.is_a?(Array) && items.length <= 12 && items.all? { |id| id.is_a?(String) && id.start_with?(scope['namespace']) } && items.uniq.length == items.length
    end
    roots = declaration['root_ids']
    tags = declaration['tags']
    reject.call('invalid host metadata roots or tags') unless valid_list.call(roots) && !roots.empty? && valid_list.call(tags)
    tag_pattern = /\A#{Regexp.escape(scope['namespace'])}tag_[0-9a-f]{16}\z/
    reject.call('host tag must use its exact task namespace and 16-hex suffix') unless tags.all? { |name| name.match?(tag_pattern) }
    actual_roots = root_objects.map { |operation| operation['id'] }
    reject.call('metadata root is not created in this transaction') unless (roots - actual_roots).empty?

    # Match the real target resolver's candidate scope, including adopted IDs
    # and the current editing context. A namespace is not absence evidence.
    collections = [model.entities]
    collections << model.active_entities if model.respond_to?(:active_entities)
    collections.compact.uniq.each do |entities|
      entities.each do |entity|
        ids = []
        if entity.respond_to?(:get_attribute)
          ids << entity.get_attribute('AlmaSketchupMCP', 'id')
          ids << entity.get_attribute('AlmaSketchupMCP', 'adopted_id')
        end
        ids << entity.persistent_id.to_s if entity.respond_to?(:persistent_id)
        reject.call('metadata root reference already exists') if ids.compact.any? { |id| roots.include?(id.to_s) }
      end
    end
    unless tags.empty?
      reject.call('native tag inventory unavailable') unless model.respond_to?(:layers) && model.layers.respond_to?(:each)
      existing_names = []
      model.layers.each { |layer| existing_names << layer.name.to_s }
      reject.call('host tag already exists') if tags.any? { |name| existing_names.include?(name) || model.layers[name] }
    end
    seen_roots = []
    created_tags = []
    document['operations'].each do |operation|
      op = operation['op']
      unless metadata_ops.include?(op)
        seen_roots << operation['id'] if actual_roots.include?(operation['id'])
        next
      end
      if op == 'tag'
        exact_keys.call(operation, %w[op name visible])
        name = operation['name']
        reject.call('host tag must be declared once and visible') unless tags.include?(name) && !created_tags.include?(name) && operation['visible'] == true
        created_tags << name
        next
      end
      target = operation['target_id']
      reject.call('metadata target must be an earlier new root') unless roots.include?(target) && seen_roots.include?(target)
      if op == 'attribute'
        exact_keys.call(operation, %w[op target_id dictionary attributes])
        reject.call('host dictionary must be an explicit inert fixture dictionary') unless %w[BenchmarkFixture BenchmarkManualEdit].include?(operation['dictionary'])
        attributes = operation['attributes']
        reject.call('host attributes require 1..32 literal entries') unless attributes.is_a?(Hash) && attributes.length.between?(1, 32)
        attributes.each do |key, value|
          reject.call('invalid host attribute key') unless key.is_a?(String) && key.match?(/\A[A-Za-z][A-Za-z0-9_]{0,63}\z/) && !%w[__proto__ constructor prototype].include?(key)
          literal = value.nil? || value == true || value == false ||
            ((value.is_a?(Integer) || value.is_a?(Float)) && value.to_f.finite?) ||
            (value.is_a?(String) && value.encode('UTF-16LE').bytesize <= 4096)
          reject.call('host attributes must be finite scalar literals') unless literal
        end
      else
        exact_keys.call(operation, %w[op target_id tag])
        reject.call('host assignment must use an earlier new tag') unless created_tags.include?(operation['tag'])
      end
    end
    reject.call('declared host tag has no creation operation') unless created_tags.length == tags.length
    true
  end
end
