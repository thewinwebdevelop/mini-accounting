import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  extractLineMediaEvent,
  isSupportedLineMedia,
  verifyLineWebhookSignature,
} = require("../forms/line-webhook.logic.js");

test("LINE webhook signature uses the exact raw body", () => {
  const body = '{"events":[]}';
  const secret = "channel-secret";
  const signature = createHmac("sha256", secret).update(body).digest("base64");
  assert.equal(verifyLineWebhookSignature({ rawBody: body, channelSecret: secret, signature }), true);
  assert.equal(verifyLineWebhookSignature({ rawBody: `${body} `, channelSecret: secret, signature }), false);
  assert.equal(verifyLineWebhookSignature({ rawBody: body, channelSecret: secret, signature: "bad" }), false);
});

test("extractLineMediaEvent recognizes image and PDF file messages", () => {
  assert.deepEqual(extractLineMediaEvent({
    type: "message",
    webhookEventId: "evt-image",
    replyToken: "reply-token",
    source: { userId: "U1" },
    message: { id: "msg-image", type: "image" },
  }), {
    eventId: "evt-image",
    messageId: "msg-image",
    lineUserId: "U1",
    replyToken: "reply-token",
    mediaKind: "image",
    originalName: "msg-image.jpg",
    contentType: "image/jpeg",
  });

  assert.deepEqual(extractLineMediaEvent({
    type: "message",
    webhookEventId: "evt-pdf",
    source: { userId: "U2" },
    message: { id: "msg-pdf", type: "file", fileName: "invoice กันยายน.pdf", fileSize: 1234 },
  }), {
    eventId: "evt-pdf",
    messageId: "msg-pdf",
    lineUserId: "U2",
    replyToken: "",
    mediaKind: "pdf",
    originalName: "invoice กันยายน.pdf",
    contentType: "application/pdf",
    fileSize: 1234,
  });
});

test("unsupported media is not accepted", () => {
  assert.equal(isSupportedLineMedia({ mediaKind: "video", contentType: "video/mp4" }), false);
  assert.equal(isSupportedLineMedia({ mediaKind: "pdf", contentType: "image/jpeg", originalName: "receipt.pdf" }), false);
  assert.equal(isSupportedLineMedia({ mediaKind: "image", contentType: "image/png" }), true);
});
