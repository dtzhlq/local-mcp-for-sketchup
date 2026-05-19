#!/usr/bin/env node
import readline from 'node:readline';
import { SketchUpBridge, callTool } from './bridge.mjs';
import { compareSnapshots } from './snapshot-diff.mjs';

const bridge = new SketchUpBridge();
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

const tools = [
  {
    name: 'get_docs',
    description: 'Return the safe SketchUp JSON DSL and runtime documentation.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'get_capabilities',
    description: 'Return runtime capability descriptors, using a live SketchUp plugin handshake for queue runtime.',
    inputSchema: {
      type: 'object',
      properties: { runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' }, timeoutMs: { type: 'number' } }
    }
  },
  {
    name: 'build_model',
    description: 'Build model geometry from a safe JSON DSL string and return a structured snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JSON DSL string.' },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number' }
      },
      required: ['code']
    }
  },
  {
    name: 'reset_model',
    description: 'Reset the current model session and return an empty snapshot.',
    inputSchema: {
      type: 'object',
      properties: { runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' }, timeoutMs: { type: 'number' } }
    }
  },
  {
    name: 'save_model',
    description: 'Save the current model session and return a file path plus snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        keep_session: { type: 'boolean', default: true },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number' }
      }
    }
  },
  {
    name: 'compare_snapshots',
    description: 'Compare two structured snapshots and return a diff report.',
    inputSchema: {
      type: 'object',
      properties: {
        expected: { type: 'object' },
        actual: { type: 'object' },
        toleranceMm: { type: 'number', default: 1 },
        budgets: { type: 'object' },
        topIssueLimit: { type: 'number', default: 10 }
      },
      required: ['expected', 'actual']
    }
  },
  {
    name: 'compare_model',
    description: 'Build the same DSL with two runtimes and return a snapshot parity QA report.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JSON DSL string.' },
        expected_runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        actual_runtime: { type: 'string', enum: ['mock', 'queue'], default: 'queue' },
        timeoutMs: { type: 'number' },
        reset_first: { type: 'boolean', default: true },
        toleranceMm: { type: 'number', default: 1 },
        budgets: { type: 'object' },
        topIssueLimit: { type: 'number', default: 10 },
        include_snapshots: { type: 'boolean', default: false }
      },
      required: ['code']
    }
  }
];

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
    await handleRequest(request);
  } catch (error) {
    respond(request?.id ?? null, null, error);
  }
});

async function handleRequest(request) {
  if (request.method === 'initialize') {
    return respond(request.id, {
      protocolVersion: request.params?.protocolVersion || '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'sketchup-mcp-replica', version: '0.1.0' }
    });
  }

  if (request.method === 'notifications/initialized') return;

  if (request.method === 'tools/list') {
    return respond(request.id, { tools });
  }

  if (request.method === 'tools/call') {
    const name = request.params?.name;
    const args = request.params?.arguments || {};
    const result = name === 'compare_snapshots'
      ? compareSnapshots(normalizeSnapshotArgument(args.expected), normalizeSnapshotArgument(args.actual), { toleranceMm: args.toleranceMm, budgets: args.budgets, topIssueLimit: args.topIssueLimit })
      : await callTool(name, args, bridge);
    return respond(request.id, {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    });
  }

  throw new Error(`Unsupported MCP method: ${request.method}`);
}

function normalizeSnapshotArgument(document) {
  if (!document?.snapshot) return document;
  return {
    ...document.snapshot,
    artifact_size_bytes: document.snapshot.artifact_size_bytes ?? document.file_size_bytes
  };
}

function respond(id, result, error) {
  const payload = error
    ? { jsonrpc: '2.0', id, error: { code: -32000, message: error.message } }
    : { jsonrpc: '2.0', id, result };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
