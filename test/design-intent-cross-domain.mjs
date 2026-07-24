import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-design-intent-cross-domain-'));

try {
  const results = [];
  for (const domain of domainFixtures()) results.push(await runReviewedDomainLoop(domain));

  assert.deepEqual(results.map((result) => result.domain), ['building', 'product', 'interior']);
  assert.ok(results.every((result) => result.version_count === 2));
  assert.ok(results.every((result) => result.reopened_aligned === true));

  process.stdout.write(`${JSON.stringify({
    ok: true,
    runtime: 'mock-only-no-queue',
    domains: results,
    source_bound_reviewed_apply: true,
    trusted_user_approval_required: true,
    save_open_store_reload_reconcile: true,
    product_hole_rebuilt: true,
    shelf_array_two_to_four: true,
    shelf_persisted_entity_refs: 4,
    identity_stable_after_reopen: true
  }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function runReviewedDomainLoop(domain) {
  const domainRoot = path.join(root, domain.name);
  const options = {
    mock: { sessionPath: path.join(domainRoot, 'mock-session.json') },
    agentContract: { rootDir: path.join(domainRoot, 'agent-state') },
    approval: {
      stateDir: path.join(domainRoot, 'approvals'),
      secret: `design-intent-cross-domain-${domain.name}-secret-is-at-least-32-bytes`
    },
    executionPolicy: { allowed_runtimes: ['mock'], auto_approve_risks: [] }
  };
  const bridge = new SketchUpBridge(options);
  await bridge.build_model({ runtime: 'mock', code: JSON.stringify(domain.document) });

  const proposed = await bridge.start_agent_task({
    intent: 'modify_design_parameters',
    instruction: domain.instruction,
    idempotency_key: `${domain.name}-design-proposal-v1`,
    inputs: {
      runtime: 'mock',
      save_model: false,
      parametric_recipe: domain.parametricRecipe,
      feature_mapping_plan: domain.featureMappingPlan,
      part_graph: domain.partGraph,
      entity_bindings: domain.entityBindings,
      changes: domain.changes
    }
  });
  assert.equal(proposed.ok, true, JSON.stringify(proposed.error));
  assert.equal(proposed.task_state, 'awaiting_review');
  assert.equal(proposed.data.change_plan.model_key, proposed.data.design_intent_store.model_key);
  assert.equal(proposed.next_action.arguments.inputs.source_design_change.task_id, proposed.task_id);
  assert.equal(Object.hasOwn(proposed.next_action.arguments.inputs, 'targets'), false);
  assert.equal(Object.hasOwn(proposed.next_action.arguments.inputs, 'operations'), false);

  const reviewed = await bridge.start_agent_task({
    ...proposed.next_action.arguments,
    idempotency_key: `${domain.name}-reviewed-rebuild-v1`
  });
  assert.equal(reviewed.ok, true, JSON.stringify(reviewed.error));
  assert.equal(reviewed.task_state, 'awaiting_review');
  const reviewedProjection = await expandedEnvelopeDocument(bridge, reviewed);
  assert.equal(reviewedProjection.result.source_design_change.provenance, 'server_task_binding');
  assert.equal(reviewedProjection.result.risk_level, 'S4');

  await bridge.approvalAuthority.recordTrustedDecision(
    reviewedProjection.result.approval_challenge,
    { decision: 'approved', user_id: 'cross-domain-reviewer', channel: 'local-user-presence-test', confirmed: true }
  );
  const applied = await bridge.submit_agent_task_input({
    task_id: reviewed.task_id,
    idempotency_key: `${domain.name}-reviewed-apply-v1`,
    input: {}
  });
  assert.equal(applied.ok, true, JSON.stringify(applied.error));
  assert.equal(applied.task_state, 'completed');
  const appliedProjection = await expandedEnvelopeDocument(bridge, applied);
  assert.equal(appliedProjection.result.lineage_status, 'persisted');
  assert.equal(appliedProjection.result.design_intent_store.version_count, 2);
  assert.equal(appliedProjection.result.design_intent_store.reconciliation_count, 1);
  assert.equal(appliedProjection.result.design_intent_store.model_key, proposed.data.design_intent_store.model_key);

  const adoption = await bridge.adopt_open_model({ runtime: 'mock', recursive: true, read_only: true });
  domain.assertApplied(adoption);

  const modelKey = appliedProjection.result.design_intent_store.model_key;
  const persistedBeforeReopen = await bridge.agentGateway.designIntentStore.loadCurrent(modelKey);
  assert.equal(persistedBeforeReopen.graph.model_key, modelKey);
  domain.assertPersistedGraph(persistedBeforeReopen.graph);
  const refsBeforeReopen = persistedBeforeReopen.graph.bindings.map((binding) => structuredClone(binding.existing_targets));

  const savePath = path.join(domainRoot, `${domain.name}-save-reopen.json`);
  await bridge.save_model({ runtime: 'mock', path: savePath, keep_session: true });
  await bridge.open_model({ runtime: 'mock', path: savePath });

  const reloadedBridge = new SketchUpBridge(options);
  const persistedAfterReload = await reloadedBridge.agentGateway.designIntentStore.loadCurrent(modelKey);
  assert.equal(persistedAfterReload.graph.design_graph_id, persistedBeforeReopen.graph.design_graph_id);
  assert.deepEqual(
    persistedAfterReload.graph.bindings.map((binding) => binding.existing_targets),
    refsBeforeReopen,
    `${domain.name} persistent entity references must survive store reload`
  );
  domain.assertPersistedGraph(persistedAfterReload.graph);

  const reopened = await reloadedBridge.start_agent_task({
    intent: 'reconcile_design_intent',
    instruction: `Verify ${domain.name} DesignIntent lineage after save, reopen, and store reload.`,
    idempotency_key: `${domain.name}-reopen-reconcile-v1`,
    inputs: { runtime: 'mock', design_task_id: reviewed.task_id }
  });
  assert.equal(reopened.ok, true, JSON.stringify(reopened.error));
  assert.equal(reopened.task_state, 'completed');
  const reopenedProjection = await expandedEnvelopeDocument(reloadedBridge, reopened);
  assert.equal(reopenedProjection.result.reconciliation.aligned, true);
  assert.equal(reopenedProjection.result.reconciliation.model_key, modelKey);
  assert.equal(reopenedProjection.result.design_intent_store.version_count, 2);
  assert.equal(reopenedProjection.result.design_intent_store.reconciliation_count, 2);

  return {
    domain: domain.name,
    model_key_bound: true,
    version_count: reopenedProjection.result.design_intent_store.version_count,
    reconciliation_count: reopenedProjection.result.design_intent_store.reconciliation_count,
    persisted_refs: refsBeforeReopen.flat().length,
    reopened_aligned: reopenedProjection.result.reconciliation.aligned
  };
}

async function expandedEnvelopeDocument(targetBridge, envelope) {
  const handle = envelope.presentation?.full_result_artifact;
  if (!handle) {
    return {
      result: envelope.data,
      next_action: envelope.next_action,
      artifacts: envelope.artifacts || []
    };
  }
  return JSON.parse(await readArtifactText(targetBridge, handle, envelope.task_id));
}

async function readArtifactText(targetBridge, handle, taskId) {
  const handleMatch = /^artifact:(task_[0-9a-f-]+):[0-9a-f-]+$/i.exec(String(handle));
  assert.ok(handleMatch, 'The full projection must use an opaque task artifact handle.');
  assert.equal(handleMatch[1], taskId, 'The full projection artifact must be bound to its owning task.');

  let offset = 0;
  let content = '';
  while (true) {
    const page = await targetBridge.read_agent_artifact({
      handle,
      task_id: taskId,
      offset,
      max_chars: 1024
    });
    assert.equal(page.ok, true, JSON.stringify(page.error));
    assert.equal(page.task_id, taskId);
    assert.equal(page.data?.artifact?.handle, handle);
    assert.equal(page.data?.artifact?.offset, offset);
    assert.equal(typeof page.data?.artifact?.content, 'string');
    content += page.data.artifact.content;
    if (page.data.artifact.eof) {
      assert.equal(page.data.artifact.next_offset, null);
      return content;
    }
    assert.ok(Number.isInteger(page.data.artifact.next_offset) && page.data.artifact.next_offset > offset);
    offset = page.data.artifact.next_offset;
  }
}

function domainFixtures() {
  return [
    {
      name: 'building',
      instruction: 'Increase the reviewed building entrance width to 1200 mm.',
      document: {
        version: 1,
        units: 'mm',
        operations: [
          { op: 'reset' },
          { op: 'box', id: 'building-door', name: 'Building_Door', origin: [500, 0, 0], size: [900, 180, 2100] }
        ]
      },
      parametricRecipe: {
        version: 1,
        id: 'building-door-recipe',
        parameters: [{ id: 'door_width_mm', default: 900, type: 'number', unit: 'mm', minimum: 700, maximum: 1800 }]
      },
      featureMappingPlan: { version: 1, id: 'building-door-map' },
      partGraph: { version: 1, id: 'building-door-parts', parts: [{ id: 'building-door' }] },
      entityBindings: [{
        binding_id: 'building-door-binding',
        part_id: 'building-door',
        feature_id: 'entrance-width',
        entity: { target_id: 'building-door' },
        parameter_bindings: ['door_width_mm'],
        rebuild_template: [{
          op: 'box', id: 'building-door', name: 'Building_Door', origin: [500, 0, 0],
          size: [{ $parameter: 'door_width_mm' }, 180, 2100]
        }]
      }],
      changes: { door_width_mm: 1200 },
      assertApplied(adoption) {
        assert.equal(adoption.entities.find((entity) => entity.id === 'building-door').bounding_box.w, 1200);
      },
      assertPersistedGraph(graph) {
        assert.equal(graph.parameters.door_width_mm.value, 1200);
        assert.deepEqual(graph.bindings[0].existing_targets, [{ target_id: 'building-door', edit_scope: 'top_level' }]);
      }
    },
    {
      name: 'product',
      instruction: 'Increase the reviewed product mounting hole diameter to 20 mm.',
      document: {
        version: 1,
        units: 'mm',
        operations: [
          { op: 'reset' },
          { op: 'box', id: 'product-panel', name: 'Product_Panel', origin: [0, 0, 0], size: [160, 100, 12] },
          { op: 'cut_hole', target_id: 'product-panel', center: [80, 50], radius: 6, feature_id: 'mounting-hole' }
        ]
      },
      parametricRecipe: {
        version: 1,
        id: 'product-hole-recipe',
        parameters: [{ id: 'hole_diameter_mm', default: 12, type: 'number', unit: 'mm', minimum: 4, maximum: 40 }]
      },
      featureMappingPlan: { version: 1, id: 'product-hole-map' },
      partGraph: { version: 1, id: 'product-hole-parts', parts: [{ id: 'product-panel' }] },
      entityBindings: [{
        binding_id: 'product-panel-binding',
        part_id: 'product-panel',
        feature_id: 'mounting-hole',
        entity: { target_id: 'product-panel' },
        parameter_bindings: ['hole_diameter_mm'],
        rebuild_template: [
          { op: 'box', id: 'product-panel', name: 'Product_Panel', origin: [0, 0, 0], size: [160, 100, 12] },
          {
            op: 'cut_hole', target_id: 'product-panel', center: [80, 50],
            radius: { $expression: { parameter: 'hole_diameter_mm', op: 'divide', value: 2 } },
            feature_id: 'mounting-hole'
          }
        ]
      }],
      changes: { hole_diameter_mm: 20 },
      assertApplied(adoption) {
        const panel = adoption.entities.find((entity) => entity.id === 'product-panel');
        const hole = panel.features.find((feature) => feature.id === 'mounting-hole');
        assert.equal(hole.op, 'cut_hole');
        assert.equal(hole.radius, 10);
      },
      assertPersistedGraph(graph) {
        assert.equal(graph.parameters.hole_diameter_mm.value, 20);
        assert.deepEqual(graph.bindings[0].existing_targets, [{ target_id: 'product-panel', edit_scope: 'top_level' }]);
      }
    },
    {
      name: 'interior',
      instruction: 'Change the reviewed interior shelf array from two shelves to four.',
      document: {
        version: 1,
        units: 'mm',
        operations: [
          { op: 'reset' },
          { op: 'box', id: 'shelf-0', name: 'Shelf_0', origin: [0, 0, 0], size: [1200, 400, 24] },
          { op: 'box', id: 'shelf-1', name: 'Shelf_1', origin: [0, 0, 320], size: [1200, 400, 24] }
        ]
      },
      parametricRecipe: {
        version: 1,
        id: 'interior-shelf-recipe',
        parameters: [{ id: 'shelf_count', default: 2, type: 'integer', minimum: 1, maximum: 8 }]
      },
      featureMappingPlan: { version: 1, id: 'interior-shelf-map' },
      partGraph: { version: 1, id: 'interior-shelf-parts', parts: [{ id: 'shelf-array' }] },
      entityBindings: [{
        binding_id: 'shelf-array-binding',
        part_id: 'shelf-array',
        feature_id: 'vertical-array',
        entity: { target_id: 'shelf-0' },
        existing_targets: [{ target_id: 'shelf-0' }, { target_id: 'shelf-1' }],
        parameter_bindings: ['shelf_count'],
        repeat: { count_parameter: 'shelf_count', index_base: 0 },
        rebuild_template: [{
          op: 'box', id: 'shelf-$index', name: 'Shelf_$index',
          origin: [0, 0, { $expression: { source: 'index', op: 'multiply', value: 320 } }],
          size: [1200, 400, 24]
        }]
      }],
      changes: { shelf_count: 4 },
      assertApplied(adoption) {
        assert.deepEqual(
          adoption.entities.filter((entity) => /^shelf-[0-3]$/.test(entity.id)).map((entity) => entity.id).sort(),
          ['shelf-0', 'shelf-1', 'shelf-2', 'shelf-3']
        );
      },
      assertPersistedGraph(graph) {
        const binding = graph.bindings[0];
        const expectedRefs = ['shelf-0', 'shelf-1', 'shelf-2', 'shelf-3'].map((targetId) => ({ target_id: targetId, edit_scope: 'top_level' }));
        assert.equal(graph.parameters.shelf_count.value, 4);
        assert.deepEqual(binding.existing_targets, expectedRefs);
        assert.equal(binding.resolved_entities.length, 4);
        assert.deepEqual(graph.bidirectional.design_to_entities['parameter:shelf_count'], expectedRefs.map((ref) => `target_id:${ref.target_id}`));
        for (const ref of expectedRefs) assert.ok(graph.bidirectional.entity_to_design[`target_id:${ref.target_id}`].includes('parameter:shelf_count'));
        assert.equal(graph.stats.mapped_entities, 4);
      }
    }
  ];
}
