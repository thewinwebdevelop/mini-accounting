import { expect } from "@playwright/test";
import { test } from "../fixtures/playwright.fixture.mjs";
import { ExpenseRequestPage } from "../pages/expense-request.page.mjs";

test.describe("expense request journeys", () => {
  test("saves and resumes a draft with manual and Stock SKU lines, tax, evidence and owner", async ({ authenticatedPage, localApp }) => {
    const request = new ExpenseRequestPage(authenticatedPage);
    await request.open();
    await request.fill({ title: "E2E expense draft", purpose: "Fixture operating supplies", vendor: "Fixture Supplies", beforeVat: "1000", vat: "70", withholding: "30" });
    await request.addEvidence("receipt", "expense-receipt.pdf", "%PDF-1.4 fixture evidence");
    await request.saveDraft();
    const saved = await request.detail();
    expect(saved).toMatchObject({ requestNo: expect.any(String), status: "draft", ownerUserId: "employee-a" });
    expect(saved.rawFiles?.length).toBeGreaterThan(0);
    await request.reload();
    await expect(authenticatedPage.locator("#requestTitle")).toHaveValue("E2E expense draft");
    await expect(authenticatedPage.locator("#sumVat")).toHaveText("70.00");
    expect(saved.expenseLines?.[0]).toMatchObject({ amountBeforeVat: "1000", vatAmount: "70", withholdingTax: "30" });
    await request.submit();
    const submitted = await request.detail();
    expect(submitted.pdfFiles?.length).toBeGreaterThan(0);
    const files = await request.fileAssertions();
    expect(files.pdfBody).toContain("%PDF");
    expect(files.auditBody).toContain("%PDF");
    expect(new URL(files.rawUrl, localApp.baseUrl).pathname).toContain("/api/expense-requests/");
  });

  test("submits, rejects to draft, retries submit and completes with accounting context", async ({ browser, authenticatedPage, localApp }) => {
    const request = new ExpenseRequestPage(authenticatedPage);
    await request.open();
    await request.fill({ title: "E2E expense lifecycle", purpose: "Lifecycle fixture", vendor: "Fixture Supplies", beforeVat: "200" });
    await request.saveDraft();
    const number = (await request.detail()).requestNo;
    await request.submit();
    const accounting = await ExpenseRequestPage.accountingPage(browser, localApp);
    try {
      const accountingRequest = new ExpenseRequestPage(accounting, number);
      await accountingRequest.open();
      await accountingRequest.reject("needs correction");
      expect((await accountingRequest.detail()).status).toBe("draft");
      await request.reload();
      await request.submit();
      await accountingRequest.reload();
      await accountingRequest.approve();
      await accountingRequest.complete();
      const completed = await accountingRequest.detail();
      expect(completed).toMatchObject({ requestNo: number, status: "completed", ownerUserId: "employee-a" });
    } finally { await accounting.context().close(); }
  });
});
