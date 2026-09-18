# Third-Party Notices

Local MCP for SketchUp is licensed under Apache License 2.0. It also depends on
third-party software distributed under the licenses identified below.

This file is an inventory for the development source tree at version `0.3.0`. A
release bundle must additionally contain the license files and the
artifact-specific dependency inventory produced during that build. This file
does not replace the license text shipped by any dependency.

## JavaScript runtime dependencies

| Component | Version in `package-lock.json` | License |
| --- | ---: | --- |
| acorn | 8.16.0 | MIT |
| ajv | 8.20.0 | MIT |
| sharp | 0.35.3 | Apache-2.0 |
| replicad | 1.1.0 | MIT |
| replicad-opencascadejs | 1.1.0 | LGPL-2.1-only |

Known transitive packages in the locked dependency graph include:

| Component | Version | License |
| --- | ---: | --- |
| @emnapi/runtime | 1.11.3 | MIT |
| @img/colour | 1.1.0 | MIT |
| @img/sharp-* | 0.35.3 | Apache-2.0, with platform package notices |
| @img/sharp-libvips-* | 1.3.2 | LGPL-3.0-or-later |
| detect-libc | 2.1.2 | Apache-2.0 |
| fast-deep-equal | 3.1.3 | MIT |
| fast-uri | 3.1.4 | BSD-3-Clause |
| json-schema-traverse | 1.0.0 | MIT |
| require-from-string | 2.0.2 | MIT |
| semver | 7.8.5 | ISC |
| tslib | 2.8.1 | 0BSD |

The exact `@img/*` packages differ by platform. The macOS Apple Silicon and
Windows x64 service bundles must be audited separately after their production
dependencies are installed.

`sharp` binary distributions may include libvips and its dependencies. libvips
is licensed under LGPL-3.0-or-later. Release bundles must preserve the license
and source-offer information supplied by the corresponding `@img/sharp-libvips-*`
package.

Project pages:

- acorn: <https://github.com/acornjs/acorn>
- ajv: <https://ajv.js.org/>
- sharp and libvips packaging information: <https://sharp.pixelplumbing.com/>

## Bundled Node.js

Official service bundles are planned to include the unmodified official Node.js
24.18.0 binary for the target platform. Node.js is distributed under the MIT
license and includes third-party software under additional licenses.

Each service bundle must include the `LICENSE` file from the exact upstream
Node.js archive. The release manifest records the upstream URL and SHA-256
checksum. The Node.js source and license information are available from:

- <https://nodejs.org/dist/v24.18.0/>
- <https://github.com/nodejs/node>

## SketchUp

SketchUp is not included in this repository or in its release artifacts. Users
must obtain and license SketchUp separately.

## Reporting an omission

If you believe an attribution or license file is missing, contact
<dtzhlq@126.com>. A release must not pass the third-party-license gate while a
known omission remains unresolved.

## CAD kernel development candidate

The CAD worker uses the unmodified npm `replicad-opencascadejs@1.1.0` WebAssembly
build and `replicad@1.1.0` wrappers. These remain separately replaceable packages
in `node_modules`; the app does not inline the kernel into its own source.
Upstream project: https://github.com/sgenoud/replicad (package gitHead
`e4b05f67dc4e2393a876ce8c5064a9c93db05bf1`). The kernel package records its build
image `ghcr.io/taucad/opencascade.js:canary-ebd263f1-single-threaded` and build
configuration location in its package scripts. Its LGPL license is included in
the package; the dependency inventory and all bundled license texts must remain
with the local candidate. Public redistribution and corresponding-source
packaging have not been qualified as part of this local-only candidate.
