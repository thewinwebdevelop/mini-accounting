import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseRuntime } from '../fixtures/supabase-runtime.fixture.mjs';

test('vendor create/update/list persists across fresh app instances with exact cleanup', { skip: !process.env.E2E_SUPABASE_CONFIG }, async () => {
  const runtime = await createSupabaseRuntime();
  try {
    const first = await runtime.startApp();
    // Register the unique business key before creation so failed HTTP responses
    // still leave a cleanup target.
    runtime.track('vendors', 'name', runtime.runId);
    const { vendor } = await first.request('/api/vendors', { method: 'POST', body: { name: runtime.runId, phone: '0800000000' } });
    assert.ok(vendor.id);
    const next = await runtime.startApp();
    const persisted = await next.request(`/api/vendors/${encodeURIComponent(vendor.id)}`);
    assert.equal(persisted.vendor.name, runtime.runId);
    const updated = await next.request(`/api/vendors/${encodeURIComponent(vendor.id)}`, { method: 'PATCH', body: { phone: '0811111111', status: 'inactive' } });
    assert.equal(updated.vendor.phone, '0811111111');
    assert.equal(updated.vendor.status, 'inactive');
    const reread = await first.request(`/api/vendors/${encodeURIComponent(vendor.id)}`);
    assert.equal(reread.vendor.phone, '0811111111');
  } finally { await runtime.stop(); }
});

test('user profile and position selection persist across app instances', { skip: !process.env.E2E_SUPABASE_CONFIG }, async () => {
  const runtime = await createSupabaseRuntime();
  runtime.track('app_user_profiles', 'user_id', runtime.userId);
  try {
    const first = await runtime.startApp();
    const { positions } = await first.request('/api/company-positions');
    assert.ok(positions.length);
    const { profile } = await first.request('/api/auth/profile', { method: 'PATCH', body: { firstName: runtime.runId, lastName: 'Test', companyPositionId: positions[0].id } });
    assert.equal(profile.firstName, runtime.runId);
    const second = await runtime.startApp();
    const fresh = await second.request('/api/auth/profile');
    assert.equal(fresh.profile.firstName, runtime.runId);
    assert.equal(fresh.profile.companyPositionId, positions[0].id);
  } finally { await runtime.stop(); }
});

test('company settings persist across instances without using local configuration', { skip: !process.env.E2E_SUPABASE_CONFIG }, async () => {
  const runtime = await createSupabaseRuntime();
  try {
    assert.deepEqual(await runtime.db('company_settings?setting_key=eq.default'), [], 'Use isolated Supabase; existing company settings must not be overwritten');
    runtime.track('company_settings', 'setting_key', 'default');
    const first = await runtime.startApp();
    await first.request('/api/company-settings', { method: 'POST', body: { legalName: runtime.runId, taxId: '0105559999999', address: 'E2E address', branch: 'E2E branch' } });
    const second = await runtime.startApp();
    const persisted = await second.request('/api/company-settings');
    assert.equal(persisted.legalName, runtime.runId);
    assert.equal(persisted.address, 'E2E address');
  } finally { await runtime.stop(); }
});
