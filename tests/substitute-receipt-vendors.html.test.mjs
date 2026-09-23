import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

import { buildFakeDomFromHtml } from "./support/fake-dom.mjs";

const htmlPath = new URL("../forms/substitute-receipt-vendors.html", import.meta.url);
const browserLogicPath = new URL("../forms/substitute-receipt-vendors.logic.browser.js", import.meta.url);

function installRuntimeShims(elementsById) {
  const form = elementsById.vendorForm;
  form.reset = () => {
    for (const element of Object.values(form.elements)) {
      if (element.tagName === "SELECT") {
        element.value = element.children.find((child) => child.selected)?.value || element.children[0]?.value || "";
      } else {
        element.value = element.getAttribute("value") || "";
      }
    }
  };
  form.scrollIntoView = () => {};
}

class FakeFormData {
  constructor(form) {
    this.entriesList = Object.entries(form.elements)
      .filter(([, element]) => element.name)
      .map(([name, element]) => [name, element.value]);
  }

  entries() {
    return this.entriesList[Symbol.iterator]();
  }
}

async function setupVendorSettingsSandbox({ fetchImpl, confirmImpl = () => false } = {}) {
  const html = await readFile(htmlPath, "utf8");
  const { elementsById, document } = buildFakeDomFromHtml(html);
  installRuntimeShims(elementsById);

  const window = {
    addEventListener(type, handler) {
      (this._handlers ??= {})[type] = handler;
    },
    confirm: confirmImpl,
  };
  const context = vm.createContext({
    window,
    document,
    fetch: fetchImpl,
    FormData: FakeFormData,
    setTimeout,
  });

  vm.runInContext(await readFile(browserLogicPath, "utf8"), context);
  await context.window._handlers.DOMContentLoaded();
  await new Promise((resolve) => setTimeout(resolve, 10));
  return { elements: elementsById };
}

test("substitute receipt vendor settings page manages the shared vendor master", async () => {
  const html = await readFile(htmlPath, "utf8");

  assert.match(html, /<title>ตั้งค่าผู้ขายกลาง - หจก\.สวีทเฮาส์<\/title>/);
  assert.match(html, /id="vendorForm"/);
  assert.match(html, /id="vendorName"/);
  assert.match(html, /id="vendorTaxId"/);
  assert.match(html, /id="vendorAddress"/);
  assert.match(html, /id="vendorContactName"/);
  assert.match(html, /id="vendorPhone"/);
  assert.match(html, /id="vendorEmail"/);
  assert.match(html, /id="vendorBankName"/);
  assert.match(html, /id="vendorAccountNo"/);
  assert.match(html, /id="vendorPaymentChannel"/);
  assert.match(html, /id="vendorPaymentReference"/);
  assert.match(html, /id="vendorDefaultBusinessPurpose"/);
  assert.match(html, /id="vendorStatusBox"[^>]*role="status"/);
  assert.match(html, /id="vendorStatusBox"[^>]*aria-live="polite"/);
  assert.match(html, /id="vendorRows"/);
  assert.match(html, /src="\.\/substitute-receipt-vendors\.logic\.browser\.js"/);
});

test("substitute receipt vendor settings browser controller calls vendor preset API", async () => {
  const browserLogic = await readFile(browserLogicPath, "utf8");

  assert.match(browserLogic, /\/api\/vendors\?includeInactive=1/);
  assert.match(browserLogic, /\/api\/vendors\/.*encodeURIComponent/);
  assert.match(browserLogic, /method = id \? "PATCH" : "POST"/);
});

test("shared vendor settings submits full vendor fields to the shared API", async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === "/api/vendors?includeInactive=1") {
      return { ok: true, json: async () => ({ vendors: [] }) };
    }
    return { ok: true, json: async () => ({ vendor: { id: "VENDOR-1", name: "ร้านใหม่", status: "active" } }) };
  };
  const { elements } = await setupVendorSettingsSandbox({ fetchImpl });

  elements.vendorForm.elements.name.value = "ร้านใหม่";
  elements.vendorForm.elements.taxId.value = "";
  elements.vendorForm.elements.address.value = "99/9";
  elements.vendorForm.elements.contactName.value = "คุณเอ";
  elements.vendorForm.elements.phone.value = "0810000000";
  elements.vendorForm.elements.email.value = "vendor@example.test";
  elements.vendorForm.elements.bankName.value = "KBANK";
  elements.vendorForm.elements.accountNo.value = "1234567890";
  elements.vendorForm.elements.paymentChannel.value = "โอน";
  elements.vendorForm.elements.paymentReference.value = "เลขบัญชี";
  elements.vendorForm.elements.defaultBusinessPurpose.value = "ซื้อสินค้า";
  elements.vendorForm.elements.note.value = "หมายเหตุ";
  await elements.vendorForm.listeners.submit[0]({ preventDefault() {} });

  const createRequest = requests.find((request) => request.url === "/api/vendors");
  assert.equal(createRequest.options.method, "POST");
  assert.deepEqual(JSON.parse(createRequest.options.body), {
    name: "ร้านใหม่",
    taxId: "",
    address: "99/9",
    contactName: "คุณเอ",
    phone: "0810000000",
    email: "vendor@example.test",
    bankName: "KBANK",
    accountNo: "1234567890",
    paymentChannel: "โอน",
    paymentReference: "เลขบัญชี",
    defaultBusinessPurpose: "ซื้อสินค้า",
    note: "หมายเหตุ",
    status: "active",
  });
});

test("shared vendor settings asks before saving a duplicate vendor", async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === "/api/vendors?includeInactive=1") {
      return { ok: true, json: async () => ({ vendors: [] }) };
    }
    if (requests.filter((request) => request.url === "/api/vendors").length === 1) {
      return {
        ok: false,
        status: 409,
        json: async () => ({
          code: "VENDOR_DUPLICATE_CONFIRMATION_REQUIRED",
          error: "พบผู้ขายที่อาจซ้ำ",
          candidateFingerprint: "fingerprint-1",
          matches: [{ id: "VENDOR-OLD", name: "ร้านเดิม", taxId: "" }],
        }),
      };
    }
    return { ok: true, json: async () => ({ vendor: { id: "VENDOR-NEW", name: "ร้านเดิม", status: "active" } }) };
  };
  let confirmations = 0;
  const { elements } = await setupVendorSettingsSandbox({
    fetchImpl,
    confirmImpl: (message) => {
      confirmations += 1;
      assert.match(message, /ร้านเดิม/);
      return true;
    },
  });

  elements.vendorForm.elements.name.value = "ร้านเดิม";
  await elements.vendorForm.listeners.submit[0]({ preventDefault() {} });

  const writes = requests.filter((request) => request.url === "/api/vendors");
  assert.equal(confirmations, 1);
  assert.equal(writes.length, 2);
  assert.deepEqual(JSON.parse(writes[1].options.body), {
    name: "ร้านเดิม",
    taxId: "",
    address: "",
    contactName: "",
    phone: "",
    email: "",
    bankName: "",
    accountNo: "",
    paymentChannel: "โอนผ่านบัญชีบริษัท",
    paymentReference: "",
    defaultBusinessPurpose: "",
    note: "",
    status: "active",
    confirmDuplicate: true,
    expectedMatchIds: ["VENDOR-OLD"],
    expectedCandidateFingerprint: "fingerprint-1",
  });
});

test("shared vendor settings deactivates an active vendor from the list", async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === "/api/vendors?includeInactive=1") {
      return {
        ok: true,
        json: async () => ({
          vendors: [{ id: "VENDOR-1", name: "ร้านพร้อมปิดใช้", taxId: "", status: "active" }],
        }),
      };
    }
    return { ok: true, json: async () => ({ vendor: { id: "VENDOR-1", name: "ร้านพร้อมปิดใช้", status: "inactive" } }) };
  };
  let confirmations = 0;
  const { elements } = await setupVendorSettingsSandbox({
    fetchImpl,
    confirmImpl: () => {
      confirmations += 1;
      return true;
    },
  });

  assert.match(elements.vendorRows.innerHTML, /data-deactivate-vendor="VENDOR-1"/);
  await elements.vendorRows.listeners.click[0]({
    target: {
      closest(selector) {
        if (selector === "[data-deactivate-vendor]") return { dataset: { deactivateVendor: "VENDOR-1" } };
        return null;
      },
    },
  });

  const deactivateRequest = requests.find((request) => request.url === "/api/vendors/VENDOR-1");
  assert.equal(confirmations, 1);
  assert.equal(deactivateRequest.options.method, "PATCH");
  assert.deepEqual(JSON.parse(deactivateRequest.options.body), { status: "inactive" });
});

test("shared vendor settings edits and reactivates a full inactive vendor record", async () => {
  const requests = [];
  const vendor = {
    id: "VENDOR-2",
    name: "ร้านรอเปิดใช้",
    taxId: "",
    address: "12/34",
    contactName: "คุณบี",
    phone: "0820000000",
    email: "inactive@example.test",
    bankName: "SCB",
    accountNo: "2223334445",
    paymentChannel: "โอนผ่านบัญชีบริษัท",
    paymentReference: "SCB 222",
    defaultBusinessPurpose: "ซื้อวัสดุ",
    note: "หยุดใช้ชั่วคราว",
    status: "inactive",
  };
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === "/api/vendors?includeInactive=1") {
      return { ok: true, json: async () => ({ vendors: [vendor] }) };
    }
    return { ok: true, json: async () => ({ vendor: { ...vendor, status: "active" } }) };
  };
  const { elements } = await setupVendorSettingsSandbox({ fetchImpl });

  await elements.vendorRows.listeners.click[0]({
    target: {
      closest(selector) {
        if (selector === "[data-edit-vendor]") return { dataset: { editVendor: "VENDOR-2" } };
        return null;
      },
    },
  });

  assert.equal(elements.vendorForm.elements.id.value, "VENDOR-2");
  assert.equal(elements.vendorForm.elements.name.value, vendor.name);
  assert.equal(elements.vendorForm.elements.taxId.value, "");
  assert.equal(elements.vendorForm.elements.address.value, vendor.address);
  assert.equal(elements.vendorForm.elements.contactName.value, vendor.contactName);
  assert.equal(elements.vendorForm.elements.phone.value, vendor.phone);
  assert.equal(elements.vendorForm.elements.email.value, vendor.email);
  assert.equal(elements.vendorForm.elements.bankName.value, vendor.bankName);
  assert.equal(elements.vendorForm.elements.accountNo.value, vendor.accountNo);
  assert.equal(elements.vendorForm.elements.paymentChannel.value, vendor.paymentChannel);
  assert.equal(elements.vendorForm.elements.paymentReference.value, vendor.paymentReference);
  assert.equal(elements.vendorForm.elements.defaultBusinessPurpose.value, vendor.defaultBusinessPurpose);
  assert.equal(elements.vendorForm.elements.note.value, vendor.note);
  assert.equal(elements.vendorForm.elements.status.value, "inactive");

  elements.vendorForm.elements.status.value = "active";
  await elements.vendorForm.listeners.submit[0]({ preventDefault() {} });

  const updateRequest = requests.find((request) => request.url === "/api/vendors/VENDOR-2");
  assert.equal(updateRequest.options.method, "PATCH");
  assert.deepEqual(JSON.parse(updateRequest.options.body), {
    name: vendor.name,
    taxId: "",
    address: vendor.address,
    contactName: vendor.contactName,
    phone: vendor.phone,
    email: vendor.email,
    bankName: vendor.bankName,
    accountNo: vendor.accountNo,
    paymentChannel: vendor.paymentChannel,
    paymentReference: vendor.paymentReference,
    defaultBusinessPurpose: vendor.defaultBusinessPurpose,
    note: vendor.note,
    status: "active",
  });
});
