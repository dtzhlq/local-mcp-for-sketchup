import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const sessionDir = path.join(projectRoot, '.session');
export const mockSessionPath = path.join(sessionDir, 'mock-model.json');
export const defaultStateDir = path.resolve(process.env.LOCAL_MCP_FOR_SKETCHUP_STATE_DIR || path.join(os.homedir(), '.local-mcp-for-sketchup'));
export const defaultQueueDir = path.resolve(process.env.LOCAL_MCP_FOR_SKETCHUP_QUEUE_DIR || path.join(defaultStateDir, 'queue'));
export const defaultResponseDir = path.resolve(process.env.LOCAL_MCP_FOR_SKETCHUP_RESPONSE_DIR || path.join(defaultStateDir, 'responses'));
