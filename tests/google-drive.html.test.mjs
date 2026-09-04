import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlPath = new URL("../forms/google-drive.html", import.meta.url);

test("google drive settings page supports OAuth setup from the UI", async () => {
  const html = await readFile(htmlPath, "utf8");
  const topbar = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)?.[1] ?? "";

  assert.match(html, /<title>ตั้งค่า Google Drive - หจก\.สวีทเฮาส์<\/title>/);
  assert.match(topbar.trim(), /^<details class="app-menu">/);
  assert.match(topbar, /href="\/inventory"/);
  assert.match(topbar, /href="\/inventory-settings"/);
  assert.match(html, /id="clientId"/);
  assert.match(html, /id="clientSecret"/);
  assert.match(html, /id="driveBasePath"/);
  assert.match(html, /id="saveConfig"/);
  assert.match(html, /id="loginGoogle"/);
  assert.match(topbar, /href="\/company-settings"/);
  assert.match(html, /\/api\/google-drive\/status/);
  assert.match(html, /\/api\/google-drive\/config/);
  assert.match(html, /\/api\/google-drive\/login/);
  assert.match(html, /Authorized JavaScript origin/);
  assert.match(html, /http:\/\/localhost:8787/);
  assert.match(html, /Authorized redirect URI/);
  assert.match(html, /http:\/\/localhost:8787\/api\/google-drive\/oauth2callback/);
  assert.match(html, /Test users/);
  assert.match(html, /sweethousecute\.manage@gmail\.com/);
});
