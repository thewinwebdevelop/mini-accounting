const {
  driveFetchJson,
  ensureDrivePath,
  getGoogleDriveConfig,
  getValidAccessToken,
  splitDrivePath,
} = require("./google-drive.logic.js");
const path = require("node:path");

const spreadsheetMimeType = "application/vnd.google-apps.spreadsheet";
const expenseSheetFolderName = "รายจ่ายรายเดือน";
const expenseHeaders = [
  "Source Key",
  "วันที่อนุมัติ",
  "เดือนบัญชี",
  "ประเภทเอกสาร",
  "เลขเอกสาร",
  "ผู้รับเงิน/ผู้ขอ",
  "รายการ",
  "หมวด",
  "ยอดก่อน VAT",
  "VAT",
  "ยอดรวม",
  "หัก ณ ที่จ่าย",
  "ยอดจ่ายสุทธิ",
  "ลิงก์เอกสาร",
];

function escapeSheetName(sheetName) {
  return `'${String(sheetName).replace(/'/g, "''")}'`;
}

function escapeDriveQueryValue(value = "") {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function getAccountingYear(accountingMonth = "") {
  const year = String(accountingMonth).split("-")[0];
  if (!/^\d{4}$/.test(year)) throw new Error("Invalid accounting month");
  return year;
}

function buildSpreadsheetTitle(accountingMonth) {
  return `รายจ่าย-${getAccountingYear(accountingMonth)}`;
}

async function findExpenseSpreadsheet({ accessToken, fetchImpl, title, parentId }) {
  const query = [
    `'${escapeDriveQueryValue(parentId)}' in parents`,
    `name = '${escapeDriveQueryValue(title)}'`,
    `mimeType = '${spreadsheetMimeType}'`,
    "trashed = false",
  ].join(" and ");
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", query);
  url.searchParams.set("fields", "files(id,name,webViewLink)");
  url.searchParams.set("pageSize", "1");
  const data = await driveFetchJson({ accessToken, fetchImpl, url: url.toString() });
  return data.files?.[0] || null;
}

async function findDriveFolderReadOnly({ accessToken, fetchImpl, name, parentId }) {
  const query = [
    `'${escapeDriveQueryValue(parentId)}' in parents`,
    `name = '${escapeDriveQueryValue(name)}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
  ].join(" and ");
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", query);
  url.searchParams.set("fields", "files(id,name,webViewLink)");
  url.searchParams.set("pageSize", "1");
  const data = await driveFetchJson({ accessToken, fetchImpl, url: url.toString() });
  return data.files?.[0] || null;
}

async function findExpenseSpreadsheetReadOnly({ rootDir, accessToken, fetchImpl, accountingMonth }) {
  const config = await getGoogleDriveConfig(rootDir);
  let parentId = "root";
  for (const name of [
    ...splitDrivePath(config?.driveBasePath || "หจก.สวีทเฮาส์ เดซี่/เอกสารบัญชี"),
    expenseSheetFolderName,
  ]) {
    const folder = await findDriveFolderReadOnly({ accessToken, fetchImpl, name, parentId });
    if (!folder) return null;
    parentId = folder.id;
  }
  return findExpenseSpreadsheet({
    accessToken,
    fetchImpl,
    title: buildSpreadsheetTitle(accountingMonth),
    parentId,
  });
}

async function createExpenseSpreadsheet({ accessToken, fetchImpl, title, parentId }) {
  return driveFetchJson({
    accessToken,
    fetchImpl,
    url: "https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink",
    options: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: title,
        mimeType: spreadsheetMimeType,
        parents: [parentId],
      }),
    },
  });
}

async function ensureExpenseSpreadsheet({ rootDir, accessToken, fetchImpl, accountingMonth }) {
  const config = await getGoogleDriveConfig(rootDir);
  const folder = await ensureDrivePath({
    accessToken,
    fetchImpl,
    pathParts: [
      ...splitDrivePath(config?.driveBasePath || "หจก.สวีทเฮาส์ เดซี่/เอกสารบัญชี"),
      expenseSheetFolderName,
    ],
  });
  const title = buildSpreadsheetTitle(accountingMonth);
  const spreadsheet = await findExpenseSpreadsheet({
    accessToken,
    fetchImpl,
    title,
    parentId: folder.id,
  }) || await createExpenseSpreadsheet({
    accessToken,
    fetchImpl,
    title,
    parentId: folder.id,
  });

  return {
    spreadsheetId: spreadsheet.id,
    spreadsheetUrl: spreadsheet.webViewLink || `https://docs.google.com/spreadsheets/d/${spreadsheet.id}`,
  };
}

async function sheetsFetchJson({ accessToken, fetchImpl, url, options = {} }) {
  const headers = {
    authorization: `Bearer ${accessToken}`,
    ...(options.headers || {}),
  };
  const response = await fetchImpl(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || data.error || `Google Sheets API request failed: ${response.status}`);
  }
  return data;
}

async function ensureMonthlySheet({ accessToken, fetchImpl, spreadsheetId, sheetName }) {
  const metadata = await sheetsFetchJson({
    accessToken,
    fetchImpl,
    url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`,
  });
  const exists = (metadata.sheets || []).some((sheet) => sheet.properties?.title === sheetName);
  if (!exists) {
    await sheetsFetchJson({
      accessToken,
      fetchImpl,
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      options: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] }),
      },
    });
  }
  await updateValues({
    accessToken,
    fetchImpl,
    spreadsheetId,
    range: `${escapeSheetName(sheetName)}!A1:N1`,
    values: [expenseHeaders],
  });
}

async function getValues({ accessToken, fetchImpl, spreadsheetId, range }) {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`);
  const data = await sheetsFetchJson({ accessToken, fetchImpl, url: url.toString() });
  return data.values || [];
}

function normalizeSourceKeys(sourceKeys) {
  const keys = [...new Set((sourceKeys || []).map((key) => String(key || "").trim()).filter(Boolean))];
  if (!keys.length) throw new Error("Missing monthly expense source keys");
  return keys;
}

function normalizeKnownLocations(knownLocations = []) {
  const locations = [];
  const seen = new Set();
  for (const reference of knownLocations) {
    const spreadsheetId = String(reference?.spreadsheetId || "").trim();
    const sheetName = String(reference?.sheetName || "").trim();
    if (!spreadsheetId && !sheetName) continue;
    if (!spreadsheetId || !sheetName) throw new Error("Invalid known monthly expense location");
    const key = `${spreadsheetId}\u0000${sheetName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push({ spreadsheetId, sheetName });
  }
  return locations;
}

async function findMonthlyExpenseSourceKeyConflicts({
  rootDir,
  accountingMonth,
  sourceKeys,
  knownLocations = [],
  fetchImpl = fetch,
}) {
  const keys = normalizeSourceKeys(sourceKeys);
  const keySet = new Set(keys);
  const accessToken = await getValidAccessToken({ rootDir, fetchImpl });
  const locations = normalizeKnownLocations(knownLocations);
  const checkedLocations = [];
  const conflicts = [];
  const inspected = new Set();

  async function inspectLocation(location) {
    const locationKey = `${location.spreadsheetId}\u0000${location.sheetName}`;
    if (inspected.has(locationKey)) return;
    const values = await getValues({
      accessToken,
      fetchImpl,
      spreadsheetId: location.spreadsheetId,
      range: `${escapeSheetName(location.sheetName)}!A:A`,
    });
    inspected.add(locationKey);
    checkedLocations.push(location);
    values.forEach((row, index) => {
      const sourceKey = String(row?.[0] || "");
      if (keySet.has(sourceKey)) {
        conflicts.push({ ...location, sourceKey, rowNumber: index + 1 });
      }
    });
  }

  for (const location of locations) await inspectLocation(location);

  const destination = await findExpenseSpreadsheetReadOnly({
    rootDir,
    accessToken,
    fetchImpl,
    accountingMonth,
  });
  if (destination) {
    const sheetName = String(accountingMonth);
    const metadata = await sheetsFetchJson({
      accessToken,
      fetchImpl,
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(destination.id)}?fields=sheets.properties`,
    });
    if ((metadata.sheets || []).some((sheet) => sheet.properties?.title === sheetName)) {
      await inspectLocation({ spreadsheetId: destination.id, sheetName });
    }
  }

  return { conflicts, checkedLocations };
}

async function updateValues({ accessToken, fetchImpl, spreadsheetId, range, values }) {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`);
  url.searchParams.set("valueInputOption", "USER_ENTERED");
  return sheetsFetchJson({
    accessToken,
    fetchImpl,
    url: url.toString(),
    options: {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ values }),
    },
  });
}

async function appendValues({ accessToken, fetchImpl, spreadsheetId, range, values }) {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append`);
  url.searchParams.set("valueInputOption", "USER_ENTERED");
  url.searchParams.set("insertDataOption", "INSERT_ROWS");
  return sheetsFetchJson({
    accessToken,
    fetchImpl,
    url: url.toString(),
    options: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ values }),
    },
  });
}

function buildExpenseRow(entry = {}) {
  return [
    entry.sourceKey || "",
    entry.approvedAt || "",
    entry.accountingMonth || "",
    entry.documentType || "",
    entry.documentNo || "",
    entry.payeeName || "",
    entry.title || "",
    entry.category || "",
    entry.amountBeforeVat || "0.00",
    entry.vatAmount || "0.00",
    entry.grossAmount || "0.00",
    entry.withholdingTax || "0.00",
    entry.netPayment || "0.00",
    entry.documentUrl || "",
  ];
}

function getRowNumberFromUpdatedRange(updatedRange = "") {
  const match = String(updatedRange).match(/![A-Z]+(\d+):/);
  return match ? Number(match[1]) : 0;
}

async function recordMonthlyExpense({
  rootDir,
  entry,
  fetchImpl = fetch,
  now = () => new Date().toISOString(),
}) {
  if (!entry?.sourceKey) throw new Error("Missing monthly expense source key");
  if (!entry?.accountingMonth) throw new Error("Missing accounting month");

  const accessToken = await getValidAccessToken({ rootDir, fetchImpl });
  const { spreadsheetId, spreadsheetUrl } = await ensureExpenseSpreadsheet({
    rootDir,
    accessToken,
    fetchImpl,
    accountingMonth: entry.accountingMonth,
  });
  const sheetName = entry.accountingMonth;
  await ensureMonthlySheet({ accessToken, fetchImpl, spreadsheetId, sheetName });

  const rows = await getValues({
    accessToken,
    fetchImpl,
    spreadsheetId,
    range: `${escapeSheetName(sheetName)}!A:N`,
  });
  const row = buildExpenseRow(entry);
  const existingIndex = rows.findIndex((existingRow, index) => index > 0 && existingRow[0] === entry.sourceKey);
  let rowNumber = existingIndex >= 0 ? existingIndex + 1 : rows.length + 1;

  if (existingIndex >= 0) {
    await updateValues({
      accessToken,
      fetchImpl,
      spreadsheetId,
      range: `${escapeSheetName(sheetName)}!A${rowNumber}:N${rowNumber}`,
      values: [row],
    });
  } else {
    const appendResult = await appendValues({
      accessToken,
      fetchImpl,
      spreadsheetId,
      range: `${escapeSheetName(sheetName)}!A:N`,
      values: [row],
    });
    rowNumber = getRowNumberFromUpdatedRange(appendResult.updates?.updatedRange) || rowNumber;
  }

  const syncedAt = now();
  return {
    syncStatus: "synced",
    spreadsheetId,
    spreadsheetUrl,
    sheetName,
    rowNumber,
    syncedAt,
    updatedAt: syncedAt,
  };
}

const monthlyExpenseDeletionQueues = new Map();
const monthlyExpenseSourceKeyPattern = /^(expense_request:REQ|substitute_receipt:SR|workflow_transaction:TXN)-(\d{4}-\d{2})-([A-Za-z0-9][A-Za-z0-9._-]{3,})$/;

function monthlyExpenseDeletionError(code, message, partialResult) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.stack = `${error.name}: ${error.message}`;
  if (partialResult) error.partialResult = partialResult;
  return error;
}

function normalizeDeletionInput({ rootDir, accountingMonth, sourceKey, knownLocations = [] }) {
  if (typeof rootDir !== "string" || !rootDir.trim()) {
    throw monthlyExpenseDeletionError("INVALID_MONTHLY_EXPENSE_DELETE_INPUT", "Invalid root directory");
  }
  if (typeof accountingMonth !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(accountingMonth)) {
    throw monthlyExpenseDeletionError("INVALID_MONTHLY_EXPENSE_MONTH", "Invalid accounting month");
  }
  if (typeof sourceKey !== "string" || sourceKey.trim() !== sourceKey || sourceKey.includes(",") || !sourceKey) {
    throw monthlyExpenseDeletionError("INVALID_MONTHLY_EXPENSE_SOURCE_KEY", "Invalid source key");
  }
  const sourceKeyMatch = sourceKey.match(monthlyExpenseSourceKeyPattern);
  if (!sourceKeyMatch || sourceKeyMatch[2] !== accountingMonth) {
    throw monthlyExpenseDeletionError("INVALID_MONTHLY_EXPENSE_SOURCE_KEY", "Invalid source key or month mismatch");
  }
  if (!Array.isArray(knownLocations)) {
    throw monthlyExpenseDeletionError("INVALID_MONTHLY_EXPENSE_LOCATION", "Invalid known monthly expense locations");
  }

  const locations = [];
  const seen = new Set();
  for (const reference of knownLocations) {
    if (reference == null || typeof reference !== "object") {
      if (reference == null) continue;
      throw monthlyExpenseDeletionError("INVALID_MONTHLY_EXPENSE_LOCATION", "Invalid known monthly expense location");
    }
    const rawSpreadsheetId = reference.spreadsheetId;
    const rawSheetName = reference.sheetName;
    if ((rawSpreadsheetId == null || rawSpreadsheetId === "") && (rawSheetName == null || rawSheetName === "")) continue;
    if (typeof rawSpreadsheetId !== "string" || typeof rawSheetName !== "string") {
      throw monthlyExpenseDeletionError("INVALID_MONTHLY_EXPENSE_LOCATION", "Invalid known monthly expense location");
    }
    const spreadsheetId = rawSpreadsheetId.trim();
    const sheetName = rawSheetName.trim();
    if (!spreadsheetId || !sheetName) {
      throw monthlyExpenseDeletionError("INVALID_MONTHLY_EXPENSE_LOCATION", "Invalid known monthly expense location");
    }
    const locationKey = `${spreadsheetId}\u0000${sheetName}`;
    if (seen.has(locationKey)) continue;
    seen.add(locationKey);
    locations.push({ spreadsheetId, sheetName, kind: "known" });
  }

  return { rootDir, accountingMonth, sourceKey, locations };
}

async function readMonthlyExpenseSheetMetadata({ accessToken, fetchImpl, spreadsheetId }) {
  return sheetsFetchJson({
    accessToken,
    fetchImpl,
    url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`,
  });
}

function resolveMonthlyExpenseSheetId(metadata, sheetName) {
  const sheet = (metadata?.sheets || []).find((candidate) => candidate?.properties?.title === sheetName);
  const sheetId = sheet?.properties?.sheetId;
  if (!sheet || !Number.isSafeInteger(sheetId)) {
    throw monthlyExpenseDeletionError("MONTHLY_EXPENSE_SHEET_METADATA_INVALID", "Monthly expense sheet could not be resolved");
  }
  return sheetId;
}

async function discoverMonthlyExpenseDeletionLocations({ rootDir, accountingMonth, accessToken, fetchImpl, locations }) {
  const discovered = [...locations];
  const seen = new Set(locations.map((location) => `${location.spreadsheetId}\u0000${location.sheetName}`));
  let destination;
  try {
    destination = await findExpenseSpreadsheetReadOnly({
      rootDir,
      accessToken,
      fetchImpl,
      accountingMonth,
    });
  } catch {
    throw monthlyExpenseDeletionError("MONTHLY_EXPENSE_DESTINATION_DISCOVERY_FAILED", "Expense destination discovery failed");
  }

  if (!destination) return discovered;
  if (typeof destination.id !== "string" || !destination.id) {
    throw monthlyExpenseDeletionError("MONTHLY_EXPENSE_DESTINATION_DISCOVERY_FAILED", "Expense destination discovery failed");
  }

  let metadata;
  try {
    metadata = await readMonthlyExpenseSheetMetadata({ accessToken, fetchImpl, spreadsheetId: destination.id });
    resolveMonthlyExpenseSheetId(metadata, accountingMonth);
  } catch (error) {
    if (error?.code === "MONTHLY_EXPENSE_SHEET_METADATA_INVALID") return discovered;
    throw monthlyExpenseDeletionError("MONTHLY_EXPENSE_DESTINATION_DISCOVERY_FAILED", "Expense destination discovery failed");
  }

  const locationKey = `${destination.id}\u0000${accountingMonth}`;
  if (!seen.has(locationKey)) {
    discovered.push({ spreadsheetId: destination.id, sheetName: accountingMonth, kind: "destination" });
  }
  return discovered;
}

function buildMonthlyExpenseDeletionResult({ sourceKey, deletedRows, checkedLocations }) {
  return {
    sourceKey,
    status: deletedRows.length > 0 ? "deleted" : "not_found",
    deletedCount: deletedRows.length,
    deletedRows: deletedRows.map((row) => ({ ...row })),
    checkedLocations: checkedLocations.map(({ spreadsheetId, sheetName }) => ({ spreadsheetId, sheetName })),
  };
}

async function deleteMonthlyExpenseRowsBySourceKey({
  rootDir,
  accountingMonth,
  sourceKey,
  knownLocations = [],
  fetchImpl = fetch,
}) {
  const normalized = normalizeDeletionInput({ rootDir, accountingMonth, sourceKey, knownLocations });
  const queueKey = path.resolve(normalized.rootDir);
  const previous = monthlyExpenseDeletionQueues.get(queueKey) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    let accessToken;
    try {
      accessToken = await getValidAccessToken({ rootDir: normalized.rootDir, fetchImpl });
    } catch {
      throw monthlyExpenseDeletionError("MONTHLY_EXPENSE_AUTH_FAILED", "Google Sheets authentication failed");
    }

    const locations = await discoverMonthlyExpenseDeletionLocations({
      rootDir: normalized.rootDir,
      accountingMonth: normalized.accountingMonth,
      accessToken,
      fetchImpl,
      locations: normalized.locations,
    });

    // All locations are fully read and schema-checked before the first mutation.
    for (const location of locations) {
      let metadata;
      try {
        metadata = await readMonthlyExpenseSheetMetadata({ accessToken, fetchImpl, spreadsheetId: location.spreadsheetId });
        resolveMonthlyExpenseSheetId(metadata, location.sheetName);
      } catch (error) {
        if (location.kind === "known" || error?.code === "MONTHLY_EXPENSE_SHEET_METADATA_INVALID") {
          throw monthlyExpenseDeletionError(
            location.kind === "known" ? "MONTHLY_EXPENSE_KNOWN_LOCATION_UNREADABLE" : "MONTHLY_EXPENSE_SHEET_METADATA_INVALID",
            "Monthly expense sheet metadata could not be read",
          );
        }
        throw monthlyExpenseDeletionError("MONTHLY_EXPENSE_SHEET_METADATA_INVALID", "Monthly expense sheet metadata could not be read");
      }
      let values;
      try {
        values = await getValues({
          accessToken,
          fetchImpl,
          spreadsheetId: location.spreadsheetId,
          range: `${escapeSheetName(location.sheetName)}!A:A`,
        });
      } catch {
        throw monthlyExpenseDeletionError(
          location.kind === "known" ? "MONTHLY_EXPENSE_KNOWN_LOCATION_UNREADABLE" : "MONTHLY_EXPENSE_VALUES_READ_FAILED",
          "Monthly expense values could not be read",
        );
      }
      if (values.length > 0 && values[0]?.[0] !== "Source Key") {
        throw monthlyExpenseDeletionError("MONTHLY_EXPENSE_SCHEMA_INVALID", "Monthly expense sheet header is invalid");
      }
    }

    const deletedRows = [];
    const checkedLocations = [];
    for (const location of locations) {
      let metadata;
      let sheetId;
      try {
        metadata = await readMonthlyExpenseSheetMetadata({ accessToken, fetchImpl, spreadsheetId: location.spreadsheetId });
        sheetId = resolveMonthlyExpenseSheetId(metadata, location.sheetName);
      } catch {
        throw monthlyExpenseDeletionError(
          "MONTHLY_EXPENSE_FINAL_METADATA_READ_FAILED",
          "Monthly expense sheet metadata could not be re-read",
          buildMonthlyExpenseDeletionResult({ sourceKey: normalized.sourceKey, deletedRows, checkedLocations }),
        );
      }

      let values;
      try {
        values = await getValues({
          accessToken,
          fetchImpl,
          spreadsheetId: location.spreadsheetId,
          range: `${escapeSheetName(location.sheetName)}!A:A`,
        });
      } catch {
        throw monthlyExpenseDeletionError(
          "MONTHLY_EXPENSE_FINAL_VALUES_READ_FAILED",
          "Monthly expense values could not be re-read",
          buildMonthlyExpenseDeletionResult({ sourceKey: normalized.sourceKey, deletedRows, checkedLocations }),
        );
      }
      if (values.length > 0 && values[0]?.[0] !== "Source Key") {
        throw monthlyExpenseDeletionError(
          "MONTHLY_EXPENSE_SCHEMA_INVALID",
          "Monthly expense sheet header is invalid",
          buildMonthlyExpenseDeletionResult({ sourceKey: normalized.sourceKey, deletedRows, checkedLocations }),
        );
      }

      const matchingRowNumbers = [];
      values.forEach((row, index) => {
        if (index > 0 && row?.[0] === normalized.sourceKey) matchingRowNumbers.push(index + 1);
      });
      if (matchingRowNumbers.length === 0) {
        checkedLocations.push(location);
        continue;
      }

      const requests = matchingRowNumbers.sort((a, b) => b - a).map((rowNumber) => ({
        deleteDimension: {
          range: {
            sheetId,
            dimension: "ROWS",
            startIndex: rowNumber - 1,
            endIndex: rowNumber,
          },
        },
      }));
      try {
        await sheetsFetchJson({
          accessToken,
          fetchImpl,
          url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(location.spreadsheetId)}:batchUpdate`,
          options: {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ requests }),
          },
        });
      } catch {
        throw monthlyExpenseDeletionError(
          "MONTHLY_EXPENSE_BATCH_DELETE_FAILED",
          "Monthly expense row deletion failed",
          buildMonthlyExpenseDeletionResult({ sourceKey: normalized.sourceKey, deletedRows, checkedLocations }),
        );
      }

      let afterValues;
      try {
        afterValues = await getValues({
          accessToken,
          fetchImpl,
          spreadsheetId: location.spreadsheetId,
          range: `${escapeSheetName(location.sheetName)}!A:A`,
        });
      } catch {
        throw monthlyExpenseDeletionError(
          "MONTHLY_EXPENSE_FINAL_VALUES_READ_FAILED",
          "Monthly expense values could not be verified",
          buildMonthlyExpenseDeletionResult({ sourceKey: normalized.sourceKey, deletedRows, checkedLocations }),
        );
      }
      if (afterValues.some((row) => row?.[0] === normalized.sourceKey)) {
        throw monthlyExpenseDeletionError(
          "MONTHLY_EXPENSE_POST_DELETE_VERIFICATION_FAILED",
          "Monthly expense row deletion could not be verified",
          buildMonthlyExpenseDeletionResult({ sourceKey: normalized.sourceKey, deletedRows, checkedLocations }),
        );
      }
      for (const rowNumber of matchingRowNumbers) {
        deletedRows.push({ spreadsheetId: location.spreadsheetId, sheetName: location.sheetName, rowNumber });
      }
      checkedLocations.push(location);
    }

    return buildMonthlyExpenseDeletionResult({ sourceKey: normalized.sourceKey, deletedRows, checkedLocations: locations });
  });
  monthlyExpenseDeletionQueues.set(queueKey, operation);
  try {
    return await operation;
  } finally {
    if (monthlyExpenseDeletionQueues.get(queueKey) === operation) monthlyExpenseDeletionQueues.delete(queueKey);
  }
}

module.exports = {
  buildExpenseRow,
  expenseHeaders,
  findMonthlyExpenseSourceKeyConflicts,
  recordMonthlyExpense,
  deleteMonthlyExpenseRowsBySourceKey,
};
