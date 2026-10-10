import { expect } from "@playwright/test";
import { test } from "../fixtures/playwright.fixture.mjs";
import { InventoryPage } from "../pages/inventory.page.mjs";
import { PlatformOrdersPage } from "../pages/platform-orders.page.mjs";

test.describe("Sale SKU and platform order journeys", () => {
  test("creates and edits a Sale SKU bundle, and rejects duplicate components", async ({ authenticatedPage, localApp }, testInfo) => {
    const inventory = new InventoryPage(authenticatedPage, localApp);
    const platform = new PlatformOrdersPage(authenticatedPage, localApp);
    const master = await inventory.createMaster({ suffix: `${testInfo.workerIndex}-${Date.now()}`, childCount: 2 });
    const bundleCode = `E2E-BUNDLE-${Date.now()}`;

    const created = await platform.createBundle({
      saleSku: bundleCode,
      displayName: "E2E bundle",
      components: [
        { stockSkuId: master.children[0].id, quantity: "1" },
        { stockSkuId: master.children[1].id, quantity: "2" },
      ],
    });
    expect(created).toMatchObject({ saleSku: bundleCode, components: expect.arrayContaining([
      expect.objectContaining({ stockSkuId: master.children[0].id, quantity: 1 }),
      expect.objectContaining({ stockSkuId: master.children[1].id, quantity: 2 }),
    ]) });

    await platform.editBundle(created.id, { displayName: "E2E bundle edited", components: [{ stockSkuId: master.children[0].id, quantity: "3" }] });
    const edited = await platform.getBundle(created.id);
    expect(edited).toMatchObject({ displayName: "E2E bundle edited", components: [{ stockSkuId: master.children[0].id, quantity: 3 }] });

    await platform.expectDuplicateComponentValidation({ saleSku: `E2E-DUP-${Date.now()}`, component: master.children[0].id });
    await platform.openSaleSkus();
    await expect(authenticatedPage.locator("#saleSkuRows")).toContainText(bundleCode);
    await expect(authenticatedPage.locator("#saleSkuRows")).toContainText("E2E bundle edited");
  });

  test("reviews issue categories, preserves reservations, posts deductions idempotently, and hands orders to shipment", async ({ authenticatedPage, localApp }, testInfo) => {
    const inventory = new InventoryPage(authenticatedPage, localApp);
    const platform = new PlatformOrdersPage(authenticatedPage, localApp);
    const master = await inventory.createMaster({ suffix: `${testInfo.workerIndex}-${Date.now()}`, childCount: 1 });
    await inventory.receivePurchaseIn({ stockSkuId: master.children[0].id, quantity: "5", unitCost: "100", referenceType: "manual", referenceNo: `PLATFORM-${Date.now()}` });
    const saleSku = await platform.createBundle({
      saleSku: `E2E-POST-${Date.now()}`,
      displayName: "E2E post bundle",
      components: [{ stockSkuId: master.children[0].id, quantity: "1" }],
    });

    await platform.openPlatformOrders();
    const issueImport = await platform.importFile({
      platform: "shopee",
      fileName: "issues.csv",
      contents: [
        "order_no,sale_sku,quantity,status",
        "E2E-MISSING-1,NOT-MAPPED,1,paid",
        "E2E-BAD-QTY-1,NOT-MAPPED,abc,paid",
        "E2E-CANCELLED-1,NOT-MAPPED,1,cancelled",
      ].join("\n"),
    });
    expect(issueImport.import).toMatchObject({ status: "has_issues", issueCount: 2 });
    await platform.expectSelectedIssueCategories(["missing_sale_sku", "invalid_quantity", "skipped_status"]);
    await expect(authenticatedPage.locator('#platformOrderDetail a[href="/sale-skus"]')).toHaveCount(1);

    const orderNo = `E2E-POST-${Date.now()}`;
    const readyImport = await platform.importFile({
      platform: "shopee",
      fileName: "ready.csv",
      contents: ["order_no,sale_sku,quantity,status", `${orderNo},${saleSku.saleSku},2,paid`].join("\n"),
    });
    expect(readyImport.import).toMatchObject({ status: "ready", matchedLineCount: 1, issueCount: 0 });
    expect((await inventory.balance(master.children[0].id)).reservedQuantity).toBe(2);

    await platform.postSelectedImport();
    const posted = await platform.getImport(readyImport.import.id);
    expect(posted.import.status).toBe("posted");
    expect((await inventory.balance(master.children[0].id)).quantityOnHand).toBe(3);
    expect((await inventory.balance(master.children[0].id)).reservedQuantity).toBe(0);

    const movementsBefore = (await inventory.stockCard(master.children[0].id)).movements.filter((movement) => movement.referenceType === "platform_order");
    const repeated = await platform.postImport(readyImport.import.id);
    expect(repeated.import.status).toBe("posted");
    const movementsAfter = (await inventory.stockCard(master.children[0].id)).movements.filter((movement) => movement.referenceType === "platform_order");
    expect(movementsAfter).toHaveLength(movementsBefore.length);
    expect(movementsAfter[0]).toMatchObject({ quantity: 2, movementType: "sale_out" });

    const handoff = await platform.openShipmentHandoff({ shopId: `e2e-shop-${Date.now()}`, orderNo: `E2E-SHIP-${Date.now()}`, stockSkuId: master.children[0].id });
    expect(handoff).toContain("/shopee-shipment");
  });
});
