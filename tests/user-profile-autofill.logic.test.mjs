import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../forms/user-profile-autofill.browser.js", import.meta.url), "utf8");

function loadHelper() {
  const window = {};
  const context = vm.createContext({ window, fetch: globalThis.fetch });
  vm.runInContext(source, context);
  return window.SweetHouseUserProfileAutofill;
}

function field(value = "") {
  return { value };
}

function selectField(labels = []) {
  const select = field("");
  select.tagName = "SELECT";
  select.options = labels.map((label) => ({ value: label, textContent: label }));
  select.append = (option) => select.options.push(option);
  return select;
}

test("joins first and last name for a new document", () => {
  const helper = loadHelper();
  const form = { requesterName: field(), requesterRole: selectField(["เจ้าของบริษัท"]) };

  const result = helper.autofillNewDocument({
    form,
    isNewDocument: true,
    nameField: form.requesterName,
    positionField: form.requesterRole,
    profile: { firstName: " ชื่อ ", lastName: " นามสกุล ", companyPositionLabel: "เจ้าของบริษัท" },
  });

  assert.equal(result.status, "filled");
  assert.equal(form.requesterName.value, "ชื่อ นามสกุล");
  assert.equal(form.requesterRole.value, "เจ้าของบริษัท");
});

test("does not add or autofill an inactive profile position in a new document", () => {
  const helper = loadHelper();
  const form = { requesterName: field(), requesterRole: selectField(["ผู้จัดการ"]) };

  helper.autofillNewDocument({
    form,
    isNewDocument: true,
    nameField: form.requesterName,
    positionField: form.requesterRole,
    profile: { firstName: "ชื่อ", lastName: "นามสกุล", companyPositionLabel: "ตำแหน่งปิดใช้งาน" },
  });

  assert.equal(form.requesterName.value, "ชื่อ นามสกุล");
  assert.equal(form.requesterRole.value, "");
  assert.deepEqual(form.requesterRole.options.map((option) => option.value), ["ผู้จัดการ"]);
});

test("does not overwrite typed requester fields", () => {
  const helper = loadHelper();
  const form = { requesterName: field("พิมพ์เอง"), requesterRole: field("ตำแหน่งเดิม") };

  helper.autofillNewDocument({
    form,
    isNewDocument: true,
    nameField: form.requesterName,
    positionField: form.requesterRole,
    profile: { firstName: "ใหม่", lastName: "ชื่อ", companyPositionLabel: "ใหม่" },
  });

  assert.equal(form.requesterName.value, "พิมพ์เอง");
  assert.equal(form.requesterRole.value, "ตำแหน่งเดิม");
});

test("does not autofill an existing document", () => {
  const helper = loadHelper();
  const form = { requesterName: field(""), requesterRole: field("") };

  const result = helper.autofillNewDocument({
    form,
    isNewDocument: false,
    nameField: form.requesterName,
    positionField: form.requesterRole,
    profile: { firstName: "ชื่อ", lastName: "นามสกุล", companyPositionLabel: "เจ้าของบริษัท" },
  });

  assert.equal(result.status, "skipped");
  assert.equal(form.requesterName.value, "");
  assert.equal(form.requesterRole.value, "");
});

test("handles unavailable/partial profile values without undefined text", async () => {
  const helper = loadHelper();
  assert.equal(helper.formatProfileName({ firstName: "ชื่อ" }), "ชื่อ");
  assert.equal(helper.formatProfileName({ lastName: "นามสกุล" }), "นามสกุล");
  assert.equal(helper.formatProfileName({}), "");

  const form = { requesterName: field(), requesterRole: field() };
  const result = helper.autofillNewDocument({
    form,
    isNewDocument: true,
    nameField: form.requesterName,
    positionField: form.requesterRole,
    profile: null,
  });

  assert.equal(result.status, "skipped");
  assert.equal(form.requesterName.value, "");
  assert.equal(form.requesterRole.value, "");
  assert.doesNotMatch(form.requesterName.value, /undefined/);
  assert.doesNotMatch(form.requesterRole.value, /undefined/);

  const unavailable = await helper.loadProfile(async () => { throw new Error("offline"); });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.profile, undefined);
});
