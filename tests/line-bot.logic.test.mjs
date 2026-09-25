import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildIntakeReviewReply,
  downloadLineContent,
} = require("../forms/line-bot.logic.js");

test("intake review reply is a safe LINE flex card", () => {
  const payload = buildIntakeReviewReply({
    replyToken: "reply-1",
    intake: { id: "intake-1", mediaKind: "pdf", originalName: "invoice.pdf", byteSize: 1200 },
    miniAppUrl: "https://example.com/line-intake",
  });
  assert.equal(payload.replyToken, "reply-1");
  assert.equal(payload.messages[0].type, "flex");
  assert.match(JSON.stringify(payload.messages), /intake-1/);
  assert.doesNotMatch(JSON.stringify(payload), /storagePath/);
});

test("content downloader sends the channel token and rejects provider errors", async () => {
  const calls = [];
  const result = await downloadLineContent({
    messageId: "msg-1",
    accessToken: "secret-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(Buffer.from("pdf-bytes"), { status: 200, headers: { "content-type": "application/pdf" } });
    },
  });
  assert.equal(result.contentType, "application/pdf");
  assert.equal(result.bytes.toString(), "pdf-bytes");
  assert.equal(calls[0].url, "https://api-data.line.me/v2/bot/message/msg-1/content");
  assert.equal(calls[0].options.headers.authorization, "Bearer secret-token");

  await assert.rejects(() => downloadLineContent({
    messageId: "msg-2", accessToken: "secret-token",
    fetchImpl: async () => new Response("provider secret", { status: 500 }),
  }), error => error.code === "LINE_CONTENT_DOWNLOAD_FAILED" && !error.message.includes("provider secret"));
});
