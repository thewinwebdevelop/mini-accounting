import { expect } from "@playwright/test";

export class SettingsPage {
  constructor(page) { this.page = page; }

  async saveCompany(values) {
    await this.page.goto("/company-settings");
    for (const [name, value] of Object.entries(values)) await this.page.locator(`[name="${name}"]`).fill(value);
    await this.page.locator("#companySettingsForm").evaluate((form) => form.requestSubmit());
    await expect(this.page.locator("#message")).toContainText("บันทึกข้อมูลบริษัทแล้ว");
    return this.page.request.get("/api/company-settings").then((response) => response.json());
  }

  async saveDrive(values) {
    await this.page.goto("/google-drive");
    await this.page.locator("#clientId").fill(values.clientId);
    if (values.clientSecret !== undefined) await this.page.locator("#clientSecret").fill(values.clientSecret);
    await this.page.locator("#driveBasePath").fill(values.driveBasePath);
    await this.page.locator("#configForm").evaluate((form) => form.requestSubmit());
    await expect(this.page.locator("#message")).toContainText("บันทึกการตั้งค่าแล้ว");
    return this.page.request.get("/api/google-drive/status").then((response) => response.json());
  }
}
