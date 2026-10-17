import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("browser bootstrap posts the LIFF ID token and exposes the auth helper", async () => {
  const source = await readFile(new URL("../forms/line-auth.browser.js", import.meta.url), "utf8");
  assert.match(source, /liff\.getIDToken\(\)/);
  assert.match(source, /\/api\/auth\/line-session/);
  assert.match(source, /window\.SweetHouseAuth/);
  assert.match(source, /credentials:\s*["']same-origin["']/);
});

test("line-auth page loads the LIFF SDK before the bootstrap", async () => {
  const html = await readFile(new URL("../forms/line-auth.html", import.meta.url), "utf8");
  assert.match(html, /https:\/\/static\.line-scdn\.net\/liff\/edge\/2\/sdk\.js/);
  assert.match(html, /line-auth\.browser\.js/);
  assert.ok(html.indexOf("sdk.js") < html.indexOf("line-auth.browser.js"));
});

test("the browser bootstrap uses an internal return path only", async () => {
  const source = await readFile(new URL("../forms/line-auth.browser.js", import.meta.url), "utf8");
  assert.match(source, /startsWith\(["']\/["']\)/);
  assert.match(source, /window\.location\.replace/);
});
