import { expect } from "@playwright/test";

export class LineIntakePage {
  constructor(page) { this.page = page; }

  async open(intakeId) {
    await this.page.goto(`/line-intake?intakeId=${encodeURIComponent(intakeId)}`);
    await expect(this.page.locator("[data-details]")).toBeVisible();
  }

  async edit(values) {
    for (const [name, value] of Object.entries(values)) await this.page.locator(`[name="${name}"]`).fill(String(value));
  }

  async confirm() {
    await this.page.locator("[data-confirm-form]").evaluate((form) => form.requestSubmit());
    await expect(this.page.locator("[data-status]")).toContainText("สร้างแบบร่าง");
  }

  async cancel() {
    await this.page.locator("[data-cancel]").click();
    await expect(this.page.locator("[data-status]")).toContainText("ยกเลิกรายการแล้ว");
  }
}
