import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const helperPath = new URL("../forms/vendor-picker.logic.browser.js", import.meta.url);
const pages = ["expense-request.html", "substitute-receipt.html", "workflow-document.html"];

test("document forms expose the shared active vendor picker and save option", async () => {
  for (const page of pages) {
    const html = await readFile(new URL(`../forms/${page}`, import.meta.url), "utf8");
    assert.match(html, /id="vendorPresetSelect"/);
    assert.match(html, /id="saveVendorPreset"/);
    assert.match(html, /vendor-picker\.logic\.browser\.js/);
    assert.match(html, /aria-describedby="vendorPresetHint"/);
  }
});

test("shared picker loads active vendors and copies only mapped fields", async () => {
  const source = await readFile(helperPath, "utf8");
  const options = { children: [], replaceChildren(...nodes) { this.children = nodes; }, appendChild(node) { this.children.push(node); } };
  const form = { elements: { name: { value: "" }, tax: { value: "" } }, dataset: {}, querySelector() { return null; } };
  const context = vm.createContext({ window: { Option: class { constructor(text, value) { this.textContent = text; this.value = value; } } }, fetch: async () => ({ ok: true, json: async () => ({ vendors: [{ id: "V1", name: "ร้านหนึ่ง", taxId: "", status: "active" }, { id: "V2", name: "ปิด", status: "inactive" }] }) }) });
  vm.runInContext(source, context);
  const picker = context.window.SharedVendorPicker;
  const vendors = await picker.loadVendorOptions(options, { fetchImpl: context.fetch });
  assert.equal(vendors.length, 1);
  picker.applyVendorToForm(form, vendors[0], { name: ["name"], taxId: ["tax"] });
  assert.equal(form.elements.name.value, "ร้านหนึ่ง");
  assert.equal(form.elements.tax.value, "");
  assert.equal(form.dataset.vendorId, "V1");
  picker.clearVendorSelection(options, form);
  assert.equal(form.dataset.vendorId, undefined);
});

test("picker preserves document entry when vendor API fails and duplicate save is confirmed", async () => {
  const source = await readFile(helperPath, "utf8");
  const form = { elements: { name: { value: "ร้านใหม่" } }, dataset: {}, querySelector() { return null; } };
  const checkbox = { checked: true };
  let calls = 0;
  const fetchImpl = async (_url, request) => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 409, json: async () => ({ error: "duplicate", matches: [{ id: "V1" }], candidateFingerprint: "fp" }) };
    return { ok: true, status: 201, json: async () => ({ vendor: { id: "V2", name: "ร้านใหม่", status: "active" } }) };
  };
  const context = vm.createContext({ window: { confirm: () => true }, fetch: fetchImpl });
  vm.runInContext(source, context);
  const picker = context.window.SharedVendorPicker;
  const result = await picker.saveVendorPresetIfRequested({ form, checkbox, mapping: { name: ["name"] }, fetchImpl, confirmImpl: () => true });
  assert.equal(result.id, "V2");
  assert.equal(form.elements.name.value, "ร้านใหม่");
  assert.equal(calls, 2);
});
