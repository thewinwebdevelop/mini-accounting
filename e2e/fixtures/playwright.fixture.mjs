import { test as base, expect } from "@playwright/test";
import { createE2EEnvironment } from "./app-server.fixture.mjs";
import { createTestSession, sessionCookie } from "./auth.fixture.mjs";
import { createCloudRuntimeMock } from "./cloud-runtime-mock.mjs";

export const test = base.extend({
  localApp: [async ({}, use, testInfo) => {
    const environment = await createE2EEnvironment({ profile: "local", workerIndex: testInfo.workerIndex });
    try { await use(environment); } finally { await environment.stop(); }
  }, { scope: "worker" }],
  seed: async ({ localApp }, use) => use({ ...localApp.manifest, rootDir: localApp.rootDir }),
  mock: async ({ localApp }, use) => use(localApp.mock),
  cloudRuntime: [async ({}, use, testInfo) => {
    const environment = await createCloudRuntimeMock({ workerIndex: testInfo.workerIndex });
    try { await use(environment); } finally { await environment.stop(); }
  }, { scope: "worker" }],
  authenticatedPage: async ({ browser, localApp }, use, testInfo) => {
    const persona = localApp.users.employeeA;
    const context = await browser.newContext({ baseURL: localApp.baseUrl });
    await context.addCookies([{ ...sessionCookie(createTestSession({ ...persona, secret: "e2e-test-session-secret-012345678901234567890123" })), url: localApp.baseUrl }]);
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  ownerPage: async ({ browser, localApp }, use) => {
    const persona = localApp.users.owner;
    const context = await browser.newContext({ baseURL: localApp.baseUrl });
    await context.addCookies([{ ...sessionCookie(createTestSession({ ...persona, secret: "e2e-test-session-secret-012345678901234567890123" })), url: localApp.baseUrl }]);
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  adminPage: async ({ browser, localApp }, use) => {
    const persona = localApp.users.admin;
    const context = await browser.newContext({ baseURL: localApp.baseUrl });
    await context.addCookies([{ ...sessionCookie(createTestSession({ ...persona, secret: "e2e-test-session-secret-012345678901234567890123" })), url: localApp.baseUrl }]);
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  anonymousPage: async ({ browser, localApp }, use) => {
    const context = await browser.newContext({ baseURL: localApp.baseUrl });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect };
