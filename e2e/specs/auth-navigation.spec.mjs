import { expect } from "@playwright/test";
import { test } from "../fixtures/playwright.fixture.mjs";
import { LoginPage } from "../pages/login.page.mjs";
import { NavigationPage } from "../pages/navigation.page.mjs";
import { createTestSession, sessionCookie } from "../fixtures/auth.fixture.mjs";

const SECRET = "e2e-test-session-secret-012345678901234567890123";

test("actual LIFF bootstrap installs a session and navigates only to safe internal returnTo", async ({ browser, localApp }) => {
  const context = await browser.newContext({ baseURL: localApp.baseUrl });
  const page = await context.newPage();
  await page.route("https://static.line-scdn.net/**", route => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
  await page.addInitScript(() => {
    window.liff = { init: async () => {}, isLoggedIn: () => true, getIDToken: () => "fixture-token-employee-a", login: () => {} };
  });
  await page.goto("/line-auth?returnTo=%2Fexpense-requests", { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/expense-requests$/, { timeout: 10000 });
  const cookies = await context.cookies();
  expect(cookies.find(cookie => cookie.name === "sweet_house_session")?.value).toMatch(/\S+/);
  expect(await page.evaluate(() => fetch("/api/auth/me").then(response => response.json()))).toMatchObject({ authenticated: true, user: { userId: "employee-a" } });
  await context.close();

  const externalContext = await browser.newContext({ baseURL: localApp.baseUrl });
  const externalPage = await externalContext.newPage();
  const externalRequests = [];
  externalPage.on("request", request => { if (request.url().startsWith("https://evil.example")) externalRequests.push(request.url()); });
  await externalPage.route("https://static.line-scdn.net/**", route => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
  await externalPage.addInitScript(() => {
    window.liff = { init: async () => {}, isLoggedIn: () => true, getIDToken: () => "fixture-token-employee-a", login: () => {} };
  });
  await externalPage.goto("/line-auth?returnTo=%2F%2Fevil.example%2Fsteal", { waitUntil: "domcontentloaded" });
  await externalPage.waitForURL(/127\.0\.0\.1/, { timeout: 10000 });
  expect(externalRequests).toEqual([]);
  await externalContext.close();
});

test("pending and inactive users are denied while active users can logout", async ({ browser, anonymousPage, localApp }) => {
  const pending = await fetch(`${localApp.baseUrl}api/auth/line-session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: "fixture-token-pending" }) });
  expect(pending.status).toBe(403);
  const context = await browser.newContext();
  const page = await context.newPage();
  const inactive = await fetch(`${localApp.baseUrl}api/auth/line-session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: "fixture-token-inactive" }) });
  expect(inactive.status).toBe(403);
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
    const navigation = new NavigationPage(page);
    await navigation.assertMenuFor(role);
    await navigation.assertRoleApiBoundary(role);
    await context.close();
  }
});
