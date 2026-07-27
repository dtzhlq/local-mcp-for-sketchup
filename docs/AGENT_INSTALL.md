# Agent installation protocol (`agent-install.v1`)

Status: draft for `0.1.0-rc.4`. This protocol must not be advertised as
release-ready while its manifest contains placeholder URLs or hashes.

## Goal

An Agent receives one immutable manifest URL and the separately published
SHA-256 checksum of that manifest. It then:

1. downloads the fixed-version manifest;
2. verifies the manifest bytes before parsing;
3. validates `agent-install.v1` and selects an exact platform entry;
4. downloads and verifies the official signed RBZ and service bundle;
5. installs the service and, when allowed, the SketchUp extension;
6. safely merges one known MCP client configuration;
7. reports every path, checksum, backup, fallback, and manual step.

The manifest is data, not a remote script. Values from the manifest must never
be interpolated into a shell command.

The release manifest also binds the canonical GitHub repository, public commit,
clean-tree hash, 41-tool count, per-platform dependency inventory, and
artifact-specific acceptance evidence. Draft values intentionally fail the
release-only validator.

## Supported first-release targets

| Manifest target | SketchUp | Service runtime |
| --- | --- | --- |
| `darwin-arm64-sketchup-2026` | 2026 on Apple Silicon | bundled Node.js 24.18.0 arm64 |
| `win32-x64-sketchup-2026` | 2026 on Windows x64 | bundled Node.js 24.18.0 x64 |

Intel Mac is intentionally absent. An installer must stop with
`unsupported-platform` instead of selecting a similar-looking bundle.

## Artifact verification

For every download:

- require HTTPS;
- write to a newly created temporary directory;
- reject redirects to non-HTTPS URLs;
- enforce a reasonable size limit;
- compare the SHA-256 checksum before extraction;
- reject absolute paths, `..` traversal, symbolic links, hard links, devices,
  and duplicate entries in an archive;
- extract into a staged directory, verify the staged file inventory, then
  publish atomically where the platform allows;
- never overwrite an existing unknown installation.

The release RBZ must declare `sketchup_officially_signed: true` and
`encrypted: false`. The SketchUp Signing Portal changes the RBZ bytes, so the
checksum must be calculated from the returned signed file, not the uploaded
unsigned file.

## Client configuration

The server entry ID is `local-mcp-for-sketchup`. It launches the MCP server
using absolute paths to the bundled Node executable and `src/mcp-server.mjs`.

### Codex

The known configuration target is the user's Codex `config.toml`. The merger:

- appends a single `[mcp_servers.local-mcp-for-sketchup]` table;
- preserves all unrelated text;
- does nothing when the exact entry already exists;
- refuses a different existing table with the same ID;
- creates a timestamped backup before a change.

### Claude Desktop

The preferred local-server route is a Claude Desktop Extension (DXT). Until a
reviewed DXT is shipped, the installer must provide manual instructions and
must not guess or edit Claude Desktop's internal files.

### Cursor

The installer may merge a `local-mcp-for-sketchup` entry into the
`mcpServers` object at Cursor's documented global path `~/.cursor/mcp.json`.
It preserves unknown keys, refuses a conflicting existing entry, and creates a
timestamped backup.

### Other clients

Generate this shape with platform-specific absolute paths:

```json
{
  "mcpServers": {
    "local-mcp-for-sketchup": {
      "command": "/absolute/path/to/bundled/node",
      "args": ["/absolute/path/to/src/mcp-server.mjs"]
    }
  }
}
```

Do not modify an unknown client's files.

After a verified service bundle has been extracted, its bundled Node runtime
can run the configuration helper:

```text
/absolute/bundle/node/bin/node \
  /absolute/bundle/app/src/installer/configure-client.mjs \
  --bundle-root /absolute/path/to/local-mcp-for-sketchup \
  --client codex
```

Replace `codex` with `cursor`, `claude-desktop`, or another client ID. Claude
Desktop and unknown clients return instructions/snippets without modifying
configuration. The helper rejects a bundle built for another OS or CPU.

## Permission and conflict fallback

If the Agent lacks permission, sees an unknown file type, detects a symlink, or
finds a conflicting MCP entry, it must leave the existing configuration
unchanged. It may still:

- download and verify the RBZ and service bundle;
- show their exact local paths and hashes;
- tell the user to install the RBZ through SketchUp Extension Manager;
- print a manual MCP configuration snippet;
- identify any backup it actually created.

## Runtime policy

Download and installation may use the network. After installation the service
must remain useful offline and must not add telemetry, mandatory network
requests, or a runtime license check.

The draft manifest is `release/agent-install.v1.template.json`; its schema is
`schema/agent-install-v1.schema.json`.
