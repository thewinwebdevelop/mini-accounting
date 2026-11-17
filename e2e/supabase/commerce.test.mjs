import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSupabaseRuntime } from '../fixtures/supabase-runtime.fixture.mjs';

async function trackShopeeRunArtifacts(runtime, { shopId, ...identities }) {
  const tokens = [shopId, ...Object.values(identities)].filter(Boolean).map(String);
  const [actions, syncRuns] = await Promise.all([
    runtime.db('commerce_actions?select=idempotency_key,payload'),
    runtime.db('commerce_records?record_type=eq.shopee_sync_run&select=identity_key,payload'),
  ]);
  for (const action of actions) {
    const value = `${action.idempotency_key} ${JSON.stringify(action.payload || {})}`;
    if (tokens.some(token => value.includes(token))) runtime.track('commerce_actions', 'idempotency_key', action.idempotency_key);
  }
  for (const record of syncRuns) {
    if (record.payload?.shopId === shopId) runtime.trackExact('commerce_records', { record_type: 'shopee_sync_run', identity_key: record.identity_key });
  }
}

test('Shopee OAuth, sync, mapping, and reads persist in Supabase', { skip: !process.env.E2E_SUPABASE_CONFIG }, async () => {
  const runtime = await createSupabaseRuntime();
  const shopId = `audit-${runtime.runId}`;
  try {
    const app = await runtime.startApp();
    const auth = await app.request('/api/shopee/authorize', { method: 'POST', body: { origin: app.baseUrl } });
    const authUrl = new URL(auth.authorizationUrl);
    const state = authUrl.searchParams.get('state');
    assert.ok(state);
    runtime.trackExact('commerce_records', { record_type: 'shopee_oauth_state', identity_key: state });
    runtime.trackExact('commerce_records', { record_type: 'shopee_connection', identity_key: shopId });
    runtime.mock.scriptResponse({ provider: 'shopee', endpoint: '/api/v2/auth/token/get', body: { access_token: 'e2e-access', refresh_token: 'e2e-refresh', expire_in: 3600 } });
    const callbackUrl = new URL(`/api/shopee/callback?state=${encodeURIComponent(state)}&code=e2e-code&shop_id=${encodeURIComponent(shopId)}&shop_name=E2E`, app.baseUrl);
    const callback = await fetch(callbackUrl, { headers: { cookie: app.cookie }, redirect: 'manual' });
    assert.equal(callback.status, 302, `${await callback.text()} | ${JSON.stringify(runtime.mock.requests)}`);
    assert.match(callback.headers.get('location'), /connected=1/);
    const second = await runtime.startApp();
    const connected = await second.request(`/api/shopee/connection?shopId=${encodeURIComponent(shopId)}`);
    assert.equal(connected.connection.shopId, shopId);
    runtime.mock.scriptResponse({ provider: 'shopee', endpoint: '/api/v2/order/get_order_list', body: { response: { order_list: [{ order_sn: `${runtime.runId}-order` }], more: false } } });
    runtime.mock.scriptResponse({ provider: 'shopee', endpoint: '/api/v2/order/get_order_detail', body: { response: { order_list: [{ order_sn: `${runtime.runId}-order`, order_status: 'READY_TO_SHIP', item_list: [{ item_id: 'item-1', model_id: 'model-1', model_sku: runtime.runId, item_quantity: 1 }] }] } } });
    runtime.trackExact('commerce_records', { record_type: 'platform_order', identity_key: `${shopId}:${runtime.runId}-order` });
    await second.request('/api/shopee/sync', { method: 'POST', body: { shopId } });
    const orders = await second.request(`/api/platform-orders?shopId=${encodeURIComponent(shopId)}`);
    assert.equal(orders.orders[0].orderNo, `${runtime.runId}-order`);
    const line = orders.orders[0].lines[0];
    const mapped = await second.request(`/api/platform-orders/${encodeURIComponent(line.id)}/sku-mapping`, { method: 'POST', body: { stockSkuId: null } });
    assert.equal(mapped.line.lineNo, line.lineNo);
    const fresh = await runtime.startApp();
    assert.equal((await fresh.request(`/api/platform-orders?shopId=${encodeURIComponent(shopId)}`)).orders.length, 1);
  } finally {
    await trackShopeeRunArtifacts(runtime, { shopId, orderNo: `${runtime.runId}-order` });
    await runtime.stop();
  }
});

test('platform import reserves, posts once, and keeps stock movement idempotent', { skip: !process.env.E2E_SUPABASE_CONFIG }, async () => {
  const runtime = await createSupabaseRuntime();
  const salt = Number.parseInt(runtime.runId.split('-')[1].slice(0, 8), 16);
  const movementDate = new Date(Date.UTC(2190, 0, 1) + (salt % (80 * 365)) * 86400000).toISOString().slice(0, 10);
  const purchaseDate = new Date(`${movementDate}T00:00:00.000Z`);
  purchaseDate.setUTCDate(purchaseDate.getUTCDate() - 1);
  const purchaseMovementDate = purchaseDate.toISOString().slice(0, 10);
  try {
    for (const date of [purchaseMovementDate, movementDate]) {
      assert.deepEqual(await runtime.db(`inventory_movement_sequences?movement_date=eq.${date}`), [], `movement sequence ${date} must be unused before this fixture`);
      runtime.track('inventory_movement_sequences', 'movement_date', date);
    }
    const app = await runtime.startApp({ movementDate });
    const { categories } = await app.request('/api/inventory/categories');
    assert.ok(categories.length, 'fixture migration must provide an active product category');
    const productCode = runtime.runId.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
    const skuCode = `${productCode}-SKU`;
    const saleCode = `${productCode}-SALE`;
    const receiveRef = `${runtime.runId}:receive`;
    const { product } = await app.request('/api/inventory/products', { method: 'POST', body: { productCode, name: runtime.runId, category: categories[0].name } });
    runtime.track('inventory_products', 'source_key', `product:${product.id}`);
    const { stockSku } = await app.request('/api/inventory/stock-skus', { method: 'POST', body: { productId: product.id, sku: skuCode, defaultUnitCost: '12.50' } });
    runtime.track('inventory_stock_skus', 'source_key', `stock_sku:${stockSku.id}`);
    runtime.track('inventory_stock_movements', 'reference_no', receiveRef);
    await app.request('/api/inventory/purchase-in', { method: 'POST', body: { stockSkuId: stockSku.id, movementDate: purchaseMovementDate, quantity: '5', unitCost: '12.50', referenceType: 'manual', referenceNo: receiveRef } });
    const { saleSku } = await app.request('/api/inventory/sale-skus', { method: 'POST', body: { saleSku: saleCode, displayName: runtime.runId, platform: 'shopee', components: [{ stockSkuId: stockSku.id, quantity: '1' }] } });
    runtime.track('inventory_sale_skus', 'source_key', `sale_sku:${saleSku.id}`);
    runtime.trackExact('inventory_bundle_components', { sale_sku_source_id: saleSku.id, stock_sku_source_id: stockSku.id });

    const form = new FormData();
    form.append('file', new Blob([`order_no,sale_sku,quantity\n${runtime.runId}-order,${saleCode},1`], { type: 'text/csv' }), 'e2e-orders.csv');
    const imported = await app.request('/api/platform-orders/imports', { method: 'POST', body: form, headers: { 'x-platform': 'shopee' } });
    assert.equal(imported.import.status, 'ready');
    runtime.track('commerce_records', 'identity_key', imported.import.importNo);
    runtime.track('commerce_idempotency_keys', 'idempotency_key', `import-post:${imported.import.importNo}`);
    const line = imported.lines[0];
    runtime.track('inventory_stock_reservations', 'order_line_key', line.orderLineKey);
    runtime.track('inventory_stock_movements', 'reference_no', line.referenceNo);

    const first = await app.request(`/api/platform-orders/imports/${encodeURIComponent(imported.import.id)}/post`, { method: 'POST' });
    assert.equal(first.import.status, 'posted');
    const second = await app.request(`/api/platform-orders/imports/${encodeURIComponent(imported.import.id)}/post`, { method: 'POST' });
    assert.equal(second.import.status, 'posted');
    const movements = await runtime.db(`inventory_stock_movements?reference_no=eq.${encodeURIComponent(line.referenceNo)}&movement_type=eq.sale_out&select=*`);
    assert.equal(movements.length, 1, 'repeat posting must not create a second stock movement');
    const { balances } = await app.request('/api/inventory/balances');
    assert.equal(Number(balances.find(item => Number(item.id) === Number(stockSku.id))?.quantityOnHand), 4, 'one imported unit must reduce stock exactly once');
    const semanticReplay = await runtime.db('rpc/post_platform_order_import', { method: 'POST', body: {
      p_idempotency_key: `import-post:${imported.import.importNo}`,
      p_import_no: imported.import.importNo,
      p_posted_at: '2099-01-01T00:00:00.000Z',
      p_movement_records: first.postedMovements.map(movement => ({
        source_key: 'retry-generated-key', source_id: 9999999999999999,
        stock_sku_source_id: movement.stock_sku_source_id,
        movement_type: movement.movement_type, movement_date: movement.movement_date,
        quantity: movement.quantity, unit_cost: movement.unit_cost, total_cost: movement.total_cost,
        reference_type: movement.reference_type, reference_no: movement.reference_no,
        note: movement.note, idempotency_key: movement.idempotency_key,
        created_at: '2099-01-01T00:00:00.000Z', source_hash: 'retry-hash', source_payload: { retry: true },
      })),
      p_order_line_keys: [line.orderLineKey],
      p_import_patch: { lines: first.lines.map(item => ({ ...item, postedAt: '2099-01-01T00:00:00.000Z', updatedAt: '2099-01-01T00:00:00.000Z' })) },
    } });
    assert.equal(semanticReplay.applied, true, 'same business posting with fresh transport IDs and timestamps must replay safely');
    await assert.rejects(() => runtime.db('rpc/post_platform_order_import', { method: 'POST', body: {
      p_idempotency_key: `import-post:${imported.import.importNo}`,
      p_import_no: imported.import.importNo,
      p_posted_at: first.import.postedAt,
      p_movement_records: [],
      p_order_line_keys: [],
      p_import_patch: { replayProbe: runtime.runId },
    } }), /409/);
    const fresh = await runtime.startApp();
    const detail = await fresh.request(`/api/platform-orders/imports/${encodeURIComponent(imported.import.id)}`);
    assert.equal(detail.import.status, 'posted');
  } finally {
    await runtime.stop();
  }
});

test('shipment batch arrange, tracking, document lifecycle, overlay, and download persist in Supabase', { skip: !process.env.E2E_SUPABASE_CONFIG }, async () => {
  const runtime = await createSupabaseRuntime();
  const shopId = `ship-${runtime.runId}`;
  const orderNo = `${runtime.runId}-ship-order`;
  try {
    const app = await runtime.startApp();
    const auth = await app.request('/api/shopee/authorize', { method: 'POST', body: { origin: app.baseUrl } });
    const state = new URL(auth.authorizationUrl).searchParams.get('state');
    runtime.trackExact('commerce_records', { record_type: 'shopee_oauth_state', identity_key: state });
    runtime.trackExact('commerce_records', { record_type: 'shopee_connection', identity_key: shopId });
    runtime.mock.scriptResponse({ provider: 'shopee', endpoint: '/api/v2/auth/token/get', body: { access_token: 'shipment-e2e-access', refresh_token: 'shipment-e2e-refresh', expire_in: 3600 } });
    const callback = new URL(`/api/shopee/callback?state=${encodeURIComponent(state)}&code=shipment-e2e&shop_id=${encodeURIComponent(shopId)}`, app.baseUrl);
    assert.equal((await fetch(callback, { headers: { cookie: app.cookie }, redirect: 'manual' })).status, 302);
    runtime.mock.scriptResponse({ provider: 'shopee', endpoint: '/api/v2/order/get_order_list', body: { response: { order_list: [{ order_sn: orderNo }], more: false } } });
    runtime.mock.scriptResponse({ provider: 'shopee', endpoint: '/api/v2/order/get_order_detail', body: { response: { order_list: [{ order_sn: orderNo, order_status: 'READY_TO_SHIP', package_number: 'PKG-E2E', logistics_channel_id: 'channel-e2e', product_location_id: 'loc-e2e', item_list: [{ item_id: 'e2e-item', model_sku: 'e2e-sku', item_quantity: 1 }] }] } } });
    runtime.trackExact('commerce_records', { record_type: 'platform_order', identity_key: `${shopId}:${orderNo}` });
    await app.request('/api/shopee/sync', { method: 'POST', body: { shopId } });
    const order = (await app.request(`/api/platform-orders?shopId=${encodeURIComponent(shopId)}`)).orders[0];
    assert.equal(order.orderNo, orderNo);

    runtime.mock.scriptResponse({ provider: 'shopee', endpoint: '/api/v2/logistics/get_mass_shipping_parameter', body: { response: { pickup: { address_list: [{ address_id: 'address-e2e', full_address: 'Fixture address', time_slot_list: [{ pickup_time_id: 'slot-e2e', label: 'Fixture slot' }] }] } } } });
    const prepared = await app.request('/api/shopee/shipment-batches/prepare', { method: 'POST', body: { connectionId: shopId, orderIds: [order.id] } });
    const batch = prepared.batches[0];
    assert.ok(batch?.id);
    runtime.trackExact('commerce_records', { record_type: 'shipment_batch', identity_key: batch.id });

    await app.request(`/api/shopee/shipment-batches/${encodeURIComponent(batch.id)}/arrange`, { method: 'POST', body: { connectionId: shopId, selection: { addressId: 'address-e2e', pickupTimeId: 'slot-e2e' } } });
    runtime.mock.scriptResponse({ provider: 'shopee', endpoint: '/api/v2/logistics/get_mass_tracking_number', body: { response: { result: [{ package_number: 'PKG-E2E', tracking_number: 'TRACK-E2E' }] } } });
    const tracked = await app.request(`/api/shopee/shipment-batches/${encodeURIComponent(batch.id)}/refresh-tracking`, { method: 'POST', body: { connectionId: shopId } });
    assert.equal(tracked.batch.orders[0].trackingNumber, 'TRACK-E2E');
    runtime.mock.scriptResponse({ provider: 'shopee', endpoint: '/api/v2/logistics/create_shipping_document_job', body: { response: { job_id: `${runtime.runId}-doc-job` } } });
    const created = await app.request(`/api/shopee/shipment-batches/${encodeURIComponent(batch.id)}/create-documents`, { method: 'POST', body: { connectionId: shopId } });
    const job = created.job;
    runtime.trackExact('commerce_records', { record_type: 'shipping_document_job', identity_key: job.id });
    const safeJobId = job.id.replace(/[^A-Za-z0-9._-]+/g, '-');
    const documentPath = `shipping-documents/${safeJobId}.pdf`;
    runtime.trackObject('sweet-house-files', documentPath);
    runtime.mock.scriptResponse({ provider: 'shopee', endpoint: '/api/v2/logistics/get_shipping_document_job_status', body: { response: { status: 'READY' } } });
    const pdf = await readFile(new URL('../../tests/fixtures/shopee-custom-label-sample.pdf', import.meta.url));
    runtime.mock.scriptResponse({ provider: 'shopee', endpoint: '/api/v2/logistics/download_shipping_document_job', body: { response: { file_base64: pdf.toString('base64') } } });
    const polled = await app.request(`/api/shopee/shipping-document-jobs/${encodeURIComponent(job.id)}/poll`, { method: 'POST', body: { connectionId: shopId } });
    assert.equal(polled.job.status, 'ready');
    const downloaded = await fetch(new URL(polled.job.downloadUrl, app.baseUrl), { headers: { cookie: app.cookie } });
    assert.equal(downloaded.status, 200);
    assert.equal((await downloaded.arrayBuffer()).byteLength, pdf.length);

    const overlayPath = `shipping-labels/${encodeURIComponent(batch.id)}.pdf`;
    runtime.trackObject('sweet-house-files', overlayPath);
    const overlay = await app.request(`/api/shopee/shipment-batches/${encodeURIComponent(batch.id)}/overlay-labels`, { method: 'POST', body: { mappings: { [order.id]: { textLines: ['E2E SKU'] } } } });
    assert.equal(overlay.pages.length, 1);
    const previewResponse = await fetch(new URL(overlay.downloadUrl, app.baseUrl), { headers: { cookie: app.cookie } });
    assert.equal(previewResponse.status, 200);
    assert.match(previewResponse.headers.get('content-type'), /application\/pdf/);
    const preview = Buffer.from(await previewResponse.arrayBuffer());
    assert.equal(preview.subarray(0, 4).toString(), '%PDF');

    // Register only action records whose unique payload references this fixture order or batch.
    const actions = await runtime.db('commerce_actions?select=idempotency_key,payload');
    for (const action of actions) {
      const payload = JSON.stringify(action.payload || {});
      if (action.idempotency_key.includes(batch.id) || payload.includes(order.id) || payload.includes(job.id)) {
        runtime.track('commerce_actions', 'idempotency_key', action.idempotency_key);
      }
    }
    const fresh = await runtime.startApp();
    const freshPreview = await fetch(new URL(overlay.downloadUrl, fresh.baseUrl), { headers: { cookie: fresh.cookie } });
    assert.equal(freshPreview.status, 200);
  } finally {
    await trackShopeeRunArtifacts(runtime, { shopId, orderNo });
    await runtime.stop();
  }
});
