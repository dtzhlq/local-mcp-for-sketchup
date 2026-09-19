# 0.3.0 development candidate

This branch combines the 48-tool modeling uplift and CAD surface work. It is a source development candidate, not the signed 0.2.0 release. Native evidence applies to Apple Silicon Mac and SketchUp 2026. The code does not require Python or a cloud CAD service.

## Run from source

Use Node 24 and a separate checkout to preserve an existing installation:

```sh
git clone --branch codex/cad-surface-kernel https://github.com/dtzhlq/local-mcp-for-sketchup.git
cd local-mcp-for-sketchup
npm ci
npm run plugin:check
npm run plugin:package -- --artifact-label cad-source-preview
```

The packaging command reports the generated RBZ path. Preserve the previous installation and client configuration. Install the candidate RBZ through SketchUp Extension Manager, fully quit/restart SketchUp, then choose **Extensions → Alma SketchUp MCP → Start Bridge**. Avoid enabling both the historical `local_mcp_for_sketchup.rb` loader and the candidate `alma_sketchup_mcp.rb` loader simultaneously. The candidate RBZ has not inherited the old release's signature.

Configure the MCP client's stdio command with the absolute path to Node 24 and its args with the absolute path to `src/mcp-server.mjs` in this checkout. Keep existing permissions and review policy. For authorized queue work, the established environment settings are `ALMA_SKETCHUP_AGENT_ALLOWED_RUNTIMES=mock,queue` and `ALMA_SKETCHUP_AGENT_ALLOW_QUEUE_MUTATION=1`; these do not replace session and approval checks.

Before native work, check the loaded runtime:

```sh
node src/cli.mjs get_capabilities --runtime queue --timeout-ms 10000
```

Resolve compatibility errors before editing. Use a disposable model for development. The QA scripts are fixture-specific and must not be run against a user's working model.

## Local packaged candidate

The [CAD acceptance report](cad-surface-kernel/acceptance-report.json) identifies the paired service archive/RBZ and SHA-256 hashes. These files were generated locally under `out/cad-surface-kernel/`; they are not downloadable GitHub release assets. The service includes Node and CAD dependencies. Extract into a separate directory, then use absolute paths to `node/bin/node` and `app/src/mcp-server.mjs` under the extracted `local-mcp-for-sketchup/` directory. Update both service and plugin as a pair.

For a new local macOS ARM build:

```sh
node scripts/package-service-bundle.mjs --target darwin-arm64 --output-dir out/cad-surface-kernel --artifact-label cad-source-preview
```

Build outputs are local previews. Review [third-party notices](../THIRD_PARTY_NOTICES.md) before any separate binary distribution. No release assets are published by these commands.

## Verification and rollback

Read the [modeling evidence](modeling-uplift/implementation-status.md) and [CAD evidence](cad-surface-kernel/acceptance-report.json). Tracked reports summarize the checks; `output/` snapshots, SKPs and screenshots are local artifacts and are not checked into Git. Historical reports retain the state and intermediate package paths at the time of each test; use the final CAD report for the current package pair.

Rollback by restoring the prior client command/plugin, restarting SketchUp and reconnecting. Preserve model files and task receipts; do not reset models or delete task state to roll back software.
