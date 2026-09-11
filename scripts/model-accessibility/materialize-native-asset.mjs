import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SketchUpBridge } from '../../src/bridge.mjs';
import { objectHash } from './benchmark.mjs';

// Serial host fixture preparation. The tested model never sees this module.
// Requires a genuinely empty active document; it never clears a model.
export async function materializeNativeAsset({ sourceFile, outputDir }) {
  const source = JSON.parse(await fs.readFile(sourceFile, 'utf8'));
  if (!['chair', 'stool', 'armchair'].includes(source.kind) || objectHash(source.dsl) !== source.dsl_sha256) throw new Error('Expected a prepared, unchanged native asset source');
  await fs.mkdir(outputDir, { recursive: false, mode: 0o700 });
  const record = async (name, value) => fs.writeFile(path.join(outputDir, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  const bridge = new SketchUpBridge({ agentContract: { rootDir: path.join(outputDir, 'state') }, executionPolicy: { allowed_runtimes: ['queue'], allow_queue_mutation: true, allow_direct_expert_queue_mutation: true, auto_approve_risks: [] } });
  const before = await bridge.inspect_model({ runtime: 'queue', includeSnapshot: true, timeoutMs: 30000 });
  await record('before.json', before);
  const snapshot = before.snapshot;
  if (snapshot.model_revision_complete !== true || (snapshot.instances || []).length || (snapshot.groups || []).length || snapshot.totals.faces !== 0 || snapshot.totals.edges !== 0) throw new Error('Open a separate empty template before materialization; existing objects will not be erased');
  const built = await bridge.withFreshQueueMutationAuthorization({ operation: 'build_model', timeoutMs: 120000 }, authorized => authorized.build_model({ code: JSON.stringify(source.dsl), runtime: 'queue', timeoutMs: 120000 }));
  await record('build.json', built);
  const inspected = await bridge.inspect_model({ runtime: 'queue', includeSnapshot: true, timeoutMs: 30000 });
  await record('native-inspection.json', inspected);
  const roots = [...inspected.snapshot.instances, ...inspected.snapshot.groups];
  const root = roots.find(item => item.id === source.root_id || item.name === source.root_id);
  if (roots.length !== 1 || !root || inspected.snapshot.model_revision_complete !== true || !root.persistent_id) throw new Error('Native materialization did not produce exactly the complete intended root');
  const bounds = root.bounding_box;
  if (!bounds || ![...bounds.min, ...bounds.max, bounds.w, bounds.d, bounds.h].every(Number.isFinite) || Math.min(bounds.w, bounds.d, bounds.h) <= 0) throw new Error('Native asset bounds are unavailable');
  const destination = path.join(outputDir, `${source.kind}.skp`);
  const saved = await bridge.withFreshQueueMutationAuthorization({ operation: 'save_model', timeoutMs: 60000 }, authorized => authorized.save_model({ path: destination, keep_session: true, runtime: 'queue', timeoutMs: 60000 }));
  await record('save.json', saved);
  const bytes = await fs.readFile(destination);
  if (bytes.length === 0 || path.resolve(saved.file_path || '') !== destination) throw new Error('Native asset save not confirmed');
  const after = await bridge.inspect_model({ runtime: 'queue', includeSnapshot: true, timeoutMs: 30000 });
  await record('after-save.json', after);
  if (after.snapshot.model_revision !== inspected.snapshot.model_revision) throw new Error('Geometry revision changed during asset save');
  const fileSha = crypto.createHash('sha256').update(bytes).digest('hex');
  const entry = { id: source.asset_id, name: source.kind, kind: 'skp_component', tags: [source.kind], path: destination,
    source: source.source, license: source.license, axes: source.axes,
    default_dimensions_mm: { width: bounds.w, depth: bounds.d, height: bounds.h }, default_bounds_mm: { min: bounds.min, max: bounds.max, size: [bounds.w, bounds.d, bounds.h] },
    dimensions_evidence: { source: 'host_recorded_native_component_bounds', native_verified: false, native_receipt: 'native-inspection.json', interpretation: 'Native source root bounds before save; importing/placing still needs fresh measurement.' },
    evidence: { file_sha256: fileSha, bytes: bytes.length, model_revision: inspected.snapshot.model_revision, persistent_root: `pid:${root.persistent_id}`, source_dsl_sha256: source.dsl_sha256 },
    native_geometry_verified: false, cold_reopen_verified: false };
  await record('catalog-entry.json', entry);
  return { asset_id: source.asset_id, path: destination, bytes: bytes.length, sha256: fileSha, dimensions_mm: entry.default_dimensions_mm, cold_reopen_verified: false };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await materializeNativeAsset({ sourceFile: path.resolve(process.argv[2]), outputDir: path.resolve(process.argv[3]) })));
