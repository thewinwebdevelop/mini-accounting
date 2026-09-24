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
  }

  assert.ok(pagesWithMenus.length > 0, "expected at least one page with a hamburger menu");
});
