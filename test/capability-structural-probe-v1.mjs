import assert from 'node:assert/strict';
import {
  CAPABILITY_MANIFEST_VERSION,
  DSL_VERSION,
  RUNTIME_CAPABILITY_VERSION,
  getComponentDefinitionOperationNames,
  getOperationNames,
  getRuntimeCapabilities
} from '../src/capabilities.mjs';
import {
  DEFAULT_STRUCTURAL_GROUP_LIMIT,
  MAX_FRESH_MANIFOLD_PATHS,
  MAX_STRUCTURAL_GROUP_LIMIT,
  STRUCTURAL_GROUPS_VERSION
} from '../src/model-adoption.mjs';

const queue = getRuntimeCapabilities('queue');
const mock = getRuntimeCapabilities('mock');
const commonProbe = {
  version: STRUCTURAL_GROUPS_VERSION,
  operation: 'adopt_open_model',
  requires_read_only: true,
  default_limit: DEFAULT_STRUCTURAL_GROUP_LIMIT,
  max_limit: MAX_STRUCTURAL_GROUP_LIMIT,
  max_fresh_manifold_paths: MAX_FRESH_MANIFOLD_PATHS,
  projected_entity_types: ['group'],
  traversed_container_types: ['group', 'component_instance'],
  leaf_entities_materialized: false,
  mutates_model: false
};

assert.equal(RUNTIME_CAPABILITY_VERSION, '0.1.0-rc.3-capabilities.1');
assert.equal(CAPABILITY_MANIFEST_VERSION, '2026-07-agent-contract-rc3.1');
assert.equal(DSL_VERSION, 1);
assert.equal(getOperationNames().length, 101, 'the read-only probe must not change the DSL operation registry');
assert.equal(getComponentDefinitionOperationNames().length, 57, 'the read-only probe must not change component scope');

assert.equal(queue.capability_version, RUNTIME_CAPABILITY_VERSION);
assert.equal(queue.manifest_version, CAPABILITY_MANIFEST_VERSION);
assert.equal(queue.dsl_version, DSL_VERSION);
assert.equal(queue.model_revision?.strategy, 'definition-merkle.v2');
assert.match(queue.model_revision_source_sha256, /^[0-9a-f]{64}$/);
assert.deepEqual(queue.read_only_probes?.structural_groups, {
  ...commonProbe,
  fresh_manifold_method: 'manifold_report'
});

assert.equal(mock.capability_version, RUNTIME_CAPABILITY_VERSION);
assert.equal(mock.manifest_version, CAPABILITY_MANIFEST_VERSION);
assert.equal(mock.dsl_version, DSL_VERSION);
assert.deepEqual(mock.read_only_probes?.structural_groups, {
  ...commonProbe,
  fresh_manifold_method: 'fixture_only'
});

assert.throws(() => getRuntimeCapabilities('live'), /Unknown runtime: live/);

process.stdout.write(`${JSON.stringify({
  ok: true,
  capability_version: RUNTIME_CAPABILITY_VERSION,
  manifest_version: CAPABILITY_MANIFEST_VERSION,
  dsl_version: DSL_VERSION,
  dsl_operation_count: getOperationNames().length,
  component_scope_operation_count: getComponentDefinitionOperationNames().length,
  structural_probe_version: STRUCTURAL_GROUPS_VERSION,
  live_queue_called: false,
  assertions: 17
}, null, 2)}\n`);
