import { expect } from "@playwright/test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { upsertShopeeOrder } = require("../../forms/platform-orders.logic.js");

async function json(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok()) throw new Error(`${response.status()} ${body.error || response.url()}`);
  return body;
}

export class PlatformOrdersPage {
  constructor(page, localApp) {
    this.page = page;
    this.localApp = localApp;
    this.selectedImportId = null;
  }

  async api(route, options = {}) {
    return json(await this.page.request.fetch(route, options));
  }

  async openSaleSkus() {
    await this.page.goto("/sale-skus");
    await expect(this.page.locator("#saleSkuForm")).toBeVisible();
    await expect(this.page.locator("#componentRows .component-row")).toHaveCount(1);
  }

  async fillComponent(row, component) {
    await expect(row.locator(`select[name="stockSkuId"] option[value="${component.stockSkuId}"]`)).toHaveCount(1);
    await row.locator('select[name="stockSkuId"]').selectOption(String(component.stockSkuId));
    await row.locator('input[name="quantity"]').fill(String(component.quantity));
  }

  async createBundle({ saleSku, displayName, components, platform = "shopee" }) {
    await this.openSaleSkus();
    await this.page.locator("#saleSkuCode").fill(saleSku);
    await this.page.locator("#saleDisplayName").fill(displayName);
    await this.page.locator("#salePlatform").selectOption(platform);
    const rows = this.page.locator("#componentRows .component-row");
    await this.fillComponent(rows.first(), components[0]);
    for (const component of components.slice(1)) {
      await this.page.locator("#addComponent").click();
      await this.fillComponent(rows.last(), component);
    }
    await this.page.locator("#saleSkuForm").evaluate((form) => form.requestSubmit());
    await expect(this.page.locator("#saleSkuStatus")).toContainText("บันทึก Sale SKU แล้ว");
    const { saleSkus } = await this.api(`/api/inventory/sale-skus?search=${encodeURIComponent(saleSku)}`);
    return saleSkus.find((item) => item.saleSku === saleSku);
  }

  async editBundle(id, { displayName, components }) {
    await this.openSaleSkus();
    await this.page.locator(`[data-edit-sale-sku="${id}"]`).click();
    await expect(this.page.locator("#saleSkuRecordId")).toHaveValue(String(id));
    await this.page.locator("#saleDisplayName").fill(displayName);
    const rows = this.page.locator("#componentRows .component-row");
    while (await rows.count() > components.length) await rows.last().locator("[data-remove-component]").click();
    while (await rows.count() < components.length) await this.page.locator("#addComponent").click();
    for (let index = 0; index < components.length; index += 1) await this.fillComponent(rows.nth(index), components[index]);
    await this.page.locator("#saleSkuForm").evaluate((form) => form.requestSubmit());
    await expect(this.page.locator("#saleSkuStatus")).toContainText("บันทึก Sale SKU แล้ว");
  }

  async getBundle(id) {
    return (await this.api(`/api/inventory/sale-skus/${encodeURIComponent(id)}`)).saleSku;
  }

  async expectDuplicateComponentValidation({ saleSku, component }) {
    await this.openSaleSkus();
    await this.page.locator("#saleSkuCode").fill(saleSku);
    await this.page.locator("#saleDisplayName").fill("Duplicate component bundle");
    const rows = this.page.locator("#componentRows .component-row");
    await this.fillComponent(rows.first(), { stockSkuId: component, quantity: "1" });
    await this.page.locator("#addComponent").click();
    await this.fillComponent(rows.last(), { stockSkuId: component, quantity: "1" });
    await this.page.locator("#saleSkuForm").evaluate((form) => form.requestSubmit());
    await expect(this.page.locator("#saleSkuStatus")).toContainText("Stock SKU component ซ้ำ");
    expect((await this.api(`/api/inventory/sale-skus?search=${encodeURIComponent(saleSku)}`)).saleSkus).toHaveLength(0);
  }

  async openPlatformOrders() {
    await this.page.goto("/platform-orders");
    await expect(this.page.locator("#platformOrderUploadForm")).toBeVisible();
    await expect(this.page.locator("#platformOrderImportRows")).toBeVisible();
  }

  async importFile({ platform = "shopee", fileName, contents }) {
    await expect(this.page.locator("#platformOrderFile")).toBeVisible();
    await this.page.locator("#platformOrderPlatform").selectOption(platform);
    await this.page.locator("#platformOrderFile").setInputFiles({ name: fileName, mimeType: fileName.endsWith(".tsv") ? "text/tab-separated-values" : "text/csv", buffer: Buffer.from(contents) });
    await this.page.locator("#platformOrderUploadForm").evaluate((form) => form.requestSubmit());
    await expect(this.page.locator("#platformOrderStatusBox")).toContainText("Import สำเร็จ");
    const { imports } = await this.api("/api/platform-orders/imports");
    const imported = imports.find((item) => item.fileName === fileName);
    if (!imported) throw new Error(`import ${fileName} was not persisted`);
    this.selectedImportId = imported.id;
    return this.getImport(imported.id);
  }

  async getImport(id) {
    return this.api(`/api/platform-orders/imports/${encodeURIComponent(id)}`);
  }

  async expectSelectedIssueCategories(categories) {
    await expect(this.page.locator("#platformOrderDetail .order-line")).toHaveCount(categories.length);
    await expect(this.page.locator("#platformOrderDetail .order-line .pill")).toHaveText(categories);
  }

  async postSelectedImport() {
    if (!this.selectedImportId) throw new Error("no platform import selected");
    await expect(this.page.locator("#postPlatformOrderImport")).toBeEnabled();
    await this.page.locator("#postPlatformOrderImport").click();
    await expect(this.page.locator("#platformOrderStatusBox")).toContainText("ตัดสต๊อกแล้ว");
    await expect(this.page.locator("#platformOrderDetail")).toContainText("ตัดสต๊อกแล้ว");
  }

  async postImport(id) {
    return this.api(`/api/platform-orders/imports/${encodeURIComponent(id)}/post`, { method: "POST" });
  }

  async openShipmentHandoff({ shopId, orderNo, stockSkuId }) {
    const order = upsertShopeeOrder(this.localApp.rootDir, {
      shopId,
      orderSn: orderNo,
      orderStatus: "READY_TO_SHIP",
      shippingStatus: "READY_TO_SHIP",
      items: [{ itemId: `${orderNo}-item`, modelId: `${orderNo}-model`, modelSku: `SHIP-${orderNo}`, itemName: "Shipment fixture", quantity: 1 }],
    });
    const page = this.page;
    await page.goto(`/shopee-orders?shopId=${encodeURIComponent(shopId)}`);
    await expect(page.locator("#shopeeOrderRows")).toContainText(orderNo);
    await page.locator(`[data-shopee-order="${order.order.id}"]`).check();
    await expect(page.locator("#openShopeeShipmentButton")).toBeEnabled();
    await page.locator("#openShopeeShipmentButton").click();
    await expect.poll(() => {
      const current = new URL(page.url());
      return current.pathname + current.search;
    }).toBe(`/shopee-shipment?shopId=${encodeURIComponent(shopId)}&orderIds=${order.order.id}`);
    return page.url();
  }
}
