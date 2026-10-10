import { expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "../fixtures/playwright.fixture.mjs";
import { InventoryPage } from "../pages/inventory.page.mjs";
import { SubstituteReceiptPage } from "../pages/substitute-receipt.page.mjs";
import { WorkflowTemplatePage, WorkflowTransactionPage, WorkflowTransactionsPage } from "../pages/workflow.page.mjs";

test.describe("inventory journeys", () => {
  test("persists category, product, parent/child SKU and images while enforcing duplicate and inactive rules", async ({ authenticatedPage, localApp }, testInfo) => {
    const inventory = new InventoryPage(authenticatedPage, localApp);
    const master = await inventory.createMaster({ suffix: `${testInfo.workerIndex}-${Date.now()}`, childCount: 2 });

    await inventory.expectDuplicateCategory(master.category.name);
    await inventory.expectDuplicateSku(master.children[0].sku);
    await inventory.setSkuInactive(master.product.id, master.children[1].id);
    await inventory.uploadImages(master.product.id, master.children[0].id);

    const detail = await inventory.reloadDetail(master.product.id);
    expect(detail.product).toMatchObject({ productCode: master.product.productCode, category: master.category.name });
    expect(detail.children.find((sku) => sku.id === master.children[0].id)).toMatchObject({
      sku: master.children[0].sku,
      imageUrl: expect.stringContaining(`/api/inventory/images/stock-skus/stock-sku-${master.children[0].id}.`),
      status: "active",
    });
    expect(detail.children.find((sku) => sku.id === master.children[1].id)).toMatchObject({ status: "inactive" });
    expect(detail.product.imageUrl).toContain(`/api/inventory/images/products/product-${master.product.id}.`);

    await inventory.openPurchaseIn();
    await expect(authenticatedPage.locator(`#purchaseSkuSelect option[value="${master.children[0].id}"]`)).toHaveCount(1);
    await expect(authenticatedPage.locator(`#purchaseSkuSelect option[value="${master.children[1].id}"]`)).toHaveCount(0);
  });

  test("records purchase-in, exposes balance/card/dashboard/report/PDF, and reverses through workflow cancellation once", async ({ ownerPage, browser, localApp }, testInfo) => {
    const inventory = new InventoryPage(ownerPage, localApp);
    const master = await inventory.createMaster({ suffix: `${testInfo.workerIndex}-${Date.now()}`, childCount: 1 });
    const page = ownerPage;
    await mkdir(path.join(localApp.rootDir, "config"), { recursive: true });
    await writeFile(path.join(localApp.rootDir, "config", "google-drive-config.json"), JSON.stringify({ clientId: "fixture-client", clientSecret: "fixture-secret" }));
    await writeFile(path.join(localApp.rootDir, "config", "google-drive-token.json"), JSON.stringify({ refresh_token: "fixture-refresh", access_token: "fixture-access", expiresAt: Date.now() + 3600000 }));
    const templates = new WorkflowTemplatePage(page);
    await templates.open();
    const templateId = await templates.editSteps([{ documentKind: "substitute_receipt", receiptType: "stock_purchase" }]);
    await templates.save();
    const transactions = new WorkflowTransactionsPage(page);
    await transactions.open();
    const created = await transactions.createTransaction({ template: templateId, month: "2026-10", title: "Inventory cancellation workflow" });
    const transaction = new WorkflowTransactionPage(page, created.transactionNo);
    await transaction.startCurrentStep();
    const receipt = new SubstituteReceiptPage(page, null, { runId: localApp.runId, workerIndex: testInfo.workerIndex });
    receipt.preparedStockSkus = [master.children[0]];
    await receipt.fill({ receiptType: "stock_purchase", title: "Inventory cancellation receipt", vendor: "Fixture Supplies", quantity: "8", unitCost: "125" });
    await receipt.addEvidence("paymentSlip", "inventory-cancellation.pdf", "%PDF-1.4 inventory cancellation evidence");
    const draft = await receipt.saveDraft();
    await receipt.submit();
    const accounting = await SubstituteReceiptPage.accountingPage(browser, localApp);
    try {
      const review = new SubstituteReceiptPage(accounting, draft.receiptNo, { runId: localApp.runId, workerIndex: testInfo.workerIndex });
      await review.open();
      await review.approve();
      await review.receiveStock();
      await review.complete();
    } finally {
      await accounting.context().close();
    }
    await transaction.returnToTransaction();
    await transaction.refresh();
    const before = await inventory.balance(master.children[0].id);
    expect(before).toMatchObject({ sku: master.children[0].sku, quantityOnHand: 8, averageUnitCost: "125.00", inventoryValue: "1000.00" });

    await inventory.openLedger(master.children[0].id);
    await expect(page.locator("#stockCardRows")).toContainText(draft.receiptNo);
    await expect(page.locator("#stockCardRows")).toContainText("8");
    const dashboard = await inventory.dashboard();
    expect(dashboard.summary).toMatchObject({ totalQuantityOnHand: 8, totalInventoryValue: "1000.00" });
    await inventory.openDashboardReport();
    await expect(page.locator("#stockInRows")).toContainText(draft.receiptNo);
    const pdf = await inventory.currentStockPdf();
    expect(pdf.contentType).toContain("application/pdf");
    expect(pdf.body.subarray(0, 4).toString("utf8")).toBe("%PDF");

    const card = await inventory.stockCard(master.children[0].id);
    const original = card.movements.find((movement) => movement.referenceNo === draft.receiptNo);
    expect(original).toMatchObject({ movementType: "purchase_in", quantity: 8 });
    let cancelled = await transaction.cancelAgainInBrowser();
    if (cancelled.statusCode === 202) {
      await transaction.open();
      cancelled = await transaction.cancelAgainInBrowser();
    }
    expect(cancelled).toMatchObject({ statusCode: 200, body: { transactionNo: created.transactionNo, status: "cancelled" } });
    await transaction.open();
    await expect(page.locator("#cancellationSummary")).toBeVisible();
    const repeatedReversal = await transaction.cancelAgainInBrowser();
    expect(repeatedReversal).toMatchObject({ statusCode: 200, body: { transactionNo: created.transactionNo, status: "cancelled" } });

    const after = await inventory.balance(master.children[0].id);
    expect(after).toMatchObject({ quantityOnHand: 0, inventoryValue: "0.00" });
    const reversedCard = await inventory.stockCard(master.children[0].id);
    expect(reversedCard.movements.map((movement) => movement.movementType)).toEqual(["purchase_in", "adjustment_out"]);
  });

  test("supports search/category/status filters and parent/all-SKU grouped views", async ({ authenticatedPage, localApp }, testInfo) => {
    const inventory = new InventoryPage(authenticatedPage, localApp);
    const master = await inventory.createMaster({ suffix: `${testInfo.workerIndex}-${Date.now()}`, childCount: 2 });
    await inventory.receivePurchaseIn({ stockSkuId: master.children[0].id, quantity: "2", unitCost: "100", referenceType: "manual", referenceNo: `FILTER-${Date.now()}` });
    await inventory.openStockList(master.product.productCode);
    await expect(authenticatedPage.locator("#stockListCount")).toHaveText("1");
    await expect(authenticatedPage.locator("#parentStockRows")).toContainText(master.product.productCode);
    await expect(authenticatedPage.locator("#parentStockRows")).toContainText(master.category.name);

    await authenticatedPage.locator("#stockListCategory").selectOption({ label: master.category.name });
    await expect(authenticatedPage.locator("#stockListCount")).toHaveText("1");
    await authenticatedPage.locator("#stockListMode").selectOption("all");
    await authenticatedPage.locator("#stockListStatus").selectOption("in_stock");
    await expect(authenticatedPage.locator("#allStockPanel")).toBeVisible();
    const group = authenticatedPage.locator("#stockGroupRows .stock-group").filter({ hasText: master.product.productCode });
    await expect(group).toHaveCount(1);
    await expect(group).toContainText(master.children[0].sku);
    await expect(group).not.toContainText(master.children[1].sku);
    await authenticatedPage.locator("#stockListStatus").selectOption("zero");
    await expect(group).toContainText(master.children[1].sku);
    await expect(group).not.toContainText(master.children[0].sku);
    await expect(group).not.toHaveAttribute("open", "");
    await group.locator("summary").click();
    await expect(group).toContainText(master.children[1].sku);
  });
});
