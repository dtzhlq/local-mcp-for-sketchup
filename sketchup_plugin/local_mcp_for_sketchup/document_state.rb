# frozen_string_literal: true

module LocalMcpForSketchUp
  extend self

  DOCUMENT_STATE_DICTIONARY = 'LocalMcpForSketchUp'.freeze
  LEGACY_DOCUMENT_STATE_DICTIONARY = 'AlmaSketchupMCP'.freeze
  DOCUMENT_STATE_ATTRIBUTE = 'document_state_v1'.freeze
  DOCUMENT_STATE_VERSION = 1
  DOCUMENT_STATE_MAX_BYTES = 1_000_000
  DOCUMENT_STATE_CACHE_LIMIT = 16
  DOCUMENT_STATE_ARRAY_FIELDS = %w[warnings scenes levels manifold_checks].freeze
  DOCUMENT_STATE_HASH_FIELDS = %w[view_state style_state shadow_state rendering_options_state].freeze

  class DocumentActivationObserver < Sketchup::AppObserver
    def expectsStartupModelNotifications
      true
    end

    def onActivateModel(model)
      LocalMcpForSketchUp.record_activated_model(model)
    end

    def onNewModel(model)
      LocalMcpForSketchUp.record_opened_model(model)
    end

    def onOpenModel(model)
      LocalMcpForSketchUp.record_opened_model(model)
    end

  end

  def install_document_activation_observer
    return @document_activation_observer if @document_activation_observer
    return nil unless Sketchup.respond_to?(:add_observer)

    @document_activation_observer = DocumentActivationObserver.new
    Sketchup.add_observer(@document_activation_observer)
    record_activated_model(Sketchup.active_model)
    @document_activation_observer
  end

  def record_activated_model(model)
    return nil unless document_model_alive?(model)

    @observed_active_model = model
    @observed_active_model_at = Time.now.utc.iso8601
    if @pending_open_request && same_file_path?(model_path(model), @pending_open_request['target_path'])
      @pending_open_request['activated_model_object_id'] = model.object_id.to_s
      @pending_open_request['activated_at'] = @observed_active_model_at
    end
    model
  end

  def record_opened_model(model)
    return nil unless document_model_alive?(model)

    @last_opened_model_object_id = model.object_id.to_s
    @last_opened_model_at = Time.now.utc.iso8601
    model
  end

  def forget_document_model(model)
    return unless model

    cache_key = model.object_id.to_s
    @document_states&.delete(cache_key)
    @document_state_cache_order&.delete(cache_key)
    @observed_active_model = nil if @observed_active_model.equal?(model)
  end

  def queue_active_model
    request_model = @queue_request_model
    return request_model if document_model_alive?(request_model)

    reconcile_queue_active_model
  end

  def reconcile_queue_active_model
    # Sketchup.active_model is authoritative for the document that currently
    # has focus. AppObserver callbacks are useful hints, but on macOS they are
    # not guaranteed to refresh our cache for every MDI window switch.
    active = Sketchup.active_model
    if document_model_alive?(active)
      record_activated_model(active) unless @observed_active_model.equal?(active)
      return active
    end

    observed = @observed_active_model
    return observed if document_model_alive?(observed)

    nil
  end

  def document_model_alive?(model)
    return false unless model && model.respond_to?(:entities) && model.respond_to?(:start_operation)
    return model.valid? if model.respond_to?(:valid?)

    true
  rescue StandardError
    false
  end

  def empty_document_state
    {
      'warnings' => [],
      'scenes' => [],
      'levels' => [],
      'manifold_checks' => [],
      'view_state' => nil,
      'style_state' => nil,
      'shadow_state' => nil,
      'rendering_options_state' => nil
    }
  end

  def document_state(model = nil)
    model ||= @document_state_model || active_model_required('document state')
    key = model.object_id.to_s
    signature = document_state_signature(model)
    @document_states ||= {}
    cached = @document_states[key]
    return cached['state'] if cached && cached['signature'] == signature

    state = load_persisted_document_state(model)
    @document_states[key] = { 'signature' => signature, 'state' => state }
    touch_document_state_cache(key)
    state
  end

  def reset_document_state(model, persist: false)
    key = model.object_id.to_s
    @document_states ||= {}
    @document_states[key] = {
      'signature' => document_state_signature(model),
      'state' => empty_document_state
    }
    touch_document_state_cache(key)
    persist_document_state(model) if persist
    @document_states[key]['state']
  end

  def discard_document_state_cache(model)
    return unless model

    key = model.object_id.to_s
    @document_states&.delete(key)
    @document_state_cache_order&.delete(key)
  end

  def persist_document_state(model, state = nil)
    state ||= document_state(model)
    payload = { 'version' => DOCUMENT_STATE_VERSION }
    DOCUMENT_STATE_ARRAY_FIELDS.each { |field| payload[field] = state[field] || [] }
    DOCUMENT_STATE_HASH_FIELDS.each { |field| payload[field] = state[field] }
    encoded = JSON.generate(payload)
    raise 'Local MCP document sidecar exceeds the 1 MB safety limit' if encoded.bytesize > DOCUMENT_STATE_MAX_BYTES

    model.set_attribute(DOCUMENT_STATE_DICTIONARY, DOCUMENT_STATE_ATTRIBUTE, encoded)
    state
  end

  def document_state_array(field, model = nil)
    state = document_state(model)
    state[field] = [] unless state[field].is_a?(Array)
    state[field]
  end

  def document_state_value(field, model = nil)
    document_state(model)[field]
  end

  def set_document_state_value(field, value, model = nil)
    document_state(model)[field] = value
  end

  def snapshot_scenes(model, state = nil)
    state ||= document_state(model)
    persisted_by_name = (state['scenes'] || []).each_with_object({}) do |scene, result|
      next unless scene.is_a?(Hash) && !scene['name'].to_s.empty?

      result[scene['name'].to_s] = scene
    end
    pages = model.pages.to_a
    return [] if pages.empty?

    pages.map do |page|
      name = page.name.to_s
      scene = (persisted_by_name[name] || {}).dup
      scene['name'] = name
      if !scene.key?('camera') && page.respond_to?(:camera) && page.camera
        scene['camera'] = camera_snapshot(page.camera)
      end
      if !scene.key?('transition_time') && page.respond_to?(:transition_time)
        scene['transition_time'] = page.transition_time
      end
      if !scene.key?('use_camera') && page.respond_to?(:use_camera?)
        scene['use_camera'] = page.use_camera?
      end
      scene
    end
  rescue StandardError
    state['scenes'] || []
  end

  def snapshot_view_state(model, state = nil)
    state ||= document_state(model)
    view = model.active_view
    return state['view_state'] unless view && view.respond_to?(:camera) && view.camera

    result = { 'camera' => camera_snapshot(view.camera) }
    selected_page = model.pages.selected_page if model.respond_to?(:pages) && model.pages.respond_to?(:selected_page)
    result['scene'] = selected_page.name.to_s if selected_page && selected_page.respond_to?(:name)
    result
  rescue StandardError
    state['view_state']
  end

  def model_path(model)
    return nil unless model && model.respond_to?(:path)

    path = model.path.to_s
    path.empty? ? nil : path
  rescue StandardError
    nil
  end

  private

  def document_state_signature(model)
    model.object_id.to_s
  end

  def load_persisted_document_state(model)
    state = empty_document_state
    if model.respond_to?(:get_attribute)
      raw = model.get_attribute(DOCUMENT_STATE_DICTIONARY, DOCUMENT_STATE_ATTRIBUTE)
      raw = model.get_attribute(LEGACY_DOCUMENT_STATE_DICTIONARY, DOCUMENT_STATE_ATTRIBUTE) if raw.nil?
    end
    return state if raw.nil? || raw.to_s.empty?
    raise 'stored sidecar exceeds the 1 MB safety limit' if raw.to_s.bytesize > DOCUMENT_STATE_MAX_BYTES

    parsed = JSON.parse(raw.to_s)
    raise 'stored sidecar must be a JSON object' unless parsed.is_a?(Hash)
    raise "unsupported stored sidecar version: #{parsed['version'].inspect}" unless parsed['version'] == DOCUMENT_STATE_VERSION

    DOCUMENT_STATE_ARRAY_FIELDS.each do |field|
      value = parsed[field]
      state[field] = value if value.is_a?(Array)
    end
    DOCUMENT_STATE_HASH_FIELDS.each do |field|
      value = parsed[field]
      state[field] = value if value.nil? || value.is_a?(Hash)
    end
    state
  rescue StandardError => error
    state = empty_document_state
    state['warnings'] << {
      'type' => 'state.sidecar_invalid',
      'severity' => 'warn',
      'category' => 'state',
      'message' => "Stored Local MCP document state was ignored: #{error.message}",
      'source' => 'model_attribute:document_state_v1'
    }
    state
  end

  def touch_document_state_cache(key)
    @document_state_cache_order ||= []
    @document_state_cache_order.delete(key)
    @document_state_cache_order << key
    while @document_state_cache_order.length > DOCUMENT_STATE_CACHE_LIMIT
      expired = @document_state_cache_order.shift
      @document_states.delete(expired)
    end
  end
end
