import { test, expect } from '@playwright/test';
import { createSupabaseRuntime } from '../fixtures/supabase-runtime.fixture.mjs';
import { InventoryPage } from '../pages/inventory.page.mjs';

test('create parent product and stock SKU through the browser and read from a fresh instance', async ({ browser }) => {
  test.skip(!process.env.E2E_SUPABASE_CONFIG, 'Requires isolated local Supabase');
  const runtime = await createSupabaseRuntime();
  let context;
  try {
    const first = await runtime.startApp();
    const code = runtime.runId.toUpperCase();
    const categoryName = `Category ${runtime.runId}`;
    runtime.track('inventory_product_categories', 'name', categoryName);
    runtime.track('inventory_products', 'product_code', code);
    runtime.track('inventory_stock_skus', 'sku', code);
    context = await browser.newContext({ baseURL: first.baseUrl });
    const equals = first.cookie.indexOf('=');
    await context.addCookies([{ name: first.cookie.slice(0, equals), value: first.cookie.slice(equals + 1), url: first.baseUrl }]);
    // Keep browser traffic within the fixture, including the optional LINE SDK.
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(first.baseUrl).origin ? route.continue() : route.abort());
    const page = await context.newPage();
    const inventory = new InventoryPage(page, first);
    await inventory.createCategory(categoryName);
    const product = await inventory.createProduct({ productCode: code, name: runtime.runId, category: categoryName });
    expect(product.id).toBeTruthy();
    const sku = await inventory.createSku({ productId: product.id, sku: code });
    expect(sku.id).toBeTruthy();
    const second = await runtime.startApp();
    const detail = await second.request(`/api/inventory/products/${product.id}/detail`);
    expect(detail.product.productCode).toBe(code);
    expect(detail.children.some(item => item.id === sku.id)).toBe(true);
  } finally {
    await context?.close();
    await runtime.stop();
  }
});
