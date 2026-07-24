import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import sharp from 'sharp';
import { AgentContractError } from '../src/agent-contract.mjs';
import {
  DEFAULT_IMAGE_ARTIFACT_LIMITS,
  IMMUTABLE_IMAGE_ARTIFACT_VERSION,
  ImmutableImageArtifactStore
} from '../src/image-artifact-store.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-image-artifact-store-'));
const allowedRoot = path.join(root, 'allowed');
const outsideRoot = path.join(root, 'outside');
await Promise.all([
  fs.mkdir(allowedRoot, { recursive: true }),
  fs.mkdir(outsideRoot, { recursive: true })
]);

try {
  const png = await sharp({
    create: { width: 32, height: 24, channels: 4, background: { r: 24, g: 96, b: 180, alpha: 1 } }
  }).png().toBuffer();
  const jpeg = await sharp({
    create: { width: 20, height: 12, channels: 3, background: { r: 220, g: 160, b: 40 } }
  }).jpeg({ quality: 90 }).toBuffer();
  const webp = await sharp({
    create: { width: 18, height: 10, channels: 4, background: { r: 30, g: 180, b: 90, alpha: 1 } }
  }).webp().toBuffer();

  const storeRoot = path.join(root, 'store');
  const store = new ImmutableImageArtifactStore({ rootDir: storeRoot, allowedRoots: [allowedRoot] });
  const mutableInput = Buffer.from(png);
  const first = await store.ingestBuffer(mutableInput, { mediaType: 'image/png' });
  mutableInput.fill(0);

  assert.equal(first.reused, false);
  assert.equal(first.record.version, IMMUTABLE_IMAGE_ARTIFACT_VERSION);
  assert.equal(first.record.content_trust, 'untrusted_data');
  assert.equal(first.record.policy_effect, 'none');
  assert.match(first.record.handle, /^image-artifact:sha256:[0-9a-f]{64}$/);
  assert.equal(first.record.sha256, `sha256:${crypto.createHash('sha256').update(png).digest('hex')}`);
  assert.equal(first.record.media_type, 'image/png');
  assert.equal(first.record.size_bytes, png.length);
  assert.equal(first.record.width, 32);
  assert.equal(first.record.height, 24);
  assert.equal(first.record.channels, 4);
  assert.equal(first.record.pages, 1);
  assert.equal(first.record.frames, 1);
  assert.equal(first.record.total_pixels, 32 * 24);
  assert.equal(JSON.stringify(first.record).includes(root), false, 'public records must never expose source or CAS paths');
  assert.deepEqual([...Object.keys(await store.resolve(first.record.handle))].sort(), ['buffer', 'record']);
  assert.deepEqual(await store.readBuffer(first.record.handle), png, 'the store must own an immutable copy of caller buffers');
  assert.deepEqual(await store.inspect(first.record.handle), first.record);

  const base64Replay = await store.ingestBase64(png.toString('base64'));
  assert.equal(base64Replay.reused, true);
  assert.equal(base64Replay.record.handle, first.record.handle);
  assert.equal(base64Replay.record.created_at, first.record.created_at);
  const dataUrlReplay = await store.ingestBase64(`data:image/png;base64,${png.toString('base64')}`);
  assert.equal(dataUrlReplay.reused, true);
  assert.equal(dataUrlReplay.record.handle, first.record.handle);

  const insidePath = path.join(allowedRoot, 'input.webp');
  await fs.writeFile(insidePath, webp);
  const pathIngest = await store.ingestPath(insidePath, { mediaType: 'image/webp' });
  assert.equal(pathIngest.record.media_type, 'image/webp');
  assert.deepEqual(await store.readBuffer(pathIngest.record.handle), webp);
  assert.equal(JSON.stringify(pathIngest.record).includes(insidePath), false);

  const outsidePath = path.join(outsideRoot, 'outside.png');
  await fs.writeFile(outsidePath, png);
  await rejectsCode(store.ingestPath(outsidePath), 'POLICY_DENIED');
  const symlinkPath = path.join(allowedRoot, 'outside-link.png');
  await fs.symlink(outsidePath, symlinkPath);
  await rejectsCode(store.ingestPath(symlinkPath), 'POLICY_DENIED');

  await rejectsCode(store.ingestBase64('not-base64!!!'), 'INVALID_ARGUMENT');
  await rejectsCode(store.ingestBase64(`data:image/jpeg;base64,${png.toString('base64')}`), 'INVALID_ARGUMENT');
  await rejectsCode(store.ingestBuffer(png, { mediaType: 'image/jpeg' }), 'INVALID_ARGUMENT');
  await rejectsCode(store.resolve('image-artifact:sha256:not-a-digest'), 'ARTIFACT_NOT_FOUND');

  const byteLimited = new ImmutableImageArtifactStore({
    rootDir: path.join(root, 'byte-limited'),
    limits: { maxBytes: png.length - 1 }
  });
  await rejectsCode(byteLimited.ingestBuffer(png), 'POLICY_DENIED');

  const widthLimited = new ImmutableImageArtifactStore({
    rootDir: path.join(root, 'width-limited'),
    limits: { maxWidth: 31 }
  });
  await rejectsCode(widthLimited.ingestBuffer(png), 'POLICY_DENIED');

  const pixelLimited = new ImmutableImageArtifactStore({
    rootDir: path.join(root, 'pixel-limited'),
    limits: { maxTotalPixels: 100 }
  });
  await rejectsCode(pixelLimited.ingestBuffer(png), 'POLICY_DENIED');

  const multiPageTiff = await sharp({
    create: {
      width: 8,
      height: 12,
      pageHeight: 6,
      channels: 4,
      background: { r: 120, g: 40, b: 180, alpha: 1 }
    }
  }).tiff().toBuffer();
  await rejectsCode(store.ingestBuffer(multiPageTiff), 'POLICY_DENIED');

  const animatedPixels = Buffer.alloc(8 * 12 * 4);
  animatedPixels.fill(0xff, 0, 8 * 6 * 4);
  const animatedWebp = await sharp(animatedPixels, {
    raw: { width: 8, height: 12, pageHeight: 6, channels: 4 }
  }).webp({ delay: [100, 100], loop: 0 }).toBuffer();
  await rejectsCode(store.ingestBuffer(animatedWebp), 'POLICY_DENIED');
  const frameLimited = new ImmutableImageArtifactStore({
    rootDir: path.join(root, 'frame-limited'),
    limits: { maxPages: 2, maxFrames: 1 }
  });
  await rejectsCode(frameLimited.ingestBuffer(animatedWebp), 'POLICY_DENIED');

  const unsupportedGif = await sharp({
    create: { width: 8, height: 8, channels: 4, background: { r: 200, g: 20, b: 20, alpha: 1 } }
  }).gif().toBuffer();
  await rejectsCode(store.ingestBuffer(unsupportedGif), 'INVALID_ARGUMENT');

  const digest = first.record.handle.split(':').at(-1);
  const firstPaths = artifactPaths(storeRoot, digest);
  assert.equal((await fs.stat(storeRoot)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(path.dirname(firstPaths.blob))).mode & 0o777, 0o700);
  assert.equal((await fs.stat(firstPaths.blob)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(firstPaths.record)).mode & 0o777, 0o600);
  const storeFiles = await filesUnder(storeRoot);
  assert.equal(storeFiles.filter((file) => file.endsWith(`${digest}.blob`)).length, 1);
  assert.equal(storeFiles.filter((file) => file.endsWith(`${digest}.json`)).length, 1);

  const restarted = new ImmutableImageArtifactStore({ rootDir: storeRoot, allowedRoots: [allowedRoot] });
  assert.deepEqual(await restarted.inspect(first.record.handle), first.record);
  assert.deepEqual(await restarted.readBuffer(first.record.handle), png);
  const restartedReplay = await restarted.ingestBuffer(png);
  assert.equal(restartedReplay.reused, true);
  assert.equal(restartedReplay.record.created_at, first.record.created_at);

  const concurrentRoot = path.join(root, 'concurrent');
  const concurrentStores = Array.from(
    { length: 64 },
    () => new ImmutableImageArtifactStore({ rootDir: concurrentRoot })
  );
  const concurrent = await Promise.all(concurrentStores.map((candidate) => candidate.ingestBuffer(jpeg)));
  const durableRecord = concurrent[0].record;
  assert.equal(new Set(concurrent.map((result) => result.record.handle)).size, 1);
  assert.equal(new Set(concurrent.map((result) => result.record.created_at)).size, 1);
  assert.equal(new Set(concurrent.map((result) => result.record.record_integrity_sha256)).size, 1);
  assert.equal(concurrent.filter((result) => !result.reused).length, 1, 'concurrent registration must publish exactly one durable record');
  for (const result of concurrent) assert.deepEqual(result.record, durableRecord);
  assert.equal((await filesUnder(concurrentRoot)).filter((file) => file.endsWith('.blob')).length, 1);
  assert.equal((await filesUnder(concurrentRoot)).filter((file) => file.endsWith('.json')).length, 1);
  assert.equal((await filesUnder(concurrentRoot)).filter((file) => file.endsWith('.tmp')).length, 0);
  const concurrentDigest = durableRecord.handle.split(':').at(-1);
  const concurrentPaths = artifactPaths(concurrentRoot, concurrentDigest);
  const stableBlobStat = await fs.stat(concurrentPaths.blob);
  const stableRecordStat = await fs.stat(concurrentPaths.record);
  assert.equal(stableBlobStat.nlink, 1);
  assert.equal(stableRecordStat.nlink, 1);
  const concurrentReplay = await Promise.all(concurrentStores.map((candidate) => candidate.ingestBuffer(jpeg)));
  for (const result of concurrentReplay) {
    assert.equal(result.reused, true);
    assert.deepEqual(result.record, durableRecord);
  }
  const replayedBlobStat = await fs.stat(concurrentPaths.blob);
  const replayedRecordStat = await fs.stat(concurrentPaths.record);
  assert.equal(replayedBlobStat.ctimeMs, stableBlobStat.ctimeMs, 'reused blob publication must not mutate inode metadata');
  assert.equal(replayedRecordStat.ctimeMs, stableRecordStat.ctimeMs, 'reused record publication must not mutate inode metadata');

  const unexpectedHardLink = path.join(concurrentRoot, 'unexpected-hard-link');
  await fs.link(concurrentPaths.blob, unexpectedHardLink);
  await rejectsCode(
    concurrentStores[0].resolve(durableRecord.handle),
    'ARTIFACT_INTEGRITY_ERROR',
    'reingest_artifact_and_report_corruption'
  );
  await fs.unlink(unexpectedHardLink);
  assert.deepEqual(await concurrentStores[0].readBuffer(durableRecord.handle), jpeg);

  const tamperRoot = path.join(root, 'tamper-store');
  const tamperStore = new ImmutableImageArtifactStore({ rootDir: tamperRoot });
  const tampered = await tamperStore.ingestBuffer(jpeg);
  const tamperedDigest = tampered.record.handle.split(':').at(-1);
  const tamperedPaths = artifactPaths(tamperRoot, tamperedDigest);
  await fs.writeFile(tamperedPaths.blob, webp);
  await rejectsCode(
    tamperStore.inspect(tampered.record.handle),
    'ARTIFACT_INTEGRITY_ERROR',
    'reingest_artifact_and_report_corruption'
  );

  const recordTamperRoot = path.join(root, 'record-tamper-store');
  const recordTamperStore = new ImmutableImageArtifactStore({ rootDir: recordTamperRoot });
  const recordTampered = await recordTamperStore.ingestBuffer(webp);
  const recordTamperedDigest = recordTampered.record.handle.split(':').at(-1);
  const recordTamperedPaths = artifactPaths(recordTamperRoot, recordTamperedDigest);
  const changedRecord = JSON.parse(await fs.readFile(recordTamperedPaths.record, 'utf8'));
  changedRecord.width += 1;
  await fs.writeFile(recordTamperedPaths.record, `${JSON.stringify(changedRecord, null, 2)}\n`, 'utf8');
  await rejectsCode(
    recordTamperStore.readBuffer(recordTampered.record.handle),
    'ARTIFACT_INTEGRITY_ERROR',
    'reingest_artifact_and_report_corruption'
  );

  const replacementRoot = path.join(root, 'replacement-store');
  const replacementStore = new ImmutableImageArtifactStore({ rootDir: replacementRoot });
  const replaced = await replacementStore.ingestBuffer(jpeg);
  const replacedDigest = replaced.record.handle.split(':').at(-1);
  const replacedPaths = artifactPaths(replacementRoot, replacedDigest);
  await fs.rm(replacedPaths.blob);
  await fs.symlink(outsidePath, replacedPaths.blob);
  await rejectsCode(
    replacementStore.resolve(replaced.record.handle),
    'ARTIFACT_INTEGRITY_ERROR',
    'reingest_artifact_and_report_corruption'
  );

  const schema = JSON.parse(await fs.readFile(new URL('../schema/immutable-image-artifact-v1.schema.json', import.meta.url), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  assert.equal(ajv.validate(schema, first.record), true, JSON.stringify(ajv.errors));

  process.stdout.write(`${JSON.stringify({
    ok: true,
    version: IMMUTABLE_IMAGE_ARTIFACT_VERSION,
    default_limits: DEFAULT_IMAGE_ARTIFACT_LIMITS,
    handle_only_ingest: true,
    source_paths_exposed: false,
    content_marked_untrusted: true,
    policy_effect_none: true,
    path_policy_fail_closed: true,
    symlink_escape_blocked: true,
    compressed_byte_limit: true,
    dimension_pixel_limits: true,
    multipage_animation_blocked: true,
    unsupported_format_blocked: true,
    cas_dedupe: true,
    concurrent_idempotency: true,
    high_concurrency_same_record: true,
    publication_inode_metadata_stable: true,
    unexpected_hard_link_fail_closed: true,
    restart_recovery: true,
    content_tamper_fail_closed: true,
    record_tamper_fail_closed: true,
    symlink_replacement_fail_closed: true,
    live_queue_called: false
  }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function rejectsCode(promise, code, nextAction) {
  let captured;
  await assert.rejects(
    promise,
    (error) => {
      captured = error;
      return error instanceof AgentContractError && error.code === code;
    },
    `expected AgentContractError ${code}`
  );
  if (nextAction) assert.equal(captured.next_action?.action, nextAction);
  return captured;
}

function artifactPaths(storeRoot, digest) {
  return {
    blob: path.join(storeRoot, 'cas', 'sha256', digest.slice(0, 2), `${digest}.blob`),
    record: path.join(storeRoot, 'records', 'sha256', digest.slice(0, 2), `${digest}.json`)
  };
}

async function filesUnder(directory) {
  const result = [];
  const visit = async (current) => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(child);
      else result.push(child);
    }
  };
  await visit(directory);
  return result;
}
