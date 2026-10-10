import { expect, test } from "../fixtures/playwright.fixture.mjs";
import { SettingsPage } from "../pages/settings.page.mjs";

test("company settings normalize persisted values and Google Drive edits preserve secrets and callback origin", async ({ adminPage }) => {
  const settings = new SettingsPage(adminPage);
  const company = await settings.saveCompany({ legalName: "  E2E Company  ", taxId: " 0105551234567 ", branch: " สำนักงานใหญ่ ", address: " 1 Test Road " });
  expect(company).toMatchObject({ legalName: "E2E Company", taxId: "0105551234567", branch: "สำนักงานใหญ่", address: "1 Test Road" });
  const first = await settings.saveDrive({ clientId: "fixture-client.apps.googleusercontent.com", clientSecret: "fixture-secret", driveBasePath: "/Fixture/Docs/" });
  expect(first).toMatchObject({ configured: true, clientId: "fixture-client.apps.googleusercontent.com", driveBasePath: "Fixture/Docs" });
  const second = await settings.saveDrive({ clientId: "fixture-client.apps.googleusercontent.com", clientSecret: "", driveBasePath: "Fixture/Updated" });
  expect(second).toMatchObject({ configured: true, clientId: "fixture-client.apps.googleusercontent.com", driveBasePath: "Fixture/Updated", clientSecretSaved: true });
  await adminPage.goto("/google-drive");
  await expect(adminPage.locator("#oauthRedirectUri")).toContainText("/api/google-drive/oauth2callback");
  const saved = await adminPage.request.get("/api/google-drive/status").then((response) => response.json());
  expect(saved.driveBasePath).toBe("Fixture/Updated");
});
