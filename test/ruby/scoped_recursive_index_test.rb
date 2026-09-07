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
end
