# frozen_string_literal: true
module AlmaSketchupMCP
  extend self

  def section_plane_define(model, operation)
    name = non_empty_string(operation['name'], 'section_plane.name')
    raise "Section plane already exists: #{name}" if model.entities.grep(Sketchup::SectionPlane).any? { |plane| plane.name == name }
    origin = vector(operation['origin'], 'section_plane.origin').map { |value| mm_to_model_units(value) }
    normal = vector(operation['normal'], 'section_plane.normal')
    raise 'section_plane.normal must not be zero' if normal.sum { |value| value * value } < 1e-12
    plane = model.entities.add_section_plane(Geom::Point3d.new(origin), Geom::Vector3d.new(normal))
    raise 'SketchUp did not create the section plane' unless plane
    plane.name = name
    plane.set_attribute('AlmaSketchupMCP', 'id', operation['id'] || name)
    plane.hidden = true
    section_plane_activate(model, 'section_ref' => name) if operation.fetch('activate', true)
    plane
  end

  def section_plane_activate(model, operation)
    reference = operation.fetch('section_ref')
    if reference.nil?
      model.entities.active_section_plane = nil
    else
      matches = model.entities.grep(Sketchup::SectionPlane).select { |plane| plane.name == reference || plane.get_attribute('AlmaSketchupMCP', 'id') == reference }
      raise 'section_ref must resolve uniquely' unless matches.length == 1
      model.entities.active_section_plane = matches.first
    end
    model.rendering_options['DisplaySectionCuts'] = !reference.nil?
    model.rendering_options['DisplaySectionPlanes'] = false
  end

  def native_section_planes_snapshot(model)
    active = model.entities.active_section_plane
    model.entities.grep(Sketchup::SectionPlane).map do |plane|
      coefficients = plane.get_plane
      { 'id' => plane.get_attribute('AlmaSketchupMCP', 'id'), 'name' => plane.name,
        'persistent_id' => plane.persistent_id.to_s, 'active' => plane == active,
        'plane_model_units' => coefficients, 'hidden' => plane.hidden? }
    end
  end
end
