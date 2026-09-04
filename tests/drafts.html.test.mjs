import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlPath = new URL("../forms/drafts.html", import.meta.url);

test("legacy draft page redirects to the filtered expense request list", async () => {
  const html = await readFile(htmlPath, "utf8");

  assert.match(html, /<title>กำลังเปิดรายการแบบร่าง - หจก\.สวีทเฮาส์<\/title>/);
  assert.match(html, /url=\/expense-requests\?status=draft/);
  assert.match(html, /location\.replace\("\/expense-requests\?status=draft"\)/);
});
