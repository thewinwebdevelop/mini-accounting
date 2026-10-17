const { createHmac, timingSafeEqual } = require("node:crypto");

function verifyLineWebhookSignature({ rawBody, channelSecret, signature }) {
  if (!channelSecret || !signature || typeof rawBody !== "string") return false;
  const expected = createHmac("sha256", channelSecret).update(rawBody, "utf8").digest("base64");
  const actualBytes = Buffer.from(String(signature), "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function eventIdFor(event) {
  return String(event?.webhookEventId || `${event?.timestamp || "0"}:${event?.message?.id || "unknown"}`);
}

function extractLineMediaEvent(event = {}) {
  if (event.type !== "message" || !event.message || !["image", "file"].includes(event.message.type)) return null;
  const message = event.message;
  const mediaKind = message.type === "image" ? "image" : "pdf";
  const originalName = message.type === "file" ? String(message.fileName || `${message.id}.pdf`) : `${message.id}.jpg`;
  return {
    eventId: eventIdFor(event),
    messageId: String(message.id || ""),
    lineUserId: String(event.source?.userId || ""),
    replyToken: String(event.replyToken || ""),
    mediaKind,
    originalName,
    contentType: mediaKind === "pdf" ? "application/pdf" : "image/jpeg",
    ...(message.fileSize === undefined ? {} : { fileSize: Number(message.fileSize) }),
  };
}

function isSupportedLineMedia({ mediaKind, contentType, originalName = "" } = {}) {
  const type = String(contentType || "").toLowerCase().split(";", 1)[0];
  if (mediaKind === "image") return ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(type);
  if (mediaKind === "pdf") return type === "application/pdf" && /\.pdf$/i.test(String(originalName));
  return false;
}

module.exports = {
  eventIdFor,
  extractLineMediaEvent,
  isSupportedLineMedia,
  verifyLineWebhookSignature,
};
