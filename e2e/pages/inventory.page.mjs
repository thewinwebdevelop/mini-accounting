import { expect } from "@playwright/test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { reversePurchaseInMovementsByReference } = require("../../forms/inventory.logic.js");

async function json(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok()) throw new Error(`${response.status()} ${body.error || response.url()}`);
  return body;
}

export class InventoryPage {
  constructor(page, localApp) {
    this.page = page;
    this.localApp = localApp;
  }

  async api(route, options = {}) {
    return json(await this.page.request.fetch(route, options));
  }

  async createCategory(name) {
    await this.page.goto("/inventory-settings");
    await expect(this.page.locator("#categoryForm")).toBeVisible();
    await this.page.locator("#categoryName").fill(name);
    await this.page.locator("#categorySortOrder").fill("10");
    await this.page.locator("#categoryForm").evaluate((form) => form.requestSubmit());
    await expect(this.page.locator("#categoryStatusBox")).toContainText("บันทึกหมวดสินค้าแล้ว");
    const { categories } = await this.api("/api/inventory/categories?includeInactive=1");
    return categories.find((category) => category.name === name);
  }

  async createProduct({ productCode, name, category }) {
    await this.page.goto("/inventory");
    await expect(this.page.locator("#productForm")).toBeVisible();
    await expect(this.page.locator(`#productCategory option[value="${category}"]`)).toHaveCount(1);
    await this.page.locator("#productCode").fill(productCode);
    await this.page.locator("#productName").fill(name);
    await this.page.locator("#productCategory").selectOption({ label: category });
    await this.page.locator("#productDescription").fill("E2E inventory product");
    await this.page.locator("#productForm").evaluate((form) => form.requestSubmit());
    await expect(this.page.locator("#inventoryStatus")).toContainText("บันทึกสินค้าแม่แล้ว");
    const { products } = await this.api(`/api/inventory/products?search=${encodeURIComponent(productCode)}`);
    return products.find((product) => product.productCode === productCode);
  }

  async createSku({ productId, sku, color = "", size = "", defaultUnitCost = "100" }) {
    await this.page.goto("/inventory");
    await expect(this.page.locator("#skuForm")).toBeVisible();
    await expect(this.page.locator(`#skuProductSelect option[value="${productId}"]`)).toHaveCount(1);
    await this.page.locator("#skuProductSelect").selectOption(String(productId));
    await this.page.locator("#skuCode").fill(sku);
    await this.page.locator("#skuColor").fill(color);
    await this.page.locator("#skuSize").fill(size);
    await this.page.locator("#skuDefaultCost").fill(defaultUnitCost);
    await this.page.locator("#skuForm").evaluate((form) => form.requestSubmit());
    await expect(this.page.locator("#inventoryStatus")).toContainText("บันทึก SKU แล้ว");
    const { stockSkus } = await this.api(`/api/inventory/stock-skus?search=${encodeURIComponent(sku)}`);
    return stockSkus.find((stockSku) => stockSku.sku === sku);
  }

  async createMaster({ suffix, childCount = 1 }) {
    const category = await this.createCategory(`E2E Category ${suffix}`);
    const product = await this.createProduct({
      productCode: `E2E-PRODUCT-${suffix}`,
      name: `E2E product ${suffix}`,
      category: category.name,
    });
    const children = [];
    for (let index = 0; index < childCount; index += 1) {
      children.push(await this.createSku({
        productId: product.id,
        sku: `E2E-SKU-${suffix}-${index + 1}`,
        color: index === 0 ? "black" : "white",
        size: index === 0 ? "M" : "L",
        defaultUnitCost: String(100 + index * 25),
      }));
    }
    return { category, product, children };
  }

  async expectDuplicateCategory(name) {
    await this.page.goto("/inventory-settings");
    await this.page.locator("#categoryName").fill(name);
    await this.page.locator("#categoryForm").evaluate((form) => form.requestSubmit());
    await expect(this.page.locator("#categoryStatusBox")).toContainText("หมวดนี้มีอยู่แล้ว");
  }

  async expectDuplicateSku(sku) {
    const { stockSkus } = await this.api(`/api/inventory/stock-skus?search=${encodeURIComponent(sku)}`);
    const existing = stockSkus.find((stockSku) => stockSku.sku === sku);
    await this.page.goto("/inventory");
    await this.page.locator("#skuProductSelect").selectOption(String(existing.productId));
    await this.page.locator("#skuCode").fill(sku);
    await this.page.locator("#skuDefaultCost").fill(existing.defaultUnitCost);
    await this.page.locator("#skuForm").evaluate((form) => form.requestSubmit());
    await expect(this.page.locator("#inventoryStatus")).toContainText("SKU นี้มีอยู่แล้ว");
  }

  async setSkuInactive(productId, stockSkuId) {
    await this.page.goto(`/inventory-product-detail?productId=${encodeURIComponent(productId)}`);
    await expect(this.page.locator(`#skuDetailRows [data-sku-form="${stockSkuId}"]`)).toBeVisible();
    const form = this.page.locator(`#skuDetailRows [data-sku-form="${stockSkuId}"]`);
    await form.locator('[name="status"]').selectOption("inactive");
    await form.locator('button[type="submit"]').click();
    await expect(this.page.locator("#productDetailStatus")).toContainText("บันทึก SKU แล้ว");
  }

  async uploadImages(productId, stockSkuId) {
    await this.page.goto(`/inventory-product-detail?productId=${encodeURIComponent(productId)}`);
    await expect(this.page.locator(`#skuDetailRows [data-sku-form="${stockSkuId}"]`)).toBeVisible();
    await this.page.locator("#productImageInput").setInputFiles({ name: "product.png", mimeType: "image/png", buffer: Buffer.from("e2e-product-image") });
    await this.page.locator("#productImageForm").evaluate((form) => form.requestSubmit());
    await expect(this.page.locator("#productDetailStatus")).toContainText("อัปโหลดรูปสินค้าแม่แล้ว");
    const skuForm = this.page.locator(`#skuDetailRows [data-sku-form="${stockSkuId}"]`);
    await skuForm.locator('input[type="file"][name="image"]').setInputFiles({ name: "sku.jpg", mimeType: "image/jpeg", buffer: Buffer.from("e2e-sku-image") });
    await skuForm.locator(`[data-sku-image-upload="${stockSkuId}"]`).click();
    await expect(this.page.locator("#productDetailStatus")).toContainText("อัปโหลดรูป SKU แล้ว");
  }

  async reloadDetail(productId) {
    await this.page.goto(`/inventory-product-detail?productId=${encodeURIComponent(productId)}`);
    await expect(this.page.locator("#productSummary")).toBeVisible();
    return (await this.api(`/api/inventory/products/${encodeURIComponent(productId)}/detail`));
  }

  async openPurchaseIn() {
    await this.page.goto("/inventory-purchase-in");
    await expect(this.page.locator("#purchaseInForm")).toBeVisible();
  }

  async receivePurchaseIn({ stockSkuId, quantity, unitCost, referenceType = "manual", referenceNo = "" }) {
    await this.openPurchaseIn();
    await expect(this.page.locator(`#purchaseSkuSelect option[value="${stockSkuId}"]`)).toHaveCount(1);
    await this.page.locator("#purchaseSkuSelect").selectOption(String(stockSkuId));
    await this.page.locator("#movementDate").fill("2026-10-10");
    await this.page.locator("#quantity").fill(String(quantity));
    await this.page.locator("#unitCost").fill(String(unitCost));
    await this.page.locator("#referenceType").fill(referenceType);
    await this.page.locator("#referenceNo").fill(referenceNo);
    await this.page.locator("#purchaseInForm").evaluate((form) => form.requestSubmit());
    await expect(this.page.locator("#inventoryPurchaseInStatus")).toContainText("รับสินค้าเข้าคลังแล้ว");
  }

  async balance(stockSkuId) {
    const { balances } = await this.api("/api/inventory/balances");
    return balances.find((balance) => String(balance.id) === String(stockSkuId));
  }

  async stockCard(stockSkuId) {
    return this.api(`/api/inventory/stock-card?stockSkuId=${encodeURIComponent(stockSkuId)}`);
  }

  async openLedger(stockSkuId) {
    await this.page.goto("/inventory-ledger");
    await expect(this.page.locator("#balanceRows")).toBeVisible();
    if (stockSkuId) {
      await expect(this.page.locator(`#stockCardSkuSelect option[value="${stockSkuId}"]`)).toHaveCount(1);
      await this.page.locator("#stockCardSkuSelect").selectOption(String(stockSkuId));
      await expect(this.page.locator("#stockCardRows")).toBeVisible();
    }
  }

  async dashboard() {
    await this.page.goto("/inventory-dashboard");
    await expect(this.page.locator("#totalInventoryValue")).toBeVisible();
    return this.api("/api/inventory/dashboard");
  }

  async openDashboardReport() {
    await expect(this.page.locator("#seeMoreStockIn")).toBeVisible();
    await this.page.locator("#seeMoreStockIn").click();
    await expect(this.page.locator("#fullReportPanel")).toBeVisible();
  }

  async currentStockPdf() {
    return this.page.request.get("/api/inventory/current-stock-pdf").then(async (response) => ({
      contentType: response.headers()["content-type"] || "",
      body: Buffer.from(await response.body()),
    }));
  }

  async reversePurchaseIn({ referenceNo, originalMovementId }) {
    return reversePurchaseInMovementsByReference({
      rootDir: this.localApp.rootDir,
      referenceType: "substitute_receipt",
      referenceNo,
      expectedOriginalMovementIds: [originalMovementId],
      reversalDate: "2026-10-10",
      cancellationReference: `workflow_transaction:TXN-2026-10-${referenceNo.slice(-4)}`,
    });
  }

  async openStockList(search = "") {
    await this.page.goto("/inventory-stock-list");
    await expect(this.page.locator("#parentStockPanel")).toBeVisible();
    if (search) {
      await this.page.locator("#stockListSearch").fill(search);
      await expect(this.page.locator("#parentStockRows")).toContainText(search);
    }
  }
}
