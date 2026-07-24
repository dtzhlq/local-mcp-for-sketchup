import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  buildRealModelCandidateReview,
  renderRealModelCandidateReviewMarkdown,
  verifyRealModelCandidateReviewBindings
} from '../src/real-model-candidate-review.mjs';

const repoRoot = path.resolve('.');
const mapping = await readJson('docs/evidence/real-model-candidate-semantic-mapping-2026-07-20.json');
const mappingSchema = await readJson('schema/real-model-candidate-semantic-mapping-v1.schema.json');
const reportSchema = await readJson('schema/real-model-candidate-review-report-v1.schema.json');
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
ajv.addSchema(mappingSchema);
const validateMapping = ajv.compile(mappingSchema);
const validateReport = ajv.compile(reportSchema);
assert.equal(validateMapping(mapping), true, JSON.stringify(validateMapping.errors));

const documents = await verifyRealModelCandidateReviewBindings({ mapping, rootDir: repoRoot });
const report = buildRealModelCandidateReview({
  mapping,
  inventory: documents.inventory,
  profile: documents.profile,
  liveEvidence: documents.live_evidence,
  manifest: documents.formal_manifest
});
assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors));
assert.deepEqual(report.summary, {
  candidates: 5,
  confirmed_candidates: 5,
  formal_cases: 7,
  semantically_mapped_cases: 6,
  unmapped_cases: 1,
  formal_sidecars_ready: 0,
  formal_sidecars_generated: 0
});
assert.equal(report.safety.live_queue_called, false);
assert.equal(report.safety.model_mutation_authorized, false);
assert.equal(report.safety.approval_token_issued, false);
assert.equal(report.safety.release_acceptance, false);

const byCase = new Map(report.case_reviews.map((entry) => [entry.case_id, entry]));
assert.deepEqual(byCase.get('architecture-golden').mapped_candidates.map((entry) => entry.source_label), ['Fire Escape.skp', '场地模型.skp']);
assert.ok(byCase.get('architecture-golden').blockers.includes('required_scene_evidence_absent'));
assert.equal(byCase.get('interior-expression').status, 'blocked_missing_formal_sidecar');
assert.equal(byCase.get('product-boolean-manifold').status, 'blocked_missing_semantic_mapping');
assert.deepEqual(byCase.get('product-boolean-manifold').required_target_roles, ['boolean_target', 'boolean_tool']);
assert.ok(byCase.get('deep-shared-components').structural_evidence.shared_occurrences >= 2);
assert.ok(byCase.get('deep-shared-components').blockers.includes('full_recursive_index_not_yet_attested'));
assert.ok(byCase.get('imported-dirty-topology').blockers.includes('reviewed_topology_probe_missing'));
assert.ok(byCase.get('appearance-scenes-hidden').blockers.includes('uv_target_evidence_absent'));
assert.ok(byCase.get('scaled-mirrored-locked').structural_evidence.nonuniform_instances > 0);
assert.ok(byCase.get('scaled-mirrored-locked').structural_evidence.mirrored_instances > 0);
assert.ok(byCase.get('scaled-mirrored-locked').blockers.includes('locked_target_evidence_absent'));

const markdown = renderRealModelCandidateReviewMarkdown(report);
assert.match(markdown, /product-boolean-manifold \| unmapped/);
assert.doesNotMatch(markdown, /\/Users\/|<live-artifact-root>/);

const elevated = structuredClone(mapping);
elevated.authority.mutation_authorized = true;
assert.equal(validateMapping(elevated), false, 'semantic mapping must not authorize mutation');
const tokenInjected = structuredClone(mapping);
tokenInjected.authority.approval_token = 'forged';
assert.equal(validateMapping(tokenInjected), false, 'semantic mapping must reject approval-token injection');
const unknownCase = structuredClone(mapping);
unknownCase.mappings[0].assignments[0].case_id = 'agent-invented-case';
assert.throws(() => buildRealModelCandidateReview({
  mapping: unknownCase,
  inventory: documents.inventory,
  profile: documents.profile,
  liveEvidence: documents.live_evidence,
  manifest: documents.formal_manifest
}), /unknown case/);
const sourceTamper = structuredClone(mapping);
sourceTamper.mappings[0].source_sha256 = `sha256:${'0'.repeat(64)}`;
assert.throws(() => buildRealModelCandidateReview({
  mapping: sourceTamper,
  inventory: documents.inventory,
  profile: documents.profile,
  liveEvidence: documents.live_evidence,
  manifest: documents.formal_manifest
}), /source sha256 mismatch/);
const bindingTamper = structuredClone(mapping);
bindingTamper.bindings.inventory.sha256 = '0'.repeat(64);
await assert.rejects(
  verifyRealModelCandidateReviewBindings({ mapping: bindingTamper, rootDir: repoRoot }),
  /sha256 mismatch/
);
const falseAcceptance = structuredClone(report);
falseAcceptance.safety.release_acceptance = true;
assert.equal(validateReport(falseAcceptance), false, 'readiness report must not claim release acceptance');

process.stdout.write(`${JSON.stringify({
  ok: true,
  candidates: report.summary.candidates,
  semantically_mapped_cases: report.summary.semantically_mapped_cases,
  formal_cases: report.summary.formal_cases,
  formal_sidecars_ready: report.summary.formal_sidecars_ready,
  live_queue_called: false,
  mutation_authorized: false,
  negative_cases: 5
}, null, 2)}\n`);

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
}
