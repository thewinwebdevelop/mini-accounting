import { expect } from "@playwright/test";
import { createTestSession, sessionCookie } from "../fixtures/auth.fixture.mjs";
const SECRET = "e2e-test-session-secret-012345678901234567890123";
async function json(response) { const body = await response.json().catch(() => ({})); if (!response.ok()) throw new Error(`${response.status()} ${body.error || response.url()}`); return body; }

export class SubstituteReceiptPage {
  constructor(page, receiptNo = null) { this.page = page; this.receiptNo = receiptNo; }
  static async accountingPage(browser, localApp) { const context = await browser.newContext({ baseURL: localApp.baseUrl }); await context.addCookies([{ ...sessionCookie(createTestSession({ ...localApp.users.accounting, secret: SECRET })), url: localApp.baseUrl }]); return context.newPage(); }
  async open() { await this.page.goto(this.receiptNo ? `/substitute-receipt?receiptNo=${encodeURIComponent(this.receiptNo)}` : "/substitute-receipt"); await expect(this.page.locator("#substituteReceiptForm")).toBeVisible(); return this; }
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
  async fill({ receiptType, title, vendor, quantity, unitCost }) {
    await this.page.locator("#accountingMonth").fill("2026-10"); await this.page.locator("#receiptDate").fill("2026-10-09"); await this.page.locator("#receiptType").selectOption(receiptType); await this.page.locator("#receiptTitle").fill(title); await this.page.locator("#payeeName").fill(vendor);
    const line = this.page.locator("#stockLineItems .stock-line").first(); await line.locator('[name="description"]').fill("Fixture receipt line"); await line.locator('[name="quantity"]').fill(quantity); await line.locator('[name="unitCost"]').fill(unitCost);
    if (receiptType === "stock_purchase") {
      const stockSkus = await this.ensureStockSku();
      await line.locator('[name="stockSkuId"]').selectOption(String(stockSkus[0].id));
    }
  }
  async addEvidence(kind, name, buffer) { await this.page.locator(`input[name="evidence_${kind}"]`).setInputFiles({ name, mimeType: "application/pdf", buffer: Buffer.from(buffer) }); }
  async saveDraft() { await this.page.locator("#saveDraft").click(); await expect(this.page.locator("#substituteReceiptStatus")).toContainText("บันทึก"); this.receiptNo = await this.page.locator("#receiptNoPreview").textContent(); return this.detail(); }
  async submit() {
    const responsePromise = this.page.waitForResponse((response) => response.url().endsWith("/api/substitute-receipts") && response.request().method() === "POST");
    await this.page.locator("#submitForApproval").click();
    if (await this.page.locator("#workflowReviewDialog").isVisible()) await this.page.locator("#workflowReviewConfirm").click();
    await json(await responsePromise);
    return this.detail();
  }
  async reload() { await this.open(); return this; }
  async detail() { const body = await json(await this.page.request.get(`/api/substitute-receipts/${encodeURIComponent(this.receiptNo)}`)); return { ...body, ownerUserId: body.ownerUserId || body.payload?.ownerUserId || "", receiptType: body.receiptType || body.payload?.receiptType || "", pdfFiles: body.pdfFiles || body.payload?.pdfFiles || [], rawFiles: body.rawFiles || body.payload?.rawFiles || [] }; }
  async selectedStockSkuId() { return this.page.locator('#stockLineItems .stock-line').first().locator('[name="stockSkuId"]').inputValue(); }
  async reviewAction(action, reason = "") { await json(await this.page.request.post(`/api/substitute-receipts/${encodeURIComponent(this.receiptNo)}/${action}`, { data: reason ? { reason } : {} })); return this.detail(); }
  async approve() { return this.reviewAction("approve"); }
  async complete() { return this.reviewAction("complete"); }
  async receiveStock() { const response = await this.page.request.post(`/api/substitute-receipts/${encodeURIComponent(this.receiptNo)}/receive-stock`, { data: { receivedDate: "2026-10-09" } }); return json(response); }
  async assertMobileActions() { await expect(this.page.locator("#saveDraft, #submitForApproval").first()).toBeVisible(); await expect(this.page.locator('input[type=file]').first()).toBeVisible(); }
}
