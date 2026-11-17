import { test, expect } from '@playwright/test';
import { createSupabaseRuntime } from '../fixtures/supabase-runtime.fixture.mjs';
import { VendorMasterPage } from '../pages/vendor-master.page.mjs';

test('vendor browser creation, duplicate confirmation and activation persist in Supabase', async ({ browser }) => {
  test.skip(!process.env.E2E_SUPABASE_CONFIG, 'Requires isolated local Supabase');
  const runtime = await createSupabaseRuntime();
  let context;
  try {
    const app = await runtime.startApp();
    runtime.track('vendors', 'name', runtime.runId);
    runtime.track('vendors', 'name', `${runtime.runId} copy`);
    context = await browser.newContext({ baseURL: app.baseUrl });
    const equals = app.cookie.indexOf('=');
    await context.addCookies([{ name: app.cookie.slice(0, equals), value: app.cookie.slice(equals + 1), url: app.baseUrl }]);
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(app.baseUrl).origin ? route.continue() : route.abort());
    const page = await context.newPage();
    const vendors = new VendorMasterPage(page);
    await vendors.open();
    const taxId = `010555${String(Date.now()).slice(-7)}`;
    const created = await vendors.create({ name: runtime.runId, taxId });
    expect(created.id).toBeTruthy();
    await vendors.expectVisible(runtime.runId);
    const duplicate = await vendors.expectDuplicateConfirmation({ name: `${runtime.runId} copy`, taxId });
    expect(duplicate.vendor.name).toBe(`${runtime.runId} copy`);
    await vendors.deactivate(created.id);
    await vendors.expectStatus(created.id, 'inactive');
    await vendors.reactivate(created.id);
    const fresh = await runtime.startApp();
    expect((await fresh.request(`/api/vendors/${created.id}`)).vendor.status).toBe('active');
  } finally { await context?.close(); await runtime.stop(); }
});
