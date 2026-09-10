const { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { existsSync } = require("node:fs");
const { homedir } = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const {
  EXPENSE_REQUEST_STATUS_LABELS,
  buildExpensePayload,
  buildRawFileName,
  formatPayloadMarkdown,
} = require("./expense-request.logic.js");
const {
  SUBSTITUTE_RECEIPT_STATUS_LABELS,
  assertSubstituteReceiptTransition,
  buildSubstituteReceiptPayload,
  buildSubstituteReceiptRawFileName,
  formatSubstituteReceiptMarkdown,
  normalizeSubstituteReceiptStatus,
  validateSubstituteReceipt,
} = require("./substitute-receipt.logic.js");
const {
  LIGHTWEIGHT_DOCUMENT_KINDS,
  WORKFLOW_DOCUMENT_PREFIXES,
  WORKFLOW_DOCUMENT_STATUS_LABELS,
  assertWorkflowDocumentCompletable,
  buildWorkflowDocumentRawFileName,
  formatWorkflowDocumentMarkdown,
  sanitizeEvidenceKey,
} = require("./workflow-document.logic.js");
const {
  DOCUMENT_TYPE_DEFINITIONS,
  buildWorkflowTransactionPayload,
  deriveWorkflowProgress,
  formatWorkflowSummaryMarkdown,
  getDefaultWorkflowTemplates,
  getDocumentTypeDefinition,
  normalizeDocumentWorkflowStatus,
  normalizeWorkflowTemplate,
  validateWorkflowTemplate,
} = require("./workflow.logic.js");
const {
  buildWorkflowPrefillContext,
  RECEIVABLE_PREFILL_GROUPS,
} = require("./workflow-prefill.logic.js");
const { getCompanySettings } = require("./company-settings.logic.js");
const { uploadFolderToGoogleDrive } = require("./google-drive.logic.js");
const { recordMonthlyExpense } = require("./google-sheets.logic.js");
const {
  createPurchaseInMovement,
  listStockMovementsByReference,
} = require("./inventory.logic.js");
const {
  allocateDocumentNumber,
  peekNextDocumentNumber,
  getDocumentIndexRowByNumber,
  queryDocumentIndexRows,
  indexDocument,
  withDocumentIndexDatabase,
} = require("./document-index.logic.js");

const execFileAsync = promisify(execFile);
const pdfGeneratorPath = path.join(__dirname, "..", "scripts", "generate_expense_pdfs.py");
const workflowDocumentPdfGeneratorPath = path.join(__dirname, "..", "scripts", "generate_workflow_document_pdf.py");
const workflowPacketPdfGeneratorPath = path.join(__dirname, "..", "scripts", "generate_workflow_packet_pdf.py");

// Fixed name so the packet always overwrites the previous one on refresh
// (there is only ever one packet per transaction) and so the transaction
// page and API tests can reference it by a known name rather than a glob.
const WORKFLOW_PACKET_PDF_FILE_NAME = "99_ชุดรวมเอกสาร_workflow-transaction.pdf";

function getMonthParts(accountingMonth = "") {
  const [year, month] = String(accountingMonth).split("-");
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month)) {
    throw new Error("Invalid accounting month");
  }
  return { year, month };
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

function createSubstituteReceiptDraftId(accountingMonth) {
  const { year, month } = getMonthParts(accountingMonth);
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `SR-DRAFT-${year}-${month}-${unique}`;
}

function getSubstituteReceiptDraftFolderPath(accountingMonth, draftId) {
  const { year, month } = getMonthParts(accountingMonth);
  return path.join("drafts", year, month, "substitute-receipts", draftId);
}

// Used to scan folder names under documents/YYYY/MM/... for the highest
// sequence in use, while allocateExpenseRequestNumber (the real write-path
// allocator, below) read the same "next number" from the
// document_number_allocations ledger instead. Two different sources of
// truth for the same question meant a "/next" preview could show REQ-...-0007
// while the request that actually got submitted a moment later became
// REQ-...-0008 (a concurrent submission won the race), or — permanently,
// once it first happened — a folder failing to get created after a number
// was allocated (see the module comment in document-index.logic.js) would
// leave the disk scan and the ledger disagreeing forever, since the disk
// scan has no way to know a number was ever spent. peekNextDocumentNumber
// reads the exact same ledger allocateExpenseRequestNumber writes to, so the
// number a form previews is always the number the next real submission will
// receive — and being a plain SELECT with no INSERT, it can be called any
// number of times (reopening the form, switching months) without ever
// spending a real document number itself.
async function getNextExpenseRequestInfo(rootDir, accountingMonth) {
  // Validates the accountingMonth format exactly as before (throws the same
  // "Invalid accounting month" error) even though only that validation is
  // used here now — the number itself comes from the ledger.
  getMonthParts(accountingMonth);

  return withDocumentIndexDatabase(rootDir, (db) => {
    const { sequence, documentNo } = peekNextDocumentNumber(db, {
      documentKind: "expense_request",
      accountingMonth,
    });
    return { sequence, requestNo: documentNo };
  });
}

async function getNextSubstituteReceiptInfo(rootDir, accountingMonth) {
  getMonthParts(accountingMonth);

  return withDocumentIndexDatabase(rootDir, (db) => {
    const { sequence, documentNo } = peekNextDocumentNumber(db, {
      documentKind: "substitute_receipt",
      accountingMonth,
    });
    return { sequence, receiptNo: documentNo };
  });
}

// Unlike getNextExpenseRequestInfo/getNextSubstituteReceiptInfo/
// getNextWorkflowTransactionInfo, this function has exactly one caller
// (handleWorkflowDocumentSubmission in local-server.mjs, right before a
// lightweight document is actually created) and no separate read-only
// "preview the next number" route, so it is safe — and necessary, to close
// the scan-then-write race described in the module-level comment above — to
// make this the real atomic allocation rather than a scan.
async function getNextWorkflowDocumentInfo(rootDir, documentKind, accountingMonth) {
  const prefix = WORKFLOW_DOCUMENT_PREFIXES[documentKind];
  if (!prefix) throw new Error(`Invalid workflow document kind: ${documentKind}`);

  // Validates the accountingMonth format exactly as before (throws the same
  // "Invalid accounting month" error), even though only its side effect
  // (validation) is used here — the actual number now comes from the DB
  // ledger, keyed on documentKind directly rather than a rebuilt prefix.
  getMonthParts(accountingMonth);

  return withDocumentIndexDatabase(rootDir, (db) => {
    const { sequence, documentNo } = allocateDocumentNumber(db, {
      documentKind,
      accountingMonth,
    });
    return { sequence, documentNo };
  });
}

async function getNextWorkflowTransactionInfo(rootDir, accountingMonth) {
  getMonthParts(accountingMonth);

  return withDocumentIndexDatabase(rootDir, (db) => {
    const { sequence, documentNo } = peekNextDocumentNumber(db, {
      documentKind: "workflow_transaction",
      accountingMonth,
    });
    return { sequence, transactionNo: documentNo };
  });
}

// The real write-path allocators. Each of getNextExpenseRequestInfo/
// getNextSubstituteReceiptInfo/getNextWorkflowTransactionInfo above is a
// read-only peek at the exact same document_number_allocations ledger these
// write to (see peekNextDocumentNumber in document-index.logic.js) — the two
// used to read from different sources entirely (the preview scanned disk
// folder names, these always read the ledger), which is what let a "/next"
// preview permanently disagree with the number a submission actually
// received. They still differ in one respect: only these are allowed to
// actually spend a number (via allocateDocumentNumber's INSERT), because
// only these run on the real write path (the moment a document is actually
// about to be created) rather than on every form open/month change. A UNIQUE
// constraint on (document_kind, accounting_month, sequence) in SQLite makes
// a second caller landing on the same sequence fail its INSERT rather than
// silently succeed, so the allocator retries with the next number instead of
// ever handing out a duplicate. See document-index.logic.js for why the
// ledger is a separate table from the documents index itself.
function allocateExpenseRequestNumber(rootDir, accountingMonth) {
  return withDocumentIndexDatabase(rootDir, (db) => {
    const { sequence, documentNo } = allocateDocumentNumber(db, {
      documentKind: "expense_request",
      accountingMonth,
    });
    return { sequence, requestNo: documentNo };
  });
}

function allocateSubstituteReceiptNumber(rootDir, accountingMonth) {
  return withDocumentIndexDatabase(rootDir, (db) => {
    const { sequence, documentNo } = allocateDocumentNumber(db, {
      documentKind: "substitute_receipt",
      accountingMonth,
    });
    return { sequence, receiptNo: documentNo };
  });
}

function allocateWorkflowTransactionNumber(rootDir, accountingMonth) {
  return withDocumentIndexDatabase(rootDir, (db) => {
    const { sequence, documentNo } = allocateDocumentNumber(db, {
      documentKind: "workflow_transaction",
      accountingMonth,
    });
    return { sequence, transactionNo: documentNo };
  });
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

// keyNormalizer defaults to identity so expense-request and substitute-receipt
// (whose evidenceKey values are never sanitized/collapsed before naming) keep
// counting against the raw key exactly as before. workflow-document is the one
// caller that passes its own sanitizeEvidenceKey here — see prepareUploadRecords.
function countEvidenceFiles(evidenceFiles = {}, keyNormalizer = (key) => key) {
  const counts = {};
  for (const [key, files] of Object.entries(evidenceFiles)) {
    const normalizedKey = keyNormalizer(key);
    const fileCount = Array.isArray(files) ? files.length : 0;
    counts[normalizedKey] = (counts[normalizedKey] ?? 0) + fileCount;
  }
  return counts;
}

// fileNameBuilder derives the stored file's slug from evidenceKey internally
// (workflow-document's buildWorkflowDocumentRawFileName sanitizes it, lowercasing
// and stripping a wide character class including dots). Left uncorrected, two
// different raw evidenceKeys that sanitize to the same slug ("a.b" and "ab" both
// become "ab") would each start counting from 0 here and collide on the same
// stored file name, silently clobbering one upload with the other. keyNormalizer
// lets a caller (workflow-document only — see saveWorkflowDocument) count against
// the same slug fileNameBuilder will actually use, so colliding raw keys share
// one counter ("ab_001", "ab_002") instead of each claiming "ab_001". Defaults to
// identity so expense-request and substitute-receipt, which pass no normalizer,
// see no behavior change.
function prepareUploadRecords(uploads = [], existingEvidenceFiles = {}, fileNameBuilder = buildRawFileName, keyNormalizer = (key) => key) {
  const counts = countEvidenceFiles(existingEvidenceFiles, keyNormalizer);
  const evidenceFiles = {};
  const writes = [];

  for (const upload of uploads) {
    if (!upload?.evidenceKey || !upload.buffer?.length) continue;
    const countingKey = keyNormalizer(upload.evidenceKey);
    const nextIndex = counts[countingKey] ?? 0;
    counts[countingKey] = nextIndex + 1;

    const storedName = fileNameBuilder(upload.evidenceKey, upload.originalName, nextIndex);
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

async function generateSubstituteReceiptPdfs({ payloadPath, outputDir, rawDir }) {
  return generateExpensePdfs({ payloadPath, outputDir, rawDir });
}

async function generateWorkflowDocumentPdf({ payloadPath, outputDir }) {
  await mkdir(outputDir, { recursive: true });
  const { stdout, stderr } = await execFileAsync(getPythonExecutable(), [
    workflowDocumentPdfGeneratorPath,
    "--payload",
    payloadPath,
    "--output-dir",
    outputDir,
  ], {
    maxBuffer: 1024 * 1024,
  });

  if (stderr.trim()) {
    console.warn(stderr.trim());
  }

  return JSON.parse(stdout);
}

// The packet PDF is a transaction-level summary/index, not a merge of the
// child documents' own PDFs — it lists the template, every step and its
// status, every child document with its own number/status, and the PDF/raw
// files that belong to each, so the whole transaction can be handed over as
// one document. Unlike generateWorkflowDocumentPdf (which is handed an
// already-written payload file), this helper owns writing its own payload
// JSON — {transaction, childDocuments} — into the transaction's data folder
// (a sibling of outputPath's pdf/ folder) because no persisted record already
// combines a transaction with its live-resolved child documents.
async function generateWorkflowPacketPdf({ transaction, childDocuments, outputPath }) {
  const pdfDir = path.dirname(outputPath);
  const dataDir = path.join(path.dirname(pdfDir), "data");
  await mkdir(pdfDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });

  const payloadPath = path.join(dataDir, "workflow-packet-payload.json");
  await writeFile(
    payloadPath,
    JSON.stringify({ transaction, childDocuments }, null, 2),
    "utf8",
  );

  const { stdout, stderr } = await execFileAsync(getPythonExecutable(), [
    workflowPacketPdfGeneratorPath,
    "--payload",
    payloadPath,
    "--output",
    outputPath,
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

function getAccountingMonthFromReceiptNo(receiptNo = "") {
  const match = String(receiptNo).match(/^SR-(\d{4})-(\d{2})-/);
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

function buildSubstituteReceiptFileUrl(receiptNo, section, fileName) {
  return `/api/substitute-receipts/${encodeURIComponent(receiptNo)}/files/${encodeURIComponent(section)}/${encodeURIComponent(fileName)}`;
}

async function listSubstituteReceiptPdfFiles(rootDir, folderPath, receiptNo) {
  const files = await listPdfFiles(rootDir, folderPath);
  return files.map((file) => ({
    ...file,
    url: buildSubstituteReceiptFileUrl(receiptNo, "pdf", file.name),
  }));
}

async function listSubstituteReceiptRawFiles(rootDir, folderPath, receiptNo) {
  const files = await listRawFiles(rootDir, folderPath);
  return files.map((file) => ({
    ...file,
    url: buildSubstituteReceiptFileUrl(receiptNo, "raw", file.name),
  }));
}

// Lightweight workflow documents (purchase_order, payment_voucher,
// cash_spend_declaration, payee_acknowledgement, goods_receipt) are served by
// their own route — GET /workflow-documents/<documentKind>/<documentNo>/<section>/<fileName>,
// handled by getWorkflowDocumentFile in local-server.mjs — which is neither
// the expense-request nor the substitute-receipt file route. Note this one
// has no "/api" prefix, unlike the other two. listPdfFiles/listRawFiles only
// know how to build the expense-request URL, so every caller on the
// workflow-document path must re-point the url through this builder instead,
// the same way substitute receipts already do with their own wrapper.
function buildWorkflowDocumentFileUrl(documentKind, documentNo, section, fileName) {
  return `/workflow-documents/${encodeURIComponent(documentKind)}/${encodeURIComponent(documentNo)}/${encodeURIComponent(section)}/${encodeURIComponent(fileName)}`;
}

async function listWorkflowDocumentPdfFiles(rootDir, folderPath, documentKind, documentNo) {
  const files = await listPdfFiles(rootDir, folderPath);
  return files.map((file) => ({
    ...file,
    url: buildWorkflowDocumentFileUrl(documentKind, documentNo, "pdf", file.name),
  }));
}

async function listWorkflowDocumentRawFiles(rootDir, folderPath, documentKind, documentNo) {
  const files = await listRawFiles(rootDir, folderPath);
  return files.map((file) => ({
    ...file,
    url: buildWorkflowDocumentFileUrl(documentKind, documentNo, "raw", file.name),
  }));
}

// The workflow-transaction packet PDF is served through its own route, GET
// /api/workflow-transactions/:transactionNo/files/:section/:fileName (handled
// by getWorkflowTransactionFile) — not the expense-request, substitute-receipt,
// or lightweight-workflow-document routes above, so it needs its own URL
// builder just like each of those already has.
function buildWorkflowTransactionFileUrl(transactionNo, section, fileName) {
  return `/api/workflow-transactions/${encodeURIComponent(transactionNo)}/files/${encodeURIComponent(section)}/${encodeURIComponent(fileName)}`;
}

async function listWorkflowTransactionPdfFiles(rootDir, folderPath, transactionNo) {
  const files = await listPdfFiles(rootDir, folderPath);
  return files.map((file) => ({
    ...file,
    url: buildWorkflowTransactionFileUrl(transactionNo, "pdf", file.name),
  }));
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

function normalizeExpenseRequestStatus(status) {
  const normalized = String(status || "submitted").trim();
  if (!["submitted", "approved", "completed", "cancelled"].includes(normalized)) {
    throw new Error(`Invalid expense request status: ${normalized}`);
  }
  return normalized;
}

function getExpenseRequestNextAction(status) {
  if (status === "submitted") return "อนุมัติ";
  if (status === "approved") return "บันทึกรายจ่ายแล้ว";
  if (status === "completed") return "เสร็จสิ้น";
  if (status === "cancelled") return "ยกเลิกแล้ว";
  return "ดูเอกสาร";
}

function getFirstExpenseCategory(lines = []) {
  const categories = [...new Set((Array.isArray(lines) ? lines : [])
    .map((line) => String(line.category || "").trim())
    .filter(Boolean))];
  if (categories.length <= 1) return categories[0] || "";
  return `${categories[0]} +${categories.length - 1}`;
}

function buildExpenseRequestSheetEntry(payload = {}, driveMetadata = {}, approvedAt = "") {
  return {
    sourceKey: `expense_request:${payload.requestNo}`,
    approvedAt,
    accountingMonth: payload.accountingMonth || getAccountingMonthFromRequestNo(payload.requestNo),
    documentType: "ใบเบิกจ่าย",
    documentNo: payload.requestNo,
    payeeName: payload.paymentTargetName || payload.requesterName || "",
    title: payload.requestTitle || payload.businessPurpose || "",
    category: getFirstExpenseCategory(payload.expenseLines),
    amountBeforeVat: payload.totals?.amountBeforeVat || "0.00",
    vatAmount: payload.totals?.vatAmount || "0.00",
    grossAmount: payload.totals?.grossAmount || "0.00",
    withholdingTax: payload.totals?.withholdingTax || "0.00",
    netPayment: payload.totals?.netPayment || "0.00",
    documentUrl: driveMetadata?.driveFolderUrl || "",
  };
}

function buildSubstituteReceiptSheetEntry(payload = {}, driveMetadata = {}, approvedAt = "") {
  return {
    sourceKey: `substitute_receipt:${payload.receiptNo}`,
    approvedAt,
    accountingMonth: payload.accountingMonth || getAccountingMonthFromReceiptNo(payload.receiptNo),
    documentType: "ใบรับรองแทนใบเสร็จรับเงิน",
    documentNo: payload.receiptNo,
    payeeName: payload.payeeName || "",
    title: payload.receiptTitle || payload.businessPurpose || "",
    category: payload.receiptTypeLabel || payload.receiptType || "",
    amountBeforeVat: payload.totals?.totalAmount || "0.00",
    vatAmount: "0.00",
    grossAmount: payload.totals?.totalAmount || "0.00",
    withholdingTax: "0.00",
    netPayment: payload.totals?.totalAmount || "0.00",
    documentUrl: driveMetadata?.driveFolderUrl || "",
  };
}

async function recordExpenseSheetMetadata({
  rootDir,
  folderPath,
  payload,
  entry,
  expenseRecorder = recordMonthlyExpense,
  now = () => new Date().toISOString(),
}) {
  try {
    payload.sheetSync = await expenseRecorder({ rootDir, entry, now });
  } catch (error) {
    const failedAt = now();
    payload.sheetSync = {
      syncStatus: "sync_failed",
      error: error.message || "Google Sheets sync failed",
      syncedAt: "",
      updatedAt: failedAt,
    };
  }

  return payload.sheetSync;
}

// Generic disk fallback used only when the documents index has no row for an
// identifier a caller asked for by number (see getSubmittedExpenseRequest,
// getSubmittedSubstituteReceipt, getWorkflowDocument, getWorkflowTransaction
// below) -- an index miss can mean the row genuinely does not exist, or that
// the index has fallen behind disk somehow (write-through failed, the
// process was killed between the file write and the index write, ...).
// Disk is always the source of truth, so on a miss these fall back to
// exactly this: a full walk for every file the app recognizes as this kind
// of document, the same walk every read path used to do unconditionally.
// This keeps a stale/incomplete index from ever hiding a real document --
// the cost of a full walk is only ever paid on that rare miss, not on every
// read.
async function walkDocumentsForFolderPaths(rootDir, canonicalFileName) {
  const documentsRoot = path.join(rootDir, "documents");
  const folderPaths = [];

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
      if (entry.name !== canonicalFileName) continue;
      folderPaths.push(path.relative(rootDir, path.dirname(path.dirname(absolutePath))));
    }
  }

  await walk(documentsRoot);
  return folderPaths;
}

// Logged whenever the index points at a folder that no longer holds the file
// it should (deleted out from under the app, moved, or never written through
// -- see the module comment in document-index.logic.js on why disk always
// wins). Never thrown: every caller degrades by skipping the affected record
// (a listing) or falling back to a full disk search (a lookup by number),
// same "degrade, don't crash" contract as the rest of this file's read
// paths.
function logIndexDriftWarning(documentNo, folderPath) {
  console.error(
    `[ดัชนีเอกสาร] พบ ${documentNo} ในดัชนีแต่ไม่พบไฟล์บนดิสก์ที่ ${folderPath} — ดิสก์คือแหล่งความจริง ข้ามรายการนี้/ค้นหาบนดิสก์แทน กรุณารัน scripts/rebuild-document-index.sh เพื่อซ่อมดัชนี`,
  );
}

async function buildSubmittedExpenseRequestRecord(rootDir, folderPath) {
  const absolutePath = path.join(rootDir, folderPath, "data", "submission.json");
  const payload = JSON.parse(await readFile(absolutePath, "utf8"));
  const resolvedFolderPath = payload.folderPath || folderPath;
  const syncMetadata = await readDriveSyncMetadata(rootDir, resolvedFolderPath);
  const status = normalizeExpenseRequestStatus(payload.status || "submitted");

  return {
    id: payload.requestNo,
    status,
    statusLabel: payload.statusLabel || EXPENSE_REQUEST_STATUS_LABELS[status],
    requestNo: payload.requestNo,
    requestTitle: getRequestTitleFromFolderPath(resolvedFolderPath, payload.requestNo),
    requesterName: payload.requesterName || "",
    accountingMonth: getAccountingMonthFromRequestNo(payload.requestNo),
    updatedAt: payload.createdAt || "",
    netPayment: payload.totals?.netPayment || "0.00",
    rawFileCount: Array.isArray(payload.rawFiles) ? payload.rawFiles.length : 0,
    rawFiles: await listRawFiles(rootDir, resolvedFolderPath),
    folderPath: resolvedFolderPath,
    pdfFiles: await listPdfFiles(rootDir, resolvedFolderPath),
    syncStatus: syncMetadata?.syncStatus || "not_synced",
    driveFolderUrl: syncMetadata?.driveFolderUrl || "",
    driveFolderId: syncMetadata?.driveFolderId || "",
    drivePath: syncMetadata?.drivePath || "",
    uploadedFileCount: syncMetadata?.uploadedFileCount || 0,
    syncedAt: syncMetadata?.syncedAt || "",
    syncError: syncMetadata?.error || "",
    sheetSyncStatus: payload.sheetSync?.syncStatus || "not_synced",
    sheetSpreadsheetUrl: payload.sheetSync?.spreadsheetUrl || "",
    sheetSpreadsheetId: payload.sheetSync?.spreadsheetId || "",
    sheetName: payload.sheetSync?.sheetName || "",
    sheetRowNumber: payload.sheetSync?.rowNumber || 0,
    sheetSyncedAt: payload.sheetSync?.syncedAt || "",
    sheetSyncError: payload.sheetSync?.error || "",
    nextAction: getExpenseRequestNextAction(status),
    transactionNo: payload.transactionNo || "",
    workflowTemplateId: payload.workflowTemplateId || "",
    workflowStepId: payload.workflowStepId || "",
    completedAt: payload.completedAt || "",
    completedBy: payload.completedBy || "",
  };
}

// Reads the documents index instead of walking documents/ recursively: one
// SQL query for every row indexed as document_kind='expense_request'
// (populated write-through by indexExpenseRequest, and backfilled by
// rebuildDocumentIndex -- see local-server.mjs's startup call), then one
// targeted file read per matching folder rather than a JSON.parse-per-file
// scan of the entire tree (including every other document kind, month, and
// the drafts/ tree, none of which can ever be a submission.json anyway). A
// row whose folder has gone missing on disk is dropped with a warning
// (logIndexDriftWarning) rather than failing the whole listing -- the same
// "degrade, don't crash" contract the rest of this file already uses for a
// single bad record.
async function findSubmittedExpenseRequests(rootDir) {
  const rows = withDocumentIndexDatabase(rootDir, (db) => queryDocumentIndexRows(db, { documentKind: "expense_request" }));
  const records = [];

  for (const row of rows) {
    try {
      records.push(await buildSubmittedExpenseRequestRecord(rootDir, row.folderPath));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      logIndexDriftWarning(row.documentNo, row.folderPath);
    }
  }

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

// The point-lookup counterpart of findSubmittedExpenseRequests: looks up the
// one row keyed by (expense_request, requestNo) instead of listing every
// expense request just to find one of them -- the O(one recursive tree walk)
// this used to cost on every single call (a request's own page, every file
// download under it, cross-document prefill, ...) drops to one indexed SQL
// lookup plus one targeted file read. Falls back to a full disk search
// (never silently reports "not found" just because the index has not caught
// up) if the index has no row, or if the row it has points at a folder that
// no longer holds a submission.json.
async function getSubmittedExpenseRequestRecord(rootDir, requestNo) {
  const row = withDocumentIndexDatabase(rootDir, (db) => getDocumentIndexRowByNumber(db, "expense_request", requestNo));
  if (row) {
    try {
      return await buildSubmittedExpenseRequestRecord(rootDir, row.folderPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      logIndexDriftWarning(requestNo, row.folderPath);
    }
  }

  for (const folderPath of await walkDocumentsForFolderPaths(rootDir, "submission.json")) {
    try {
      const candidate = await buildSubmittedExpenseRequestRecord(rootDir, folderPath);
      if (candidate.requestNo === requestNo) return candidate;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  return null;
}

async function getSubmittedExpenseRequest(rootDir, requestNo) {
  if (!requestNo) throw new Error("Missing expense request number");

  const request = await getSubmittedExpenseRequestRecord(rootDir, requestNo);
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

async function findSubstituteReceiptDraftRecords(rootDir, includeSubmitted = false) {
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
      if (!String(record.draftId || "").startsWith("SR-DRAFT-")) continue;
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

async function getSubstituteReceiptDraft(rootDir, draftId, options = {}) {
  const records = await findSubstituteReceiptDraftRecords(rootDir, options.includeSubmitted);
  const draft = records.find((record) => record.draftId === draftId);
  if (!draft) throw new Error("Substitute receipt draft not found");
  return draft;
}

const SUBSTITUTE_RECEIPT_TEMPLATE_TYPE_LABELS = {
  stock_purchase: "ซื้อสต๊อกสินค้า",
  general_expense: "รายจ่ายทั่วไป",
};

// Locking the <select> in forms/substitute-receipt.html when opened from a
// workflow step (see workflowContext.receiptType in
// substitute-receipt.logic.browser.js) is a UI affordance only, not
// enforcement -- a crafted request can still POST any receiptType. This is
// the actual guard: given a transactionNo + workflowStepId, look up the
// *snapshotted* template on that transaction (never the live one in
// data/workflow-templates.json, which may have been edited since the
// transaction started -- see getWorkflowTransaction below) and refuse a
// receiptType that disagrees with what that step declared.
//
// A step that declares no receiptType at all -- every workflow-templates.json
// persisted before this feature shipped, or a template step whose kind is
// not substitute_receipt -- has nothing to enforce, so this is a no-op for
// those (a running install must not break because of this change).
async function assertSubstituteReceiptTypeMatchesWorkflowStep(rootDir, payload = {}) {
  const transactionNo = payload.transactionNo;
  const workflowStepId = payload.workflowStepId;
  if (!transactionNo || !workflowStepId) return;

  const transaction = await getWorkflowTransaction(rootDir, transactionNo);
  if (!transaction) return;

  const templateStep = (transaction.templateSnapshot?.documentSteps || [])
    .find((step) => step.stepId === workflowStepId);
  if (!templateStep || templateStep.documentKind !== "substitute_receipt" || !templateStep.receiptType) return;

  const expectedReceiptType = templateStep.receiptType;
  const actualReceiptType = payload.receiptType || "stock_purchase";
  if (actualReceiptType !== expectedReceiptType) {
    const expectedLabel = SUBSTITUTE_RECEIPT_TEMPLATE_TYPE_LABELS[expectedReceiptType] || expectedReceiptType;
    throw new Error(`ขั้นตอนนี้ใน Workflow กำหนดประเภทใบรับรองแทนใบเสร็จไว้เป็น "${expectedLabel}" เท่านั้น ไม่สามารถบันทึกเป็นประเภทอื่นได้`);
  }
}

async function writeSubstituteReceiptDraftRecord(rootDir, record) {
  const absoluteFolderPath = path.join(rootDir, record.folderPath);
  await mkdir(path.join(absoluteFolderPath, "data"), { recursive: true });
  await writeFile(
    path.join(absoluteFolderPath, "data", "draft.json"),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );
}

async function saveSubstituteReceiptDraft({ rootDir, payload, uploads = [] }) {
  const accountingMonth = payload.accountingMonth;
  getMonthParts(accountingMonth);
  await assertSubstituteReceiptTypeMatchesWorkflowStep(rootDir, payload);

  let existingDraft = null;
  if (payload.draftId) {
    existingDraft = await getSubstituteReceiptDraft(rootDir, payload.draftId, { includeSubmitted: true });
    if (existingDraft.status === "submitted") {
      throw new Error("Submitted substitute receipt drafts cannot be edited");
    }
  }

  const draftId = existingDraft?.draftId || createSubstituteReceiptDraftId(accountingMonth);
  const folderPath = existingDraft?.folderPath || getSubstituteReceiptDraftFolderPath(accountingMonth, draftId);
  const absoluteFolderPath = path.join(rootDir, folderPath);
  const rawDir = path.join(absoluteFolderPath, "raw");
  const existingEvidenceFiles = existingDraft?.evidenceFiles ?? {};
  const preparedUploads = prepareUploadRecords(uploads, existingEvidenceFiles, buildSubstituteReceiptRawFileName);
  const evidenceFiles = mergeEvidenceFiles(existingEvidenceFiles, preparedUploads.evidenceFiles);
  const now = new Date().toISOString();
  const record = {
    draftId,
    status: "draft",
    folderPath,
    payload: {
      ...payload,
      draftId,
      status: "draft",
      evidenceFiles,
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
  await writeSubstituteReceiptDraftRecord(rootDir, record);

  return {
    draftId,
    folderPath,
    absoluteFolderPath,
    rawFiles: flattenEvidenceFiles(evidenceFiles),
    updatedAt: record.updatedAt,
  };
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

// Keeps the `documents` index row for one expense request in step with
// whatever was just written to submission.json — called immediately after
// that write succeeds (never before), so an index row can never claim a
// request that doesn't exist on disk. See document-index.logic.js for why
// this write-through happens per document write rather than via some
// separate background sync.
function indexExpenseRequest(rootDir, expensePayload) {
  indexDocument(rootDir, {
    documentKind: "expense_request",
    documentNo: expensePayload.requestNo,
    accountingMonth: expensePayload.accountingMonth,
    status: expensePayload.status,
    folderPath: expensePayload.folderPath,
    transactionNo: expensePayload.transactionNo,
    workflowTemplateId: expensePayload.workflowTemplateId,
    workflowStepId: expensePayload.workflowStepId,
    createdAt: expensePayload.createdAt,
    updatedAt: expensePayload.updatedAt,
  });
}

async function writeSubmittedExpenseRequestFiles(rootDir, expensePayload) {
  const absoluteFolderPath = path.join(rootDir, expensePayload.folderPath);
  const rawDir = path.join(absoluteFolderPath, "raw");
  const dataDir = path.join(absoluteFolderPath, "data");
  const workingMdDir = path.join(absoluteFolderPath, "working-md");
  const pdfDir = path.join(absoluteFolderPath, "pdf");
  const submissionJsonPath = path.join(dataDir, "submission.json");

  await mkdir(dataDir, { recursive: true });
  await mkdir(workingMdDir, { recursive: true });
  await mkdir(pdfDir, { recursive: true });
  await writeFile(submissionJsonPath, `${JSON.stringify(expensePayload, null, 2)}\n`, "utf8");
  indexExpenseRequest(rootDir, expensePayload);
  await writeFile(path.join(workingMdDir, "submission.md"), formatPayloadMarkdown(expensePayload), "utf8");
  await generateExpensePdfs({
    payloadPath: submissionJsonPath,
    outputDir: pdfDir,
    rawDir,
  });
  // Re-listed via listPdfFiles (the same disk scan every other "no-op/repeat"
  // branch already uses — see approveExpenseRequest/completeExpenseRequest's
  // idempotent paths) rather than returned straight from generateExpensePdfs,
  // so a caller of this helper always gets the same {name, path,
  // absolutePath, url} shape regardless of whether it just regenerated the
  // PDFs or short-circuited on a repeat call. generateExpensePdfs's own
  // {name, path, absolutePath, size, pageCount, annexedRawFiles} shape is
  // still exactly what saveExpenseSubmission (the original, non-repeatable
  // submission) returns — untouched, since it calls generateExpensePdfs
  // directly rather than through this helper.
  const pdfFiles = await listPdfFiles(rootDir, expensePayload.folderPath);

  return {
    absoluteFolderPath,
    pdfFiles,
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
    : await allocateExpenseRequestNumber(rootDir, payload.accountingMonth);
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
    status: existingRequest?.payload?.status || "submitted",
    statusHistory: existingRequest?.payload?.statusHistory,
    sheetSync: existingRequest?.payload?.sheetSync,
  });

  if (existingRequest?.payload?.sheetSync?.syncStatus === "synced") {
    expensePayload.sheetSync = {
      ...existingRequest.payload.sheetSync,
      syncStatus: "needs_resync",
      updatedAt: new Date().toISOString(),
    };
  }

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
  indexExpenseRequest(rootDir, expensePayload);
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

async function saveSubstituteReceiptSubmission({
  rootDir,
  payload,
  uploads = [],
  createStockMovements = true,
}) {
  if (payload.receiptNo) throw new Error("Submitted substitute receipts cannot be edited");

  let draft = null;
  if (payload.draftId) {
    draft = await getSubstituteReceiptDraft(rootDir, payload.draftId, { includeSubmitted: true });
    if (draft.status === "submitted") {
      throw new Error("Submitted substitute receipt drafts cannot be submitted again");
    }
  }

  const submissionPayload = {
    ...draft?.payload,
    ...payload,
    draftId: payload.draftId || draft?.draftId,
  };
  await assertSubstituteReceiptTypeMatchesWorkflowStep(rootDir, submissionPayload);
  const nextReceipt = await allocateSubstituteReceiptNumber(rootDir, submissionPayload.accountingMonth);
  const existingEvidenceFiles = draft?.evidenceFiles ?? submissionPayload.evidenceFiles ?? {};
  const preparedUploads = prepareUploadRecords(uploads, existingEvidenceFiles, buildSubstituteReceiptRawFileName);
  const evidenceFiles = mergeEvidenceFiles(existingEvidenceFiles, preparedUploads.evidenceFiles);
  const errors = validateSubstituteReceipt({
    ...submissionPayload,
    sequence: nextReceipt.sequence,
    receiptNo: nextReceipt.receiptNo,
    evidenceFiles,
  });
  if (errors.length) throw new Error(errors.join(", "));

  const company = await getCompanySettings(rootDir);
  const now = new Date().toISOString();
  const receiptPayload = buildSubstituteReceiptPayload({
    ...submissionPayload,
    company,
    receiptNo: nextReceipt.receiptNo,
    sequence: nextReceipt.sequence,
    evidenceFiles,
    createdAt: now,
  });
  receiptPayload.status = "pending_approval";
  receiptPayload.statusLabel = SUBSTITUTE_RECEIPT_STATUS_LABELS.pending_approval;
  receiptPayload.statusHistory = [{
    fromStatus: "",
    toStatus: "pending_approval",
    changedAt: now,
    note: "submitted",
  }];
  receiptPayload.stockReceipt = null;
  receiptPayload.revisions = [];

  const absoluteFolderPath = path.join(rootDir, receiptPayload.folderPath);
  const rawDir = path.join(absoluteFolderPath, "raw");
  const dataDir = path.join(absoluteFolderPath, "data");
  const workingMdDir = path.join(absoluteFolderPath, "working-md");
  const pdfDir = path.join(absoluteFolderPath, "pdf");

  await mkdir(rawDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await mkdir(workingMdDir, { recursive: true });
  await mkdir(pdfDir, { recursive: true });

  const rawFiles = flattenEvidenceFiles(existingEvidenceFiles);
  if (draft) {
    const draftRawDir = path.join(rootDir, draft.folderPath, "raw");
    for (const fileRecord of rawFiles) {
      await copyFile(path.join(draftRawDir, fileRecord.storedName), path.join(rawDir, fileRecord.storedName));
    }
  }

  for (const write of preparedUploads.writes) {
    await writeFile(path.join(rawDir, write.fileRecord.storedName), write.buffer);
    rawFiles.push(write.fileRecord);
  }

  const submissionJsonPath = path.join(dataDir, "substitute-receipt.json");
  await writeFile(submissionJsonPath, `${JSON.stringify(receiptPayload, null, 2)}\n`, "utf8");
  indexSubstituteReceipt(rootDir, receiptPayload);
  await writeFile(path.join(workingMdDir, "substitute-receipt.md"), formatSubstituteReceiptMarkdown(receiptPayload), "utf8");
  const pdfFiles = await generateSubstituteReceiptPdfs({
    payloadPath: submissionJsonPath,
    outputDir: pdfDir,
    rawDir,
  });

  const stockMovements = [];

  if (draft) {
    await writeSubstituteReceiptDraftRecord(rootDir, {
      ...draft,
      status: "submitted",
      submittedReceiptNo: receiptPayload.receiptNo,
      submittedAt: now,
      updatedAt: now,
    });
  }

  return {
    receiptNo: receiptPayload.receiptNo,
    status: receiptPayload.status,
    folderPath: receiptPayload.folderPath,
    absoluteFolderPath,
    pdfFiles,
    rawFiles,
    stockMovements,
  };
}

// Same write-through contract as indexExpenseRequest above: called only
// after substitute-receipt.json has actually been written.
function indexSubstituteReceipt(rootDir, receiptPayload) {
  indexDocument(rootDir, {
    documentKind: "substitute_receipt",
    documentNo: receiptPayload.receiptNo,
    accountingMonth: receiptPayload.accountingMonth,
    status: receiptPayload.status,
    folderPath: receiptPayload.folderPath,
    transactionNo: receiptPayload.transactionNo,
    workflowTemplateId: receiptPayload.workflowTemplateId,
    workflowStepId: receiptPayload.workflowStepId,
    createdAt: receiptPayload.createdAt,
    updatedAt: receiptPayload.updatedAt,
  });
}

async function writeSubmittedSubstituteReceiptFiles(rootDir, receiptPayload) {
  const absoluteFolderPath = path.join(rootDir, receiptPayload.folderPath);
  const rawDir = path.join(absoluteFolderPath, "raw");
  const dataDir = path.join(absoluteFolderPath, "data");
  const workingMdDir = path.join(absoluteFolderPath, "working-md");
  const pdfDir = path.join(absoluteFolderPath, "pdf");
  const submissionJsonPath = path.join(dataDir, "substitute-receipt.json");

  await mkdir(dataDir, { recursive: true });
  await mkdir(workingMdDir, { recursive: true });
  await mkdir(pdfDir, { recursive: true });
  await writeFile(submissionJsonPath, `${JSON.stringify(receiptPayload, null, 2)}\n`, "utf8");
  indexSubstituteReceipt(rootDir, receiptPayload);
  await writeFile(path.join(workingMdDir, "substitute-receipt.md"), formatSubstituteReceiptMarkdown(receiptPayload), "utf8");
  await generateSubstituteReceiptPdfs({
    payloadPath: submissionJsonPath,
    outputDir: pdfDir,
    rawDir,
  });
  // Same shape unification as writeSubmittedExpenseRequestFiles above: every
  // caller of this helper (approveSubstituteReceipt, receiveSubstituteReceiptStock,
  // completeSubstituteReceipt) gets the {name, path, absolutePath, url} shape,
  // matching each of those functions' own idempotent/repeat branch, which
  // already lists via listSubstituteReceiptPdfFiles.
  const pdfFiles = await listSubstituteReceiptPdfFiles(rootDir, receiptPayload.folderPath, receiptPayload.receiptNo);

  return {
    absoluteFolderPath,
    pdfFiles,
  };
}

async function buildSubmittedSubstituteReceiptRecord(rootDir, folderPath) {
  const absolutePath = path.join(rootDir, folderPath, "data", "substitute-receipt.json");
  const payload = JSON.parse(await readFile(absolutePath, "utf8"));
  const resolvedFolderPath = payload.folderPath || folderPath;
  const inferredStatus = listStockMovementsByReference(rootDir, "substitute_receipt", payload.receiptNo).length
    ? "received"
    : "pending_approval";
  const status = normalizeSubstituteReceiptStatus(payload.status || inferredStatus);
  const rawFiles = await listSubstituteReceiptRawFiles(rootDir, resolvedFolderPath, payload.receiptNo);
  const pdfFiles = await listSubstituteReceiptPdfFiles(rootDir, resolvedFolderPath, payload.receiptNo);
  const syncMetadata = await readDriveSyncMetadata(rootDir, resolvedFolderPath);

  return {
    id: payload.receiptNo,
    receiptNo: payload.receiptNo,
    status,
    receiptTitle: payload.receiptTitle || getRequestTitleFromFolderPath(resolvedFolderPath, payload.receiptNo),
    payeeName: payload.payeeName || "",
    folderPath: resolvedFolderPath,
    absoluteFolderPath: path.join(rootDir, resolvedFolderPath),
    accountingMonth: payload.accountingMonth || getAccountingMonthFromReceiptNo(payload.receiptNo),
    updatedAt: payload.updatedAt || payload.createdAt || "",
    totalAmount: payload.totals?.totalAmount || "0.00",
    rawFileCount: rawFiles.length,
    rawFiles,
    pdfFiles,
    syncStatus: syncMetadata?.syncStatus || "not_synced",
    driveFolderUrl: syncMetadata?.driveFolderUrl || "",
    driveFolderId: syncMetadata?.driveFolderId || "",
    drivePath: syncMetadata?.drivePath || "",
    uploadedFileCount: syncMetadata?.uploadedFileCount || 0,
    syncedAt: syncMetadata?.syncedAt || "",
    syncError: syncMetadata?.error || "",
    sheetSyncStatus: payload.sheetSync?.syncStatus || "not_synced",
    sheetSpreadsheetUrl: payload.sheetSync?.spreadsheetUrl || "",
    sheetSpreadsheetId: payload.sheetSync?.spreadsheetId || "",
    sheetName: payload.sheetSync?.sheetName || "",
    sheetRowNumber: payload.sheetSync?.rowNumber || 0,
    sheetSyncedAt: payload.sheetSync?.syncedAt || "",
    sheetSyncError: payload.sheetSync?.error || "",
    payload: {
      ...payload,
      status,
      statusLabel: payload.statusLabel || SUBSTITUTE_RECEIPT_STATUS_LABELS[status],
      folderPath: payload.folderPath || resolvedFolderPath,
    },
  };
}

// See findSubmittedExpenseRequests above for why this reads the documents
// index (rows where document_kind='substitute_receipt') instead of walking
// documents/ recursively.
async function findSubmittedSubstituteReceipts(rootDir) {
  const rows = withDocumentIndexDatabase(rootDir, (db) => queryDocumentIndexRows(db, { documentKind: "substitute_receipt" }));
  const records = [];

  for (const row of rows) {
    try {
      records.push(await buildSubmittedSubstituteReceiptRecord(rootDir, row.folderPath));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      logIndexDriftWarning(row.documentNo, row.folderPath);
    }
  }

  return records.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function getSubstituteReceiptNextAction(status) {
  if (status === "pending_approval") return "อนุมัติ";
  if (status === "approved") return "รับสินค้าเข้าคลัง";
  if (status === "received") return "ดูเอกสาร";
  if (status === "completed") return "เสร็จสิ้น";
  if (status === "draft") return "แก้ไขแบบร่าง";
  if (status === "cancelled") return "ยกเลิกแล้ว";
  return "ดูเอกสาร";
}

async function listSubstituteReceipts(rootDir) {
  const draftRecords = (await findSubstituteReceiptDraftRecords(rootDir, false)).map((draft) => {
    const payload = draft.payload || {};
    const rawFileCount = flattenEvidenceFiles(draft.evidenceFiles).length;
    return {
      id: draft.draftId,
      status: "draft",
      statusLabel: SUBSTITUTE_RECEIPT_STATUS_LABELS.draft,
      draftId: draft.draftId,
      receiptNo: "",
      receiptTitle: payload.receiptTitle || "ยังไม่ได้ตั้งชื่อ",
      payeeName: payload.payeeName || "",
      accountingMonth: payload.accountingMonth || "",
      updatedAt: draft.updatedAt,
      totalAmount: payload.totals?.totalAmount || "",
      rawFileCount,
      rawFiles: [],
      folderPath: draft.folderPath,
      pdfFiles: [],
      editUrl: `/substitute-receipt?draftId=${encodeURIComponent(draft.draftId)}`,
      nextAction: getSubstituteReceiptNextAction("draft"),
      syncStatus: "",
      driveFolderUrl: "",
      driveFolderId: "",
      drivePath: "",
      uploadedFileCount: 0,
      syncedAt: "",
      syncError: "",
    };
  });
  const submittedRecords = await findSubmittedSubstituteReceipts(rootDir);

  return [
    ...draftRecords,
    ...submittedRecords.map((receipt) => ({
      id: receipt.receiptNo,
      status: receipt.status,
      statusLabel: SUBSTITUTE_RECEIPT_STATUS_LABELS[receipt.status] || receipt.status,
      draftId: "",
      receiptNo: receipt.receiptNo,
      receiptTitle: receipt.receiptTitle,
      payeeName: receipt.payeeName,
      accountingMonth: receipt.accountingMonth,
      updatedAt: receipt.updatedAt,
      totalAmount: receipt.totalAmount,
      rawFileCount: receipt.rawFileCount,
      rawFiles: receipt.rawFiles,
      folderPath: receipt.folderPath,
      pdfFiles: receipt.pdfFiles,
      editUrl: `/substitute-receipt?receiptNo=${encodeURIComponent(receipt.receiptNo)}`,
      nextAction: getSubstituteReceiptNextAction(receipt.status),
      syncStatus: receipt.syncStatus,
      driveFolderUrl: receipt.driveFolderUrl,
      driveFolderId: receipt.driveFolderId,
      drivePath: receipt.drivePath,
      uploadedFileCount: receipt.uploadedFileCount,
      syncedAt: receipt.syncedAt,
      syncError: receipt.syncError,
      sheetSyncStatus: receipt.sheetSyncStatus,
      sheetSpreadsheetUrl: receipt.sheetSpreadsheetUrl,
      sheetSpreadsheetId: receipt.sheetSpreadsheetId,
      sheetName: receipt.sheetName,
      sheetRowNumber: receipt.sheetRowNumber,
      sheetSyncedAt: receipt.sheetSyncedAt,
      sheetSyncError: receipt.sheetSyncError,
    })),
  ].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

// Point-lookup counterpart of findSubmittedSubstituteReceipts -- see the
// comment above getSubmittedExpenseRequestRecord for why this indexes first
// and falls back to a full disk search only on an index miss/drift.
async function getSubmittedSubstituteReceiptRecord(rootDir, receiptNo) {
  const row = withDocumentIndexDatabase(rootDir, (db) => getDocumentIndexRowByNumber(db, "substitute_receipt", receiptNo));
  if (row) {
    try {
      return await buildSubmittedSubstituteReceiptRecord(rootDir, row.folderPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      logIndexDriftWarning(receiptNo, row.folderPath);
    }
  }

  for (const folderPath of await walkDocumentsForFolderPaths(rootDir, "substitute-receipt.json")) {
    try {
      const candidate = await buildSubmittedSubstituteReceiptRecord(rootDir, folderPath);
      if (candidate.receiptNo === receiptNo) return candidate;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  return null;
}

async function getSubmittedSubstituteReceipt(rootDir, receiptNo) {
  if (!receiptNo) throw new Error("Missing substitute receipt number");
  const receipt = await getSubmittedSubstituteReceiptRecord(rootDir, receiptNo);
  if (!receipt) throw new Error("Substitute receipt not found");
  return receipt;
}

async function getSubstituteReceiptFile({ rootDir, receiptNo, section, fileName }) {
  if (!receiptNo) throw new Error("Missing substitute receipt number");
  if (!["pdf", "raw"].includes(section)) throw new Error("Invalid file section");
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") {
    throw new Error("Invalid file name");
  }

  const receipt = await getSubmittedSubstituteReceipt(rootDir, receiptNo);
  const baseDir = path.resolve(rootDir, receipt.folderPath, section);
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

// `now` is injectable (defaulting to the real wall clock) and must be the
// exact same clock/value the caller uses to stamp its own audit field
// (approvedAt/receivedAt/completedAt) for this same event — otherwise
// statusHistory.at(-1).changedAt and that audit field can disagree even
// though they describe one status change. See the three call sites below,
// each of which computes its timestamp once and passes it in here rather
// than letting this function reach for the clock a second time.
function appendSubstituteReceiptStatus(payload, toStatus, note, actor, now = () => new Date().toISOString()) {
  const fromStatus = normalizeSubstituteReceiptStatus(payload.status || "pending_approval");
  assertSubstituteReceiptTransition(fromStatus, toStatus);
  const changedAt = now();
  payload.status = toStatus;
  payload.statusLabel = SUBSTITUTE_RECEIPT_STATUS_LABELS[toStatus];
  payload.updatedAt = changedAt;
  payload.statusHistory = [
    ...(Array.isArray(payload.statusHistory) ? payload.statusHistory : []),
    {
      fromStatus,
      toStatus,
      changedAt,
      note,
      actor: actor || "",
    },
  ];
}

function appendExpenseRequestStatus(payload, toStatus, note, actor, now = () => new Date().toISOString()) {
  const fromStatus = normalizeExpenseRequestStatus(payload.status || "submitted");
  const targetStatus = normalizeExpenseRequestStatus(toStatus);
  if ((fromStatus === "cancelled" || fromStatus === "completed") && targetStatus !== fromStatus) {
    throw new Error(`Invalid expense request status transition: ${fromStatus} -> ${targetStatus}`);
  }
  if (targetStatus === "completed" && fromStatus !== "approved" && fromStatus !== "completed") {
    throw new Error(`Invalid expense request status transition: ${fromStatus} -> ${targetStatus}`);
  }
  const changedAt = now();
  payload.status = targetStatus;
  payload.statusLabel = EXPENSE_REQUEST_STATUS_LABELS[targetStatus];
  payload.updatedAt = changedAt;
  payload.statusHistory = [
    ...(Array.isArray(payload.statusHistory) ? payload.statusHistory : []),
    {
      fromStatus,
      toStatus: targetStatus,
      changedAt,
      note,
      actor: actor || "",
    },
  ];
}

async function approveExpenseRequest({
  rootDir,
  requestNo,
  approvedBy = "",
  expenseRecorder = recordMonthlyExpense,
  now = () => new Date().toISOString(),
}) {
  const request = await getSubmittedExpenseRequest(rootDir, requestNo);
  const payload = {
    ...request.payload,
    folderPath: request.folderPath,
  };
  const approvedAt = now();
  appendExpenseRequestStatus(payload, "approved", "approved", approvedBy, () => approvedAt);
  payload.approvedAt = approvedAt;
  payload.approvedBy = approvedBy || "";
  const driveMetadata = await readDriveSyncMetadata(rootDir, request.folderPath);
  await recordExpenseSheetMetadata({
    rootDir,
    folderPath: request.folderPath,
    payload,
    entry: buildExpenseRequestSheetEntry(payload, driveMetadata, approvedAt),
    expenseRecorder,
    now,
  });
  const { pdfFiles } = await writeSubmittedExpenseRequestFiles(rootDir, payload);

  return {
    requestNo: payload.requestNo,
    status: payload.status,
    folderPath: payload.folderPath,
    pdfFiles,
    sheetSync: payload.sheetSync,
  };
}

async function approveSubstituteReceipt({
  rootDir,
  receiptNo,
  approvedBy = "",
  expenseRecorder = recordMonthlyExpense,
  now = () => new Date().toISOString(),
}) {
  const receipt = await getSubmittedSubstituteReceipt(rootDir, receiptNo);
  const payload = {
    ...receipt.payload,
    folderPath: receipt.folderPath,
  };
  const approvedAt = now();
  appendSubstituteReceiptStatus(payload, "approved", "approved", approvedBy, () => approvedAt);
  payload.approvedAt = approvedAt;
  payload.approvedBy = approvedBy || "";
  const driveMetadata = await readDriveSyncMetadata(rootDir, receipt.folderPath);
  await recordExpenseSheetMetadata({
    rootDir,
    folderPath: receipt.folderPath,
    payload,
    entry: buildSubstituteReceiptSheetEntry(payload, driveMetadata, approvedAt),
    expenseRecorder,
    now,
  });
  const { pdfFiles } = await writeSubmittedSubstituteReceiptFiles(rootDir, payload);

  return {
    receiptNo: payload.receiptNo,
    status: payload.status,
    folderPath: payload.folderPath,
    pdfFiles,
    sheetSync: payload.sheetSync,
  };
}

async function receiveSubstituteReceiptStock({
  rootDir,
  receiptNo,
  receivedDate,
  receivedBy = "",
  now = () => new Date().toISOString(),
}) {
  const receipt = await getSubmittedSubstituteReceipt(rootDir, receiptNo);
  const payload = {
    ...receipt.payload,
    folderPath: receipt.folderPath,
  };
  const currentStatus = normalizeSubstituteReceiptStatus(payload.status || "pending_approval");
  if (currentStatus !== "approved" && currentStatus !== "received") {
    assertSubstituteReceiptTransition(currentStatus, "received");
  }
  if (payload.receiptType !== "stock_purchase") {
    throw new Error("Only stock purchase receipts can be received into inventory");
  }
  if (!receivedDate) throw new Error("ระบุวันที่รับสินค้า");

  if (currentStatus === "received") {
    // A repeat receive call (retry, double-clicked "receive" button) is a
    // true no-op, the same way completeExpenseRequest/completeSubstituteReceipt
    // treat a repeat completion: stockReceipt.receivedAt/receivedBy is the
    // audit record of who received the goods and when, and native "received"
    // is what the workflow layer treats as completing this step, so a retry
    // must not rewrite that stamp, append to statusHistory, or throw. It also
    // must not create a second set of inventory movements — the existing
    // movements for this receipt (created on the first, real receive) are
    // returned unchanged rather than re-derived from payload.lines.
    return {
      receiptNo: payload.receiptNo,
      status: payload.status,
      folderPath: payload.folderPath,
      pdfFiles: await listSubstituteReceiptPdfFiles(rootDir, payload.folderPath, payload.receiptNo),
      stockMovements: listStockMovementsByReference(rootDir, "substitute_receipt", receiptNo),
    };
  }

  // First (and only legitimate) receive for this receipt. Guard against
  // creating a duplicate movement set even here, in case movements already
  // exist for this reference out of band.
  let stockMovements = listStockMovementsByReference(rootDir, "substitute_receipt", receiptNo);
  if (!stockMovements.length) {
    stockMovements = (payload.lines || []).map((line) => createPurchaseInMovement(rootDir, {
      stockSkuId: line.stockSkuId,
      movementDate: receivedDate,
      quantity: line.quantity,
      unitCost: line.unitCost,
      referenceType: "substitute_receipt",
      referenceNo: payload.receiptNo,
      note: line.description,
    }));
  }

  const receivedAt = now();
  appendSubstituteReceiptStatus(payload, "received", "received stock", receivedBy, () => receivedAt);
  payload.stockReceipt = {
    receivedAt,
    receivedDate,
    receivedBy,
    movementIds: stockMovements.map((movement) => movement.id),
  };
  const { pdfFiles } = await writeSubmittedSubstituteReceiptFiles(rootDir, payload);

  return {
    receiptNo: payload.receiptNo,
    status: payload.status,
    folderPath: payload.folderPath,
    pdfFiles,
    stockMovements,
  };
}

async function completeExpenseRequest({
  rootDir,
  requestNo,
  completedBy = "",
  now = () => new Date().toISOString(),
}) {
  const request = await getSubmittedExpenseRequest(rootDir, requestNo);
  const payload = {
    ...request.payload,
    folderPath: request.folderPath,
  };
  const currentStatus = normalizeExpenseRequestStatus(payload.status || "submitted");

  if (currentStatus === "completed") {
    // A repeat completion call (retry, double-click, replayed request) is a no-op:
    // completedAt/completedBy are the audit record of who closed the document and
    // when, so they must not be overwritten, and no duplicate history entry is added.
    return {
      requestNo: payload.requestNo,
      status: payload.status,
      completedAt: payload.completedAt,
      completedBy: payload.completedBy,
      folderPath: payload.folderPath,
      pdfFiles: await listPdfFiles(rootDir, payload.folderPath),
    };
  }

  const completedAt = now();
  appendExpenseRequestStatus(payload, "completed", "completed", completedBy, () => completedAt);
  payload.completedAt = completedAt;
  payload.completedBy = completedBy || "";
  const { pdfFiles } = await writeSubmittedExpenseRequestFiles(rootDir, payload);

  return {
    requestNo: payload.requestNo,
    status: payload.status,
    completedAt: payload.completedAt,
    completedBy: payload.completedBy,
    folderPath: payload.folderPath,
    pdfFiles,
  };
}

async function completeSubstituteReceipt({
  rootDir,
  receiptNo,
  completedBy = "",
  now = () => new Date().toISOString(),
}) {
  const receipt = await getSubmittedSubstituteReceipt(rootDir, receiptNo);
  const payload = {
    ...receipt.payload,
    folderPath: receipt.folderPath,
  };
  const currentStatus = normalizeSubstituteReceiptStatus(payload.status || "pending_approval");

  if (currentStatus === "completed") {
    // A repeat completion call (retry, double-click, replayed request) is a no-op:
    // completedAt/completedBy are the audit record of who closed the document and
    // when, so they must not be overwritten, and no duplicate history entry is added.
    return {
      receiptNo: payload.receiptNo,
      status: payload.status,
      completedAt: payload.completedAt,
      completedBy: payload.completedBy,
      folderPath: payload.folderPath,
      pdfFiles: await listSubstituteReceiptPdfFiles(rootDir, payload.folderPath, payload.receiptNo),
    };
  }

  const completedAt = now();
  appendSubstituteReceiptStatus(payload, "completed", "completed", completedBy, () => completedAt);
  payload.completedAt = completedAt;
  payload.completedBy = completedBy || "";
  const { pdfFiles } = await writeSubmittedSubstituteReceiptFiles(rootDir, payload);

  return {
    receiptNo: payload.receiptNo,
    status: payload.status,
    completedAt: payload.completedAt,
    completedBy: payload.completedBy,
    folderPath: payload.folderPath,
    pdfFiles,
  };
}

async function writeWorkflowDocumentFiles(rootDir, payload, { beforeCommit } = {}) {
  const absoluteFolderPath = path.join(rootDir, payload.folderPath);
  const dataDir = path.join(absoluteFolderPath, "data");
  const workingMdDir = path.join(absoluteFolderPath, "working-md");
  const pdfDir = path.join(absoluteFolderPath, "pdf");

  await mkdir(dataDir, { recursive: true });
  await mkdir(workingMdDir, { recursive: true });
  await mkdir(pdfDir, { recursive: true });

  // Last chance to refuse before the commit write below. Callers (see
  // saveWorkflowDocument) pass a hook that re-reads the on-disk status: the
  // three mkdir calls above are each an awaited event-loop yield a concurrent
  // .../complete request can land in, so the check that decides whether this
  // write may proceed must run *after* them, immediately before the commit —
  // otherwise a completion landing during those mkdirs would still get
  // silently reverted by this write.
  if (beforeCommit) {
    await beforeCommit();
  }

  const dataPath = path.join(dataDir, "workflow-document.json");
  await writeFile(dataPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  // Single write-through choke point for all five lightweight document
  // kinds: saveWorkflowDocument (create/edit) and completeWorkflowDocument
  // both funnel their commit through this function, so indexing here once
  // keeps the `documents` index current for all of them without duplicating
  // this call at each caller.
  indexDocument(rootDir, {
    documentKind: payload.documentKind,
    documentNo: payload.documentNo,
    accountingMonth: payload.accountingMonth,
    status: payload.status,
    folderPath: payload.folderPath,
    transactionNo: payload.transactionNo,
    workflowTemplateId: payload.workflowTemplateId,
    workflowStepId: payload.workflowStepId,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
  });
  await writeFile(path.join(workingMdDir, "workflow-document.md"), formatWorkflowDocumentMarkdown(payload), "utf8");

  await generateWorkflowDocumentPdf({
    payloadPath: dataPath,
    outputDir: pdfDir,
  });
  // Same shape unification as writeSubmittedExpenseRequestFiles/
  // writeSubmittedSubstituteReceiptFiles above: completeWorkflowDocument's
  // idempotent repeat-completion branch already hands back the
  // {name, path, absolutePath, url} shape via listWorkflowDocumentPdfFiles,
  // so the first-time completion (and the initial save, via saveWorkflowDocument)
  // must match it rather than handing back generateWorkflowDocumentPdf's raw
  // {size, pageCount, ...} shape with no url at all.
  const pdfFiles = await listWorkflowDocumentPdfFiles(rootDir, payload.folderPath, payload.documentKind, payload.documentNo);

  return { absoluteFolderPath, pdfFiles };
}

async function buildWorkflowDocumentRecord(rootDir, folderPath) {
  const absolutePath = path.join(rootDir, folderPath, "data", "workflow-document.json");
  const payload = JSON.parse(await readFile(absolutePath, "utf8"));

  return {
    documentKind: payload.documentKind,
    documentNo: payload.documentNo,
    status: payload.status,
    statusLabel: payload.statusLabel || WORKFLOW_DOCUMENT_STATUS_LABELS[payload.status] || payload.status,
    title: payload.title || "",
    transactionNo: payload.transactionNo || "",
    workflowTemplateId: payload.workflowTemplateId || "",
    workflowStepId: payload.workflowStepId || "",
    folderPath: payload.folderPath || folderPath,
    absoluteFolderPath: path.join(rootDir, folderPath),
    updatedAt: payload.updatedAt || payload.createdAt || "",
    payload,
  };
}

// Reads the documents index instead of walking documents/ recursively --
// see findSubmittedExpenseRequests above. Every filter listWorkflowDocuments
// accepts (documentKind, transactionNo, workflowTemplateId, workflowStepId,
// status) maps directly onto an indexed column, so filtering happens in SQL
// rather than "list everything, then filter in JS" -- the whole point of
// findLightweightWorkflowDocuments(rootDir, transactionNo) (a hot path on
// every workflow-transaction page load) is exactly this transactionNo
// pushdown, so it no longer has to look at any lightweight document outside
// the one transaction it cares about.
async function listWorkflowDocuments(rootDir, filters = {}) {
  const rows = withDocumentIndexDatabase(rootDir, (db) => queryDocumentIndexRows(db, {
    documentKind: filters.documentKind || undefined,
    documentKinds: filters.documentKind ? undefined : LIGHTWEIGHT_DOCUMENT_KINDS,
    transactionNo: filters.transactionNo || undefined,
    workflowTemplateId: filters.workflowTemplateId || undefined,
    workflowStepId: filters.workflowStepId || undefined,
    status: filters.status || undefined,
    accountingMonth: filters.accountingMonth || undefined,
  }));

  const records = [];
  for (const row of rows) {
    try {
      records.push(await buildWorkflowDocumentRecord(rootDir, row.folderPath));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      logIndexDriftWarning(row.documentNo, row.folderPath);
    }
  }

  return records.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

const WORKFLOW_DOCUMENT_LIST_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const WORKFLOW_TRANSACTION_NO_PATTERN = /^TXN-\d{4}-(0[1-9]|1[0-2])-\d{4}$/;
const WORKFLOW_REFERENCE_ID_MAX_LENGTH = 200;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

// Validates every query parameter GET /api/workflow-documents accepts before
// any of it reaches the documents index. Each value is only ever handed to
// queryDocumentIndexRows as a bound parameter anyway; this makes an
// unrecognised value a Thai 400 instead of a silent empty list (and, for
// documentKind, stops a caller from pointing this lightweight-document route
// at expense_request/substitute_receipt rows, which have no
// workflow-document.json to read). "all" is the list page's "no status
// filter" option. Template/step ids are free-form (saveWorkflowTemplate takes
// any string), so they are only bounded, never pattern-matched.
function parseWorkflowDocumentListFilters(searchParams) {
  const read = (name) => String(searchParams?.get?.(name) ?? "");

  const documentKind = read("documentKind");
  if (documentKind && !LIGHTWEIGHT_DOCUMENT_KINDS.includes(documentKind)) {
    throw new Error("ประเภทเอกสารไม่ถูกต้อง");
  }

  const accountingMonth = read("accountingMonth");
  if (accountingMonth && !WORKFLOW_DOCUMENT_LIST_MONTH_PATTERN.test(accountingMonth)) {
    throw new Error("เดือนบัญชีไม่ถูกต้อง (ใช้รูปแบบ YYYY-MM)");
  }

  const requestedStatus = read("status");
  const status = requestedStatus === "all" ? "" : requestedStatus;
  if (status && !Object.prototype.hasOwnProperty.call(WORKFLOW_DOCUMENT_STATUS_LABELS, status)) {
    throw new Error("สถานะเอกสารไม่ถูกต้อง");
  }

  const transactionNo = read("transactionNo");
  if (transactionNo && !WORKFLOW_TRANSACTION_NO_PATTERN.test(transactionNo)) {
    throw new Error("เลขที่ธุรกรรมไม่ถูกต้อง");
  }

  const readReferenceId = (name, message) => {
    const value = read(name);
    if (value.length > WORKFLOW_REFERENCE_ID_MAX_LENGTH || CONTROL_CHARACTER_PATTERN.test(value)) {
      throw new Error(message);
    }
    return value;
  };

  return {
    documentKind,
    accountingMonth,
    status,
    transactionNo,
    workflowTemplateId: readReferenceId("workflowTemplateId", "รหัส Workflow Template ไม่ถูกต้อง"),
    workflowStepId: readReferenceId("workflowStepId", "รหัสขั้นตอน Workflow ไม่ถูกต้อง"),
  };
}

function omitAbsolutePathFromListedFile(file) {
  if (!file || typeof file !== "object") return file;
  const { absolutePath, ...rest } = file;
  return rest;
}

// One row per document for the /workflow-documents list page (GET
// /api/workflow-documents). On top of listWorkflowDocuments' record it
// surfaces the columns the page shows (date, payee, total, month) and the
// document's PDF/raw files -- every url built by buildWorkflowDocumentFileUrl,
// i.e. served only through the guarded getWorkflowDocumentFile route. The
// server's filesystem paths (the record's absoluteFolderPath and each file's
// absolutePath) are stripped here, before the response is ever built.
async function listWorkflowDocumentSummaries(rootDir, filters = {}) {
  const records = await listWorkflowDocuments(rootDir, filters);

  return Promise.all(records.map(async (record) => {
    const { absoluteFolderPath, ...rest } = record;
    const payload = record.payload || {};
    const [pdfFiles, rawFiles, driveSync] = await Promise.all([
      listWorkflowDocumentPdfFiles(rootDir, record.folderPath, record.documentKind, record.documentNo),
      listWorkflowDocumentRawFiles(rootDir, record.folderPath, record.documentKind, record.documentNo),
      readDriveSyncMetadataForListing(rootDir, record),
    ]);

    return {
      ...rest,
      documentKindLabel: payload.documentKindLabel || record.documentKind,
      accountingMonth: payload.accountingMonth || "",
      documentDate: payload.documentDate || "",
      requesterName: payload.requesterName || "",
      payeeName: payload.payeeName || "",
      totalAmount: payload.totals?.grossAmount || "",
      pdfFiles: pdfFiles.map(omitAbsolutePathFromListedFile),
      rawFiles: rawFiles.map(omitAbsolutePathFromListedFile),
      // The document's own Drive sync state (data/drive-sync.json, written by
      // syncWorkflowDocumentToDrive), for the row's status badge and button.
      // syncError is the Thai reason, so a failure is still explained after
      // the page is reloaded.
      syncStatus: driveSync?.syncStatus || "not_synced",
      driveFolderUrl: driveSync?.driveFolderUrl || "",
      drivePath: driveSync?.drivePath || "",
      syncedAt: driveSync?.syncedAt || "",
      syncError: driveSync?.syncStatus === "sync_failed" ? describeDriveSyncError(driveSync.error) : "",
    };
  }));
}

// One unreadable (hand-edited, truncated) drive-sync.json must not take the
// whole list page down with it: it degrades to "not synced" for that one row
// and is logged, the same "degrade, don't crash" contract
// readExpenseRequestChildDocument uses.
async function readDriveSyncMetadataForListing(rootDir, record) {
  try {
    return await readDriveSyncMetadata(rootDir, record.folderPath);
  } catch (error) {
    console.error(`ไม่สามารถอ่านสถานะซิงก์ Google Drive ของ ${record.documentNo} ได้: ${error.message}`);
    return null;
  }
}

async function getWorkflowDocument(rootDir, documentKind, documentNo) {
  if (!documentKind || !documentNo) return null;

  const row = withDocumentIndexDatabase(rootDir, (db) => getDocumentIndexRowByNumber(db, documentKind, documentNo));
  if (row) {
    try {
      return await buildWorkflowDocumentRecord(rootDir, row.folderPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      logIndexDriftWarning(documentNo, row.folderPath);
    }
  }

  for (const folderPath of await walkDocumentsForFolderPaths(rootDir, "workflow-document.json")) {
    try {
      const candidate = await buildWorkflowDocumentRecord(rootDir, folderPath);
      if (candidate.documentKind === documentKind && candidate.documentNo === documentNo) return candidate;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  return null;
}

// Defense-in-depth path containment: resolves targetPath and refuses it unless
// it is baseDir itself or strictly inside it. Exported so this guard can be
// unit-tested directly, independent of whatever upstream sanitization
// currently prevents a hostile path from reaching it in practice — the whole
// point of "defense in depth" is that it must still hold if that sanitization
// ever regresses.
function assertPathWithinDirectory(baseDir, targetPath, message) {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(`${resolvedBase}${path.sep}`)) {
    throw new Error(message);
  }
  return resolvedTarget;
}

// Thrown by saveWorkflowDocument's assertNotCompletedOnDisk guard below. Kept
// as a shared constant so saveWorkflowDocument can recognize *this specific*
// refusal (as opposed to, say, a PDF-generation failure) when deciding whether
// a failed attempt needs to clean up raw files it just wrote.
const WORKFLOW_DOCUMENT_COMPLETED_GUARD_MESSAGE = "ไม่สามารถแก้ไขเอกสารที่เสร็จสิ้นแล้วได้";

async function saveWorkflowDocument({ rootDir, payload, uploads = [] }) {
  if (!LIGHTWEIGHT_DOCUMENT_KINDS.includes(payload.documentKind)) {
    throw new Error(`Invalid workflow document kind: ${payload.documentKind}`);
  }

  // Re-reads the stored status from disk and refuses if it has become
  // "completed". Called twice: once up front, before any raw evidence file is
  // written (so a save that is already doomed never leaves an orphaned file
  // behind, and the common case fails fast and cheaply); and again as the
  // beforeCommit hook passed to writeWorkflowDocumentFiles, immediately before
  // the actual JSON commit write, to close the TOCTOU window a concurrent
  // .../complete request could otherwise land in during the mkdir calls that
  // precede that commit. The route's own early check (in local-server.mjs)
  // stays too, for a fast, clear error before this function is even called.
  const assertNotCompletedOnDisk = async () => {
    if (!payload.documentNo) return;
    const currentOnDisk = await getWorkflowDocument(rootDir, payload.documentKind, payload.documentNo);
    if (currentOnDisk?.status === "completed") {
      throw new Error(WORKFLOW_DOCUMENT_COMPLETED_GUARD_MESSAGE);
    }
  };

  await assertNotCompletedOnDisk();

  const existingEvidenceFiles = payload.evidenceFiles ?? {};
  // Count against the same sanitized slug buildWorkflowDocumentRawFileName uses
  // to name the stored file, so raw evidenceKeys that collapse onto the same
  // slug (e.g. "a.b" and "ab" both sanitize to "ab") share one counter instead
  // of each starting at 0 and clobbering the same path — see prepareUploadRecords.
  const preparedUploads = prepareUploadRecords(uploads, existingEvidenceFiles, buildWorkflowDocumentRawFileName, sanitizeEvidenceKey);
  const evidenceFiles = mergeEvidenceFiles(existingEvidenceFiles, preparedUploads.evidenceFiles);
  const rawFiles = flattenEvidenceFiles(evidenceFiles).map((file) => file.storedName);

  const finalPayload = {
    ...payload,
    evidenceFiles,
    rawFiles: rawFiles.length ? rawFiles : payload.rawFiles ?? [],
  };

  // Defense in depth: folderPath is meant to be server-derived (fresh for a new
  // document, carried forward from the stored record for an edit — see
  // handleWorkflowDocumentSubmission), but a future bug in either path must not
  // turn into a write primitive outside rootDir. Re-resolve and contain it here,
  // the same way the read side already contains file lookups.
  const absoluteFolderPath = assertPathWithinDirectory(
    rootDir,
    path.join(rootDir, finalPayload.folderPath || ""),
    "ที่อยู่โฟลเดอร์เอกสารไม่ถูกต้อง",
  );

  const rawDir = path.join(absoluteFolderPath, "raw");
  await mkdir(rawDir, { recursive: true });

  const writtenRawPaths = [];
  for (const write of preparedUploads.writes) {
    const targetPath = assertPathWithinDirectory(
      rawDir,
      path.join(rawDir, write.fileRecord.storedName),
      "ชื่อไฟล์แนบไม่ถูกต้อง",
    );
    await writeFile(targetPath, write.buffer);
    writtenRawPaths.push(targetPath);
  }

  let pdfFiles;
  try {
    ({ pdfFiles } = await writeWorkflowDocumentFiles(rootDir, finalPayload, { beforeCommit: assertNotCompletedOnDisk }));
  } catch (error) {
    // Only the completed-guard refusal (not, say, a PDF-generation failure —
    // which happens *after* the JSON commit succeeds, so the raw files it
    // references are no longer orphans) means this attempt's raw files were
    // never committed to anything. Clean those up so a refused save — including
    // a naive client retry — never leaves an unreferenced file behind.
    if (error.message === WORKFLOW_DOCUMENT_COMPLETED_GUARD_MESSAGE && writtenRawPaths.length) {
      await Promise.all(writtenRawPaths.map((targetPath) => rm(targetPath, { force: true }).catch(() => {})));
    }
    throw error;
  }

  return {
    documentKind: finalPayload.documentKind,
    documentNo: finalPayload.documentNo,
    status: finalPayload.status,
    folderPath: finalPayload.folderPath,
    absoluteFolderPath,
    pdfFiles,
    rawFiles,
  };
}

async function completeWorkflowDocument({
  rootDir,
  documentKind,
  documentNo,
  completedBy = "",
  now = () => new Date().toISOString(),
}) {
  const record = await getWorkflowDocument(rootDir, documentKind, documentNo);
  if (!record) throw new Error("ไม่พบเอกสาร");

  const payload = { ...record.payload, folderPath: record.folderPath };
  const currentStatus = payload.status || "draft";

  if (currentStatus === "completed") {
    // A repeat completion call (retry, double-click, replayed request) is a no-op:
    // completedAt/completedBy are the audit record of who closed the document and
    // when, so they must not be overwritten, and no duplicate history entry is added.
    return {
      documentKind: payload.documentKind,
      documentNo: payload.documentNo,
      status: payload.status,
      completedAt: payload.completedAt,
      completedBy: payload.completedBy,
      folderPath: payload.folderPath,
      pdfFiles: await listWorkflowDocumentPdfFiles(rootDir, payload.folderPath, payload.documentKind, payload.documentNo),
    };
  }

  // A cancelled document must never be silently reopened by completing it.
  assertWorkflowDocumentCompletable(currentStatus);

  const completedAt = now();
  payload.statusHistory = [
    ...(Array.isArray(payload.statusHistory) ? payload.statusHistory : []),
    { fromStatus: currentStatus, toStatus: "completed", changedAt: completedAt, note: "completed" },
  ];
  payload.status = "completed";
  payload.statusLabel = WORKFLOW_DOCUMENT_STATUS_LABELS.completed;
  payload.completedAt = completedAt;
  payload.completedBy = completedBy || "";
  payload.updatedAt = completedAt;

  const { pdfFiles } = await writeWorkflowDocumentFiles(rootDir, payload);

  return {
    documentKind: payload.documentKind,
    documentNo: payload.documentNo,
    status: payload.status,
    completedAt: payload.completedAt,
    completedBy: payload.completedBy,
    folderPath: payload.folderPath,
    pdfFiles,
  };
}

async function getWorkflowDocumentFile({ rootDir, documentKind, documentNo, section, fileName }) {
  if (!documentNo) throw new Error("ไม่มีเลขที่เอกสาร");
  if (!["pdf", "raw"].includes(section)) throw new Error("ส่วนไฟล์ไม่ถูกต้อง");
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") {
    throw new Error("ชื่อไฟล์ไม่ถูกต้อง");
  }

  const record = await getWorkflowDocument(rootDir, documentKind, documentNo);
  if (!record) throw new Error("ไม่พบเอกสาร");

  const baseDir = path.resolve(rootDir, record.folderPath, section);
  const absolutePath = path.resolve(baseDir, fileName);
  if (!absolutePath.startsWith(`${baseDir}${path.sep}`)) {
    throw new Error("ชื่อไฟล์ไม่ถูกต้อง");
  }

  return { absolutePath, fileName, section };
}

async function getExpenseRequestFile({ rootDir, requestNo, section, fileName }) {
  if (!requestNo) throw new Error("Missing expense request number");
  if (!["pdf", "raw"].includes(section)) throw new Error("Invalid file section");
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") {
    throw new Error("Invalid file name");
  }

  const request = await getSubmittedExpenseRequestRecord(rootDir, requestNo);
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

function listWorkflowDocumentTypes() {
  return Object.values(DOCUMENT_TYPE_DEFINITIONS);
}

function getWorkflowTemplatesFilePath(rootDir) {
  return path.join(rootDir, "data", "workflow-templates.json");
}

async function listWorkflowTemplates(rootDir) {
  const filePath = getWorkflowTemplatesFilePath(rootDir);
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return getDefaultWorkflowTemplates();
  }
}

async function saveWorkflowTemplate({ rootDir, template }) {
  const errors = validateWorkflowTemplate(template);
  if (errors.length) {
    throw new Error(errors.join(", "));
  }

  const templates = await listWorkflowTemplates(rootDir);
  const existing = templates.find((item) => item.templateId === template.templateId);
  const normalized = normalizeWorkflowTemplate({
    ...template,
    createdAt: template.createdAt || existing?.createdAt,
  });

  const nextTemplates = existing
    ? templates.map((item) => (item.templateId === normalized.templateId ? normalized : item))
    : [...templates, normalized];

  const dataDir = path.join(rootDir, "data");
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    getWorkflowTemplatesFilePath(rootDir),
    `${JSON.stringify(nextTemplates, null, 2)}\n`,
    "utf8",
  );

  return normalized;
}

async function getWorkflowTemplate(rootDir, templateId) {
  const templates = await listWorkflowTemplates(rootDir);
  return templates.find((template) => template.templateId === templateId) || null;
}

async function persistWorkflowTransaction(rootDir, transaction, childDocuments = [], { beforeCommit } = {}) {
  if (!transaction.folderPath) {
    throw new Error("ที่อยู่โฟลเดอร์ธุรกรรมไม่ถูกต้อง");
  }
  const absoluteFolderPath = assertPathWithinDirectory(
    rootDir,
    path.join(rootDir, transaction.folderPath),
    "ที่อยู่โฟลเดอร์ธุรกรรมไม่ถูกต้อง",
  );
  const dataDir = path.join(absoluteFolderPath, "data");
  const workingMdDir = path.join(absoluteFolderPath, "working-md");
  const pdfDir = path.join(absoluteFolderPath, "pdf");

  await mkdir(dataDir, { recursive: true });
  await mkdir(workingMdDir, { recursive: true });
  await mkdir(pdfDir, { recursive: true });

  // Last chance to refuse (or redirect the caller) immediately before the
  // commit write below, mirroring the beforeCommit hook writeWorkflowDocumentFiles
  // uses for the same reason: the three mkdir calls above are each an awaited
  // event-loop yield a concurrent call can land in, so a guard that only ran
  // before this function was called would leave that window open.
  if (beforeCommit) {
    await beforeCommit();
  }

  await writeFile(
    path.join(dataDir, "workflow-transaction.json"),
    `${JSON.stringify(transaction, null, 2)}\n`,
    "utf8",
  );
  // Single write-through choke point for transactions: startWorkflowTransaction,
  // refreshWorkflowTransaction and completeWorkflowTransaction all funnel their
  // commit through this function.
  indexDocument(rootDir, {
    documentKind: "workflow_transaction",
    documentNo: transaction.transactionNo,
    accountingMonth: transaction.accountingMonth,
    status: transaction.status,
    folderPath: transaction.folderPath,
    transactionNo: "",
    workflowTemplateId: transaction.workflowTemplateId,
    workflowStepId: "",
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
  });
  await writeFile(
    path.join(workingMdDir, "workflow-summary.md"),
    formatWorkflowSummaryMarkdown(transaction, childDocuments),
    "utf8",
  );

  return absoluteFolderPath;
}

async function startWorkflowTransaction({
  rootDir,
  templateId,
  accountingMonth,
  title,
  now = () => new Date().toISOString(),
}) {
  const template = await getWorkflowTemplate(rootDir, templateId);
  if (!template) {
    throw new Error("ไม่พบ template ที่ระบุ");
  }

  // Transaction numbers used to be allocated by scanning existing folder
  // names for the highest sequence used so far
  // (getNextWorkflowTransactionInfo, still used verbatim by the read-only
  // "/next" preview route — see the comment above
  // allocateExpenseRequestNumber), which is not itself a reservation: two
  // concurrent calls could both scan before either had written anything and
  // both land on the same "next" number. That was patched with a mkdir-EEXIST
  // reservation dance (bare-number folder, then rename into the title-suffixed
  // shape) — a hand-rolled substitute for the uniqueness guarantee a database
  // gives for free.
  //
  // allocateWorkflowTransactionNumber (backed by the document_number_allocations
  // table's UNIQUE(document_kind, accounting_month, sequence) constraint) now
  // makes a duplicate transactionNo impossible rather than merely unlikely, so
  // the folderPath derived from it (which embeds the now-guaranteed-unique
  // transactionNo) can never collide with a concurrent call's folderPath
  // either — a plain recursive mkdir is enough, and the bare-reservation/rename
  // dance no longer earns its keep.
  const { sequence } = await allocateWorkflowTransactionNumber(rootDir, accountingMonth);
  const transaction = buildWorkflowTransactionPayload(
    { accountingMonth, title, sequence, template },
    { now },
  );

  const absoluteFolderPath = path.join(rootDir, transaction.folderPath);
  await mkdir(absoluteFolderPath, { recursive: true });

  await persistWorkflowTransaction(rootDir, transaction, []);

  return transaction;
}

async function buildWorkflowTransactionRecord(rootDir, folderPath) {
  const absolutePath = path.join(rootDir, folderPath, "data", "workflow-transaction.json");
  const transaction = JSON.parse(await readFile(absolutePath, "utf8"));
  return { ...transaction, folderPath: transaction.folderPath || folderPath };
}

// See findSubmittedExpenseRequests above for why this reads the documents
// index (rows where document_kind='workflow_transaction') instead of
// walking documents/ recursively.
async function findAllWorkflowTransactions(rootDir) {
  const rows = withDocumentIndexDatabase(rootDir, (db) => queryDocumentIndexRows(db, { documentKind: "workflow_transaction" }));
  const records = [];

  for (const row of rows) {
    try {
      records.push(await buildWorkflowTransactionRecord(rootDir, row.folderPath));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      logIndexDriftWarning(row.documentNo, row.folderPath);
    }
  }

  return records.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function listWorkflowTransactions(rootDir) {
  return findAllWorkflowTransactions(rootDir);
}

// Point lookup: one indexed SQL row plus one targeted file read, instead of
// listing every workflow transaction on disk to find one of them -- this is
// the choke point every step of a transaction page load goes through
// (getWorkflowTransactionDetail, refresh, complete, prefill, the file route,
// and the completed-guard checks inside completeWorkflowTransaction), so
// converting it here alone removes one of the four full recursive walks a
// single transaction page load used to trigger. Falls back to a full disk
// search on an index miss/drift, same contract as
// getSubmittedExpenseRequestRecord above.
async function getWorkflowTransaction(rootDir, transactionNo) {
  if (!transactionNo) return null;

  const row = withDocumentIndexDatabase(rootDir, (db) => getDocumentIndexRowByNumber(db, "workflow_transaction", transactionNo));
  if (row) {
    try {
      return await buildWorkflowTransactionRecord(rootDir, row.folderPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      logIndexDriftWarning(transactionNo, row.folderPath);
    }
  }

  for (const folderPath of await walkDocumentsForFolderPaths(rootDir, "workflow-transaction.json")) {
    try {
      const candidate = await buildWorkflowTransactionRecord(rootDir, folderPath);
      if (candidate.transactionNo === transactionNo) return candidate;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  return null;
}

// MVP child-document scan: every document type a workflow template can
// reference lives in one of three places on disk. Expense requests and
// substitute receipts do not carry a documentKind field on their own record,
// so it is injected here before the record reaches normalizeDocumentWorkflowStatus
// (in workflow.logic.js), which dispatches on documentKind — including the
// hybrid substitute_receipt completion rule that inspects receiptType.
async function findLightweightWorkflowDocuments(rootDir, transactionNo) {
  if (!transactionNo) return [];
  const records = await listWorkflowDocuments(rootDir, { transactionNo });

  return Promise.all(records.map(async (record) => ({
    // The full stored payload (title, payeeName, businessPurpose, lines,
    // requesterName, ...) is spread first so cross-document prefill (Task 6)
    // has real field values to read; the explicit keys below are listed
    // afterwards purely to override the payload's own copies with the
    // authoritative ones this scan already resolved (folderPath, freshly
    // listed pdf/raw files), never to hide anything.
    ...record.payload,
    documentKind: record.documentKind,
    documentNo: record.documentNo,
    status: record.status,
    statusLabel: record.statusLabel,
    folderPath: record.folderPath,
    pdfFiles: await listWorkflowDocumentPdfFiles(rootDir, record.folderPath, record.documentKind, record.documentNo),
    rawFiles: await listWorkflowDocumentRawFiles(rootDir, record.folderPath, record.documentKind, record.documentNo),
    workflowStepId: record.workflowStepId,
    completedAt: record.payload?.completedAt || "",
    completedBy: record.payload?.completedBy || "",
  })));
}

// Re-reads one already-listed expense request's full submission.json using
// the folderPath findSubmittedExpenseRequests (called once, at the top of
// findWorkflowChildDocuments) already resolved. This used to go through
// getSubmittedExpenseRequest, which re-walks the *entire* documents/ tree via
// its own internal findSubmittedExpenseRequests call just to look up the one
// folderPath this caller already has — making findWorkflowChildDocuments
// O(matching requests x tree size) on a path hit on every transaction page
// load. Reading the known path directly drops that back to one walk total.
//
// Never lets a single unreadable record take the whole scan down with it: a
// request can be deleted (or its submission.json corrupted) between the
// listing scan above and this per-record re-read — a real race, not a
// hypothetical one, since nothing serializes "list workflow child documents"
// against "delete/edit an expense request" — so a failure here is logged to
// stderr and degrades to dropping that one document, the same "degrade,
// don't crash" contract generatePacketPdfSafely already uses for the packet
// PDF below. The caller (the Promise.all in findWorkflowChildDocuments) must
// never see this rejection, or one bad record would take out refresh,
// prefill, and the page itself along with it.
async function readExpenseRequestChildDocument(rootDir, record) {
  try {
    const payload = JSON.parse(
      await readFile(path.join(rootDir, record.folderPath, "data", "submission.json"), "utf8"),
    );
    // Mirrors getSubmittedExpenseRequest's own payload-override set exactly
    // (requestNo/folderPath/accountingMonth/requestType/requestTitle), so the
    // shape handed to callers (progress derivation, prefill adapters, the
    // page, the packet PDF) is byte-identical to before this change.
    return {
      ...payload,
      requestNo: payload.requestNo || record.requestNo,
      folderPath: record.folderPath,
      accountingMonth: getAccountingMonthFromRequestNo(payload.requestNo || record.requestNo),
      requestType: payload.requestType || "reimbursement",
      requestTitle: payload.requestTitle || record.requestTitle,
      // pdfFiles/rawFiles come from `record` (already resolved by the
      // listing scan via listPdfFiles/listRawFiles), never from the raw
      // payload, the same way substituteReceiptDocs does below.
      pdfFiles: record.pdfFiles,
      rawFiles: record.rawFiles,
      documentKind: "expense_request",
    };
  } catch (error) {
    console.error(
      `ไม่สามารถอ่านใบเบิกจ่าย ${record.requestNo} สำหรับธุรกรรม workflow ได้: ${error.message}`,
    );
    return null;
  }
}

// Targeted counterparts of findSubmittedExpenseRequests/
// findSubmittedSubstituteReceipts, scoped to one transaction via the
// transaction_no column instead of listing every expense request/substitute
// receipt on disk and filtering in JS afterwards -- these are two of the
// four full recursive walks a single workflow-transaction page load used to
// trigger (the other two were the transaction lookup itself and the
// lightweight-document listing, both already converted above).
async function findExpenseRequestRecordsByTransaction(rootDir, transactionNo) {
  const rows = withDocumentIndexDatabase(rootDir, (db) => queryDocumentIndexRows(db, { documentKind: "expense_request", transactionNo }));
  const records = [];
  for (const row of rows) {
    try {
      records.push(await buildSubmittedExpenseRequestRecord(rootDir, row.folderPath));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      logIndexDriftWarning(row.documentNo, row.folderPath);
    }
  }
  return records;
}

async function findSubstituteReceiptRecordsByTransaction(rootDir, transactionNo) {
  const rows = withDocumentIndexDatabase(rootDir, (db) => queryDocumentIndexRows(db, { documentKind: "substitute_receipt", transactionNo }));
  const records = [];
  for (const row of rows) {
    try {
      records.push(await buildSubmittedSubstituteReceiptRecord(rootDir, row.folderPath));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      logIndexDriftWarning(row.documentNo, row.folderPath);
    }
  }
  return records;
}

async function findWorkflowChildDocuments(rootDir, transactionNo) {
  if (!transactionNo) return [];

  const [matchingExpenseRequests, matchingSubstituteReceipts, lightweightDocuments] = await Promise.all([
    findExpenseRequestRecordsByTransaction(rootDir, transactionNo),
    findSubstituteReceiptRecordsByTransaction(rootDir, transactionNo),
    findLightweightWorkflowDocuments(rootDir, transactionNo),
  ]);

  // findSubmittedExpenseRequests only returns a curated listing-page summary
  // (requestTitle is even reconstructed from the folder name, not the raw
  // payload text) — it has no businessPurpose, paymentTargetName/BankName/
  // AccountNo, requesterRole, or expenseLines at all. Cross-document prefill
  // (Task 6) needs the real stored fields, so the full submission.json is
  // re-read per matching request here, the same way substitute receipts
  // already carry their full payload via `record.payload` below.
  const expenseRequestDocs = (
    await Promise.all(matchingExpenseRequests.map((record) => readExpenseRequestChildDocument(rootDir, record)))
  ).filter(Boolean);

  const substituteReceiptDocs = matchingSubstituteReceipts.map((record) => ({
    ...record.payload,
    folderPath: record.folderPath,
    pdfFiles: record.pdfFiles,
    rawFiles: record.rawFiles,
    documentKind: "substitute_receipt",
  }));

  return [...expenseRequestDocs, ...substituteReceiptDocs, ...lightweightDocuments];
}

// Shapes one raw child document (whichever of the three storage families it
// came from — see findWorkflowChildDocuments) into the flat view the
// workflow-transaction detail/refresh responses hand to the progress page:
// its own document number (documentNo/requestNo/receiptNo/... normalized via
// normalizeDocumentWorkflowStatus), its native status/label (distinct from
// the workflow step's own workflowStatus), which step it belongs to, and its
// pdfFiles/rawFiles with working download URLs (already resolved by
// findWorkflowChildDocuments/findLightweightWorkflowDocuments).
function formatWorkflowChildDocumentForResponse(doc) {
  const normalized = normalizeDocumentWorkflowStatus(doc);
  return {
    documentKind: doc.documentKind,
    documentNo: normalized.documentNo,
    status: doc.status,
    statusLabel: doc.statusLabel || normalized.nativeStatusLabel || doc.status,
    workflowStepId: doc.workflowStepId,
    pdfFiles: doc.pdfFiles || [],
    rawFiles: doc.rawFiles || [],
  };
}

// The single source of truth for "this transaction plus every document
// produced under it" — used by the GET detail route. Resolves child
// documents live on every call (rather than reading back whatever was last
// persisted by refresh) because documents change outside this page's
// knowledge whenever the user completes one elsewhere, and a plain GET must
// not hand back stale files. It does not persist anything, unlike refresh:
// deriving and persisting progress is refreshWorkflowTransaction's job alone.
async function getWorkflowTransactionDetail(rootDir, transactionNo) {
  const transaction = await getWorkflowTransaction(rootDir, transactionNo);
  if (!transaction) return null;

  const childDocuments = await findWorkflowChildDocuments(rootDir, transactionNo);

  // The transaction's own pdfFiles (currently just the packet, if one has
  // been generated by a prior refresh) are distinct from each child
  // document's pdfFiles above — those belong to the individual documents
  // (e.g. PO-2026-09-0001's own PDF) and are already attached per-document
  // by formatWorkflowChildDocumentForResponse. Read here (not regenerated —
  // that only happens on refresh) so a plain GET stays read-only, matching
  // the rest of this function.
  const pdfFiles = await listWorkflowTransactionPdfFiles(rootDir, transaction.folderPath, transaction.transactionNo);

  return {
    ...transaction,
    childDocuments: childDocuments.map(formatWorkflowChildDocumentForResponse),
    pdfFiles,
  };
}

// The packet PDF is only ever a convenience download link over the
// transaction and its child documents — never the source of truth for
// anything derived (progress, strict order, completion), which are all
// already computed and persisted before this runs. A failure to generate it
// (missing Python runtime, a ReportLab import error, a locked output file,
// ...) must therefore degrade to "no packet link yet", not take down
// refresh/complete and, through them, every "เปิดเอกสาร" start-document call
// across the whole transaction page. Never swallowed silently: logged to
// stderr so the failure is still visible to whoever runs the server.
// `packetGenerator` defaults to the real generateWorkflowPacketPdf and is
// only ever overridden by tests, the same DI pattern already used for
// expenseRecorder/driveUploader elsewhere in this file.
async function generatePacketPdfSafely(packetGenerator, { transaction, childDocuments, outputPath }) {
  try {
    await packetGenerator({ transaction, childDocuments, outputPath });
    return { ok: true };
  } catch (error) {
    console.error(
      `ไม่สามารถสร้าง PDF ชุดรวมเอกสารของ workflow transaction ${transaction.transactionNo} ได้: ${error.message}`,
    );
    return { ok: false, error: error.message };
  }
}

// regeneratePacket defaults to true so every existing direct caller (tests,
// and any future caller that doesn't pass it) keeps today's behavior
// unchanged: refresh derives+persists progress *and* regenerates the packet.
// It exists so the two cheap, universally-needed jobs (resolve child
// documents, derive+persist progress) can be pulled apart from the one
// expensive, only-sometimes-needed job (spawn Python to regenerate the
// packet PDF) at the call sites that don't want it — the transaction page's
// self-refresh on load, and start-document's self-refresh before its order
// check (local-server.mjs) both now pass regeneratePacket:false, so neither
// a page load nor a "เปิดเอกสาร" click spawns a subprocess the user may never
// download. Freshness is guaranteed at the two moments the packet is
// actually meaningful to hand someone: the explicit "รีเฟรชสถานะ" button
// (still calls this with the default) and completeWorkflowTransaction (which
// always regenerates, below) — the trade-off is that a packet downloaded
// without ever pressing refresh or completing can be stale relative to
// changes made elsewhere, exactly as it always could be even before this
// split (a plain GET never regenerated it either).
async function refreshWorkflowTransaction({
  rootDir,
  transactionNo,
  now = () => new Date().toISOString(),
  packetGenerator = generateWorkflowPacketPdf,
  regeneratePacket = true,
}) {
  const transaction = await getWorkflowTransaction(rootDir, transactionNo);
  if (!transaction) {
    throw new Error("ไม่พบธุรกรรม");
  }

  const childDocuments = await findWorkflowChildDocuments(rootDir, transactionNo);
  const updated = {
    ...deriveWorkflowProgress(transaction, childDocuments),
    updatedAt: now(),
  };

  await persistWorkflowTransaction(rootDir, updated, childDocuments);

  // childDocuments is derived, not persisted state (see persistWorkflowTransaction
  // above, which only ever writes `updated`) — attached here, after persisting,
  // so the caller gets the same shape getWorkflowTransactionDetail returns
  // without a second, redundant findWorkflowChildDocuments scan.
  const formattedChildDocuments = childDocuments.map(formatWorkflowChildDocumentForResponse);

  // The packet PDF is a summary/index over the transaction and its child
  // documents as they stand right now — when regenerated (after the
  // transaction record above has already been persisted, so a packet
  // failure never leaves derived progress half-written) it always overwrites
  // the same fixed file name, so there is only ever one packet per
  // transaction to serve or link to. When regeneratePacket is false, the
  // Python subprocess is never spawned at all — whatever packet (if any) was
  // last generated stays on disk untouched and is still reported below via
  // pdfFiles.
  let packetResult = { ok: true };
  if (regeneratePacket) {
    const absoluteFolderPath = path.join(rootDir, updated.folderPath);
    packetResult = await generatePacketPdfSafely(packetGenerator, {
      transaction: updated,
      childDocuments: formattedChildDocuments,
      outputPath: path.join(absoluteFolderPath, "pdf", WORKFLOW_PACKET_PDF_FILE_NAME),
    });
  }

  const pdfFiles = await listWorkflowTransactionPdfFiles(rootDir, updated.folderPath, updated.transactionNo);

  return {
    ...updated,
    childDocuments: formattedChildDocuments,
    pdfFiles,
    // Present only on failure — a successful (or skipped) generation never
    // adds this key — so the page/caller can tell "no packet yet" from
    // "packet generation just failed" without inferring it from a missing
    // pdfFiles entry.
    ...(packetResult.ok ? {} : { packetError: packetResult.error }),
  };
}

const WORKFLOW_TRANSACTION_INCOMPLETE_MESSAGE = "ยังไม่เสร็จสิ้นทุกขั้นตอนของ Workflow";

// Thrown by completeWorkflowTransaction's beforeCommit guard below, caught by
// that same function (never let to escape it), to recognize *this specific*
// outcome — a concurrent completion call already won — as opposed to any
// other rejection persistWorkflowTransaction's write might raise.
const WORKFLOW_TRANSACTION_ALREADY_COMPLETED_RACE = "__workflow_transaction_already_completed_race__";

function isWorkflowTransactionFullyCompleted(steps = []) {
  return steps.length > 0 && steps.every((step) => step.workflowStatus === "completed");
}

// Shared by completeWorkflowTransaction's own idempotent-repeat path and its
// beforeCommit race-lost path: both mean "someone (possibly this exact call,
// on a retry) already finished completing this transaction — hand back its
// real state instead of doing anything more."
async function buildCompletedWorkflowTransactionSnapshot(rootDir, transaction) {
  const childDocuments = await findWorkflowChildDocuments(rootDir, transaction.transactionNo);
  const pdfFiles = await listWorkflowTransactionPdfFiles(rootDir, transaction.folderPath, transaction.transactionNo);
  return {
    ...transaction,
    childDocuments: childDocuments.map(formatWorkflowChildDocumentForResponse),
    pdfFiles,
    driveSync: transaction.driveSync || { syncStatus: "not_required" },
  };
}

// Closes the workflow: refuses unless every step is completed, stamps the
// audit trail, regenerates the markdown/packet, and — governed by the
// syncGoogleDrive toggle snapshotted onto the transaction at start time, not
// a live template lookup — runs Drive sync automatically. There is no
// workflow-level Sheets sync here or anywhere in this file (decision D6):
// child documents (expense request, substitute receipt) already write their
// own Sheets rows for the real amounts, and one transaction bundles several
// of those documents covering the *same* money, so a workflow-level row
// would double- or triple-count it in the monthly sheet.
async function completeWorkflowTransaction({
  rootDir,
  transactionNo,
  completedBy = "",
  now = () => new Date().toISOString(),
  driveUploader = uploadFolderToGoogleDrive,
  packetGenerator = generateWorkflowPacketPdf,
}) {
  const transaction = await getWorkflowTransaction(rootDir, transactionNo);
  if (!transaction) throw new Error("ไม่พบธุรกรรม");

  // A repeat completion call (retry, double-click, replayed request) is a
  // true no-op: completedAt/completedBy are the audit record of who closed
  // the transaction and when, so they must not be overwritten, and no
  // duplicate history entry is added. This is checked on completedAt, not on
  // transaction.status — deriveWorkflowProgress (used by refresh) already
  // reports status "completed" once every step is done, *before* anyone has
  // actually called this function, so status alone cannot distinguish "ready
  // to complete" from "already completed".
  if (transaction.completedAt) {
    return buildCompletedWorkflowTransactionSnapshot(rootDir, transaction);
  }

  const childDocuments = await findWorkflowChildDocuments(rootDir, transactionNo);
  const derived = deriveWorkflowProgress(transaction, childDocuments);
  if (!isWorkflowTransactionFullyCompleted(derived.steps)) {
    throw new Error(WORKFLOW_TRANSACTION_INCOMPLETE_MESSAGE);
  }

  const completedAt = now();
  const updated = {
    ...derived,
    status: "completed",
    completedAt,
    completedBy: completedBy || "",
    statusHistory: [
      ...(Array.isArray(transaction.statusHistory) ? transaction.statusHistory : []),
      {
        fromStatus: transaction.status,
        toStatus: "completed",
        changedAt: completedAt,
        note: "completed",
        actor: completedBy || "",
      },
    ],
    updatedAt: completedAt,
    // Set here (rather than left undefined) when the toggle is off, so the
    // page can tell "not needed" apart from "not yet synced" even before any
    // Drive call is attempted below.
    driveSync: derived.templateSnapshot?.syncGoogleDrive ? undefined : { syncStatus: "not_required" },
  };

  // The steps above (loading the transaction, scanning child documents,
  // deriving progress) are all awaited I/O a concurrent .../complete request
  // can land in. Re-verified immediately before the actual commit write
  // (persistWorkflowTransaction's beforeCommit, called after its own mkdir
  // calls) rather than only here, so a call that loses this race yields to
  // the winner instead of overwriting its audit stamp or double-appending
  // history.
  let lostRace = false;
  try {
    await persistWorkflowTransaction(rootDir, updated, childDocuments, {
      beforeCommit: async () => {
        const latest = await getWorkflowTransaction(rootDir, transactionNo);
        if (latest?.completedAt) {
          lostRace = true;
          throw new Error(WORKFLOW_TRANSACTION_ALREADY_COMPLETED_RACE);
        }
      },
    });
  } catch (error) {
    if (lostRace) {
      const latest = await getWorkflowTransaction(rootDir, transactionNo);
      return buildCompletedWorkflowTransactionSnapshot(rootDir, latest);
    }
    throw error;
  }

  const formattedChildDocuments = childDocuments.map(formatWorkflowChildDocumentForResponse);
  const absoluteFolderPath = path.join(rootDir, updated.folderPath);
  const packetResult = await generatePacketPdfSafely(packetGenerator, {
    transaction: updated,
    childDocuments: formattedChildDocuments,
    outputPath: path.join(absoluteFolderPath, "pdf", WORKFLOW_PACKET_PDF_FILE_NAME),
  });

  if (updated.templateSnapshot?.syncGoogleDrive) {
    // syncWorkflowTransactionToDrive never throws past itself (a failed
    // upload becomes a sync_failed status, not a rejected completion) — see
    // its own definition below — so a missing/expired Drive connection never
    // turns a legitimate completion into a 400.
    updated.driveSync = await syncWorkflowTransactionToDrive({ rootDir, transactionNo, driveUploader, now });
  }

  const pdfFiles = await listWorkflowTransactionPdfFiles(rootDir, updated.folderPath, updated.transactionNo);

  return {
    ...updated,
    childDocuments: formattedChildDocuments,
    pdfFiles,
    ...(packetResult.ok ? {} : { packetError: packetResult.error }),
  };
}

// A document never sources prefill data from its own step (the
// siblingDocuments filter below) — mainly relevant if a step is ever
// re-opened after already having a child document. The HTTP route for this
// (GET /api/workflow-transactions/:transactionNo/prefill) is wired in a later
// task, the same way Task 5's storage functions waited for their route.
async function getWorkflowTransactionPrefill({ rootDir, transactionNo, documentKind, stepId }) {
  const transaction = await getWorkflowTransaction(rootDir, transactionNo);
  if (!transaction) throw new Error("ไม่พบ Workflow transaction");

  const step = transaction.steps.find((item) => item.stepId === stepId);
  if (!step) throw new Error("ไม่พบขั้นตอนนี้ใน Workflow");
  if (documentKind && documentKind !== step.documentKind) {
    throw new Error("ประเภทเอกสารไม่ตรงกับขั้นตอนนี้");
  }

  const childDocuments = await findWorkflowChildDocuments(rootDir, transactionNo);
  const siblingDocuments = childDocuments.filter((doc) => doc.workflowStepId !== stepId);
  const { context, sources } = buildWorkflowPrefillContext(siblingDocuments, step.documentKind);
  const availableGroups = (RECEIVABLE_PREFILL_GROUPS[step.documentKind] || [])
    .filter((group) => Object.prototype.hasOwnProperty.call(sources, group));

  return { context, sources, availableGroups };
}

async function getWorkflowTransactionFile({ rootDir, transactionNo, section, fileName }) {
  if (!transactionNo) throw new Error("ไม่มีเลขที่ธุรกรรม");
  if (!["pdf"].includes(section)) throw new Error("ส่วนไฟล์ไม่ถูกต้อง");
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") {
    throw new Error("ชื่อไฟล์ไม่ถูกต้อง");
  }

  const transaction = await getWorkflowTransaction(rootDir, transactionNo);
  if (!transaction) throw new Error("ไม่พบธุรกรรม");

  const baseDir = path.resolve(rootDir, transaction.folderPath, section);
  const absolutePath = assertPathWithinDirectory(baseDir, path.resolve(baseDir, fileName), "ชื่อไฟล์ไม่ถูกต้อง");

  return { absolutePath, fileName, section };
}

async function syncExpenseRequestToDrive({
  rootDir,
  requestNo,
  driveUploader = uploadFolderToGoogleDrive,
  now = () => new Date().toISOString(),
}) {
  if (!requestNo) throw new Error("Missing expense request number");

  const request = await getSubmittedExpenseRequestRecord(rootDir, requestNo);
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

async function syncSubstituteReceiptToDrive({
  rootDir,
  receiptNo,
  driveUploader = uploadFolderToGoogleDrive,
  now = () => new Date().toISOString(),
}) {
  if (!receiptNo) throw new Error("Missing substitute receipt number");

  const receipt = await getSubmittedSubstituteReceipt(rootDir, receiptNo);
  let uploadResult;

  try {
    uploadResult = await driveUploader({
      rootDir,
      folderPath: receipt.folderPath,
    });
  } catch (error) {
    const failedAt = now();
    const failedMetadata = {
      receiptNo,
      syncStatus: "sync_failed",
      error: error.message || "Google Drive sync failed",
      syncedAt: "",
      updatedAt: failedAt,
    };
    await writeDriveSyncMetadata(rootDir, receipt.folderPath, failedMetadata);
    throw error;
  }

  const syncedAt = now();
  const metadata = {
    receiptNo,
    syncStatus: "synced",
    driveFolderId: uploadResult.driveFolderId,
    driveFolderUrl: uploadResult.driveFolderUrl,
    drivePath: uploadResult.drivePath,
    uploadedFileCount: uploadResult.uploadedFileCount,
    syncedAt,
    updatedAt: syncedAt,
  };
  await writeDriveSyncMetadata(rootDir, receipt.folderPath, metadata);

  return metadata;
}

// Turns an uploader/Drive error into the Thai sentence a user reads. The two
// errors a user can fix themselves -- no Google Drive config, or never logged
// in (the state this app ships in: uploadFolderToGoogleDrive throws these
// before it makes any network call) -- get a Thai explanation with the way
// out; anything else is labelled as a Google Drive error. The original text
// is always kept so the failure can still be diagnosed. An error that is
// already Thai (this file's own validation messages) passes through as is.
const THAI_CHARACTER_PATTERN = /[\u0E00-\u0E7F]/;

function describeDriveSyncError(rawMessage) {
  const raw = String(rawMessage || "").trim();
  if (!raw) return "ซิงก์ Google Drive ไม่สำเร็จ";
  if (/not configured/i.test(raw)) {
    return `ยังไม่ได้ตั้งค่า Google Drive — ไปที่เมนู "ตั้งค่า Google Drive" ใส่ Client ID/Secret แล้วเข้าสู่ระบบ (${raw})`;
  }
  if (/not authenticated/i.test(raw)) {
    return `ยังไม่ได้เข้าสู่ระบบ Google Drive — ไปที่เมนู "ตั้งค่า Google Drive" แล้วกดเข้าสู่ระบบ (${raw})`;
  }
  if (THAI_CHARACTER_PATTERN.test(raw)) return raw;
  return `เกิดข้อผิดพลาดจาก Google Drive: ${raw}`;
}

const WORKFLOW_DOCUMENT_DRIVE_SYNC_REQUIRES_COMPLETED_MESSAGE = "ต้องกดเสร็จสิ้นเอกสารก่อน จึงจะซิงก์ Google Drive ได้";

// The standalone Drive sync for the five lightweight kinds (purchase_order,
// payment_voucher, cash_spend_declaration, payee_acknowledgement,
// goods_receipt), in the same shape as syncExpenseRequestToDrive/
// syncSubstituteReceiptToDrive above: a stubbable driveUploader, the result
// written to the document's own data/drive-sync.json, and a failure recorded
// there as sync_failed *before* it is re-thrown -- the route turns that into a
// Thai 400 naming the document, and syncWorkflowTransactionToDrive turns it
// into that document's per-document entry.
//
// Only a completed document can sync. Completed is the one state
// saveWorkflowDocument refuses to edit, so what reaches Drive cannot go stale
// behind the user's back; a draft can still change, and re-uploading a changed
// one would put a second copy of every file in Drive (the uploader is not
// idempotent -- see syncWorkflowChildDocumentToDrive below).
async function syncWorkflowDocumentToDrive({
  rootDir,
  documentKind,
  documentNo,
  driveUploader = uploadFolderToGoogleDrive,
  now = () => new Date().toISOString(),
}) {
  if (!LIGHTWEIGHT_DOCUMENT_KINDS.includes(documentKind)) throw new Error("ประเภทเอกสารไม่ถูกต้อง");
  if (!documentNo) throw new Error("ไม่มีเลขที่เอกสาร");

  const record = await getWorkflowDocument(rootDir, documentKind, documentNo);
  if (!record) throw new Error("ไม่พบเอกสาร");
  if (record.status !== "completed") throw new Error(WORKFLOW_DOCUMENT_DRIVE_SYNC_REQUIRES_COMPLETED_MESSAGE);

  // Defense in depth, as on every other path that turns a stored folderPath
  // into a filesystem location: the uploader reads rootDir/folderPath
  // recursively, so it must never be pointed outside rootDir.
  assertPathWithinDirectory(rootDir, path.join(rootDir, record.folderPath || ""), "ที่อยู่โฟลเดอร์เอกสารไม่ถูกต้อง");

  let uploadResult;
  try {
    uploadResult = await driveUploader({ rootDir, folderPath: record.folderPath });
  } catch (error) {
    await writeDriveSyncMetadata(rootDir, record.folderPath, {
      documentKind,
      documentNo,
      syncStatus: "sync_failed",
      error: error.message || "Google Drive sync failed",
      syncedAt: "",
      updatedAt: now(),
    });
    throw error;
  }

  const syncedAt = now();
  const metadata = {
    documentKind,
    documentNo,
    syncStatus: "synced",
    driveFolderId: uploadResult.driveFolderId,
    driveFolderUrl: uploadResult.driveFolderUrl,
    drivePath: uploadResult.drivePath,
    uploadedFileCount: uploadResult.uploadedFileCount,
    syncedAt,
    updatedAt: syncedAt,
  };
  await writeDriveSyncMetadata(rootDir, record.folderPath, metadata);

  return metadata;
}

// documentKind -> that document's OWN standalone Drive sync action. The
// workflow never uploads a child document's folder itself: it dispatches
// here, so a child synced from the workflow is uploaded, recorded and stored
// exactly as if the user had pressed that document's own sync button (same
// state, same action). Each entry only adapts the shared { documentNo } to the
// identifier its action takes. Covers every kind DOCUMENT_TYPE_DEFINITIONS
// declares (asserted in tests/workflow-api.test.mjs).
const DOCUMENT_DRIVE_SYNC_ACTIONS = Object.freeze({
  expense_request: ({ documentNo, ...options }) => syncExpenseRequestToDrive({ ...options, requestNo: documentNo }),
  substitute_receipt: ({ documentNo, ...options }) => syncSubstituteReceiptToDrive({ ...options, receiptNo: documentNo }),
  ...Object.fromEntries(LIGHTWEIGHT_DOCUMENT_KINDS.map((documentKind) => [
    documentKind,
    (options) => syncWorkflowDocumentToDrive({ ...options, documentKind }),
  ])),
});

const WORKFLOW_TRANSACTION_FOLDER_WAITING_MESSAGE = "ยังไม่ได้ส่ง — จะส่งเมื่อเอกสารย่อยขึ้น Google Drive ครบทุกฉบับ";

function driveSyncDocumentName(documentKind, documentNo) {
  return `${getDocumentTypeDefinition(documentKind)?.label || documentKind} ${documentNo || ""}`.trim();
}

// One child document's turn in the workflow sync. Never throws: a failure
// becomes this child's own sync_failed entry, so one bad document never stops
// the others from getting their turn.
//
// A child whose own sync record already says "synced" (the user pressed its
// own button earlier, or an earlier workflow sync already got it there) is
// NOT uploaded again: uploadFolderToGoogleDrive reuses Drive folders but
// creates a brand-new Drive file for every local file on every call -- it
// never looks for an existing file (tests/google-drive.logic.test.mjs pins
// this down) -- so a second upload would put a duplicate of every file in
// Drive. Anything else (never synced, sync_failed, or an expense request
// edited after syncing, which its own save marks needs_resync) is sent
// through the child's own action.
async function syncWorkflowChildDocumentToDrive(rootDir, doc, { driveUploader, now }) {
  const { documentNo } = normalizeDocumentWorkflowStatus(doc);
  const entry = {
    documentKind: doc.documentKind,
    documentNo: documentNo || "",
    workflowStepId: doc.workflowStepId || "",
  };

  try {
    const action = DOCUMENT_DRIVE_SYNC_ACTIONS[doc.documentKind];
    if (!action) throw new Error(`ไม่รองรับการซิงก์ Google Drive สำหรับเอกสารประเภท ${doc.documentKind}`);

    const ownRecord = await readDriveSyncMetadata(rootDir, doc.folderPath);
    const alreadySynced = ownRecord?.syncStatus === "synced";
    const metadata = alreadySynced ? ownRecord : await action({ rootDir, documentNo, driveUploader, now });

    return {
      ...entry,
      syncStatus: "synced",
      alreadySynced,
      driveFolderUrl: metadata.driveFolderUrl || "",
      drivePath: metadata.drivePath || "",
      syncedAt: metadata.syncedAt || "",
    };
  } catch (error) {
    const raw = error.message || "Google Drive sync failed";
    return { ...entry, syncStatus: "sync_failed", error: raw, message: describeDriveSyncError(raw) };
  }
}

// The transaction folder's own result from an earlier sync, if any. A
// transaction synced before child documents were included recorded only its
// own folder's result, flat on driveSync -- that folder is in Drive already
// and must not be uploaded a second time either.
function previousWorkflowTransactionFolderSync(driveSync) {
  if (!driveSync) return null;
  if (driveSync.transactionFolder) return driveSync.transactionFolder;
  if (driveSync.syncStatus !== "synced") return null;
  return {
    syncStatus: "synced",
    driveFolderId: driveSync.driveFolderId || "",
    driveFolderUrl: driveSync.driveFolderUrl || "",
    drivePath: driveSync.drivePath || "",
    uploadedFileCount: driveSync.uploadedFileCount || 0,
    syncedAt: driveSync.syncedAt || "",
  };
}

async function uploadWorkflowTransactionFolder(rootDir, transaction, { driveUploader, now }) {
  try {
    const uploadResult = await driveUploader({ rootDir, folderPath: transaction.folderPath });
    return {
      syncStatus: "synced",
      alreadySynced: false,
      driveFolderId: uploadResult.driveFolderId || "",
      driveFolderUrl: uploadResult.driveFolderUrl || "",
      drivePath: uploadResult.drivePath || "",
      uploadedFileCount: uploadResult.uploadedFileCount || 0,
      syncedAt: now(),
    };
  } catch (error) {
    const raw = error.message || "Google Drive sync failed";
    return { syncStatus: "sync_failed", error: raw, message: describeDriveSyncError(raw) };
  }
}

// Syncing a completed workflow is meant to put the whole set of paperwork for
// one purchase into Drive, not just its cover sheet. So it:
//
//   1. sends every child document, in template step order, through that
//      document's OWN standalone sync action (DOCUMENT_DRIVE_SYNC_ACTIONS) --
//      there is no second upload path for child documents in this function.
//      Each child lands where its own button would put it (its own folder,
//      mirrored under the Drive base path the way it is laid out on disk), so
//      syncing from the workflow and from the document can never put one
//      document in two places. Children go one at a time, not in parallel:
//      ensureDrivePath's find-then-create would otherwise race and create
//      duplicate year/month folders.
//   2. then, only once every child is in Drive, uploads the transaction's own
//      folder (packet PDF + summary). Its workflow-summary.md is rewritten
//      just before that upload to list each child's Drive folder link, so the
//      transaction folder in Drive is the index to its paperwork. Holding it
//      back while a child is missing means the cover sheet never reaches
//      Drive without the paperwork it describes -- and, because the uploader
//      is not idempotent, it goes up exactly once, with a complete index.
//
// A partial failure is sync_failed, never plain success: `documents` has one
// entry per child (synced / sync_failed with its own Thai `message`,
// `alreadySynced` when it was not uploaded again), `transactionFolder` says
// whether the folder went up, is waiting for the children, or failed, and
// `message` names, in Thai, exactly which documents did not make it. `error`
// stays the first underlying error. A retry skips everything already in Drive
// (each child's own sync record, and transactionFolder here), so it
// re-attempts only what failed.
//
// Never throws past itself for an upload failure (only for a transaction that
// does not exist or is not completed): it also runs automatically inside
// completeWorkflowTransaction, where a missing Drive connection must degrade
// to a status the page can show, not a failed completion. There is no Google
// Sheets write here or anywhere in the workflow layer (decision D6): each
// child writes its own Sheets row, and a workflow row would double-count the
// same money.
//
// The result is stored on transaction.driveSync (persisted via
// persistWorkflowTransaction into workflow-transaction.json), because the
// transaction page renders driveSync straight off the transaction record.
async function runWorkflowTransactionDriveSync({ rootDir, transactionNo, driveUploader, now }) {
  if (!transactionNo) throw new Error("ไม่มีเลขที่ธุรกรรม");

  const transaction = await getWorkflowTransaction(rootDir, transactionNo);
  if (!transaction) throw new Error("ไม่พบธุรกรรม");
  if (transaction.status !== "completed") {
    throw new Error("ต้องปิดงาน Workflow ให้เสร็จสิ้นก่อนจึงจะซิงก์ Google Drive ได้");
  }

  const childDocuments = await findWorkflowChildDocuments(rootDir, transactionNo);
  const stepOrder = new Map((transaction.steps || []).map((step, index) => [step.stepId, index]));
  const orderedChildren = [...childDocuments].sort((a, b) => (
    (stepOrder.get(a.workflowStepId) ?? Number.MAX_SAFE_INTEGER) - (stepOrder.get(b.workflowStepId) ?? Number.MAX_SAFE_INTEGER)
  ));

  const documents = [];
  for (const doc of orderedChildren) {
    documents.push(await syncWorkflowChildDocumentToDrive(rootDir, doc, { driveUploader, now }));
  }
  const missingDocuments = documents.filter((doc) => doc.syncStatus !== "synced");

  const previousFolder = previousWorkflowTransactionFolderSync(transaction.driveSync);
  let transactionFolder;
  if (previousFolder?.syncStatus === "synced") {
    transactionFolder = { ...previousFolder, alreadySynced: true };
  } else if (missingDocuments.length) {
    transactionFolder = { syncStatus: "waiting_for_documents", message: WORKFLOW_TRANSACTION_FOLDER_WAITING_MESSAGE };
  } else {
    // Persisted first so the workflow-summary.md this rewrites -- and the
    // upload right after carries -- already links every child's Drive folder.
    await persistWorkflowTransaction(
      rootDir,
      { ...transaction, driveSync: { ...(transaction.driveSync || {}), documents }, updatedAt: now() },
      childDocuments,
    );
    transactionFolder = await uploadWorkflowTransactionFolder(rootDir, transaction, { driveUploader, now });
  }

  const failures = [
    ...missingDocuments.map((doc) => ({ name: driveSyncDocumentName(doc.documentKind, doc.documentNo), error: doc.error, message: doc.message })),
    ...(transactionFolder.syncStatus === "sync_failed"
      ? [{ name: `โฟลเดอร์ธุรกรรม ${transaction.transactionNo}`, error: transactionFolder.error, message: transactionFolder.message }]
      : []),
  ];
  const allSynced = failures.length === 0 && transactionFolder.syncStatus === "synced";
  const syncedDocumentCount = documents.length - missingDocuments.length;

  let failureSummary = {};
  if (!allSynced) {
    const lines = [
      `สำเร็จ ${syncedDocumentCount} จาก ${documents.length} เอกสาร ยังไม่สำเร็จ:`,
      ...failures.map((failure) => `- ${failure.name}: ${failure.message}`),
    ];
    if (transactionFolder.syncStatus === "waiting_for_documents") {
      lines.push(`- โฟลเดอร์ธุรกรรม ${transaction.transactionNo} (ชุดรวม PDF และสรุป): ${WORKFLOW_TRANSACTION_FOLDER_WAITING_MESSAGE}`);
    }
    failureSummary = { error: failures[0].error, message: lines.join("\n") };
  }

  const finishedAt = now();
  const metadata = {
    syncStatus: allSynced ? "synced" : "sync_failed",
    ...failureSummary,
    syncedDocumentCount,
    totalDocumentCount: documents.length,
    documents,
    transactionFolder,
    // The transaction folder's own Drive link stays where the page and any
    // earlier reader of driveSync already look for it.
    ...(transactionFolder.syncStatus === "synced"
      ? {
        driveFolderId: transactionFolder.driveFolderId,
        driveFolderUrl: transactionFolder.driveFolderUrl,
        drivePath: transactionFolder.drivePath,
        uploadedFileCount: transactionFolder.uploadedFileCount,
      }
      : {}),
    syncedAt: allSynced ? finishedAt : "",
    updatedAt: finishedAt,
  };

  await persistWorkflowTransaction(
    rootDir,
    { ...transaction, driveSync: metadata, updatedAt: finishedAt },
    childDocuments,
  );

  return metadata;
}

// One sync per transaction at a time. The uploader is not idempotent, so two
// overlapping runs for the same transaction (a double-click, the manual button
// racing completion's automatic sync, a replayed request) would each upload
// the same not-yet-synced documents and duplicate them in Drive. A call that
// arrives while one is already running gets that run's result instead.
const workflowTransactionDriveSyncsInFlight = new Map();

async function syncWorkflowTransactionToDrive({
  rootDir,
  transactionNo,
  driveUploader = uploadFolderToGoogleDrive,
  now = () => new Date().toISOString(),
}) {
  const key = `${path.resolve(rootDir)}\n${transactionNo}`;
  const running = workflowTransactionDriveSyncsInFlight.get(key);
  if (running) return running;

  const run = runWorkflowTransactionDriveSync({ rootDir, transactionNo, driveUploader, now });
  workflowTransactionDriveSyncsInFlight.set(key, run);
  try {
    return await run;
  } finally {
    workflowTransactionDriveSyncsInFlight.delete(key);
  }
}

module.exports = {
  approveExpenseRequest,
  approveSubstituteReceipt,
  assertPathWithinDirectory,
  describeDriveSyncError,
  DOCUMENT_DRIVE_SYNC_ACTIONS,
  completeExpenseRequest,
  completeSubstituteReceipt,
  completeWorkflowDocument,
  completeWorkflowTransaction,
  findLightweightWorkflowDocuments,
  findWorkflowChildDocuments,
  readExpenseRequestChildDocument,
  getExpenseDraft,
  getExpenseRequestFile,
  getSubstituteReceiptFile,
  getSubmittedExpenseRequest,
  getNextExpenseRequestInfo,
  getNextSubstituteReceiptInfo,
  getNextWorkflowDocumentInfo,
  getNextWorkflowTransactionInfo,
  getSubstituteReceiptDraft,
  getSubmittedSubstituteReceipt,
  getWorkflowDocument,
  getWorkflowDocumentFile,
  getWorkflowTemplate,
  getWorkflowTransaction,
  getWorkflowTransactionDetail,
  getWorkflowTransactionFile,
  getWorkflowTransactionPrefill,
  groupUploadsByEvidence,
  listExpenseRequests,
  listExpenseDrafts,
  listSubstituteReceipts,
  listWorkflowDocumentTypes,
  listWorkflowDocumentSummaries,
  listWorkflowDocuments,
  listWorkflowTemplates,
  listWorkflowTransactions,
  parseMultipartForm,
  parseWorkflowDocumentListFilters,
  persistWorkflowTransaction,
  receiveSubstituteReceiptStock,
  refreshWorkflowTransaction,
  saveExpenseDraft,
  saveExpenseSubmission,
  saveSubstituteReceiptDraft,
  saveSubstituteReceiptSubmission,
  saveWorkflowDocument,
  saveWorkflowTemplate,
  startWorkflowTransaction,
  syncExpenseRequestToDrive,
  syncSubstituteReceiptToDrive,
  syncWorkflowDocumentToDrive,
  syncWorkflowTransactionToDrive,
  writeWorkflowDocumentFiles,
};
