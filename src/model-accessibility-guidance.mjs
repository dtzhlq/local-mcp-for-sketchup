// Bounded guidance derived from persisted state, never from an Agent's success claim.
export function accessibilityStatus(task, envelope) {
  const result = envelope.result || {};
  const code = envelope.error?.code || '';
  const unknown = /MUTATION_|QUEUE_/.test(code) && (task.state === 'executing' || /RECOVERY|EXECUTION_FAILED/.test(code));
  const serverCaptureBlocked = Boolean(task.inputs?.task && task.private?.creation?.round?.capture_error);
  const recoveryClass = /APPROVAL_/.test(code) || task.state === 'awaiting_review' ? 'user_approval'
    : serverCaptureBlocked ? 'runtime_blocked'
    : /POLICY_|HANDSHAKE_|QUEUE_|INTERNAL_|MUTATION_|MODEL_IDENTITY_UNAVAILABLE/.test(code) ? 'runtime_blocked'
      : envelope.error?.details?.recovery_class || (task.state === 'awaiting_input' ? (result.quality_status === 'fail' ? 'self_correctable' : 'design_input') : code ? 'self_correctable' : null);
  return {
    execution_status: unknown ? 'outcome_unknown' : task.state,
    quality_status: result.quality_status || result.quality?.quality_status || 'not_evaluated',
    evidence_level: result.evidence_level || (['discover', 'preflight_model'].includes(task.intent) ? 'preflight_only' : 'not_established'),
    recovery_class: recoveryClass,
    resume: { tool: 'resume_agent_task', arguments: { task_id: task.task_id } },
    retry_rule: 'After an uncertain response, resume this task; never recreate with a new key.',
    repair_limit_per_part: 3,
    ...(serverCaptureBlocked ? { blocked_step: 'server_detail_capture', next_step: 'Resolve the capture/restoration problem, then submit reverify=true on this task; do not recreate geometry.' } : {})
  };
}

export function discoverCall(inputs = {}) {
  return { tool: 'start_agent_task', arguments: { intent: 'discover', instruction: 'Discover the next supported modeling step.', inputs } };
}

export const FIRST_USE_GUIDE = Object.freeze({
  units: 'mm',
  axes: 'Right-handed world: +X width, +Y depth, +Z up. Component geometry is local; placement origin is in world mm.',
  transform_order: 'Local geometry, optional mirror, Z rotation in degrees, then world translation. Common-task input currently supports rotation and translation only.',
  defaults: 'Design dimensions and world origin must be explicit. Declared construction defaults are shown in each task contract.',
  assets: 'discover topic=assets, query=<keyword> reads the local asset catalog. Parametric recipe dimensions are compiled bounds, not native imported geometry.',
  image_structure: 'Use image_artifact inputs.action=structure with domain building|interior|product, an image_handle, observations and optional helpers (lines, contours, boundaries). Direct understanding runs no CV by default. Preserve source_understanding for continuation. goal=complete_model accepts an explicit PartGraph plus assumptions; create_model consumes source_image_model after trusted plan review.',
  creation: 'Use inputs.task with intent=create_model, an explicit runtime (mock or queue), and an idempotency_key. Queue accepts connection_task_id from discover/connect. Preflight using intent=preflight_model first.',
  editing: 'Single instance: make_unique. All associated instances: definition_wide with explicit reviewed targets. Never replace existing objects via create_model.',
  evidence: 'A successful request or preflight is not geometry, appearance, or saved-file acceptance.',
  delivery: 'After required quality review and successful save, deliver the artifact and stop. Close/reopen validation is only for an explicit user request; untested lifecycle claims remain false.',
  recovery: 'Keep task_id and idempotency_key. Resume after uncertain responses; submit only the requested missing input. Local repair stops after three consecutive failures per part.'
});
