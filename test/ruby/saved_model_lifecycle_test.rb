# frozen_string_literal: true
require 'minitest/autorun'
require 'tmpdir'
$LOAD_PATH.unshift(File.join(__dir__, 'support'))
require_relative '../../sketchup_plugin/alma_sketchup_mcp'

module Sketchup
  class << self
    attr_accessor :active_model, :test_platform, :test_opener
    def platform; test_platform; end
    def open_file(target, **options); test_opener.call(target, options); end
  end
end

class SavedLifecycleModel
  attr_accessor :dirty, :revision, :complete, :on_close, :alive, :valid_failure
  attr_reader :path, :calls
  def initialize(path)
    @path, @calls = path, []
    @dirty, @alive, @complete = false, true, true
    @revision = "sha256:#{'a' * 64}"
  end
  def title; 'model'; end
  def guid; 'file-guid'; end
  def entities; []; end
  def valid?; raise 'native valid read failed' if @valid_failure; @alive; end
  def modified?; @dirty; end
  def start_operation(*); raise 'Document lifecycle must not start an undo operation'; end
  def close(ignore_changes)
    @calls << ['close', ignore_changes]
    @on_close ? @on_close.call : @alive = false
    nil
  end
end

class SavedModelLifecycleTest < Minitest::Test
  def setup
    @directory = File.realpath(Dir.mktmpdir('saved-model-lifecycle-'))
    @source = File.join(@directory, 'model.skp')
    File.write(@source, 'Offline synthetic saved bytes, not a native SKP.')
    @old, @other, @new = SavedLifecycleModel.new(@source), SavedLifecycleModel.new('other.skp'), SavedLifecycleModel.new(@source)
    @other.dirty = true
    @opens = []
    Sketchup.active_model = @old
    Sketchup.test_platform = :platform_osx
    Sketchup.test_opener = lambda do |target, options|
      refute @old.valid?, 'Opening cannot precede closed-handle evidence'
      @opens << [target, options]
      Sketchup.active_model = @new
      true
    end
    AlmaSketchupMCP.instance_variable_set(:@queue_request_model, @old)
    AlmaSketchupMCP.instance_variable_set(:@pending_open_request, nil)
    AlmaSketchupMCP.instance_variable_set(:@observed_active_model, nil)
    @params = { 'path' => @source, 'source_sha256' => Digest::SHA256.file(@source).hexdigest, 'source_bytes' => File.size(@source),
      'session_id' => AlmaSketchupMCP.bridge_session_id, 'document_id' => AlmaSketchupMCP.session_document_id(@old),
      'model_identity' => AlmaSketchupMCP.session_model_identity(@old), 'model_revision' => @old.revision,
      'delivery_task_id' => 'task_12345678-1234-4234-8234-123456789abc' }
    @revision_reader = ->(model, *_args) { { 'model_revision' => model.revision, 'complete' => model.complete } }
  end
  def teardown
    FileUtils.remove_entry(@directory)
    AlmaSketchupMCP.instance_variable_set(:@queue_request_model, nil)
    AlmaSketchupMCP.instance_variable_set(:@pending_open_request, nil)
    AlmaSketchupMCP.instance_variable_set(:@observed_active_model, nil)
  end
  def execute(params = @params)
    AlmaSketchupMCP.stub(:session_model_revision_report, @revision_reader) do
      AlmaSketchupMCP.stub(:snapshot, ->(model, **_options) { { 'model_revision' => model.revision } }) do
        AlmaSketchupMCP.close_reopen_saved_model(params)
      end
    end
  end
  def assert_no_close
    assert_empty @old.calls
    assert_empty @opens
    assert @old.valid?
    assert @other.dirty
  end
  def test_real_close_nil_result_is_confirmed_only_by_invalid_old_handle_then_disk_open
    result = execute
    assert_equal [['close', false]], @old.calls
    assert_equal [[@source, { with_status: true, show_version_warning_dialog: false }]], @opens
    assert result['close_confirmed']
    assert result['reopen_verified']
    assert result['new_document_identity_confirmed']
    assert_equal @params['document_id'], result['before_document_id']
    refute_equal result['before_document_id'], result['after_document_id']
    assert_equal false, result['after']['model_modified']
    assert_equal @params['model_revision'], result['after']['model_revision']
    assert_equal result['file_before'], result['file_after']
    assert_equal false, result['application_restarted']
    assert_equal false, result['automatic_retry_allowed']
    assert result['requires_fresh_session']
    assert @other.dirty
    assert_empty @other.calls
  end
  def test_unsaved_incomplete_or_changed_document_never_closes
    [-> { @old.dirty = true }, -> { @old.dirty = nil }, -> { @old.complete = false }, -> { @old.revision = "sha256:#{'b' * 64}" }].each do |change|
      @old.dirty = false; @old.complete = true; @old.revision = @params['model_revision']
      change.call
      assert_raises(AlmaSketchupMCP::QueueGuardError) { execute }
      assert_no_close
    end
  end
  def test_wrong_receipt_identity_path_or_file_bytes_never_closes
    [{ 'session_id' => 'other' }, { 'document_id' => 'other' }, { 'model_identity' => @params['model_identity'].merge('model_guid' => 'other') },
     { 'path' => File.join(@directory, 'other.skp') }, { 'source_sha256' => '0' * 64 }, { 'source_bytes' => File.size(@source) + 1 },
     { 'ignore_changes' => true }].each do |change|
      assert_raises(AlmaSketchupMCP::QueueGuardError) { execute(@params.merge(change)) }
      assert_no_close
    end
  end
  def test_windows_is_not_misrepresented_as_document_close
    Sketchup.test_platform = :platform_win
    assert_raises(AlmaSketchupMCP::QueueGuardError) { execute }
    assert_no_close
  end
  def test_focus_change_during_revision_probe_aborts_before_close
    @revision_reader = ->(model, *_args) { Sketchup.active_model = @other; { 'model_revision' => model.revision, 'complete' => true } }
    assert_raises(AlmaSketchupMCP::QueueGuardError) { execute }
    assert_no_close
  end
  def test_close_not_confirmed_does_not_open_or_retry
    @old.on_close = -> { nil }
    error = assert_raises(AlmaSketchupMCP::QueueOperationError) { execute }
    assert_equal false, error.details['close_confirmed']
    assert_equal false, error.details['automatic_retry_allowed']
    assert_equal [['close', false]], @old.calls
    assert_empty @opens
  end
  def test_close_raises_or_validity_read_fails_stops_with_unknown_outcome
    [-> { raise 'native close failed' }, -> { @old.alive = false; @old.valid_failure = true }].each do |failure|
      @old.alive = true; @old.valid_failure = false
      @old.on_close = failure
      error = assert_raises(AlmaSketchupMCP::QueueOperationError) { execute }
      assert_equal 'closing_saved_document', error.details['phase']
      assert_equal false, error.details['close_confirmed']
      assert_empty @opens
    end
  end
  def test_changed_disk_bytes_after_confirmed_close_stops_before_open
    @old.on_close = -> { @old.alive = false; File.write(@source, 'changed during close') }
    error = assert_raises(AlmaSketchupMCP::QueueOperationError) { execute }
    assert_equal true, error.details['close_confirmed']
    assert_equal 'checking_saved_bytes_after_close', error.details['phase']
    assert_empty @opens
  end
  def test_failed_open_is_not_retried
    Sketchup.test_opener = ->(target, _options) { @opens << target; false }
    error = assert_raises(AlmaSketchupMCP::QueueOperationError) { execute }
    assert_equal true, error.details['close_confirmed']
    assert_equal 'opening_saved_document', error.details['phase']
    assert_equal 1, @opens.length
    assert_equal [['close', false]], @old.calls
  end
  def test_pending_mdi_does_not_claim_new_active_identity_and_never_closes_other_document
    Sketchup.test_opener = ->(target, _options) { @opens << target; Sketchup.active_model = @other; true }
    result = execute
    assert_equal 'pending_mdi_activation', result['open_status']
    assert_equal true, result['close_confirmed']
    assert_equal false, result['reopen_verified']
    assert_equal false, result['new_document_identity_confirmed']
    assert_nil result['after']
    assert_nil result['after_document_id']
    assert_equal @source, AlmaSketchupMCP.instance_variable_get(:@pending_open_request)['target_path']
    assert_empty @other.calls
    assert @other.dirty
  end
  def test_changed_reopened_revision_cannot_be_counted_as_verified_reopen
    @new.revision = "sha256:#{'b' * 64}"
    result = execute
    assert_equal false, result['reopen_verified']
    assert_equal true, result['new_document_identity_confirmed']
    assert_equal true, result['close_confirmed']
    assert_equal 1, @opens.length
  end
  def test_queue_dispatch_requires_fresh_transport_guard_before_close
    error = assert_raises(AlmaSketchupMCP::QueueGuardError) { AlmaSketchupMCP.dispatch('close_reopen_saved_model', @params) }
    assert_equal 'HANDSHAKE_REQUIRED', error.code
    assert_no_close
  end
end
