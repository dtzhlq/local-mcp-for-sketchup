import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { AgentContractError, sha256Canonical } from './agent-contract.mjs';
import { defaultStateDir } from './paths.mjs';

export const IMMUTABLE_IMAGE_ARTIFACT_VERSION = 'immutable-image-artifact.v1';

export const DEFAULT_IMAGE_ARTIFACT_LIMITS = Object.freeze({
  max_bytes: 20 * 1024 * 1024,
  max_width: 8192,
  max_height: 8192,
  max_total_pixels: 40_000_000,
  max_pages: 1,
  max_frames: 1,
  max_channels: 4
});

const HANDLE_PATTERN = /^image-artifact:sha256:([0-9a-f]{64})$/;
const SHA256_PATTERN = /^sha256:([0-9a-f]{64})$/;
const PUBLICATION_LINK_RETRY_LIMIT = 50;
const PUBLICATION_LINK_RETRY_DELAY_MS = 1;
const FORMAT_TO_MEDIA_TYPE = Object.freeze({
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  tiff: 'image/tiff'
});
const RECORD_FIELDS = new Set([
  'version',
  'kind',
  'content_trust',
  'policy_effect',
  'handle',
  'sha256',
  'media_type',
  'format',
  'size_bytes',
  'width',
  'height',
  'channels',
  'pages',
  'frames',
  'total_pixels',
  'created_at',
  'record_integrity_sha256'
]);

/**
 * Content-addressed storage for server-owned image inputs and captures.
 *
 * Public records contain no source or CAS path. A handle is deterministic for
 * the exact compressed bytes, so repeated registration is idempotent across
 * tasks and process restarts. Artifact content is still untrusted data.
 */
export class ImmutableImageArtifactStore {
  constructor({
    rootDir = path.join(defaultStateDir, 'image-artifacts-v1'),
    allowedRoots = [],
    limits = {}
  } = {}) {
    this.rootDir = path.resolve(rootDir);
    this.allowedRoots = [...new Set((allowedRoots || []).map((value) => path.resolve(String(value))))];
    this.limits = normalizeLimits(limits);
    this.layoutPromise = null;
    this.storageRoot = null;
  }

  async ingest({ filePath, path: inputPath, buffer, base64, mediaType, media_type } = {}) {
    const requestedPath = filePath ?? inputPath;
    const supplied = [requestedPath !== undefined, buffer !== undefined, base64 !== undefined].filter(Boolean).length;
    if (supplied !== 1) {
      throw new AgentContractError('INVALID_ARGUMENT', 'Image ingest requires exactly one of filePath, buffer, or base64.');
    }
    const mediaTypeHint = mediaType ?? media_type;
    if (requestedPath !== undefined) return this.ingestPath(requestedPath, { mediaType: mediaTypeHint });
    if (base64 !== undefined) return this.ingestBase64(base64, { mediaType: mediaTypeHint });
    return this.ingestBuffer(buffer, { mediaType: mediaTypeHint });
  }

  async ingestPath(filePath, { mediaType } = {}) {
    const buffer = await readAllowedImagePath(filePath, this.allowedRoots, this.limits.max_bytes);
    return this.ingestBuffer(buffer, { mediaType });
  }

  async ingestBase64(value, { mediaType } = {}) {
    const decoded = decodeBase64Image(value, this.limits.max_bytes);
    const hintedMediaType = normalizeMediaTypeHint(mediaType ?? decoded.mediaType);
    if (mediaType && decoded.mediaType && normalizeMediaTypeHint(mediaType) !== normalizeMediaTypeHint(decoded.mediaType)) {
      throw new AgentContractError('INVALID_ARGUMENT', 'The data URL media type does not match the supplied image media type.');
    }
    return this.ingestBuffer(decoded.buffer, { mediaType: hintedMediaType });
  }

  async ingestBuffer(value, { mediaType } = {}) {
    const buffer = immutableBuffer(value);
    const analysis = await analyzeImageBuffer(buffer, this.limits);
    const mediaTypeHint = normalizeMediaTypeHint(mediaType);
    if (mediaTypeHint && mediaTypeHint !== analysis.media_type) {
      throw new AgentContractError('INVALID_ARGUMENT', 'The supplied image media type does not match the decoded image.');
    }

    await this.ensureLayout();
    const digest = sha256Hex(buffer);
    const sha256 = `sha256:${digest}`;
    const handle = `image-artifact:sha256:${digest}`;
    const blobPath = this.blobPath(digest);
    const recordPath = this.recordPath(digest);
    await ensurePrivateDirectory(path.dirname(blobPath), this.storageRoot);
    await ensurePrivateDirectory(path.dirname(recordPath), this.storageRoot);

    await publishImmutableFile(blobPath, buffer, {
      rootDir: this.storageRoot,
      validateExisting: (existing) => assertBlobIntegrity(existing, digest, analysis.size_bytes)
    });

    const core = {
      version: IMMUTABLE_IMAGE_ARTIFACT_VERSION,
      kind: 'immutable_image_artifact',
      content_trust: 'untrusted_data',
      policy_effect: 'none',
      handle,
      sha256,
      media_type: analysis.media_type,
      format: analysis.format,
      size_bytes: analysis.size_bytes,
      width: analysis.width,
      height: analysis.height,
      channels: analysis.channels,
      pages: analysis.pages,
      frames: analysis.frames,
      total_pixels: analysis.total_pixels,
      created_at: new Date().toISOString()
    };
    const candidateRecord = {
      ...core,
      record_integrity_sha256: sha256Canonical(core)
    };
    let publishedRecord = candidateRecord;
    const recordPublish = await publishImmutableFile(recordPath, recordBuffer(candidateRecord), {
      rootDir: this.storageRoot,
      validateExisting: (existing) => {
        const record = parseAndValidateRecord(existing, digest);
        assertRecordMatchesAnalysis(record, analysis);
        publishedRecord = record;
      }
    });

    const resolved = await this.resolve(handle);
    assertRecordMatchesAnalysis(resolved.record, analysis);
    return {
      record: structuredClone(resolved.record),
      reused: recordPublish.reused,
      cas_reused: recordPublish.reused || publishedRecord.created_at !== candidateRecord.created_at
    };
  }

  async resolve(handle) {
    await this.ensureLayout();
    const digest = digestForHandle(handle);
    const recordPath = this.recordPath(digest);
    const blobPath = this.blobPath(digest);
    const recordBytes = await readPrivateRegularFile(recordPath, {
      rootDir: this.storageRoot,
      missingCode: 'ARTIFACT_NOT_FOUND',
      maxBytes: 1024 * 1024,
      missingMessage: 'The immutable image artifact is not registered.'
    });
    const record = parseAndValidateRecord(recordBytes, digest);
    const buffer = await readPrivateRegularFile(blobPath, {
      rootDir: this.storageRoot,
      missingCode: 'ARTIFACT_INTEGRITY_ERROR',
      maxBytes: this.limits.max_bytes,
      missingMessage: 'The immutable image artifact content is missing.'
    });
    assertBlobIntegrity(buffer, digest, record.size_bytes);
    return { record: structuredClone(record), buffer };
  }

  async readBuffer(handle) {
    const resolved = await this.resolve(handle);
    return Buffer.from(resolved.buffer);
  }

  async inspect(handle) {
    const resolved = await this.resolve(handle);
    return structuredClone(resolved.record);
  }

  async ensureLayout() {
    this.layoutPromise ||= (async () => {
      await fs.mkdir(this.rootDir, { recursive: true, mode: 0o700 });
      const rootStat = await fs.lstat(this.rootDir);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        throw integrityError('The immutable image artifact root must be a real directory.');
      }
      await fs.chmod(this.rootDir, 0o700);
      this.storageRoot = await fs.realpath(this.rootDir);
      await ensurePrivateDirectory(path.join(this.storageRoot, 'cas', 'sha256'), this.storageRoot);
      await ensurePrivateDirectory(path.join(this.storageRoot, 'records', 'sha256'), this.storageRoot);
    })();
    return this.layoutPromise;
  }

  blobPath(digest) {
    assertDigest(digest);
    const root = this.storageRoot || this.rootDir;
    const candidate = path.join(root, 'cas', 'sha256', digest.slice(0, 2), `${digest}.blob`);
    assertLexicallyWithin(candidate, root);
    return candidate;
  }

  recordPath(digest) {
    assertDigest(digest);
    const root = this.storageRoot || this.rootDir;
    const candidate = path.join(root, 'records', 'sha256', digest.slice(0, 2), `${digest}.json`);
    assertLexicallyWithin(candidate, root);
    return candidate;
  }
}

async function analyzeImageBuffer(buffer, limits) {
  if (buffer.length === 0) throw new AgentContractError('INVALID_ARGUMENT', 'The image artifact is empty.');
  if (buffer.length > limits.max_bytes) {
    throw policyError('The compressed image artifact exceeds the configured byte limit.', {
      actual_bytes: buffer.length,
      maximum_bytes: limits.max_bytes
    });
  }

  let metadata;
  try {
    metadata = await sharp(buffer, {
      failOn: 'error',
      limitInputPixels: limits.max_total_pixels,
      sequentialRead: true
    }).metadata();
  } catch (error) {
    if (/pixel limit/i.test(String(error?.message || ''))) {
      throw policyError('The image artifact exceeds the configured pixel limit.', {
        maximum_pixels: limits.max_total_pixels
      });
    }
    throw new AgentContractError('INVALID_ARGUMENT', 'The image artifact could not be decoded safely.');
  }

  const format = String(metadata.format || '').toLowerCase();
  const mediaType = FORMAT_TO_MEDIA_TYPE[format];
  if (!mediaType) {
    throw new AgentContractError('INVALID_ARGUMENT', 'The image artifact format is not supported.');
  }
  const width = positiveMetadataInteger(metadata.width, 'width');
  const height = positiveMetadataInteger(metadata.height, 'height');
  const channels = positiveMetadataInteger(metadata.channels, 'channels');
  const pages = positiveMetadataInteger(metadata.pages ?? 1, 'pages');
  const frames = Math.max(pages, Array.isArray(metadata.delay) ? metadata.delay.length : 1);
  const totalPixels = width * height * pages;

  if (width > limits.max_width || height > limits.max_height) {
    throw policyError('The image dimensions exceed the configured limit.', {
      width,
      height,
      maximum_width: limits.max_width,
      maximum_height: limits.max_height
    });
  }
  if (!Number.isSafeInteger(totalPixels) || totalPixels > limits.max_total_pixels) {
    throw policyError('The image artifact exceeds the configured total-pixel limit.', {
      actual_pixels: Number.isSafeInteger(totalPixels) ? totalPixels : null,
      maximum_pixels: limits.max_total_pixels
    });
  }
  if (pages > limits.max_pages || frames > limits.max_frames) {
    throw policyError('Multi-page or animated image artifacts exceed the configured frame limit.', {
      pages,
      frames,
      maximum_pages: limits.max_pages,
      maximum_frames: limits.max_frames
    });
  }
  if (channels > limits.max_channels) {
    throw policyError('The image artifact channel count exceeds the configured limit.', {
      channels,
      maximum_channels: limits.max_channels
    });
  }

  try {
    // stats() forces a real decode without materializing a second full-frame JS
    // buffer. The exact immutable compressed Buffer is reused for metadata,
    // decode validation, hashing, and CAS publication.
    await sharp(buffer, {
      failOn: 'error',
      limitInputPixels: limits.max_total_pixels,
      sequentialRead: true
    }).stats();
  } catch (error) {
    if (/pixel limit/i.test(String(error?.message || ''))) {
      throw policyError('The image artifact exceeds the configured pixel limit.', {
        maximum_pixels: limits.max_total_pixels
      });
    }
    throw new AgentContractError('INVALID_ARGUMENT', 'The image artifact failed full decode validation.');
  }

  return {
    media_type: mediaType,
    format,
    size_bytes: buffer.length,
    width,
    height,
    channels,
    pages,
    frames,
    total_pixels: totalPixels
  };
}

async function readAllowedImagePath(value, allowedRoots, maxBytes) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AgentContractError('INVALID_ARGUMENT', 'Image artifact path must be a non-empty string.');
  }
  if (!allowedRoots.length) {
    throw policyError('No image artifact input roots are configured.');
  }

  const roots = [];
  for (const root of allowedRoots) {
    try {
      roots.push(await fs.realpath(root));
    } catch {
      throw policyError('A configured image artifact root is unavailable.');
    }
  }

  let canonical;
  try {
    canonical = await fs.realpath(path.resolve(value));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new AgentContractError('ARTIFACT_NOT_FOUND', 'The image artifact does not exist.');
    }
    throw policyError('The image artifact path cannot be accessed safely.');
  }
  if (!roots.some((root) => isWithin(canonical, root))) {
    throw policyError('The image artifact is outside the configured input roots.');
  }

  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0);
  let fileHandle;
  try {
    fileHandle = await fs.open(canonical, flags);
    const before = await fileHandle.stat();
    if (!before.isFile()) throw new AgentContractError('INVALID_ARGUMENT', 'The image artifact must be a regular file.');
    if (before.size > maxBytes) {
      throw policyError('The compressed image artifact exceeds the configured byte limit.', {
        actual_bytes: before.size,
        maximum_bytes: maxBytes
      });
    }
    const buffer = await fileHandle.readFile();
    const after = await fileHandle.stat();
    if (!sameFileSnapshot(before, after) || buffer.length !== after.size) {
      throw policyError('The image artifact changed during its secure read.');
    }

    const canonicalAfter = await fs.realpath(path.resolve(value));
    const afterPathStat = await fs.stat(canonicalAfter);
    if (canonicalAfter !== canonical
      || !roots.some((root) => isWithin(canonicalAfter, root))
      || !sameFileIdentity(after, afterPathStat)) {
      throw policyError('The image artifact path changed during its secure read.');
    }
    return Buffer.from(buffer);
  } catch (error) {
    if (error instanceof AgentContractError) throw error;
    if (error?.code === 'ENOENT') throw new AgentContractError('ARTIFACT_NOT_FOUND', 'The image artifact does not exist.');
    throw policyError('The image artifact path cannot be read safely.');
  } finally {
    await fileHandle?.close();
  }
}

function decodeBase64Image(value, maxBytes) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AgentContractError('INVALID_ARGUMENT', 'Inline image base64 must be a non-empty string.');
  }
  let encoded = value.trim();
  let mediaType = null;
  const dataUrl = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(encoded);
  if (encoded.startsWith('data:')) {
    if (!dataUrl) throw new AgentContractError('INVALID_ARGUMENT', 'Inline image data URL must contain valid base64.');
    mediaType = dataUrl[1].toLowerCase();
    encoded = dataUrl[2];
  }
  if (!isCanonicalBase64(encoded)) {
    throw new AgentContractError('INVALID_ARGUMENT', 'Inline image content is not valid canonical base64.');
  }
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const estimatedBytes = Math.floor((encoded.length * 3) / 4) - padding;
  if (estimatedBytes > maxBytes) {
    throw policyError('The inline compressed image exceeds the configured byte limit.', {
      actual_bytes: estimatedBytes,
      maximum_bytes: maxBytes
    });
  }
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.length !== estimatedBytes
    || buffer.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
    throw new AgentContractError('INVALID_ARGUMENT', 'Inline image content is not valid canonical base64.');
  }
  return { buffer, mediaType };
}

function immutableBuffer(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new AgentContractError('INVALID_ARGUMENT', 'Inline image buffer must be a Buffer or Uint8Array.');
  }
  return Buffer.from(value);
}

function normalizeMediaTypeHint(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'image/jpg') return 'image/jpeg';
  if (!Object.values(FORMAT_TO_MEDIA_TYPE).includes(normalized)) {
    throw new AgentContractError('INVALID_ARGUMENT', 'The supplied image media type is not supported.');
  }
  return normalized;
}

function normalizeLimits(value) {
  const aliases = {
    maxBytes: 'max_bytes',
    maxWidth: 'max_width',
    maxHeight: 'max_height',
    maxTotalPixels: 'max_total_pixels',
    maxPages: 'max_pages',
    maxFrames: 'max_frames',
    maxChannels: 'max_channels'
  };
  const requested = { ...value };
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (requested[canonical] === undefined && requested[alias] !== undefined) requested[canonical] = requested[alias];
  }
  const result = {};
  for (const [name, fallback] of Object.entries(DEFAULT_IMAGE_ARTIFACT_LIMITS)) {
    const parsed = requested[name] === undefined ? fallback : Number(requested[name]);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new AgentContractError('INVALID_ARGUMENT', `Image artifact limit ${name} must be a positive integer.`);
    }
    result[name] = parsed;
  }
  return Object.freeze(result);
}

async function publishImmutableFile(filePath, bytes, { rootDir, validateExisting }) {
  const existing = await readPrivateRegularFile(filePath, {
    rootDir,
    missingCode: null,
    maxBytes: Math.max(bytes.length, 1024 * 1024)
  });
  if (existing) {
    validateExisting(existing);
    return { reused: true };
  }

  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle;
  let temporaryExists = false;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    temporaryExists = true;
    await handle.writeFile(bytes);
    await handle.chmod(0o600);
    await handle.sync();
    await handle.close();
    handle = null;

    let reused = false;
    try {
      await fs.link(temporary, filePath);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      reused = true;
    }
    await fs.unlink(temporary);
    temporaryExists = false;
    // Persist both the public link (when newly published) and temporary-link
    // removal (including EEXIST/reuse) before reporting a durable outcome.
    await syncDirectory(path.dirname(filePath));
    const published = await readPrivateRegularFile(filePath, {
      rootDir,
      missingCode: 'ARTIFACT_INTEGRITY_ERROR',
      maxBytes: Math.max(bytes.length, 1024 * 1024),
      missingMessage: 'The immutable artifact publication was not durable.'
    });
    validateExisting(published);
    return { reused };
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (temporaryExists) await fs.rm(temporary, { force: true });
  }
}

async function readPrivateRegularFile(filePath, { rootDir, missingCode, maxBytes, missingMessage } = {}) {
  for (let attempt = 0; attempt <= PUBLICATION_LINK_RETRY_LIMIT; attempt += 1) {
    let canonical;
    try {
      canonical = await fs.realpath(filePath);
    } catch (error) {
      if (error?.code === 'ENOENT' && missingCode === null) return null;
      if (error?.code === 'ENOENT') {
        throw new AgentContractError(missingCode || 'ARTIFACT_NOT_FOUND', missingMessage || 'The immutable artifact does not exist.');
      }
      throw integrityError('The immutable artifact path cannot be resolved safely.');
    }
    if (canonical !== path.resolve(filePath) || !isWithin(canonical, rootDir)) {
      throw integrityError('The immutable artifact path escaped its private store.');
    }

    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0);
    let fileHandle;
    try {
      const linkStat = await fs.lstat(filePath);
      if (linkStat.isSymbolicLink() || !linkStat.isFile()) throw integrityError('The immutable artifact is not a private regular file.');
      if (linkStat.nlink !== 1) {
        if (linkStat.nlink > 1 && attempt < PUBLICATION_LINK_RETRY_LIMIT) {
          await waitForPublicationLink();
          continue;
        }
        throw integrityError('The immutable artifact has an unsafe hard-link count.');
      }
      fileHandle = await fs.open(filePath, flags);
      const before = await fileHandle.stat();
      if (!before.isFile()) throw integrityError('The immutable artifact is not a regular file.');
      if (before.nlink !== 1) {
        if (before.nlink > 1 && attempt < PUBLICATION_LINK_RETRY_LIMIT) {
          await waitForPublicationLink();
          continue;
        }
        throw integrityError('The immutable artifact has an unsafe hard-link count.');
      }
      if (Number.isFinite(maxBytes) && before.size > maxBytes) throw integrityError('The immutable artifact exceeds its stored size boundary.');
      const buffer = await fileHandle.readFile();
      const after = await fileHandle.stat();
      if (!sameFileSnapshot(before, after) || after.nlink !== 1 || buffer.length !== after.size) {
        throw integrityError('The immutable artifact changed while it was being verified.');
      }
      const canonicalAfter = await fs.realpath(filePath);
      const pathStat = await fs.stat(canonicalAfter);
      if (canonicalAfter !== canonical || pathStat.nlink !== 1 || !sameFileIdentity(after, pathStat)) {
        throw integrityError('The immutable artifact path changed while it was being verified.');
      }
      return buffer;
    } catch (error) {
      if (error instanceof AgentContractError) throw error;
      throw integrityError('The immutable artifact could not be read safely.');
    } finally {
      await fileHandle?.close();
    }
  }
  throw integrityError('The immutable artifact publication did not settle safely.');
}

async function ensurePrivateDirectory(directory, rootDir) {
  assertLexicallyWithin(directory, rootDir);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw integrityError('The immutable artifact store contains an unsafe directory.');
  const canonical = await fs.realpath(directory);
  if (canonical !== path.resolve(directory) || !isWithin(canonical, rootDir)) {
    throw integrityError('The immutable artifact directory escaped its private store.');
  }
  await fs.chmod(directory, 0o700);
}

function parseAndValidateRecord(bytes, digest) {
  let record;
  try {
    record = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw integrityError('The immutable image artifact record is not valid JSON.');
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || Object.keys(record).some((key) => !RECORD_FIELDS.has(key))
    || Object.keys(record).length !== RECORD_FIELDS.size
    || record.version !== IMMUTABLE_IMAGE_ARTIFACT_VERSION
    || record.kind !== 'immutable_image_artifact'
    || record.content_trust !== 'untrusted_data'
    || record.policy_effect !== 'none'
    || record.handle !== `image-artifact:sha256:${digest}`
    || record.sha256 !== `sha256:${digest}`
    || !Object.values(FORMAT_TO_MEDIA_TYPE).includes(record.media_type)
    || FORMAT_TO_MEDIA_TYPE[record.format] !== record.media_type
    || !positiveRecordInteger(record.size_bytes)
    || !positiveRecordInteger(record.width)
    || !positiveRecordInteger(record.height)
    || !positiveRecordInteger(record.channels)
    || !positiveRecordInteger(record.pages)
    || !positiveRecordInteger(record.frames)
    || !positiveRecordInteger(record.total_pixels)
    || !Number.isFinite(Date.parse(record.created_at))
    || !SHA256_PATTERN.test(String(record.record_integrity_sha256 || ''))) {
    throw integrityError('The immutable image artifact record is structurally invalid.');
  }
  const core = { ...record };
  delete core.record_integrity_sha256;
  if (sha256Canonical(core) !== record.record_integrity_sha256) {
    throw integrityError('The immutable image artifact record failed its integrity check.');
  }
  return record;
}

function assertRecordMatchesAnalysis(record, analysis) {
  const expected = {
    media_type: analysis.media_type,
    format: analysis.format,
    size_bytes: analysis.size_bytes,
    width: analysis.width,
    height: analysis.height,
    channels: analysis.channels,
    pages: analysis.pages,
    frames: analysis.frames,
    total_pixels: analysis.total_pixels
  };
  for (const [key, value] of Object.entries(expected)) {
    if (record[key] !== value) throw integrityError('The immutable image artifact metadata does not match its content.');
  }
}

function assertBlobIntegrity(buffer, digest, expectedBytes) {
  if (buffer.length !== expectedBytes || sha256Hex(buffer) !== digest) {
    throw integrityError('The immutable image artifact content failed its hash check.');
  }
}

function recordBuffer(record) {
  return Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

function digestForHandle(handle) {
  const match = HANDLE_PATTERN.exec(String(handle || ''));
  if (!match) throw new AgentContractError('ARTIFACT_NOT_FOUND', 'The immutable image artifact handle is invalid.');
  return match[1];
}

function assertDigest(value) {
  if (!/^[0-9a-f]{64}$/.test(String(value || ''))) throw new AgentContractError('ARTIFACT_NOT_FOUND', 'The immutable image artifact digest is invalid.');
}

function assertLexicallyWithin(candidate, root) {
  if (!isWithin(path.resolve(candidate), path.resolve(root))) throw integrityError('The immutable image artifact path escaped its private store.');
}

function isWithin(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function sameFileSnapshot(left, right) {
  return sameFileIdentity(left, right)
    && left.size === right.size
    && left.nlink === right.nlink
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function sameFileIdentity(left, right) {
  return String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino);
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function positiveMetadataInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new AgentContractError('INVALID_ARGUMENT', `Decoded image ${field} is invalid.`);
  }
  return number;
}

function positiveRecordInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isCanonicalBase64(value) {
  if (value === '') return false;
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

function policyError(message, details) {
  return new AgentContractError('POLICY_DENIED', message, details ? { details } : undefined);
}

function integrityError(message) {
  return new AgentContractError('ARTIFACT_INTEGRITY_ERROR', message, {
    details: { resource: 'immutable_image_artifact_store' }
  });
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EPERM', 'EISDIR'].includes(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
}

async function waitForPublicationLink() {
  await new Promise((resolve) => setTimeout(resolve, PUBLICATION_LINK_RETRY_DELAY_MS));
}
