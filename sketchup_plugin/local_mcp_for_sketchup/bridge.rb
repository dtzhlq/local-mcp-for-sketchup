# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'time'
require 'digest'
require 'stringio'
require 'base64'
require 'securerandom'
require 'sketchup.rb'

support_require = lambda do |relative_path|
  if defined?(Sketchup) && Sketchup.respond_to?(:require)
    Sketchup.require(relative_path)
  else
    require_relative File.basename(relative_path)
  end
end

support_require.call('local_mcp_for_sketchup/operation_registry')
support_require.call('local_mcp_for_sketchup/document_state')
support_require.call('local_mcp_for_sketchup/materials')
support_require.call('local_mcp_for_sketchup/appearance_operations')
support_require.call('local_mcp_for_sketchup/object_operations')
support_require.call('local_mcp_for_sketchup/geometry_operations')
support_require.call('local_mcp_for_sketchup/primitive_operations')
support_require.call('local_mcp_for_sketchup/product_operations')
support_require.call('local_mcp_for_sketchup/profile_operations')
support_require.call('local_mcp_for_sketchup/surface_operations')
support_require.call('local_mcp_for_sketchup/feature_operations')
support_require.call('local_mcp_for_sketchup/runtime_source_attestation')
LocalMcpForSketchUp::RuntimeSourceAttestation.attest_model_revision!(__dir__) do
  support_require.call('local_mcp_for_sketchup/model_revision')
end
LocalMcpForSketchUp::RuntimeSourceAttestation.attest_boolean_operations!(__dir__) do
  support_require.call('local_mcp_for_sketchup/boolean_operations')
end
support_require.call('local_mcp_for_sketchup/structural_probe')
support_require.call('local_mcp_for_sketchup/demo_operations')
support_require.call('local_mcp_for_sketchup/architecture_operations')
support_require.call('local_mcp_for_sketchup/component_operations')
support_require.call('local_mcp_for_sketchup/view_operations')
support_require.call('local_mcp_for_sketchup/snapshot')

module LocalMcpForSketchUp
  extend self

  STATE_DIR = File.expand_path(ENV.fetch('LOCAL_MCP_FOR_SKETCHUP_STATE_DIR', '~/.local-mcp-for-sketchup'))
  QUEUE_DIR = File.join(STATE_DIR, 'queue')
  PROCESSING_DIR = File.join(STATE_DIR, 'processing')
  RESPONSE_DIR = File.join(STATE_DIR, 'responses')
  MM_PER_INCH = 25.4
  DEFAULT_OPERATION_LIMIT = 2000
  PLUGIN_VERSION = '0.1.0-rc.4' unless const_defined?(:PLUGIN_VERSION)
  ATTRIBUTE_DICTIONARY = 'LocalMcpForSketchUp'.freeze
  LEGACY_ATTRIBUTE_DICTIONARIES = {
    ATTRIBUTE_DICTIONARY => 'AlmaSketchupMCP',
    'LocalMcpFeatures' => 'AlmaFeatures',
    'LocalMcpBoolean' => 'AlmaBoolean',
    'LocalMcpManifold' => 'AlmaManifold'
  }.freeze
  CAPABILITY_MANIFEST_VERSION = '2026-07-agent-contract-rc4.1'
  RUNTIME_CAPABILITY_VERSION = '0.1.0-rc.4-capabilities.1'
  OCCURRENCE_CONTRACT_VERSION = 'canonical-occurrence-path.v1'
  BOOLEAN_OPERATIONS_SHA256 = RuntimeSourceAttestation.loaded_boolean_operations_sha256
  MODEL_REVISION_SOURCE_SHA256 = RuntimeSourceAttestation.loaded_model_revision_sha256
  DSL_VERSION = 1
  GUARDED_QUEUE_METHODS = %w[
    reset_model build_model save_model save_model_version open_model import_model export_model
    adopt_open_model set_selection capture_view run_ruby_expert
  ].freeze
  MUTATION_UNCERTAIN_QUEUE_METHODS = %w[
    reset_model build_model save_model save_model_version open_model import_model export_model
    adopt_open_model set_selection capture_view run_ruby_expert
  ].freeze

  class QueueGuardError < StandardError
    NEXT_ACTIONS = {
      'HANDSHAKE_REQUIRED' => 'create_queue_handshake',
      'HANDSHAKE_SESSION_MISMATCH' => 'restart_bridge_then_create_queue_handshake',
      'HANDSHAKE_DOCUMENT_MISMATCH' => 'inspect_active_model_then_create_queue_handshake',
      'HANDSHAKE_MODEL_REVISION_MISMATCH' => 'prepare_new_plan_then_create_queue_handshake',
      'HANDSHAKE_PLUGIN_VERSION_MISMATCH' => 'restart_bridge_then_create_queue_handshake',
      'HANDSHAKE_CAPABILITIES_MISMATCH' => 'restart_bridge_then_create_queue_handshake',
      'OPERATION_NOT_ALLOWED' => 'prepare_new_plan'
    }.freeze

    attr_reader :code, :details

    def initialize(code, message, details = nil)
      super(message)
      @code = code
      @details = details
    end

    def response_payload
      {
        'code' => code,
        'message' => message,
        'retryable' => false,
        'next_action' => { 'action' => NEXT_ACTIONS.fetch(code, 'create_queue_handshake') },
        'details' => details
      }.compact
    end
  end

  class QueueOperationError < StandardError
    attr_reader :code, :details

    def initialize(message, details = nil)
      super(message)
      @code = 'MUTATION_EXECUTION_FAILED'
      @details = details
    end

    def response_payload
      {
        'code' => code,
        'message' => message,
        'retryable' => false,
        'next_action' => { 'action' => 'inspect_failure_then_start_new_task' },
        'details' => details
      }.compact
    end
  end

  class QueueResponsePersistenceError < StandardError; end

  def compatible_attribute(entity, dictionary, key, default_value = nil)
    return default_value unless entity&.respond_to?(:get_attribute)

    current = entity.get_attribute(dictionary, key)
    return current unless current.nil?

    legacy_dictionary = LEGACY_ATTRIBUTE_DICTIONARIES[dictionary]
    return default_value unless legacy_dictionary

    legacy = entity.get_attribute(legacy_dictionary, key)
    legacy.nil? ? default_value : legacy
  end

  def start
    FileUtils.mkdir_p(QUEUE_DIR)
    FileUtils.mkdir_p(PROCESSING_DIR)
    FileUtils.mkdir_p(RESPONSE_DIR)
    # Start is deliberately idempotent. Replacing a healthy timer here would
    # rotate the live session and invalidate fresh Session Contracts merely
    # because an operator clicked Start twice.
    if @timer_id
      announce_bridge_state('Local MCP for SketchUp Bridge is already running.')
      return @timer_id
    end
    @session_id = SecureRandom.uuid
    @session_started_at = Time.now.utc.iso8601
    install_document_activation_observer
    @timer_id = UI.start_timer(1.0, true) { process_pending_requests }
    announce_bridge_state('Local MCP for SketchUp Bridge is running.')
    @timer_id
  end

  def stop
    return unless @timer_id

    UI.stop_timer(@timer_id)
    @timer_id = nil
    announce_bridge_state('Local MCP for SketchUp Bridge stopped.')
  end

  def announce_bridge_state(message)
    Sketchup.status_text = message
    puts "[Local MCP for SketchUp] #{message}"
  rescue StandardError
    # Bridge lifecycle must not fail only because a host cannot display a
    # non-modal status update (for example, a headless test double).
    nil
  end

  def process_pending_requests
    # A retained claim means the previous outcome is unknown. Never execute a
    # later request until an operator has inspected that marker.
    return if Dir[File.join(PROCESSING_DIR, '*.json')].any?

    Dir[File.join(QUEUE_DIR, '*.json')].sort.each do |request_path|
      processing_path = claim_request(request_path)
      next unless processing_path

      request = nil
      request_id = File.basename(processing_path, '.json')
      response_body = begin
        request = JSON.parse(File.read(processing_path))
        request_id = request['id'] unless request['id'].nil?
        { result: dispatch(request['method'], request['params'] || {}) }
      rescue StandardError => error
        { error: queue_error_payload(error, request) }
      end

      response_persisted = false
      claim_released = false
      begin
        write_response(request_id, response_body)
        response_persisted = true
      rescue QueueResponsePersistenceError
        warn '[Local MCP for SketchUp] Queue response persistence failed; the claimed request is retained and queue processing is paused.'
      ensure
        if response_persisted && File.exist?(processing_path)
          begin
            File.delete(processing_path)
            claim_released = !File.exist?(processing_path)
          rescue StandardError
            warn '[Local MCP for SketchUp] A persisted response still has a claimed request marker; inspect queue diagnostics before continuing.'
          end
        elsif response_persisted
          claim_released = true
        end
      end

      # Continuing to execute later requests while responses cannot be made
      # durable would multiply outcome-unknown mutations. Leave every unclaimed
      # request in queue/ and require an operator to inspect the retained claim.
      break unless response_persisted && claim_released
    end
  end

  def claim_request(request_path)
    FileUtils.mkdir_p(PROCESSING_DIR)
    processing_path = File.join(PROCESSING_DIR, File.basename(request_path))
    raise "Refusing to replay claimed queue request: #{File.basename(request_path)}" if File.exist?(processing_path)

    File.rename(request_path, processing_path)
    processing_path
  rescue Errno::ENOENT
    nil
  end

  def add_warning(type, severity, message, source = nil)
    document_state_array('warnings') << {
      'type' => type,
      'severity' => severity,
      'category' => type.split('.').first,
      'message' => message,
      'source' => source
    }
  end

  def qa_metadata(operation)
    qa = operation['qa']
    return nil unless qa.is_a?(Hash)

    sanitized = {}
    %w[role part_id intent evidence_status fallback_state parent_part_id].each do |key|
      value = qa[key]
      sanitized[key] = value.to_s unless value.nil? || value.to_s.empty?
    end
    %w[evidence_sources feature_intents].each do |key|
      value = qa[key]
      sanitized[key] = value if value.is_a?(Array) || value.is_a?(Hash)
    end
    contacts = qa['expected_contacts'] || qa['expectedContacts']
    if contacts.is_a?(Array)
      sanitized['expected_contacts'] = contacts.each_with_object([]) do |contact, list|
        next unless contact.is_a?(Hash)

        with_name = contact['with'] || contact['object'] || contact['name']
        bucket = contact['bucket']
        next if with_name.to_s.empty? || bucket.to_s.empty?

        entry = { 'with' => with_name.to_s, 'bucket' => bucket.to_s }
        entry['note'] = contact['note'].to_s unless contact['note'].nil? || contact['note'].to_s.empty?
        list << entry
      end
    end
    sanitized.empty? ? nil : sanitized
  end

  def object_id(operation, fallback_name)
    raw = operation['id'] || operation['object_id'] || operation['objectId'] || operation['guid'] || fallback_name
    raw.to_s
  end

  def dispatch(method, params)
    params = (params || {}).dup
    # Reconcile the focused MDI document once, then pin it for the complete
    # request so the Session Contract guard and the operation cannot observe
    # different models if focus changes during the callback.
    @queue_request_model = reconcile_queue_active_model
    transport_guard = params.delete('_session_guard')
    assert_transport_guard!(method, params, transport_guard)
    case method
    when 'get_capabilities'
      get_capabilities
    when 'get_session_state'
      get_session_state
    when 'get_active_model_identity'
      get_active_model_identity
    when 'reset_model'
      reset_model
    when 'build_model'
      build_model(params.fetch('code'))
    when 'save_model'
      save_model(params['path'], params.fetch('keep_session', true))
    when 'save_model_version'
      save_model_version(params)
    when 'open_model'
      open_model(params['path'])
    when 'import_model'
      import_model(params)
    when 'export_model'
      export_model(params)
    when 'get_model_info'
      get_model_info
    when 'list_entities'
      list_entities(params)
    when 'inspect_model'
      inspect_model(params)
    when 'adopt_open_model'
      adopt_open_model(params)
    when 'get_selection'
      get_selection
    when 'set_selection'
      set_selection(params)
    when 'capture_view'
      capture_view(params)
    when 'run_ruby_expert'
      run_ruby_expert(params)
    else
      raise "Unknown method: #{method}"
    end
  ensure
    @queue_request_model = nil
  end

  def assert_transport_guard!(method, params, guard)
    guarded = GUARDED_QUEUE_METHODS.include?(method)
    guarded = false if method == 'adopt_open_model' &&
      (params['read_only'] == true || params['readOnly'] == true) &&
      !guard.is_a?(Hash)
    return unless guarded

    unless guard.is_a?(Hash)
      raise QueueGuardError.new('HANDSHAKE_REQUIRED', "A live Session Contract transport guard is required before #{method}.")
    end

    model = active_model_required("#{method} transport guard")
    assert_pending_open_target!(method, model)
    assert_transport_binding!(guard, 'session_id', bridge_session_id, 'HANDSHAKE_SESSION_MISMATCH')
    assert_transport_binding!(guard, 'document_id', session_document_id(model), 'HANDSHAKE_DOCUMENT_MISMATCH')
    assert_transport_binding!(guard, 'plugin_version', PLUGIN_VERSION, 'HANDSHAKE_PLUGIN_VERSION_MISMATCH')
    assert_transport_binding!(guard, 'capability_version', RUNTIME_CAPABILITY_VERSION, 'HANDSHAKE_CAPABILITIES_MISMATCH')
    assert_transport_binding!(guard, 'manifest_version', CAPABILITY_MANIFEST_VERSION, 'HANDSHAKE_CAPABILITIES_MISMATCH')
    assert_transport_binding!(guard, 'dsl_version', DSL_VERSION, 'HANDSHAKE_CAPABILITIES_MISMATCH')
    assert_transport_binding!(guard, 'model_revision_strategy', MODEL_REVISION_STRATEGY, 'HANDSHAKE_CAPABILITIES_MISMATCH')
    assert_transport_binding!(guard, 'model_revision_unique_entity_limit', MODEL_REVISION_UNIQUE_ENTITY_LIMIT, 'HANDSHAKE_CAPABILITIES_MISMATCH')
    assert_transport_binding!(guard, 'boolean_operations_sha256', BOOLEAN_OPERATIONS_SHA256, 'HANDSHAKE_CAPABILITIES_MISMATCH')
    assert_transport_binding!(guard, 'model_revision_source_sha256', MODEL_REVISION_SOURCE_SHA256, 'HANDSHAKE_CAPABILITIES_MISMATCH')
    if guard.key?('model_modified')
      current_modified = model.respond_to?(:modified?) ? model.modified? : nil
      assert_transport_binding!(guard, 'model_modified', current_modified, 'HANDSHAKE_MODEL_REVISION_MISMATCH')
    end
    if guard['model_revision']
      assert_transport_binding!(guard, 'model_revision', session_model_revision(model), 'HANDSHAKE_MODEL_REVISION_MISMATCH')
    end
    @pending_open_request = nil if pending_open_target_active?(model)
  end

  def assert_pending_open_target!(method, model)
    return unless @pending_open_request
    return if pending_open_target_active?(model)

    raise QueueGuardError.new(
      'HANDSHAKE_DOCUMENT_MISMATCH',
      "#{method} is blocked while SketchUp is still activating the model accepted by open_model. Focus the opened model, inspect session state, and create a fresh handshake.",
      { 'pending_open' => true, 'open_status' => 'pending_mdi_activation' }
    )
  end

  def pending_open_target_active?(model)
    @pending_open_request && same_file_path?(model_path(model), @pending_open_request['target_path'])
  end

  def assert_transport_binding!(guard, field, actual, code)
    expected = guard[field]
    return if !expected.nil? && expected == actual

    raise QueueGuardError.new(code, "The live queue transport guard no longer matches #{field}.", { 'field' => field })
  end

  def write_response(id, body)
    FileUtils.mkdir_p(RESPONSE_DIR)
    target = queue_response_path(id)
    temporary = File.join(
      RESPONSE_DIR,
      ".#{File.basename(target)}.#{Process.pid}-#{SecureRandom.hex(8)}.tmp"
    )
    payload = "#{JSON.pretty_generate(body)}\n"
    File.open(temporary, File::WRONLY | File::CREAT | File::EXCL, 0o600) do |file|
      file.write(payload)
      file.flush
      file.fsync
    end
    File.rename(temporary, target)
    true
  rescue StandardError
    begin
      File.delete(temporary) if temporary && File.exist?(temporary)
    rescue StandardError
      nil
    end
    raise QueueResponsePersistenceError, 'Queue response could not be persisted atomically.'
  end

  def queue_response_path(id)
    token = id.to_s
    unless token.match?(/\A[0-9A-Za-z][0-9A-Za-z._-]{0,200}\z/)
      raise QueueResponsePersistenceError, 'Queue response identifier is invalid.'
    end

    File.join(RESPONSE_DIR, "#{token}.json")
  end

  def queue_error_payload(error, request = nil)
    return error.response_payload if error.respond_to?(:response_payload)

    method = request.is_a?(Hash) ? request['method'].to_s : ''
    params = request.is_a?(Hash) && request['params'].is_a?(Hash) ? request['params'] : {}
    mutation_uncertain = MUTATION_UNCERTAIN_QUEUE_METHODS.include?(method)
    mutation_uncertain = false if method == 'adopt_open_model' && (params['read_only'] == true || params['readOnly'] == true)
    if mutation_uncertain
      return {
        'code' => 'MUTATION_EXECUTION_FAILED',
        'message' => 'The SketchUp operation failed after execution began. Inspect the active model before starting a new task.',
        'retryable' => false,
        'next_action' => { 'action' => 'inspect_failure_then_start_new_task' }
      }
    end

    {
      'code' => 'INTERNAL_ERROR',
      'message' => 'The SketchUp bridge could not complete the request.',
      'retryable' => false,
      'next_action' => { 'action' => 'inspect_queue_then_report' }
    }
  end

  def with_atomic_model_transaction(model, operation_name)
    operation_started = false
    commit_attempted = false
    committed = false
    start_ok = model.start_operation(operation_name, true)
    unless start_ok == true
      raise QueueOperationError.new(
        'SketchUp did not start the requested model transaction.',
        { 'phase' => 'start', 'commit_state' => 'not_started' }
      )
    end
    operation_started = true

    result = yield
    assert_queue_result_serializable!(result)
    # Once commit is called, SketchUp owns the transaction outcome. A false
    # return or exception is outcome-unknown and must never be followed by an
    # abort that could target a different/native transaction.
    commit_attempted = true
    operation_started = false
    commit_ok = model.commit_operation
    unless commit_ok == true
      raise QueueOperationError.new(
        'SketchUp did not confirm the requested model transaction commit.',
        { 'phase' => 'commit', 'commit_state' => 'outcome_unknown', 'commit_confirmed' => false }
      )
    end
    committed = true
    if result.is_a?(Hash)
      result['mutation_receipt'] = {
        'version' => 'mutation-receipt.v1',
        'kind' => 'sketchup_mutation_receipt',
        'operation' => operation_name.to_s,
        'commit_state' => 'committed',
        'committed_at' => Time.now.utc.iso8601
      }
    end
    result
  rescue StandardError => error
    abort_succeeded = nil
    if model && operation_started && !commit_attempted
      abort_succeeded = begin
        model.abort_operation == true
      rescue StandardError
        false
      end
    end
    discard_document_state_cache(model) if model

    if error.is_a?(QueueOperationError)
      error.details['abort_succeeded'] = abort_succeeded if error.details && !abort_succeeded.nil?
      raise error
    end

    if committed
      raise QueueOperationError.new(
        'The SketchUp transaction committed but its result could not be finalized.',
        { 'phase' => 'postcommit_finalize', 'commit_state' => 'committed', 'commit_confirmed' => true }
      )
    end

    if commit_attempted && !committed
      raise QueueOperationError.new(
        'SketchUp did not confirm the requested model transaction commit.',
        { 'phase' => 'commit', 'commit_state' => 'outcome_unknown', 'commit_confirmed' => false }
      )
    end

    details = {
      'phase' => 'precommit_execution',
      'commit_state' => 'not_committed',
      'abort_succeeded' => abort_succeeded
    }
    if error.is_a?(BooleanOperationFailure) && BOOLEAN_OPERATION_FAILURE_CODES.include?(error.operation_failure_code)
      details['operation_failure_code'] = error.operation_failure_code
    end
    raise QueueOperationError.new(
      'The SketchUp model transaction failed before commit.',
      details
    )
  end

  def assert_queue_result_serializable!(value)
    unless json_value?(value)
      raise QueueOperationError.new(
        'The SketchUp operation produced a non-JSON result before commit.',
        { 'phase' => 'precommit_serialization', 'commit_state' => 'not_committed' }
      )
    end

    JSON.parse(JSON.generate(value))
    value
  rescue JSON::GeneratorError, JSON::ParserError
    raise QueueOperationError.new(
      'The SketchUp operation produced a non-JSON result before commit.',
      { 'phase' => 'precommit_serialization', 'commit_state' => 'not_committed' }
    )
  end

  def get_capabilities
    {
      'name' => 'queue',
      'version' => PLUGIN_VERSION,
      'capability_version' => RUNTIME_CAPABILITY_VERSION,
      'manifest_version' => CAPABILITY_MANIFEST_VERSION,
      'dsl_version' => DSL_VERSION,
      'occurrence_contract' => OCCURRENCE_CONTRACT_VERSION,
      'boolean_operations_sha256' => BOOLEAN_OPERATIONS_SHA256,
      'model_revision_source_sha256' => MODEL_REVISION_SOURCE_SHA256,
      'model_revision' => {
        'strategy' => MODEL_REVISION_STRATEGY,
        'unique_entity_limit' => MODEL_REVISION_UNIQUE_ENTITY_LIMIT,
        'logical_occurrence_count' => 'complete_definition_graph_expansion'
      },
      'read_only_probes' => {
        'structural_groups' => {
          'version' => STRUCTURAL_GROUPS_VERSION,
          'operation' => 'adopt_open_model',
          'requires_read_only' => true,
          'default_limit' => DEFAULT_STRUCTURAL_GROUP_LIMIT,
          'max_limit' => MAX_STRUCTURAL_GROUP_LIMIT,
          'max_fresh_manifold_paths' => MAX_FRESH_MANIFOLD_PATHS,
          'projected_entity_types' => ['group'],
          'traversed_container_types' => %w[group component_instance],
          'fresh_manifold_method' => 'manifold_report',
          'leaf_entities_materialized' => false,
          'mutates_model' => false
        }
      },
      'supported_operations' => SUPPORTED_OPERATIONS,
      'operation_support' => operation_support_descriptor,
      'plugin' => {
        'name' => 'Local MCP for SketchUp Bridge',
        'version' => PLUGIN_VERSION,
        'sketchup_version' => Sketchup.version,
        'ruby_version' => RUBY_VERSION
      },
      'handshake' => {
        'transport' => 'file_queue',
        'session_id' => bridge_session_id,
        'session_started_at' => @session_started_at,
        'state_dir' => STATE_DIR,
        'queue_dir' => QUEUE_DIR,
        'response_dir' => RESPONSE_DIR,
        'checked_at' => Time.now.utc.iso8601
      },
      'notes' => 'Live capabilities reported by the installed SketchUp Ruby plugin.'
    }
  end

  def get_session_state
    model = active_model_required('get_session_state')
    identity = session_model_identity(model)
    revision = session_model_revision_report(model)
    {
      'kind' => 'queue_session_state',
      'runtime' => 'queue',
      'session_id' => bridge_session_id,
      'document_id' => session_document_id(model),
      'model_identity' => identity,
      'model_revision' => revision['model_revision'],
      'model_revision_complete' => revision['complete'],
      'model_revision_total_seen' => revision['recursive_total_seen'],
      'model_revision_indexed' => revision['recursive_indexed'],
      'model_revision_strategy' => revision['strategy'],
      'model_revision_unique_entity_limit' => MODEL_REVISION_UNIQUE_ENTITY_LIMIT,
      'model_revision_unique_entities' => revision['unique_entities'],
      'model_revision_reachable_definitions' => revision['reachable_definitions'],
      'model_revision_blockers' => revision['blockers'],
      'model_modified' => model.respond_to?(:modified?) ? model.modified? : nil,
      'plugin_version' => PLUGIN_VERSION,
      'queue_state' => 'idle',
      'capability_version' => RUNTIME_CAPABILITY_VERSION,
      'manifest_version' => CAPABILITY_MANIFEST_VERSION,
      'dsl_version' => DSL_VERSION,
      'occurrence_contract' => OCCURRENCE_CONTRACT_VERSION,
      'boolean_operations_sha256' => BOOLEAN_OPERATIONS_SHA256,
      'model_revision_source_sha256' => MODEL_REVISION_SOURCE_SHA256,
      'observed_at' => Time.now.utc.iso8601
    }
  end

  def get_active_model_identity
    model = active_model_required('get_active_model_identity')
    pending_before = !@pending_open_request.nil?
    pending_target_active = pending_before && pending_open_target_active?(model)
    @pending_open_request = nil if pending_target_active
    {
      'kind' => 'active_model_identity',
      'runtime' => 'queue',
      'session_id' => bridge_session_id,
      'document_id' => session_document_id(model),
      'model_identity' => session_model_identity(model),
      'model_modified' => model.respond_to?(:modified?) ? model.modified? : nil,
      'pending_open_before_probe' => pending_before,
      'pending_target_active' => pending_target_active,
      'pending_open' => !@pending_open_request.nil?,
      'activation_confirmed' => !pending_before || pending_target_active,
      'plugin_version' => PLUGIN_VERSION,
      'capability_version' => RUNTIME_CAPABILITY_VERSION,
      'manifest_version' => CAPABILITY_MANIFEST_VERSION,
      'observed_at' => Time.now.utc.iso8601
    }
  end

  def reset_model
    model = active_model_or_new('reset_model')
    assert_model_reset_preconditions(model)
    with_atomic_model_transaction(model, 'Local MCP Reset Model') do
      clear_model(model, preflight: false)
      clear_image_references(model)
      reset_document_state(model)
      persist_document_state(model)
      snapshot(model)
    end
  end

  def build_model(code)
    model = nil
    previous_document_state_model = @document_state_model
    document = parse_dsl(code)
    model = active_model_or_new('build_model')
    @document_state_model = model
    with_atomic_model_transaction(model, 'Local MCP Build Model') do
      document_state(model)['warnings'] = []
      document.fetch('operations').each do |operation|
        apply_operation(model, operation)
      end
      persist_document_state(model)
      snapshot(model)
    end
  ensure
    @document_state_model = previous_document_state_model
  end

  def save_model(path, keep_session)
    model = active_model_or_new('save_model')
    target = path.to_s.strip
    target = File.join(STATE_DIR, 'local-mcp-for-sketchup-model.skp') if target.empty?
    target = File.expand_path(target)
    FileUtils.mkdir_p(File.dirname(target))
    # Mutation paths persist document state inside their own transaction. Save
    # must remain a pure persistence operation so a failed save cannot leave a
    # newly written model attribute behind.
    result = { 'file_path' => target, 'snapshot' => snapshot(model) }
    assert_queue_result_serializable!(result)
    save_ok = model.save(target)
    unless save_ok == true && File.file?(target)
      raise QueueOperationError.new(
        'SketchUp did not confirm that the model was saved.',
        { 'phase' => 'save', 'save_confirmed' => false }
      )
    end
    reset_model unless keep_session
    result
  end

  def save_model_copy(path)
    model = active_model_or_new('save_model_version')
    target = path.to_s.strip
    target = File.join(STATE_DIR, 'local-mcp-for-sketchup-model-copy.skp') if target.empty?
    target = File.expand_path(target)
    parent = File.dirname(target)
    assert_save_copy_ancestor_chain!(parent, require_parent: false)
    FileUtils.mkdir_p(parent)
    assert_save_copy_ancestor_chain!(parent, require_parent: true)
    assert_save_copy_target_absent!(target)
    unless model.respond_to?(:save_copy)
      raise QueueOperationError.new(
        'This SketchUp runtime does not support identity-preserving model copies.',
        { 'phase' => 'save_copy', 'save_confirmed' => false }
      )
    end

    result = {
      'file_path' => target,
      'snapshot' => snapshot(model),
      'save_mode' => 'copy',
      'active_model_identity_preserved' => true
    }
    assert_queue_result_serializable!(result)
    # SketchUp's save_copy API has no file-descriptor/O_EXCL variant. Repeat
    # both checks immediately before the call to narrow, but not claim to
    # eliminate, the same-OS-account TOCTOU window.
    assert_save_copy_ancestor_chain!(parent, require_parent: true)
    assert_save_copy_target_absent!(target)
    save_ok = model.save_copy(target)
    unless save_ok == true && File.file?(target)
      raise QueueOperationError.new(
        'SketchUp did not confirm that the model copy was saved.',
        { 'phase' => 'save_copy', 'save_confirmed' => false }
      )
    end
    result
  end

  def save_model_version(params)
    keep_session = params.fetch('keep_session', true)
    target = versioned_model_path(params['path'] || params['base_path'], params['label'])
    result = if keep_session
               save_model_copy(target)
             else
               save_model(target, false).merge(
                 'save_mode' => 'save_as_and_reset',
                 'active_model_identity_preserved' => false
               )
             end
    result.merge('kind' => 'save_model_version')
  end

  def assert_save_copy_ancestor_chain!(parent, require_parent:)
    expanded_parent = File.expand_path(parent)
    current = expanded_parent
    loop do
      stat = begin
        File.lstat(current)
      rescue Errno::ENOENT
        nil
      end
      if stat&.symlink?
        raise QueueOperationError.new(
          'The model copy directory chain must not contain symbolic links.',
          { 'phase' => 'save_copy_preflight', 'save_confirmed' => false, 'ancestor_chain_verified' => false }
        )
      end
      if require_parent && current == expanded_parent && (!stat || !stat.directory?)
        raise QueueOperationError.new(
          'The model copy parent must be an existing real directory.',
          { 'phase' => 'save_copy_preflight', 'save_confirmed' => false, 'ancestor_chain_verified' => false }
        )
      end

      ancestor = File.dirname(current)
      break if ancestor == current

      current = ancestor
    end

    return true unless require_parent

    real_parent = File.expand_path(File.realpath(expanded_parent))
    unless real_parent.casecmp(expanded_parent).zero?
      raise QueueOperationError.new(
        'The model copy parent real path differs from its approved path.',
        { 'phase' => 'save_copy_preflight', 'save_confirmed' => false, 'ancestor_chain_verified' => false }
      )
    end
    true
  rescue SystemCallError
    raise QueueOperationError.new(
      'The model copy directory chain could not be verified.',
      { 'phase' => 'save_copy_preflight', 'save_confirmed' => false, 'ancestor_chain_verified' => false }
    )
  end

  def assert_save_copy_target_absent!(target)
    return true unless File.exist?(target) || File.symlink?(target)

    raise QueueOperationError.new(
      'The versioned model copy target already exists; overwrite is forbidden.',
      { 'phase' => 'save_copy_preflight', 'save_confirmed' => false, 'target_absent' => false }
    )
  end

  def open_model(path)
    target = non_empty_string(path, 'open_model.path')
    target = File.expand_path(target)
    raise "open_model.path does not exist: #{target}" unless File.exist?(target)
    raise 'Sketchup.open_file is unavailable in this SketchUp runtime' unless Sketchup.respond_to?(:open_file)

    open_result = begin
      Sketchup.open_file(target, with_status: true, show_version_warning_dialog: false)
    rescue ArgumentError
      Sketchup.open_file(target)
    end
    raise "Failed to open SketchUp model: #{target}" unless open_file_success?(open_result)

    observed_model = queue_active_model
    activated = document_model_alive?(observed_model) && same_file_path?(model_path(observed_model), target)
    base = {
      'kind' => 'open_model',
      'runtime' => 'queue',
      'file_path' => target,
      'open_status' => activated ? 'activated' : 'pending_mdi_activation',
      'opened' => true,
      'mutation_ready' => false,
      'requires_fresh_session' => true
    }
    if activated
      @pending_open_request = nil
      base['model_identity'] = session_model_identity(observed_model)
      base['snapshot'] = snapshot(observed_model)
      return base
    end

    @pending_open_request = {
      'target_path' => target,
      'requested_at' => Time.now.utc.iso8601,
      'requesting_model_object_id' => observed_model&.object_id&.to_s
    }
    base['pending'] = true
    base['next_action'] = {
      'action' => 'focus_opened_model_then_create_queue_handshake',
      'note' => 'macOS SketchUp may open the file in another document window after this queue callback returns.'
    }
    base['observed_model_identity'] = session_model_identity(observed_model) if document_model_alive?(observed_model)
    base
  end

  def import_model(params)
    model = active_model_or_new('import_model')
    target = non_empty_string(params['path'], 'import_model.path')
    target = File.expand_path(target)
    raise "import_model.path does not exist: #{target}" unless File.exist?(target)
    mode = (params['mode'] || 'append').to_s.downcase
    raise 'import_model.mode must be append or replace' unless %w[append replace].include?(mode)

    if mode == 'replace'
      raise QueueGuardError.new(
        'OPERATION_NOT_ALLOWED',
        'import_model mode=replace is disabled for the live queue because a failed import could erase the active model.',
        { 'operation' => 'import_model', 'runtime' => 'queue', 'requested_mode' => 'replace', 'model_state_preserved' => true }
      )
    end
    before_signature = snapshot_signature(snapshot(model))
    with_atomic_model_transaction(model, 'Local MCP Import Model') do
      import_result = if File.extname(target).downcase == '.skp'
                        import_skp_model(model, target)
                      else
                        raise 'SketchUp model import is unavailable in this runtime' unless model.respond_to?(:import)

                        ok = model.import(target)
                        raise 'SketchUp did not confirm the model import.' unless ok

                        { 'strategy' => 'model.import' }
                      end

      result_snapshot = snapshot(model)
      if snapshot_signature(result_snapshot) == before_signature
        raise 'import_model completed without a visible model change.'
      end
      {
        'kind' => 'import_model',
        'runtime' => 'queue',
        'file_path' => target,
        'mode' => mode,
        'import' => import_result,
        'snapshot' => result_snapshot
      }
    end
  end

  def export_model(params)
    model = active_model_or_new('export_model')
    target = non_empty_string(params['path'], 'export_model.path')
    target = File.expand_path(target)
    FileUtils.mkdir_p(File.dirname(target))
    raise 'SketchUp model export is unavailable in this runtime' unless model.respond_to?(:export)

    ok = model.export(target)
    raise "Failed to export model: #{target}" unless ok && File.exist?(target)

    {
      'kind' => 'export_model',
      'runtime' => 'queue',
      'format' => params['format'] || File.extname(target).delete_prefix('.'),
      'file_path' => target,
      'snapshot' => snapshot(model)
    }
  end

  def get_model_info
    model = active_model_or_new('get_model_info')
    model_info_payload(model, snapshot(model))
  end

  def model_info_payload(model, model_snapshot)
    {
      'kind' => 'model_info',
      'runtime' => 'queue',
      'units' => 'mm',
      'source_path' => model_path(model),
      'model_modified' => model.respond_to?(:modified?) ? model.modified? : nil,
      'totals' => model_snapshot['totals'],
      'bounding_box' => model_snapshot['bounding_box'],
      'counts' => {
        'groups' => model_snapshot['groups'].length,
        'instances' => model_snapshot['instances'].length,
        'component_definitions' => model_snapshot['component_definitions'].length,
        'classification_schemas' => model_snapshot['classification_schemas'].length,
        'materials' => model_snapshot['materials'].length,
        'tags' => model_snapshot['tags'].length,
        'scenes' => model_snapshot['scenes'].length,
        'image_references' => model_snapshot['image_references'].length
      },
      'warning_summary' => model_snapshot['warning_summary'],
      'material_names' => model_snapshot['material_names'],
      'component_definitions' => model_snapshot['component_definitions'],
      'component_definition_summaries' => model_snapshot['component_definition_summaries'],
      'classification_schemas' => model_snapshot['classification_schemas'],
      'tags' => model_snapshot['tags'],
      'scenes' => model_snapshot['scenes']
    }
  end

  def list_entities(params = {})
    model = active_model_or_new('list_entities')
    {
      'kind' => 'list_entities',
      'runtime' => 'queue',
      'entities' => filtered_entity_snapshots(snapshot(model), params)
    }
  end

  def inspect_model(params = {})
    model = active_model_or_new('inspect_model')
    model_snapshot = snapshot(model)
    result = {
      'kind' => 'inspect_model',
      'runtime' => 'queue',
      'model_info' => model_info_payload(model, model_snapshot),
      'selection' => get_selection['selection']
    }
    result['entities'] = filtered_entity_snapshots(model_snapshot, params) unless params['includeEntities'] == false || params['include_entities'] == false
    result['snapshot'] = model_snapshot if params['includeSnapshot'] == true || params['include_snapshot'] == true
    result
  end

  def adopt_open_model(params = {})
    read_only = params['read_only'] == true || params['readOnly'] == true
    structural_probe_options = normalize_structural_probe_options(params, read_only: read_only)
    model = read_only ? active_model_required('adopt_open_model read_only') : active_model_or_new('adopt_open_model')
    prefix = safe_adoption_token(params['prefix'] || 'adopted')
    force = params['force'] == true
    recursive = params['recursive'] == true
    recursive_limit = positive_integer(params['recursive_limit'] || params['recursiveLimit'] || 500, 'adopt_open_model.recursive_limit')
    adopted = 0
    existing = 0

    if read_only
      adoptable_entities(model).each do |entity|
        existing += 1 if entity_id(entity)
      end
      return adoption_result(
        model,
        read_only: true,
        adopted: adopted,
        existing: existing,
        recursive: recursive,
        recursive_limit: recursive_limit,
        structural_probe_options: structural_probe_options
      )
    end

    with_atomic_model_transaction(model, 'Local MCP Adopt Open Model') do
      adoptable_entities(model).each_with_index do |entity, index|
        current = entity_id(entity)
        if current && !force
          existing += 1
          next
        end
        adopted_id = adoption_id_for(entity, prefix, index)
        entity.set_attribute('LocalMcpForSketchUp', 'adopted_id', adopted_id)
        entity.set_attribute('LocalMcpForSketchUp', 'adoption_version', '2026-07-existing-model-editing.1')
        entity.set_attribute('LocalMcpForSketchUp', 'adopted_at', Time.now.utc.iso8601)
        adopted += 1
      end
      adoption_result(
        model,
        read_only: false,
        adopted: adopted,
        existing: existing,
        recursive: recursive,
        recursive_limit: recursive_limit,
        structural_probe_options: structural_probe_options
      )
    end
  end

  def adoption_result(model, read_only:, adopted:, existing:, recursive:, recursive_limit:, structural_probe_options:)
    model_snapshot = snapshot(model)
    entities = filtered_entity_snapshots(model_snapshot, { 'includeHidden' => true }).map do |entity|
      entity.merge(
        'editable' => true,
        'edit_scope' => 'top_level',
        'reference' => entity['id'] || entity['persistent_id'] || entity['name'],
        'allowed_operations' => occurrence_allowed_operations(entity['entity_type'])
      )
    end
    recursive_result = recursive ? recursive_entity_index(model, recursive_limit) : nil
    recursive_index = recursive_result ? recursive_result['entries'] : nil
    revision = session_model_revision_report(model, model_snapshot)
    result = {
      'kind' => 'adopt_open_model',
      'version' => '2026-07-existing-model-editing.1',
      'runtime' => 'queue',
      'read_only' => read_only,
      'adopted_count' => adopted,
      'existing_count' => existing,
      'entity_count' => entities.length,
      'recursive' => recursive,
      'occurrence_contract' => OCCURRENCE_CONTRACT_VERSION,
      'recursive_truncated' => recursive_result ? recursive_result['truncated'] : false,
      'recursive_total_seen' => recursive_result ? recursive_result['total_seen'] : 0,
      'read_only_nested_count' => recursive_index ? recursive_index.count { |entry| entry['editable'] == false } : 0,
      'editable_nested_count' => recursive_index ? recursive_index.count { |entry| entry['editable'] == true } : 0,
      'model_info' => model_info_payload(model, model_snapshot),
      'session_id' => bridge_session_id,
      'document_id' => session_document_id(model),
      'model_identity' => session_model_identity(model),
      'model_revision' => revision['model_revision'],
      'model_revision_complete' => revision['complete'],
      'model_revision_total_seen' => revision['recursive_total_seen'],
      'model_revision_indexed' => revision['recursive_indexed'],
      'model_revision_strategy' => revision['strategy'],
      'model_revision_unique_entity_limit' => MODEL_REVISION_UNIQUE_ENTITY_LIMIT,
      'model_revision_unique_entities' => revision['unique_entities'],
      'model_revision_reachable_definitions' => revision['reachable_definitions'],
      'model_revision_blockers' => revision['blockers'],
      'model_modified' => model.respond_to?(:modified?) ? model.modified? : nil,
      'classification_schemas' => model_snapshot['classification_schemas'],
      'component_definition_summaries' => model_snapshot['component_definition_summaries'],
      'entities' => entities,
      'recursive_index' => recursive_index,
      'snapshot' => model_snapshot
    }
    if structural_probe_options['structural_groups']
      result['structural_groups'] = structural_group_probe(
        model,
        limit: structural_probe_options['structural_group_limit'],
        fresh_paths: structural_probe_options['fresh_manifold_paths'],
        model_revision: revision['model_revision']
      )
    end
    result
  end

  def get_selection
    model = active_model_or_new('get_selection')
    selected = model.selection.to_a.select { |entity| selectable_entity?(entity) }.map { |entity| selection_entity_summary(entity) }
    {
      'kind' => 'get_selection',
      'runtime' => 'queue',
      'selection' => selected
    }
  end

  def set_selection(params)
    model = active_model_or_new('set_selection')
    mode = (params['mode'] || 'replace').to_s
    raise 'set_selection.mode must be replace, add, remove, or clear' unless %w[replace add remove clear].include?(mode)

    selected = apply_model_selection(model, mode, params['targets'] || [])
    {
      'kind' => 'set_selection',
      'runtime' => 'queue',
      'mode' => mode,
      'selection' => selected,
      'snapshot' => snapshot(model)
    }
  end

  def capture_view(params)
    model = active_model_required('capture_view')
    view_name = (params['view'] || 'current').to_s
    scene_name = params['scene'].to_s.strip
    width = positive_integer(params['width'] || 1280, 'capture_view.width')
    height = positive_integer(params['height'] || 720, 'capture_view.height')
    antialias = params.key?('antialias') ? !!params['antialias'] : true
    compression = params.key?('compression') ? params['compression'].to_f : 1.0
    zoom_extents = params.fetch('zoom_extents', true)
    server_visual_capture = params['server_visual_capture'] == true
    raise 'capture_view.compression must be between 0 and 1' if compression.negative? || compression > 1
    if server_visual_capture
      raise 'server visual capture requires view=current' unless view_name == 'current'
      raise 'server visual capture does not accept a scene' unless scene_name.empty?
      raise 'server visual capture requires zoom_extents=false' unless zoom_extents == false
    end

    target = params['path'].to_s.strip
    if target.empty?
      stamp = Time.now.utc.strftime('%Y%m%dT%H%M%SZ')
      target = File.join(STATE_DIR, 'captures', "capture-#{stamp}.png")
    end
    target = File.expand_path(target)
    FileUtils.mkdir_p(File.dirname(target))

    revision_before = session_model_revision_report(model)
    camera_before = camera_snapshot(model.active_view.camera)
    modified_before = model.respond_to?(:modified?) ? model.modified? : nil

    if scene_name.empty?
      apply_capture_camera(model, view_name, zoom_extents)
    else
      apply_capture_scene(model, scene_name, zoom_extents)
    end
    view = model.active_view
    view.refresh if view.respond_to?(:refresh)
    ok = view.write_image(target, width, height, antialias, compression)
    raise "Failed to capture SketchUp view to #{target}" unless ok && File.exist?(target)

    model_snapshot = snapshot(model)
    revision_after = session_model_revision_report(model, model_snapshot)
    camera_after = camera_snapshot(model.active_view.camera)
    modified_after = model.respond_to?(:modified?) ? model.modified? : nil
    state_unchanged = revision_before['complete'] == true &&
      revision_after['complete'] == true &&
      revision_before['model_revision'] == revision_after['model_revision']
    view_unchanged = camera_before == camera_after
    if server_visual_capture && (!state_unchanged || !view_unchanged || modified_before != modified_after)
      raise 'server visual capture changed SketchUp model or camera state'
    end
    {
      'kind' => 'capture_view',
      'runtime' => 'queue',
      'file_path' => target,
      'view' => view_name,
      'scene' => scene_name.empty? ? nil : scene_name,
      'width' => width,
      'height' => height,
      'antialias' => antialias,
      'compression' => compression,
      'camera' => camera_snapshot(view.camera),
      'captured_at' => Time.now.utc.iso8601,
      'read_only_attestation' => {
        'version' => 'capture-view-read-only-attestation.v1',
        'server_visual_capture' => server_visual_capture,
        'session_id' => bridge_session_id,
        'document_id' => session_document_id(model),
        'model_identity' => session_model_identity(model),
        'model_revision_before' => revision_before['model_revision'],
        'model_revision_after' => revision_after['model_revision'],
        'model_revision_complete_before' => revision_before['complete'],
        'model_revision_complete_after' => revision_after['complete'],
        'camera_before' => camera_before,
        'camera_after' => camera_after,
        'model_modified_before' => modified_before,
        'model_modified_after' => modified_after,
        'state_unchanged' => state_unchanged,
        'view_unchanged' => view_unchanged
      },
      'model_summary' => {
        'totals' => model_snapshot['totals'],
        'bounding_box' => model_snapshot['bounding_box'],
        'warning_summary' => model_snapshot['warning_summary'],
        'visible_object_count' => model_snapshot['totals']['groups'] + model_snapshot['totals']['instances'],
        'total_object_count' => model_snapshot['groups'].length + model_snapshot['instances'].length
      }
    }
  end

  def run_ruby_expert(params)
    audit_path = ruby_expert_audit_path(params['audit_path'])
    unless ENV['LOCAL_MCP_FOR_SKETCHUP_ENABLE_RUBY_EXPERT'] == '1'
      payload = {
        'kind' => 'run_ruby_expert',
        'runtime' => 'queue',
        'enabled' => false,
        'blocked' => true,
        'audit_path' => audit_path,
        'reason' => 'Set LOCAL_MCP_FOR_SKETCHUP_ENABLE_RUBY_EXPERT=1 before launching SketchUp to enable this destructive debug-only tool.'
      }
      write_ruby_expert_audit(audit_path, payload)
      return payload
    end

    code = params['code'].to_s
    raise 'run_ruby_expert requires non-empty Ruby code' if code.strip.empty?

    started_at = Time.now
    stdout_buffer = StringIO.new
    stderr_buffer = StringIO.new
    old_stdout = $stdout
    old_stderr = $stderr
    ok = true
    result_value = nil
    error_payload = nil

    begin
      $stdout = stdout_buffer
      $stderr = stderr_buffer
      result_value = TOPLEVEL_BINDING.eval(code)
    rescue Exception => error # rubocop:disable Lint/RescueException
      ok = false
      error_payload = {
        'class' => error.class.name,
        'message' => error.message,
        'backtrace' => (error.backtrace || [])[0, 20]
      }
    ensure
      $stdout = old_stdout
      $stderr = old_stderr
    end

    finished_at = Time.now
    payload = {
      'kind' => 'run_ruby_expert',
      'runtime' => 'queue',
      'enabled' => true,
      'blocked' => false,
      'ok' => ok,
      'audit_path' => audit_path,
      'started_at' => started_at.utc.iso8601,
      'finished_at' => finished_at.utc.iso8601,
      'elapsed_ms' => ((finished_at - started_at) * 1000).round,
      'code_sha256' => Digest::SHA256.hexdigest(code),
      'code' => code,
      'stdout' => stdout_buffer.string,
      'stderr' => stderr_buffer.string,
      'result' => ok ? ruby_expert_json_value(result_value) : nil,
      'error' => error_payload
    }
    write_ruby_expert_audit(audit_path, payload)
    payload
  end

  def active_model_or_new(method_name = 'queue runtime')
    model = queue_active_model
    return model if editable_model?(model)

    Sketchup.new_model if Sketchup.respond_to?(:new_model)
    model = queue_active_model
    return model if editable_model?(model)

    raise "#{method_name} requires an editable SketchUp active model. Open or create a model, then start the Local MCP for SketchUp Bridge again."
  end

  def active_model_required(method_name = 'queue runtime')
    model = queue_active_model
    return model if editable_model?(model)

    raise "#{method_name} requires an already open, editable SketchUp model. The fresh handshake does not create, reset, open, or modify a model."
  end

  def bridge_session_id
    @session_id ||= SecureRandom.uuid
  end

  def session_document_id(model)
    digest = Digest::SHA256.hexdigest([bridge_session_id, model.object_id.to_s].join(':'))
    "document_#{digest}"
  end

  def session_model_identity(model)
    {
      'model_guid' => model.respond_to?(:guid) ? model.guid.to_s : nil,
      'runtime_object_id' => model.object_id.to_s,
      'title' => model.respond_to?(:title) ? model.title.to_s : nil,
      'source_path' => model_path(model)
    }
  end

  def editable_model?(model)
    model && model.respond_to?(:entities) && model.respond_to?(:start_operation)
  end

  def apply_capture_camera(model, view_name, zoom_extents)
    view = model.active_view
    normalized = view_name.downcase
    return if normalized == 'current'

    bounds = model.bounds
    valid_bounds = bounds.respond_to?(:valid?) ? bounds.valid? : !model.entities.empty?
    return unless valid_bounds

    center = bounds.center
    distance = [bounds.diagonal * 1.8, mm_to_model_units(1000)].max
    camera_vectors = {
      'top' => [[0, 0, distance], [0, 1, 0]],
      'front' => [[0, -distance, 0], [0, 0, 1]],
      'back' => [[0, distance, 0], [0, 0, 1]],
      'right' => [[distance, 0, 0], [0, 0, 1]],
      'left' => [[-distance, 0, 0], [0, 0, 1]],
      'iso' => [[distance, -distance, distance], [0, 0, 1]]
    }
    vector_pair = camera_vectors[normalized]
    raise 'capture_view.view must be current, top, front, back, right, left, or iso' unless vector_pair

    eye_offset, up_vector = vector_pair
    eye = Geom::Point3d.new(center.x + eye_offset[0], center.y + eye_offset[1], center.z + eye_offset[2])
    view.camera = Sketchup::Camera.new(eye, center, Geom::Vector3d.new(*up_vector), true)
    view.zoom_extents if zoom_extents && view.respond_to?(:zoom_extents)
  end

  def apply_capture_scene(model, scene_name, zoom_extents)
    page = model.pages.find { |candidate| candidate.name == scene_name }
    raise "capture_view.scene not found: #{scene_name}" unless page

    model.pages.selected_page = page if model.pages.respond_to?(:selected_page=)
    if page.respond_to?(:camera) && page.camera
      model.active_view.camera = page.camera
    end
    model.active_view.zoom_extents if zoom_extents && model.active_view.respond_to?(:zoom_extents)
  end

  def camera_snapshot(camera)
    {
      'eye' => point_snapshot(camera.eye),
      'target' => point_snapshot(camera.target),
      'up' => [camera.up.x, camera.up.y, camera.up.z],
      'fov' => camera.respond_to?(:fov) ? camera.fov : nil
    }
  end

  def point_snapshot(point)
    [model_units_to_mm(point.x), model_units_to_mm(point.y), model_units_to_mm(point.z)]
  end

  def ruby_expert_audit_path(requested_path)
    target = requested_path.to_s.strip
    if target.empty?
      stamp = Time.now.utc.strftime('%Y%m%dT%H%M%SZ')
      target = File.join(STATE_DIR, 'audit', "run-ruby-expert-#{stamp}-#{rand(1_000_000)}.json")
    end
    File.expand_path(target)
  end

  def write_ruby_expert_audit(audit_path, payload)
    FileUtils.mkdir_p(File.dirname(audit_path))
    File.write(audit_path, JSON.pretty_generate(payload))
  end

  def ruby_expert_json_value(value, depth = 0)
    return value if value.nil? || value.is_a?(String) || value.is_a?(Numeric) || value == true || value == false
    return value.inspect if depth >= 4

    if value.is_a?(Array)
      return value.map { |item| ruby_expert_json_value(item, depth + 1) }
    end
    if value.is_a?(Hash)
      return value.each_with_object({}) do |(key, entry), result|
        result[key.to_s] = ruby_expert_json_value(entry, depth + 1)
      end
    end

    value.inspect
  end

  def active_model_path(model = nil)
    model_path(model || queue_active_model)
  end

  def open_file_success?(result)
    return true if result == true
    return false if result == false || result.nil?

    success_codes = []
    if defined?(Sketchup::Model::LOAD_STATUS_SUCCESS)
      success_codes << Sketchup::Model::LOAD_STATUS_SUCCESS
    end
    if defined?(Sketchup::Model::LOAD_STATUS_SUCCESS_MORE_RECENT)
      success_codes << Sketchup::Model::LOAD_STATUS_SUCCESS_MORE_RECENT
    end
    success_codes.empty? ? !!result : success_codes.include?(result)
  end

  def same_file_path?(left, right)
    return false if left.to_s.empty? || right.to_s.empty?

    File.expand_path(left).casecmp(File.expand_path(right)).zero?
  end

  def import_skp_model(model, target)
    definition = begin
      model.definitions.load(target, allow_newer: true)
    rescue ArgumentError
      model.definitions.load(target)
    end
    raise "Failed to load SketchUp component definition from #{target}" unless definition

    instance = model.entities.add_instance(definition, Geom::Transformation.new)
    instance.name = File.basename(target, File.extname(target)) if instance.name.to_s.empty?
    exploded = instance.explode
    {
      'strategy' => 'definitions.load+explode',
      'definition' => definition.name,
      'exploded_entities' => exploded.respond_to?(:length) ? exploded.length : nil
    }
  end

  def snapshot_signature(model_snapshot)
    totals = model_snapshot['totals'] || {}
    [
      totals['faces'],
      totals['edges'],
      totals['vertices'],
      totals['groups'],
      totals['instances'],
      (model_snapshot['component_definitions'] || []).length,
      (model_snapshot['materials'] || []).length
    ]
  end

  def versioned_model_path(requested_path, label)
    base = requested_path.to_s.strip
    base = File.join(STATE_DIR, 'local-mcp-for-sketchup-model.skp') if base.empty?
    expanded = File.expand_path(base)
    ext = File.extname(expanded)
    ext = '.skp' if ext.empty?
    stem = expanded.end_with?(ext) ? expanded[0...-ext.length] : expanded
    safe_label = label.to_s.strip
    safe_label = Time.now.utc.strftime('%Y%m%dT%H%M%SZ') if safe_label.empty?
    safe_label = safe_label.gsub(/[^a-zA-Z0-9._-]+/, '-').gsub(/^-|-$/, '')
    "#{stem}-#{safe_label}#{ext}"
  end

  def filtered_entity_snapshots(model_snapshot, params)
    include_hidden = params.key?('includeHidden') ? params['includeHidden'] : params.fetch('include_hidden', true)
    kind = params['kind']
    material = params['material']
    tag = params['tag']
    name_pattern = params['name']
    regex = name_pattern && !name_pattern.to_s.empty? ? Regexp.new(name_pattern.to_s, Regexp::IGNORECASE) : nil
    entities = model_snapshot['groups'].map { |item| item.merge('entity_type' => 'group') } +
               model_snapshot['instances'].map { |item| item.merge('entity_type' => 'component_instance') }
    entities.select do |item|
      next false if include_hidden == false && item['visible'] == false
      next false if kind && item['kind'] != kind
      next false if material && item['material'] != material
      next false if tag && item['tag'] != tag
      next false if regex && item['name'].to_s !~ regex

      true
    end.map do |item|
      {
        'id' => item['id'],
        'persistent_id' => item['persistent_id'],
        'name' => item['name'],
        'entity_type' => item['entity_type'],
        'kind' => item['kind'] || item['definition'] || item['entity_type'],
        'definition' => item['definition'],
        'visible' => item['visible'] != false,
        'locked' => item['locked'] == true,
        'faces' => item['faces'],
        'edges' => item['edges'],
        'vertices' => item['vertices'],
        'bounding_box' => item['bounding_box'],
        'material' => item['material'],
        'tag' => item['tag'],
        'classification' => item['classification'],
        'native_classification' => item['native_classification'],
        'attributes' => item['attributes'],
        'texture_transform' => item['texture_transform'],
        'face_uvs' => item['face_uvs'],
        'transform' => item['transform'],
        'features' => item['features'],
        'image' => item['image'],
        'qa' => item['qa']
      }
    end
  end

  def adoptable_entities(model)
    model.entities.grep(Sketchup::Group) + model.entities.grep(Sketchup::ComponentInstance)
  end

  def adoption_id_for(entity, prefix, index)
    persistent = entity_persistent_id(entity)
    entity_type = entity.is_a?(Sketchup::ComponentInstance) ? 'component-instance' : 'group'
    return "#{prefix}-#{safe_adoption_token(entity_type)}-#{safe_adoption_token(persistent)}" if persistent && !persistent.empty?

    raw_name = entity.respond_to?(:name) ? entity.name.to_s.strip : ''
    name = raw_name.empty? ? '' : safe_adoption_token(raw_name)
    "#{prefix}-#{safe_adoption_token(entity_type)}-#{name.empty? ? index + 1 : name}"
  end

  def safe_adoption_token(value)
    token = value.to_s.strip.gsub(/[^a-zA-Z0-9_-]+/, '-').gsub(/\A-+|-+\z/, '').downcase
    token.empty? ? 'adopted' : token
  end

  def recursive_entity_index(model, limit)
    state = {
      'entries' => [],
      'total_seen' => 0,
      'classification_schemas' => classification_schema_catalog(model),
      'native_classification_by_definition' => {}
    }
    counts = definition_occurrence_counts(model)
    walk_occurrence_entities(model, model.entities, [], [], counts, state, limit)
    {
      'entries' => state['entries'],
      'total_seen' => state['total_seen'],
      'truncated' => state['total_seen'] > limit
    }
  end

  def walk_occurrence_entities(model, entities, ancestors, definition_stack, counts, state, limit)
    entities.each do |entity|
      next unless selectable_entity?(entity)

      path_entities = ancestors + [entity]
      state['total_seen'] += 1
      state['entries'] << occurrence_entity_snapshot(entity, path_entities, counts, state) if state['entries'].length < limit
      next unless entity.is_a?(Sketchup::Group) || entity.is_a?(Sketchup::ComponentInstance)

      definition = entity.definition
      definition_key = entity_persistent_id(definition) || definition.name.to_s
      next if definition_stack.include?(definition_key)

      walk_occurrence_entities(model, definition.entities, path_entities, definition_stack + [definition_key], counts, state, limit)
    end
  end

  def definition_occurrence_counts(model)
    counts = Hash.new(0)
    walk = lambda do |entities, stack|
      entities.grep(Sketchup::Group).concat(entities.grep(Sketchup::ComponentInstance)).each do |instance|
        definition = instance.definition
        key = entity_persistent_id(definition) || definition.name.to_s
        counts[key] += 1
        next if stack.include?(key)

        walk.call(definition.entities, stack + [key])
      end
    end
    walk.call(model.entities, [])
    counts
  end

  def occurrence_entity_snapshot(entity, path_entities, counts, state)
    entity_type = if entity.is_a?(Sketchup::Group)
                    'group'
                  elsif entity.is_a?(Sketchup::ComponentInstance)
                    'component_instance'
                  elsif entity.is_a?(Sketchup::Face)
                    'face'
                  else
                    'edge'
                  end
    parent_instance = path_entities.length > 1 ? path_entities[-2] : nil
    definition = parent_instance && parent_instance.respond_to?(:definition) ? parent_instance.definition : nil
    definition_key = definition ? (entity_persistent_id(definition) || definition.name.to_s) : nil
    entity_definition = entity.respond_to?(:definition) ? entity.definition : definition
    native_classification = if entity_definition
                              state['native_classification_by_definition'][entity_definition.object_id] ||=
                                native_definition_classification_summary(entity_definition, state['classification_schemas'])
                            end
    affected_instance_count = definition_key ? counts[definition_key] : 1
    instance_path = Sketchup::InstancePath.new(path_entities)
    persistent_id_path = instance_path.persistent_id_path
    entity_path = "pid:#{persistent_id_path}"
    parent_entity_path = if path_entities.length > 1
                           "pid:#{Sketchup::InstancePath.new(path_entities[0...-1]).persistent_id_path}"
                         end
    legacy_path = if definition && %w[group component_instance].include?(entity_type)
                    definition_entity_path(definition.name, entity_type, entity_id(entity) || entity_persistent_id(entity))
                  end
    geometry_counts = occurrence_geometry_counts(entity)
    {
      'path' => entity_path,
      'entity_path' => entity_path,
      'persistent_id_path' => persistent_id_path,
      'parent_entity_path' => parent_entity_path,
      'path_segments' => occurrence_path_segments(path_entities),
      'legacy_entity_path' => legacy_path,
      'parent_definition' => definition&.name,
      'definition_name' => definition&.name,
      'definition_persistent_id' => definition ? entity_persistent_id(definition) : nil,
      'entity_definition_name' => entity_definition&.name,
      'entity_definition_persistent_id' => entity_definition ? entity_persistent_id(entity_definition) : nil,
      'reference' => entity_id(entity) || entity_persistent_id(entity),
      'name' => entity.respond_to?(:name) ? entity.name : nil,
      'entity_type' => entity_type,
      'kind' => entity_type,
      'persistent_id' => entity_persistent_id(entity),
      'transformation' => instance_path.transformation.to_a,
      'world_transform' => instance_path.transformation.to_a,
      'transform' => entity.respond_to?(:get_attribute) ? entity_object_transform(entity) : nil,
      'bounding_box' => entity.respond_to?(:bounds) ? bounds_hash(entity.bounds) : nil,
      'material' => entity.respond_to?(:material) && entity.material ? entity.material.name : nil,
      'back_material' => entity.is_a?(Sketchup::Face) && entity.back_material ? entity.back_material.name : nil,
      'tag' => entity.respond_to?(:layer) && entity.layer ? entity.layer.name : nil,
      'classification' => entity.respond_to?(:get_attribute) ? entity_classification(entity) : nil,
      'native_classification' => native_classification,
      'attributes' => entity.respond_to?(:get_attribute) ? entity_attributes(entity) : nil,
      'texture_transform' => entity.respond_to?(:get_attribute) ? entity_texture_transform(entity) : nil,
      'face_uvs' => entity.respond_to?(:get_attribute) ? entity_face_uvs(entity) : nil,
      'visible' => entity.respond_to?(:hidden?) ? !entity.hidden? : true,
      'locked' => entity.respond_to?(:locked?) ? entity.locked? : false,
      'soft' => entity.is_a?(Sketchup::Edge) ? entity.soft? : nil,
      'smooth' => entity.is_a?(Sketchup::Edge) ? entity.smooth? : nil,
      'geometry_summary' => occurrence_geometry_summary(entity),
      'faces' => geometry_counts['faces'],
      'edges' => geometry_counts['edges'],
      'vertices' => geometry_counts['vertices'],
      'features' => entity.respond_to?(:get_attribute) ? entity_features(entity) : [],
      'editable' => true,
      'edit_scope' => 'instance_path',
      'allowed_operations' => occurrence_allowed_operations(entity_type),
      'affected_instance_count' => affected_instance_count,
      'shared_definition' => affected_instance_count > 1,
      'instance_policy_required' => !definition.nil?,
      'warning' => definition ? 'Definition-wide edits affect every occurrence; use instance_policy=make_unique for one occurrence.' : nil
    }
  end

  def occurrence_path_segments(path_entities)
    path_entities.map do |path_entity|
      entity_type = if path_entity.is_a?(Sketchup::Group)
                      'group'
                    elsif path_entity.is_a?(Sketchup::ComponentInstance)
                      'component_instance'
                    elsif path_entity.is_a?(Sketchup::Face)
                      'face'
                    else
                      'edge'
                    end
      {
        'entity_type' => entity_type,
        'persistent_id' => entity_persistent_id(path_entity),
        'reference' => entity_id(path_entity) || entity_persistent_id(path_entity)
      }
    end
  end

  def occurrence_geometry_counts(entity)
    entities = if entity.is_a?(Sketchup::Group)
                 entity.entities
               elsif entity.is_a?(Sketchup::ComponentInstance)
                 entity.definition.entities
               end
    return { 'faces' => 0, 'edges' => 0, 'vertices' => 0 } unless entities

    edges = entities.grep(Sketchup::Edge)
    {
      'faces' => entities.grep(Sketchup::Face).length,
      'edges' => edges.length,
      'vertices' => edges.flat_map(&:vertices).uniq.length
    }
  end

  def occurrence_geometry_summary(entity)
    if entity.is_a?(Sketchup::Face)
      normal = entity.normal
      outer_loop = entity.outer_loop ? entity.outer_loop.vertices.map { |vertex| point_to_mm(vertex.position) } : entity.vertices.map { |vertex| point_to_mm(vertex.position) }
      holes = entity.loops
        .select { |loop| !loop.outer? }
        .map { |loop| loop.vertices.map { |vertex| point_to_mm(vertex.position) } }
      return {
        'type' => 'face',
        'normal' => [normal.x.round(6), normal.y.round(6), normal.z.round(6)],
        'area_mm2' => model_area_to_square_mm(entity.area),
        'outer_loop' => outer_loop,
        'holes' => holes,
        'loop_count' => 1 + holes.length,
        'edge_count' => entity.edges.length,
        'vertex_count' => outer_loop.length
      }
    end
    if entity.is_a?(Sketchup::Edge)
      return {
        'type' => 'edge',
        'length_mm' => model_units_to_mm(entity.length),
        'endpoints' => entity.vertices.map { |vertex| point_to_mm(vertex.position) },
        'adjacent_face_count' => entity.faces.length,
        'soft' => entity.soft?,
        'smooth' => entity.smooth?
      }
    end

    nil
  end

  def occurrence_allowed_operations(entity_type)
    case entity_type
    when 'face'
      %w[set_material set_face_material set_visibility attribute remove_attribute reverse_face pushpull_face erase_entities transform_entities]
    when 'edge'
      %w[set_visibility attribute remove_attribute set_edge_properties erase_entities transform_entities]
    else
      %w[delete rename set_material set_visibility transform_object assign_tag attribute remove_attribute classification texture_transform duplicate_entity replace_component_definition explode_entity erase_entities transform_entities cut_hole cut_slot cut_recess add_boss add_raised_rib boolean_union boolean_difference boolean_intersect manifold_check manifold_repair]
    end
  end

  def definition_instance_count(model, definition)
    entity_collections = [model.entities] + model.definitions.map(&:entities)
    entity_collections.sum do |entities|
      entities.grep(Sketchup::ComponentInstance).count { |instance| instance.definition == definition }
    end
  end

  def definition_entity_snapshot(entity, definition, affected_instance_count)
    entity_type = if entity.is_a?(Sketchup::Group)
                    'group'
                  elsif entity.is_a?(Sketchup::ComponentInstance)
                    'component_instance'
                  elsif entity.is_a?(Sketchup::Face)
                    'face'
                  else
                    'edge'
                  end
    stable_reference = entity_id(entity) || entity_persistent_id(entity)
    editable = %w[group component_instance].include?(entity_type)
    entity_path = editable ? definition_entity_path(definition.name, entity_type, stable_reference) : nil
    {
      'path' => entity_path || "definition-read-only:#{definition.name}/#{entity_type}:#{stable_reference}",
      'entity_path' => entity_path,
      'parent_definition' => definition.name,
      'definition_name' => definition.name,
      'reference' => stable_reference,
      'name' => entity.respond_to?(:name) ? entity.name : nil,
      'entity_type' => entity_type,
      'kind' => entity_type,
      'persistent_id' => entity_persistent_id(entity),
      'bounding_box' => entity.respond_to?(:bounds) ? bounds_hash(entity.bounds) : nil,
      'material' => entity.respond_to?(:material) && entity.material ? entity.material.name : nil,
      'visible' => entity.respond_to?(:hidden?) ? !entity.hidden? : true,
      'editable' => editable,
      'edit_scope' => editable ? 'component_definition' : 'nested_read_only',
      'allowed_operations' => editable ? occurrence_allowed_operations(entity_type) : [],
      'affected_instance_count' => affected_instance_count,
      'shared_definition' => affected_instance_count > 1,
      'instance_policy_required' => editable,
      'warning' => editable ? 'Definition-wide edits affect every instance; use instance_policy=make_unique with instance_id for a per-instance edit.' : 'Legacy definition-only indexes do not expose Face/Edge paths; use recursive occurrence indexing.'
    }
  end

  def definition_entity_path(definition_name, entity_type, stable_reference)
    "definition:#{encode_entity_path_token(definition_name)}/#{entity_type}:#{encode_entity_path_token(stable_reference)}"
  end

  def encode_entity_path_token(value)
    Base64.urlsafe_encode64(value.to_s, padding: false)
  end

  def decode_entity_path_token(value)
    token = value.to_s
    Base64.urlsafe_decode64(token + ('=' * ((4 - token.length % 4) % 4)))
  end

  def selectable_entity?(entity)
    entity.is_a?(Sketchup::Group) ||
      entity.is_a?(Sketchup::ComponentInstance) ||
      entity.is_a?(Sketchup::Face) ||
      entity.is_a?(Sketchup::Edge)
  end

  def selection_entity_summary(entity)
    if entity.is_a?(Sketchup::Face)
      return face_selection_summary(entity)
    elsif entity.is_a?(Sketchup::Edge)
      return edge_selection_summary(entity)
    end

    {
      'id' => entity_id(entity) || entity.name,
      'persistent_id' => entity_persistent_id(entity),
      'name' => entity.name,
      'entity_type' => entity.is_a?(Sketchup::ComponentInstance) ? 'component_instance' : 'group',
      'kind' => group_kind(entity) || (entity.is_a?(Sketchup::ComponentInstance) ? 'component_instance' : 'group'),
      'bounding_box' => bounds_hash(entity.bounds),
      'visible' => entity.respond_to?(:hidden?) ? !entity.hidden? : true
    }
  end

  def face_selection_summary(face)
    normal = face.normal
    outer_loop = face.outer_loop ? face.outer_loop.vertices.map { |vertex| point_to_mm(vertex.position) } : face.vertices.map { |vertex| point_to_mm(vertex.position) }
    holes = face.loops
      .select { |loop| !loop.outer? }
      .map { |loop| loop.vertices.map { |vertex| point_to_mm(vertex.position) } }
    {
      'id' => entity_id(face) || entity_persistent_id(face),
      'persistent_id' => entity_persistent_id(face),
      'name' => nil,
      'entity_type' => 'face',
      'kind' => 'face',
      'bounding_box' => bounds_hash(face.bounds),
      'visible' => face.respond_to?(:hidden?) ? !face.hidden? : true,
      'material' => face.material ? face.material.name : nil,
      'back_material' => face.back_material ? face.back_material.name : nil,
      'tag' => entity_tag_name(face),
      'normal' => [normal.x.round(6), normal.y.round(6), normal.z.round(6)],
      'area_mm2' => model_area_to_square_mm(face.area),
      'vertices' => outer_loop,
      'outer_loop' => outer_loop,
      'holes' => holes,
      'loop_count' => 1 + holes.length,
      'edge_count' => face.edges.length,
      'vertex_count' => outer_loop.length
    }
  end

  def edge_selection_summary(edge)
    {
      'id' => entity_id(edge) || entity_persistent_id(edge),
      'persistent_id' => entity_persistent_id(edge),
      'name' => nil,
      'entity_type' => 'edge',
      'kind' => 'edge',
      'bounding_box' => bounds_hash(edge.bounds),
      'visible' => edge.respond_to?(:hidden?) ? !edge.hidden? : true,
      'material' => edge.respond_to?(:material) && edge.material ? edge.material.name : nil,
      'tag' => entity_tag_name(edge),
      'length' => model_units_to_mm(edge.length),
      'vertices' => edge.vertices.map { |vertex| point_to_mm(vertex.position) }
    }
  end

  def point_to_mm(point)
    [model_units_to_mm(point.x), model_units_to_mm(point.y), model_units_to_mm(point.z)]
  end

  def model_area_to_square_mm(value)
    (value.to_f * MM_PER_INCH * MM_PER_INCH).round(6)
  end

  def find_selection_target(model, target)
    operation = selection_reference_operation(target)
    find_referenced_entity(model, operation, 'set_selection', allow_locked: true)
  rescue StandardError
    if target.is_a?(String)
      fallback = { 'name' => target }
      return find_referenced_entity(model, fallback, 'set_selection', allow_locked: true)
    end
    raise
  end

  def selection_reference_operation(target)
    return { 'target_id' => target } if target.is_a?(String)
    raise 'set_selection.targets entries must be strings or objects' unless target.is_a?(Hash)

    {
      'target_id' => target['target_id'] || target['targetId'] || target['id'] || target['object_id'] || target['objectId'] || target['guid'],
      'name' => target['name'] || target['target'] || target['object']
    }.compact
  end

  def positive_integer(value, field_name)
    number = Integer(value)
    raise "#{field_name} must be positive" unless number.positive?

    number
  rescue ArgumentError, TypeError
    raise "#{field_name} must be a positive integer"
  end


  def assert_model_reset_preconditions(model)
    active_path = model.respond_to?(:active_path) ? model.active_path : nil
    if active_path && !active_path.empty?
      raise 'reset_model refuses to mutate while a group or component edit path is active. Close the edit context, create a fresh handshake, and retry.'
    end

    locked_count = model.entities.to_a.count { |entity| entity.respond_to?(:locked?) && entity.locked? }
    return if locked_count.zero?

    raise "reset_model refuses to erase #{locked_count} locked top-level entities. Unlock them, create a fresh handshake, and retry."
  end

  def clear_model(model, preflight: true)
    assert_model_reset_preconditions(model) if preflight
    model.selection.clear if model.respond_to?(:selection) && model.selection.respond_to?(:clear)
    if model.respond_to?(:pages) && model.pages.respond_to?(:erase)
      model.pages.to_a.each { |page| model.pages.erase(page) }
    end
    model.entities.clear!
    model.definitions.purge_unused if model.definitions.respond_to?(:purge_unused)
    model.materials.purge_unused if model.materials.respond_to?(:purge_unused)
    model.layers.purge_unused if model.layers.respond_to?(:purge_unused)
    model.layers.purge_unused_folders if model.layers.respond_to?(:purge_unused_folders)
  end

  def parse_dsl(code)
    raise 'build_model requires a non-empty JSON DSL string' if code.to_s.strip.empty?

    document = JSON.parse(code)
    raise 'DSL version must be 1' unless document['version'] == 1
    raise 'Only millimeter units are supported in the MVP' if document['units'] && document['units'] != 'mm'
    raise 'DSL requires operations array' unless document['operations'].is_a?(Array)

    max_operations = operation_limit
    if document['operations'].length > max_operations
      raise "DSL operation limit exceeded: max #{max_operations} operations. Set LOCAL_MCP_FOR_SKETCHUP_MAX_OPERATIONS before launching SketchUp to raise this for trusted large models."
    end

    document
  rescue JSON::ParserError => error
    raise "build_model accepts JSON DSL only: #{error.message}"
  end

  def operation_limit
    raw = ENV['LOCAL_MCP_FOR_SKETCHUP_MAX_OPERATIONS'].to_s.strip
    return DEFAULT_OPERATION_LIMIT if raw.empty?

    limit = Integer(raw)
    raise 'LOCAL_MCP_FOR_SKETCHUP_MAX_OPERATIONS must be a positive integer' unless limit.positive?

    limit
  rescue ArgumentError
    raise 'LOCAL_MCP_FOR_SKETCHUP_MAX_OPERATIONS must be a positive integer'
  end

  def apply_operation(model, operation)
    case operation['op']
    when 'reset'
      clear_model(model)
      clear_image_references(model)
      reset_document_state(model)
    when 'material'
      ensure_material(operation)
    when 'tag'
      add_tag(model, operation)
    when 'assign_tag'
      assign_tag(model, operation)
    when 'attribute'
      set_object_attribute(model, operation)
    when 'remove_attribute'
      remove_object_attribute(model, operation)
    when 'classification'
      set_object_classification(model, operation)
    when 'texture_transform'
      set_object_texture_transform(model, operation)
    when 'uv_project_planar'
      set_object_texture_transform(model, operation.merge('projection' => 'planar'))
    when 'uv_project_box'
      set_object_texture_transform(model, operation.merge('projection' => 'box'))
    when 'face_uv'
      set_face_uv(model, operation)
    when 'image_reference'
      add_image_reference(model, operation)
    when 'delete'
      delete_object(model, operation)
    when 'rename'
      rename_object(model, operation)
    when 'set_material'
      set_object_material(model, operation)
    when 'set_face_material'
      set_face_material(model, operation)
    when 'set_visibility'
      set_object_visibility(model, operation)
    when 'transform_object'
      transform_object(model, operation)
    when 'set_edge_properties'
      set_edge_properties(model, operation)
    when 'reverse_face'
      reverse_face(model, operation)
    when 'pushpull_face'
      pushpull_face(model, operation)
    when 'duplicate_entity'
      duplicate_entity(model, operation)
    when 'replace_component_definition'
      replace_component_definition(model, operation)
    when 'explode_entity'
      explode_entity(model, operation)
    when 'erase_entities'
      erase_entities_operation(model, operation)
    when 'transform_entities'
      transform_entities_operation(model, operation)
    when 'level'
      add_level(model, operation)
    when 'box'
      add_box(model.entities, operation)
    when 'rounded_box'
      add_rounded_box(model.entities, operation)
    when 'beveled_panel'
      add_beveled_panel(model.entities, operation)
    when 'fillet'
      add_fillet(model.entities, operation)
    when 'chamfer'
      add_chamfer(model.entities, operation)
    when 'recess'
      add_recess(model.entities, operation)
    when 'engraved_line'
      add_engraved_line(model.entities, operation)
    when 'text_emboss'
      add_text_emboss(model.entities, operation)
    when 'text_engrave'
      add_text_engrave(model.entities, operation)
    when 'text_3d'
      add_text_3d(model.entities, operation)
    when 'slot'
      add_slot(model.entities, operation)
    when 'slot_array'
      add_slot_array(model.entities, operation)
    when 'rib'
      add_rib(model.entities, operation)
    when 'standoff_boss'
      add_standoff_boss(model.entities, operation)
    when 'button_on_panel'
      add_button_on_panel(model.entities, operation)
    when 'cut_hole'
      cut_hole(model, operation)
    when 'cut_slot'
      cut_slot(model, operation)
    when 'cut_recess'
      cut_recess(model, operation)
    when 'add_boss'
      add_boss(model, operation)
    when 'add_raised_rib'
      add_raised_rib(model, operation)
    when 'boolean_union'
      boolean_union(model, operation)
    when 'boolean_difference'
      boolean_difference(model, operation)
    when 'boolean_intersect'
      boolean_intersect(model, operation)
    when 'manifold_check'
      manifold_check(model, operation)
    when 'manifold_repair'
      manifold_repair(model, operation)
    when 'image_plane'
      add_image_plane(model.entities, operation)
    when 'floor_slab'
      add_floor_slab(model.entities, operation)
    when 'footprint_slab'
      add_footprint_slab(model.entities, operation)
    when 'wall'
      add_wall(model.entities, operation)
    when 'wall_path'
      add_wall_path(model.entities, operation)
    when 'curved_wall'
      add_curved_wall(model.entities, operation)
    when 'roof_footprint'
      add_roof_footprint(model.entities, operation)
    when 'hip_roof'
      add_hip_roof(model.entities, operation)
    when 'parapet_path'
      add_parapet_path(model.entities, operation)
    when 'curtain_wall'
      add_curtain_wall(model.entities, operation)
    when 'column_grid'
      add_column_grid(model.entities, operation)
    when 'path_surface'
      add_path_surface(model.entities, operation)
    when 'terrain_mesh'
      add_terrain_mesh(model.entities, operation)
    when 'parking_stall_array'
      add_parking_stall_array(model.entities, operation)
    when 'door'
      add_door(model.entities, operation)
    when 'window'
      add_window(model.entities, operation)
    when 'stairs'
      add_stairs(model.entities, operation)
    when 'railing'
      add_railing(model.entities, operation)
    when 'panel_with_openings'
      add_panel_with_openings(model.entities, operation)
    when 'boolean_cutout'
      add_boolean_cutout(model.entities, operation)
    when 'mesh'
      add_mesh(model.entities, operation)
    when 'geometry_input'
      add_geometry_input(model.entities, operation)
    when 'curve'
      add_curve(model.entities, operation)
    when 'arc_curve'
      add_arc_curve(model.entities, operation)
    when 'prism'
      add_prism(model.entities, operation)
    when 'face_with_holes'
      add_face_with_holes(model.entities, operation)
    when 'profile_extrude'
      add_profile_extrude(model.entities, operation)
    when 'gable_roof'
      add_gable_roof(model.entities, operation)
    when 'shed_roof'
      add_shed_roof(model.entities, operation)
    when 'cylinder'
      add_cylinder(model.entities, operation)
    when 'loft_between_profiles'
      add_loft_between_profiles(model.entities, operation)
    when 'shell_from_front_side_profiles'
      add_shell_from_front_side_profiles(model.entities, operation)
    when 'lofted_solid'
      add_lofted_solid(model.entities, operation)
    when 'face_on_cylinder'
      add_face_on_cylinder(model.entities, operation)
    when 'analog_stick'
      add_analog_stick(model.entities, operation)
    when 'screw_hole'
      add_screw_hole(model.entities, operation)
    when 'pipe_between_points'
      add_pipe_between_points(model.entities, operation)
    when 'swept_path'
      add_swept_path(model.entities, operation)
    when 'domed_surface'
      add_domed_surface(model.entities, operation)
    when 'bowed_panel'
      add_bowed_panel(model.entities, operation)
    when 'component_definition'
      add_component_definition(model, operation)
    when 'component_instance'
      add_component_instance(model, operation)
    when 'selection'
      apply_selection_operation(model, operation)
    when 'camera'
      set_camera(model, operation)
    when 'scene'
      add_scene(model, operation)
    when 'style'
      set_style(model, operation)
    when 'shadow'
      set_shadow(model, operation)
    when 'rendering_options'
      set_rendering_options(model, operation)
    when 'room'
      add_demo_room(model.entities, operation)
    else
      raise "Unsupported operation: #{operation['op']}"
    end
  end

  def object_reference(operation, op_name)
    raw_entity_path = operation['entity_path'] || operation['entityPath'] || operation['target_path'] || operation['targetPath']
    if raw_entity_path
      allowed = %w[delete rename set_material set_visibility transform_object assign_tag attribute remove_attribute classification texture_transform set_face_material reverse_face pushpull_face set_edge_properties duplicate_entity replace_component_definition explode_entity erase_entities transform_entities cut_hole cut_slot cut_recess add_boss add_raised_rib boolean_union boolean_difference boolean_intersect manifold_check manifold_repair]
      raise "#{op_name} does not support nested entity_path targets" unless allowed.include?(op_name)
      edit_scope = operation['edit_scope'] || operation['editScope']
      raise "#{op_name}.edit_scope must be component_definition or instance_path for nested targets" unless %w[component_definition instance_path].include?(edit_scope)
      instance_policy = operation['instance_policy'] || operation['instancePolicy']
      raise "#{op_name}.instance_policy must be definition_wide or make_unique for nested targets" unless %w[definition_wide make_unique].include?(instance_policy)
      instance_id = operation['instance_id'] || operation['instanceId']
      raise "#{op_name}.instance_id is required when instance_policy=make_unique" if instance_policy == 'make_unique' && instance_id.to_s.empty?

      return {
        'entity_path' => raw_entity_path.to_s,
        'edit_scope' => edit_scope,
        'instance_policy' => instance_policy,
        'instance_id' => instance_id&.to_s
      }.compact
    end
    raw_id = operation['target_id'] || operation['targetId'] || operation['id'] || operation['object_id'] || operation['objectId'] || operation['guid']
    raw_name = operation['name'] || operation['target'] || operation['object']
    reference = {}
    reference['id'] = raw_id.to_s unless raw_id.nil? || raw_id.to_s.empty?
    reference['name'] = raw_name.to_s unless raw_name.nil? || raw_name.to_s.empty?
    raise "#{op_name} requires target_id or name" if reference.empty?

    reference
  end

  def apply_selection_operation(model, operation)
    mode = (operation['mode'] || 'replace').to_s
    raise 'selection.mode must be replace, add, remove, or clear' unless %w[replace add remove clear].include?(mode)

    apply_model_selection(model, mode, operation['targets'] || [])
  end

  def apply_model_selection(model, mode, targets)
    targets = [targets] unless targets.is_a?(Array)
    selection = model.selection
    selection.clear if %w[replace clear].include?(mode)
    unless mode == 'clear'
      entities = targets.map { |target| find_selection_target(model, target) }
      if mode == 'remove'
        entities.each { |entity| selection.remove(entity) if selection.respond_to?(:remove) }
      else
        entities.each { |entity| selection.add(entity) }
      end
    end
    selection.to_a.select { |entity| selectable_entity?(entity) }.map { |entity| selection_entity_summary(entity) }
  end

  def reference_label(reference)
    [reference['entity_path'] ? "entity_path:#{reference['entity_path']}" : nil, reference['id'] ? "id:#{reference['id']}" : nil, reference['name'] ? "name:#{reference['name']}" : nil].compact.join(' ')
  end

  def find_referenced_entity(model, operation, op_name, allow_locked: false)
    reference = object_reference(operation, op_name)
    entity = if reference['entity_path']
               find_nested_definition_entity(model, reference, op_name, allow_locked: allow_locked)
             else
               candidate = selection_candidate_entities(model).find { |item| entity_matches_reference(item, reference) }
               raise "object not found: #{reference_label(reference)}" unless candidate

               candidate
             end
    assert_reference_entity_access!(entity, op_name, allow_locked: allow_locked)
  end

  def find_nested_definition_entity(model, reference, op_name, allow_locked: false)
    return find_persistent_path_entity(model, reference, op_name, allow_locked: allow_locked) if reference['entity_path'].start_with?('pid:')

    match = /\Adefinition:([^\/]+)\/(group|component_instance):([^\/]+)\z/.match(reference['entity_path'])
    raise 'entity_path must use definition:<token>/<group|component_instance>:<token>' unless match

    definition_name = decode_entity_path_token(match[1])
    entity_type = match[2]
    stable_reference = decode_entity_path_token(match[3])
    definition = model.definitions[definition_name]
    raise "component definition not found for entity_path: #{definition_name}" unless definition

    source_entities = entity_type == 'group' ? definition.entities.grep(Sketchup::Group) : definition.entities.grep(Sketchup::ComponentInstance)
    source_entity = source_entities.find { |entity| nested_entity_matches_reference(entity, stable_reference) }
    raise "nested object not found: #{reference_label(reference)}" unless source_entity
    assert_reference_entity_access!(source_entity, op_name, allow_locked: allow_locked)

    if reference['instance_policy'] == 'make_unique'
      instance = model.entities.grep(Sketchup::ComponentInstance).find do |candidate|
        [entity_id(candidate), entity_persistent_id(candidate), candidate.name].compact.map(&:to_s).include?(reference['instance_id'].to_s)
      end
      raise "make_unique instance not found: #{reference['instance_id']}" unless instance
      raise "make_unique instance #{reference['instance_id']} does not use definition #{definition_name}" unless instance.definition == definition
      assert_reference_entity_access!(instance, op_name, allow_locked: allow_locked)

      source_name = source_entity.respond_to?(:name) ? source_entity.name : nil
      source_index = source_entities.index(source_entity)
      instance.make_unique
      definition = instance.definition
      unique_entities = entity_type == 'group' ? definition.entities.grep(Sketchup::Group) : definition.entities.grep(Sketchup::ComponentInstance)
      source_entity = unique_entities.find { |entity| source_name && entity.respond_to?(:name) && entity.name == source_name } || unique_entities[source_index]
      raise "make_unique could not preserve nested target for #{op_name}" unless source_entity
    end

    source_entity
  end

  def find_persistent_path_entity(model, reference, op_name, allow_locked: false)
    pid_path = reference['entity_path'].delete_prefix('pid:')
    instance_path = model.instance_path_from_pid_path(pid_path)
    raise "persistent entity path not found: #{pid_path}" unless instance_path && instance_path.valid?

    path_entities = instance_path.to_a
    path_entities.each_with_index do |entity, index|
      role = index == path_entities.length - 1 ? 'target' : "ancestor[#{index}]"
      assert_reference_entity_access!(entity, op_name, allow_locked: allow_locked, role: role)
    end
    root = path_entities.first
    if reference['instance_policy'] == 'make_unique' && reference['instance_id']
      root_refs = [entity_id(root), entity_persistent_id(root), (root.respond_to?(:name) ? root.name : nil)].compact.map(&:to_s)
      raise "make_unique instance #{reference['instance_id']} does not match persistent path root" unless root_refs.include?(reference['instance_id'].to_s)
    end
    return path_entities.last unless reference['instance_policy'] == 'make_unique'

    make_unique_persistent_path(model, path_entities, op_name)
  end

  def assert_reference_entity_access!(entity, op_name, allow_locked: false, role: 'target')
    raise "#{op_name} #{role} is invalid" if entity.respond_to?(:valid?) && !entity.valid?
    if !allow_locked && entity.respond_to?(:locked?) && entity.locked?
      raise "#{op_name} #{role} is locked"
    end

    entity
  end

  def make_unique_persistent_path(model, path_entities, op_name)
    locators = []
    entities = model.entities
    path_entities.each do |entity|
      candidates = locator_candidates(entities, entity)
      locators << entity_locator(entity, candidates)
      entities = entity.respond_to?(:definition) ? entity.definition.entities : nil
      break unless entities
    end

    entities = model.entities
    resolved = nil
    locators.each_with_index do |locator, index|
      resolved = resolve_entity_locator(entities, locator)
      raise "make_unique could not preserve persistent target for #{op_name}" unless resolved
      break if index == locators.length - 1
      raise "make_unique path contains a non-instance ancestor for #{op_name}" unless resolved.respond_to?(:definition)

      resolved.make_unique if resolved.respond_to?(:make_unique)
      entities = resolved.definition.entities
    end
    resolved
  end

  def locator_candidates(entities, entity)
    return [] unless entities
    klass = entity.class
    entities.select { |candidate| candidate.class == klass }
  end

  def entity_locator(entity, candidates)
    {
      'class' => entity.class,
      'id' => entity_id(entity),
      'persistent_id' => entity_persistent_id(entity),
      'name' => entity.respond_to?(:name) ? entity.name.to_s : nil,
      'ordinal' => candidates.index(entity) || 0
    }
  end

  def resolve_entity_locator(entities, locator)
    candidates = entities.select { |candidate| candidate.class == locator['class'] }
    if locator['id']
      match = candidates.find { |candidate| entity_id(candidate).to_s == locator['id'].to_s }
      return match if match
    end
    if locator['persistent_id']
      match = candidates.find { |candidate| entity_persistent_id(candidate).to_s == locator['persistent_id'].to_s }
      return match if match
    end
    if locator['name'] && !locator['name'].empty?
      named = candidates.select { |candidate| candidate.respond_to?(:name) && candidate.name.to_s == locator['name'] }
      return named.first if named.length == 1
    end
    candidates[locator['ordinal']]
  end

  def nested_entity_matches_reference(entity, stable_reference)
    [entity_id(entity), entity_persistent_id(entity), (entity.respond_to?(:name) ? entity.name : nil)].compact.map(&:to_s).include?(stable_reference.to_s)
  end

  def selection_candidate_entities(model)
    collections = [model.entities]
    collections << model.active_entities if model.respond_to?(:active_entities) && model.active_entities != model.entities
    collections.compact.uniq.flat_map do |entities|
      entities.grep(Sketchup::Group) +
        entities.grep(Sketchup::ComponentInstance) +
        entities.grep(Sketchup::Face) +
        entities.grep(Sketchup::Edge)
    end
  end

  def entity_matches_reference(entity, reference)
    id_matches = !reference['id'] || [entity_id(entity), entity_persistent_id(entity)].compact.include?(reference['id'])
    name_matches = !reference['name'] || (entity.respond_to?(:name) && entity.name == reference['name'])
    id_matches && name_matches
  end

  def entity_id(entity)
    return nil unless entity.respond_to?(:get_attribute)

    raw = compatible_attribute(entity, ATTRIBUTE_DICTIONARY, 'id') ||
      compatible_attribute(entity, ATTRIBUTE_DICTIONARY, 'adopted_id')
    raw.nil? || raw.to_s.empty? ? nil : raw.to_s
  end

  def entity_persistent_id(entity)
    entity.respond_to?(:persistent_id) ? entity.persistent_id.to_s : nil
  end

  def integer_index(value, field_name, length)
    number = value.to_i
    raise "#{field_name} must be a valid vertex index" unless number.to_s == value.to_s && number >= 0 && number < length

    number
  end

  def soften_edges(group, mode)
    return unless mode

    group.entities.grep(Sketchup::Edge).each do |edge|
      if mode == 'coplanar'
        faces = edge.faces
        next unless faces.length == 2

        dot = faces[0].normal.dot(faces[1].normal)
        next unless dot > 0.999
      end
      edge.soft = true
      edge.smooth = true
    end
  end


  def boolean_value(value, field_name)
    return value if value == true || value == false
    if value.is_a?(String)
      normalized = value.strip.downcase
      return true if normalized == 'true'
      return false if normalized == 'false'
    end
    raise "#{field_name} must be a boolean"
  end

  def non_empty_string(value, field_name)
    raise "#{field_name} must be a non-empty string" unless value.is_a?(String) && !value.strip.empty?

    value
  end

  def json_value?(value)
    return true if value.nil? || value.is_a?(String) || value == true || value == false
    return value.finite? if value.is_a?(Numeric)
    return value.all? { |item| json_value?(item) } if value.is_a?(Array)
    return value.values.all? { |item| json_value?(item) } if value.is_a?(Hash)

    false
  end

  def color_hex(value, field_name)
    raise "#{field_name} must be a #rrggbb color" unless value.is_a?(String) && value.match?(/\A#[0-9a-fA-F]{6}\z/)

    value.downcase
  end

  def sketchup_color(value)
    hex = value.delete_prefix('#')
    Sketchup::Color.new(hex[0, 2].to_i(16), hex[2, 2].to_i(16), hex[4, 2].to_i(16))
  end

  def finite_number(value, field_name)
    number = value.to_f
    raise "#{field_name} must be a finite number" unless number.finite?

    number
  end

  def number_in_range(value, min, max, field_name)
    number = finite_number(value, field_name)
    raise "#{field_name} must be a number from #{min} to #{max}" if number < min || number > max

    number
  end

  def vector(value, field_name)
    raise "#{field_name} must be [x, y, z]" unless value.is_a?(Array) && value.length == 3

    value.each_with_index.map do |item, index|
      number = item.to_f
      raise "#{field_name}[#{index}] must be a finite number" unless number.finite?

      number
    end
  end

  def size2(value, field_name)
    raise "#{field_name} must be [width, height]" unless value.is_a?(Array) && value.length == 2

    value.each_with_index.map do |item, index|
      positive_number(item, nil, "#{field_name}[#{index}]")
    end
  end

  def uv_pair(value, field_name)
    raise "#{field_name} must be [u, v]" unless value.is_a?(Array) && value.length == 2

    value.each_with_index.map do |item, index|
      finite_number(item, "#{field_name}[#{index}]")
    end
  end

  def non_negative_number(value, fallback, field_name)
    number = value.nil? ? fallback : value.to_f
    raise "#{field_name} must be a non-negative number" unless number.respond_to?(:finite?) && number.finite? && number >= 0

    number
  end

  def integer_range(value, min, max, field_name)
    number = value.to_i
    raise "#{field_name} must be an integer from #{min} to #{max}" unless number.to_s == value.to_s && number >= min && number <= max

    number
  end

  def positive_number(value, fallback, field_name)
    number = value.nil? ? fallback : value.to_f
    raise "#{field_name} must be a positive number" unless number.respond_to?(:finite?) && number.finite? && number.positive?

    number
  end

  unless file_loaded?(__FILE__)
    menu = UI.menu('Plugins').add_submenu('Local MCP for SketchUp')
    menu.add_item('Start Bridge') { start }
    menu.add_item('Stop Bridge') { stop }
    file_loaded(__FILE__)
  end
end
