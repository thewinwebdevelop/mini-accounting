const { copyFile, mkdir, readdir, readFile, stat, writeFile } = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { existsSync } = require("node:fs");
const { homedir } = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const {
  buildExpensePayload,
  buildRawFileName,
  formatPayloadMarkdown,
} = require("./expense-request.logic.js");
const { getCompanySettings } = require("./company-settings.logic.js");
const { uploadFolderToGoogleDrive } = require("./google-drive.logic.js");

const execFileAsync = promisify(execFile);
const pdfGeneratorPath = path.join(__dirname, "..", "scripts", "generate_expense_pdfs.py");

function padSequence(sequence) {
  return String(sequence).padStart(4, "0");
}

function getMonthParts(accountingMonth = "") {
  const [year, month] = String(accountingMonth).split("-");
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month)) {
    throw new Error("Invalid accounting month");
  }
  return { year, month };
}

function getExpenseMonthDir(rootDir, accountingMonth) {
  const { year, month } = getMonthParts(accountingMonth);
  return path.join(rootDir, "documents", year, month, "เบิกจ่าย");
}

function getDraftMonthDir(rootDir, accountingMonth) {
  const { year, month } = getMonthParts(accountingMonth);
  return path.join(rootDir, "drafts", year, month);
}

function createDraftId(accountingMonth) {
  const { year, month } = getMonthParts(accountingMonth);
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `DRAFT-${year}-${month}-${unique}`;
}

function getDraftFolderPath(accountingMonth, draftId) {
  const { year, month } = getMonthParts(accountingMonth);
  return path.join("drafts", year, month, draftId);
}

async function getNextExpenseRequestInfo(rootDir, accountingMonth) {
  const { year, month } = getMonthParts(accountingMonth);
  const monthDir = getExpenseMonthDir(rootDir, accountingMonth);
  let folderNames = [];

  try {
    folderNames = await readdir(monthDir);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const prefix = `REQ-${year}-${month}-`;
  const latestSequence = folderNames.reduce((latest, name) => {
    if (!name.startsWith(prefix)) return latest;
    const match = name.slice(prefix.length).match(/^(\d{4})/);
    if (!match) return latest;
    return Math.max(latest, Number.parseInt(match[1], 10));
  }, 0);
  const sequence = String(latestSequence + 1);

  return {
    sequence,
    requestNo: `REQ-${year}-${month}-${padSequence(sequence)}`,
  };
}

function splitBuffer(buffer, delimiter) {
  const parts = [];
  let start = 0;
  let index = buffer.indexOf(delimiter, start);

  while (index !== -1) {
    parts.push(buffer.subarray(start, index));
    start = index + delimiter.length;
    index = buffer.indexOf(delimiter, start);
  }

  parts.push(buffer.subarray(start));
  return parts;
}

function trimMultipartPart(buffer) {
  let start = 0;
  let end = buffer.length;

  if (buffer.subarray(0, 2).toString("latin1") === "\r\n") start = 2;
  if (buffer.subarray(start, start + 2).toString("latin1") === "--") return null;
  if (buffer.subarray(end - 2, end).toString("latin1") === "\r\n") end -= 2;
  if (buffer.subarray(end - 2, end).toString("latin1") === "--") return null;

  return buffer.subarray(start, end);
}

function parseContentDisposition(value = "") {
  const result = {};
  for (const segment of value.split(";")) {
    const [rawKey, ...rawValue] = segment.trim().split("=");
    if (!rawValue.length) continue;
    result[rawKey] = rawValue.join("=").replace(/^"|"$/g, "");
  }
  return result;
}

function parseMultipartForm(body, contentType = "") {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    throw new Error("Missing multipart boundary");
  }

  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`, "latin1");
  const fields = {};
  const files = [];

  for (const rawPart of splitBuffer(body, boundary).slice(1)) {
    const part = trimMultipartPart(rawPart);
    if (!part?.length) continue;

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n", "latin1"));
    if (headerEnd === -1) continue;

    const headerText = part.subarray(0, headerEnd).toString("latin1");
    const content = part.subarray(headerEnd + 4);
    const headers = Object.fromEntries(
      headerText.split("\r\n").map((line) => {
        const separator = line.indexOf(":");
        return [line.slice(0, separator).toLowerCase(), line.slice(separator + 1).trim()];
      }),
    );
    const disposition = parseContentDisposition(headers["content-disposition"]);
    if (!disposition.name) continue;

    if (!disposition.filename) {
      fields[disposition.name] = content.toString("utf8");
      continue;
    }

    files.push({
      evidenceKey: disposition.name.replace(/^evidence_/, ""),
      originalName: disposition.filename,
      type: headers["content-type"] || "application/octet-stream",
      buffer: content,
    });
  }

  return { fields, files };
}

function countEvidenceFiles(evidenceFiles = {}) {
  return Object.fromEntries(
    Object.entries(evidenceFiles).map(([key, files]) => [key, Array.isArray(files) ? files.length : 0]),
  );
}

function prepareUploadRecords(uploads = [], existingEvidenceFiles = {}) {
  const counts = countEvidenceFiles(existingEvidenceFiles);
  const evidenceFiles = {};
  const writes = [];

  for (const upload of uploads) {
    if (!upload?.evidenceKey || !upload.buffer?.length) continue;
    const nextIndex = counts[upload.evidenceKey] ?? 0;
    counts[upload.evidenceKey] = nextIndex + 1;

    const storedName = buildRawFileName(upload.evidenceKey, upload.originalName, nextIndex);
    const fileRecord = {
      evidenceKey: upload.evidenceKey,
      originalName: upload.originalName,
      storedName,
      size: upload.buffer.length,
      type: upload.type || "application/octet-stream",
    };

    if (!evidenceFiles[upload.evidenceKey]) evidenceFiles[upload.evidenceKey] = [];
    evidenceFiles[upload.evidenceKey].push(fileRecord);
    writes.push({
      fileRecord,
      buffer: upload.buffer,
    });
  }

  return {
    evidenceFiles,
    writes,
  };
}

function groupUploadsByEvidence(uploads = [], existingEvidenceFiles = {}) {
  return prepareUploadRecords(uploads, existingEvidenceFiles).evidenceFiles;
}

function mergeEvidenceFiles(...sources) {
  const merged = {};
  for (const source of sources) {
    for (const [key, files] of Object.entries(source ?? {})) {
      if (!Array.isArray(files) || files.length === 0) continue;
      if (!merged[key]) merged[key] = [];
      merged[key].push(...files.map((file) => ({ ...file })));
    }
  }
  return merged;
}

function flattenEvidenceFiles(evidenceFiles = {}) {
  return Object.values(evidenceFiles).flat().filter(Boolean);
}

function getPythonExecutable() {
  if (process.env.SWEET_HOUSE_PYTHON) return process.env.SWEET_HOUSE_PYTHON;
  if (process.env.PYTHON) return process.env.PYTHON;

  const bundledPython = path.join(
    homedir(),
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "python",
    "bin",
    "python3",
  );

  return existsSync(bundledPython) ? bundledPython : "python3";
}

async function generateExpensePdfs({ payloadPath, outputDir, rawDir }) {
  await mkdir(outputDir, { recursive: true });
  const { stdout, stderr } = await execFileAsync(getPythonExecutable(), [
    pdfGeneratorPath,
    "--payload",
    payloadPath,
    "--output-dir",
    outputDir,
    "--raw-dir",
    rawDir,
  ], {
    maxBuffer: 1024 * 1024,
  });

  if (stderr.trim()) {
    console.warn(stderr.trim());
  }

  return JSON.parse(stdout);
}

async function findDraftRecords(rootDir, includeSubmitted = false) {
  const draftsRoot = path.join(rootDir, "drafts");
  const records = [];

  async function walk(dir) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (entry.name !== "draft.json") continue;
      const record = JSON.parse(await readFile(absolutePath, "utf8"));
      if (!includeSubmitted && record.status === "submitted") continue;
      records.push({
        ...record,
        absoluteFolderPath: path.join(rootDir, record.folderPath),
      });
    }
  }

  await walk(draftsRoot);
  return records.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function getExpenseDraft(rootDir, draftId, options = {}) {
  const records = await findDraftRecords(rootDir, options.includeSubmitted);
  const draft = records.find((record) => record.draftId === draftId);
  if (!draft) throw new Error("Draft not found");
  return draft;
}

async function listExpenseDrafts(rootDir) {
  return (await findDraftRecords(rootDir, false)).map((draft) => ({
    draftId: draft.draftId,
    status: draft.status,
    requestTitle: draft.payload?.requestTitle || "ยังไม่ได้ตั้งชื่อ",
    requesterName: draft.payload?.requesterName || "",
    accountingMonth: draft.payload?.accountingMonth || "",
    updatedAt: draft.updatedAt,
    rawFileCount: flattenEvidenceFiles(draft.evidenceFiles).length,
  }));
}

function getAccountingMonthFromRequestNo(requestNo = "") {
  const match = String(requestNo).match(/^REQ-(\d{4})-(\d{2})-/);
  return match ? `${match[1]}-${match[2]}` : "";
}

function getRequestTitleFromFolderPath(folderPath = "", requestNo = "") {
  const folderName = path.basename(folderPath);
  const prefix = `${requestNo}_`;
  return folderName.startsWith(prefix) ? folderName.slice(prefix.length).replace(/-/g, " ") : folderName;
}

async function listPdfFiles(rootDir, folderPath) {
  const pdfDir = path.join(rootDir, folderPath, "pdf");
  const requestNo = path.basename(folderPath).split("_")[0];
  let files = [];
  try {
    files = await readdir(pdfDir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  return files
    .filter((file) => file.isFile() && file.name.toLowerCase().endsWith(".pdf"))
    .map((file) => ({
      name: file.name,
      path: `pdf/${file.name}`,
      absolutePath: path.join(pdfDir, file.name),
      url: buildRequestFileUrl(requestNo, "pdf", file.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function listRawFiles(rootDir, folderPath) {
  const rawDir = path.join(rootDir, folderPath, "raw");
  const requestNo = path.basename(folderPath).split("_")[0];
  let files = [];
  try {
    files = await readdir(rawDir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const rawFiles = [];
  for (const file of files.filter((entry) => entry.isFile())) {
    const absolutePath = path.join(rawDir, file.name);
    const info = await stat(absolutePath);
    rawFiles.push({
      name: file.name,
      path: `raw/${file.name}`,
      absolutePath,
      url: buildRequestFileUrl(requestNo, "raw", file.name),
      storedName: file.name,
      originalName: file.name,
      size: info.size,
      type: "application/octet-stream",
    });
  }

  return rawFiles
    .sort((a, b) => a.name.localeCompare(b.name));
}

function buildRequestFileUrl(requestNo, section, fileName) {
  return `/api/expense-requests/${encodeURIComponent(requestNo)}/files/${encodeURIComponent(section)}/${encodeURIComponent(fileName)}`;
}

async function readDriveSyncMetadata(rootDir, folderPath) {
  try {
    return JSON.parse(await readFile(path.join(rootDir, folderPath, "data", "drive-sync.json"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

async function writeDriveSyncMetadata(rootDir, folderPath, metadata) {
  const dataDir = path.join(rootDir, folderPath, "data");
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, "drive-sync.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

async function findSubmittedExpenseRequests(rootDir) {
  const documentsRoot = path.join(rootDir, "documents");
  const records = [];

  async function walk(dir) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (entry.name !== "submission.json") continue;
      const payload = JSON.parse(await readFile(absolutePath, "utf8"));
      const folderPath = path.relative(rootDir, path.dirname(path.dirname(absolutePath)));
      const syncMetadata = await readDriveSyncMetadata(rootDir, folderPath);
      records.push({
        id: payload.requestNo,
        status: "submitted",
        requestNo: payload.requestNo,
        requestTitle: getRequestTitleFromFolderPath(folderPath, payload.requestNo),
        requesterName: payload.requesterName || "",
        accountingMonth: getAccountingMonthFromRequestNo(payload.requestNo),
        updatedAt: payload.createdAt || "",
        netPayment: payload.totals?.netPayment || "0.00",
        rawFileCount: Array.isArray(payload.rawFiles) ? payload.rawFiles.length : 0,
        rawFiles: await listRawFiles(rootDir, folderPath),
        folderPath,
        pdfFiles: await listPdfFiles(rootDir, folderPath),
        syncStatus: syncMetadata?.syncStatus || "not_synced",
        driveFolderUrl: syncMetadata?.driveFolderUrl || "",
        driveFolderId: syncMetadata?.driveFolderId || "",
        drivePath: syncMetadata?.drivePath || "",
        uploadedFileCount: syncMetadata?.uploadedFileCount || 0,
        syncedAt: syncMetadata?.syncedAt || "",
        syncError: syncMetadata?.error || "",
      });
    }
  }

  await walk(documentsRoot);
  return records;
}

function evidenceKeyFromStoredName(storedName = "") {
  const ref = String(storedName).match(/^A(\d+)_/)?.[1];
  const key = Object.keys(buildExpensePayload({
    accountingMonth: "2000-01",
    sequence: "1",
    expenseLines: [],
  }).evidence)[Number(ref) - 1];
  return key || "otherEvidence";
}

function buildSubmittedEvidenceFiles(payload = {}, rawFiles = []) {
  const evidenceFiles = {};
  const rawFileByName = new Map(rawFiles.map((file) => [file.name, file]));

  for (const [evidenceKey, evidence] of Object.entries(payload.evidence ?? {})) {
    const files = Array.isArray(evidence.files) ? evidence.files : [];
    for (const storedName of files) {
      const rawFile = rawFileByName.get(storedName) ?? {};
      if (!evidenceFiles[evidenceKey]) evidenceFiles[evidenceKey] = [];
      evidenceFiles[evidenceKey].push({
        evidenceKey,
        originalName: rawFile.originalName || storedName,
        storedName,
        size: rawFile.size || 0,
        type: rawFile.type || "application/octet-stream",
      });
    }
  }

  for (const rawFile of rawFiles) {
    if ([].concat(...Object.values(evidenceFiles)).some((file) => file.storedName === rawFile.name)) continue;
    const evidenceKey = evidenceKeyFromStoredName(rawFile.name);
    if (!evidenceFiles[evidenceKey]) evidenceFiles[evidenceKey] = [];
    evidenceFiles[evidenceKey].push({
      evidenceKey,
      originalName: rawFile.originalName || rawFile.name,
      storedName: rawFile.name,
      size: rawFile.size || 0,
      type: rawFile.type || "application/octet-stream",
    });
  }

  return evidenceFiles;
}

async function getSubmittedExpenseRequest(rootDir, requestNo) {
  if (!requestNo) throw new Error("Missing expense request number");

  const requests = await findSubmittedExpenseRequests(rootDir);
  const request = requests.find((record) => record.requestNo === requestNo);
  if (!request) throw new Error("Expense request not found");

  const payload = JSON.parse(await readFile(path.join(rootDir, request.folderPath, "data", "submission.json"), "utf8"));
  const rawFiles = await listRawFiles(rootDir, request.folderPath);
  const evidenceFiles = payload.evidenceFiles || buildSubmittedEvidenceFiles(payload, rawFiles);

  return {
    ...request,
    payload: {
      ...payload,
      requestNo: payload.requestNo || request.requestNo,
      folderPath: payload.folderPath || request.folderPath,
      accountingMonth: getAccountingMonthFromRequestNo(payload.requestNo || request.requestNo),
      requestType: payload.requestType || "reimbursement",
      requestTitle: payload.requestTitle || request.requestTitle,
    },
    evidenceFiles,
    rawFiles,
    editUrl: `/expense-request?requestNo=${encodeURIComponent(request.requestNo)}`,
  };
}

async function listExpenseRequests(rootDir) {
  const draftRecords = (await listExpenseDrafts(rootDir)).map((draft) => ({
    id: draft.draftId,
    status: "draft",
    draftId: draft.draftId,
    requestNo: "",
    requestTitle: draft.requestTitle,
    requesterName: draft.requesterName,
    accountingMonth: draft.accountingMonth,
    updatedAt: draft.updatedAt,
    netPayment: "",
    rawFileCount: draft.rawFileCount,
    rawFiles: [],
    folderPath: "",
    pdfFiles: [],
    editUrl: `/expense-request?draftId=${encodeURIComponent(draft.draftId)}`,
  }));
  const submittedRecords = await findSubmittedExpenseRequests(rootDir);

  return [
    ...draftRecords,
    ...submittedRecords.map((request) => ({
      ...request,
      editUrl: `/expense-request?requestNo=${encodeURIComponent(request.requestNo)}`,
    })),
  ].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function writeDraftRecord(rootDir, record) {
  const absoluteFolderPath = path.join(rootDir, record.folderPath);
  await mkdir(path.join(absoluteFolderPath, "data"), { recursive: true });
  await writeFile(
    path.join(absoluteFolderPath, "data", "draft.json"),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );
}

async function saveExpenseDraft({ rootDir, payload, uploads = [] }) {
  const accountingMonth = payload.accountingMonth;
  getMonthParts(accountingMonth);

  let existingDraft = null;
  if (payload.draftId) {
    existingDraft = await getExpenseDraft(rootDir, payload.draftId, { includeSubmitted: true });
    if (existingDraft.status === "submitted") {
      throw new Error("Submitted drafts cannot be edited");
    }
  }

  const draftId = existingDraft?.draftId || createDraftId(accountingMonth);
  const folderPath = existingDraft?.folderPath || getDraftFolderPath(accountingMonth, draftId);
  const absoluteFolderPath = path.join(rootDir, folderPath);
  const rawDir = path.join(absoluteFolderPath, "raw");
  const existingEvidenceFiles = existingDraft?.evidenceFiles ?? {};
  const preparedUploads = prepareUploadRecords(uploads, existingEvidenceFiles);
  const evidenceFiles = mergeEvidenceFiles(existingEvidenceFiles, preparedUploads.evidenceFiles);
  const now = new Date().toISOString();
  const record = {
    draftId,
    status: "draft",
    folderPath,
    payload: {
      ...payload,
      draftId,
    },
    evidenceFiles,
    rawFiles: flattenEvidenceFiles(evidenceFiles).map((file) => file.storedName),
    createdAt: existingDraft?.createdAt || now,
    updatedAt: now,
  };

  await mkdir(rawDir, { recursive: true });
  for (const write of preparedUploads.writes) {
    await writeFile(path.join(rawDir, write.fileRecord.storedName), write.buffer);
  }
  await writeDraftRecord(rootDir, record);

  return {
    draftId,
    folderPath,
    absoluteFolderPath,
    rawFiles: flattenEvidenceFiles(evidenceFiles),
    updatedAt: record.updatedAt,
  };
}

async function saveExpenseSubmission({ rootDir, payload, uploads = [] }) {
  let draft = null;
  if (payload.draftId) {
    draft = await getExpenseDraft(rootDir, payload.draftId, { includeSubmitted: true });
  }

  const existingRequest = payload.requestNo ? await getSubmittedExpenseRequest(rootDir, payload.requestNo) : null;
  const existingEvidenceFiles = existingRequest?.evidenceFiles ?? draft?.evidenceFiles ?? {};
  const preparedUploads = prepareUploadRecords(uploads, existingEvidenceFiles);
  const evidenceFiles = mergeEvidenceFiles(existingEvidenceFiles, preparedUploads.evidenceFiles);
  const nextRequest = existingRequest
    ? {
        sequence: existingRequest.requestNo.split("-").at(-1),
        requestNo: existingRequest.requestNo,
      }
    : await getNextExpenseRequestInfo(rootDir, payload.accountingMonth);
  const company = await getCompanySettings(rootDir);
  const expensePayload = buildExpensePayload({
    ...existingRequest?.payload,
    ...payload,
    company,
    requestNo: existingRequest?.requestNo || payload.requestNo,
    folderPath: existingRequest?.folderPath || payload.folderPath,
    sequence: nextRequest.sequence,
    evidenceFiles,
    createdAt: existingRequest?.payload?.createdAt,
  });

  const absoluteFolderPath = path.join(rootDir, expensePayload.folderPath);
  const rawDir = path.join(absoluteFolderPath, "raw");
  const dataDir = path.join(absoluteFolderPath, "data");
  const workingMdDir = path.join(absoluteFolderPath, "working-md");
  const pdfDir = path.join(absoluteFolderPath, "pdf");

  await mkdir(rawDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await mkdir(workingMdDir, { recursive: true });
  await mkdir(pdfDir, { recursive: true });

  const rawFiles = [];
  if (existingRequest) {
    rawFiles.push(...flattenEvidenceFiles(existingEvidenceFiles));
  } else if (draft) {
    const draftRawDir = path.join(rootDir, draft.folderPath, "raw");
    for (const fileRecord of flattenEvidenceFiles(existingEvidenceFiles)) {
      const targetPath = path.join(rawDir, fileRecord.storedName);
      if (!path.join(draftRawDir, fileRecord.storedName).startsWith(rawDir)) {
        await copyFile(path.join(draftRawDir, fileRecord.storedName), targetPath);
      }
      rawFiles.push(fileRecord);
    }
  }

  for (const write of preparedUploads.writes) {
    await writeFile(path.join(rawDir, write.fileRecord.storedName), write.buffer);
    rawFiles.push(write.fileRecord);
  }

  const submissionJsonPath = path.join(dataDir, "submission.json");
  await writeFile(submissionJsonPath, `${JSON.stringify(expensePayload, null, 2)}\n`, "utf8");
  await writeFile(path.join(workingMdDir, "submission.md"), formatPayloadMarkdown(expensePayload), "utf8");
  const pdfFiles = await generateExpensePdfs({
    payloadPath: submissionJsonPath,
    outputDir: pdfDir,
    rawDir,
  });

  if (draft) {
    await writeDraftRecord(rootDir, {
      ...draft,
      status: "submitted",
      submittedRequestNo: expensePayload.requestNo,
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  if (existingRequest) {
    const syncMetadata = await readDriveSyncMetadata(rootDir, existingRequest.folderPath);
    if (syncMetadata?.syncStatus === "synced") {
      await writeDriveSyncMetadata(rootDir, existingRequest.folderPath, {
        ...syncMetadata,
        syncStatus: "needs_resync",
        updatedAt: new Date().toISOString(),
      });
    }
  }

  return {
    requestNo: expensePayload.requestNo,
    folderPath: expensePayload.folderPath,
    absoluteFolderPath,
    pdfFiles,
    rawFiles,
  };
}

async function getExpenseRequestFile({ rootDir, requestNo, section, fileName }) {
  if (!requestNo) throw new Error("Missing expense request number");
  if (!["pdf", "raw"].includes(section)) throw new Error("Invalid file section");
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") {
    throw new Error("Invalid file name");
  }

  const requests = await findSubmittedExpenseRequests(rootDir);
  const request = requests.find((record) => record.requestNo === requestNo);
  if (!request) throw new Error("Expense request not found");

  const baseDir = path.resolve(rootDir, request.folderPath, section);
  const absolutePath = path.resolve(baseDir, fileName);
  if (!absolutePath.startsWith(`${baseDir}${path.sep}`)) {
    throw new Error("Invalid file name");
  }

  return {
    absolutePath,
    fileName,
    section,
  };
}

async function syncExpenseRequestToDrive({
  rootDir,
  requestNo,
  driveUploader = uploadFolderToGoogleDrive,
  now = () => new Date().toISOString(),
}) {
  if (!requestNo) throw new Error("Missing expense request number");

  const requests = await findSubmittedExpenseRequests(rootDir);
  const request = requests.find((record) => record.requestNo === requestNo);
  if (!request) throw new Error("Expense request not found");

  let uploadResult;

  try {
    uploadResult = await driveUploader({
      rootDir,
      folderPath: request.folderPath,
    });
  } catch (error) {
    const message = error.message || "Google Drive sync failed";
    const failedMetadata = {
      requestNo,
      syncStatus: "sync_failed",
      error: message,
      updatedAt: now(),
    };
    await writeDriveSyncMetadata(rootDir, request.folderPath, failedMetadata);
    throw new Error(message);
  }

  const syncedAt = now();
  const metadata = {
    requestNo,
    syncStatus: "synced",
    driveFolderId: uploadResult.driveFolderId,
    driveFolderUrl: uploadResult.driveFolderUrl,
    drivePath: uploadResult.drivePath,
    uploadedFileCount: uploadResult.uploadedFileCount,
    syncedAt,
    updatedAt: syncedAt,
  };
  await writeDriveSyncMetadata(rootDir, request.folderPath, metadata);

  return metadata;
}

module.exports = {
  getExpenseDraft,
  getExpenseRequestFile,
  getSubmittedExpenseRequest,
  getNextExpenseRequestInfo,
  groupUploadsByEvidence,
  listExpenseRequests,
  listExpenseDrafts,
  parseMultipartForm,
  saveExpenseDraft,
  saveExpenseSubmission,
  syncExpenseRequestToDrive,
};
