import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  CAPABILITY_MANIFEST_VERSION,
  RUNTIME_CAPABILITY_VERSION,
  getRuntimeCapabilities
} from '../src/capabilities.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainPath = path.join(repoRoot, 'sketchup_plugin', 'local_mcp_for_sketchup', 'bridge.rb');
const probePath = path.join(repoRoot, 'sketchup_plugin', 'local_mcp_for_sketchup', 'structural_probe.rb');
const [mainSource, probeSource] = await Promise.all([
  fs.readFile(mainPath, 'utf8'),
  fs.readFile(probePath, 'utf8')
]);
let assertions = 0;

assert.match(mainSource, /support_require\.call\('local_mcp_for_sketchup\/structural_probe'\)/); assertions += 1;
assert.equal(rubyStringConstant(mainSource, 'CAPABILITY_MANIFEST_VERSION'), CAPABILITY_MANIFEST_VERSION); assertions += 1;
assert.equal(rubyStringConstant(mainSource, 'RUNTIME_CAPABILITY_VERSION'), RUNTIME_CAPABILITY_VERSION); assertions += 1;
const capabilities = methodBody(mainSource, 'get_capabilities', 'get_session_state');
for (const field of [
  'read_only_probes', 'structural_groups', 'version', 'operation', 'requires_read_only',
  'default_limit', 'max_limit', 'max_fresh_manifold_paths', 'projected_entity_types',
  'traversed_container_types', 'fresh_manifold_method', 'leaf_entities_materialized', 'mutates_model'
]) {
  assert.match(capabilities, new RegExp(`'${field}'\\s*=>`), `Ruby capability descriptor missing ${field}`); assertions += 1;
}
const queueProbe = getRuntimeCapabilities('queue').read_only_probes.structural_groups;
assert.deepEqual(queueProbe, {
  version: 'structural-groups.v1',
  operation: 'adopt_open_model',
  requires_read_only: true,
  default_limit: 500,
  max_limit: 5000,
  max_fresh_manifold_paths: 20,
  projected_entity_types: ['group'],
  traversed_container_types: ['group', 'component_instance'],
  fresh_manifold_method: 'manifold_report',
  leaf_entities_materialized: false,
  mutates_model: false
}); assertions += 1;
const adopt = methodBody(mainSource, 'adopt_open_model', 'adoption_result');
assert.ok(adopt.indexOf('normalize_structural_probe_options') < adopt.indexOf('active_model_required'));
assertions += 1;
assert.equal((adopt.match(/structural_probe_options: structural_probe_options/g) || []).length, 2); assertions += 1;
const adoptionResult = methodBody(mainSource, 'adoption_result', 'get_selection');
assert.match(adoptionResult, /result\['structural_groups'\]\s*=\s*structural_group_probe/); assertions += 1;
assert.match(adoptionResult, /model_revision:\s*revision\['model_revision'\]/); assertions += 1;
assert.ok(adoptionResult.indexOf('revision = session_model_revision_report') < adoptionResult.indexOf('structural_group_probe'));
assertions += 1;

assert.match(probeSource, /STRUCTURAL_GROUPS_VERSION\s*=\s*'structural-groups\.v1'/); assertions += 1;
assert.match(probeSource, /MAX_STRUCTURAL_GROUP_LIMIT\s*=\s*5_000/); assertions += 1;
assert.match(probeSource, /MAX_FRESH_MANIFOLD_PATHS\s*=\s*20/); assertions += 1;
assert.match(probeSource, /CANONICAL_STRUCTURAL_PID_PATH\s*=\s*\/\\Apid:/); assertions += 1;
const normalize = methodBody(probeSource, 'normalize_structural_probe_options', 'structural_group_probe');
assert.match(normalize, /requested && !read_only/); assertions += 1;
assert.match(normalize, /structural_group_limit requires structural_groups=true/); assertions += 1;
assert.match(normalize, /fresh_manifold_paths requires structural_groups=true/); assertions += 1;
assert.match(normalize, /fresh_paths\.uniq\.length == fresh_paths\.length/); assertions += 1;

const walk = methodBody(probeSource, 'walk_structural_containers', 'structural_containers');
assert.match(walk, /structural_containers\(entities\)/); assertions += 1;
assert.match(walk, /container\.is_a\?\(Sketchup::Group\)/); assertions += 1;
assert.match(walk, /state\['total_seen'\] > limit/); assertions += 1;
assert.match(walk, /state\['halted'\] = true/); assertions += 1;
assert.doesNotMatch(walk, /recursive_entity_index|occurrence_entity_snapshot/); assertions += 1;
const containers = methodBody(probeSource, 'structural_containers', 'structural_group_entry');
assert.match(containers, /Sketchup::Group/); assertions += 1;
assert.match(containers, /Sketchup::ComponentInstance/); assertions += 1;
assert.doesNotMatch(containers, /Sketchup::Face|Sketchup::Edge/); assertions += 1;

const entry = methodBody(probeSource, 'structural_group_entry', 'structural_path_segments');
for (const field of [
  'entity_path', 'parent_entity_path', 'scope_path', 'persistent_id', 'path_segments',
  'name', 'material', 'tag', 'visible', 'locked', 'effective_visible', 'effective_locked',
  'faces', 'edges', 'vertices', 'parent_bounding_box', 'world_bounding_box', 'world_transform',
  'affected_instance_count', 'shared_definition', 'instance_policy_required', 'manifold_attestation'
]) {
  assert.match(entry, new RegExp(`'${field}'\\s*=>`), `missing structural entry field ${field}`); assertions += 1;
}
assert.match(entry, /'scope_path'\s*=>\s*parent_entity_path \|\| 'model'/); assertions += 1;
assert.match(entry, /persistent_id_path = instance_path\.persistent_id_path\.to_s/); assertions += 1;
assert.doesNotMatch(entry, /definition:/); assertions += 1;
assert.doesNotMatch(entry, /entity_classification|entity_attributes|classification|attributes/); assertions += 1;
assert.match(entry, /'trust'\s*=>\s*'untrusted_data'/); assertions += 1;
const segments = methodBody(probeSource, 'structural_path_segments', 'structural_persistent_id');
assert.match(segments, /'persistent_id'\s*=>\s*persistent_id/); assertions += 1;
assert.match(segments, /'reference'\s*=>\s*persistent_id/); assertions += 1;
const persistentId = methodBody(probeSource, 'structural_persistent_id', 'structural_untrusted_display');
assert.match(persistentId, /value\.to_s/); assertions += 1;
assert.match(persistentId, /positive decimal persistent ids/); assertions += 1;
const display = methodBody(probeSource, 'structural_untrusted_display', 'structural_entity_visible?');
assert.match(display, /gsub\(\/\[\\x00-\\x1f\\x7f\]\//); assertions += 1;
assert.match(display, /\[0, 200\]/); assertions += 1;

const projection = methodBody(probeSource, 'structural_group_probe', 'walk_structural_containers');
for (const field of [
  'version', 'total_seen', 'total_seen_exact', 'returned', 'truncated', 'limit',
  'fresh_manifold_requested', 'fresh_manifold_matched', 'fresh_manifold_unmatched', 'entries'
]) {
  assert.match(projection, new RegExp(`'${field}'\\s*=>`), `missing structural projection field ${field}`); assertions += 1;
}
assert.match(projection, /unmatched_paths = fresh_paths\.reject/); assertions += 1;

const attestation = methodBody(probeSource, 'structural_manifold_attestation', 'structural_occurrence_manifold_report');
assert.match(attestation, /report = manifold_report\(group\)/); assertions += 1;
assert.equal((attestation.match(/manifold_report\(group\)/g) || []).length, 1); assertions += 1;
assert.doesNotMatch(attestation, /definition_manifold_cache|manifold_check|set_attribute/); assertions += 1;
for (const field of ['status', 'fresh', 'matched', 'entity_path', 'model_revision', 'is_manifold']) {
  assert.match(attestation, new RegExp(`'${field}'\\s*=>`)); assertions += 1;
}
assert.match(attestation, /'status'\s*=>\s*'fresh_matched'/); assertions += 1;
const occurrenceReport = methodBody(probeSource, 'structural_occurrence_manifold_report', 'structural_volume_scale');
assert.match(occurrenceReport, /'entity_path'\s*=>\s*entity_path/); assertions += 1;
assert.match(occurrenceReport, /'model_revision'\s*=>\s*model_revision/); assertions += 1;
assert.match(occurrenceReport, /volume\.to_f \* ancestor_scale/); assertions += 1;
assert.doesNotMatch(probeSource, /set_attribute|document_state|manifold_check/); assertions += 1;

const rubySyntax = await execFileAsync('/usr/bin/ruby', ['-c', probePath]);
assert.match(rubySyntax.stdout, /Syntax OK/); assertions += 1;
const dynamic = JSON.parse((await execFileAsync('/usr/bin/ruby', ['-e', rubyDynamicContract(probePath)])).stdout.trim());
assert.equal(dynamic.calls, 2, 'each exact occurrence must get its own fresh read'); assertions += 1;
assert.deepEqual(dynamic.paths, ['pid:100.11', 'pid:200.11']); assertions += 1;
assert.deepEqual(dynamic.report_paths, ['pid:100.11', 'pid:200.11']); assertions += 1;
assert.deepEqual(dynamic.report_names, ['First', 'Second']); assertions += 1;
assert.deepEqual(dynamic.world_volumes, [10, 60]); assertions += 1;
assert.equal(dynamic.same_definition, true); assertions += 1;
assert.equal(dynamic.sanitized_length, 200); assertions += 1;
assert.equal(dynamic.sanitized_has_controls, false); assertions += 1;

process.stdout.write(`${JSON.stringify({
  ok: true,
  assertions,
  version: 'structural-groups.v1',
  group_occurrence_fresh_reads: dynamic.calls,
  shared_definition_identity_isolated: true,
  live_queue_called: false
}, null, 2)}\n`);

function methodBody(source, name, nextName) {
  const start = source.indexOf(`  def ${name}`);
  const end = source.indexOf(`  def ${nextName}`, start + 1);
  assert.ok(start >= 0 && end > start, `missing Ruby method boundary for ${name}`);
  return source.slice(start, end);
}

function rubyStringConstant(source, name) {
  const match = source.match(new RegExp(`^\\s*${name}\\s*=\\s*'([^']+)'`, 'm'));
  assert.ok(match, `missing Ruby string constant ${name}`);
  return match[1];
}

function rubyDynamicContract(targetPath) {
  return `
require 'json'
require ${JSON.stringify(targetPath)}
FakeTransform = Struct.new(:matrix) do
  def to_a
    matrix
  end
end
FakeDefinition = Struct.new(:label)
FakeGroup = Struct.new(:definition, :name, :pid, :base_volume)
shared = FakeDefinition.new('shared')
first = FakeGroup.new(shared, 'First', '11', 10.0)
second = FakeGroup.new(shared, 'Second', '11', 20.0)
calls = 0
LocalMcpForSketchUp.define_singleton_method(:manifold_report) do |group|
  calls += 1
  {
    'persistent_id' => group.pid,
    'name' => group.name,
    'is_manifold' => true,
    'method' => 'stub',
    'checked' => true,
    'faces' => 6,
    'edges' => 12,
    'vertices' => 8,
    'volume' => group.base_volume,
    'checks' => { 'closed_edges' => true },
    'issues' => []
  }
end
state = {
  'fresh_requested' => { 'pid:100.11' => true, 'pid:200.11' => true },
  'fresh_matched' => {}
}
identity = FakeTransform.new([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
scale_three_x = FakeTransform.new([3, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
revision = 'sha256:' + ('a' * 64)
left = LocalMcpForSketchUp.structural_manifold_attestation(first, 'pid:100.11', state, revision, identity)
right = LocalMcpForSketchUp.structural_manifold_attestation(second, 'pid:200.11', state, revision, scale_three_x)
sanitized = LocalMcpForSketchUp.structural_untrusted_display("bad\\u0000\\n" + ('x' * 250))
puts JSON.generate({
  calls: calls,
  paths: state['fresh_matched'].keys,
  report_paths: [left['report']['entity_path'], right['report']['entity_path']],
  report_names: [left['report']['name'], right['report']['name']],
  world_volumes: [left['report']['volume'], right['report']['volume']],
  same_definition: first.definition.equal?(second.definition),
  sanitized_length: sanitized.length,
  sanitized_has_controls: !!(sanitized =~ /[\\x00-\\x1f\\x7f]/)
})
`;
}
