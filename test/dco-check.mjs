import assert from 'node:assert/strict';
import { validateDcoCommit } from '../scripts/check-dco.mjs';

const passed = validateDcoCommit({
  sha: '0123456789abcdef',
  authorEmail: 'contributor@example.invalid',
  message: 'A focused change\n\nSigned-off-by: Contributor <contributor@example.invalid>\n'
});
assert.equal(passed.passed, true);

const otherSigner = validateDcoCommit({
  sha: 'fedcba9876543210',
  authorEmail: 'contributor@example.invalid',
  message: 'A change\n\nSigned-off-by: Reviewer <reviewer@example.invalid>\n'
});
assert.equal(otherSigner.passed, false);

const missing = validateDcoCommit({
  sha: 'aaaaaaaaaaaaaaaa',
  authorEmail: 'contributor@example.invalid',
  message: 'Unsigned change'
});
assert.equal(missing.passed, false);

process.stdout.write(`${JSON.stringify({
  ok: true,
  matching_author_signoff_required: true,
  missing_signoff_blocked: true
}, null, 2)}\n`);
