import { createServer } from "node:http";
import { createRequire } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { randomUUID } = require("node:crypto");
const { createInventoryCloudRepository } = require("./forms/inventory-cloud.repository.js");
const { createSupabaseCommerceService } = require("./forms/supabase-commerce.logic.js");
const { renderShipmentLabelOverlay } = require("./forms/shopee-label-overlay.logic.js");
const {
  buildGoogleOAuthUrl,
  exchangeGoogleOAuthCode,
  getGoogleDriveStatus,
  saveGoogleDriveConfig,
} = require("./forms/google-drive.logic.js");
const {
  getCompanySettings,
  saveCompanySettings,
  normalizeCompanySettings,
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
const {
  getDefaultWorkflowTemplates,
  normalizeWorkflowTemplate,
  validateWorkflowTemplate,
  deriveWorkflowProgress,
} = require("./forms/workflow.logic.js");
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
  compatibilityVendor,
  createSubstituteReceiptVendor,
  listSubstituteReceiptVendors,
  updateSubstituteReceiptVendor,
} = require("./forms/substitute-receipt-vendors.logic.js");
const {
  createVendor,
  buildVendorRecord,
  buildUpdatedVendorRecord,
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
  normalizePlatform,
  parsePlatformOrderFile,
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
  getCustomLabelFile,
  getCustomLabelJob,
  compareCustomLabelFiles,
  customLabelStorageObjectPath,
  createCustomLabelComparison,
  parseCustomLabelUpload,
  previewCustomLabel,
  saveCustomLabel,
} = require("./forms/shopee-custom-label.logic.js");
const {
  rebuildDocumentIndex,
} = require("./forms/document-index.logic.js");
const {
  resolveLineAppUser,
  verifyLineIdToken,
} = require("./forms/line-auth.logic.js");
const {
  getAppUserProfile,
  updateAppUserProfile,
  listCompanyPositions,
  profileRequesterFallback,
} = require("./forms/user-profile.server.logic.js");
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
  pushToLine,
} = require("./forms/line-bot.logic.js");
const { scanLineDocument } = require("./forms/line-ocr.logic.js");
const { verifyWorkerToken } = require("./forms/line-workflow-worker.logic.js");
const { createLineWorkflowController } = require("./forms/line-workflow-controller.logic.js");
const { createLineWorkflowNativeServices } = require("./forms/line-workflow-native.logic.js");
const { createSupabaseAdminClient, supabaseRequest } = require("./forms/supabase.logic.js");
const { createSupabaseDataRepository } = require("./forms/supabase-data.logic.js");
const {
  createSupabaseStorageClient,
  downloadStorageObject,
  uploadStorageObject,
  deleteStorageObject,
} = require("./forms/supabase-storage.logic.js");
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
  buildMockProfileStore,
  buildMockSessionUser,
  parseMockAuthConfig,
} = require("./forms/mock-auth.logic.js");
const { issueFileAccessToken, verifyFileAccessToken } = require("./forms/file-access.logic.js");
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
const sessionAuthMode = authMode === "line" || authMode === "mock";
const mockAuthConfig = parseMockAuthConfig(process.env);
const mockProfileStore = mockAuthConfig.enabled ? buildMockProfileStore(mockAuthConfig) : null;
const sessionSecret = String(runtimeEnv.SWEET_HOUSE_SESSION_SECRET || "");
const sessionTtlSeconds = Math.max(300, Number(runtimeEnv.SWEET_HOUSE_SESSION_TTL_SECONDS || 43200));
const cookieSecure = /^(1|true|yes)$/i.test(String(runtimeEnv.SWEET_HOUSE_COOKIE_SECURE || ""))
  || String(runtimeEnv.NODE_ENV || "").toLowerCase() === "production";
const appPublicOrigin = String(runtimeEnv.APP_PUBLIC_ORIGIN || "").trim().replace(/\/$/, "");
const e2eRunId = String(runtimeEnv.E2E_RUN_ID || "").trim();
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
const customLabelStorageClient = cloudRun
  ? createSupabaseStorageClient({
    url: runtimeEnv.SUPABASE_URL,
    serviceRoleKey: runtimeEnv.SUPABASE_SERVICE_ROLE_KEY,
    bucket: runtimeEnv.SUPABASE_STORAGE_BUCKET,
  })
  : null;
const cloudDataRepository = cloudRun
  ? createSupabaseDataRepository({
    client: createSupabaseAdminClient({ url: runtimeEnv.SUPABASE_URL, serviceRoleKey: runtimeEnv.SUPABASE_SERVICE_ROLE_KEY }),
  })
  : null;
const inventoryCloudRepository = cloudRun
  ? createInventoryCloudRepository({
    client: createSupabaseAdminClient({ url: runtimeEnv.SUPABASE_URL, serviceRoleKey: runtimeEnv.SUPABASE_SERVICE_ROLE_KEY }),
    storageClient: customLabelStorageClient,
  })
  : null;
const cloudCommerceService = cloudRun
  ? createSupabaseCommerceService({
    client: createSupabaseAdminClient({ url: runtimeEnv.SUPABASE_URL, serviceRoleKey: runtimeEnv.SUPABASE_SERVICE_ROLE_KEY }),
  })
  : null;
const documentDataAdapter = createDocumentDataAdapter({
  env: runtimeEnv,
  persistFiles: documentFileSynchronizer
    ? ({ documentKind, documentNo, folderPath, sourceHash }) => documentFileSynchronizer.sync({ documentKind, documentNo, folderPath, sourceHash })
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
const cloudDocumentNumberAllocator = cloudRun
  ? input => documentDataAdapter.allocateAccountingDocumentNumber(input)
  : undefined;
const documentFileAdapter = createFileAdapter({
  rootDir,
  env: runtimeEnv,
  logger: event => console.warn(`[data-adapter] ${JSON.stringify(event)}`),
});

const lineWorkflow = createLineWorkflowController({
  rootDir, env: runtimeEnv, intakeStore: lineIntakeStore,
  templates: listRuntimeWorkflowTemplates,
  resolveActor: async batch => {
    const rows = await supabaseRequest(createSupabaseAdminClient(), `/rest/v1/app_users?select=id,line_user_id,display_name,status,app_user_roles(role_code)&id=eq.${encodeURIComponent(batch.ownerUserId)}&limit=1`);
    const user = require("./forms/line-auth.logic.js").rowToAppUser(rows[0]);
    if(user.status !== "active" || user.lineUserId !== batch.lineUserId || !user.role) throw new Error("บัญชีผู้ใช้ไม่มีสิทธิ์ดำเนินการแล้ว");
    return {userId:user.id,lineUserId:user.lineUserId,role:user.role,displayName:user.displayName};
  },
  scan: f => scanLineDocument({ provider: lineOcrProvider, endpoint: lineOcrEndpoint, apiKey: lineOcrApiKey, bytes: f.bytes, contentType: f.contentType, fileName: f.fileName }),
  download: messageId => downloadLineContent({ messageId, accessToken: lineChannelAccessToken, maxBytes: lineIntakeMaxBytes }),
  push: input => pushToLine({...input,accessToken:lineChannelAccessToken}),
  reply: (replyToken, messages) => replyToLine({ replyToken, messages, accessToken: lineChannelAccessToken }),
  mediaEvent: extractLineMediaEvent, validateStock: assertKnownStockSkuReferences,
  nativeFactory: ({actor, store}) => createLineWorkflowNativeServices({ rootDir, store, actor, intakeStore: lineIntakeStore, documentDataAdapter, cloudRun,
    hydrate: async options => {
      if (cloudRun) { const record = await documentDataAdapter.get({localResult:null,documentKind:options.documentKind,documentNo:options.documentNo}); if(record) { await documentFileSynchronizer.materialize({record}); await rebuildDocumentIndex(rootDir); } }
      return ensureLocalCloudDocument(options);
    }, hydrateTransaction: ensureLocalCloudWorkflowTransaction,
    persistTransaction: persistCloudWorkflowTransactionMutation, persistDocument: persistCloudDocumentMutation,
    companySettingsResolver: resolveCompanySettings, vendorResolver, inventoryCloudRepository, validateStock: assertKnownStockSkuReferences }),
});

async function assertKnownStockSkuReferences(lines = []) {
  const selectedLines = (Array.isArray(lines) ? lines : []).filter((line) => String(line?.stockSkuId ?? "").trim());
  if (!selectedLines.length) return;
  const stockSkus = await inventoryDataAdapter.read("listStockSkus", { search: "" });
  const errors = validateStockSkuReferences(lines, stockSkus);
  if (errors.length) throw new Error(errors.join(", "));
}

async function resolveCompanySettings() {
  return cloudDataRepository ? cloudDataRepository.getCompanySettings() : getCompanySettings(rootDir);
}

function workflowTemplateFromCloudRecord(record) {
  if (!record) return null;
  const template = { ...record };
  delete template.documentKind;
  delete template.documentNo;
  delete template.status;
  delete template.folderPath;
  delete template.ownerUserId;
  delete template.sourceKey;
  delete template.sourceHash;
  return template.templateId ? template : null;
}

async function listRuntimeWorkflowTemplates() {
  if (!cloudRun) return listWorkflowTemplates(rootDir);
  const templates = new Map(getDefaultWorkflowTemplates().map(template => [template.templateId, template]));
  const cloudTemplates = await documentDataAdapter.list({ localResult: [], documentKind: "workflow_template" });
  for (const record of cloudTemplates) {
    const template = workflowTemplateFromCloudRecord(record);
    if (template) templates.set(template.templateId, template);
  }
  return [...templates.values()];
}

async function getRuntimeWorkflowTemplate(templateId) {
  if (!cloudRun) return getWorkflowTemplate(rootDir, templateId);
  const cloudRecord = await documentDataAdapter.get({ localResult: null, documentKind: "workflow_template", documentNo: templateId });
  return workflowTemplateFromCloudRecord(cloudRecord)
    || getDefaultWorkflowTemplates().find(template => template.templateId === templateId)
    || null;
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

const cloudDocumentMutationContext = new AsyncLocalStorage();

async function ensureLocalCloudDocument({ documentKind, documentNo, localLoad }) {
  const record = await cloudDocumentReader.ensure({ documentKind, documentNo, localLoad });
  if (cloudRun && record && documentNo) {
    const sourceHash = await documentDataAdapter.getSourceHash({ documentKind, documentNo });
    if (sourceHash) cloudDocumentMutationContext.getStore()?.set(`${documentKind}:${documentNo}`, sourceHash);
  }
  return record;
}

function takeCloudDocumentSourceHash(documentKind, documentNo) {
  if (!documentNo) return "";
  const sourceVersions = cloudDocumentMutationContext.getStore();
  const identity = `${documentKind}:${documentNo}`;
  const value = sourceVersions?.get(identity) || "";
  sourceVersions?.delete(identity);
  return value;
}

async function ensureLocalCloudWorkflowTransaction(transactionNo) {
  let localRecord = await getWorkflowTransaction(rootDir, transactionNo);
  if (!cloudRun || !documentFileSynchronizer) return localRecord;

  const cloudRecord = await documentDataAdapter.get({
    localResult: localRecord,
    documentKind: "workflow_transaction",
    documentNo: transactionNo,
  });
  if (!cloudRecord) return localRecord;
  const cloudSourceHash = await documentDataAdapter.getSourceHash({ documentKind: "workflow_transaction", documentNo: transactionNo });
  const localSourceHash = localRecord
    ? documentDataAdapter.buildDocumentCloudRecord({ documentKind: "workflow_transaction", documentNo: transactionNo, payload: localRecord }).sourceHash
    : "";
  if (!localRecord || (cloudSourceHash && cloudSourceHash !== localSourceHash)) {
    await documentFileSynchronizer.materialize({ record: cloudRecord });
    await rebuildDocumentIndex(rootDir);
    localRecord = await getWorkflowTransaction(rootDir, transactionNo);
  }
  if (cloudSourceHash) cloudDocumentMutationContext.getStore()?.set(`workflow_transaction:${transactionNo}`, cloudSourceHash);
  if (!localRecord) return null;

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

  if (childDocuments.length > 0) await rebuildDocumentIndex(rootDir);
  return getWorkflowTransaction(rootDir, transactionNo);
}

const cloudWorkflowTransactionPersistenceQueues = new Map();

function persistCloudWorkflowTransactionMutation(transactionNo, options = {}) {
  if (!cloudRun) return Promise.resolve(null);
  const key = String(transactionNo || "");
  const previous = cloudWorkflowTransactionPersistenceQueues.get(key) || Promise.resolve();
  const operation = previous.catch(() => {}).then(() => persistCloudWorkflowTransactionMutationNow(key, options));
  cloudWorkflowTransactionPersistenceQueues.set(key, operation);
  return operation.finally(() => {
    if (cloudWorkflowTransactionPersistenceQueues.get(key) === operation) cloudWorkflowTransactionPersistenceQueues.delete(key);
  });
}

function withWorkflowCancellationSnapshot(transaction, snapshot) {
  if (!snapshot || !["cancellation_pending", "cancelled"].includes(snapshot.status) || !snapshot.cancellation) return transaction;
  return {
    ...transaction,
    status: snapshot.status,
    baseStatus: snapshot.baseStatus || "",
    completedAt: snapshot.completedAt || transaction.completedAt || "",
    cancellation: snapshot.cancellation,
  };
}

async function persistCloudWorkflowTransactionMutationNow(transactionNo, { retryMutation, snapshot = null } = {}) {
  if (!cloudRun) return null;
  let transaction = await getWorkflowTransaction(rootDir, transactionNo);
  let expectedSourceHash = takeCloudDocumentSourceHash("workflow_transaction", transactionNo);
  if (!transaction) throw new Error("ไม่พบธุรกรรม");
  transaction = withWorkflowCancellationSnapshot(transaction, snapshot);
  for (let attempt = 0; ; attempt += 1) {
    try {
      await documentDataAdapter.save({
        documentKind: "workflow_transaction",
        documentNo: transactionNo,
        payload: transaction,
        localSave: async () => transaction,
        expectedSourceHash,
      });
      return transaction;
    } catch (error) {
      if (error?.code !== "DOCUMENT_WRITE_CONFLICT" || attempt >= 4) throw error;
      const latestCloudRecord = await documentDataAdapter.get({
        localResult: null,
        documentKind: "workflow_transaction",
        documentNo: transactionNo,
      });
      if (!latestCloudRecord) throw error;
      await documentFileSynchronizer.materialize({ record: latestCloudRecord });
      await rebuildDocumentIndex(rootDir);
      if (typeof retryMutation === "function") {
        const retried = await retryMutation();
        if (retried?.cancellation) snapshot = retried;
      }
      expectedSourceHash = await documentDataAdapter.getSourceHash({ documentKind: "workflow_transaction", documentNo: transactionNo });
      transaction = await getWorkflowTransaction(rootDir, transactionNo);
      if (!transaction) throw error;
      transaction = withWorkflowCancellationSnapshot(transaction, snapshot);
    }
  }
}

async function persistCloudDocumentMutation({ documentKind, documentNo, result, localLoad }) {
  if (!cloudRun) return result;
  const localRecord = await localLoad();
  const identity = `${documentKind}:${documentNo}`;
  const sourceVersions = cloudDocumentMutationContext.getStore();
  const expectedSourceHash = sourceVersions?.get(identity);
  sourceVersions?.delete(identity);
  await documentDataAdapter.save({
    documentKind,
    documentNo,
    payload: localRecord?.payload || localRecord,
    localSave: async () => result,
    expectedSourceHash,
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

function pdfResponseHeaders({ fileName, download = false } = {}) {
  const safeFileName = String(fileName || "document.pdf").replace(/[\r\n\"]/g, "_");
  return {
    "content-type": "application/pdf",
    "content-disposition": `${download ? "attachment" : "inline"}; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(safeFileName)}`,
  };
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
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
    || pathname === "/api/auth/mock-session"
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

function isLoopbackHost(hostHeader) {
  const rawHost = String(hostHeader || "").trim();
  if (!rawHost) return false;
  let hostname;
  try {
    hostname = new URL(`http://${rawHost}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "[::1]"
    || hostname === "::1";
}

function mockAuthRequestIsAllowed(request) {
  if (!isLoopbackHost(request.headers.host)) return false;
  const origin = String(request.headers.origin || "").trim();
  if (appPublicOrigin) return origin === appPublicOrigin;
  if (!origin) return true;
  try {
    const parsedOrigin = new URL(origin);
    return (parsedOrigin.protocol === "http:" || parsedOrigin.protocol === "https:")
      && isLoopbackHost(parsedOrigin.host);
  } catch {
    return false;
  }
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
  const authEnforced = sessionAuthMode;
  const isProtectedPagePath = authEnforced && ["/user-profile", "/user-profile/"].includes(url.pathname);
  if (!authEnforced || (!isProtectedApiPath && !isProtectedPagePath) || isPublicApiPath(url.pathname)) return true;
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
  const fileAccess = readFileAccessToken(request, url);
  if (fileAccess) {
    request.auth = fileAccess;
    request.fileAccess = true;
    return true;
  }
  try {
    request.auth = readRequestSession(request);
    return true;
  } catch (error) {
    if (isProtectedPagePath) {
      if (error.code !== "SESSION_MISSING") response.setHeader("set-cookie", [clearSessionCookie({ secure: cookieSecure })]);
      const authEntryPath = authMode === "mock" ? "/mock-auth" : "/line-auth";
      redirect(response, `${authEntryPath}?returnTo=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
      return false;
    }
    sendAuthError(response, 401, "AUTH_REQUIRED", "กรุณาเข้าสู่ระบบผ่าน LINE", { clearCookie: error.code !== "SESSION_MISSING" });
    return false;
  }
}

function readFileAccessToken(request, url) {
  if (!['GET', 'HEAD'].includes(request.method)) return null;
  const isFileRoute = Boolean(
    parseExpenseRequestFileRoute(url.pathname)
      || parseSubstituteReceiptFileRoute(url.pathname)
      || parseWorkflowDocumentFileRoute(url.pathname)
      || parseWorkflowTransactionFileRoute(url.pathname)
      || /^\/api\/shopee\/custom-labels\/[^/]+\/(source|preview-file|output|download|comparison)$/.test(url.pathname),
  );
  if (!isFileRoute) return null;
  return verifyFileAccessToken({
    token: url.searchParams.get("fileToken"),
    secret: sessionSecret,
    path: url.pathname,
  });
}

function actorForRequest(request, suppliedActor) {
  return sessionAuthMode ? actorLabel(request.auth) : suppliedActor;
}

function denyForbidden(response) {
  sendJson(response, 403, { code: "AUTH_FORBIDDEN", error: "ไม่มีสิทธิ์ดำเนินการ" });
  return false;
}

function ensurePermission(request, response, action) {
  if (!sessionAuthMode) return true;
  try {
    assertPermission(request.auth, action);
    return true;
  } catch (error) {
    if (error.code === "AUTH_FORBIDDEN") return denyForbidden(response);
    throw error;
  }
}

async function ensureDocumentAccess(request, response, { action, load }) {
  if (!sessionAuthMode) return true;
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
  documentKind,
  loadExisting,
  existingAction = ACTIONS.DOCUMENT_EDIT,
}) {
  if (!ensurePermission(request, response, ACTIONS.DOCUMENT_CREATE)) return false;
  if (!sessionAuthMode) return true;
  const documentNo = String(payload?.[numberField] ?? "").trim();
  if (!documentNo) return true;
  return ensureDocumentAccess(request, response, {
    action: existingAction,
    load: () => cloudRun && documentKind
      ? loadDocumentForAuthorization({ documentKind, documentNo, localLoad: () => loadExisting(documentNo) })
      : loadExisting(documentNo),
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
  if (!sessionAuthMode || request.auth?.role !== "employee") return records;
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

async function bindLineOwner(request, payload, { numberField, documentKind, loadExisting }) {
  if (!sessionAuthMode) return payload;
  const documentNo = String(payload?.[numberField] ?? "").trim();
  if (!documentNo) return { ...payload, ownerUserId: String(request.auth?.userId || "").trim() };
  const existing = await (cloudRun && documentKind
    ? loadDocumentForAuthorization({ documentKind, documentNo, localLoad: () => loadExisting(documentNo) })
    : loadExisting(documentNo)).catch((error) => {
    if (error.message === "Expense request not found" || error.message === "Substitute receipt not found") return null;
    throw error;
  });
  return { ...payload, ownerUserId: String(existing?.payload?.ownerUserId || existing?.ownerUserId || "").trim() };
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
  if (authMode !== "line" && authMode !== "mock") {
    sendJson(response, 200, { authenticated: false, mode: "disabled", user: null });
    return;
  }
  try {
    const session = readRequestSession(request);
    sendJson(response, 200, { authenticated: true, mode: authMode, user: session });
  } catch (error) {
    if (error?.code === "SESSION_CONFIG_MISSING") {
      sendAuthError(response, 503, "AUTH_CONFIG_MISSING", "ระบบยืนยันตัวตนยังไม่ได้ตั้งค่า");
      return;
    }
    sendAuthError(response, 401, "AUTH_REQUIRED", "กรุณาเข้าสู่ระบบผ่าน LINE", { clearCookie: error.code !== "SESSION_MISSING" });
  }
}

function handleMockSession(request, response) {
  if (authMode !== "mock" || !mockAuthConfig.enabled) {
    sendAuthError(response, 404, "MOCK_AUTH_DISABLED", "Mock auth is disabled");
    return;
  }
  if (!mockAuthRequestIsAllowed(request)) {
    sendAuthError(response, 403, "ORIGIN_FORBIDDEN", "คำขอมาจากแหล่งที่ไม่อนุญาต");
    return;
  }
  if (sessionSecret.length < 32) {
    sendAuthError(response, 503, "AUTH_CONFIG_MISSING", "ระบบยืนยันตัวตนยังไม่ได้ตั้งค่า");
    return;
  }
  const user = buildMockSessionUser(mockAuthConfig);
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + sessionTtlSeconds;
  let token;
  try {
    token = signSession({
      userId: user.id,
      lineUserId: user.lineUserId,
      displayName: user.displayName,
      pictureUrl: user.pictureUrl,
      role: user.role,
      iat: issuedAt,
      exp: expiresAt,
    }, sessionSecret);
  } catch (error) {
    if (error?.code === "SESSION_CONFIG_MISSING") {
      sendAuthError(response, 503, "AUTH_CONFIG_MISSING", "ระบบยืนยันตัวตนยังไม่ได้ตั้งค่า");
      return;
    }
    throw error;
  }
  response.setHeader("set-cookie", [buildSessionCookie(token, { secure: cookieSecure, maxAge: sessionTtlSeconds })]);
  sendJson(response, 200, { user, expiresAt });
}

function handleAuthLogout(response) {
  response.setHeader("set-cookie", [clearSessionCookie({ secure: cookieSecure })]);
  sendJson(response, 200, { ok: true });
}

function sendProfileOperationError(response, error, fallback) {
  const providerCodes = new Set([
    "SUPABASE_CONFIG_MISSING",
    "SUPABASE_CONFIG_INVALID",
    "SUPABASE_CLIENT_INVALID",
    "SUPABASE_REQUEST_FAILED",
  ]);
  if (providerCodes.has(error?.code)) {
    sendJson(response, 503, { code: "PROFILE_PROVIDER_UNAVAILABLE", error: "ระบบข้อมูลโปรไฟล์ยังไม่พร้อมใช้งาน" });
    return;
  }
  sendOperationError(response, error, fallback);
}

async function handleAppUserProfileGet(request, response) {
  try {
    if (authMode === "mock" && mockProfileStore) {
      sendJson(response, 200, { profile: mockProfileStore.getProfile(request.auth?.userId) });
      return;
    }
    const profile = await getAppUserProfile({
      client: createSupabaseAdminClient(),
      userId: request.auth?.userId,
    });
    sendJson(response, 200, { profile });
  } catch (error) {
    sendProfileOperationError(response, error, "Cannot read user profile");
  }
}

async function handleAppUserProfilePatch(request, response) {
  try {
    const payload = await readJsonBody(request);
    if (authMode === "mock" && mockProfileStore) {
      const profile = mockProfileStore.updateProfile(request.auth?.userId, payload);
      sendJson(response, 200, { profile });
      return;
    }
    const profile = await updateAppUserProfile({
      client: createSupabaseAdminClient(),
      userId: request.auth?.userId,
      input: payload,
    });
    sendJson(response, 200, { profile });
  } catch (error) {
    sendProfileOperationError(response, error, "Cannot save user profile");
  }
}

async function handleCompanyPositionsGet(response) {
  try {
    if (authMode === "mock" && mockProfileStore) {
      sendJson(response, 200, { positions: mockProfileStore.listPositions() });
      return;
    }
    const positions = await listCompanyPositions({ client: createSupabaseAdminClient() });
    sendJson(response, 200, { positions });
  } catch (error) {
    sendProfileOperationError(response, error, "Cannot read company positions");
  }
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
    "/mock-auth": "/mock-auth.html",
    "/mock-auth/": "/mock-auth.html",
    "/line-intake/auth": "/line-auth.html",
    "/line-intake/auth/": "/line-auth.html",
    "/line-intake": "/line-intake.html",
    "/line-workflow-review": "/line-workflow-review.html",
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
    "/user-profile": "/user-profile.html",
    "/user-profile/": "/user-profile.html",
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
    "/shopee-custom-label": "/shopee-custom-label.html",
    "/shopee-custom-label/": "/shopee-custom-label.html",
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

function buildLineExpensePayload(request, item, body = {}, profileFallback = {}) {
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
    requesterName: firstText(body.requesterName, profileFallback.requesterName, request.auth?.displayName),
    requesterRole: firstText(body.requesterRole, profileFallback.requesterRole),
    requestType: ["reimbursement", "direct_payment"].includes(body.requestType) ? body.requestType : "reimbursement",
    requestTitle: firstText(body.requestTitle, fields.documentNo, fields.description, "ค่าใช้จ่ายจาก LINE"),
    businessPurpose: firstText(body.businessPurpose, fields.description),
    paymentTargetName: firstText(body.paymentTargetName, fields.vendorName),
    vendorSnapshot: { name: firstText(body.paymentTargetName, fields.vendorName), taxId: firstText(body.taxId, fields.taxId) },
    ownerUserId: sessionAuthMode ? String(request.auth?.userId || "") : "",
    expenseLines: lines,
  };
  return payload;
}

async function getLineConfirmationProfile(request) {
  const userId = String(request.auth?.userId || "").trim();
  if (!userId) return null;
  try {
    return await getAppUserProfile({
      client: createSupabaseAdminClient(),
      userId,
    });
  } catch (error) {
    console.warn(`[line-intake] profile fallback unavailable userId=${userId} code=${error.code || "PROFILE_LOOKUP_FAILED"}`);
    return null;
  }
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
  const workflowEvents = [];
  let workflowRetryRequired = false;
  const skipped = [];
  for (const event of Array.isArray(payload.events) ? payload.events : []) {
    if (lineWorkflow.enabled) {
      try {
        const result = await lineWorkflow.chat(event);
        if (result) { workflowEvents.push(result); continue; }
      } catch (error) { workflowRetryRequired = true; skipped.push({ eventId: event.webhookEventId, code: error.code || "LINE_WORKFLOW_FAILED" }); continue; }
    }
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
  sendJson(response, workflowRetryRequired ? 503 : 200, { ok: !workflowRetryRequired, accepted, skipped, ...(lineWorkflow.enabled ? {workflowEvents} : {}) });
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
    const profile = await getLineConfirmationProfile(request);
    const payload = buildLineExpensePayload(request, scanned, body, profileRequesterFallback(profile));
    await assertKnownStockSkuReferences(payload.expenseLines);
    const errors = validateExpenseRequest(payload);
    if (errors.length) {
      sendJson(response, 400, { code: "LINE_INTAKE_CONFIRMATION_INVALID", error: errors.join(", "), errors });
      return;
    }
    if (!await ensureDocumentWriteAccess(request, response, {
      numberField: "requestNo",
      payload,
      documentKind: "expense_request",
      loadExisting: requestNo => getSubmittedExpenseRequest(rootDir, requestNo),
    })) return;
    const original = await lineIntakeStore.readOriginal(scanned);
    const result = await documentDataAdapter.save({
      documentKind: "expense_request",
      documentNo: "",
      payload,
      createOnly: true,
      localSave: () => saveExpenseDraft({
        rootDir,
        payload,
        uploads: [{ evidenceKey: "receipt", originalName: original.fileName, type: original.contentType, buffer: original.bytes }],
        vendorResolver,
        numberAllocator: cloudDocumentNumberAllocator
          ? input => cloudDocumentNumberAllocator({ ...input, requestKey: `line-intake:${intakeId}` })
          : undefined,
        companySettingsResolver: resolveCompanySettings,
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

async function lineWorkflowEvidenceUploads(request,payload,documentKind,files,isNew=!(payload.requestNo||payload.receiptNo||payload.documentNo)) {
  if(!lineWorkflow.enabled||!isNew||!payload.transactionNo)return [];
  const batch=await lineWorkflow.store.findByTransaction({transactionNo:payload.transactionNo});
  if(!batch?.confirmedContext||batch.mode!=="manual")return [];
  await ensureLocalCloudWorkflowTransaction(payload.transactionNo);
  if(sessionAuthMode)assertDocumentAccess(request.auth,await getWorkflowTransaction(rootDir,payload.transactionNo),ACTIONS.DOCUMENT_EDIT);
  const step=batch.templateSnapshot.documentSteps.find(step=>step.stepId===payload.workflowStepId&&step.documentKind===documentKind);
  if(!step)throw new Error("ขั้นตอนเอกสารไม่ตรงกับ Workflow");
  const uploads=[];
  for(const id of batch.evidenceIds){const item=await lineIntakeStore.getForUser(id,batch.lineUserId);const original=await lineIntakeStore.readOriginal(item);if(files.some(file=>file.buffer?.equals(original.bytes)))continue;uploads.push({evidenceKey:documentKind==="substitute_receipt"?"otherEvidence":"receipt",originalName:original.fileName,type:original.contentType,buffer:original.bytes});}
  return uploads;
}

async function handleExpenseSubmission(request, response) {
  try {
    const body = await readRequestBody(request);
    const { fields, files } = parseMultipartForm(body, request.headers["content-type"]);
    const payload = await bindLineOwner(request, JSON.parse(fields.payload || "{}"), {
      numberField: "requestNo",
      documentKind: "expense_request",
      loadExisting: (requestNo) => getSubmittedExpenseRequest(rootDir, requestNo),
    });
    await assertKnownStockSkuReferences(payload.expenseLines);
    if (!await ensureDocumentWriteAccess(request, response, {
      numberField: "requestNo",
      payload,
      documentKind: "expense_request",
      loadExisting: (requestNo) => getSubmittedExpenseRequest(rootDir, requestNo),
      existingAction: ACTIONS.DOCUMENT_SUBMIT,
    })) return;
    if (cloudRun && payload.requestNo) await ensureLocalCloudDocument({ documentKind: "expense_request", documentNo: payload.requestNo, localLoad: () => getSubmittedExpenseRequest(rootDir, payload.requestNo) });
    files.push(...await lineWorkflowEvidenceUploads(request,payload,"expense_request",files));
    const result = await documentDataAdapter.save({
      documentKind: "expense_request",
      documentNo: payload.requestNo,
      payload,
      expectedSourceHash: takeCloudDocumentSourceHash("expense_request", payload.requestNo),
      createOnly: !payload.requestNo,
      localSave: () => saveExpenseSubmission({
        rootDir,
        payload,
        uploads: files,
        vendorResolver,
        numberAllocator: cloudDocumentNumberAllocator,
        companySettingsResolver: resolveCompanySettings,
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
      documentKind: "substitute_receipt",
      loadExisting: (receiptNo) => getSubmittedSubstituteReceipt(rootDir, receiptNo),
    });
    await assertKnownStockSkuReferences(payload.lines);
    if (!await ensureDocumentWriteAccess(request, response, {
      numberField: "receiptNo",
      payload,
      documentKind: "substitute_receipt",
      loadExisting: (receiptNo) => getSubmittedSubstituteReceipt(rootDir, receiptNo),
      existingAction: ACTIONS.DOCUMENT_SUBMIT,
    })) return;
    if (cloudRun && payload.receiptNo) await ensureLocalCloudDocument({ documentKind: "substitute_receipt", documentNo: payload.receiptNo, localLoad: () => getSubmittedSubstituteReceipt(rootDir, payload.receiptNo) });
    files.push(...await lineWorkflowEvidenceUploads(request,payload,"substitute_receipt",files));
    const result = await documentDataAdapter.save({
      documentKind: "substitute_receipt",
      documentNo: payload.receiptNo,
      payload,
      expectedSourceHash: takeCloudDocumentSourceHash("substitute_receipt", payload.receiptNo),
      createOnly: !payload.receiptNo,
      localSave: () => saveSubstituteReceiptSubmission({
        rootDir,
        payload,
        uploads: files,
        vendorResolver,
        numberAllocator: cloudDocumentNumberAllocator,
        companySettingsResolver: resolveCompanySettings,
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
      documentKind: "substitute_receipt",
      loadExisting: (receiptNo) => getSubmittedSubstituteReceipt(rootDir, receiptNo),
    });
    await assertKnownStockSkuReferences(payload.lines);
    if (!await ensureDocumentWriteAccess(request, response, {
      numberField: "receiptNo",
      payload,
      documentKind: "substitute_receipt",
      loadExisting: (receiptNo) => getSubmittedSubstituteReceipt(rootDir, receiptNo),
    })) return;
    if (cloudRun && payload.receiptNo) await ensureLocalCloudDocument({ documentKind: "substitute_receipt", documentNo: payload.receiptNo, localLoad: () => getSubmittedSubstituteReceipt(rootDir, payload.receiptNo) });
    files.push(...await lineWorkflowEvidenceUploads(request,payload,"substitute_receipt",files));
    const result = await documentDataAdapter.save({
      documentKind: "substitute_receipt",
      documentNo: payload.receiptNo,
      payload,
      expectedSourceHash: takeCloudDocumentSourceHash("substitute_receipt", payload.receiptNo),
      createOnly: !payload.receiptNo,
      localSave: () => saveSubstituteReceiptDraft({
        rootDir,
        payload,
        uploads: files,
        vendorResolver,
        numberAllocator: cloudDocumentNumberAllocator,
        companySettingsResolver: resolveCompanySettings,
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
      inventoryCloudRepository,
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
      await ensureLocalCloudDocument({
        documentKind: fileRoute.documentKind,
        documentNo: fileRoute.documentNo,
        localLoad: () => getWorkflowDocument(rootDir, fileRoute.documentKind, fileRoute.documentNo),
      });
      await refreshWorkflowDocumentCompanySettings({
        rootDir,
        documentKind: fileRoute.documentKind,
        documentNo: fileRoute.documentNo,
        companySettingsResolver: resolveCompanySettings,
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
    response.writeHead(200, fileRoute.section === "pdf"
      ? pdfResponseHeaders({ fileName: fileRoute.fileName })
      : { "content-type": contentType });
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
    const expectedSourceHash = cloudRun && requestedDocumentNo
      ? await documentDataAdapter.getSourceHash({ documentKind: data.documentKind, documentNo: requestedDocumentNo })
      : undefined;
    if (cloudRun && requestedDocumentNo) {
      await ensureLocalCloudDocument({
        documentKind: data.documentKind,
        documentNo: requestedDocumentNo,
        localLoad: () => getWorkflowDocument(rootDir, data.documentKind, requestedDocumentNo),
      });
    }
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
      const nextInfo = cloudRun
        ? await documentDataAdapter.allocateAccountingDocumentNumber({ documentKind: data.documentKind, accountingMonth: data.accountingMonth })
        : await getNextWorkflowDocumentInfo(rootDir, data.documentKind, data.accountingMonth);
      serverOwnedFields = {
        documentNo: nextInfo.documentNo || "",
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
    const company = await resolveCompanySettings();
    const payload = buildWorkflowDocumentPayload({ ...data, company, ...serverOwnedFields });
    files.push(...await lineWorkflowEvidenceUploads(request,payload,payload.documentKind,files,!existingDocument));
    const result = await documentDataAdapter.save({
      documentKind: payload.documentKind,
      documentNo: payload.documentNo,
      payload,
      expectedSourceHash,
      createOnly: !requestedDocumentNo,
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
function fileEntryWithAccessToken(file, request) {
  const publicFile = omitAbsolutePathFromFileEntry(file);
  if (!publicFile?.url || authMode !== "line" || !request?.auth) return publicFile;
  const fileUrl = new URL(publicFile.url, "http://sweet-house.local");
  const fileToken = issueFileAccessToken({
    secret: sessionSecret,
    path: fileUrl.pathname,
    auth: request.auth,
  });
  fileUrl.searchParams.set("fileToken", fileToken);
  return { ...publicFile, url: `${fileUrl.pathname}${fileUrl.search}` };
}

function omitAbsolutePathsFromWorkflowTransactionResponse(record, request) {
  if (!record) return record;
  return {
    ...record,
    pdfFiles: Array.isArray(record.pdfFiles) ? record.pdfFiles.map((file) => fileEntryWithAccessToken(file, request)) : record.pdfFiles,
    childDocuments: Array.isArray(record.childDocuments)
      ? record.childDocuments.map((doc) => ({
        ...doc,
        pdfFiles: Array.isArray(doc.pdfFiles) ? doc.pdfFiles.map((file) => fileEntryWithAccessToken(file, request)) : doc.pdfFiles,
        rawFiles: Array.isArray(doc.rawFiles) ? doc.rawFiles.map((file) => fileEntryWithAccessToken(file, request)) : doc.rawFiles,
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
    const visible = sessionAuthMode && request.auth?.role === "employee"
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
    sendJson(response, 200, { templates: await listRuntimeWorkflowTemplates() });
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

    const existing = await getRuntimeWorkflowTemplate(templateId);
    const expectedSourceHash = cloudRun && existing
      ? await documentDataAdapter.getSourceHash({ documentKind: "workflow_template", documentNo: templateId })
      : undefined;

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

    const validationErrors = validateWorkflowTemplate(template);
    if (validationErrors.length) throw new Error(validationErrors.join(", "));
    let saved;
    if (cloudRun) {
      saved = normalizeWorkflowTemplate({ ...template, createdAt: template.createdAt || existing?.createdAt });
      await documentDataAdapter.save({
        documentKind: "workflow_template",
        documentNo: templateId,
        payload: saved,
        expectedSourceHash,
        createOnly: !existing,
        localSave: async () => saved,
      });
    } else {
      saved = await saveWorkflowTemplate({ rootDir, template });
    }
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
    const result = cloudRun
      ? await documentDataAdapter.peekWorkflowTransactionNumber(accountingMonth)
      : await getNextWorkflowTransactionInfo(rootDir, accountingMonth);
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
    let result = await documentDataAdapter.list({ localResult, documentKind: "workflow_transaction" });
    if (cloudRun && result.length > 0) {
      // Older Cloud Run versions could complete every child without writing
      // the derived parent status back to Supabase. Re-derive list status from
      // the durable child records so those already-completed transactions do
      // not remain labelled as in progress until someone reopens them.
      const childRecords = await documentDataAdapter.list({
        localResult: [],
        filters: { documentKinds: ["expense_request", "substitute_receipt", ...LIGHTWEIGHT_DOCUMENT_KINDS] },
      });
      const childrenByTransaction = new Map();
      for (const child of childRecords) {
        const transactionNo = String(child.transactionNo || "").trim();
        if (!transactionNo) continue;
        const children = childrenByTransaction.get(transactionNo) || [];
        children.push(child);
        childrenByTransaction.set(transactionNo, children);
      }
      result = result.map((transaction) => {
        if (transaction.status !== "in_progress" || transaction.completedAt) return transaction;
        const derived = deriveWorkflowProgress(transaction, childrenByTransaction.get(transaction.transactionNo) || []);
        return { ...transaction, status: derived.status, steps: derived.steps, currentStepId: derived.currentStepId };
      });
    }
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
    const requestKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";

    if (!templateId) throw new Error("ระบุรหัส template");
    if (!isValidAccountingMonth(accountingMonth)) {
      throw new Error("รูปแบบเดือนบัญชีไม่ถูกต้อง กรุณาระบุเป็น YYYY-MM");
    }
    if (!title) throw new Error("ระบุชื่อธุรกรรม");

    let allocation = null;
    if (cloudRun) {
      allocation = await documentDataAdapter.allocateWorkflowTransactionNumber({
        accountingMonth,
        requestKey,
      });
      if (allocation.existing) {
        const existingCloud = await documentDataAdapter.get({
          localResult: null,
          documentKind: "workflow_transaction",
          documentNo: allocation.transactionNo,
        });
        if (existingCloud) {
          const existing = await ensureLocalCloudWorkflowTransaction(allocation.transactionNo);
          if (existing) {
            sendJson(response, 200, existing);
            return;
          }
        }
      }
      if (allocation.existing) {
        // The durable request reservation exists but its document row does not.
        // This is a retry after a cloud write failed; reuse the same number and
        // complete the original create instead of allocating another number.
        allocation = { ...allocation, existing: false };
      }
    }

    const result = await startWorkflowTransaction({
      rootDir,
      templateId,
      accountingMonth,
      title,
      ownerUserId: String(request.auth?.userId || "").trim(),
      allocation,
    });
    if (cloudRun) {
      await documentDataAdapter.save({
        documentKind: "workflow_transaction",
        documentNo: result.transactionNo,
        payload: result,
        localSave: async () => result,
      });
    }
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "ไม่สามารถเริ่มธุรกรรมได้",
      ...(error?.causeCode ? { causeCode: error.causeCode } : {}),
    });
  }
}

async function handleWorkflowTransactionGet(transactionNo, request, response) {
  try {
    await ensureLocalCloudWorkflowTransaction(transactionNo);
    const record = await getWorkflowTransactionDetail(rootDir, transactionNo);
    if (!record) throw new Error("ไม่พบธุรกรรม");
    sendJson(response, 200, omitAbsolutePathsFromWorkflowTransactionResponse(record, request));
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
    await refreshWorkflowTransaction({ rootDir, transactionNo, regeneratePacket });
    await persistCloudWorkflowTransactionMutation(transactionNo, {
      retryMutation: () => refreshWorkflowTransaction({ rootDir, transactionNo, regeneratePacket }),
    });
    const result = await getWorkflowTransactionDetail(rootDir, transactionNo);
    sendJson(response, 200, omitAbsolutePathsFromWorkflowTransactionResponse(result, request));
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
    await persistCloudWorkflowTransactionMutation(transactionNo, {
      retryMutation: () => completeWorkflowTransaction({
        rootDir,
        transactionNo,
        completedBy: actorForRequest(request, body.completedBy),
      }),
    });
    sendJson(response, 200, omitAbsolutePathsFromWorkflowTransactionResponse(result, request));
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
      inventoryCloudRepository,
      transactionNo,
      confirmed: body.confirmed,
      cancelledBy: actorForRequest(request, body.cancelledBy),
    });
    await persistCloudWorkflowTransactionMutation(transactionNo, {
      snapshot: result,
      retryMutation: () => cancelWorkflowTransaction({
        rootDir,
        inventoryCloudRepository,
        transactionNo,
        confirmed: body.confirmed,
        cancelledBy: actorForRequest(request, body.cancelledBy),
      }),
    });
    const statusCode = result.httpStatus || 200;
    sendJson(response, statusCode, { ...omitAbsolutePathsFromWorkflowTransactionResponse(result, request), ...(result.code ? { code: result.code } : {}) });
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
    let result;
    try {
      result = await syncWorkflowTransactionToSheets({ rootDir, transactionNo });
    } catch (error) {
      await persistCloudWorkflowTransactionMutation(transactionNo);
      throw error;
    }
    const persistedTransaction = await persistCloudWorkflowTransactionMutation(transactionNo, {
      retryMutation: async () => {
        result = await syncWorkflowTransactionToSheets({ rootDir, transactionNo });
      },
    });
    if (persistedTransaction?.sheetSync) result = persistedTransaction.sheetSync;
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

async function handleWorkflowTransactionPrefill(transactionNo, url, response, request) {
  try {
    await ensureLocalCloudWorkflowTransaction(transactionNo);
    const documentKind = url.searchParams.get("documentKind") || "";
    const stepId = url.searchParams.get("stepId") || "";
    if (!stepId) throw new Error("ระบุขั้นตอนของ Workflow");
    if (sessionAuthMode) assertDocumentAccess(request.auth, await getWorkflowTransaction(rootDir, transactionNo), ACTIONS.DOCUMENT_READ);
    const result = await getWorkflowTransactionPrefill({ rootDir, transactionNo, documentKind, stepId });
    if (lineWorkflow.enabled) {
      const batch = await lineWorkflow.store.findByTransaction({transactionNo});
      if (batch?.confirmedContext) {
        result.autoApplyConfirmed = true;
        result.invoiceEvidenceCount=batch.evidenceIds.length;
        const invoice=batch.confirmedContext.invoice;
        result.invoiceDefaults={accountingMonth:invoice.accountingMonth,expenseDate:invoice.expenseDate,receiptDate:invoice.expenseDate,documentDate:invoice.expenseDate,paymentChannel:invoice.paymentChannel,paymentReference:invoice.paymentReference};
        for (const group of ["payee", "purpose", "lines", "parties"]) {
          const baseline = batch.confirmedContext[group];
          const current = result.context[group];
          const present = Array.isArray(current) ? current.length : current && Object.keys(current).length;
          if (!present && baseline) { result.context[group] = baseline; result.sources[group] = "ข้อมูลที่ยืนยันจากใบกำกับภาษี"; if (!result.availableGroups.includes(group) && group !== "parties") result.availableGroups.push(group); }
        }
      }
    }
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, error.statusCode || 400, {
      error: error.message || "ไม่สามารถดึงข้อมูลเติมล่วงหน้าได้",
    });
  }
}

function buildWorkflowStepOpenUrl({ route, documentKind, documentNo, transactionNo, workflowTemplateId, workflowStepId, returnTo, receiptType }) {
  const [pathname, search = ""] = String(route || "").split("?", 2);
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries({ transactionNo, workflowTemplateId, workflowStepId, returnTo })) {
    if (value) params.set(key, value);
  }
  // Child pages use this discriminator to select and initialize the correct
  // form. Without it, workflow links open the default shell and the saved
  // transaction/step identity is lost from the child page context.
  if (documentKind) params.set("documentKind", documentKind);
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
  return `${pathname}?${params.toString()}`;
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
    response.writeHead(200, fileRoute.section === "pdf"
      ? pdfResponseHeaders({ fileName: fileRoute.fileName, download: true })
      : { "content-type": contentType });
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
    const settings = cloudDataRepository
      ? await cloudDataRepository.getCompanySettings()
      : await getCompanySettings(rootDir);
    sendJson(response, 200, settings);
  } catch (error) {
    sendJson(response, 400, {
      error: error.message || "Cannot read company settings",
    });
  }
}

async function handleCompanySettingsSave(request, response) {
  try {
    const payload = await readJsonBody(request);
    const settings = {
      rootDir,
      legalName: payload.legalName,
      taxId: payload.taxId,
      branch: payload.branch,
      address: payload.address,
    };
    let result;
    if (cloudDataRepository) {
      const normalized = normalizeCompanySettings(payload);
      if (!normalized.legalName) throw new Error("Missing company legal name");
      result = await cloudDataRepository.saveCompanySettings(normalized);
    } else {
      result = await saveCompanySettings(settings);
    }
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
      documentKind: "expense_request",
      loadExisting: (requestNo) => getSubmittedExpenseRequest(rootDir, requestNo),
    });
    await assertKnownStockSkuReferences(payload.expenseLines);
    if (!await ensureDocumentWriteAccess(request, response, {
      numberField: "requestNo",
      payload,
      documentKind: "expense_request",
      loadExisting: (requestNo) => getSubmittedExpenseRequest(rootDir, requestNo),
    })) return;
    if (cloudRun && payload.requestNo) {
      await ensureLocalCloudDocument({ documentKind: "expense_request", documentNo: payload.requestNo, localLoad: () => getSubmittedExpenseRequest(rootDir, payload.requestNo) });
    }
    files.push(...await lineWorkflowEvidenceUploads(request,payload,"expense_request",files));
    const result = await documentDataAdapter.save({
      documentKind: "expense_request",
      documentNo: payload.requestNo || payload.draftId,
      payload,
      expectedSourceHash: takeCloudDocumentSourceHash("expense_request", payload.requestNo),
      createOnly: !payload.requestNo,
      localSave: () => saveExpenseDraft({
        rootDir,
        payload,
        uploads: files,
        vendorResolver,
        numberAllocator: cloudDocumentNumberAllocator,
        companySettingsResolver: resolveCompanySettings,
      }),
    });

    sendJson(response, 200, result);
  } catch (error) {
    sendOperationError(response, error, "Cannot save draft");
  }
}

async function handleDraftList(response) {
  try {
    const result = cloudRun
      ? (await documentDataAdapter.list({ localResult: [], documentKind: "expense_request", filters: { status: "draft" } }))
        .filter(document => document.status === "draft")
        .map(document => ({
          draftId: document.requestNo || document.documentNo,
          status: document.status,
          requestTitle: document.requestTitle || "ยังไม่ได้ตั้งชื่อ",
          requesterName: document.requesterName || "",
          accountingMonth: document.accountingMonth || "",
          updatedAt: document.updatedAt || "",
          rawFileCount: Array.isArray(document.rawFiles) ? document.rawFiles.length : 0,
        }))
      : await listExpenseDrafts(rootDir);
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
    if (/^REQ-\d{4}-(0[1-9]|1[0-2])-\d{4}$/.test(draftId)) {
      return handleSubmittedExpenseRequestGet(draftId, response);
    }
    if (cloudRun) throw new Error("ไม่พบแบบร่างเก่าใน Supabase");
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
    if (/^SR-\d{4}-(0[1-9]|1[0-2])-\d{4}$/.test(draftId)) {
      return handleSubmittedSubstituteReceiptGet(draftId, response);
    }
    if (cloudRun) throw new Error("ไม่พบแบบร่างเก่าใน Supabase");
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
    const result = cloudRun
      ? await documentDataAdapter.allocateAccountingDocumentNumber({ documentKind: "expense_request", accountingMonth, allocate: false })
      : await getNextExpenseRequestInfo(rootDir, accountingMonth);
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
    const result = cloudRun
      ? await documentDataAdapter.allocateAccountingDocumentNumber({ documentKind: "substitute_receipt", accountingMonth, allocate: false })
      : await getNextSubstituteReceiptInfo(rootDir, accountingMonth);
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
    sendJson(response, 200, (inventoryCloudRepository ? await inventoryCloudRepository.getProductDetail(productId) : getInventoryProductDetail(rootDir, productId)));
  } catch (error) {
    sendJson(response, 404, { error: error.message || "Cannot load product detail" });
  }
}

async function handleInventoryCategoryList(url, response) {
  try {
    const includeInactive = url.searchParams.get("includeInactive") === "1";
    sendJson(response, 200, { categories: (inventoryCloudRepository ? await inventoryCloudRepository.listProductCategories({ includeInactive }) : listProductCategories(rootDir, { includeInactive })) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot list product categories" });
  }
}

async function handleInventoryCategoryCreate(request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { category: (inventoryCloudRepository ? await inventoryCloudRepository.saveProductCategory(payload) : createProductCategory(rootDir, payload)) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot create product category" });
  }
}

async function handleInventoryCategoryUpdate(categoryId, request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { category: (inventoryCloudRepository ? await inventoryCloudRepository.saveProductCategory({ ...payload, id: categoryId }) : updateProductCategory(rootDir, categoryId, payload)) });
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
    sendJson(response, 200, (inventoryCloudRepository ? await inventoryCloudRepository.uploadInventoryImage("product", productId, file) : await saveProductImage(rootDir, productId, file)));
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
    sendJson(response, 200, (inventoryCloudRepository ? await inventoryCloudRepository.uploadInventoryImage("stock_sku", stockSkuId, file) : await saveStockSkuImage(rootDir, stockSkuId, file)));
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
    sendJson(response, 200, { saleSkus: (inventoryCloudRepository ? await inventoryCloudRepository.listSaleSkus({ search: url.searchParams.get("search") || "" }) : listSaleSkus(rootDir, { search: url.searchParams.get("search") || "" })) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot list sale SKUs" });
  }
}

async function handleInventorySaleSkuGet(saleSkuId, response) {
  try {
    sendJson(response, 200, { saleSku: (inventoryCloudRepository ? await inventoryCloudRepository.getSaleSku(saleSkuId) : getSaleSku(rootDir, saleSkuId)) });
  } catch (error) {
    sendJson(response, 404, { error: error.message || "Cannot load sale SKU" });
  }
}

async function handleInventorySaleSkuCreate(request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { saleSku: (inventoryCloudRepository ? await inventoryCloudRepository.saveSaleSku(payload) : createSaleSku(rootDir, payload)) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot create sale SKU" });
  }
}

async function handleInventorySaleSkuUpdate(saleSkuId, request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { saleSku: (inventoryCloudRepository ? await inventoryCloudRepository.saveSaleSku({ ...payload, id: saleSkuId }) : updateSaleSku(rootDir, saleSkuId, payload)) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot update sale SKU" });
  }
}

async function handlePlatformOrderImportList(response) {
  try {
    const imports = cloudCommerceService
      ? await cloudCommerceService.listPlatformOrderImports()
      : listPlatformOrderImports(rootDir);
    sendJson(response, 200, { imports: imports.map(item => cloudCommerceService ? platformOrderImportSummary(item) : item) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot list platform order imports" });
  }
}

function platformOrderImportSummary(item = {}) {
  const value = item.import || item;
  return {
    id: value.id || value.importNo,
    importNo: value.importNo || value.id,
    platform: value.platform || "manual",
    fileName: value.fileName || "",
    status: value.status || "imported",
    rowCount: Number(value.rowCount || 0),
    matchedLineCount: Number(value.matchedLineCount || 0),
    issueCount: Number(value.issueCount || 0),
    postedAt: value.postedAt || "",
    createdAt: value.createdAt || "",
    updatedAt: value.updatedAt || "",
  };
}

function platformOrderImportDetail(payload = {}) {
  const value = payload.import ? payload : {
    import: payload,
    orders: payload.orders || [],
    lines: payload.lines || [],
    postedMovements: payload.postedMovements || [],
  };
  const importRow = platformOrderImportSummary(value.import);
  return {
    import: importRow,
    orders: value.orders || [],
    lines: value.lines || [],
    ...(value.postedMovements ? { postedMovements: value.postedMovements } : {}),
  };
}

async function createCloudPlatformOrderImport(parsed, { platform, fileName }) {
  const timestamp = new Date().toISOString();
  const importNo = `IMP-${timestamp.slice(0, 10).replace(/-/g, "")}-${randomUUID()}`;
  const [saleSkus, balances] = await Promise.all([
    inventoryCloudRepository.listSaleSkus({ includeInactive: false }),
    inventoryCloudRepository.listInventoryBalances(),
  ]);
  const bySku = new Map(balances.map(item => [String(item.id), item]));
  const remaining = new Map(balances.map(item => [String(item.id), Number(item.availableQuantity || 0)]));
  const orders = new Map();
  const lines = [];
  let matchedLineCount = 0;
  let issueCount = 0;

  for (const row of parsed.rows) {
    const orderKey = `${platform}:${row.orderNo}`;
    if (!orders.has(orderKey)) orders.set(orderKey, {
      id: orderKey,
      importId: importNo,
      platform,
      orderNo: row.orderNo,
      orderDate: row.orderDate || "",
      orderStatus: row.orderStatus || "",
      buyerName: row.buyerName || "",
      createdAt: timestamp,
    });
    const lineId = `${importNo}:${orderKey}:${row.lineNo}:${row.saleSku}`;
    const referenceNo = `${platform}:${row.orderNo}:${row.lineNo}:${row.saleSku}`;
    const candidates = saleSkus.filter(item => String(item.saleSku || "").trim().toUpperCase() === String(row.saleSku || "").trim().toUpperCase());
    const ranked = candidates.sort((a, b) => (a.platform === platform ? 0 : a.platform === "manual" ? 1 : 2) - (b.platform === platform ? 0 : b.platform === "manual" ? 1 : 2));
    const bestRank = ranked[0] ? (ranked[0].platform === platform ? 0 : ranked[0].platform === "manual" ? 1 : 2) : -1;
    const best = ranked.filter(item => (item.platform === platform ? 0 : item.platform === "manual" ? 1 : 2) === bestRank);
    const saleSku = best.length === 1 ? best[0] : null;
    let matchStatus = row.skipped ? "skipped_status" : "matched";
    let issueMessage = "";
    let components = [];
    if (!row.skipped && row.quantity <= 0) {
      matchStatus = "invalid_quantity";
      issueMessage = "จำนวนสินค้าไม่ถูกต้อง";
    } else if (!row.skipped && !saleSku) {
      matchStatus = "missing_sale_sku";
      issueMessage = candidates.length ? "พบ Sale SKU มากกว่าหนึ่งรายการ" : "ไม่พบ Sale SKU";
    } else if (!row.skipped) {
      components = (saleSku.components || []).map(component => {
        const balance = bySku.get(String(component.stockSkuId));
        const componentQuantity = Number(component.quantity || 0);
        const requiredQuantity = componentQuantity * row.quantity;
        return {
          stockSkuId: component.stockSkuId,
          sku: component.sku || "",
          color: component.color || "",
          size: component.size || "",
          productCode: component.productCode || "",
          productName: component.productName || "",
          componentQuantity,
          requiredQuantity,
          quantityOnHand: Number(balance?.quantityOnHand || 0),
          reservedQuantity: Number(balance?.reservedQuantity || 0),
          availableQuantity: Number(remaining.get(String(component.stockSkuId)) || 0),
          unitCost: Number(component.defaultUnitCost || 0),
        };
      });
      if (!components.length || components.some(component => !bySku.has(String(component.stockSkuId)))) {
        matchStatus = "missing_sale_sku";
        issueMessage = "Sale SKU อ้างอิง Stock SKU ที่ไม่พบ";
      } else if (components.some(component => component.availableQuantity < component.requiredQuantity)) {
        matchStatus = "insufficient_stock";
        issueMessage = "สต๊อกไม่พอสำหรับรายการที่เลือก";
      } else {
        for (const component of components) remaining.set(String(component.stockSkuId), component.availableQuantity - component.requiredQuantity);
      }
    }
    if (matchStatus === "matched") matchedLineCount += 1;
    else if (matchStatus !== "skipped_status") issueCount += 1;
    lines.push({
      id: lineId,
      orderLineKey: `platform_order_import:${lineId}`,
      importId: importNo,
      orderId: orderKey,
      platform,
      orderNo: row.orderNo,
      lineNo: row.lineNo,
      saleSku: row.saleSku,
      displayName: row.displayName || "",
      quantity: row.quantity,
      saleSkuId: saleSku?.id || null,
      matchStatus,
      issueMessage,
      postedAt: "",
      createdAt: timestamp,
      postable: matchStatus !== "skipped_status",
      referenceNo,
      components,
    });
  }
  const status = lines.filter(line => line.postable).every(line => line.matchStatus === "matched") ? "ready" : "has_issues";
  const payload = {
    id: importNo,
    importNo,
    platform,
    fileName,
    status,
    rowCount: lines.length,
    matchedLineCount,
    issueCount,
    postedAt: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    orders: [...orders.values()],
    lines,
  };
  return platformOrderImportDetail(await cloudCommerceService.savePlatformOrderImport(payload));
}

async function handlePlatformOrderImportDetail(importId, response) {
  try {
    const detail = cloudCommerceService
      ? await cloudCommerceService.getPlatformOrderImport(importId)
      : getPlatformOrderImport(rootDir, importId);
    if (!detail) throw new Error("ไม่พบ import");
    sendJson(response, 200, cloudCommerceService ? platformOrderImportDetail(detail) : detail);
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
    if (cloudCommerceService) {
      const normalizedPlatform = normalizePlatform(platform);
      const parsed = parsePlatformOrderFile(file.buffer, { platform: normalizedPlatform });
      if (parsed.duplicateKeys.length) throw new Error(`ไฟล์มีรายการซ้ำ: ${parsed.duplicateKeys.join(", ")}`);
      sendJson(response, 200, await createCloudPlatformOrderImport(parsed, { platform: normalizedPlatform, fileName: file.originalName || "orders.csv" }));
      return;
    }
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
    if (!cloudCommerceService) {
      sendJson(response, 200, postPlatformOrderImport(rootDir, importId));
      return;
    }
    const detail = await cloudCommerceService.getPlatformOrderImport(importId);
    if (!detail) throw new Error("ไม่พบ import");
    if (detail.status === "posted") {
      sendJson(response, 200, platformOrderImportDetail(detail));
      return;
    }
    if (detail.status !== "ready") throw new Error("ยังมีรายการที่ต้องแก้ไขก่อนตัดสต๊อก");
    const requestedTestDate = process.env.NODE_ENV === "test" ? String(process.env.SWEET_HOUSE_E2E_MOVEMENT_DATE || "").trim() : "";
    const postedAt = /^\d{4}-\d{2}-\d{2}$/.test(requestedTestDate)
      ? `${requestedTestDate}T00:00:00.000Z`
      : new Date().toISOString();
    const movementRecords = [];
    const orderLineKeys = [];
    for (const line of detail.lines.filter(item => item.postable && item.matchStatus === "matched" && !item.postedAt)) {
      orderLineKeys.push(line.orderLineKey);
      for (const component of line.components || []) {
        const id = await inventoryCloudRepository.allocateSourceId();
        movementRecords.push({
          source_key: `stock_movement:${id}`,
          source_id: id,
          stock_sku_source_id: component.stockSkuId,
          movement_type: "sale_out",
          movement_date: postedAt.slice(0, 10),
          quantity: component.requiredQuantity,
          unit_cost: Number(component.unitCost || 0).toFixed(2),
          total_cost: (Math.round(Number(component.unitCost || 0) * component.requiredQuantity * 100) / 100).toFixed(2),
          reference_type: "platform_order",
          reference_no: line.referenceNo,
          note: `Platform order import ${detail.importNo}`,
          created_at: postedAt,
          source_hash: "",
          source_payload: { id, importNo: detail.importNo, orderLineKey: line.orderLineKey },
          idempotency_key: `platform-order:${line.referenceNo}:${component.stockSkuId}`,
        });
      }
    }
    const lines = detail.lines.map(line => line.postable && line.matchStatus === "matched" ? { ...line, postedAt } : line);
    const result = await cloudCommerceService.postPlatformOrderImport(importId, {
      postedAt,
      movementRecords,
      orderLineKeys,
      importPatch: { lines },
      idempotencyKey: `import-post:${importId}`,
    });
    sendJson(response, 200, platformOrderImportDetail(result));
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot post platform order import" });
  }
}

async function handleShopeeOrderList(url, response) {
  try {
    sendJson(response, 200, {
      orders: cloudCommerceService
        ? await cloudCommerceService.listShopeeOrders({
          shopId: url.searchParams.get("shopId") || url.searchParams.get("connectionId") || "",
          status: url.searchParams.get("status") || "",
          limit: url.searchParams.get("limit") || 100,
        })
        : listShopeeOrders(rootDir, {
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
    const line = cloudCommerceService
      ? await cloudCommerceService.saveShopeeOrderLineMapping({ lineId, ...payload })
      : saveShopeeOrderLineMapping(rootDir, lineId, payload);
    sendJson(response, 200, { line });
  } catch (error) {
    sendOperationError(response, error, "ไม่สามารถบันทึก mapping Stock SKU ได้");
  }
}

function customLabelFileUrl(jobId, kind, request) {
  const filePath = `/api/shopee/custom-labels/${encodeURIComponent(jobId)}/${kind}`;
  if (authMode !== "line" || !request?.auth) return filePath;
  const fileUrl = new URL(filePath, "http://sweet-house.local");
  const fileToken = issueFileAccessToken({
    secret: sessionSecret,
    path: fileUrl.pathname,
    auth: request.auth,
  });
  fileUrl.searchParams.set("fileToken", fileToken);
  return `${fileUrl.pathname}${fileUrl.search}`;
}

function publicCustomLabelJob(job, request) {
  if (!job) return null;
  return {
    id: job.id,
    originalFileName: job.originalFileName,
    pageCount: job.pageCount,
    pages: job.parsedPayload?.pages || [],
    autofillMappings: job.parsedPayload?.autofillMappings || {},
    savedMappings: job.savedMappings || {},
    status: job.status,
    errorMessage: job.errorMessage || "",
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    sourceUrl: customLabelFileUrl(job.id, "source", request),
    previewUrl: job.previewFilePath
      ? customLabelFileUrl(job.id, "preview-file", request) : "",
    outputUrl: job.outputFilePath
      ? customLabelFileUrl(job.id, "output", request) : "",
    comparisonUrl: (job.outputFilePath || job.previewFilePath)
      ? customLabelFileUrl(job.id, "comparison", request) : "",
    downloadUrl: job.outputFilePath
      ? customLabelFileUrl(job.id, "download", request) : "",
  };
}

async function persistCustomLabelArtifact(jobId, kind, filePath) {
  if (!customLabelStorageClient) return;
  await uploadStorageObject(customLabelStorageClient, {
    objectPath: customLabelStorageObjectPath(jobId, kind),
    body: await readFile(filePath),
    contentType: "application/pdf",
  });
}

async function readPersistedCustomLabelArtifact(jobId, kind) {
  if (!customLabelStorageClient) throw new Error("Custom label storage is unavailable");
  return downloadStorageObject(customLabelStorageClient, customLabelStorageObjectPath(jobId, kind));
}

async function createPersistedCustomLabelComparison(jobId) {
  const directory = await mkdtemp(path.join(tmpdir(), "sweet-house-custom-label-comparison-"));
  try {
    const sourcePath = path.join(directory, "source.pdf");
    const generatedPath = path.join(directory, "generated.pdf");
    const outputPath = path.join(directory, "comparison.pdf");
    await writeFile(sourcePath, await readPersistedCustomLabelArtifact(jobId, "source"));
    let generated;
    try {
      generated = await readPersistedCustomLabelArtifact(jobId, "output");
    } catch {
      generated = await readPersistedCustomLabelArtifact(jobId, "preview");
    }
    await writeFile(generatedPath, generated);
    await compareCustomLabelFiles(sourcePath, generatedPath, outputPath, {
      pythonBin: process.env.SWEET_HOUSE_PYTHON_BIN || undefined,
    });
    await persistCustomLabelArtifact(jobId, "comparison", outputPath);
    return {
      body: await readFile(outputPath),
      fileName: "shopee-custom-label-comparison.pdf",
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function saveCloudCustomLabelJob(job) {
  return cloudCommerceService.saveCustomLabelJob({ ...job,
    sourceFilePath: "source.pdf", previewFilePath: job.previewFilePath ? "preview.pdf" : "",
    outputFilePath: job.outputFilePath ? "output.pdf" : "",
  });
}

async function materializeCloudCustomLabelJob(jobId) {
  const job = await cloudCommerceService.getCustomLabelJob(jobId);
  if (!job) throw new Error("ไม่พบ custom label job");
  customLabelStorageObjectPath(jobId, "source");
  const directory = path.join(rootDir, "data", "shopee-custom-labels", String(jobId));
  await mkdir(directory, { recursive: true });
  const sourceFilePath = path.join(directory, "source.pdf");
  await writeFile(sourceFilePath, await readPersistedCustomLabelArtifact(jobId, "source"));
  return { ...job, sourceFilePath };
}

async function handleCustomLabelUpload(request, response) {
  try {
    const body = await readRequestBody(request);
    const { files } = parseMultipartForm(body, request.headers["content-type"]);
    const file = files.find((upload) => upload.evidenceKey === "file") || files[0];
    let job = await parseCustomLabelUpload(rootDir, file, {
      pythonBin: process.env.SWEET_HOUSE_PYTHON_BIN || undefined,
      ...(cloudCommerceService ? { createJob: payload => ({ ...payload, id: randomUUID(), status: "parsed", savedMappings: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }) } : {}),
      ...(cloudDataRepository
        ? { mappingLoader: keys => cloudDataRepository.listShopeeCustomLabelMappings(keys) }
        : {}),
    });
    await persistCustomLabelArtifact(job.id, "source", job.sourceFilePath);
    if (cloudCommerceService) {
      try { job = await saveCloudCustomLabelJob(job); }
      catch (error) {
        const committed = await cloudCommerceService.getCustomLabelJob(job.id);
        if (committed) job = committed;
        else {
          await deleteStorageObject(customLabelStorageClient, customLabelStorageObjectPath(job.id, "source"));
          throw error;
        }
      }
    }
    sendJson(response, 200, { job: publicCustomLabelJob(job, request) });
  } catch (error) {
    sendOperationError(response, error, "ไม่สามารถอ่านไฟล์ใบปะหน้า Shopee ได้");
  }
}

async function handleCustomLabelJobGet(jobId, request, response) {
  try {
    const job = cloudCommerceService ? await cloudCommerceService.getCustomLabelJob(jobId) : getCustomLabelJob(rootDir, jobId);
    if (!job) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    sendJson(response, 200, { job: publicCustomLabelJob(job, request) });
  } catch (error) {
    sendOperationError(response, error, "ไม่สามารถอ่าน custom label job ได้");
  }
}

async function handleCustomLabelTransform(jobId, action, request, response) {
  try {
    const body = await readJsonBody(request);
    const transform = action === "preview" ? previewCustomLabel : saveCustomLabel;
    let job = await transform(rootDir, jobId, body.mappings || {}, {
      ...(cloudCommerceService ? { job: await materializeCloudCustomLabelJob(jobId) } : {}),
      pythonBin: process.env.SWEET_HOUSE_PYTHON_BIN || undefined,
      parsedPayload: body.parsedPayload || undefined,
      ...(cloudDataRepository && action === "save"
        ? { mappingSaver: mappings => cloudDataRepository.upsertShopeeCustomLabelMappings(mappings) }
        : {}),
    });
    await persistCustomLabelArtifact(
      job.id,
      action === "preview" ? "preview" : "output",
      action === "preview" ? job.previewFilePath : job.outputFilePath,
    );
    if (cloudCommerceService) job = await saveCloudCustomLabelJob(job);
    sendJson(response, 200, { job: publicCustomLabelJob(job, request) });
  } catch (error) {
    sendOperationError(response, error, `ไม่สามารถ${action === "preview" ? "สร้าง preview" : "บันทึก"} custom label ได้`);
  }
}

async function handleCustomLabelFile(jobId, kind, response, disposition = "inline") {
  try {
    let body;
    let fileName;
    try {
      if (cloudCommerceService) throw new Error("Read durable artifact");
      const file = getCustomLabelFile(rootDir, jobId, kind);
      body = await readFile(file.path);
      fileName = file.fileName;
    } catch {
      body = await readPersistedCustomLabelArtifact(jobId, kind);
      fileName = kind === "source" ? "source.pdf" : `${kind}.pdf`;
    }
    const safeName = String(fileName || `${kind}.pdf`).replace(/[\r\n"]+/g, "_");
    response.writeHead(200, {
      "content-type": "application/pdf",
      "content-disposition": `${disposition}; filename="${safeName}"`,
      "content-length": String(body.length),
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

async function handleCustomLabelComparison(jobId, response) {
  try {
    let body;
    let fileName;
    try {
      if (cloudCommerceService) throw new Error("Read durable artifacts");
      const file = await createCustomLabelComparison(rootDir, jobId, {
        pythonBin: process.env.SWEET_HOUSE_PYTHON_BIN || undefined,
      });
      await persistCustomLabelArtifact(jobId, "comparison", file.path);
      body = await readFile(file.path);
      fileName = file.fileName;
    } catch {
      const persisted = await createPersistedCustomLabelComparison(jobId);
      body = persisted.body;
      fileName = persisted.fileName;
    }
    response.writeHead(200, {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${fileName}"`,
      "content-length": String(body.length),
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
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
  const connection = cloudCommerceService
    ? await cloudCommerceService.getShopeeConnection(url.searchParams.get("connectionId") || url.searchParams.get("shopId") || "")
    : getShopeeConnection(rootDir, url.searchParams.get("connectionId") || url.searchParams.get("shopId") || "");
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
    const stateRecord = cloudCommerceService
      ? await cloudCommerceService.createOAuthState({ returnUrl })
      : createShopeeOAuthState(rootDir, { returnUrl });
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
    stateRecord = cloudCommerceService
      ? await cloudCommerceService.consumeShopeeOAuthState(url.searchParams.get("state") || "")
      : consumeShopeeOAuthState(rootDir, url.searchParams.get("state") || "");
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
    let connection;
    if (cloudCommerceService) {
      const tokens = await shopeeClientFromEnvironment().exchangeAuthorizationCode({ code, shopId });
      if (!tokens.accessToken || !tokens.refreshToken) throw new Error("Shopee ไม่ส่ง access token กลับมา");
      const expireIn = Number(tokens.expireIn || 0);
      connection = await cloudCommerceService.saveShopeeConnection({
        shopId, shopName: url.searchParams.get("shop_name") || "",
        partnerId: process.env.SHOPEE_PARTNER_ID || "", ...tokens,
        tokenExpiresAt: expireIn ? new Date(Date.now() + expireIn * 1000).toISOString() : "", status: "connected",
      });
    } else {
      connection = await completeShopeeAuthorization(rootDir, {
        shopId, shopName: url.searchParams.get("shop_name") || "",
        partnerId: process.env.SHOPEE_PARTNER_ID || "", code,
        client: shopeeClientFromEnvironment(),
      });
    }
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
    const result = cloudCommerceService
      ? await cloudCommerceService.syncShopeeOrders({ connectionId: payload.connectionId || payload.shopId, client })
      : await syncShopeeOrders(rootDir, { connectionId: payload.connectionId || payload.shopId, client });
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
    const connection = cloudCommerceService
      ? await cloudCommerceService.getShopeeConnection(payload.connectionId || payload.shopId)
      : getShopeeConnection(rootDir, payload.connectionId || payload.shopId);
    if (!connection) throw new Error("ไม่พบ Shopee connection");
    const result = cloudCommerceService
      ? await cloudCommerceService.prepareShipmentBatch({ orderIds: payload.orderIds || [], client: authenticatedShopeeClient(connection) })
      : await prepareShipmentBatch(rootDir, payload.orderIds || [], { client: authenticatedShopeeClient(connection) });
    sendJson(response, 200, result);
  } catch (error) {
    sendOperationError(response, error, "ไม่สามารถเตรียม shipment batch ได้");
  }
}

async function handleShopeeShipmentBatchArrange(batchId, request, response) {
  try {
    const payload = await readJsonBody(request);
    const connection = cloudCommerceService
      ? await cloudCommerceService.getShopeeConnection(payload.connectionId || payload.shopId)
      : getShopeeConnection(rootDir, payload.connectionId || payload.shopId);
    if (!connection) throw new Error("ไม่พบ Shopee connection");
    const result = cloudCommerceService
      ? await cloudCommerceService.arrangeShipmentBatch(batchId, payload.selection || payload, { client: authenticatedShopeeClient(connection) })
      : await arrangeShipmentBatch(rootDir, batchId, payload.selection || payload, { client: authenticatedShopeeClient(connection) });
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
    const batch = cloudCommerceService ? await cloudCommerceService.getShipmentBatch(batchId) : null;
    const connection = cloudCommerceService
      ? await cloudCommerceService.getShopeeConnection(payload.connectionId || payload.shopId || batch?.shopId)
      : getShopeeConnection(rootDir, payload.connectionId || payload.shopId);
    if (!connection) throw new Error("ไม่พบ Shopee connection");
    const result = cloudCommerceService
      ? await cloudCommerceService.refreshBatchTracking(batchId, { client: authenticatedShopeeClient(connection) })
      : await refreshBatchTracking(rootDir, batchId, { client: authenticatedShopeeClient(connection) });
    sendJson(response, 200, result);
  } catch (error) {
    sendOperationError(response, error, "ไม่สามารถดึง Tracking จาก Shopee ได้");
  }
}

async function handleShopeeShippingDocumentCreate(batchId, request, response) {
  try {
    const payload = await readJsonBody(request);
    const batch = cloudCommerceService ? await cloudCommerceService.getShipmentBatch(batchId) : null;
    const connection = cloudCommerceService
      ? await cloudCommerceService.getShopeeConnection(payload.connectionId || payload.shopId || batch?.shopId)
      : getShopeeConnection(rootDir, payload.connectionId || payload.shopId);
    if (!connection) throw new Error("ไม่พบ Shopee connection");
    const job = cloudCommerceService
      ? await cloudCommerceService.createShippingDocumentJob(batchId, { client: authenticatedShopeeClient(connection) })
      : await createShippingDocumentJob(rootDir, batchId, { client: authenticatedShopeeClient(connection) });
    sendJson(response, 200, { job: publicShippingDocumentJob(job, request) });
  } catch (error) {
    sendOperationError(response, error, "ไม่สามารถสร้าง shipping document job ได้");
  }
}

async function handleShopeeShippingDocumentPoll(jobId, request, response) {
  try {
    const payload = await readJsonBody(request);
    if (cloudCommerceService) {
      const job = await cloudCommerceService.getShippingDocumentJob(jobId);
      if (!job) throw new Error("ไม่พบ shipping document job");
      const batch = await cloudCommerceService.getShipmentBatch(job.batchId);
      if (!batch) throw new Error("ไม่พบ shipment batch");
      const connection = await cloudCommerceService.getShopeeConnection(payload.connectionId || payload.shopId || job.shopId || batch.shopId);
      if (!connection) throw new Error("ไม่พบ Shopee connection");
      const result = await cloudCommerceService.pollShippingDocumentJob(jobId, {
        client: authenticatedShopeeClient(connection),
        saveArtifact: async ({ jobId: artifactId, content, contentType }) => {
          const safeArtifactId = String(artifactId).replace(/[^A-Za-z0-9._-]+/g, "-");
          const objectPath = `shipping-documents/${safeArtifactId}.pdf`;
          await uploadStorageObject(customLabelStorageClient, { objectPath, body: content, contentType });
          return objectPath;
        },
      });
      sendJson(response, 200, { job: publicShippingDocumentJob(result, request) });
      return;
    }
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
  if (cloudCommerceService) {
    try {
      const job = await cloudCommerceService.getShippingDocumentJob(jobId);
      if (!job || job.status !== "ready" || !job.objectPath) throw new Error("Not found");
      const body = await downloadStorageObject(customLabelStorageClient, job.objectPath);
      response.writeHead(200, {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="shipping-document-${String(job.batchId).replace(/[\r\n"]+/g, "_")}.pdf"`,
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
    return;
  }
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
    if (cloudCommerceService) {
      const batch = await cloudCommerceService.getShipmentBatch(batchId);
      if (!batch) throw new Error("ไม่พบ shipment batch");
      const documentJob = await cloudCommerceService.getReadyShippingDocumentJob(batchId);
      if (!documentJob) throw new Error("ยังไม่มี Shopee shipping document ที่พร้อมพิมพ์");
      const sourcePdf = await downloadStorageObject(customLabelStorageClient, documentJob.objectPath);
      const rendered = await renderShipmentLabelOverlay({
        batch,
        sourcePdf,
        mappings: payload.mappings || payload.orders || {},
        pythonBin: process.env.SWEET_HOUSE_PYTHON_BIN || undefined,
      });
      const objectPath = `shipping-labels/${encodeURIComponent(batch.id)}.pdf`;
      await uploadStorageObject(customLabelStorageClient, { objectPath, body: rendered.body, contentType: "application/pdf" });
      const updatedBatch = await cloudCommerceService.saveShipmentBatch({
        ...batch,
        status: "ready_to_print",
        labelOverlay: { objectPath, pages: rendered.pages, updatedAt: new Date().toISOString() },
        updatedAt: new Date().toISOString(),
      });
      sendJson(response, 200, {
        batchId: updatedBatch.id,
        downloadUrl: `/api/shopee/shipment-batches/${encodeURIComponent(updatedBatch.id)}/print-preview`,
        pages: rendered.pages,
      });
      return;
    }
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
  if (cloudCommerceService) {
    try {
      const batch = await cloudCommerceService.getShipmentBatch(batchId);
      const objectPath = batch?.labelOverlay?.objectPath;
      if (!objectPath) throw new Error("Not found");
      const body = await downloadStorageObject(customLabelStorageClient, objectPath);
      response.writeHead(200, {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="shipment-batch-${String(batch.id).replace(/[\r\n"]+/g, "_")}.pdf"`,
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
    return;
  }
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
    const vendors = cloudVendorRepository
      ? mapCloudVendors(await cloudVendorRepository.listVendors(""), { includeInactive }).map(compatibilityVendor)
      : await listSubstituteReceiptVendors(rootDir, { includeInactive });
    sendJson(response, 200, { vendors });
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
    let vendor;
    if (cloudVendorRepository) {
      const vendors = mapCloudVendors(await cloudVendorRepository.listVendors(""), { includeInactive: true });
      const record = buildVendorRecord(payload, vendors, vendorMutationOptions(payload));
      vendor = await cloudVendorRepository.saveVendor(record);
    } else {
      vendor = await createVendor(rootDir, payload, vendorMutationOptions(payload));
    }
    sendJson(response, 200, { vendor });
  } catch (error) {
    sendVendorError(response, error, "Cannot create vendor");
  }
}

async function handleVendorUpdate(vendorId, request, response) {
  try {
    const id = decodeVendorId(vendorId);
    const payload = await readJsonBody(request);
    let vendor;
    if (cloudVendorRepository) {
      const vendors = mapCloudVendors(await cloudVendorRepository.listVendors(""), { includeInactive: true });
      const current = vendors.find(item => item.id === id);
      if (!current) {
        const error = new Error("ไม่พบผู้ขาย");
        error.code = "VENDOR_NOT_FOUND";
        error.statusCode = 404;
        throw error;
      }
      const updated = buildUpdatedVendorRecord(current, payload, vendors, vendorMutationOptions(payload));
      vendor = await cloudVendorRepository.saveVendor(updated);
    } else {
      vendor = await updateVendor(rootDir, id, { ...payload, options: vendorMutationOptions(payload) });
    }
    sendJson(response, 200, { vendor });
  } catch (error) {
    sendVendorError(response, error, "Cannot update vendor");
  }
}

async function handleSubstituteReceiptVendorCreate(request, response) {
  try {
    const payload = await readJsonBody(request);
    let vendor;
    if (cloudVendorRepository) {
      const status = String(payload?.status ?? "active").trim() || "active";
      if (!["active", "inactive"].includes(status)) {
        const error = new Error("สถานะผู้ขายไม่ถูกต้อง");
        error.code = "INVALID_VENDOR_STATUS";
        error.statusCode = 400;
        throw error;
      }
      const vendors = mapCloudVendors(await cloudVendorRepository.listVendors(""), { includeInactive: true });
      const record = buildVendorRecord({
        ...payload,
        paymentChannel: payload.paymentChannel || "โอนผ่านบัญชีบริษัท",
      }, vendors, { ...vendorMutationOptions(payload), status });
      vendor = compatibilityVendor(await cloudVendorRepository.saveVendor(record));
    } else {
      vendor = await createSubstituteReceiptVendor(rootDir, payload);
    }
    sendJson(response, 200, { vendor });
  } catch (error) {
    sendVendorError(response, error, "Cannot create substitute receipt vendor");
  }
}

async function handleSubstituteReceiptVendorUpdate(vendorId, request, response) {
  try {
    const payload = await readJsonBody(request);
    let vendor;
    if (cloudVendorRepository) {
      const id = decodeVendorId(vendorId);
      const vendors = mapCloudVendors(await cloudVendorRepository.listVendors(""), { includeInactive: true });
      const current = vendors.find(item => item.id === id);
      if (!current) {
        const error = new Error("ไม่พบผู้ขาย");
        error.code = "VENDOR_NOT_FOUND";
        error.statusCode = 404;
        throw error;
      }
      const updated = buildUpdatedVendorRecord({
        ...current,
        paymentChannel: current.paymentChannel || "โอนผ่านบัญชีบริษัท",
      }, {
        ...payload,
        paymentChannel: payload.paymentChannel || current.paymentChannel || "โอนผ่านบัญชีบริษัท",
      }, vendors, vendorMutationOptions(payload));
      vendor = compatibilityVendor(await cloudVendorRepository.saveVendor(updated));
    } else {
      vendor = await updateSubstituteReceiptVendor(rootDir, vendorId, payload);
    }
    sendJson(response, 200, { vendor });
  } catch (error) {
    sendVendorError(response, error, "Cannot update substitute receipt vendor");
  }
}

async function handleInventoryPurchaseIn(request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { movement: (inventoryCloudRepository ? await inventoryCloudRepository.createPurchaseInMovement(payload) : createPurchaseInMovement(rootDir, payload)), balances: await inventoryDataAdapter.read("listInventoryBalances") });
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
    const company = cloudDataRepository ? await cloudDataRepository.getCompanySettings() : await getCompanySettings(rootDir);
    const { summary } = await inventoryDataAdapter.read("getInventoryDashboard");
    const balances = await inventoryDataAdapter.read("listInventoryBalances");
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
    const body = inventoryCloudRepository ? await inventoryCloudRepository.downloadInventoryImage(imagePath) : await readFile(absolutePath);
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
      let html = body.toString("utf8").replaceAll("__LINE_LIFF_ID__", escapeHtmlAttribute(runtimeEnv.LINE_LIFF_ID || ""));
      if (sessionAuthMode && authMode === "line" && !html.includes('src="/line-auth.browser.js"')) {
        const returnTo = `${url.pathname}${url.search}`;
        const authBootstrap = [
          '<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>',
          `<script src="/line-auth.browser.js" data-line-liff-id="${escapeHtmlAttribute(runtimeEnv.LINE_LIFF_ID || "")}" data-auth-gate="true" data-return-to="${escapeHtmlAttribute(returnTo)}"></script>`,
        ].join("\n  ");
        html = html.includes("</head>")
          ? html.replace("</head>", `  ${authBootstrap}\n</head>`)
          : html.replace("</body>", `  ${authBootstrap}\n</body>`);
      }
      body = Buffer.from(html, "utf8");
    }
    response.writeHead(200, {
      "content-type": contentType,
      "cache-control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  return cloudDocumentMutationContext.run(new Map(), async () => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/__e2e__/health") {
    sendJson(response, 200, { ok: true, runId: e2eRunId });
    return;
  }

  if (request.method === "GET" && url.pathname === "/healthz") {
    sendJson(response, 200, healthPayload(runtimeEnv));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/healthz") {
    sendJson(response, 200, healthPayload(runtimeEnv));
    return;
  }

  if (url.pathname === "/api/internal/line-workflow/run" && request.method === "POST") {
    try {
      if (!lineWorkflow.enabled) throw Object.assign(new Error("Feature disabled"), {statusCode:404});
      await verifyWorkerToken(String(request.headers.authorization || "").replace(/^Bearer /, ""), {audience:runtimeEnv.LINE_WORKFLOW_WORKER_AUDIENCE,email:runtimeEnv.LINE_WORKFLOW_WORKER_EMAIL});
      sendJson(response, 200, await lineWorkflow.work());
    } catch (error) { sendJson(response, error.statusCode || 503, {error:error.message}); }
    return;
  }

  if (!requireAuthenticatedRequest(request, response, url)) return;

  if (request.method === "POST" && url.pathname === "/api/webhooks/line") {
    await handleLineWebhook(request, response);
    return;
  }

  const batchRoute = url.pathname.match(/^\/api\/line-workflow-batches\/([^/]+)(?:\/(review|primary|confirm|run|resume|evidence)(?:\/([^/]+))?)?$/);
  if (batchRoute) {
    try {
      if (!request.auth?.lineUserId) throw Object.assign(new Error("กรุณาเข้าสู่ระบบด้วยบัญชี LINE ที่ส่งไฟล์"), {statusCode:403});
      const result = await lineWorkflow.api({ id: decodeURIComponent(batchRoute[1]), action: batchRoute[2], evidenceId: batchRoute[3], method: request.method, actor: request.auth, body: request.method === "GET" ? {} : await readJsonBody(request) });
      if (result.original) { response.writeHead(200, {"content-type":result.original.contentType,"cache-control":"private, no-store","x-content-type-options":"nosniff"}); response.end(result.original.bytes); }
      else sendJson(response, 200, result);
    } catch (error) { sendJson(response, error.statusCode || 400, {error:error.message}); }
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

  if (request.method === "POST" && url.pathname === "/api/auth/mock-session") {
    handleMockSession(request, response);
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

  if (request.method === "GET" && url.pathname === "/api/auth/profile") {
    await handleAppUserProfileGet(request, response);
    return;
  }

  if (request.method === "PATCH" && url.pathname === "/api/auth/profile") {
    await handleAppUserProfilePatch(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/company-positions") {
    await handleCompanyPositionsGet(response);
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

  if (request.method === "POST" && url.pathname === "/api/shopee/custom-labels") {
    await handleCustomLabelUpload(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/shopee/custom-labels/") && url.pathname.endsWith("/preview")) {
    const jobId = decodeURIComponent(url.pathname
      .replace("/api/shopee/custom-labels/", "")
      .replace("/preview", ""));
    await handleCustomLabelTransform(jobId, "preview", request, response);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/shopee/custom-labels/") && url.pathname.endsWith("/save")) {
    const jobId = decodeURIComponent(url.pathname
      .replace("/api/shopee/custom-labels/", "")
      .replace("/save", ""));
    await handleCustomLabelTransform(jobId, "save", request, response);
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

    if (url.pathname.startsWith("/api/shopee/custom-labels/") && url.pathname.endsWith("/source")) {
      const jobId = decodeURIComponent(url.pathname
        .replace("/api/shopee/custom-labels/", "")
        .replace("/source", ""));
      await handleCustomLabelFile(jobId, "source", response);
      return;
    }

    if (url.pathname.startsWith("/api/shopee/custom-labels/") && url.pathname.endsWith("/preview-file")) {
      const jobId = decodeURIComponent(url.pathname
        .replace("/api/shopee/custom-labels/", "")
        .replace("/preview-file", ""));
      await handleCustomLabelFile(jobId, "preview", response);
      return;
    }

    if (url.pathname.startsWith("/api/shopee/custom-labels/") && url.pathname.endsWith("/output")) {
      const jobId = decodeURIComponent(url.pathname
        .replace("/api/shopee/custom-labels/", "")
        .replace("/output", ""));
      await handleCustomLabelFile(jobId, "output", response);
      return;
    }

    if (url.pathname.startsWith("/api/shopee/custom-labels/") && url.pathname.endsWith("/download")) {
      const jobId = decodeURIComponent(url.pathname
        .replace("/api/shopee/custom-labels/", "")
        .replace("/download", ""));
      await handleCustomLabelFile(jobId, "output", response, "attachment");
      return;
    }

    if (url.pathname.startsWith("/api/shopee/custom-labels/") && url.pathname.endsWith("/comparison")) {
      const jobId = decodeURIComponent(url.pathname
        .replace("/api/shopee/custom-labels/", "")
        .replace("/comparison", ""));
      await handleCustomLabelComparison(jobId, response);
      return;
    }

    if (url.pathname.startsWith("/api/shopee/custom-labels/")) {
      const jobId = decodeURIComponent(url.pathname.replace("/api/shopee/custom-labels/", ""));
      await handleCustomLabelJobGet(jobId, request, response);
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
      await handleWorkflowTransactionPrefill(transactionNo, url, response, request);
      return;
    }

    if (
      url.pathname.startsWith("/api/workflow-transactions/")
      && !url.pathname.includes("/files/")
      && !url.pathname.endsWith("/prefill")
    ) {
      const transactionNo = decodeURIComponent(url.pathname.replace("/api/workflow-transactions/", ""));
      if (!ensurePermission(request, response, ACTIONS.DOCUMENT_READ)) return;
      await handleWorkflowTransactionGet(transactionNo, request, response);
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
