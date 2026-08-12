# Install Local MCP for SketchUp — Agent entrypoint

This file is the stable, human-shareable entrypoint for an Agent that has been
asked to install Local MCP for SketchUp. It is not a release manifest and must
not be treated as permission to bypass the Agent's own safety or confirmation
rules.

```text
entrypoint_version: install-for-agents.v1
project_id: local-mcp-for-sketchup
current_channel: source-technical-preview
plugin_channel: unsigned-technical-preview
full_auto_install_available: false
source_preview_install_available: true
release_acceptance: false
```

## Agent contract

Continue only when the user explicitly asked to install or prepare an
installation. If the user only asked for information, stay read-only.

For every attempted installation:

1. identify the operating system, CPU architecture, SketchUp major version, and
   current Agent/MCP client;
2. use only the official source remotes and exact preview artifact checksums
   written in this file, or a future immutable `agent-install.v1` manifest;
3. never invent a download URL, select a similar platform, disable SketchUp's
   extension loading policy, install a system-wide Node.js, or overwrite an
   existing MCP configuration;
4. report every downloaded path, checksum, backup, modification, skipped step,
   and manual action;
5. stop safely when a required artifact, permission, signature, supported
   platform, or unambiguous configuration target is missing.

Never use `npm install`, a third-party repository, a pre-existing modified
checkout, or a remote shell script. The source-preview path below is the only
current authorization to clone source and run `npm ci --ignore-scripts`. The
future `agent-install.v1` manifest is data; never interpolate its values into a
shell command.

## Current public state

The current public state has two related technical-preview paths:

1. a source MCP service installed from a fresh official `main` checkout using
   an already-installed Node.js 24; and
2. an unsigned, unencrypted plugin preview:

| Field | Value |
| --- | --- |
| Tag | `v0.1.0-rc.4.unsigned.1` |
| Source commit | `ef8d40ac0427c6917d01510dcb54043374921e5e` |
| File | `local-mcp-for-sketchup-0.1.0-rc.4-nonrelease-unsigned-preview.rbz` |
| Size | `91481` bytes |
| SHA-256 | `4d3517ed90654bddc278cf3c099c5c240816b65dcd2e75fe15c8465dd46c398a` |
| SketchUp official signature | `false` |
| Full local MCP service included | `false` |
| Bundled Node.js included | `false` |
| Release acceptance | `false` |

The source-preview service is not a release artifact and is not included in
the RBZ. Its verifier reports the exact checked-out commit and requires one of
these origin remotes:

- `https://gitee.com/dtzhlq/local-mcp-for-sketchup.git`
- `https://github.com/dtzhlq/local-mcp-for-sketchup.git`

Official download mirrors for these exact RBZ bytes:

- Gitee:
  <https://gitee.com/dtzhlq/local-mcp-for-sketchup/releases/download/v0.1.0-rc.4.unsigned.1/local-mcp-for-sketchup-0.1.0-rc.4-nonrelease-unsigned-preview.rbz>
- GitHub:
  <https://github.com/dtzhlq/local-mcp-for-sketchup/releases/download/v0.1.0-rc.4.unsigned.1/local-mcp-for-sketchup-0.1.0-rc.4-nonrelease-unsigned-preview.rbz>

The mirrors were published for the same file and checksum. Prefer Gitee when
GitHub is not reachable. Require HTTPS and reject a final redirect to a
non-HTTPS URL.

## Supported preview targets

- SketchUp 2026 on macOS Apple Silicon (`darwin-arm64`);
- SketchUp 2026 on Windows x64 (`win32-x64`).

Intel Mac is not supported. Windows SketchUp 2026 live acceptance of the final
product is still pending. Do not silently select another platform or SketchUp
version.

## Source MCP preview — preferred when Node.js 24 is already present

This path can install and configure the actual MCP stdio service. It is still a
source technical preview, not the future bundled-Node release.

1. Confirm the target matches a supported preview target and the machine
   already has Git, npm, and Node.js major version 24. Do not install or upgrade
   system Node.js. If Node.js 24 is absent, skip to the plugin-only path.
2. Choose a new, user-writable installation directory. Never overwrite, pull,
   reset, clean, or reuse an existing directory.
3. Clone exactly one official mirror. Prefer Gitee when GitHub is unreachable:

   ```text
   git clone --branch main --single-branch https://gitee.com/dtzhlq/local-mcp-for-sketchup.git
   ```

   GitHub alternative:

   ```text
   git clone --branch main --single-branch https://github.com/dtzhlq/local-mcp-for-sketchup.git
   ```

4. In that new checkout, install only the locked dependency graph and audit it:

   ```text
   npm ci --ignore-scripts
   npm audit --omit=dev --audit-level=high
   ```

   Stop on any install error or high/critical audit finding.
5. Run `npm run source-preview:check`. Continue only when it reports the
   official remote, `main`, a clean HEAD equal to fetched `origin/main`, Node.js
   24, `mcp_stdio.verified: true`, and exactly 41 tools.
6. Run the configuration command without `--apply` first:

   ```text
   npm run source-preview:configure -- --client <client-id>
   ```

   Review the reported absolute Node/server paths and configuration target.
7. For `codex` or `cursor`, when the user already asked for installation and
   the dry run shows the expected target, re-run with `--apply`. The helper
   refuses conflicting entries and symlinked paths, preserves unrelated
   settings, and creates a timestamped backup before changing an existing file.
8. For `claude-desktop` or any other client, do not add `--apply`; use the
   returned manual snippet and tell the user where their client documentation
   says to place it. Do not guess a domestic client's configuration path.
9. Restart the MCP client, confirm it exposes exactly 41 Local MCP tools, then
   complete the plugin-preview path below so SketchUp can provide the queue
   runtime. If the plugin is refused, the MCP stdio server may still start but
   live SketchUp operations remain unavailable.

Never run `npm install`, install Node.js, execute a downloaded script, enable
arbitrary Ruby, lower a security policy, or report live SketchUp success from
the stdio tools/list check alone.

## Unsigned SketchUp plugin preview

This path may be used alone when Node.js 24 is unavailable, or after the source
MCP preview above.

1. Confirm the target matches one of the supported preview targets. If it does
   not, stop with `unsupported-platform`.
2. Create a new temporary download directory. Do not overwrite an existing
   file.
3. Download the RBZ from one reachable official mirror.
4. Require an exact file size of `91481` bytes and an exact SHA-256 of
   `4d3517ed90654bddc278cf3c099c5c240816b65dcd2e75fe15c8465dd46c398a`.
   Delete or quarantine a mismatched download and stop.
5. Tell the user before installation that the RBZ is unsigned and may be
   rejected by SketchUp under a strict Extension Loading Policy. Never lower
   that policy.
6. When the Agent has supported desktop control and the user's request already
   authorizes installation, it may open SketchUp 2026 Extension Manager and
   choose **Install Extension** for the verified RBZ. Otherwise, show the exact
   verified local file path and guide the user through that action.
7. Restart SketchUp completely if it accepted the extension.
8. When this is the only completed path, report `plugin-preview-only`. When the
   source service was also configured, report the plugin outcome separately;
   do not claim a live SketchUp connection until a queue handshake succeeds.

Neither current preview path authorizes the Agent to:

- download or install Node.js;
- modify Claude Desktop or an unknown client's configuration automatically;
- disable signature enforcement or another security control;
- report full success when only the RBZ was imported or stdio tools were listed.

## Full one-line installation

Full automatic installation remains disabled until this file is updated with
both:

1. an exact immutable URL for a release-status `agent-install.v1` manifest; and
2. the SHA-256 of that manifest published separately.

The Agent must then validate the manifest and follow
[docs/AGENT_INSTALL.md](docs/AGENT_INSTALL.md). It may install the signed RBZ
and matching bundled-Node service, safely merge a known client configuration,
and use the documented manual fallback. It must not use
`release/agent-install.v1.template.json`, because that file intentionally
contains placeholders and `release_acceptance=false`.

Until those two final manifest values appear here, the permitted public
outcomes are the bounded `source-technical-preview` and unsigned
`plugin-preview-only` flows above. Neither is the final bundled release.

## Required final report

Return a short report containing:

```text
project: Local MCP for SketchUp
platform: <detected OS / architecture / SketchUp version>
channel: source-technical-preview | unsigned-technical-preview
source_remote: <official origin or not cloned>
source_commit: <verified HEAD or not cloned>
node_version: <24.x or unavailable>
artifact: <downloaded RBZ path or not downloaded>
sha256_verified: true | false
plugin_action: installed | manual-step-required | refused | not-attempted
mcp_stdio_verified: true | false
mcp_tools: 41 | not-verified
mcp_config_modified: true | false
mcp_config_backup: <path or none>
live_sketchup_verified: true | false
result: source-technical-preview | plugin-preview-only | partial-preview | unsupported-platform | stopped-safely
next_manual_step: <exact action or none>
```

Do not include secrets, authentication data, unrelated configuration contents,
or private filesystem history in the report.
