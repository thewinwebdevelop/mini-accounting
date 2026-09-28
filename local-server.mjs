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
  approveWorkflowDocument,
  completeExpenseRequest,
  completeSubstituteReceipt,
  completeWorkflowDocument,
  completeWorkflowTransaction,
  cancelWorkflowTransaction,
  getNextExpenseRequestInfo,
  getNextSubstituteReceiptInfo,
  getNextWorkflowDocumentInfo,
  getNextWorkflowTransactionInfo,
  getExpenseDraft,
  getLegacyExpenseDraftFile,
  getExpenseRequestFile,
  getSubstituteReceiptDraft,
  getLegacySubstituteReceiptDraftFile,
  getSubstituteReceiptFile,
  getSubmittedSubstituteReceipt,
  getWorkflowDocument,
  getWorkflowDocumentFiles,
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
  refreshWorkflowDocumentCompanySettings,
  saveExpenseDraft,
  saveExpenseSubmission,
  saveSubstituteReceiptDraft,
  saveSubstituteReceiptSubmission,
  saveWorkflowDocument,
  submitWorkflowDocument,
  rejectWorkflowDocument,
  saveWorkflowTemplate,
  startWorkflowTransaction,
  receiveSubstituteReceiptStock,
  rejectExpenseRequest,
  rejectSubstituteReceipt,
  getSubmittedExpenseRequest,
  describeDriveSyncError,
  syncExpenseRequestToDrive,
  syncSubstituteReceiptToDrive,
  syncWorkflowDocumentToDrive,
  syncWorkflowTransactionToDrive,
  syncWorkflowTransactionToSheets,
} = require("./forms/local-server.logic.js");
const {
  LIGHTWEIGHT_DOCUMENT_KINDS,
  buildWorkflowDocumentPayload,
  validateWorkflowDocumentPayload,
} = require("./forms/workflow-document.logic.js");
const { validateExpenseRequest } = require("./forms/expense-request.logic.js");
const {
  getDocumentTypeDefinition,
} = require("./forms/workflow.logic.js");
const {
  createProductCategory,
  createPurchaseInMovement,
  createSaleSku,
  getInventoryProductDetail,
  getInventoryDashboardSummary,
  getSaleSku,
  getStockCard,
  listInventoryBalances,
  listInventoryStockGroups,
  listProductCategories,
  listSaleSkus,
  listStockInReport,
  saveProductImage,
  saveStockSkuImage,
  updateProductCategory,
  updateSaleSku,
} = require("./forms/inventory.logic.js");
const {
  createSubstituteReceiptVendor,
  listSubstituteReceiptVendors,
  updateSubstituteReceiptVendor,
} = require("./forms/substitute-receipt-vendors.logic.js");
const {
  createVendor,
  findVendorMatches,
  getVendorById,
  listVendors,
  updateVendor,
  vendorCandidateFingerprint,
} = require("./forms/vendor.logic.js");
const {
  generateCurrentStockPdf,
} = require("./forms/inventory-report.logic.js");
const {
  getPlatformOrderImport,
  importPlatformOrders,
  listShopeeOrders,
  listPlatformOrderImports,
  postPlatformOrderImport,
  saveShopeeOrderLineMapping,
  getShopeeOrder,
} = require("./forms/platform-orders.logic.js");
const { openInventoryDatabase, ensureInventorySchema } = require("./forms/inventory-db.logic.js");
const {
  completeShopeeAuthorization,
  consumeShopeeOAuthState,
  createShopeeOAuthState,
  getShopeeConnection,
} = require("./forms/shopee-auth.logic.js");
const { createShopeeClient } = require("./forms/shopee-client.logic.js");
const { syncShopeeOrders } = require("./forms/shopee-orders.logic.js");
const {
  arrangeShipmentBatch,
  createShippingDocumentJob,
  pollShippingDocumentJob,
  prepareShipmentBatch,
  refreshBatchTracking,
  renderBatchLabels,
} = require("./forms/shopee-shipment.logic.js");
const {
  rebuildDocumentIndex,
} = require("./forms/document-index.logic.js");
const {
  resolveLineAppUser,
  verifyLineIdToken,
} = require("./forms/line-auth.logic.js");
const {
  extractLineMediaEvent,
  isSupportedLineMedia,
  verifyLineWebhookSignature,
} = require("./forms/line-webhook.logic.js");
const { createConfiguredLineIntakeStore } = require("./forms/line-intake.logic.js");
const {
  buildIntakeReviewReply,
  downloadLineContent,
  replyToLine,
} = require("./forms/line-bot.logic.js");
const { scanLineDocument } = require("./forms/line-ocr.logic.js");
const { createSupabaseAdminClient } = require("./forms/supabase.logic.js");
const { createSupabaseDataRepository } = require("./forms/supabase-data.logic.js");
const { createSupabaseStorageClient } = require("./forms/supabase-storage.logic.js");
const { resolveGoogleOAuthRedirectUri } = require("./forms/google-oauth-config.logic.js");
const {
  SESSION_COOKIE_NAME,
  buildSessionCookie,
  clearSessionCookie,
  parseCookies,
  signSession,
  verifySession,
} = require("./forms/session.logic.js");
const {
  ACTIONS,
  actorLabel,
  assertDocumentAccess,
  assertPermission,
} = require("./forms/authorization.logic.js");
const { createInventoryDataAdapter } = require("./forms/local-data.adapter.js");
const { createDocumentDataAdapter } = require("./forms/document-data.adapter.js");
const { createCloudDocumentReader } = require("./forms/cloud-document-read.logic.js");
const { createFileAdapter } = require("./forms/storage-file.adapter.js");
const { validateStockSkuReferences } = require("./forms/stock-line.logic.js");
const {
  assertCloudRuntimeConfig,
  buildCloudRuntimeEnv,
  healthPayload,
  isCloudRunEnvironment,
  resolveListenHost,
  resolveRuntimeRoot,
} = require("./forms/cloud-run.logic.js");
const { createDocumentFileSynchronizer } = require("./forms/supabase-document-files.logic.js");
const { mapCloudVendors } = require("./forms/cloud-vendor-read.logic.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = __dirname;
const runtimeEnv = buildCloudRuntimeEnv(process.env);
assertCloudRuntimeConfig(runtimeEnv);
const cloudRun = isCloudRunEnvironment(runtimeEnv);
const rootDir = resolveRuntimeRoot({ env: runtimeEnv, appDir });
const formsDir = path.join(appDir, "forms");
const port = Number(runtimeEnv.PORT || 8787);
// Security: bind loopback-only by default. There is no authentication
// anywhere in this app, so binding every interface (the previous behaviour)
// let anyone on the same network -- office wifi, cafe wifi -- open the
// accounting app and read, edit, or delete documents. Set
// SWEET_HOUSE_ALLOW_NETWORK=1 to opt in when the owner deliberately wants to
// reach the app from another device (phone, tablet) on their own network.
const allowNetwork = /^(1|true|yes)$/i.test(String(runtimeEnv.SWEET_HOUSE_ALLOW_NETWORK || "").trim());
const listenHost = resolveListenHost(runtimeEnv);
const maxBodyBytes = 80 * 1024 * 1024;
const authMode = String(runtimeEnv.SWEET_HOUSE_AUTH_MODE || "disabled").trim().toLowerCase();
const sessionSecret = String(runtimeEnv.SWEET_HOUSE_SESSION_SECRET || "");
const sessionTtlSeconds = Math.max(300, Number(runtimeEnv.SWEET_HOUSE_SESSION_TTL_SECONDS || 43200));
const cookieSecure = /^(1|true|yes)$/i.test(String(runtimeEnv.SWEET_HOUSE_COOKIE_SECURE || ""))
  || String(runtimeEnv.NODE_ENV || "").toLowerCase() === "production";
const appPublicOrigin = String(runtimeEnv.APP_PUBLIC_ORIGIN || "").trim().replace(/\/$/, "");
const googleOAuthRedirectUri = String(runtimeEnv.GOOGLE_OAUTH_REDIRECT_URI || "").trim();
const lineChannelSecret = String(runtimeEnv.LINE_CHANNEL_SECRET || "");
const lineChannelAccessToken = String(runtimeEnv.LINE_CHANNEL_ACCESS_TOKEN || "");
const lineIntakeMaxBytes = Math.max(1024 * 1024, Number(runtimeEnv.LINE_INTAKE_MAX_BYTES || 20 * 1024 * 1024));
const lineMiniAppUrl = String(runtimeEnv.LINE_INTAKE_MINI_APP_URL || (runtimeEnv.APP_PUBLIC_ORIGIN ? `${String(runtimeEnv.APP_PUBLIC_ORIGIN).replace(/\/$/, "")}/line-intake` : "")).trim();
const lineOcrProvider = String(runtimeEnv.LINE_OCR_PROVIDER || "manual").trim().toLowerCase();
const lineOcrEndpoint = String(runtimeEnv.LINE_OCR_API_URL || "").trim();
const lineOcrApiKey = String(runtimeEnv.LINE_OCR_API_KEY || "").trim();
const lineIntakeStore = createConfiguredLineIntakeStore({ rootDir, env: runtimeEnv, maxBytes: lineIntakeMaxBytes });
const inventoryDataAdapter = createInventoryDataAdapter({
  rootDir,
  env: runtimeEnv,
  logger: event => console.warn(`[data-adapter] ${JSON.stringify(event)}`),
});
const documentFileSynchronizer = cloudRun
  ? createDocumentFileSynchronizer({
    rootDir,
    client: createSupabaseAdminClient({ url: runtimeEnv.SUPABASE_URL, serviceRoleKey: runtimeEnv.SUPABASE_SERVICE_ROLE_KEY }),
    storageClient: createSupabaseStorageClient({ url: runtimeEnv.SUPABASE_URL, serviceRoleKey: runtimeEnv.SUPABASE_SERVICE_ROLE_KEY, bucket: runtimeEnv.SUPABASE_STORAGE_BUCKET }),
  })
  : null;
const documentDataAdapter = createDocumentDataAdapter({
  env: runtimeEnv,
  persistFiles: documentFileSynchronizer
    ? ({ documentKind, documentNo, folderPath }) => documentFileSynchronizer.sync({ documentKind, documentNo, folderPath })
    : undefined,
  logger: event => console.warn(`[data-adapter] ${JSON.stringify(event)}`),
});
const cloudDocumentReader = createCloudDocumentReader({
  cloudRun,
  documentDataAdapter,
  documentFileSynchronizer,
  rebuildIndex: () => rebuildDocumentIndex(rootDir),
});
const cloudVendorRepository = cloudRun
  ? createSupabaseDataRepository({
    client: createSupabaseAdminClient({ url: runtimeEnv.SUPABASE_URL, serviceRoleKey: runtimeEnv.SUPABASE_SERVICE_ROLE_KEY }),
  })
  : null;
const vendorResolver = cloudVendorRepository
  ? async vendorId => mapCloudVendors(
    await cloudVendorRepository.listVendors(""),
    { includeInactive: true },
  ).find(vendor => vendor.id === String(vendorId || "").trim()) || null
  : undefined;
const documentFileAdapter = createFileAdapter({
  rootDir,
  env: runtimeEnv,
  logger: event => console.warn(`[data-adapter] ${JSON.stringify(event)}`),
});

async function assertKnownStockSkuReferences(lines = []) {
  const selectedLines = (Array.isArray(lines) ? lines : []).filter((line) => String(line?.stockSkuId ?? "").trim());
  if (!selectedLines.length) return;
  const stockSkus = await inventoryDataAdapter.read("listStockSkus", { search: "" });
  const errors = validateStockSkuReferences(lines, stockSkus);
  if (errors.length) throw new Error(errors.join(", "));
}

async function resolveDocumentFileReference({ documentKind, documentNo, section, fileName, localResolve }) {
  try {
    return await localResolve();
  } catch (error) {
    if (!cloudRun) throw error;
    const cloudRecord = await documentDataAdapter.get({
      localResult: null,
      documentKind,
      documentNo,
    });
    const folderPath = String(cloudRecord?.folderPath || "");
    if (!folderPath.startsWith("documents/") || !["pdf", "raw"].includes(section)
      || !fileName || fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") {
      throw error;
    }
    const baseDir = path.resolve(rootDir, folderPath, section);
    const absolutePath = path.resolve(baseDir, fileName);
    if (!absolutePath.startsWith(`${baseDir}${path.sep}`)) throw error;
    return { absolutePath, fileName, section };
  }
}

async function ensureLocalCloudDocument({ documentKind, documentNo, localLoad }) {
  return cloudDocumentReader.ensure({ documentKind, documentNo, localLoad });
}

async function ensureLocalCloudWorkflowTransaction(transactionNo) {
  const localRecord = await getWorkflowTransaction(rootDir, transactionNo);
  if (!cloudRun || !documentFileSynchronizer) return localRecord;

  if (!localRecord) {
    const cloudRecord = await documentDataAdapter.get({
      localResult: null,
      documentKind: "workflow_transaction",
      documentNo: transactionNo,
    });
    if (!cloudRecord) return null;
    await documentFileSynchronizer.materialize({ record: cloudRecord });
  }

  // Cloud Run starts with an empty ephemeral filesystem. A transaction row
  // alone is not enough for its detail page: the child documents that make
  // up the progress checklist are separate cloud rows and must be
  // materialized too before the existing filesystem-oriented workflow logic
  // scans for them.
  const cloudDocuments = await documentDataAdapter.list({
    localResult: [],
    filters: {
      documentKinds: ["expense_request", "substitute_receipt", ...LIGHTWEIGHT_DOCUMENT_KINDS],
    },
  });
  const childDocuments = cloudDocuments.filter((document) => String(
    document.transactionNo || document.payload?.transactionNo || "",
  ).trim() === String(transactionNo).trim());
  for (const document of childDocuments) {
    await documentFileSynchronizer.materialize({ record: document });
  }

  if (!localRecord || childDocuments.length > 0) await rebuildDocumentIndex(rootDir);
  return getWorkflowTransaction(rootDir, transactionNo);
}

async function persistCloudDocumentMutation({ documentKind, documentNo, result, localLoad }) {
  if (!cloudRun) return result;
  const localRecord = await localLoad();
  await documentDataAdapter.save({
    documentKind,
    documentNo,
    payload: localRecord?.payload || localRecord,
    localSave: async () => result,
  });
  return result;
}

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
  response.end(JSON.stringify(data, (key, value) => (
    key === "absolutePath" || key === "absoluteFolderPath" ? undefined : value
  )));
}

function sendAuthError(response, statusCode, code, error, { clearCookie = false } = {}) {
  if (clearCookie) response.setHeader("set-cookie", [clearSessionCookie({ secure: cookieSecure })]);
  sendJson(response, statusCode, { code, error });
}

function isPublicApiPath(pathname) {
  return pathname === "/api/healthz"
    || pathname === "/api/auth/line-session"
    || pathname === "/api/auth/me"
    || pathname === "/api/auth/logout"
    || pathname === "/api/google-drive/oauth2callback"
    || pathname === "/api/shopee/callback"
    || pathname === "/api/webhooks/line";
}

function originIsAllowed(request) {
  if (!appPublicOrigin || request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return true;
  return request.headers.origin === appPublicOrigin;
}

function readRequestSession(request) {
  if (!sessionSecret) throw Object.assign(new Error("Session configuration is missing"), { code: "SESSION_CONFIG_MISSING" });
  let cookies;
  try {
    cookies = parseCookies(request.headers.cookie || "");
  } catch {
    throw Object.assign(new Error("Session is invalid"), { code: "SESSION_INVALID" });
  }
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) throw Object.assign(new Error("Session is missing"), { code: "SESSION_MISSING" });
  return verifySession(token, sessionSecret);
}

function requireAuthenticatedRequest(request, response, url) {
  const isProtectedApiPath = url.pathname.startsWith("/api/") || url.pathname.startsWith("/workflow-documents/");
  if (authMode !== "line" || !isProtectedApiPath || isPublicApiPath(url.pathname)) return true;
  const isUnsafeMethod = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  const isProduction = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  if (!sessionSecret || (isProduction && isUnsafeMethod && !appPublicOrigin)) {
    sendAuthError(response, 503, "AUTH_CONFIG_MISSING", "ระบบยืนยันตัวตนยังไม่ได้ตั้งค่า");
    return false;
  }
  if (!originIsAllowed(request)) {
    sendAuthError(response, 403, "ORIGIN_FORBIDDEN", "คำขอมาจากแหล่งที่ไม่อนุญาต");
    return false;
  }
  try {
    request.auth = readRequestSession(request);
    return true;
  } catch (error) {
    sendAuthError(response, 401, "AUTH_REQUIRED", "กรุณาเข้าสู่ระบบผ่าน LINE", { clearCookie: error.code !== "SESSION_MISSING" });
    return false;
  }
}

function actorForRequest(request, suppliedActor) {
  return authMode === "line" ? actorLabel(request.auth) : suppliedActor;
}

function denyForbidden(response) {
  sendJson(response, 403, { code: "AUTH_FORBIDDEN", error: "ไม่มีสิทธิ์ดำเนินการ" });
  return false;
}

function ensurePermission(request, response, action) {
  if (authMode !== "line") return true;
  try {
    assertPermission(request.auth, action);
    return true;
  } catch (error) {
    if (error.code === "AUTH_FORBIDDEN") return denyForbidden(response);
    throw error;
  }
}

async function ensureDocumentAccess(request, response, { action, load }) {
  if (authMode !== "line") return true;
  let record;
  try {
    record = await load();
  } catch (error) {
    if (error.message === "Expense request not found" || error.message === "Substitute receipt not found") return true;
    sendJson(response, 404, { error: "ไม่พบเอกสาร" });
    return false;
  }
  if (!record) return true;
  try {
    assertDocumentAccess(request.auth, record.payload || record, action);
    return true;
  } catch (error) {
    if (error.code === "AUTH_FORBIDDEN") return denyForbidden(response);
    throw error;
  }
}

async function ensureDocumentWriteAccess(request, response, {
  numberField,
  payload,
  loadExisting,
  existingAction = ACTIONS.DOCUMENT_EDIT,
}) {
  if (!ensurePermission(request, response, ACTIONS.DOCUMENT_CREATE)) return false;
  if (authMode !== "line") return true;
  const documentNo = String(payload?.[numberField] ?? "").trim();
  if (!documentNo) return true;
  return ensureDocumentAccess(request, response, {
    action: existingAction,
    load: () => loadExisting(documentNo),
  });
}

async function ensureLifecycleAccess(request, response, action, load) {
  return ensureDocumentAccess(request, response, { action, load });
}

async function loadDocumentForAuthorization({ documentKind, documentNo, localLoad }) {
  let localRecord = null;
  try {
    localRecord = await localLoad();
  } catch (error) {
    if (error.message !== "Expense request not found" && error.message !== "Substitute receipt not found") throw error;
  }
  return documentDataAdapter.get({ localResult: localRecord, documentKind, documentNo });
}

async function filterOwnedDocumentList(request, records, { numberField, load }) {
  if (authMode !== "line" || request.auth?.role !== "employee") return records;
  const visible = [];
  for (const record of records) {
    const documentNo = String(record?.[numberField] || "").trim();
    if (!documentNo) continue;
    const directOwner = String(record?.ownerUserId || record?.payload?.ownerUserId || "").trim();
    if (directOwner) {
      if (directOwner === String(request.auth?.userId || "").trim()) visible.push(record);
      continue;
    }
    try {
      const full = await load(documentNo);
      if (String(full?.payload?.ownerUserId || "").trim() === String(request.auth?.userId || "").trim()) visible.push(record);
    } catch (error) {
      if (error.message !== "Expense request not found" && error.message !== "Substitute receipt not found") throw error;
    }
  }
  return visible;
}

async function bindLineOwner(request, payload, { numberField, loadExisting }) {
  if (authMode !== "line") return payload;
  const documentNo = String(payload?.[numberField] ?? "").trim();
  if (!documentNo) return { ...payload, ownerUserId: String(request.auth?.userId || "").trim() };
  const existing = await loadExisting(documentNo).catch((error) => {
    if (error.message === "Expense request not found" || error.message === "Substitute receipt not found") return null;
    throw error;
  });
  return { ...payload, ownerUserId: String(existing?.payload?.ownerUserId || "").trim() };
}

async function handleLineSession(request, response) {
  try {
    const body = await readJsonBody(request);
    const lineProfile = await verifyLineIdToken({ idToken: body.idToken || body.id_token });
    const client = createSupabaseAdminClient();
    const user = await resolveLineAppUser({ client, lineProfile });
    if (user.status !== "active" || !user.role) {
      sendAuthError(response, 403, "APP_USER_PENDING", "บัญชี LINE นี้ยังไม่ได้รับสิทธิ์ใช้งาน");
      return;
    }
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + sessionTtlSeconds;
    const token = signSession({
      userId: user.id,
      lineUserId: user.lineUserId,
      displayName: user.displayName,
      role: user.role,
      iat: issuedAt,
      exp: expiresAt,
    }, sessionSecret);
    response.setHeader("set-cookie", [buildSessionCookie(token, { secure: cookieSecure, maxAge: sessionTtlSeconds })]);
    sendJson(response, 200, { user, expiresAt });
  } catch (error) {
    if (error?.code === "APP_USER_NOT_FOUND" || error?.code === "LINE_PROFILE_INVALID") {
      sendAuthError(response, 403, "APP_USER_PENDING", "บัญชี LINE นี้ยังไม่ได้รับสิทธิ์ใช้งาน");
      return;
    }
    if (error?.code === "SUPABASE_CONFIG_MISSING" || error?.code === "SUPABASE_CONFIG_INVALID" || error?.code === "LINE_AUTH_CONFIG_MISSING" || error?.code === "LINE_AUTH_UNAVAILABLE" || error?.code === "SUPABASE_REQUEST_FAILED") {
      sendAuthError(response, 503, "AUTH_PROVIDER_UNAVAILABLE", "ระบบยืนยันตัวตนยังไม่พร้อมใช้งาน");
      return;
    }
    if (error?.code === "LINE_TOKEN_INVALID") {
      sendAuthError(response, 401, "LINE_TOKEN_INVALID", "LINE token ไม่ถูกต้องหรือหมดอายุ");
      return;
    }
    if (error?.code === "SESSION_CONFIG_MISSING") {
      sendAuthError(response, 503, "AUTH_CONFIG_MISSING", "ระบบยืนยันตัวตนยังไม่ได้ตั้งค่า");
      return;
    }
    sendAuthError(response, 400, "AUTH_REQUEST_INVALID", "ไม่สามารถเข้าสู่ระบบได้");
  }
}

function handleAuthMe(request, response) {
  if (authMode !== "line") {
    sendJson(response, 200, { authenticated: false, mode: "disabled", user: null });
    return;
  }
  try {
    const session = readRequestSession(request);
    sendJson(response, 200, { authenticated: true, mode: "line", user: session });
  } catch (error) {
    if (error?.code === "SESSION_CONFIG_MISSING") {
      sendAuthError(response, 503, "AUTH_CONFIG_MISSING", "ระบบยืนยันตัวตนยังไม่ได้ตั้งค่า");
      return;
    }
    sendAuthError(response, 401, "AUTH_REQUIRED", "กรุณาเข้าสู่ระบบผ่าน LINE", { clearCookie: error.code !== "SESSION_MISSING" });
  }
}

function handleAuthLogout(response) {
  response.setHeader("set-cookie", [clearSessionCookie({ secure: cookieSecure })]);
  sendJson(response, 200, { ok: true });
}

function sendOperationError(response, error, fallback) {
  sendJson(response, error.statusCode || (error.code === "LEGACY_DRAFT_READ_ONLY" || error.code === "DOCUMENT_NOT_DRAFT" ? 409 : 400), {
    ...(error.code ? { code: error.code } : {}),
    error: error.code === "LEGACY_DRAFT_READ_ONLY" ? "แบบร่างเก่านี้เปิดอ่านได้อย่างเดียว" : (error.message || fallback),
  });
}

function sendWorkflowMutationError(response, error, fallback, defaultStatus = 400) {
  const barrier = new Set(["WORKFLOW_CANCELLATION_IN_PROGRESS", "WORKFLOW_CANCELLED"]);
  const status = barrier.has(error?.code) ? 409 : (Number.isInteger(error?.statusCode) ? error.statusCode : defaultStatus);
  sendJson(response, status, { ...(error?.code ? { code: error.code } : {}), error: error?.message || fallback });
}

function safeStaticPath(urlPath) {
  const routeMap = {
    "/": "/index.html",
    "/line-auth": "/line-auth.html",
    "/line-auth/": "/line-auth.html",
    "/line-intake/auth": "/line-auth.html",
    "/line-intake/auth/": "/line-auth.html",
    "/line-intake": "/line-intake.html",
    "/line-intake/": "/line-intake.html",
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
    "/shopee": "/shopee-connection.html",
    "/shopee/": "/shopee-connection.html",
    "/shopee-connection": "/shopee-connection.html",
    "/shopee-connection/": "/shopee-connection.html",
    "/shopee-orders": "/shopee-orders.html",
    "/shopee-orders/": "/shopee-orders.html",
    "/shopee-mapping": "/shopee-mapping.html",
    "/shopee-mapping/": "/shopee-mapping.html",
    "/shopee-shipment": "/shopee-shipment.html",
    "/shopee-shipment/": "/shopee-shipment.html",
  };
  const requestedPath = routeMap[urlPath] || urlPath;
  const normalized = path.normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(formsDir, normalized);
  if (!absolutePath.startsWith(formsDir)) return null;
  return absolutePath;
}

function escapeHtmlAttribute(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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

function publicLineIntakeView(item) {
  if (!item) return null;
  const { storagePath, storageBucket, objectPath, ...safeItem } = item;
  return safeItem;
}

const lineIntakeOcrInFlight = new Map();

async function ensureLineIntakeScanned(item) {
  if (item.ocrStatus === "needs_review") return item;
  const existing = lineIntakeOcrInFlight.get(item.id);
  if (existing) return existing;
  const run = (async () => {
    try {
      const original = await lineIntakeStore.readOriginal(item);
      const result = await scanLineDocument({
        provider: lineOcrProvider,
        endpoint: lineOcrEndpoint,
        apiKey: lineOcrApiKey,
        bytes: original.bytes,
        contentType: original.contentType,
        fileName: original.fileName,
        maxBytes: lineIntakeMaxBytes,
      });
      return lineIntakeStore.updateScan(item.id, result);
    } catch (error) {
      return lineIntakeStore.updateScan(item.id, {
        provider: lineOcrProvider,
        status: "failed",
        confidence: 0,
        fields: {},
        warnings: [],
        error: error.code || "LINE_OCR_FAILED",
      });
    }
  })();
  lineIntakeOcrInFlight.set(item.id, run);
  try { return await run; } finally { lineIntakeOcrInFlight.delete(item.id); }
}

function firstText(...values) {
  return values.map(value => String(value ?? "").trim()).find(Boolean) || "";
}

function buildLineExpensePayload(request, item, body = {}) {
  const fields = item.extractedPayload?.fields && typeof item.extractedPayload.fields === "object" ? item.extractedPayload.fields : {};
  const lines = Array.isArray(body.expenseLines) && body.expenseLines.length
    ? body.expenseLines.slice(0, 50).map(line => ({
      date: firstText(line.date, body.expenseDate, fields.expenseDate),
      category: firstText(line.category, "ทั่วไป"),
      description: firstText(line.description, fields.description),
      vendor: firstText(line.vendor, body.paymentTargetName, fields.vendorName),
      amountBeforeVat: firstText(line.amountBeforeVat, fields.amountBeforeVat),
      vatAmount: firstText(line.vatAmount, fields.vatAmount),
      withholdingTax: firstText(line.withholdingTax, fields.withholdingTax, "0"),
    }))
    : [{
      date: firstText(body.expenseDate, fields.expenseDate),
      category: firstText(body.category, "ทั่วไป"),
      description: firstText(body.description, fields.description),
      vendor: firstText(body.paymentTargetName, fields.vendorName),
      amountBeforeVat: firstText(body.amountBeforeVat, fields.amountBeforeVat),
      vatAmount: firstText(body.vatAmount, fields.vatAmount),
      withholdingTax: firstText(body.withholdingTax, fields.withholdingTax, "0"),
    }];
  const payload = {
    accountingMonth: firstText(body.accountingMonth, fields.accountingMonth),
    expenseDate: firstText(body.expenseDate, fields.expenseDate),
    requesterName: firstText(body.requesterName, request.auth?.displayName),
    requesterRole: String(body.requesterRole || "").trim(),
    requestType: ["reimbursement", "direct_payment"].includes(body.requestType) ? body.requestType : "reimbursement",
    requestTitle: firstText(body.requestTitle, fields.documentNo, fields.description, "ค่าใช้จ่ายจาก LINE"),
    businessPurpose: firstText(body.businessPurpose, fields.description),
    paymentTargetName: firstText(body.paymentTargetName, fields.vendorName),
    vendorSnapshot: { name: firstText(body.paymentTargetName, fields.vendorName), taxId: firstText(body.taxId, fields.taxId) },
    ownerUserId: authMode === "line" ? String(request.auth?.userId || "") : "",
    expenseLines: lines,
  };
  return payload;
}

function lineDocumentSummary(result = {}) {
  return {
    requestNo: result.requestNo || "",
    status: result.status || "draft",
    statusLabel: result.statusLabel || "แบบร่าง",
    folderPath: result.folderPath || "",
    evidenceFiles: result.evidenceFiles || {},
    rawFiles: result.rawFiles || [],
    updatedAt: result.updatedAt || "",
  };
}

async function handleLineWebhook(request, response) {
  const rawBody = (await readRequestBody(request)).toString("utf8");
  const signature = request.headers["x-line-signature"];
  if (!lineChannelSecret) {
    sendJson(response, 503, { code: "LINE_WEBHOOK_CONFIG_MISSING", error: "ระบบ webhook ยังไม่ได้ตั้งค่า channel secret" });
    return;
  }
  if (!verifyLineWebhookSignature({ rawBody, channelSecret: lineChannelSecret, signature })) {
    sendJson(response, 401, { code: "LINE_WEBHOOK_SIGNATURE_INVALID", error: "ลายเซ็น webhook ไม่ถูกต้อง" });
    return;
  }

  let payload;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    sendJson(response, 400, { code: "LINE_WEBHOOK_INVALID_JSON", error: "ข้อมูล webhook ไม่ถูกต้อง" });
    return;
  }

  const accepted = [];
  const skipped = [];
  for (const event of Array.isArray(payload.events) ? payload.events : []) {
    const media = extractLineMediaEvent(event);
    if (!media) continue;
    try {
      const content = await downloadLineContent({
        messageId: media.messageId,
        accessToken: lineChannelAccessToken,
        maxBytes: lineIntakeMaxBytes,
      });
      const normalized = { ...media, contentType: content.contentType };
      if (!isSupportedLineMedia(normalized)) {
        skipped.push({ eventId: media.eventId, code: "LINE_MEDIA_UNSUPPORTED" });
        continue;
      }
      const stored = await lineIntakeStore.create({
        ...normalized,
        bytes: content.bytes,
      });
      accepted.push({ eventId: media.eventId, intakeId: stored.item.id, duplicate: !stored.created });
      if (stored.created && media.replyToken && lineMiniAppUrl && lineChannelAccessToken) {
        const reply = buildIntakeReviewReply({ replyToken: media.replyToken, intake: stored.item, miniAppUrl: lineMiniAppUrl });
        try {
          await replyToLine({ replyToken: reply.replyToken, messages: reply.messages, accessToken: lineChannelAccessToken });
        } catch (error) {
          console.warn(`[line-webhook] reply failed code=${error.code || "LINE_REPLY_FAILED"} intakeId=${stored.item.id}`);
        }
      }
    } catch (error) {
      skipped.push({ eventId: media.eventId, code: error.code || "LINE_WEBHOOK_PROCESSING_FAILED" });
    }
  }
  sendJson(response, 200, { ok: true, accepted, skipped });
}

async function handleLineIntakeReview(request, response, intakeId) {
  try {
    const lineUserId = authMode === "line" ? String(request.auth?.lineUserId || "") : "";
    const item = await lineIntakeStore.getForUser(intakeId, lineUserId);
    const scanned = await ensureLineIntakeScanned(item);
    sendJson(response, 200, { intake: publicLineIntakeView(scanned) });
  } catch (error) {
    sendOperationError(response, error, "ไม่สามารถอ่านรายการไฟล์จาก LINE ได้");
  }
}

async function handleLineIntakeConfirm(request, response, intakeId) {
  try {
    const lineUserId = authMode === "line" ? String(request.auth?.lineUserId || "") : "";
    const item = await lineIntakeStore.getForUser(intakeId, lineUserId);
    if (item.status === "confirmed" && item.createdDocument) {
      sendJson(response, 200, { intake: publicLineIntakeView(item), document: item.createdDocument, idempotent: true });
      return;
    }
    if (item.status !== "needs_confirmation") {
      sendJson(response, 409, { code: "LINE_INTAKE_NOT_CONFIRMABLE", error: "รายการนี้ไม่อยู่ในสถานะรอยืนยัน" });
      return;
    }
    const body = await readJsonBody(request);
    const scanned = await ensureLineIntakeScanned(item);
    const payload = buildLineExpensePayload(request, scanned, body);
    await assertKnownStockSkuReferences(payload.expenseLines);
    const errors = validateExpenseRequest(payload);
    if (errors.length) {
      sendJson(response, 400, { code: "LINE_INTAKE_CONFIRMATION_INVALID", error: errors.join(", "), errors });
      return;
    }
    if (!await ensureDocumentWriteAccess(request, response, {
      numberField: "requestNo",
      payload,
      loadExisting: requestNo => getSubmittedExpenseRequest(rootDir, requestNo),
    })) return;
    const original = await lineIntakeStore.readOriginal(scanned);
    const result = await documentDataAdapter.save({
      documentKind: "expense_request",
      documentNo: "",
      payload,
      localSave: () => saveExpenseDraft({
        rootDir,
        payload,
        uploads: [{ evidenceKey: "receipt", originalName: original.fileName, type: original.contentType, buffer: original.bytes }],
        vendorResolver,
      }),
    });
    const document = lineDocumentSummary(result);
    const confirmed = await lineIntakeStore.transition(intakeId, "confirmed", {
      lineUserId,
      metadata: { createdDocument: document, createdDocumentNo: document.requestNo },
    });
    sendJson(response, 200, { intake: publicLineIntakeView(confirmed), document, idempotent: false });
  } catch (error) {
    sendOperationError(response, error, "ไม่สามารถสร้างแบบร่างจากไฟล์ LINE ได้");
  }
}

async function handleLineIntakeCancel(request, response, intakeId) {
  try {
    const lineUserId = authMode === "line" ? String(request.auth?.lineUserId || "") : "";
    const item = await lineIntakeStore.transition(intakeId, "cancelled", { lineUserId });
    sendJson(response, 200, { intake: publicLineIntakeView(item) });
  } catch (error) {
    sendOperationError(response, error, "ไม่สามารถยกเลิกรายการไฟล์จาก LINE ได้");
  }
}

function getOAuthRedirectUri(request) {
  return resolveGoogleOAuthRedirectUri({
    configuredRedirectUri: googleOAuthRedirectUri,
    publicDeployment: cloudRun || String(runtimeEnv.NODE_ENV || "").toLowerCase() === "production",
    requestHost: request.headers.host,
    port,
  });
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

function parseLegacyDraftFileRoute(urlPath, prefix) {
  if (!urlPath.startsWith(prefix)) return null;
  const segments = urlPath.slice(prefix.length).split("/");
  if (segments.length !== 4 || segments[1] !== "files" || segments[2] !== "raw" || !segments[0] || !segments[3]) return null;
  return { draftId: decodeURIComponent(segments[0]), section: segments[2], fileName: decodeURIComponent(segments[3]) };
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
    const payload = await bindLineOwner(request, JSON.parse(fields.payload || "{}"), {
      numberField: "requestNo",
      loadExisting: (requestNo) => getSubmittedExpenseRequest(rootDir, requestNo),
    });
    await assertKnownStockSkuReferences(payload.expenseLines);
    if (!await ensureDocumentWriteAccess(request, response, {
      numberField: "requestNo",
      payload,
      loadExisting: (requestNo) => getSubmittedExpenseRequest(rootDir, requestNo),
      existingAction: ACTIONS.DOCUMENT_SUBMIT,
    })) return;
    const result = await documentDataAdapter.save({
      documentKind: "expense_request",
      documentNo: payload.requestNo,
      payload,
      localSave: () => saveExpenseSubmission({
        rootDir,
        payload,
        uploads: files,
        vendorResolver,
      }),
    });

    sendJson(response, 200, result);
  } catch (error) {
    sendOperationError(response, error, "Cannot save expense request");
  }
}

async function handleSubstituteReceiptSubmission(request, response) {
  try {
    const body = await readRequestBody(request);
    const { fields, files } = parseMultipartForm(body, request.headers["content-type"]);
    const payload = await bindLineOwner(request, JSON.parse(fields.payload || "{}"), {
      numberField: "receiptNo",
      loadExisting: (receiptNo) => getSubmittedSubstituteReceipt(rootDir, receiptNo),
    });
    await assertKnownStockSkuReferences(payload.lines);
    if (!await ensureDocumentWriteAccess(request, response, {
      numberField: "receiptNo",
      payload,
      loadExisting: (receiptNo) => getSubmittedSubstituteReceipt(rootDir, receiptNo),
      existingAction: ACTIONS.DOCUMENT_SUBMIT,
    })) return;
    const result = await documentDataAdapter.save({
      documentKind: "substitute_receipt",
      documentNo: payload.receiptNo,
      payload,
      localSave: () => saveSubstituteReceiptSubmission({
        rootDir,
        payload,
        uploads: files,
        vendorResolver,
      }),
    });

    sendJson(response, 200, result);
  } catch (error) {
    sendOperationError(response, error, "Cannot save substitute receipt");
  }
}

async function handleSubstituteReceiptDraftSave(request, response) {
  try {
    const body = await readRequestBody(request);
    const { fields, files } = parseMultipartForm(body, request.headers["content-type"]);
    const payload = await bindLineOwner(request, JSON.parse(fields.payload || "{}"), {
      numberField: "receiptNo",
      loadExisting: (receiptNo) => getSubmittedSubstituteReceipt(rootDir, receiptNo),
    });
    await assertKnownStockSkuReferences(payload.lines);
    if (!await ensureDocumentWriteAccess(request, response, {
      numberField: "receiptNo",
      payload,
      loadExisting: (receiptNo) => getSubmittedSubstituteReceipt(rootDir, receiptNo),
    })) return;
    const result = await documentDataAdapter.save({
      documentKind: "substitute_receipt",
      documentNo: payload.receiptNo,
      payload,
      localSave: () => saveSubstituteReceiptDraft({
        rootDir,
        payload,
        uploads: files,
        vendorResolver,
      }),
    });

    sendJson(response, 200, result);
  } catch (error) {
    sendOperationError(response, error, "Cannot save substitute receipt draft");
  }
}

async function handleSubstituteReceiptApprove(receiptNo, request, response) {
  try {
    const payload = await readJsonBody(request);
    await ensureLocalCloudDocument({
      documentKind: "substitute_receipt",
      documentNo: receiptNo,
      localLoad: () => getSubmittedSubstituteReceipt(rootDir, receiptNo),
    });
    const result = await approveSubstituteReceipt({
      rootDir,
      receiptNo,
      approvedBy: actorForRequest(request, payload.approvedBy),
    });
    await persistCloudDocumentMutation({
      documentKind: "substitute_receipt",
      documentNo: receiptNo,
      result,
      localLoad: () => getSubmittedSubstituteReceipt(rootDir, receiptNo),
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendWorkflowMutationError(response, error, "Cannot approve substitute receipt");
  }
}

async function handleExpenseRequestApprove(requestNo, request, response) {
  try {
    const payload = await readJsonBody(request);
    await ensureLocalCloudDocument({
      documentKind: "expense_request",
      documentNo: requestNo,
      localLoad: () => getSubmittedExpenseRequest(rootDir, requestNo),
    });
    const result = await approveExpenseRequest({
      rootDir,
      requestNo,
      approvedBy: actorForRequest(request, payload.approvedBy),
    });
    await persistCloudDocumentMutation({
      documentKind: "expense_request",
      documentNo: requestNo,
      result,
      localLoad: () => getSubmittedExpenseRequest(rootDir, requestNo),
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendWorkflowMutationError(response, error, "Cannot approve expense request");
  }
}

async function handleSubstituteReceiptReject(receiptNo, request, response) {
  try {
    const payload = await readJsonBody(request);
    await ensureLocalCloudDocument({
      documentKind: "substitute_receipt",
      documentNo: receiptNo,
      localLoad: () => getSubmittedSubstituteReceipt(rootDir, receiptNo),
    });
    const result = await rejectSubstituteReceipt({
      rootDir,
      receiptNo,
      rejectedBy: actorForRequest(request, payload.rejectedBy),
      reason: payload.reason,
    });
    await persistCloudDocumentMutation({
      documentKind: "substitute_receipt",
      documentNo: receiptNo,
      result,
      localLoad: () => getSubmittedSubstituteReceipt(rootDir, receiptNo),
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendWorkflowMutationError(response, error, "Cannot reject substitute receipt");
  }
}

async function handleExpenseRequestReject(requestNo, request, response) {
  try {
    const payload = await readJsonBody(request);
    await ensureLocalCloudDocument({
      documentKind: "expense_request",
      documentNo: requestNo,
      localLoad: () => getSubmittedExpenseRequest(rootDir, requestNo),
    });
    const result = await rejectExpenseRequest({
      rootDir,
      requestNo,
      rejectedBy: actorForRequest(request, payload.rejectedBy),
      reason: payload.reason,
    });
    await persistCloudDocumentMutation({
      documentKind: "expense_request",
      documentNo: requestNo,
      result,
      localLoad: () => getSubmittedExpenseRequest(rootDir, requestNo),
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendWorkflowMutationError(response, error, "Cannot reject expense request");
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
    await ensureLocalCloudDocument({
      documentKind: "expense_request",
      documentNo: requestNo,
      localLoad: () => getSubmittedExpenseRequest(rootDir, requestNo),
    });
    const result = await completeExpenseRequest({
      rootDir,
      requestNo,
      completedBy: actorForRequest(request, payload.completedBy),
    });
    await persistCloudDocumentMutation({
      documentKind: "expense_request",
      documentNo: requestNo,
      result,
      localLoad: () => getSubmittedExpenseRequest(rootDir, requestNo),
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendWorkflowMutationError(response, error, "Cannot complete expense request");
  }
}

// Approval and stock receiving remain native substitute_receipt transitions,
// but only this explicit completion route reaches native "completed" and
// unlocks the next workflow step under owner decision O7.
async function handleSubstituteReceiptComplete(receiptNo, request, response) {
  try {
    const payload = await readJsonBody(request);
    await ensureLocalCloudDocument({
      documentKind: "substitute_receipt",
      documentNo: receiptNo,
      localLoad: () => getSubmittedSubstituteReceipt(rootDir, receiptNo),
    });
    const result = await completeSubstituteReceipt({
      rootDir,
      receiptNo,
      completedBy: actorForRequest(request, payload.completedBy),
    });
    await persistCloudDocumentMutation({
      documentKind: "substitute_receipt",
      documentNo: receiptNo,
      result,
      localLoad: () => getSubmittedSubstituteReceipt(rootDir, receiptNo),
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendWorkflowMutationError(response, error, "Cannot complete substitute receipt");
  }
}

async function handleSubstituteReceiptReceiveStock(receiptNo, request, response) {
  try {
    const payload = await readJsonBody(request);
    await ensureLocalCloudDocument({
      documentKind: "substitute_receipt",
      documentNo: receiptNo,
      localLoad: () => getSubmittedSubstituteReceipt(rootDir, receiptNo),
    });
    const result = await receiveSubstituteReceiptStock({
      rootDir,
      receiptNo,
      receivedDate: payload.receivedDate,
      receivedBy: actorForRequest(request, payload.receivedBy),
    });
    await persistCloudDocumentMutation({
      documentKind: "substitute_receipt",
      documentNo: receiptNo,
      result,
      localLoad: () => getSubmittedSubstituteReceipt(rootDir, receiptNo),
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendWorkflowMutationError(response, error, "Cannot receive substitute receipt stock");
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
    sendWorkflowMutationError(response, error, "Cannot sync expense request to Google Drive");
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
    sendWorkflowMutationError(response, error, "Cannot sync substitute receipt to Google Drive");
  }
}

async function handleExpenseRequestFile(fileRoute, response) {
  try {
    const file = await resolveDocumentFileReference({
      documentKind: "expense_request",
      documentNo: fileRoute.requestNo,
      section: fileRoute.section,
      fileName: fileRoute.fileName,
      localResolve: () => getExpenseRequestFile({
        rootDir,
        requestNo: fileRoute.requestNo,
        section: fileRoute.section,
        fileName: fileRoute.fileName,
      }),
    });
    const served = await documentFileAdapter.read({ file, localRead: () => readFile(file.absolutePath) });
    const body = Buffer.isBuffer(served) ? served : served.body;
    const contentType = (Buffer.isBuffer(served) ? "" : served.contentType) || mimeTypes[path.extname(file.absolutePath).toLowerCase()] || "application/octet-stream";
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
    const file = await resolveDocumentFileReference({
      documentKind: "substitute_receipt",
      documentNo: fileRoute.receiptNo,
      section: fileRoute.section,
      fileName: fileRoute.fileName,
      localResolve: () => getSubstituteReceiptFile({
        rootDir,
        receiptNo: fileRoute.receiptNo,
        section: fileRoute.section,
        fileName: fileRoute.fileName,
      }),
    });
    const served = await documentFileAdapter.read({ file, localRead: () => readFile(file.absolutePath) });
    const body = Buffer.isBuffer(served) ? served : served.body;
    const contentType = (Buffer.isBuffer(served) ? "" : served.contentType) || mimeTypes[path.extname(file.absolutePath).toLowerCase()] || "application/octet-stream";
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
    if (fileRoute.section === "pdf") {
      await refreshWorkflowDocumentCompanySettings({
        rootDir,
        documentKind: fileRoute.documentKind,
        documentNo: fileRoute.documentNo,
      });
    }
    const file = await resolveDocumentFileReference({
      documentKind: fileRoute.documentKind,
      documentNo: fileRoute.documentNo,
      section: fileRoute.section,
      fileName: fileRoute.fileName,
      localResolve: () => getWorkflowDocumentFile({
        rootDir,
        documentKind: fileRoute.documentKind,
        documentNo: fileRoute.documentNo,
        section: fileRoute.section,
        fileName: fileRoute.fileName,
      }),
    });
    const served = await documentFileAdapter.read({ file, localRead: () => readFile(file.absolutePath) });
    const body = Buffer.isBuffer(served) ? served : served.body;
    const contentType = (Buffer.isBuffer(served) ? "" : served.contentType) || mimeTypes[path.extname(file.absolutePath).toLowerCase()] || "application/octet-stream";
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
    await assertKnownStockSkuReferences(data.lines);
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

    if (existingDocument) {
      if (!await ensureDocumentAccess(request, response, {
        action: ACTIONS.DOCUMENT_EDIT,
        load: async () => existingDocument,
      })) return;
    } else if (!ensurePermission(request, response, ACTIONS.DOCUMENT_CREATE)) {
      return;
    }

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
        submittedAt: existingDocument.payload?.submittedAt ?? "",
        submittedBy: existingDocument.payload?.submittedBy ?? "",
        approvedAt: existingDocument.payload?.approvedAt ?? "",
        approvedBy: existingDocument.payload?.approvedBy ?? "",
        completedAt: existingDocument.payload?.completedAt ?? "",
        completedBy: existingDocument.payload?.completedBy ?? "",
        ownerUserId: existingDocument.payload?.ownerUserId ?? "",
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
        submittedAt: "",
        submittedBy: "",
        approvedAt: "",
        approvedBy: "",
        completedAt: "",
        completedBy: "",
        ownerUserId: String(request.auth?.userId || "").trim(),
        createdAt: "",
      };
    }

    // Company identity is server-owned. Always take it from the current
    // company settings so every regenerated lightweight-document PDF carries
    // the configured legal name and tax ID, including edits to an existing
    // draft. Never trust a client-supplied company object for this header.
    const company = await getCompanySettings(rootDir);
    const payload = buildWorkflowDocumentPayload({ ...data, company, ...serverOwnedFields });
    const result = await documentDataAdapter.save({
      documentKind: payload.documentKind,
      documentNo: payload.documentNo,
      payload,
      localSave: () => saveWorkflowDocument({ rootDir, payload, uploads: files, vendorResolver }),
    });

    sendJson(response, 200, omitAbsoluteFolderPath(result));
  } catch (error) {
    sendWorkflowMutationError(response, error, "ไม่สามารถบันทึกเอกสารได้");
  }
}

async function handleWorkflowDocumentComplete(documentKind, documentNo, request, response) {
  try {
    const body = await readJsonBody(request);
    await ensureLocalCloudDocument({
      documentKind,
      documentNo,
      localLoad: () => getWorkflowDocument(rootDir, documentKind, documentNo),
    });
    const result = await completeWorkflowDocument({
      rootDir,
      documentKind,
      documentNo,
      completedBy: actorForRequest(request, body.completedBy),
    });
    await persistCloudDocumentMutation({
      documentKind,
      documentNo,
      result,
      localLoad: () => getWorkflowDocument(rootDir, documentKind, documentNo),
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendWorkflowMutationError(response, error, "Cannot complete workflow document");
  }
}

async function handleWorkflowDocumentAction(action, documentKind, documentNo, request, response) {
  try {
    const body = await readJsonBody(request);
    await ensureLocalCloudDocument({
      documentKind,
      documentNo,
      localLoad: () => getWorkflowDocument(rootDir, documentKind, documentNo),
    });
    const actions = {
      submit: () => submitWorkflowDocument({ rootDir, documentKind, documentNo, submittedBy: actorForRequest(request, body.submittedBy) }),
      approve: () => approveWorkflowDocument({ rootDir, documentKind, documentNo, approvedBy: actorForRequest(request, body.approvedBy) }),
      reject: () => rejectWorkflowDocument({ rootDir, documentKind, documentNo, rejectedBy: actorForRequest(request, body.rejectedBy), reason: body.reason }),
    };
    const result = await actions[action]();
    await persistCloudDocumentMutation({
      documentKind,
      documentNo,
      result,
      localLoad: () => getWorkflowDocument(rootDir, documentKind, documentNo),
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendWorkflowMutationError(response, error, "ไม่สามารถเปลี่ยนสถานะเอกสารได้");
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
async function handleWorkflowDocumentList(request, url, response) {
  try {
    const filters = parseWorkflowDocumentListFilters(url.searchParams);
    const localDocuments = await listWorkflowDocumentSummaries(rootDir, filters);
    const cloudFilters = {
      ...filters,
      ...(filters.documentKind ? {} : { documentKinds: LIGHTWEIGHT_DOCUMENT_KINDS }),
    };
    const documents = await documentDataAdapter.list({
      localResult: localDocuments,
      documentKind: filters.documentKind || undefined,
      filters: cloudFilters,
    });
    const visible = authMode === "line" && request.auth?.role === "employee"
      ? documents.filter((document) => String(document.payload?.ownerUserId || "").trim() === String(request.auth?.userId || "").trim())
      : documents;
    sendJson(response, 200, { documents: visible.map(omitAbsoluteFolderPath) });
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "ไม่สามารถแสดงรายการเอกสารได้",
    });
  }
}

async function handleWorkflowDocumentGet(documentKind, documentNo, response) {
  try {
    const localRecord = await ensureLocalCloudDocument({
      documentKind,
      documentNo,
      localLoad: () => getWorkflowDocument(rootDir, documentKind, documentNo),
    });
    const record = await documentDataAdapter.get({ localResult: localRecord, documentKind, documentNo });
    if (!record) throw new Error("ไม่พบเอกสาร");
    const files = localRecord
      ? await getWorkflowDocumentFiles(rootDir, documentKind, documentNo)
      : null;
    sendJson(response, 200, omitAbsoluteFolderPath({
      ...record,
      ...(files ? {
        pdfFiles: files.pdfFiles.map(omitAbsolutePathFromFileEntry),
        rawFiles: files.rawFiles.map(omitAbsolutePathFromFileEntry),
      } : {}),
    }));
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
    const localResult = await listWorkflowTransactions(rootDir);
    const result = await documentDataAdapter.list({ localResult, documentKind: "workflow_transaction" });
    sendJson(response, 200, {
      transactions: result.map(transaction => ({
        ...transaction,
        transactionNo: transaction.transactionNo || transaction.documentNo,
      })),
    });
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
    await ensureLocalCloudWorkflowTransaction(transactionNo);
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
    await ensureLocalCloudWorkflowTransaction(transactionNo);
    const body = await readJsonBody(request);
    const regeneratePacket = body.regeneratePacket !== false;
    const result = await refreshWorkflowTransaction({ rootDir, transactionNo, regeneratePacket });
    sendJson(response, 200, omitAbsolutePathsFromWorkflowTransactionResponse(result));
  } catch (error) {
    sendWorkflowMutationError(response, error, "ไม่สามารถรีเฟรชธุรกรรมได้", 404);
  }
}

// Refuses unless every step is completed (completeWorkflowTransaction's own
// check), and auto-syncs Google Drive per the transaction's snapshotted
// syncGoogleDrive toggle. No sheetsRecorder/syncGoogleSheets anywhere here —
// there is no workflow-level Sheets sync (decision D6).
async function handleWorkflowTransactionComplete(transactionNo, request, response) {
  try {
    await ensureLocalCloudWorkflowTransaction(transactionNo);
    const body = await readJsonBody(request);
    const result = await completeWorkflowTransaction({
      rootDir,
      transactionNo,
      completedBy: actorForRequest(request, body.completedBy),
    });
    sendJson(response, 200, omitAbsolutePathsFromWorkflowTransactionResponse(result));
  } catch (error) {
    sendWorkflowMutationError(response, error, "ไม่สามารถปิดงานธุรกรรมได้");
  }
}

async function handleWorkflowTransactionCancel(transactionNo, request, response) {
  try {
    await ensureLocalCloudWorkflowTransaction(transactionNo);
    const body = await readJsonBody(request);
    const result = await cancelWorkflowTransaction({
      rootDir,
      transactionNo,
      confirmed: body.confirmed,
      cancelledBy: actorForRequest(request, body.cancelledBy),
    });
    const statusCode = result.httpStatus || 200;
    sendJson(response, statusCode, { ...omitAbsolutePathsFromWorkflowTransactionResponse(result), ...(result.code ? { code: result.code } : {}) });
  } catch (error) {
    const stableCodes = new Set([
      "CANCELLATION_CONFIRMATION_REQUIRED", "INVALID_DOCUMENT_NUMBER", "INVALID_CANCELLATION_REQUEST",
      "WORKFLOW_NOT_FOUND", "WORKFLOW_CANCELLATION_IN_PROGRESS", "WORKFLOW_CANCELLED",
      "INSUFFICIENT_STOCK_FOR_CANCELLATION", "CANCELLATION_SOURCE_INVALID", "WORKFLOW_CANCELLATION_PENDING",
      "MONTHLY_EXPENSE_DELETE_FAILED", "STOCK_REVERSAL_FAILED",
    ]);
    const safeError = error?.safeCancellationError === true;
    const code = safeError && stableCodes.has(error.code) ? error.code : "WORKFLOW_CANCELLATION_FAILED";
    const statusCode = safeError && Number.isInteger(error.statusCode) ? error.statusCode : 409;
    sendJson(response, statusCode, {
      error: safeError ? (error.message || "ไม่สามารถยกเลิก Workflow ได้") : "ไม่สามารถยกเลิก Workflow ได้",
      code,
      ...(safeError && error.code === "INSUFFICIENT_STOCK_FOR_CANCELLATION" && Array.isArray(error.details?.items) ? { items: error.details.items } : {}),
    });
  }
}

// Usable any time after completion regardless of the toggle (the manual
// "sync Drive" button on the transaction page), and the exact same function
// completeWorkflowTransaction calls internally for the toggle-on path.
async function handleWorkflowTransactionDriveSync(transactionNo, response) {
  try {
    await ensureLocalCloudWorkflowTransaction(transactionNo);
    const result = await syncWorkflowTransactionToDrive({ rootDir, transactionNo });
    sendJson(response, 200, result);
  } catch (error) {
    sendWorkflowMutationError(response, error, "ไม่สามารถซิงก์ธุรกรรมไปยัง Google Drive ได้");
  }
}

async function handleWorkflowTransactionSheetsSync(transactionNo, response) {
  try {
    await ensureLocalCloudWorkflowTransaction(transactionNo);
    const result = await syncWorkflowTransactionToSheets({ rootDir, transactionNo });
    if (result.syncStatus === "blocked_child_rows") {
      sendJson(response, 409, { error: result.error, code: result.code, conflicts: result.conflicts });
      return;
    }
    sendJson(response, 200, result);
  } catch (error) {
    if (["WORKFLOW_CANCELLATION_IN_PROGRESS", "WORKFLOW_CANCELLED"].includes(error?.code)) {
      sendJson(response, 409, { error: error.message, code: error.code });
      return;
    }
    const safeErrors = new Set(["ไม่พบธุรกรรม", "ข้อมูลธุรกรรมไม่ตรงกับเลขที่ที่ร้องขอ", "ต้องปิดงาน Workflow ให้เสร็จสิ้นก่อนจึงจะซิงก์ Google Sheets ได้", "ไม่สามารถตรวจสอบ Google Sheets ก่อนซิงก์ได้", "ไม่สามารถซิงก์ Google Sheets ได้"]);
    sendJson(response, 400, { error: safeErrors.has(error.message) ? error.message : "ไม่สามารถซิงก์ธุรกรรมไปยัง Google Sheets ได้", code: "workflow_sheet_sync_failed" });
  }
}

async function handleWorkflowTransactionPrefill(transactionNo, url, response) {
  try {
    await ensureLocalCloudWorkflowTransaction(transactionNo);
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

function buildWorkflowStepOpenUrl({ route, documentKind, documentNo, transactionNo, workflowTemplateId, workflowStepId, returnTo, receiptType }) {
  const separator = route.includes("?") ? "&" : "?";
  const params = new URLSearchParams({ transactionNo, workflowTemplateId, workflowStepId, returnTo });
  if (documentNo) {
    const documentNumberParam = documentKind === "expense_request"
      ? "requestNo"
      : documentKind === "substitute_receipt"
        ? "receiptNo"
        : "documentNo";
    params.set(documentNumberParam, documentNo);
  }
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
    await ensureLocalCloudWorkflowTransaction(transactionNo);
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
    const childDocument = (transaction.childDocuments || []).find((document) => document.workflowStepId === step.stepId)
      || (transaction.childDocuments || []).find((document) => !document.workflowStepId && document.documentKind === step.documentKind);
    const documentNo = childDocument?.documentNo || "";

    const returnTo = `/workflow-transaction?transactionNo=${encodeURIComponent(transactionNo)}`;
    const url = buildWorkflowStepOpenUrl({
      route: definition.route,
      documentKind: step.documentKind,
      documentNo,
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
      documentNo,
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
    await ensureLocalCloudWorkflowTransaction(fileRoute.transactionNo);
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

async function handleGoogleDriveStatus(request, response) {
  try {
    sendJson(response, 200, {
      ...(await getGoogleDriveStatus(rootDir)),
      redirectUri: getOAuthRedirectUri(request),
    });
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
    const payload = await bindLineOwner(request, JSON.parse(fields.payload || "{}"), {
      numberField: "requestNo",
      loadExisting: (requestNo) => getSubmittedExpenseRequest(rootDir, requestNo),
    });
    await assertKnownStockSkuReferences(payload.expenseLines);
    if (!await ensureDocumentWriteAccess(request, response, {
      numberField: "requestNo",
      payload,
      loadExisting: (requestNo) => getSubmittedExpenseRequest(rootDir, requestNo),
    })) return;
    const result = await documentDataAdapter.save({
      documentKind: "expense_request",
      documentNo: payload.requestNo || payload.draftId,
      payload,
      localSave: () => saveExpenseDraft({
        rootDir,
        payload,
        uploads: files,
        vendorResolver,
      }),
    });

    sendJson(response, 200, result);
  } catch (error) {
    sendOperationError(response, error, "Cannot save draft");
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

async function handleExpenseRequestList(request, response) {
  try {
    const localResult = await listExpenseRequests(rootDir);
    const result = await documentDataAdapter.list({ localResult, documentKind: "expense_request" });
    const visible = await filterOwnedDocumentList(request, result, {
      numberField: "requestNo",
      load: (requestNo) => getSubmittedExpenseRequest(rootDir, requestNo),
    });
    sendJson(response, 200, { requests: visible });
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot list expense requests",
    });
  }
}

async function handleSubstituteReceiptList(request, response) {
  try {
    const localResult = await listSubstituteReceipts(rootDir);
    const result = await documentDataAdapter.list({ localResult, documentKind: "substitute_receipt" });
    const visible = await filterOwnedDocumentList(request, result, {
      numberField: "receiptNo",
      load: (receiptNo) => getSubmittedSubstituteReceipt(rootDir, receiptNo),
    });
    sendJson(response, 200, { receipts: visible });
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot list substitute receipts",
    });
  }
}

async function handleSubmittedExpenseRequestGet(requestNo, response) {
  try {
    const localResult = await ensureLocalCloudDocument({
      documentKind: "expense_request",
      documentNo: requestNo,
      localLoad: () => getSubmittedExpenseRequest(rootDir, requestNo),
    });
    const result = await documentDataAdapter.get({ localResult, documentKind: "expense_request", documentNo: requestNo });
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, error.statusCode || (error.code === "INVALID_DOCUMENT_NUMBER" ? 400 : 404), { ...(error.code ? { code: error.code } : {}), error: error.message || "Cannot load expense request" });
  }
}

async function handleSubmittedSubstituteReceiptGet(receiptNo, response) {
  try {
    const localResult = await ensureLocalCloudDocument({
      documentKind: "substitute_receipt",
      documentNo: receiptNo,
      localLoad: () => getSubmittedSubstituteReceipt(rootDir, receiptNo),
    });
    const result = await documentDataAdapter.get({ localResult, documentKind: "substitute_receipt", documentNo: receiptNo });
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, error.statusCode || (error.code === "INVALID_DOCUMENT_NUMBER" ? 400 : 404), { ...(error.code ? { code: error.code } : {}), error: error.message || "Cannot load substitute receipt" });
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

async function handleLegacyDraftFile(file, response, kind) {
  try {
    const resolver = kind === "substitute_receipt" ? getLegacySubstituteReceiptDraftFile : getLegacyExpenseDraftFile;
    const result = await resolver(file);
    const body = await readFile(result.absolutePath);
    const contentType = mimeTypes[path.extname(result.absolutePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, { "content-type": contentType });
    response.end(body);
  } catch (error) {
    sendJson(response, 404, { error: error.message || "Cannot open legacy draft file" });
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
    sendJson(response, 200, { products: await inventoryDataAdapter.read("listProducts", { search: url.searchParams.get("search") || "" }) });
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
    sendJson(response, 200, { product: await inventoryDataAdapter.write("saveProduct", payload) });
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
    sendJson(response, 200, { product: await inventoryDataAdapter.write("saveProduct", { ...payload, id: productId }) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot update product" });
  }
}

async function handleInventoryStockSkuList(url, response) {
  try {
    sendJson(response, 200, { stockSkus: await inventoryDataAdapter.read("listStockSkus", { search: url.searchParams.get("search") || "" }) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot list stock SKUs" });
  }
}

async function handleInventoryStockSkuCreate(request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { stockSku: await inventoryDataAdapter.write("saveStockSku", payload) });
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
    sendJson(response, 200, { stockSku: await inventoryDataAdapter.write("saveStockSku", { ...payload, id: stockSkuId }) });
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

async function handleShopeeOrderList(url, response) {
  try {
    sendJson(response, 200, {
      orders: listShopeeOrders(rootDir, {
        shopId: url.searchParams.get("shopId") || url.searchParams.get("connectionId") || "",
        status: url.searchParams.get("status") || "",
        limit: url.searchParams.get("limit") || 100,
      }),
    });
  } catch (error) {
    sendOperationError(response, error, "ไม่สามารถแสดงรายการ Shopee orders ได้");
  }
}

async function handleShopeeOrderLineMapping(lineId, request, response) {
  try {
    const payload = await readJsonBody(request);
    const line = saveShopeeOrderLineMapping(rootDir, lineId, payload);
    sendJson(response, 200, { line });
  } catch (error) {
    sendOperationError(response, error, "ไม่สามารถบันทึก mapping Stock SKU ได้");
  }
}

function shopeeClientFromEnvironment() {
  return createShopeeClient({
    partnerId: process.env.SHOPEE_PARTNER_ID || "",
    partnerKey: process.env.SHOPEE_PARTNER_KEY || "",
    baseUrl: process.env.SHOPEE_API_BASE_URL || undefined,
  });
}

function publicShopeeConnection(connection) {
  if (!connection) return null;
  const { accessToken, refreshToken, ...publicFields } = connection;
  return publicFields;
}

async function handleShopeeConnection(url, response) {
  const connection = getShopeeConnection(rootDir, url.searchParams.get("connectionId") || url.searchParams.get("shopId") || "");
  sendJson(response, 200, { connection: publicShopeeConnection(connection) });
}

async function handleShopeeAuthorize(request, response) {
  try {
    const payload = await readJsonBody(request);
    const client = shopeeClientFromEnvironment();
    const appOrigin = process.env.SHOPEE_APP_ORIGIN
      || request.headers.origin
      || payload.origin
      || `http://127.0.0.1:${port}`;
    const returnUrl = `${appOrigin.replace(/\/$/, "")}/shopee-connection`;
    const stateRecord = createShopeeOAuthState(rootDir, { returnUrl });
    const redirectUrl = process.env.SHOPEE_CALLBACK_URL
      || `${appOrigin.replace(/\/$/, "")}/api/shopee/callback`;
    sendJson(response, 200, {
      authorizationUrl: client.buildAuthorizationUrl({ redirectUrl, state: stateRecord.state }),
    });
  } catch (error) {
    sendOperationError(response, error, "ไม่สามารถสร้าง Shopee authorization URL ได้");
  }
}

async function handleShopeeCallback(url, response) {
  let stateRecord = null;
  try {
    stateRecord = consumeShopeeOAuthState(rootDir, url.searchParams.get("state") || "");
    if (!stateRecord) {
      sendJson(response, 400, { error: "Shopee callback state ไม่ถูกต้องหรือหมดอายุแล้ว" });
      return;
    }
    const callbackError = url.searchParams.get("error") || url.searchParams.get("error_code");
    if (callbackError) {
      const target = new URL(stateRecord.returnUrl);
      target.searchParams.set("shopee_error", url.searchParams.get("error_description") || callbackError);
      redirect(response, target.toString());
      return;
    }
    const shopId = url.searchParams.get("shop_id") || url.searchParams.get("shopId");
    const code = url.searchParams.get("code") || "";
    if (!shopId || !code) {
      const target = new URL(stateRecord.returnUrl);
      target.searchParams.set("shopee_error", "Shopee callback ต้องมี code และ shop_id");
      redirect(response, target.toString());
      return;
    }
    const connection = await completeShopeeAuthorization(rootDir, {
      shopId,
      shopName: url.searchParams.get("shop_name") || "",
      partnerId: process.env.SHOPEE_PARTNER_ID || "",
      code,
      client: shopeeClientFromEnvironment(),
    });
    const target = new URL(stateRecord.returnUrl);
    target.searchParams.set("connected", "1");
    target.searchParams.set("shopId", connection.shopId);
    redirect(response, target.toString());
  } catch (error) {
    if (stateRecord?.returnUrl) {
      const target = new URL(stateRecord.returnUrl);
      target.searchParams.set("shopee_error", error.message || "ไม่สามารถบันทึก Shopee connection ได้");
      redirect(response, target.toString());
      return;
    }
    sendOperationError(response, error, "ไม่สามารถบันทึก Shopee connection ได้");
  }
}

async function handleShopeeSync(request, response) {
  try {
    const payload = await readJsonBody(request);
    const client = shopeeClientFromEnvironment();
    const result = await syncShopeeOrders(rootDir, { connectionId: payload.connectionId || payload.shopId, client });
    sendJson(response, 200, result);
  } catch (error) {
    sendOperationError(response, error, "ไม่สามารถ sync Shopee orders ได้");
  }
}

function authenticatedShopeeClient(connection) {
  const rawClient = shopeeClientFromEnvironment();
  return {
    ...rawClient,
    request: (options = {}) => rawClient.request({
      ...options,
      accessToken: options.accessToken || connection.accessToken,
      shopId: options.shopId || connection.shopId,
    }),
  };
}

async function handleShopeeShipmentBatchPrepare(request, response) {
  try {
    const payload = await readJsonBody(request);
    const connection = getShopeeConnection(rootDir, payload.connectionId || payload.shopId);
    if (!connection) throw new Error("ไม่พบ Shopee connection");
    const result = await prepareShipmentBatch(rootDir, payload.orderIds || [], {
      client: authenticatedShopeeClient(connection),
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendOperationError(response, error, "ไม่สามารถเตรียม shipment batch ได้");
  }
}

async function handleShopeeShipmentBatchArrange(batchId, request, response) {
  try {
    const payload = await readJsonBody(request);
    const connection = getShopeeConnection(rootDir, payload.connectionId || payload.shopId);
    if (!connection) throw new Error("ไม่พบ Shopee connection");
    const result = await arrangeShipmentBatch(rootDir, batchId, payload.selection || payload, {
      client: authenticatedShopeeClient(connection),
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendOperationError(response, error, "ไม่สามารถนัดรับ shipment batch ได้");
  }
}

function publicShippingDocumentJob(job, request) {
  if (!job) return null;
  const { filePath, downloadedFilePath, ...publicJob } = job;
  return {
    ...publicJob,
    downloadUrl: job.status === "ready" ? `/api/shopee/shipping-document-jobs/${encodeURIComponent(job.id)}/download` : "",
  };
}

async function handleShopeeShipmentBatchTracking(batchId, request, response) {
  try {
    const payload = await readJsonBody(request);
    const connection = getShopeeConnection(rootDir, payload.connectionId || payload.shopId);
    if (!connection) throw new Error("ไม่พบ Shopee connection");
    const result = await refreshBatchTracking(rootDir, batchId, {
      client: authenticatedShopeeClient(connection),
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendOperationError(response, error, "ไม่สามารถดึง Tracking จาก Shopee ได้");
  }
}

async function handleShopeeShippingDocumentCreate(batchId, request, response) {
  try {
    const payload = await readJsonBody(request);
    const connection = getShopeeConnection(rootDir, payload.connectionId || payload.shopId);
    if (!connection) throw new Error("ไม่พบ Shopee connection");
    const job = await createShippingDocumentJob(rootDir, batchId, {
      client: authenticatedShopeeClient(connection),
    });
    sendJson(response, 200, { job: publicShippingDocumentJob(job, request) });
  } catch (error) {
    sendOperationError(response, error, "ไม่สามารถสร้าง shipping document job ได้");
  }
}

async function handleShopeeShippingDocumentPoll(jobId, request, response) {
  try {
    const payload = await readJsonBody(request);
    const db = openInventoryDatabase(rootDir);
    ensureInventorySchema(db);
    const job = db.prepare(`
      SELECT shipping_document_jobs.*, shipment_batches.shop_id
      FROM shipping_document_jobs
      JOIN shipment_batches ON shipment_batches.id = shipping_document_jobs.batch_id
      WHERE shipping_document_jobs.id = ?
    `).get(Number(jobId));
    db.close();
    if (!job) throw new Error("ไม่พบ shipping document job");
    const connection = getShopeeConnection(rootDir, payload.connectionId || payload.shopId || job.shop_id);
    if (!connection) throw new Error("ไม่พบ Shopee connection");
    const result = await pollShippingDocumentJob(rootDir, jobId, {
      client: authenticatedShopeeClient(connection),
    });
    sendJson(response, 200, { job: publicShippingDocumentJob(result, request) });
  } catch (error) {
    sendOperationError(response, error, "ไม่สามารถตรวจสอบ shipping document job ได้");
  }
}

async function handleShopeeShippingDocumentDownload(jobId, response) {
  const db = openInventoryDatabase(rootDir);
  ensureInventorySchema(db);
  try {
    const job = db.prepare("SELECT * FROM shipping_document_jobs WHERE id = ? AND status = 'ready'").get(Number(jobId));
    if (!job?.downloaded_file_path) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const documentsRoot = path.resolve(rootDir, "data", "shipping-documents");
    const absolutePath = path.resolve(job.downloaded_file_path);
    if (!absolutePath.startsWith(`${documentsRoot}${path.sep}`)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const body = await readFile(absolutePath);
    response.writeHead(200, {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="shipment-batch-${job.batch_id}.pdf"`,
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  } finally {
    db.close();
  }
}

async function handleShopeeBatchOverlay(batchId, request, response) {
  try {
    const payload = await readJsonBody(request);
    const result = await renderBatchLabels(rootDir, batchId, payload.mappings || payload.orders || {}, {
      pythonBin: process.env.SWEET_HOUSE_PYTHON_BIN || undefined,
    });
    const { filePath, ...publicResult } = result;
    sendJson(response, 200, publicResult);
  } catch (error) {
    sendOperationError(response, error, "ไม่สามารถสร้าง custom shipping labels ได้");
  }
}

async function handleShopeeBatchPrintPreview(batchId, response) {
  const documentsRoot = path.resolve(rootDir, "data", "shipping-labels");
  const absolutePath = path.resolve(documentsRoot, `shipment-batch-${Number(batchId)}.pdf`);
  if (!absolutePath.startsWith(`${documentsRoot}${path.sep}`)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  try {
    const body = await readFile(absolutePath);
    response.writeHead(200, {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="shipment-batch-${Number(batchId)}.pdf"`,
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

async function handleSubstituteReceiptVendorList(url, response) {
  try {
    const includeInactive = url.searchParams.get("includeInactive") === "1";
    sendJson(response, 200, { vendors: await listSubstituteReceiptVendors(rootDir, { includeInactive }) });
  } catch (error) {
    sendVendorError(response, error, "Cannot list substitute receipt vendors");
  }
}

function invalidVendorIdError() {
  const error = new Error("รหัสผู้ขายไม่ถูกต้อง");
  error.code = "INVALID_VENDOR_ID";
  error.statusCode = 400;
  return error;
}

function decodeVendorId(rawId) {
  let id;
  try {
    id = decodeURIComponent(String(rawId || ""));
  } catch {
    throw invalidVendorIdError();
  }
  // IDs are opaque to clients, but accepting path separators or arbitrary
  // strings here makes malformed requests ambiguous and risks path-like data
  // leaking into storage adapters. Keep compatibility with generated shared
  // and legacy substitute-receipt IDs only.
  if (!/^(?:VENDOR|SRV)-[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(id)) throw invalidVendorIdError();
  return id;
}

function sendVendorError(response, error, fallback) {
  const safeMessages = {
    INVALID_VENDOR_ID: "รหัสผู้ขายไม่ถูกต้อง",
    INVALID_VENDOR: "ข้อมูลผู้ขายไม่ถูกต้อง",
    INVALID_VENDOR_STATUS: "สถานะผู้ขายไม่ถูกต้อง",
    VENDOR_NOT_FOUND: "ไม่พบผู้ขาย",
    VENDOR_INACTIVE: "ผู้ขายถูกปิดใช้งาน",
    VENDOR_DUPLICATE_CONFIRMATION_REQUIRED: "พบผู้ขายที่อาจซ้ำ กรุณายืนยันก่อนบันทึก",
  };
  const knownCode = Object.prototype.hasOwnProperty.call(safeMessages, error?.code) ? error.code : undefined;
  const body = {
    ...(knownCode ? { code: knownCode } : {}),
    error: knownCode ? safeMessages[knownCode] : fallback,
  };
  if (knownCode === "VENDOR_DUPLICATE_CONFIRMATION_REQUIRED") {
    body.candidateFingerprint = error.candidateFingerprint;
    body.matches = Array.isArray(error.matches) ? error.matches.map((match) => ({
      id: match.id,
      name: match.name,
      taxId: match.taxId,
      matchedFields: Array.isArray(match.matchedFields) ? [...match.matchedFields] : [],
    })) : [];
  }
  sendJson(response, Number.isInteger(error?.statusCode) ? error.statusCode : 400, body);
}

async function handleVendorList(url, response) {
  try {
    const includeInactive = url.searchParams.get("includeInactive") === "1";
    const vendors = cloudVendorRepository
      ? mapCloudVendors(await cloudVendorRepository.listVendors(""), { includeInactive })
      : await listVendors(rootDir, { includeInactive });
    sendJson(response, 200, { vendors });
  } catch (error) {
    sendVendorError(response, error, "Cannot list vendors");
  }
}

async function handleVendorGet(vendorId, response) {
  try {
    const id = decodeVendorId(vendorId);
    const vendor = cloudVendorRepository
      ? mapCloudVendors(await cloudVendorRepository.listVendors(""), { includeInactive: true }).find(item => item.id === id) || null
      : await getVendorById(rootDir, id);
    if (!vendor) {
      const error = new Error("ไม่พบผู้ขาย");
      error.code = "VENDOR_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    }
    sendJson(response, 200, { vendor });
  } catch (error) {
    sendVendorError(response, error, "Cannot load vendor");
  }
}

async function handleVendorMatches(url, response) {
  try {
    const candidate = Object.fromEntries([
      "name", "taxId", "address", "contactName", "phone", "email", "bankName", "accountNo",
      "paymentChannel", "paymentReference", "defaultBusinessPurpose", "note",
    ].map((field) => [field, url.searchParams.get(field) || ""]));
    const vendors = cloudVendorRepository
      ? mapCloudVendors(await cloudVendorRepository.listVendors(""), { includeInactive: true })
      : await listVendors(rootDir, { includeInactive: true });
    const matches = findVendorMatches(candidate, vendors);
    sendJson(response, 200, {
      matches: matches.map((match) => ({
        id: match.id,
        name: match.name,
        taxId: match.taxId,
        status: match.status,
        matchedFields: [...match.matchedFields],
      })),
      candidateFingerprint: vendorCandidateFingerprint(candidate),
    });
  } catch (error) {
    sendVendorError(response, error, "Cannot match vendors");
  }
}

function vendorMutationOptions(payload = {}) {
  const options = payload?.options && typeof payload.options === "object" ? payload.options : {};
  return {
    confirmDuplicate: payload.confirmDuplicate === true || options.confirmDuplicate === true,
    expectedMatchIds: Array.isArray(payload.expectedMatchIds) ? payload.expectedMatchIds : options.expectedMatchIds,
    expectedCandidateFingerprint: payload.expectedCandidateFingerprint || options.expectedCandidateFingerprint,
  };
}

async function handleVendorCreate(request, response) {
  try {
    const payload = await readJsonBody(request);
    const vendor = await createVendor(rootDir, payload, vendorMutationOptions(payload));
    sendJson(response, 200, { vendor });
  } catch (error) {
    sendVendorError(response, error, "Cannot create vendor");
  }
}

async function handleVendorUpdate(vendorId, request, response) {
  try {
    const id = decodeVendorId(vendorId);
    const payload = await readJsonBody(request);
    const vendor = await updateVendor(rootDir, id, { ...payload, options: vendorMutationOptions(payload) });
    sendJson(response, 200, { vendor });
  } catch (error) {
    sendVendorError(response, error, "Cannot update vendor");
  }
}

async function handleSubstituteReceiptVendorCreate(request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { vendor: await createSubstituteReceiptVendor(rootDir, payload) });
  } catch (error) {
    sendVendorError(response, error, "Cannot create substitute receipt vendor");
  }
}

async function handleSubstituteReceiptVendorUpdate(vendorId, request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { vendor: await updateSubstituteReceiptVendor(rootDir, vendorId, payload) });
  } catch (error) {
    sendVendorError(response, error, "Cannot update substitute receipt vendor");
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
    sendJson(response, 200, { balances: await inventoryDataAdapter.read("listInventoryBalances") });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot list inventory balances" });
  }
}

async function handleInventoryDashboard(response) {
  try {
    sendJson(response, 200, await inventoryDataAdapter.read("getInventoryDashboard"));
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot load inventory dashboard" });
  }
}

async function handleInventoryStockInReport(url, response) {
  try {
    sendJson(response, 200, {
      movements: await inventoryDataAdapter.read("listStockInReport", { limit: url.searchParams.get("limit") || "100" }),
    });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot load stock-in report" });
  }
}

async function handleInventoryStockList(url, response) {
  try {
    sendJson(response, 200, {
      groups: await inventoryDataAdapter.read("listInventoryStockGroups", {
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
    sendJson(response, 200, await inventoryDataAdapter.read("getStockCard", url.searchParams.get("stockSkuId")));
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
    const contentType = mimeTypes[path.extname(absolutePath).toLowerCase()] || "application/octet-stream";
    const body = await readFile(absolutePath);
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

    const contentType = mimeTypes[path.extname(absolutePath).toLowerCase()] || "application/octet-stream";
    let body = await readFile(absolutePath);
    if (contentType.startsWith("text/html")) {
      body = body.toString("utf8").replaceAll("__LINE_LIFF_ID__", escapeHtmlAttribute(runtimeEnv.LINE_LIFF_ID || ""));
    }
    response.writeHead(200, { "content-type": contentType });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/healthz") {
    sendJson(response, 200, healthPayload(runtimeEnv));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/healthz") {
    sendJson(response, 200, healthPayload(runtimeEnv));
    return;
  }

  if (!requireAuthenticatedRequest(request, response, url)) return;

  if (request.method === "POST" && url.pathname === "/api/webhooks/line") {
    await handleLineWebhook(request, response);
    return;
  }

  const lineIntakeMatch = url.pathname.match(/^\/api\/line-intakes\/([^/]+)(\/cancel)?$/);
  if (lineIntakeMatch && request.method === "GET" && !lineIntakeMatch[2]) {
    await handleLineIntakeReview(request, response, decodeURIComponent(lineIntakeMatch[1]));
    return;
  }
  if (lineIntakeMatch && request.method === "POST" && lineIntakeMatch[2]) {
    await handleLineIntakeCancel(request, response, decodeURIComponent(lineIntakeMatch[1]));
    return;
  }
  const lineIntakeConfirmMatch = url.pathname.match(/^\/api\/line-intakes\/([^/]+)\/confirm$/);
  if (lineIntakeConfirmMatch && request.method === "POST") {
    await handleLineIntakeConfirm(request, response, decodeURIComponent(lineIntakeConfirmMatch[1]));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/line-session") {
    await handleLineSession(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    handleAuthMe(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    handleAuthLogout(response);
    return;
  }

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

  if (request.method === "POST" && url.pathname.startsWith("/api/platform-orders/") && url.pathname.endsWith("/sku-mapping")) {
    const lineId = decodeURIComponent(url.pathname
      .replace("/api/platform-orders/", "")
      .replace("/sku-mapping", ""));
    await handleShopeeOrderLineMapping(lineId, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/shopee/authorize") {
    await handleShopeeAuthorize(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/shopee/callback") {
    await handleShopeeCallback(url, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/shopee/sync") {
    await handleShopeeSync(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/shopee/shipment-batches/prepare") {
    await handleShopeeShipmentBatchPrepare(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/shopee/shipment-batches/") && url.pathname.endsWith("/arrange")) {
    const batchId = decodeURIComponent(url.pathname
      .replace("/api/shopee/shipment-batches/", "")
      .replace("/arrange", ""));
    await handleShopeeShipmentBatchArrange(batchId, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/shopee/shipment-batches/") && url.pathname.endsWith("/refresh-tracking")) {
    const batchId = decodeURIComponent(url.pathname
      .replace("/api/shopee/shipment-batches/", "")
      .replace("/refresh-tracking", ""));
    await handleShopeeShipmentBatchTracking(batchId, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/shopee/shipment-batches/") && url.pathname.endsWith("/create-documents")) {
    const batchId = decodeURIComponent(url.pathname
      .replace("/api/shopee/shipment-batches/", "")
      .replace("/create-documents", ""));
    await handleShopeeShippingDocumentCreate(batchId, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/shopee/shipment-batches/") && url.pathname.endsWith("/overlay-labels")) {
    const batchId = decodeURIComponent(url.pathname
      .replace("/api/shopee/shipment-batches/", "")
      .replace("/overlay-labels", ""));
    await handleShopeeBatchOverlay(batchId, request, response);
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/shopee/shipment-batches/") && url.pathname.endsWith("/print-preview")) {
    const batchId = decodeURIComponent(url.pathname
      .replace("/api/shopee/shipment-batches/", "")
      .replace("/print-preview", ""));
    await handleShopeeBatchPrintPreview(batchId, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/shopee/shipping-document-jobs/") && url.pathname.endsWith("/poll")) {
    const jobId = decodeURIComponent(url.pathname
      .replace("/api/shopee/shipping-document-jobs/", "")
      .replace("/poll", ""));
    await handleShopeeShippingDocumentPoll(jobId, request, response);
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/shopee/shipping-document-jobs/") && url.pathname.endsWith("/download")) {
    const jobId = decodeURIComponent(url.pathname
      .replace("/api/shopee/shipping-document-jobs/", "")
      .replace("/download", ""));
    await handleShopeeShippingDocumentDownload(jobId, response);
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

  if (request.method === "POST" && url.pathname === "/api/vendors") {
    await handleVendorCreate(request, response);
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

  if (request.method === "PATCH" && url.pathname.startsWith("/api/vendors/")) {
    const vendorId = url.pathname.slice("/api/vendors/".length);
    await handleVendorUpdate(vendorId, request, response);
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

  if (request.method === "POST" && url.pathname.startsWith("/api/workflow-documents/") && (url.pathname.endsWith("/submit") || url.pathname.endsWith("/approve") || url.pathname.endsWith("/reject"))) {
    const action = url.pathname.endsWith("/submit") ? "submit" : url.pathname.endsWith("/approve") ? "approve" : "reject";
    const remainder = url.pathname.replace("/api/workflow-documents/", "").replace(new RegExp(`/${action}$`), "");
    const [documentKind, documentNo] = remainder.split("/");
    const permission = action === "submit" ? ACTIONS.DOCUMENT_SUBMIT : action === "approve" ? ACTIONS.DOCUMENT_APPROVE : ACTIONS.DOCUMENT_REJECT;
    if (!await ensureLifecycleAccess(request, response, permission, () => getWorkflowDocument(rootDir, decodeURIComponent(documentKind || ""), decodeURIComponent(documentNo || "")))) return;
    await handleWorkflowDocumentAction(action, decodeURIComponent(documentKind || ""), decodeURIComponent(documentNo || ""), request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/workflow-documents/") && url.pathname.endsWith("/complete")) {
    const remainder = url.pathname.replace("/api/workflow-documents/", "").replace("/complete", "");
    const [documentKind, documentNo] = remainder.split("/");
    if (!await ensureLifecycleAccess(request, response, ACTIONS.DOCUMENT_COMPLETE, () => getWorkflowDocument(rootDir, decodeURIComponent(documentKind || ""), decodeURIComponent(documentNo || "")))) return;
    await handleWorkflowDocumentComplete(decodeURIComponent(documentKind || ""), decodeURIComponent(documentNo || ""), request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/workflow-documents/") && url.pathname.endsWith("/sync-drive")) {
    const segments = url.pathname.replace("/api/workflow-documents/", "").replace(/\/sync-drive$/, "").split("/");
    const [documentKind, documentNo] = segments.length === 2 ? segments : [segments[0], ""];
    if (!ensurePermission(request, response, ACTIONS.ACCOUNTING_SYNC)) return;
    if (!await ensureLifecycleAccess(request, response, ACTIONS.ACCOUNTING_SYNC, () => getWorkflowDocument(rootDir, decodeURIComponent(documentKind || ""), decodeURIComponent(documentNo || "")))) return;
    await handleWorkflowDocumentDriveSync(decodeURIComponent(documentKind || ""), decodeURIComponent(documentNo || ""), response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/workflow-templates") {
    if (!ensurePermission(request, response, ACTIONS.SETTINGS_MANAGE)) return;
    await handleWorkflowTemplateSave(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/workflow-transactions") {
    if (!ensurePermission(request, response, ACTIONS.DOCUMENT_CREATE)) return;
    await handleWorkflowTransactionStart(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/workflow-transactions/") && url.pathname.endsWith("/refresh")) {
    const transactionNo = decodeURIComponent(url.pathname
      .replace("/api/workflow-transactions/", "")
      .replace("/refresh", ""));
    if (!ensurePermission(request, response, ACTIONS.DOCUMENT_READ)) return;
    await handleWorkflowTransactionRefresh(transactionNo, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/workflow-transactions/") && url.pathname.endsWith("/complete")) {
    const transactionNo = decodeURIComponent(url.pathname
      .replace("/api/workflow-transactions/", "")
      .replace("/complete", ""));
    if (!ensurePermission(request, response, ACTIONS.DOCUMENT_COMPLETE)) return;
    await handleWorkflowTransactionComplete(transactionNo, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/workflow-transactions/") && url.pathname.endsWith("/cancel")) {
    const transactionNo = decodeURIComponent(url.pathname
      .replace("/api/workflow-transactions/", "")
      .replace("/cancel", ""));
    if (!ensurePermission(request, response, ACTIONS.DOCUMENT_COMPLETE)) return;
    await handleWorkflowTransactionCancel(transactionNo, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/workflow-transactions/") && url.pathname.endsWith("/sync-drive")) {
    const transactionNo = decodeURIComponent(url.pathname
      .replace("/api/workflow-transactions/", "")
      .replace("/sync-drive", ""));
    if (!ensurePermission(request, response, ACTIONS.ACCOUNTING_SYNC)) return;
    await handleWorkflowTransactionDriveSync(transactionNo, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/workflow-transactions/") && url.pathname.endsWith("/sync-sheets")) {
    const transactionNo = decodeURIComponent(url.pathname
      .replace("/api/workflow-transactions/", "")
      .replace("/sync-sheets", ""));
    if (!ensurePermission(request, response, ACTIONS.ACCOUNTING_SYNC)) return;
    await handleWorkflowTransactionSheetsSync(transactionNo, response);
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
    if (!await ensureLifecycleAccess(request, response, ACTIONS.DOCUMENT_APPROVE, () => getSubmittedSubstituteReceipt(rootDir, receiptNo))) return;
    await handleSubstituteReceiptApprove(receiptNo, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/substitute-receipts/") && url.pathname.endsWith("/reject")) {
    const receiptNo = decodeURIComponent(url.pathname
      .replace("/api/substitute-receipts/", "")
      .replace("/reject", ""));
    if (!await ensureLifecycleAccess(request, response, ACTIONS.DOCUMENT_REJECT, () => getSubmittedSubstituteReceipt(rootDir, receiptNo))) return;
    await handleSubstituteReceiptReject(receiptNo, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/expense-requests/") && url.pathname.endsWith("/approve")) {
    const requestNo = decodeURIComponent(url.pathname
      .replace("/api/expense-requests/", "")
      .replace("/approve", ""));
    if (!await ensureLifecycleAccess(request, response, ACTIONS.DOCUMENT_APPROVE, () => getSubmittedExpenseRequest(rootDir, requestNo))) return;
    await handleExpenseRequestApprove(requestNo, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/expense-requests/") && url.pathname.endsWith("/reject")) {
    const requestNo = decodeURIComponent(url.pathname
      .replace("/api/expense-requests/", "")
      .replace("/reject", ""));
    if (!await ensureLifecycleAccess(request, response, ACTIONS.DOCUMENT_REJECT, () => getSubmittedExpenseRequest(rootDir, requestNo))) return;
    await handleExpenseRequestReject(requestNo, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/expense-requests/") && url.pathname.endsWith("/complete")) {
    const requestNo = decodeURIComponent(url.pathname
      .replace("/api/expense-requests/", "")
      .replace("/complete", ""));
    if (!await ensureLifecycleAccess(request, response, ACTIONS.DOCUMENT_COMPLETE, () => getSubmittedExpenseRequest(rootDir, requestNo))) return;
    await handleExpenseRequestComplete(requestNo, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/substitute-receipts/") && url.pathname.endsWith("/complete")) {
    const receiptNo = decodeURIComponent(url.pathname
      .replace("/api/substitute-receipts/", "")
      .replace("/complete", ""));
    if (!await ensureLifecycleAccess(request, response, ACTIONS.DOCUMENT_COMPLETE, () => getSubmittedSubstituteReceipt(rootDir, receiptNo))) return;
    await handleSubstituteReceiptComplete(receiptNo, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/substitute-receipts/") && url.pathname.endsWith("/receive-stock")) {
    const receiptNo = decodeURIComponent(url.pathname
      .replace("/api/substitute-receipts/", "")
      .replace("/receive-stock", ""));
    if (!await ensureLifecycleAccess(request, response, ACTIONS.STOCK_RECEIVE, () => getSubmittedSubstituteReceipt(rootDir, receiptNo))) return;
    await handleSubstituteReceiptReceiveStock(receiptNo, request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/substitute-receipts/") && url.pathname.endsWith("/sync-drive")) {
    const receiptNo = decodeURIComponent(url.pathname
      .replace("/api/substitute-receipts/", "")
      .replace("/sync-drive", ""));
    if (!ensurePermission(request, response, ACTIONS.ACCOUNTING_SYNC)) return;
    if (!await ensureLifecycleAccess(request, response, ACTIONS.ACCOUNTING_SYNC, () => getSubmittedSubstituteReceipt(rootDir, receiptNo))) return;
    await handleSubstituteReceiptDriveSync(receiptNo, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/expense-requests/") && url.pathname.endsWith("/sync-drive")) {
    const requestNo = decodeURIComponent(url.pathname
      .replace("/api/expense-requests/", "")
      .replace("/sync-drive", ""));
    if (!ensurePermission(request, response, ACTIONS.ACCOUNTING_SYNC)) return;
    if (!await ensureLifecycleAccess(request, response, ACTIONS.ACCOUNTING_SYNC, () => getSubmittedExpenseRequest(rootDir, requestNo))) return;
    await handleExpenseDriveSync(requestNo, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/expense-drafts") {
    await handleDraftSave(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/google-drive/config") {
    if (!ensurePermission(request, response, ACTIONS.SETTINGS_MANAGE)) return;
    await handleGoogleDriveConfig(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/company-settings") {
    if (!ensurePermission(request, response, ACTIONS.SETTINGS_MANAGE)) return;
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
      if (!ensurePermission(request, response, ACTIONS.DOCUMENT_READ)) return;
      await handleWorkflowDocumentTypesList(response);
      return;
    }

    if (url.pathname === "/api/workflow-templates") {
      if (!ensurePermission(request, response, ACTIONS.DOCUMENT_READ)) return;
      await handleWorkflowTemplateList(response);
      return;
    }

    // Must be checked before the generic "/api/workflow-transactions/:transactionNo"
    // route below, or a request for the literal "next" would be swallowed and
    // treated as a lookup for a transaction named "next".
    if (url.pathname === "/api/workflow-transactions/next") {
      if (!ensurePermission(request, response, ACTIONS.DOCUMENT_CREATE)) return;
      await handleNextWorkflowTransaction(url, response);
      return;
    }

    if (url.pathname === "/api/workflow-transactions") {
      if (!ensurePermission(request, response, ACTIONS.DOCUMENT_READ)) return;
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

    if (url.pathname === "/api/platform-orders") {
      await handleShopeeOrderList(url, response);
      return;
    }

    if (url.pathname === "/api/shopee/connection") {
      await handleShopeeConnection(url, response);
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

    if (url.pathname === "/api/vendors") {
      await handleVendorList(url, response);
      return;
    }

    if (url.pathname === "/api/vendors/matches") {
      await handleVendorMatches(url, response);
      return;
    }

    if (url.pathname.startsWith("/api/vendors/")) {
      const vendorId = url.pathname.slice("/api/vendors/".length);
      await handleVendorGet(vendorId, response);
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
      if (!ensurePermission(request, response, ACTIONS.DOCUMENT_READ)) return;
      await handleExpenseRequestList(request, response);
      return;
    }

    if (url.pathname === "/api/substitute-receipts") {
      if (!ensurePermission(request, response, ACTIONS.DOCUMENT_READ)) return;
      await handleSubstituteReceiptList(request, response);
      return;
    }

    if (url.pathname.startsWith("/api/substitute-receipts/") && !url.pathname.includes("/files/")) {
      const receiptNo = decodeURIComponent(url.pathname.replace("/api/substitute-receipts/", ""));
      if (!await ensureLifecycleAccess(request, response, ACTIONS.DOCUMENT_READ, () => loadDocumentForAuthorization({
        documentKind: "substitute_receipt",
        documentNo: receiptNo,
        localLoad: () => getSubmittedSubstituteReceipt(rootDir, receiptNo),
      }))) return;
      await handleSubmittedSubstituteReceiptGet(receiptNo, response);
      return;
    }

    if (url.pathname.startsWith("/api/expense-requests/") && !url.pathname.includes("/files/")) {
      const requestNo = decodeURIComponent(url.pathname.replace("/api/expense-requests/", ""));
      if (!await ensureLifecycleAccess(request, response, ACTIONS.DOCUMENT_READ, () => loadDocumentForAuthorization({
        documentKind: "expense_request",
        documentNo: requestNo,
        localLoad: () => getSubmittedExpenseRequest(rootDir, requestNo),
      }))) return;
      await handleSubmittedExpenseRequestGet(requestNo, response);
      return;
    }

    if (url.pathname === "/api/workflow-documents") {
      if (!ensurePermission(request, response, ACTIONS.DOCUMENT_READ)) return;
      await handleWorkflowDocumentList(request, url, response);
      return;
    }

    if (url.pathname.startsWith("/api/workflow-documents/")) {
      const remainder = url.pathname.replace("/api/workflow-documents/", "");
      const [documentKind, documentNo] = remainder.split("/");
      if (!await ensureLifecycleAccess(request, response, ACTIONS.DOCUMENT_READ, () => loadDocumentForAuthorization({
        documentKind: decodeURIComponent(documentKind || ""),
        documentNo: decodeURIComponent(documentNo || ""),
        localLoad: () => getWorkflowDocument(rootDir, decodeURIComponent(documentKind || ""), decodeURIComponent(documentNo || "")),
      }))) return;
      await handleWorkflowDocumentGet(decodeURIComponent(documentKind || ""), decodeURIComponent(documentNo || ""), response);
      return;
    }

    if (url.pathname.startsWith("/api/workflow-transactions/") && url.pathname.endsWith("/prefill")) {
      const transactionNo = decodeURIComponent(url.pathname
        .replace("/api/workflow-transactions/", "")
        .replace("/prefill", ""));
      if (!ensurePermission(request, response, ACTIONS.DOCUMENT_READ)) return;
      await handleWorkflowTransactionPrefill(transactionNo, url, response);
      return;
    }

    if (
      url.pathname.startsWith("/api/workflow-transactions/")
      && !url.pathname.includes("/files/")
      && !url.pathname.endsWith("/prefill")
    ) {
      const transactionNo = decodeURIComponent(url.pathname.replace("/api/workflow-transactions/", ""));
      if (!ensurePermission(request, response, ACTIONS.DOCUMENT_READ)) return;
      await handleWorkflowTransactionGet(transactionNo, response);
      return;
    }

    const fileRoute = parseExpenseRequestFileRoute(url.pathname);
    if (fileRoute) {
      if (!await ensureLifecycleAccess(request, response, ACTIONS.DOCUMENT_READ, () => loadDocumentForAuthorization({
        documentKind: "expense_request",
        documentNo: fileRoute.requestNo,
        localLoad: () => getSubmittedExpenseRequest(rootDir, fileRoute.requestNo),
      }))) return;
      await handleExpenseRequestFile(fileRoute, response);
      return;
    }

    const substituteReceiptFileRoute = parseSubstituteReceiptFileRoute(url.pathname);
    if (substituteReceiptFileRoute) {
      if (!await ensureLifecycleAccess(request, response, ACTIONS.DOCUMENT_READ, () => loadDocumentForAuthorization({
        documentKind: "substitute_receipt",
        documentNo: substituteReceiptFileRoute.receiptNo,
        localLoad: () => getSubmittedSubstituteReceipt(rootDir, substituteReceiptFileRoute.receiptNo),
      }))) return;
      await handleSubstituteReceiptFile(substituteReceiptFileRoute, response);
      return;
    }

    const workflowDocumentFileRoute = parseWorkflowDocumentFileRoute(url.pathname);
    if (workflowDocumentFileRoute) {
      if (!await ensureLifecycleAccess(request, response, ACTIONS.DOCUMENT_READ, () => loadDocumentForAuthorization({
        documentKind: workflowDocumentFileRoute.documentKind,
        documentNo: workflowDocumentFileRoute.documentNo,
        localLoad: () => getWorkflowDocument(rootDir, workflowDocumentFileRoute.documentKind, workflowDocumentFileRoute.documentNo),
      }))) return;
      await handleWorkflowDocumentFile(workflowDocumentFileRoute, response);
      return;
    }

    const workflowTransactionFileRoute = parseWorkflowTransactionFileRoute(url.pathname);
    if (workflowTransactionFileRoute) {
      if (!ensurePermission(request, response, ACTIONS.DOCUMENT_READ)) return;
      await handleWorkflowTransactionFile(workflowTransactionFileRoute, response);
      return;
    }

    if (url.pathname === "/api/google-drive/status") {
      if (!ensurePermission(request, response, ACTIONS.DOCUMENT_READ)) return;
      await handleGoogleDriveStatus(request, response);
      return;
    }

    if (url.pathname === "/api/company-settings") {
      if (!ensurePermission(request, response, ACTIONS.DOCUMENT_READ)) return;
      await handleCompanySettingsGet(response);
      return;
    }

    if (url.pathname === "/api/google-drive/login") {
      if (!ensurePermission(request, response, ACTIONS.SETTINGS_MANAGE)) return;
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

    const legacyExpenseFile = parseLegacyDraftFileRoute(url.pathname, "/api/expense-drafts/");
    if (legacyExpenseFile) {
      await handleLegacyDraftFile({ rootDir, ...legacyExpenseFile }, response, "expense_request");
      return;
    }

    if (url.pathname.startsWith("/api/expense-drafts/")) {
      const draftId = decodeURIComponent(url.pathname.replace("/api/expense-drafts/", ""));
      await handleDraftGet(draftId, response);
      return;
    }

    if (url.pathname.startsWith("/api/substitute-receipt-drafts/")) {
      const legacySubstituteFile = parseLegacyDraftFileRoute(url.pathname, "/api/substitute-receipt-drafts/");
      if (legacySubstituteFile) {
        await handleLegacyDraftFile({ rootDir, ...legacySubstituteFile }, response, "substitute_receipt");
        return;
      }
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
    console.log(`${cloudRun ? "Expense request Cloud Run app" : "Expense request local web app"}: http://localhost:${boundPort}/`);
    if (cloudRun) {
      console.log(`Cloud Run runtime active (${listenHost}:${boundPort}); durable data is configured for Supabase and local files use ${rootDir}`);
    } else if (allowNetwork) {
      console.log(
        `[คำเตือน] SWEET_HOUSE_ALLOW_NETWORK เปิดใช้งานอยู่ เซิร์ฟเวอร์กำลังรับฟังทุกอินเทอร์เฟซเครือข่าย (${listenHost}:${boundPort}) สามารถเข้าถึงจากเครือข่ายได้จากอุปกรณ์อื่น เช่น วงแลนสำนักงานหรือไวไฟร้านกาแฟ และระบบนี้ไม่มีระบบยืนยันตัวตนใด ๆ ทั้งสิ้น ผู้ใดก็ตามที่อยู่ในเครือข่ายเดียวกันจะสามารถเปิดดู แก้ไข หรือลบเอกสารบัญชีได้ โปรดใช้เฉพาะในเครือข่ายที่เชื่อถือได้เท่านั้น`,
      );
    } else {
      console.log(`เซิร์ฟเวอร์รับฟังเฉพาะเครื่องนี้เท่านั้น (${listenHost}:${boundPort}) หากต้องการเปิดให้เข้าถึงจากอุปกรณ์อื่นในเครือข่าย ให้ตั้งค่า SWEET_HOUSE_ALLOW_NETWORK=1`);
    }
  });
}

startServer();
