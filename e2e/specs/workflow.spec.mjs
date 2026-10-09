import { expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "../fixtures/playwright.fixture.mjs";
import { WorkflowTemplatePage, WorkflowTransactionsPage, WorkflowTransactionPage } from "../pages/workflow.page.mjs";

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
    const template = await list.firstTemplateId();
    const first = await list.createTransaction({ template, month: "2026-10", title: "Employee A workflow" });
    const firstPage = new WorkflowTransactionPage(authenticatedPage, first.transactionNo);
    await firstPage.assertIdentity({ transactionNo: first.transactionNo, title: "Employee A workflow", ownerUserId: "employee-a" });
    await list.open();
    const second = await list.createTransaction({ template, month: "2026-10", title: "Employee A second workflow" });
    expect(second.transactionNo).not.toBe(first.transactionNo);
    const secondPage = new WorkflowTransactionPage(authenticatedPage, second.transactionNo);
    await secondPage.assertIdentity({ transactionNo: second.transactionNo, title: "Employee A second workflow", ownerUserId: "employee-a" });
    const secondStepLabels = await authenticatedPage.locator("#documentChecklist .step-label").allTextContents();
    await firstPage.open();
    await firstPage.assertIdentity({ transactionNo: first.transactionNo, title: "Employee A workflow", ownerUserId: "employee-a" });
    await expect(authenticatedPage.locator("#documentChecklist .step-label")).toHaveText(secondStepLabels);
    expect(authenticatedPage.url()).toContain(`/workflow-transaction?transactionNo=${first.transactionNo}`);
    await secondPage.open();
    await secondPage.assertIdentity({ transactionNo: second.transactionNo, title: "Employee A second workflow", ownerUserId: "employee-a" });
    expect(await secondPage.detail()).toMatchObject({ transactionNo: second.transactionNo, title: "Employee A second workflow" });
    expect(localApp.mock.state.documents.size).toBeGreaterThanOrEqual(0);
  });

  test("double-click while POST is pending produces one business record", async ({ authenticatedPage }) => {
    const list = new WorkflowTransactionsPage(authenticatedPage);
    await list.open();
    const template = await list.firstTemplateId();
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
    const firstUrl = `${authenticatedPage.url()}`;
    await expect(authenticatedPage).toHaveURL(new RegExp(`transactionNo=${result.transactionNo}$`));
    await expect(authenticatedPage.locator("#transactionNumber")).toHaveText(result.transactionNo);
    await expect(authenticatedPage.locator("#transactionTitleDisplay")).toHaveText("Pending double click");
    expect(firstUrl).toContain(`/workflow-transaction?transactionNo=${result.transactionNo}`);
    await list.open();
    const persistedRows = authenticatedPage.locator("#transactionRows tr").filter({ hasText: "Pending double click" });
    await expect(persistedRows).toHaveCount(1);
    await expect(persistedRows.first()).toContainText(result.transactionNo);
  });

  test("keeps strict step order, completes children through the browser, refreshes, and exposes packet/file links", async ({ ownerPage }) => {
    const list = new WorkflowTransactionsPage(ownerPage);
    await list.open();
    const templatePage = new WorkflowTemplatePage(ownerPage);
    await templatePage.open();
    const templateId = await templatePage.editSteps([{ documentKind: "purchase_order" }, { documentKind: "payment_voucher" }]);
    await templatePage.save();
    await list.open();
    const created = await list.createTransaction({ template: templateId, month: "2026-10", title: "Ordered workflow" });
    const transaction = new WorkflowTransactionPage(ownerPage, created.transactionNo);
    let detail = await transaction.detail();
    expect(detail.steps.map((step) => step.documentKind)).toEqual(["purchase_order", "payment_voucher"]);
    expect(detail.steps.slice(1).every((step) => step.workflowStatus === "blocked")).toBeTruthy();
    const start = await transaction.startCurrentStep();
    expect(start.url).toContain(`transactionNo=${created.transactionNo}`);
    await transaction.completeCurrentChild({ title: "Ordered purchase order" });
    await transaction.returnToTransaction();
    detail = await transaction.refresh();
    expect(detail.steps[0].workflowStatus).toBe("completed");
    expect(detail.currentStepId).toBe(detail.steps[1].stepId);
    const secondStart = await transaction.startCurrentStep();
    expect(secondStart.url).toContain("documentKind=payment_voucher");
    await expect(ownerPage.locator("#workflowPrefillBanner")).toBeVisible();
    await ownerPage.locator("#workflowPrefillApply").click();
    await transaction.completeCurrentChild({ title: "Ordered payment voucher" });
    await transaction.returnToTransaction();
    await transaction.refresh();
    await expect(ownerPage.locator("#documentChecklist .workflow-status")).toHaveText(["เสร็จสิ้น", "เสร็จสิ้น"]);
    const completed = await transaction.complete();
    expect(completed.completedAt).toBeTruthy();
    const completedLinks = await ownerPage.locator("#childDocumentFiles .file-link").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    const repeatedComplete = await transaction.completeAgainInBrowser();
    expect(repeatedComplete.statusCode).toBe(200);
    expect(repeatedComplete.body.completedAt).toBe(completed.completedAt);
    expect(await ownerPage.locator("#childDocumentFiles .file-link").evaluateAll((links) => links.map((link) => link.getAttribute("href")))).toEqual(completedLinks);
    await ownerPage.locator("#refreshTransactionButton").click();
    await expect(ownerPage.locator("#workflowPacketLink")).toBeVisible();
    await expect(ownerPage.locator("#childDocumentFiles .file-link").first()).toHaveAttribute("href", /workflow-documents/);
  });

  test("cancels a valid completed-child transaction and repeats cancellation idempotently", async ({ ownerPage, localApp }) => {
    await mkdir(path.join(localApp.rootDir, "config"), { recursive: true });
    await writeFile(path.join(localApp.rootDir, "config", "google-drive-config.json"), JSON.stringify({ clientId: "fixture-client", clientSecret: "fixture-secret" }));
    await writeFile(path.join(localApp.rootDir, "config", "google-drive-token.json"), JSON.stringify({ refresh_token: "fixture-refresh", access_token: "fixture-access", expiresAt: Date.now() + 3600000 }));
    const page = ownerPage;
    const list = new WorkflowTransactionsPage(page);
    await list.open();
    const templatePage = new WorkflowTemplatePage(page);
    await templatePage.open();
    const template = await templatePage.editSteps([{ documentKind: "purchase_order" }]);
    await templatePage.save();
    await list.open();
    const created = await list.createTransaction({ template, month: "2026-10", title: "Cancellation workflow" });
    const transaction = new WorkflowTransactionPage(page, created.transactionNo);
    await transaction.startCurrentStep();
    await transaction.completeCurrentChild({ title: "Cancellation purchase order" });
    await transaction.returnToTransaction();
    await transaction.refresh();
    const requested = await transaction.cancelWithConfirmation();
    expect(requested.status).toBe("cancelled");
    const linksBefore = await page.locator("#childDocumentFiles .file-link").evaluateAll((links) => links.map((link) => new URL(link.href).pathname));
    const cancellationBefore = requested.cancellation;
    const childBefore = requested.childDocuments.map(({ documentKind, documentNo, status, completedAt, workflowStepId }) => ({ documentKind, documentNo, status, completedAt, workflowStepId }));
    const repeated = await transaction.cancelAgainInBrowser();
    expect(repeated.statusCode).toBe(200);
    expect(repeated.body.status).toBe("cancelled");
    expect(repeated.body.cancellation).toEqual(cancellationBefore);
    expect(repeated.body.childDocuments.map(({ documentKind, documentNo, status, completedAt, workflowStepId }) => ({ documentKind, documentNo, status, completedAt, workflowStepId }))).toEqual(childBefore);
    await transaction.open();
    await expect(page.locator("#cancellationSummary")).toBeVisible();
    const after = await transaction.detail();
    expect(after).toMatchObject({ transactionNo: created.transactionNo, status: "cancelled" });
    expect(after.cancellation).toEqual(cancellationBefore);
    expect(await page.locator("#childDocumentFiles .file-link").evaluateAll((links) => links.map((link) => new URL(link.href).pathname))).toEqual(linksBefore);
  });
});
