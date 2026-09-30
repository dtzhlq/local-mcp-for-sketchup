# Agent installation manifest

The stable entrypoint is [INSTALL_FOR_AGENTS.md](../INSTALL_FOR_AGENTS.md). It discovers the latest formal release from the canonical GitHub API and consumes that release's immutable `agent-install.v1.json` plus checksums. The user-facing sentence remains stable across updates.

The release manifest is authoritative for version, source tag/commit, supported platforms, exact asset names/size/hash, bundled runtime, tool count and acceptance. Pin it for the whole installation. Current formal release: v0.4.0, Apple Silicon Mac / SketchUp 2026, 48 tools. These values are an example, not a future version ceiling.

The source schema, draft template and version-bound validator apply only to their own source version. If executable validation is needed, use the selected release's source/schema. Preserve client configuration and install each version separately for rollback. See the entrypoint for upgrade and verification steps.

## Windows preview

When the latest stable manifest has no Windows target, inspect matching platform releases rather than rejecting Windows globally. The current `v0.4.0-windows-preview.1` prerelease supplies `windows-install.v1.json`, its own Windows archive and the byte-identical signed 0.4.0 RBZ. It provides Windows CI evidence for the installed 48-tool server, image integration, CAD geometry/editing/surfaces/fillets and traditional-timber rules. Live Windows SketchUp acceptance remains pending; obtain the user's preview choice. Do not feed this preview manifest into the stable-release validator or set release_acceptance=true.

Discover the newest published matching Windows preview and require its product version and runtime baseline to match the current stable version. If no such package exists, report the synchronization gap instead of installing an older preview silently. See the root entrypoint for exact source, checksum, CI-report and rollback rules.

## Source development

For explicitly requested source development, see [candidate setup](DEVELOPMENT_CANDIDATE.md), [changes](../CHANGELOG.md) and [CAD acceptance](cad-surface-kernel/acceptance-report.json). Normal installation continues to use the selected published release manifest.
