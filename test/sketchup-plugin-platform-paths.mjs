import assert from 'node:assert/strict';
import path from 'node:path';
import { defaultSketchUpPluginDir } from '../scripts/package-sketchup-plugin.mjs';

assert.equal(
  defaultSketchUpPluginDir({
    platform: 'darwin',
    homeDir: '/opt/local-mcp-test-home',
    sketchUpYear: 2026
  }),
  path.join('/opt/local-mcp-test-home', 'Library/Application Support/SketchUp 2026/SketchUp/Plugins')
);

assert.equal(
  defaultSketchUpPluginDir({
    platform: 'win32',
    appData: 'C:\\LocalMcpTest\\AppData\\Roaming',
    sketchUpYear: 2026
  }),
  path.join('C:\\LocalMcpTest\\AppData\\Roaming', 'SketchUp', 'SketchUp 2026', 'SketchUp', 'Plugins')
);

assert.throws(
  () => defaultSketchUpPluginDir({ platform: 'win32', appData: '' }),
  (error) => error?.code === 'SKETCHUP_APPDATA_REQUIRED'
);

assert.throws(
  () => defaultSketchUpPluginDir({ platform: 'linux' }),
  (error) => error?.code === 'SKETCHUP_PLATFORM_UNSUPPORTED'
);

process.stdout.write(`${JSON.stringify({ ok: true, platform_paths: 4 }, null, 2)}\n`);
