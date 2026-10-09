import { expect } from "@playwright/test";
import { test } from "../fixtures/playwright.fixture.mjs";
import { NavigationPage } from "../pages/navigation.page.mjs";
import { createTestSession, sessionCookie } from "../fixtures/auth.fixture.mjs";

const SECRET = "e2e-test-session-secret-012345678901234567890123";

test("LIFF bootstrap creates a session and returns only to an internal path", async ({ browser, localApp }) => {
  const response = await fetch(`${localApp.baseUrl}api/auth/line-session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: "fixture-token-employee-a" }) });
  expect(response.status).toBe(200);
  const token = decodeURIComponent((response.headers.get("set-cookie") || "").match(/sweet_house_session=([^;]+)/)?.[1] || "");
  const context = await browser.newContext();
  await context.addCookies([{ name: "sweet_house_session", value: token, url: localApp.baseUrl }]);
  const anonymousPage = await context.newPage();
  await anonymousPage.goto(`${localApp.baseUrl}expense-requests`, { waitUntil: "commit" });
  await expect(anonymousPage).toHaveURL(/\/expense-requests$/);
  await expect(anonymousPage.evaluate(() => fetch("/api/auth/me").then(response => response.json()))).resolves.toMatchObject({ authenticated: true, user: { userId: "employee-a" } });
  await context.close();
});

test("pending and inactive users are denied while active users can logout", async ({ browser, localApp }) => {
  const pending = await fetch(`${localApp.baseUrl}api/auth/line-session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: "fixture-token-pending" }) });
  expect(pending.status).toBe(403);
  const context = await browser.newContext();
  const page = await context.newPage();
  const response = await page.request.post(`${localApp.baseUrl}api/auth/line-session`, { data: { idToken: "fixture-token-inactive" } });
  expect(response.status()).toBe(403);
  await context.close();

  const activeContext = await browser.newContext();
  await activeContext.addCookies([{ ...sessionCookie(createTestSession({ ...localApp.users.employeeA, secret: SECRET })), url: localApp.baseUrl }]);
  const activePage = await activeContext.newPage();
  await activePage.goto(localApp.baseUrl);
  await new NavigationPage(activePage).logout();
  expect(await activePage.evaluate(() => fetch("/api/auth/me").then(response => response.status))).toBe(401);
  await activeContext.close();
});

test("role navigation shells are available for employee, owner, accounting and admin", async ({ browser, localApp }) => {
  for (const role of ["employee", "owner", "accounting", "admin"]) {
    const context = await browser.newContext();
    const user = localApp.users[role === "employee" ? "employeeA" : role];
    const { createTestSession, sessionCookie } = await import("../fixtures/auth.fixture.mjs");
    await context.addCookies([{ ...sessionCookie(createTestSession({ ...user, secret: SECRET })), url: localApp.baseUrl }]);
    const page = await context.newPage();
    await page.goto(localApp.baseUrl);
    await new NavigationPage(page).assertMenuFor(role);
    await context.close();
  }
});
