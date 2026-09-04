import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlPath = new URL("../forms/substitute-receipt-vendors.html", import.meta.url);
const browserLogicPath = new URL("../forms/substitute-receipt-vendors.logic.browser.js", import.meta.url);

test("substitute receipt vendor settings page manages reusable payee presets", async () => {
  const html = await readFile(htmlPath, "utf8");

  assert.match(html, /<title>ตั้งค่าผู้ขายใบรับรองแทนใบเสร็จ - หจก\.สวีทเฮาส์<\/title>/);
  assert.match(html, /id="vendorForm"/);
  assert.match(html, /id="vendorName"/);
  assert.match(html, /id="vendorTaxId"/);
  assert.match(html, /id="vendorPaymentChannel"/);
  assert.match(html, /id="vendorPaymentReference"/);
  assert.match(html, /id="vendorDefaultBusinessPurpose"/);
  assert.match(html, /id="vendorRows"/);
  assert.match(html, /src="\.\/substitute-receipt-vendors\.logic\.browser\.js"/);
});

test("substitute receipt vendor settings browser controller calls vendor preset API", async () => {
  const browserLogic = await readFile(browserLogicPath, "utf8");

  assert.match(browserLogic, /\/api\/substitute-receipt-vendors\?includeInactive=1/);
  assert.match(browserLogic, /\/api\/substitute-receipt-vendors\/.*encodeURIComponent/);
});
