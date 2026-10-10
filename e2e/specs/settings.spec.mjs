import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "../fixtures/playwright.fixture.mjs";
import { SettingsPage } from "../pages/settings.page.mjs";

test("company settings normalize persisted values and Google Drive edits preserve secrets and callback origin", async ({ adminPage, localApp }) => {
  const settings = new SettingsPage(adminPage);
  const company = await settings.saveCompany({ legalName: "  E2E Company  ", taxId: " 0105551234567 ", branch: " สำนักงานใหญ่ ", address: " 1 Test Road " });
  expect(company).toMatchObject({ legalName: "E2E Company", taxId: "0105551234567", branch: "สำนักงานใหญ่", address: "1 Test Road" });
  const first = await settings.saveDrive({ clientId: "fixture-client.apps.googleusercontent.com", clientSecret: "fixture-secret", driveBasePath: "/Fixture/Docs/" });
  expect(first).toMatchObject({ configured: true, clientId: "fixture-client.apps.googleusercontent.com", driveBasePath: "Fixture/Docs" });
  const second = await settings.saveDrive({ clientId: "fixture-client.apps.googleusercontent.com", clientSecret: "", driveBasePath: "Fixture/Updated" });
  expect(second).toMatchObject({ configured: true, clientId: "fixture-client.apps.googleusercontent.com", driveBasePath: "Fixture/Updated", clientSecretSaved: true });
  await adminPage.goto("/google-drive");
  const expectedOrigin = "http://localhost:8787";
  await expect(adminPage.locator("#oauthOrigin")).toHaveText(expectedOrigin);
  await expect(adminPage.locator("#oauthRedirectUri")).toHaveText(`${expectedOrigin}/api/google-drive/oauth2callback`);
  const saved = await adminPage.request.get("/api/google-drive/status").then((response) => response.json());
  expect(saved.driveBasePath).toBe("Fixture/Updated");

  const created = await adminPage.request.post("/api/expense-requests", { multipart: { payload: JSON.stringify({ requestType: "reimbursement", accountingMonth: "2026-10", requestTitle: "PDF company marker", requesterName: "Admin", businessPurpose: "PDF marker", paymentTargetName: "Fixture Supplies", expenseLines: [{ description: "PDF marker", amountBeforeVat: "10", vatAmount: "0", withholdingTax: "0" }] }) } });
  expect(created.ok()).toBeTruthy();
  const draft = await created.json();
  expect(draft.pdfFiles.length).toBeGreaterThan(0);
  const pdfPath = path.join(localApp.rootDir, draft.folderPath, draft.pdfFiles[0].path);
  const text = execFileSync(process.env.SWEET_HOUSE_PYTHON_BIN || "python3", ["-c", "import sys; from pypdf import PdfReader; import io; print('\\n'.join(page.extract_text() or '' for page in PdfReader(io.BytesIO(sys.stdin.buffer.read())).pages))"], { input: await readFile(pdfPath), encoding: "utf8" });
  expect(text).toContain("E2E Company");
});
