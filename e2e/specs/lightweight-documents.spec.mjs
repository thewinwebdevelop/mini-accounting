import { expect } from "@playwright/test";
import { test } from "../fixtures/playwright.fixture.mjs";
import { WorkflowDocumentPage } from "../pages/workflow-document.page.mjs";

const documentKinds = ["purchase_order", "payment_voucher", "cash_spend_declaration", "payee_acknowledgement", "goods_receipt"];

for (const documentKind of documentKinds) {
  test(`creates, reloads and completes ${documentKind} with PDF and evidence`, async ({ browser, authenticatedPage, localApp }) => {
    const document = new WorkflowDocumentPage(authenticatedPage, documentKind);
    await document.open();
    await document.fill({ title: `E2E ${documentKind}`, purpose: "Lightweight document fixture", vendor: "Fixture Supplies", beforeVat: "300", vatMode: "manual", vatAmount: "21", withholdingTax: "10" });
    await document.addEvidence("lightweight.pdf", "%PDF-1.4 lightweight evidence");
    await document.save();
    const saved = await document.detail();
    expect(saved).toMatchObject({ documentKind, documentNo: expect.any(String), status: "draft", ownerUserId: "employee-a" });
    await document.reload();
    const accounting = await WorkflowDocumentPage.accountingPage(browser, localApp);
    try {
      const review = new WorkflowDocumentPage(accounting, documentKind, saved.documentNo);
      await review.open();
      await review.submit();
      await review.approve();
      await review.complete();
      const completed = await review.detail();
      expect(completed).toMatchObject({ documentKind, documentNo: saved.documentNo, status: "completed", ownerUserId: "employee-a" });
      expect(completed.pdfFiles?.length).toBeGreaterThan(0);
      expect(completed.rawFiles?.length).toBeGreaterThan(0);
      expect((await review.pdfBody()).toString("latin1", 0, 8)).toContain("%PDF");
    } finally { await accounting.context().close(); }
  });
}
