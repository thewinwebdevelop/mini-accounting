import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import googleDrive from "../forms/google-drive.logic.js";
import googleSheets from "../forms/google-sheets.logic.js";

const { saveGoogleDriveConfig } = googleDrive;
const { buildExpenseRow, recordMonthlyExpense } = googleSheets;

async function writeValidGoogleAuth(rootDir) {
  await saveGoogleDriveConfig({
    rootDir,
    clientId: "client-id.apps.googleusercontent.com",
    clientSecret: "client-secret",
    driveBasePath: "หจก.สวีทเฮาส์ เดซี่/เอกสารบัญชี",
  });
  await mkdir(join(rootDir, "config"), { recursive: true });
  await writeFile(join(rootDir, "config", "google-drive-token.json"), JSON.stringify({
    access_token: "access-token",
    refresh_token: "refresh-token",
    expiresAt: Date.now() + 3_600_000,
  }));
}

test("recordMonthlyExpense appends a new approved expense row to the monthly sheet", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-sheet-"));
  const calls = [];

  try {
    await writeValidGoogleAuth(rootDir);
    const entry = {
      sourceKey: "expense_request:REQ-2026-09-0001",
      approvedAt: "2026-09-04T10:00:00.000Z",
      accountingMonth: "2026-09",
      documentType: "ใบเบิกจ่าย",
      documentNo: "REQ-2026-09-0001",
      payeeName: "ขนส่งตัวอย่าง",
      title: "ค่าส่งพัสดุ",
      category: "ค่าส่ง/ขนส่ง",
      amountBeforeVat: "100.00",
      vatAmount: "7.00",
      grossAmount: "107.00",
      withholdingTax: "3.00",
      netPayment: "104.00",
      documentUrl: "https://drive.google.com/drive/folders/doc-folder",
    };

    const result = await recordMonthlyExpense({
      rootDir,
      entry,
      now: () => "2026-09-04T10:00:00.000Z",
      fetchImpl: async (url, options = {}) => {
        calls.push({ url: String(url), method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
        const urlText = String(url);
        if (urlText.startsWith("https://www.googleapis.com/drive/v3/files") && options.method === "POST") {
          return { ok: true, json: async () => ({ id: "sheet-2026", webViewLink: "https://docs.google.com/spreadsheets/d/sheet-2026" }) };
        }
        if (urlText.startsWith("https://www.googleapis.com/drive/v3/files?")) {
          if (urlText.includes("application%2Fvnd.google-apps.spreadsheet") || urlText.includes("spreadsheet")) {
            return { ok: true, json: async () => ({ files: [] }) };
          }
          return { ok: true, json: async () => ({ files: [{ id: "expense-folder", webViewLink: "https://drive.google.com/folder" }] }) };
        }
        if (urlText === "https://sheets.googleapis.com/v4/spreadsheets/sheet-2026?fields=sheets.properties") {
          return { ok: true, json: async () => ({ sheets: [{ properties: { title: "Sheet1" } }] }) };
        }
        if (urlText === "https://sheets.googleapis.com/v4/spreadsheets/sheet-2026:batchUpdate") {
          return { ok: true, json: async () => ({ replies: [{}] }) };
        }
        if (urlText.includes("/values/") && options.method === "PUT") {
          return { ok: true, json: async () => ({ updatedRange: "'2026-09'!A1:N1" }) };
        }
        if (urlText.includes("/values/") && (options.method || "GET") === "GET") {
          return { ok: true, json: async () => ({ values: [["Source Key"]] }) };
        }
        if (urlText.includes(":append") && options.method === "POST") {
          return { ok: true, json: async () => ({ updates: { updatedRange: "'2026-09'!A2:N2" } }) };
        }
        throw new Error(`Unexpected URL: ${urlText}`);
      },
    });

    assert.equal(result.syncStatus, "synced");
    assert.equal(result.spreadsheetId, "sheet-2026");
    assert.equal(result.spreadsheetUrl, "https://docs.google.com/spreadsheets/d/sheet-2026");
    assert.equal(result.sheetName, "2026-09");
    assert.equal(result.rowNumber, 2);

    const appendCall = calls.find((call) => call.url.includes(":append"));
    assert.deepEqual(appendCall.body.values, [buildExpenseRow(entry)]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("recordMonthlyExpense updates an existing source key row instead of appending a duplicate", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-sheet-update-"));
  const calls = [];

  try {
    await writeValidGoogleAuth(rootDir);
    const entry = {
      sourceKey: "substitute_receipt:SR-2026-09-0001",
      approvedAt: "2026-09-04T10:00:00.000Z",
      accountingMonth: "2026-09",
      documentType: "ใบรับรองแทนใบเสร็จรับเงิน",
      documentNo: "SR-2026-09-0001",
      payeeName: "บริษัทขายส่งตัวอย่าง",
      title: "ซื้อสต๊อก",
      category: "ซื้อสต๊อกสินค้า",
      amountBeforeVat: "200.00",
      vatAmount: "0.00",
      grossAmount: "200.00",
      withholdingTax: "0.00",
      netPayment: "200.00",
      documentUrl: "",
    };

    const result = await recordMonthlyExpense({
      rootDir,
      entry,
      fetchImpl: async (url, options = {}) => {
        calls.push({ url: String(url), method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
        const urlText = String(url);
        if (urlText.startsWith("https://www.googleapis.com/drive/v3/files?")) {
          return { ok: true, json: async () => ({ files: [{ id: "sheet-2026", webViewLink: "https://docs.google.com/spreadsheets/d/sheet-2026" }] }) };
        }
        if (urlText === "https://sheets.googleapis.com/v4/spreadsheets/sheet-2026?fields=sheets.properties") {
          return { ok: true, json: async () => ({ sheets: [{ properties: { title: "2026-09" } }] }) };
        }
        if (urlText.includes("/values/") && options.method === "PUT") {
          return { ok: true, json: async () => ({ updatedRange: "'2026-09'!A2:N2" }) };
        }
        if (urlText.includes("/values/") && (options.method || "GET") === "GET") {
          return { ok: true, json: async () => ({
            values: [
              ["Source Key"],
              ["substitute_receipt:SR-2026-09-0001", "ข้อมูลเดิม"],
            ],
          }) };
        }
        throw new Error(`Unexpected URL: ${urlText}`);
      },
    });

    assert.equal(result.rowNumber, 2);
    assert.equal(calls.some((call) => call.url.includes(":append")), false);
    const updateCall = calls.find((call) => call.method === "PUT" && call.url.includes("A2%3AN2"));
    assert.deepEqual(updateCall.body.values, [buildExpenseRow(entry)]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
