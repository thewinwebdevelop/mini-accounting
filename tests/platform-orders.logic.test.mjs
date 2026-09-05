import assert from "node:assert/strict";
import test from "node:test";

import platformOrders from "../forms/platform-orders.logic.js";

const { normalizePlatform, parsePlatformOrderFile } = platformOrders;

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
