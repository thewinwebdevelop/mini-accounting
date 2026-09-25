import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import inventoryDb from "../forms/inventory-db.logic.js";
import platformOrders from "../forms/platform-orders.logic.js";

const { openInventoryDatabase, ensureInventorySchema } = inventoryDb;
const { getShopeeOrder, upsertShopeeOrder } = platformOrders;

function orderPayload(overrides = {}) {
  return {
    shopId: "shop-1",
    orderSn: "260925ABC123",
    orderStatus: "READY_TO_SHIP",
    createTime: 1758772800,
    updateTime: 1758776400,
    recipientAddress: {
      name: "ผู้รับทดสอบ",
      phone: "0810000000",
      fullAddress: "ที่อยู่ทดสอบ กรุงเทพฯ 10110",
    },
    packageNumber: "PKG-1",
    trackingNumber: "",
    logisticsChannel: "SPX Express",
    logisticsChannelId: "SPX-1",
    productLocationId: "warehouse-1",
    items: [{
      itemId: "item-1",
      modelId: "model-1",
      modelSku: "SKU-01875",
      itemName: "ชุดทดสอบ",
      modelName: "ฟ้าดอกไม้",
      quantity: 2,
    }],
    ...overrides,
  };
}

test("ensureInventorySchema creates Shopee connection, sync, shipment, and document tables", () => {
  const db = openInventoryDatabase(join(tmpdir(), `sweet-house-schema-${Date.now()}.sqlite`));
  try {
    ensureInventorySchema(db);
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
    for (const name of [
      "shopee_connections",
      "shopee_sync_runs",
      "shipment_batches",
      "shipment_batch_orders",
      "shipment_actions",
      "shipping_document_jobs",
    ]) {
      assert.ok(names.includes(name), `missing ${name}`);
    }
  } finally {
    const dbPath = db.prepare("PRAGMA database_list").get().file;
    db.close();
    rm(dbPath, { force: true });
  }
});

test("upsertShopeeOrder stores normalized order and line details", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-shopee-order-"));
  try {
    const result = upsertShopeeOrder(rootDir, orderPayload(), { now: () => "2026-09-25T09:00:00.000Z" });

    assert.equal(result.created, true);
    assert.equal(result.order.orderNo, "260925ABC123");
    assert.equal(result.order.shopId, "shop-1");
    assert.equal(result.order.shippingStatus, "READY_TO_SHIP");
    assert.equal(result.order.trackingNumber, "");
    assert.equal(result.lines.length, 1);
    assert.equal(result.lines[0].externalItemId, "item-1");
    assert.equal(result.lines[0].externalModelId, "model-1");
    assert.equal(result.lines[0].externalModelSku, "SKU-01875");
    assert.equal(result.lines[0].quantity, 2);
    assert.equal(result.lines[0].mappingStatus, "unmapped");

    const loaded = getShopeeOrder(rootDir, { shopId: "shop-1", orderSn: "260925ABC123" });
    assert.equal(loaded.order.buyerName, "ผู้รับทดสอบ");
    assert.equal(loaded.order.packageNumber, "PKG-1");
    assert.equal(loaded.lines[0].displayName, "ชุดทดสอบ / ฟ้าดอกไม้");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("upsertShopeeOrder updates the existing order instead of duplicating it", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-shopee-order-update-"));
  try {
    const first = upsertShopeeOrder(rootDir, orderPayload(), { now: () => "2026-09-25T09:00:00.000Z" });
    const second = upsertShopeeOrder(rootDir, orderPayload({
      orderStatus: "PROCESSED",
      updateTime: 1758780000,
      trackingNumber: "TH123456789",
    }), { now: () => "2026-09-25T10:00:00.000Z" });

    assert.equal(first.order.id, second.order.id);
    assert.equal(second.created, false);
    assert.equal(second.order.orderStatus, "PROCESSED");
    assert.equal(second.order.trackingNumber, "TH123456789");

    const db = openInventoryDatabase(rootDir);
    try {
      const count = db.prepare("SELECT COUNT(*) AS count FROM platform_orders WHERE platform = 'shopee'").get().count;
      assert.equal(count, 1);
    } finally {
      db.close();
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
