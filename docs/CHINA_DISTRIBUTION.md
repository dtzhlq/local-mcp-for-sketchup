# GitHub and Gitee distribution

[GitHub](https://github.com/dtzhlq/local-mcp-for-sketchup) remains the canonical source for commits, tags, release notes and release manifests. [Gitee](https://gitee.com/dtzhlq/local-mcp-for-sketchup) is a one-way source and release-asset mirror for mainland-China access. Do not enable bidirectional synchronization or create independent mirror commits.

## Mirror a release

1. Freeze the canonical GitHub release tag, source commit, actual asset list, sizes and SHA-256 values. A successful source sync does not establish binary availability.
2. Mirror the same tag/commit and exact release notes. Preserve stable versus preview status; a Windows installation preview must remain a preview.
3. Upload the original signed RBZ, platform service archives, installation manifests, notices and verification/checksum files. Do not rebuild, rename, recompress or edit them for Gitee. Keep canonical manifest contents unchanged.
4. Read the actual published Gitee asset links. Download every attachment again from both hosts, then compare filenames, byte sizes, SHA-256 and byte-for-byte content. Include installation manifests and checksum files themselves in this verification.
5. Record the tags, source commits, published links and per-file results. Report a release mirror current only after all of its uploaded attachments pass. Host-generated source ZIP/TAR files are separate from the canonical uploaded source archive and are not assumed byte-identical.

The 0.4.2 release tags are `v0.4.2` and `v0.4.2-windows-preview.1`. Apply the per-file verification above to both release asset sets and preserve their stable/preview distinction. The [release record](RELEASE_ACCEPTANCE.md) defines the package acceptance boundary; a completed mirror check is a separate dated distribution result. Older mirrored files do not establish availability for these tags.

## Installation

The stable [INSTALL_FOR_AGENTS.md](../INSTALL_FOR_AGENTS.md) entrypoint resolves canonical published release metadata and freezes one supported platform manifest. A release-specific Gitee download may be used only when its actual published link and bytes match that selected canonical manifest; do not construct download URLs or substitute older unsigned packages. If canonical metadata or a verified release-specific mirror is unavailable, report that exact connectivity gap.

No installer registration form, email-distribution service or data collection is configured by this repository. Any future distribution form, domain, privacy notice and retention policy are separate decisions and must not claim to verify whether SketchUp is genuine.
