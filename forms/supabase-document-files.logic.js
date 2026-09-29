const crypto = require("node:crypto");
const { mkdir, readdir, readFile, stat, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { supabaseRequest } = require("./supabase.logic.js");
const { downloadStorageObject, storageObjectPath, uploadStorageObject } = require("./supabase-storage.logic.js");

const STORAGE_MIGRATION_NAME = "local-file-storage-20260925";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".txt": "text/plain",
  ".webp": "image/webp",
};

function fileError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function contentTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function documentPayloadFileName(documentKind) {
  if (documentKind === "expense_request") return "submission.json";
  if (documentKind === "substitute_receipt") return "substitute-receipt.json";
  if (documentKind === "workflow_transaction") return "workflow-transaction.json";
  return "workflow-document.json";
}

function assertDocumentFolder(rootDir, folderPath) {
  const root = path.resolve(rootDir);
  const folder = path.resolve(root, folderPath);
  if (!folderPath.startsWith("documents/") || !folder.startsWith(`${root}${path.sep}`)) {
    throw fileError("DOCUMENT_STORAGE_PATH_INVALID", "Document folder is outside the approved storage root");
  }
  return { root, folder };
}

async function collectFiles(rootDir, folderPath) {
  const { folder } = assertDocumentFolder(rootDir, folderPath);
  const files = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolutePath);
      else if (entry.isFile() && entry.name !== ".DS_Store" && path.extname(entry.name).toLowerCase() !== ".html") files.push(absolutePath);
    }
  }
  await mkdir(folder, { recursive: true });
  await walk(folder);
  return files.sort();
}

function createDocumentFileSynchronizer({
  rootDir,
  client,
  storageClient,
  bucket = storageClient?.bucket || "sweet-house-files",
  request = supabaseRequest,
  uploadObject = uploadStorageObject,
  downloadObject = downloadStorageObject,
  now = () => new Date().toISOString(),
} = {}) {
  if (!rootDir || !client || !storageClient) throw fileError("DOCUMENT_STORAGE_CONFIG_MISSING", "Document Storage configuration is missing");

  async function sync({ documentKind, documentNo, folderPath }) {
    if (!folderPath) return [];
    const absoluteRoot = path.resolve(rootDir);
    const files = await collectFiles(absoluteRoot, folderPath);
    const documentSourceKey = `document:${documentKind}:${documentNo}`;
    const records = [];
    for (const absolutePath of files) {
      const relativePath = path.relative(absoluteRoot, absolutePath).split(path.sep).join("/");
      const body = await readFile(absolutePath);
      const info = await stat(absolutePath);
      const sourceSha256 = crypto.createHash("sha256").update(body).digest("hex");
      const objectPath = storageObjectPath(relativePath);
      const record = {
        migration_name: STORAGE_MIGRATION_NAME,
        source_key: `file:${relativePath}`,
        bucket_name: bucket,
        object_path: objectPath,
        source_sha256: sourceSha256,
        byte_size: info.size,
        content_type: contentTypeFor(absolutePath),
        migrated_at: now(),
      };
      await uploadObject(storageClient, {
        objectPath,
        body,
        contentType: record.content_type,
      });
      await request(client, "/rest/v1/storage_migration_records?on_conflict=migration_name,source_key", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: record,
      });
      await request(client, "/rest/v1/document_files?on_conflict=source_key", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: {
          source_key: `document_file:${relativePath}`,
          document_source_key: documentSourceKey,
          bucket_name: bucket,
          object_path: objectPath,
          source_sha256: sourceSha256,
          byte_size: info.size,
          content_type: record.content_type,
          original_name: path.basename(relativePath),
          migrated_at: record.migrated_at,
        },
      });
      records.push({ ...record, objectPath });
    }
    return records;
  }

  async function materialize({ rootDir: targetRootDir = rootDir, record = {} }) {
    const folderPath = String(record.folderPath || "");
    const { folder } = assertDocumentFolder(targetRootDir, folderPath);
    const dataDir = path.join(folder, "data");
    const rawDir = path.join(folder, "raw");
    const pdfDir = path.join(folder, "pdf");
    await mkdir(dataDir, { recursive: true });
    await mkdir(rawDir, { recursive: true });
    await mkdir(pdfDir, { recursive: true });

    const documentKind = String(record.documentKind || record.payload?.documentKind || "");
    const documentNo = String(record.documentNo || record.payload?.documentNo || "");
    const documentSourceKey = `document:${documentKind}:${documentNo}`;
    const rows = await request(client, `/rest/v1/document_files?document_source_key=eq.${encodeURIComponent(documentSourceKey)}&order=object_path.asc`);
    // The document adapter exposes cloud rows in its public, flattened shape
    // (payload fields are promoted to the record root), while callers that
    // persist locally may still pass an explicit `payload` object. Accept
    // both shapes so a Cloud Run materialization does not write an empty JSON
    // file and make an otherwise valid document look missing.
    const documentPayload = record.payload && typeof record.payload === "object"
      ? record.payload
      : Object.fromEntries(Object.entries(record).filter(([key]) => ![
        "sourceKey",
        "sourceHash",
        "ownerUserId",
      ].includes(key)));
    await writeFile(path.join(dataDir, documentPayloadFileName(documentKind)), `${JSON.stringify(documentPayload, null, 2)}\n`, "utf8");

    for (const row of Array.isArray(rows) ? rows : []) {
      const objectPath = String(row.object_path || "");
      const sourceKey = String(row.source_key || "");
      const sourcePath = sourceKey.startsWith("document_file:") ? sourceKey.slice("document_file:".length) : "";
      const relativeToFolder = sourcePath.startsWith(`${folderPath}/`)
        ? sourcePath.slice(folderPath.length + 1)
        : (objectPath.startsWith(`${folderPath}/`) ? objectPath.slice(folderPath.length + 1) : "");
      // JSON is written above; restore both user-uploaded evidence and
      // generated PDFs so the filesystem-oriented readers can expose the
      // same download links after a fresh Cloud Run instance starts.
      const isRuntimeFile = relativeToFolder.startsWith("raw/") || relativeToFolder.startsWith("pdf/");
      if (!isRuntimeFile || relativeToFolder.includes("\\") || relativeToFolder.includes("..")) continue;
      const targetPath = path.resolve(folder, relativeToFolder);
      if (!targetPath.startsWith(`${folder}${path.sep}`)) continue;
      await writeFile(targetPath, Buffer.from(await downloadObject(storageClient, objectPath)));
    }
    return { folderPath, folder };
  }

  return Object.freeze({ materialize, sync });
}

module.exports = { STORAGE_MIGRATION_NAME, collectFiles, createDocumentFileSynchronizer };
