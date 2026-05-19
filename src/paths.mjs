import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const sessionDir = path.join(projectRoot, '.session');
export const mockSessionPath = path.join(sessionDir, 'mock-model.json');
export const defaultStateDir = path.join(os.homedir(), '.sketchup-mcp-replica');
export const defaultQueueDir = path.join(defaultStateDir, 'queue');
export const defaultResponseDir = path.join(defaultStateDir, 'responses');
