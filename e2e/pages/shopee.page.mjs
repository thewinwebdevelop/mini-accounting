import { expect } from "@playwright/test";

async function json(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok()) throw new Error(`${response.status()} ${body.error || response.url()}`);
  return body;
}

export class ShopeePage {
  constructor(page) { this.page = page; }

  async api(route, options = {}) { return json(await this.page.request.fetch(route, options)); }

  async openConnection(shopId) {
    await this.page.goto(`/shopee-connection?shopId=${encodeURIComponent(shopId)}`);
    await expect(this.page.locator("#shopeeShopId")).toHaveValue(shopId);
  }

  async connect() {
    await this.page.locator("#shopeeConnectButton").click();
    await expect.poll(() => new URL(this.page.url()).pathname).toBe("/shopee-connection");
    return new URL(this.page.url());
  }

  async sync(shopId) {
    await this.page.locator("#syncShopeeOrdersButton").click();
    await expect(this.page.locator("#shopeeConnectionStatus")).toContainText("Sync orders สำเร็จ");
    return this.api(`/api/platform-orders?shopId=${encodeURIComponent(shopId)}`);
  }

  async openOrders(shopId) {
    await this.page.goto(`/shopee-orders?shopId=${encodeURIComponent(shopId)}`);
    await expect(this.page.locator("#shopeeOrderRows")).toBeVisible();
  }

  async openMapping(shopId, orderIds) {
    await this.page.goto(`/shopee-mapping?shopId=${encodeURIComponent(shopId)}&orderIds=${encodeURIComponent(orderIds.join(","))}`);
    await expect(this.page.locator("#shopeeMappingContent [data-shopee-mapping]")).toHaveCount(1);
  }

  async editAndClearMapping(stockSkuId) {
    const select = this.page.locator("#shopeeMappingContent [data-shopee-mapping]").first();
    await select.selectOption(String(stockSkuId));
    await expect(this.page.locator("#shopeeMappingStatus")).toContainText("บันทึก mapping แล้ว");
    await select.selectOption("");
    await expect(this.page.locator("#shopeeMappingStatus")).toContainText("บันทึก mapping แล้ว");
    await this.page.reload();
    await expect(this.page.locator("#shopeeMappingContent [data-shopee-mapping]").first()).toHaveValue("");
    await select.selectOption(String(stockSkuId));
    await expect(this.page.locator("#shopeeMappingStatus")).toContainText("บันทึก mapping แล้ว");
  }

  async selectOrders(orderIds) {
    for (const id of orderIds) await this.page.locator(`[data-shopee-order="${id}"]`).check();
  }

  async saveMapping(lineId, stockSkuId) {
    await this.page.locator(`[data-shopee-detail]`).first().click();
    const select = this.page.locator(`[data-shopee-mapping="${lineId}"]`);
    await select.selectOption(stockSkuId ? String(stockSkuId) : "");
    await expect(this.page.locator("#shopeeOrderStatus")).toContainText("mapping");
  }

  async openShipment(shopId, orderIds) {
    await this.page.goto(`/shopee-shipment?shopId=${encodeURIComponent(shopId)}&orderIds=${encodeURIComponent(orderIds.join(","))}`);
    await expect(this.page.locator("#shopeeShipmentOrders")).toBeVisible();
  }

  async loadAndPrepare() {
    await this.page.locator("#loadShopeeShipmentOrdersButton").click();
    await expect(this.page.locator("#shopeeShipmentOrders")).toContainText("orders:");
    await this.page.locator("#prepareShopeeShipmentButton").click();
    await expect(this.page.locator("#shopeeBatchChoices .shopee-batch")).toHaveCount(1);
    const batchText = await this.page.locator("#shopeeBatchChoices .shopee-batch strong").innerText();
    this.batchId = Number(batchText.match(/Batch #(\d+)/)?.[1] || 0);
    expect(this.batchId).toBeGreaterThan(0);
  }

  async chooseFirstPickup() {
    const batch = this.page.locator("#shopeeBatchChoices .shopee-batch").first();
    await batch.locator("[data-batch-address]").selectOption({ index: 1 });
    await batch.locator("[data-batch-time]").selectOption({ index: 1 });
  }

  async arrangeRefreshAndLabels() {
    await this.page.locator("#arrangeShopeeShipmentButton").click();
    await expect(this.page.locator("#shopeeBatchStatus")).toContainText("นัดรับ");
    await this.page.locator("#refreshShopeeTrackingButton").click();
    await this.page.locator("#createShopeeDocumentsButton").click();
    await expect(this.page.locator("#shopeeBatchStatus")).toHaveText("ส่งคำขอใบปะหน้าแล้ว");
    await this.page.locator("#overlayShopeeLabelsButton").click();
    await expect(this.page.locator("#shopeeBatchChoices a[href*='/api/shopee/']")).toHaveCount(1);
    await expect(this.page.locator("#printShopeeLabelsButton")).toBeEnabled();
  }

  async persistedLabelArtifacts(shopId) {
    const jobResponse = await this.api(`/api/shopee/shipment-batches/${this.batchId}/create-documents`, { method: "POST", data: { connectionId: shopId } });
    const job = jobResponse.job;
    expect(job).toMatchObject({ status: "ready" });
    expect(job.downloadUrl).toContain(`/api/shopee/shipping-document-jobs/${job.id}/download`);
    const source = await this.page.request.get(new URL(job.downloadUrl, this.page.url()).toString());
    expect(source.status()).toBe(200);
    expect((await source.body()).subarray(0, 4).toString()).toBe("%PDF");
    const label = await this.page.request.get(`/api/shopee/shipment-batches/${this.batchId}/print-preview`);
    expect(label.status()).toBe(200);
    expect((await label.body()).subarray(0, 4).toString()).toBe("%PDF");
    return { job, label };
  }
}
