#!/usr/bin/env node
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SketchUpBridge } from './bridge.mjs';
import { cleanupOwnedQueueArtifacts } from './queue-runtime.mjs';

export { TOOL_REGISTRY } from './tool-registry.mjs';

import { McpProtocol } from './mcp-protocol.mjs';

async function main() {
  const bridge = new SketchUpBridge();
  const protocol = new McpProtocol(bridge);
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    rl.close();
    await cleanupOwnedQueueArtifacts();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let request;
    try {
      request = JSON.parse(line);
      const response = await protocol.handle(request);
      if(response) process.stdout.write(JSON.stringify(response)+'\n');
    } catch (error) {
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request?.id??null,error:{code:-32700,message:'Invalid JSON'}})+'\n');
    }
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
