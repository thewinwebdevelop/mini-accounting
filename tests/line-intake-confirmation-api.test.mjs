import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createLocalLineIntakeStore } = require("../forms/line-intake.logic.js");

async function waitForServerPort(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("local server did not start")), 5000);
    child.stdout.on("data", chunk => {
      const match = chunk.toString().match(/Expense request local web app: http:\/\/localhost:(\d+)\//);
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    });
    child.once("error", reject);
    child.once("exit", code => reject(new Error(`local server exited with ${code}`)));
  });
}

async function jsonRequest(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  return { response, body: await response.json() };
}

test("LINE intake review scans and confirmation creates one expense draft with original evidence", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-line-confirm-"));
  const store = createLocalLineIntakeStore({ rootDir, maxBytes: 1024 * 1024 });
  const intake = await store.create({
    eventId: "evt-confirm", messageId: "msg-confirm", lineUserId: "U-confirm", mediaKind: "pdf",
    originalName: "invoice.pdf", contentType: "application/pdf", bytes: Buffer.from("%PDF-original"),
  });
  const child = spawn(process.execPath, ["local-server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: "0", SWEET_HOUSE_ROOT_DIR: rootDir, SWEET_HOUSE_AUTH_MODE: "disabled", LINE_INTAKE_BACKEND: "local", LINE_OCR_PROVIDER: "manual" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await waitForServerPort(child);
    const baseUrl = `http://localhost:${port}`;
    const reviewed = await jsonRequest(baseUrl, `/api/line-intakes/${intake.item.id}`);
    assert.equal(reviewed.response.status, 200);
    assert.equal(reviewed.body.intake.ocrStatus, "needs_review");
    assert.equal(reviewed.body.intake.ocrProvider, "manual");
    assert.equal(reviewed.body.intake.storagePath, undefined);

    const incomplete = await jsonRequest(baseUrl, `/api/line-intakes/${intake.item.id}/confirm`, { method: "POST", body: JSON.stringify({}) });
    assert.equal(incomplete.response.status, 400);
    assert.match(incomplete.body.error, /เดือนบัญชี|ชื่อผู้ขอ/);

    const payload = {
      accountingMonth: "2026-09", expenseDate: "2026-09-25", requesterName: "ผู้ทดสอบ",
      businessPurpose: "ค่าใช้จ่ายจาก invoice", paymentTargetName: "ร้านตัวอย่าง", requestType: "reimbursement",
      requestTitle: "Invoice จาก LINE", expenseLines: [{ date: "2026-09-25", description: "ค่าบริการ", amountBeforeVat: "100.00", vatAmount: "7.00", withholdingTax: "0.00", category: "ทั่วไป" }],
    };
    const confirmed = await jsonRequest(baseUrl, `/api/line-intakes/${intake.item.id}/confirm`, { method: "POST", body: JSON.stringify(payload) });
    assert.equal(confirmed.response.status, 200, confirmed.body.error);
    assert.equal(confirmed.body.intake.status, "confirmed");
    assert.equal(confirmed.body.document.status, "draft");
    assert.match(confirmed.body.document.requestNo, /^REQ-2026-09-\d{4}$/);
    const rawPath = join(rootDir, confirmed.body.document.folderPath, "raw", "A1_receipt_001.pdf");
    assert.equal(await readFile(rawPath, "utf8"), "%PDF-original");

    const repeated = await jsonRequest(baseUrl, `/api/line-intakes/${intake.item.id}/confirm`, { method: "POST", body: JSON.stringify(payload) });
    assert.equal(repeated.response.status, 200);
    assert.equal(repeated.body.document.requestNo, confirmed.body.document.requestNo);
    assert.equal(repeated.body.idempotent, true);
  } finally {
    child.kill();
    await new Promise(resolve => child.once("exit", resolve));
    await rm(rootDir, { recursive: true, force: true });
  }
});
