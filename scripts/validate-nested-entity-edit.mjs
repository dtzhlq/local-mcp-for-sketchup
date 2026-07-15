#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SketchUpBridge } from '../src/bridge.mjs';

export async function validateNestedEntityEdit({ runtime = 'mock', timeoutMs = runtime === 'queue' ? 180000 : 20000, outputDir = `output/nested-entity-edit/${runtime}`, saveSkp } = {}) {
  const bridge = new SketchUpBridge(runtime === 'mock'
    ? { mock: { sessionPath: path.join(outputDir, '.mock-session.json') } }
    : {});
  const document = {
    version: 1,
    units: 'mm',
    operations: [
      { op: 'reset' },
      { op: 'material', name: 'Nested_Edit_Base', color: '#b8c4d0' },
      {
        op: 'component_definition',
        name: 'Nested_Edit_Definition',
        operations: [
          { op: 'box', id: 'nested-edit-bar', name: 'Nested_Edit_Bar', origin: [0, 0, 0], size: [120, 20, 20], material: 'Nested_Edit_Base' }
        ]
      },
      { op: 'component_instance', id: 'nested-edit-instance-a', name: 'Nested_Edit_Instance_A', definition: 'Nested_Edit_Definition', origin: [0, 0, 0] },
      { op: 'component_instance', id: 'nested-edit-instance-b', name: 'Nested_Edit_Instance_B', definition: 'Nested_Edit_Definition', origin: [0, 80, 0] }
    ]
  };
  await bridge.build_model({ runtime, timeoutMs, code: JSON.stringify(document) });
  const adopted = await bridge.adopt_open_model({ runtime, timeoutMs, recursive: true, prefix: 'nested-edit' });
  const target = adopted.recursive_index?.find((entry) => entry.name === 'Nested_Edit_Bar');
  assert(target?.editable === true, 'nested definition group must be editable');
  assert(['component_definition', 'instance_path'].includes(target.edit_scope), 'nested edit scope must be component_definition or instance_path');
  assert(target.affected_instance_count === 2, 'definition-wide target must report two affected instances');
  assert(target.shared_definition === true, 'two instances must report a shared definition');

  const definitionWideDir = path.join(outputDir, 'definition-wide');
  const definitionWide = await bridge.iterate_model({
    runtime,
    timeoutMs,
    targets: [{ entity_path: target.entity_path, edit_scope: target.edit_scope, instance_policy: 'definition_wide' }],
    code: JSON.stringify({
      version: 1,
      units: 'mm',
      operations: [
        { op: 'set_material', entity_path: '$target', edit_scope: target.edit_scope, instance_policy: 'definition_wide', material: 'Nested_Edit_Blue' },
        { op: 'set_visibility', entity_path: '$target', edit_scope: target.edit_scope, instance_policy: 'definition_wide', visible: false },
        { op: 'transform_object', entity_path: '$target', edit_scope: target.edit_scope, instance_policy: 'definition_wide', translate: [10, 0, 0] },
        { op: 'rename', entity_path: '$target', edit_scope: target.edit_scope, instance_policy: 'definition_wide', new_name: 'Nested_Edit_Bar_Reviewed' }
      ]
    }),
    input_format: 'json_dsl',
    output_dir: definitionWideDir,
    label: 'nested-definition-wide',
    save_model: false,
    validate_model: false
  });
  const definitionAfter = definitionWide.nested_edit?.targets?.[0]?.after;
  assert(definitionAfter?.name === 'Nested_Edit_Bar_Reviewed', 'definition-wide rename must be visible in the after index');
  assert(definitionAfter.material === 'Nested_Edit_Blue', 'definition-wide material must be visible in the after index');
  assert(definitionAfter.visible === false, 'definition-wide visibility must be visible in the after index');
  assert(definitionAfter.bounding_box?.min?.[0] === 10, 'definition-wide transform must move the nested bounding box');
  assert(definitionAfter.affected_instance_count === 2, 'definition-wide edit must continue reporting both instances');

  const makeUniqueDir = path.join(outputDir, 'make-unique');
  const makeUnique = await bridge.iterate_model({
    runtime,
    timeoutMs,
    targets: [{ entity_path: target.entity_path, edit_scope: target.edit_scope, instance_policy: 'make_unique', instance_id: 'nested-edit-instance-a' }],
    code: JSON.stringify({
      version: 1,
      units: 'mm',
      operations: [
        { op: 'set_visibility', entity_path: '$target', edit_scope: target.edit_scope, instance_policy: 'make_unique', instance_id: 'nested-edit-instance-a', visible: true }
      ]
    }),
    input_format: 'json_dsl',
    output_dir: makeUniqueDir,
    label: 'nested-make-unique',
    save_model: false,
    validate_model: false
  });
  const afterUniqueAdoption = JSON.parse(await fs.readFile(makeUnique.artifacts.after_nested_index, 'utf8'));
  const matchingEntries = (afterUniqueAdoption.recursive_index || []).filter((entry) => entry.reference === target.reference);
  const uniqueEntry = matchingEntries.find((entry) => entry.definition_name !== 'Nested_Edit_Definition');
  const sharedEntry = matchingEntries.find((entry) => entry.definition_name === 'Nested_Edit_Definition');
  assert(uniqueEntry?.visible === true, 'make_unique edit must affect the cloned definition target');
  assert(uniqueEntry?.affected_instance_count === 1, 'make_unique target must affect one instance');
  assert(sharedEntry?.visible === false, 'make_unique edit must not change the original shared definition');
  assert(sharedEntry?.affected_instance_count === 1, 'the original definition must retain the other instance');

  if (runtime === 'mock') {
    let blocked = false;
    try {
      await bridge.evaluate_py({
        runtime,
        input_format: 'json_dsl',
        code: JSON.stringify({ version: 1, units: 'mm', operations: [{ op: 'set_visibility', entity_path: target.entity_path, edit_scope: target.edit_scope, visible: true }] })
      });
    } catch (error) {
      blocked = /instance_policy must be definition_wide or make_unique/.test(error.message);
    }
    assert(blocked, 'nested edit without instance_policy must fail closed');
  }

  let savedModel = null;
  if (saveSkp) {
    const saved = await bridge.save_model({ runtime, timeoutMs, path: saveSkp, keep_session: true });
    savedModel = saved.path || saved.file_path || saveSkp;
  }
  const report = {
    ok: true,
    runtime,
    target: { entity_path: target.entity_path, reference: target.reference },
    definition_wide: {
      affected_instance_count: definitionAfter.affected_instance_count,
      after_name: definitionAfter.name,
      after_material: definitionAfter.material,
      after_visible: definitionAfter.visible,
      after_bbox: definitionAfter.bounding_box,
      artifacts: definitionWide.artifacts
    },
    make_unique: {
      unique_definition: uniqueEntry.definition_name,
      unique_affected_instance_count: uniqueEntry.affected_instance_count,
      original_affected_instance_count: sharedEntry.affected_instance_count,
      artifacts: makeUnique.artifacts
    },
    face_edge_editable: (afterUniqueAdoption.recursive_index || []).filter((entry) => ['face', 'edge'].includes(entry.entity_type)).some((entry) => entry.editable === true),
    saved_model: savedModel
  };
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'nested-edit-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--runtime') options.runtime = argv[++index];
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else if (arg === '--output-dir') options.outputDir = argv[++index];
    else if (arg === '--save-skp') options.saveSkp = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  validateNestedEntityEdit(parseArgs(process.argv.slice(2)))
    .then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exit(1);
    });
}
