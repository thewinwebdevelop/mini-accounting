import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlPath = new URL("../forms/inventory.html", import.meta.url);

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
  assert.match(html, /src="\.\/inventory\.logic\.browser\.js"/);
});
