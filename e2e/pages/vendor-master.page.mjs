import { expect } from "@playwright/test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { vendorCandidateFingerprint } = require("../../forms/vendor.logic.js");

async function json(response) { const body = await response.json().catch(() => ({})); if (!response.ok()) throw new Error(`${response.status()} ${body.error || response.url()}`); return body; }
export class VendorMasterPage {
  constructor(page) { this.page = page; }
  async open() { await this.page.goto("/substitute-receipt-vendors"); await expect(this.page.locator("#vendorForm")).toBeVisible(); }
  async create({ name, taxId }) { await this.page.locator("#vendorName").fill(name); await this.page.locator("#vendorTaxId").fill(taxId); await this.page.locator("#vendorForm").evaluate((form) => form.requestSubmit()); await expect(this.page.locator("#vendorStatusBox")).toContainText("บันทึก"); const list = await json(await this.page.request.get("/api/vendors?includeInactive=1")); return list.vendors.find((vendor) => vendor.name === name); }
  async expectVisible(name) { await expect(this.page.locator("#vendorRows")).toContainText(name); }
  async expectDuplicateConfirmation({ name, taxId }) {
    let confirmationMessage = "";
    this.page.once("dialog", async (dialog) => {
      confirmationMessage = dialog.message();
      expect(dialog.type()).toBe("confirm");
      expect(confirmationMessage).toContain("พบผู้ขายที่อาจซ้ำ");
      expect(confirmationMessage).toContain(taxId);
      await dialog.accept();
    });
    await this.page.locator("#vendorName").fill(name);
    await this.page.locator("#vendorTaxId").fill(taxId);
    await this.page.locator("#vendorForm").evaluate((form) => form.requestSubmit());
    await expect(this.page.locator("#vendorStatusBox")).toContainText("บันทึก");
    const list = await json(await this.page.request.get("/api/vendors?includeInactive=1"));
    return { confirmationMessage, vendor: list.vendors.find((vendor) => vendor.name === name) };
  }
  async status(id, status) {
    const current = await json(await this.page.request.get(`/api/vendors/${encodeURIComponent(id)}`));
    const matches = (await json(await this.page.request.get("/api/vendors?includeInactive=1"))).vendors.filter((vendor) => vendor.id !== id && (vendor.name === current.vendor.name || vendor.taxId === current.vendor.taxId));
    return json(await this.page.request.patch(`/api/vendors/${encodeURIComponent(id)}`, { data: { status, confirmDuplicate: true, expectedMatchIds: matches.map((vendor) => vendor.id), expectedCandidateFingerprint: vendorCandidateFingerprint(current.vendor) } }));
  }
  async deactivate(id) { return this.status(id, "inactive"); }
  async reactivate(id) { return this.status(id, "active"); }
  async reload() { await this.page.reload(); await expect(this.page.locator("#vendorForm")).toBeVisible(); }
  async expectStatus(id, status) { const result = await json(await this.page.request.get(`/api/vendors/${encodeURIComponent(id)}`)); expect(result.vendor.status).toBe(status); }
  async createExpenseSnapshot({ vendorId, name }) { const response = await this.page.request.post("/api/expense-requests", { multipart: { payload: JSON.stringify({ accountingMonth: "2026-10", requestTitle: name, requesterName: "Employee A", businessPurpose: "snapshot", paymentTargetName: name, vendorId, expenseLines: [{ description: "snapshot", amountBeforeVat: "10", vatAmount: "0", withholdingTax: "0" }] }) } }); return json(response); }
  async get(requestNo) { return json(await this.page.request.get(`/api/expense-requests/${encodeURIComponent(requestNo)}`)); }
}
