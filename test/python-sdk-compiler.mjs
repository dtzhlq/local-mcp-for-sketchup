import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePythonSdkScript } from '../src/python-sdk-compiler.mjs';
import { SketchUpBridge } from '../src/bridge.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await fs.readFile(path.join(repoRoot, 'examples/python-sdk-facade-fixture.py'), 'utf8');
const faceSource = await fs.readFile(path.join(repoRoot, 'examples/python-sdk-face-edge-loop-fixture.py'), 'utf8');
const componentSource = await fs.readFile(path.join(repoRoot, 'examples/python-sdk-component-facade-fixture.py'), 'utf8');
const viewSource = await fs.readFile(path.join(repoRoot, 'examples/python-sdk-view-facade-fixture.py'), 'utf8');
const appearanceSource = await fs.readFile(path.join(repoRoot, 'examples/python-sdk-appearance-facade-fixture.py'), 'utf8');
const curveSource = await fs.readFile(path.join(repoRoot, 'examples/python-sdk-curve-facade-fixture.py'), 'utf8');
const helperSource = await fs.readFile(path.join(repoRoot, 'examples/python-sdk-helper-functions-fixture.py'), 'utf8');
const comprehensionSource = await fs.readFile(path.join(repoRoot, 'examples/python-sdk-comprehension-fixture.py'), 'utf8');
const officialApiSource = await fs.readFile(path.join(repoRoot, 'examples/python-sdk-official-api-coverage-fixture.py'), 'utf8');
const officialApiR3Source = await fs.readFile(path.join(repoRoot, 'examples/python-sdk-official-api-expression-r3-fixture.py'), 'utf8');
const pythonTimeoutMs = 20000;

const compiled = compilePythonSdkScript(source, { timeoutMs: pythonTimeoutMs });
assert.equal(compiled.document.version, 1);
assert.equal(compiled.document.units, 'mm');
assert.equal(compiled.python_sdk.compiler_version, 'python-sdk-facade-compiler-0.1.0');
assert.equal(compiled.python_sdk.source_units, 'inches');
assert.equal(compiled.python_sdk.operations, 7);
assert.equal(compiled.python_sdk.safety.executed_python, false);
assert.ok(compiled.python_sdk.facade_objects.includes('GeometryInput'));
assert.ok(compiled.python_sdk.facade_objects.includes('SUPoint3D'));
assert.equal(compiled.result.operation_count, 7);

const noResultCompiled = compilePythonSdkScript('model.reset()\n', { timeoutMs: pythonTimeoutMs });
assert.equal(noResultCompiled.document.operations.length, 1, 'Python SDK facade code should compile without defining result');
assert.equal(Object.hasOwn(noResultCompiled, 'result'), false, 'missing optional result should be omitted from compiler output');

const nullResultCompiled = compilePythonSdkScript('result = None\n', { timeoutMs: pythonTimeoutMs });
assert.equal(Object.hasOwn(nullResultCompiled, 'result'), true, 'an explicitly assigned result should be preserved');
assert.equal(nullResultCompiled.result, null, 'Python None should remain a JSON-compatible null result');

const material = compiled.document.operations.find((operation) => operation.op === 'material' && operation.name === 'SDK_Wall');
assert.equal(material.color, '#e6e2d8');

const geometry = compiled.document.operations.find((operation) => operation.op === 'geometry_input');
assert.equal(geometry.id, 'sdk-panel');
assert.equal(geometry.vertices.length, 8);
assert.deepEqual(geometry.vertices[1], [101.6, 0, 0]);
assert.deepEqual(geometry.faces[0].outer, [0, 1, 2, 3]);
assert.deepEqual(geometry.faces[0].holes[0], [4, 5, 6, 7]);
assert.equal(geometry.material, 'SDK_Wall');

const curve = compiled.document.operations.find((operation) => operation.op === 'curve');
assert.deepEqual(curve.points[2], [101.6, 0, 12.7]);

const arc = compiled.document.operations.find((operation) => operation.op === 'arc_curve');
assert.equal(arc.radius, 38.1);
assert.equal(arc.segments, 6);

const box = compiled.document.operations.find((operation) => operation.op === 'box');
assert.deepEqual(box.origin, [127, 0, 0]);
assert.deepEqual(box.size, [25.4, 50.8, 12.7]);
assert.deepEqual(box.transform.translate, [0, 0, 12.7]);

const bridge = new SketchUpBridge();
const noResultEvaluated = await bridge.evaluate_py({ code: 'model.reset()\n', input_format: 'python_sdk', runtime: 'mock', pythonTimeoutMs });
assert.equal(noResultEvaluated.executed, true, 'evaluate_py should execute restricted Python facade code without result');
assert.equal(Object.hasOwn(noResultEvaluated.compiled, 'result'), false, 'evaluate_py should omit an undefined optional result');
const evaluated = await bridge.evaluate_py({ code: source, input_format: 'python_sdk', runtime: 'mock', pythonTimeoutMs });
assert.equal(evaluated.kind, 'evaluate_py');
assert.equal(evaluated.compatibility_mode, 'python_sdk_facade_compiler');
assert.equal(evaluated.executed, true);
assert.equal(evaluated.blocked, false);
assert.equal(evaluated.compiled.python_sdk.operations, 7);
assert.equal(evaluated.snapshot.totals.groups, 4);
assert.equal(evaluated.snapshot.warning_summary.total, 0);
assert.ok(evaluated.snapshot.groups.some((group) => group.id === 'sdk-panel'));

const autoEvaluated = await bridge.evaluate_py({ code: source, input_format: 'auto', runtime: 'mock', pythonTimeoutMs });
assert.equal(autoEvaluated.compatibility_mode, 'python_sdk_facade_compiler');
assert.equal(autoEvaluated.snapshot.totals.groups, 4);

const faceCompiled = compilePythonSdkScript(faceSource, { timeoutMs: pythonTimeoutMs });
assert.equal(faceCompiled.python_sdk.operations, 4);
assert.equal(faceCompiled.python_sdk.source_units, 'inches');
assert.ok(faceCompiled.python_sdk.facade_objects.includes('Face'));
assert.ok(faceCompiled.python_sdk.facade_objects.includes('Edge'));
assert.ok(faceCompiled.python_sdk.facade_objects.includes('Loop'));
assert.deepEqual(faceCompiled.result, {
  face_area_source_units: 20,
  edge_count: 4,
  loop_count: 2,
  outer_loop_is_outer: true,
  outer_loop_vertices: 4,
  first_edge_length: 6,
  normal_after_reverse: [0, 0, -1],
  plane_after_reverse: [0, 0, -1, 0]
});

const faceGeometry = faceCompiled.document.operations.find((operation) => operation.op === 'geometry_input');
assert.equal(faceGeometry.id, 'sdk-face-panel');
assert.equal(faceGeometry.name, 'SDK_Face_Loop_Edge_Panel');
assert.equal(faceGeometry.vertices.length, 8);
assert.equal(faceGeometry.faces.length, 1);
assert.deepEqual(faceGeometry.faces[0].outer, [0, 1, 2, 3]);
assert.deepEqual(faceGeometry.faces[0].holes, [[4, 5, 6, 7]]);
assert.equal(faceGeometry.faces[0].id, 'front-face');
assert.equal(faceGeometry.faces[0].material, 'SDK_Face_Front');
assert.equal(faceGeometry.faces[0].back_material, 'SDK_Face_Back');
assert.equal(faceGeometry.faces[0].reversed, true);
assert.deepEqual(faceGeometry.faces[0].normal, [0, 0, -1]);
assert.deepEqual(faceGeometry.faces[0].plane, [0, 0, -1, 0]);
assert.equal(faceGeometry.faces[0].area, 12903.2);
assert.deepEqual(faceGeometry.faces[0].pushpull, { distance: 6.35, copy: true, metadata_only: false });
assert.deepEqual(faceGeometry.faces[0].metadata, { role: 'panel_face', source: 'sdk_facade' });

const faceEvaluated = await bridge.evaluate_py({ code: faceSource, input_format: 'python_sdk', runtime: 'mock', pythonTimeoutMs });
assert.equal(faceEvaluated.compatibility_mode, 'python_sdk_facade_compiler');
assert.equal(faceEvaluated.snapshot.totals.groups, 1);
assert.equal(faceEvaluated.snapshot.totals.faces, 10);
assert.equal(faceEvaluated.snapshot.warning_summary.total, 0);
const faceGroup = faceEvaluated.snapshot.groups.find((group) => group.id === 'sdk-face-panel');
assert.ok(faceGroup);
assert.equal(faceGroup.geometry_input.face_count, 1);
assert.equal(faceGroup.geometry_input.edge_count, 8);
assert.equal(faceGroup.geometry_input.loop_count, 2);
assert.equal(faceGroup.geometry_input.faces[0].back_material, 'SDK_Face_Back');
assert.equal(faceGroup.geometry_input.faces[0].pushpull.metadata_only, false);
assert.equal(faceGroup.geometry_input.pushpull_realized.length, 1);
assert.equal(faceGroup.bounding_box.h, 6.35);

const componentCompiled = compilePythonSdkScript(componentSource, { timeoutMs: pythonTimeoutMs });
assert.equal(componentCompiled.python_sdk.operations, 5);
assert.ok(componentCompiled.python_sdk.facade_objects.includes('ComponentDefinition'));
assert.ok(componentCompiled.python_sdk.facade_objects.includes('ComponentInstance'));
assert.deepEqual(componentCompiled.result, {
  definition_name: 'SDK_Component_Definition',
  definition_operations: 1,
  first_definition: 'SDK_Component_Definition',
  second_definition: 'SDK_Component_Definition',
  second_origin_source_units: [4, 0, 0]
});
const componentDefinition = componentCompiled.document.operations.find((operation) => operation.op === 'component_definition');
assert.equal(componentDefinition.name, 'SDK_Component_Definition');
assert.equal(componentDefinition.operations.length, 1);
assert.equal(componentDefinition.operations[0].op, 'geometry_input');
assert.equal(componentDefinition.operations[0].faces[0].id, 'component-panel-face');
assert.deepEqual(componentDefinition.operations[0].vertices[2], [50.8, 25.4, 0]);
const componentInstances = componentCompiled.document.operations.filter((operation) => operation.op === 'component_instance');
assert.equal(componentInstances.length, 2);
assert.deepEqual(componentInstances[1].origin, [101.6, 0, 0]);
assert.deepEqual(componentInstances[1].transform, { rotateZ: 90 });

const componentEvaluated = await bridge.evaluate_py({ code: componentSource, input_format: 'python_sdk', runtime: 'mock', pythonTimeoutMs });
assert.equal(componentEvaluated.snapshot.totals.instances, 2);
assert.ok(componentEvaluated.snapshot.component_definitions.includes('SDK_Component_Definition'));
assert.equal(componentEvaluated.snapshot.warning_summary.total, 0);

const viewCompiled = compilePythonSdkScript(viewSource, { timeoutMs: pythonTimeoutMs });
assert.equal(viewCompiled.python_sdk.operations, 6);
for (const objectName of ['Camera', 'Scene', 'Style', 'ShadowInfo', 'RenderingOptions']) {
  assert.ok(viewCompiled.python_sdk.facade_objects.includes(objectName));
}
assert.deepEqual(viewCompiled.result, {
  scene_name: 'SDK_View_Scene',
  camera_target_source_units: [1, 1, 1],
  style_name: 'SDK_View_Style',
  shadow_light: 80,
  rendering_edge_display_mode: 1
});
const viewCamera = viewCompiled.document.operations.find((operation) => operation.op === 'camera');
assert.deepEqual(viewCamera.eye, [203.2, -254, 152.4]);
assert.deepEqual(viewCamera.target, [25.4, 25.4, 25.4]);
const viewScene = viewCompiled.document.operations.find((operation) => operation.op === 'scene');
assert.equal(viewScene.name, 'SDK_View_Scene');
assert.deepEqual(viewScene.camera.target, [25.4, 25.4, 25.4]);
const viewStyle = viewCompiled.document.operations.find((operation) => operation.op === 'style');
assert.equal(viewStyle.name, 'SDK_View_Style');
assert.equal(viewStyle.face_style, 'shaded_with_textures');
assert.equal(viewStyle.background_color, '#f7f4ed');
const viewShadow = viewCompiled.document.operations.find((operation) => operation.op === 'shadow');
assert.equal(viewShadow.time, '2026-06-25T10:00:00+08:00');
assert.equal(viewShadow.use_sun_for_shading, true);
const viewRendering = viewCompiled.document.operations.find((operation) => operation.op === 'rendering_options');
assert.equal(viewRendering.edge_display_mode, 1);
assert.equal(viewRendering.transparency, true);

const viewEvaluated = await bridge.evaluate_py({ code: viewSource, input_format: 'python_sdk', runtime: 'mock', pythonTimeoutMs });
assert.equal(viewEvaluated.snapshot.scenes[0].name, 'SDK_View_Scene');
assert.equal(viewEvaluated.snapshot.view_state.scene, 'SDK_View_Scene');
assert.equal(viewEvaluated.snapshot.style_state.name, 'SDK_View_Style');
assert.equal(viewEvaluated.snapshot.shadow_state.light, 80);
assert.equal(viewEvaluated.snapshot.rendering_options.edge_display_mode, 1);
assert.equal(viewEvaluated.snapshot.warning_summary.total, 0);

const appearanceCompiled = compilePythonSdkScript(appearanceSource, { timeoutMs: pythonTimeoutMs });
assert.equal(appearanceCompiled.python_sdk.operations, 7);
for (const objectName of ['Layer', 'Texture', 'Image', 'ImageRep']) {
  assert.ok(appearanceCompiled.python_sdk.facade_objects.includes(objectName));
}
assert.deepEqual(appearanceCompiled.result, {
  layer_name: 'SDK_Appearance_Layer',
  texture_path: 'textures/sdk-facade-albedo.jpg',
  reference_image: 'SDK_Reference_Image',
  image_rep_role: 'texture'
});
const appearanceTag = appearanceCompiled.document.operations.find((operation) => operation.op === 'tag');
assert.equal(appearanceTag.name, 'SDK_Appearance_Layer');
assert.equal(appearanceTag.color, '#336699');
const texturedMaterial = appearanceCompiled.document.operations.find((operation) => operation.op === 'material' && operation.name === 'SDK_Textured_Material');
assert.deepEqual(texturedMaterial.texture, { path: 'textures/sdk-facade-albedo.jpg', width: 128, height: 64 });
const imageReferences = appearanceCompiled.document.operations.filter((operation) => operation.op === 'image_reference');
assert.equal(imageReferences.length, 2);
assert.equal(imageReferences[1].role, 'texture');
const assignedLayer = appearanceCompiled.document.operations.find((operation) => operation.op === 'assign_tag');
assert.deepEqual(assignedLayer, { op: 'assign_tag', tag: 'SDK_Appearance_Layer', target_id: 'sdk-textured-box' });

const appearanceEvaluated = await bridge.evaluate_py({ code: appearanceSource, input_format: 'python_sdk', runtime: 'mock', pythonTimeoutMs });
assert.deepEqual(appearanceEvaluated.snapshot.tags, [{ name: 'SDK_Appearance_Layer', color: '#336699', visible: true }]);
assert.equal(appearanceEvaluated.snapshot.materials.find((item) => item.name === 'SDK_Textured_Material').texture.path, 'textures/sdk-facade-albedo.jpg');
assert.equal(appearanceEvaluated.snapshot.image_references.length, 2);
assert.equal(appearanceEvaluated.snapshot.groups.find((group) => group.id === 'sdk-textured-box').tag, 'SDK_Appearance_Layer');
assert.equal(appearanceEvaluated.snapshot.warning_summary.total, 0);

const curveCompiled = compilePythonSdkScript(curveSource, { timeoutMs: pythonTimeoutMs });
assert.equal(curveCompiled.python_sdk.operations, 3);
assert.ok(curveCompiled.python_sdk.facade_objects.includes('Curve'));
assert.ok(curveCompiled.python_sdk.facade_objects.includes('ArcCurve'));
assert.deepEqual(curveCompiled.result, { curve_points: 3, arc_segments: 8 });
const curveOperation = curveCompiled.document.operations.find((operation) => operation.op === 'curve');
assert.deepEqual(curveOperation.points[1], [25.4, 12.7, 0]);
const arcOperation = curveCompiled.document.operations.find((operation) => operation.op === 'arc_curve');
assert.equal(arcOperation.radius, 38.1);
assert.equal(arcOperation.segments, 8);
const curveEvaluated = await bridge.evaluate_py({ code: curveSource, input_format: 'python_sdk', runtime: 'mock', pythonTimeoutMs });
assert.equal(curveEvaluated.snapshot.totals.groups, 2);
assert.equal(curveEvaluated.snapshot.warning_summary.total, 0);

const helperCompiled = compilePythonSdkScript(helperSource, { timeoutMs: pythonTimeoutMs });
assert.equal(helperCompiled.python_sdk.operations, 6);
assert.ok(helperCompiled.python_sdk.facade_objects.includes('Face'));
assert.ok(helperCompiled.python_sdk.facade_objects.includes('GeometryInput'));
assert.ok(helperCompiled.python_sdk.facade_objects.includes('SUPoint3D'));
assert.deepEqual(helperCompiled.result, {
  panel_count: 3,
  operation_count: 6,
  first_edge_length: 2,
  first_outer_loop: true,
  last_face_area: 3
});
const helperGeometry = helperCompiled.document.operations.filter((operation) => operation.op === 'geometry_input');
assert.equal(helperGeometry.length, 3);
assert.equal(helperGeometry[0].id, 'SDK_Helper_Panel_0-id');
assert.deepEqual(helperGeometry[1].vertices[0], [76.2, 0, 0]);
assert.equal(helperGeometry[2].faces[0].material, 'SDK_Helper_Accent');
assert.deepEqual(helperGeometry[2].faces[0].metadata, { source: 'helper_function', index: 6 });

const helperEvaluated = await bridge.evaluate_py({ code: helperSource, input_format: 'python_sdk', runtime: 'mock', pythonTimeoutMs });
assert.equal(helperEvaluated.compatibility_mode, 'python_sdk_facade_compiler');
assert.equal(helperEvaluated.snapshot.totals.groups, 3);
assert.equal(helperEvaluated.snapshot.totals.faces, 3);
assert.equal(helperEvaluated.snapshot.warning_summary.total, 0);

const comprehensionCompiled = compilePythonSdkScript(comprehensionSource, { timeoutMs: pythonTimeoutMs });
assert.equal(comprehensionCompiled.python_sdk.operations, 7);
assert.ok(comprehensionCompiled.python_sdk.facade_objects.includes('GeometryInput'));
assert.deepEqual(comprehensionCompiled.result, {
  material_roles: ['accent', 'base', 'shadow'],
  panel_names: ['Left', 'Center', 'Right'],
  areas: [1.5, 2.5, 0.9375],
  all_outer: true,
  wide_count: 2,
  total_area: 4.9375,
  last_panel: 'Right',
  middle_names: ['Center', 'Right']
});
const comprehensionGeometry = comprehensionCompiled.document.operations.filter((operation) => operation.op === 'geometry_input');
assert.equal(comprehensionGeometry.length, 3);
assert.deepEqual(comprehensionGeometry.map((operation) => operation.id), ['sdk-p2-0', 'sdk-p2-1', 'sdk-p2-2']);
assert.equal(comprehensionGeometry[1].faces[0].material, 'SDK_P2_accent');
assert.deepEqual(comprehensionGeometry[1].vertices[0], [50.8, 0, 0]);
assert.deepEqual(comprehensionGeometry[1].vertices[2], [101.6, 0, 31.75]);
assert.deepEqual(comprehensionGeometry[2].faces[0].metadata, {
  index: 2,
  spec_keys: ['h', 'name', 'role', 'w', 'x'],
  role: 'shadow'
});

const comprehensionEvaluated = await bridge.evaluate_py({ code: comprehensionSource, input_format: 'python_sdk', runtime: 'mock', pythonTimeoutMs });
assert.equal(comprehensionEvaluated.compatibility_mode, 'python_sdk_facade_compiler');
assert.equal(comprehensionEvaluated.snapshot.totals.groups, 3);
assert.equal(comprehensionEvaluated.snapshot.totals.faces, 3);
assert.equal(comprehensionEvaluated.snapshot.warning_summary.total, 0);

const officialApiCompiled = compilePythonSdkScript(officialApiSource, { timeoutMs: pythonTimeoutMs });
assert.equal(officialApiCompiled.python_sdk.operations, 18);
for (const objectName of ['Entities', 'Materials', 'Layers', 'Pages', 'Selection', 'ComponentDefinition', 'ComponentInstance', 'Face']) {
  assert.ok(officialApiCompiled.python_sdk.facade_objects.includes(objectName), `${objectName} facade object should be reported`);
}
assert.deepEqual(officialApiCompiled.result, {
  material_count: 1,
  layer_name: 'SDK_API_Layer',
  definition_name: 'SDK_API_Component_Definition',
  definition_operations: 1,
  component_definition: 'SDK_API_Component_Definition',
  group_face_area: 2,
  page_name: 'SDK_API_Page',
  selection_size: 0,
  rendering_keys: ['draw_hidden_geometry', 'display_color_by_layer', 'transparency'],
  shadow_keys: ['display', 'time']
});
const officialOps = officialApiCompiled.document.operations;
assert.deepEqual(officialOps.map((operation) => operation.op), [
  'reset',
  'material',
  'tag',
  'component_definition',
  'component_instance',
  'assign_tag',
  'attribute',
  'geometry_input',
  'assign_tag',
  'attribute',
  'box',
  'assign_tag',
  'attribute',
  'transform_object',
  'scene',
  'rendering_options',
  'shadow',
  'image_reference'
]);
const officialDefinition = officialOps.find((operation) => operation.op === 'component_definition');
assert.equal(officialDefinition.operations[0].faces[0].pushpull.metadata_only, false);
assert.equal(officialDefinition.operations[0].faces[0].pushpull.distance, 6.35);
const officialGroup = officialOps.find((operation) => operation.op === 'geometry_input' && operation.id === 'sdk-api-entities-group');
assert.equal(officialGroup.faces[0].pushpull.metadata_only, false);
assert.equal(officialGroup.faces[0].pushpull.distance, 12.7);
assert.deepEqual(officialOps.filter((operation) => operation.op === 'assign_tag').map((operation) => operation.target_id), [
  'sdk-api-component-instance',
  'sdk-api-entities-group',
  'sdk-api-box'
]);

const officialApiEvaluated = await bridge.evaluate_py({ code: officialApiSource, input_format: 'python_sdk', runtime: 'mock', pythonTimeoutMs });
assert.equal(officialApiEvaluated.compatibility_mode, 'python_sdk_facade_compiler');
assert.equal(officialApiEvaluated.snapshot.totals.groups, 2);
assert.equal(officialApiEvaluated.snapshot.totals.instances, 1);
assert.equal(officialApiEvaluated.snapshot.totals.faces, 18);
assert.equal(officialApiEvaluated.snapshot.warning_summary.total, 0);
const officialApiGroup = officialApiEvaluated.snapshot.groups.find((group) => group.id === 'sdk-api-entities-group');
assert.equal(officialApiGroup.bounding_box.h, 12.7);
assert.equal(officialApiGroup.geometry_input.pushpull_realized[0].distance, 12.7);
assert.equal(officialApiEvaluated.snapshot.groups.find((group) => group.id === 'sdk-api-box').attributes.SDK_API.role, 'box');
assert.equal(officialApiEvaluated.snapshot.instances.find((instance) => instance.id === 'sdk-api-component-instance').tag, 'SDK_API_Layer');
assert.equal(officialApiEvaluated.snapshot.scenes[0].name, 'SDK_API_Page');
assert.equal(officialApiEvaluated.snapshot.rendering_options.edge_display_mode, 1);
assert.equal(officialApiEvaluated.snapshot.shadow_state.light, 75);
assert.equal(officialApiEvaluated.snapshot.image_references[0].name, 'SDK_API_View_Image');

const officialApiR3Compiled = compilePythonSdkScript(officialApiR3Source, { timeoutMs: pythonTimeoutMs });
assert.equal(officialApiR3Compiled.python_sdk.operations, 12);
for (const objectName of ['PolygonMesh', 'Selection', 'Pages', 'Face', 'Edge', 'Entities']) {
  assert.ok(officialApiR3Compiled.python_sdk.facade_objects.includes(objectName), `${objectName} facade object should be reported by R3 fixture`);
}
assert.deepEqual(officialApiR3Compiled.result, {
  follow_ok: true,
  texture_positioned: true,
  mesh_count: 1,
  fill_ok: true,
  selection_size: 1,
  page_name: 'SDK_R3_Page'
});
const officialR3Ops = officialApiR3Compiled.document.operations;
assert.ok(officialR3Ops.some((operation) => operation.op === 'selection'), 'R3 fixture should compile Selection facade to runtime selection op');
assert.equal(officialR3Ops.filter((operation) => operation.op === 'mesh').length, 2);
const followOperation = officialR3Ops.find((operation) => operation.id === 'sdk-r3-followme');
assert.equal(followOperation.faces[0].followme.path[1][2], 38.1);
const uvOperation = officialR3Ops.find((operation) => operation.id === 'sdk-r3-uv-face');
assert.equal(uvOperation.faces[0].position_material.mapping.length, 4);
const sceneOperation = officialR3Ops.find((operation) => operation.op === 'scene' && operation.name === 'SDK_R3_Page');
assert.equal(sceneOperation.transition_time, 1.5);
assert.deepEqual(sceneOperation.layer_visibility, [{ layer: 'SDK_R3_Layer', visible: false }]);
assert.equal(sceneOperation.rendering_options.edge_display_mode, 1);
assert.equal(sceneOperation.shadow.light, 60);

const officialApiR3Evaluated = await bridge.evaluate_py({ code: officialApiR3Source, input_format: 'python_sdk', runtime: 'mock', pythonTimeoutMs });
assert.equal(officialApiR3Evaluated.compatibility_mode, 'python_sdk_facade_compiler');
assert.equal(officialApiR3Evaluated.snapshot.totals.groups, 5);
assert.equal(officialApiR3Evaluated.snapshot.totals.faces, 16);
assert.equal(officialApiR3Evaluated.snapshot.warning_summary.total, 0);
assert.equal(officialApiR3Evaluated.snapshot.selection[0].id, 'sdk-r3-selected-box');
assert.equal(officialApiR3Evaluated.snapshot.scenes[0].transition_time, 1.5);
assert.equal(officialApiR3Evaluated.snapshot.scenes[0].drawingelement_visibility[0].target_id, 'sdk-r3-selected-box');
assert.equal(officialApiR3Evaluated.snapshot.groups.find((group) => group.id === 'sdk-r3-followme').geometry_input.followme_realized[0].faces, 6);
assert.equal(officialApiR3Evaluated.snapshot.groups.find((group) => group.id === 'sdk-r3-uv-face').face_uvs[0].mapping.length, 4);

assert.throws(
  () => compilePythonSdkScript('import os\nmodel.reset()\n'),
  /Unsupported Python statement: Import/
);
assert.throws(
  () => compilePythonSdkScript('print("hello")\n'),
  /Unsupported Python SDK function: print/
);
assert.throws(
  () => compilePythonSdkScript('return 1\n'),
  /return is only supported inside restricted helper functions/
);
assert.throws(
  () => compilePythonSdkScript('def build(name):\n    return name\n\nresult = build(extra="x")\n'),
  /build got unexpected keyword argument extra/
);

const blockedArbitraryPython = await bridge.evaluate_py({ code: 'print("hello")', input_format: 'auto', runtime: 'mock' });
assert.equal(blockedArbitraryPython.compatibility_mode, 'blocked_python_runtime');
assert.equal(blockedArbitraryPython.blocked, true);
assert.equal(blockedArbitraryPython.executed, false);

console.log(JSON.stringify({
  ok: true,
  operations: compiled.python_sdk.operations,
  face_operations: faceCompiled.python_sdk.operations,
  component_operations: componentCompiled.python_sdk.operations,
  view_operations: viewCompiled.python_sdk.operations,
  appearance_operations: appearanceCompiled.python_sdk.operations,
  curve_operations: curveCompiled.python_sdk.operations,
  helper_operations: helperCompiled.python_sdk.operations,
  comprehension_operations: comprehensionCompiled.python_sdk.operations,
  official_api_operations: officialApiCompiled.python_sdk.operations,
  official_api_r3_operations: officialApiR3Compiled.python_sdk.operations,
  groups: evaluated.snapshot.totals.groups,
  warnings: evaluated.snapshot.warning_summary.total
}, null, 2));
