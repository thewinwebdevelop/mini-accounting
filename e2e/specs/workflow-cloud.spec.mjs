import { expect } from "@playwright/test";
import { test } from "../fixtures/playwright.fixture.mjs";
import { WorkflowTransactionsPage, WorkflowTransactionPage } from "../pages/workflow.page.mjs";

test.describe("workflow cloud runtime mocked", () => {
  test("reuses a durable allocation after save failure, allocates a new key, and materializes after restart", async ({ browser, cloudRuntime }) => {
    const pageContext = async (baseUrl, user) => {
      const context = await browser.newContext({ baseURL: baseUrl });
      await context.addCookies([{ name: "sweet_house_session", value: user, url: baseUrl }]);
      return { context, page: await context.newPage() };
    };
    const template = "stock_no_tax_invoice_company_bank";
    const key = "cloud-workflow-retry-key";
    const token = cloudRuntime.sessionToken;
    const first = await pageContext(cloudRuntime.baseUrl, token);
    const list = new WorkflowTransactionsPage(first.page);
    await list.open();
    cloudRuntime.mock.scriptResponse({ endpoint: "/rest/v1/documents", type: "drop-after-persist" });
    const failed = await first.page.request.post("/api/workflow-transactions", { data: { templateId: template, accountingMonth: "2026-10", title: "Cloud durable retry", idempotencyKey: key } });
    expect(failed.ok()).toBeFalsy();
    const reservation = cloudRuntime.cloudState.reservations.get(key);
    expect(reservation?.transactionNo).toBeTruthy();
    const retry = await first.page.request.post("/api/workflow-transactions", { data: { templateId: template, accountingMonth: "2026-10", title: "Cloud durable retry", idempotencyKey: key } }).then((response) => response.json());
    expect(retry.transactionNo).toBe(reservation.transactionNo);
    expect(retry.folderPath).toContain(`/${reservation.transactionNo}_`);
    const newKey = await first.page.request.post("/api/workflow-transactions", { data: { templateId: template, accountingMonth: "2026-10", title: "Cloud second transaction", idempotencyKey: "cloud-workflow-new-key" } }).then((response) => response.json());
    expect(newKey.transactionNo).not.toBe(retry.transactionNo);
    expect(cloudRuntime.cloudState.documents.has(`document:workflow_transaction:${retry.transactionNo}`)).toBeTruthy();
    expect(cloudRuntime.cloudState.documents.has(`document:workflow_transaction:${newKey.transactionNo}`)).toBeTruthy();
    await first.context.close();

    const restarted = await cloudRuntime.restartApp();
    const second = await pageContext(restarted.baseUrl, restarted.sessionToken);
    const detail = new WorkflowTransactionPage(second.page, retry.transactionNo);
    await detail.open();
    await detail.assertIdentity({ transactionNo: retry.transactionNo, title: "Cloud durable retry" });
    expect((await detail.detail()).folderPath).toContain(`/${retry.transactionNo}_`);

    const concurrent = await Promise.all([
      second.page.request.post("/api/workflow-transactions", { data: { templateId: template, accountingMonth: "2026-10", title: "Concurrent A", idempotencyKey: "concurrent-a" } }).then((response) => response.json()),
      second.page.request.post("/api/workflow-transactions", { data: { templateId: template, accountingMonth: "2026-10", title: "Concurrent B", idempotencyKey: "concurrent-b" } }).then((response) => response.json()),
    ]);
    expect(concurrent[0].transactionNo).not.toBe(concurrent[1].transactionNo);
    expect(cloudRuntime.cloudState.reservations.size).toBeGreaterThanOrEqual(4);
    await second.context.close();
    await restarted.stop();
  });
});
