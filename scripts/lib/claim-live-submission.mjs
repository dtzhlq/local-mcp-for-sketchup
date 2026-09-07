import fs from 'node:fs/promises';
import path from 'node:path';

// Persist the submission identity before invoking a native mutation. A missing
// final receipt after a crash is not permission to submit the same work again.
export async function claimLiveSubmission(directory, artifact, record) {
  if (path.basename(artifact) !== artifact) throw new Error('Submission artifact must be a basename');
  try {
    await fs.access(path.join(directory, artifact));
    throw new Error('Operation receipt already exists; do not replay this submission.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.writeFile(path.join(directory, `${artifact}.submitted.json`), JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
