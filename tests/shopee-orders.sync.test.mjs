import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import inventoryDb from "../forms/inventory-db.logic.js";
import shopeeAuth from "../forms/shopee-auth.logic.js";
import { syncShopeeOrders } from "../forms/shopee-orders.logic.js";

const { openInventoryDatabase, ensureInventorySchema } = inventoryDb;
const { saveShopeeConnection } = shopeeAuth;

test("syncShopeeOrders fetches changed order details and upserts them once", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-shopee-sync-"));
  try {
    const connection = saveShopeeConnection(rootDir, {
      shopId: "shop-1",
      shopName: "Sweet House",
      accessToken: "access-1",
      refreshToken: "refresh-1",
      tokenExpiresAt: "2099-01-01T00:00:00.000Z",
    }, { now: () => "2026-09-25T09:00:00.000Z" });
    const calls = [];
    const client = {
      request: async (request) => {
        calls.push(request);
        if (request.path.endsWith("get_order_list")) {
          return { response: { orderList: [{ orderSn: "SP-001", updateTime: 1758776400 }], more: false, nextCursor: "" } };
        }
        return {
          response: {
            orderSn: "SP-001",
            orderStatus: "READY_TO_SHIP",
            createTime: 1758772800,
            updateTime: 1758776400,
            recipientAddress: { name: "ผู้รับ", fullAddress: "กรุงเทพฯ" },
            itemList: [{ itemId: "item-1", modelId: "model-1", modelSku: "SKU-1", itemName: "สินค้า", modelName: "แดง", itemQuantity: 1 }],
          },
        };
      },
    };

    const result = await syncShopeeOrders(rootDir, {
      connectionId: connection.id,
      client,
      now: () => "2026-09-25T09:01:00.000Z",
    });

    assert.equal(result.imported, 1);
    assert.equal(result.updated, 0);
    assert.equal(result.failed, 0);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].path, "/api/v2/order/get_order_list");
    assert.equal(calls[1].path, "/api/v2/order/get_order_detail");

    const db = openInventoryDatabase(rootDir);
    try {
      ensureInventorySchema(db);
      const orderCount = db.prepare("SELECT COUNT(*) AS count FROM platform_orders WHERE platform = 'shopee'").get().count;
      const syncStatus = db.prepare("SELECT status FROM shopee_sync_runs ORDER BY id DESC LIMIT 1").get().status;
      assert.equal(orderCount, 1);
      assert.equal(syncStatus, "succeeded");
    } finally {
      db.close();
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
