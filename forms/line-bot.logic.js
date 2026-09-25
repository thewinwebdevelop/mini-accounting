async function downloadLineContent({ messageId, accessToken, fetchImpl = fetch, maxBytes = 20 * 1024 * 1024 }) {
  if (!messageId || !accessToken) throw Object.assign(new Error("LINE content configuration is missing"), { code: "LINE_CONTENT_CONFIG_MISSING" });
  const response = await fetchImpl(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw Object.assign(new Error("ไม่สามารถดาวน์โหลดไฟล์จาก LINE ได้"), { code: "LINE_CONTENT_DOWNLOAD_FAILED" });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw Object.assign(new Error("ไฟล์มีขนาดใหญ่เกินกว่าที่ระบบรับได้"), { code: "LINE_INTAKE_TOO_LARGE" });
  return { bytes, contentType: String(response.headers.get("content-type") || "application/octet-stream").split(";", 1)[0] };
}

function buildIntakeReviewReply({ replyToken, intake, miniAppUrl }) {
  const url = new URL(miniAppUrl || "/line-intake", "https://localhost");
  url.searchParams.set("intakeId", intake.id);
  const label = intake.mediaKind === "pdf" ? "PDF" : "รูปภาพ";
  return {
    replyToken,
    messages: [{
      type: "flex",
      altText: "รับไฟล์แล้ว กรุณาตรวจสอบรายการ",
      contents: {
        type: "bubble",
        body: { type: "box", layout: "vertical", spacing: "sm", contents: [
          { type: "text", text: "รับไฟล์แล้ว", weight: "bold", size: "lg" },
          { type: "text", text: `${label}: ${intake.originalName}`, wrap: true, size: "sm" },
          { type: "text", text: `ขนาด ${intake.byteSize} bytes — กรุณาตรวจสอบก่อนสร้างเอกสาร`, wrap: true, size: "sm", color: "#666666" },
        ] },
        footer: { type: "box", layout: "vertical", contents: [{ type: "button", style: "primary", action: { type: "uri", label: "เปิดเพื่อตรวจสอบ", uri: url.toString() } }] },
      },
    }],
  };
}

async function replyToLine({ replyToken, messages, accessToken, fetchImpl = fetch }) {
  if (!replyToken) return { skipped: true };
  if (!accessToken) throw Object.assign(new Error("LINE channel access token is missing"), { code: "LINE_BOT_CONFIG_MISSING" });
  const response = await fetchImpl("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!response.ok) throw Object.assign(new Error("ไม่สามารถส่งข้อความตอบกลับ LINE ได้"), { code: "LINE_REPLY_FAILED" });
  return { sent: true };
}

module.exports = { buildIntakeReviewReply, downloadLineContent, replyToLine };
