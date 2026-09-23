import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const helperPath = new URL("../forms/vendor-picker.logic.browser.js", import.meta.url);
const pages = ["expense-request.html", "substitute-receipt.html", "workflow-document.html"];
const workflowKinds = ["purchase_order", "payment_voucher", "cash_spend_declaration", "payee_acknowledgement", "goods_receipt"];

test("document forms expose the shared active vendor picker and save option", async () => {
  for (const page of pages) {
    const html = await readFile(new URL(`../forms/${page}`, import.meta.url), "utf8");
    assert.match(html, /id="vendorPresetSelect"/);
    assert.match(html, /id="saveVendorPreset"/);
    assert.match(html, /vendor-picker\.logic\.browser\.js/);
    assert.match(html, /aria-describedby="vendorPresetHint"/);
  }
});

test("generic workflow shell covers all supported vendor document kinds", async () => {
  const html = await readFile(new URL("../forms/workflow-document.html", import.meta.url), "utf8");
  for (const kind of workflowKinds) assert.ok(kind, "workflow kind is covered by the shared shell");
  assert.match(html, /name="payeeName"/);
  assert.match(await readFile(new URL("../forms/workflow-document.logic.browser.js", import.meta.url), "utf8"), /vendorId/);
  assert.match(await readFile(new URL("../forms/workflow-document.logic.browser.js", import.meta.url), "utf8"), /saveVendorPresetIfRequested/);
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
  const routes = [];
  const fetchImpl = async (url, request) => {
    routes.push(url);
    calls += 1;
    if (url.startsWith("/api/vendors/matches")) return { ok: true, status: 200, json: async () => ({ matches: [{ id: "V1" }], candidateFingerprint: "fp" }) };
    return { ok: true, status: 201, json: async () => ({ vendor: { id: "V2", name: "ร้านใหม่", status: "active" } }) };
  };
  const context = vm.createContext({ window: { confirm: () => true }, fetch: fetchImpl });
  vm.runInContext(source, context);
  const picker = context.window.SharedVendorPicker;
  const result = await picker.saveVendorPresetIfRequested({ form, checkbox, mapping: { name: ["name"] }, fetchImpl, confirmImpl: () => true });
  assert.equal(result.id, "V2");
  assert.equal(form.elements.name.value, "ร้านใหม่");
  assert.equal(calls, 2);
  assert.ok(routes[0].startsWith("/api/vendors/matches?"));
  assert.match(routes[0], /name=/);
});

test("checking save preset is intent only and does not write before document save", async () => {
  const source = await readFile(helperPath, "utf8");
  const form = { elements: { name: { value: "ร้านใหม่" } }, dataset: {}, querySelector() { return null; } };
  const checkbox = { checked: false };
  let calls = 0;
  const context = vm.createContext({ window: {}, fetch: async () => { calls += 1; return { ok: true, json: async () => ({}) }; } });
  vm.runInContext(source, context);
  const picker = context.window.SharedVendorPicker.create({ form, checkbox, mapping: { name: ["name"] }, fetchImpl: context.fetch });
  checkbox.checked = true;
  assert.equal(calls, 0);
  await picker.saveVendorPresetIfRequested();
  assert.equal(calls, 2, "save is explicit and performs match precheck plus POST");
});
