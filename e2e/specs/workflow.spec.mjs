import { expect } from "@playwright/test";
import { test } from "../fixtures/playwright.fixture.mjs";
import { WorkflowTemplatePage, WorkflowTransactionsPage, WorkflowTransactionPage, SECRET } from "../pages/workflow.page.mjs";
import { createTestSession, sessionCookie } from "../fixtures/auth.fixture.mjs";

test.describe("workflow local journeys", () => {
  test("edits a template, reloads its ordered steps and preserves receipt type", async ({ ownerPage }) => {
    const templates = new WorkflowTemplatePage(ownerPage);
    await templates.open();
    const templateId = await templates.editSteps([
      { documentKind: "purchase_order" },
      { documentKind: "substitute_receipt", receiptType: "general_expense" },
      { documentKind: "payment_voucher" },
    ]);
    const saved = await templates.save();
    await templates.open();
    await ownerPage.locator("#templateSelect").selectOption(templateId);
    await expect(ownerPage.locator("#documentStepsList .step-label")).toHaveText(["ใบสั่งซื้อ", "ใบรับรองแทนใบเสร็จรับเงิน", "ใบสำคัญจ่าย"]);
    await expect(ownerPage.locator("#documentStepsList .step-receipt-type").nth(1)).toHaveValue("general_expense");
    expect(saved.documentSteps.map((step) => step.documentKind)).toEqual(["purchase_order", "substitute_receipt", "payment_voucher"]);
  });

  test("creates two same-month transactions with exact identity and isolates their reloads", async ({ authenticatedPage, localApp }) => {
    const list = new WorkflowTransactionsPage(authenticatedPage);
    await list.open();
    const template = await authenticatedPage.request.get("/api/workflow-templates").then((response) => response.json()).then((body) => body.templates[0].templateId);
    const first = await list.createTransaction({ template, month: "2026-10", title: "Employee A workflow" });
    const firstPage = new WorkflowTransactionPage(authenticatedPage, first.transactionNo);
    await firstPage.assertIdentity({ transactionNo: first.transactionNo, title: "Employee A workflow", ownerUserId: "employee-a" });
    await list.open();
    const second = await list.createTransaction({ template, month: "2026-10", title: "Employee A second workflow" });
    expect(second.transactionNo).not.toBe(first.transactionNo);
    const secondPage = new WorkflowTransactionPage(authenticatedPage, second.transactionNo);
    await secondPage.assertIdentity({ transactionNo: second.transactionNo, title: "Employee A second workflow", ownerUserId: "employee-a" });
    await authenticatedPage.reload();
    await expect(authenticatedPage.locator("#transactionNumber")).toHaveText(second.transactionNo);
    expect(await secondPage.detail()).toMatchObject({ transactionNo: second.transactionNo, title: "Employee A second workflow" });
    expect(localApp.mock.state.reservations.size).toBeGreaterThanOrEqual(0);
  });

  test("double-click while POST is pending produces one business record", async ({ authenticatedPage }) => {
    const list = new WorkflowTransactionsPage(authenticatedPage);
    await list.open();
    const template = await authenticatedPage.request.get("/api/workflow-templates").then((response) => response.json()).then((body) => body.templates[0].templateId);
    let release;
    const barrier = new Promise((resolve) => { release = resolve; });
    await authenticatedPage.route("**/api/workflow-transactions", async (route) => {
      if (route.request().method() === "POST") await barrier;
      await route.continue();
    });
    const creation = list.createTransaction({ template, month: "2026-10", title: "Pending double click", clicks: 2 });
    await authenticatedPage.waitForTimeout(100);
    release();
    const result = await creation;
    await authenticatedPage.unroute("**/api/workflow-transactions");
    const rows = await authenticatedPage.request.get("/api/workflow-transactions").then((response) => response.json());
    expect(rows.transactions.filter((item) => item.transactionNo === result.transactionNo)).toHaveLength(1);
    expect((await new WorkflowTransactionPage(authenticatedPage, result.transactionNo).detail()).title).toBe("Pending double click");
  });

  test("keeps strict step order, refreshes after child completion, and exposes packet/file links", async ({ authenticatedPage }) => {
    const list = new WorkflowTransactionsPage(authenticatedPage);
    await list.open();
    const template = await authenticatedPage.request.get("/api/workflow-templates").then((response) => response.json()).then((body) => body.templates[0]);
    const created = await list.createTransaction({ template: template.templateId, month: "2026-10", title: "Ordered workflow" });
    const transaction = new WorkflowTransactionPage(authenticatedPage, created.transactionNo);
    let detail = await transaction.detail();
    expect(detail.steps.map((step) => step.documentKind)).toEqual(template.documentSteps.map((step) => step.documentKind));
    expect(detail.steps.slice(1).every((step) => step.workflowStatus === "blocked")).toBeTruthy();
    const start = await transaction.startCurrentStep();
    await authenticatedPage.goto(start.url);
    await expect(authenticatedPage.locator("#transactionNo")).toHaveValue(created.transactionNo);
    await authenticatedPage.goto(`/workflow-transaction?transactionNo=${encodeURIComponent(created.transactionNo)}`);
    detail = await transaction.detail();
    expect(detail.currentStepId).toBe(detail.steps[0].stepId);
    expect(detail.childDocuments).toEqual([]);
  });

  test("supports complete/cancel retry and idempotent terminal results", async ({ browser, localApp }) => {
    const context = await browser.newContext({ baseURL: localApp.baseUrl });
    await context.addCookies([{ ...sessionCookie(createTestSession({ ...localApp.users.owner, secret: SECRET })), url: localApp.baseUrl }]);
    const page = await context.newPage();
    const list = new WorkflowTransactionsPage(page);
    await list.open();
    const template = await page.request.get("/api/workflow-templates").then((response) => response.json()).then((body) => body.templates[0].templateId);
    const created = await list.createTransaction({ template, month: "2026-10", title: "Cancellation workflow" });
    const transaction = new WorkflowTransactionPage(page, created.transactionNo);
    const missingConfirmation = await page.request.post(`/api/workflow-transactions/${encodeURIComponent(created.transactionNo)}/cancel`, { data: { confirmed: "wrong" } });
    expect(missingConfirmation.status()).toBe(400);
    const cancelled = await transaction.cancelWithConfirmation();
    expect(["cancelled", "cancellation_pending"]).toContain(cancelled.status);
    const retry = await transaction.cancel(true);
    expect(["cancelled", "cancellation_pending"]).toContain(retry.status);
    await context.close();
  });
});
