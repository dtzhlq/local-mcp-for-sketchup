import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getOperationManifest, getOperationNames, getRuntimeCapabilities } from '../src/capabilities.mjs';
import { SketchUpBridge } from '../src/bridge.mjs';
import { compareSnapshots } from '../src/snapshot-diff.mjs';
import { formatSnapshotReportMarkdown } from '../src/snapshot-report.mjs';

const bridge = new SketchUpBridge();
const demoPath = path.resolve('examples/demo-room.json');
const demoCode = await fs.readFile(demoPath, 'utf8');
const fakeQueueRuntimeDescriptor = {
  ...getRuntimeCapabilities('queue'),
  name: 'queue',
  version: 'queue-plugin-test',
  plugin: {
    name: 'Alma SketchUp MCP Bridge',
    version: 'queue-plugin-test',
    sketchup_version: '2026.0',
    ruby_version: '3.2.0'
  },
  handshake: {
    transport: 'file_queue',
    checked_at: '2026-05-14T03:14:11Z'
  },
  notes: 'Test descriptor returned by a queue plugin handshake.'
};

async function buildExample(relativePath) {
  const exampleCode = await fs.readFile(path.resolve(relativePath), 'utf8');
  return bridge.build_model({ runtime: 'mock', code: exampleCode });
}

function assertSnapshotQualityFields(snapshot, label) {
  assert.equal(snapshot.runtime.name, 'mock', `${label} runtime descriptor should identify mock runtime`);
  assert.equal(snapshot.runtime.dsl_version, 1, `${label} runtime descriptor should include DSL version`);
  assert.ok(snapshot.runtime.manifest_version, `${label} runtime descriptor should include manifest version`);
  assert.ok(snapshot.runtime.supported_operations.includes('box'), `${label} runtime descriptor should include supported operations`);
  assert.ok(Array.isArray(snapshot.warnings), `${label} warnings should be an array`);
  assert.ok(snapshot.warnings.every((warning) => warning.type && warning.severity && warning.category && warning.message !== undefined), `${label} warnings should be structured`);
  assert.ok(Array.isArray(snapshot.warning_messages), `${label} warning_messages should be an array`);
  assert.equal(typeof snapshot.warning_summary, 'object', `${label} warning_summary should exist`);
  assert.equal(typeof snapshot.warning_summary.total, 'number', `${label} warning_summary.total should be numeric`);
  assert.equal(typeof snapshot.warning_summary.by_severity.error, 'number', `${label} warning_summary.by_severity.error should be numeric`);
  assert.equal(typeof snapshot.warning_summary.by_severity.warn, 'number', `${label} warning_summary.by_severity.warn should be numeric`);
  assert.equal(typeof snapshot.warning_summary.by_severity.info, 'number', `${label} warning_summary.by_severity.info should be numeric`);
}

const manifest = getOperationManifest();
assert.ok(manifest.length > 0, 'capability manifest should list operations');
for (const capability of manifest) {
  assert.equal(typeof capability.op, 'string', 'manifest capability should have op name');
  assert.ok(Array.isArray(capability.schema.required), `${capability.op} should declare required fields`);
  assert.ok(Array.isArray(capability.schema.optional), `${capability.op} should declare optional fields`);
  assert.ok(capability.runtime_support.mock, `${capability.op} should declare mock support`);
  assert.ok(capability.runtime_support.queue, `${capability.op} should declare queue support`);
  assert.ok(capability.stability, `${capability.op} should declare stability`);
}

const docsResult = await bridge.get_docs();
assert.ok(docsResult.docs.includes('## Capability Baseline'), 'docs should include generated capability baseline');
for (const operationName of getOperationNames()) {
  assert.ok(docsResult.docs.includes(`\`${operationName}\``), `docs should include manifest operation ${operationName}`);
}

const reset = await bridge.reset_model({ runtime: 'mock' });
assert.equal(reset.snapshot.runtime.name, 'mock');
assert.equal(reset.snapshot.runtime.operation_support.box.status, 'supported');
assert.equal(reset.snapshot.runtime.compatibility.ok, true);
assert.equal(reset.snapshot.runtime.compatibility.level, 'ok');
assert.equal(reset.snapshot.totals.groups, 0);
assert.deepEqual(reset.snapshot.bounding_box.min, [0, 0, 0]);

let fakeQueueCapabilityCalls = 0;
const fakeQueueBridge = new SketchUpBridge({
  queueRuntime: {
    async getCapabilities() {
      fakeQueueCapabilityCalls += 1;
      return fakeQueueRuntimeDescriptor;
    },
    async resetModel() {
      return { totals: { groups: 0 }, warnings: [], warning_messages: [], warning_summary: { total: 0, by_severity: { error: 0, warn: 0, info: 0 } } };
    },
    async buildModel() {
      return { totals: { groups: 1 }, warnings: [], warning_messages: [], warning_summary: { total: 0, by_severity: { error: 0, warn: 0, info: 0 } } };
    },
    async saveModel() {
      return { file_path: 'output/fake-queue.skp', snapshot: { totals: { groups: 1 }, warnings: [], warning_messages: [], warning_summary: { total: 0, by_severity: { error: 0, warn: 0, info: 0 } } } };
    }
  }
});
const fakeQueueCapabilities = await fakeQueueBridge.get_capabilities({ runtime: 'queue' });
assert.equal(fakeQueueCapabilityCalls, 1);
assert.equal(fakeQueueCapabilities.runtime.plugin.sketchup_version, '2026.0');
assert.equal(fakeQueueCapabilities.runtime.handshake.transport, 'file_queue');
assert.equal(fakeQueueCapabilities.runtime.compatibility.ok, true);
assert.equal(fakeQueueCapabilities.runtime.compatibility.level, 'ok');
const fakeQueueReset = await fakeQueueBridge.reset_model({ runtime: 'queue' });
assert.equal(fakeQueueCapabilityCalls, 1, 'queue capabilities should be cached for non-handshake calls');
assert.equal(fakeQueueReset.snapshot.runtime.version, 'queue-plugin-test');
assert.equal(fakeQueueReset.snapshot.runtime.plugin.name, 'Alma SketchUp MCP Bridge');
assert.equal(fakeQueueReset.snapshot.runtime.operation_support.material.status, 'partial');
assert.deepEqual(fakeQueueReset.snapshot.runtime.operation_support.box.schema.required, ['op', 'name', 'origin', 'size']);
assert.equal(fakeQueueReset.snapshot.runtime.operation_support.box.component_scope.status, 'supported');
assert.equal(fakeQueueReset.snapshot.runtime.operation_support.camera.component_scope.status, 'unsupported');
assert.equal(fakeQueueReset.snapshot.runtime.compatibility.ok, true);
const fakeQueueBuild = await fakeQueueBridge.build_model({ runtime: 'queue', code: demoCode });
assert.equal(fakeQueueBuild.snapshot.runtime.version, 'queue-plugin-test');
assert.equal(fakeQueueCapabilityCalls, 1, 'cached queue capabilities should be reused across build calls');
await fakeQueueBridge.get_capabilities({ runtime: 'queue' });
assert.equal(fakeQueueCapabilityCalls, 2, 'explicit get_capabilities should refresh the live queue descriptor');

const driftedQueueBridge = new SketchUpBridge({
  queueRuntime: {
    async getCapabilities() {
      return {
        ...fakeQueueRuntimeDescriptor,
        manifest_version: 'older-manifest',
        supported_operations: fakeQueueRuntimeDescriptor.supported_operations.filter((operation) => operation !== 'box'),
        operation_support: {
          ...fakeQueueRuntimeDescriptor.operation_support,
          material: { status: 'supported', stability: 'stable' },
          tag: { ...fakeQueueRuntimeDescriptor.operation_support.tag, stability: 'stable' }
        }
      };
    },
    async resetModel() {
      return { totals: { groups: 0 }, warnings: [], warning_messages: [], warning_summary: { total: 0, by_severity: { error: 0, warn: 0, info: 0 } } };
    }
  }
});
const driftedQueueCapabilities = await driftedQueueBridge.get_capabilities({ runtime: 'queue' });
assert.equal(driftedQueueCapabilities.runtime.compatibility.ok, false);
assert.equal(driftedQueueCapabilities.runtime.compatibility.level, 'error');
assert.ok(driftedQueueCapabilities.runtime.compatibility.issues.some((issue) => issue.type === 'runtime.operation_missing' && issue.operation === 'box'));
assert.ok(driftedQueueCapabilities.runtime.compatibility.issues.some((issue) => issue.type === 'runtime.operation_status_mismatch' && issue.operation === 'material'));
assert.ok(driftedQueueCapabilities.runtime.compatibility.issues.some((issue) => issue.type === 'runtime.operation_stability_mismatch' && issue.operation === 'tag'));
assert.ok(driftedQueueCapabilities.runtime.compatibility.issues.some((issue) => issue.field === 'runtime.manifest_version'));

const mockParity = await bridge.compare_model({ code: demoCode, expected_runtime: 'mock', actual_runtime: 'mock', toleranceMm: 1, budgets: { max_faces: 1000 }, topIssueLimit: 5 });
assert.equal(mockParity.expected_runtime, 'mock');
assert.equal(mockParity.actual_runtime, 'mock');
assert.equal(mockParity.report.ok, true);
assert.equal(mockParity.report.verdict, 'pass');
assert.equal(mockParity.report.summary.total, 0);
assert.equal(mockParity.expected, undefined);
assert.equal(mockParity.actual, undefined);

const mockParityWithSnapshots = await bridge.compare_model({ code: demoCode, expected_runtime: 'mock', actual_runtime: 'mock', include_snapshots: true });
assert.equal(mockParityWithSnapshots.report.ok, true);
assert.equal(mockParityWithSnapshots.expected.runtime.name, 'mock');
assert.equal(mockParityWithSnapshots.actual.runtime.name, 'mock');

const built = await bridge.build_model({ runtime: 'mock', code: demoCode });
const snapshot = built.snapshot;
assert.equal(typeof snapshot, 'object');
assert.equal(snapshot.runtime.manifest_version, reset.snapshot.runtime.manifest_version);
assert.equal(snapshot.runtime.operation_support.room.status, 'supported');
assert.ok(snapshot.totals.groups >= 18, 'demo room should create many named groups');
assert.ok(snapshot.totals.faces >= 100, 'demo room should create faces');
assert.ok(snapshot.totals.edges >= 200, 'demo room should create edges');
assert.ok(snapshot.material_names.includes('Wall_Paint'));
assert.ok(snapshot.material_names.includes('Floor_Oak'));
assert.ok(snapshot.material_names.includes('Door_Wood'));
assert.ok(snapshot.material_names.includes('Window_Glass'));
assert.ok(snapshot.groups.every((group) => group.name && group.bounding_box));
assert.ok(snapshot.bounding_box.w >= 4500);
assert.ok(snapshot.bounding_box.d >= 3000);
assert.ok(snapshot.bounding_box.h >= 2400);
assert.ok(Array.isArray(snapshot.warnings));
// New structured warning fields
assert.ok(Array.isArray(snapshot.warning_messages), 'warning_messages should be string array');
assert.equal(typeof snapshot.warning_summary, 'object');
assert.ok(snapshot.warning_summary.total >= 0);
assert.ok(typeof snapshot.warning_summary.by_severity.error === 'number');
assert.ok(typeof snapshot.warning_summary.by_severity.warn === 'number');
assert.ok(typeof snapshot.warning_summary.by_severity.info === 'number');
assert.ok(snapshot.warnings.every((w) => w.type && w.severity && w.category && w.message !== undefined), 'all warnings should be structured');
// totals.vertices should exist
assert.ok(typeof snapshot.totals.vertices === 'number');

const identitySnapshot = (await buildExample('examples/editing-identity.json')).snapshot;
const identityPanel = identitySnapshot.groups.find((group) => group.id === 'stable-panel-id');
assert.equal(identityPanel.name, 'Panel_Renamed');
assert.equal(identityPanel.material, 'Identity_Accent');
assert.equal(identityPanel.bounding_box.min[0], 25);
assert.equal(identitySnapshot.groups.some((group) => group.id === 'delete-target-id'), false);
const identityInstance = identitySnapshot.instances.find((instance) => instance.id === 'stable-led-id');
assert.equal(identityInstance.name, 'LED_Original');
assert.equal(identityInstance.visible, false);
assert.equal(identityInstance.bounding_box.min[1], 150);

const metadataBuilt = await bridge.build_model({ runtime: 'mock', code: JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'tag', name: 'Structure', color: '#336699', visible: true },
    { op: 'box', id: 'metadata-panel-id', name: 'Metadata_Panel', origin: [0, 0, 0], size: [100, 40, 8] },
    { op: 'assign_tag', target_id: 'metadata-panel-id', tag: 'Structure' },
    { op: 'attribute', target_id: 'metadata-panel-id', dictionary: 'BIM', attributes: { system: 'frame', level: 1 } },
    { op: 'attribute', target_id: 'metadata-panel-id', dictionary: 'BIM', key: 'status', value: 'existing' },
    { op: 'classification', target_id: 'metadata-panel-id', system: 'IFC', type: 'IfcBuildingElementProxy', identifier: 'PANEL-001', attributes: { predefined_type: 'ELEMENT', load_bearing: false } }
  ]
}) });
const metadataSnapshot = metadataBuilt.snapshot;
const metadataPanel = metadataSnapshot.groups.find((group) => group.id === 'metadata-panel-id');
assert.deepEqual(metadataSnapshot.tags, [{ name: 'Structure', color: '#336699', visible: true }]);
assert.equal(metadataPanel.tag, 'Structure');
assert.deepEqual(metadataPanel.classification, { system: 'IFC', type: 'IfcBuildingElementProxy', identifier: 'PANEL-001', attributes: { predefined_type: 'ELEMENT', load_bearing: false } });
assert.deepEqual(metadataPanel.attributes.BIM, { system: 'frame', level: 1, status: 'existing' });
assert.deepEqual(metadataPanel.attributes.Classification, { system: 'IFC', type: 'IfcBuildingElementProxy', identifier: 'PANEL-001', attributes_json: '{"predefined_type":"ELEMENT","load_bearing":false}' });

await assert.rejects(
  () => bridge.build_model({ runtime: 'mock', code: JSON.stringify({
    version: 1,
    units: 'mm',
    operations: [
      { op: 'reset' },
      { op: 'box', id: 'duplicate-id', name: 'Duplicate_A', origin: [0, 0, 0], size: [10, 10, 10] },
      { op: 'box', id: 'duplicate-id', name: 'Duplicate_B', origin: [20, 0, 0], size: [10, 10, 10] }
    ]
  }) }),
  /object id already exists: duplicate-id/
);

await assert.rejects(
  () => bridge.build_model({ runtime: 'mock', code: JSON.stringify({
    version: 1,
    units: 'mm',
    operations: [
      { op: 'reset' },
      { op: 'box', id: 'rename-a', name: 'Rename_A', origin: [0, 0, 0], size: [10, 10, 10] },
      { op: 'box', id: 'rename-b', name: 'Rename_B', origin: [20, 0, 0], size: [10, 10, 10] },
      { op: 'rename', target_id: 'rename-a', new_name: 'Rename_B' }
    ]
  }) }),
  /rename target already exists: Rename_B/
);

await assert.rejects(
  () => bridge.build_model({ runtime: 'mock', code: JSON.stringify({
    version: 1,
    units: 'mm',
    operations: [
      { op: 'reset' },
      { op: 'material', name: 'Conflict_Material', color: '#333333' },
      { op: 'box', id: 'conflict-a', name: 'Conflict_A', origin: [0, 0, 0], size: [10, 10, 10] },
      { op: 'box', id: 'conflict-b', name: 'Conflict_B', origin: [20, 0, 0], size: [10, 10, 10] },
      { op: 'set_material', target_id: 'conflict-a', name: 'Conflict_B', material: 'Conflict_Material' }
    ]
  }) }),
  /object not found: id:conflict-a name:Conflict_B/
);

const prismCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Roof_Test', color: '#111111' },
    { op: 'prism', name: 'Triangular_Gable_Prism', origin: [0, 0, 3000], plane: 'xz', points: [[0, 0], [2500, 900], [5000, 0]], depth: 6000, material: 'Roof_Test' }
  ]
});
const prismBuilt = await bridge.build_model({ runtime: 'mock', code: prismCode });
const prismSnapshot = prismBuilt.snapshot;
assert.equal(prismSnapshot.totals.groups, 1);
assert.equal(prismSnapshot.totals.faces, 5);
assert.equal(prismSnapshot.totals.edges, 9);
assert.equal(prismSnapshot.bounding_box.w, 5000);
assert.equal(prismSnapshot.bounding_box.d, 6000);
assert.equal(prismSnapshot.bounding_box.h, 900);
assert.ok(prismSnapshot.material_names.includes('Roof_Test'));

const panelCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Wall_Test', color: '#efe7dc' },
    { op: 'panel_with_openings', name: 'Wall_With_Door_Window', origin: [0, 0, 0], plane: 'xz', size: [5000, 3000], thickness: 150, openings: [
      { name: 'Door', x: 600, y: 0, width: 900, height: 2100 },
      { name: 'Window', x: 2400, y: 1100, width: 1200, height: 900 }
    ], material: 'Wall_Test' }
  ]
});
const panelBuilt = await bridge.build_model({ runtime: 'mock', code: panelCode });
const panelSnapshot = panelBuilt.snapshot;
assert.equal(panelSnapshot.totals.groups, 1);
assert.equal(panelSnapshot.totals.faces, 14);
assert.equal(panelSnapshot.totals.edges, 40);
assert.equal(panelSnapshot.bounding_box.w, 5000);
assert.equal(panelSnapshot.bounding_box.d, 150);
assert.equal(panelSnapshot.bounding_box.h, 3000);
assert.ok(panelSnapshot.material_names.includes('Wall_Test'));

const meshCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Mesh_Test', color: '#336699' },
    { op: 'mesh', name: 'Indexed_Tetrahedron', vertices: [[0, 0, 0], [1000, 0, 0], [500, 800, 0], [500, 300, 900]], faces: [[0, 1, 2], [0, 3, 1], [1, 3, 2], [2, 3, 0]], material: 'Mesh_Test', smooth: 'all' }
  ]
});
const meshBuilt = await bridge.build_model({ runtime: 'mock', code: meshCode });
const meshSnapshot = meshBuilt.snapshot;
assert.equal(meshSnapshot.totals.groups, 1);
assert.equal(meshSnapshot.totals.faces, 4);
assert.equal(meshSnapshot.totals.edges, 6);
assert.equal(meshSnapshot.bounding_box.w, 1000);
assert.equal(meshSnapshot.bounding_box.d, 800);
assert.equal(meshSnapshot.bounding_box.h, 900);
assert.ok(meshSnapshot.material_names.includes('Mesh_Test'));

const roundedBoxCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Rounded_Product_Test', color: '#e8ece8' },
    { op: 'rounded_box', name: 'Rounded_Product_Shell', origin: [-50, -30, 0], size: [100, 60, 12], radius: 12, segments: 4, material: 'Rounded_Product_Test', smooth: 'all' }
  ]
});
const roundedBoxBuilt = await bridge.build_model({ runtime: 'mock', code: roundedBoxCode });
const roundedBoxSnapshot = roundedBoxBuilt.snapshot;
const roundedBox = roundedBoxSnapshot.groups.find((group) => group.name === 'Rounded_Product_Shell');
assert.equal(roundedBoxSnapshot.totals.groups, 1);
assert.equal(roundedBox.kind, 'rounded_box');
assert.equal(roundedBox.faces, 22);
assert.equal(roundedBox.edges, 60);
assert.equal(roundedBox.bounding_box.w, 100);
assert.equal(roundedBox.bounding_box.d, 60);
assert.equal(roundedBox.bounding_box.h, 12);
assert.deepEqual(roundedBox.resolution_hint, { segments: 4 });
assert.ok(roundedBoxSnapshot.material_names.includes('Rounded_Product_Test'));

const beveledPanelCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Beveled_Product_Test', color: '#30343b' },
    { op: 'beveled_panel', name: 'Beveled_Faceplate', origin: [-60, -35, 4], size: [120, 70, 6], bevel: 10, material: 'Beveled_Product_Test' }
  ]
});
const beveledPanelBuilt = await bridge.build_model({ runtime: 'mock', code: beveledPanelCode });
const beveledPanelSnapshot = beveledPanelBuilt.snapshot;
const beveledPanel = beveledPanelSnapshot.groups.find((group) => group.name === 'Beveled_Faceplate');
assert.equal(beveledPanelSnapshot.totals.groups, 1);
assert.equal(beveledPanel.kind, 'beveled_panel');
assert.equal(beveledPanel.faces, 10);
assert.equal(beveledPanel.edges, 24);
assert.equal(beveledPanel.bounding_box.w, 120);
assert.equal(beveledPanel.bounding_box.d, 70);
assert.equal(beveledPanel.bounding_box.h, 6);
assert.ok(beveledPanelSnapshot.material_names.includes('Beveled_Product_Test'));

const recessCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Recess_Dark', color: '#090909' },
    { op: 'recess', name: 'Rectangular_Product_Recess', center: [0, 0, 12], size: [80, 36], depth: 5, material: 'Recess_Dark' },
    { op: 'recess', name: 'Rounded_Product_Recess', center: [100, 0, 12], size: [90, 42], depth: 7, radius: 12, segments: 4, material: 'Recess_Dark', smooth: 'all' }
  ]
});
const recessBuilt = await bridge.build_model({ runtime: 'mock', code: recessCode });
const recessSnapshot = recessBuilt.snapshot;
const rectangularRecess = recessSnapshot.groups.find((group) => group.name === 'Rectangular_Product_Recess');
const roundedRecess = recessSnapshot.groups.find((group) => group.name === 'Rounded_Product_Recess');
assert.equal(recessSnapshot.totals.groups, 2);
assert.equal(rectangularRecess.kind, 'recess');
assert.equal(rectangularRecess.faces, 5);
assert.equal(rectangularRecess.edges, 12);
assert.equal(rectangularRecess.bounding_box.w, 80);
assert.equal(rectangularRecess.bounding_box.d, 36);
assert.equal(rectangularRecess.bounding_box.h, 5);
assert.deepEqual(rectangularRecess.resolution_hint, { segments: 5 });
assert.equal(roundedRecess.kind, 'recess');
assert.equal(roundedRecess.faces, 21);
assert.equal(roundedRecess.edges, 60);
assert.equal(roundedRecess.bounding_box.w, 90);
assert.equal(roundedRecess.bounding_box.d, 42);
assert.equal(roundedRecess.bounding_box.h, 7);
assert.deepEqual(roundedRecess.resolution_hint, { segments: 4 });
assert.ok(recessSnapshot.material_names.includes('Recess_Dark'));

const engravedLineCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Groove_Dark', color: '#020202' },
    { op: 'engraved_line', name: 'Straight_Engraved_Line', points: [[0, 0, 8], [80, 0, 8]], width: 4, depth: 1.5, material: 'Groove_Dark' },
    { op: 'engraved_line', name: 'Bent_Engraved_Line', points: [[0, 30, 8], [40, 30, 8], [40, 70, 8]], width: 5, depth: 2, material: 'Groove_Dark' }
  ]
});
const engravedLineBuilt = await bridge.build_model({ runtime: 'mock', code: engravedLineCode });
const engravedLineSnapshot = engravedLineBuilt.snapshot;
const straightLine = engravedLineSnapshot.groups.find((group) => group.name === 'Straight_Engraved_Line');
const bentLine = engravedLineSnapshot.groups.find((group) => group.name === 'Bent_Engraved_Line');
assert.equal(engravedLineSnapshot.totals.groups, 2);
assert.equal(straightLine.kind, 'engraved_line');
assert.equal(straightLine.faces, 5);
assert.equal(straightLine.edges, 12);
assert.equal(straightLine.bounding_box.w, 80);
assert.equal(straightLine.bounding_box.d, 4);
assert.equal(straightLine.bounding_box.h, 1.5);
assert.equal(bentLine.kind, 'engraved_line');
assert.equal(bentLine.faces, 10);
assert.equal(bentLine.edges, 24);
assert.equal(bentLine.bounding_box.w, 42.5);
assert.equal(bentLine.bounding_box.d, 42.5);
assert.equal(bentLine.bounding_box.h, 2);
assert.ok(engravedLineSnapshot.material_names.includes('Groove_Dark'));

const slotCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Slot_Dark', color: '#030303' },
    { op: 'slot', name: 'Speaker_Slot', center: [0, 0, 8], length: 72, width: 14, depth: 3, segments: 4, material: 'Slot_Dark' }
  ]
});
const slotBuilt = await bridge.build_model({ runtime: 'mock', code: slotCode });
const slotSnapshot = slotBuilt.snapshot;
const speakerSlot = slotSnapshot.groups.find((group) => group.name === 'Speaker_Slot');
assert.equal(slotSnapshot.totals.groups, 1);
assert.equal(speakerSlot.kind, 'slot');
assert.equal(speakerSlot.faces, 19);
assert.equal(speakerSlot.edges, 54);
assert.equal(speakerSlot.bounding_box.w, 72);
assert.equal(speakerSlot.bounding_box.d, 14);
assert.equal(speakerSlot.bounding_box.h, 3);
assert.deepEqual(speakerSlot.resolution_hint, { segments: 4 });
assert.ok(slotSnapshot.material_names.includes('Slot_Dark'));

const editingTransformProfileCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Edit_Base', color: '#d7d9dc' },
    { op: 'material', name: 'Edit_Accent', color: '#3498db' },
    { op: 'material', name: 'Edit_Hidden', color: '#222222' },
    { op: 'box', name: 'Editable_Block', origin: [0, 0, 0], size: [100, 60, 20], material: 'Edit_Base' },
    { op: 'box', name: 'Temporary_Block', origin: [130, 0, 0], size: [30, 30, 20], material: 'Edit_Hidden' },
    { op: 'box', name: 'Center_Pivot_Block', origin: [220, 0, 0], size: [40, 30, 20], material: 'Edit_Base' },
    { op: 'box', name: 'Axis_Rotated_Block', origin: [300, 0, 0], size: [50, 30, 18], material: 'Edit_Base' },
    { op: 'box', name: 'Local_Axis_Block', origin: [390, 0, 0], size: [50, 30, 18], material: 'Edit_Base' },
    { op: 'box', name: 'Matrix_Block', origin: [0, -80, 0], size: [40, 20, 15], material: 'Edit_Base' },
    { op: 'rename', name: 'Editable_Block', new_name: 'Edited_Block' },
    { op: 'set_material', name: 'Edited_Block', material: 'Edit_Accent' },
    { op: 'transform_object', name: 'Edited_Block', translate: [20, 10, 5], rotateZ: 15, scale: [1.2, 1, 1] },
    { op: 'transform_object', name: 'Center_Pivot_Block', pivot: 'center', scale: [1.5, 1, 1], rotateZ: 20 },
    { op: 'transform_object', name: 'Axis_Rotated_Block', pivot: 'center', axis: [1, 1, 0], angle: 35 },
    { op: 'transform_object', name: 'Local_Axis_Block', pivot: 'center', rotateZ: 35 },
    { op: 'transform_object', name: 'Local_Axis_Block', pivot: 'center', local_axis: 'x', local_angle: 40 },
    { op: 'transform_object', name: 'Matrix_Block', matrix: [1, 0, 0, 0, 0.4, 1, 0, 0, 0, 0, 1, 0, 0, 0, 5, 1] },
    { op: 'set_visibility', name: 'Temporary_Block', visible: false },
    { op: 'profile_extrude', name: 'Panel_Profile_With_Hole', origin: [0, 120, 0], plane: 'xy', outer: [[0, 0], [120, 0], [150, 45], [110, 90], [20, 90], [0, 45]], holes: [{ points: [[70, 30], [88, 45], [70, 62], [52, 45]] }], depth: 12, material: 'Edit_Base' },
    { op: 'face_with_holes', name: 'Flat_Profile_With_Hole', origin: [180, 120, 0], plane: 'xy', outer: [[0, 0], [90, 0], [110, 35], [80, 70], [15, 60], [-10, 25]], holes: [{ points: [[35, 25], [65, 25], [50, 48]] }], material: 'Edit_Accent' },
    { op: 'delete', name: 'Temporary_Block' }
  ]
});
const editingTransformProfileBuilt = await bridge.build_model({ runtime: 'mock', code: editingTransformProfileCode });
const editingTransformProfileSnapshot = editingTransformProfileBuilt.snapshot;
const editedBlock = editingTransformProfileSnapshot.groups.find((group) => group.name === 'Edited_Block');
const profilePanel = editingTransformProfileSnapshot.groups.find((group) => group.name === 'Panel_Profile_With_Hole');
const flatProfile = editingTransformProfileSnapshot.groups.find((group) => group.name === 'Flat_Profile_With_Hole');
const centerPivotBlock = editingTransformProfileSnapshot.groups.find((group) => group.name === 'Center_Pivot_Block');
const axisRotatedBlock = editingTransformProfileSnapshot.groups.find((group) => group.name === 'Axis_Rotated_Block');
const localAxisBlock = editingTransformProfileSnapshot.groups.find((group) => group.name === 'Local_Axis_Block');
const matrixBlock = editingTransformProfileSnapshot.groups.find((group) => group.name === 'Matrix_Block');
assert.equal(editingTransformProfileSnapshot.totals.groups, 7);
assert.equal(editingTransformProfileSnapshot.groups.some((group) => group.name === 'Temporary_Block'), false);
assert.equal(editedBlock.kind, 'box');
assert.equal(editedBlock.material, 'Edit_Accent');
assert.ok(editedBlock.bounding_box.w > 110);
assert.ok(editedBlock.bounding_box.d > 80);
assert.equal(centerPivotBlock.kind, 'box');
assert.ok(centerPivotBlock.bounding_box.w > 65);
assert.ok(centerPivotBlock.bounding_box.d > 45);
assert.ok(centerPivotBlock.bounding_box.min[0] < 220);
assert.equal(axisRotatedBlock.kind, 'box');
assert.ok(axisRotatedBlock.bounding_box.w > 55);
assert.ok(axisRotatedBlock.bounding_box.h > 35);
assert.deepEqual(axisRotatedBlock.transform.object_transform.axis, [1 / Math.sqrt(2), 1 / Math.sqrt(2), 0]);
assert.equal(axisRotatedBlock.transform.object_transform.angle, 35);
assert.equal(localAxisBlock.kind, 'box');
assert.ok(localAxisBlock.bounding_box.w > 55);
assert.ok(localAxisBlock.bounding_box.h > 30);
assert.deepEqual(localAxisBlock.transform.object_transform.local_axis, [1, 0, 0]);
assert.equal(localAxisBlock.transform.object_transform.local_angle, 40);
assert.ok(Math.abs(localAxisBlock.transform.object_transform.local_model_axis[0] - Math.cos(35 * Math.PI / 180)) < 1e-12);
assert.ok(Math.abs(localAxisBlock.transform.object_transform.local_model_axis[1] - Math.sin(35 * Math.PI / 180)) < 1e-12);
assert.ok(Math.abs(localAxisBlock.transform.object_transform.local_model_axis[2]) < 1e-12);
assert.equal(matrixBlock.kind, 'box');
assert.equal(matrixBlock.bounding_box.w, 48);
assert.equal(matrixBlock.bounding_box.h, 15);
assert.deepEqual(matrixBlock.bounding_box.min, [-32, -80, 5]);
assert.deepEqual(matrixBlock.transform.object_transform.matrix, [1, 0, 0, 0, 0.4, 1, 0, 0, 0, 0, 1, 0, 0, 0, 5, 1]);
assert.deepEqual(matrixBlock.transform.object_transform.matrix_decomposition.translate, [0, 0, 5]);
assert.deepEqual(matrixBlock.transform.object_transform.matrix_decomposition.x_axis, [1, 0, 0]);
assert.equal(matrixBlock.transform.object_transform.matrix_decomposition.scale[0], 1);
assert.ok(matrixBlock.transform.object_transform.matrix_decomposition.scale[1] > 1.07);
assert.equal(matrixBlock.transform.object_transform.matrix_decomposition.determinant, 1);
assert.equal(matrixBlock.transform.object_transform.matrix_decomposition.mirrored, false);
assert.equal(matrixBlock.transform.object_transform.matrix_decomposition.affine, true);
assert.deepEqual(matrixBlock.transform.object_transform.matrix_decomposition.non_affine_reasons, []);
assert.deepEqual(matrixBlock.transform.object_transform.matrix_decomposition.homogeneous, { perspective: [0, 0, 0], w: 1 });
assert.equal(matrixBlock.transform.object_transform.matrix_decomposition.rotation_euler_degrees, null);
assert.equal(profilePanel.kind, 'profile_extrude');
assert.equal(profilePanel.faces, 12);
assert.equal(profilePanel.edges, 30);
assert.equal(profilePanel.bounding_box.w, 150);
assert.equal(profilePanel.bounding_box.d, 90);
assert.equal(profilePanel.bounding_box.h, 12);
assert.equal(flatProfile.kind, 'face_with_holes');
assert.equal(flatProfile.faces, 1);
assert.equal(flatProfile.edges, 9);
assert.equal(flatProfile.bounding_box.w, 120);
assert.equal(flatProfile.bounding_box.d, 70);
assert.ok(editingTransformProfileSnapshot.material_names.includes('Edit_Accent'));

const transformDecompositionCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'box', name: 'Euler_Matrix_Block', origin: [0, 0, 0], size: [20, 10, 8] },
    { op: 'box', name: 'Non_Affine_Block', origin: [40, 0, 0], size: [20, 10, 8] },
    { op: 'transform_object', name: 'Euler_Matrix_Block', matrix: [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 10, 20, 5, 1] },
    { op: 'transform_object', name: 'Non_Affine_Block', matrix: [1, 0, 0, 0.1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2] }
  ]
});
const transformDecompositionBuilt = await bridge.build_model({ runtime: 'mock', code: transformDecompositionCode });
const eulerMatrixBlock = transformDecompositionBuilt.snapshot.groups.find((group) => group.name === 'Euler_Matrix_Block');
const nonAffineBlock = transformDecompositionBuilt.snapshot.groups.find((group) => group.name === 'Non_Affine_Block');
assert.equal(eulerMatrixBlock.transform.object_transform.matrix_decomposition.affine, true);
assert.equal(eulerMatrixBlock.transform.object_transform.matrix_decomposition.rotation_euler_order, 'XYZ');
assert.ok(Math.abs(eulerMatrixBlock.transform.object_transform.matrix_decomposition.rotation_euler_degrees[2] - 90) < 1e-9);
assert.equal(nonAffineBlock.transform.object_transform.matrix_decomposition.affine, false);
assert.deepEqual(nonAffineBlock.transform.object_transform.matrix_decomposition.non_affine_reasons, ['perspective_terms', 'homogeneous_w_not_one']);
assert.deepEqual(nonAffineBlock.transform.object_transform.matrix_decomposition.homogeneous, { perspective: [0.1, 0, 0], w: 2 });

await assert.rejects(
  () => bridge.build_model({ runtime: 'mock', code: JSON.stringify({
    version: 1,
    units: 'mm',
    operations: [
      { op: 'reset' },
      { op: 'profile_extrude', name: 'Self_Intersecting_Profile', origin: [0, 0, 0], plane: 'xy', outer: [[0, 0], [100, 0], [20, 80], [80, -20], [100, 80]], depth: 10 }
    ]
  }) }),
  /Self_Intersecting_Profile\.outer must not self-intersect/
);

await assert.rejects(
  () => bridge.build_model({ runtime: 'mock', code: JSON.stringify({
    version: 1,
    units: 'mm',
    operations: [
      { op: 'reset' },
      { op: 'face_with_holes', name: 'Boundary_Touching_Hole', origin: [0, 0, 0], plane: 'xy', outer: [[0, 0], [100, 0], [100, 80], [0, 80]], holes: [{ points: [[0, 20], [20, 20], [20, 40], [0, 40]] }] }
    ]
  }) }),
  /Boundary_Touching_Hole\.holes\[0\] must fit inside outer profile without touching boundary/
);

const structuredProductHelpersCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Helper_Dark', color: '#050505' },
    { op: 'material', name: 'Helper_Plastic', color: '#d8d8d0' },
    { op: 'slot_array', name: 'Speaker_Grille_Array', center: [0, 0, 12], count: 3, spacing: 74, length: 64, width: 10, depth: 3, direction: 'x', segments: 4, material: 'Helper_Dark' },
    { op: 'rib', name: 'Internal_Rib_X', origin: [-60, 40, 0], length: 90, height: 18, thickness: 5, direction: 'x', material: 'Helper_Plastic' },
    { op: 'rib', name: 'Internal_Rib_Y', origin: [60, -45, 0], length: 70, height: 16, thickness: 4, direction: 'y', material: 'Helper_Plastic' },
    { op: 'standoff_boss', name: 'Mounting_Standoff', center: [0, 80, 0], outer_radius: 24, inner_radius: 8, height: 30, segments: 12, material: 'Helper_Plastic', hole_material: 'Helper_Dark' },
    { op: 'component_definition', name: 'Helper_Def', operations: [
      { op: 'rib', name: 'Nested_Rib', origin: [0, 0, 0], length: 30, height: 8, thickness: 3, material: 'Helper_Plastic' },
      { op: 'slot_array', name: 'Nested_Slots', center: [15, 15, 8], count: 2, spacing: 10, length: 20, width: 6, depth: 2, material: 'Helper_Dark' }
    ] },
    { op: 'component_instance', name: 'Helper_Instance', definition: 'Helper_Def', origin: [120, 60, 0] }
  ]
});
const structuredHelpersBuilt = await bridge.build_model({ runtime: 'mock', code: structuredProductHelpersCode });
const structuredHelpersSnapshot = structuredHelpersBuilt.snapshot;
const speakerGrilleArray = structuredHelpersSnapshot.groups.find((group) => group.name === 'Speaker_Grille_Array');
const internalRibX = structuredHelpersSnapshot.groups.find((group) => group.name === 'Internal_Rib_X');
const internalRibY = structuredHelpersSnapshot.groups.find((group) => group.name === 'Internal_Rib_Y');
const mountingStandoff = structuredHelpersSnapshot.groups.find((group) => group.name === 'Mounting_Standoff');
assert.equal(structuredHelpersSnapshot.totals.groups, 4);
assert.equal(structuredHelpersSnapshot.totals.instances, 1);
assert.ok(structuredHelpersSnapshot.component_definitions.includes('Helper_Def'));
assert.equal(speakerGrilleArray.kind, 'slot_array');
assert.equal(speakerGrilleArray.faces, 57);
assert.equal(speakerGrilleArray.edges, 162);
assert.equal(speakerGrilleArray.bounding_box.w, 212);
assert.equal(speakerGrilleArray.bounding_box.d, 10);
assert.equal(speakerGrilleArray.bounding_box.h, 3);
assert.equal(internalRibX.kind, 'rib');
assert.equal(internalRibX.bounding_box.w, 90);
assert.equal(internalRibX.bounding_box.d, 5);
assert.equal(internalRibX.bounding_box.h, 18);
assert.equal(internalRibY.kind, 'rib');
assert.equal(internalRibY.bounding_box.w, 4);
assert.equal(internalRibY.bounding_box.d, 70);
assert.equal(internalRibY.bounding_box.h, 16);
assert.equal(mountingStandoff.kind, 'standoff_boss');
assert.equal(mountingStandoff.faces, 64);
assert.equal(mountingStandoff.edges, 108);
assert.equal(mountingStandoff.bounding_box.w, 48);
assert.equal(mountingStandoff.bounding_box.d, 48);
assert.equal(mountingStandoff.bounding_box.h, 30);
assert.deepEqual(mountingStandoff.resolution_hint, { segments: 12 });
assert.ok(structuredHelpersSnapshot.material_names.includes('Helper_Dark'));
assert.ok(structuredHelpersSnapshot.material_names.includes('Helper_Plastic'));

const textMarkerCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Text_Light', color: '#eeeeee' },
    { op: 'material', name: 'Text_Dark', color: '#111111' },
    { op: 'text_emboss', name: 'Logo_Emboss', center: [0, 0, 10], text: 'ALMA', height: 12, depth: 2, spacing: 1, material: 'Text_Light' },
    { op: 'text_engrave', name: 'Logo_Engrave', origin: [40, 0, 10], text: '07', height: 10, depth: 1.5, align: 'right', material: 'Text_Dark' },
    { op: 'text_emboss', name: 'Outline_Emboss', center: [80, 0, 12], text: 'OK', height: 10, depth: 2, mode: 'font_outline', font: 'Arial', material: 'Text_Light' },
    { op: 'text_engrave', name: 'Outline_Engrave', center: [80, 20, 12], text: 'CUT', height: 9, depth: 1.2, outline: true, font: 'Arial', italic: true, material: 'Text_Dark' },
    { op: 'text_3d', name: 'True_Text_3D', center: [0, 24, 12], text: 'ALMA', height: 14, extrusion: 3, font: 'Arial', align: 'center', bold: true, material: 'Text_Light' }
  ]
});
const textMarkerBuilt = await bridge.build_model({ runtime: 'mock', code: textMarkerCode });
const textMarkerSnapshot = textMarkerBuilt.snapshot;
const logoEmboss = textMarkerSnapshot.groups.find((group) => group.name === 'Logo_Emboss');
const logoEngrave = textMarkerSnapshot.groups.find((group) => group.name === 'Logo_Engrave');
const outlineEmboss = textMarkerSnapshot.groups.find((group) => group.name === 'Outline_Emboss');
const outlineEngrave = textMarkerSnapshot.groups.find((group) => group.name === 'Outline_Engrave');
const trueText3d = textMarkerSnapshot.groups.find((group) => group.name === 'True_Text_3D');
assert.equal(textMarkerSnapshot.totals.groups, 5);
assert.equal(logoEmboss.kind, 'text_emboss');
assert.equal(logoEmboss.faces, 24);
assert.equal(logoEmboss.edges, 48);
assert.ok(Math.abs(logoEmboss.bounding_box.w - 31.8) < 1e-9);
assert.equal(logoEmboss.bounding_box.d, 12);
assert.equal(logoEmboss.bounding_box.h, 2);
assert.equal(logoEngrave.kind, 'text_engrave');
assert.equal(logoEngrave.faces, 12);
assert.equal(logoEngrave.edges, 24);
assert.equal(logoEngrave.bounding_box.min[0], 26);
assert.equal(logoEngrave.bounding_box.max[0], 40);
assert.equal(logoEngrave.bounding_box.h, 1.5);
assert.equal(outlineEmboss.kind, 'text_emboss');
assert.equal(outlineEmboss.faces, 20);
assert.equal(outlineEmboss.edges, 48);
assert.ok(Math.abs(outlineEmboss.bounding_box.w - 12.4) < 1e-9);
assert.equal(outlineEmboss.bounding_box.h, 2);
assert.equal(outlineEmboss.attributes.Text3D.mode, 'font_outline');
assert.equal(outlineEmboss.attributes.Text3D.surface_kind, 'text_emboss');
assert.equal(outlineEmboss.attributes.Text3D.direction, 'emboss');
assert.equal(outlineEngrave.kind, 'text_engrave');
assert.equal(outlineEngrave.faces, 30);
assert.equal(outlineEngrave.edges, 72);
assert.ok(Math.abs(outlineEngrave.bounding_box.w - 17.2422) < 1e-9);
assert.equal(outlineEngrave.bounding_box.min[2], 10.8);
assert.ok(Math.abs(outlineEngrave.bounding_box.h - 1.2) < 1e-9);
assert.equal(outlineEngrave.attributes.Text3D.mode, 'font_outline');
assert.equal(outlineEngrave.attributes.Text3D.surface_kind, 'text_engrave');
assert.equal(outlineEngrave.attributes.Text3D.direction, 'engrave');
assert.equal(trueText3d.kind, 'text_3d');
assert.equal(trueText3d.faces, 40);
assert.equal(trueText3d.edges, 96);
assert.ok(Math.abs(trueText3d.bounding_box.w - 40.2164) < 1e-9);
assert.equal(trueText3d.bounding_box.d, 14);
assert.equal(trueText3d.bounding_box.h, 3);
assert.deepEqual(trueText3d.attributes.Text3D, {
  text: 'ALMA',
  font: 'Arial',
  align: 'center',
  bold: true,
  italic: false,
  filled: true,
  height: 14,
  extrusion: 3,
  tolerance: 0,
  glyphs: 4,
  mock_bounds: true
});
assert.ok(textMarkerSnapshot.material_names.includes('Text_Light'));
assert.ok(textMarkerSnapshot.material_names.includes('Text_Dark'));

const buttonOnPanelCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Button_Product_Test', color: '#f4f4f0' },
    { op: 'button_on_panel', name: 'Round_Face_Button', center: [0, 0, 10], radius: 18, height: 8, segments: 12, material: 'Button_Product_Test' },
    { op: 'button_on_panel', name: 'Pill_Shoulder_Button', center: [70, 0, 10], size: [54, 24], corner_radius: 12, height: 7, segments: 6, material: 'Button_Product_Test' }
  ]
});
const buttonOnPanelBuilt = await bridge.build_model({ runtime: 'mock', code: buttonOnPanelCode });
const buttonOnPanelSnapshot = buttonOnPanelBuilt.snapshot;
const roundButton = buttonOnPanelSnapshot.groups.find((group) => group.name === 'Round_Face_Button');
const pillButton = buttonOnPanelSnapshot.groups.find((group) => group.name === 'Pill_Shoulder_Button');
assert.equal(buttonOnPanelSnapshot.totals.groups, 2);
assert.equal(roundButton.kind, 'button_on_panel');
assert.equal(roundButton.faces, 32);
assert.equal(roundButton.edges, 54);
assert.equal(roundButton.bounding_box.w, 36);
assert.equal(roundButton.bounding_box.d, 36);
assert.equal(roundButton.bounding_box.h, 8);
assert.deepEqual(roundButton.resolution_hint, { segments: 12 });
assert.equal(pillButton.kind, 'button_on_panel');
assert.equal(pillButton.faces, 28);
assert.equal(pillButton.edges, 78);
assert.equal(pillButton.bounding_box.w, 54);
assert.equal(pillButton.bounding_box.d, 24);
assert.equal(pillButton.bounding_box.h, 7);
assert.deepEqual(pillButton.resolution_hint, { segments: 6 });
assert.ok(buttonOnPanelSnapshot.material_names.includes('Button_Product_Test'));

const analogStickCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Analog_Stick_Test', color: '#151515' },
    { op: 'analog_stick', name: 'Default_Analog_Stick', origin: [0, 0, 0], height: 40, base_radius: 22, shaft_radius: 12, cap_radius: 28, top_radius: 20, segments: 12, material: 'Analog_Stick_Test' },
    { op: 'analog_stick', name: 'Profile_Analog_Stick', origin: [80, 0, 0], profile: [[0, 18], [12, 28], [36, 20]], segments: 12, material: 'Analog_Stick_Test' }
  ]
});
const analogStickBuilt = await bridge.build_model({ runtime: 'mock', code: analogStickCode });
const analogStickSnapshot = analogStickBuilt.snapshot;
const defaultStick = analogStickSnapshot.groups.find((group) => group.name === 'Default_Analog_Stick');
const profileStick = analogStickSnapshot.groups.find((group) => group.name === 'Profile_Analog_Stick');
assert.equal(analogStickSnapshot.totals.groups, 2);
assert.equal(defaultStick.kind, 'analog_stick');
assert.equal(defaultStick.faces, 92);
assert.equal(defaultStick.edges, 138);
assert.equal(defaultStick.bounding_box.w, 56);
assert.equal(defaultStick.bounding_box.d, 56);
assert.equal(defaultStick.bounding_box.h, 40);
assert.deepEqual(defaultStick.resolution_hint, { segments: 12 });
assert.equal(profileStick.kind, 'analog_stick');
assert.equal(profileStick.faces, 68);
assert.equal(profileStick.edges, 102);
assert.equal(profileStick.bounding_box.w, 56);
assert.equal(profileStick.bounding_box.d, 56);
assert.equal(profileStick.bounding_box.h, 36);
assert.deepEqual(profileStick.resolution_hint, { segments: 12 });
assert.ok(analogStickSnapshot.material_names.includes('Analog_Stick_Test'));

const edgeTreatmentCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Edge_Test', color: '#bbbbbb' },
    { op: 'fillet', name: 'Soft_Edge_Block', origin: [0, 0, 0], size: [80, 40, 12], radius: 8, segments: 4, material: 'Edge_Test' },
    { op: 'chamfer', name: 'Chamfer_Edge_Block', origin: [100, 0, 0], size: [80, 40, 12], amount: 6, material: 'Edge_Test' },
    { op: 'component_definition', name: 'Edge_Def', operations: [
      { op: 'chamfer', name: 'Nested_Chamfer', origin: [0, 0, 0], size: [20, 16, 6], amount: 3, material: 'Edge_Test' }
    ] },
    { op: 'component_instance', name: 'Edge_Instance', definition: 'Edge_Def', origin: [0, 80, 0] }
  ]
});
const edgeTreatmentBuilt = await bridge.build_model({ runtime: 'mock', code: edgeTreatmentCode });
const edgeTreatmentSnapshot = edgeTreatmentBuilt.snapshot;
const softEdgeBlock = edgeTreatmentSnapshot.groups.find((group) => group.name === 'Soft_Edge_Block');
const chamferEdgeBlock = edgeTreatmentSnapshot.groups.find((group) => group.name === 'Chamfer_Edge_Block');
assert.equal(edgeTreatmentSnapshot.totals.groups, 2);
assert.equal(edgeTreatmentSnapshot.totals.instances, 1);
assert.ok(edgeTreatmentSnapshot.component_definitions.includes('Edge_Def'));
assert.equal(softEdgeBlock.kind, 'fillet');
assert.equal(softEdgeBlock.faces, 22);
assert.equal(softEdgeBlock.edges, 60);
assert.equal(softEdgeBlock.bounding_box.w, 80);
assert.equal(softEdgeBlock.bounding_box.d, 40);
assert.equal(softEdgeBlock.bounding_box.h, 12);
assert.deepEqual(softEdgeBlock.resolution_hint, { segments: 4 });
assert.equal(chamferEdgeBlock.kind, 'chamfer');
assert.equal(chamferEdgeBlock.faces, 10);
assert.equal(chamferEdgeBlock.edges, 24);
assert.equal(chamferEdgeBlock.bounding_box.w, 80);
assert.equal(chamferEdgeBlock.bounding_box.d, 40);
assert.equal(chamferEdgeBlock.bounding_box.h, 12);
assert.ok(edgeTreatmentSnapshot.material_names.includes('Edge_Test'));

const booleanCutoutCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Cutout_Test', color: '#cccccc' },
    { op: 'boolean_cutout', name: 'Panel_Cutout', origin: [0, 0, 0], size: [120, 80, 8], cutouts: [{ name: 'USB_Cutout', center: [60, 40], size: [36, 18] }], material: 'Cutout_Test' },
    { op: 'component_definition', name: 'Cutout_Def', operations: [
      { op: 'boolean_cutout', name: 'Nested_Cutout', origin: [0, 0, 0], size: [40, 30, 5], cutouts: [{ center: [20, 15], size: [12, 8] }], material: 'Cutout_Test' }
    ] },
    { op: 'component_instance', name: 'Cutout_Instance', definition: 'Cutout_Def', origin: [150, 0, 0] }
  ]
});
const booleanCutoutBuilt = await bridge.build_model({ runtime: 'mock', code: booleanCutoutCode });
const booleanCutoutSnapshot = booleanCutoutBuilt.snapshot;
const panelCutout = booleanCutoutSnapshot.groups.find((group) => group.name === 'Panel_Cutout');
assert.equal(booleanCutoutSnapshot.totals.groups, 1);
assert.equal(booleanCutoutSnapshot.totals.instances, 1);
assert.ok(booleanCutoutSnapshot.component_definitions.includes('Cutout_Def'));
assert.equal(panelCutout.kind, 'boolean_cutout');
assert.equal(panelCutout.faces, 10);
assert.equal(panelCutout.edges, 24);
assert.equal(panelCutout.bounding_box.w, 120);
assert.equal(panelCutout.bounding_box.d, 80);
assert.equal(panelCutout.bounding_box.h, 8);
assert.ok(booleanCutoutSnapshot.material_names.includes('Cutout_Test'));

const shellFromProfilesCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Shell_Test', color: '#dddddd' },
    { op: 'shell_from_front_side_profiles', name: 'Controller_Shell_From_Profiles', origin: [0, 0, 0], front_profile: [[-40, 10], [40, 10], [56, 34], [46, 82], [20, 100], [-20, 100], [-46, 82], [-56, 34]], side_profile: [[0, 8], [40, 24], [100, 14]], material: 'Shell_Test' },
    { op: 'component_definition', name: 'Shell_Def', operations: [
      { op: 'shell_from_front_side_profiles', name: 'Nested_Shell', origin: [0, 0, 0], front_profile: [[-10, 0], [10, 0], [14, 18], [0, 28], [-14, 18]], side_profile: [[0, 4], [28, 8]], material: 'Shell_Test' }
    ] },
    { op: 'component_instance', name: 'Shell_Instance', definition: 'Shell_Def', origin: [100, 0, 0] }
  ]
});
const shellFromProfilesBuilt = await bridge.build_model({ runtime: 'mock', code: shellFromProfilesCode });
const shellFromProfilesSnapshot = shellFromProfilesBuilt.snapshot;
const controllerShellFromProfiles = shellFromProfilesSnapshot.groups.find((group) => group.name === 'Controller_Shell_From_Profiles');
assert.equal(shellFromProfilesSnapshot.totals.groups, 1);
assert.equal(shellFromProfilesSnapshot.totals.instances, 1);
assert.ok(shellFromProfilesSnapshot.component_definitions.includes('Shell_Def'));
assert.equal(controllerShellFromProfiles.kind, 'shell_from_front_side_profiles');
assert.equal(controllerShellFromProfiles.faces, 28);
assert.equal(controllerShellFromProfiles.edges, 42);
assert.equal(controllerShellFromProfiles.bounding_box.w, 112);
assert.equal(controllerShellFromProfiles.bounding_box.d, 43.2);
assert.equal(controllerShellFromProfiles.bounding_box.h, 90);
assert.deepEqual(controllerShellFromProfiles.resolution_hint, { segments: 8 });
assert.ok(shellFromProfilesSnapshot.material_names.includes('Shell_Test'));

const loftAndCylinderFaceCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Loft_Test', color: '#888888' },
    { op: 'loft_between_profiles', name: 'Grip_Loft', profiles: [
      { origin: [0, 0, 0], plane: 'xy', points: [[-20, -10], [20, -10], [25, 10], [-25, 10]] },
      { origin: [0, 0, 30], plane: 'xy', points: [[-28, -16], [28, -16], [34, 16], [-34, 16]] },
      { origin: [0, 0, 65], plane: 'xy', points: [[-18, -12], [18, -12], [22, 12], [-22, 12]] }
    ], material: 'Loft_Test' },
    { op: 'face_on_cylinder', name: 'Cylinder_Face_Button', cylinder_center: [100, 0, 0], cylinder_radius: 24, center: [124, 0, 40], width: 18, height: 26, depth: 4, material: 'Loft_Test' },
    { op: 'component_definition', name: 'Face_Def', operations: [
      { op: 'face_on_cylinder', name: 'Nested_Cylinder_Face', cylinder_center: [0, 0, 0], cylinder_radius: 12, center: [12, 0, 10], width: 8, height: 10, depth: 2, material: 'Loft_Test' }
    ] },
    { op: 'component_instance', name: 'Face_Instance', definition: 'Face_Def', origin: [160, 0, 0] }
  ]
});
const loftAndCylinderFaceBuilt = await bridge.build_model({ runtime: 'mock', code: loftAndCylinderFaceCode });
const loftAndCylinderFaceSnapshot = loftAndCylinderFaceBuilt.snapshot;
const gripLoft = loftAndCylinderFaceSnapshot.groups.find((group) => group.name === 'Grip_Loft');
const cylinderFaceButton = loftAndCylinderFaceSnapshot.groups.find((group) => group.name === 'Cylinder_Face_Button');
assert.equal(loftAndCylinderFaceSnapshot.totals.groups, 2);
assert.equal(loftAndCylinderFaceSnapshot.totals.instances, 1);
assert.ok(loftAndCylinderFaceSnapshot.component_definitions.includes('Face_Def'));
assert.equal(gripLoft.kind, 'loft_between_profiles');
assert.equal(gripLoft.faces, 20);
assert.equal(gripLoft.edges, 30);
assert.equal(gripLoft.bounding_box.w, 68);
assert.equal(gripLoft.bounding_box.d, 32);
assert.equal(gripLoft.bounding_box.h, 65);
assert.deepEqual(gripLoft.resolution_hint, { segments_z: 2 });
assert.equal(cylinderFaceButton.kind, 'face_on_cylinder');
assert.equal(cylinderFaceButton.faces, 6);
assert.equal(cylinderFaceButton.edges, 12);
assert.equal(cylinderFaceButton.bounding_box.w, 4);
assert.equal(cylinderFaceButton.bounding_box.d, 18);
assert.equal(cylinderFaceButton.bounding_box.h, 26);
assert.ok(loftAndCylinderFaceSnapshot.material_names.includes('Loft_Test'));

const pipeBetweenPointsCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Pipe_Test', color: '#666666' },
    { op: 'pipe_between_points', name: 'Diagonal_Pipe', points: [[0, 0, 0], [40, 30, 20], [70, 80, 35]], radius: 5, segments: 8, material: 'Pipe_Test' },
    { op: 'component_definition', name: 'Pipe_Def', operations: [
      { op: 'pipe_between_points', name: 'Nested_Pipe', start: [0, 0, 0], end: [0, 50, 20], radius: 4, segments: 6, material: 'Pipe_Test' }
    ] },
    { op: 'component_instance', name: 'Pipe_Instance', definition: 'Pipe_Def', origin: [100, 0, 0] }
  ]
});
const pipeBetweenPointsBuilt = await bridge.build_model({ runtime: 'mock', code: pipeBetweenPointsCode });
const pipeBetweenPointsSnapshot = pipeBetweenPointsBuilt.snapshot;
const diagonalPipe = pipeBetweenPointsSnapshot.groups.find((group) => group.name === 'Diagonal_Pipe');
assert.equal(pipeBetweenPointsSnapshot.totals.groups, 1);
assert.equal(pipeBetweenPointsSnapshot.totals.instances, 1);
assert.ok(pipeBetweenPointsSnapshot.component_definitions.includes('Pipe_Def'));
assert.equal(diagonalPipe.kind, 'pipe_between_points');
assert.equal(diagonalPipe.faces, 44);
assert.equal(diagonalPipe.edges, 66);
assert.ok(Math.abs(diagonalPipe.bounding_box.w - 77.45923643500014) < 1e-9);
assert.ok(Math.abs(diagonalPipe.bounding_box.d - 86.57432296387634) < 1e-9);
assert.ok(Math.abs(diagonalPipe.bounding_box.h - 44.48472543554132) < 1e-9);
assert.deepEqual(diagonalPipe.resolution_hint, { segments: 8 });
assert.ok(pipeBetweenPointsSnapshot.material_names.includes('Pipe_Test'));

const screwHoleCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Hole_Dark', color: '#050505' },
    { op: 'screw_hole', name: 'Simple_Screw_Hole', center: [0, 0, 12], radius: 8, depth: 5, segments: 12, material: 'Hole_Dark' },
    { op: 'screw_hole', name: 'Countersunk_Screw_Hole', center: [40, 0, 12], radius: 7, depth: 6, head_radius: 14, head_depth: 3, segments: 12, material: 'Hole_Dark' }
  ]
});
const screwHoleBuilt = await bridge.build_model({ runtime: 'mock', code: screwHoleCode });
const screwHoleSnapshot = screwHoleBuilt.snapshot;
const simpleScrewHole = screwHoleSnapshot.groups.find((group) => group.name === 'Simple_Screw_Hole');
const countersunkScrewHole = screwHoleSnapshot.groups.find((group) => group.name === 'Countersunk_Screw_Hole');
assert.equal(screwHoleSnapshot.totals.groups, 2);
assert.equal(simpleScrewHole.kind, 'screw_hole');
assert.equal(simpleScrewHole.faces, 44);
assert.equal(simpleScrewHole.edges, 66);
assert.equal(simpleScrewHole.bounding_box.w, 16);
assert.equal(simpleScrewHole.bounding_box.d, 16);
assert.equal(simpleScrewHole.bounding_box.h, 5);
assert.deepEqual(simpleScrewHole.resolution_hint, { segments: 12 });
assert.equal(countersunkScrewHole.kind, 'screw_hole');
assert.equal(countersunkScrewHole.faces, 68);
assert.equal(countersunkScrewHole.edges, 102);
assert.equal(countersunkScrewHole.bounding_box.w, 28);
assert.equal(countersunkScrewHole.bounding_box.d, 28);
assert.equal(countersunkScrewHole.bounding_box.h, 6);
assert.deepEqual(countersunkScrewHole.resolution_hint, { segments: 12 });
assert.ok(screwHoleSnapshot.material_names.includes('Hole_Dark'));

const pbrCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'PBR_Test', color: '#8a8178', workflow: 'pbr_metallic_roughness', alpha: 0.9, texture: { path: 'textures/base.jpg', width: 1200, height: 800 }, pbr: { metallic_factor: 0.85, roughness_factor: 0.32, ao_strength: 0.55, normal_style: 'opengl', normal_scale: 1.2, textures: { metallic: 'textures/metallic.jpg', roughness: 'textures/roughness.jpg', normal: 'textures/normal.jpg', ao: 'textures/ao.jpg', opacity: 'textures/opacity.jpg' } } },
    { op: 'box', name: 'PBR_Box', origin: [0, 0, 0], size: [100, 100, 100], material: 'PBR_Test' }
  ]
});
const pbrBuilt = await bridge.build_model({ runtime: 'mock', code: pbrCode });
const pbrSnapshot = pbrBuilt.snapshot;
const pbrMaterial = pbrSnapshot.materials.find((material) => material.name === 'PBR_Test');
assert.ok(pbrSnapshot.material_names.includes('PBR_Test'));
assert.equal(pbrMaterial.workflow, 'pbr_metallic_roughness');
assert.equal(pbrMaterial.alpha, 0.9);
assert.deepEqual(pbrMaterial.texture, { path: 'textures/base.jpg', width: 1200, height: 800 });
assert.equal(pbrMaterial.pbr.metallic_factor, 0.85);
assert.equal(pbrMaterial.pbr.roughness_factor, 0.32);
assert.equal(pbrMaterial.pbr.textures.normal, 'textures/normal.jpg');


const presentationCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Presentation_Test', color: '#efe7dc' },
    { op: 'box', name: 'Presentation_Box', origin: [0, 0, 0], size: [100, 100, 100], material: 'Presentation_Test' },
    { op: 'style', name: 'Presentation', display_edges: true, profiles: true, profile_width: 2, display_watermarks: false, face_style: 'shaded_with_textures', background_color: '#f7f4ed', sky_color: '#cfe8ff', ground_color: '#d8d0bf' },
    { op: 'shadow', display: true, time: '2026-05-08T14:30:00+08:00', light: 80, dark: 35, use_sun_for_shading: true },
    { op: 'rendering_options', edge_display_mode: 1, draw_hidden_geometry: false, display_color_by_layer: false, transparency: true }
  ]
});
const presentationBuilt = await bridge.build_model({ runtime: 'mock', code: presentationCode });
const presentationSnapshot = presentationBuilt.snapshot;
assert.equal(presentationSnapshot.style_state.name, 'Presentation');
assert.equal(presentationSnapshot.style_state.face_style, 'shaded_with_textures');
assert.equal(presentationSnapshot.style_state.background_color, '#f7f4ed');
assert.equal(presentationSnapshot.shadow_state.display, true);
assert.equal(presentationSnapshot.shadow_state.time, '2026-05-08T06:30:00.000Z');
assert.equal(presentationSnapshot.shadow_state.light, 80);
assert.equal(presentationSnapshot.rendering_options.edge_display_mode, 1);
assert.equal(presentationSnapshot.rendering_options.draw_hidden_geometry, false);
assert.equal(presentationSnapshot.rendering_options.transparency, true);

const expandedCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Roof_Test', color: '#222222' },
    { op: 'material', name: 'Post_Test', color: '#805533' },
    { op: 'gable_roof', name: 'Gable_Roof_Helper', origin: [0, 0, 3000], width: 5000, depth: 7000, rise: 1200, overhang: 300, material: 'Roof_Test' },
    { op: 'shed_roof', name: 'Shed_Roof_Helper', origin: [7000, 0, 2500], width: 3000, depth: 2500, rise: 600, overhang: 100, material: 'Roof_Test' },
    { op: 'cylinder', name: 'Round_Post_Helper', origin: [0, 9000, 0], radius: 150, height: 2800, segments: 12, material: 'Post_Test', smooth: 'all' },
    { op: 'component_definition', name: 'Baluster_Def', size: [80, 80, 900], material: 'Post_Test' },
    { op: 'component_definition', name: 'WindowUnit_Def', operations: [
      { op: 'material', name: 'Glass_Test', color: '#88ccee' },
      { op: 'box', name: 'Window_Glass', origin: [0, 0, 0], size: [900, 20, 700], material: 'Glass_Test' },
      { op: 'box', name: 'Window_Header_Frame', origin: [-40, -20, 700], size: [980, 60, 80], material: 'Post_Test' },
      { op: 'box', name: 'Window_Sill_Frame', origin: [-40, -20, -80], size: [980, 60, 80], material: 'Post_Test' }
    ] },
    { op: 'component_instance', name: 'Baluster_Instance_A', definition: 'Baluster_Def', origin: [1000, 9000, 0] },
    { op: 'component_instance', name: 'Baluster_Instance_B', definition: 'Baluster_Def', origin: [1040, 9000, 0] },
    { op: 'component_instance', name: 'Window_Instance_A', definition: 'WindowUnit_Def', origin: [3000, 9000, 1200] },
    { op: 'camera', eye: [7000, -9000, 5200], target: [2500, 2500, 1800], up: [0, 0, 1], fov: 35 }
  ]
});
const expandedBuilt = await bridge.build_model({ runtime: 'mock', code: expandedCode });
const expandedSnapshot = expandedBuilt.snapshot;
assert.equal(expandedSnapshot.totals.groups, 3);
assert.equal(expandedSnapshot.totals.instances, 3);
assert.ok(expandedSnapshot.totals.faces > 40);
assert.ok(expandedSnapshot.material_names.includes('Roof_Test'));
assert.ok(expandedSnapshot.material_names.includes('Post_Test'));
assert.ok(expandedSnapshot.material_names.includes('Glass_Test'));
assert.ok(expandedSnapshot.component_definitions.includes('Baluster_Def'));
assert.ok(expandedSnapshot.component_definitions.includes('WindowUnit_Def'));
assert.equal(expandedSnapshot.instances.length, 3);
assert.equal(expandedSnapshot.view_state.camera.fov, 35);
assert.ok(expandedSnapshot.warnings.some((warning) => warning.type === 'geometry.bbox_collision' && warning.relation === 'collision'));

const advancedCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Advanced_Test', color: '#445566' },
    { op: 'box', name: 'Translated_Box', origin: [0, 0, 0], size: [100, 200, 300], material: 'Advanced_Test', transform: { translate: [1000, 2000, 3000] } },
    { op: 'lofted_solid', name: 'Turned_Post', origin: [0, 0, 0], profile: [[0, 80], [500, 120], [1000, 70]], segments: 8, material: 'Advanced_Test', smooth: 'all' },
    { op: 'swept_path', name: 'Simple_Rail', path: [[0, 0, 1200], [1000, 0, 1200], [1600, 0, 1600]], radius: 40, segments: 8, material: 'Advanced_Test', smooth: 'all' },
    { op: 'scene', name: 'Hero_View', camera: { eye: [3000, -5000, 2600], target: [500, 0, 900], up: [0, 0, 1], fov: 40 } }
  ]
});
const advancedBuilt = await bridge.build_model({ runtime: 'mock', code: advancedCode });
const advancedSnapshot = advancedBuilt.snapshot;
assert.equal(advancedSnapshot.totals.groups, 3);
assert.equal(advancedSnapshot.groups.find((group) => group.name === 'Turned_Post').kind, 'lofted_solid');
assert.equal(advancedSnapshot.groups.find((group) => group.name === 'Simple_Rail').kind, 'swept_path');
assert.equal(advancedSnapshot.groups.find((group) => group.name === 'Translated_Box').bounding_box.min[0], 1000);
assert.equal(advancedSnapshot.groups.find((group) => group.name === 'Translated_Box').bounding_box.min[1], 2000);
assert.equal(advancedSnapshot.groups.find((group) => group.name === 'Translated_Box').bounding_box.min[2], 3000);
assert.equal(advancedSnapshot.scenes.length, 1);
assert.equal(advancedSnapshot.scenes[0].name, 'Hero_View');
assert.equal(advancedSnapshot.view_state.scene, 'Hero_View');
assert.equal(advancedSnapshot.view_state.camera.fov, 40);

const surfaceCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Surface_Test', color: '#aa8844' },
    { op: 'domed_surface', name: 'Cushion_Dome', origin: [0, 0, 0], width: 1200, depth: 800, thickness: 120, crown_height: 180, segments_x: 4, segments_y: 4, material: 'Surface_Test', smooth: 'all' },
    { op: 'bowed_panel', name: 'Curved_Back', origin: [0, 1200, 0], width: 1200, height: 900, thickness: 80, bow_depth: 160, segments_x: 4, segments_z: 4, material: 'Surface_Test', smooth: 'all' }
  ]
});
const surfaceBuilt = await bridge.build_model({ runtime: 'mock', code: surfaceCode });
const surfaceSnapshot = surfaceBuilt.snapshot;
assert.equal(surfaceSnapshot.totals.groups, 2);
assert.equal(surfaceSnapshot.groups.find((group) => group.name === 'Cushion_Dome').kind, 'domed_surface');
assert.equal(surfaceSnapshot.groups.find((group) => group.name === 'Curved_Back').kind, 'bowed_panel');
assert.equal(surfaceSnapshot.groups.find((group) => group.name === 'Cushion_Dome').bounding_box.w, 1200);
assert.equal(surfaceSnapshot.groups.find((group) => group.name === 'Cushion_Dome').bounding_box.d, 800);
assert.equal(surfaceSnapshot.groups.find((group) => group.name === 'Cushion_Dome').bounding_box.h, 300);
assert.equal(surfaceSnapshot.groups.find((group) => group.name === 'Curved_Back').bounding_box.w, 1200);
assert.equal(surfaceSnapshot.groups.find((group) => group.name === 'Curved_Back').bounding_box.d, 240);
assert.equal(surfaceSnapshot.groups.find((group) => group.name === 'Curved_Back').bounding_box.h, 900);
// Resolution hints for surface groups
const domeGroup = surfaceSnapshot.groups.find((group) => group.name === 'Cushion_Dome');
assert.ok(domeGroup.vertices > 0, 'domed surface should have vertices count');
assert.deepEqual(domeGroup.resolution_hint, { segments_x: 4, segments_y: 4 });
const bowedGroup = surfaceSnapshot.groups.find((group) => group.name === 'Curved_Back');
assert.ok(bowedGroup.vertices > 0, 'bowed panel should have vertices count');
assert.deepEqual(bowedGroup.resolution_hint, { segments_x: 4, segments_z: 4 });
assert.ok(surfaceSnapshot.totals.vertices > 0, 'totals should include vertices');

const buildingCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'level', name: 'Level_1', elevation: 0, height: 3000 },
    { op: 'material', name: 'Concrete', color: '#b8b2a8' },
    { op: 'material', name: 'Wall', color: '#eee5d6' },
    { op: 'material', name: 'Wood', color: '#8a5a35' },
    { op: 'floor_slab', name: 'Level_1_Slab', origin: [0, 0, 0], width: 3600, depth: 2400, thickness: 160, material: 'Concrete' },
    { op: 'wall', name: 'Front_Wall', start: [0, 0, 160], end: [3600, 0, 160], height: 2600, thickness: 120, openings: [
      { name: 'Door_Opening', x: 400, y: 0, width: 900, height: 2100 },
      { name: 'Window_Opening', x: 1900, y: 900, width: 900, height: 800 }
    ], material: 'Wall' },
    { op: 'wall', name: 'Side_Wall', start: [0, 0, 160], end: [0, 2400, 160], height: 2600, thickness: 120, material: 'Wall' },
    { op: 'door', name: 'Entry_Door', origin: [425, -45, 160], plane: 'xz', width: 850, height: 2050, thickness: 40, material: 'Wood' },
    { op: 'window', name: 'Front_Window', origin: [1925, -35, 1080], plane: 'xz', width: 850, height: 720, thickness: 24, material: 'Glass' },
    { op: 'stairs', name: 'Entry_Stairs', origin: [0, -900, 0], steps: 4, width: 1400, tread_depth: 300, riser_height: 160, direction: 'y', material: 'Concrete' },
    { op: 'railing', name: 'Front_Railing', path: [[0, -940, 640], [1800, -940, 640]], height: 900, rail_radius: 35, post_radius: 30, post_spacing: 600, material: 'Wood' }
  ]
});
const buildingBuilt = await bridge.build_model({ runtime: 'mock', code: buildingCode });
const buildingSnapshot = buildingBuilt.snapshot;
assert.equal(buildingSnapshot.levels.length, 1);
assert.equal(buildingSnapshot.levels[0].name, 'Level_1');
assert.equal(buildingSnapshot.totals.groups, 14);
assert.equal(buildingSnapshot.totals.faces, 170);
assert.equal(buildingSnapshot.totals.edges, 314);
assert.equal(buildingSnapshot.groups.find((group) => group.name === 'Level_1_Slab').kind, 'floor_slab');
assert.equal(buildingSnapshot.groups.find((group) => group.name === 'Front_Wall').kind, 'wall');
assert.equal(buildingSnapshot.groups.find((group) => group.name === 'Entry_Door').kind, 'door');
assert.equal(buildingSnapshot.groups.find((group) => group.name === 'Front_Window').kind, 'window');
assert.equal(buildingSnapshot.groups.filter((group) => group.kind === 'stair_step').length, 4);
assert.equal(buildingSnapshot.groups.filter((group) => group.kind === 'railing_post').length, 4);
assert.equal(buildingSnapshot.bounding_box.w, 3630);
assert.equal(buildingSnapshot.bounding_box.d, 3375);
assert.equal(buildingSnapshot.bounding_box.h, 2760);


const goldenArchitectureBuilt = await buildExample('examples/golden-architecture.json');
const goldenArchitectureSnapshot = goldenArchitectureBuilt.snapshot;
const goldenArchitectureGroupNames = new Set(goldenArchitectureSnapshot.groups.map((group) => group.name));
assert.ok(goldenArchitectureSnapshot.totals.groups > 0, 'golden architecture should create groups');
assert.ok(goldenArchitectureSnapshot.scenes.some((scene) => scene.name === 'Golden_Architecture_Hero'));
assert.ok(goldenArchitectureSnapshot.scenes.some((scene) => scene.name === 'Golden_Architecture_Section_Check'));
assert.ok(goldenArchitectureSnapshot.material_names.includes('Golden_Wall_Paint'));
assert.ok(goldenArchitectureSnapshot.material_names.includes('Golden_Roof'));
assertSnapshotQualityFields(goldenArchitectureSnapshot, 'golden architecture');
assert.ok(goldenArchitectureSnapshot.levels.some((level) => level.name === 'Golden_Level_1'));
assert.ok(goldenArchitectureSnapshot.levels.some((level) => level.name === 'Golden_Level_2'));
assert.ok(goldenArchitectureGroupNames.has('Golden_Front_Wall'));
assert.ok(goldenArchitectureGroupNames.has('Golden_Entry_Door'));
assert.ok(goldenArchitectureGroupNames.has('Golden_Living_Window'));
assert.ok(goldenArchitectureGroupNames.has('Golden_Main_Gable_Roof'));
assert.ok(goldenArchitectureSnapshot.groups.some((group) => group.kind === 'stair_step'));
assert.ok(goldenArchitectureSnapshot.groups.some((group) => group.kind === 'railing_post'));
assert.equal(goldenArchitectureSnapshot.style_state.name, 'Golden_Architecture_Presentation');
assert.equal(goldenArchitectureSnapshot.shadow_state.display, true);
assert.equal(goldenArchitectureSnapshot.rendering_options.transparency, true);

const goldenProductBuilt = await buildExample('examples/golden-product.json');
const goldenProductSnapshot = goldenProductBuilt.snapshot;
const goldenProductGroupNames = new Set(goldenProductSnapshot.groups.map((group) => group.name));
assert.ok(goldenProductSnapshot.totals.groups > 0, 'golden product should create groups');
assert.ok(goldenProductSnapshot.totals.instances >= 12, 'golden product should use component instances');
assert.ok(goldenProductSnapshot.scenes.some((scene) => scene.name === 'Golden_Product_Front'));
assert.ok(goldenProductSnapshot.scenes.some((scene) => scene.name === 'Golden_Product_Top_QA'));
assert.ok(goldenProductSnapshot.material_names.includes('Golden_Product_Body'));
assert.ok(goldenProductSnapshot.material_names.includes('Golden_Product_Rubber'));
assertSnapshotQualityFields(goldenProductSnapshot, 'golden product');
assert.ok(goldenProductSnapshot.component_definitions.includes('Golden_Round_Button_Def'));
assert.ok(goldenProductSnapshot.component_definitions.includes('Golden_Dpad_Key_Def'));
assert.ok(goldenProductSnapshot.component_definitions.includes('Golden_Screw_Def'));
assert.ok(goldenProductGroupNames.has('Golden_Controller_Shell_Mesh'));
assert.ok(goldenProductGroupNames.has('Golden_Left_Analog_Stick'));
assert.ok(goldenProductGroupNames.has('Golden_Front_Accent_Seam'));
const goldenProductDome = goldenProductSnapshot.groups.find((group) => group.name === 'Golden_Faceplate_Soft_Dome');
const goldenProductGrip = goldenProductSnapshot.groups.find((group) => group.name === 'Golden_Back_Grip_Bowed_Panel');
const goldenProductStick = goldenProductSnapshot.groups.find((group) => group.name === 'Golden_Left_Analog_Stick');
assert.ok(goldenProductDome.vertices > 0, 'golden product dome should report vertices');
assert.deepEqual(goldenProductDome.resolution_hint, { segments_x: 8, segments_y: 6 });
assert.ok(goldenProductGrip.vertices > 0, 'golden product grip should report vertices');
assert.deepEqual(goldenProductGrip.resolution_hint, { segments_x: 8, segments_z: 4 });
assert.deepEqual(goldenProductStick.resolution_hint, { segments: 18 });
assert.ok(goldenProductSnapshot.totals.vertices > 0, 'golden product should report aggregate vertices');

const featureEditingBuilt = await buildExample('examples/feature-editing-slice.json');
const featureEditingSnapshot = featureEditingBuilt.snapshot;
const featurePanel = featureEditingSnapshot.groups.find((group) => group.name === 'Feature_Test_Panel');
assert.equal(featureEditingSnapshot.totals.groups, 1);
assert.equal(featureEditingSnapshot.totals.faces, 141);
assert.equal(featureEditingSnapshot.totals.edges, 280);
assert.equal(featurePanel.kind, 'box');
assert.equal(featurePanel.bounding_box.h, 28);
assert.equal(featurePanel.features.length, 5);
assert.deepEqual(featurePanel.features.map((feature) => feature.op), ['cut_hole', 'cut_slot', 'cut_recess', 'add_boss', 'add_raised_rib']);
assert.equal(featurePanel.features[0].target_id, 'feature-test-panel');
assert.equal(featurePanel.features[0].through, true);
assert.equal(featurePanel.features[2].through, false);
assert.equal(featurePanel.features[3].height, 12);
assert.equal(featurePanel.attributes.Phase7.slice, 'feature-editing');
assertSnapshotQualityFields(featureEditingSnapshot, 'feature editing');

const booleanManifoldBuilt = await buildExample('examples/boolean-manifold-slice.json');
const booleanManifoldSnapshot = booleanManifoldBuilt.snapshot;
const booleanFinal = booleanManifoldSnapshot.groups.find((group) => group.name === 'Boolean_Final_Intersection');
assert.equal(booleanManifoldSnapshot.totals.groups, 1);
assert.equal(booleanManifoldSnapshot.totals.instances, 0);
assert.equal(booleanManifoldSnapshot.warning_summary.by_severity.error, 0);
assert.equal(booleanManifoldSnapshot.warning_summary.by_severity.warn, 0);
assert.equal(booleanFinal.kind, 'solid_boolean');
assert.equal(booleanFinal.boolean_operations.length, 3);
assert.deepEqual(booleanFinal.boolean_operations.map((operation) => operation.op), ['boolean_difference', 'boolean_union', 'boolean_intersect']);
assert.equal(booleanFinal.manifold.is_manifold, true);
assert.equal(booleanFinal.manifold.repaired, true);
assert.equal(booleanManifoldSnapshot.manifold_checks.length, 2);
assert.equal(booleanManifoldSnapshot.manifold_checks.every((check) => check.ok), true);
assert.equal(booleanFinal.attributes.Phase7.slice, 'boolean-manifold');
assertSnapshotQualityFields(booleanManifoldSnapshot, 'boolean manifold');

const componentTransformCode = await fs.readFile(path.resolve('examples/component-transform-composition.json'), 'utf8');
const componentTransformBuilt = await bridge.build_model({ runtime: 'mock', code: componentTransformCode });
const componentTransformSnapshot = componentTransformBuilt.snapshot;
const componentA = componentTransformSnapshot.instances.find((instance) => instance.name === 'Component_Transform_A');
const componentB = componentTransformSnapshot.instances.find((instance) => instance.name === 'Component_Transform_B');
const componentC = componentTransformSnapshot.instances.find((instance) => instance.name === 'Component_Transform_C');
assert.equal(componentTransformSnapshot.totals.instances, 3);
assert.ok(componentTransformSnapshot.component_definitions.includes('Transform_Widget_Def'));
assert.equal(componentA.definition, 'Transform_Widget_Def');
assert.equal(componentA.faces, 12);
assert.ok(componentA.bounding_box.w > 65);
assert.ok(componentA.bounding_box.h > 30);
assert.deepEqual(componentA.transform.object_transform.matrix, [1, 0, 0, 0, 0.25, 1, 0, 0, 0, 0, 1, 0, 0, 12, 6, 1]);
assert.deepEqual(componentA.transform.object_transform.matrix_decomposition.translate, [0, 12, 6]);
assert.ok(componentA.transform.object_transform.matrix_decomposition.shear.xy > 0.24);
assert.equal(componentB.definition, 'Transform_Widget_Def');
assert.ok(componentB.bounding_box.h > 45);
assert.deepEqual(componentB.transform.object_transform.axis, [0, 1 / Math.sqrt(2), 1 / Math.sqrt(2)]);
assert.equal(componentB.transform.object_transform.angle, 28);
assert.equal(componentC.definition, 'Transform_Widget_Def');
assert.ok(componentC.bounding_box.h > 30);
assert.deepEqual(componentC.transform.object_transform.local_axis, [1, 0, 0]);
assert.equal(componentC.transform.object_transform.local_angle, 32);
assert.ok(Math.abs(componentC.transform.object_transform.local_model_axis[0] - Math.cos(25 * Math.PI / 180)) < 1e-12);
assert.ok(Math.abs(componentC.transform.object_transform.local_model_axis[1] - Math.sin(25 * Math.PI / 180)) < 1e-12);

const transformChainCode = await fs.readFile(path.resolve('examples/transform-chain-regression.json'), 'utf8');
const transformChainBuilt = await bridge.build_model({ runtime: 'mock', code: transformChainCode });
const transformChainSnapshot = transformChainBuilt.snapshot;
const chainGroup = transformChainSnapshot.groups.find((group) => group.name === 'Transform_Chain_Group_A');
const chainInstance = transformChainSnapshot.instances.find((instance) => instance.name === 'Transform_Chain_Instance_A');
assert.equal(transformChainSnapshot.totals.groups, 1);
assert.equal(transformChainSnapshot.totals.instances, 1);
assert.ok(transformChainSnapshot.component_definitions.includes('Transform_Chain_Def'));
assert.ok(transformChainSnapshot.scenes.some((scene) => scene.name === 'Transform_Chain_QA'));
assert.equal(chainGroup.id, 'chain-group-a');
assert.equal(chainGroup.kind, 'box');
assert.ok(chainGroup.bounding_box.w > 49 && chainGroup.bounding_box.w < 51);
assert.ok(chainGroup.bounding_box.d > 40 && chainGroup.bounding_box.d < 42);
assert.ok(chainGroup.bounding_box.h > 22 && chainGroup.bounding_box.h < 23);
assert.deepEqual(chainGroup.transform.object_transform.matrix, [1, 0, 0, 0, 0.15, 1, 0, 0, 0, 0, 1, 0, 8, -6, 4, 1]);
assert.equal(chainInstance.id, 'chain-instance-a');
assert.equal(chainInstance.definition, 'Transform_Chain_Def');
assert.equal(chainInstance.transform.rotateZ, 20);
assert.deepEqual(chainInstance.transform.object_transform.axis, [0, 0, 1]);
assert.equal(chainInstance.transform.object_transform.angle, 15);
assert.deepEqual(chainInstance.transform.object_transform.translate, [18, 10, 6]);
assert.ok(chainInstance.bounding_box.h > 35 && chainInstance.bounding_box.h < 36);

const transformLocalMatrixCode = await fs.readFile(path.resolve('examples/transform-local-matrix.json'), 'utf8');
const transformLocalMatrixBuilt = await bridge.build_model({ runtime: 'mock', code: transformLocalMatrixCode });
const transformLocalMatrixSnapshot = transformLocalMatrixBuilt.snapshot;
const localMatrixGroup = transformLocalMatrixSnapshot.groups.find((group) => group.name === 'Local_Matrix_Group');
const localMatrixInstance = transformLocalMatrixSnapshot.instances.find((instance) => instance.name === 'Local_Matrix_Instance');
assert.equal(transformLocalMatrixSnapshot.totals.groups, 1);
assert.equal(transformLocalMatrixSnapshot.totals.instances, 1);
assert.ok(transformLocalMatrixSnapshot.component_definitions.includes('Local_Matrix_Widget_Def'));
assert.ok(transformLocalMatrixSnapshot.scenes.some((scene) => scene.name === 'Local_Matrix_QA'));
assert.equal(localMatrixGroup.id, 'local-matrix-group');
assert.equal(localMatrixGroup.kind, 'box');
assert.deepEqual(localMatrixGroup.transform.object_transform.local_matrix, [1, 0, 0, 0, 0.2, 1, 0, 0, 0, 0, 1, 0, 0, 30, 6, 1]);
assert.deepEqual(localMatrixGroup.transform.object_transform.local_matrix_decomposition.translate, [0, 30, 6]);
assert.equal(localMatrixGroup.transform.object_transform.local_matrix_decomposition.determinant, 1);
assert.equal(localMatrixGroup.transform.object_transform.local_matrix_decomposition.mirrored, false);
assert.equal(localMatrixGroup.bounding_box.h, 10);
assert.equal(localMatrixGroup.bounding_box.min[2], 6);
assert.ok(localMatrixGroup.bounding_box.d > 44 && localMatrixGroup.bounding_box.d < 45);
assert.equal(localMatrixInstance.id, 'local-matrix-instance');
assert.equal(localMatrixInstance.definition, 'Local_Matrix_Widget_Def');
assert.deepEqual(localMatrixInstance.transform.object_transform.local_matrix, [1, 0.25, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 20, 0, 4, 1]);
assert.deepEqual(localMatrixInstance.transform.object_transform.local_matrix_decomposition.translate, [20, 0, 4]);
assert.ok(localMatrixInstance.transform.object_transform.local_matrix_decomposition.shear.xy > 0.24);
assert.equal(localMatrixInstance.bounding_box.h, 18);
assert.equal(localMatrixInstance.bounding_box.min[2], 4);
assert.ok(localMatrixInstance.bounding_box.d > 44 && localMatrixInstance.bounding_box.d < 45);

const profileEdgeCasesCode = await fs.readFile(path.resolve('examples/profile-edge-cases.json'), 'utf8');
const profileEdgeCasesBuilt = await bridge.build_model({ runtime: 'mock', code: profileEdgeCasesCode });
const profileEdgeCasesSnapshot = profileEdgeCasesBuilt.snapshot;
const concaveProfile = profileEdgeCasesSnapshot.groups.find((group) => group.name === 'Concave_Profile_Two_Holes');
const verticalFace = profileEdgeCasesSnapshot.groups.find((group) => group.name === 'Vertical_Concave_Face_Two_Holes');
assert.equal(profileEdgeCasesSnapshot.totals.groups, 2);
assert.equal(profileEdgeCasesSnapshot.totals.instances, 2);
assert.ok(profileEdgeCasesSnapshot.component_definitions.includes('Profile_Insert_Def'));
assert.equal(concaveProfile.kind, 'profile_extrude');
assert.equal(concaveProfile.faces, 18);
assert.equal(concaveProfile.edges, 48);
assert.deepEqual(concaveProfile.bounding_box.min, [0, 0, 0]);
assert.equal(concaveProfile.bounding_box.w, 180);
assert.equal(concaveProfile.bounding_box.d, 120);
assert.equal(concaveProfile.bounding_box.h, 14);
assert.equal(verticalFace.kind, 'face_with_holes');
assert.equal(verticalFace.faces, 1);
assert.equal(verticalFace.edges, 16);
assert.deepEqual(verticalFace.bounding_box.min, [230, 0, 0]);
assert.equal(verticalFace.bounding_box.w, 140);
assert.equal(verticalFace.bounding_box.d, 0);
assert.equal(verticalFace.bounding_box.h, 90);

await assert.rejects(
  () => bridge.build_model({ runtime: 'mock', code: JSON.stringify({
    version: 1,
    units: 'mm',
    operations: [
      { op: 'reset' },
      {
        op: 'profile_extrude',
        name: 'Overlapping_Profile_Holes',
        origin: [0, 0, 0],
        plane: 'xy',
        outer: [[0, 0], [120, 0], [120, 80], [0, 80]],
        holes: [
          { points: [[20, 20], [60, 20], [60, 50], [20, 50]] },
          { points: [[45, 30], [85, 30], [85, 60], [45, 60]] }
        ],
        depth: 10
      }
    ]
  }) }),
  /Overlapping_Profile_Holes\.holes\[0\] must not overlap Overlapping_Profile_Holes\.holes\[1\]/
);

await assert.rejects(
  () => bridge.build_model({ runtime: 'mock', code: JSON.stringify({
    version: 1,
    units: 'mm',
    operations: [
      { op: 'reset' },
      {
        op: 'face_with_holes',
        name: 'Outside_Profile_Hole',
        origin: [0, 0, 0],
        plane: 'xy',
        outer: [[0, 0], [100, 0], [100, 80], [0, 80]],
        holes: [{ points: [[70, 50], [120, 50], [120, 70], [70, 70]] }]
      }
    ]
  }) }),
  /Outside_Profile_Hole\.holes\[0\] must fit inside outer profile without touching boundary/
);

const appearanceTextureCode = await fs.readFile(path.resolve('examples/appearance-texture-slice.json'), 'utf8');
const appearanceTextureBuilt = await bridge.build_model({ runtime: 'mock', code: appearanceTextureCode });
const appearanceTextureSnapshot = appearanceTextureBuilt.snapshot;
const texturedPanel = appearanceTextureSnapshot.groups.find((group) => group.name === 'Appearance_Textured_Panel');
const referencePlane = appearanceTextureSnapshot.groups.find((group) => group.name === 'Appearance_Reference_Plane');
const labelInstance = appearanceTextureSnapshot.instances.find((instance) => instance.name === 'Appearance_Label_Instance');
assert.equal(appearanceTextureSnapshot.totals.groups, 2);
assert.equal(appearanceTextureSnapshot.totals.instances, 1);
assert.ok(appearanceTextureSnapshot.component_definitions.includes('Appearance_Label_Def'));
assert.equal(texturedPanel.kind, 'box');
assert.deepEqual(texturedPanel.texture_transform, { projection: 'box', offset: [12, 8], scale: [1.5, 0.75], rotation: 30, material: 'Appearance_Base' });
assert.deepEqual(texturedPanel.attributes.TextureTransform, { projection: 'box', offset_u: 12, offset_v: 8, scale_u: 1.5, scale_v: 0.75, rotation: 30, material: 'Appearance_Base' });
assert.equal(referencePlane.kind, 'image_plane');
assert.equal(referencePlane.faces, 1);
assert.equal(referencePlane.edges, 4);
assert.deepEqual(referencePlane.bounding_box.min, [220, 0, 0]);
assert.equal(referencePlane.bounding_box.w, 160);
assert.equal(referencePlane.bounding_box.d, 0);
assert.equal(referencePlane.bounding_box.h, 90);
assert.deepEqual(referencePlane.texture_transform, { projection: 'planar', offset: [4, 6], scale: [1, 1], rotation: 0, material: 'Reference_Tint' });
assert.equal(labelInstance.definition, 'Appearance_Label_Def');
assert.equal(labelInstance.faces, 1);
assert.equal(labelInstance.edges, 4);

const largeOperationCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Large_Op_Test', color: '#cccccc' },
    ...Array.from({ length: 201 }, (_, index) => ({
      op: 'box',
      name: `Large_Op_Box_${index + 1}`,
      origin: [index * 20, 0, 0],
      size: [10, 10, 10],
      material: 'Large_Op_Test'
    }))
  ]
});
const largeOperationBuilt = await bridge.build_model({ runtime: 'mock', code: largeOperationCode });
assert.equal(largeOperationBuilt.snapshot.totals.groups, 201);

const identicalSnapshotDiff = compareSnapshots(snapshot, JSON.parse(JSON.stringify(snapshot)));
assert.equal(identicalSnapshotDiff.ok, true);
assert.equal(identicalSnapshotDiff.level, 'ok');
assert.equal(identicalSnapshotDiff.verdict, 'pass');
assert.equal(identicalSnapshotDiff.summary.total, 0);
assert.deepEqual(identicalSnapshotDiff.top_issues, []);
assert.deepEqual(identicalSnapshotDiff.recommendations, []);

const driftedSnapshot = JSON.parse(JSON.stringify(snapshot));
const removedGroupName = snapshot.groups[0].name;
driftedSnapshot.totals.groups += 1;
driftedSnapshot.groups = driftedSnapshot.groups.filter((group) => group.name !== removedGroupName);
driftedSnapshot.groups[0].bounding_box.w += 25;
driftedSnapshot.material_names.push('Unexpected_Material');
driftedSnapshot.artifact_size_bytes = 2048;
snapshot.artifact_size_bytes = 1024;
driftedSnapshot.runtime.compatibility = { ok: false, level: 'error', issues: [{ type: 'runtime.operation_missing', severity: 'error', operation: 'box' }] };
const driftedSnapshotDiff = compareSnapshots(snapshot, driftedSnapshot, { toleranceMm: 1, budgets: { max_faces: 50, max_artifact_size_bytes: 1000 }, topIssueLimit: 3 });
assert.equal(driftedSnapshotDiff.ok, false);
assert.equal(driftedSnapshotDiff.level, 'error');
assert.equal(driftedSnapshotDiff.verdict, 'fail');
assert.equal(driftedSnapshotDiff.top_issues.length, 3);
assert.equal(driftedSnapshotDiff.budgets.max_faces, 50);
assert.ok(driftedSnapshotDiff.summary.by_severity.error >= 2);
assert.ok(driftedSnapshotDiff.diffs.some((diff) => diff.type === 'runtime.compatibility_failed'));
assert.ok(driftedSnapshotDiff.diffs.some((diff) => diff.type === 'groups.missing' && diff.name === removedGroupName));
assert.ok(driftedSnapshotDiff.diffs.some((diff) => diff.type === 'materials.extra' && diff.name === 'Unexpected_Material'));
assert.ok(driftedSnapshotDiff.diffs.some((diff) => diff.type === 'artifact.size_mismatch'));
assert.ok(driftedSnapshotDiff.diffs.some((diff) => diff.type === 'budget.exceeded' && diff.name === 'faces'));
assert.ok(driftedSnapshotDiff.diffs.some((diff) => diff.path.endsWith('.bounding_box.w')));
assert.ok(driftedSnapshotDiff.recommendations.some((recommendation) => recommendation.includes('get_capabilities')));
assert.ok(driftedSnapshotDiff.recommendations.some((recommendation) => recommendation.includes('budget')));
const topologyToleratedSnapshot = JSON.parse(JSON.stringify(snapshot));
topologyToleratedSnapshot.totals.faces += 1;
topologyToleratedSnapshot.totals.edges += 3;
topologyToleratedSnapshot.groups[0].faces += 1;
topologyToleratedSnapshot.groups[0].edges += 3;
const topologyToleratedDiff = compareSnapshots(snapshot, topologyToleratedSnapshot, { topologyTolerance: { faces: 1, edges: 3 } });
assert.equal(topologyToleratedDiff.ok, true);
assert.equal(topologyToleratedDiff.summary.total, 0);
assert.equal(topologyToleratedDiff.topology_tolerance.faces, 1);
const markdownReport = formatSnapshotReportMarkdown({ report: driftedSnapshotDiff, expected_runtime: 'mock', actual_runtime: 'queue', reset_first: true }, { title: 'Test QA Report' });
assert.ok(markdownReport.includes('# Test QA Report'));
assert.ok(markdownReport.includes('Verdict: **fail**'));
assert.ok(markdownReport.includes('## Top Issues'));
assert.ok(markdownReport.includes('budget.exceeded'));
assert.ok(markdownReport.includes('Expected runtime: `mock`'));
const topologyMarkdown = formatSnapshotReportMarkdown(topologyToleratedDiff, { title: 'Topology Tolerance Report' });
assert.ok(topologyMarkdown.includes('## Topology Tolerance'));
assert.ok(topologyMarkdown.includes('`faces`'));

const saved = await bridge.save_model({ runtime: 'mock', path: 'output/mock-validation-model.json' });
assert.ok(saved.file_path.endsWith('output/mock-validation-model.json'));
assert.ok(saved.file_size_bytes > 0, 'file_size_bytes should be reported');
assert.ok(saved.snapshot.artifact_size_bytes > 0, 'artifact_size_bytes should be injected into snapshot');
assert.equal(saved.snapshot.runtime.name, 'mock', 'saved snapshot should include runtime descriptor');
await fs.access(saved.file_path);

console.log(JSON.stringify({ ok: true, totals: snapshot.totals, saved: saved.file_path }, null, 2));
