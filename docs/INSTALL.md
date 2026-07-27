# Installation

No public release is available yet. The steps below are for local source review
and must not be presented as the final one-line installer.

## Requirements

- SketchUp 2026
- macOS Apple Silicon or Windows x64
- Node.js 24 for a source checkout
- Ruby available to run the extension syntax checks

Official release service bundles are planned to carry their own Node.js
runtime, so end users will not need a separate Node installation.

## Source review

```text
npm ci
npm run core:check
```

To generate a locally reviewable, explicitly non-release RBZ:

```text
npm run plugin:package -- \
  --output-dir out/previews/local-review \
  --artifact-label local-review
```

The resulting file is unsigned. In SketchUp, open Extension Manager and choose
Install Extension. Depending on SketchUp's loading policy, an unsigned extension
may not load.

Do not upload this preview package to a download channel. The formal release
flow packages a clean source revision, uploads the exact RBZ to the SketchUp
Extension Signing Portal without encryption, downloads the signed result, and
then recalculates all checksums.

Release-candidate service bundles use `--candidate` and canonical file names,
but their embedded metadata still records `release_artifact=false` and
`release_acceptance=false`. They become publishable only after the signed RBZ,
platform acceptance evidence, and final manifest all bind to the same source
commit.

## Starting the MCP server from source

```text
node src/mcp-server.mjs
```

Use an absolute path to both Node and `src/mcp-server.mjs` in the MCP client
configuration. See [AGENT_INSTALL.md](AGENT_INSTALL.md) for safe merge and
manual fallback rules.

## Uninstall

Remove `local_mcp_for_sketchup.rb` and the `local_mcp_for_sketchup/` directory
through SketchUp's extension management workflow, then remove the local service
directory and its MCP client entry.

Uninstall does not automatically remove:

- user models;
- MCP client configuration backups;
- `~/.local-mcp-for-sketchup` local state;
- generated evidence in a source checkout's `output/` directory.

Inspect and delete those separately only when no longer needed.
