import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("standalone Shopee custom label page exposes upload, editors, comparison panes, and actions", async () => {
  const html = await readFile(join(process.cwd(), "forms", "shopee-custom-label.html"), "utf8");
  for (const id of [
    "shopeeCustomLabelFile",
    "uploadShopeeCustomLabelButton",
    "shopeeCustomLabelPages",
    "shopeeCustomLabelItems",
    "previewShopeeCustomLabelButton",
    "saveShopeeCustomLabelButton",
    "shopeeCustomLabelOriginalFrame",
    "shopeeCustomLabelPreviewFrame",
    "shopeeCustomLabelStatus",
    "openShopeeCustomLabelComparisonButton",
  ]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /data-custom-label-bundle/);
  assert.match(html, /data-custom-label-sku/);
  assert.match(html, /data-custom-label-quantity/);
  assert.match(html, /data-custom-label-remove/);
  assert.match(html, /shopee-custom-label\.logic\.browser\.js/);
  assert.match(html, /href="\/shopee-custom-label"/);
});

test("custom label page keeps original and generated PDF panes separate", async () => {
  const html = await readFile(join(process.cwd(), "forms", "shopee-custom-label.html"), "utf8");
  assert.match(html, /id="shopeeCustomLabelOriginalFrame"[^>]*title="[^"]*เดิม/);
  assert.match(html, /id="shopeeCustomLabelPreviewFrame"[^>]*title="[^"]*(ใหม่|preview)/i);
  assert.match(html, /id="downloadShopeeCustomLabelButton"/);
  assert.match(html, /id="downloadShopeeCustomLabelButton"[^>]*type="button"/);
  assert.doesNotMatch(html, /id="downloadShopeeCustomLabelButton"[^>]*href="#"/);
  assert.match(html, /id="openShopeeCustomLabelComparisonButton"/);
});

test("custom label download uses the saved PDF URL and refuses an empty fallback", async () => {
  const browserLogic = await readFile(join(process.cwd(), "forms", "shopee-custom-label.logic.browser.js"), "utf8");
  assert.match(browserLogic, /downloadUrlFor/);
  assert.match(browserLogic, /\/api\/shopee\/custom-labels\/\$\{encodeURIComponent\(job\.id\)\}\/download/);
  assert.match(browserLogic, /ไม่มีไฟล์ PDF สำหรับดาวน์โหลด/);
});
