# Install or upgrade the formal release

Use the stable [Agent entrypoint](../INSTALL_FOR_AGENTS.md). It resolves the latest non-draft, non-prerelease release, pins its manifest and verifies the exact service/RBZ pair. Do not install main source or use development source-preview helpers for a formal release.

Current release: [0.3.0](https://github.com/dtzhlq/local-mcp-for-sketchup/releases/tag/v0.3.0), Apple Silicon Mac and SketchUp 2026, 48 tools, bundled Node and signed RBZ. Windows x64 / SketchUp 2026 has a separate `v0.2.0-windows-preview.1` package; offer it with its Windows-CI-versus-live-SketchUp evidence boundary and obtain the user's preview choice. Do not reject Windows merely because the latest stable release is Mac-only. Intel Mac has no matching package. Download INSTALL.md and agent-install.v1.json from the selected release for exact version-specific instructions.

Install into a separate versioned directory; preserve the old server/plugin and configuration backup. Upgrade only the confirmed MCP entry's executable and server paths, preserving unrelated settings. Avoid duplicate legacy/new Ruby loaders, then restart around saved user documents and choose Extensions → Alma SketchUp MCP → Start Bridge, then check tools/list and the live plugin handshake. A plugin-only or stdio-only result is not complete live installation.

Rollback restores the previous confirmed server/plugin pair and client configuration. Preserve user models and task state. If latest discovery is unavailable, report the missing metadata; do not silently downgrade to an old unsigned preview or guess a mirror URL.

## Source development

For explicitly requested source development, see [candidate setup](DEVELOPMENT_CANDIDATE.md), [changes](../CHANGELOG.md) and [CAD acceptance](cad-surface-kernel/acceptance-report.json). The 48-tool release has bounded macOS native evidence; it is not a Windows-verified upgrade. Normal installation continues to use the selected published release manifest.
