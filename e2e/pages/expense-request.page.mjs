import { expect } from "@playwright/test";
import { createTestSession, sessionCookie } from "../fixtures/auth.fixture.mjs";

const SECRET = "e2e-test-session-secret-012345678901234567890123";

async function json(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok()) throw new Error(`${response.status()} ${body.error || response.url()}`);
  return body;
}

export class ExpenseRequestPage {
  constructor(page, requestNo = null) { this.page = page; this.requestNo = requestNo; }

  static async accountingPage(browser, localApp) {
    const context = await browser.newContext({ baseURL: localApp.baseUrl });
    await context.addCookies([{ ...sessionCookie(createTestSession({ ...localApp.users.accounting, secret: SECRET })), url: localApp.baseUrl }]);
    return context.newPage();
  }

  async open() {
    await this.page.goto(this.requestNo ? `/expense-request?requestNo=${encodeURIComponent(this.requestNo)}` : "/expense-request");
    await expect(this.page.locator("#expenseForm")).toBeVisible();
    return this;
  }

  async fill({ title, purpose, vendor, beforeVat, vat = "0", withholding = "0", stockSku = false }) {
    await this.page.locator("#accountingMonth").fill("2026-10");
    await this.page.locator("#requestTitle").fill(title);
    await this.page.locator("#requesterName").fill("Employee A");
    await this.page.locator("#businessPurpose").fill(purpose);
    await this.page.locator("#paymentTargetName").fill(vendor);
    const line = this.page.locator("#lineItems .line-row").first();
    await line.locator('[name="lineDescription"]').fill("Fixture expense line");
    await line.locator('[name="lineBeforeVat"]').fill(beforeVat);
    await line.locator('[name="lineVat"]').fill(vat);
    await line.locator('[name="lineWht"]').fill(withholding);
    if (stockSku) {
      await this.page.locator("#addLine").click();
      const stockLine = this.page.locator("#lineItems .line-row").nth(1);
      await stockLine.locator('[name="isStockItem"]').check();
      const stockSkus = await this.ensureStockSku();
      await stockLine.locator('[name="stockSkuId"]').evaluate((select, sku) => {
        if (!select.querySelector(`option[value="${sku.id}"]`)) select.add(new Option(`${sku.sku} - ${sku.name || "Fixture SKU"}`, String(sku.id)));
        select.value = String(sku.id);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }, stockSkus[0]);
      await stockLine.locator('[name="lineDescription"]').fill("Fixture Stock SKU line");
      await stockLine.locator('[name="lineBeforeVat"]').fill("200");
      await stockLine.locator('[name="lineVat"]').fill("0");
      await stockLine.locator('[name="lineWht"]').fill("0");
    }
  }

  async ensureStockSku() {
    let stockSkus = (await json(await this.page.request.get("/api/inventory/stock-skus"))).stockSkus || [];
    if (stockSkus.length) return stockSkus;
    let categories = (await json(await this.page.request.get("/api/inventory/categories"))).categories || [];
    if (!categories.length) await json(await this.page.request.post("/api/inventory/categories", { data: { name: "E2E fixture category", status: "active" } }));
    categories = (await json(await this.page.request.get("/api/inventory/categories"))).categories || [];
    const product = await json(await this.page.request.post("/api/inventory/products", { data: { productCode: `E2E-${Date.now()}`, name: "E2E fixture product", category: categories[0].name, status: "active" } }));
    const created = await json(await this.page.request.post("/api/inventory/stock-skus", { data: { productId: product.product.id, sku: `E2E-SKU-${Date.now()}`, defaultUnitCost: "200", status: "active" } }));
    return [created.stockSku];
  }

  async addEvidence(kind, name, buffer) {
    await this.page.locator(`[data-evidence-card="${kind}"] input[type=file]`).setInputFiles({ name, mimeType: "application/pdf", buffer: Buffer.from(buffer) });
  }

  async saveDraft() {
    await this.page.locator("#saveDraft").click();
    await expect(this.page.locator("#saveStatus")).toContainText("บันทึก");
    this.requestNo = await this.page.locator("#docNo").textContent();
    return this.detail();
  }

  async submit() {
    await this.page.locator("#submitRequest").click();
    await expect(this.page.locator("#workflowReviewDialog")).toBeVisible();
    await this.page.locator("#workflowReviewConfirm").click();
    await expect(this.page.locator("#saveStatus")).toContainText("ส่ง");
    return this.detail();
  }

  async assertLineItemCollapse() {
    const row = this.page.locator("#lineItems .line-row").first();
    await expect(row).toHaveAttribute("open", "");
    await row.locator("summary.line-summary").click();
    await expect(row).not.toHaveAttribute("open", "");
  }

  async reload() { await this.open(); return this; }
  async detail() {
    const body = await json(await this.page.request.get(`/api/expense-requests/${encodeURIComponent(this.requestNo)}`));
    return { ...body, ownerUserId: body.ownerUserId || body.payload?.ownerUserId || "", expenseLines: body.expenseLines || body.payload?.expenseLines || [], pdfFiles: body.pdfFiles || body.payload?.pdfFiles || [], rawFiles: body.rawFiles || body.payload?.rawFiles || [], auditPacketFiles: body.auditPacketFiles || body.payload?.auditPacketFiles || [] };
  }
  async get(no) { return json(await this.page.request.get(`/api/expense-requests/${encodeURIComponent(no)}`)); }

  async reviewAction(action, reason = "") { await json(await this.page.request.post(`/api/expense-requests/${encodeURIComponent(this.requestNo)}/${action}`, { data: reason ? { reason } : {} })); return this.detail(); }
  async approve() { return this.reviewAction("approve"); }
  async reject(reason) { return this.reviewAction("reject", reason); }
  async complete() { return this.reviewAction("complete"); }

  async fileAssertions() {
    const detail = await this.detail();
    const pdfUrl = detail.pdfFiles?.[0]?.url || detail.pdfFiles?.[0]?.path;
    const rawUrl = detail.rawFiles?.[0]?.url || detail.rawFiles?.[0]?.path;
    const auditUrl = detail.auditPacket?.url || detail.auditPacketUrl || detail.auditPacketFiles?.[0]?.url || detail.pdfFiles?.[1]?.url;
    const [pdf, raw, audit] = await Promise.all([pdfUrl, rawUrl, auditUrl].map((url) => this.page.request.get(url)));
    return { pdfBody: await pdf.text(), rawUrl, auditBody: await audit.text() };
  }

  async assertMobileActions() {
    await expect(this.page.locator("#saveDraft, #submitRequest").first()).toBeVisible();
    await expect(this.page.locator('[data-evidence-card] input[type=file]').first()).toBeVisible();
  }
}
