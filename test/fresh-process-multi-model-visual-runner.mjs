import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FRESH_PROCESS_MULTI_MODEL_VISUAL_EVIDENCE_VERSION,
  main,
  stage,
  runtimeSummary
} from '../scripts/run-fresh-process-multi-model-visual-live.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = await fs.mkdtemp(path.join(root, 'output', '.visual-runner-test-'));
try {
  const staged = await stage({ runDir: temporaryRoot });
  assert.equal(staged.ok, true);
  assert.equal(staged.phase, 'staged');
  assert.equal(staged.queue_called, false);
  assert.deepEqual(staged.cases.map((entry) => entry.case_id), ['architecture', 'product']);
  assert.deepEqual(staged.cases.map((entry) => entry.domain), ['architecture', 'product']);
  for (const entry of staged.cases) {
    const workingCopy = path.join(root, entry.working_copy);
    assert.equal(await sha256File(workingCopy), entry.fixture_handle.slice('fixture:sha256:'.length));
    assert.equal((await fs.stat(workingCopy)).size, entry.size_bytes);
    const checkpoint = JSON.parse(await fs.readFile(
      path.join(temporaryRoot, 'private', `${entry.case_id}.checkpoint.json`),
      'utf8'
    ));
    assert.equal(checkpoint.version, 'fresh-process-multi-model-visual-checkpoint.v1');
    assert.equal(checkpoint.case_id, entry.case_id);
    assert.equal(checkpoint.phase, 'staged');
    assert.equal(checkpoint.before, null);
    assert.equal(checkpoint.after, null);
    assert.equal(checkpoint.comparison, null);
    assert.equal(checkpoint.working_copy_sha256, entry.fixture_handle.slice('fixture:sha256:'.length));
    assert.equal(await sha256File(checkpoint.source_model), checkpoint.source_sha256);
    assert.equal(await sha256File(checkpoint.working_copy), checkpoint.working_copy_sha256);
  }

  await assert.rejects(
    main(['capture', '--case', 'architecture']),
    /explicit --runtime queue --queue-required/
  );
  await assert.rejects(
    main(['recapture', '--case', 'product', '--runtime', 'mock', '--queue-required']),
    /explicit --runtime queue --queue-required/
  );
  await assert.rejects(
    main(['capture', '--case', 'unknown', '--runtime', 'queue', '--queue-required', '--run-dir', temporaryRoot]),
    /--case must be one of/
  );
  await assert.rejects(
    stage({ runDir: path.join(os.tmpdir(), 'visual-runner-path-escape') }),
    /must stay inside repository output/
  );

  const source = await fs.readFile(
    path.join(root, 'scripts/run-fresh-process-multi-model-visual-live.mjs'),
    'utf8'
  );
  assert.match(source, /does not reset, edit, save, or approve/);
  assert.match(source, /fully quit and reopen/);
  assert.match(source, /cleanupReliabilityQueueArtifacts/);
  assert.match(source, /installReliabilityInterruptCleanup/);
  assert.equal(FRESH_PROCESS_MULTI_MODEL_VISUAL_EVIDENCE_VERSION, 'fresh-process-multi-model-visual-evidence.v1');
  assert.deepEqual(runtimeSummary({
    version: '0.1.0-rc.2',
    capability_version: '0.1.0-rc.2-capabilities.7',
    manifest_version: '2026-07-agent-contract-v1.4',
    model_revision: { strategy: 'definition-merkle.v2' },
    plugin: { version: '0.1.0-rc.2', sketchup_version: '26.2.242' },
    compatibility: { ok: true }
  }), {
    plugin_version: '0.1.0-rc.2',
    sketchup_version: '26.2.242',
    capability_version: '0.1.0-rc.2-capabilities.7',
    manifest_version: '2026-07-agent-contract-v1.4',
    model_revision_strategy: 'definition-merkle.v2',
    compatibility_ok: true
  });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    staged_cases: staged.cases.length,
    byte_exact_working_copies: staged.cases.length,
    queue_called_by_default: false,
    explicit_live_opt_in_negative_cases: 3,
    path_escape_negative_cases: 1,
    interrupt_cleanup_installed: true
  }, null, 2)}\n`);
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

async function sha256File(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}
