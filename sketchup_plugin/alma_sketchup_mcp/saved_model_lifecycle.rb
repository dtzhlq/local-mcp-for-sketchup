# frozen_string_literal: true

module AlmaSketchupMCP
  extend self

  # Internal queue action. The server supplies a verified signed delivery
  # receipt, never a caller-selected file. This lifecycle cannot be rolled back
  # with a SketchUp operation; a lost response must never cause a retry.
  def close_reopen_saved_model(params)
    fields = %w[path source_sha256 source_bytes session_id document_id model_identity model_revision delivery_task_id]
    unless params.is_a?(Hash) && (params.keys - fields).empty? && (fields - params.keys).empty?
      raise QueueGuardError.new('OPERATION_NOT_ALLOWED', 'Saved model lifecycle requires the exact server receipt binding.')
    end
    unless Sketchup.respond_to?(:platform) && Sketchup.platform == :platform_osx
      raise QueueGuardError.new('OPERATION_NOT_ALLOWED', 'Saved document close/reopen is currently supported only on macOS; Windows File/New is not this lifecycle.')
    end
    model = active_model_required('close_reopen_saved_model')
    unless model.respond_to?(:close) && model.respond_to?(:valid?) && model.valid? == true && Sketchup.active_model.equal?(model)
      raise QueueGuardError.new('OPERATION_NOT_ALLOWED', 'The exact active native document must support close and closed-handle verification.')
    end
    unless params['delivery_task_id'].to_s.match?(/\Atask_[0-9a-f-]{36}\z/i) && params['model_revision'].to_s.match?(/\Asha256:[0-9a-f]{64}\z/)
      raise QueueGuardError.new('OPERATION_NOT_ALLOWED', 'Saved lifecycle receipt identity or revision is malformed.')
    end
    before = saved_lifecycle_assert_model!(model, params)
    file = saved_lifecycle_assert_file!(params)
    # File hashing and full revision reads happen before the final dirtiness /
    # focus check. No timer, capture or temporary camera adjustment is used.
    saved_lifecycle_assert_model!(model, params)
    saved_lifecycle_assert_file!(params)
    unless model.modified? == false && Sketchup.active_model.equal?(model)
      raise QueueGuardError.new('OPERATION_NOT_ALLOWED', 'The saved document changed or lost focus before close.')
    end

    phase = 'closing_saved_document'
    close_confirmed = false
    opened = false
    begin
      model.close(false)
      # Model#close returns nil, including success. Model#valid? is the native
      # evidence that this exact old handle has been closed.
      close_confirmed = model.valid? == false
      raise 'Native close did not confirm that the exact old document was closed' unless close_confirmed

      forget_document_model(model)
      @queue_request_model = nil
      phase = 'checking_saved_bytes_after_close'
      saved_lifecycle_assert_file!(params)
      phase = 'opening_saved_document'
      result = open_model(params['path'])
      opened = result['opened'] == true
      phase = 'checking_reopened_document'
      after_file = saved_lifecycle_assert_file!(params)
      active = Sketchup.active_model
      activated = result['open_status'] == 'activated' && document_model_alive?(active)
      after = activated ? saved_lifecycle_model_state(active) : nil
      after_document_id = after && after['document_id']
      new_document = activated && !active.equal?(model) && after_document_id != before['document_id']
      reopened_verified = new_document && after['model_revision_complete'] == true && after['model_revision'] == params['model_revision'] &&
        after['model_modified'] == false && after['model_identity']['source_path'] == params['path']
      result.merge(
        'kind' => 'close_reopen_saved_model', 'version' => 'saved-model-lifecycle.v1',
        'delivery_task_id' => params['delivery_task_id'], 'close_confirmed' => true, 'close_ignore_changes' => false,
        'close_evidence' => 'original_native_model_valid_false_before_open',
        'before_document_id' => before['document_id'], 'after_document_id' => after_document_id,
        'before' => before, 'after' => after, 'file_before' => file, 'file_after' => after_file,
        'new_document_identity_confirmed' => new_document, 'reopen_verified' => reopened_verified,
        'application_restarted' => false, 'cold_application_restart' => false,
        'mutation_ready' => false, 'requires_fresh_session' => true, 'automatic_retry_allowed' => false
      )
    rescue StandardError => error
      raise QueueOperationError.new('The saved document lifecycle did not complete with verified native evidence. Inspect its recorded phase; never repeat the close automatically.',
        { 'phase' => phase, 'close_confirmed' => close_confirmed, 'opened' => opened,
          'before_document_id' => before['document_id'], 'delivery_task_id' => params['delivery_task_id'],
          'automatic_retry_allowed' => false, 'failure_class' => error.class.name })
    end
  end

  def saved_lifecycle_model_state(model)
    revision = session_model_revision_report(model)
    { 'session_id' => bridge_session_id, 'document_id' => session_document_id(model),
      'model_identity' => session_model_identity(model), 'model_revision' => revision['model_revision'],
      'model_revision_complete' => revision['complete'], 'model_modified' => model.respond_to?(:modified?) ? model.modified? : nil }
  end

  def saved_lifecycle_assert_model!(model, params)
    current = saved_lifecycle_model_state(model)
    unless Sketchup.active_model.equal?(model) && current['session_id'] == params['session_id'] && current['document_id'] == params['document_id'] &&
      current['model_identity'] == params['model_identity'] && current['model_identity']['source_path'] == params['path']
      raise QueueGuardError.new('HANDSHAKE_DOCUMENT_MISMATCH', 'The active native document does not match the signed saved-file receipt.')
    end
    unless current['model_revision_complete'] == true && current['model_revision'] == params['model_revision'] && current['model_modified'] == false
      raise QueueGuardError.new('HANDSHAKE_MODEL_REVISION_MISMATCH', 'Closing requires the exact complete saved revision and modified? false.')
    end
    current
  end

  def saved_lifecycle_assert_file!(params)
    target = params['path']
    unless target.is_a?(String) && File.expand_path(target) == target && File.extname(target).downcase == '.skp' &&
      !File.symlink?(target) && File.file?(target) && File.realpath(target) == target && params['source_sha256'].to_s.match?(/\A[0-9a-f]{64}\z/) &&
      params['source_bytes'].is_a?(Integer) && params['source_bytes'].positive?
      raise QueueGuardError.new('OPERATION_NOT_ALLOWED', 'The signed saved file must be a real, canonical SKP with byte and SHA evidence.')
    end
    bytes = File.size(target)
    sha = Digest::SHA256.file(target).hexdigest
    unless bytes == params['source_bytes'] && sha == params['source_sha256'] && File.size(target) == bytes && File.realpath(target) == target && !File.symlink?(target)
      raise QueueGuardError.new('OPERATION_NOT_ALLOWED', 'The saved file bytes changed after the verified delivery receipt.')
    end
    { 'bytes' => bytes, 'sha256' => sha }
  end
end
