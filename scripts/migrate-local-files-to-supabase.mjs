import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { lstat, readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { createSupabaseStorageClient, downloadStorageObject, storageObjectPath, uploadStorageObject } = require("../forms/supabase-storage.logic.js");
const { createSupabaseAdminClient, supabaseRequest } = require("../forms/supabase.logic.js");

export const STORAGE_MIGRATION_NAME = "local-file-storage-20260925";

const APPROVED_ROOTS = [
  { directory: "documents", objectPrefix: "documents" },
  { directory: path.join("data", "inventory-images"), objectPrefix: "inventory-images" },
];

const CONTENT_TYPES = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".txt": "text/plain",
  ".webp": "image/webp",
};

function storageError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function contentTypeFor(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function relativePosix(rootDir, absolutePath) {
  return path.relative(rootDir, absolutePath).split(path.sep).join("/");
}

async function collectDirectory({ rootDir, sourceRoot, absoluteDir, relativeDir, objectPrefix }) {
  let entries;
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const records = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(absoluteDir, entry.name);
    if (entry.isFile() && (entry.name === ".DS_Store" || path.extname(entry.name).toLowerCase() === ".html")) continue;
    if (entry.isSymbolicLink()) {
      throw storageError("STORAGE_SOURCE_SYMLINK", `Storage source contains a symlink: ${relativePosix(rootDir, absolutePath)}`);
    }
    if (entry.isDirectory()) {
      records.push(...await collectDirectory({
        rootDir,
        sourceRoot,
        absoluteDir: absolutePath,
        relativeDir: path.join(relativeDir, entry.name),
        objectPrefix,
      }));
      continue;
    }
    if (!entry.isFile()) {
      throw storageError("STORAGE_SOURCE_NOT_REGULAR", `Storage source is not a regular file: ${relativePosix(rootDir, absolutePath)}`);
    }

    const relativePath = relativePosix(rootDir, path.join(rootDir, relativeDir, entry.name));
    const objectPath = storageObjectPath(`${objectPrefix}/${relativePosix(sourceRoot, absolutePath)}`);
    const body = await readFile(absolutePath);
    const record = {
      sourceKey: `file:${relativePath}`,
      relativePath,
      objectPath,
      sourceSha256: createHash("sha256").update(body).digest("hex"),
      byteSize: body.length,
      contentType: contentTypeFor(absolutePath),
    };
    Object.defineProperty(record, "absolutePath", { value: absolutePath, enumerable: false });
    records.push(record);
  }
  return records;
}

export async function collectStorageManifest({ rootDir } = {}) {
  const resolvedRootDir = path.resolve(String(rootDir || ""));
  let rootStats;
  try {
    rootStats = await lstat(resolvedRootDir);
  } catch (error) {
    if (error.code === "ENOENT") throw storageError("STORAGE_ROOT_MISSING", "Storage source root is missing");
    throw error;
  }
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw storageError("STORAGE_ROOT_INVALID", "Storage source root is not a directory");
  }

  const records = [];
  for (const approvedRoot of APPROVED_ROOTS) {
    records.push(...await collectDirectory({
      rootDir: resolvedRootDir,
      sourceRoot: path.join(resolvedRootDir, approvedRoot.directory),
      absoluteDir: path.join(resolvedRootDir, approvedRoot.directory),
      relativeDir: approvedRoot.directory,
      objectPrefix: approvedRoot.objectPrefix,
    }));
  }
  return records.sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
}

function countStorageRecords(records) {
  return records.reduce((counts, record) => {
    if (record.sourceKey.startsWith("file:documents/")) counts.documentFiles += 1;
    if (record.sourceKey.startsWith("file:data/inventory-images/")) counts.inventoryImages += 1;
    counts.total += 1;
    return counts;
  }, { documentFiles: 0, inventoryImages: 0, total: 0 });
}

export async function planStorageMigration({ rootDir, now = () => new Date().toISOString() } = {}) {
  const records = await collectStorageManifest({ rootDir });
  return {
    migrationName: STORAGE_MIGRATION_NAME,
    mode: "dry-run",
    generatedAt: now(),
    counts: countStorageRecords(records),
    records,
    writes: 0,
  };
}

function storageRecordMatches(row, record, bucket) {
  return row
    && row.bucket_name === bucket
    && row.object_path === record.objectPath
    && row.source_sha256 === record.sourceSha256
    && Number(row.byte_size) === record.byteSize
    && row.content_type === record.contentType;
}

function migrationRecordRoute(record) {
  return `/rest/v1/storage_migration_records?migration_name=eq.${encodeURIComponent(STORAGE_MIGRATION_NAME)}&source_key=eq.${encodeURIComponent(record.sourceKey)}&limit=1`;
}

async function updateMigrationRun({ client, request, runId, status, counts, errorCode = "", finishedAt = null }) {
  if (!runId) return;
  await request(client, `/rest/v1/migration_runs?id=eq.${encodeURIComponent(runId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: { status, counts, error_code: errorCode, finished_at: finishedAt },
  });
}

function verifyStorageBytes(record, body) {
  const bytes = Buffer.from(body);
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== record.byteSize || sourceSha256 !== record.sourceSha256) {
    const error = new Error("Uploaded Storage object failed byte verification");
    error.code = "STORAGE_VERIFY_FAILED";
    throw error;
  }
}

export async function applyStorageMigration({
  rootDir,
  client,
  request = supabaseRequest,
  now = () => new Date().toISOString(),
} = {}) {
  if (!client || typeof client.bucket !== "string") {
    const error = new Error("Supabase Storage client is required");
    error.code = "SUPABASE_STORAGE_CLIENT_INVALID";
    throw error;
  }
  const plan = await planStorageMigration({ rootDir, now });
  const startedAt = now();
  const runRows = await request(client, "/rest/v1/migration_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: { migration_name: STORAGE_MIGRATION_NAME, mode: "apply", status: "running", counts: plan.counts, started_at: startedAt },
  });
  const runId = Array.isArray(runRows) ? runRows[0]?.id : "";
  let writes = 0;
  let skipped = 0;
  let currentRecord = null;
  try {
    for (const record of plan.records) {
      currentRecord = record;
      const existingRows = await request(client, migrationRecordRoute(record));
      if (Array.isArray(existingRows) && storageRecordMatches(existingRows[0], record, client.bucket)) {
        skipped += 1;
        continue;
      }

      const sourceBody = await readFile(record.absolutePath);
      verifyStorageBytes(record, sourceBody);
      await uploadStorageObject(client, {
        objectPath: record.objectPath,
        body: sourceBody,
        contentType: record.contentType,
      });
      const uploadedBody = await downloadStorageObject(client, record.objectPath);
      verifyStorageBytes(record, uploadedBody);

      await request(client, "/rest/v1/storage_migration_records?on_conflict=migration_name,source_key", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: {
          migration_name: STORAGE_MIGRATION_NAME,
          source_key: record.sourceKey,
          bucket_name: client.bucket,
          object_path: record.objectPath,
          source_sha256: record.sourceSha256,
          byte_size: record.byteSize,
          content_type: record.contentType,
          migrated_at: now(),
        },
      });
      writes += 1;
    }
    await updateMigrationRun({ client, request, runId, status: "succeeded", counts: { ...plan.counts, writes, skipped }, finishedAt: now() });
    return { ...plan, mode: "apply", writes, skipped };
  } catch (error) {
    if (currentRecord) {
      error.sourceKey = currentRecord.sourceKey;
      error.relativePath = currentRecord.relativePath;
    }
    await updateMigrationRun({ client, request, runId, status: "failed", counts: { ...plan.counts, writes, skipped }, errorCode: error.code || "STORAGE_MIGRATION_FAILED", finishedAt: now() }).catch(() => {});
    throw error;
  }
}

async function main() {
  const rootDir = process.env.SWEET_HOUSE_ROOT_DIR || process.cwd();
  const result = process.argv.includes("--apply")
    ? await applyStorageMigration({ rootDir, client: createSupabaseStorageClient() })
    : await planStorageMigration({ rootDir });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({
      error: {
        code: error.code || "STORAGE_MIGRATION_FAILED",
        message: error.message,
        sourceKey: error.sourceKey || "",
        relativePath: error.relativePath || "",
      },
    })}\n`);
    process.exitCode = 1;
  });
}
