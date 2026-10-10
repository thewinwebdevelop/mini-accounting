import { expect } from "@playwright/test";
import { test } from "../fixtures/playwright.fixture.mjs";
import { InventoryPage } from "../pages/inventory.page.mjs";

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

  test("records purchase-in, exposes balance/card/dashboard/report/PDF, and reverses once", async ({ authenticatedPage, localApp }, testInfo) => {
    const inventory = new InventoryPage(authenticatedPage, localApp);
    const master = await inventory.createMaster({ suffix: `${testInfo.workerIndex}-${Date.now()}`, childCount: 1 });
    const referenceNo = `SR-2026-10-${String(Date.now()).slice(-4)}`;
    await inventory.receivePurchaseIn({ stockSkuId: master.children[0].id, quantity: "8", unitCost: "125", referenceType: "substitute_receipt", referenceNo });

    const before = await inventory.balance(master.children[0].id);
    expect(before).toMatchObject({ sku: master.children[0].sku, quantityOnHand: 8, averageUnitCost: "125.00", inventoryValue: "1000.00" });

    await inventory.openLedger(master.children[0].id);
    await expect(authenticatedPage.locator("#stockCardRows")).toContainText(referenceNo);
    await expect(authenticatedPage.locator("#stockCardRows")).toContainText("8");
    const dashboard = await inventory.dashboard();
    expect(dashboard.summary).toMatchObject({ totalQuantityOnHand: 8, totalInventoryValue: "1000.00" });
    await inventory.openDashboardReport();
    await expect(authenticatedPage.locator("#stockInRows")).toContainText(referenceNo);
    const pdf = await inventory.currentStockPdf();
    expect(pdf.contentType).toContain("application/pdf");
    expect(pdf.body.subarray(0, 4).toString("utf8")).toBe("%PDF");

    const card = await inventory.stockCard(master.children[0].id);
    const original = card.movements.find((movement) => movement.referenceNo === referenceNo);
    const firstReversal = await inventory.reversePurchaseIn({ referenceNo, originalMovementId: original.id });
    expect(firstReversal.status).toBe("reversed");
    const repeatedReversal = await inventory.reversePurchaseIn({ referenceNo, originalMovementId: original.id });
    expect(repeatedReversal.status).toBe("already_reversed");

    const after = await inventory.balance(master.children[0].id);
    expect(after).toMatchObject({ quantityOnHand: 0, inventoryValue: "0.00" });
    const reversedCard = await inventory.stockCard(master.children[0].id);
    expect(reversedCard.movements.map((movement) => movement.movementType)).toEqual(["purchase_in", "adjustment_out"]);
  });

  test("supports search/category/status filters and parent/all-SKU grouped views", async ({ authenticatedPage, localApp }, testInfo) => {
    const inventory = new InventoryPage(authenticatedPage, localApp);
    const master = await inventory.createMaster({ suffix: `${testInfo.workerIndex}-${Date.now()}`, childCount: 2 });
    await inventory.openStockList(master.product.productCode);
    await expect(authenticatedPage.locator("#stockListCount")).toHaveText("1");
    await expect(authenticatedPage.locator("#parentStockRows")).toContainText(master.product.productCode);
    await expect(authenticatedPage.locator("#parentStockRows")).toContainText(master.category.name);

    await authenticatedPage.locator("#stockListCategory").selectOption({ label: master.category.name });
    await expect(authenticatedPage.locator("#stockListCount")).toHaveText("1");
    await authenticatedPage.locator("#stockListMode").selectOption("all");
    await expect(authenticatedPage.locator("#allStockPanel")).toBeVisible();
    const group = authenticatedPage.locator("#stockGroupRows .stock-group").filter({ hasText: master.product.productCode });
    await expect(group).toHaveCount(1);
    await expect(group).not.toHaveAttribute("open", "");
    await group.locator("summary").click();
    await expect(group).toContainText(master.children[0].sku);
    await expect(group).toContainText(master.children[1].sku);
  });
});
