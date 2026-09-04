const {
  driveFetchJson,
  ensureDrivePath,
  getGoogleDriveConfig,
  getValidAccessToken,
  splitDrivePath,
} = require("./google-drive.logic.js");

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

module.exports = {
  buildExpenseRow,
  expenseHeaders,
  recordMonthlyExpense,
};
