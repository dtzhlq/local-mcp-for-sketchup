import fs from 'node:fs/promises';
import { runImageStructureHelper } from '../src/image-structure.mjs';
const [image,method='boundaries']=process.argv.slice(2);
if(!image)throw new Error('usage: node scripts/image-structure-evidence.mjs IMAGE [lines|contours|boundaries]');
console.log(JSON.stringify(await runImageStructureHelper(method,await fs.readFile(image))));
