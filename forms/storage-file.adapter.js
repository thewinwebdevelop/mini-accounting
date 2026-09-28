const crypto = require("node:crypto");
const path = require("node:path");
const { createSupabaseAdminClient, supabaseRequest } = require("./supabase.logic.js");
const { createSupabaseStorageClient, downloadStorageObject, storageObjectPath } = require("./supabase-storage.logic.js");
const { resolveDataBackendMode } = require("./data-backend.logic.js");

const STORAGE_MIGRATION_NAME = "local-file-storage-20260925";

function storageError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function objectIdentity(rootDir, absolutePath) {
  const relativePath = path.relative(path.resolve(rootDir), path.resolve(absolutePath)).split(path.sep).join("/");
  if (relativePath.startsWith("documents/") && relativePath.length > "documents/".length) {
    return { sourceKey: `file:${relativePath}`, objectPath: storageObjectPath(relativePath) };
  }
  const imagePrefix = "data/inventory-images/";
  if (relativePath.startsWith(imagePrefix) && relativePath.length > imagePrefix.length) {
    return { sourceKey: `file:${relativePath}`, objectPath: storageObjectPath(`inventory-images/${relativePath.slice(imagePrefix.length)}`) };
  }
  throw storageError("STORAGE_SOURCE_NOT_APPROVED", "File is outside approved Storage roots");
}

function verifyObject(record, body) {
  const bytes = Buffer.from(body);
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  if (hash !== record.source_sha256 || bytes.length !== Number(record.byte_size)) {
    throw storageError("STORAGE_VERIFY_FAILED", "Storage object failed byte verification");
  }
}

function createFileAdapter({ rootDir, env = process.env, client, storageClient, logger = () => {}, downloadObject = downloadStorageObject } = {}) {
  const configuredMode = resolveDataBackendMode({ ...env, DATA_BACKEND: env.DATA_BACKEND_FILES || env.DATA_BACKEND }, "default");
  const mode = configuredMode === "dual-write" ? "shadow" : configuredMode;
  const fallbackOnCloudError = String(env.DATA_BACKEND_FALLBACK || "").toLowerCase() === "local";
  let adminClient = null;
  let cloudStorageClient = null;
  if (mode !== "local") {
    adminClient = client || createSupabaseAdminClient({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
    cloudStorageClient = storageClient || createSupabaseStorageClient({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
  }

  async function read({ file, localRead }) {
    if (!file || !file.absolutePath || typeof localRead !== "function") throw storageError("STORAGE_FILE_INVALID", "Local file reference is invalid");
    if (mode === "local") return localRead();
    const identity = objectIdentity(rootDir, file.absolutePath);
    const route = `/rest/v1/storage_migration_records?migration_name=eq.${encodeURIComponent(STORAGE_MIGRATION_NAME)}&source_key=eq.${encodeURIComponent(identity.sourceKey)}&limit=1`;
    try {
      const rows = await supabaseRequest(adminClient, route);
      const record = Array.isArray(rows) ? rows[0] : null;
      if (!record) {
        if (fallbackOnCloudError) return localRead();
        throw storageError("STORAGE_OBJECT_NOT_MIGRATED", "File has not been migrated to Storage");
      }
      const body = await downloadObject(cloudStorageClient, record.object_path);
      verifyObject(record, body);
      const result = { body: Buffer.from(body), contentType: record.content_type || "application/octet-stream", fileName: file.fileName };
      if (mode === "shadow") {
        const localBody = await localRead();
        const localHash = crypto.createHash("sha256").update(localBody).digest("hex");
        if (localHash !== record.source_sha256) logger({ type: "data-shadow-diff", domain: "files", method: "read", summary: "file hash mismatch" });
        return { body: Buffer.from(localBody), contentType: result.contentType, fileName: file.fileName };
      }
      return result;
    } catch (error) {
      if (mode === "supabase-read" && fallbackOnCloudError && error.code !== "STORAGE_VERIFY_FAILED") {
        logger({ type: "data-cloud-fallback", domain: "files", method: "read", code: error?.code || "CLOUD_ERROR" });
        return localRead();
      }
      throw error;
    }
  }

  return Object.freeze({ mode, read, objectIdentity: absolutePath => objectIdentity(rootDir, absolutePath) });
}

module.exports = { STORAGE_MIGRATION_NAME, createFileAdapter, objectIdentity, verifyObject };
