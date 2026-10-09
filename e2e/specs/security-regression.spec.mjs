import { expect } from "@playwright/test";
import { test } from "../fixtures/playwright.fixture.mjs";
import { createTestSession, sessionCookie } from "../fixtures/auth.fixture.mjs";
import { issueFileAccessToken } from "../../forms/file-access.logic.js";
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

test("employee A and B cannot cross-read, download or mutate existing documents", async ({ browser, localApp, seed, anonymousPage }) => {
  const employeeARequest = seed.documents.find(document => document.ownerUserId === "employee-a");
  const employeeBRequest = seed.documents.find(document => document.ownerUserId === "employee-b");
  expect(employeeARequest?.documentNo).toBeTruthy();
  expect(employeeBRequest?.documentNo).toBeTruthy();
  const a = await browser.newContext();
  await a.addCookies([{ ...sessionCookie(createTestSession({ ...localApp.users.employeeA, secret: SECRET })), url: localApp.baseUrl }]);
  const b = await browser.newContext();
  await b.addCookies([{ ...sessionCookie(createTestSession({ ...localApp.users.employeeB, secret: SECRET })), url: localApp.baseUrl }]);
  const aPage = await a.newPage();
  const bPage = await b.newPage();
  await aPage.goto(localApp.baseUrl);
  await bPage.goto(localApp.baseUrl);
  const aList = await aPage.evaluate(() => fetch("/api/expense-requests").then(response => response.json()));
  const bList = await bPage.evaluate(() => fetch("/api/expense-requests").then(response => response.json()));
  expect(aList.requests.some(request => request.requestNo === employeeARequest.documentNo)).toBeTruthy();
  expect(bList.requests.some(request => request.requestNo === employeeBRequest.documentNo)).toBeTruthy();
  expect(bList.requests.some(request => request.requestNo === employeeARequest.documentNo)).toBeFalsy();
  const ownDetail = await aPage.evaluate(requestNo => fetch(`/api/expense-requests/${requestNo}`).then(async response => ({ status: response.status, body: await response.json() })), employeeARequest.documentNo);
  expect(ownDetail.status).toBe(200);
  const ownFilePath = ownDetail.body.pdfFiles[0].url.split("?")[0];
  expect(await aPage.evaluate(path => fetch(path).then(response => response.status), ownFilePath)).toBe(200);
  const crossRead = await bPage.evaluate(requestNo => fetch(`/api/expense-requests/${requestNo}`).then(response => response.status), employeeARequest.documentNo);
  expect(crossRead).toBe(403);
  const crossFile = await bPage.evaluate(path => fetch(path).then(response => response.status), ownFilePath);
  expect(crossFile).toBe(403);
  const mutation = await bPage.evaluate(requestNo => fetch(`/api/expense-requests/${requestNo}/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then(response => response.status), employeeARequest.documentNo);
  expect(mutation).toBe(403);
  const expiredToken = issueFileAccessToken({ secret: SECRET, path: ownFilePath, auth: localApp.users.employeeA, now: () => 1, ttlSeconds: 60 });
  const expiredFile = await anonymousPage.request.get(`${localApp.baseUrl.slice(0, -1)}${ownFilePath}?fileToken=${encodeURIComponent(expiredToken)}`);
  expect(expiredFile.status()).toBe(401);
  expect(await expiredFile.json()).toMatchObject({ code: "AUTH_REQUIRED" });
  await a.close(); await b.close();
});

test("owner, accounting and admin can read both documents and reach permitted mutation checks", async ({ localApp, seed }) => {
  const documents = seed.documents.map(document => document.documentNo);
  for (const role of ["owner", "accounting", "admin"]) {
    const user = localApp.users[role];
    const token = createTestSession({ ...user, secret: SECRET });
    const headers = { cookie: `sweet_house_session=${token}`, origin: localApp.baseUrl.slice(0, -1) };
    const first = await fetch(`${localApp.baseUrl}api/expense-requests/${documents[0]}`, { headers });
    const second = await fetch(`${localApp.baseUrl}api/expense-requests/${documents[1]}`, { headers });
    expect(first.status, `${role} cannot read document A`).toBe(200);
    expect(second.status, `${role} cannot read document B`).toBe(200);
    const detail = await first.json();
    const filePath = detail.pdfFiles[0].url;
    expect((await fetch(`${localApp.baseUrl.slice(0, -1)}${filePath}`, { headers })).status).toBe(200);
    const mutationPath = role === "accounting"
      ? "api/workflow-documents/purchase_order/fixture-missing/approve"
      : "api/workflow-templates";
    const mutation = await fetch(`${localApp.baseUrl}${mutationPath}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{}" });
    expect(mutation.status, `${role} was incorrectly denied at the mutation permission boundary`).not.toBe(403);
  }
});

test("unsafe return, traversal and expired file tokens are rejected", async ({ anonymousPage, localApp }) => {
  const login = new URL(`${localApp.baseUrl}/line-auth`);
  login.searchParams.set("returnTo", "//evil.example/steal");
  await anonymousPage.goto(login.toString());
  await expect(anonymousPage.locator("[data-line-auth-status]")).toBeVisible();
  expect((await anonymousPage.request.get(`${localApp.baseUrl}/../forms/index.html`)).status()).toBe(404);
  expect((await anonymousPage.request.get(`${localApp.baseUrl}api/expense-requests/does-not-exist/files/raw/file.pdf?fileToken=expired`)).status()).toBe(401);
});
