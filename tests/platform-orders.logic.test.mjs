import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import inventoryDb from "../forms/inventory-db.logic.js";
import inventory from "../forms/inventory.logic.js";
import platformOrders from "../forms/platform-orders.logic.js";

const { withInventoryDatabase } = inventoryDb;
const {
  createProduct,
  createPurchaseInMovement,
  createSaleSku,
  createStockSku,
  getStockCard,
  updateSaleSku,
} = inventory;
const {
  getPlatformOrderImport,
  importPlatformOrders,
  listPlatformOrderImports,
  normalizePlatform,
  postPlatformOrderImport,
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

test("importPlatformOrders reserves component stock across all lines in the same import", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-platform-reserve-"));

  try {
    const product = createProduct(rootDir, { productCode: "SHARED-STOCK", name: "เสื้อแชร์สต๊อก", category: "เสื้อ" });
    const stockSku = createStockSku(rootDir, { productId: product.id, sku: "SHARED-STOCK-WHITE-M", color: "ขาว", size: "M", defaultUnitCost: "100" });
    createPurchaseInMovement(rootDir, { stockSkuId: stockSku.id, quantity: "5", unitCost: "100", movementDate: "2026-09-05" });
    createSaleSku(rootDir, {
      saleSku: "SHARED-STOCK-SALE",
      displayName: "เสื้อแชร์สต๊อก",
      platform: "shopee",
      components: [{ stockSkuId: stockSku.id, quantity: "1" }],
    });

    const detail = importPlatformOrders(rootDir, {
      platform: "shopee",
      fileName: "shared-stock.csv",
      fileBuffer: Buffer.from([
        "order_no,sale_sku,quantity",
        "SP-SHARED-001,SHARED-STOCK-SALE,3",
        "SP-SHARED-002,SHARED-STOCK-SALE,3",
      ].join("\n"), "utf8"),
    });

    assert.equal(detail.import.status, "has_issues");
    assert.equal(detail.import.matchedLineCount, 1);
    assert.equal(detail.import.issueCount, 1);
    assert.deepEqual(detail.lines.map((line) => line.matchStatus), ["matched", "insufficient_stock"]);
    assert.equal(detail.lines[1].components[0].requiredQuantity, 3);
    assert.equal(detail.lines[1].components[0].quantityOnHand, 5);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("importPlatformOrders rejects partial numeric quantities as invalid_quantity", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-platform-strict-quantity-"));

  try {
    const product = createProduct(rootDir, { productCode: "STRICT-QTY", name: "เสื้อจำนวนเข้มงวด", category: "เสื้อ" });
    const stockSku = createStockSku(rootDir, { productId: product.id, sku: "STRICT-QTY-WHITE-M", color: "ขาว", size: "M", defaultUnitCost: "100" });
    createPurchaseInMovement(rootDir, { stockSkuId: stockSku.id, quantity: "10", unitCost: "100", movementDate: "2026-09-05" });
    createSaleSku(rootDir, {
      saleSku: "STRICT-QTY-SALE",
      displayName: "เสื้อจำนวนเข้มงวด",
      platform: "shopee",
      components: [{ stockSkuId: stockSku.id, quantity: "1" }],
    });

    const detail = importPlatformOrders(rootDir, {
      platform: "shopee",
      fileName: "strict-quantity.csv",
      fileBuffer: Buffer.from([
        "order_no,sale_sku,quantity",
        "SP-QTY-001,STRICT-QTY-SALE,2abc",
        "SP-QTY-002,STRICT-QTY-SALE,1.5",
      ].join("\n"), "utf8"),
    });

    assert.equal(detail.import.status, "has_issues");
    assert.equal(detail.import.matchedLineCount, 0);
    assert.equal(detail.import.issueCount, 2);
    assert.deepEqual(detail.lines.map((line) => line.matchStatus), ["invalid_quantity", "invalid_quantity"]);
    assert.deepEqual(detail.lines.map((line) => line.quantity), [0, 0]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("importPlatformOrders rejects re-imports that conflict with posted order lines", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-platform-posted-conflict-"));

  try {
    const product = createProduct(rootDir, { productCode: "POSTED-CONFLICT", name: "เสื้อโพสต์แล้ว", category: "เสื้อ" });
    const stockSku = createStockSku(rootDir, { productId: product.id, sku: "POSTED-CONFLICT-WHITE-M", color: "ขาว", size: "M", defaultUnitCost: "100" });
    createPurchaseInMovement(rootDir, { stockSkuId: stockSku.id, quantity: "5", unitCost: "100", movementDate: "2026-09-05" });
    createSaleSku(rootDir, {
      saleSku: "POSTED-CONFLICT-SALE",
      displayName: "เสื้อโพสต์แล้ว",
      platform: "shopee",
      components: [{ stockSkuId: stockSku.id, quantity: "1" }],
    });
    const fileBuffer = Buffer.from("order_no,sale_sku,quantity\nSP-POSTED-001,POSTED-CONFLICT-SALE,1", "utf8");

    const firstImport = importPlatformOrders(rootDir, {
      platform: "shopee",
      fileName: "posted-conflict.csv",
      fileBuffer,
    });
    withInventoryDatabase(rootDir, (db) => {
      db.prepare("UPDATE platform_order_imports SET status = 'posted', posted_at = ? WHERE id = ?")
        .run("2026-09-05T10:00:00.000Z", firstImport.import.id);
      db.prepare("UPDATE platform_order_lines SET posted_at = ? WHERE import_id = ?")
        .run("2026-09-05T10:00:00.000Z", firstImport.import.id);
    });

    assert.throws(() => importPlatformOrders(rootDir, {
      platform: "shopee",
      fileName: "posted-conflict-again.csv",
      fileBuffer,
    }), /โพสต์แล้ว|posted/i);

    const imports = listPlatformOrderImports(rootDir);
    assert.equal(imports.length, 1);
    const loaded = getPlatformOrderImport(rootDir, firstImport.import.id);
    assert.equal(loaded.import.status, "posted");
    assert.equal(loaded.orders.length, 1);
    assert.equal(loaded.lines.length, 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("postPlatformOrderImport creates sale_out movements for bundle components", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-platform-post-"));

  try {
    const top = createProduct(rootDir, { productCode: "TOP-POST", name: "เสื้อโพสต์", category: "เสื้อ" });
    const skirt = createProduct(rootDir, { productCode: "SKIRT-POST", name: "กระโปรงโพสต์", category: "กระโปรง" });
    const topSku = createStockSku(rootDir, { productId: top.id, sku: "TOP-POST-WHITE-M", color: "ขาว", size: "M", defaultUnitCost: "100" });
    const skirtSku = createStockSku(rootDir, { productId: skirt.id, sku: "SKIRT-POST-BLACK-M", color: "ดำ", size: "M", defaultUnitCost: "150" });
    createPurchaseInMovement(rootDir, { stockSkuId: topSku.id, quantity: "5", unitCost: "100", movementDate: "2026-09-05" });
    createPurchaseInMovement(rootDir, { stockSkuId: skirtSku.id, quantity: "5", unitCost: "150", movementDate: "2026-09-05" });
    createSaleSku(rootDir, {
      saleSku: "POST-SET",
      displayName: "ชุดพร้อมส่ง",
      platform: "tiktok",
      components: [
        { stockSkuId: topSku.id, quantity: "1" },
        { stockSkuId: skirtSku.id, quantity: "1" },
      ],
    });

    const detail = importPlatformOrders(rootDir, {
      platform: "tiktok",
      fileName: "post-orders.tsv",
      fileBuffer: Buffer.from("order id\tseller sku\tqty\nTT-9001\tPOST-SET\t2", "utf8"),
    }, {
      now: () => "2026-09-05T10:00:00.000Z",
    });

    const posted = postPlatformOrderImport(rootDir, detail.import.id, {
      now: () => "2026-09-05T10:05:00.000Z",
    });

    assert.equal(posted.import.status, "posted");
    assert.equal(posted.lines[0].postedAt, "2026-09-05T10:05:00.000Z");

    const movements = posted.postedMovements;
    assert.deepEqual(movements.map((movement) => movement.movementNo), [
      "MOV-20260905-00003",
      "MOV-20260905-00004",
    ]);
    assert.deepEqual(movements.map((movement) => ({
      stockSkuId: movement.stockSkuId,
      movementType: movement.movementType,
      quantity: movement.quantity,
      referenceType: movement.referenceType,
      referenceNo: movement.referenceNo,
    })), [
      {
        stockSkuId: topSku.id,
        movementType: "sale_out",
        quantity: 2,
        referenceType: "platform_order",
        referenceNo: "tiktok:TT-9001:1:POST-SET",
      },
      {
        stockSkuId: skirtSku.id,
        movementType: "sale_out",
        quantity: 2,
        referenceType: "platform_order",
        referenceNo: "tiktok:TT-9001:1:POST-SET",
      },
    ]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("postPlatformOrderImport is idempotent and blocks batches with postable issues", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-platform-idempotent-"));

  try {
    const product = createProduct(rootDir, { productCode: "TOP-IDEMP", name: "เสื้อกันซ้ำ", category: "เสื้อ" });
    const stockSku = createStockSku(rootDir, { productId: product.id, sku: "TOP-IDEMP-WHITE-M", color: "ขาว", size: "M", defaultUnitCost: "90" });
    createPurchaseInMovement(rootDir, { stockSkuId: stockSku.id, quantity: "3", unitCost: "90", movementDate: "2026-09-05" });
    createSaleSku(rootDir, {
      saleSku: "IDEMP-TOP",
      displayName: "เสื้อกันซ้ำ",
      platform: "shopee",
      components: [{ stockSkuId: stockSku.id, quantity: "1" }],
    });

    const ready = importPlatformOrders(rootDir, {
      platform: "shopee",
      fileName: "ready.csv",
      fileBuffer: Buffer.from("order_no,sale_sku,quantity\nSP-3001,IDEMP-TOP,1", "utf8"),
    });

    const postedOnce = postPlatformOrderImport(rootDir, ready.import.id, {
      now: () => "2026-09-05T11:00:00.000Z",
    });
    const balanceAfterFirstPost = getStockCard(rootDir, stockSku.id).balance.quantityOnHand;
    const postedAgain = postPlatformOrderImport(rootDir, ready.import.id, {
      now: () => "2026-09-05T11:30:00.000Z",
    });

    assert.equal(postedAgain.postedMovements.length, 1);
    assert.equal(postedAgain.import.status, "posted");
    assert.equal(postedAgain.import.postedAt, postedOnce.import.postedAt);
    assert.equal(postedAgain.lines[0].postedAt, postedOnce.lines[0].postedAt);
    assert.equal(getStockCard(rootDir, stockSku.id).balance.quantityOnHand, balanceAfterFirstPost);

    const bad = importPlatformOrders(rootDir, {
      platform: "shopee",
      fileName: "bad.csv",
      fileBuffer: Buffer.from("order_no,sale_sku,quantity\nSP-3002,UNKNOWN,1", "utf8"),
    });

    assert.throws(() => postPlatformOrderImport(rootDir, bad.import.id), /ยังมีรายการที่ต้องแก้ไข/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("postPlatformOrderImport reuses posted movements after bundle components change", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-platform-posted-bundle-change-"));

  try {
    const originalProduct = createProduct(rootDir, { productCode: "ORIG-POST", name: "เสื้อเดิม", category: "เสื้อ" });
    const replacementProduct = createProduct(rootDir, { productCode: "REPL-POST", name: "เสื้อใหม่", category: "เสื้อ" });
    const originalSku = createStockSku(rootDir, { productId: originalProduct.id, sku: "ORIG-POST-WHITE-M", color: "ขาว", size: "M", defaultUnitCost: "80" });
    const replacementSku = createStockSku(rootDir, { productId: replacementProduct.id, sku: "REPL-POST-BLACK-M", color: "ดำ", size: "M", defaultUnitCost: "95" });
    createPurchaseInMovement(rootDir, { stockSkuId: originalSku.id, quantity: "5", unitCost: "80", movementDate: "2026-09-05" });
    createPurchaseInMovement(rootDir, { stockSkuId: replacementSku.id, quantity: "5", unitCost: "95", movementDate: "2026-09-05" });
    const saleSku = createSaleSku(rootDir, {
      saleSku: "MUTABLE-SET",
      displayName: "ชุดเปลี่ยน component",
      platform: "shopee",
      components: [{ stockSkuId: originalSku.id, quantity: "1" }],
    });

    const ready = importPlatformOrders(rootDir, {
      platform: "shopee",
      fileName: "mutable-ready.csv",
      fileBuffer: Buffer.from("order_no,sale_sku,quantity\nSP-4001,MUTABLE-SET,1", "utf8"),
    });

    const postedOnce = postPlatformOrderImport(rootDir, ready.import.id, {
      now: () => "2026-09-05T12:00:00.000Z",
    });
    updateSaleSku(rootDir, saleSku.id, {
      saleSku: "MUTABLE-SET",
      displayName: "ชุดเปลี่ยน component",
      platform: "shopee",
      components: [{ stockSkuId: replacementSku.id, quantity: "1" }],
    });

    const postedAgain = postPlatformOrderImport(rootDir, ready.import.id, {
      now: () => "2026-09-05T12:45:00.000Z",
    });

    assert.deepEqual(postedAgain.postedMovements.map((movement) => ({
      stockSkuId: movement.stockSkuId,
      quantity: movement.quantity,
      referenceNo: movement.referenceNo,
    })), [{
      stockSkuId: originalSku.id,
      quantity: 1,
      referenceNo: "shopee:SP-4001:1:MUTABLE-SET",
    }]);
    assert.equal(getStockCard(rootDir, originalSku.id).balance.quantityOnHand, 4);
    assert.equal(getStockCard(rootDir, replacementSku.id).balance.quantityOnHand, 5);
    assert.equal(postedAgain.import.postedAt, postedOnce.import.postedAt);
    assert.equal(postedAgain.lines[0].postedAt, postedOnce.lines[0].postedAt);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
