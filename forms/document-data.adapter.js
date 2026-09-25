const { canonicalHash, stableSourceKey } = require("./data-backend.logic.js");
const { createSupabaseAdminClient } = require("./supabase.logic.js");
const { createDocumentCloudRepository } = require("./document-cloud.logic.js");

function adapterError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function stripPrivatePaths(value) {
  if (Array.isArray(value)) return value.map(stripPrivatePaths);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "absolutePath" && key !== "absoluteFolderPath")
    .map(([key, item]) => [key, stripPrivatePaths(item)]));
}

function buildDocumentCloudRecord({ documentKind, documentNo, payload, result }) {
  const cleanKind = String(documentKind || payload?.documentKind || result?.documentKind || "").trim();
  const cleanNo = String(documentNo || payload?.documentNo || result?.documentNo || "").trim();
  if (!cleanKind || !cleanNo) throw adapterError("DOCUMENT_SOURCE_KEY_INVALID", "Document identity is required for cloud persistence");
  const safePayload = stripPrivatePaths(payload || result?.payload || result || {});
  return {
    sourceKey: stableSourceKey("document", `${cleanKind}:${cleanNo}`),
    documentKind: cleanKind,
    documentNo: cleanNo,
    ownerUserId: safePayload.ownerUserId || result?.ownerUserId || null,
    status: result?.status || safePayload.status || "draft",
    accountingMonth: safePayload.accountingMonth || result?.accountingMonth || "",
    folderPath: safePayload.folderPath || result?.folderPath || "",
    payload: safePayload,
    sourceHash: canonicalHash(safePayload),
    createdAt: result?.createdAt || safePayload.createdAt || null,
    updatedAt: result?.updatedAt || safePayload.updatedAt || null,
  };
}

function cloudRecordToPublicDocument(record = {}) {
  return Object.fromEntries(Object.entries({
    ...(record.payload && typeof record.payload === "object" ? record.payload : {}),
    documentKind: record.documentKind,
    documentNo: record.documentNo,
    status: record.status,
    folderPath: record.folderPath,
    ownerUserId: record.ownerUserId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }).filter(([, value]) => value !== undefined));
}

function createDocumentDataAdapter({ env = process.env, client, logger = () => {} } = {}) {
  const mode = String(env.DATA_BACKEND_DOCUMENTS || env.DATA_BACKEND || "local").trim().toLowerCase();
  if (!["local", "shadow", "dual-write", "supabase-read"].includes(mode)) {
    throw adapterError("DATA_BACKEND_INVALID", `Unsupported data backend mode: ${mode}`);
  }
  let cloud = null;
  const fallbackOnCloudError = String(env.DATA_BACKEND_FALLBACK || "").toLowerCase() === "local";
  if (mode !== "local") {
    const supabaseClient = client || createSupabaseAdminClient({
      url: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    });
    cloud = createDocumentCloudRepository({ client: supabaseClient });
  }

  async function save({ localSave, documentKind, documentNo, payload }) {
    if (typeof localSave !== "function") throw adapterError("DOCUMENT_LOCAL_SAVE_MISSING", "Local document save is required");
    const result = await localSave();
    if (mode === "local" || mode === "shadow") return result;
    const record = buildDocumentCloudRecord({ documentKind, documentNo, payload, result });
    try {
      await cloud.upsertDocument(record);
    } catch (error) {
      throw adapterError("DATA_CLOUD_WRITE_FAILED", "Cloud document write failed; retry is required", { retryable: true, causeCode: error?.code || "CLOUD_ERROR" });
    }
    return result;
  }

  async function shadowRead({ localResult, cloudRead, documentKind, method }) {
    if (mode !== "shadow" || typeof cloudRead !== "function") return localResult;
    try {
      const cloudResult = await cloudRead();
      const localHash = canonicalHash(stripPrivatePaths(localResult));
      const cloudHash = canonicalHash(stripPrivatePaths(cloudResult));
      if (localHash !== cloudHash) logger({
        type: "data-shadow-diff",
        domain: "documents",
        method,
        documentKind,
        summary: "document hash mismatch",
      });
    } catch (error) {
      logger({ type: "data-shadow-cloud-error", domain: "documents", method, code: error?.code || "CLOUD_ERROR" });
    }
    return localResult;
  }

  async function list({ localResult, documentKind, filters = {} }) {
    if (mode === "local" || mode === "dual-write") return localResult;
    try {
      const cloudRows = await cloud.listDocuments({ ...filters, ...(documentKind ? { documentKind } : {}) });
      if (mode === "shadow") {
        if (cloudRows.length !== localResult.length) logger({
          type: "data-shadow-diff",
          domain: "documents",
          method: "list",
          documentKind,
          summary: `document count mismatch: local ${localResult.length}, cloud ${cloudRows.length}`,
        });
        return localResult;
      }
      if (mode === "supabase-read" && cloudRows.length === 0 && fallbackOnCloudError) return localResult;
      return cloudRows.map(cloudRecordToPublicDocument);
    } catch (error) {
      if (mode === "supabase-read" && fallbackOnCloudError) {
        logger({ type: "data-cloud-fallback", domain: "documents", method: "list", code: error?.code || "CLOUD_ERROR" });
        return localResult;
      }
      throw error;
    }
  }

  async function get({ localResult, documentKind, documentNo }) {
    if (mode === "local" || mode === "dual-write") return localResult;
    try {
      const cloudResult = await cloud.getDocument(stableSourceKey("document", `${documentKind}:${documentNo}`));
      if (!cloudResult) {
        if (mode === "supabase-read" && fallbackOnCloudError) return localResult;
        return null;
      }
      const publicResult = cloudRecordToPublicDocument(cloudResult);
      if (mode === "shadow") {
        const localHash = canonicalHash(stripPrivatePaths(localResult));
        const cloudHash = canonicalHash(stripPrivatePaths(publicResult));
        if (localHash !== cloudHash) logger({ type: "data-shadow-diff", domain: "documents", method: "get", documentKind, summary: "document hash mismatch" });
        return localResult;
      }
      return publicResult;
    } catch (error) {
      if (mode === "supabase-read" && fallbackOnCloudError) {
        logger({ type: "data-cloud-fallback", domain: "documents", method: "get", code: error?.code || "CLOUD_ERROR" });
        return localResult;
      }
      throw error;
    }
  }

  return Object.freeze({ mode, save, shadowRead, list, get, buildDocumentCloudRecord });
}

module.exports = { buildDocumentCloudRecord, createDocumentDataAdapter, stripPrivatePaths };
