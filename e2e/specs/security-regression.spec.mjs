import { expect } from "@playwright/test";
import { test } from "../fixtures/playwright.fixture.mjs";
import { createTestSession, sessionCookie } from "../fixtures/auth.fixture.mjs";
import { NavigationPage } from "../pages/navigation.page.mjs";

const SECRET = "e2e-test-session-secret-012345678901234567890123";

test("HTML remains a shell but protected API denies anonymous access", async ({ anonymousPage, localApp }) => {
  const html = await anonymousPage.goto(`${localApp.baseUrl}/expense-requests`);
  expect(html.status()).toBe(200);
  await new NavigationPage(anonymousPage).assertProtectedRouteDenied("/api/expense-requests");
});

test("tampered and expired sessions cannot read protected resources", async ({ browser, localApp }) => {
  const context = await browser.newContext();
  await context.addCookies([{ name: "sweet_house_session", value: "tampered.token", url: localApp.baseUrl }]);
  const page = await context.newPage();
  await page.goto(localApp.baseUrl);
  expect(await page.evaluate(() => fetch("/api/expense-requests").then(response => response.status))).toBe(401);
  await context.close();

  const expired = await browser.newContext();
  await expired.addCookies([{ ...sessionCookie(createTestSession({ ...localApp.users.employeeA, secret: SECRET, now: 1 - 3600 })), url: localApp.baseUrl }]);
  const expiredPage = await expired.newPage();
  await expiredPage.goto(localApp.baseUrl);
  expect(await expiredPage.evaluate(() => fetch("/api/expense-requests").then(response => response.status))).toBe(401);
  await expired.close();
});

test("employee A and B cannot cross-read or mutate documents", async ({ browser, localApp }) => {
  const a = await browser.newContext();
  await a.addCookies([{ ...sessionCookie(createTestSession({ ...localApp.users.employeeA, secret: SECRET })), url: localApp.baseUrl }]);
  const b = await browser.newContext();
  await b.addCookies([{ ...sessionCookie(createTestSession({ ...localApp.users.employeeB, secret: SECRET })), url: localApp.baseUrl }]);
  const aPage = await a.newPage();
  const bPage = await b.newPage();
  await aPage.goto(localApp.baseUrl);
  await bPage.goto(localApp.baseUrl);
  expect(await aPage.evaluate(() => fetch("/api/expense-requests").then(response => response.status))).toBe(200);
  const crossRead = await bPage.evaluate(() => fetch("/api/expense-requests/REQ-2026-10-0001").then(response => response.status));
  expect([403, 404]).toContain(crossRead);
  const mutation = await bPage.evaluate(() => fetch("/api/expense-requests/REQ-2026-10-0001/complete", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then(response => response.status));
  expect(mutation).toBe(403);
  await a.close(); await b.close();
});

test("unsafe return, traversal and expired file tokens are rejected", async ({ anonymousPage, localApp }) => {
  const login = new URL(`${localApp.baseUrl}/line-auth`);
  login.searchParams.set("returnTo", "//evil.example/steal");
  await anonymousPage.goto(login.toString());
  await expect(anonymousPage.locator("[data-line-auth-status]")).toBeVisible();
  expect((await anonymousPage.request.get(`${localApp.baseUrl}/../forms/index.html`)).status()).toBe(404);
  expect((await anonymousPage.request.get(`${localApp.baseUrl}/api/expense-requests/REQ-2026-10-0001/files/raw/file.pdf?fileToken=expired`)).status()).not.toBe(200);
});
