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
    "saveShopeeCustomLabelButton",
    "shopeeCustomLabelStatus",
    "openShopeeCustomLabelComparisonButton",
  ]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /data-custom-label-bundle/);
  assert.match(html, /data-custom-label-sku/);
  assert.match(html, /data-custom-label-quantity/);
  assert.match(html, /data-custom-label-remove/);
  assert.match(html, /shopee-custom-label\.logic\.browser\.js/);
  assert.match(html, /<shopee-header\b[^>]*page-title="Shopee Custom Label จาก PDF"[^>]*><\/shopee-header>/);
  assert.match(html, /<script src="\/shopee-header\.browser\.js"><\/script>/);
  assert.doesNotMatch(html, /id="previewShopeeCustomLabelButton"/);
  assert.doesNotMatch(html, /custom-label-compare-section/);
});

test("custom label page shows download after save and opens comparison from a button", async () => {
  const html = await readFile(join(process.cwd(), "forms", "shopee-custom-label.html"), "utf8");
  assert.match(html, /id="downloadShopeeCustomLabelButton"/);
  assert.match(html, /id="downloadShopeeCustomLabelButton"[^>]*type="button"/);
  assert.doesNotMatch(html, /id="downloadShopeeCustomLabelButton"[^>]*href="#"/);
  assert.match(html, /id="openShopeeCustomLabelComparisonButton"[^>]*type="button"/);
});

test("custom label download uses the saved PDF URL and refuses an empty fallback", async () => {
  const browserLogic = await readFile(join(process.cwd(), "forms", "shopee-custom-label.logic.browser.js"), "utf8");
  assert.match(browserLogic, /downloadUrlFor/);
  assert.match(browserLogic, /\/api\/shopee\/custom-labels\/\$\{encodeURIComponent\(job\.id\)\}\/download/);
  assert.match(browserLogic, /ไม่มีไฟล์ PDF สำหรับดาวน์โหลด/);
  assert.match(browserLogic, /window\.open\("about:blank", "_blank"/);
  assert.match(browserLogic, /\/preview/);
});

test("custom label PDF URLs include a cookie-independent file access token in LINE mode", async () => {
  const server = await readFile(join(process.cwd(), "local-server.mjs"), "utf8");
  assert.match(server, /function customLabelFileUrl\(jobId, kind, request\)/);
  assert.match(server, /issueFileAccessToken\(\{[\s\S]*?path: fileUrl\.pathname/);
  assert.match(server, /\(source\|preview-file\|output\|download\|comparison\)/);
});
