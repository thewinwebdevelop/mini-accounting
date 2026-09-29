import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { buildFakeDomFromHtml } from "./support/fake-dom.mjs";

const loaderPath = new URL("../forms/company-position.browser.js", import.meta.url);

async function loadLoader({ positions, selectedValue = "" }) {
  const { elementsById, document } = buildFakeDomFromHtml(
    `<select id="requesterRole" data-searchable><option value="" selected disabled>เลือกตำแหน่ง</option></select>`,
  );
  const fetch = async () => ({ ok: true, json: async () => ({ positions }) });
  const window = { fetch, document };
  const context = vm.createContext({ window, document, fetch });
  vm.runInContext(await readFile(loaderPath, "utf8"), context);

  const select = elementsById.requesterRole;
  await context.window.SweetHouseCompanyPositions.loadInto(select, { selectedValue });
  return select;
}

test("company-position loader offers active positions in master order only", async () => {
  const select = await loadLoader({
    positions: [
      { id: "p-2", label: "Marketing", status: "active", sort_order: 2 },
      { id: "p-old", label: "Old position", status: "inactive", sort_order: 0 },
      { id: "p-1", label: "Owner", status: "active", sort_order: 1 },
    ],
  });

  assert.deepEqual(
    select.querySelectorAll("option").map((option) => ({ value: option.value, text: option.textContent })),
    [
      { value: "", text: "เลือกแผนก/ตำแหน่ง" },
      { value: "Owner", text: "Owner" },
      { value: "Marketing", text: "Marketing" },
    ],
  );
});

test("company-position loader keeps a selected legacy label as a snapshot option", async () => {
  const select = await loadLoader({
    positions: [{ id: "p-1", label: "Owner", status: "active", sort_order: 1 }],
    selectedValue: "ผู้จัดการเดิม",
  });

  const legacy = select.querySelectorAll("option").find((option) => option.value === "ผู้จัดการเดิม");
  assert.ok(legacy);
  assert.equal(legacy.textContent, "ผู้จัดการเดิม");
  assert.equal(select.value, "ผู้จัดการเดิม");
});

test("requester-role controls use the shared position loader and no longer embed static options", async () => {
  const expense = await readFile(new URL("../forms/expense-request.html", import.meta.url), "utf8");
  const substitute = await readFile(new URL("../forms/substitute-receipt.html", import.meta.url), "utf8");

  assert.match(expense, /company-position\.browser\.js/);
  assert.match(expense, /companyPositionLoader\.loadInto/);
  assert.doesNotMatch(expense, /<option value="เจ้าของบริษัท">เจ้าของบริษัท<\/option>/);
  assert.doesNotMatch(expense, /<option value="marketing">marketing<\/option>/);
  assert.match(substitute, /company-position\.browser\.js/);
  assert.match(substitute, /name="requesterRole"[^>]*data-searchable/);
  assert.doesNotMatch(substitute, /<input id="requesterRole"/);
});
