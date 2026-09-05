import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlPath = new URL("../forms/inventory.html", import.meta.url);
const dashboardPath = new URL("../forms/inventory-dashboard.html", import.meta.url);
const detailPath = new URL("../forms/inventory-product-detail.html", import.meta.url);
const ledgerPath = new URL("../forms/inventory-ledger.html", import.meta.url);
const purchaseInPath = new URL("../forms/inventory-purchase-in.html", import.meta.url);
const stockListPath = new URL("../forms/inventory-stock-list.html", import.meta.url);
const settingsPath = new URL("../forms/inventory-settings.html", import.meta.url);

test("inventory page focuses on product and Stock SKU master data", async () => {
  const html = await readFile(htmlPath, "utf8");

  assert.match(html, /<title>ระบบสต๊อกสินค้า - หจก\.สวีทเฮาส์<\/title>/);
  assert.match(html, /id="productForm"/);
  assert.match(html, /id="skuForm"/);
  assert.doesNotMatch(html, /id="purchaseInForm"/);
  assert.doesNotMatch(html, /id="balanceRows"/);
  assert.doesNotMatch(html, /id="stockCardRows"/);
  assert.match(html, /id="productRecordId"/);
  assert.match(html, /id="skuRecordId"/);
  assert.match(html, /href="\/inventory-purchase-in"/);
  assert.match(html, /href="\/inventory-ledger"/);
  assert.match(html, /href="\/inventory-settings"/);
  assert.match(html, /href="\/inventory-stock-list"/);
  assert.match(html, /data-create-product-flow/);
  assert.match(html, /<select id="productCategory" name="category" required data-searchable><\/select>/);
  assert.match(html, /<select id="skuProductSelect" name="productId" required data-searchable><\/select>/);
  assert.doesNotMatch(html, /<input id="productCategory"/);
  assert.match(html, /src="\.\/searchable-select\.logic\.browser\.js"/);
  assert.match(html, /src="\.\/inventory\.logic\.browser\.js"/);
});

test("inventory purchase-in page provides a dedicated stock receiving flow", async () => {
  const html = await readFile(purchaseInPath, "utf8");

  assert.match(html, /<title>รับสินค้าเข้าคลัง - หจก\.สวีทเฮาส์<\/title>/);
  assert.match(html, /id="purchaseInForm"/);
  assert.match(html, /id="purchaseSkuSelect"/);
  assert.match(html, /name="movementDate"/);
  assert.match(html, /name="quantity"/);
  assert.match(html, /name="unitCost"/);
  assert.match(html, /href="\/inventory-ledger"/);
  assert.match(html, /src="\.\/searchable-select\.logic\.browser\.js"/);
  assert.match(html, /src="\.\/inventory-purchase-in\.logic\.browser\.js"/);
});

test("inventory ledger page provides separated stock data views", async () => {
  const html = await readFile(ledgerPath, "utf8");

  assert.match(html, /<title>ข้อมูลสต๊อกสินค้า - หจก\.สวีทเฮาส์<\/title>/);
  assert.match(html, /id="balanceRows"/);
  assert.match(html, /id="productRows"/);
  assert.match(html, /id="skuRows"/);
  assert.match(html, /id="stockCardRows"/);
  assert.match(html, /id="stockCardSkuSelect"/);
  assert.match(html, /href="\/inventory-purchase-in"/);
  assert.match(html, /src="\.\/searchable-select\.logic\.browser\.js"/);
  assert.match(html, /src="\.\/inventory-ledger\.logic\.browser\.js"/);
});

test("inventory browser controller supports create product mode from stock list", async () => {
  const script = await readFile(new URL("../forms/inventory.logic.browser.js", import.meta.url), "utf8");

  assert.match(script, /URLSearchParams\(window\.location\.search\)/);
  assert.match(script, /create-product/);
  assert.match(script, /focusCreateProductFlow/);
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

test("inventory stock list page supports search, filters, and grouped parent child display", async () => {
  const html = await readFile(stockListPath, "utf8");

  assert.match(html, /<title>List Stock - หจก\.สวีทเฮาส์<\/title>/);
  assert.match(html, /id="stockListSearch"/);
  assert.match(html, /id="stockListCategory"/);
  assert.match(html, /id="stockListCategory"[^>]*data-searchable/);
  assert.match(html, /id="stockListStatus"/);
  assert.match(html, /id="stockListMode"/);
  assert.match(html, /id="parentStockRows"/);
  assert.match(html, /id="stockGroupRows"/);
  assert.match(html, /product-image-thumb/);
  assert.match(html, /inventory-product-detail\?productId=/);
  assert.match(html, /href="\/inventory\?mode=create-product"/);
  assert.match(html, /src="\.\/inventory-stock-list\.logic\.browser\.js"/);
  assert.match(html, /src="\.\/searchable-select\.logic\.browser\.js"/);
});

test("inventory product detail page edits parent and child SKUs and shows stock history", async () => {
  const html = await readFile(detailPath, "utf8");

  assert.match(html, /<title>รายละเอียดสินค้า - หจก\.สวีทเฮาส์<\/title>/);
  assert.match(html, /id="productDetailForm"/);
  assert.match(html, /id="detailProductCategory"/);
  assert.match(html, /id="detailProductCategory"[^>]*data-searchable/);
  assert.match(html, /id="skuDetailRows"/);
  assert.match(html, /id="movementHistoryRows"/);
  assert.match(html, /id="productSummary"/);
  assert.match(html, /id="productImageForm"/);
  assert.match(html, /id="productImageInput"/);
  assert.match(html, /data-sku-image-form/);
  assert.match(html, /href="\/inventory-stock-list"/);
  assert.match(html, /src="\.\/inventory-product-detail\.logic\.browser\.js"/);
  assert.match(html, /src="\.\/searchable-select\.logic\.browser\.js"/);
});
