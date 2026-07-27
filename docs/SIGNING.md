# SketchUp RBZ signing handoff

The official release RBZ must be returned by the SketchUp Extension Signing
Portal. Internal release metadata or a locally created checksum is not an
official SketchUp extension signature.

## Before upload

1. Freeze the clean public source commit and version.
2. Run the full core gate from that exact tree.
3. Build one canonical unsigned RBZ from that exact tree.
4. Record its file name, byte size, SHA-256 checksum, and 23-file inventory.
5. Confirm that the archive root contains only:
   - `local_mcp_for_sketchup.rb`
   - `local_mcp_for_sketchup/`
6. Confirm that the extension name is `Local MCP for SketchUp`.

Keep unsigned RBZ and service-bundle candidates local; canonical names do not
make them release artifacts.

Do not upload a file containing `nonrelease` in its name.

## Portal choices

- Sign: yes
- Encrypt: no

The signing portal injects signature data and therefore changes the RBZ bytes.
The uploaded checksum is only an input receipt; it is not the release checksum.

## After download

1. Save the returned file as a new file. Do not overwrite the unsigned input.
2. Inspect the archive paths and reject traversal, absolute paths, or unrelated
   payloads.
3. Confirm the expected 23 extension files remain present and record any
   portal-added signature file.
4. Calculate the new byte size and SHA-256 checksum.
5. Install that exact signed RBZ with SketchUp's strict identified-extension
   loading policy on both release platforms.
6. Bind that signed checksum to both platform entries in
   `agent-install.v1.json`.

Signing is an integrity step. It does not mean that SketchUp or Trimble
endorses, sponsors, or partners with this project.
