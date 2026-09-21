import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

import { buildFakeDomFromHtml } from "./support/fake-dom.mjs";

const htmlPath = new URL("../forms/expense-requests.html", import.meta.url);

test("expense request list page supports filtering and creating a new request", async () => {
  const html = await readFile(htmlPath, "utf8");
  const topbar = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)?.[1] ?? "";

  assert.match(html, /<title>รายการใบเบิกจ่าย - หจก\.สวีทเฮาส์<\/title>/);
  assert.match(html, /class="app-menu"/);
  assert.match(html, /href="\/expense-request"/);
  assert.match(html, /href="\/inventory"/);
  assert.match(html, /href="\/inventory-settings"/);
  assert.match(html, /id="statusFilter"/);
  assert.match(html, /value="draft"/);
  assert.match(html, /value="submitted"/);
  assert.match(html, /value="approved"/);
  assert.match(html, /\/api\/expense-requests/);
  assert.match(html, /\/api\/expense-requests\/\$\{encodeURIComponent\(requestNo\)\}\/approve/);
  assert.match(html, /data-approve/);
  assert.match(html, /ลง Sheet อีกครั้ง/);
  assert.match(html, /\/api\/expense-requests\/\$\{encodeURIComponent\(requestNo\)\}\/sync-drive/);
  assert.match(html, /Sync to Google Drive/);
  assert.match(html, /syncStatusLabel/);
  assert.match(html, /sheetStatusLabel/);
  assert.match(html, /เปิด Sheet/);
  assert.match(html, /เปิดใบเบิกจ่าย/);
  assert.match(html, /เปิดชุดรวม/);
  assert.match(html, /reimbursementPdf/);
  assert.match(html, /Raw files/);
  assert.match(html, /request\.rawFiles/);
  assert.match(html, /reimbursementUrl/);
  assert.match(html, /auditUrl/);
  assert.match(html, /driveFolderUrl/);
  assert.match(html, /needs_resync/);
  assert.match(html, /href="\/google-drive"/);
  assert.match(html, /href="\/company-settings"/);
  assert.match(html, /\?draftId=\$\{encodeURIComponent\(request\.draftId \|\| ""\)\}/);
  assert.match(html, /\?requestNo=\$\{encodeURIComponent\(requestNo\)\}/);
  assert.match(topbar.trim(), /^<details class="app-menu">/);
  assert.match(html, /\.menu-panel \{[\s\S]*?left: 0;/);
  assert.doesNotMatch(html, /\.panel \{[\s\S]*?overflow: hidden;/);
  assert.match(html, /\.file-menu\[open\] \.file-list \{[\s\S]*?z-index: 40;/);
});

async function expenseControllerHarness(requests = [], approveResult = { sheetSync: { syncStatus: "managed_by_workflow" } }) {
  const html = await readFile(htmlPath, "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const { document, elementsById } = buildFakeDomFromHtml(html);
  const fetch = async (url) => ({ ok: true, json: async () => url === "/api/expense-requests" ? { requests } : approveResult });
  const context = vm.createContext({ document, fetch, URLSearchParams, location: { search: "" } });
  vm.runInContext(`${script}\nglobalThis.__expense = { actionHtml, statusHtml, sheetStatusLabel, approveRequest };`, context);
  await new Promise((resolve) => setTimeout(resolve, 5));
  return { api: context.__expense, elements: elementsById };
}

test("workflow-bound approved REQs complete without child Sheet retry while standalone actions stay unchanged", async () => {
  const { api } = await expenseControllerHarness();
  const workflow = { requestNo: "REQ-W", status: "approved", transactionNo: "TXN-1", sheetSyncStatus: "managed_by_workflow" };
  const legacy = { requestNo: "REQ-L", status: "approved", transactionNo: "TXN-1", sheetSyncStatus: "synced", sheetSpreadsheetUrl: "https://docs.google.com/sheet" };
  const standalone = { requestNo: "REQ-S", status: "approved", sheetSyncStatus: "sync_failed" };
  assert.match(api.actionHtml(workflow), /data-complete="REQ-W"/);
  assert.doesNotMatch(api.actionHtml(workflow), /ลง Sheet อีกครั้ง/);
  assert.match(api.sheetStatusLabel("managed_by_workflow"), /Workflow/);
  assert.doesNotMatch(api.sheetStatusLabel("managed_by_workflow"), /ลง Sheet แล้ว/);
  assert.match(api.actionHtml(legacy), /เปิด Sheet/);
  assert.doesNotMatch(api.actionHtml(legacy), /ลง Sheet อีกครั้ง/);
  assert.match(api.actionHtml(standalone), /ลง Sheet อีกครั้ง/);
  assert.doesNotMatch(api.actionHtml(standalone), /data-complete="REQ-S"/);
});

test("workflow approval reports parent-owned Sheets while standalone approval keeps its existing success message", async () => {
  const workflow = await expenseControllerHarness([], { sheetSync: { syncStatus: "managed_by_workflow" } });
  const workflowButton = { textContent: "อนุมัติ", disabled: false };
  await workflow.api.approveRequest("REQ-W", workflowButton);
  assert.match(workflow.elements.listStatus.textContent, /ลง Sheet จากหน้า Workflow หลังปิดงาน/);
  assert.doesNotMatch(workflow.elements.listStatus.textContent, /ยังลง Sheet ไม่สำเร็จ/);

  const standalone = await expenseControllerHarness([], { sheetSync: { syncStatus: "synced" } });
  const standaloneButton = { textContent: "อนุมัติ", disabled: false };
  await standalone.api.approveRequest("REQ-S", standaloneButton);
  assert.match(standalone.elements.listStatus.textContent, /อนุมัติและลง Sheet แล้ว/);
});

test("inline workflow request rendering escapes hostile transaction, error, and source values", async () => {
  const { api } = await expenseControllerHarness();
  const hostile = '<img src=x onerror="bad">';
  const request = { requestNo: hostile, transactionNo: hostile, status: "approved", sheetSyncStatus: "sync_failed", sheetSyncError: hostile, requestTitle: hostile };
  const actions = api.actionHtml(request);
  const status = api.statusHtml(request);
  assert.doesNotMatch(actions, /<img/);
  assert.match(actions, /&lt;img/);
  assert.doesNotMatch(status, /<img/);
  assert.match(status, /Sheet ไม่สำเร็จ/);
});

test("expense list treats legacy rows as read-only and labels pending drafts", async () => {
  const { api } = await expenseControllerHarness();
  const legacy = { draftId: "DRAFT-2026-09-0001", legacyReadOnly: true, status: "draft", requestTitle: "เก่า" };
  const numbered = { requestNo: "REQ-2026-09-0001", legacyReadOnly: false, status: "draft", requestTitle: "ใหม่" };
  assert.match(api.actionHtml(legacy), /ดูแบบร่างเก่า/);
  assert.doesNotMatch(api.actionHtml(legacy), /แก้ไขต่อ|data-approve|data-complete|sync-drive/);
  assert.match(api.actionHtml(numbered), /\?requestNo=REQ-2026-09-0001/);
  assert.match(api.statusHtml({ status: "pending_approval" }), /รอตรวจอนุมัติ/);
});
