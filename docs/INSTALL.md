# Install 0.2.0 on Apple Silicon

> 本文记录 0.2.0 历史发布。0.3.0 的 48 工具与 CAD 曲面开发候选见 [候选说明](DEVELOPMENT_CANDIDATE.md)；旧版签名和发布验收不适用于候选包。

Target: Apple Silicon Mac and SketchUp 2026. Node is included. The released bytes passed independent server installation, native signed-plugin installation, and three-domain creation/save/close/reopen acceptance.

1. Keep the current installation and client configuration as the rollback copy.
2. Extract `local-mcp-for-sketchup-0.2.0-darwin-arm64.tar.gz` into a new version-specific directory. Do not overlay another version.
3. Configure the MCP client to execute `<install>/local-mcp-for-sketchup/node/bin/node` with argument `<install>/local-mcp-for-sketchup/app/src/mcp-server.mjs`. Replace both placeholders with absolute paths.
4. Start with the default offline/mock policy. For authorized SketchUp work, the existing settings are `ALMA_SKETCHUP_AGENT_ALLOWED_RUNTIMES=mock,queue` and `ALMA_SKETCHUP_AGENT_ALLOW_QUEUE_MUTATION=1`; trusted review and fresh session checks still apply. Direct expert mutation need not be enabled.
5. For formal acceptance, install the returned officially signed RBZ through SketchUp Extension Manager. The unsigned handoff file is not the final release plugin. Preserve the previous plugin first, and avoid loading both the compatibility `alma_sketchup_mcp.rb` entry and the new `local_mcp_for_sketchup.rb` entry simultaneously.
6. Restart SketchUp, discover/connect through the server, and verify the loaded plugin and source capabilities. Use `docs/IMAGE_STRUCTURE.md` for the new image path.

The bundle was independently started with its own Node 24.18.0 and dependencies. MCP initialization, tools/list (44 tools), and an actual image_artifact/structure tools/call passed. This does not substitute for signed-plugin acceptance or save/reopen tests.

Rollback: point the MCP client back to the preserved prior server directory, restore the prior plugin through Extension Manager, restart SketchUp and reconnect. Preserve image task artifacts, source photos and user model files. Do not reset models or delete task state to roll back software.

Download files and SHA256SUMS.txt from the [0.2.0 release](https://github.com/dtzhlq/local-mcp-for-sketchup/releases/tag/v0.2.0). Run `shasum -a 256 -c SHA256SUMS.txt` in the directory containing all downloaded assets, or compare the individual downloaded file with its listed hash. The archive retains its build-time candidate flags; promotion uses these exact tested bytes, with final acceptance recorded in the release manifest.
