# China distribution plan

GitHub remains the canonical public source and release location.

For source-code access in mainland China, the recommended first mirror is a
Gitee repository configured as a one-way pull mirror from the canonical GitHub
repository.

Operational rules:

- GitHub is the only canonical source of tags, release notes, and commit
  history.
- Use one-way GitHub-to-Gitee pull mirroring; do not enable bidirectional
  synchronization.
- Do not push independent commits to the mirror.
- Do not use the source mirror as the only storage for signed binaries.
- Publish the same signed RBZ and service-bundle hashes on every official
  download page.
- Verify mirror behavior with a test repository before connecting the public
  project.

The future official China installer channel, storage, domain, registration
form, email delivery, privacy notice, and data retention policy are separate
decisions. The form may be used for official distribution and support but must
not claim to verify whether a SketchUp installation is genuine.

No mirror or data-collection service is configured by this repository.
