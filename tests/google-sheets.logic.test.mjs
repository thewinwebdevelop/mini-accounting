import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import googleDrive from "../forms/google-drive.logic.js";
import googleSheets from "../forms/google-sheets.logic.js";

const { saveGoogleDriveConfig } = googleDrive;
const {
  buildExpenseRow,
  recordMonthlyExpense,
  findMonthlyExpenseSourceKeyConflicts,
  deleteMonthlyExpenseRowsBySourceKey,
} = googleSheets;

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

function googleOk(body) {
  return { ok: true, json: async () => body };
}

test("deleteMonthlyExpenseRowsBySourceKey deletes one exact row with the resolved numeric sheet id", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-sheet-delete-one-"));
  const calls = [];
  let deleted = false;

  try {
    await writeValidGoogleAuth(rootDir);
    const result = await deleteMonthlyExpenseRowsBySourceKey({
      rootDir,
      accountingMonth: "2026-09",
      sourceKey: "expense_request:REQ-2026-09-0001",
      fetchImpl: async (url, options = {}) => {
        const urlText = String(url);
        const method = options.method || "GET";
        const body = options.body ? JSON.parse(options.body) : null;
        calls.push({ url: urlText, method, body });
        if (urlText.startsWith("https://www.googleapis.com/drive/v3/files?")) {
          const query = new URL(urlText).searchParams.get("q");
          if (query.includes("name = 'รายจ่าย-2026'")) return googleOk({ files: [{ id: "destination" }] });
          return googleOk({ files: [{ id: "folder" }] });
        }
        if (urlText === "https://sheets.googleapis.com/v4/spreadsheets/destination?fields=sheets.properties") {
          return googleOk({ sheets: [{ properties: { title: "2026-09", sheetId: 7 } }] });
        }
        if (urlText.includes("spreadsheets/destination/values/")) {
          return googleOk({ values: deleted ? [["Source Key"]] : [["Source Key"], ["expense_request:REQ-2026-09-0001"]] });
        }
        if (urlText === "https://sheets.googleapis.com/v4/spreadsheets/destination:batchUpdate") {
          deleted = true;
          return googleOk({ replies: [{}] });
        }
        throw new Error(`Unexpected URL: ${urlText}`);
      },
    });

    assert.deepEqual(result, {
      sourceKey: "expense_request:REQ-2026-09-0001",
      status: "deleted",
      deletedCount: 1,
      deletedRows: [{ spreadsheetId: "destination", sheetName: "2026-09", rowNumber: 2 }],
      checkedLocations: [{ spreadsheetId: "destination", sheetName: "2026-09" }],
    });
    const batchCall = calls.find((call) => call.url.endsWith(":batchUpdate"));
    assert.equal(batchCall.method, "POST");
    assert.deepEqual(batchCall.body, {
      requests: [{ deleteDimension: { range: { sheetId: 7, dimension: "ROWS", startIndex: 1, endIndex: 2 } } }],
    });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

function deleteDriveResponse(url, { destination = true, destinationId = "destination" } = {}) {
  const query = new URL(url).searchParams.get("q") || "";
  if (query.includes("name = 'รายจ่าย-2026'")) {
    return googleOk({ files: destination ? [{ id: destinationId }] : [] });
  }
  return googleOk({ files: [{ id: "folder" }] });
}

function sheetIdFromUrl(url) {
  const match = String(url).match(/\/spreadsheets\/([^/?]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

test("deleteMonthlyExpenseRowsBySourceKey deletes duplicate exact rows descending and preserves lookalikes", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-sheet-delete-duplicates-"));
  const key = "substitute_receipt:SR-2026-09-0001";
  const lookalikes = [
    ["substitute_receipt:SR-2026-09-00010"],
    ["SUBSTITUTE_RECEIPT:SR-2026-09-0001"],
    [" substitute_receipt:SR-2026-09-0001"],
    ["substitute_receipt:SR-2026-09-0001 "],
    [key],
    ["workflow_transaction:TXN-2026-09-0001"],
    [key],
  ];
  const calls = [];
  let values = [["Source Key"], ...lookalikes];
  try {
    await writeValidGoogleAuth(rootDir);
    const result = await deleteMonthlyExpenseRowsBySourceKey({
      rootDir,
      accountingMonth: "2026-09",
      sourceKey: key,
      fetchImpl: async (url, options = {}) => {
        const urlText = String(url);
        const method = options.method || "GET";
        const body = options.body ? JSON.parse(options.body) : null;
        calls.push({ url: urlText, method, body });
        if (urlText.startsWith("https://www.googleapis.com/drive/v3/files?")) return deleteDriveResponse(urlText);
        if (urlText.includes("?fields=sheets.properties")) return googleOk({ sheets: [{ properties: { title: "2026-09", sheetId: 17 } }] });
        if (urlText.includes("/values/")) return googleOk({ values });
        if (urlText.endsWith(":batchUpdate")) {
          const ranges = body.requests.map((request) => request.deleteDimension.range);
          assert.deepEqual(ranges.map((range) => range.startIndex), [7, 5]);
          for (const range of ranges) values.splice(range.startIndex, 1);
          return googleOk({ replies: ranges.map(() => ({})) });
        }
        throw new Error(`Unexpected URL: ${urlText}`);
      },
    });
    assert.equal(result.deletedCount, 2);
    assert.deepEqual(values, [["Source Key"], ...lookalikes.filter((row) => row[0] !== key)]);
    assert.equal(calls.filter((call) => call.method === "POST" && call.url.endsWith(":batchUpdate")).length, 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("deleteMonthlyExpenseRowsBySourceKey never deletes the header, treats empty sheets as no-op, and rejects bad headers", async () => {
  for (const [label, values, expectedCode] of [
    ["empty", [], null],
    ["bad-header", [["Wrong Header"], ["expense_request:REQ-2026-09-0001"]], "MONTHLY_EXPENSE_SCHEMA_INVALID"],
  ]) {
    const rootDir = await mkdtemp(join(tmpdir(), `sweet-house-sheet-delete-${label}-`));
    const calls = [];
    try {
      await writeValidGoogleAuth(rootDir);
      const resultOrError = await deleteMonthlyExpenseRowsBySourceKey({
        rootDir,
        accountingMonth: "2026-09",
        sourceKey: "expense_request:REQ-2026-09-0001",
        fetchImpl: async (url, options = {}) => {
          const urlText = String(url);
          calls.push({ url: urlText, method: options.method || "GET" });
          if (urlText.startsWith("https://www.googleapis.com/drive/v3/files?")) return deleteDriveResponse(urlText);
          if (urlText.includes("?fields=sheets.properties")) return googleOk({ sheets: [{ properties: { title: "2026-09", sheetId: 3 } }] });
          if (urlText.includes("/values/")) return googleOk({ values });
          if (urlText.endsWith(":batchUpdate")) return googleOk({ replies: [{}] });
          throw new Error(`Unexpected URL: ${urlText}`);
        },
      }).catch((error) => error);
      if (expectedCode) assert.equal(resultOrError.code, expectedCode);
      else assert.equal(resultOrError.deletedCount, 0);
      assert.equal(calls.some((call) => call.method === "POST" && call.url.endsWith(":batchUpdate")), false);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }
});

test("deleteMonthlyExpenseRowsBySourceKey discovers trusted known locations, deduplicates the destination, and deletes both matches", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-sheet-delete-known-"));
  const calls = [];
  const values = {
    "child-sheet": [["Source Key"], ["expense_request:REQ-2026-09-0001"]],
    destination: [["Source Key"], ["expense_request:REQ-2026-09-0001"]],
  };
  try {
    await writeValidGoogleAuth(rootDir);
    const result = await deleteMonthlyExpenseRowsBySourceKey({
      rootDir,
      accountingMonth: "2026-09",
      sourceKey: "expense_request:REQ-2026-09-0001",
      knownLocations: [
        { spreadsheetId: "child-sheet", sheetName: "child-month" },
        { spreadsheetId: "destination", sheetName: "2026-09" },
        { spreadsheetId: "child-sheet", sheetName: "child-month" },
        {},
      ],
      fetchImpl: async (url, options = {}) => {
        const urlText = String(url);
        calls.push({ url: urlText, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
        if (urlText.startsWith("https://www.googleapis.com/drive/v3/files?")) return deleteDriveResponse(urlText);
        const spreadsheetId = sheetIdFromUrl(urlText);
        if (urlText.includes("?fields=sheets.properties")) return googleOk({ sheets: [{ properties: { title: spreadsheetId === "child-sheet" ? "child-month" : "2026-09", sheetId: spreadsheetId === "child-sheet" ? 8 : 9 } }] });
        if (urlText.includes("/values/")) return googleOk({ values: values[spreadsheetId] });
        if (urlText.endsWith(":batchUpdate")) {
          values[spreadsheetId.replace(/:batchUpdate$/, "")] = [["Source Key"]];
          return googleOk({ replies: [{}] });
        }
        throw new Error(`Unexpected URL: ${urlText}`);
      },
    });
    assert.deepEqual(result.checkedLocations, [
      { spreadsheetId: "child-sheet", sheetName: "child-month" },
      { spreadsheetId: "destination", sheetName: "2026-09" },
    ]);
    assert.equal(result.deletedCount, 2);
    assert.equal(calls.filter((call) => call.method === "POST" && call.url.endsWith(":batchUpdate")).length, 2);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("deleteMonthlyExpenseRowsBySourceKey returns not_found without creating a missing destination", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-sheet-delete-missing-destination-"));
  const calls = [];
  try {
    await writeValidGoogleAuth(rootDir);
    const result = await deleteMonthlyExpenseRowsBySourceKey({
      rootDir,
      accountingMonth: "2026-09",
      sourceKey: "workflow_transaction:TXN-2026-09-0001",
      fetchImpl: async (url, options = {}) => {
        calls.push({ url: String(url), method: options.method || "GET" });
        if (String(url).startsWith("https://www.googleapis.com/drive/v3/files?")) return deleteDriveResponse(String(url), { destination: false });
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    assert.deepEqual(result, {
      sourceKey: "workflow_transaction:TXN-2026-09-0001",
      status: "not_found",
      deletedCount: 0,
      deletedRows: [],
      checkedLocations: [],
    });
    assert.equal(calls.some((call) => call.method !== "GET"), false);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("deleteMonthlyExpenseRowsBySourceKey preflights every known location before any batch mutation", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-sheet-delete-preflight-"));
  const calls = [];
  try {
    await writeValidGoogleAuth(rootDir);
    const error = await deleteMonthlyExpenseRowsBySourceKey({
      rootDir,
      accountingMonth: "2026-09",
      sourceKey: "expense_request:REQ-2026-09-0001",
      knownLocations: [
        { spreadsheetId: "first", sheetName: "2026-09" },
        { spreadsheetId: "unreadable", sheetName: "2026-09" },
      ],
      fetchImpl: async (url, options = {}) => {
        const urlText = String(url);
        calls.push({ url: urlText, method: options.method || "GET" });
        if (urlText.startsWith("https://www.googleapis.com/drive/v3/files?")) return deleteDriveResponse(urlText, { destination: false });
        if (urlText.includes("unreadable?fields=sheets.properties")) return { ok: false, status: 503, json: async () => ({ error: "remote metadata failed" }) };
        if (urlText.includes("?fields=sheets.properties")) return googleOk({ sheets: [{ properties: { title: "2026-09", sheetId: 12 } }] });
        if (urlText.includes("/values/")) return googleOk({ values: [["Source Key"], ["expense_request:REQ-2026-09-0001"]] });
        if (urlText.endsWith(":batchUpdate")) {
          values = [["Source Key"]];
          return googleOk({ replies: [{}] });
        }
        throw new Error(`Unexpected URL: ${urlText}`);
      },
    }).catch((caught) => caught);
    assert.equal(error.code, "MONTHLY_EXPENSE_KNOWN_LOCATION_UNREADABLE");
    assert.equal(calls.some((call) => call.method === "POST" && call.url.endsWith(":batchUpdate")), false);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("deleteMonthlyExpenseRowsBySourceKey fails closed for each configured and trusted-location preflight failure", async () => {
  const cases = [
    {
      name: "missing known tab",
      expectedCode: "MONTHLY_EXPENSE_KNOWN_LOCATION_UNREADABLE",
      knownLocations: [{ spreadsheetId: "known-sheet", sheetName: "2026-09" }],
      fetchImpl: async (url) => {
        const urlText = String(url);
        if (urlText.startsWith("https://www.googleapis.com/drive/v3/files?")) return deleteDriveResponse(urlText, { destination: false });
        if (urlText.includes("known-sheet?fields=sheets.properties")) return googleOk({ sheets: [{ properties: { title: "renamed", sheetId: 31 } }] });
        throw new Error(`Unexpected URL: ${urlText}`);
      },
    },
    {
      name: "known values failure after earlier match",
      expectedCode: "MONTHLY_EXPENSE_KNOWN_LOCATION_UNREADABLE",
      knownLocations: [
        { spreadsheetId: "first-known", sheetName: "2026-09" },
        { spreadsheetId: "second-known", sheetName: "2026-09" },
      ],
      fetchImpl: async (url) => {
        const urlText = String(url);
        if (urlText.startsWith("https://www.googleapis.com/drive/v3/files?")) return deleteDriveResponse(urlText, { destination: false });
        const spreadsheetId = sheetIdFromUrl(urlText);
        if (urlText.includes("?fields=sheets.properties")) return googleOk({ sheets: [{ properties: { title: "2026-09", sheetId: spreadsheetId === "first-known" ? 32 : 33 } }] });
        if (urlText.includes("second-known/values/")) return { ok: false, status: 503, json: async () => ({ error: "known values failure" }) };
        if (urlText.includes("first-known/values/")) return googleOk({ values: [["Source Key"], ["expense_request:REQ-2026-09-0001"]] });
        throw new Error(`Unexpected URL: ${urlText}`);
      },
    },
    {
      name: "configured Drive discovery failure",
      expectedCode: "MONTHLY_EXPENSE_DESTINATION_DISCOVERY_FAILED",
      fetchImpl: async (url) => {
        if (String(url).startsWith("https://www.googleapis.com/drive/v3/files?")) return { ok: false, status: 503, json: async () => ({ error: "drive discovery failure" }) };
        throw new Error(`Unexpected URL: ${url}`);
      },
    },
    {
      name: "configured destination metadata request failure",
      expectedCode: "MONTHLY_EXPENSE_DESTINATION_DISCOVERY_FAILED",
      fetchImpl: async (url) => {
        const urlText = String(url);
        if (urlText.startsWith("https://www.googleapis.com/drive/v3/files?")) return deleteDriveResponse(urlText);
        if (urlText.includes("?fields=sheets.properties")) return { ok: false, status: 503, json: async () => ({ error: "destination metadata failure" }) };
        throw new Error(`Unexpected URL: ${urlText}`);
      },
    },
    {
      name: "configured destination values failure",
      expectedCode: "MONTHLY_EXPENSE_VALUES_READ_FAILED",
      fetchImpl: async (url) => {
        const urlText = String(url);
        if (urlText.startsWith("https://www.googleapis.com/drive/v3/files?")) return deleteDriveResponse(urlText);
        if (urlText.includes("?fields=sheets.properties")) return googleOk({ sheets: [{ properties: { title: "2026-09", sheetId: 34 } }] });
        if (urlText.includes("/values/")) return { ok: false, status: 503, json: async () => ({ error: "destination values failure" }) };
        throw new Error(`Unexpected URL: ${urlText}`);
      },
    },
  ];

  for (const fixture of cases) {
    const rootDir = await mkdtemp(join(tmpdir(), `sweet-house-sheet-delete-preflight-${fixture.name.replace(/\s+/g, "-")}-`));
    const calls = [];
    try {
      await writeValidGoogleAuth(rootDir);
      const error = await deleteMonthlyExpenseRowsBySourceKey({
        rootDir,
        accountingMonth: "2026-09",
        sourceKey: "expense_request:REQ-2026-09-0001",
        knownLocations: fixture.knownLocations,
        fetchImpl: async (url, options = {}) => {
          calls.push({ url: String(url), method: options.method || "GET" });
          return fixture.fetchImpl(url, options);
        },
      }).catch((caught) => caught);
      assert.equal(error.code, fixture.expectedCode, fixture.name);
      assert.equal(calls.some((call) => call.method === "POST" && call.url.endsWith(":batchUpdate")), false, fixture.name);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }
});

test("deleteMonthlyExpenseRowsBySourceKey recomputes the final row after a row moves", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-sheet-delete-reread-"));
  const calls = [];
  let valuesRead = 0;
  try {
    await writeValidGoogleAuth(rootDir);
    const result = await deleteMonthlyExpenseRowsBySourceKey({
      rootDir,
      accountingMonth: "2026-09",
      sourceKey: "expense_request:REQ-2026-09-0001",
      fetchImpl: async (url, options = {}) => {
        const urlText = String(url);
        const body = options.body ? JSON.parse(options.body) : null;
        calls.push({ url: urlText, method: options.method || "GET", body });
        if (urlText.startsWith("https://www.googleapis.com/drive/v3/files?")) return deleteDriveResponse(urlText);
        if (urlText.includes("?fields=sheets.properties")) return googleOk({ sheets: [{ properties: { title: "2026-09", sheetId: 13 } }] });
        if (urlText.includes("/values/")) {
          valuesRead += 1;
          if (valuesRead === 1) return googleOk({ values: [["Source Key"], ["expense_request:REQ-2026-09-0001"], ["other"]] });
          if (valuesRead === 2) return googleOk({ values: [["Source Key"], ["other"], ["expense_request:REQ-2026-09-0001"]] });
          return googleOk({ values: [["Source Key"], ["other"]] });
        }
        if (urlText.endsWith(":batchUpdate")) return googleOk({ replies: [{}] });
        throw new Error(`Unexpected URL: ${urlText}`);
      },
    });
    assert.equal(result.deletedRows[0].rowNumber, 3);
    const batchCall = calls.find((call) => call.url.endsWith(":batchUpdate"));
    assert.equal(batchCall.body.requests[0].deleteDimension.range.startIndex, 2);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("deleteMonthlyExpenseRowsBySourceKey is idempotent and issues no second batch update", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-sheet-delete-idempotent-"));
  let values = [["Source Key"], ["expense_request:REQ-2026-09-0001"]];
  let batchCount = 0;
  try {
    await writeValidGoogleAuth(rootDir);
    const fetchImpl = async (url, options = {}) => {
      const urlText = String(url);
      if (urlText.startsWith("https://www.googleapis.com/drive/v3/files?")) return deleteDriveResponse(urlText);
      if (urlText.includes("?fields=sheets.properties")) return googleOk({ sheets: [{ properties: { title: "2026-09", sheetId: 14 } }] });
      if (urlText.includes("/values/")) return googleOk({ values });
      if (urlText.endsWith(":batchUpdate")) {
        batchCount += 1;
        values = [["Source Key"]];
        return googleOk({ replies: [{}] });
      }
      throw new Error(`Unexpected URL: ${urlText}`);
    };
    const first = await deleteMonthlyExpenseRowsBySourceKey({ rootDir, accountingMonth: "2026-09", sourceKey: "expense_request:REQ-2026-09-0001", fetchImpl });
    const second = await deleteMonthlyExpenseRowsBySourceKey({ rootDir, accountingMonth: "2026-09", sourceKey: "expense_request:REQ-2026-09-0001", fetchImpl });
    assert.equal(first.status, "deleted");
    assert.equal(second.status, "not_found");
    assert.equal(batchCount, 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("deleteMonthlyExpenseRowsBySourceKey serializes different keys at one root and follows shifted rows", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-sheet-delete-queue-"));
  const keyA = "expense_request:REQ-2026-09-0001";
  const keyB = "expense_request:REQ-2026-09-0002";
  let values = [["Source Key"], [keyA], [keyB]];
  const ranges = [];
  try {
    await writeValidGoogleAuth(rootDir);
    const fetchImpl = async (url, options = {}) => {
      const urlText = String(url);
      const body = options.body ? JSON.parse(options.body) : null;
      if (urlText.startsWith("https://www.googleapis.com/drive/v3/files?")) return deleteDriveResponse(urlText);
      if (urlText.includes("?fields=sheets.properties")) return googleOk({ sheets: [{ properties: { title: "2026-09", sheetId: 15 } }] });
      if (urlText.includes("/values/")) return googleOk({ values });
      if (urlText.endsWith(":batchUpdate")) {
        const range = body.requests[0].deleteDimension.range;
        ranges.push(range);
        await new Promise((resolve) => setTimeout(resolve, 10));
        values.splice(range.startIndex, 1);
        return googleOk({ replies: [{}] });
      }
      throw new Error(`Unexpected URL: ${urlText}`);
    };
    const [first, second] = await Promise.all([
      deleteMonthlyExpenseRowsBySourceKey({ rootDir, accountingMonth: "2026-09", sourceKey: keyA, fetchImpl }),
      deleteMonthlyExpenseRowsBySourceKey({ rootDir, accountingMonth: "2026-09", sourceKey: keyB, fetchImpl }),
    ]);
    assert.equal(first.status, "deleted");
    assert.equal(second.status, "deleted");
    assert.deepEqual(ranges.map((range) => range.startIndex), [1, 1]);
    assert.deepEqual(values, [["Source Key"]]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("deleteMonthlyExpenseRowsBySourceKey returns safe partial metadata and retries the remaining location", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-sheet-delete-partial-"));
  const key = "expense_request:REQ-2026-09-0001";
  const values = {
    first: [["Source Key"], [key]],
    second: [["Source Key"], [key]],
  };
  let failSecond = true;
  const batches = [];
  try {
    await writeValidGoogleAuth(rootDir);
    const fetchImpl = async (url, options = {}) => {
      const urlText = String(url);
      const body = options.body ? JSON.parse(options.body) : null;
      if (urlText.startsWith("https://www.googleapis.com/drive/v3/files?")) return deleteDriveResponse(urlText, { destination: false });
      const spreadsheetId = sheetIdFromUrl(urlText);
      const baseSpreadsheetId = spreadsheetId.replace(/:batchUpdate$/, "");
      if (urlText.includes("?fields=sheets.properties")) return googleOk({ sheets: [{ properties: { title: "2026-09", sheetId: spreadsheetId === "first" ? 21 : 22 } }] });
      if (urlText.includes("/values/")) return googleOk({ values: values[baseSpreadsheetId] });
      if (urlText.endsWith(":batchUpdate")) {
        batches.push(baseSpreadsheetId);
        if (baseSpreadsheetId === "second" && failSecond) return { ok: false, status: 503, json: async () => ({ error: "raw should not escape" }) };
        values[baseSpreadsheetId] = [["Source Key"]];
        return googleOk({ replies: [{}] });
      }
      throw new Error(`Unexpected URL: ${urlText}`);
    };
    const firstError = await deleteMonthlyExpenseRowsBySourceKey({
      rootDir,
      accountingMonth: "2026-09",
      sourceKey: key,
      knownLocations: [{ spreadsheetId: "first", sheetName: "2026-09" }, { spreadsheetId: "second", sheetName: "2026-09" }],
      fetchImpl,
    }).catch((error) => error);
    assert.equal(firstError.code, "MONTHLY_EXPENSE_BATCH_DELETE_FAILED");
    assert.deepEqual(firstError.partialResult, {
      sourceKey: key,
      status: "deleted",
      deletedCount: 1,
      deletedRows: [{ spreadsheetId: "first", sheetName: "2026-09", rowNumber: 2 }],
      checkedLocations: [{ spreadsheetId: "first", sheetName: "2026-09" }],
    });
    assert.equal(JSON.stringify(firstError).includes("raw should not escape"), false);
    failSecond = false;
    const retry = await deleteMonthlyExpenseRowsBySourceKey({
      rootDir,
      accountingMonth: "2026-09",
      sourceKey: key,
      knownLocations: [{ spreadsheetId: "first", sheetName: "2026-09" }, { spreadsheetId: "second", sheetName: "2026-09" }],
      fetchImpl,
    });
    assert.equal(retry.deletedCount, 1);
    assert.deepEqual(batches, ["first", "second", "second"]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("deleteMonthlyExpenseRowsBySourceKey reports a stable post-delete verification error", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-sheet-delete-verify-"));
  const key = "expense_request:REQ-2026-09-0001";
  try {
    await writeValidGoogleAuth(rootDir);
    const error = await deleteMonthlyExpenseRowsBySourceKey({
      rootDir,
      accountingMonth: "2026-09",
      sourceKey: key,
      fetchImpl: async (url, options = {}) => {
        const urlText = String(url);
        if (urlText.startsWith("https://www.googleapis.com/drive/v3/files?")) return deleteDriveResponse(urlText);
        if (urlText.includes("?fields=sheets.properties")) return googleOk({ sheets: [{ properties: { title: "2026-09", sheetId: 23 } }] });
        if (urlText.includes("/values/")) return googleOk({ values: [["Source Key"], [key]] });
        if (urlText.endsWith(":batchUpdate")) {
          return googleOk({ replies: [{}] });
        }
        throw new Error(`Unexpected URL: ${urlText}`);
      },
    }).catch((caught) => caught);
    assert.equal(error.code, "MONTHLY_EXPENSE_POST_DELETE_VERIFICATION_FAILED");
    assert.equal(error.partialResult.deletedCount, 0);
    assert.equal(error.message.includes("access-token"), false);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("deleteMonthlyExpenseRowsBySourceKey rejects invalid inputs before authentication", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-sheet-delete-invalid-"));
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount += 1;
    throw new Error("fetch must not run");
  };
  try {
    for (const input of [
      { accountingMonth: "2026-09", sourceKey: "unknown:REQ-2026-09-0001" },
      { accountingMonth: "2026-09", sourceKey: " expense_request:REQ-2026-09-0001" },
      { accountingMonth: "2026-09", sourceKey: "expense_request:REQ-2026-09-0001,substitute_receipt:SR-2026-09-0002" },
      { accountingMonth: "2026-09", sourceKey: "expense_request:REQ-2026-09-ABCD" },
      { accountingMonth: "2026-09", sourceKey: "substitute_receipt:SR-2026-09-0001.extra" },
      { accountingMonth: "2026-09", sourceKey: "workflow_transaction:TXN-2026-09-0001_extra" },
      { accountingMonth: "2026-09", sourceKey: "expense_request:REQ-2026-09-0001-extra" },
      { accountingMonth: "2026-09", sourceKey: "expense_request:REQ-2026-09-001" },
      { accountingMonth: "2026-09", sourceKey: "expense_request:REQ-2026-09-0000" },
      { accountingMonth: "2026-9", sourceKey: "expense_request:REQ-2026-09-0001" },
      { accountingMonth: "2026-09", sourceKey: "expense_request:REQ-2025-09-0001" },
    ]) {
      const error = await deleteMonthlyExpenseRowsBySourceKey({ rootDir, ...input, fetchImpl }).catch((caught) => caught);
      assert.match(error.code, /INVALID_MONTHLY_EXPENSE/);
    }
    const arrayError = await deleteMonthlyExpenseRowsBySourceKey({ rootDir, accountingMonth: "2026-09", sourceKey: ["expense_request:REQ-2026-09-0001"], fetchImpl }).catch((caught) => caught);
    assert.equal(arrayError.code, "INVALID_MONTHLY_EXPENSE_SOURCE_KEY");
    const partialLocationError = await deleteMonthlyExpenseRowsBySourceKey({
      rootDir,
      accountingMonth: "2026-09",
      sourceKey: "expense_request:REQ-2026-09-0001",
      knownLocations: [{ spreadsheetId: "trusted-sheet", sheetName: "" }],
      fetchImpl,
    }).catch((caught) => caught);
    assert.equal(partialLocationError.code, "INVALID_MONTHLY_EXPENSE_LOCATION");
    assert.equal(fetchCount, 0);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("deleteMonthlyExpenseRowsBySourceKey permits only OAuth refresh POST and one deleteDimension mutation", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-sheet-delete-methods-"));
  const calls = [];
  let values = [["Source Key"], ["expense_request:REQ-2026-09-0001"]];
  try {
    await writeValidGoogleAuth(rootDir);
    const result = await deleteMonthlyExpenseRowsBySourceKey({
      rootDir,
      accountingMonth: "2026-09",
      sourceKey: "expense_request:REQ-2026-09-0001",
      fetchImpl: async (url, options = {}) => {
        const urlText = String(url);
        const method = options.method || "GET";
        const body = options.body ? JSON.parse(options.body) : null;
        calls.push({ url: urlText, method, body });
        if (urlText.startsWith("https://www.googleapis.com/drive/v3/files?")) return deleteDriveResponse(urlText);
        if (urlText.includes("?fields=sheets.properties")) return googleOk({ sheets: [{ properties: { title: "2026-09", sheetId: 24 } }] });
        if (urlText.includes("/values/")) return googleOk({ values });
        if (urlText.endsWith(":batchUpdate")) {
          values = [["Source Key"]];
          return googleOk({ replies: [{}] });
        }
        throw new Error(`Unexpected URL: ${urlText}`);
      },
    });
    assert.equal(result.status, "deleted");
    assert.equal(calls.filter((call) => call.method === "POST").length, 1);
    const batch = calls.find((call) => call.url.endsWith(":batchUpdate"));
    assert.deepEqual(batch.body.requests.map((request) => Object.keys(request)), [["deleteDimension"]]);
    assert.equal(calls.some((call) => call.method === "PUT" || call.url.includes(":append") || call.body?.requests?.some((request) => !request.deleteDimension)), false);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("findMonthlyExpenseSourceKeyConflicts reads configured and known locations with GET only", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-sheet-conflicts-"));
  const calls = [];

  try {
    await writeValidGoogleAuth(rootDir);
    const result = await findMonthlyExpenseSourceKeyConflicts({
      rootDir,
      accountingMonth: "2026-09",
      sourceKeys: ["expense_request:REQ-1", "expense_request:REQ-1", "substitute_receipt:SR-2"],
      knownLocations: [
        { spreadsheetId: "child-sheet", sheetName: "child-month" },
        { spreadsheetId: "child-sheet", sheetName: "child-month" },
        {},
      ],
      fetchImpl: async (url, options = {}) => {
        const urlText = String(url);
        calls.push({ url: urlText, method: options.method || "GET" });
        if (urlText.startsWith("https://www.googleapis.com/drive/v3/files?")) {
          const query = new URL(urlText).searchParams.get("q");
          if (query.includes("name = 'หจก.สวีทเฮาส์ เดซี่'")) return googleOk({ files: [{ id: "base" }] });
          if (query.includes("name = 'เอกสารบัญชี'")) return googleOk({ files: [{ id: "accounting" }] });
          if (query.includes("name = 'รายจ่ายรายเดือน'")) return googleOk({ files: [{ id: "expenses" }] });
          if (query.includes("name = 'รายจ่าย-2026'")) return googleOk({ files: [{ id: "destination" }] });
          throw new Error(`Unexpected Drive query: ${query}`);
        }
        if (urlText === "https://sheets.googleapis.com/v4/spreadsheets/destination?fields=sheets.properties") {
          return googleOk({ sheets: [{ properties: { title: "2026-09" } }] });
        }
        if (urlText.includes("spreadsheets/child-sheet/values/")) {
          return googleOk({ values: [["Source Key"], ["expense_request:REQ-1"], ["expense_request:REQ-1"]] });
        }
        if (urlText.includes("spreadsheets/destination/values/")) {
          return googleOk({ values: [["Source Key"], ["substitute_receipt:SR-2"], ["expense_request:REQ-10"]] });
        }
        throw new Error(`Unexpected URL: ${urlText}`);
      },
    });

    assert.deepEqual(result.checkedLocations, [
      { spreadsheetId: "child-sheet", sheetName: "child-month" },
      { spreadsheetId: "destination", sheetName: "2026-09" },
    ]);
    assert.deepEqual(result.conflicts, [
      { sourceKey: "expense_request:REQ-1", spreadsheetId: "child-sheet", sheetName: "child-month", rowNumber: 2 },
      { sourceKey: "expense_request:REQ-1", spreadsheetId: "child-sheet", sheetName: "child-month", rowNumber: 3 },
      { sourceKey: "substitute_receipt:SR-2", spreadsheetId: "destination", sheetName: "2026-09", rowNumber: 2 },
    ]);
    assert.equal(calls.every((call) => call.method === "GET"), true);
    assert.equal(calls.some((call) => /:append|:batchUpdate/.test(call.url)), false);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("findMonthlyExpenseSourceKeyConflicts treats an absent destination as clear without creating it", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-sheet-absent-"));
  const calls = [];
  try {
    await writeValidGoogleAuth(rootDir);
    const result = await findMonthlyExpenseSourceKeyConflicts({
      rootDir,
      accountingMonth: "2026-09",
      sourceKeys: ["expense_request:REQ-1"],
      fetchImpl: async (url, options = {}) => {
        calls.push({ url: String(url), method: options.method || "GET" });
        return googleOk({ files: [] });
      },
    });
    assert.deepEqual(result, { conflicts: [], checkedLocations: [] });
    assert.equal(calls.every((call) => call.method === "GET"), true);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("findMonthlyExpenseSourceKeyConflicts treats an existing destination month without exact keys as clear", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-sheet-clear-"));
  try {
    await writeValidGoogleAuth(rootDir);
    const result = await findMonthlyExpenseSourceKeyConflicts({
      rootDir,
      accountingMonth: "2026-09",
      sourceKeys: ["expense_request:REQ-1"],
      fetchImpl: async (url) => {
        const urlText = String(url);
        if (urlText.startsWith("https://www.googleapis.com/drive/v3/files?")) {
          const query = new URL(urlText).searchParams.get("q");
          if (query.includes("รายจ่าย-2026")) return googleOk({ files: [{ id: "destination" }] });
          return googleOk({ files: [{ id: "folder" }] });
        }
        if (urlText.includes("?fields=sheets.properties")) return googleOk({ sheets: [{ properties: { title: "2026-09" } }] });
        if (urlText.includes("/values/")) return googleOk({ values: [["Source Key"], ["expense_request:REQ-10"]] });
        throw new Error(`Unexpected URL: ${urlText}`);
      },
    });
    assert.deepEqual(result, {
      conflicts: [],
      checkedLocations: [{ spreadsheetId: "destination", sheetName: "2026-09" }],
    });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("findMonthlyExpenseSourceKeyConflicts fails closed for malformed or unreadable known references and read failures", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-sheet-fail-"));
  try {
    await writeValidGoogleAuth(rootDir);
    await assert.rejects(() => findMonthlyExpenseSourceKeyConflicts({
      rootDir,
      accountingMonth: "2026-09",
      sourceKeys: ["expense_request:REQ-1"],
      knownLocations: [{ spreadsheetId: "child-sheet", sheetName: "" }],
      fetchImpl: async () => googleOk({}),
    }), /Invalid known monthly expense location/);
    await assert.rejects(() => findMonthlyExpenseSourceKeyConflicts({
      rootDir,
      accountingMonth: "2026-09",
      sourceKeys: ["expense_request:REQ-1"],
      knownLocations: [{ spreadsheetId: "child-sheet", sheetName: "2025-08" }],
      fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ error: { message: "read failed" } }) }),
    }), /read failed/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("findMonthlyExpenseSourceKeyConflicts fails closed when destination discovery, metadata, or values reads fail", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-sheet-destination-fail-"));
  const fail = () => ({ ok: false, status: 503, json: async () => ({ error: "remote read failed" }) });
  try {
    await writeValidGoogleAuth(rootDir);
    await assert.rejects(() => findMonthlyExpenseSourceKeyConflicts({
      rootDir,
      accountingMonth: "2026-09",
      sourceKeys: ["expense_request:REQ-1"],
      fetchImpl: async () => fail(),
    }), /remote read failed/);

    for (const failingPart of ["metadata", "values"]) {
      await assert.rejects(() => findMonthlyExpenseSourceKeyConflicts({
        rootDir,
        accountingMonth: "2026-09",
        sourceKeys: ["expense_request:REQ-1"],
        fetchImpl: async (url) => {
          const urlText = String(url);
          if (urlText.startsWith("https://www.googleapis.com/drive/v3/files?")) {
            const query = new URL(urlText).searchParams.get("q");
            return googleOk({ files: [{ id: query.includes("รายจ่าย-2026") ? "destination" : "folder" }] });
          }
          if (urlText.includes("?fields=sheets.properties")) return failingPart === "metadata" ? fail() : googleOk({ sheets: [{ properties: { title: "2026-09" } }] });
          if (urlText.includes("/values/")) return fail();
          throw new Error(`Unexpected URL: ${urlText}`);
        },
      }), /remote read failed/);
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("findMonthlyExpenseSourceKeyConflicts permits only OAuth refresh POST when the token is expired", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-sheet-refresh-"));
  const calls = [];
  try {
    await writeValidGoogleAuth(rootDir);
    await writeFile(join(rootDir, "config", "google-drive-token.json"), JSON.stringify({
      access_token: "expired-token",
      refresh_token: "refresh-token",
      expiresAt: 0,
    }));
    await findMonthlyExpenseSourceKeyConflicts({
      rootDir,
      accountingMonth: "2026-09",
      sourceKeys: ["expense_request:REQ-1"],
      fetchImpl: async (url, options = {}) => {
        const urlText = String(url);
        calls.push({ url: urlText, method: options.method || "GET" });
        if (urlText === "https://oauth2.googleapis.com/token") return googleOk({ access_token: "fresh-token", expires_in: 3600 });
        if (urlText.startsWith("https://www.googleapis.com/drive/v3/files?")) return googleOk({ files: [] });
        throw new Error(`Unexpected URL: ${urlText}`);
      },
    });
    assert.deepEqual(calls.map((call) => call.method), ["POST", "GET"]);
    assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
