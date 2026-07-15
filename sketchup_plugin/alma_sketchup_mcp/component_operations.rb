# frozen_string_literal: true

module AlmaSketchupMCP
  extend self

  def add_component_definition(model, operation)
    name = operation.fetch('name')
    definition = model.definitions[name] || model.definitions.add(name)
    definition.entities.clear!

    if operation.key?('operations')
      operations = operation['operations']
      raise "#{name}.operations must be an array" unless operations.is_a?(Array)

      operations.each { |child_operation| apply_component_definition_operation(definition.entities, child_operation, name) }
      return
    end

    size = vector(operation['size'] || [1000, 1000, 1000], "#{name}.size")
    material = operation['material']
    add_box(definition.entities, 'name' => "#{name}_Geometry", 'origin' => [0, 0, 0], 'size' => size, 'material' => material)
  end

  def apply_component_definition_operation(entities, operation, component_name)
    case operation['op']
    when 'material'
      ensure_material(operation)
    when 'box'
      add_box(entities, operation)
    when 'rounded_box'
      add_rounded_box(entities, operation)
    when 'beveled_panel'
      add_beveled_panel(entities, operation)
    when 'fillet'
      add_fillet(entities, operation)
    when 'chamfer'
      add_chamfer(entities, operation)
    when 'recess'
      add_recess(entities, operation)
    when 'engraved_line'
      add_engraved_line(entities, operation)
    when 'text_emboss'
      add_text_emboss(entities, operation)
    when 'text_engrave'
      add_text_engrave(entities, operation)
    when 'text_3d'
      add_text_3d(entities, operation)
    when 'slot'
      add_slot(entities, operation)
    when 'slot_array'
      add_slot_array(entities, operation)
    when 'rib'
      add_rib(entities, operation)
    when 'standoff_boss'
      add_standoff_boss(entities, operation)
    when 'button_on_panel'
      add_button_on_panel(entities, operation)
    when 'image_plane'
      add_image_plane(entities, operation)
    when 'floor_slab'
      add_floor_slab(entities, operation)
    when 'footprint_slab'
      add_footprint_slab(entities, operation)
    when 'wall'
      add_wall(entities, operation)
    when 'wall_path'
      add_wall_path(entities, operation)
    when 'curved_wall'
      add_curved_wall(entities, operation)
    when 'roof_footprint'
      add_roof_footprint(entities, operation)
    when 'hip_roof'
      add_hip_roof(entities, operation)
    when 'parapet_path'
      add_parapet_path(entities, operation)
    when 'curtain_wall'
      add_curtain_wall(entities, operation)
    when 'column_grid'
      add_column_grid(entities, operation)
    when 'path_surface'
      add_path_surface(entities, operation)
    when 'terrain_mesh'
      add_terrain_mesh(entities, operation)
    when 'parking_stall_array'
      add_parking_stall_array(entities, operation)
    when 'door'
      add_door(entities, operation)
    when 'window'
      add_window(entities, operation)
    when 'stairs'
      add_stairs(entities, operation)
    when 'railing'
      add_railing(entities, operation)
    when 'panel_with_openings'
      add_panel_with_openings(entities, operation)
    when 'boolean_cutout'
      add_boolean_cutout(entities, operation)
    when 'mesh'
      add_mesh(entities, operation)
    when 'geometry_input'
      add_geometry_input(entities, operation)
    when 'curve'
      add_curve(entities, operation)
    when 'arc_curve'
      add_arc_curve(entities, operation)
    when 'prism'
      add_prism(entities, operation)
    when 'face_with_holes'
      add_face_with_holes(entities, operation)
    when 'profile_extrude'
      add_profile_extrude(entities, operation)
    when 'gable_roof'
      add_gable_roof(entities, operation)
    when 'shed_roof'
      add_shed_roof(entities, operation)
    when 'cylinder'
      add_cylinder(entities, operation)
    when 'loft_between_profiles'
      add_loft_between_profiles(entities, operation)
    when 'shell_from_front_side_profiles'
      add_shell_from_front_side_profiles(entities, operation)
    when 'lofted_solid'
      add_lofted_solid(entities, operation)
    when 'face_on_cylinder'
      add_face_on_cylinder(entities, operation)
    when 'analog_stick'
      add_analog_stick(entities, operation)
    when 'screw_hole'
      add_screw_hole(entities, operation)
    when 'pipe_between_points'
      add_pipe_between_points(entities, operation)
    when 'swept_path'
      add_swept_path(entities, operation)
    when 'domed_surface'
      add_domed_surface(entities, operation)
    when 'bowed_panel'
      add_bowed_panel(entities, operation)
    when 'component_instance'
      add_component_instance_to_entities(entities, Sketchup.active_model, operation)
    else
      raise "#{component_name}.operations does not support op: #{operation['op']}"
    end
  end

  def add_component_instance(model, operation)
    add_component_instance_to_entities(model.entities, model, operation)
  end

  def add_component_instance_to_entities(entities, model, operation)
    name = operation.fetch('name')
    definition = model.definitions[operation.fetch('definition')]
    raise "#{name}.definition not found: #{operation['definition']}" unless definition

    origin = vector(operation['origin'] || [0, 0, 0], "#{name}.origin").map { |value| mm_to_model_units(value) }
    transform = operation['transform'] || {}
    rotate_z = transform['rotateZ'] || transform['rotationZ'] || operation['rotateZ']
    rotation = rotate_z ? Geom::Transformation.rotation(ORIGIN, Z_AXIS, rotate_z.to_f.degrees) : Geom::Transformation.new
    instance = entities.add_instance(definition, rotation)
    instance.name = name
    if instance.respond_to?(:set_attribute)
      id = object_id(operation, name)
      assert_entity_identity_available(instance, id, name)
      instance.set_attribute('AlmaSketchupMCP', 'id', id)
      qa = qa_metadata(operation)
      instance.set_attribute('AlmaSketchupMCP', 'qa', JSON.generate(qa)) if qa
    end
    translate = transform['translate'] || transform['translation'] || operation['translation'] || [0, 0, 0]
    extra_translate = vector(translate, "#{name}.transform.translate").map { |value| mm_to_model_units(value) }
    instance.transform!(Geom::Transformation.translation([
      origin[0] + extra_translate[0],
      origin[1] + extra_translate[1],
      origin[2] + extra_translate[2]
    ]))
    instance
  end

  def apply_transform(entity, operation)
    transform = operation['transform'] || {}
    translate = transform['translate'] || transform['translation'] || operation['translation']
    if translate
      vector_translate = vector(translate, "#{operation['name']}.transform.translate").map { |value| mm_to_model_units(value) }
      entity.transform!(Geom::Transformation.translation(vector_translate))
    end
    rotate_z = transform['rotateZ'] || transform['rotationZ'] || operation['rotateZ']
    return entity unless rotate_z

    angle = rotate_z.to_f.degrees
    entity.transform!(Geom::Transformation.rotation(ORIGIN, Z_AXIS, angle))
    entity
  end
end
