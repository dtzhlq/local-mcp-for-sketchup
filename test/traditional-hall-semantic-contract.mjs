import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { SketchUpBridge } from '../src/bridge.mjs';
import { compilePartGraphToSketchUpDsl } from '../src/product-modeling/part-graph-compiler.mjs';
import { partBoundingBox } from '../src/product-modeling/physical-consistency-qa.mjs';
import {
  compareSemanticSnapshots,
  deriveSemanticViewEvidenceFromSnapshot,
  validatePartGraphSemanticContract
} from '../src/product-modeling/semantic-contract-qa.mjs';
import {
  buildTraditionalHallSemanticFixture,
  semanticViewEvidence,
  traditionalHallProfile
} from './fixtures/traditional-hall-semantic-fixture.mjs';

const partGraph = buildTraditionalHallSemanticFixture();
const userGroundTruth = JSON.parse(await fs.readFile('test/fixtures/xieshan-hall-semantic-ground-truth.v1.json', 'utf8'));
assert.deepEqual(userGroundTruth.assertions.map((assertion) => assertion.id), [
  'hall-column-grids-outer-and-enclosure',
  'podium-no-perimeter-balustrade',
  'masonry-below-enclosure',
  'front-stair-only'
]);
assert.equal(userGroundTruth.scoring_policy.geometry_density_cannot_offset_semantic_failure, true);
const profile = traditionalHallProfile();
const viewEvidence = semanticViewEvidence();
const precompile = validatePartGraphSemanticContract(partGraph, { phase: 'precompile', viewEvidence });
assert.equal(precompile.ok, true, JSON.stringify(precompile.issues, null, 2));
assert.equal(precompile.summary.assertions, 11);

const dsl = compilePartGraphToSketchUpDsl(partGraph, profile, { repoRoot: process.cwd() });
assert.equal(dsl.metadata.source_mode, 'manual_authored');
assert.equal(dsl.metadata.interpretation_eligible, false);
assert.equal(dsl.metadata.semantic_contract.id, 'xieshan-hall-four-truths-v1');
const postcompile = validatePartGraphSemanticContract(partGraph, { phase: 'postcompile', dsl, viewEvidence });
assert.equal(postcompile.ok, true, JSON.stringify(postcompile.issues, null, 2));

const withoutEnclosureGrid = structuredClone(partGraph);
withoutEnclosureGrid.parts = withoutEnclosureGrid.parts.filter((part) => part.role !== 'enclosure_column');
assertSemanticFailure(withoutEnclosureGrid, 'enclosure_column_grid_required');

const withBalustrade = structuredClone(partGraph);
withBalustrade.parts.push({
  id: 'forged-podium-balustrade',
  name: 'Forged_Podium_Balustrade',
  type: 'balustrade',
  role: 'balustrade',
  material: 'Hall_Stone',
  shape: { primitive: 'box', parameters: { origin: [-5000, -3600, 500], size: [10000, 100, 900] } },
  evidence_status: 'inferred',
  fallback_state: 'profile_default',
  review_required: false,
  qa: {}
});
assertSemanticFailure(withBalustrade, 'podium_balustrade_absent');
assertSemanticFailure(withBalustrade, 'balustrade_absent');

const wrongSill = structuredClone(partGraph);
wrongSill.parts.find((part) => part.id === 'front-masonry-sill').role = 'podium_balustrade';
assertSemanticFailure(wrongSill, 'masonry_sill_required');

const sideStair = structuredClone(partGraph);
sideStair.parts.find((part) => part.id === 'front-stair').shape.parameters.origin = [-4200, -500, 0];
assertSemanticFailure(sideStair, 'front_stair_only');
assertSemanticFailure(sideStair, 'no_side_or_rear_stair');

const reversedRoofFace = structuredClone(partGraph);
reversedRoofFace.parts.find((part) => part.id === 'roof-shell').shape.parameters.faces[1].reverse();
assertSemanticFailure(reversedRoofFace, 'roof_mesh_winding_and_materials');

const missingBackMaterial = structuredClone(partGraph);
delete missingBackMaterial.parts.find((part) => part.id === 'roof-shell').shape.parameters.back_material;
assertSemanticFailure(missingBackMaterial, 'roof_mesh_winding_and_materials');

const missingLayerEvidence = structuredClone(viewEvidence);
missingLayerEvidence.views[0].layer_order = [];
const viewFailure = validatePartGraphSemanticContract(partGraph, { phase: 'postcompile', dsl, viewEvidence: missingLayerEvidence });
assert.equal(viewFailure.ok, false);
assert.ok(viewFailure.issues.some((issue) => issue.id === 'front_and_oblique_column_layering'));

const missingSemanticTag = structuredClone(partGraph);
delete missingSemanticTag.parts.find((part) => part.id === 'front-stair').tag;
const missingSemanticTagReport = validatePartGraphSemanticContract(missingSemanticTag, { phase: 'precompile' });
assert.equal(missingSemanticTagReport.ok, false);
assert.ok(missingSemanticTagReport.issues.some((issue) => issue.id === 'named_identity_front-stair'));

const beforeSnapshot = snapshotForPartGraph(partGraph);
const derivedViewEvidence = deriveSemanticViewEvidenceFromSnapshot({
  partGraph,
  snapshot: beforeSnapshot,
  captures: [
    { view: 'front', path: '/tmp/front.png', ok: true },
    { view: 'oblique', path: '/tmp/oblique.png', ok: true }
  ]
});
assert.equal(validatePartGraphSemanticContract(partGraph, {
  phase: 'postcapture',
  snapshot: beforeSnapshot,
  viewEvidence: derivedViewEvidence
}).ok, true);

const sparseOcclusionPartGraph = {
  semantic_contract: {
    view_assertions: [{
      id: 'target_still_visible_between_sparse_occluders',
      type: 'multi_view_role_evidence',
      views: ['front'],
      required_visible_roles: ['target']
    }]
  }
};
const sparseOcclusionSnapshot = {
  items: [
    snapshotBox('target', 'target', [-100, 0, 0], [200, 20, 200]),
    snapshotBox('lower-left-occluder', 'occluder', [-105, -100, -5], [20, 20, 20]),
    snapshotBox('upper-left-occluder', 'occluder', [-105, -100, 185], [20, 20, 20]),
    snapshotBox('lower-right-occluder', 'occluder', [85, -100, -5], [20, 20, 20]),
    snapshotBox('upper-right-occluder', 'occluder', [85, -100, 185], [20, 20, 20]),
    snapshotBox('center-occluder', 'occluder', [-10, -100, 90], [20, 20, 20])
  ]
};
const sparseOcclusionEvidence = deriveSemanticViewEvidenceFromSnapshot({
  partGraph: sparseOcclusionPartGraph,
  snapshot: sparseOcclusionSnapshot,
  captures: [{ view: 'front', ok: true }]
});
assert.ok(sparseOcclusionEvidence.views[0].visible_roles.includes('target'));

const fullOcclusionSnapshot = structuredClone(sparseOcclusionSnapshot);
fullOcclusionSnapshot.items = [
  fullOcclusionSnapshot.items[0],
  snapshotBox('full-occluder', 'occluder', [-110, -100, -10], [220, 20, 220])
];
const fullOcclusionEvidence = deriveSemanticViewEvidenceFromSnapshot({
  partGraph: sparseOcclusionPartGraph,
  snapshot: fullOcclusionSnapshot,
  captures: [{ view: 'front', ok: true }]
});
assert.equal(fullOcclusionEvidence.views[0].visible_roles.includes('target'), false);
const stableReopen = compareSemanticSnapshots({
  partGraph,
  beforeSnapshot,
  afterSnapshot: structuredClone(beforeSnapshot),
  beforeViewEvidence: viewEvidence,
  afterViewEvidence: viewEvidence
});
assert.equal(stableReopen.ok, true, JSON.stringify(stableReopen.issues, null, 2));

const missingMeshAttestation = structuredClone(beforeSnapshot);
delete missingMeshAttestation.items.find((item) => item.id === 'roof-shell').qa.mesh_semantic;
const missingMeshAttestationReport = validatePartGraphSemanticContract(partGraph, {
  phase: 'postreopen',
  snapshot: missingMeshAttestation,
  viewEvidence
});
assert.equal(missingMeshAttestationReport.ok, false);
assert.ok(missingMeshAttestationReport.issues.some((issue) => issue.id === 'roof_mesh_winding_and_materials'));

const changedAfterReopen = structuredClone(beforeSnapshot);
changedAfterReopen.items.find((item) => item.id === 'front-stair').bounding_box.min[0] -= 3000;
const driftedReopen = compareSemanticSnapshots({
  partGraph,
  beforeSnapshot,
  afterSnapshot: changedAfterReopen,
  beforeViewEvidence: viewEvidence,
  afterViewEvidence: viewEvidence
});
assert.equal(driftedReopen.ok, false);
assert.equal(driftedReopen.digest_matches, false);
assert.ok(driftedReopen.issues.some((issue) => issue.id === 'save_reopen_semantic_digest_mismatch'));

const mockDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hall-semantic-reopen-'));
try {
  const bridge = new SketchUpBridge({ mock: { sessionPath: path.join(mockDir, 'session.json') } });
  const built = await bridge.build_model({ runtime: 'mock', code: JSON.stringify(dsl) });
  const builtRoof = built.snapshot.groups.find((item) => item.id === 'roof-shell');
  assert.equal(builtRoof.mesh_semantic.geometry_remeasured, true);
  assert.equal(builtRoof.mesh_semantic.native_geometry_remeasured, false);
  assert.equal(builtRoof.mesh_semantic.inward_face_count, 0);
  assert.equal(builtRoof.mesh_semantic.missing_back_material_face_count, 0);
  const runtimeReversedFace = structuredClone(built.snapshot);
  runtimeReversedFace.groups.find((item) => item.id === 'roof-shell').mesh_semantic.inward_face_count = 1;
  const runtimeReversedReport = validatePartGraphSemanticContract(partGraph, {
    phase: 'postreopen',
    snapshot: runtimeReversedFace,
    viewEvidence
  });
  assert.equal(runtimeReversedReport.ok, false);
  assert.ok(runtimeReversedReport.issues.some((issue) => issue.id === 'roof_mesh_winding_and_materials'));
  const savedPath = path.join(mockDir, 'hall-model.json');
  await bridge.save_model({ runtime: 'mock', path: savedPath, keep_session: true });
  const reopened = await bridge.open_model({ runtime: 'mock', path: savedPath });
  const persisted = compareSemanticSnapshots({
    partGraph,
    beforeSnapshot: built.snapshot,
    afterSnapshot: reopened.snapshot,
    beforeViewEvidence: deriveSemanticViewEvidenceFromSnapshot({ partGraph, snapshot: built.snapshot, captures: [{ view: 'front', ok: true }, { view: 'oblique', ok: true }] }),
    afterViewEvidence: deriveSemanticViewEvidenceFromSnapshot({ partGraph, snapshot: reopened.snapshot, captures: [{ view: 'front', ok: true }, { view: 'oblique', ok: true }] })
  });
  assert.equal(persisted.ok, true, JSON.stringify(persisted.issues, null, 2));
  assert.equal(persisted.before.summary.runtime_mesh_remeasured, 1);
  assert.equal(persisted.after.summary.runtime_mesh_remeasured, 1);
} finally {
  await fs.rm(mockDir, { recursive: true, force: true });
}

const schema = JSON.parse(await fs.readFile('schema/part-graph.schema.json', 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
assert.equal(validate(partGraph), true, JSON.stringify(validate.errors, null, 2));

process.stdout.write(`${JSON.stringify({
  ok: true,
  semantic_contract: partGraph.semantic_contract.id,
  precompile_digest: precompile.semantic_digest,
  postcompile_digest: postcompile.semantic_digest,
  mutation_regressions: 10,
  save_reopen_semantic_revalidation: true,
  face_count_not_used_as_semantic_score: true
}, null, 2)}\n`);

function assertSemanticFailure(value, assertionId) {
  const report = validatePartGraphSemanticContract(value, { phase: 'precompile' });
  assert.equal(report.ok, false, `${assertionId} mutation must fail`);
  assert.ok(report.issues.some((issue) => issue.id === assertionId), `${assertionId} missing from ${report.issues.map((issue) => issue.id).join(', ')}`);
}

function snapshotForPartGraph(value) {
  return {
    items: value.parts.map((part) => ({
      id: part.id,
      name: part.name,
      role: part.role,
      tag: part.tag || null,
      material: part.material || null,
      bounding_box: partBoundingBox(part),
      qa: {
        part_id: part.id,
        role: part.role,
        ...(part.shape?.primitive === 'mesh' ? {
          mesh_semantic: {
            front_material: part.shape.parameters?.material || part.material || null,
            back_material: part.shape.parameters?.back_material || null,
            precompile_winding_validated: true
          }
        } : {})
      }
    }))
  };
}

function snapshotBox(id, role, origin, size) {
  return {
    id,
    name: id,
    role,
    tag: 'Semantic_Test',
    bounding_box: {
      min: origin,
      max: origin.map((value, index) => value + size[index])
    },
    qa: { part_id: id, role }
  };
}
