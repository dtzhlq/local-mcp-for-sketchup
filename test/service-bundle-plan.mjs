import assert from 'node:assert/strict';
import path from 'node:path';
import {
  planServiceBundle,
  serviceBundleRuntimeDirectories,
  serviceBundleTargets
} from '../scripts/package-service-bundle.mjs';

assert.deepEqual(Object.keys(serviceBundleTargets).sort(), ['darwin-arm64', 'win32-x64']);
assert.equal(serviceBundleTargets['darwin-arm64'].nodeExecutable, 'node/bin/node');
assert.equal(serviceBundleTargets['win32-x64'].nodeExecutable, 'node/node.exe');
assert.ok(serviceBundleRuntimeDirectories.includes('sketchup_plugin'), 'runtime attestation source must ship with the service');
assert.equal(Object.values(serviceBundleTargets).some((item) => item.arch === 'x64' && item.os === 'darwin'), false);

const planned = planServiceBundle({
  targetId: 'darwin-arm64',
  version: '0.1.0-rc.4',
  outputDir: '/opt/local-mcp-test-output',
  artifactLabel: 'local-review'
});
assert.equal(planned.fileName, 'nonrelease-local-review-local-mcp-for-sketchup-0.1.0-rc.4-darwin-arm64.tar.gz');
assert.equal(planned.artifactPath, path.join('/opt/local-mcp-test-output', planned.fileName));
assert.throws(
  () => planServiceBundle({
    targetId: 'darwin-x64',
    version: '0.1.0-rc.4',
    outputDir: '/opt/local-mcp-test-output',
    artifactLabel: 'local-review'
  }),
  (error) => error?.code === 'SERVICE_BUNDLE_TARGET_UNSUPPORTED'
);
assert.throws(
  () => planServiceBundle({
    targetId: 'win32-x64',
    version: '0.1.0-rc.4',
    outputDir: '/opt/local-mcp-test-output',
    artifactLabel: '../release'
  }),
  (error) => error?.code === 'SERVICE_BUNDLE_LABEL_REQUIRED'
);

process.stdout.write(`${JSON.stringify({
  ok: true,
  targets: Object.keys(serviceBundleTargets),
  intel_mac_excluded: true,
  release_name_impersonation_blocked: true
}, null, 2)}\n`);
