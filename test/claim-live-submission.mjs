import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { claimLiveSubmission } from '../scripts/lib/claim-live-submission.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claim-live-'));
try {
  let mutations = 0;
  const submit = async artifact => { await claimLiveSubmission(directory, artifact, { operations: ['test'] }); mutations++; };
  await submit('first.json');
  await assert.rejects(submit('first.json'), { code: 'EEXIST' });
  assert.equal(mutations, 1, 'An uncertain submission without a receipt must not replay');
  await fs.writeFile(path.join(directory, 'old.json'), 'historical receipt');
  await assert.rejects(submit('old.json'), /receipt already exists/);
  assert.equal(mutations, 1, 'Historical receipts without new claim files must also block replay');
  const concurrent = await Promise.allSettled([submit('race.json'), submit('race.json')]);
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(mutations, 2, 'Concurrent callers may only submit once');
  await assert.rejects(submit('../outside.json'), /basename/);
} finally { await fs.rm(directory, { recursive: true, force: true }); }
console.log('live submission retry and concurrency guards passed');
