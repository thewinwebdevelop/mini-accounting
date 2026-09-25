import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import inventoryDb from "../forms/inventory-db.logic.js";
import platformOrders from "../forms/platform-orders.logic.js";
import shipment from "../forms/shopee-shipment.logic.js";

const { openInventoryDatabase, ensureInventorySchema } = inventoryDb;
const { upsertShopeeOrder } = platformOrders;
const {
  arrangeShipmentBatch,
  createShippingDocumentJob,
  groupEligibleShopeePackages,
  pollShippingDocumentJob,
  prepareShipmentBatch,
  refreshBatchTracking,
} = shipment;

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

test("refreshBatchTracking keeps delayed packages pending and updates them when Tracking arrives", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-shipment-tracking-"));
  try {
    const order = upsertShopeeOrder(rootDir, payload("SP-TRACK"));
    let trackingAttempt = 0;
    const client = {
      request: async ({ path }) => {
        if (path.endsWith("get_mass_shipping_parameter")) {
          return { response: { pickup: { addressList: [{ addressId: "A1", timeSlotList: [{ pickupTimeId: "T1" }] }] } } };
        }
        if (path.endsWith("mass_ship_order")) {
          return { response: { result: [{ packageNumber: "PKG-SP-TRACK", success: true }] } };
        }
        assert.equal(path, "/api/v2/logistics/get_mass_tracking_number");
        trackingAttempt += 1;
        return { response: { result: [{ packageNumber: "PKG-SP-TRACK", trackingNumber: trackingAttempt === 1 ? "" : "TH-TRACK-1" }] } };
      },
    };
    const prepared = await prepareShipmentBatch(rootDir, [order.order.id], { client });
    await arrangeShipmentBatch(rootDir, prepared.batches[0].id, { addressId: "A1", pickupTimeId: "T1" }, { client });
    const pending = await refreshBatchTracking(rootDir, prepared.batches[0].id, { client });
    assert.equal(pending.orders[0].status, "tracking_pending");
    const ready = await refreshBatchTracking(rootDir, prepared.batches[0].id, { client });
    assert.equal(ready.orders[0].status, "documents_pending");
    assert.equal(ready.orders[0].trackingNumber, "TH-TRACK-1");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("shipping document job is created only after Tracking and downloads once ready", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-shipment-document-"));
  try {
    const order = upsertShopeeOrder(rootDir, payload("SP-DOC"));
    let documentCalls = 0;
    const client = {
      request: async ({ path }) => {
        if (path.endsWith("get_mass_shipping_parameter")) {
          return { response: { pickup: { addressList: [{ addressId: "A1", timeSlotList: [{ pickupTimeId: "T1" }] }] } } };
        }
        if (path.endsWith("mass_ship_order")) {
          return { response: { result: [{ packageNumber: "PKG-SP-DOC", success: true }] } };
        }
        if (path.endsWith("get_mass_tracking_number")) {
          return { response: { result: [{ packageNumber: "PKG-SP-DOC", trackingNumber: "TH-DOC-1" }] } };
        }
        if (path.endsWith("create_shipping_document_job")) {
          documentCalls += 1;
          return { response: { jobId: "JOB-1" } };
        }
        if (path.endsWith("get_shipping_document_job_status")) {
          return { response: { status: "READY" } };
        }
        assert.equal(path, "/api/v2/logistics/download_shipping_document_job");
        return { response: { fileBase64: Buffer.from("shopeedoc").toString("base64") } };
      },
    };
    const prepared = await prepareShipmentBatch(rootDir, [order.order.id], { client });
    await arrangeShipmentBatch(rootDir, prepared.batches[0].id, { addressId: "A1", pickupTimeId: "T1" }, { client });
    await refreshBatchTracking(rootDir, prepared.batches[0].id, { client });
    const job = await createShippingDocumentJob(rootDir, prepared.batches[0].id, { client });
    assert.equal(job.status, "created");
    assert.equal(documentCalls, 1);
    const ready = await pollShippingDocumentJob(rootDir, job.id, { client });
    assert.equal(ready.status, "ready");
    assert.equal(await readFile(ready.filePath, "utf8"), "shopeedoc");
    const retry = await pollShippingDocumentJob(rootDir, job.id, { client });
    assert.equal(retry.status, "ready");
    assert.equal(documentCalls, 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
