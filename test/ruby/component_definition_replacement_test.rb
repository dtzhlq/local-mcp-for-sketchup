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
