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
    namespace = scope['namespace']
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
        if op == 'material'
          reject.call('material must be a fresh top-level resource') if nested || !name.to_s.start_with?(namespace) || materials.include?(name) || model.materials[name]
          materials << name
          next
        end
        if op == 'component_definition'
          reject.call('definition must be a fresh top-level resource') if nested || !name.to_s.start_with?(namespace) || definitions.include?(name) || model.definitions[name]
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
        reject.call('instance references an existing or forward definition') if op == 'component_instance' && !definitions.include?(operation['definition'])
        id = operation['id']
        reject.call('fresh unique object id required') unless id.to_s.start_with?(namespace) && !objects.key?(id)
        objects[id] = operation
        root_objects << operation unless nested
      end
    end
    visit.call(document['operations'], false)
    reject.call('resource declaration mismatch') unless definitions == scope['definitions'] && materials == scope['materials']
    model.entities.each do |entity|
      next unless entity.respond_to?(:name)
      id = entity.respond_to?(:get_attribute) ? entity.get_attribute('AlmaSketchupMCP', 'id') : nil
      reject.call('root object already exists') if root_objects.any? { |operation| operation['id'] == id || operation['name'] == entity.name }
    end
    true
  end
end
