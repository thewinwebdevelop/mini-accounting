import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createSupabaseRuntime } from '../fixtures/supabase-runtime.fixture.mjs';

const require = createRequire(import.meta.url);
const { createSupabaseAdminClient, supabaseRequest } = require('../../forms/supabase.logic.js');
const { createInventoryCloudRepository } = require('../../forms/inventory-cloud.repository.js');

test('inventory movements, reservations, bundles, image metadata and reports persist in local Supabase and clean up', {
  skip: !process.env.E2E_SUPABASE_CONFIG,
}, async () => {
  const runtime = await createSupabaseRuntime();
  const config = JSON.parse(await readFile(process.env.E2E_SUPABASE_CONFIG, 'utf8'));
  const client = createSupabaseAdminClient({ url: runtime.url, serviceRoleKey: config.SERVICE_ROLE_KEY });
  const inventory = createInventoryCloudRepository({ client });
  const tag = runtime.runId.replace(/[^a-z0-9]/gi, '').toUpperCase();
  const orderLineKey = `e2e-inventory:${runtime.runId}`;
  const movementDate = '2199-12-31';
  const receiptNo = 'SR-2199-12-9876';
  let app;
  let category;
  let product;
  let stockSku;
  let saleSku;
  const movementIds = new Set();
  let imagePath = '';
  let skuImagePath = '';

  try {
    assert.deepEqual(await runtime.db(`inventory_movement_sequences?movement_date=eq.${movementDate}&select=movement_date`), [],
      `reserved E2E movement date ${movementDate} already has a sequence; refusing to mutate it`);
    runtime.track('inventory_movement_sequences', 'movement_date', movementDate);
    app = await runtime.startApp();
    category = (await app.request('/api/inventory/categories', { method: 'POST', body: { name: `E2E ${runtime.runId}` } })).category;
    runtime.track('inventory_product_categories', 'source_id', category.id);
    await assert.rejects(app.request('/api/inventory/categories', { method: 'POST', body: { name: category.name } }),
      /หมวดสินค้านี้มีอยู่แล้ว/);

    product = (await app.request('/api/inventory/products', { method: 'POST', body: {
      productCode: tag, name: `E2E ${runtime.runId}`, category: category.name,
    } })).product;
    runtime.track('inventory_products', 'source_id', product.id);
    await assert.rejects(app.request('/api/inventory/products', { method: 'POST', body: {
      productCode: tag, name: `duplicate ${runtime.runId}`, category: category.name,
    } }), /รหัสสินค้าแม่นี้มีอยู่แล้ว/);

    stockSku = (await app.request('/api/inventory/stock-skus', { method: 'POST', body: {
      productId: product.id, sku: tag, defaultUnitCost: 2,
    } })).stockSku;
    runtime.track('inventory_stock_skus', 'source_id', stockSku.id);
    await assert.rejects(app.request('/api/inventory/stock-skus', { method: 'POST', body: {
      productId: product.id, sku: tag, defaultUnitCost: 2,
    } }), /SKU นี้มีอยู่แล้ว/);

    const imageForm = new FormData();
    imageForm.set('image', new Blob([Buffer.from('tiny inventory e2e image')], { type: 'image/png' }), 'inventory.png');
    const uploaded = await app.request(`/api/inventory/products/${stockSku.productId || product.id}/image`, { method: 'POST', body: imageForm });
    imagePath = uploaded.imagePath;
    assert.ok(imagePath, 'image upload returns its stored path');
    runtime.trackObject('sweet-house-files', imagePath);

    const skuImageForm = new FormData();
    skuImageForm.set('image', new Blob([Buffer.from('tiny stock sku e2e image')], { type: 'image/png' }), 'stock-sku.png');
    const skuUploaded = await app.request(`/api/inventory/stock-skus/${stockSku.id}/image`, { method: 'POST', body: skuImageForm });
    skuImagePath = skuUploaded.imagePath;
    assert.ok(skuImagePath);
    runtime.trackObject('sweet-house-files', skuImagePath);
    const editedSku = (await app.request(`/api/inventory/stock-skus/${stockSku.id}`, {
      method: 'PUT', body: { productId: product.id, sku: tag, defaultUnitCost: 2, status: 'inactive' },
    })).stockSku;
    assert.equal(editedSku.imagePath, skuImagePath, 'editing SKU fields preserves uploaded image');
    const reactivatedSku = (await app.request(`/api/inventory/stock-skus/${stockSku.id}`, {
      method: 'PUT', body: { productId: product.id, sku: tag, defaultUnitCost: 2, status: 'active' },
    })).stockSku;
    assert.equal(reactivatedSku.status, 'active');

    const edited = (await app.request(`/api/inventory/products/${product.id}`, {
      method: 'PUT', body: { productCode: tag, name: `Edited ${runtime.runId}`, category: category.name },
    })).product;
    assert.equal(edited.imagePath, imagePath, 'editing product fields preserves uploaded image');

    const purchaseInput = { stockSkuId: stockSku.id, quantity: 10, unitCost: 2, movementDate,
      referenceType: 'manual', referenceNo: runtime.runId, idempotencyKey: `purchase:${runtime.runId}` };
    const purchase = (await app.request('/api/inventory/purchase-in', { method: 'POST', body: purchaseInput })).movement;
    movementIds.add(purchase.id);
    runtime.track('inventory_stock_movements', 'source_id', purchase.id);
    const replay = (await app.request('/api/inventory/purchase-in', { method: 'POST', body: purchaseInput })).movement;
    assert.equal(replay.id, purchase.id);
    await assert.rejects(app.request('/api/inventory/purchase-in', { method: 'POST', body: { ...purchaseInput, idempotencyKey: `${runtime.runId}:fraction`, quantity: '1.5' } }), /ข้อมูลรับสินค้าไม่ถูกต้อง/);


    saleSku = (await app.request('/api/inventory/sale-skus', { method: 'POST', body: {
      saleSku: tag, displayName: `E2E bundle ${runtime.runId}`,
      components: [{ stockSkuId: stockSku.id, quantity: 2 }],
    } })).saleSku;
    runtime.track('inventory_sale_skus', 'source_id', saleSku.id);
    runtime.track('inventory_bundle_components', 'sale_sku_source_id', saleSku.id);
    assert.equal(saleSku.componentCount, 1);

    const reservations = await inventory.replaceReservations({ orderLineKey, referenceNo: runtime.runId,
      reservations: [{ stockSkuId: stockSku.id, quantity: 3 }] });
    runtime.track('inventory_stock_reservations', 'order_line_key', orderLineKey);
    assert.equal(reservations.length, 1);
    const balances = await app.request('/api/inventory/balances');
    const balance = balances.balances.find(row => String(row.id) === String(stockSku.id));
    assert.equal(Number(balance.quantityOnHand), 10);
    assert.equal(Number(balance.reservedQuantity), 3);
    assert.equal(Number(balance.availableQuantity), 7);

    await assert.rejects(inventory.applyStockMovements([{
      stockSkuId: stockSku.id, movementType: 'sale_out', quantity: 8, unitCost: 2,
      movementDate, referenceType: 'e2e', referenceNo: runtime.runId,
      idempotencyKey: `${runtime.runId}:oversell`,
    }]), error => error.code === 'INSUFFICIENT_STOCK');

    const received = await inventory.applyStockMovements([{
      stockSkuId: stockSku.id, movementType: 'purchase_in', quantity: 2, unitCost: 2,
      movementDate, referenceType: 'substitute_receipt', referenceNo: receiptNo,
      idempotencyKey: `substitute_receipt:${receiptNo}:0`,
    }]);
    const receiveMovement = received[0];
    movementIds.add(receiveMovement.id);
    runtime.track('inventory_stock_movements', 'source_id', receiveMovement.id);
    const repeatedReceive = await inventory.applyStockMovements([{
      stockSkuId: stockSku.id, movementType: 'purchase_in', quantity: 2, unitCost: 2,
      movementDate, referenceType: 'substitute_receipt', referenceNo: receiptNo,
      idempotencyKey: `substitute_receipt:${receiptNo}:0`,
    }]);
    assert.equal(String(repeatedReceive[0].id), String(receiveMovement.id), 'retry does not duplicate receipt movement');

    const mixedKey = `${runtime.runId}:mixed-batch`;
    const mixedBatch = await inventory.applyStockMovements([
      { stockSkuId: stockSku.id, movementType: 'purchase_in', quantity: 2, unitCost: 2,
        movementDate, referenceType: 'e2e', referenceNo: runtime.runId,
        idempotencyKey: `${mixedKey}:in` },
      { stockSkuId: stockSku.id, movementType: 'sale_out', quantity: 2, unitCost: 2,
        movementDate, referenceType: 'e2e', referenceNo: runtime.runId,
        idempotencyKey: `${mixedKey}:out` },
    ]);
    for (const row of mixedBatch) {
      movementIds.add(row.id);
      runtime.track('inventory_stock_movements', 'source_id', row.id);
    }
    const sameKeyRetry = await inventory.applyStockMovements([{
      stockSkuId: stockSku.id, movementType: 'purchase_in', quantity: 2, unitCost: 2,
      movementDate, referenceType: 'e2e', referenceNo: runtime.runId,
      idempotencyKey: `${mixedKey}:in`,
    }]);
    assert.equal(String(sameKeyRetry[0].id), String(mixedBatch[0].id));
    await assert.rejects(inventory.applyStockMovements([
      { stockSkuId: stockSku.id, movementType: 'purchase_in', quantity: 1, unitCost: 2,
        movementDate, referenceType: 'e2e', referenceNo: runtime.runId,
        idempotencyKey: `${mixedKey}:duplicate` },
      { stockSkuId: stockSku.id, movementType: 'purchase_in', quantity: 2, unitCost: 2,
        movementDate, referenceType: 'e2e', referenceNo: runtime.runId,
        idempotencyKey: `${mixedKey}:duplicate` },
    ]), error => error.code === 'IDEMPOTENCY_CONFLICT');
    await assert.rejects(inventory.applyStockMovements([{
      stockSkuId: stockSku.id, movementType: 'purchase_in', quantity: 9, unitCost: 2,
      movementDate, referenceType: 'e2e', referenceNo: runtime.runId,
      idempotencyKey: `${mixedKey}:in`,
    }]), error => error.code === 'IDEMPOTENCY_CONFLICT');
    const rawDuplicateKey = `${runtime.runId}:raw-duplicate-key`;
    const duplicateIds = [await inventory.allocateSourceId(), await inventory.allocateSourceId()];
    const malformedBatch = await supabaseRequest(client, '/rest/v1/rpc/apply_inventory_stock_movements', {
      method: 'POST', body: { p_records: duplicateIds.map(sourceId => ({
        source_key: `stock_movement:${sourceId}`, source_id: sourceId,
        stock_sku_source_id: stockSku.id, movement_type: 'purchase_in', movement_date: movementDate,
        quantity: 1, unit_cost: 2, total_cost: 2, reference_type: 'e2e', reference_no: runtime.runId,
        note: '', idempotency_key: rawDuplicateKey,
      })) },
    });
    assert.equal(malformedBatch.error, 'IDEMPOTENCY_CONFLICT');
    assert.deepEqual(await runtime.db(`inventory_stock_movements?idempotency_key=eq.${encodeURIComponent(rawDuplicateKey)}&select=source_id`), []);
    const nullMovementType = await supabaseRequest(client, '/rest/v1/rpc/apply_inventory_stock_movements', {
      method: 'POST', body: { p_records: [{
        source_key: 'stock_movement:8000000000000001', source_id: 8000000000000001,
        stock_sku_source_id: stockSku.id, movement_type: null, movement_date: movementDate,
        quantity: 1, unit_cost: 2,
      }] },
    });
    assert.equal(nullMovementType.error, 'INVALID_STOCK_MOVEMENTS');

    const reversal = await inventory.reversePurchaseInMovementsByReference({
      referenceType: 'substitute_receipt', referenceNo: receiptNo,
      cancellationReference: 'workflow_transaction:TXN-2199-12-9876',
      reversalDate: movementDate, expectedOriginalMovementIds: [Number(receiveMovement.id)],
    });
    assert.equal(reversal.status, 'reversed');
    for (const row of reversal.reversals) {
      movementIds.add(row.reversalMovementId);
      runtime.track('inventory_stock_movements', 'source_id', row.reversalMovementId);
      runtime.track('inventory_stock_movement_reversals', 'original_movement_source_id', row.originalMovementId);
    }

    const detail = await app.request(`/api/inventory/products/${product.id}/detail`);
    assert.equal(detail.product.imagePath, imagePath);
    assert.equal(detail.children.some(row => String(row.id) === String(stockSku.id)), true);
    const stockIn = await app.request('/api/inventory/stock-in-report?limit=100');
    assert.ok(stockIn.movements.some(row => String(row.id) === String(purchase.id)));
    const stockList = await app.request(`/api/inventory/stock-list?search=${encodeURIComponent(tag)}`);
    assert.ok(stockList.groups.some(group => group.children?.some(row => String(row.id) === String(stockSku.id))));
    const imageResponse = await fetch(new URL(`/api/inventory/images/${imagePath}`, app.baseUrl), {
      headers: { cookie: app.cookie },
    });
    assert.equal(imageResponse.status, 200);
    assert.match(imageResponse.headers.get('content-type') || '', /^image\//);
    const skuImageResponse = await fetch(new URL(`/api/inventory/images/${skuImagePath}`, app.baseUrl), {
      headers: { cookie: app.cookie },
    });
    assert.equal(skuImageResponse.status, 200);
  } finally {
    await runtime.stop();
    for (const movementId of movementIds) {
      assert.deepEqual(await runtime.db(`inventory_stock_movements?source_id=eq.${encodeURIComponent(movementId)}&select=source_id`), []);
    }
    if (saleSku) assert.deepEqual(await runtime.db(`inventory_sale_skus?source_id=eq.${encodeURIComponent(saleSku.id)}&select=source_id`), []);
    if (stockSku) assert.deepEqual(await runtime.db(`inventory_stock_skus?source_id=eq.${encodeURIComponent(stockSku.id)}&select=source_id`), []);
    if (product) assert.deepEqual(await runtime.db(`inventory_products?source_id=eq.${encodeURIComponent(product.id)}&select=source_id`), []);
    if (category) assert.deepEqual(await runtime.db(`inventory_product_categories?source_id=eq.${encodeURIComponent(category.id)}&select=source_id`), []);
    assert.deepEqual(await runtime.db(`inventory_movement_sequences?movement_date=eq.${movementDate}&select=movement_date`), []);
  }
});
