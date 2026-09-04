import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlPath = new URL("../forms/expense-request.html", import.meta.url);

test("expense form keeps copy/export controls in the backup tools section", async () => {
  const html = await readFile(htmlPath, "utf8");
  const topbar = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)?.[1] ?? "";

  assert.doesNotMatch(topbar, /copyJson|copyMarkdown|submitRequest|saveDraft/);
  assert.match(html, /<details class="section backup-tools">/);
  assert.match(html, /<summary[^>]*>เครื่องมือสำรอง \/ สำหรับตรวจสอบ<\/summary>/);
  assert.match(html, /<button class="button warn" type="button" id="copyJson">Copy JSON<\/button>/);
  assert.match(html, /<button class="button secondary" type="button" id="copyMarkdown">Copy Markdown<\/button>/);
});

test("expense form uses placeholders instead of sample values for user-entered fields", async () => {
  const html = await readFile(htmlPath, "utf8");

  assert.doesNotMatch(html, /value="ค่าแพ็คสินค้า"/);
  assert.doesNotMatch(html, /value="คุณตัวอย่าง/);
  assert.doesNotMatch(html, /value="Line: sample-ops"/);
  assert.doesNotMatch(html, /value="กสิกรไทย"/);
  assert.doesNotMatch(html, /value="123-4-56789-0"/);
  assert.doesNotMatch(html, /value="ซองไปรษณีย์ 100 ใบ และถุง OPP 200 ใบ"/);
  assert.doesNotMatch(html, /value="1869\.16"/);
  assert.doesNotMatch(html, /value="130\.84"/);
  assert.doesNotMatch(html, /value="2026-09"/);
  assert.doesNotMatch(html, /value="2026-09-03"/);
  assert.doesNotMatch(html, /<option selected>marketing<\/option>/);
  assert.match(html, /placeholder="เช่น ค่าแพ็คสินค้า"/);
  assert.match(html, /<option value="" selected disabled>เลือกแผนก\/ตำแหน่ง<\/option>/);
});

test("expense form shows automatic document number instead of an editable sequence field", async () => {
  const html = await readFile(htmlPath, "utf8");

  assert.doesNotMatch(html, /name="sequence"/);
  assert.doesNotMatch(html, /ลำดับเอกสาร \*/);
  assert.match(html, /id="requestNoPreview"/);
  assert.match(html, /เลขเอกสารถัดไป/);
  assert.match(html, /refreshRequestNo/);
});

test("expense line template is collapsible with a summary for each item", async () => {
  const html = await readFile(htmlPath, "utf8");
  const template = html.match(/<template id="lineTemplate">([\s\S]*?)<\/template>/)?.[1] ?? "";

  assert.match(template, /<details class="line-row" open>/);
  assert.match(template, /<summary class="line-summary">/);
  assert.match(template, /data-line-title/);
  assert.match(template, /data-line-total/);
  assert.match(html, /function updateLineSummaries/);
});

test("expense form exposes navigation menu and bottom submit bar", async () => {
  const html = await readFile(htmlPath, "utf8");
  const topbar = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)?.[1] ?? "";
  const bottomBar = html.match(/<div class="bottom-action-bar">([\s\S]*?)<\/div>/)?.[1] ?? "";

  assert.match(topbar.trim(), /^<details class="app-menu">/);
  assert.match(topbar, /class="app-menu"/);
  assert.match(topbar, /href="\/expense-requests"/);
  assert.match(topbar, /href="\/expense-request"/);
  assert.match(topbar, /href="\/google-drive"/);
  assert.match(topbar, /href="\/company-settings"/);
  assert.match(topbar, /id="resetForm"/);
  assert.match(html, /\.menu-panel \{[\s\S]*?left: 0;/);
  assert.match(bottomBar, /id="saveDraft"/);
  assert.match(bottomBar, /id="submitRequest"/);
  assert.doesNotMatch(topbar, /id="saveDraft"|id="submitRequest"/);
  assert.doesNotMatch(html, /id="draftList"/);
  assert.doesNotMatch(html, /แบบร่างล่าสุด/);
  assert.match(html, /let currentDraftId/);
  assert.match(html, /let currentRequestNo/);
  assert.match(html, /function loadDraft/);
  assert.match(html, /function loadSubmittedRequest/);
  assert.match(html, /\/api\/expense-drafts/);
  assert.match(html, /\/api\/expense-requests\/\$\{encodeURIComponent\(requestNo\)\}/);
  assert.match(html, /new URLSearchParams\(location.search\)\.get\("draftId"\)/);
  assert.match(html, /new URLSearchParams\(location.search\)\.get\("requestNo"\)/);
});

test("expense form submit status reports generated PDF files", async () => {
  const html = await readFile(htmlPath, "utf8");

  assert.match(html, /result\.pdfFiles\?\.length/);
  assert.match(html, /สร้าง PDF/);
});
