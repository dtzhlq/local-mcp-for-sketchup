# Agent installation contract

> 本文记录 0.2.0 历史发布。0.3.0 的 48 工具与 CAD 曲面开发候选见 [候选说明](DEVELOPMENT_CANDIDATE.md)；旧版签名和发布验收不适用于候选包。

Version 0.2.0 supports Apple Silicon Mac and SketchUp 2026. Download the release assets and `agent-install.v1.json` from the [release](https://github.com/dtzhlq/local-mcp-for-sketchup/releases/tag/v0.2.0). Verify SHA-256 before installation.

Use bundled `node/bin/node` with `app/src/mcp-server.mjs`, both absolute paths, preserving existing client configuration. See [manual installation and rollback](INSTALL.md). The signed RBZ is installed through SketchUp Extension Manager. The source template is intentionally a draft; the downloadable manifest binds the final commit, files and acceptance evidence.
