import crypto from "node:crypto";
import { expect, test } from "../fixtures/playwright.fixture.mjs";
import { LineIntakePage } from "../pages/line-intake.page.mjs";
import { createLocalLineIntakeStore } from "../../forms/line-intake.logic.js";

const SECRET = "e2e-line-channel-secret";

async function postWebhook(localApp, body, signature = true) {
  return fetch(`${localApp.baseUrl}api/webhooks/line`, { method: "POST", headers: { "content-type": "application/json", "x-line-signature": signature ? crypto.createHmac("sha256", SECRET).update(body).digest("base64") : "bad" }, body });
}

test.describe("LINE intake", () => {
  test("accepts a signed provider event, OCRs it in review, confirms one draft idempotently, and preserves evidence", async ({ authenticatedPage, localApp, mock }) => {
    const messageId = `message-${Date.now()}`;
    const payload = JSON.stringify({ events: [{ webhookEventId: `event-${Date.now()}`, type: "message", source: { userId: "employee-a" }, replyToken: "reply-token", message: { id: messageId, type: "image" } }] });
    const webhook = await postWebhook(localApp, payload);
    expect(webhook.status).toBe(200);
    const accepted = await webhook.json();
    expect(accepted.accepted).toHaveLength(1);
    const intakeId = accepted.accepted[0].intakeId;
    mock.scriptResponse({ provider: "ocr", endpoint: "/", body: { fields: { accountingMonth: "2026-10", vendorName: "OCR Vendor", description: "OCR receipt", amountBeforeVat: "88", vatAmount: "6.16", withholdingTax: "0" }, confidence: 0.93, warnings: ["ตรวจสอบเลขที่เอกสาร"] } });
    const page = new LineIntakePage(authenticatedPage);
    await page.open(intakeId);
    await expect(authenticatedPage.locator('[name="amountBeforeVat"]')).toHaveValue("88");
    const reviewed = await authenticatedPage.request.get(`/api/line-intakes/${intakeId}`).then((response) => response.json());
    expect(reviewed.intake.extractedPayload.fields).toMatchObject({ vendorName: "OCR Vendor", amountBeforeVat: "88" });
    const ocrRequest = mock.requests.find((request) => request.provider === "ocr");
    expect(ocrRequest).toMatchObject({ method: "POST", path: "/" });
    expect(JSON.parse(ocrRequest.body)).toMatchObject({ fileName: `${messageId}.jpg`, contentType: "image/jpeg" });
    await page.edit({ requesterName: "Employee A", paymentTargetName: "Fixture Supplies", businessPurpose: "LINE evidence", description: "LINE receipt", accountingMonth: "2026-10", amountBeforeVat: "100", vatAmount: "7", withholdingTax: "0" });
    await page.confirm();
    const first = await authenticatedPage.request.get(`/api/line-intakes/${intakeId}`).then((response) => response.json());
    const second = await authenticatedPage.request.post(`/api/line-intakes/${intakeId}/confirm`, { data: { accountingMonth: "2026-10", requesterName: "Employee A", paymentTargetName: "Fixture Supplies", businessPurpose: "LINE evidence", description: "LINE receipt", amountBeforeVat: "100", vatAmount: "7", withholdingTax: "0", expenseLines: [{ description: "LINE receipt", vendor: "Fixture Supplies", amountBeforeVat: "100", vatAmount: "7", withholdingTax: "0" }] } }).then((response) => response.json());
    expect(first.intake.status).toBe("confirmed");
    expect(first.intake.createdDocumentNo).toBeTruthy();
    expect(second).toMatchObject({ idempotent: true, document: { requestNo: first.intake.createdDocumentNo, evidenceFiles: expect.any(Object) } });
    expect(Object.values(second.document.evidenceFiles).flat().length).toBeGreaterThan(0);
    const evidenceEntry = second.document.rawFiles[0];
    const evidenceResponse = await authenticatedPage.request.get(new URL(`/api/expense-requests/${first.intake.createdDocumentNo}/files/raw/${encodeURIComponent(evidenceEntry.storedName)}`, localApp.baseUrl).toString());
    expect(evidenceResponse.status()).toBe(200);
    expect(Buffer.from(await evidenceResponse.body())).toEqual(Buffer.from("fixture-bytes"));
    expect(mock.requests.filter((request) => request.provider === "line").map((request) => request.path)).toEqual(expect.arrayContaining([`/v2/bot/message/${messageId}/content`, "/v2/bot/message/reply"]));
  });

  test("accepts a signed LINE probe, rejects bad signatures, and cancels a review without creating a draft", async ({ authenticatedPage, localApp }) => {
    const probeBody = JSON.stringify({ destination: "fixture-destination", events: [] });
    const probe = await postWebhook(localApp, probeBody);
    expect(probe.status).toBe(200);
    expect(await probe.json()).toMatchObject({ ok: true, accepted: [], skipped: [] });
    const invalid = await postWebhook(localApp, JSON.stringify({ events: [] }), false);
    expect(invalid.status).toBe(401);
    const before = await authenticatedPage.request.get("/api/expense-requests").then((response) => response.json());
    const store = createLocalLineIntakeStore({ rootDir: localApp.rootDir });
    const created = await store.create({ eventId: `cancel-${Date.now()}`, messageId: `cancel-message-${Date.now()}`, lineUserId: "employee-a", mediaKind: "pdf", originalName: "cancel.pdf", contentType: "application/pdf", bytes: Buffer.from("pdf") });
    const page = new LineIntakePage(authenticatedPage);
    await page.open(created.item.id);
    await page.cancel();
    const review = await authenticatedPage.request.get(`/api/line-intakes/${created.item.id}`).then((response) => response.json());
    expect(review.intake.status).toBe("cancelled");
    const after = await authenticatedPage.request.get("/api/expense-requests").then((response) => response.json());
    expect(after.requests).toHaveLength(before.requests.length);
  });

  test("rejects unsupported media types and provider downloads over the size limit before persistence", async ({ localApp, mock }) => {
    const unsupportedMessage = `unsupported-${Date.now()}`;
    mock.scriptResponse({ endpoint: unsupportedMessage, contentType: "application/pdf" });
    const unsupportedBody = JSON.stringify({ events: [{ webhookEventId: `unsupported-event-${Date.now()}`, type: "message", source: { userId: "employee-a" }, message: { id: unsupportedMessage, type: "image" } }] });
    const unsupported = await postWebhook(localApp, unsupportedBody);
    expect((await unsupported.json()).skipped).toEqual([expect.objectContaining({ code: "LINE_MEDIA_UNSUPPORTED" })]);

    const oversizedMessage = `oversized-${Date.now()}`;
    mock.scriptResponse({ endpoint: oversizedMessage, bytes: Buffer.alloc(20 * 1024 * 1024 + 1) });
    const oversizedBody = JSON.stringify({ events: [{ webhookEventId: `oversized-event-${Date.now()}`, type: "message", source: { userId: "employee-a" }, message: { id: oversizedMessage, type: "image" } }] });
    const oversized = await postWebhook(localApp, oversizedBody);
    expect((await oversized.json()).skipped).toEqual([expect.objectContaining({ code: "LINE_INTAKE_TOO_LARGE" })]);
  });
});
