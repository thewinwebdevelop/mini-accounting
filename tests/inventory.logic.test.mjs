import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import inventory from "../forms/inventory.logic.js";

const {
  createProductCategory,
  createProduct,
  createStockSku,
  listProductCategories,
  listProducts,
  listStockSkus,
  updateProductCategory,
  updateProduct,
  updateStockSku,
} = inventory;

test("product category config seeds defaults and controls allowed product categories", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-inventory-"));

  try {
    assert.deepEqual(listProductCategories(rootDir).map((category) => category.name).slice(0, 6), [
      "เสื้อ",
      "กระโปรง",
      "กางเกง",
      "เดรส",
      "เซต",
      "เครื่องประดับ",
    ]);

    const category = createProductCategory(rootDir, { name: "เสื้อแฟชั่น", sortOrder: "15" }, {
      now: () => "2026-09-04T00:00:00.000Z",
    });
    assert.equal(category.name, "เสื้อแฟชั่น");
    assert.equal(category.sortOrder, 15);

    const updated = updateProductCategory(rootDir, category.id, {
      name: "เสื้อแฟชั่นเกาหลี",
      sortOrder: "16",
      status: "inactive",
    }, {
      now: () => "2026-09-05T00:00:00.000Z",
    });
    assert.equal(updated.name, "เสื้อแฟชั่นเกาหลี");
    assert.equal(updated.status, "inactive");
    assert.equal(updated.updatedAt, "2026-09-05T00:00:00.000Z");
    assert.equal(listProductCategories(rootDir).some((item) => item.name === "เสื้อแฟชั่นเกาหลี"), false);
    assert.equal(listProductCategories(rootDir, { includeInactive: true }).some((item) => item.name === "เสื้อแฟชั่นเกาหลี"), true);

    assert.throws(() => {
      createProduct(rootDir, { productCode: "UNKNOWN-CAT", name: "สินค้าหมวดไม่ตั้งค่า", category: "หมวดไม่มีใน config" });
    }, /เลือกหมวดจาก config/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("createProduct and createStockSku store clothing SKU attributes and default cost", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-inventory-"));

  try {
    const product = createProduct(rootDir, {
      productCode: "SHIRT-A",
      name: "เสื้อ A",
      category: "เสื้อ",
      description: "เสื้อรุ่น A",
    }, {
      now: () => "2026-09-04T00:00:00.000Z",
    });

    const sku = createStockSku(rootDir, {
      productId: product.id,
      sku: "SHIRT-A-BLACK-M",
      color: "ดำ",
      size: "M",
      barcode: "885000000001",
      defaultUnitCost: "120.50",
    }, {
      now: () => "2026-09-04T00:00:00.000Z",
    });

    assert.equal(product.productCode, "SHIRT-A");
    assert.equal(sku.sku, "SHIRT-A-BLACK-M");
    assert.equal(sku.color, "ดำ");
    assert.equal(sku.size, "M");
    assert.equal(sku.defaultUnitCost, "120.50");

    assert.deepEqual(listProducts(rootDir).map((item) => item.productCode), ["SHIRT-A"]);
    assert.deepEqual(listStockSkus(rootDir).map((item) => item.sku), ["SHIRT-A-BLACK-M"]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("createStockSku rejects duplicate SKU codes", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-inventory-"));

  try {
    const product = createProduct(rootDir, {
      productCode: "SKIRT-B",
      name: "กระโปรง B",
      category: "กระโปรง",
    });

    createStockSku(rootDir, {
      productId: product.id,
      sku: "SKIRT-B-BLACK-M",
      color: "ดำ",
      size: "M",
      defaultUnitCost: "150",
    });

    assert.throws(() => {
      createStockSku(rootDir, {
        productId: product.id,
        sku: "SKIRT-B-BLACK-M",
        color: "ดำ",
        size: "M",
        defaultUnitCost: "150",
      });
    }, /SKU นี้มีอยู่แล้ว/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("updateProduct and updateStockSku edit master data without changing movement history", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-inventory-"));

  try {
    const product = createProduct(rootDir, {
      productCode: "TOP-E",
      name: "เสื้อสายเดี่ยว E",
      category: "เสื้อ",
      description: "ชื่อเดิม",
    }, {
      now: () => "2026-09-04T00:00:00.000Z",
    });
    const sku = createStockSku(rootDir, {
      productId: product.id,
      sku: "TOP-E-PINK-F",
      color: "ชมพู",
      size: "F",
      barcode: "885000000002",
      defaultUnitCost: "95",
    }, {
      now: () => "2026-09-04T00:00:00.000Z",
    });

    createProductCategory(rootDir, { name: "เสื้อแฟชั่น" });
    const updatedProduct = updateProduct(rootDir, product.id, {
      productCode: "TOP-E",
      name: "เสื้อสายเดี่ยว E รุ่นปรับชื่อ",
      category: "เสื้อแฟชั่น",
      description: "ชื่อใหม่",
      status: "active",
    }, {
      now: () => "2026-09-05T00:00:00.000Z",
    });
    const updatedSku = updateStockSku(rootDir, sku.id, {
      productId: product.id,
      sku: "TOP-E-PINK-F",
      color: "ชมพูอ่อน",
      size: "Free Size",
      barcode: "885000000099",
      defaultUnitCost: "99.50",
      status: "active",
    }, {
      now: () => "2026-09-05T00:00:00.000Z",
    });

    assert.equal(updatedProduct.name, "เสื้อสายเดี่ยว E รุ่นปรับชื่อ");
    assert.equal(updatedProduct.category, "เสื้อแฟชั่น");
    assert.equal(updatedProduct.updatedAt, "2026-09-05T00:00:00.000Z");
    assert.equal(updatedSku.color, "ชมพูอ่อน");
    assert.equal(updatedSku.size, "Free Size");
    assert.equal(updatedSku.defaultUnitCost, "99.50");
    assert.equal(updatedSku.updatedAt, "2026-09-05T00:00:00.000Z");
    assert.deepEqual(listStockSkus(rootDir).map((item) => item.color), ["ชมพูอ่อน"]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

const {
  createPurchaseInMovement,
  getStockCard,
  listInventoryBalances,
} = inventory;

test("createPurchaseInMovement stores unit cost, total cost, and increases balance", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-inventory-"));

  try {
    const product = createProduct(rootDir, { productCode: "DRESS-C", name: "เดรส C", category: "เดรส" });
    const sku = createStockSku(rootDir, {
      productId: product.id,
      sku: "DRESS-C-WHITE-S",
      color: "ขาว",
      size: "S",
      defaultUnitCost: "220",
    });

    const movement = createPurchaseInMovement(rootDir, {
      stockSkuId: sku.id,
      movementDate: "2026-09-04",
      quantity: "10",
      unitCost: "225.75",
      referenceType: "manual",
      referenceNo: "RCV-TEST-001",
      note: "รับเข้าทดสอบ",
    }, {
      now: () => "2026-09-04T01:00:00.000Z",
    });

    assert.match(movement.movementNo, /^MOV-20260904-/);
    assert.equal(movement.movementType, "purchase_in");
    assert.equal(movement.quantity, 10);
    assert.equal(movement.unitCost, "225.75");
    assert.equal(movement.totalCost, "2257.50");

    const balances = listInventoryBalances(rootDir);
    assert.equal(balances.length, 1);
    assert.equal(balances[0].quantityOnHand, 10);
    assert.equal(balances[0].averageUnitCost, "225.75");
    assert.equal(balances[0].inventoryValue, "2257.50");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("stock card lists movements in chronological order with running balance", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-inventory-"));

  try {
    const product = createProduct(rootDir, { productCode: "PANTS-D", name: "กางเกง D", category: "กางเกง" });
    const sku = createStockSku(rootDir, {
      productId: product.id,
      sku: "PANTS-D-NAVY-L",
      color: "กรม",
      size: "L",
      defaultUnitCost: "180",
    });

    createPurchaseInMovement(rootDir, {
      stockSkuId: sku.id,
      movementDate: "2026-09-05",
      quantity: "3",
      unitCost: "180",
    }, { now: () => "2026-09-05T01:00:00.000Z" });

    createPurchaseInMovement(rootDir, {
      stockSkuId: sku.id,
      movementDate: "2026-09-04",
      quantity: "2",
      unitCost: "170",
    }, { now: () => "2026-09-04T01:00:00.000Z" });

    const card = getStockCard(rootDir, sku.id);

    assert.equal(card.sku.sku, "PANTS-D-NAVY-L");
    assert.deepEqual(card.movements.map((movement) => movement.movementDate), ["2026-09-04", "2026-09-05"]);
    assert.deepEqual(card.movements.map((movement) => movement.runningQuantity), [2, 5]);
    assert.equal(card.balance.quantityOnHand, 5);
    assert.equal(card.balance.averageUnitCost, "176.00");
    assert.equal(card.balance.inventoryValue, "880.00");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
