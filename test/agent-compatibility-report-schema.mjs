import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import { runAgentCompatibilityHarness } from '../scripts/run-agent-compatibility-harness.mjs';

const schema = JSON.parse(await fs.readFile(new URL('../schema/agent-compatibility-report-v1.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
const valid = await runAgentCompatibilityHarness();
assert.equal(validate(valid), true, JSON.stringify(validate.errors));
for (const level of valid.levels) {
  assert.equal(
    level.metrics.artifact_page_tool_calls,
    Object.values(level.scenario_results).reduce((total, scenario) => total + scenario.artifact_page_tool_calls, 0),
    `${level.level} artifact-page calls must be derived from the public Agent tool accounting`
  );
  assert.ok(level.scenario_results.ambiguous_edit.agent_tool_calls > 3, `${level.level} must page the full ambiguous-edit projection through the Agent surface`);
  assert.ok(level.scenario_results.make_unique.agent_tool_calls > 3, `${level.level} must page the full make-unique projection through the Agent surface`);
  assert.ok(level.scenario_results.image_summary.agent_tool_calls > 1, `${level.level} must page the capability-safe image summary without raw vision`);
  assert.ok(level.scenario_results.stale_recovery_and_approval.agent_tool_calls > 7, `${level.level} must recover approval fields from task-bound projection artifacts`);
  assert.equal(
    level.metrics.text_only_round_trips,
    Object.values(level.scenario_results).reduce((total, scenario) => total + scenario.text_only_round_trips, 0),
    `${level.level} text-only round trips must be derived from named scenarios`
  );
  assert.equal(level.metrics.text_only_round_trip_failures, 0);
  if (level.level === 'L0') {
    assert.ok(level.metrics.text_only_round_trips > 0);
    assert.ok(Object.values(level.scenario_results).every((scenario) => scenario.text_only_round_trips > 0));
  } else {
    assert.equal(level.metrics.text_only_round_trips, 0);
  }
}
assert.equal(
  valid.aggregate.artifact_page_tool_calls,
  valid.levels.reduce((total, level) => total + level.metrics.artifact_page_tool_calls, 0),
  'aggregate artifact-page calls must equal the sum of capability levels'
);
assert.equal(
  valid.aggregate.text_only_round_trips,
  valid.levels.reduce((total, level) => total + level.metrics.text_only_round_trips, 0),
  'aggregate text-only round trips must equal the sum of capability levels'
);

rejectMutation('unknown level', (report) => { report.levels[0].level = 'NOT_A_LEVEL'; });
rejectMutation('duplicate capability level', (report) => { report.levels[1] = structuredClone(report.levels[0]); });
rejectMutation('negative tool calls', (report) => { report.aggregate.agent_tool_calls = -99; });
rejectMutation('negative artifact page calls', (report) => { report.aggregate.artifact_page_tool_calls = -1; });
rejectMutation('non-numeric completion rate', (report) => { report.levels[0].metrics.completion_rate = 'bogus'; });
rejectMutation('live queue assertion', (report) => { report.live_queue_called = true; });
rejectMutation('brand-specific assertion', (report) => { report.brand_specific = true; });
rejectMutation('empty aggregate', (report) => { report.aggregate = {}; });
rejectMutation('missing named scenario', (report) => { delete report.levels[0].scenario_results.make_unique; });
rejectMutation('profile constraint drift', (report) => { report.levels[0].constraints.context.max_chars = 1_000_000; });
rejectMutation('text-only enforcement disabled', (report) => { report.levels[0].constraints.structured_output.enforced = false; });
rejectMutation('L0 text-only transport not exercised', (report) => { report.levels[0].metrics.text_only_round_trips = 0; });
rejectMutation('text-only round-trip failure hidden', (report) => { report.aggregate.text_only_round_trip_failures = 1; });
rejectMutation('non-zero hard gate', (report) => { report.hard_gates.unauthorized_s2_s4_execution = 1; });
rejectMutation('Gateway audit source drift', (report) => { report.gateway_audit.source = 'scenario_self_report'; });
rejectMutation('missing mutation event lineage', (report) => { report.mutation_ledger[0].source_event_id = null; });
rejectMutation('malformed model diff lineage hash', (report) => { report.mutation_ledger[0].model_diff_hash = 'not-a-hash'; });
rejectMutation('unexpected report field', (report) => { report.untrusted_extension = true; });

process.stdout.write(`${JSON.stringify({ ok: true, rejected_invalid_reports: 18, exact_levels: ['L0', 'L1', 'L2'], strict_additional_properties: true, event_lineage_required: true, l0_json_text_round_trip_enforced: true }, null, 2)}\n`);

function rejectMutation(label, mutate) {
  const candidate = structuredClone(valid);
  mutate(candidate);
  assert.equal(validate(candidate), false, `${label} must be rejected`);
}
