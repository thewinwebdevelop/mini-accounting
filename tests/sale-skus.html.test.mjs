import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("sale SKU page manages platform SKUs and bundle components", async () => {
  const html = await readFile(new URL("../forms/sale-skus.html", import.meta.url), "utf8");
  const browserLogic = await readFile(new URL("../forms/sale-skus.logic.browser.js", import.meta.url), "utf8");

  assert.match(html, /<title>Sale SKU \/ Bundle SKU - หจก\.สวีทเฮาส์<\/title>/);
  assert.match(html, /id="saleSkuForm"/);
  assert.match(html, /id="saleSkuRows"/);
  assert.match(html, /id="componentRows"/);
  assert.match(html, /id="componentTemplate"/);
  assert.match(html, /href="\/inventory"/);
  assert.match(html, /src="\.\/sale-skus\.logic\.browser\.js"/);
  assert.match(browserLogic, /\/api\/inventory\/sale-skus/);
  assert.match(browserLogic, /\/api\/inventory\/stock-skus/);
  assert.match(browserLogic, /addComponent/);
  assert.match(browserLogic, /data-edit-sale-sku/);
});
