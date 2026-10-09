import { expect } from "@playwright/test";
import { test } from "../fixtures/playwright.fixture.mjs";
import { LoginPage } from "../pages/login.page.mjs";
import { NavigationPage } from "../pages/navigation.page.mjs";
import { createTestSession, sessionCookie } from "../fixtures/auth.fixture.mjs";

const SECRET = "e2e-test-session-secret-012345678901234567890123";

test("actual LIFF bootstrap creates a session and honors internal returnTo", async ({ anonymousPage, localApp }) => {
  await anonymousPage.goto(`${localApp.baseUrl}line-auth?returnTo=%2Fexpense-requests`, { waitUntil: "commit" });
  await anonymousPage.waitForFunction(() => Boolean(window.SweetHouseAuth));
  const session = await fetch(`${localApp.baseUrl}api/auth/line-session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: "fixture-token-employee-a" }) });
  expect(session.status).toBe(200);
  expect(await anonymousPage.evaluate(() => window.SweetHouseAuth.safeReturnPath())).toBe("/expense-requests");
  const externalPage = await anonymousPage.context().newPage();
  const externalRequests = [];
  externalPage.on("request", request => { if (request.url().startsWith("https://evil.example")) externalRequests.push(request.url()); });
  await externalPage.goto(`${localApp.baseUrl}line-auth?returnTo=%2F%2Fevil.example%2Fsteal`, { waitUntil: "commit" });
  await externalPage.waitForFunction(() => Boolean(window.SweetHouseAuth));
  expect(await externalPage.evaluate(() => window.SweetHouseAuth.safeReturnPath())).toBe("/");
  expect(externalRequests).toEqual([]);
  await externalPage.close();
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
