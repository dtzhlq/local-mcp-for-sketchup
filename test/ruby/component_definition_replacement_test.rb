# frozen_string_literal: true
require 'minitest/autorun'
$LOAD_PATH.unshift(File.join(__dir__, 'support'))
require_relative '../../sketchup_plugin/alma_sketchup_mcp'

module Sketchup
  class ComponentInstance
    attr_accessor :definition, :name, :material, :hidden
    attr_reader :persistent_id, :transformation, :attributes
    def initialize(definition)
      @definition, @persistent_id, @name = definition, 12345, 'Reviewed instance'
      @transformation = [2, 0, 0, 100, 0, 1, 0, 200, 0, 0, 1, 0]
      @attributes = { 'external_binding' => 'stable' }
      @material = 'User material override'
      @hidden = true
    end
    def erase!; raise 'Replacing a definition must never erase the instance'; end
  end
end

class ComponentDefinitionReplacementTest < Minitest::Test
  def test_fresh_definition_identity_index_still_rejects_duplicates
    siblings = Object.new # Deliberately has no grep: no sibling scan is allowed.
    entity_class = Struct.new(:persistent_id, :erased) do
      def erase!; self.erased = true; end
    end
    first = entity_class.new(123, false)
    candidate = entity_class.new(124, false)
    AlmaSketchupMCP.instance_variable_set(:@definition_creation_identity_index, {entities: siblings, ids: {}, names: {}})
    AlmaSketchupMCP.stub(:entity_parent_entities, siblings) do
      AlmaSketchupMCP.assert_entity_identity_available(first, 'id-a', 'name-a')
      assert_raises(RuntimeError) { AlmaSketchupMCP.assert_entity_identity_available(candidate, 'id-a', 'name-b') }
      assert candidate.erased
      assert_raises(RuntimeError) { AlmaSketchupMCP.assert_entity_identity_available(candidate, 'id-b', 'name-a') }
      assert_raises(RuntimeError) { AlmaSketchupMCP.assert_entity_identity_available(candidate, '123', 'name-b') }
    end
  ensure
    AlmaSketchupMCP.instance_variable_set(:@definition_creation_identity_index, nil)
  end

  def test_snapshot_counts_reuse_definitions_but_refresh_after_an_edit
    leaf = [Sketchup::Face.new]
    definition = Struct.new(:entities).new(leaf)
    root = [Sketchup::ComponentInstance.new(definition), Sketchup::ComponentInstance.new(definition)]
    assert_equal 2, AlmaSketchupMCP.count_faces(root)
    leaf << Sketchup::Face.new
    assert_equal 4, AlmaSketchupMCP.count_faces(root)
  end

  def test_snapshot_cache_uses_native_definition_not_entities_wrapper
    reads = 0
    definition = Object.new
    definition.define_singleton_method(:persistent_id) { 999 }
    definition.define_singleton_method(:entities) do
      wrapper = [Sketchup::Face.new]
      wrapper.define_singleton_method(:grep) { |type| reads += 1; super(type) }
      wrapper
    end
    root = [Sketchup::ComponentInstance.new(definition), Sketchup::ComponentInstance.new(definition)]
    assert_equal 2, AlmaSketchupMCP.count_faces(root)
    assert_equal 1, reads
  end

  def test_native_setter_preserves_instance_identity_and_properties
    old_definition = Object.new
    new_definition = Object.new
    instance = Sketchup::ComponentInstance.new(old_definition)
    model = Struct.new(:definitions).new({ 'new-version' => new_definition })
    before = [instance.persistent_id, instance.name, instance.transformation.dup, instance.material, instance.hidden, instance.attributes.dup]
    AlmaSketchupMCP.stub(:find_referenced_entity, instance) do
      result = AlmaSketchupMCP.replace_component_definition(model, { 'confirmed' => true, 'definition' => 'new-version' })
      assert_same instance, result
      assert_same new_definition, instance.definition
      assert_equal before, [instance.persistent_id, instance.name, instance.transformation, instance.material, instance.hidden, instance.attributes]
      assert_raises(RuntimeError) { AlmaSketchupMCP.replace_component_definition(model, { 'definition' => 'new-version' }) }
    end
  end
end
