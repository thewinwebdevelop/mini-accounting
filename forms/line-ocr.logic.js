const OCR_FIELDS = [
  "accountingMonth", "expenseDate", "vendorName", "taxId", "documentNo",
  "description", "amountBeforeVat", "vatAmount", "withholdingTax", "grossAmount",
];

function ocrError(code, message) {
  return Object.assign(new Error(message), { code });
}

function safeFieldValue(value) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/[\r\n\t]+/g, "").trim().slice(0, 500);
}

function normalizeOcrResult(result = {}) {
  const fields = Object.fromEntries(OCR_FIELDS.map(field => [field, safeFieldValue(result.fields?.[field])]));
  const rawConfidence = Number(result.confidence);
  const confidence = Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : 0;
  const warnings = [...new Set((Array.isArray(result.warnings) ? result.warnings : [])
    .filter(item => typeof item === "string")
    .map(item => safeFieldValue(item))
    .filter(Boolean))].slice(0, 10);
  return {
    provider: safeFieldValue(result.provider || "unknown") || "unknown",
    status: "needs_review",
    confidence,
    fields,
    warnings,
  };
}

async function scanLineDocument({
  provider = "manual",
  endpoint = "",
  apiKey = "",
  bytes,
  contentType,
  fileName,
  maxBytes = 20 * 1024 * 1024,
  fetchImpl = fetch,
} = {}) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!buffer.length) throw ocrError("LINE_OCR_INPUT_EMPTY", "ไม่พบข้อมูลไฟล์สำหรับ OCR");
  if (buffer.length > maxBytes) throw ocrError("LINE_OCR_INPUT_TOO_LARGE", "ไฟล์มีขนาดใหญ่เกินกว่าที่ OCR รับได้");
  const normalizedProvider = String(provider || "manual").trim().toLowerCase();
  if (normalizedProvider === "manual") {
    return normalizeOcrResult({
      provider: "manual",
      confidence: 0,
      fields: {},
      warnings: ["ยังไม่ได้ตั้งค่า OCR provider — กรุณาตรวจและกรอกข้อมูลด้วยตนเอง"],
    });
  }
  if (normalizedProvider !== "http") throw ocrError("LINE_OCR_PROVIDER_INVALID", "OCR provider ไม่ถูกต้อง");
  if (!endpoint || !apiKey) throw ocrError("LINE_OCR_CONFIG_MISSING", "OCR endpoint หรือ API key ยังไม่ได้ตั้งค่า");
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ fileName: String(fileName || "upload"), contentType: String(contentType || "application/octet-stream"), base64: buffer.toString("base64") }),
    });
  } catch {
    throw ocrError("LINE_OCR_PROVIDER_FAILED", "ไม่สามารถเชื่อมต่อ OCR provider ได้");
  }
  const rawBody = await response.text().catch(() => "");
  if (!response.ok) throw ocrError("LINE_OCR_PROVIDER_FAILED", "OCR provider ตอบกลับผิดพลาด");
  let data;
  try { data = JSON.parse(rawBody); } catch { throw ocrError("LINE_OCR_RESULT_INVALID", "ผลลัพธ์ OCR ไม่ถูกต้อง"); }
  if (!data || typeof data !== "object" || !data.fields || typeof data.fields !== "object") {
    throw ocrError("LINE_OCR_RESULT_INVALID", "ผลลัพธ์ OCR ไม่ครบถ้วน");
  }
  return normalizeOcrResult({ ...data, provider: "http" });
}

module.exports = { OCR_FIELDS, normalizeOcrResult, scanLineDocument };
