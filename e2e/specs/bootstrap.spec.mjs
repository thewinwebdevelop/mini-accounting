import { expect, test } from "@playwright/test";

test("bootstrap has a selected project and run identity", async ({}, testInfo) => {
  expect(["chromium", "mobile-chromium", "production-smoke"]).toContain(testInfo.project.name);
  expect(process.env.E2E_RUN_ID).toMatch(/\S+/);
});
