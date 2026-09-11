# Official signing handoff — 0.2.0

Build the public wrapper with `node scripts/package-image-release-plugin.mjs`. This relocates the current Ruby modules without changing business logic and writes an unsigned RBZ plus the exact file inventory and SHA-256.

Upload that RBZ to https://extensions.sketchup.com/extension/sign using the authorized Trimble account. Choose signing without encryption. Save the returned RBZ as a new file. A checksum or a locally generated package metadata flag is not an official signature.

Verify every inventory entry against the returned archive and account for portal-added signature files. Reject absolute/traversal paths, changed business logic or missing files. Calculate the returned file hash. Keep the unsigned input receipt separately.

Install only the returned final signed RBZ for formal acceptance, on Apple Silicon Mac / SketchUp 2026, under the identified-extension loading policy. Preserve and remove any prior compatibility loader through the existing backup/install mechanism to avoid two active queue bridges. Run the planned focused checks and three live model/save/reopen cases on the exact final Node bundle and plugin. Do not claim Windows acceptance.
