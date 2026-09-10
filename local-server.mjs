import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  buildGoogleOAuthUrl,
  exchangeGoogleOAuthCode,
  getGoogleDriveStatus,
  saveGoogleDriveConfig,
} = require("./forms/google-drive.logic.js");
const {
  getCompanySettings,
  saveCompanySettings,
} = require("./forms/company-settings.logic.js");
const {
  approveExpenseRequest,
  approveSubstituteReceipt,
  completeExpenseRequest,
  completeSubstituteReceipt,
  completeWorkflowDocument,
  completeWorkflowTransaction,
  getNextExpenseRequestInfo,
  getNextSubstituteReceiptInfo,
  getNextWorkflowDocumentInfo,
  getNextWorkflowTransactionInfo,
  getExpenseDraft,
  getExpenseRequestFile,
  getSubstituteReceiptDraft,
  getSubstituteReceiptFile,
  getSubmittedSubstituteReceipt,
  getWorkflowDocument,
  getWorkflowDocumentFile,
  getWorkflowTemplate,
  getWorkflowTransaction,
  getWorkflowTransactionDetail,
  getWorkflowTransactionFile,
  getWorkflowTransactionPrefill,
  listExpenseDrafts,
  listExpenseRequests,
  listSubstituteReceipts,
  listWorkflowDocumentTypes,
  listWorkflowDocumentSummaries,
  parseWorkflowDocumentListFilters,
  listWorkflowTemplates,
  listWorkflowTransactions,
  parseMultipartForm,
  refreshWorkflowTransaction,
  saveExpenseDraft,
  saveExpenseSubmission,
  saveSubstituteReceiptDraft,
  saveSubstituteReceiptSubmission,
  saveWorkflowDocument,
  saveWorkflowTemplate,
  startWorkflowTransaction,
  receiveSubstituteReceiptStock,
  getSubmittedExpenseRequest,
  describeDriveSyncError,
  syncExpenseRequestToDrive,
  syncSubstituteReceiptToDrive,
  syncWorkflowDocumentToDrive,
  syncWorkflowTransactionToDrive,
} = require("./forms/local-server.logic.js");
const {
  buildWorkflowDocumentPayload,
  validateWorkflowDocumentPayload,
} = require("./forms/workflow-document.logic.js");
const {
  getDocumentTypeDefinition,
} = require("./forms/workflow.logic.js");
const {
  createProductCategory,
  createProduct,
  createPurchaseInMovement,
  createSaleSku,
  createStockSku,
  getInventoryProductDetail,
  getInventoryDashboardSummary,
  getSaleSku,
  getStockCard,
  listInventoryBalances,
  listInventoryStockGroups,
  listProductCategories,
  listProducts,
  listSaleSkus,
  listStockInReport,
  listStockSkus,
  saveProductImage,
  saveStockSkuImage,
  updateProductCategory,
  updateProduct,
  updateSaleSku,
  updateStockSku,
} = require("./forms/inventory.logic.js");
const {
  createSubstituteReceiptVendor,
  listSubstituteReceiptVendors,
  updateSubstituteReceiptVendor,
} = require("./forms/substitute-receipt-vendors.logic.js");
const {
  generateCurrentStockPdf,
} = require("./forms/inventory-report.logic.js");
const {
  getPlatformOrderImport,
  importPlatformOrders,
  listPlatformOrderImports,
  postPlatformOrderImport,
} = require("./forms/platform-orders.logic.js");
const {
  rebuildDocumentIndex,
} = require("./forms/document-index.logic.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = __dirname;
const rootDir = process.env.SWEET_HOUSE_ROOT_DIR || appDir;
const formsDir = path.join(appDir, "forms");
const port = Number(process.env.PORT || 8787);
// Security: bind loopback-only by default. There is no authentication
// anywhere in this app, so binding every interface (the previous behaviour)
// let anyone on the same network -- office wifi, cafe wifi -- open the
// accounting app and read, edit, or delete documents. Set
// SWEET_HOUSE_ALLOW_NETWORK=1 to opt in when the owner deliberately wants to
// reach the app from another device (phone, tablet) on their own network.
const allowNetwork = /^(1|true|yes)$/i.test(String(process.env.SWEET_HOUSE_ALLOW_NETWORK || "").trim());
const listenHost = allowNetwork ? "0.0.0.0" : "127.0.0.1";
const maxBodyBytes = 80 * 1024 * 1024;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
};

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function safeStaticPath(urlPath) {
  const routeMap = {
    "/": "/index.html",
    "/expense-request": "/expense-request.html",
    "/expense-request/": "/expense-request.html",
    "/expense-requests": "/expense-requests.html",
    "/expense-requests/": "/expense-requests.html",
    "/substitute-receipt": "/substitute-receipt.html",
    "/substitute-receipt/": "/substitute-receipt.html",
    "/substitute-receipts": "/substitute-receipts.html",
    "/substitute-receipts/": "/substitute-receipts.html",
    "/substitute-receipt-vendors": "/substitute-receipt-vendors.html",
    "/substitute-receipt-vendors/": "/substitute-receipt-vendors.html",
    "/workflow-document": "/workflow-document.html",
    "/workflow-document/": "/workflow-document.html",
    "/workflow-documents": "/workflow-documents.html",
    "/workflow-documents/": "/workflow-documents.html",
    "/workflow-templates": "/workflow-templates.html",
    "/workflow-templates/": "/workflow-templates.html",
    "/workflow-transactions": "/workflow-transactions.html",
    "/workflow-transactions/": "/workflow-transactions.html",
    "/workflow-transaction": "/workflow-transaction.html",
    "/workflow-transaction/": "/workflow-transaction.html",
    "/google-drive": "/google-drive.html",
    "/google-drive/": "/google-drive.html",
    "/company-settings": "/company-settings.html",
    "/company-settings/": "/company-settings.html",
    "/inventory": "/inventory.html",
    "/inventory/": "/inventory.html",
    "/inventory-dashboard": "/inventory-dashboard.html",
    "/inventory-dashboard/": "/inventory-dashboard.html",
    "/inventory-ledger": "/inventory-ledger.html",
    "/inventory-ledger/": "/inventory-ledger.html",
    "/inventory-product-detail": "/inventory-product-detail.html",
    "/inventory-product-detail/": "/inventory-product-detail.html",
    "/inventory-purchase-in": "/inventory-purchase-in.html",
    "/inventory-purchase-in/": "/inventory-purchase-in.html",
    "/inventory-stock-list": "/inventory-stock-list.html",
    "/inventory-stock-list/": "/inventory-stock-list.html",
    "/inventory-settings": "/inventory-settings.html",
    "/inventory-settings/": "/inventory-settings.html",
    "/sale-skus": "/sale-skus.html",
    "/sale-skus/": "/sale-skus.html",
    "/platform-orders": "/platform-orders.html",
    "/platform-orders/": "/platform-orders.html",
  };
  const requestedPath = routeMap[urlPath] || urlPath;
  const normalized = path.normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(formsDir, normalized);
  if (!absolutePath.startsWith(formsDir)) return null;
  return absolutePath;
}

function redirect(response, location) {
  response.writeHead(302, { location });
  response.end();
}

async function readRequestBody(request) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > maxBodyBytes) {
      throw new Error("Uploaded files are larger than the local limit");
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function readJsonBody(request) {
  const body = await readRequestBody(request);
  return body.length ? JSON.parse(body.toString("utf8")) : {};
}

function getOAuthRedirectUri(request) {
  const host = request.headers.host || `localhost:${port}`;
  return `http://${host}/api/google-drive/oauth2callback`;
}

function parseExpenseRequestFileRoute(urlPath) {
  const prefix = "/api/expense-requests/";
  const marker = "/files/";
  if (!urlPath.startsWith(prefix)) return null;

  const remainder = urlPath.slice(prefix.length);
  const markerIndex = remainder.indexOf(marker);
  if (markerIndex === -1) return null;

  const fileRoute = remainder.slice(markerIndex + marker.length);
  const sectionEnd = fileRoute.indexOf("/");
  if (sectionEnd === -1) return null;

  return {
    requestNo: decodeURIComponent(remainder.slice(0, markerIndex)),
    section: decodeURIComponent(fileRoute.slice(0, sectionEnd)),
    fileName: decodeURIComponent(fileRoute.slice(sectionEnd + 1)),
  };
}

function parseWorkflowDocumentFileRoute(urlPath) {
  const prefix = "/workflow-documents/";
  if (!urlPath.startsWith(prefix)) return null;

  const segments = urlPath.slice(prefix.length).split("/");
  if (segments.length !== 4 || segments.some((segment) => !segment)) return null;

  const [documentKind, documentNo, section, fileName] = segments;
  return {
    documentKind: decodeURIComponent(documentKind),
    documentNo: decodeURIComponent(documentNo),
    section: decodeURIComponent(section),
    fileName: decodeURIComponent(fileName),
  };
}

function parseWorkflowTransactionFileRoute(urlPath) {
  const prefix = "/api/workflow-transactions/";
  const marker = "/files/";
  if (!urlPath.startsWith(prefix)) return null;

  const remainder = urlPath.slice(prefix.length);
  const markerIndex = remainder.indexOf(marker);
  if (markerIndex === -1) return null;

  const fileRoute = remainder.slice(markerIndex + marker.length);
  const sectionEnd = fileRoute.indexOf("/");
  if (sectionEnd === -1) return null;

  return {
    transactionNo: decodeURIComponent(remainder.slice(0, markerIndex)),
    section: decodeURIComponent(fileRoute.slice(0, sectionEnd)),
    fileName: decodeURIComponent(fileRoute.slice(sectionEnd + 1)),
  };
}

function isValidAccountingMonth(accountingMonth) {
  return /^\d{4}-\d{2}$/.test(String(accountingMonth ?? ""));
}

function parseSubstituteReceiptFileRoute(urlPath) {
  const prefix = "/api/substitute-receipts/";
  const marker = "/files/";
  if (!urlPath.startsWith(prefix)) return null;

  const remainder = urlPath.slice(prefix.length);
  const markerIndex = remainder.indexOf(marker);
  if (markerIndex === -1) return null;

  const fileRoute = remainder.slice(markerIndex + marker.length);
  const sectionEnd = fileRoute.indexOf("/");
  if (sectionEnd === -1) return null;

  return {
    receiptNo: decodeURIComponent(remainder.slice(0, markerIndex)),
    section: decodeURIComponent(fileRoute.slice(0, sectionEnd)),
    fileName: decodeURIComponent(fileRoute.slice(sectionEnd + 1)),
  };
}

async function handleExpenseSubmission(request, response) {
  try {
    const body = await readRequestBody(request);
    const { fields, files } = parseMultipartForm(body, request.headers["content-type"]);
    const payload = JSON.parse(fields.payload || "{}");
    const result = await saveExpenseSubmission({
      rootDir,
      payload,
      uploads: files,
    });

    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot save expense request",
    });
  }
}

async function handleSubstituteReceiptSubmission(request, response) {
  try {
    const body = await readRequestBody(request);
    const { fields, files } = parseMultipartForm(body, request.headers["content-type"]);
    const payload = JSON.parse(fields.payload || "{}");
    const result = await saveSubstituteReceiptSubmission({
      rootDir,
      payload,
      uploads: files,
    });

    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot save substitute receipt",
    });
  }
}

async function handleSubstituteReceiptDraftSave(request, response) {
  try {
    const body = await readRequestBody(request);
    const { fields, files } = parseMultipartForm(body, request.headers["content-type"]);
    const payload = JSON.parse(fields.payload || "{}");
    const result = await saveSubstituteReceiptDraft({
      rootDir,
      payload,
      uploads: files,
    });

    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot save substitute receipt draft",
    });
  }
}

async function handleSubstituteReceiptApprove(receiptNo, request, response) {
  try {
    const payload = await readJsonBody(request);
    const result = await approveSubstituteReceipt({
      rootDir,
      receiptNo,
      approvedBy: payload.approvedBy,
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot approve substitute receipt",
    });
  }
}

async function handleExpenseRequestApprove(requestNo, request, response) {
  try {
    const payload = await readJsonBody(request);
    const result = await approveExpenseRequest({
      rootDir,
      requestNo,
      approvedBy: payload.approvedBy,
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot approve expense request",
    });
  }
}

// Closes out an approved expense request. Without this route, completeExpenseRequest
// (implemented and unit-tested in local-server.logic.js) was never reachable
// over HTTP, so an expense_request step inside a workflow transaction could
// never leave "in_progress" — five of the six shipped templates contain one.
// The server owns the status transition (approveExpenseRequest -> completed
// only, enforced by appendExpenseRequestStatus); the client supplies only who
// completed it, the same way handleWorkflowDocumentComplete already works.
async function handleExpenseRequestComplete(requestNo, request, response) {
  try {
    const payload = await readJsonBody(request);
    const result = await completeExpenseRequest({
      rootDir,
      requestNo,
      completedBy: payload.completedBy,
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot complete expense request",
    });
  }
}

// substitute_receipt already reaches workflow-completed through the existing
// approve/receive-stock routes (deriveChildWorkflowStatus's hybrid rule), so
// this route is not load-bearing for the workflow the way the expense-request
// one above is. Wired anyway for consistency: completeSubstituteReceipt is
// implemented and unit-tested but was otherwise unreachable over HTTP.
async function handleSubstituteReceiptComplete(receiptNo, request, response) {
  try {
    const payload = await readJsonBody(request);
    const result = await completeSubstituteReceipt({
      rootDir,
      receiptNo,
      completedBy: payload.completedBy,
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot complete substitute receipt",
    });
  }
}

async function handleSubstituteReceiptReceiveStock(receiptNo, request, response) {
  try {
    const payload = await readJsonBody(request);
    const result = await receiveSubstituteReceiptStock({
      rootDir,
      receiptNo,
      receivedDate: payload.receivedDate,
      receivedBy: payload.receivedBy,
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot receive substitute receipt stock",
    });
  }
}

async function handleExpenseDriveSync(requestNo, response) {
  try {
    const result = await syncExpenseRequestToDrive({
      rootDir,
      requestNo,
    });

    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot sync expense request to Google Drive",
    });
  }
}

async function handleSubstituteReceiptDriveSync(receiptNo, response) {
  try {
    const result = await syncSubstituteReceiptToDrive({
      rootDir,
      receiptNo,
    });

    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot sync substitute receipt to Google Drive",
    });
  }
}

async function handleExpenseRequestFile(fileRoute, response) {
  try {
    const file = await getExpenseRequestFile({
      rootDir,
      requestNo: fileRoute.requestNo,
      section: fileRoute.section,
      fileName: fileRoute.fileName,
    });
    const body = await readFile(file.absolutePath);
    const contentType = mimeTypes[path.extname(file.absolutePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, { "content-type": contentType });
    response.end(body);
  } catch (error) {
    sendJson(response, 404, {
      error: error.message || "Cannot open expense request file",
    });
  }
}

async function handleSubstituteReceiptFile(fileRoute, response) {
  try {
    const file = await getSubstituteReceiptFile({
      rootDir,
      receiptNo: fileRoute.receiptNo,
      section: fileRoute.section,
      fileName: fileRoute.fileName,
    });
    const body = await readFile(file.absolutePath);
    const contentType = mimeTypes[path.extname(file.absolutePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, { "content-type": contentType });
    response.end(body);
  } catch (error) {
    sendJson(response, 404, {
      error: error.message || "Cannot open substitute receipt file",
    });
  }
}

async function handleWorkflowDocumentFile(fileRoute, response) {
  try {
    const file = await getWorkflowDocumentFile({
      rootDir,
      documentKind: fileRoute.documentKind,
      documentNo: fileRoute.documentNo,
      section: fileRoute.section,
      fileName: fileRoute.fileName,
    });
    const body = await readFile(file.absolutePath);
    const contentType = mimeTypes[path.extname(file.absolutePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, { "content-type": contentType });
    response.end(body);
  } catch (error) {
    sendJson(response, 404, {
      error: error.message || "Cannot open workflow document file",
    });
  }
}

async function handleWorkflowDocumentSubmission(request, response) {
  try {
    const body = await readRequestBody(request);
    const { fields, files } = parseMultipartForm(body, request.headers["content-type"]);
    const data = JSON.parse(fields.payload || "{}");
    const errors = validateWorkflowDocumentPayload(data);
    if (errors.length) throw new Error(errors.join(", "));

    // documentNo, folderPath, status, statusHistory, completedAt, completedBy,
    // createdAt, evidenceFiles, rawFiles, transactionNo, workflowTemplateId and
    // workflowStepId are server-owned. The client may only ever *reference* an
    // existing document by documentNo to edit it — every one of those fields is
    // then loaded from the stored record here, never taken from the request
    // body, so a client cannot forge an audit stamp, redirect the write outside
    // its real folder, resurrect an already-completed document by editing it,
    // move it to a different workflow step/transaction with a crafted POST, or
    // destroy its evidence files by omitting them from the edit payload (a save
    // that carries no new uploads must leave existing evidence exactly as it
    // was — see saveWorkflowDocument's merge of these against any new uploads).
    const requestedDocumentNo = String(data.documentNo ?? "").trim();
    const existingDocument = requestedDocumentNo
      ? await getWorkflowDocument(rootDir, data.documentKind, requestedDocumentNo)
      : null;

    if (existingDocument?.status === "completed") {
      throw new Error("ไม่สามารถแก้ไขเอกสารที่เสร็จสิ้นแล้วได้");
    }

    let serverOwnedFields;
    if (existingDocument) {
      serverOwnedFields = {
        documentNo: existingDocument.documentNo,
        folderPath: existingDocument.folderPath,
        status: existingDocument.status,
        statusHistory: existingDocument.payload?.statusHistory ?? [],
        completedAt: existingDocument.payload?.completedAt ?? "",
        completedBy: existingDocument.payload?.completedBy ?? "",
        createdAt: existingDocument.payload?.createdAt ?? "",
        evidenceFiles: existingDocument.payload?.evidenceFiles ?? {},
        rawFiles: existingDocument.payload?.rawFiles ?? [],
        transactionNo: existingDocument.payload?.transactionNo ?? "",
        workflowTemplateId: existingDocument.payload?.workflowTemplateId ?? "",
        workflowStepId: existingDocument.payload?.workflowStepId ?? "",
      };
    } else {
      const nextInfo = await getNextWorkflowDocumentInfo(rootDir, data.documentKind, data.accountingMonth);
      serverOwnedFields = {
        documentNo: "",
        folderPath: "",
        sequence: nextInfo.sequence,
        status: "draft",
        statusHistory: [],
        completedAt: "",
        completedBy: "",
        createdAt: "",
      };
    }

    const payload = buildWorkflowDocumentPayload({ ...data, ...serverOwnedFields });
    const result = await saveWorkflowDocument({ rootDir, payload, uploads: files });

    sendJson(response, 200, omitAbsoluteFolderPath(result));
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "ไม่สามารถบันทึกเอกสารได้",
    });
  }
}

async function handleWorkflowDocumentComplete(documentKind, documentNo, request, response) {
  try {
    const body = await readJsonBody(request);
    const result = await completeWorkflowDocument({
      rootDir,
      documentKind,
      documentNo,
      completedBy: body.completedBy,
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot complete workflow document",
    });
  }
}

// A lightweight document's own "Sync to Google Drive" button on the
// /workflow-documents list page: the same per-document route expense requests
// and substitute receipts already have. syncWorkflowDocumentToDrive records a
// failed upload on the document before re-throwing it; here it becomes a Thai
// 400 that names the document and says why (with no Google Drive credentials:
// "not configured"), so a failure is never an unhandled error or a silent
// no-op. The response carries only Drive-side fields, never a local path.
async function handleWorkflowDocumentDriveSync(documentKind, documentNo, response) {
  try {
    const result = await syncWorkflowDocumentToDrive({ rootDir, documentKind, documentNo });
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: `ซิงก์ ${documentNo || "เอกสาร"} ขึ้น Google Drive ไม่สำเร็จ: ${describeDriveSyncError(error.message)}`,
    });
  }
}

function omitAbsoluteFolderPath(record) {
  const { absoluteFolderPath, ...rest } = record;
  return rest;
}

// Strips the server's own filesystem path off one pdfFiles/rawFiles entry.
function omitAbsolutePathFromFileEntry(file) {
  if (!file || typeof file !== "object") return file;
  const { absolutePath, ...rest } = file;
  return rest;
}

// Every pdfFiles/rawFiles entry attached to a workflow-transaction response —
// both the transaction's own top-level pdfFiles (the packet) and each child
// document's pdfFiles/rawFiles — still carries the server's absolute
// filesystem path (listPdfFiles/listRawFiles attach it for on-disk lookups
// elsewhere). omitAbsoluteFolderPath above already strips the *folder*-level
// field for the workflow-document routes; this does the equivalent for every
// file entry on the workflow-transaction GET/refresh/complete routes, without
// touching the expense-request or substitute-receipt routes, which are out of
// scope for this fix.
function omitAbsolutePathsFromWorkflowTransactionResponse(record) {
  if (!record) return record;
  return {
    ...record,
    pdfFiles: Array.isArray(record.pdfFiles) ? record.pdfFiles.map(omitAbsolutePathFromFileEntry) : record.pdfFiles,
    childDocuments: Array.isArray(record.childDocuments)
      ? record.childDocuments.map((doc) => ({
        ...doc,
        pdfFiles: Array.isArray(doc.pdfFiles) ? doc.pdfFiles.map(omitAbsolutePathFromFileEntry) : doc.pdfFiles,
        rawFiles: Array.isArray(doc.rawFiles) ? doc.rawFiles.map(omitAbsolutePathFromFileEntry) : doc.rawFiles,
      }))
      : record.childDocuments,
  };
}

// Backs the /workflow-documents list page. Every filter is validated by
// parseWorkflowDocumentListFilters (a Thai 400 on anything unrecognised)
// before it reaches the documents index, where each is a bound parameter.
// listWorkflowDocumentSummaries already strips absolutePath from every file
// entry; omitAbsoluteFolderPath stays here as the same last line of defence
// the other workflow-document routes use.
async function handleWorkflowDocumentList(url, response) {
  try {
    const filters = parseWorkflowDocumentListFilters(url.searchParams);
    const documents = await listWorkflowDocumentSummaries(rootDir, filters);
    sendJson(response, 200, { documents: documents.map(omitAbsoluteFolderPath) });
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "ไม่สามารถแสดงรายการเอกสารได้",
    });
  }
}

async function handleWorkflowDocumentGet(documentKind, documentNo, response) {
  try {
    const record = await getWorkflowDocument(rootDir, documentKind, documentNo);
    if (!record) throw new Error("ไม่พบเอกสาร");
    sendJson(response, 200, omitAbsoluteFolderPath(record));
  } catch (error) {
    sendJson(response, 404, {
      error: error.message || "ไม่สามารถโหลดเอกสารได้",
    });
  }
}

async function handleWorkflowDocumentTypesList(response) {
  try {
    sendJson(response, 200, { documentTypes: listWorkflowDocumentTypes() });
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "ไม่สามารถแสดงประเภทเอกสารได้",
    });
  }
}

async function handleWorkflowTemplateList(response) {
  try {
    sendJson(response, 200, { templates: await listWorkflowTemplates(rootDir) });
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "ไม่สามารถแสดงรายการ template ได้",
    });
  }
}

async function handleWorkflowTemplateSave(request, response) {
  try {
    const body = await readJsonBody(request);
    const templateId = typeof body.templateId === "string" ? body.templateId.trim() : "";
    if (!templateId) throw new Error("ระบุรหัส template");

    const existing = await getWorkflowTemplate(rootDir, templateId);

    // The client may only set name, description, the ordered document kinds,
    // and the syncGoogleDrive toggle. Everything else (active/createdAt) is
    // server-owned: derived from the existing record when editing, or a safe
    // default when creating — never taken from the body. This mirrors how
    // POST /api/workflow-documents refuses to trust status/completedBy/
    // folderPath from the client (see handleWorkflowDocumentSubmission). In
    // particular there is no syncGoogleSheets toggle here: the workflow layer
    // deliberately never writes a Google Sheets row.
    const template = {
      templateId,
      name: typeof body.name === "string" ? body.name : (existing?.name ?? ""),
      description: typeof body.description === "string" ? body.description : (existing?.description ?? ""),
      documentSteps: Array.isArray(body.documentSteps) ? body.documentSteps : (existing?.documentSteps ?? []),
      syncGoogleDrive: typeof body.syncGoogleDrive === "boolean" ? body.syncGoogleDrive : !!existing?.syncGoogleDrive,
      active: existing ? existing.active : true,
      createdAt: existing?.createdAt,
    };

    const saved = await saveWorkflowTemplate({ rootDir, template });
    sendJson(response, 200, saved);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "ไม่สามารถบันทึก template ได้",
    });
  }
}

async function handleNextWorkflowTransaction(url, response) {
  try {
    const accountingMonth = url.searchParams.get("accountingMonth") || "";
    if (!isValidAccountingMonth(accountingMonth)) {
      throw new Error("รูปแบบเดือนบัญชีไม่ถูกต้อง กรุณาระบุเป็น YYYY-MM");
    }
    const result = await getNextWorkflowTransactionInfo(rootDir, accountingMonth);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "ไม่สามารถคำนวณเลขที่ธุรกรรมถัดไปได้",
    });
  }
}

async function handleWorkflowTransactionList(response) {
  try {
    sendJson(response, 200, { transactions: await listWorkflowTransactions(rootDir) });
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "ไม่สามารถแสดงรายการธุรกรรมได้",
    });
  }
}

async function handleWorkflowTransactionStart(request, response) {
  try {
    const body = await readJsonBody(request);
    // The client supplies only templateId/accountingMonth/title. Every
    // identifier, path, and status the transaction gets is derived by
    // startWorkflowTransaction itself — nothing else from the body is ever
    // forwarded into it, so a client cannot forge transactionNo, folderPath,
    // or status the way Critical 3 let it forge a workflow-document's audit
    // stamp.
    const templateId = typeof body.templateId === "string" ? body.templateId.trim() : "";
    const accountingMonth = typeof body.accountingMonth === "string" ? body.accountingMonth.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";

    if (!templateId) throw new Error("ระบุรหัส template");
    if (!isValidAccountingMonth(accountingMonth)) {
      throw new Error("รูปแบบเดือนบัญชีไม่ถูกต้อง กรุณาระบุเป็น YYYY-MM");
    }
    if (!title) throw new Error("ระบุชื่อธุรกรรม");

    const result = await startWorkflowTransaction({ rootDir, templateId, accountingMonth, title });
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "ไม่สามารถเริ่มธุรกรรมได้",
    });
  }
}

async function handleWorkflowTransactionGet(transactionNo, response) {
  try {
    const record = await getWorkflowTransactionDetail(rootDir, transactionNo);
    if (!record) throw new Error("ไม่พบธุรกรรม");
    sendJson(response, 200, omitAbsolutePathsFromWorkflowTransactionResponse(record));
  } catch (error) {
    sendJson(response, 404, {
      error: error.message || "ไม่สามารถโหลดธุรกรรมได้",
    });
  }
}

// regeneratePacket defaults to true — the same default refreshWorkflowTransaction
// itself uses — so every existing caller of this route (the explicit
// "รีเฟรชสถานะ" button, and every test that just POSTs .../refresh with no
// body) keeps regenerating the packet exactly as before. The transaction
// page's self-refresh on load is the one caller that opts out, by sending
// { regeneratePacket: false } (see refreshTransaction in
// forms/workflow.logic.browser.js) — a page load has no reason to spawn the
// packet's Python subprocess before anyone has asked to download it.
async function handleWorkflowTransactionRefresh(transactionNo, request, response) {
  try {
    const body = await readJsonBody(request);
    const regeneratePacket = body.regeneratePacket !== false;
    const result = await refreshWorkflowTransaction({ rootDir, transactionNo, regeneratePacket });
    sendJson(response, 200, omitAbsolutePathsFromWorkflowTransactionResponse(result));
  } catch (error) {
    sendJson(response, 404, {
      error: error.message || "ไม่สามารถรีเฟรชธุรกรรมได้",
    });
  }
}

// Refuses unless every step is completed (completeWorkflowTransaction's own
// check), and auto-syncs Google Drive per the transaction's snapshotted
// syncGoogleDrive toggle. No sheetsRecorder/syncGoogleSheets anywhere here —
// there is no workflow-level Sheets sync (decision D6).
async function handleWorkflowTransactionComplete(transactionNo, request, response) {
  try {
    const body = await readJsonBody(request);
    const result = await completeWorkflowTransaction({
      rootDir,
      transactionNo,
      completedBy: body.completedBy,
    });
    sendJson(response, 200, omitAbsolutePathsFromWorkflowTransactionResponse(result));
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "ไม่สามารถปิดงานธุรกรรมได้",
    });
  }
}

// Usable any time after completion regardless of the toggle (the manual
// "sync Drive" button on the transaction page), and the exact same function
// completeWorkflowTransaction calls internally for the toggle-on path.
async function handleWorkflowTransactionDriveSync(transactionNo, response) {
  try {
    const result = await syncWorkflowTransactionToDrive({ rootDir, transactionNo });
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "ไม่สามารถซิงก์ธุรกรรมไปยัง Google Drive ได้",
    });
  }
}

async function handleWorkflowTransactionPrefill(transactionNo, url, response) {
  try {
    const documentKind = url.searchParams.get("documentKind") || "";
    const stepId = url.searchParams.get("stepId") || "";
    if (!stepId) throw new Error("ระบุขั้นตอนของ Workflow");
    const result = await getWorkflowTransactionPrefill({ rootDir, transactionNo, documentKind, stepId });
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "ไม่สามารถดึงข้อมูลเติมล่วงหน้าได้",
    });
  }
}

function buildWorkflowStepOpenUrl({ route, transactionNo, workflowTemplateId, workflowStepId, returnTo, receiptType }) {
  const separator = route.includes("?") ? "&" : "?";
  const params = new URLSearchParams({ transactionNo, workflowTemplateId, workflowStepId, returnTo });
  // Only present for a substitute_receipt step whose *snapshotted* template
  // step declared a receiptType (see getDocumentTypeDefinition call site
  // below) -- a template persisted before this feature shipped, or a step
  // that simply never declared one, must open exactly as before: no extra
  // param, no lock on the form.
  if (receiptType) params.set("receiptType", receiptType);
  return `${route}${separator}${params.toString()}`;
}

async function handleWorkflowTransactionStartDocument(transactionNo, stepId, response) {
  try {
    if (!transactionNo) throw new Error("ไม่มีเลขที่ธุรกรรม");
    if (!stepId) throw new Error("ไม่พบขั้นตอนนี้ใน Workflow");

    // Refresh first, deliberately: a child document completed moments ago
    // must unlock the next step immediately, without forcing the user to
    // press refresh before they can open it. regeneratePacket:false — this
    // route only needs the freshly-derived step order below, never the
    // packet PDF, so every "เปิดเอกสาร" click must not spawn Python for a
    // download link nobody asked for on this request.
    const transaction = await refreshWorkflowTransaction({ rootDir, transactionNo, regeneratePacket: false });

    const step = (transaction.steps || []).find((item) => item.stepId === stepId);
    if (!step) throw new Error("ไม่พบขั้นตอนนี้ใน Workflow");

    // Enforcement, not a UI affordance: compare against the freshly derived
    // currentStepId (strict template order) so a crafted request for a
    // locked step is refused server-side even if the UI would never send it.
    if (transaction.currentStepId !== step.stepId) {
      throw new Error("ขั้นตอนนี้ยังไม่พร้อมใช้งาน กรุณาทำขั้นตอนก่อนหน้าให้เสร็จสิ้นก่อน");
    }

    const definition = getDocumentTypeDefinition(step.documentKind);
    if (!definition) throw new Error("ไม่พบประเภทเอกสารสำหรับขั้นตอนนี้");

    // Sourced from the transaction's snapshotted template (templateSnapshot),
    // never the live one in data/workflow-templates.json -- a template
    // edited after the transaction started must not change a running
    // transaction (see the snapshot-immutability test in
    // tests/workflow-api.test.mjs).
    const templateStep = (transaction.templateSnapshot?.documentSteps || [])
      .find((item) => item.stepId === step.stepId);
    const receiptType = step.documentKind === "substitute_receipt" ? templateStep?.receiptType : undefined;

    const returnTo = `/workflow-transaction?transactionNo=${encodeURIComponent(transactionNo)}`;
    const url = buildWorkflowStepOpenUrl({
      route: definition.route,
      transactionNo,
      workflowTemplateId: transaction.workflowTemplateId,
      workflowStepId: step.stepId,
      returnTo,
      receiptType,
    });

    sendJson(response, 200, {
      url,
      documentKind: step.documentKind,
      transactionNo,
      workflowTemplateId: transaction.workflowTemplateId,
      workflowStepId: step.stepId,
      returnTo,
    });
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "ไม่สามารถเปิดเอกสารของขั้นตอนนี้ได้",
    });
  }
}

async function handleWorkflowTransactionFile(fileRoute, response) {
  try {
    const file = await getWorkflowTransactionFile({
      rootDir,
      transactionNo: fileRoute.transactionNo,
      section: fileRoute.section,
      fileName: fileRoute.fileName,
    });
    const body = await readFile(file.absolutePath);
    const contentType = mimeTypes[path.extname(file.absolutePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, { "content-type": contentType });
    response.end(body);
  } catch (error) {
    sendJson(response, 404, {
      error: error.message || "ไม่สามารถเปิดไฟล์ธุรกรรมได้",
    });
  }
}

async function handleGoogleDriveStatus(response) {
  try {
    sendJson(response, 200, await getGoogleDriveStatus(rootDir));
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot read Google Drive status",
    });
  }
}

async function handleCompanySettingsGet(response) {
  try {
    sendJson(response, 200, await getCompanySettings(rootDir));
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot read company settings",
    });
  }
}

async function handleCompanySettingsSave(request, response) {
  try {
    const payload = await readJsonBody(request);
    const result = await saveCompanySettings({
      rootDir,
      legalName: payload.legalName,
      taxId: payload.taxId,
      branch: payload.branch,
      address: payload.address,
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot save company settings",
    });
  }
}

async function handleGoogleDriveConfig(request, response) {
  try {
    const payload = await readJsonBody(request);
    const result = await saveGoogleDriveConfig({
      rootDir,
      clientId: payload.clientId,
      clientSecret: payload.clientSecret,
      driveBasePath: payload.driveBasePath,
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot save Google Drive config",
    });
  }
}

async function handleGoogleDriveLogin(request, response) {
  try {
    const authUrl = await buildGoogleOAuthUrl({
      rootDir,
      redirectUri: getOAuthRedirectUri(request),
      state: "sweet-house-google-drive",
    });
    redirect(response, authUrl);
  } catch (error) {
    redirect(response, `/google-drive?error=${encodeURIComponent(error.message || "Cannot start Google login")}`);
  }
}

async function handleGoogleDriveCallback(request, response, url) {
  try {
    if (url.searchParams.get("error")) {
      throw new Error(url.searchParams.get("error"));
    }
    await exchangeGoogleOAuthCode({
      rootDir,
      code: url.searchParams.get("code"),
      redirectUri: getOAuthRedirectUri(request),
    });
    redirect(response, "/google-drive?auth=success");
  } catch (error) {
    redirect(response, `/google-drive?error=${encodeURIComponent(error.message || "Google login failed")}`);
  }
}

async function handleDraftSave(request, response) {
  try {
    const body = await readRequestBody(request);
    const { fields, files } = parseMultipartForm(body, request.headers["content-type"]);
    const payload = JSON.parse(fields.payload || "{}");
    const result = await saveExpenseDraft({
      rootDir,
      payload,
      uploads: files,
    });

    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot save draft",
    });
  }
}

async function handleDraftList(response) {
  try {
    const result = await listExpenseDrafts(rootDir);
    sendJson(response, 200, { drafts: result });
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot list drafts",
    });
  }
}

async function handleExpenseRequestList(response) {
  try {
    const result = await listExpenseRequests(rootDir);
    sendJson(response, 200, { requests: result });
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot list expense requests",
    });
  }
}

async function handleSubstituteReceiptList(response) {
  try {
    const result = await listSubstituteReceipts(rootDir);
    sendJson(response, 200, { receipts: result });
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot list substitute receipts",
    });
  }
}

async function handleSubmittedExpenseRequestGet(requestNo, response) {
  try {
    const result = await getSubmittedExpenseRequest(rootDir, requestNo);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 404, {
      error: error.message || "Cannot load expense request",
    });
  }
}

async function handleSubmittedSubstituteReceiptGet(receiptNo, response) {
  try {
    const result = await getSubmittedSubstituteReceipt(rootDir, receiptNo);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 404, {
      error: error.message || "Cannot load substitute receipt",
    });
  }
}

async function handleDraftGet(draftId, response) {
  try {
    const result = await getExpenseDraft(rootDir, draftId);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 404, {
      error: error.message || "Cannot load draft",
    });
  }
}

async function handleSubstituteReceiptDraftGet(draftId, response) {
  try {
    const result = await getSubstituteReceiptDraft(rootDir, draftId);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 404, {
      error: error.message || "Cannot load substitute receipt draft",
    });
  }
}

async function handleNextExpenseRequest(url, response) {
  try {
    const accountingMonth = url.searchParams.get("accountingMonth");
    const result = await getNextExpenseRequestInfo(rootDir, accountingMonth);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot calculate next request number",
    });
  }
}

async function handleNextSubstituteReceipt(url, response) {
  try {
    const accountingMonth = url.searchParams.get("accountingMonth");
    const result = await getNextSubstituteReceiptInfo(rootDir, accountingMonth);
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot calculate next substitute receipt number",
    });
  }
}

async function handleInventoryProductList(url, response) {
  try {
    sendJson(response, 200, { products: listProducts(rootDir, { search: url.searchParams.get("search") || "" }) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot list products" });
  }
}

async function handleInventoryProductDetail(productId, response) {
  try {
    sendJson(response, 200, getInventoryProductDetail(rootDir, productId));
  } catch (error) {
    sendJson(response, 404, { error: error.message || "Cannot load product detail" });
  }
}

async function handleInventoryCategoryList(url, response) {
  try {
    const includeInactive = url.searchParams.get("includeInactive") === "1";
    sendJson(response, 200, { categories: listProductCategories(rootDir, { includeInactive }) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot list product categories" });
  }
}

async function handleInventoryCategoryCreate(request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { category: createProductCategory(rootDir, payload) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot create product category" });
  }
}

async function handleInventoryCategoryUpdate(categoryId, request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { category: updateProductCategory(rootDir, categoryId, payload) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot update product category" });
  }
}

async function handleInventoryProductCreate(request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { product: createProduct(rootDir, payload) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot create product" });
  }
}

async function handleInventoryProductImageUpload(productId, request, response) {
  try {
    const body = await readRequestBody(request);
    const { files } = parseMultipartForm(body, request.headers["content-type"]);
    const file = files.find((upload) => upload.evidenceKey === "image") || files[0];
    sendJson(response, 200, await saveProductImage(rootDir, productId, file));
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot upload product image" });
  }
}

async function handleInventoryProductUpdate(productId, request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { product: updateProduct(rootDir, productId, payload) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot update product" });
  }
}

async function handleInventoryStockSkuList(url, response) {
  try {
    sendJson(response, 200, { stockSkus: listStockSkus(rootDir, { search: url.searchParams.get("search") || "" }) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot list stock SKUs" });
  }
}

async function handleInventoryStockSkuCreate(request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { stockSku: createStockSku(rootDir, payload) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot create stock SKU" });
  }
}

async function handleInventoryStockSkuImageUpload(stockSkuId, request, response) {
  try {
    const body = await readRequestBody(request);
    const { files } = parseMultipartForm(body, request.headers["content-type"]);
    const file = files.find((upload) => upload.evidenceKey === "image") || files[0];
    sendJson(response, 200, await saveStockSkuImage(rootDir, stockSkuId, file));
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot upload stock SKU image" });
  }
}

async function handleInventoryStockSkuUpdate(stockSkuId, request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { stockSku: updateStockSku(rootDir, stockSkuId, payload) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot update stock SKU" });
  }
}

async function handleInventorySaleSkuList(url, response) {
  try {
    sendJson(response, 200, { saleSkus: listSaleSkus(rootDir, { search: url.searchParams.get("search") || "" }) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot list sale SKUs" });
  }
}

async function handleInventorySaleSkuGet(saleSkuId, response) {
  try {
    sendJson(response, 200, { saleSku: getSaleSku(rootDir, saleSkuId) });
  } catch (error) {
    sendJson(response, 404, { error: error.message || "Cannot load sale SKU" });
  }
}

async function handleInventorySaleSkuCreate(request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { saleSku: createSaleSku(rootDir, payload) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot create sale SKU" });
  }
}

async function handleInventorySaleSkuUpdate(saleSkuId, request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { saleSku: updateSaleSku(rootDir, saleSkuId, payload) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot update sale SKU" });
  }
}

async function handlePlatformOrderImportList(response) {
  try {
    sendJson(response, 200, { imports: listPlatformOrderImports(rootDir) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot list platform order imports" });
  }
}

async function handlePlatformOrderImportDetail(importId, response) {
  try {
    sendJson(response, 200, getPlatformOrderImport(rootDir, importId));
  } catch (error) {
    sendJson(response, 404, { error: error.message || "Cannot load platform order import" });
  }
}

async function handlePlatformOrderImportCreate(request, response) {
  try {
    const body = await readRequestBody(request);
    const { fields, files } = parseMultipartForm(body, request.headers["content-type"]);
    const file = files.find((upload) => upload.evidenceKey === "file") || files[0];
    if (!file?.buffer?.length) throw new Error("เลือกไฟล์ order");
    const platform = fields.platform || request.headers["x-platform"] || "manual";
    const result = importPlatformOrders(rootDir, {
      platform,
      fileName: file.originalName || "orders.csv",
      fileBuffer: file.buffer,
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot import platform orders" });
  }
}

async function handlePlatformOrderImportPost(importId, response) {
  try {
    sendJson(response, 200, postPlatformOrderImport(rootDir, importId));
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot post platform order import" });
  }
}

async function handleSubstituteReceiptVendorList(url, response) {
  try {
    const includeInactive = url.searchParams.get("includeInactive") === "1";
    sendJson(response, 200, { vendors: await listSubstituteReceiptVendors(rootDir, { includeInactive }) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot list substitute receipt vendors" });
  }
}

async function handleSubstituteReceiptVendorCreate(request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { vendor: await createSubstituteReceiptVendor(rootDir, payload) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot create substitute receipt vendor" });
  }
}

async function handleSubstituteReceiptVendorUpdate(vendorId, request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { vendor: await updateSubstituteReceiptVendor(rootDir, vendorId, payload) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot update substitute receipt vendor" });
  }
}

async function handleInventoryPurchaseIn(request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { movement: createPurchaseInMovement(rootDir, payload), balances: listInventoryBalances(rootDir) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot receive inventory" });
  }
}

async function handleInventoryBalanceList(response) {
  try {
    sendJson(response, 200, { balances: listInventoryBalances(rootDir) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot list inventory balances" });
  }
}

async function handleInventoryDashboard(response) {
  try {
    sendJson(response, 200, {
      summary: getInventoryDashboardSummary(rootDir),
      latestStockIn: listStockInReport(rootDir, { limit: 10 }),
    });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot load inventory dashboard" });
  }
}

async function handleInventoryStockInReport(url, response) {
  try {
    sendJson(response, 200, {
      movements: listStockInReport(rootDir, { limit: url.searchParams.get("limit") || "100" }),
    });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot load stock-in report" });
  }
}

async function handleInventoryStockList(url, response) {
  try {
    sendJson(response, 200, {
      groups: listInventoryStockGroups(rootDir, {
        search: url.searchParams.get("search") || "",
        category: url.searchParams.get("category") || "",
        stockStatus: url.searchParams.get("stockStatus") || "all",
      }),
    });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot load stock list" });
  }
}

async function handleCurrentStockPdf(response) {
  try {
    const company = await getCompanySettings(rootDir);
    const summary = getInventoryDashboardSummary(rootDir);
    const balances = listInventoryBalances(rootDir);
    const pdf = await generateCurrentStockPdf({ company, summary, balances });
    response.writeHead(200, {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="current-stock-${summary.asOfDate}.pdf"`,
      "content-length": String(pdf.length),
    });
    response.end(pdf);
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot generate current stock PDF" });
  }
}

async function handleInventoryStockCard(url, response) {
  try {
    sendJson(response, 200, getStockCard(rootDir, url.searchParams.get("stockSkuId")));
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot load stock card" });
  }
}

async function handleInventoryImage(urlPath, response) {
  const prefix = "/api/inventory/images/";
  const imagePath = decodeURIComponent(urlPath.slice(prefix.length));
  if (!imagePath || imagePath.includes("..") || imagePath.includes("\\") || path.isAbsolute(imagePath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const imageRoot = path.resolve(rootDir, "data", "inventory-images");
  const absolutePath = path.resolve(imageRoot, imagePath);
  if (!absolutePath.startsWith(`${imageRoot}${path.sep}`)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  try {
    const body = await readFile(absolutePath);
    const contentType = mimeTypes[path.extname(absolutePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, { "content-type": contentType });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

async function handleStaticFile(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const absolutePath = safeStaticPath(url.pathname);
    if (!absolutePath) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    const body = await readFile(absolutePath);
    const contentType = mimeTypes[path.extname(absolutePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, { "content-type": contentType });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "POST" && request.url === "/api/inventory/products") {
    await handleInventoryProductCreate(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/inventory/categories") {
    await handleInventoryCategoryCreate(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/inventory/stock-skus") {
    await handleInventoryStockSkuCreate(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/inventory/purchase-in") {
    await handleInventoryPurchaseIn(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/inventory/sale-skus") {
    await handleInventorySaleSkuCreate(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/platform-orders/imports") {
    await handlePlatformOrderImportCreate(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/platform-orders/imports/") && url.pathname.endsWith("/post")) {
    const importId = decodeURIComponent(url.pathname.replace("/api/platform-orders/imports/", "").replace("/post", ""));
    await handlePlatformOrderImportPost(importId, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/inventory/products/") && url.pathname.endsWith("/image")) {
    const productId = decodeURIComponent(url.pathname
      .replace("/api/inventory/products/", "")
      .replace("/image", ""));
    await handleInventoryProductImageUpload(productId, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/inventory/stock-skus/") && url.pathname.endsWith("/image")) {
    const stockSkuId = decodeURIComponent(url.pathname
      .replace("/api/inventory/stock-skus/", "")
      .replace("/image", ""));
    await handleInventoryStockSkuImageUpload(stockSkuId, request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/substitute-receipt-vendors") {
    await handleSubstituteReceiptVendorCreate(request, response);
    return;
  }

  if (request.method === "PUT" && url.pathname.startsWith("/api/inventory/products/")) {
    const productId = decodeURIComponent(url.pathname.replace("/api/inventory/products/", ""));
    await handleInventoryProductUpdate(productId, request, response);
    return;
  }

  if (request.method === "PUT" && url.pathname.startsWith("/api/inventory/categories/")) {
    const categoryId = decodeURIComponent(url.pathname.replace("/api/inventory/categories/", ""));
    await handleInventoryCategoryUpdate(categoryId, request, response);
    return;
  }

  if (request.method === "PUT" && url.pathname.startsWith("/api/inventory/stock-skus/")) {
    const stockSkuId = decodeURIComponent(url.pathname.replace("/api/inventory/stock-skus/", ""));
    await handleInventoryStockSkuUpdate(stockSkuId, request, response);
    return;
  }

  if (request.method === "PUT" && url.pathname.startsWith("/api/inventory/sale-skus/")) {
    const saleSkuId = decodeURIComponent(url.pathname.replace("/api/inventory/sale-skus/", ""));
    await handleInventorySaleSkuUpdate(saleSkuId, request, response);
    return;
  }

  if (request.method === "PUT" && url.pathname.startsWith("/api/substitute-receipt-vendors/")) {
    const vendorId = decodeURIComponent(url.pathname.replace("/api/substitute-receipt-vendors/", ""));
    await handleSubstituteReceiptVendorUpdate(vendorId, request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/expense-requests") {
    await handleExpenseSubmission(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/substitute-receipts") {
    await handleSubstituteReceiptSubmission(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/workflow-documents") {
    await handleWorkflowDocumentSubmission(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/workflow-documents/") && url.pathname.endsWith("/complete")) {
    const remainder = url.pathname.replace("/api/workflow-documents/", "").replace("/complete", "");
    const [documentKind, documentNo] = remainder.split("/");
    await handleWorkflowDocumentComplete(decodeURIComponent(documentKind || ""), decodeURIComponent(documentNo || ""), request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/workflow-documents/") && url.pathname.endsWith("/sync-drive")) {
    const segments = url.pathname.replace("/api/workflow-documents/", "").replace(/\/sync-drive$/, "").split("/");
    const [documentKind, documentNo] = segments.length === 2 ? segments : [segments[0], ""];
    await handleWorkflowDocumentDriveSync(decodeURIComponent(documentKind || ""), decodeURIComponent(documentNo || ""), response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/workflow-templates") {
    await handleWorkflowTemplateSave(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/workflow-transactions") {
    await handleWorkflowTransactionStart(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/workflow-transactions/") && url.pathname.endsWith("/refresh")) {
    const transactionNo = decodeURIComponent(url.pathname
      .replace("/api/workflow-transactions/", "")
      .replace("/refresh", ""));
    await handleWorkflowTransactionRefresh(transactionNo, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/workflow-transactions/") && url.pathname.endsWith("/complete")) {
    const transactionNo = decodeURIComponent(url.pathname
      .replace("/api/workflow-transactions/", "")
      .replace("/complete", ""));
    await handleWorkflowTransactionComplete(transactionNo, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/workflow-transactions/") && url.pathname.endsWith("/sync-drive")) {
    const transactionNo = decodeURIComponent(url.pathname
      .replace("/api/workflow-transactions/", "")
      .replace("/sync-drive", ""));
    await handleWorkflowTransactionDriveSync(transactionNo, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/workflow-transactions/") && url.pathname.includes("/start-document/")) {
    const remainder = url.pathname.replace("/api/workflow-transactions/", "");
    const [transactionNoRaw, stepIdRaw] = remainder.split("/start-document/");
    await handleWorkflowTransactionStartDocument(
      decodeURIComponent(transactionNoRaw || ""),
      decodeURIComponent(stepIdRaw || ""),
      response,
    );
    return;
  }

  if (request.method === "POST" && request.url === "/api/substitute-receipt-drafts") {
    await handleSubstituteReceiptDraftSave(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/substitute-receipts/") && url.pathname.endsWith("/approve")) {
    const receiptNo = decodeURIComponent(url.pathname
      .replace("/api/substitute-receipts/", "")
      .replace("/approve", ""));
    await handleSubstituteReceiptApprove(receiptNo, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/expense-requests/") && url.pathname.endsWith("/approve")) {
    const requestNo = decodeURIComponent(url.pathname
      .replace("/api/expense-requests/", "")
      .replace("/approve", ""));
    await handleExpenseRequestApprove(requestNo, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/expense-requests/") && url.pathname.endsWith("/complete")) {
    const requestNo = decodeURIComponent(url.pathname
      .replace("/api/expense-requests/", "")
      .replace("/complete", ""));
    await handleExpenseRequestComplete(requestNo, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/substitute-receipts/") && url.pathname.endsWith("/complete")) {
    const receiptNo = decodeURIComponent(url.pathname
      .replace("/api/substitute-receipts/", "")
      .replace("/complete", ""));
    await handleSubstituteReceiptComplete(receiptNo, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/substitute-receipts/") && url.pathname.endsWith("/receive-stock")) {
    const receiptNo = decodeURIComponent(url.pathname
      .replace("/api/substitute-receipts/", "")
      .replace("/receive-stock", ""));
    await handleSubstituteReceiptReceiveStock(receiptNo, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/substitute-receipts/") && url.pathname.endsWith("/sync-drive")) {
    const receiptNo = decodeURIComponent(url.pathname
      .replace("/api/substitute-receipts/", "")
      .replace("/sync-drive", ""));
    await handleSubstituteReceiptDriveSync(receiptNo, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/expense-requests/") && url.pathname.endsWith("/sync-drive")) {
    const requestNo = decodeURIComponent(url.pathname
      .replace("/api/expense-requests/", "")
      .replace("/sync-drive", ""));
    await handleExpenseDriveSync(requestNo, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/expense-drafts") {
    await handleDraftSave(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/google-drive/config") {
    await handleGoogleDriveConfig(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/company-settings") {
    await handleCompanySettingsSave(request, response);
    return;
  }

  if (request.method === "GET") {
    if (url.pathname === "/drafts" || url.pathname === "/drafts/") {
      redirect(response, "/expense-requests?status=draft");
      return;
    }

    if (url.pathname === "/api/expense-requests/next") {
      await handleNextExpenseRequest(url, response);
      return;
    }

    if (url.pathname === "/api/substitute-receipts/next") {
      await handleNextSubstituteReceipt(url, response);
      return;
    }

    if (url.pathname === "/api/workflow-document-types") {
      await handleWorkflowDocumentTypesList(response);
      return;
    }

    if (url.pathname === "/api/workflow-templates") {
      await handleWorkflowTemplateList(response);
      return;
    }

    // Must be checked before the generic "/api/workflow-transactions/:transactionNo"
    // route below, or a request for the literal "next" would be swallowed and
    // treated as a lookup for a transaction named "next".
    if (url.pathname === "/api/workflow-transactions/next") {
      await handleNextWorkflowTransaction(url, response);
      return;
    }

    if (url.pathname === "/api/workflow-transactions") {
      await handleWorkflowTransactionList(response);
      return;
    }

    if (url.pathname === "/api/inventory/products") {
      await handleInventoryProductList(url, response);
      return;
    }

    if (url.pathname.startsWith("/api/inventory/products/") && url.pathname.endsWith("/detail")) {
      const productId = decodeURIComponent(url.pathname
        .replace("/api/inventory/products/", "")
        .replace("/detail", ""));
      await handleInventoryProductDetail(productId, response);
      return;
    }

    if (url.pathname === "/api/inventory/categories") {
      await handleInventoryCategoryList(url, response);
      return;
    }

    if (url.pathname === "/api/inventory/stock-skus") {
      await handleInventoryStockSkuList(url, response);
      return;
    }

    if (url.pathname === "/api/inventory/sale-skus") {
      await handleInventorySaleSkuList(url, response);
      return;
    }

    if (url.pathname === "/api/platform-orders/imports") {
      await handlePlatformOrderImportList(response);
      return;
    }

    if (url.pathname.startsWith("/api/platform-orders/imports/")) {
      const importId = decodeURIComponent(url.pathname.replace("/api/platform-orders/imports/", ""));
      await handlePlatformOrderImportDetail(importId, response);
      return;
    }

    if (url.pathname === "/api/inventory/dashboard") {
      await handleInventoryDashboard(response);
      return;
    }

    if (url.pathname === "/api/inventory/stock-in-report") {
      await handleInventoryStockInReport(url, response);
      return;
    }

    if (url.pathname === "/api/inventory/stock-list") {
      await handleInventoryStockList(url, response);
      return;
    }

    if (url.pathname === "/api/inventory/current-stock-pdf") {
      await handleCurrentStockPdf(response);
      return;
    }

    if (url.pathname.startsWith("/api/inventory/images/")) {
      await handleInventoryImage(url.pathname, response);
      return;
    }

    if (url.pathname === "/api/substitute-receipt-vendors") {
      await handleSubstituteReceiptVendorList(url, response);
      return;
    }

    if (url.pathname.startsWith("/api/inventory/sale-skus/")) {
      const saleSkuId = decodeURIComponent(url.pathname.replace("/api/inventory/sale-skus/", ""));
      await handleInventorySaleSkuGet(saleSkuId, response);
      return;
    }

    if (url.pathname === "/api/inventory/balances") {
      await handleInventoryBalanceList(response);
      return;
    }

    if (url.pathname === "/api/inventory/stock-card") {
      await handleInventoryStockCard(url, response);
      return;
    }

    if (url.pathname === "/api/expense-requests") {
      await handleExpenseRequestList(response);
      return;
    }

    if (url.pathname === "/api/substitute-receipts") {
      await handleSubstituteReceiptList(response);
      return;
    }

    if (url.pathname.startsWith("/api/substitute-receipts/") && !url.pathname.includes("/files/")) {
      const receiptNo = decodeURIComponent(url.pathname.replace("/api/substitute-receipts/", ""));
      await handleSubmittedSubstituteReceiptGet(receiptNo, response);
      return;
    }

    if (url.pathname.startsWith("/api/expense-requests/") && !url.pathname.includes("/files/")) {
      const requestNo = decodeURIComponent(url.pathname.replace("/api/expense-requests/", ""));
      await handleSubmittedExpenseRequestGet(requestNo, response);
      return;
    }

    if (url.pathname === "/api/workflow-documents") {
      await handleWorkflowDocumentList(url, response);
      return;
    }

    if (url.pathname.startsWith("/api/workflow-documents/")) {
      const remainder = url.pathname.replace("/api/workflow-documents/", "");
      const [documentKind, documentNo] = remainder.split("/");
      await handleWorkflowDocumentGet(decodeURIComponent(documentKind || ""), decodeURIComponent(documentNo || ""), response);
      return;
    }

    if (url.pathname.startsWith("/api/workflow-transactions/") && url.pathname.endsWith("/prefill")) {
      const transactionNo = decodeURIComponent(url.pathname
        .replace("/api/workflow-transactions/", "")
        .replace("/prefill", ""));
      await handleWorkflowTransactionPrefill(transactionNo, url, response);
      return;
    }

    if (
      url.pathname.startsWith("/api/workflow-transactions/")
      && !url.pathname.includes("/files/")
      && !url.pathname.endsWith("/prefill")
    ) {
      const transactionNo = decodeURIComponent(url.pathname.replace("/api/workflow-transactions/", ""));
      await handleWorkflowTransactionGet(transactionNo, response);
      return;
    }

    const fileRoute = parseExpenseRequestFileRoute(url.pathname);
    if (fileRoute) {
      await handleExpenseRequestFile(fileRoute, response);
      return;
    }

    const substituteReceiptFileRoute = parseSubstituteReceiptFileRoute(url.pathname);
    if (substituteReceiptFileRoute) {
      await handleSubstituteReceiptFile(substituteReceiptFileRoute, response);
      return;
    }

    const workflowDocumentFileRoute = parseWorkflowDocumentFileRoute(url.pathname);
    if (workflowDocumentFileRoute) {
      await handleWorkflowDocumentFile(workflowDocumentFileRoute, response);
      return;
    }

    const workflowTransactionFileRoute = parseWorkflowTransactionFileRoute(url.pathname);
    if (workflowTransactionFileRoute) {
      await handleWorkflowTransactionFile(workflowTransactionFileRoute, response);
      return;
    }

    if (url.pathname === "/api/google-drive/status") {
      await handleGoogleDriveStatus(response);
      return;
    }

    if (url.pathname === "/api/company-settings") {
      await handleCompanySettingsGet(response);
      return;
    }

    if (url.pathname === "/api/google-drive/login") {
      await handleGoogleDriveLogin(request, response);
      return;
    }

    if (url.pathname === "/api/google-drive/oauth2callback") {
      await handleGoogleDriveCallback(request, response, url);
      return;
    }

    if (url.pathname === "/api/expense-drafts") {
      await handleDraftList(response);
      return;
    }

    if (url.pathname.startsWith("/api/expense-drafts/")) {
      const draftId = decodeURIComponent(url.pathname.replace("/api/expense-drafts/", ""));
      await handleDraftGet(draftId, response);
      return;
    }

    if (url.pathname.startsWith("/api/substitute-receipt-drafts/")) {
      const draftId = decodeURIComponent(url.pathname.replace("/api/substitute-receipt-drafts/", ""));
      await handleSubstituteReceiptDraftGet(draftId, response);
      return;
    }

    await handleStaticFile(request, response);
    return;
  }

  response.writeHead(405);
  response.end("Method not allowed");
});

// Read paths now query the documents index (forms/document-index.logic.js)
// instead of walking documents/ on every request -- see local-server.logic.js.
// That makes it critical that the index is never empty/stale relative to an
// installation's real on-disk documents the moment the server starts serving
// requests: an owner who already has real accounting documents on disk (and
// whose index may be empty -- a brand-new database file, or one built by an
// older version of this app before the index existed) must never see their
// documents "vanish" from every list/detail page just because nothing has
// written through the index for them yet.
//
// rebuildDocumentIndex is idempotent and read-only against documents/ (see
// forms/document-index.logic.js) -- it always fully re-derives the `documents`
// table from disk, so running it unconditionally on every startup is both the
// simplest correct answer (no "is the index actually stale?" check to get
// wrong) and cheap: it is one recursive walk of documents/ plus one JSON.parse
// per canonical document file, paid once per server process start, not per
// request. For a company of this size (dozens to low hundreds of documents
// accumulated over years) this finishes in well under a second; even an
// installation with several thousand documents would still be a small
// fraction of a second, and either way it only happens at boot -- the exact
// walk this task's read-path change was meant to stop paying on every page
// load. A failure here (e.g. a locked/corrupted database file) is logged
// loudly but must not prevent the server from starting at all: every other
// subsystem (inventory, company settings, ...) shares the same sqlite file
// and would fail the same way, so refusing to start would not be any safer.
async function rebuildDocumentIndexOnStartup() {
  try {
    const startedAt = Date.now();
    const { total } = await rebuildDocumentIndex(rootDir);
    const durationMs = Date.now() - startedAt;
    console.log(`[ดัชนีเอกสาร] สร้างดัชนีใหม่จากไฟล์บนดิสก์เรียบร้อย (${total} เอกสาร, ${durationMs}ms)`);
  } catch (error) {
    console.error(
      `[ดัชนีเอกสาร] ไม่สามารถสร้างดัชนีเอกสารใหม่ตอนเริ่มเซิร์ฟเวอร์ได้: ${error.message} — เซิร์ฟเวอร์จะยังเริ่มทำงานต่อ แต่ผลการค้นหาเอกสารอาจไม่ครบถ้วนจนกว่าจะรัน scripts/rebuild-document-index.sh`,
    );
  }
}

async function startServer() {
  await rebuildDocumentIndexOnStartup();

  server.listen(port, listenHost, () => {
    const boundPort = server.address().port;
    console.log(`Expense request local web app: http://localhost:${boundPort}/`);
    if (allowNetwork) {
      console.log(
        `[คำเตือน] SWEET_HOUSE_ALLOW_NETWORK เปิดใช้งานอยู่ เซิร์ฟเวอร์กำลังรับฟังทุกอินเทอร์เฟซเครือข่าย (${listenHost}:${boundPort}) สามารถเข้าถึงจากเครือข่ายได้จากอุปกรณ์อื่น เช่น วงแลนสำนักงานหรือไวไฟร้านกาแฟ และระบบนี้ไม่มีระบบยืนยันตัวตนใด ๆ ทั้งสิ้น ผู้ใดก็ตามที่อยู่ในเครือข่ายเดียวกันจะสามารถเปิดดู แก้ไข หรือลบเอกสารบัญชีได้ โปรดใช้เฉพาะในเครือข่ายที่เชื่อถือได้เท่านั้น`,
      );
    } else {
      console.log(`เซิร์ฟเวอร์รับฟังเฉพาะเครื่องนี้เท่านั้น (${listenHost}:${boundPort}) หากต้องการเปิดให้เข้าถึงจากอุปกรณ์อื่นในเครือข่าย ให้ตั้งค่า SWEET_HOUSE_ALLOW_NETWORK=1`);
    }
  });
}

startServer();
