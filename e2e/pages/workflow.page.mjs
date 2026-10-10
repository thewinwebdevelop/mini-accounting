import { expect } from "@playwright/test";

async function jsonResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok()) throw new Error(`${response.url()} -> ${response.status()}: ${body.error || "request failed"}`);
  return body;
}

export class WorkflowTemplatePage {
  constructor(page) { this.page = page; }

  async open() { await this.page.goto("/workflow-templates"); await expect(this.page.locator("#templatePage")).toBeVisible(); }

  async editSteps(steps) {
    const templates = await this.page.request.get("/api/workflow-templates").then(jsonResponse);
    const template = templates.templates.find((item) => item.templateId === "fixture-workflow-template")
      || templates.templates[0];
    if (!template) throw new Error("workflow template fixture is missing");
    await this.page.locator("#templateSelect").selectOption(template.templateId);
    await expect(this.page.locator("#documentStepsList .step-row")).toHaveCount(template.documentSteps.length);
    for (let index = template.documentSteps.length - 1; index >= 0; index--) {
      await this.page.locator("#documentStepsList .step-row").nth(index).locator("[data-remove-step]").click();
    }
    for (const step of steps) {
      await this.page.locator("#documentKindSelect").selectOption(step.documentKind);
      await this.page.locator("#addDocumentStep").click();
      if (step.receiptType) {
        await this.page.locator("#documentStepsList .step-row").last().locator(".step-receipt-type").selectOption(step.receiptType);
      }
    }
    return template.templateId;
  }

  async save() {
    await this.page.locator("#saveTemplate").click();
    await expect(this.page.locator("#templateStatus")).toContainText("บันทึก template");
    const templateId = await this.page.locator("#templateSelect").inputValue();
    const result = await this.page.request.get("/api/workflow-templates").then(jsonResponse);
    const saved = result.templates.find((template) => template.templateId === templateId);
    expect(saved?.documentSteps?.map((step) => step.documentKind)).toEqual(expect.any(Array));
    return saved;
  }
}

export class WorkflowTransactionsPage {
  constructor(page) { this.page = page; }

  async open() { await this.page.goto("/workflow-transactions"); await expect(this.page.locator("#transactionsPage")).toBeVisible(); }

  async firstTemplateId() {
    const option = this.page.locator("#startTemplateSelect option:not([value=''])").first();
    await expect(option).toBeAttached();
    return option.getAttribute("value");
  }

  async createTransaction({ template, month, title, clicks = 1, idempotencyKey, expectFailure = false } = {}) {
    await this.page.locator("#startTemplateSelect").selectOption(template);
    await this.page.locator("#startAccountingMonth").fill(month);
    await this.page.locator("#startTransactionTitle").fill(title);
    const requestKey = idempotencyKey;
    if (requestKey) {
      await this.page.addInitScript((key) => { window.crypto.randomUUID = () => key; }, requestKey);
      await this.page.evaluate((key) => { window.crypto.randomUUID = () => key; }, requestKey);
    }
    const responsePromise = this.page.waitForResponse((response) => response.url().endsWith("/api/workflow-transactions") && response.request().method() === "POST");
    await this.page.locator("#startTransactionButton").click();
    for (let index = 1; index < clicks; index++) await this.page.locator("#startTransactionButton").dispatchEvent("click");
    const response = await responsePromise;
    if (expectFailure) {
      expect(response.ok()).toBeFalsy();
      return { status: response.status(), url: this.page.url() };
    }
    const result = await jsonResponse(response);
    await this.page.waitForURL(/\/workflow-transaction\?transactionNo=/);
    return { ...result, transactionNo: result.transactionNo || new URL(this.page.url()).searchParams.get("transactionNo"), url: this.page.url() };
  }
}

export class WorkflowTransactionPage {
  constructor(page, transactionNo = null) { this.page = page; this.transactionNo = transactionNo; }

  async open(transactionNo = this.transactionNo) {
    this.transactionNo = transactionNo || new URL(this.page.url()).searchParams.get("transactionNo");
    await this.page.goto(`/workflow-transaction?transactionNo=${encodeURIComponent(this.transactionNo)}`);
    await expect(this.page.locator("#transactionNumber")).toHaveText(this.transactionNo);
    return this;
  }

  async detail() { return this.page.request.get(`/api/workflow-transactions/${encodeURIComponent(this.transactionNo)}`).then(jsonResponse); }
  async refresh() {
    await this.page.locator("#refreshTransactionButton").click();
    await expect(this.page.locator("#transactionNumber")).toHaveText(this.transactionNo);
    return this.detail();
  }

  async assertIdentity({ transactionNo, title, ownerUserId }) {
    const detail = await this.detail();
    expect(detail.transactionNo).toBe(transactionNo);
    expect(detail.title).toBe(title);
    if (ownerUserId !== undefined) expect(detail.ownerUserId).toBe(ownerUserId);
    await expect(this.page).toHaveURL(new RegExp(`transactionNo=${encodeURIComponent(transactionNo)}$`));
    await expect(this.page.locator("#transactionTitleDisplay")).toHaveText(title);
    return detail;
  }

  async startCurrentStep() {
    const before = new URL(this.page.url()).pathname;
    expect(before).toBe("/workflow-transaction");
    const responsePromise = this.page.waitForResponse((response) => response.url().includes("/start-document/") && response.request().method() === "POST");
    await this.page.locator("[data-step-action]:not([disabled])").click();
    const response = await responsePromise.then(jsonResponse);
    await this.page.waitForURL((url) => url.pathname !== "/workflow-transaction");
    expect(this.page.url()).toContain(`transactionNo=${this.transactionNo}`);
    return { ...response, url: this.page.url() };
  }

  async completeCurrentChild({ title = "Workflow child" } = {}) {
    const kind = new URL(this.page.url()).searchParams.get("documentKind");
    if (kind === "purchase_order" || kind === "payment_voucher" || kind === "cash_spend_declaration" || kind === "payee_acknowledgement" || kind === "goods_receipt") {
      await this.page.locator("#accountingMonth").fill("2026-10");
      await this.page.locator("#documentDate").fill("2026-10-09");
      await this.page.locator("#title").fill(title);
      await this.page.locator("#businessPurpose").fill(`${title} purpose`);
      const row = this.page.locator("#lineItems .line-item").first();
      await row.locator('[name="description"]').fill("Fixture item");
      await row.locator('[name="quantity"]').fill("1");
      await row.locator('[name="unitCost"]').fill("100");
      await row.locator('[name="vatMode"]').selectOption("none");
      await this.page.locator("#saveWorkflowDocument").click();
      await expect(this.page.locator("#workflowDocumentStatus")).toContainText("บันทึกเอกสาร");
      await this.page.locator("#submitWorkflowDocument").click();
      await expect(this.page.locator("#workflowReviewDialog")).toBeVisible();
      await this.page.locator("#workflowReviewConfirm").click();
      await expect(this.page.locator("#workflowDocumentStatus")).toContainText("ส่งเอกสาร");
      await this.page.locator("#approveWorkflowDocument").click();
      await expect(this.page.locator("#workflowReviewDialog")).toBeVisible();
      await this.page.locator("#workflowReviewConfirm").click();
      await expect(this.page.locator("#workflowDocumentStatus")).toContainText("อนุมัติเอกสาร");
      await this.page.locator("#completeWorkflowDocument").click();
      await expect(this.page.locator("#workflowDocumentStatus")).toContainText("เสร็จสิ้นแล้ว");
      return;
    }
    throw new Error(`unsupported child form for ${kind}`);
  }

  async returnToTransaction() {
    await this.page.locator("#workflowReturnLink").click();
    await this.page.waitForURL(/\/workflow-transaction\?transactionNo=/);
    await expect(this.page.locator("#transactionNumber")).toHaveText(this.transactionNo);
  }

  async childDocument(kind) {
    const detail = await this.detail();
    return detail.childDocuments.find((document) => document.documentKind === kind);
  }

  async complete() {
    await this.page.locator("#completeTransactionButton").click();
    await expect(this.page.locator("#transactionStatus")).toContainText("ปิดงานธุรกรรมเรียบร้อยแล้ว");
    return this.detail();
  }

  async completeAgainInBrowser() {
    return this.page.evaluate(async (transactionNo) => {
      const response = await fetch(`/api/workflow-transactions/${encodeURIComponent(transactionNo)}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      return { statusCode: response.status, body: await response.json() };
    }, this.transactionNo);
  }

  async cancelAgainInBrowser() {
    return this.page.evaluate(async (transactionNo) => {
      const response = await fetch(`/api/workflow-transactions/${encodeURIComponent(transactionNo)}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      return { statusCode: response.status, body: await response.json() };
    }, this.transactionNo);
  }

  async cancelWithConfirmation() {
    await this.page.locator("#cancelTransactionButton").click();
    await expect(this.page.locator("#cancellationDialog")).toBeVisible();
    await this.page.locator("#confirmCancellationButton").click();
    await expect(this.page.locator("#cancellationSummary")).toBeVisible();
    return this.detail();
  }

  async cancelWithConfirmationResponse() {
    const responsePromise = this.page.waitForResponse((response) => response.url().endsWith(`/api/workflow-transactions/${encodeURIComponent(this.transactionNo)}/cancel`) && response.request().method() === "POST");
    await this.page.locator("#cancelTransactionButton").click();
    await expect(this.page.locator("#cancellationDialog")).toBeVisible();
    await this.page.locator("#confirmCancellationButton").click();
    const response = await responsePromise;
    const body = await response.json();
    await expect(this.page.locator("#cancellationSummary")).toBeVisible();
    return { statusCode: response.status(), body };
  }

  async retryCancellation() {
    await this.page.locator("#retryCancellationButton").click();
    await expect(this.page.locator("#cancellationSummary")).toBeVisible();
    return this.detail();
  }

  async retryCancellationResponse() {
    const responsePromise = this.page.waitForResponse((response) => response.url().endsWith(`/api/workflow-transactions/${encodeURIComponent(this.transactionNo)}/cancel`) && response.request().method() === "POST");
    await this.page.locator("#retryCancellationButton").click();
    const response = await responsePromise;
    const body = await response.json();
    await expect(this.page.locator("#cancellationSummary")).toBeVisible();
    return { statusCode: response.status(), body };
  }

  async repeatCancellationRequest() {
    const response = await this.page.request.post(`/api/workflow-transactions/${encodeURIComponent(this.transactionNo)}/cancel`, { data: { confirmed: true } });
    return { statusCode: response.status(), body: await response.json() };
  }
}
