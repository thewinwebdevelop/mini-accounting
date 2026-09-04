import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlPath = new URL("../forms/company-settings.html", import.meta.url);

test("company settings page supports editing company master data", async () => {
  const html = await readFile(htmlPath, "utf8");
  const topbar = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)?.[1] ?? "";

  assert.match(html, /<title>ตั้งค่าบริษัท - หจก\.สวีทเฮาส์<\/title>/);
  assert.match(topbar.trim(), /^<details class="app-menu">/);
  assert.match(html, /id="legalName"/);
  assert.match(html, /id="taxId"/);
  assert.match(html, /id="branch"/);
  assert.match(html, /id="address"/);
  assert.match(html, /\/api\/company-settings/);
  assert.match(html, /บันทึกข้อมูลบริษัท/);
});
