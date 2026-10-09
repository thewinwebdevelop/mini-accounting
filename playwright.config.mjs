import { defineConfig, devices } from "@playwright/test";

const localBaseURL = "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./e2e/specs",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], baseURL: localBaseURL },
      testIgnore: /production-smoke\.spec\.mjs$/,
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], browserName: "chromium", baseURL: localBaseURL },
      testIgnore: /production-smoke\.spec\.mjs$/,
    },
    {
      name: "production-smoke",
      use: { baseURL: process.env.E2E_BASE_URL },
      testMatch: /production-smoke\.spec\.mjs$/,
    },
  ],
});
