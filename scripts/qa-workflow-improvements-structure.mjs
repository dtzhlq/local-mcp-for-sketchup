// Imported by the native QA coordinator. No live calls occur on import.
// The caller owns the saved fixture document, scoped development policy and
// serial queue. This runner never installs, resets, saves, closes or reopens it.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { sha256Canonical } from '../src/agent-contract.mjs';
import { straightCorridorTask } from '../src/traditional-timber/examples.mjs';
import { adoptAssemblySummary } from '../src/model-accessibility-assembly-summary.mjs';

const TIMEOUT_MS = 300000;
const TOLERANCE_MM = 0.05;
const equal = (a, b, message) => assert.equal(sha256Canonical(a ?? null), sha256Canonical(b ?? null), message);
const close = (a, b, message) => assert.ok(Number.isFinite(a) && Math.abs(a - b) <= TOLERANCE_MM, `${message}: actual=${a}; expected=${b}`);
const publicError = error => ({ code: error?.code || 'QA_ASSERTION_FAILED', message: String(error?.message || error), ...(error?.details ? { details: error.details } : {}) });

function fixture(id) {
  const task = straightCorridorTask(id);
  task.parameters = { bay_lengths_mm: [1500, 1500], width_mm: 1000, column_height_mm: 2400, rise_mm: 350, eave_mm: 250 };
  task.assembly.assemblies = task.assembly.assemblies.filter(part => part.family !== 'rail_seat');
  Object.assign(task.assembly.assemblies.find(part => part.id === 'roof').parameters, { rafter_spacing_mm: 750, tile_detail: 'surface' });
  task.assembly.parameter_sources.bay_lengths_mm = { basis: 'selected', note: 'Compact native QA: two 1500 mm bays; insert/remove one explicit middle bay.' };
  task.assembly.simplifications.push('Surface roof tiles and 750 mm rafter spacing keep the QA fixture compact; columns, beams, purlins, rafters, roof boards and eaves remain present.');
  task.instances = [
    { id: `${id}-selected`, origin_mm: [12000, 2000, 0], rotation_z_deg: 90 },
    { id: `${id}-peer`, origin_mm: [17000, 2000, 0], rotation_z_deg: 0 }
  ];
  delete task.placement;
  return task;
}

function rootRow(report, target) {
  const rows = report.recursive_index.filter(row => row.parent_entity_path === null && row.entity_path === target.entity_path);
  assert.equal(rows.length, 1, `Exactly one native root must match ${target.entity_path}`);
  return rows[0];
}
function protectedRoot(row) {
  // Sharing counts may change after the selected occurrence splits. Native
  // definition identity, subtree digest, placement and user metadata may not.
  return Object.fromEntries(['entity_path', 'persistent_id', 'reference', 'name', 'entity_type', 'entity_definition_name',
    'entity_definition_persistent_id', 'geometry_summary', 'transform', 'transformation', 'world_transform', 'bounding_box',
    'material', 'back_material', 'tag', 'attributes', 'texture_transform', 'classification', 'visible', 'locked']
    .map(key => [key, row[key] ?? null]));
}
function placement(row) {
  assert.ok(Array.isArray(row.world_transform) && row.world_transform.length === 16, 'Native root must expose its complete world matrix.');
  return { entity_path: row.entity_path, world_transform: row.world_transform, transformation: row.transformation ?? null };
}
function rootLength(row) {
  const box = row.bounding_box;
  assert.ok(box && [box.min, box.max].every(point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)), 'Finite native root bounds are required.');
  // The selected corridor's local x axis is rotated 90 degrees into world y.
  return box.max[1] - box.min[1];
}
function assertSealedSource(record) {
  const { source_record_hash, ...body } = record;
  assert.equal(source_record_hash, sha256Canonical(body), 'Creation source seal must match its stored contents.');
  assert.equal(record.runtime, 'queue');
  assert.equal(record.entries.length, 2);
}

function stableNativeIdentity(report) {
  const identity = report.model_identity;
  assert.ok(report.document_id && report.session_id && identity?.runtime_object_id && identity?.source_path,
    'Stable native document, session, runtime object and saved source identities are required.');
  // SketchUp model_guid may change after replacing a definition in the same
  // open document. Bind the document/runtime/source identity independently.
  return { document_id: report.document_id, session_id: report.session_id, runtime_object_id: identity.runtime_object_id,
    source_path: identity.source_path, title: identity.title ?? null };
}

export async function runStructureNativeQA({ bridge, outputDir, resumeAfterInsert = false } = {}) {
  if (!bridge?.start_agent_task || !bridge?.submit_agent_task_input || !bridge?.taskStore?.getTask) throw new Error('An initialized local SketchUpBridge with its existing task store is required.');
  if (typeof outputDir !== 'string' || !path.isAbsolute(outputDir)) throw new Error('outputDir must be an absolute evidence directory.');
  const limits = bridge.executionPolicy?.resource_limits;
  for (const key of ['max_operations', 'max_affected_instances', 'max_recursive_entities']) {
    assert.ok(Number.isInteger(limits?.[key]) && limits[key] > 0, `A normalized host resource limit is required: ${key}`);
  }
  // Public reviewed budgets use recursive_limit, while host policy uses
  // max_recursive_entities. The compact fixture only needs a 10k readback cap.
  const budgets = { max_operations: Math.min(100, limits.max_operations), max_affected_instances: Math.min(40, limits.max_affected_instances),
    recursive_limit: Math.min(10000, limits.max_recursive_entities) };
  const recursiveLimit = budgets.recursive_limit;
  await fs.mkdir(outputDir, { recursive: true });
  assert.equal(typeof resumeAfterInsert, 'boolean', 'resumeAfterInsert must be explicitly true or false.');
  const readPrior = async label => JSON.parse(await fs.readFile(path.join(outputDir, `structure-${label}.json`), 'utf8'));
  const priorReport = resumeAfterInsert ? await readPrior('report') : null;
  if (priorReport) {
    assert.equal(priorReport.version, 'workflow-improvements-structure-native-qa.v1');
    assert.equal(priorReport.status, 'stopped_with_issue');
    assert.ok(priorReport.creation_task_id && priorReport.stages.some(stage => stage.stage === 'insert-native-readback'));
    assert.ok(!priorReport.stages.some(stage => stage.stage === 'dimension-start'), 'This entry resumes only the committed insertion checkpoint.');
    equal(priorReport.requested_review_budgets, budgets, 'Resume requires the same bounded review budgets.');
  }
  const artifactPrefix = resumeAfterInsert ? `structure-resume-after-insert-${crypto.randomUUID().slice(0, 8)}` : 'structure';
  const reportPath = path.join(outputDir, `${artifactPrefix}-report.json`);
  const runId = priorReport?.run_id || `structure-native-${crypto.randomUUID().slice(0, 8)}`;
  const report = { ...(priorReport || {}), version: 'workflow-improvements-structure-native-qa.v1', run_id: runId,
    started_at: priorReport?.started_at || new Date().toISOString(),
    status: 'running', ok: false, runtime: 'queue', evidence_level: 'not_established', fixture_additive: true,
    cold_reopen_performed: false, penetration_checked: false, bearing_capacity_checked: false, full_collision_sweep: false,
    tolerance_mm: TOLERANCE_MM, requested_review_budgets: budgets, host_resource_limits: limits,
    stages: [...(priorReport?.stages || [])], checks: [...(priorReport?.checks || [])], issues: [...(priorReport?.issues || [])], artifacts: [...(priorReport?.artifacts || [])],
    ...(priorReport ? { resumed_at: new Date().toISOString(), resume_checkpoint: 'completed_insert_before_qa_readback',
      prior_report_path: path.join(outputDir, 'structure-report.json'), preserved_prior_report_sha256: sha256Canonical(priorReport) } : {}) };
  // Never manufacture a second fixture after an interrupted run. Its task ids
  // and evidence stay available for explicit same-task recovery by the caller.
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' });
  const persist = () => fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  const write = async (label, value) => {
    const file = path.join(outputDir, `${artifactPrefix}-${label}.json`);
    await fs.writeFile(file, JSON.stringify(value, null, 2));
    report.artifacts.push(file);
    await persist();
    return value;
  };
  const call = async (label, operation) => {
    console.log(`[structure native QA] ${label}`);
    const start = Date.now();
    try {
      const result = await operation();
      await write(label, result);
      report.stages.push({ stage: label, elapsed_ms: Date.now() - start, task_id: result?.task_id ?? null,
        task_state: result?.task_state ?? null, ok: result?.ok !== false });
      await persist();
      return result;
    } catch (error) {
      const failure = publicError(error);
      await write(`${label}-error`, failure);
      report.stages.push({ stage: label, elapsed_ms: Date.now() - start, ok: false, error: failure });
      await persist();
      throw error;
    }
  };
  const assertEnvelope = (result, label) => assert.notEqual(result?.ok, false, `${label}: ${JSON.stringify(result?.error || result?.next_action)}`);
  const storedTask = async (taskId, label) => {
    const task = await bridge.taskStore.getTask(taskId, { includePrivate: true });
    const creation = task.private?.creation;
    // Read server-owned evidence only; never submit these fields as authority.
    await write(`${label}-server-evidence`, { task_id: task.task_id, state: task.state, result: task.result, last_error: task.last_error,
      artifacts: task.artifacts, next_action: task.next_action,
      ...(creation ? { creation: { runtime: creation.runtime, frozen_spec: creation.frozen_spec, parameter_source: creation.parameter_source,
        parameter_edit_support: creation.parameter_edit_support, occurrence_path_map: creation.occurrence_path_map,
        captures: creation.round?.captures, capture_error: creation.round?.capture_error, capture_diagnostics: creation.round?.capture_diagnostics,
        joint_measurements: creation.round?.joint_measurements, mutation_receipt: creation.round?.mutation_receipt } } : {}),
      parameter_execution: task.private?.parameter_execution, parameter_edit: task.private?.creation_parameter_edit,
      frozen_creation_verification: task.private?.frozen_creation_verification });
    return task;
  };
  const connect = async label => {
    const result = await call(`${label}-connect`, () => bridge.start_agent_task({ intent: 'discover', instruction: 'Connect to the current authorized native QA fixture.',
      idempotency_key: `${runId}:${label}:connect`, inputs: { topic: 'connect', runtime: 'queue', timeout_ms: TIMEOUT_MS } }));
    assertEnvelope(result, 'connect');
    assert.equal(result.task_state, 'completed', 'A completed native connection task is required.');
    return result.task_id;
  };
  const assessQuality = async (label, task, publicEnvelope) => {
    const quality = task.result?.quality, measures = quality?.native_joint_measurements || [];
    const summary = { stage: label, task_id: task.task_id, state: task.state, quality_accepted: task.result?.quality_accepted === true,
      quality_status: task.result?.quality_status ?? 'unverified', evidence_level: task.result?.evidence_level ?? 'not_established',
      quality_evidence_source: 'server_task_store_unprojected_result', public_evidence_level: publicEnvelope?.result?.evidence_level ?? null,
      native_joint_evidence_level: quality?.native_joint_evidence_level ?? 'unverified',
      native_surface_distance_passed: measures.length === 6 && measures.every(row => row.status === 'pass' && row.evidence_level === 'native_surface_distance'),
      native_joint_measurements: measures, measured_joint_count: measures.length, selected_member_pairs_only: true,
      penetration_checked: false, bearing_capacity_checked: false, full_collision_sweep: false,
      capture_error: task.private?.creation?.round?.capture_error ?? null, remaining: quality?.remaining || [] };
    await write(`${label}-quality`, summary);
    report.checks.push(summary);
    if (summary.public_evidence_level !== null && summary.public_evidence_level !== summary.evidence_level) {
      report.issues.push({ stage: label, code: 'PUBLIC_QUALITY_EVIDENCE_MISMATCH', public_evidence_level: summary.public_evidence_level, stored_evidence_level: summary.evidence_level });
    }
    if (!summary.quality_accepted || !summary.native_surface_distance_passed || summary.evidence_level !== 'live_runtime') {
      report.issues.push({ stage: label, code: 'NATIVE_QUALITY_NOT_ACCEPTED', quality_status: summary.quality_status,
        native_surface_distance_passed: summary.native_surface_distance_passed, capture_error: summary.capture_error, remaining: summary.remaining });
    }
    for (const [index, capture] of (task.private?.creation?.round?.captures || []).entries()) {
      if (!capture.path) continue;
      try {
        const destination = path.join(outputDir, `${artifactPrefix}-${label}-capture-${index}${path.extname(capture.path) || '.png'}`);
        await fs.copyFile(capture.path, destination);
        report.artifacts.push(destination);
      } catch (error) { report.issues.push({ stage: label, code: 'CAPTURE_EVIDENCE_COPY_FAILED', source: capture.path, error: publicError(error) }); }
    }
    await persist();
  };
  try {
    const initial = resumeAfterInsert ? await readPrior('before-fixture') : await call('before-fixture', () => bridge.adopt_open_model({ runtime: 'queue', read_only: true,
      assembly_projection: true, recursive: true, recursive_limit: recursiveLimit, timeoutMs: TIMEOUT_MS }));
    assert.equal(initial.runtime, 'queue');
    assert.equal(initial.model_revision_complete, true);
    assert.equal(initial.recursive_truncated, false);
    const background = (initial.recursive_index || []).filter(row => row.parent_entity_path === null).map(protectedRoot);
    const taskPlan = resumeAfterInsert ? await readPrior('fixture-plan') : fixture(runId);
    await write('fixture-plan', taskPlan);
    let created, originalTask;
    if (resumeAfterInsert) {
      created = await readPrior('create');
      const archived = await readPrior('create-server-evidence');
      assert.equal(created.task_id, priorReport.creation_task_id);
      assert.equal(archived.task_id, created.task_id);
      originalTask = { ...archived, private: { creation: archived.creation } };
    } else {
    const createRequest = { intent: 'create_model', instruction: 'Create two shared compact straight corridor QA instances additively. Preserve all existing roots.',
      idempotency_key: `${runId}:create`, inputs: { runtime: 'queue', task: taskPlan, timeout_ms: TIMEOUT_MS, recursive_limit: recursiveLimit,
        connection_task_id: await connect('create') } };
    created = await call('create', () => bridge.start_agent_task(createRequest));
    assertEnvelope(created, 'create_model');
    report.creation_task_id = created.task_id;
    originalTask = await storedTask(created.task_id, 'create');
    await assessQuality('create', originalTask, created);
    }
    const source = originalTask.private?.creation?.parameter_source;
    assert.ok(source, `Trusted creation parameter baseline unavailable: ${JSON.stringify(originalTask.private?.creation?.parameter_edit_support)}`);
    assertSealedSource(source);
    const selectedId = taskPlan.instances[0].id, peerId = taskPlan.instances[1].id;
    const entryFor = (record, id) => {
      const entries = record.entries.filter(entry => entry.logical_instance_id === id);
      assert.equal(entries.length, 1, `Exactly one source must bind ${id}`);
      return entries[0];
    };
    const selectedSource = entryFor(source, selectedId), peerSource = entryFor(source, peerId);
    assert.equal(selectedSource.source_definition, peerSource.source_definition, 'Fixture instances must initially share the same native definition.');
    const rootPaths = source.entries.map(entry => entry.target.entity_path);
    const read = label => call(`${label}-native-readback`, () => adoptAssemblySummary({ bridge, rootPaths, recursiveLimit, timeoutMs: TIMEOUT_MS }));
    const baseline = resumeAfterInsert ? await readPrior('baseline-native-readback') : await read('baseline');
    const selectedBefore = rootRow(baseline, selectedSource.target), peerBefore = rootRow(baseline, peerSource.target);
    assert.equal(peerBefore.geometry_summary?.type, 'assembly_merkle');
    assert.ok(peerBefore.geometry_summary.subtree_digest, 'Native peer subtree digest is required.');
    const baselineLength = rootLength(selectedBefore), selectedPlacement = placement(selectedBefore), peerProtection = protectedRoot(peerBefore);
    const initialFrozenHash = originalTask.private.creation.frozen_spec.hash;
    const checkReadback = (label, native, expectedGrowth) => {
      equal(stableNativeIdentity(native), stableNativeIdentity(baseline), 'Stable native document/runtime/source identity changed.');
      const selected = rootRow(native, selectedSource.target), peer = rootRow(native, peerSource.target);
      equal(placement(selected), selectedPlacement, 'Selected world placement changed.');
      equal(protectedRoot(peer), peerProtection, 'Shared peer geometry, placement, definition or metadata changed.');
      close(rootLength(selected) - baselineLength, expectedGrowth, 'Selected world-y extent change');
      for (const prior of background) equal(protectedRoot(rootRow(native, { entity_path: prior.entity_path })), prior, `Unrelated root changed: ${prior.entity_path}`);
      report.checks.push({ stage: label, native_bbox_delta_mm: rootLength(selected) - baselineLength, expected_delta_mm: expectedGrowth,
        selected_world_placement_preserved: true, peer_subtree_digest_preserved: true, peer_world_placement_preserved: true,
        background_roots_preserved: background.length, model_revision: native.model_revision });
    };
    checkReadback('baseline', baseline, 0);
    const checkSource = (label, current, bays, revision) => {
      const record = current.private.creation.parameter_source;
      assertSealedSource(record);
      assert.equal(record.parameter_revision, revision);
      assert.deepEqual(entryFor(record, selectedId).source.task.parameters.bay_lengths_mm, bays);
      equal(entryFor(record, peerId).source, peerSource.source, 'Peer semantic source changed.');
      equal(entryFor(record, peerId).identity_map, peerSource.identity_map, 'Peer identity mapping changed.');
      assert.equal(entryFor(record, peerId).source_definition, peerSource.source_definition);
      assert.equal(current.private.creation.frozen_spec.hash, initialFrozenHash, 'The original creation specification was overwritten.');
      report.checks.push({ stage: label, source_revision: revision, source_record_hash: record.source_record_hash,
        original_frozen_spec_preserved: true, peer_semantic_source_preserved: true, selected_bays_mm: bays });
      return record;
    };
    const verify = async (label, parameterTask, currentRecord, expectedLength, expectedColumns) => {
      const connectionTaskId = await connect(`${label}-verify`);
      const result = await call(`${label}-verify`, () => bridge.start_agent_task({ intent: 'verify_model', instruction: 'Verify every current source root at its own topology, using native measurements and server captures.',
        idempotency_key: `${runId}:${label}:verify`, inputs: { runtime: 'queue', creation_task_id: created.task_id,
          parameter_task_id: parameterTask.task_id, timeout_ms: TIMEOUT_MS, connection_task_id: connectionTaskId } }));
      assertEnvelope(result, 'verify_model');
      const verified = await storedTask(result.task_id, `${label}-verify`);
      const binding = verified.private?.frozen_creation_verification, spec = verified.private?.creation?.frozen_spec;
      assert.ok(binding?.integrity_hmac, 'Verification must have a signed server binding.');
      assert.equal(binding.edit_hash, parameterTask.private.creation_parameter_edit.edit_hash);
      assert.equal(binding.parameter_source_hash, currentRecord.source_record_hash);
      assert.equal(binding.verification_scope, 'all_current_creation_source_roots_each_at_its_own_parameter_version');
      assert.equal(spec.hash, sha256Canonical(spec.specification));
      assert.notEqual(spec.hash, initialFrozenHash);
      const values = spec.specification.compiler_expected_values.by_root;
      assert.equal(values.find(row => row.root_instance_id === selectedId)?.values.total_path_length_mm, expectedLength);
      assert.equal(values.find(row => row.root_instance_id === selectedId)?.values.column_count, expectedColumns);
      assert.equal(values.find(row => row.root_instance_id === peerId)?.values.total_path_length_mm, 3000);
      assert.equal(values.find(row => row.root_instance_id === peerId)?.values.column_count, 6);
      assert.equal(spec.specification.native_joint_checks.length, 6);
      report.checks.push({ stage: `${label}-verify`, frozen_spec_recompiled: true, each_root_uses_its_current_source: true,
        specification_hash: spec.hash, signed_edit_hash: binding.edit_hash, compiler_expected_values: values });
      await assessQuality(`${label}-verify`, verified, result);
    };
    const changes = [
      { label: 'insert', edit: { structure_change: { operation: 'insert_bay', segment_id: 'run', bay_index: 1, length_mm: 1600 } }, bays: [1500, 1600, 1500], growth: 1600, columns: 8 },
      { label: 'dimension', edit: { changes: { bay_lengths_mm: [1500, 1700, 1500] } }, bays: [1500, 1700, 1500], growth: 1700, columns: 8 },
      { label: 'remove', edit: { structure_change: { operation: 'remove_bay', segment_id: 'run', bay_index: 1 } }, bays: [1500, 1500], growth: 0, columns: 6 }
    ];
    let resumedInsertion = null;
    if (resumeAfterInsert) {
      const archivedParameter = await readPrior('insert-applied-server-evidence');
      const archivedSource = await readPrior('insert-source-server-evidence');
      const committedReadback = await readPrior('insert-native-readback');
      const started = await readPrior('insert-start');
      assert.equal(archivedParameter.task_id, started.task_id);
      assert.equal(archivedParameter.state, 'completed');
      const parameter = await storedTask(started.task_id, 'resume-insert-guard-task');
      assert.equal(parameter.intent, 'modify_design_parameters');
      assert.equal(parameter.state, 'completed');
      assert.equal(parameter.result.geometry_applied, true);
      assert.equal(parameter.private.parameter_execution.phase, 'completed');
      assert.equal(parameter.inputs.parameter_edit.creation_task_id, created.task_id);
      equal(parameter.inputs.parameter_edit.structure_change, changes[0].edit.structure_change, 'Resume requires the original insertion request.');
      equal(parameter.private.parameter_execution, archivedParameter.parameter_execution, 'Completed insertion execution record changed.');
      assert.equal(parameter.private.creation_parameter_edit.source_record_hash, source.source_record_hash);
      const current = await storedTask(created.task_id, 'resume-insert-guard-source');
      const currentRecord = checkSource('resume-insert-guard', current, changes[0].bays, 1);
      assert.equal(currentRecord.source_record_hash, archivedSource.creation.parameter_source.source_record_hash, 'Current source differs from the completed insertion checkpoint.');
      assert.equal(parameter.result.source_record_hash, currentRecord.source_record_hash);
      assert.equal(parameter.private.parameter_execution.parameter_source_hash_after, currentRecord.source_record_hash);
      const native = await read('resume-insert-guard');
      assert.equal(native.model_revision, committedReadback.model_revision, 'Native revision changed after the saved insertion readback; do not resume this checkpoint.');
      assert.equal(native.model_revision, parameter.result.model_revision);
      equal(stableNativeIdentity(native), stableNativeIdentity(committedReadback), 'The committed insertion belongs to another open document.');
      checkReadback('resume-insert-guard', native, 1600);
      const originalInputs = structuredClone(parameter.inputs);
      assert.ok(originalInputs.connection_task_id, 'Original public connection reference is required for an identical replay.');
      delete originalInputs.session_contract; // It is rematerialized from that exact server-owned connection task.
      const request = { intent: parameter.intent, instruction: parameter.instruction, idempotency_key: `${runId}:insert`, inputs: originalInputs };
      const appliedConnection = await readPrior('insert-apply-connect');
      const submission = { task_id: started.task_id, idempotency_key: `${runId}:insert:apply`, input: { connection_task_id: appliedConnection.task_id } };
      resumedInsertion = { request, started, parameter, submission, current, native };
      // Preserve the original report and error verbatim; resolve only the
      // disproven model_guid harness assertion after the real guards pass.
      const resolved = report.issues.filter(issue => issue.stage === 'insert-native-readback' && issue.code === 'ERR_ASSERTION' && issue.message.startsWith('Native model identity changed.'));
      report.resolved_harness_issues = resolved.map(issue => ({ ...issue, resolution: 'Current native revision, source hash and stable document/runtime/source identity match the committed insertion.' }));
      report.issues = report.issues.filter(issue => !resolved.includes(issue));
      await persist();
    }
    for (const [index, step] of changes.entries()) {
      let request, started, parameter, submission;
      const resumed = index === 0 ? resumedInsertion : null;
      if (resumed) ({ request, started, parameter, submission } = resumed);
      else {
      request = { intent: 'modify_design_parameters', instruction: `Native QA ${step.label}: modify only the selected corridor and retain the shared peer.`,
        idempotency_key: `${runId}:${step.label}`, inputs: { runtime: 'queue', timeout_ms: TIMEOUT_MS, recursive_limit: recursiveLimit, budgets: { ...budgets },
          connection_task_id: await connect(step.label), parameter_edit: { creation_task_id: created.task_id, scope: 'single', targets: [selectedSource.target], ...step.edit } } };
      started = await call(`${step.label}-start`, () => bridge.start_agent_task(request));
      assertEnvelope(started, `${step.label} plan`);
      parameter = await storedTask(started.task_id, `${step.label}-planned`);
      if (parameter.state !== 'completed') {
        assert.equal(parameter.state, 'awaiting_review', 'Only a ready reviewed parameter task may be submitted.');
        submission = { task_id: started.task_id, idempotency_key: `${runId}:${step.label}:apply`,
          input: { connection_task_id: await connect(`${step.label}-apply`) } };
        const applied = await call(`${step.label}-submit`, () => bridge.submit_agent_task_input(submission));
        assertEnvelope(applied, `${step.label} apply`);
        parameter = await storedTask(started.task_id, `${step.label}-applied`);
      }
      }
      assert.equal(parameter.state, 'completed', 'Scoped development policy must complete the reviewed replacement; no caller approval is injected.');
      assert.equal(parameter.result.geometry_applied, true);
      assert.equal(parameter.private.parameter_execution.phase, 'completed');
      assert.equal(parameter.private.parameter_execution.edit_hash, parameter.private.creation_parameter_edit.edit_hash);
      const current = resumed?.current || await storedTask(created.task_id, `${step.label}-source`);
      const currentRecord = checkSource(step.label, current, step.bays, index + 1);
      assert.equal(parameter.result.source_record_hash, currentRecord.source_record_hash);
      const native = resumed?.native || await read(step.label);
      checkReadback(step.label, native, step.growth);
      assert.equal(native.model_revision, parameter.result.model_revision);
      // Identical public requests must resolve to the original task/receipt.
      const replay = await call(`${step.label}-start-replay`, () => bridge.start_agent_task(request));
      assertEnvelope(replay, 'parameter start replay');
      assert.equal(replay.task_id, started.task_id);
      if (submission) {
        const submitReplay = await call(`${step.label}-submit-replay`, () => bridge.submit_agent_task_input(submission));
        assertEnvelope(submitReplay, 'parameter submit replay');
        assert.equal(submitReplay.task_id, started.task_id);
      }
      const replayedNative = await read(`${step.label}-replay`);
      assert.equal(replayedNative.model_revision, native.model_revision, 'Replay mutated native geometry.');
      const replayedSource = await storedTask(created.task_id, `${step.label}-replay-source`);
      assert.equal(replayedSource.private.creation.parameter_source.source_record_hash, currentRecord.source_record_hash, 'Replay advanced the semantic source.');
      report.checks.push({ stage: `${step.label}-replay`, same_task: true, native_revision_unchanged: true, source_revision_unchanged: true });
      await verify(step.label, parameter, currentRecord, 3000 + step.growth, step.columns);
    }
    report.workflow_completed = true;
    report.evidence_level = 'live_runtime_readback';
    report.ok = report.issues.length === 0;
    report.status = report.ok ? 'passed' : 'completed_with_quality_issues';
  } catch (error) {
    report.issues.push({ stage: report.stages.at(-1)?.stage || 'setup', ...publicError(error) });
    report.status = 'stopped_with_issue';
    report.workflow_completed = false;
    report.ok = false;
    // Preserve tasks and native geometry exactly where the failure occurred.
  }
  report.finished_at = new Date().toISOString();
  report.report_path = reportPath;
  await persist();
  return report;
}
