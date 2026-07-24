# frozen_string_literal: true

require 'json'
require 'tmpdir'

repo_root = File.expand_path('../..', __dir__)
support_dir = File.join(__dir__, 'support')
ENV['HOME'] = Dir.mktmpdir('alma-model-revision-')
$LOAD_PATH.unshift(support_dir)
require File.join(repo_root, 'sketchup_plugin', 'alma_sketchup_mcp')

FakeRevisionTransformation = Struct.new(:values) do
  def to_a
    values
  end
end

FakeRevisionMaterial = Struct.new(:name)

class FakeRevisionAttributeDictionary
  attr_reader :name

  def initialize(name, entries)
    @name = name
    @entries = entries
  end

  def each_pair(&block)
    @entries.each_pair(&block)
  end
end

class FakeRevisionDefinition
  attr_reader :name, :persistent_id, :entities

  def initialize(name:, persistent_id:, entities: [], reference: nil)
    @name = name
    @persistent_id = persistent_id
    @entities = entities
    @reference = reference
  end

  def get_attribute(dictionary, key)
    return @reference if dictionary == 'AlmaSketchupMCP' && key == 'id'

    nil
  end

  def attribute_dictionaries
    nil
  end
end

class Sketchup::Group
  attr_reader :persistent_id, :entityID, :definition
  attr_accessor :name, :transformation

  def initialize(persistent_id:, definition:, name: '', transformation: nil, entity_id: persistent_id, reference: nil, material_name: nil, attributes: nil)
    @persistent_id = persistent_id
    @entityID = entity_id
    @definition = definition
    @name = name
    @reference = reference
    @material_name = material_name
    @attributes = attributes
    @transformation = transformation || FakeRevisionTransformation.new(identity_matrix)
  end

  def get_attribute(dictionary, key)
    return @reference if dictionary == 'AlmaSketchupMCP' && key == 'id'

    nil
  end

  def attribute_dictionaries
    return nil unless @attributes

    @attributes.map { |dictionary, entries| FakeRevisionAttributeDictionary.new(dictionary, entries) }
  end

  def hidden?
    false
  end

  def locked?
    false
  end

  def material
    @material_name && FakeRevisionMaterial.new(@material_name)
  end

  def layer
    nil
  end

  private

  def identity_matrix
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  end
end

class Sketchup::ComponentInstance
  attr_reader :persistent_id, :entityID, :definition
  attr_accessor :name, :transformation

  def initialize(persistent_id:, definition:, name: '', transformation: nil, entity_id: persistent_id, reference: nil, material_name: nil, attributes: nil)
    @persistent_id = persistent_id
    @entityID = entity_id
    @definition = definition
    @name = name
    @reference = reference
    @material_name = material_name
    @attributes = attributes
    @transformation = transformation || FakeRevisionTransformation.new(identity_matrix)
  end

  def get_attribute(dictionary, key)
    return @reference if dictionary == 'AlmaSketchupMCP' && key == 'id'

    nil
  end

  def attribute_dictionaries
    return nil unless @attributes

    @attributes.map { |dictionary, entries| FakeRevisionAttributeDictionary.new(dictionary, entries) }
  end

  def hidden?
    false
  end

  def locked?
    false
  end

  def material
    @material_name && FakeRevisionMaterial.new(@material_name)
  end

  def layer
    nil
  end

  private

  def identity_matrix
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  end
end

FakeRevisionModel = Struct.new(:entities)

def check!(condition, message)
  raise message unless condition
end

def empty_snapshot
  {
    'totals' => { 'groups' => 0, 'instances' => 1_000, 'faces' => 0, 'edges' => 0, 'vertices' => 0 },
    'materials' => [],
    'tags' => [],
    'scenes' => [],
    'classification_schemas' => [],
    'component_definition_summaries' => [],
    'image_references' => []
  }
end

empty_definition = FakeRevisionDefinition.new(name: 'Empty', persistent_id: 10, entities: [])
shared_children = 200.times.map do |index|
  Sketchup::ComponentInstance.new(persistent_id: 20_000 + index, definition: empty_definition, name: "child-#{index}")
end
shared_definition = FakeRevisionDefinition.new(name: 'Shared', persistent_id: 20, entities: shared_children)
root_instances = 1_000.times.map do |index|
  Sketchup::ComponentInstance.new(persistent_id: 100_000 + index, definition: shared_definition, name: "root-#{index}")
end
model = FakeRevisionModel.new(root_instances)

first = AlmaSketchupMCP.session_model_revision_report(model, empty_snapshot)
second = AlmaSketchupMCP.session_model_revision_report(model, empty_snapshot)

tests = 0
tests += 1; check!(first['strategy'] == 'definition-merkle.v2', 'revision strategy must be versioned')
tests += 1; check!(AlmaSketchupMCP::MODEL_REVISION_UNIQUE_ENTITY_LIMIT == 1_000_000, 'default unique-entity safety limit must cover the accepted real-model corpus')
tests += 1; check!(first['complete'] == true, 'shared-definition graph must be completely covered')
tests += 1; check!(first['recursive_total_seen'] == 201_000, 'logical occurrence count must expand shared definitions')
tests += 1; check!(first['recursive_indexed'] == 201_000, 'complete coverage must bind indexed count to logical count')
tests += 1; check!(first['unique_entities'] == 1_200, 'shared definition entities must be fingerprinted once')
tests += 1; check!(first['reachable_definitions'] == 2, 'reachable definitions must be counted once')
tests += 1; check!(first['model_revision'] == second['model_revision'], 'unchanged graph must produce a deterministic revision')

reopened_definition_a = FakeRevisionDefinition.new(name: 'Reopened', persistent_id: 40, entities: [])
reopened_definition_b = FakeRevisionDefinition.new(name: 'Reopened', persistent_id: 40, entities: [])
reopened_a = FakeRevisionModel.new([
  Sketchup::ComponentInstance.new(persistent_id: 40_001, entity_id: 501, definition: reopened_definition_a, name: 'stable-instance')
])
reopened_b = FakeRevisionModel.new([
  Sketchup::ComponentInstance.new(persistent_id: 40_001, entity_id: 9_501, definition: reopened_definition_b, name: 'stable-instance')
])
reopened_revision_a = AlmaSketchupMCP.session_model_revision_report(reopened_a, empty_snapshot)
reopened_revision_b = AlmaSketchupMCP.session_model_revision_report(reopened_b, empty_snapshot)
tests += 1; check!(reopened_revision_a['model_revision'] == reopened_revision_b['model_revision'], 'process-local entityID drift must not change a persistent-identity model revision')

custom_reference_entity_a = FakeRevisionModel.new([
  Sketchup::ComponentInstance.new(persistent_id: nil, entity_id: 801, reference: 'stable-custom-entity', definition: reopened_definition_a)
])
custom_reference_entity_b = FakeRevisionModel.new([
  Sketchup::ComponentInstance.new(persistent_id: nil, entity_id: 9_801, reference: 'stable-custom-entity', definition: reopened_definition_b)
])
custom_reference_revision_a = AlmaSketchupMCP.session_model_revision_report(custom_reference_entity_a, empty_snapshot)
custom_reference_revision_b = AlmaSketchupMCP.session_model_revision_report(custom_reference_entity_b, empty_snapshot)
tests += 1; check!(custom_reference_revision_a['model_revision'] == custom_reference_revision_b['model_revision'], 'process-local entityID drift must not change a custom-reference entity revision')

permuted_definition_a = FakeRevisionDefinition.new(name: 'Permuted', persistent_id: 41, entities: [])
permuted_definition_b = FakeRevisionDefinition.new(name: 'Permuted', persistent_id: 41, entities: [])
permuted_a = FakeRevisionModel.new([
  Sketchup::ComponentInstance.new(persistent_id: 41_001, entity_id: 601, definition: permuted_definition_a, name: 'first'),
  Sketchup::ComponentInstance.new(persistent_id: 41_002, entity_id: 602, definition: permuted_definition_a, name: 'second')
])
permuted_b = FakeRevisionModel.new([
  Sketchup::ComponentInstance.new(persistent_id: 41_002, entity_id: 9_602, definition: permuted_definition_b, name: 'second'),
  Sketchup::ComponentInstance.new(persistent_id: 41_001, entity_id: 9_601, definition: permuted_definition_b, name: 'first')
])
permuted_revision_a = AlmaSketchupMCP.session_model_revision_report(permuted_a, empty_snapshot)
permuted_revision_b = AlmaSketchupMCP.session_model_revision_report(permuted_b, empty_snapshot)
tests += 1; check!(permuted_revision_a['model_revision'] == permuted_revision_b['model_revision'], 'enumeration order and process-local entityID drift must not change revision')

missing_identity_model = FakeRevisionModel.new([
  Sketchup::ComponentInstance.new(persistent_id: nil, entity_id: 12_345, definition: reopened_definition_a, name: 'missing-stable-id')
])
missing_identity = AlmaSketchupMCP.session_model_revision_report(missing_identity_model, empty_snapshot)
tests += 1; check!(missing_identity['complete'] == false, 'missing persistent/custom entity identity must fail closed')
tests += 1; check!(missing_identity['blockers'].include?('entity_identity_unavailable'), 'missing stable identity blocker must be machine-readable')

duplicate_reference_model = FakeRevisionModel.new([
  Sketchup::ComponentInstance.new(persistent_id: nil, entity_id: 20_001, reference: 'duplicate-ref', definition: reopened_definition_a),
  Sketchup::ComponentInstance.new(persistent_id: nil, entity_id: 20_002, reference: 'duplicate-ref', definition: reopened_definition_a)
])
duplicate_reference = AlmaSketchupMCP.session_model_revision_report(duplicate_reference_model, empty_snapshot)
tests += 1; check!(duplicate_reference['complete'] == false, 'duplicate fallback references must fail closed')
tests += 1; check!(duplicate_reference['blockers'].include?('duplicate_entity_identity'), 'duplicate stable identity blocker must be machine-readable')

cross_type_duplicate_reference_model = FakeRevisionModel.new([
  Sketchup::ComponentInstance.new(persistent_id: nil, entity_id: 21_001, reference: 'cross-type-ref', definition: reopened_definition_a),
  Sketchup::Group.new(persistent_id: nil, entity_id: 21_002, reference: 'cross-type-ref', definition: reopened_definition_a)
])
cross_type_duplicate_reference = AlmaSketchupMCP.session_model_revision_report(cross_type_duplicate_reference_model, empty_snapshot)
tests += 1; check!(cross_type_duplicate_reference['complete'] == false, 'duplicate fallback references across entity types must fail closed')
tests += 1; check!(cross_type_duplicate_reference['blockers'].include?('duplicate_entity_identity'), 'cross-type duplicate identity blocker must be machine-readable')

custom_definition_a = FakeRevisionDefinition.new(name: 'Custom Definition', persistent_id: nil, reference: 'definition-ref', entities: [])
custom_definition_b = FakeRevisionDefinition.new(name: 'Custom Definition', persistent_id: nil, reference: 'definition-ref', entities: [])
custom_definition_model_a = FakeRevisionModel.new([
  Sketchup::ComponentInstance.new(persistent_id: 42_001, entity_id: 701, definition: custom_definition_a)
])
custom_definition_model_b = FakeRevisionModel.new([
  Sketchup::ComponentInstance.new(persistent_id: 42_001, entity_id: 9_701, definition: custom_definition_b)
])
custom_definition_revision_a = AlmaSketchupMCP.session_model_revision_report(custom_definition_model_a, empty_snapshot)
custom_definition_revision_b = AlmaSketchupMCP.session_model_revision_report(custom_definition_model_b, empty_snapshot)
tests += 1; check!(custom_definition_revision_a['complete'] == true, 'unique custom definition reference must be accepted as stable identity')
tests += 1; check!(custom_definition_revision_a['model_revision'] == custom_definition_revision_b['model_revision'], 'custom definition reference must remain stable across process-local identity drift')

missing_definition_identity = FakeRevisionDefinition.new(name: 'Name Is Not Identity', persistent_id: nil, entities: [])
missing_definition_identity_model = FakeRevisionModel.new([
  Sketchup::ComponentInstance.new(persistent_id: 43_001, definition: missing_definition_identity)
])
missing_definition_identity_revision = AlmaSketchupMCP.session_model_revision_report(missing_definition_identity_model, empty_snapshot)
tests += 1; check!(missing_definition_identity_revision['complete'] == false, 'definition name alone must not be accepted as stable identity')
tests += 1; check!(missing_definition_identity_revision['blockers'].include?('definition_identity_unavailable'), 'missing definition identity blocker must be machine-readable')

duplicate_definition_a = FakeRevisionDefinition.new(name: 'Duplicate A', persistent_id: 44, entities: [])
duplicate_definition_b = FakeRevisionDefinition.new(name: 'Duplicate B', persistent_id: 44, entities: [])
duplicate_definition_identity_model = FakeRevisionModel.new([
  Sketchup::ComponentInstance.new(persistent_id: 44_001, definition: duplicate_definition_a),
  Sketchup::ComponentInstance.new(persistent_id: 44_002, definition: duplicate_definition_b)
])
duplicate_definition_identity_revision = AlmaSketchupMCP.session_model_revision_report(duplicate_definition_identity_model, empty_snapshot)
tests += 1; check!(duplicate_definition_identity_revision['complete'] == false, 'duplicate definition identity must fail closed')
tests += 1; check!(duplicate_definition_identity_revision['blockers'].include?('duplicate_definition_identity'), 'duplicate definition identity blocker must be machine-readable')

attribute_order_a = {
  'z_dictionary' => { 'second' => 2, 'first' => 1 },
  'a_dictionary' => { 'nested' => { 'b' => true, 'a' => false } }
}
attribute_order_b = {
  'a_dictionary' => { 'nested' => { 'a' => false, 'b' => true } },
  'z_dictionary' => { 'first' => 1, 'second' => 2 }
}
tests += 1; check!(AlmaSketchupMCP.revision_json(attribute_order_a) == AlmaSketchupMCP.revision_json(attribute_order_b), 'attribute dictionary/key enumeration order must not change canonical revision input')

material_model_a = FakeRevisionModel.new([
  Sketchup::ComponentInstance.new(persistent_id: 45_001, definition: reopened_definition_a, material_name: 'Red')
])
material_model_b = FakeRevisionModel.new([
  Sketchup::ComponentInstance.new(persistent_id: 45_001, definition: reopened_definition_b, material_name: 'Blue')
])
tests += 1; check!(AlmaSketchupMCP.session_model_revision(material_model_a, empty_snapshot) != AlmaSketchupMCP.session_model_revision(material_model_b, empty_snapshot), 'material changes must change model revision')

attribute_model_a = FakeRevisionModel.new([
  Sketchup::ComponentInstance.new(
    persistent_id: 46_001,
    definition: reopened_definition_a,
    attributes: { 'Z' => { 'second' => 2, 'first' => 1 }, 'A' => { 'enabled' => true } }
  )
])
attribute_model_b = FakeRevisionModel.new([
  Sketchup::ComponentInstance.new(
    persistent_id: 46_001,
    definition: reopened_definition_b,
    attributes: { 'A' => { 'enabled' => true }, 'Z' => { 'first' => 1, 'second' => 2 } }
  )
])
attribute_model_changed = FakeRevisionModel.new([
  Sketchup::ComponentInstance.new(
    persistent_id: 46_001,
    definition: reopened_definition_b,
    attributes: { 'A' => { 'enabled' => true }, 'Z' => { 'first' => 1, 'second' => 3 } }
  )
])
attribute_revision_a = AlmaSketchupMCP.session_model_revision(attribute_model_a, empty_snapshot)
attribute_revision_b = AlmaSketchupMCP.session_model_revision(attribute_model_b, empty_snapshot)
attribute_revision_changed = AlmaSketchupMCP.session_model_revision(attribute_model_changed, empty_snapshot)
tests += 1; check!(attribute_revision_a == attribute_revision_b, 'attribute dictionary/key enumeration order must not change integrated revision')
tests += 1; check!(attribute_revision_a != attribute_revision_changed, 'attribute value changes must change model revision')

ring = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]]
canonical_ring = AlmaSketchupMCP.revision_canonical_ring(ring)
tests += 1; check!(AlmaSketchupMCP.revision_canonical_ring(ring.rotate(2)) == canonical_ring, 'face loop start vertex drift must not change canonical ring')
tests += 1; check!(AlmaSketchupMCP.revision_canonical_ring(ring.reverse.rotate(1)) == canonical_ring, 'face loop enumeration direction drift must not change canonical ring')

face_geometry_a = {
  'type' => 'face',
  'normal' => [0, 0, 1],
  'outer_loop' => ring,
  'holes' => [[[2, 2, 0], [3, 2, 0], [3, 3, 0]], [[6, 6, 0], [7, 6, 0], [7, 7, 0]]]
}
face_geometry_b = {
  'holes' => [face_geometry_a['holes'][1].reverse.rotate(1), face_geometry_a['holes'][0].rotate(2)],
  'outer_loop' => ring.reverse.rotate(3),
  'normal' => [0, 0, 1],
  'type' => 'face'
}
canonical_face_a = AlmaSketchupMCP.revision_canonical_geometry_summary(face_geometry_a)
canonical_face_b = AlmaSketchupMCP.revision_canonical_geometry_summary(face_geometry_b)
tests += 1; check!(AlmaSketchupMCP.revision_json(canonical_face_a) == AlmaSketchupMCP.revision_json(canonical_face_b), 'face hole order and loop representation drift must not change canonical geometry')

edge_forward = { 'type' => 'edge', 'endpoints' => [[0, 0, 0], [10, 20, 30]], 'length_mm' => 37.416574 }
edge_reverse = { 'length_mm' => 37.416574, 'endpoints' => edge_forward['endpoints'].reverse, 'type' => 'edge' }
tests += 1; check!(AlmaSketchupMCP.revision_json(AlmaSketchupMCP.revision_canonical_geometry_summary(edge_forward)) == AlmaSketchupMCP.revision_json(AlmaSketchupMCP.revision_canonical_geometry_summary(edge_reverse)), 'edge endpoint direction drift must not change canonical geometry')
tests += 1; check!(AlmaSketchupMCP.revision_json(AlmaSketchupMCP.revision_canonical_geometry_summary(edge_forward)) != AlmaSketchupMCP.revision_json(AlmaSketchupMCP.revision_canonical_geometry_summary(edge_forward.merge('length_mm' => 40))), 'semantic geometry changes must still change canonical geometry')

root_instances.first.transformation = FakeRevisionTransformation.new(
  [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 25, 0, 0, 1]
)
changed = AlmaSketchupMCP.session_model_revision_report(model, empty_snapshot)
tests += 1; check!(changed['model_revision'] != first['model_revision'], 'instance transform changes must change the complete revision')
tests += 1; check!(changed['recursive_total_seen'] == first['recursive_total_seen'], 'transform changes must not corrupt logical counts')

bounded = AlmaSketchupMCP.model_revision_merkle_graph(model, empty_snapshot, unique_entity_limit: 100)
tests += 1; check!(bounded['complete'] == false, 'unique entity budget exhaustion must fail closed')
tests += 1; check!(bounded['blockers'].include?('unique_entity_limit_exceeded'), 'budget blocker must be stable and machine-readable')

cycle_definition = FakeRevisionDefinition.new(name: 'Cycle', persistent_id: 30, entities: [])
cycle_definition.entities << Sketchup::ComponentInstance.new(persistent_id: 30_001, definition: cycle_definition)
cycle_model = FakeRevisionModel.new([Sketchup::ComponentInstance.new(persistent_id: 30_002, definition: cycle_definition)])
cycle = AlmaSketchupMCP.model_revision_merkle_graph(cycle_model, empty_snapshot)
tests += 1; check!(cycle['complete'] == false, 'recursive definition cycles must fail closed')
tests += 1; check!(cycle['blockers'].include?('recursive_definition_cycle'), 'cycle blocker must be stable and machine-readable')

puts JSON.generate({
  ok: true,
  tests: tests,
  strategy: first['strategy'],
  unique_entity_limit: AlmaSketchupMCP::MODEL_REVISION_UNIQUE_ENTITY_LIMIT,
  logical_occurrences: first['recursive_total_seen'],
  unique_entities: first['unique_entities'],
  shared_definition_expansion_materialized: false,
  transform_change_detected: true,
  process_local_entity_id_ignored: true,
  custom_reference_entity_id_stable: true,
  enumeration_order_independent: true,
  missing_stable_identity_failed_closed: true,
  duplicate_fallback_identity_failed_closed: true,
  cross_type_duplicate_identity_failed_closed: true,
  custom_definition_identity_stable: true,
  missing_definition_identity_failed_closed: true,
  duplicate_definition_identity_failed_closed: true,
  attribute_order_independent: true,
  material_change_detected: true,
  attribute_change_detected: true,
  face_loop_order_independent: true,
  edge_direction_independent: true,
  semantic_geometry_change_detected: true,
  unique_limit_failed_closed: true,
  recursive_cycle_failed_closed: true
})
