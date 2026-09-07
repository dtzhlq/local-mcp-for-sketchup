# frozen_string_literal: true
require 'minitest/autorun'
require 'json'
require 'digest'
module Sketchup
  class Group; end
  class ComponentInstance; end
end
require_relative '../../sketchup_plugin/alma_sketchup_mcp/snapshot'
require_relative '../../sketchup_plugin/alma_sketchup_mcp/model_revision'

# Load the actual two methods without launching SketchUp's plugin entry point.
entry_source = File.read(File.expand_path('../../sketchup_plugin/alma_sketchup_mcp.rb', __dir__))
info_methods = entry_source.split("  def get_model_info\n", 2).fetch(1).split("  def list_entities", 2).first
AlmaSketchupMCP.module_eval("def get_model_info\n#{info_methods}", __FILE__, __LINE__)

module AlmaSketchupMCP
  def self.document_state(*); {}; end
  def self.classification_schema_catalog(*); []; end
  def self.snapshot_warnings(*); []; end
  def self.snapshot_scenes(*); []; end
  def self.native_section_planes_snapshot(*); []; end
  def self.native_appearance_snapshot(*); { 'native' => true }; end
  def self.image_references_snapshot(*); []; end
  def self.merge_bounds_hashes(*); nil; end
  def self.selection_snapshot(*); []; end
  def self.warning_summary(*); {}; end
  def self.snapshot_view_state(*); {}; end
  def self.geometry_occurrences(*); []; end
  def self.active_model_or_new(*); raise 'stub required'; end
  def self.model_path(*); '/independent-test.skp'; end
end

class RevisionSnapshotCostTest < Minitest::Test
  Model = Struct.new(:entities, :definitions, :layers, :materials)
  def test_model_info_keeps_all_returned_fields_without_collecting_discarded_detail
    model = Model.new([], [], [], [])
    calls = []
    AlmaSketchupMCP.stub(:native_geometry_resource_totals, ->(*) { calls << :resources; { 'faces' => 123 } }) do
      AlmaSketchupMCP.stub(:geometry_occurrences, ->(*) { calls << :geometry; [{ 'measured' => true }] }) do
        expected = AlmaSketchupMCP.model_info_payload(model, AlmaSketchupMCP.snapshot(model))
        assert_equal [:resources, :geometry], calls
        calls.clear
        AlmaSketchupMCP.stub(:active_model_or_new, model) do
          assert_equal expected, AlmaSketchupMCP.get_model_info
        end
        assert_empty calls
      end
    end
  end
  def test_revision_omits_only_derived_costs_and_keeps_identical_hash
    model = Model.new([], [], [], [])
    calls = []
    AlmaSketchupMCP.stub(:native_geometry_resource_totals, ->(*) { calls << :resources; { 'faces' => 123 } }) do
      AlmaSketchupMCP.stub(:geometry_occurrences, ->(*) { calls << :geometry; [{ 'measured' => true }] }) do
        full = AlmaSketchupMCP.snapshot(model)
        assert_equal [:resources, :geometry], calls
        calls.clear
        lean = AlmaSketchupMCP.snapshot(model, include_detail_evidence: false)
        assert_empty calls
        assert_equal full.reject { |k, _| %w[resource_totals geometry_occurrences].include?(k) }, lean.reject { |k, _| %w[resource_totals geometry_occurrences].include?(k) }
        graph = { 'root_digest' => 'actual-native-entity-hash', 'logical_occurrences' => 1, 'unique_entities' => 1, 'reachable_definitions' => 0, 'complete' => true, 'blockers' => [] }
        AlmaSketchupMCP.stub(:model_revision_merkle_graph, graph) do
          expected = AlmaSketchupMCP.session_model_revision_report(model, full)
          assert_equal expected, AlmaSketchupMCP.session_model_revision_report(model)
          assert_empty calls
          graph['root_digest'] = 'changed-native-geometry'
          refute_equal expected['model_revision'], AlmaSketchupMCP.session_model_revision_report(model)['model_revision']
        end
      end
    end
  end
end
