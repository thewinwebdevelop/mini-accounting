import { expect } from "@playwright/test";
import { test } from "../fixtures/playwright.fixture.mjs";
import { ExpenseRequestPage } from "../pages/expense-request.page.mjs";
import { SubstituteReceiptPage } from "../pages/substitute-receipt.page.mjs";
import { WorkflowDocumentPage } from "../pages/workflow-document.page.mjs";

test.describe("mobile document UI", () => {
  test("collapses navigation, line items and keeps actions/evidence usable", async ({ authenticatedPage }) => {
    for (const [path, Page] of [["/expense-request", ExpenseRequestPage], ["/substitute-receipt", SubstituteReceiptPage], ["/workflow-document?documentKind=purchase_order", WorkflowDocumentPage]]) {
      await authenticatedPage.goto(path);
      if (path !== "/workflow-document?documentKind=purchase_order") {
        await expect(authenticatedPage.locator("summary.menu-button")).toBeVisible();
        await authenticatedPage.locator("summary.menu-button").click();
        await expect(authenticatedPage.locator("nav[aria-label='เมนูหลัก']")).toBeVisible();
        await authenticatedPage.locator("summary.menu-button").click();
      }
      const pageObject = Page === WorkflowDocumentPage ? new Page(authenticatedPage, "purchase_order") : new Page(authenticatedPage);
      await pageObject.assertMobileActions();
    }
  });
});
