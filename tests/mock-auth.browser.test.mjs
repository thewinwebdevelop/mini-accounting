import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlPath = new URL("../forms/mock-auth.html", import.meta.url);
const browserLogicPath = new URL("../forms/mock-auth.browser.js", import.meta.url);

test("mock auth page posts the local session and preserves a safe return path", async () => {
  const html = await readFile(htmlPath, "utf8");
  const source = await readFile(browserLogicPath, "utf8");

  assert.match(html, /id="mock-auth-status"/);
  assert.match(html, /src="\.\/mock-auth\.browser\.js"/);
  assert.match(source, /\/api\/auth\/mock-session/);
  assert.match(source, /returnTo/);
  assert.match(source, /startsWith\("\/\/"\)/);
  assert.doesNotMatch(source, /liff\.login/);
});
