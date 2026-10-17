import { expect } from "@playwright/test";
import { test } from "../fixtures/playwright.fixture.mjs";
import { SubstituteReceiptPage } from "../pages/substitute-receipt.page.mjs";

for (const receiptType of ["general_expense", "stock_purchase"]) {
  test(`supports ${receiptType} evidence, lifecycle and idempotent receive`, async ({ browser, authenticatedPage, localApp }, testInfo) => {
    const receipt = new SubstituteReceiptPage(authenticatedPage, null, { runId: localApp.runId, workerIndex: testInfo.workerIndex });
    const seededStockSkus = receiptType === "stock_purchase" ? await receipt.ensureStockSku() : [];
    await receipt.open();
    if (receiptType === "stock_purchase") {
      const option = authenticatedPage.locator(`#stockLineItems .stock-line select[name="stockSkuId"] option[value="${seededStockSkus[0].id}"]`);
      await expect(option).toHaveCount(1);
      await expect(option).toContainText(seededStockSkus[0].sku);
    }
    await receipt.fill({ receiptType, title: `E2E ${receiptType}`, vendor: "Fixture Supplies", quantity: "2", unitCost: "150" });
    if (receiptType === "stock_purchase") expect(await receipt.selectedStockSkuId()).not.toBe("");
    await receipt.addEvidence("paymentSlip", "receipt-evidence.pdf", "%PDF-1.4 substitute evidence");
    await receipt.saveDraft();
    const draft = await receipt.detail();
    expect(draft).toMatchObject({ receiptNo: expect.any(String), status: "draft", ownerUserId: "employee-a", receiptType });
    if (receiptType === "stock_purchase") expect(draft.payload?.lines?.[0]?.stockSkuId || draft.lines?.[0]?.stockSkuId).toBeTruthy();
    const submitted = await receipt.submit();
    expect(submitted.status).toBe("pending_approval");
    const accounting = await SubstituteReceiptPage.accountingPage(browser, localApp);
    try {
      const review = new SubstituteReceiptPage(accounting, draft.receiptNo, { runId: localApp.runId, workerIndex: testInfo.workerIndex });
      await review.open();
      await review.approve();
      if (receiptType === "stock_purchase") {
        const retryAccounting = await SubstituteReceiptPage.accountingPage(browser, localApp);
        try {
          const retryReview = new SubstituteReceiptPage(retryAccounting, draft.receiptNo, { runId: localApp.runId, workerIndex: testInfo.workerIndex });
          await retryReview.open();
          const first = await review.receiveStock();
          const second = await retryReview.receiveStock();
          expect(second).toMatchObject({ receiptNo: draft.receiptNo, status: "received" });
          expect(second.stockMovements?.[0]?.id).toBe(first.stockMovements?.[0]?.id);
          expect(first.receiptNo).toBe(draft.receiptNo);
        } finally { await retryAccounting.context().close(); }
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
