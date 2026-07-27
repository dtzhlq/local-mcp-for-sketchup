# Privacy

Local MCP for SketchUp is designed to keep its normal modeling workflow on the
user's computer.

## Runtime behavior

- No telemetry is implemented.
- No runtime license check is implemented.
- No account or mandatory network connection is required after installation.
- The local MCP service does not intentionally upload models, prompts, queue
  payloads, screenshots, or usage records.

An Agent or another program connected to the MCP service may have its own
network and privacy behavior. That behavior is controlled by the other program,
not by this project.

## Local data

Depending on the features used, the project can store local queue requests,
responses, approval records, task state, diagnostic reports, visual captures,
saved-model copies, and configuration backups. The default application state
directory is:

- macOS and other Unix-like systems: `~/.local-mcp-for-sketchup`
- Windows: the equivalent path resolved from the user's home directory, unless
  an explicit state directory is configured

Test commands may also write generated evidence under the repository's
`output/` directory. Users should inspect these locations before sharing
diagnostics because file names, model structure, prompts, or screenshots may be
sensitive.

Uninstalling the extension or service does not automatically delete user
models, configuration backups, or local state. Delete those files manually
after confirming they are no longer needed.

## Installation network access

An installer may use the network to download a fixed-version manifest, the
SketchUp extension, the local service bundle, and the official Node.js runtime.
The installer must verify the published SHA-256 checksum before installing any
downloaded artifact. Installation does not enable telemetry or later mandatory
network access.

## Future China distribution form

Any future registration form for an official China distribution channel is a
separate service. Its data fields, purpose, retention period, processor,
contact method, and consent text must be disclosed on that form before data is
collected. Registration must not be described as a way to verify whether a
SketchUp installation is genuine.

Questions: <dtzhlq@126.com>
