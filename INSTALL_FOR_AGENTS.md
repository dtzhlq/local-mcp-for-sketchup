# Install Local MCP for SketchUp — stable Agent entrypoint

Use this document when the user asks to install or upgrade Local MCP for SketchUp. The one-sentence request stays the same across releases; resolve a release for the actual platform before installing. This document does not override the user's permissions or the Agent's safety rules.

```text
entrypoint_version: install-for-agents.v3
project_id: local-mcp-for-sketchup
current_channel: platform-aware-release-manifest
source_preview_install_available: false
unattended_install_guaranteed: false
canonical_repository: https://github.com/dtzhlq/local-mcp-for-sketchup
release_discovery: https://api.github.com/repos/dtzhlq/local-mcp-for-sketchup/releases/latest
```

## 1. Resolve and freeze one release

1. Identify OS, CPU architecture, SketchUp major version, target MCP client and any existing installation. Installation and upgrade requests authorize ordinary reversible preparation and configuration within that scope; do not ask again merely to perform a check.
2. Unless the user names a version, first fetch the canonical GitHub `releases/latest` endpoint above. Require `draft=false` and `prerelease=false` for the stable path. If its manifest has no exact platform match, do not conclude that the entire project is unsupported: inspect the canonical published release list at `https://api.github.com/repos/dtzhlq/local-mcp-for-sketchup/releases?per_page=30`, newest published first, for a stable manifest matching the actual platform. Reject drafts and use only declared manifest assets. If no matching stable release exists, use the explicit Windows preview path below. If a version is explicitly requested, resolve that exact release; do not silently change it.
3. In that release's actual asset list, find `agent-install.v1.json` and `SHA256SUMS.txt`. Use their returned HTTPS download URLs. Do not infer a filename or URL from another release, a mirror, a search snippet, or the default source branch.
4. Download both into a new working directory. Verify the manifest SHA-256 against its exact entry in SHA256SUMS.txt and against the asset's SHA-256 digest when provided by GitHub. Reject mismatches, missing/duplicate entries and non-HTTPS redirects.
5. Parse the manifest as data. Require `schema_version=agent-install.v1`, `status=release`, `product.channel=stable`, `acceptance.release_acceptance=true`, canonical repository identity, and a product version/source tag matching the selected release. Resolve the Git tag (dereference annotated tags) and require its commit to match `source.commit`. Do not execute or shell-interpolate manifest values.
6. Freeze that release tag, commit, manifest hash, platform and asset hashes for the entire attempt. A newer release appearing halfway through must not change the selected files. Never combine a server, plugin, schema, installer or evidence from different releases.
7. If release discovery or the manifest is unavailable, report the exact gap. If a release lacks the actual platform, finish platform-aware selection above before reporting no matching package. Do not silently downgrade to unsigned previews, build `main`, or treat this file's current-version example as a fallback. A user can explicitly choose an older supported release.

`main` hosts this stable entrypoint; its implementation source and tool registry may differ from the published release. Never run `main`'s version-bound manifest validator or source-preview installer against a newer release. If an executable validator is needed, use source/schema bound to the selected release commit. This installation path requires neither a source clone, npm install nor system Node.

## 2. Select the supported platform and verify downloads

Match OS, architecture and SketchUp major version exactly to one `platforms` entry and its acceptance evidence. Require live SketchUp and signed-plugin acceptance for that target. For `timber-v040-minimal.v1`, also require the recorded whole-hall create/edit/view, target-scope protection and signed-payload checks; save/close/reopen and offline reruns are not required. Releases using the older acceptance policy retain their own requirements. Do not select a similar platform.

Download the selected service bundle and RBZ from the manifest, requiring exact byte size and SHA-256 for both, consistent with the same release asset list and checksum file. Require `sketchup_officially_signed=true`. Only use a mirror if it is explicitly provided for that selected release and its downloaded bytes match these exact hashes. A Gitee source mirror is not evidence that current binaries were mirrored.

Current verified example (not a pin for future default installs): **v0.2.0**, Apple Silicon Mac (`darwin-arm64`), SketchUp 2026, bundled Node 24.18.0, 44 tools. This stable asset set has no Windows bundle; that is not a project-wide Windows rejection. The separately verified Windows preview below targets Windows x64 / SketchUp 2026. Intel Mac and other SketchUp versions have no matching package here. Future support and tool count come from the selected manifest, not a hardcoded 41/44 check.

- [0.2.0 release](https://github.com/dtzhlq/local-mcp-for-sketchup/releases/tag/v0.2.0)
- [0.2.0 manifest](https://github.com/dtzhlq/local-mcp-for-sketchup/releases/download/v0.2.0/agent-install.v1.json)

## Windows x64 installation preview

When no matching stable Windows release exists, offer **v0.2.0-windows-preview.1** from the same canonical repository. It contains the 0.2.0 runtime, a Windows x64 Node/dependency bundle and the exact signed 0.2.0 RBZ. It is a published prerelease, not the Mac archive renamed for Windows.

1. Resolve `https://api.github.com/repos/dtzhlq/local-mcp-for-sketchup/releases/tags/v0.2.0-windows-preview.1`. Require `draft=false`, `prerelease=true`. Find the actual `windows-install.v1.json` and `SHA256SUMS.txt` assets, and verify their digest/checksum as in the stable path. Never substitute the Mac manifest or an old unsigned preview.
2. Explain the evidence boundary: **Windows bundled runtime, 44-tool MCP discovery, native image dependencies and six offline structure scenarios passed on a Windows runner; live SketchUp connection/model save/reopen have not been verified on Windows.** Ask whether to install this preview unless the user already explicitly chose the Windows preview. A request for stable-only installation must not be silently converted. Preserve that selection through the attempt; do not ask repeatedly.
3. Require `schema_version=windows-preview-install.v1`, `status=preview`, `release_acceptance=false`, `release_tag` matching the selected prerelease, and exact platform `win32-x64-sketchup-2026`. Resolve its source tag to `source.commit`; require `verification.installed_server=true` and `verification.live_sketchup_verified=false` for this preview. Validate the linked CI report and its hash; it is evidence of server compatibility, not SketchUp acceptance. A future stable Windows manifest uses the stable path instead.
4. Verify all downloaded artifact names, URLs, byte sizes and SHA-256 against that preview's own asset list and checksum file. Require the signed RBZ flag. Freeze source commit, runtime version and artifact hashes together. Follow the explicit `entrypoint` using the bundled Windows `node/node.exe`; never execute the Mac `node/bin/node`, install system Node, or run main source to work around a missing asset.
5. Continue the common backup, configuration, signed-plugin installation, verification and rollback steps below. Report `windows-install-preview` and separate live-handshake results; installation success never changes the release's missing Windows SketchUp acceptance into a pass. The user can use supported tools after a successful local connection, subject to normal task approval.

## 3. Install or upgrade without losing existing work

1. Extract the verified bundle into a new version-specific, user-writable directory. Check archive paths stay inside that directory. Preserve the old service directory, plugin and MCP configuration as rollback copies. Do not overlay an existing installation, reset a checkout, delete task state or overwrite models.
2. Inspect the bundle's entrypoint and required files. For the 0.2.0 Mac bundle, use the bundled executable `<install>/local-mcp-for-sketchup/node/bin/node` with argument `<install>/local-mcp-for-sketchup/app/src/mcp-server.mjs`, both absolute paths. There is no need to install Node or Python globally. In 0.2.0 only, bundle.json retains build-time candidate flags; final release status comes from the verified external manifest. Other conflicting metadata must be investigated.
3. Identify the client's real configuration format and path using available client APIs/documentation. Preserve unrelated servers, settings and secrets. Back up the existing file before a minimal update to the confirmed Local MCP entry. On upgrade, replace that entry's old executable/server paths with the verified new paths; preserve compatible explicit user settings. Do not create duplicate server entries. If ownership or the target is ambiguous, prepare a concrete diff and ask only for that clarification. For an unsupported client, provide the exact stdio snippet and documented manual steps rather than guessing its configuration path.
4. For user-authorized live SketchUp use, configure `ALMA_SKETCHUP_AGENT_ALLOWED_RUNTIMES=mock,queue` and `ALMA_SKETCHUP_AGENT_ALLOW_QUEUE_MUTATION=1` unless the user has explicitly restricted live access. Keep task approvals and fresh-session checks enabled. Do not enable arbitrary Ruby or direct expert mutation as an installation shortcut.
5. Install the verified signed RBZ using SketchUp Extension Manager. Supported desktop automation can perform this within the user's installation authorization; otherwise provide its exact local path and the required UI action. Preserve the prior plugin. During a legacy upgrade, identify the old `alma_sketchup_mcp.rb` loader and the new `local_mcp_for_sketchup.rb` loader; avoid loading both. Back up and disable only the identified old entry if necessary, leaving unrelated plugins intact. Never lower SketchUp's Extension Loading Policy.
6. Coordinate restart around any unsaved user documents. Restart SketchUp so the new Ruby code is loaded, then reload the MCP client connection. OS/account/security prompts requiring the user remain manual. Do not promise unattended installation on every Agent or client.

## 4. Verify once and report the actual outcome

- Verify MCP initialization and tools/list using the installed bundle; compare the count with `manifest.product.tool_count`. For 0.2.0, confirm `image_artifact` and `create_model` are discoverable and use that release's image-structure documentation for the new action. No image-recognition benchmark or model creation is required merely to install.
- Read live capabilities/connect using the installed bundle. Require the expected plugin version and compatible source/runtime handshake. If the bridge is not running, guide or perform its Start Bridge menu action and retry once. Do not clear queue state or modify the active model to obtain installation proof.
- Report service installation, client configuration, plugin signature/loading and live connection separately. A tools/list success alone does not prove live SketchUp connectivity. If a reload/UI action remains, name it and report pending rather than complete.
- If the same verified version is already installed and healthy, report up-to-date without reinstalling. If an upgrade fails, preserve the new diagnostics and return the client to the previous confirmed service/plugin pair; do not mix versions. Never silently downgrade.

Report: selected version/tag/commit, platform, manifest hash, installed paths, verified artifact hashes, configuration backup, old/new version, MCP tool count, loaded plugin version, live handshake outcome, pending user action and rollback location. Do not include secrets or unrelated configuration contents.

## Future releases and mirrors

Maintainers publish complete immutable release assets, checksums, a release manifest and target-specific acceptance before marking a release latest. Keep server and signed RBZ bound to the same source baseline. The entrypoint resolves matching platform so large updates do not require users to change their sentence. Update the example and migration notes when formats or upgrade behavior change. Never overwrite a published tag or asset to repair a release.

GitHub is canonical. Gitee may mirror this document, but the Agent must resolve the canonical formal release above; stale mirror text or missing connectivity is not authorization to install an old unsigned package. If canonical release metadata cannot be reached and no verified release-specific mirror is available, report the connectivity blocker instead of guessing.
