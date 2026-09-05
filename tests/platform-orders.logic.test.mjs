import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import inventory from "../forms/inventory.logic.js";
import platformOrders from "../forms/platform-orders.logic.js";

const { createProduct, createPurchaseInMovement, createSaleSku, createStockSku } = inventory;
const {
  getPlatformOrderImport,
  importPlatformOrders,
  listPlatformOrderImports,
  normalizePlatform,
  parsePlatformOrderFile,
} = platformOrders;

test("parsePlatformOrderFile normalizes Shopee CSV aliases", () => {
  const csv = [
    "หมายเลขคำสั่งซื้อ,รหัสสินค้า,จำนวน,สถานะ,ชื่อสินค้า,ชื่อผู้ซื้อ",
    "SP-001,SET-A,2,สำเร็จ,เสื้อ A + กระโปรง B,คุณเอ",
  ].join("\n");

  const result = parsePlatformOrderFile(Buffer.from(csv, "utf8"), { platform: "shopee" });

  assert.deepEqual(result.rows, [{
    platform: "shopee",
    orderNo: "SP-001",
    lineNo: "1",
    saleSku: "SET-A",
    quantity: 2,
    orderDate: "",
    orderStatus: "สำเร็จ",
    displayName: "เสื้อ A + กระโปรง B",
    buyerName: "คุณเอ",
    skipped: false,
  }]);
  assert.deepEqual(result.duplicateKeys, []);
});

test("parsePlatformOrderFile supports TSV and skipped cancelled statuses", () => {
  const tsv = [
    "order id\tseller sku\tqty\torder status",
    "TT-001\tTOP-A\t1\tcancelled",
  ].join("\n");

  const result = parsePlatformOrderFile(Buffer.from(tsv, "utf8"), { platform: "tiktok" });

  assert.equal(result.rows[0].platform, "tiktok");
  assert.equal(result.rows[0].skipped, true);
  assert.equal(result.rows[0].orderStatus, "cancelled");
});

test("parsePlatformOrderFile reports duplicate order-line keys", () => {
  const csv = [
    "order_no,sale_sku,quantity,line_no",
    "SP-002,TOP-A,1,1",
    "SP-002,TOP-A,1,1",
  ].join("\n");

  const result = parsePlatformOrderFile(Buffer.from(csv, "utf8"), { platform: "shopee" });

  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.duplicateKeys, ["shopee:SP-002:1:TOP-A"]);
});

test("normalizePlatform accepts only supported platforms", () => {
  assert.equal(normalizePlatform("Shopee"), "shopee");
  assert.equal(normalizePlatform("TikTok"), "tiktok");
  assert.equal(normalizePlatform(""), "manual");
  assert.throws(() => normalizePlatform("lazada"), /platform/);
});

test("importPlatformOrders matches Sale SKU bundle components and creates ready batch", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-platform-import-"));

  try {
    const top = createProduct(rootDir, { productCode: "TOP-A", name: "เสื้อ A", category: "เสื้อ" });
    const skirt = createProduct(rootDir, { productCode: "SKIRT-B", name: "กระโปรง B", category: "กระโปรง" });
    const topSku = createStockSku(rootDir, { productId: top.id, sku: "TOP-A-WHITE-M", color: "ขาว", size: "M", defaultUnitCost: "120" });
    const skirtSku = createStockSku(rootDir, { productId: skirt.id, sku: "SKIRT-B-BLACK-M", color: "ดำ", size: "M", defaultUnitCost: "150" });
    createPurchaseInMovement(rootDir, { stockSkuId: topSku.id, quantity: "5", unitCost: "120", movementDate: "2026-09-05" });
    createPurchaseInMovement(rootDir, { stockSkuId: skirtSku.id, quantity: "5", unitCost: "150", movementDate: "2026-09-05" });
    const saleSku = createSaleSku(rootDir, {
      saleSku: "SET-A-SKIRT-B",
      displayName: "เสื้อ A + กระโปรง B",
      platform: "shopee",
      components: [
        { stockSkuId: topSku.id, quantity: "1" },
        { stockSkuId: skirtSku.id, quantity: "1" },
      ],
    });

    const csv = [
      "order_no,sale_sku,quantity,status,product name",
      "SP-1001,SET-A-SKIRT-B,2,paid,Set A",
    ].join("\n");

    const detail = importPlatformOrders(rootDir, {
      platform: "shopee",
      fileName: "orders.csv",
      fileBuffer: Buffer.from(csv, "utf8"),
    }, {
      now: () => "2026-09-05T09:00:00.000Z",
    });

    assert.equal(detail.import.platform, "shopee");
    assert.equal(detail.import.status, "ready");
    assert.equal(detail.import.rowCount, 1);
    assert.equal(detail.import.matchedLineCount, 1);
    assert.equal(detail.import.issueCount, 0);
    assert.equal(detail.lines[0].saleSkuId, saleSku.id);
    assert.deepEqual(detail.lines[0].components.map((component) => ({
      stockSkuId: component.stockSkuId,
      requiredQuantity: component.requiredQuantity,
      quantityOnHand: component.quantityOnHand,
    })), [
      { stockSkuId: topSku.id, requiredQuantity: 2, quantityOnHand: 5 },
      { stockSkuId: skirtSku.id, requiredQuantity: 2, quantityOnHand: 5 },
    ]);

    const listed = listPlatformOrderImports(rootDir);
    assert.equal(listed[0].importNo, detail.import.importNo);

    const loaded = getPlatformOrderImport(rootDir, detail.import.id);
    assert.equal(loaded.orders[0].orderNo, "SP-1001");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("importPlatformOrders stores row issues for missing mapping invalid quantity and skipped status", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-platform-issues-"));

  try {
    const csv = [
      "order_no,sale_sku,quantity,status",
      "SP-2001,UNKNOWN-SKU,1,paid",
      "SP-2002,UNKNOWN-QTY,abc,paid",
      "SP-2003,CANCELLED-SKU,1,cancelled",
    ].join("\n");

    const detail = importPlatformOrders(rootDir, {
      platform: "shopee",
      fileName: "issue-orders.csv",
      fileBuffer: Buffer.from(csv, "utf8"),
    });

    assert.equal(detail.import.status, "has_issues");
    assert.deepEqual(detail.lines.map((line) => line.matchStatus), [
      "missing_sale_sku",
      "invalid_quantity",
      "skipped_status",
    ]);
    assert.equal(detail.lines[2].postable, false);
    assert.equal(detail.import.issueCount, 2);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("importPlatformOrders marks matched lines as insufficient_stock when components exceed balance", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-platform-insufficient-"));

  try {
    const product = createProduct(rootDir, { productCode: "LOW-STOCK", name: "เสื้อสต๊อกน้อย", category: "เสื้อ" });
    const stockSku = createStockSku(rootDir, { productId: product.id, sku: "LOW-STOCK-WHITE-M", color: "ขาว", size: "M", defaultUnitCost: "100" });
    createPurchaseInMovement(rootDir, { stockSkuId: stockSku.id, quantity: "1", unitCost: "100", movementDate: "2026-09-05" });
    createSaleSku(rootDir, {
      saleSku: "LOW-STOCK-SALE",
      displayName: "เสื้อสต๊อกน้อย",
      platform: "shopee",
      components: [{ stockSkuId: stockSku.id, quantity: "1" }],
    });

    const detail = importPlatformOrders(rootDir, {
      platform: "shopee",
      fileName: "low-stock.csv",
      fileBuffer: Buffer.from("order_no,sale_sku,quantity\nSP-LOW-001,LOW-STOCK-SALE,2", "utf8"),
    });

    assert.equal(detail.import.status, "has_issues");
    assert.equal(detail.lines[0].matchStatus, "insufficient_stock");
    assert.equal(detail.lines[0].components[0].requiredQuantity, 2);
    assert.equal(detail.lines[0].components[0].quantityOnHand, 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
