#!/usr/bin/env node
import http from 'node:http';
import { SketchUpBridge, callTool } from './bridge.mjs';
import { compareSnapshots } from './snapshot-diff.mjs';
import { PRODUCT_VERSION } from './version.mjs';

const bridge = new SketchUpBridge();
const port = Number(process.env.PORT || 3977);

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/health') {
      return sendJson(response, 200, { ok: true, name: 'sketchup-mcp-replica', version: PRODUCT_VERSION });
    }

    if (request.method === 'GET' && request.url === '/tools') {
      return sendJson(response, 200, { tools: ['get_docs', 'get_workflow_bundle', 'get_capabilities', 'queue_diagnostics', 'prepare_image_modeling_brief', 'compile_reviewed_part_graph', 'build_model', 'compile_expert', 'compile_python_sdk', 'build_expert_model', 'reset_model', 'save_model', 'save_model_version', 'open_model', 'import_model', 'export_model', 'get_model_info', 'list_entities', 'inspect_model', 'adopt_open_model', 'resolve_model_targets', 'get_selection', 'analyze_selection_geometry', 'plan_modification_intent', 'set_selection', 'capture_view', 'run_ruby_expert', 'evaluate_py', 'build_report', 'iterate_model', 'compare_snapshots', 'compare_model', 'validate_model', 'validate_reference_model'] });
    }

    if (request.method === 'POST' && request.url?.startsWith('/tools/')) {
      const tool = decodeURIComponent(request.url.split('/').pop());
      const body = await readJson(request);
      const result = tool === 'compare_snapshots'
        ? compareSnapshots(normalizeSnapshotArgument(body.expected), normalizeSnapshotArgument(body.actual), { toleranceMm: body.toleranceMm, budgets: body.budgets, topIssueLimit: body.topIssueLimit })
        : await callTool(tool, body || {}, bridge);
      return sendJson(response, 200, result);
    }

    sendJson(response, 404, { error: 'not_found' });
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(port, () => {
  process.stderr.write(`SketchUp MCP replica HTTP bridge listening on http://127.0.0.1:${port}\n`);
});

function normalizeSnapshotArgument(document) {
  if (!document?.snapshot) return document;
  return {
    ...document.snapshot,
    artifact_size_bytes: document.snapshot.artifact_size_bytes ?? document.file_size_bytes
  };
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error.message}`));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}
