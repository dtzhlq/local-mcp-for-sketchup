import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createHttpConfig, createHttpServer } from '../src/http-server.mjs';
import { listToolNames } from '../src/tool-registry.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-http-server-'));
const externalRoot = path.join(root, 'external-models');
await fs.mkdir(externalRoot, { recursive: true });
const sessionSecret = 'test-session-secret-32-bytes-long';
const server = createHttpServer({
  port: 0,
  sessionSecret,
  stateDir: path.join(root, 'state'),
  allowedRoots: [externalRoot],
  maxBodyBytes: 256,
  toolTimeoutMs: 1000,
  requestTimeoutMs: 1500
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

try {
  const config = createHttpConfig({ sessionSecret });
  assert.equal(config.host, '127.0.0.1', 'HTTP must bind loopback by default');
  assert.throws(
    () => createHttpConfig({ host: '0.0.0.0', sessionSecret }),
    /Non-loopback HTTP binding requires/,
    'non-loopback binding must require an explicit override'
  );

  const health = await request({ port, method: 'GET', pathname: '/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.body.auth_required, true);

  const tools = await request({ port, method: 'GET', pathname: '/tools' });
  assert.equal(tools.statusCode, 200);
  assert.equal(tools.body.count, 36);
  assert.deepEqual(tools.body.tools, listToolNames(), 'HTTP and stdio must derive from the same tool registry');
  assert.ok(tools.body.tools.includes('prepare_existing_model_edit'));
  assert.ok(tools.body.tools.includes('apply_reviewed_model_edit'));

  const unauthorized = await request({ port, method: 'POST', pathname: '/tools/get_docs', body: {} });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.body.error.code, 'AUTH_REQUIRED');

  const invalidJson = await request({
    port,
    method: 'POST',
    pathname: '/tools/get_docs',
    headers: authorization(sessionSecret),
    rawBody: '{invalid'
  });
  assert.equal(invalidJson.statusCode, 400);
  assert.equal(invalidJson.body.error.code, 'INVALID_JSON');

  const tooLarge = await request({
    port,
    method: 'POST',
    pathname: '/tools/get_docs',
    headers: authorization(sessionSecret),
    body: { padding: 'x'.repeat(512) }
  });
  assert.equal(tooLarge.statusCode, 413);
  assert.equal(tooLarge.body.error.code, 'BODY_TOO_LARGE');

  const escapedPath = await request({
    port,
    method: 'POST',
    pathname: '/tools/get_docs',
    headers: authorization(sessionSecret),
    body: { path: '/private/alma-secret-model.skp' }
  });
  assert.equal(escapedPath.statusCode, 403);
  assert.equal(escapedPath.body.error.code, 'PATH_NOT_ALLOWED');
  assert.equal(JSON.stringify(escapedPath.body).includes('/private/alma-secret-model.skp'), false, 'path errors must not echo sensitive paths');

  const escapedTexture = await request({
    port,
    method: 'POST',
    pathname: '/tools/get_docs',
    headers: authorization(sessionSecret),
    body: { code: JSON.stringify({ operations: [{ op: 'material', pbr: { textures: { normal: '/private/normal.png' } } }] }) }
  });
  assert.equal(escapedTexture.statusCode, 403);
  assert.equal(escapedTexture.body.error.code, 'PATH_NOT_ALLOWED');

  const configuredExternalPath = await request({
    port,
    method: 'POST',
    pathname: '/tools/get_docs',
    headers: authorization(sessionSecret),
    body: { path: path.join(externalRoot, 'allowed.skp') }
  });
  assert.equal(configuredExternalPath.statusCode, 200, 'explicitly configured external model roots must be usable');

  const missingModel = path.join(process.cwd(), 'output', 'definitely-missing-http-model.json');
  const internalFailure = await request({
    port,
    method: 'POST',
    pathname: '/tools/open_model',
    headers: authorization(sessionSecret),
    body: { path: missingModel, runtime: 'mock' }
  });
  assert.equal(internalFailure.statusCode, 500);
  assert.equal(internalFailure.body.error.code, 'INTERNAL_ERROR');
  assert.equal(JSON.stringify(internalFailure.body).includes(missingModel), false, 'internal errors must not echo filesystem details');

  process.stdout.write(`${JSON.stringify({ ok: true, tools: tools.body.count, tests: 11 }, null, 2)}\n`);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
}

function authorization(secret) {
  return { authorization: `Bearer ${secret}` };
}

function request({ port, method, pathname, headers = {}, body, rawBody }) {
  const payload = rawBody ?? (body === undefined ? null : JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: pathname,
      headers: {
        ...headers,
        ...(payload === null ? {} : {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload)
        })
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try {
          resolve({ statusCode: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}
