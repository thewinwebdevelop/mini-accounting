import { expect } from "@playwright/test";

export class NavigationPage {
  constructor(page, baseUrl = "") { this.page = page; this.baseUrl = baseUrl; }

  async open(path) { return this.page.goto(path); }

  async logout() {
    const response = await this.page.request.post("/api/auth/logout");
    expect(response.ok()).toBeTruthy();
    return response;
  }

  async assertMenuFor(role) {
    await expect(this.page.locator("details.app-menu")).toHaveCount(1);
    const menu = this.page.locator("nav[aria-label='เมนูหลัก']");
    await this.page.locator("details.app-menu summary").click();
    await expect(menu).toBeVisible();
    if (role === "employee") await expect(menu.locator("a[href='/expense-request']")).toBeVisible();
    if (["owner", "admin"].includes(role)) await expect(menu.locator("a[href='/company-settings']")).toBeVisible();
  }

  async assertProtectedRouteDenied(path, expectedStatus = 401) {
    const response = await this.page.request.get(path);
    expect(response.status()).toBe(expectedStatus);
    return response;
  }
}
