# Official signing — 0.4.1

Build the public wrapper with `node scripts/package-image-release-plugin.mjs`. This relocates the current Ruby modules without changing business logic and writes an unsigned RBZ plus the exact file inventory and SHA-256.

Upload that RBZ to https://extensions.sketchup.com/extension/sign using the authorized Trimble account. Choose signing without encryption. Save the returned RBZ as a new file. A checksum or a locally generated package metadata flag is not an official signature.

Verify every inventory entry against the returned archive and account for portal-added signature files. Reject absolute/traversal paths, changed business logic or missing files. Calculate the returned file hash. Keep the unsigned input receipt separately.

Install only the returned final signed RBZ for formal acceptance, on Apple Silicon Mac / SketchUp 2026, under the identified-extension loading policy. Preserve and remove any prior compatibility loader through the existing backup/install mechanism to avoid two active queue bridges. Use the v0.4.1 assembly minimal validation policy: reuse the recorded A/B/C development geometry acceptance and supplement it with final signed-package loading, bundled-service discovery and a bounded native create/edit/view check. Verify selected-root isolation and source/payload/registry/package integrity. The new camera-facing pre-capture guard also needs a native rejection check before release. Saving is a delivery operation, not a save/reopen test. A restart needed for plugin installation is not a separate model acceptance. Do not claim Windows acceptance.
