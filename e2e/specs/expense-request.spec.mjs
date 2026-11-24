import { execFileSync } from "node:child_process";
import { checkApprovalPreview } from "../pages/approval-preview.mjs";
import { expect } from "@playwright/test";
import { test } from "../fixtures/playwright.fixture.mjs";
import { ExpenseRequestPage } from "../pages/expense-request.page.mjs";

test.describe("expense request journeys", () => {
  test("saves and resumes a draft with manual and Stock SKU lines, tax, evidence and owner", async ({ authenticatedPage, localApp }) => {
    const request = new ExpenseRequestPage(authenticatedPage);
    await request.open();
    await request.fill({ title: "E2E expense draft", purpose: "Fixture operating supplies", vendor: "Fixture Supplies", beforeVat: "1000", vat: "70", withholding: "30", stockSku: true });
    await authenticatedPage.locator('[name="lineVendor"]').last().fill("OmittedVendor");
    await request.addEvidence("receipt", "expense-receipt.pdf", "%PDF-1.4 fixture evidence");
    await request.saveDraft();
    const saved = await request.detail();
    expect(saved).toMatchObject({ requestNo: expect.any(String), status: "draft", ownerUserId: "employee-a" });
    expect(saved.rawFiles?.length).toBeGreaterThan(0);
    await request.reload();
    await expect(authenticatedPage.locator("#requestTitle")).toHaveValue("E2E expense draft");
    await expect(authenticatedPage.locator("#sumVat")).toHaveText("70.00");
    expect(saved.expenseLines?.[0]).toMatchObject({ amountBeforeVat: "1000", vatAmount: "70", withholdingTax: "30" });
    expect(saved.expenseLines?.[0]?.stockSkuId || "").toBe("");
    expect(saved.expenseLines?.[1]).toMatchObject({ stockSkuId: expect.anything(), description: "Fixture Stock SKU line" });
    expect(saved.expenseLines?.[1]?.stockSkuId).not.toBe("");
    await request.submit();
    const submitted = await request.detail();
    expect(submitted.pdfFiles?.length).toBeGreaterThan(0);
    const files = await request.fileAssertions();
    const pages = JSON.parse(execFileSync(process.env.SWEET_HOUSE_PYTHON_BIN || "python3", ["-c", `
import io, json, sys
from pypdf import PdfReader
pages = PdfReader(io.BytesIO(sys.stdin.buffer.read())).pages
print(json.dumps([dict(width=float(p.mediabox.width), height=float(p.mediabox.height),
                       text=p.extract_text()) for p in pages]))
`], { input: files.pdfBody, encoding: "utf8" }));
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      expect(page.width).toBeCloseTo(595.28, 1);
      expect(page.height).toBeCloseTo(841.89, 1);
    }
    const text = pages.map(page => page.text).join("\n");
    expect(text).toContain("Fixture Supplies");
    expect(text).toContain("Fixture expense line");
    expect(text).not.toContain("OmittedVendor");
    expect(text.split(/\s+/)).not.toContain("ผู้ขาย");
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
    await accounting.setViewportSize(authenticatedPage.viewportSize());
    try {
      const accountingRequest = new ExpenseRequestPage(accounting, number);
      await accountingRequest.open();
      await accountingRequest.reject("needs correction");
      expect((await accountingRequest.detail()).status).toBe("draft");
      await request.reload();
      await expect(authenticatedPage.locator("#requestTitle")).toHaveValue("E2E expense lifecycle");
      await request.submit();
      await accountingRequest.reload();
      await accounting.locator("#approveRequest").click();
      await checkApprovalPreview(accounting, number, { auditPacket: true });
      await accounting.locator("#workflowReviewCancel").click();
      await accounting.goto("/expense-requests");
      await accounting.locator(`[data-approve="${number}"]`).click();
      await checkApprovalPreview(accounting, number, { auditPacket: true });
      const approved = accounting.waitForResponse(response => response.url().endsWith(`/${number}/approve`));
      await accounting.locator("#workflowReviewConfirm").click();
      expect((await approved).ok()).toBe(true);
      await accountingRequest.complete();
      const completed = await accountingRequest.detail();
      expect(completed).toMatchObject({ requestNo: number, status: "completed", ownerUserId: "employee-a" });
    } finally { await accounting.context().close(); }
  });
});
