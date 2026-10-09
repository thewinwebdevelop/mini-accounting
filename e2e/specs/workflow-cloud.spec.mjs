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
    await retryPage.open();
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
    await detail.open();
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
