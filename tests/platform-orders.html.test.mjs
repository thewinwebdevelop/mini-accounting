import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("platform orders page has upload review and post controls", async () => {
  const html = await readFile(join(process.cwd(), "forms", "platform-orders.html"), "utf8");

  assert.match(html, /id="platformOrderUploadForm"/);
  assert.match(html, /id="platformOrderPlatform"/);
  assert.match(html, /id="platformOrderFile"/);
  assert.match(html, /id="platformOrderImportRows"/);
  assert.match(html, /id="platformOrderDetail"/);
  assert.match(html, /id="postPlatformOrderImport"/);
  assert.match(html, /id="platformOrderPlatform"[^>]*data-searchable/);
  assert.match(html, /searchable-select\.logic\.browser\.js/);
  assert.match(html, /platform-orders\.logic\.browser\.js/);
});
