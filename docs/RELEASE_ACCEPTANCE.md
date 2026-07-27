# Release acceptance — `0.1.0-rc.4`

This document separates automated checks, controlled live evidence, and final
release acceptance. Passing one layer does not imply that the next layer passed.

Current decision: `release_acceptance=false`.

## Gate dependency order

1. Freeze the intended clean public source tree and version.
2. Pass core offline, dependency, secret, path, size, and license checks.
3. Build an unsigned RBZ and two service bundles from that source revision.
4. Verify each artifact inventory, license set, size, and SHA-256 checksum.
5. Upload the exact unsigned RBZ to the SketchUp Extension Signing Portal with
   encryption disabled.
6. Download the signed RBZ, verify that its bytes changed as expected, and
   calculate its new checksum.
7. Populate and validate the immutable `agent-install.v1` release manifest with
   final URLs, sizes, and hashes.
8. Perform macOS Apple Silicon and Windows x64 SketchUp 2026 acceptance using
   the final signed RBZ and final service bundles.
9. Test Codex, Claude Desktop manual/DXT, Cursor, and generic manual MCP
   configuration paths without overwriting unrelated settings.
10. Set `release_acceptance=true` only after all required evidence refers to
    the exact final artifact hashes.

## Automated core checks

- [ ] Exactly 41 MCP tools are listed and exercised by the mock capability
  suite.
- [ ] Plugin registration root, 22 support files, Ruby syntax, runtime source
  manifest, and packaging inventory pass.
- [ ] `agent-install.v1` schema and release-only semantic blockers pass.
- [ ] Agent configuration merge is idempotent, backs up changed files, and
  refuses conflicts and symlink targets.
- [ ] `npm audit` reports no known vulnerabilities at the configured severity.
- [ ] All dependencies have an artifact-specific license inventory.
- [ ] Clean public export contains no secrets, personal paths, user models,
  media sets, package caches, generated outputs, or experimental projects.
- [ ] Rebuilding from the same source and inputs produces the recorded logical
  inventory; any nondeterministic archive metadata is documented.

## macOS Apple Silicon / SketchUp 2026

- [ ] Install the final signed RBZ under the strict identified-extension
  loading policy.
- [ ] Start the final bundled arm64 service without a separately installed
  Node.js.
- [ ] Obtain a fresh `get_capabilities --runtime queue` handshake.
- [ ] Confirm the running plugin version, capability version, source
  attestation, and 41-tool registry match the release.
- [ ] Run a controlled read-only check.
- [ ] Run one approved mutation on a disposable model.
- [ ] Save, close, reopen, and verify the exact saved model.
- [ ] Confirm offline operation after installation.
- [ ] Confirm no unexpected network, telemetry, or license prompt.

Historical RC3 live evidence may inform risk but cannot satisfy these RC4
artifact checks.

## Windows x64 / SketchUp 2026

- [ ] Install the same final signed RBZ under the strict identified-extension
  loading policy.
- [ ] Start the final bundled Windows x64 service without a separately
  installed Node.js.
- [ ] Obtain a fresh `get_capabilities --runtime queue` handshake.
- [ ] Confirm version, capability version, source attestation, and 41 tools.
- [ ] Run the same disposable-model read, approved mutation, save, close,
  reopen, and verification flow.
- [ ] Confirm Windows path, spaces, Unicode user name, and `%APPDATA%` handling.
- [ ] Confirm offline operation after installation.
- [ ] Confirm no unexpected network, telemetry, or license prompt.

Windows acceptance is assigned to the maintainer and remains a release blocker
until evidence is returned.

## Publication authorization

Creating the public GitHub repository, adding a remote, pushing history,
creating a GitHub Release, uploading artifacts, publishing a mirror, or
collecting registration data changes external state. Each action must use the
confirmed target and exact artifact set. No such action is authorized merely by
passing local gates.
