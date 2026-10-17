import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCloudInventoryBalances,
  buildCloudInventoryDashboard,
  buildCloudInventoryStockGroups,
  buildCloudStockCard,
  buildCloudStockInReport,
} from "../forms/inventory-cloud-read.logic.js";

const products = [
  { id: 2, productCode: "P-2", name: "เสื้อดอกไม้", category: "เสื้อ", description: "", imagePath: "", status: "active", createdAt: "", updatedAt: "" },
];
const stockSkus = [
  { id: 2, productId: 2, sku: "SKU-2", color: "ชมพู", size: "", barcode: "", defaultUnitCost: "85.00", imagePath: "", status: "active", createdAt: "", updatedAt: "" },
];
const movements = [{
  source_id: 2,
  stock_sku_source_id: 2,
  movement_no: "MOV-1",
  movement_type: "purchase_in",
  movement_date: "2026-09-02",
  quantity: 3,
  unit_cost: 85,
  total_cost: 255,
  reference_type: "substitute_receipt",
  reference_no: "SR-1",
  note: "รับเข้า",
  created_at: "2026-09-02T00:00:00Z",
}];

test("cloud inventory balances reconstruct quantity and value from Supabase rows", () => {
  const balances = buildCloudInventoryBalances({ products, stockSkus, movements });
  assert.equal(balances.length, 1);
  assert.equal(balances[0].quantityOnHand, 3);
  assert.equal(balances[0].availableQuantity, 3);
  assert.equal(balances[0].inventoryValue, "255.00");
});

test("cloud inventory stock groups preserve products, SKU children, and filters", () => {
  const groups = buildCloudInventoryStockGroups({
    products,
    stockSkus,
    movements,
    filters: { stockStatus: "in_stock" },
  });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].children[0].productName, "เสื้อดอกไม้");
  assert.equal(groups[0].totalQuantityOnHand, 3);
});

test("cloud inventory dashboard and stock-in report expose migrated movements", () => {
  const balances = buildCloudInventoryBalances({ products, stockSkus, movements });
  const dashboard = buildCloudInventoryDashboard({ balances, asOfDate: "2026-09-29" });
  const report = buildCloudStockInReport({ products, stockSkus, movements, limit: 10 });
  assert.equal(dashboard.totalQuantityOnHand, 3);
  assert.equal(report[0].movementNo, "MOV-1");
  assert.equal(report[0].productCode, "P-2");
});

test("cloud stock card returns running quantities for one SKU", () => {
  const card = buildCloudStockCard({ products, stockSkus, movements, stockSkuId: 2 });
  assert.equal(card.movements[0].runningQuantity, 3);
  assert.equal(card.balance.quantityOnHand, 3);
});
