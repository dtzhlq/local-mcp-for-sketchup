# frozen_string_literal: true
require 'minitest/autorun'
require 'json'

module AlmaSketchupMCP
  extend self
  def parse_dsl(code); JSON.parse(code); end
  def active_model_or_new(*); :test_model; end
  def with_atomic_model_transaction(*); yield; end
  def validate_creation_scope!(*); end
  def document_state(*); {}; end
  def persist_document_state(*); end
  def apply_operation(_, op); raise 'operation failed' if op['op'] == 'fail'; end
  def snapshot(*); { 'geometry' => 'unchanged' }; end
  def session_model_revision_report(*); { 'model_revision' => 'test-revision', 'complete' => true }; end
end
source = File.read(File.expand_path('../../sketchup_plugin/alma_sketchup_mcp.rb', __dir__))
method_source = source.split("  def build_model(code, snapshot_detail: true)\n", 2).fetch(1).split("  def save_model(path, keep_session, snapshot_detail: true)\n", 2).first
AlmaSketchupMCP.module_eval("def build_model(code, snapshot_detail: true)\n#{method_source}", __FILE__, __LINE__)

class BuildRuntimeProfileTest < Minitest::Test
  def test_profile_keeps_native_operation_order_and_separates_snapshot_cost
    result = AlmaSketchupMCP.build_model(JSON.generate('operations' => [{ 'op' => 'mesh' }, { 'op' => 'component_instance' }]))
    assert_equal 'unchanged', result['geometry']
    assert_equal 'test-revision', result['model_revision']
    profile = result.fetch('runtime_profile')
    assert_equal 'native_monotonic_clock', profile['source']
    assert_equal [0, 1], profile['operations'].map { |row| row['index'] }
    assert_equal %w[mesh component_instance], profile['operations'].map { |row| row['op'] }
    durations = profile['operations'].map { |row| row['elapsed_ms'] } + [profile['snapshot_elapsed_ms'], profile['revision_elapsed_ms']]
    assert durations.all? { |duration| duration.finite? && duration >= 0 }
    assert_operator profile['total_elapsed_ms'], :>=, durations.sum
    assert_equal false, profile['includes_queue_wait']
    assert_equal false, profile['quality_evidence']
    AlmaSketchupMCP.stub(:snapshot, ->(_, include_detail_evidence:) {
      assert_equal false, include_detail_evidence
      { 'geometry' => 'compact' }
    }) do
      compact = AlmaSketchupMCP.build_model(JSON.generate('operations' => []), snapshot_detail: false)
      assert_equal 'compact', compact['geometry']
      assert_equal 'test-revision', compact['model_revision']
    end
  end

  def test_failed_operation_is_not_returned_as_a_successful_profile
    assert_raises(RuntimeError) { AlmaSketchupMCP.build_model(JSON.generate('operations' => [{ 'op' => 'fail' }])) }
  end
end
