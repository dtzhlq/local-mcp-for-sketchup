# Agent installation contract

Version 0.2.0 supports Apple Silicon Mac and SketchUp 2026. Download the release assets and `agent-install.v1.json` from the [release](https://github.com/dtzhlq/local-mcp-for-sketchup/releases/tag/v0.2.0). Verify SHA-256 before installation.

Use bundled `node/bin/node` with `app/src/mcp-server.mjs`, both absolute paths, preserving existing client configuration. See [manual installation and rollback](INSTALL.md). The signed RBZ is installed through SketchUp Extension Manager. The source template is intentionally a draft; the downloadable manifest binds the final commit, files and acceptance evidence.
