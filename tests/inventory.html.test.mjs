import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlPath = new URL("../forms/inventory.html", import.meta.url);
const dashboardPath = new URL("../forms/inventory-dashboard.html", import.meta.url);
const settingsPath = new URL("../forms/inventory-settings.html", import.meta.url);

test("inventory page provides product, SKU, purchase-in, balance, and stock card work areas", async () => {
  const html = await readFile(htmlPath, "utf8");

  assert.match(html, /<title>ระบบสต๊อกสินค้า - หจก\.สวีทเฮาส์<\/title>/);
  assert.match(html, /id="productForm"/);
  assert.match(html, /id="skuForm"/);
  assert.match(html, /id="purchaseInForm"/);
  assert.match(html, /id="productRows"/);
  assert.match(html, /id="skuRows"/);
  assert.match(html, /id="balanceRows"/);
  assert.match(html, /id="stockCardRows"/);
  assert.match(html, /id="productRecordId"/);
  assert.match(html, /id="skuRecordId"/);
  assert.match(html, /href="\/inventory-settings"/);
  assert.match(html, /<select id="productCategory" name="category" required><\/select>/);
  assert.doesNotMatch(html, /<input id="productCategory"/);
  assert.match(html, /src="\.\/inventory\.logic\.browser\.js"/);
});

test("inventory settings page manages product category options", async () => {
  const html = await readFile(settingsPath, "utf8");

  assert.match(html, /<title>ตั้งค่าหมวดสินค้า - หจก\.สวีทเฮาส์<\/title>/);
  assert.match(html, /id="categoryForm"/);
  assert.match(html, /id="categoryName"/);
  assert.match(html, /id="categorySortOrder"/);
  assert.match(html, /id="categoryRows"/);
  assert.match(html, /src="\.\/inventory-settings\.logic\.browser\.js"/);
});

test("inventory dashboard page shows stock value, stock-in report, and PDF export", async () => {
  const html = await readFile(dashboardPath, "utf8");

  assert.match(html, /<title>Dashboard สต๊อกสินค้า - หจก\.สวีทเฮาส์<\/title>/);
  assert.match(html, /id="totalInventoryValue"/);
  assert.match(html, /id="stockSkuCount"/);
  assert.match(html, /id="totalQuantityOnHand"/);
  assert.match(html, /id="zeroQuantitySkuCount"/);
  assert.match(html, /id="latestStockInRows"/);
  assert.match(html, /id="stockInRows"/);
  assert.match(html, /id="seeMoreStockIn"/);
  assert.match(html, /href="\/api\/inventory\/current-stock-pdf"/);
  assert.match(html, /src="\.\/inventory-dashboard\.logic\.browser\.js"/);
});
