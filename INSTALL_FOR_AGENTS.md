# Install Local MCP for SketchUp — Agent entrypoint

This file is the stable, human-shareable entrypoint for an Agent that has been
asked to install Local MCP for SketchUp. It is not a release manifest and must
not be treated as permission to bypass the Agent's own safety or confirmation
rules.

```text
entrypoint_version: install-for-agents.v1
project_id: local-mcp-for-sketchup
current_channel: unsigned-technical-preview
full_auto_install_available: false
release_acceptance: false
```

## Agent contract

Continue only when the user explicitly asked to install or prepare an
installation. If the user only asked for information, stay read-only.

For every attempted installation:

1. identify the operating system, CPU architecture, SketchUp major version, and
   current Agent/MCP client;
2. use only the exact artifacts and checksums written in this file or in a
   future immutable `agent-install.v1` release manifest;
3. never invent a download URL, select a similar platform, disable SketchUp's
   extension loading policy, install a system-wide Node.js, or overwrite an
   existing MCP configuration;
4. report every downloaded path, checksum, backup, modification, skipped step,
   and manual action;
5. stop safely when a required artifact, permission, signature, supported
   platform, or unambiguous configuration target is missing.

Do not use `npm install`, clone the source repository, or execute a remote
script as a substitute for missing release artifacts. The future
`agent-install.v1` manifest is data; never interpolate its values into a shell
command.

## Current public state

The current public release is an unsigned, unencrypted plugin-only technical
preview:

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

## What the Agent may do now

The current safe outcome is `plugin-preview-only`.

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
8. Report the result as `plugin-preview-only`. Do not claim that the MCP server
   is installed or connected.

The current preview does **not** authorize the Agent to:

- modify Codex, Claude Desktop, Cursor, or another MCP client configuration;
- download or install Node.js;
- build or install the MCP service from a source checkout;
- disable signature enforcement or another security control;
- report full success when only the RBZ was downloaded or imported.

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

Until those two final manifest values appear here, the only permitted public
installation outcome is the unsigned `plugin-preview-only` flow above.

## Required final report

Return a short report containing:

```text
project: Local MCP for SketchUp
platform: <detected OS / architecture / SketchUp version>
channel: unsigned-technical-preview
artifact: <downloaded RBZ path or not downloaded>
sha256_verified: true | false
plugin_action: installed | manual-step-required | refused | not-attempted
mcp_service_installed: false
mcp_config_modified: false
result: plugin-preview-only | unsupported-platform | stopped-safely
next_manual_step: <exact action or none>
```

Do not include secrets, authentication data, unrelated configuration contents,
or private filesystem history in the report.
