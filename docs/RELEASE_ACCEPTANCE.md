# 0.3.0 release acceptance

Released for Apple Silicon macOS + SketchUp 2026, with 48 tools, bundled Node 24.18.0 and an officially signed, unencrypted RBZ. The release binds source commit `590e1d480491d90bd5471ff333f338d51f46c58b`.

## Final package verification

- Service SHA-256: `f1919e8d5bd0f161d1b00d8795d94bcd9ae6e39e6f149ad4776cce52cb14c681`.
- Signed RBZ SHA-256: `018797f72f74bbb035d75d88d28d3b0ee5ee850279e06488af477e0eed7b0dff`.
- The signing portal returned a signature without changing the 33 source files. SketchUp Extension Manager displayed the extension as signed and enabled after restarting.
- Extracted bundled Node passed MCP initialization, discovery of 48 tools and a tool call. The exact source commit passed [Core CI](https://github.com/dtzhlq/local-mcp-for-sketchup/actions/runs/35410106378).
- The final service and signed plugin read the dedicated CAD model, executed two sequential local-edit stages with real intermediate readback, preserved unrelated vertices, measured volume and saved the model.
- After normal document close and disk reopen, all five contexts retained CAD parameters, vertex and face counts. The deliberate stale-source control remained stale.
- The Node service completed these native checks under a macOS sandbox denying network access. SketchUp application networking was not globally disabled; this establishes the local service workflow without claiming the entire host was disconnected.

The prior combined [modeling validation](modeling-uplift/implementation-status.md), [CAD validation](cad-surface-kernel/acceptance-report.json) and GLM investigation are reused. Unchanged geometry algorithms were not retested in a redundant full matrix.

## Recorded exception

The first document-close attempt coincided with manual UI activity and SketchUp crashed. Its stack included CEF/AppKit rendering frames. The cause remains unresolved; neither user fault nor an MCP defect is established. The saved file recovered, and the subsequent isolated normal close, disk reopen and native persistence check passed. No crash-fix claim is made.

## Scope and artifacts

[Release assets](https://github.com/dtzhlq/local-mcp-for-sketchup/releases/tag/v0.3.0) include the exact service/plugin pair, machine-readable installation manifest, SHA-256 checksums, acceptance report, examples, corresponding source and dependency notices. The archive retains build-time candidate flags; the final release manifest promotes those same tested bytes.

SketchUp receives tessellated faces and retained CAD recipes, not native NURBS entities. Arbitrary historical mesh reconstruction, trimmed or periodic NURBS, variable-radius fillets and every corner configuration remain unsupported. Windows 0.3.0 native acceptance and a universal cross-model benchmark are not claimed.

Historical [0.2.0 acceptance](RELEASE_ACCEPTANCE_0.2.0.md) applies only to its original artifacts.
