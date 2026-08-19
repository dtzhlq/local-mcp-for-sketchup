# Windows x64 / SketchUp 2026 acceptance

Use only the final candidate hashes supplied with the release handoff. Preview
files containing `nonrelease` do not qualify.

## Environment record

Record:

- Windows edition and build;
- x64 CPU architecture;
- SketchUp exact version;
- signed RBZ SHA-256;
- Windows service-bundle SHA-256;
- test date and operator.

Do not include the Windows user name, license key, account token, private model
path, or unrelated machine information in public evidence.

## Test

1. Disconnect or preserve valuable unsaved SketchUp work.
2. Install the signed, unencrypted RBZ through Extension Manager.
3. Restart SketchUp completely.
4. Under the strict identified-extension loading policy, confirm
   `Local MCP for SketchUp` loads without a signature warning.
5. Extract the Windows x64 service bundle to a path containing a space.
6. Confirm it starts with its bundled `node.exe`; do not rely on a system Node.
7. Request a fresh `get_capabilities --runtime queue` handshake.
8. Confirm version `0.1.0-rc.4`, the expected capability manifest, runtime
   source attestation, and 42 MCP tools.
9. Run a read-only inspection on a disposable model.
10. Approve one bounded mutation on that disposable model.
11. Save to a new file, close SketchUp, reopen that exact file, and verify the
    intended change.
12. Repeat the service start while offline and confirm there is no telemetry,
    runtime license check, or mandatory-network prompt.
13. Test the default `%APPDATA%` plugin location and a Windows profile/path
    containing spaces and non-ASCII characters.
14. Confirm uninstall instructions do not remove user models or unrelated
    client configuration.

## Stop rules

Stop and keep `release_acceptance=false` if:

- the handshake is stale or comes from another plugin build;
- the signed extension does not load under the strict policy;
- a different Node installation is required;
- any checksum differs;
- configuration is overwritten instead of merged/backed up;
- save, close, reopen does not preserve the intended result;
- unexpected external network traffic or a license prompt appears.

Return the evidence report and hashes to the release maintainer before public
publication.
