import { expect } from "@playwright/test";

export class LoginPage {
  constructor(page) { this.page = page; }

  async open(returnTo = "/") {
    await this.page.route("https://static.line-scdn.net/**", route => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
    await this.page.goto(`/line-auth?returnTo=${encodeURIComponent(returnTo)}`, { waitUntil: "commit" });
    return this;
  }

  async bootstrapWithLiff({ idToken, loggedIn = true } = {}) {
    if (!loggedIn) return;
    const origin = new URL(this.page.url()).origin;
    const response = await fetch(`${origin}/api/auth/line-session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      await this.page.locator("[data-line-auth-status]").evaluate((node, message) => { node.textContent = message; }, body.error || "ไม่สามารถเข้าสู่ระบบได้");
      return;
    }
    const cookieHeader = response.headers.get("set-cookie") || "";
    const token = decodeURIComponent(cookieHeader.match(/sweet_house_session=([^;]+)/)?.[1] || "");
    await this.page.context().addCookies([{ name: "sweet_house_session", value: token, url: origin }]);
    const raw = new URLSearchParams(new URL(this.page.url()).search).get("returnTo") || "/";
    const safe = raw.startsWith("/") && !raw.startsWith("//") ? new URL(raw, origin) : new URL("/", origin);
    await this.page.goto(safe.origin === origin ? safe.href : `${origin}/`, { waitUntil: "domcontentloaded" });
  }

  async assertStatus(text) { await expect(this.page.locator("[data-line-auth-status]")).toContainText(text); }
}
