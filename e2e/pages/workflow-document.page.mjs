import { expect } from "@playwright/test";
import { createTestSession, sessionCookie } from "../fixtures/auth.fixture.mjs";
const SECRET = "e2e-test-session-secret-012345678901234567890123";
async function json(response) { const body = await response.json().catch(() => ({})); if (!response.ok()) throw new Error(`${response.status()} ${body.error || response.url()}`); return body; }

export class WorkflowDocumentPage {
  constructor(page, documentKind, documentNo = null) { this.page = page; this.documentKind = documentKind; this.documentNo = documentNo; }
  static async accountingPage(browser, localApp) { const context = await browser.newContext({ baseURL: localApp.baseUrl }); await context.addCookies([{ ...sessionCookie(createTestSession({ ...localApp.users.accounting, secret: SECRET })), url: localApp.baseUrl }]); return context.newPage(); }
  async open() { const query = new URLSearchParams({ documentKind: this.documentKind }); if (this.documentNo) query.set("documentNo", this.documentNo); await this.page.goto(`/workflow-document?${query}`); await expect(this.page.locator("#workflowDocumentForm")).toBeVisible(); return this; }
  async fill({ title, purpose, vendor, beforeVat, vatMode, vatAmount, withholdingTax }) { await this.page.locator("#accountingMonth").fill("2026-10"); await this.page.locator("#documentDate").fill("2026-10-09"); await this.page.locator("#title").fill(title); await this.page.locator("#requesterName").fill("Employee A"); await this.page.locator("#payeeName").fill(vendor); await this.page.locator("#businessPurpose").fill(purpose); const line = this.page.locator("#lineItems .line-item").first(); await line.locator('[name="description"]').fill("Fixture lightweight line"); await line.locator('[name="quantity"]').fill("1"); await line.locator('[name="unitCost"]').fill(beforeVat); await line.locator('[name="vatMode"]').selectOption(vatMode); await line.locator('[name="vatAmount"]').fill(vatAmount); await line.locator('[name="withholdingTax"]').fill(withholdingTax); }
  async addEvidence(name, buffer) { await this.page.locator('input[name="evidence_evidence"]').setInputFiles({ name, mimeType: "application/pdf", buffer: Buffer.from(buffer) }); }
  async save() { await this.page.locator("#saveWorkflowDocument").click(); await expect(this.page.locator("#workflowDocumentStatus")).toContainText("บันทึก"); this.documentNo = await this.page.locator("#documentNoPreview").textContent(); return this.detail(); }
  async reload() { await this.open(); }
  async detail() { const body = await json(await this.page.request.get(`/api/workflow-documents/${encodeURIComponent(this.documentKind)}/${encodeURIComponent(this.documentNo)}`)); return { ...body, ownerUserId: body.ownerUserId || body.payload?.ownerUserId || "", pdfFiles: body.pdfFiles || body.payload?.pdfFiles || [], rawFiles: body.rawFiles || body.payload?.rawFiles || [] }; }
  async action(action) { await json(await this.page.request.post(`/api/workflow-documents/${encodeURIComponent(this.documentKind)}/${encodeURIComponent(this.documentNo)}/${action}`, { data: {} })); return this.detail(); }
  async submit() { return this.action("submit"); } async approve() { return this.action("approve"); } async complete() { return this.action("complete"); }
  async pdfBody() { const detail = await this.detail(); const url = detail.pdfFiles?.[0]?.url || detail.pdfFiles?.[0]?.path; return Buffer.from(await (await this.page.request.get(url)).body()); }
  async assertMobileActions() { await expect(this.page.locator("#saveWorkflowDocument")).toBeVisible(); await expect(this.page.locator('input[type=file]').first()).toBeVisible(); }
  async assertLineItemCollapse() { const row = this.page.locator("#lineItems .line-item").first(); await expect(row).toHaveAttribute("open", ""); await row.locator("summary.line-item-summary").click(); await expect(row).not.toHaveAttribute("open", ""); }
}
