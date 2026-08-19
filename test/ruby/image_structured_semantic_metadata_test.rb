# frozen_string_literal: true

require 'json'

plugin_path = File.expand_path('../../sketchup_plugin/local_mcp_for_sketchup/bridge.rb', __dir__)
source = File.read(plugin_path)
qa_start = source.index('  def qa_metadata(')
qa_end = qa_start && source.index('  def object_id(', qa_start)
raise 'qa_metadata source boundary is missing' unless qa_start && qa_end

QaMetadataHarness = Module.new do
  extend self
end
QaMetadataHarness.module_eval(source.slice(qa_start...qa_end), plugin_path, source[0...qa_start].count("\n") + 1)

qa = QaMetadataHarness.qa_metadata(
  'qa' => {
    'role' => 'roof_shell',
    'part_id' => 'roof-shell',
    'source_candidate_ids' => ['candidate-roof'],
    'source_observation_ids' => ['observation-roof'],
    'architectural_primitive_id' => 'roof-primitive',
    'mesh_semantic' => {
      'front_material' => 'Hall_Roof',
      'back_material' => 'Hall_Roof',
      'precompile_winding_validated' => true,
      'untrusted_extra' => 'must-not-survive'
    },
    'untrusted_extra' => 'must-not-survive'
  }
)

raise 'candidate lineage was dropped' unless qa['source_candidate_ids'] == ['candidate-roof']
raise 'observation lineage was dropped' unless qa['source_observation_ids'] == ['observation-roof']
raise 'primitive identity was dropped' unless qa['architectural_primitive_id'] == 'roof-primitive'
raise 'mesh semantic attestation was dropped' unless qa['mesh_semantic'] == {
  'front_material' => 'Hall_Roof',
  'back_material' => 'Hall_Roof',
  'precompile_winding_validated' => true
}
raise 'untrusted QA fields must not survive sanitation' if qa.key?('untrusted_extra')

module LocalMcpForSketchUp
  ATTRIBUTE_DICTIONARY = 'LocalMcpForSketchUp' unless const_defined?(:ATTRIBUTE_DICTIONARY)
  LEGACY_ATTRIBUTE_DICTIONARIES = {}.freeze unless const_defined?(:LEGACY_ATTRIBUTE_DICTIONARIES)

  def compatible_attribute(entity, dictionary, key)
    entity.get_attribute(dictionary, key)
  end
end

require File.expand_path('../../sketchup_plugin/local_mcp_for_sketchup/geometry_operations.rb', __dir__)

Point = Struct.new(:x, :y, :z)
Vertex = Struct.new(:position)
Normal = Struct.new(:x, :y, :z)
Material = Struct.new(:name)
Face = Struct.new(:vertices, :normal, :area, :material, :back_material)

class SemanticMeshGroup
  attr_reader :entities

  def initialize(faces)
    @entities = faces
  end

  def get_attribute(dictionary, key)
    return 'mesh' if dictionary == 'LocalMcpForSketchUp' && key == 'kind'

    nil
  end
end

def face(points, normal)
  material = Material.new('Hall_Roof')
  Face.new(points.map { |point| Vertex.new(Point.new(*point)) }, Normal.new(*normal), 4.0, material, material)
end

faces = [
  face([[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]], [0, 0, -1]),
  face([[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], [0, 0, 1]),
  face([[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]], [0, -1, 0]),
  face([[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]], [1, 0, 0]),
  face([[1, 1, -1], [-1, 1, -1], [-1, 1, 1], [1, 1, 1]], [0, 1, 0]),
  face([[-1, 1, -1], [-1, -1, -1], [-1, -1, 1], [-1, 1, 1]], [-1, 0, 0])
]
measurement = LocalMcpForSketchUp.native_mesh_semantic(SemanticMeshGroup.new(faces))
raise 'native mesh was not remeasured' unless measurement['native_geometry_remeasured'] == true
raise 'native mesh face count is wrong' unless measurement['face_count'] == 6
raise 'valid mesh was marked inward' unless measurement['inward_face_count'].zero?
raise 'valid back materials were rejected' unless measurement['missing_back_material_face_count'].zero?

faces[0].normal = Normal.new(0, 0, 1)
reversed = LocalMcpForSketchUp.native_mesh_semantic(SemanticMeshGroup.new(faces))
raise 'reversed native face was not detected' unless reversed['inward_face_count'] == 1

puts JSON.generate({
  ok: true,
  qa_lineage_persisted: true,
  mesh_attestation_persisted: true,
  native_face_measurement: true,
  reversed_face_detected: true
})
