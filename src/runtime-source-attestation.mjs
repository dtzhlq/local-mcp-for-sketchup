import fs from 'node:fs';

const manifestUrl = new URL('../sketchup_plugin/local_mcp_for_sketchup/runtime_source_manifest.rb', import.meta.url);
const manifestSource = fs.readFileSync(manifestUrl, 'utf8');
const booleanHashMatch = manifestSource.match(/BOOLEAN_OPERATIONS_SHA256\s*=\s*'([0-9a-f]{64})'/);
const modelRevisionHashMatch = manifestSource.match(/MODEL_REVISION_SHA256\s*=\s*'([0-9a-f]{64})'/);

if (!booleanHashMatch || !modelRevisionHashMatch) {
  throw new Error('The tracked plugin runtime source manifest is missing a valid attested-source SHA-256.');
}

export const BOOLEAN_OPERATIONS_SHA256 = booleanHashMatch[1];
export const MODEL_REVISION_SOURCE_SHA256 = modelRevisionHashMatch[1];
