import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlPath = new URL("../forms/index.html", import.meta.url);

test("landing page introduces the accounting system and links to expense routes", async () => {
  const html = await readFile(htmlPath, "utf8");
  const topbar = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)?.[1] ?? "";

  assert.match(html, /<title>ระบบบัญชี หจก\.สวีทเฮาส์ เดซี่<\/title>/);
  assert.match(html, /ระบบบัญชี หจก\.สวีทเฮาส์ เดซี่/);
  assert.match(topbar.trim(), /^<details class="app-menu">/);
  assert.match(html, /class="app-menu"/);
  assert.match(html, /\.menu-panel \{[\s\S]*?left: 0;/);
  assert.match(html, /href="\/expense-requests"/);
  assert.match(html, /href="\/expense-request"/);
  assert.match(html, /href="\/inventory"/);
  assert.match(html, /สินค้าและสต๊อก/);
  assert.match(html, /href="\/google-drive"/);
  assert.match(html, /href="\/company-settings"/);
  assert.doesNotMatch(html, /class="quick-actions"/);
  assert.doesNotMatch(html, /class="button"/);
});
