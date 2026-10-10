import { expect } from "@playwright/test";
import { createTestSession, sessionCookie } from "../fixtures/auth.fixture.mjs";
const SECRET = "e2e-test-session-secret-012345678901234567890123";
async function json(response) { const body = await response.json().catch(() => ({})); if (!response.ok()) throw new Error(`${response.status()} ${body.error || response.url()}`); return body; }

export class SubstituteReceiptPage {
  constructor(page, receiptNo = null, { runId = "e2e", workerIndex = 0 } = {}) { this.page = page; this.receiptNo = receiptNo; this.runId = runId; this.workerIndex = workerIndex; this.preparedStockSkus = null; }
  static async accountingPage(browser, localApp) { const context = await browser.newContext({ baseURL: localApp.baseUrl }); await context.addCookies([{ ...sessionCookie(createTestSession({ ...localApp.users.accounting, secret: SECRET })), url: localApp.baseUrl }]); return context.newPage(); }
  async open() { await this.page.goto(this.receiptNo ? `/substitute-receipt?receiptNo=${encodeURIComponent(this.receiptNo)}` : "/substitute-receipt"); await expect(this.page.locator("#substituteReceiptForm")).toBeVisible(); return this; }
  async ensureStockSku() {
    let stockSkus = (await json(await this.page.request.get("/api/inventory/stock-skus"))).stockSkus || [];
    const suffix = `${this.runId}-${this.workerIndex}`.replace(/[^a-zA-Z0-9-]/g, "-");
    const expectedSku = `E2E-SKU-${suffix}`;
    const existing = stockSkus.find((sku) => sku.sku === expectedSku);
    if (existing) { this.preparedStockSkus = [existing]; return this.preparedStockSkus; }
    let categories = (await json(await this.page.request.get("/api/inventory/categories"))).categories || [];
    const categoryName = `E2E fixture category ${suffix}`;
    if (!categories.some((category) => category.name === categoryName)) await json(await this.page.request.post("/api/inventory/categories", { data: { name: categoryName, status: "active" } }));
    categories = (await json(await this.page.request.get("/api/inventory/categories"))).categories || [];
    const productCode = `E2E-PRODUCT-${suffix}`;
    const product = await json(await this.page.request.post("/api/inventory/products", { data: { productCode, name: `E2E fixture product ${suffix}`, category: categoryName, status: "active" } }));
    const created = await json(await this.page.request.post("/api/inventory/stock-skus", { data: { productId: product.product.id, sku: expectedSku, defaultUnitCost: "200", status: "active" } }));
    this.preparedStockSkus = [created.stockSku];
    return this.preparedStockSkus;
  }
  async fill({ receiptType, title, vendor, quantity, unitCost }) {
    await this.page.locator("#accountingMonth").fill("2026-10"); await this.page.locator("#receiptDate").fill("2026-10-09"); await this.page.locator("#receiptType").selectOption(receiptType); await this.page.locator("#receiptTitle").fill(title); await this.page.locator("#payeeName").fill(vendor);
    const line = this.page.locator("#stockLineItems .stock-line").first(); await line.locator('[name="description"]').fill("Fixture receipt line"); await line.locator('[name="quantity"]').fill(quantity); await line.locator('[name="unitCost"]').fill(unitCost);
    if (receiptType === "stock_purchase") {
      const stockSkus = this.preparedStockSkus || await this.ensureStockSku();
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
  async approve() {
    const responsePromise = this.page.waitForResponse((response) => response.url().endsWith(`/api/substitute-receipts/${encodeURIComponent(this.receiptNo)}/approve`) && response.request().method() === "POST");
    await this.page.locator("#approveReceipt").click();
    if (await this.page.locator("#workflowReviewDialog").isVisible()) await this.page.locator("#workflowReviewConfirm").click();
    await json(await responsePromise);
    return this.detail();
  }
  async complete() {
    const responsePromise = this.page.waitForResponse((response) => response.url().endsWith(`/api/substitute-receipts/${encodeURIComponent(this.receiptNo)}/complete`) && response.request().method() === "POST");
    await this.page.locator("#completeReceipt").click();
    await json(await responsePromise);
    return this.detail();
  }
  async receiveStock() {
    const responsePromise = this.page.waitForResponse((response) => response.url().endsWith(`/api/substitute-receipts/${encodeURIComponent(this.receiptNo)}/receive-stock`) && response.request().method() === "POST");
    this.page.once("dialog", async (dialog) => { expect(dialog.type()).toBe("prompt"); await dialog.accept("2026-10-09"); });
    await this.page.locator("#receiveStock").click();
    return json(await responsePromise);
  }
  async assertMobileActions() { await expect(this.page.locator("#saveDraft, #submitForApproval").first()).toBeVisible(); await expect(this.page.locator('input[type=file]').first()).toBeVisible(); }
}
