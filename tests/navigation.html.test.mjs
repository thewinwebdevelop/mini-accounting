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

test("home page links to the workflow template settings page", async () => {
  const html = await readFile(new URL("../forms/index.html", import.meta.url), "utf8");
  const menu = html.match(/<nav class="menu-panel" aria-label="เมนูหลัก">([\s\S]*?)<\/nav>/)?.[1] ?? "";
  assert.match(menu, /href="\/workflow-templates"/);
  assert.match(menu, /ตั้งค่า Workflow Template/);
});

// The transaction list/detail pages built in this pass are reachable from the
// home page now; Task 12's site-wide navigation sweep rolls both workflow
// links out to the other major pages in the `pages` array above (this is why
// those pages are not added to that array here).
test("home page links to workflow group pages", async () => {
  const html = await readFile(new URL("../forms/index.html", import.meta.url), "utf8");
  assert.match(html, /href="\/workflow-transactions"/);
  assert.match(html, /href="\/workflow-templates"/);
});

test("main navigation links to workflow group pages", async () => {
  const pagesWithWorkflow = [
    "../forms/index.html",
    "../forms/expense-request.html",
    "../forms/expense-requests.html",
    "../forms/substitute-receipt.html",
    "../forms/substitute-receipts.html",
  ];
  for (const page of pagesWithWorkflow) {
    const html = await readFile(new URL(page, import.meta.url), "utf8");
    assert.match(html, /href="\/workflow-transactions"/, page);
    assert.match(html, /href="\/workflow-templates"/, page);
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
