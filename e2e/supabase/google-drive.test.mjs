import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseRuntime } from '../fixtures/supabase-runtime.fixture.mjs';

test('Google Drive configuration survives a fresh app instance', { skip: !process.env.E2E_SUPABASE_CONFIG }, async () => {
  const runtime = await createSupabaseRuntime();
  try {
    const existing = await runtime.db('integration_credentials?credential_key=in.(google-drive-config,google-drive-token)');
    assert.deepEqual(existing, [], 'Use an isolated Supabase database; existing Google credentials must not be overwritten');
    runtime.track("integration_credentials", "credential_key", "google-drive-config");
    runtime.track("integration_credentials", "credential_key", "google-drive-token");
    const first = await runtime.startApp();
    await first.request('/api/google-drive/config', { method: 'POST', body: { clientId: runtime.runId, clientSecret: 'e2e-secret', driveBasePath: runtime.runId } });
    const second = await runtime.startApp();
    const status = await second.request('/api/google-drive/status');
    assert.equal(status.clientId, runtime.runId);
    assert.equal(status.configured, true);
    assert.equal(status.clientSecretSaved, true);
    assert.equal(status.clientSecret, undefined);
    runtime.mock.scriptResponse({ provider: "google", endpoint: "/token", body: { access_token: "e2e-access", refresh_token: "e2e-refresh", expires_in: 3600, scope: "drive.file" } });
    const callback = await fetch(new URL('/api/google-drive/oauth2callback?code=e2e-code', second.baseUrl), { headers: { cookie: second.cookie }, redirect: 'manual' });
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get('location'), '/google-drive?auth=success');
    const after = await first.request('/api/google-drive/status');
    assert.equal(after.authenticated, true);
    assert.equal(after.scope, 'drive.file');
  } finally { await runtime.stop(); }
});
