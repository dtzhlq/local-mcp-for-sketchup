import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { runRealModelReliabilityHarness } from '../scripts/run-real-model-reliability-harness.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-reliability-schema-'));

try {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  const [reportSchema, manifestSchema, liveCaseSchema, manifest] = await Promise.all([
    readJson(new URL('../schema/real-model-reliability-report-v1.schema.json', import.meta.url)),
    readJson(new URL('../schema/real-model-reliability-corpus-v1.schema.json', import.meta.url)),
    readJson(new URL('../schema/real-model-reliability-live-case-v1.schema.json', import.meta.url)),
    readJson(new URL('./reliability-corpus/manifest.json', import.meta.url))
  ]);
  const validateReport = ajv.compile(reportSchema);
  const validateManifest = ajv.compile(manifestSchema);
  const validateLiveCase = ajv.compile(liveCaseSchema);

  assert.equal(validateManifest(manifest), true, JSON.stringify(validateManifest.errors));
  assert.equal(manifest.default_runtime, 'mock');
  assert.equal(manifest.repository_live_artifacts.tracked_skp_count, 0);
  assert.deepEqual(new Set(manifest.cases.map((entry) => entry.domain)), new Set([
    'architecture', 'interior', 'product', 'shared_component', 'imported_cad', 'appearance', 'transform_edge_case'
  ]));

  for (const invalidManifest of [
    { ...manifest, default_runtime: 'queue' },
    { ...manifest, unexpected: true },
    { ...manifest, repository_live_artifacts: { ...manifest.repository_live_artifacts, tracked_skp_count: 1 } },
    { ...manifest, cases: manifest.cases.map((entry, index) => index === 0 ? { ...entry, live: { ...entry.live, repository_tracked: true } } : entry) },
    { ...manifest, live_policy: { ...manifest.live_policy, interrupt_cleanup_required: false } },
    { ...manifest, cases: [...manifest.cases, { ...manifest.cases[0], id: 'unexpected-eighth-case' }] }
  ]) {
    assert.equal(validateManifest(invalidManifest), false, `invalid reliability manifest was accepted: ${JSON.stringify(invalidManifest)}`);
  }

  const validLiveCase = {
    version: 'real-model-reliability-live-case.v1',
    kind: 'real_model_reliability_live_case',
    case_id: 'architecture-golden',
    artifact_file: 'architecture-building.skp',
    artifact_sha256: `sha256:${'a'.repeat(64)}`,
    targets: {
      wall_target: { persistent_id: '12345' }
    },
    expectations: {
      minimum_entities: 1,
      minimum_recursive_entities: 1,
      minimum_scenes: 1,
      required_materials: ['Wall_Material'],
      uv_target_roles: [],
      hidden_target_roles: [],
      minimum_shared_occurrences: 0,
      boolean_operation: null
    }
  };
  assert.equal(validateLiveCase(validLiveCase), true, JSON.stringify(validateLiveCase.errors));
  for (const invalidLiveCase of [
    { ...validLiveCase, artifact_sha256: 'not-hash-bound' },
    { ...validLiveCase, artifact_file: '../escape.skp' },
    { ...validLiveCase, targets: { wall_target: { persistent_id: 12345 } } },
    { ...validLiveCase, expectations: { ...validLiveCase.expectations, extra: true } },
    { ...validLiveCase, unexpected: true }
  ]) {
    assert.equal(validateLiveCase(invalidLiveCase), false, `invalid live reliability contract was accepted: ${JSON.stringify(invalidLiveCase)}`);
  }

  const { report } = await runRealModelReliabilityHarness({ outputDir: path.join(root, 'mock') });
  assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors));
  const invalidReports = [
    mutate(report, (value) => { value.live_queue_called = true; }),
    mutate(report, (value) => { value.runtime = 'queue'; }),
    mutate(report, (value) => { value.unexpected = true; }),
    mutate(report, (value) => { value.metrics.unknown_metric = 1; }),
    mutate(report, (value) => { value.manifest.repository_tracked_skp_count = 1; }),
    mutate(report, (value) => { value.safety.fresh_handshake_per_guarded_operation = false; }),
    mutate(report, (value) => { delete value.coverage.boolean_manifold; }),
    mutate(report, (value) => { value.results[0].error = 'should not be present on success'; }),
    mutate(report, (value) => { value.results[0].tasks[0].evidence = {}; }),
    mutate(report, (value) => { value.live_sketchup_version_matrix = { versions: ['2026'], complete: false }; }),
    mutate(report, (value) => { value.results.push({ ...value.results[0], id: 'unexpected-eighth-result' }); })
  ];
  for (const invalid of invalidReports) {
    assert.equal(validateReport(invalid), false, `invalid reliability report was accepted: ${JSON.stringify(invalid)}`);
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    strict_report_schema: true,
    strict_manifest_schema: true,
    hash_bound_live_case_schema: true,
    deterministic_mock_cannot_claim_live: true,
    report_negative_cases: invalidReports.length,
    manifest_negative_cases: 6,
    live_case_negative_cases: 5,
    live_queue_called: report.live_queue_called
  }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

function readJson(url) {
  return fs.readFile(url, 'utf8').then(JSON.parse);
}

function mutate(value, callback) {
  const copy = structuredClone(value);
  callback(copy);
  return copy;
}
