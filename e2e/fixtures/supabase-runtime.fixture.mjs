import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { createAppServer, assertNoProductionSecrets } from './app-server.fixture.mjs';
import { createMockProviders } from './mock-providers.mjs';
import { createTestSession, SESSION_NAME } from './auth.fixture.mjs';

// Config comes from `supabase status -o json`, never from the production .env.
export async function createSupabaseRuntime({ configPath = process.env.E2E_SUPABASE_CONFIG } = {}) {
  assertNoProductionSecrets();
  if (!configPath) throw new Error('E2E_SUPABASE_CONFIG is required');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const url = config.API_URL;
  if (!['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname)) throw new Error('Supabase E2E only allows loopback');
  const serviceRoleKey = config.SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error('Local Supabase service key missing');
  const runId = `e2e-${randomUUID()}`;
  const userId = randomUUID();
  const cleanup = [];
  const storageObjects = [];
  const roots = [];
  const apps = [];
  const headers = { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, 'content-type': 'application/json' };
  let casBarrier = null;
  const proxy = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      if (casBarrier && request.url?.startsWith('/rest/v1/rpc/compare_and_swap_document')) {
        const barrier = casBarrier;
        barrier.arrivals += 1;
        if (barrier.arrivals >= 2) {
          casBarrier = null;
          for (const release of barrier.releases) release();
        } else {
          await new Promise(resolve => barrier.releases.push(resolve));
        }
      }
      const upstream = await fetch(new URL(request.url, url), {
        method: request.method,
        headers: Object.fromEntries(Object.entries(request.headers).filter(([name]) => !['host', 'connection', 'content-length'].includes(name.toLowerCase()))),
        body,
      });
      const responseBody = Buffer.from(await upstream.arrayBuffer());
      response.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
      response.end(responseBody);
    } catch (error) {
      response.writeHead(502, { 'content-type': 'text/plain' });
      response.end(`Local Supabase test proxy failed: ${error.message}`);
    }
  });
  await new Promise((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(0, '127.0.0.1', resolve);
  });
  const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
  async function db(route, { method = 'GET', body } = {}) {
    const response = await fetch(`${url}/rest/v1/${route}`, { method, headers: { ...headers, Prefer: 'return=representation' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    if (!response.ok) throw new Error(`Local Supabase ${method} ${route}: ${response.status} ${text}`);
    return text ? JSON.parse(text) : null;
  }
  function track(table, column, value) {
    if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(column) || value == null || value === '') throw new Error('Cleanup requires an exact record identity');
    cleanup.push({ table, query: `${column}=eq.${encodeURIComponent(value)}` });
  }
  function trackExact(table, filters) {
    if (!/^[a-z_]+$/.test(table) || !filters || typeof filters !== 'object' || !Object.keys(filters).length) throw new Error('Cleanup requires exact record filters');
    const entries = Object.entries(filters);
    if (entries.some(([column, value]) => !/^[a-z_]+$/.test(column) || value == null || value === '')) throw new Error('Cleanup requires exact record filters');
    cleanup.push({ table, query: entries.map(([column, value]) => `${column}=eq.${encodeURIComponent(value)}`).join('&') });
  }
  let mock;
  async function stop() {
    const errors = [];
    for (const app of apps) await app.stop().catch(error => errors.push(error));
    for (const { bucket, objectPath } of storageObjects) {
      try {
        const result = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}`, { method: 'DELETE', headers, body: JSON.stringify({ prefixes: [objectPath] }) });
        assert.ok(result.ok, `Storage cleanup failed: ${result.status}`);
        const probe = await fetch(`${url}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${objectPath.split('/').map(encodeURIComponent).join('/')}`, { headers });
        assert.ok([400, 404].includes(probe.status), `test object remains: ${objectPath}`);
      } catch (error) { errors.push(error); }
    }
    for (const { table, query } of cleanup.reverse()) {
      try { await db(`${table}?${query}`, { method: 'DELETE' }); assert.deepEqual(await db(`${table}?select=*&${query}`), [], `test records remain in ${table}`); }
      catch (error) { errors.push(error); }
    }
    if (mock) await mock.stop().catch(error => errors.push(error));
    for (const root of roots) await rm(root, { recursive: true, force: true });
    await new Promise(resolve => proxy.close(resolve));
    if (errors.length) throw new AggregateError(errors, 'E2E cleanup failed');
  }
  const secret = `e2e-secret-${randomUUID()}`;
  const token = createTestSession({ userId, lineUserId: runId, role: 'admin', secret });
  async function startApp({ movementDate } = {}) {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'sweet-house-real-supabase-'));
    roots.push(rootDir);
    const env = { PATH: process.env.PATH, NODE_ENV: 'test', CLOUD_RUN: '1', DATA_BACKEND_DOCUMENTS: 'supabase-read', SWEET_HOUSE_AUTH_MODE: 'line', SWEET_HOUSE_SESSION_SECRET: secret,
      SWEET_HOUSE_PYTHON_BIN: process.env.SWEET_HOUSE_PYTHON_BIN || '',
      LINE_CHANNEL_SECRET: 'e2e-line-channel-secret', LINE_CHANNEL_ACCESS_TOKEN: 'e2e-line-token', LINE_CHANNEL_ID: 'e2e-line',
      SHOPEE_PARTNER_ID: '1', SHOPEE_PARTNER_KEY: 'e2e-shopee-key', SHOPEE_API_BASE_URL: mock.baseUrls.shopee,
      LINE_VERIFY_URL: `${mock.baseUrls.line}/oauth2/v2.1/verify`, LINE_CONTENT_BASE_URL: mock.baseUrls.line,
      SWEET_HOUSE_E2E_MOVEMENT_DATE: movementDate || '',
      LINE_REPLY_URL: `${mock.baseUrls.line}/v2/bot/message/reply`, LINE_OCR_PROVIDER: 'http', LINE_OCR_API_KEY: 'e2e-key', LINE_OCR_API_URL: mock.baseUrls.ocr,
      GOOGLE_API_BASE_URL: mock.baseUrls.google, GOOGLE_OAUTH_TOKEN_URL: `${mock.baseUrls.google}/token` };
    const app = await createAppServer({ env, rootDir, mockBaseUrl: mock.baseUrls.supabase, supabase: { url: proxyUrl, serviceRoleKey } });
    apps.push(app);
    return { ...app, cookie: `${SESSION_NAME}=${token}`, request: async (route, { method = 'GET', body, headers = {} } = {}) => {
      const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
      const requestHeaders = { cookie: `${SESSION_NAME}=${token}`, ...headers };
      if (!isFormData && !Object.keys(requestHeaders).some(key => key.toLowerCase() === 'content-type')) {
        requestHeaders['content-type'] = 'application/json';
      }
      const response = await fetch(new URL(route, app.baseUrl), { method, headers: requestHeaders, body: body === undefined ? undefined : (isFormData ? body : JSON.stringify(body)) });
      const text = await response.text();
      if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${text}`);
      return text ? JSON.parse(text) : null;
    } };
  }
  try {
    track('app_users', 'id', userId);
    await db('app_users', { method: 'POST', body: { id: userId, line_user_id: runId, display_name: runId, status: 'active' } });
    await db('app_user_roles', { method: 'POST', body: { user_id: userId, role_code: 'admin' } });
    mock = await createMockProviders({ profile: 'local', runId });
    return { runId, userId, db, track, trackExact, startApp, stop, url, mock, async readObject(bucket, objectPath) {
      const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
      const response = await fetch(`${url}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encodedPath}`, { headers });
      if (!response.ok) throw new Error(`Storage read failed: ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    }, async proxyRequest(route, { method = 'POST', body } = {}) {
      const response = await fetch(`${proxyUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    }, armDocumentCasBarrier() {
      if (casBarrier) throw new Error('CAS barrier is already armed');
      casBarrier = { arrivals: 0, releases: [] };
    }, trackObject(bucket, objectPath) {
      if (!bucket || !objectPath) throw new Error('Storage cleanup requires exact object path');
      storageObjects.push({ bucket, objectPath });
    } };
  } catch (error) { await stop(); throw error; }
}
