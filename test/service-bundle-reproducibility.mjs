import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createArchive } from '../scripts/package-service-bundle.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-mcp-service-archive-test-'));
const timestamp = new Date('2026-01-01T00:00:00.000Z');

try {
  const firstRoot = await makeFixture(path.join(root, 'first'));
  const secondRoot = await makeFixture(path.join(root, 'second'));
  const firstArchive = path.join(root, 'first.tar.gz');
  const secondArchive = path.join(root, 'second.tar.gz');

  await createArchive(firstRoot, firstArchive, 'tar.gz');
  await createArchive(secondRoot, secondArchive, 'tar.gz');

  const firstHash = sha256(await fs.readFile(firstArchive));
  const secondHash = sha256(await fs.readFile(secondArchive));
  assert.equal(secondHash, firstHash);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    tar_gzip_reproducible: true,
    sha256: firstHash
  }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function makeFixture(parent) {
  const bundleRoot = path.join(parent, 'local-mcp-for-sketchup');
  const nested = path.join(bundleRoot, 'app');
  const filePath = path.join(nested, 'fixture.txt');
  await fs.mkdir(nested, { recursive: true, mode: 0o755 });
  await fs.writeFile(filePath, 'reproducible service bundle fixture\n', { encoding: 'utf8', mode: 0o644 });
  await fs.utimes(filePath, timestamp, timestamp);
  await fs.utimes(nested, timestamp, timestamp);
  await fs.utimes(bundleRoot, timestamp, timestamp);
  return bundleRoot;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
