import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const formsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../forms");

test("every page hamburger menu exposes the workflow transaction and template links", async () => {
  const files = (await readdir(formsDir)).filter((fileName) => fileName.endsWith(".html"));
  const pagesWithMenus = [];

  for (const fileName of files) {
    const html = await readFile(path.join(formsDir, fileName), "utf8");
    if (!html.includes('class="app-menu"')) continue;
    pagesWithMenus.push(fileName);
    assert.match(html, /href="\/workflow-transactions"[^>]*>Workflow ธุรกรรมเอกสาร<\/a>/, `${fileName}: missing Workflow transactions link`);
    assert.match(html, /href="\/workflow-templates"[^>]*>ตั้งค่า Workflow Template<\/a>/, `${fileName}: missing Workflow templates link`);
    assert.match(html, /href="\/user-profile"[^>]*>ข้อมูลส่วนตัว<\/a>/, `${fileName}: missing user profile link`);
  }

  assert.ok(pagesWithMenus.length > 0, "expected at least one page with a hamburger menu");
});

test("every Shopee page reuses the shared header component", async () => {
  const shopeePages = [
    "shopee-connection.html",
    "shopee-orders.html",
    "shopee-mapping.html",
    "shopee-shipment.html",
    "shopee-custom-label.html",
  ];
  const sharedHeader = await readFile(path.join(formsDir, "shopee-header.browser.js"), "utf8");

  assert.match(
    sharedHeader,
    /href="\/shopee-custom-label"[^>]*>Custom Label จาก PDF<\/a>/,
    "shared header: missing Shopee custom label link",
  );

  for (const fileName of shopeePages) {
    const html = await readFile(path.join(formsDir, fileName), "utf8");
    assert.match(
      html,
      /<shopee-header\b[^>]*><\/shopee-header>/,
      `${fileName}: missing shared Shopee header component`,
    );
    assert.match(
      html,
      /<script src="\/shopee-header\.browser\.js"><\/script>/,
      `${fileName}: missing shared Shopee header script`,
    );
  }
});
