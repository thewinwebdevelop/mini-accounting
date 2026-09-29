import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { buildFakeDomFromHtml } from "./support/fake-dom.mjs";

const loaderPath = new URL("../forms/company-position.browser.js", import.meta.url);
const formPaths = [
  new URL("../forms/expense-request.html", import.meta.url),
  new URL("../forms/substitute-receipt.html", import.meta.url),
];

async function loadLoader({ positions, selectedValue = "", fetchError = false }) {
  const { elementsById, document } = buildFakeDomFromHtml(
    `<select id="requesterRole" name="requesterRole" data-searchable><option value="" selected disabled>เลือกตำแหน่ง</option></select>`,
  );
  const fetch = async () => {
    if (fetchError) throw new Error("network unavailable");
    return { ok: true, json: async () => ({ positions }) };
  };
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

test("company-position loader falls back to editable text when the master request is rejected", async () => {
  const select = await loadLoader({ fetchError: true, selectedValue: "ตำแหน่งเดิม" });
  const fallback = select.parentNode.querySelector('input[name="requesterRole"]');

  assert.ok(fallback);
  assert.equal(fallback.value, "ตำแหน่งเดิม");
  assert.equal(fallback.placeholder, "เช่น ผู้จัดการ");
  assert.equal(select.name, "");
});

test("company-position loader falls back to editable text when the master has no positions", async () => {
  const select = await loadLoader({ positions: [] });
  const fallback = select.parentNode.querySelector('input[name="requesterRole"]');

  assert.ok(fallback);
  assert.equal(fallback.value, "");
  assert.equal(select.name, "");
});

test("both requester-role form integrations stay editable when the master request is rejected", async () => {
  for (const formPath of formPaths) {
    const html = await readFile(formPath, "utf8");
    const { elementsById, document } = buildFakeDomFromHtml(html);
    const select = elementsById.requesterRole;
    const window = { document };
    const fetch = async () => { throw new Error("network unavailable"); };
    const context = vm.createContext({ window, document, fetch });
    vm.runInContext(await readFile(loaderPath, "utf8"), context);

    await context.window.SweetHouseCompanyPositions.loadInto(select);
    const fallback = document.querySelector('input[name="requesterRole"]');
    assert.ok(fallback, `${formPath.pathname} must retain a manual requester-role field`);
    assert.equal(fallback.id, "requesterRole");
  }
});

test("both requester-role form integrations stay editable when the master is empty", async () => {
  for (const formPath of formPaths) {
    const html = await readFile(formPath, "utf8");
    const { elementsById, document } = buildFakeDomFromHtml(html);
    const select = elementsById.requesterRole;
    const window = { document };
    const fetch = async () => ({ ok: true, json: async () => ({ positions: [] }) });
    const context = vm.createContext({ window, document, fetch });
    vm.runInContext(await readFile(loaderPath, "utf8"), context);

    await context.window.SweetHouseCompanyPositions.loadInto(select);
    assert.ok(document.querySelector('input[name="requesterRole"]'), `${formPath.pathname} must retain a manual requester-role field`);
  }
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
