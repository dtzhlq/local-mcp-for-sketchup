#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const target = path.join(repoRoot, 'external-datasets/wikimedia-commons/interior-hallway-2013/hallway.jpg');
const sourceUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/Hallway.jpg/960px-Hallway.jpg';
const expectedSha256 = 'e25e46c5a3743c0d215eace59b34a23752436581228e9be271a76827b4f3a7d7';

export async function prepareInteriorHallwaySample() {
  await fs.mkdir(path.dirname(target), { recursive: true });
  let buffer = null;
  try {
    buffer = await fs.readFile(target);
  } catch {
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`hallway_download_failed:${response.status}`);
    buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(target, buffer);
  }
  const actualSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  if (actualSha256 !== expectedSha256) {
    throw new Error(`hallway_checksum_mismatch:${actualSha256}`);
  }
  return {
    ok: true,
    local_path: path.relative(repoRoot, target),
    sha256: actualSha256,
    source_page: 'https://commons.wikimedia.org/wiki/File:Hallway.jpg',
    author: 'Isadoradel',
    license: 'CC BY-SA 3.0',
    dataset_committed: false
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await prepareInteriorHallwaySample(), null, 2));
}
