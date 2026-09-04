import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pages = [
  "company-settings.html",
  "expense-request.html",
  "expense-requests.html",
  "google-drive.html",
  "index.html",
  "inventory.html",
  "inventory-settings.html",
  "substitute-receipt.html",
  "substitute-receipts.html",
];

test("main pages link to substitute receipt creation from the document menu", async () => {
  for (const page of pages) {
    const html = await readFile(new URL(`../forms/${page}`, import.meta.url), "utf8");
    const menu = html.match(/<nav class="menu-panel" aria-label="เมนูหลัก">([\s\S]*?)<\/nav>/)?.[1] ?? "";
    assert.match(menu, /href="\/substitute-receipt"/, page);
    assert.match(menu, /สร้างใบรับรองแทนใบเสร็จ/, page);
    assert.match(menu, /href="\/substitute-receipts"/, page);
    assert.match(menu, /รายการใบรับรองแทนใบเสร็จ/, page);
  }
});
