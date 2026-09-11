import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SketchUpBridge } from '../../src/bridge.mjs';
import { objectHash, sha256 } from './benchmark.mjs';
import { assertEmptyNativeTemplate } from './native-asset-development.mjs';

// Private, serial host setup. This is never exposed to the tested model and
// never creates a parameter authority for already existing geometry.
export async function materializeAppearanceFixture({ preparedDir, outputDir }) {
  const read = async name => JSON.parse(await fs.readFile(path.join(preparedDir, name), 'utf8'));
  const [manifest, dsl, oracle] = await Promise.all([read('fixture-manifest.json'), read('fixture.dsl.json'), read('fixture-oracle.private.json')]);
  if (manifest.fixture_family !== 'appearance_assets' || manifest.blockers.length || manifest.native_ready !== false || objectHash(dsl) !== manifest.dsl_sha256 || objectHash(oracle) !== manifest.oracle_sha256) throw new Error('Expected an unchanged prepared appearance fixture without resource blockers.');
  for (const resource of manifest.source_resources) if (sha256(await fs.readFile(resource.path)) !== resource.sha256) throw new Error('A prepared appearance resource changed.');
  await fs.mkdir(outputDir, { recursive: false, mode: 0o700 });
  const record = async (name, value) => fs.writeFile(path.join(outputDir, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  const bridge = new SketchUpBridge({ agentContract: { rootDir: path.join(outputDir, 'host-state') }, executionPolicy: { allowed_runtimes: ['queue'], allow_queue_mutation: true, allow_direct_expert_queue_mutation: true, auto_approve_risks: [] } });
  const inspect = async () => {
    const result = await bridge.adopt_open_model({ runtime: 'queue', read_only: true, recursive: false, timeoutMs: 60000 });
    return { ...result, snapshot: { ...result.snapshot, model_revision: result.model_revision, model_revision_complete: result.model_revision_complete } };
  };
  const before = await inspect(); await record('before.json', before);
  assertEmptyNativeTemplate(before.snapshot);
  await record('build-started.json', { created_at: new Date().toISOString(), case_id: manifest.case_id, dsl_sha256: manifest.dsl_sha256, before_revision: before.model_revision, automatic_retry_allowed: false });
  const built = await bridge.withFreshQueueMutationAuthorization({ operation: 'build_model', timeoutMs: 120000 }, authorized => authorized.build_model({ code: JSON.stringify(dsl), runtime: 'queue', timeoutMs: 120000 }));
  await record('build.json', built);
  const after = await inspect(); await record('native-baseline.json', after);
  const roots = [...after.snapshot.instances, ...after.snapshot.groups];
  const names = roots.map(root => root.id).sort();
  if (!after.model_revision_complete || JSON.stringify(names) !== JSON.stringify(Object.keys(oracle.identities).sort()) || !roots.every(root => root.persistent_id)) throw new Error('Native fixture roots differ from the frozen source.');
  const panel = roots.find(root => root.id === 'P');
  if (!panel || [panel.bounding_box.w, panel.bounding_box.d, panel.bounding_box.h].some((v, i) => Math.abs(v - [1800, 900, 30][i]) > 0.1)) throw new Error('Native panel size differs from its frozen fixture.');
  const destination = path.join(outputDir, 'appearance-fixture.skp');
  const saved = await bridge.withFreshQueueMutationAuthorization({ operation: 'save_model', timeoutMs: 60000 }, authorized => authorized.save_model({ path: destination, keep_session: true, runtime: 'queue', timeoutMs: 60000 }));
  await record('save.json', saved);
  const bytes = await fs.readFile(destination), afterSave = await inspect();
  await record('after-save.json', afterSave);
  if (bytes.length === 0 || saved.file_path !== destination || afterSave.model_revision !== after.model_revision) throw new Error('Native save or geometry preservation was not confirmed.');
  const result = { version: 'native-appearance-fixture.v1', case_id: manifest.case_id, prepared_source: preparedDir, dsl_sha256: manifest.dsl_sha256, oracle_sha256: manifest.oracle_sha256,
    native_baseline_complete: true, model_revision: after.model_revision, identities: roots.map(root => ({ id: root.id, persistent_id: root.persistent_id, definition: root.definition, bounding_box: root.bounding_box })),
    file: { path: destination, bytes: bytes.length, sha256: sha256(bytes) }, model_provider_called: false, cold_reopen_verified: false, formal_acceptance: false };
  await record('materialization.json', result);
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await materializeAppearanceFixture({ preparedDir: path.resolve(process.argv[2]), outputDir: path.resolve(process.argv[3]) })));
