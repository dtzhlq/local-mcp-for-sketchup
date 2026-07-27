#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { PRODUCT_VERSION } from '../src/version.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

export async function validateAgentInstallManifest(manifest, {
  requireRelease = false,
  schemaPath = path.join(repoRoot, 'schema', 'agent-install-v1.schema.json')
} = {}) {
  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    formats: { uri: true }
  });
  const validate = ajv.compile(schema);
  const schemaValid = validate(manifest);
  const errors = schemaValid
    ? []
    : (validate.errors || []).map((error) => `${error.instancePath || '/'} ${error.message}`);

  if (manifest?.product?.version !== PRODUCT_VERSION) {
    errors.push(`product.version must equal source version ${PRODUCT_VERSION}`);
  }
  if (requireRelease && manifest?.status !== 'release') {
    errors.push('manifest status must be release');
  }

  const platformIds = (manifest?.platforms || []).map((platform) => platform.id);
  if (new Set(platformIds).size !== platformIds.length) errors.push('platform ids must be unique');
  for (const expected of ['darwin-arm64-sketchup-2026', 'win32-x64-sketchup-2026']) {
    if (!platformIds.includes(expected)) errors.push(`missing required platform ${expected}`);
  }
  if (platformIds.some((id) => String(id).includes('darwin-x64'))) {
    errors.push('Intel macOS is outside the first-release scope');
  }
  const expectedPlatforms = {
    'darwin-arm64-sketchup-2026': {
      os: 'darwin',
      arch: 'arm64',
      node_url: 'https://nodejs.org/dist/v24.18.0/node-v24.18.0-darwin-arm64.tar.gz',
      node_sha256: 'e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1'
    },
    'win32-x64-sketchup-2026': {
      os: 'win32',
      arch: 'x64',
      node_url: 'https://nodejs.org/dist/v24.18.0/node-v24.18.0-win-x64.zip',
      node_sha256: '0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821'
    }
  };
  for (const platform of manifest?.platforms || []) {
    const expected = expectedPlatforms[platform.id];
    if (!expected) continue;
    if (platform.os !== expected.os || platform.arch !== expected.arch) {
      errors.push(`${platform.id} os/arch mapping is invalid`);
    }
    if (platform.bundled_node?.archive_url !== expected.node_url ||
        platform.bundled_node?.archive_sha256 !== expected.node_sha256) {
      errors.push(`${platform.id} bundled Node source is not the pinned upstream archive`);
    }
  }

  const clientIds = (manifest?.client_configuration?.known_clients || []).map((client) => client.id);
  if (new Set(clientIds).size !== clientIds.length) errors.push('known client ids must be unique');
  for (const expected of ['codex', 'claude-desktop', 'cursor']) {
    if (!clientIds.includes(expected)) errors.push(`missing known client ${expected}`);
  }
  if (manifest?.source?.tag !== `v${PRODUCT_VERSION}`) {
    errors.push(`source.tag must equal v${PRODUCT_VERSION}`);
  }

  const acceptanceIds = (manifest?.acceptance?.platforms || []).map((platform) => platform.id);
  if (new Set(acceptanceIds).size !== acceptanceIds.length) errors.push('acceptance platform ids must be unique');
  if (acceptanceIds.length > 0 &&
      acceptanceIds.slice().sort().join('\n') !== platformIds.slice().sort().join('\n')) {
    errors.push('acceptance platforms must exactly match artifact platforms');
  }

  if (manifest?.status === 'release') {
    for (const platform of manifest.platforms || []) {
      for (const [label, artifact] of Object.entries({
        service_bundle: platform.service_bundle,
        rbz: platform.rbz
      })) {
        if (artifact?.url?.includes('example.invalid')) {
          errors.push(`${platform.id}.${label}.url is still a placeholder`);
        }
        if (/^0{64}$/.test(artifact?.sha256 || '')) {
          errors.push(`${platform.id}.${label}.sha256 is still a placeholder`);
        }
      }
      if (/^0{64}$/.test(platform.service_bundle?.inventory_sha256 || '')) {
        errors.push(`${platform.id}.service_bundle.inventory_sha256 is still a placeholder`);
      }
      if (platform.rbz?.sketchup_officially_signed !== true) {
        errors.push(`${platform.id}.rbz must be returned by the SketchUp Signing Portal`);
      }
      if (platform.rbz?.encrypted !== false) {
        errors.push(`${platform.id}.rbz must remain unencrypted`);
      }
    }
    if (manifest.manifest_delivery?.immutable_url?.includes('example.invalid')) {
      errors.push('manifest immutable_url is still a placeholder');
    }
    if (manifest.source?.canonical_repository?.includes('example-owner') ||
        /^0{40}$/.test(manifest.source?.commit || '') ||
        /^0{64}$/.test(manifest.source?.public_tree_sha256 || '')) {
      errors.push('source repository, commit, and public tree hash must be final');
    }
    if (manifest.acceptance?.release_acceptance !== true) {
      errors.push('acceptance.release_acceptance must be true');
    }
    for (const field of [
      ['core_gate', manifest.acceptance?.core_gate],
      ...(manifest.acceptance?.platforms || []).map((item) => [`platform ${item.id}`, item.evidence])
    ]) {
      const [label, evidence] = field;
      if (evidence?.url?.includes('example.invalid') || /^0{64}$/.test(evidence?.sha256 || '')) {
        errors.push(`${label} evidence is still a placeholder`);
      }
    }
    for (const acceptance of manifest.acceptance?.platforms || []) {
      for (const booleanField of [
        'live_sketchup_2026',
        'signed_rbz_loaded',
        'save_close_reopen_verified',
        'offline_after_install_verified'
      ]) {
        if (acceptance[booleanField] !== true) {
          errors.push(`${acceptance.id}.${booleanField} must be true`);
        }
      }
    }

    const rbzBindings = (manifest.platforms || []).map((platform) => JSON.stringify({
      file_name: platform.rbz?.file_name,
      url: platform.rbz?.url,
      sha256: platform.rbz?.sha256,
      size_bytes: platform.rbz?.size_bytes
    }));
    if (new Set(rbzBindings).size > 1) {
      errors.push('all platform entries must bind the same signed RBZ bytes');
    }
  }

  return {
    ok: errors.length === 0,
    schema_valid: schemaValid,
    status: manifest?.status || null,
    release_required: requireRelease,
    version: manifest?.product?.version || null,
    platforms: platformIds,
    clients: clientIds,
    errors
  };
}

async function main() {
  const args = process.argv.slice(2);
  const requireRelease = args.includes('--require-release');
  const input = args.find((arg) => !arg.startsWith('--')) || 'release/agent-install.v1.template.json';
  const manifestPath = path.isAbsolute(input) ? input : path.join(repoRoot, input);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const report = await validateAgentInstallManifest(manifest, { requireRelease });
  process.stdout.write(`${JSON.stringify({ ...report, manifest: path.relative(repoRoot, manifestPath) }, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
