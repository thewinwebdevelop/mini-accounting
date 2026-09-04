import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("substitute receipt list page exposes filters and action columns", async () => {
  const html = await readFile(new URL("../forms/substitute-receipts.html", import.meta.url), "utf8");

  assert.match(html, /<title>รายการใบรับรองแทนใบเสร็จ - หจก\.สวีทเฮาส์<\/title>/);
  assert.match(html, /id="substituteReceiptRows"/);
  assert.match(html, /id="statusFilter"/);
  assert.match(html, /id="searchText"/);
  assert.match(html, /src="\.\/substitute-receipts\.logic\.browser\.js"/);
});
