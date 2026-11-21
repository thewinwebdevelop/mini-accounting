import { checkApprovalPreview } from "../pages/approval-preview.mjs";
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
    await expect(authenticatedPage.locator("#title")).toHaveValue(`E2E ${documentKind}`);
    await expect(authenticatedPage.locator("#lineItems .line-item [name=description]").first()).toHaveValue("Fixture lightweight line");
    const accounting = await WorkflowDocumentPage.accountingPage(browser, localApp);
    await accounting.setViewportSize(authenticatedPage.viewportSize());
    try {
      const review = new WorkflowDocumentPage(accounting, documentKind, saved.documentNo);
      await review.open();
      await review.submit();
      await review.reload();
      await accounting.locator("#approveWorkflowDocument").click();
      await checkApprovalPreview(accounting, saved.documentNo, { failFirst: documentKind === "payment_voucher", auditPacket: true });
      await accounting.locator("#workflowReviewConfirm").click();
      await expect(accounting.locator("#documentStatusPreview")).toHaveText("อนุมัติแล้ว");
      await review.complete();
      const completed = await review.detail();
      expect(completed).toMatchObject({ documentKind, documentNo: saved.documentNo, status: "completed", ownerUserId: "employee-a" });
      expect(completed.pdfFiles?.length).toBeGreaterThan(0);
      expect(completed.rawFiles?.length).toBeGreaterThan(0);
      expect((await review.pdfBody()).toString("latin1", 0, 8)).toContain("%PDF");
    } finally { await accounting.context().close(); }
  });
}

test("payment voucher saves the selected slip before submitting for approval", async ({ authenticatedPage: page }) => {
  const voucher = new WorkflowDocumentPage(page, "payment_voucher");
  await voucher.open();
  await voucher.fill({ title: "Voucher with slip", purpose: "Payment", vendor: "Fixture Supplies", beforeVat: "800", vatMode: "manual", vatAmount: "0", withholdingTax: "0" });
  await voucher.save();
  await voucher.reload();
  await expect(page.locator("#title")).toHaveValue("Voucher with slip");
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAwAAAAMCAIAAADZF8uwAAAAF0lEQVR4nGNkYPjPQAgwEVQxqmgAggAAzeIBF5UyoZcAAAAASUVORK5CYII=", "base64");
  await page.locator('[name=evidence_evidence]').setInputFiles({ name: "slip.png", mimeType: "image/png", buffer: image });
  const confirmSubmit = async () => {
    await page.locator("#submitWorkflowDocument").click();
    await expect(page.locator("#workflowReviewContent")).toContainText("slip.png");
    await page.locator("#workflowReviewConfirm").click();
  };
  await page.route("**/api/workflow-documents", route => route.fulfill({ status: 503, json: { error: "Upload unavailable" } }), { times: 1 });
  await confirmSubmit();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("อัปโหลดไฟล์แนบไม่สำเร็จ");
  await expect(alert).toContainText("ยังไม่ได้ส่งอนุมัติ");
  await expect(alert).toContainText("กดส่งตรวจอนุมัติอีกครั้งได้โดยใช้ไฟล์เดิม");
  await expect(alert).toContainText("Upload unavailable");
  await expect(alert).toBeInViewport();
  await page.route("**/api/workflow-documents", route => route.abort("failed"), { times: 1 });
  await confirmSubmit();
  await expect(alert).toContainText("ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต");
  expect((await voucher.detail()).status).toBe("draft");
  await confirmSubmit();
  await expect(page.locator("#workflowDocumentStatus")).toContainText("ตรวจอนุมัติแล้ว");
  await voucher.reload();
  await expect(page.locator("#documentStatusPreview")).toHaveText("รอตรวจอนุมัติ");
  const slip = page.locator("#existingEvidenceFiles a").filter({ hasText: "evidence_001.png" });
  await expect(slip).toBeVisible();
  expect(await (await page.request.get(await slip.getAttribute("href"))).body()).toEqual(image);
  expect((await voucher.detail()).pdfFiles.some(file => file.name.includes("audit-packet"))).toBe(true);
});
