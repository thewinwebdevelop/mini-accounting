import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlPath = new URL("../forms/user-profile.html", import.meta.url);
const browserLogicPath = new URL("../forms/user-profile.logic.browser.js", import.meta.url);

test("user profile page exposes editable profile fields and authenticated API hooks", async () => {
  const html = await readFile(htmlPath, "utf8");

  assert.match(html, /<form[^>]+id="userProfileForm"/);
  assert.match(html, /<input[^>]+id="first-name-input"[^>]+name="firstName"/);
  assert.match(html, /<input[^>]+id="last-name-input"[^>]+name="lastName"/);
  assert.match(html, /<select[^>]+id="company-position-dropdown"[^>]+name="companyPositionId"/);
  assert.match(html, /<button[^>]+id="save-user-profile-btn"[^>]+type="submit"/);
  assert.match(html, /src="\.\/user-profile\.logic\.browser\.js"/);
});

test("user profile browser controller loads the profile and submits only editable fields", async () => {
  const source = await readFile(browserLogicPath, "utf8");

  assert.match(source, /api\("\/api\/auth\/profile"\)/);
  assert.match(source, /api\("\/api\/company-positions"\)/);
  assert.match(source, /method:\s*["']PATCH["']/);
  assert.match(source, /firstName:\s*form\.elements\.firstName\.value/);
  assert.match(source, /lastName:\s*form\.elements\.lastName\.value/);
  assert.match(source, /companyPositionId:\s*form\.elements\.companyPositionId\.value/);
  assert.doesNotMatch(source, /userId\s*:/);
  assert.doesNotMatch(source, /displayName\s*:/);
});

test("user profile page uses the LINE session gate before exposing the editable shell", async () => {
  const html = await readFile(htmlPath, "utf8");
  const source = await readFile(browserLogicPath, "utf8");

  assert.match(html, /data-line-auth-status/);
  assert.match(html, /https:\/\/static\.line-scdn\.net\/liff\/edge\/2\/sdk\.js/);
  assert.match(html, /data-auth-gate="true"/);
  assert.ok(html.indexOf("sdk.js") < html.indexOf("line-auth.browser.js"));
  assert.match(html, /data-authenticated-content[^>]+hidden/);
  assert.match(source, /fetch\("\/api\/auth\/me",\s*\{\s*credentials:\s*"same-origin"\s*\}\)/);
  assert.match(source, /line-auth\?returnTo=/);
});
