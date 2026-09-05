import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlPath = new URL("../forms/sale-skus.html", import.meta.url);
const browserLogicPath = new URL("../forms/sale-skus.logic.browser.js", import.meta.url);

test("sale SKU page makes platform and component dropdowns searchable", async () => {
  const html = await readFile(htmlPath, "utf8");

  assert.match(html, /id="salePlatform"[^>]*data-searchable/);
  assert.match(html, /<select name="stockSkuId" required data-searchable><\/select>/);
  assert.match(html, /src="\.\/searchable-select\.logic\.browser\.js"/);
  assert.match(html, /src="\.\/sale-skus\.logic\.browser\.js"/);
});

test("sale SKU browser controller enhances dynamic component dropdowns", async () => {
  const script = await readFile(browserLogicPath, "utf8");

  assert.match(script, /SearchableSelect\?\.enhance\(select\)/);
});
