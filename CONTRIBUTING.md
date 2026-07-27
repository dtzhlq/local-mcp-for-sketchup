# Contributing

Thank you for contributing to Local MCP for SketchUp.

## Before opening a change

- Keep changes focused on the core project. Experimental projects and private
  release evidence are outside the public first-release scope.
- Do not add models, photos, customer data, credentials, API tokens, private
  URLs, absolute user paths, or large generated artifacts.
- Do not weaken the local-only transport, approval, queue, path-containment, or
  fail-closed safeguards.
- Do not describe mock or static checks as live SketchUp acceptance.

## Developer Certificate of Origin

Contributions use the [Developer Certificate of Origin 1.1](DCO.md). Sign off
each commit:

```text
git commit -s
```

The sign-off records that you have the right to submit the contribution under
this project's license. It is not a copyright assignment.

## Local checks

Use Node.js 24 and install the locked dependencies:

```text
npm ci
npm run core:check
```

The core gate is offline and does not prove compatibility with a running
SketchUp installation. Changes that affect the extension or queue runtime also
need the relevant macOS or Windows SketchUp 2026 acceptance steps documented in
`docs/RELEASE_ACCEPTANCE.md`.

## Security reports

Do not open a public issue for a suspected vulnerability. Follow
[SECURITY.md](SECURITY.md).
