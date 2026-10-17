import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { stockSkuLabel, validateStockSkuReferences } = require("../forms/stock-line.logic.js");

test("stock SKU labels include the SKU and product name", () => {
  assert.equal(stockSkuLabel({ sku: "TOP-101", productName: "เสื้อดำ", color: "ดำ", size: "M" }), "TOP-101 - เสื้อดำ");
});

test("manual lines are accepted while selected stock lines must reference active Stock SKUs", () => {
  const errors = validateStockSkuReferences([
    { description: "ค่าขนส่ง", stockSkuId: "" },
    { description: "เสื้อสีดำ", stockSkuId: "101" },
    { description: "SKU ถูกปิด", stockSkuId: "999" },
  ], [
    { id: 101, status: "active" },
    { id: 999, status: "inactive" },
  ]);

  assert.deepEqual(errors, ["รายการ 3: ไม่พบ Stock SKU ที่ใช้งานอยู่"]);
});

test("stock reference validation accepts legacy catalogs without a status field", () => {
  assert.deepEqual(
    validateStockSkuReferences([{ stockSkuId: "42" }], [{ id: 42 }]),
    [],
  );
});
