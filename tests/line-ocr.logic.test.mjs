import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  normalizeOcrResult,
  scanLineDocument,
} = require("../forms/line-ocr.logic.js");

test("manual OCR provider returns reviewable empty fields without inventing values", async () => {
  const result = await scanLineDocument({ provider: "manual", bytes: Buffer.from("image"), contentType: "image/jpeg", fileName: "receipt.jpg" });
  assert.deepEqual(result, {
    provider: "manual",
    status: "needs_review",
    confidence: 0,
    fields: {
      accountingMonth: "", expenseDate: "", vendorName: "", taxId: "", documentNo: "",
      description: "", amountBeforeVat: "", vatAmount: "", withholdingTax: "", grossAmount: "",
    },
    warnings: ["ยังไม่ได้ตั้งค่า OCR provider — กรุณาตรวจและกรอกข้อมูลด้วยตนเอง"],
  });
});

test("HTTP OCR provider receives bytes server-side and normalizes the response", async () => {
  let request;
  const result = await scanLineDocument({
    provider: "http",
    endpoint: "https://ocr.example.test/scan",
    apiKey: "ocr-secret",
    bytes: Buffer.from("pdf-bytes"),
    contentType: "application/pdf",
    fileName: "invoice.pdf",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ confidence: 0.91, fields: {
        vendorName: " ร้านตัวอย่าง ", amountBeforeVat: "100.00", vatAmount: "7.00", ignored: "drop-me",
      }, warnings: ["ตรวจเลขผู้เสียภาษี"] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(request.url, "https://ocr.example.test/scan");
  assert.equal(request.options.headers.authorization, "Bearer ocr-secret");
  const body = JSON.parse(request.options.body);
  assert.equal(body.fileName, "invoice.pdf");
  assert.equal(body.contentType, "application/pdf");
  assert.equal(body.base64, Buffer.from("pdf-bytes").toString("base64"));
  assert.equal(result.provider, "http");
  assert.equal(result.status, "needs_review");
  assert.equal(result.confidence, 0.91);
  assert.equal(result.fields.vendorName, "ร้านตัวอย่าง");
  assert.equal(result.fields.amountBeforeVat, "100.00");
  assert.equal(result.fields.ignored, undefined);
  assert.deepEqual(result.warnings, ["ตรวจเลขผู้เสียภาษี"]);
});

test("OCR normalization clamps confidence and does not trust unsafe values", () => {
  const result = normalizeOcrResult({
    provider: "vendor",
    confidence: 4,
    fields: { vendorName: { nested: true }, amountBeforeVat: "1\n<script>", taxId: " 123 " },
    warnings: ["ok", { bad: true }, ""],
  });
  assert.equal(result.confidence, 1);
  assert.equal(result.fields.vendorName, "");
  assert.equal(result.fields.amountBeforeVat, "1<script>");
  assert.equal(result.fields.taxId, "123");
  assert.deepEqual(result.warnings, ["ok"]);
});

test("HTTP OCR provider fails closed on provider errors and malformed responses", async () => {
  await assert.rejects(() => scanLineDocument({
    provider: "http", endpoint: "https://ocr.example.test/scan", apiKey: "secret", bytes: Buffer.from("x"),
    contentType: "image/jpeg", fileName: "x.jpg", fetchImpl: async () => new Response("provider secret", { status: 502 }),
  }), error => error.code === "LINE_OCR_PROVIDER_FAILED" && !error.message.includes("provider secret"));
  await assert.rejects(() => scanLineDocument({
    provider: "http", endpoint: "https://ocr.example.test/scan", apiKey: "secret", bytes: Buffer.from("x"),
    contentType: "image/jpeg", fileName: "x.jpg", fetchImpl: async () => new Response("{}", { status: 200 }),
  }), error => error.code === "LINE_OCR_RESULT_INVALID");
});
