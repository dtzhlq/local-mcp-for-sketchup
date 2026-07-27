#!/usr/bin/env node
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');

export function validateDcoCommit({ sha, authorEmail, message }) {
  const signoffs = String(message || '')
    .split(/\r?\n/)
    .map((line) => line.match(/^Signed-off-by:\s*(.+?)\s*<([^<>]+)>\s*$/i))
    .filter(Boolean)
    .map((match) => ({ name: match[1].trim(), email: match[2].trim().toLowerCase() }));
  const normalizedAuthor = String(authorEmail || '').trim().toLowerCase();
  return Object.freeze({
    sha,
    passed: signoffs.some((entry) => entry.email === normalizedAuthor),
    author_email: normalizedAuthor,
    signoffs
  });
}

export async function checkDcoRange({ base, head, cwd = repoRoot }) {
  if (!/^[0-9a-f]{7,40}$/i.test(String(base || '')) || !/^[0-9a-f]{7,40}$/i.test(String(head || ''))) {
    throw codedError('DCO_REVISION_REQUIRED', '--base and --head must be commit IDs.');
  }
  const { stdout } = await execFileAsync('git', ['rev-list', '--reverse', `${base}..${head}`], { cwd });
  const commits = stdout.trim().split(/\r?\n/).filter(Boolean);
  const results = [];
  for (const sha of commits) {
    const { stdout: record } = await execFileAsync('git', [
      'show', '-s', '--format=%H%x00%ae%x00%B', sha
    ], { cwd, maxBuffer: 2_000_000 });
    const [resolvedSha, authorEmail, ...messageParts] = record.split('\0');
    results.push(validateDcoCommit({
      sha: resolvedSha,
      authorEmail,
      message: messageParts.join('\0')
    }));
  }
  return Object.freeze({
    passed: results.every((item) => item.passed),
    commit_count: results.length,
    failures: results.filter((item) => !item.passed).map((item) => ({
      sha: item.sha,
      author_email: item.author_email
    }))
  });
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base') options.base = argv[++index];
    else if (argv[index] === '--head') options.head = argv[++index];
    else throw codedError('DCO_ARGUMENT_UNKNOWN', `Unknown argument: ${argv[index]}`);
  }
  return options;
}

if (path.resolve(process.argv[1] || '') === scriptPath) {
  const report = await checkDcoRange(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
