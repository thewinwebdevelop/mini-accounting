import { expect } from "@playwright/test";

const SECRET = "e2e-test-session-secret-012345678901234567890123";

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

  async createTransaction({ template, month, title, clicks = 1, idempotencyKey } = {}) {
    await this.page.locator("#startTemplateSelect").selectOption(template);
    await this.page.locator("#startAccountingMonth").fill(month);
    await this.page.locator("#startTransactionTitle").fill(title);
    if (idempotencyKey) {
      return this.page.request.post("/api/workflow-transactions", { data: { templateId: template, accountingMonth: month, title, idempotencyKey } }).then(jsonResponse);
    }
    const responsePromise = this.page.waitForResponse((response) => response.url().endsWith("/api/workflow-transactions") && response.request().method() === "POST");
    await this.page.locator("#startTransactionButton").click();
    for (let index = 1; index < clicks; index++) await this.page.locator("#startTransactionButton").dispatchEvent("click");
    const response = await responsePromise;
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
  async refresh() { return this.page.request.post(`/api/workflow-transactions/${encodeURIComponent(this.transactionNo)}/refresh`, { data: { regeneratePacket: false } }).then(jsonResponse); }

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
    const detail = await this.detail();
    const step = detail.steps.find((item) => item.stepId === detail.currentStepId);
    const response = await this.page.request.post(`/api/workflow-transactions/${encodeURIComponent(this.transactionNo)}/start-document/${encodeURIComponent(step.stepId)}`, { data: {} }).then(jsonResponse);
    expect(response.transactionNo).toBe(this.transactionNo);
    return response;
  }

  async childDocument(kind) {
    const detail = await this.detail();
    return detail.childDocuments.find((document) => document.documentKind === kind);
  }

  async complete() {
    return this.page.request.post(`/api/workflow-transactions/${encodeURIComponent(this.transactionNo)}/complete`, { data: {} }).then(jsonResponse);
  }

  async cancel(confirmText = "confirm") {
    return this.page.request.post(`/api/workflow-transactions/${encodeURIComponent(this.transactionNo)}/cancel`, { data: { confirmed: confirmText } }).then(jsonResponse);
  }

  async cancelWithConfirmation() {
    await this.page.locator("#cancelTransactionButton").click();
    await expect(this.page.locator("#cancellationDialog")).toBeVisible();
    await this.page.locator("#confirmCancellationButton").click();
    await expect(this.page.locator("#cancellationSummary")).toBeVisible();
    return this.detail();
  }
}

export async function createChildDocument(page, { transaction, step, title = "Workflow child" }) {
  const payload = {
    documentKind: step.documentKind,
    accountingMonth: transaction.accountingMonth,
    documentDate: `${transaction.accountingMonth}-09`,
    title,
    businessPurpose: `${transaction.title} child document`,
    transactionNo: transaction.transactionNo,
    workflowTemplateId: transaction.workflowTemplateId,
    workflowStepId: step.stepId,
    lines: [{ description: "Fixture item", quantity: "1", unitCost: "100", vatMode: "none", withholdingTax: "0" }],
  };
  const form = new FormData();
  form.append("payload", JSON.stringify(payload));
  return page.request.post("/api/workflow-documents", { multipart: { payload: JSON.stringify(payload) } }).then(jsonResponse);
}

export { SECRET };
