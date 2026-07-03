import path from 'node:path';

export function toPortableAssetPath(value, repoRoot = process.cwd()) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || isUriLike(trimmed)) return trimmed;

  const resolvedRepoRoot = path.resolve(repoRoot);
  if (!path.isAbsolute(trimmed)) return normalizeSlash(path.normalize(trimmed));

  const relative = path.relative(resolvedRepoRoot, trimmed);
  if (isRepoRelative(relative)) return normalizeSlash(relative);
  return trimmed;
}

export function materializeDslAssetPaths(input, { repoRoot = process.cwd() } = {}) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const document = typeof input === 'string' ? JSON.parse(input) : cloneJson(input);
  if (!document || typeof document !== 'object') return input;

  for (const operation of document.operations || []) {
    materializeOperationAssetPaths(operation, resolvedRepoRoot);
  }

  return typeof input === 'string' ? `${JSON.stringify(document, null, 2)}\n` : document;
}

export function normalizeMaterialAssetPaths(material, repoRoot = process.cwd()) {
  const clone = cloneJson(material);
  if (!clone || typeof clone !== 'object') return clone;
  rewriteMaterialTexturePaths(clone, (value) => toPortableAssetPath(value, repoRoot));
  return clone;
}

function materializeOperationAssetPaths(operation, repoRoot) {
  if (!operation || typeof operation !== 'object') return;
  switch (operation.op) {
    case 'image_plane':
      rewritePathField(operation, 'image', repoRoot);
      rewritePathField(operation, 'texture', repoRoot);
      break;
    case 'image_reference':
      for (const key of ['path', 'file', 'filename', 'image']) rewritePathField(operation, key, repoRoot);
      break;
    case 'material':
      rewriteMaterialTexturePaths(operation, (value) => toAbsoluteAssetPath(value, repoRoot));
      break;
    default:
      break;
  }
}

function rewriteMaterialTexturePaths(material, transformPath) {
  if (!material || typeof material !== 'object') return;

  if (typeof material.texture === 'string') {
    material.texture = transformPath(material.texture);
  } else if (material.texture && typeof material.texture === 'object') {
    for (const key of ['path', 'file', 'filename']) {
      if (typeof material.texture[key] === 'string') material.texture[key] = transformPath(material.texture[key]);
    }
  }

  const textures = material.pbr?.textures;
  if (!textures || typeof textures !== 'object') return;
  for (const [key, value] of Object.entries(textures)) {
    if (typeof value === 'string') {
      textures[key] = transformPath(value);
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    for (const field of ['path', 'file', 'filename']) {
      if (typeof value[field] === 'string') value[field] = transformPath(value[field]);
    }
  }
}

function rewritePathField(object, key, repoRoot) {
  if (typeof object[key] !== 'string') return;
  object[key] = toAbsoluteAssetPath(object[key], repoRoot);
}

function toAbsoluteAssetPath(value, repoRoot) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || isUriLike(trimmed) || path.isAbsolute(trimmed)) return trimmed;
  return path.resolve(repoRoot, trimmed);
}

function isRepoRelative(value) {
  return value && value !== '.' && !value.startsWith('..') && !path.isAbsolute(value);
}

function isUriLike(value) {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);
}

function normalizeSlash(value) {
  return value.split(path.sep).join('/');
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}
