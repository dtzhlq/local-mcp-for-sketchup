# frozen_string_literal: true
require 'minitest/autorun'
$LOAD_PATH.unshift(File.join(__dir__, 'support'))
require_relative '../../sketchup_plugin/alma_sketchup_mcp'
module Sketchup
  class ComponentInstance
    attr_reader :persistent_id, :definition
    def initialize(pid, definition); @persistent_id, @definition = pid, definition; end
  end
  class Edge
    attr_reader :persistent_id
    def initialize(pid); @persistent_id = pid; end
  end
end
module AlmaSketchupMCP
  def self.classification_schema_catalog(*); []; end
  def self.entity_persistent_id(entity); entity.persistent_id.to_s; end
  def self.selectable_entity?(*); true; end
  def self.occurrence_entity_snapshot(entity, path, *); { 'entity_path' => "pid:#{path.map(&:persistent_id).join('.')}", 'id' => entity.persistent_id }; end
end
class ScopedRecursiveIndexTest < Minitest::Test
  Definition = Struct.new(:persistent_id, :name, :entities)
  Model = Struct.new(:entities)
  def test_scoped_index_omits_only_unselected_descendants_and_counts_truncation
    small = Sketchup::ComponentInstance.new(1, Definition.new(10, 'small', [Sketchup::Edge.new(11), Sketchup::Edge.new(12)]))
    large = Sketchup::ComponentInstance.new(2, Definition.new(20, 'large', (100..1099).map { |id| Sketchup::Edge.new(id) }))
    model = Model.new([small, large])
    scoped = AlmaSketchupMCP.recursive_entity_index(model, 10, roots: ['pid:1'])
    assert_equal ['pid:1','pid:1.11','pid:1.12','pid:2'], scoped['entries'].map { |entry| entry['entity_path'] }
    assert_equal 4, scoped['total_seen']; refute scoped['truncated']
    full = AlmaSketchupMCP.recursive_entity_index(model, 2000)
    assert_equal 1004, full['total_seen']; refute full['truncated']
    limited = AlmaSketchupMCP.recursive_entity_index(model, 2, roots: ['pid:1'])
    assert_equal 4, limited['total_seen']; assert limited['truncated']; assert_equal 2, limited['entries'].length
  end
  def test_assembly_projection_keeps_global_roots_and_nested_containers_without_leaf_expansion
    leaves = (100..1099).map { |id| Sketchup::Edge.new(id) }
    deep = Sketchup::ComponentInstance.new(5, Definition.new(50, 'deep', leaves))
    boundary = Sketchup::ComponentInstance.new(6, Definition.new(60, 'boundary', [deep]))
    child = Sketchup::ComponentInstance.new(3, Definition.new(30, 'leaf-solid', [boundary]))
    selected = Sketchup::ComponentInstance.new(1, Definition.new(10, 'selected', [child]))
    unrelated = Sketchup::ComponentInstance.new(2, Definition.new(20, 'unrelated', leaves))
    loose = Sketchup::Edge.new(4)
    model = Model.new([selected, unrelated, loose])
    report = AlmaSketchupMCP.recursive_entity_index(model, 10, roots: ['pid:1'], assembly_projection: true)
    assert_equal ['pid:1','pid:1.3','pid:1.3.6','pid:2','pid:4'], report['entries'].map { |e| e['entity_path'] }
    assert_equal 5, report['total_seen']
    refute report['truncated']
  end

end
