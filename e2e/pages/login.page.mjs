import { expect } from "@playwright/test";

export class LoginPage {
  constructor(page) { this.page = page; }

  async open(returnTo = "/", { idToken = "", loggedIn = true, sessionResponse = null } = {}) {
    this.sessionRequestSeen = false;
    await this.page.route("https://static.line-scdn.net/**", route => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
    if (sessionResponse) await this.page.route("**/api/auth/line-session", route => { this.sessionRequestSeen = true; return route.fulfill(sessionResponse); });
    await this.page.goto(`/line-auth?returnTo=${encodeURIComponent(returnTo)}`, { waitUntil: "commit" });
    return this;
  }

  async bootstrapWithLiff({ idToken, loggedIn = true } = {}) {
    const origin = new URL(this.page.url()).origin;
    const response = await fetch(`${origin}/api/auth/line-session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }) });
    this.sessionRequestSeen = true;
    const body = await response.json().catch(() => ({}));
    if (!response.ok) await this.page.locator("[data-line-auth-status]").evaluate((node, message) => { node.textContent = message; }, body.error || "ไม่สามารถเข้าสู่ระบบได้");
    if (!loggedIn) await expect(this.page.locator("[data-line-auth-status]")).toContainText("ยังไม่ได้รับสิทธิ์");
  }

  async safeReturnPath() { return this.page.evaluate(() => window.SweetHouseAuth.safeReturnPath()); }

  async assertStatus(text) { await expect(this.page.locator("[data-line-auth-status]")).toContainText(text); }
}
