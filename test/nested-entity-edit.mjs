import assert from 'node:assert/strict';
import { validateNestedEntityEdit } from '../scripts/validate-nested-entity-edit.mjs';

const report = await validateNestedEntityEdit({ runtime: 'mock', outputDir: 'output/nested-entity-edit/test-mock' });
assert.equal(report.ok, true);
assert.equal(report.definition_wide.affected_instance_count, 2);
assert.equal(report.make_unique.unique_affected_instance_count, 1);
assert.equal(report.make_unique.original_affected_instance_count, 1);
assert.equal(report.face_edge_editable, true);

process.stdout.write(`${JSON.stringify({ ok: true, definition_wide_instances: 2, make_unique_instances: 1, face_edge_editable: true }, null, 2)}\n`);
