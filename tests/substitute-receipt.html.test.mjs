import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlPath = new URL("../forms/substitute-receipt.html", import.meta.url);
const browserLogicPath = new URL("../forms/substitute-receipt.logic.browser.js", import.meta.url);

test("substitute receipt page provides stock purchase form, evidence uploads, and summary", async () => {
  const html = await readFile(htmlPath, "utf8");

  assert.match(html, /<title>ใบรับรองแทนใบเสร็จรับเงิน - หจก\.สวีทเฮาส์<\/title>/);
  assert.match(html, /id="substituteReceiptForm"/);
  assert.match(html, /id="receiptNoPreview"/);
  assert.match(html, /name="receiptType"/);
  assert.match(html, /value="stock_purchase"/);
  assert.match(html, /id="stockLineItems"/);
  assert.match(html, /id="addStockLine"/);
  assert.match(html, /name="stockSkuId"/);
  assert.match(html, /name="quantity"/);
  assert.match(html, /name="unitCost"/);
  assert.match(html, /name="evidence_paymentSlip"/);
  assert.match(html, /name="evidence_purchaseOrder"/);
  assert.match(html, /name="evidence_goodsReceived"/);
  assert.match(html, /id="submitSubstituteReceipt"/);
  assert.match(html, /id="saveDraft"/);
  assert.match(html, /id="submitForApproval"/);
  assert.match(html, /id="approveReceipt"/);
  assert.match(html, /id="receiveStock"/);
  assert.match(html, /id="receiptStatus"/);
  assert.match(html, /src="\.\/substitute-receipt\.logic\.js"/);
  assert.match(html, /src="\.\/substitute-receipt\.logic\.browser\.js"/);
});

test("substitute receipt browser controller loads draft and submitted receipt query targets", async () => {
  const browserLogic = await readFile(browserLogicPath, "utf8");

  assert.match(browserLogic, /new URLSearchParams\(location\.search\)\.get\("draftId"\)/);
  assert.match(browserLogic, /new URLSearchParams\(location\.search\)\.get\("receiptNo"\)/);
  assert.match(browserLogic, /\/api\/substitute-receipt-drafts\//);
  assert.match(browserLogic, /\/api\/substitute-receipts\/.*\/approve/);
  assert.match(browserLogic, /\/api\/substitute-receipts\/.*\/receive-stock/);
});
