import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(repoRoot, 'docs', 'evidence');
const ARCHIVAL_MANIFEST_SPECS = [
  {
    path: path.join(evidenceDir, 'model-revision-v1-archival-lineage-manifest-v1.json'),
    evidencePaths: [
      'docs/evidence/model-revision-merkle-v1-mock-evidence.json',
      'docs/evidence/real-model-candidate-live-evidence-2026-07-20.json',
      'docs/evidence/real-model-recursive-live-readonly-evidence-2026-07-20-capability6.json',
      'docs/evidence/real-model-target-review-live-evidence-2026-07-20.json'
    ]
  },
  {
    path: path.join(evidenceDir, 'real-model-reliability-plan-v1-archival-lineage-manifest-v1.json'),
    evidencePaths: [
      'docs/evidence/real-model-recursive-reliability-v1-mock-evidence.json'
    ]
  },
  {
    path: path.join(evidenceDir, 'real-model-target-review-v1-archival-lineage-manifest-v1.json'),
    evidencePaths: [
      'docs/evidence/real-model-target-review-v1-mock-evidence.json'
    ]
  }
];
const EXPECTED_ARCHIVAL_EVIDENCE_PATHS = ARCHIVAL_MANIFEST_SPECS
  .flatMap((entry) => entry.evidencePaths)
  .sort();
const DIGEST_PATTERN = /^(?:sha256:)?([0-9a-f]{64})$/;

export async function verifyMockEvidenceHashes({ rootDir, evidenceFiles }) {
  const root = path.resolve(rootDir);
  const realRoot = await fs.realpath(root);
  const failures = [];
  let checked = 0;

  for (const evidenceFile of [...evidenceFiles].sort()) {
    const evidencePath = path.resolve(evidenceFile);
    const document = JSON.parse(await fs.readFile(evidencePath, 'utf8'));
    const bindings = collectPathDigestBindings(document);
    for (const binding of bindings) {
      checked += 1;
      const candidate = path.resolve(root, binding.repoPath);
      const relative = path.relative(root, candidate);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        failures.push(failure(evidencePath, binding, 'path_escape'));
        continue;
      }

      let realCandidate;
      try {
        realCandidate = await fs.realpath(candidate);
      } catch (error) {
        failures.push(failure(evidencePath, binding, error?.code === 'ENOENT' ? 'file_missing' : 'file_unreadable'));
        continue;
      }
      const realRelative = path.relative(realRoot, realCandidate);
      if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
        failures.push(failure(evidencePath, binding, 'symlink_escape'));
        continue;
      }

      const stat = await fs.stat(realCandidate);
      if (!stat.isFile()) {
        failures.push(failure(evidencePath, binding, 'not_a_regular_file'));
        continue;
      }
      const actual = crypto.createHash('sha256').update(await fs.readFile(realCandidate)).digest('hex');
      if (actual !== binding.expected) failures.push(failure(evidencePath, binding, 'digest_mismatch', actual));
    }
  }

  return { checked, failures: failures.sort(compareFailure) };
}

function collectPathDigestBindings(value, pointer = '$', result = []) {
  if (!value || typeof value !== 'object') return result;
  for (const [key, child] of Object.entries(value)) {
    const match = typeof child === 'string' ? DIGEST_PATTERN.exec(child) : null;
    if (key.includes('/') && match) {
      result.push({ repoPath: key, expected: match[1], pointer: `${pointer}.${key}` });
    } else {
      collectPathDigestBindings(child, `${pointer}.${key}`, result);
    }
  }
  return result;
}

function failure(evidencePath, binding, reason, actual = null) {
  return {
    evidence: path.basename(evidencePath),
    repo_path: binding.repoPath,
    pointer: binding.pointer,
    reason,
    expected: binding.expected,
    actual
  };
}

function compareFailure(left, right) {
  return `${left.evidence}\0${left.repo_path}\0${left.pointer}`
    .localeCompare(`${right.evidence}\0${right.repo_path}\0${right.pointer}`);
}

async function runNegativeSelfTest() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-evidence-hash-guard-'));
  try {
    await fs.mkdir(path.join(root, 'docs', 'evidence'), { recursive: true });
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'fixture.txt'), 'trusted fixture\n', 'utf8');
    const evidencePath = path.join(root, 'docs', 'evidence', 'negative-mock-evidence.json');
    await fs.writeFile(evidencePath, `${JSON.stringify({
      hashes: {
        'src/fixture.txt': '0'.repeat(64),
        '../outside.txt': '1'.repeat(64),
        generated_report: '2'.repeat(64)
      }
    }, null, 2)}\n`, 'utf8');
    const report = await verifyMockEvidenceHashes({ rootDir: root, evidenceFiles: [evidencePath] });
    assert.equal(report.checked, 2, 'semantic hashes whose keys are not paths must be ignored');
    assert.deepEqual(report.failures.map((entry) => entry.reason).sort(), ['digest_mismatch', 'path_escape']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

await runNegativeSelfTest();
const archivalManifests = await Promise.all(ARCHIVAL_MANIFEST_SPECS.map(async (spec) => ({
  spec,
  document: JSON.parse(await fs.readFile(spec.path, 'utf8'))
})));
const archivalEvidenceRepoPaths = [];
for (const { spec, document } of archivalManifests) {
  assert.equal(document.lineage_only, true);
  assert.equal(document.current_acceptance, false);
  assert.equal(document.release_acceptance, false);
  assert.equal(document.policy.current_evidence_source_hash_validation_preserved, true);
  const manifestPaths = document.entries.map((entry) => entry.path).sort();
  assert.deepEqual(manifestPaths, [...spec.evidencePaths].sort());
  assert.deepEqual(Object.keys(document.evidence_sha256).sort(), [...spec.evidencePaths].sort());
  archivalEvidenceRepoPaths.push(...manifestPaths);
}
archivalEvidenceRepoPaths.sort();
assert.deepEqual(archivalEvidenceRepoPaths, EXPECTED_ARCHIVAL_EVIDENCE_PATHS);
assert.equal(new Set(archivalEvidenceRepoPaths).size, archivalEvidenceRepoPaths.length,
  'an evidence document cannot be classified by more than one archival manifest');
const archivalEvidenceFiles = new Set(archivalEvidenceRepoPaths.map((repoPath) => path.resolve(repoRoot, repoPath)));

const allMockEvidenceFiles = (await fs.readdir(evidenceDir))
  .filter((name) => /mock-evidence.*\.json$/i.test(name))
  .map((name) => path.join(evidenceDir, name));
const currentEvidenceFiles = allMockEvidenceFiles.filter((evidenceFile) => !archivalEvidenceFiles.has(path.resolve(evidenceFile)));
const archivedMockEvidenceFiles = allMockEvidenceFiles.filter((evidenceFile) => archivalEvidenceFiles.has(path.resolve(evidenceFile)));
assert.deepEqual(
  archivedMockEvidenceFiles.map((evidenceFile) => path.basename(evidenceFile)).sort(),
  [
    'model-revision-merkle-v1-mock-evidence.json',
    'real-model-recursive-reliability-v1-mock-evidence.json',
    'real-model-target-review-v1-mock-evidence.json'
  ],
  'only mock evidence frozen by an explicit archival manifest may bypass current-source hash comparison'
);

const [currentReport, archivalReport] = await Promise.all([
  verifyMockEvidenceHashes({ rootDir: repoRoot, evidenceFiles: currentEvidenceFiles }),
  verifyMockEvidenceHashes({
    rootDir: repoRoot,
    evidenceFiles: ARCHIVAL_MANIFEST_SPECS.map((entry) => entry.path)
  })
]);
const report = {
  checked: currentReport.checked + archivalReport.checked,
  failures: [...currentReport.failures, ...archivalReport.failures].sort(compareFailure)
};
if (report.failures.length) {
  process.stderr.write(`${JSON.stringify({ ok: false, ...report }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    evidence_files: currentEvidenceFiles.length,
    current_source_hash_evidence_files: currentEvidenceFiles.length,
    archival_manifests: archivalManifests.length,
    archival_evidence_files: archivalEvidenceFiles.size,
    archived_mock_evidence_files: archivedMockEvidenceFiles.length,
    path_hash_bindings: report.checked,
    current_source_hash_bindings: currentReport.checked,
    archival_evidence_byte_hash_bindings: archivalReport.checked,
    path_escape_fail_closed: true,
    digest_mismatch_fail_closed: true
  }, null, 2)}\n`);
}
