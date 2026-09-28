import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("LINE intake page exposes editable accounting fields and confirm action", async () => {
  const html = await readFile(new URL("../forms/line-intake.html", import.meta.url), "utf8");
  assert.match(html, /data-confirm-form/);
  assert.match(html, /name="accountingMonth"/);
  assert.match(html, /name="paymentTargetName"/);
  assert.match(html, /name="amountBeforeVat"/);
  assert.match(html, /line-intake.browser.js/);
});

test("LINE intake browser controller posts an explicit confirmation payload", async () => {
  const source = await readFile(new URL("../forms/line-intake.browser.js", import.meta.url), "utf8");
  assert.match(source, /\/confirm/);
  assert.match(source, /expenseLines/);
  assert.match(source, /textContent/);
  assert.doesNotMatch(source, /innerHTML/);
});

test("LINE intake keeps LIFF authentication under the configured endpoint path", async () => {
  const source = await readFile(new URL("../forms/line-intake.browser.js", import.meta.url), "utf8");
  assert.match(source, /\/line-intake\/auth\?returnTo=/);
  assert.doesNotMatch(source, /\/line-auth\?returnTo=/);
});

test("LINE intake explains how to create a review link when opened without an intake", async () => {
  const source = await readFile(new URL("../forms/line-intake.browser.js", import.meta.url), "utf8");
  assert.match(source, /กรุณาส่งรูปหรือ PDF ใบแจ้งหนี้เข้า LINE OA/);
});
