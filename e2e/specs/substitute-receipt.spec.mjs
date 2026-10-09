import { expect } from "@playwright/test";
import { test } from "../fixtures/playwright.fixture.mjs";
import { SubstituteReceiptPage } from "../pages/substitute-receipt.page.mjs";

for (const receiptType of ["general_expense", "stock_purchase"]) {
  test(`supports ${receiptType} evidence, lifecycle and idempotent receive`, async ({ browser, authenticatedPage, localApp }) => {
    const receipt = new SubstituteReceiptPage(authenticatedPage);
    await receipt.open();
    await receipt.fill({ receiptType, title: `E2E ${receiptType}`, vendor: "Fixture Supplies", quantity: "2", unitCost: "150" });
    await receipt.addEvidence("paymentSlip", "receipt-evidence.pdf", "%PDF-1.4 substitute evidence");
    await receipt.saveDraft();
    const draft = await receipt.detail();
    expect(draft).toMatchObject({ receiptNo: expect.any(String), status: "draft", ownerUserId: "employee-a", receiptType });
    await receipt.submit();
    const accounting = await SubstituteReceiptPage.accountingPage(browser, localApp);
    try {
      const review = new SubstituteReceiptPage(accounting, draft.receiptNo);
      await review.open();
      await review.approve();
      if (receiptType === "stock_purchase") {
        const first = await review.receiveStock();
        const second = await review.receiveStock();
        expect(second).toMatchObject({ receiptNo: draft.receiptNo, status: "received" });
        expect(second.stockMovements?.[0]?.id).toBe(first.stockMovements?.[0]?.id);
        expect(first.receiptNo).toBe(draft.receiptNo);
      }
      await review.complete();
      const completed = await review.detail();
      expect(completed).toMatchObject({ receiptNo: draft.receiptNo, status: "completed" });
      expect(completed.pdfFiles?.length).toBeGreaterThan(0);
      expect(completed.rawFiles?.length).toBeGreaterThan(0);
      await review.reload();
      expect((await review.detail()).ownerUserId).toBe("employee-a");
    } finally { await accounting.context().close(); }
  });
}
