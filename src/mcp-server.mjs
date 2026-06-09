#!/usr/bin/env node
import readline from 'node:readline';
import { SketchUpBridge, callTool } from './bridge.mjs';
import { compareSnapshots } from './snapshot-diff.mjs';

const bridge = new SketchUpBridge();
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

const expertOptionProperties = {
  seed: { type: 'number', description: 'Seed for deterministic Expert Mode random helpers.' },
  maxOperations: { type: 'number', description: 'Maximum number of generated DSL operations.' },
  maxLoopIterations: { type: 'number', description: 'Maximum total loop iterations during Expert Mode compilation.' },
  maxStatements: { type: 'number', description: 'Maximum interpreted statement/expression steps during Expert Mode compilation.' },
  maxOutputBytes: { type: 'number', description: 'Maximum compiled JSON DSL output size in bytes.' },
  expertTimeoutMs: { type: 'number', description: 'Expert Mode compiler timeout in milliseconds.' }
};

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
    name: 'queue_diagnostics',
    description: 'Inspect local queue directories, pending requests, orphan responses, and queue lock state without sending a SketchUp request.',
    inputSchema: {
      type: 'object',
      properties: {
        includeFiles: { type: 'boolean', default: false },
        timeoutMs: { type: 'number' }
      }
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
    name: 'compile_expert',
    description: 'Compile a restricted Expert Mode script into the safe JSON DSL without building geometry.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Expert Mode script string.' },
        ...expertOptionProperties
      },
      required: ['code']
    }
  },
  {
    name: 'build_expert_model',
    description: 'Compile a restricted Expert Mode script into JSON DSL, then build it with the selected runtime.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Expert Mode script string.' },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number', description: 'Runtime timeout in milliseconds.' },
        ...expertOptionProperties
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
    name: 'capture_view',
    description: 'Capture the current live SketchUp viewport to an image artifact and return camera/model metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Output image path. Defaults to the queue state captures directory.' },
        view: { type: 'string', enum: ['current', 'top', 'front', 'right', 'left', 'back', 'iso'], default: 'current' },
        width: { type: 'number', default: 1280 },
        height: { type: 'number', default: 720 },
        antialias: { type: 'boolean', default: true },
        compression: { type: 'number', default: 1.0 },
        zoom_extents: { type: 'boolean', default: true },
        runtime: { type: 'string', enum: ['queue'], default: 'queue' },
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
  },
  {
    name: 'validate_model',
    description: 'Build or inspect a model snapshot, run semantic layout QA, and return orthographic SVG/HTML previews plus correction suggestions.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JSON DSL string. Required unless snapshot is provided.' },
        snapshot: { type: 'object', description: 'Existing build_model snapshot. If provided, code is not required.' },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number' },
        spec: { type: 'object', description: 'Optional model QA spec with contacts, inside, support, and separation rules.' },
        includePreview: { type: 'boolean', default: true },
        strictCollisions: { type: 'boolean', default: true },
        strictUnanchored: { type: 'boolean', default: false },
        floatingDetails: { type: 'boolean', default: true }
      }
    }
  },
  {
    name: 'validate_reference_model',
    description: 'Build or inspect a model snapshot, run reference visual QA against orthographic silhouette/keypoint/area rules, and return PartGraph-targeted correction suggestions.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JSON DSL string. Required unless snapshot is provided.' },
        snapshot: { type: 'object', description: 'Existing build_model snapshot. If provided, code is not required.' },
        runtime: { type: 'string', enum: ['mock', 'queue'], default: 'mock' },
        timeoutMs: { type: 'number' },
        spec: { type: 'object', description: 'Reference visual QA spec with views, silhouettes, keypoints, area ratios, and relative-position rules.' },
        includePreview: { type: 'boolean', default: true }
      }
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
