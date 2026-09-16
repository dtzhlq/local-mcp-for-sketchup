# Agent installation manifest

The stable entrypoint is [INSTALL_FOR_AGENTS.md](../INSTALL_FOR_AGENTS.md). It discovers the latest formal release from the canonical GitHub API and consumes that release's immutable `agent-install.v1.json` plus checksums. The user-facing sentence remains stable across updates.

The release manifest is authoritative for version, source tag/commit, supported platforms, exact asset names/size/hash, bundled runtime, tool count and acceptance. Pin it for the whole installation. Current formal release: v0.2.0, Apple Silicon Mac / SketchUp 2026, 44 tools; these values are an example, not a future version ceiling.

This branch's legacy schema, draft template and version-bound preview validator belong to its older source baseline. Do not use them to reject or install newer releases. If executable validation is needed, use the selected release's source/schema. Preserve client configuration and install each version separately for rollback. See the entrypoint for upgrade and verification steps.

## Windows preview

When the latest stable manifest has no Windows target, inspect matching platform releases rather than rejecting Windows globally. The explicit `v0.2.0-windows-preview.1` prerelease supplies `windows-install.v1.json`, its own Windows archive and signed RBZ hashes. It has Windows CI server evidence, not live SketchUp acceptance; obtain the user's preview choice. Do not feed this preview manifest into the stable-release validator or set release_acceptance=true. See the root entrypoint for exact binding and installation rules.
