import { test as base, expect } from "@playwright/test";
import { createE2EEnvironment } from "./app-server.fixture.mjs";
import { createTestSession, sessionCookie } from "./auth.fixture.mjs";

export const test = base.extend({
  localApp: [async ({}, use, testInfo) => {
    const environment = await createE2EEnvironment({ profile: "local", workerIndex: testInfo.workerIndex });
    try { await use(environment); } finally { await environment.stop(); }
  }, { scope: "worker" }],
  seed: async ({ localApp }, use) => use({ users: localApp.users, rootDir: localApp.rootDir, runId: localApp.runId }),
  mock: async ({ localApp }, use) => use(localApp.mock),
  authenticatedPage: async ({ browser, localApp }, use, testInfo) => {
    const persona = localApp.users.employeeA;
    const context = await browser.newContext();
    await context.addCookies([{ ...sessionCookie(createTestSession({ ...persona, secret: "e2e-test-session-secret-012345678901234567890123" })), url: localApp.baseUrl }]);
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  anonymousPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect };
