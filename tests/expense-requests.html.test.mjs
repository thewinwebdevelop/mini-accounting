import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlPath = new URL("../forms/expense-requests.html", import.meta.url);

test("expense request list page supports filtering and creating a new request", async () => {
  const html = await readFile(htmlPath, "utf8");
  const topbar = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)?.[1] ?? "";

  assert.match(html, /<title>รายการใบเบิกจ่าย - หจก\.สวีทเฮาส์<\/title>/);
  assert.match(html, /class="app-menu"/);
  assert.match(html, /href="\/expense-request"/);
  assert.match(html, /id="statusFilter"/);
  assert.match(html, /value="draft"/);
  assert.match(html, /value="submitted"/);
  assert.match(html, /\/api\/expense-requests/);
  assert.match(html, /\/api\/expense-requests\/\$\{encodeURIComponent\(requestNo\)\}\/sync-drive/);
  assert.match(html, /Sync to Google Drive/);
  assert.match(html, /syncStatusLabel/);
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
  assert.match(html, /\?draftId=\$\{encodeURIComponent\(request\.draftId\)\}/);
  assert.match(html, /\?requestNo=\$\{encodeURIComponent\(requestNo\)\}/);
  assert.match(topbar.trim(), /^<details class="app-menu">/);
  assert.match(html, /\.menu-panel \{[\s\S]*?left: 0;/);
  assert.doesNotMatch(html, /\.panel \{[\s\S]*?overflow: hidden;/);
  assert.match(html, /\.file-menu\[open\] \.file-list \{[\s\S]*?z-index: 40;/);
});
