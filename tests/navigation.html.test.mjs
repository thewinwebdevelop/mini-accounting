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
  "inventory-dashboard.html",
  "inventory-product-detail.html",
  "inventory-stock-list.html",
  "inventory-settings.html",
  "platform-orders.html",
  "sale-skus.html",
  "substitute-receipt.html",
  "substitute-receipts.html",
  "substitute-receipt-vendors.html",
];

function menuGroup(menu, title) {
  const titleToken = `<div class="menu-group-title">${title}</div>`;
  const start = menu.indexOf(titleToken);
  if (start < 0) return "";
  const next = menu.indexOf('<div class="menu-group">', start + titleToken.length);
  return menu.slice(start, next < 0 ? menu.length : next);
}

test("main pages link to substitute receipt creation from the document menu", async () => {
  for (const page of pages) {
    const html = await readFile(new URL(`../forms/${page}`, import.meta.url), "utf8");
    const menu = html.match(/<nav class="menu-panel" aria-label="เมนูหลัก">([\s\S]*?)<\/nav>/)?.[1] ?? "";
    assert.match(menu, /href="\/substitute-receipt"/, page);
    assert.match(menu, /สร้างใบรับรองแทนใบเสร็จ/, page);
    assert.match(menu, /href="\/substitute-receipts"/, page);
    assert.match(menu, /รายการใบรับรองแทนใบเสร็จ/, page);
    assert.match(menu, /href="\/substitute-receipt-vendors"/, page);
    assert.match(menu, /ตั้งค่าผู้ขายใบรับรอง/, page);
    assert.match(menu, /href="\/sale-skus"/, page);
    assert.match(menu, /href="\/platform-orders"/, page);
    assert.match(menu, /Sale SKU \/ Bundle SKU/, page);
    assert.match(menu, /href="\/inventory-dashboard"/, page);
    assert.match(menu, /Dashboard สต๊อก/, page);
    assert.match(menu, /href="\/inventory-stock-list"/, page);
    assert.match(menu, /List Stock/, page);
  }
});

test("main pages separate substitute receipt links from expense request links", async () => {
  for (const page of pages) {
    const html = await readFile(new URL(`../forms/${page}`, import.meta.url), "utf8");
    const menu = html.match(/<nav class="menu-panel" aria-label="เมนูหลัก">([\s\S]*?)<\/nav>/)?.[1] ?? "";
    const expenseGroup = menuGroup(menu, "ใบเบิกจ่ายเอกสาร");
    const substituteReceiptGroup = menuGroup(menu, "ใบรับรองแทนใบเสร็จ");

    assert.match(expenseGroup, /href="\/expense-requests"/, page);
    assert.match(expenseGroup, /href="\/expense-request"/, page);
    assert.doesNotMatch(expenseGroup, /href="\/substitute-receipt"/, page);
    assert.match(substituteReceiptGroup, /href="\/substitute-receipts"/, page);
    assert.match(substituteReceiptGroup, /href="\/substitute-receipt"/, page);
    assert.match(substituteReceiptGroup, /href="\/substitute-receipt-vendors"/, page);
  }
});

test("hamburger menu popover stays inside short viewports", async () => {
  for (const page of pages) {
    const html = await readFile(new URL(`../forms/${page}`, import.meta.url), "utf8");
    const menuPanelCss = html.match(/\.menu-panel \{([\s\S]*?)\n    \}/)?.[1] ?? "";

    assert.match(menuPanelCss, /max-height:\s*calc\(100vh - 70px\);/, page);
    assert.match(menuPanelCss, /overflow-y:\s*auto;/, page);
    assert.match(menuPanelCss, /overscroll-behavior:\s*contain;/, page);
  }
});
