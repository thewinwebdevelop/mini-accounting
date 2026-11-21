import { expect } from "@playwright/test";
import { test } from "../fixtures/playwright.fixture.mjs";
import { WorkflowTransactionsPage, WorkflowTransactionPage } from "../pages/workflow.page.mjs";
import { WorkflowDocumentPage } from "../pages/workflow-document.page.mjs";
import { createTestSession } from "../fixtures/auth.fixture.mjs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { canonicalHash, stableSourceKey } = require("../../forms/data-backend.logic.js");
const workflowLogic = require("../../forms/workflow.logic.js");

async function openCloudWorkflow(page, transactionNo) {
  const openingRefresh = page.waitForResponse((response) => response.url().endsWith(`/api/workflow-transactions/${encodeURIComponent(transactionNo)}/refresh`) && response.request().method() === "POST");
  await page.goto(`/workflow-transaction?transactionNo=${encodeURIComponent(transactionNo)}`);
  await expect(page.locator("#transactionNumber")).toHaveText(transactionNo);
  await openingRefresh;
}

test.describe("workflow cloud runtime mocked", () => {
  test("submitted voucher retains its evidence metadata in Supabase", async ({ browser, cloudRuntime }) => {
    const context = await browser.newContext({ baseURL: cloudRuntime.baseUrl });
    await context.addCookies([{ name: "sweet_house_session", value: cloudRuntime.sessionToken, url: cloudRuntime.baseUrl }]);
    try {
      const page = await context.newPage();
      const voucher = new WorkflowDocumentPage(page, "payment_voucher");
      await voucher.open();
      await voucher.fill({ title: "Cloud voucher", purpose: "Payment", vendor: "Fixture Supplies", beforeVat: "800", vatMode: "manual", vatAmount: "0", withholdingTax: "0" });
      await voucher.save();
      await page.locator('[name=evidence_evidence]').setInputFiles({
        name: "slip.png", mimeType: "image/png",
        buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAwAAAAMCAIAAADZF8uwAAAAF0lEQVR4nGNkYPjPQAgwEVQxqmgAggAAzeIBF5UyoZcAAAAASUVORK5CYII=", "base64"),
      });
      await page.locator("#submitWorkflowDocument").click();
      await page.locator("#workflowReviewConfirm").click();
      await expect(page.locator("#workflowDocumentStatus")).toContainText("ตรวจอนุมัติแล้ว");
      const record = cloudRuntime.cloudState.documents.get(`document:payment_voucher:${voucher.documentNo}`);
      expect(record.payload.evidenceFiles.evidence).toMatchObject([{ originalName: "slip.png", storedName: "evidence_001.png" }]);
      await voucher.reload();
      await expect(page.locator("#existingEvidenceFiles")).toContainText("evidence_001.png");
      await expect(page.locator("#documentStatusPreview")).toHaveText("รอตรวจอนุมัติ");
    } finally { await context.close(); }
  });

  test("transaction list derives completed steps when the Supabase parent status is stale", async ({ browser, cloudRuntime }) => {
    const secret = "e2e-test-session-secret-012345678901234567890123";
    const ownerToken = createTestSession({ ...cloudRuntime.users.owner, secret });
    const context = await browser.newContext({ baseURL: cloudRuntime.baseUrl });
    await context.addCookies([{ name: "sweet_house_session", value: ownerToken, url: cloudRuntime.baseUrl }]);
    const page = await context.newPage();
    const template = {
      templateId: "stale-completed-list-test",
      name: "Stale completed list test",
      description: "E2E fixture",
      active: true,
      syncGoogleDrive: false,
      documentSteps: [{ stepId: "step-001", documentKind: "payment_voucher" }],
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    };
    const transaction = workflowLogic.buildWorkflowTransactionPayload({
      accountingMonth: "2026-11",
      title: "Stale completed transaction",
      ownerUserId: "owner-1",
      sequence: "9997",
      template,
    }, { now: () => "2026-11-18T00:00:00.000Z" });
    const parentKey = stableSourceKey("document", `workflow_transaction:${transaction.transactionNo}`);
    cloudRuntime.cloudState.documents.set(parentKey, {
      source_key: parentKey,
      document_kind: "workflow_transaction",
      document_no: transaction.transactionNo,
      owner_user_id: "owner-1",
      status: "in_progress",
      accounting_month: transaction.accountingMonth,
      folder_path: transaction.folderPath,
      payload: transaction,
      source_hash: canonicalHash(transaction),
      created_at: transaction.createdAt,
      updated_at: transaction.updatedAt,
    });
    const child = {
      documentKind: "payment_voucher",
      documentNo: "PV-2026-11-9997",
      transactionNo: transaction.transactionNo,
      workflowStepId: "step-001",
      status: "completed",
    };
    const childKey = stableSourceKey("document", `${child.documentKind}:${child.documentNo}`);
    cloudRuntime.cloudState.documents.set(childKey, {
      source_key: childKey,
      document_kind: child.documentKind,
      document_no: child.documentNo,
      owner_user_id: "owner-1",
      status: child.status,
      accounting_month: transaction.accountingMonth,
      folder_path: `${transaction.folderPath}/payment-vouchers/${child.documentNo}`,
      payload: child,
      source_hash: canonicalHash(child),
      created_at: transaction.createdAt,
      updated_at: transaction.updatedAt,
    });

    const list = new WorkflowTransactionsPage(page);
    await list.open();
    await page.locator("#transactionStatusFilter").selectOption("all");
    const row = page.locator("#transactionRows tr").filter({ hasText: transaction.transactionNo });
    await expect(row).toContainText("เสร็จสมบูรณ์");
    await expect(row).not.toContainText("กำลังดำเนินการ");
    await context.close();
  });

  test("cancelled workflow status survives a fresh app instance and appears in the transaction list", async ({ browser, cloudRuntime }) => {
    const secret = "e2e-test-session-secret-012345678901234567890123";
    const ownerToken = createTestSession({ ...cloudRuntime.users.owner, secret });
    const openAsOwner = async (runtime) => {
      const context = await browser.newContext({ baseURL: runtime.baseUrl });
      await context.addCookies([{ name: "sweet_house_session", value: ownerToken, url: runtime.baseUrl }]);
      return { context, page: await context.newPage() };
    };
    const first = await openAsOwner(cloudRuntime);
    const templateId = "cloud-cancel-persistence-test";
    const template = {
      templateId,
      name: "Cloud cancel persistence test",
      description: "E2E fixture",
      active: true,
      syncGoogleDrive: false,
      documentSteps: [{ stepId: "step-001", documentKind: "payment_voucher" }],
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    };
    const transaction = workflowLogic.buildWorkflowTransactionPayload({
      accountingMonth: "2026-11",
      title: "Cloud cancellation persistence",
      ownerUserId: "owner-1",
      sequence: "9998",
      template,
    }, { now: () => "2026-11-18T00:00:00.000Z" });
    const sourceKey = stableSourceKey("document", `workflow_transaction:${transaction.transactionNo}`);
    cloudRuntime.cloudState.documents.set(sourceKey, {
      source_key: sourceKey,
      document_kind: "workflow_transaction",
      document_no: transaction.transactionNo,
      owner_user_id: "owner-1",
      status: transaction.status,
      accounting_month: transaction.accountingMonth,
      folder_path: transaction.folderPath,
      payload: transaction,
      source_hash: canonicalHash(transaction),
      created_at: transaction.createdAt,
      updated_at: transaction.updatedAt,
    });

    const detail = new WorkflowTransactionPage(first.page, transaction.transactionNo);
    const openingRefresh = first.page.waitForResponse((response) => response.url().endsWith(`/api/workflow-transactions/${transaction.transactionNo}/refresh`) && response.request().method() === "POST");
    await first.page.goto(`/workflow-transaction?transactionNo=${encodeURIComponent(transaction.transactionNo)}`);
    await expect(first.page.locator("#transactionNumber")).toHaveText(transaction.transactionNo);
    await openingRefresh;
    const cancelResponse = await detail.cancelWithConfirmationResponse();
    expect([200, 202]).toContain(cancelResponse.statusCode);
    expect(["cancelled", "cancellation_pending"]).toContain(cancelResponse.body.status);
    expect(cloudRuntime.cloudState.documents.get(sourceKey)?.payload?.status).toBe(cancelResponse.body.status);
    await first.context.close();

    const restarted = await cloudRuntime.restartApp();
    const reopened = await openAsOwner(restarted);
    const list = new WorkflowTransactionsPage(reopened.page);
    await list.open();
    await reopened.page.locator("#transactionStatusFilter").selectOption("all");
    const row = reopened.page.locator("#transactionRows tr").filter({ hasText: transaction.transactionNo });
    const displayedStatus = cancelResponse.body.status === "cancelled" ? "ยกเลิกแล้ว" : "รอดำเนินการยกเลิก";
    await expect(row).toContainText(displayedStatus);
    await expect(row).not.toContainText("กำลังดำเนินการ");
    await row.getByRole("link", { name: "เปิดธุรกรรม" }).click();
    await expect(reopened.page.locator("#workflowProgress")).toContainText(displayedStatus);
    await expect(reopened.page.locator("#cancellationSummary")).toBeVisible();
    expect(await new WorkflowTransactionPage(reopened.page, transaction.transactionNo).detail()).toMatchObject({ status: cancelResponse.body.status });
    await reopened.context.close();
    await restarted.stop();
  });

  test("closed workflow status survives a fresh app instance and page reload", async ({ browser, cloudRuntime }) => {
    const secret = "e2e-test-session-secret-012345678901234567890123";
    const ownerToken = createTestSession({ ...cloudRuntime.users.owner, secret });
    const openAsOwner = async (runtime) => {
      const context = await browser.newContext({ baseURL: runtime.baseUrl });
      await context.addCookies([{ name: "sweet_house_session", value: ownerToken, url: runtime.baseUrl }]);
      return { context, page: await context.newPage() };
    };
    const first = await openAsOwner(cloudRuntime);
    const templateId = "cloud-close-persistence-test";
    const template = {
      templateId,
      name: "Cloud close persistence test",
      description: "E2E fixture",
      active: true,
      syncGoogleDrive: false,
      documentSteps: [{ stepId: "step-001", documentKind: "payment_voucher" }],
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    };
    const transaction = workflowLogic.buildWorkflowTransactionPayload({
      accountingMonth: "2026-11",
      title: "Cloud close persistence",
      ownerUserId: "owner-1",
      sequence: "9999",
      template,
    }, { now: () => "2026-11-18T00:00:00.000Z" });
    const sourceKey = stableSourceKey("document", `workflow_transaction:${transaction.transactionNo}`);
    cloudRuntime.cloudState.documents.set(sourceKey, {
      source_key: sourceKey,
      document_kind: "workflow_transaction",
      document_no: transaction.transactionNo,
      owner_user_id: "owner-1",
      status: transaction.status,
      accounting_month: transaction.accountingMonth,
      folder_path: transaction.folderPath,
      payload: transaction,
      source_hash: canonicalHash(transaction),
      created_at: transaction.createdAt,
      updated_at: transaction.updatedAt,
    });
    const workflow = new WorkflowTransactionPage(first.page, transaction.transactionNo);
    const openingRefresh = first.page.waitForResponse((response) => response.url().endsWith(`/api/workflow-transactions/${transaction.transactionNo}/refresh`) && response.request().method() === "POST");
    await first.page.goto(`/workflow-transaction?transactionNo=${encodeURIComponent(transaction.transactionNo)}`);
    await expect(first.page.locator("#transactionNumber")).toHaveText(transaction.transactionNo);
    await openingRefresh;
    await workflow.startCurrentStep();
    await workflow.completeCurrentChild({ title: "Cloud closed voucher" });
    const returnRefresh = first.page.waitForResponse((response) => response.url().endsWith(`/api/workflow-transactions/${transaction.transactionNo}/refresh`) && response.request().method() === "POST");
    await workflow.returnToTransaction();
    await returnRefresh;
    await workflow.refresh();
    const closeResponse = first.page.waitForResponse((response) => response.url().endsWith(`/api/workflow-transactions/${transaction.transactionNo}/complete`) && response.request().method() === "POST");
    await first.page.locator("#completeTransactionButton").click();
    const response = await closeResponse;
    expect(response.ok()).toBeTruthy();
    const closed = await response.json();
    await expect(first.page.locator("#transactionStatus")).toContainText("ปิดงานธุรกรรมเรียบร้อยแล้ว");
    expect(closed.status).toBe("completed");
    expect(closed.completedAt).toBeTruthy();
    expect(cloudRuntime.cloudState.documents.get(sourceKey)?.payload?.completedAt).toBeTruthy();
    expect(cloudRuntime.cloudState.documents.get(sourceKey)?.status).toBe("completed");
    // Simulate a workflow whose financial entry was synced by a prior instance.
    const saved = cloudRuntime.cloudState.documents.get(sourceKey);
    const spreadsheetUrl = "https://docs.google.com/spreadsheets/d/cloud-sheet/edit";
    const payload = { ...saved.payload, sheetSync: {
      syncStatus: "synced", sourceKey: `workflow_transaction:${transaction.transactionNo}`,
      sourceDocumentKind: "expense_request", sourceDocumentNo: "REQ-2026-11-9999",
      spreadsheetId: "cloud-sheet", spreadsheetUrl, sheetName: transaction.accountingMonth,
      rowNumber: 4, syncedAt: closed.completedAt, updatedAt: closed.completedAt,
    } };
    cloudRuntime.cloudState.documents.set(sourceKey, { ...saved, payload, source_hash: canonicalHash(payload) });
    await openCloudWorkflow(first.page, transaction.transactionNo);
    await expect(first.page.locator("#sheetSyncStatus")).toContainText("REQ-2026-11-9999");
    // This isolated runtime has no Google credentials. Its failed Drive result
    // must survive reopening just as a successful upload does.
    await first.page.locator("#syncDriveButton").click();
    await expect(first.page.locator("#driveSyncStatus")).toContainText("ซิงก์ Google Drive ไม่สำเร็จ");
    const driveStatus = await first.page.locator("#driveSyncStatus").innerText();
    await openCloudWorkflow(first.page, transaction.transactionNo);
    await expect(first.page.locator("#driveSyncStatus")).toHaveText(driveStatus);
    await expect(first.page.locator("#sheetSyncStatus")).toContainText("REQ-2026-11-9999");
    await expect(first.page.locator("#sheetSyncLink")).toHaveAttribute("href", spreadsheetUrl);

    cloudRuntime.cloudState.driveCredentials = {
      "google-drive-config": { clientId: "fixture", clientSecret: "fixture", driveBasePath: "workflow" },
      "google-drive-token": { access_token: "fixture", refresh_token: "fixture", expiresAt: Date.now() + 3600000 },
    };
    await first.page.locator("#syncDriveButton").click();
    await expect(first.page.locator("#driveSyncStatus")).toHaveText("ซิงก์ Google Drive สำเร็จแล้ว");
    const driveLink = first.page.locator("#workflowDriveFolderLink");
    await expect(driveLink).toHaveAttribute("href", /^https:\/\/drive\.google\.com\/drive\/folders\/fixture-folder-/);
    const driveUrl = await driveLink.getAttribute("href");
    await first.context.close();

    const restarted = await cloudRuntime.restartApp();
    const reopened = await openAsOwner(restarted);
    const reloaded = new WorkflowTransactionPage(reopened.page, transaction.transactionNo);
    const list = new WorkflowTransactionsPage(reopened.page);
    await list.open();
    await reopened.page.locator("#transactionStatusFilter").selectOption("all");
    const row = reopened.page.locator("#transactionRows tr").filter({ hasText: "Cloud close persistence" });
    await expect(row).toContainText("เสร็จสมบูรณ์");
    await expect(row).not.toContainText("กำลังดำเนินการ");
    await row.getByRole("link", { name: "เปิดธุรกรรม" }).click();
    await expect(reopened.page.locator("#completeTransactionButton")).toHaveText("ปิดงานธุรกรรมแล้ว");
    expect(await reloaded.detail()).toMatchObject({ status: "completed", completedAt: closed.completedAt });
    await openCloudWorkflow(reopened.page, transaction.transactionNo);
    await expect(reopened.page.locator("#driveSyncStatus")).toHaveText("ซิงก์ Google Drive สำเร็จแล้ว");
    await expect(reopened.page.locator("#workflowDriveFolderLink")).toHaveAttribute("href", driveUrl);
    await expect(reopened.page.locator("#sheetSyncLink")).toHaveAttribute("href", spreadsheetUrl);
    await reopened.context.close();
    await restarted.stop();
  });

  test("reuses a durable allocation after save failure, allocates a new key, and materializes after restart", async ({ browser, cloudRuntime }) => {
    const pageContext = async (baseUrl, user) => {
      const context = await browser.newContext({ baseURL: baseUrl });
      await context.addCookies([{ name: "sweet_house_session", value: user, url: baseUrl }]);
      return { context, page: await context.newPage() };
    };
    const key = "cloud-workflow-retry-key";
    const token = cloudRuntime.sessionToken;
    const first = await pageContext(cloudRuntime.baseUrl, token);
    const list = new WorkflowTransactionsPage(first.page);
    await list.open();
    const templateId = await list.firstTemplateId();
    cloudRuntime.mock.scriptResponse({ endpoint: "/rest/v1/documents", type: "drop-after-persist" });
    const failed = await list.createTransaction({ template: templateId, month: "2026-10", title: "Cloud durable retry", idempotencyKey: key, expectFailure: true });
    expect(failed.status).toBeGreaterThanOrEqual(400);
    const reservation = cloudRuntime.cloudState.reservations.get(key);
    expect(reservation?.transactionNo).toBeTruthy();
    const retried = await list.createTransaction({ template: templateId, month: "2026-10", title: "Cloud durable retry", idempotencyKey: key });
    expect(retried.transactionNo).toBe(reservation.transactionNo);
    expect(retried.url).toBe(`${cloudRuntime.baseUrl}workflow-transaction?transactionNo=${reservation.transactionNo}`);
    const retryPage = new WorkflowTransactionPage(first.page, retried.transactionNo);
    await openCloudWorkflow(first.page, retried.transactionNo);
    await retryPage.assertIdentity({ transactionNo: retried.transactionNo, title: "Cloud durable retry" });
    await list.open();
    const newKey = await list.createTransaction({ template: templateId, month: "2026-10", title: "Cloud second transaction", idempotencyKey: "cloud-workflow-new-key" });
    expect(newKey.transactionNo).not.toBe(retried.transactionNo);
    expect(cloudRuntime.cloudState.documents.has(`document:workflow_transaction:${retried.transactionNo}`)).toBeTruthy();
    expect(cloudRuntime.cloudState.documents.has(`document:workflow_transaction:${newKey.transactionNo}`)).toBeTruthy();
    await first.context.close();

    const restarted = await cloudRuntime.restartApp();
    const second = await pageContext(restarted.baseUrl, restarted.sessionToken);
    const detail = new WorkflowTransactionPage(second.page, retried.transactionNo);
    await openCloudWorkflow(second.page, retried.transactionNo);
    await detail.assertIdentity({ transactionNo: retried.transactionNo, title: "Cloud durable retry" });
    expect((await detail.detail()).folderPath).toContain(`/${retried.transactionNo}_`);

    const concurrentContext = await pageContext(restarted.baseUrl, restarted.sessionToken);
    const concurrentList = new WorkflowTransactionsPage(concurrentContext.page);
    await concurrentList.open();
    const secondList = new WorkflowTransactionsPage(second.page);
    await secondList.open();
    const [concurrent, concurrentB] = await Promise.all([
      concurrentList.createTransaction({ template: await concurrentList.firstTemplateId(), month: "2026-10", title: "Concurrent A", idempotencyKey: "concurrent-a" }),
      secondList.createTransaction({ template: await secondList.firstTemplateId(), month: "2026-10", title: "Concurrent B", idempotencyKey: "concurrent-b" }),
    ]);
    expect(concurrent.transactionNo).not.toBe(concurrentB.transactionNo);
    expect(cloudRuntime.cloudState.reservations.size).toBeGreaterThanOrEqual(4);
    await expect(concurrentContext.page).toHaveURL(new RegExp(`transactionNo=${concurrent.transactionNo}$`));
    await expect(second.page).toHaveURL(new RegExp(`transactionNo=${concurrentB.transactionNo}$`));
    await concurrentContext.context.close();
    await second.context.close();
    await restarted.stop();
  });
});
