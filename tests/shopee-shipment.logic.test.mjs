import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import inventoryDb from "../forms/inventory-db.logic.js";
import platformOrders from "../forms/platform-orders.logic.js";
import shipment from "../forms/shopee-shipment.logic.js";

const { openInventoryDatabase, ensureInventorySchema } = inventoryDb;
const { upsertShopeeOrder } = platformOrders;
const { arrangeShipmentBatch, groupEligibleShopeePackages, prepareShipmentBatch } = shipment;

function payload(orderSn, overrides = {}) {
  return {
    shopId: "shop-1",
    orderSn,
    orderStatus: "READY_TO_SHIP",
    createTime: 1758772800,
    updateTime: 1758776400,
    recipientAddress: { name: "ผู้รับ", fullAddress: "กรุงเทพฯ" },
    packageNumber: `PKG-${orderSn}`,
    logisticsChannelId: "SPX-1",
    productLocationId: "warehouse-1",
    items: [{ itemId: `item-${orderSn}`, modelId: "model-1", modelSku: "SKU-1", itemName: "สินค้า", quantity: 1 }],
    ...overrides,
  };
}

test("groupEligibleShopeePackages splits incompatible logistics and location groups", () => {
  const groups = groupEligibleShopeePackages([
    { id: 1, orderStatus: "READY_TO_SHIP", shippingStatus: "READY_TO_SHIP", logisticsChannelId: "SPX", productLocationId: "W1", packageNumber: "P1" },
    { id: 2, orderStatus: "READY_TO_SHIP", shippingStatus: "READY_TO_SHIP", logisticsChannelId: "SPX", productLocationId: "W1", packageNumber: "P2" },
    { id: 3, orderStatus: "READY_TO_SHIP", shippingStatus: "READY_TO_SHIP", logisticsChannelId: "JNT", productLocationId: "W1", packageNumber: "P3" },
    { id: 4, orderStatus: "CANCELLED", shippingStatus: "CANCELLED", logisticsChannelId: "SPX", productLocationId: "W1", packageNumber: "P4" },
  ]);

  assert.deepEqual(groups.map((group) => ({ key: group.key, ids: group.orders.map((order) => order.id) })), [
    { key: "JNT::W1", ids: [3] },
    { key: "SPX::W1", ids: [1, 2] },
  ]);
});

test("prepareShipmentBatch stores a compatible batch and returned pickup choices", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-shipment-prepare-"));
  try {
    const first = upsertShopeeOrder(rootDir, payload("SP-001"));
    const second = upsertShopeeOrder(rootDir, payload("SP-002"));
    const client = {
      request: async ({ path }) => {
        assert.equal(path, "/api/v2/logistics/get_mass_shipping_parameter");
        return { response: { pickup: { addressList: [{ addressId: "A1", timeSlotList: [{ pickupTimeId: "T1", label: "วันนี้ 13:00" }] }] } } };
      },
    };

    const result = await prepareShipmentBatch(rootDir, [first.order.id, second.order.id], {
      client,
      now: () => "2026-09-25T09:00:00.000Z",
    });

    assert.equal(result.batches.length, 1);
    assert.equal(result.batches[0].orders.length, 2);
    assert.equal(result.batches[0].pickup.addresses[0].addressId, "A1");
    assert.equal(result.batches[0].pickup.addresses[0].timeSlots[0].pickupTimeId, "T1");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("arrangeShipmentBatch isolates partial success and never resubmits arranged packages", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-shipment-arrange-"));
  try {
    const first = upsertShopeeOrder(rootDir, payload("SP-001"));
    const second = upsertShopeeOrder(rootDir, payload("SP-002"));
    let prepare = true;
    const client = {
      request: async ({ path, body }) => {
        if (path.endsWith("get_mass_shipping_parameter")) {
          return { response: { pickup: { addressList: [{ addressId: "A1", timeSlotList: [{ pickupTimeId: "T1" }] }] } } };
        }
        assert.equal(path, "/api/v2/logistics/mass_ship_order");
        const packages = body.packageList || body.package_list;
        if (prepare) {
          prepare = false;
          assert.deepEqual(packages.map((item) => item.packageNumber || item.package_number), ["PKG-SP-001", "PKG-SP-002"]);
          return { response: { result: [
            { packageNumber: "PKG-SP-001", success: true },
            { packageNumber: "PKG-SP-002", success: false, error: "not ready" },
          ] } };
        }
        assert.deepEqual(packages.map((item) => item.packageNumber || item.package_number), ["PKG-SP-002"]);
        return { response: { result: [{ packageNumber: "PKG-SP-002", success: true }] } };
      },
    };
    const prepared = await prepareShipmentBatch(rootDir, [first.order.id, second.order.id], { client });
    const firstAttempt = await arrangeShipmentBatch(rootDir, prepared.batches[0].id, { addressId: "A1", pickupTimeId: "T1" }, { client });
    assert.deepEqual(firstAttempt.orders.map((order) => order.status), ["arranged", "failed"]);

    const retry = await arrangeShipmentBatch(rootDir, prepared.batches[0].id, { addressId: "A1", pickupTimeId: "T1" }, { client });
    assert.deepEqual(retry.orders.map((order) => order.status), ["arranged", "arranged"]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("prepareShipmentBatch rejects canceled orders", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-shipment-cancelled-"));
  try {
    const order = upsertShopeeOrder(rootDir, payload("SP-CANCEL", { orderStatus: "CANCELLED", shippingStatus: "CANCELLED" }));
    await assert.rejects(
      prepareShipmentBatch(rootDir, [order.order.id], { client: { request: async () => ({}) } }),
      /ไม่พร้อมจัดส่ง|eligible/i,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
