import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { canonicalHash } = require("../forms/data-backend.logic.js");
const { createSupabaseAdminClient, supabaseRequest } = require("../forms/supabase.logic.js");
const { scanDocumentIndexRecords } = require("../forms/document-index.logic.js");
const { collectStorageManifest } = await import("./migrate-local-files-to-supabase.mjs");

export const DOCUMENT_MIGRATION_NAME = "document-metadata-20260925";
export const DEFAULT_STORAGE_BUCKET = "sweet-house-files";

const DOCUMENT_FILE_NAMES = {
  expense_request: "submission.json",
  substitute_receipt: "substitute-receipt.json",
  workflow_transaction: "workflow-transaction.json",
};

function safePayload(value) {
  if (Array.isArray(value)) return value.map(safePayload);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "absolutePath" && key !== "absoluteFolderPath")
    .map(([key, item]) => [key, safePayload(item)]));
}

function documentFileName(documentKind) {
  return DOCUMENT_FILE_NAMES[documentKind] || "workflow-document.json";
}

function documentSourceKey(record) {
  return `document:${record.documentKind}:${record.documentNo}`;
}

async function collectDocumentRecords(rootDir) {
  const indexRecords = await scanDocumentIndexRecords(rootDir);
  const records = [];
  for (const indexRecord of indexRecords) {
    const payloadPath = join(rootDir, indexRecord.folderPath, "data", documentFileName(indexRecord.documentKind));
    const payload = safePayload(JSON.parse(await readFile(payloadPath, "utf8")));
    const sourceKey = documentSourceKey(indexRecord);
    const normalizedPayload = {
      ...payload,
      folderPath: payload.folderPath || indexRecord.folderPath,
      status: indexRecord.status || payload.status || "draft",
    };
    records.push({
      table: "documents",
      sourceKey,
      row: {
        source_key: sourceKey,
        document_kind: indexRecord.documentKind,
        document_no: indexRecord.documentNo,
        owner_user_id: normalizedPayload.ownerUserId || null,
        status: normalizedPayload.status,
        accounting_month: indexRecord.accountingMonth || normalizedPayload.accountingMonth || "",
        folder_path: indexRecord.folderPath,
        payload: normalizedPayload,
        source_hash: canonicalHash(normalizedPayload),
        created_at: indexRecord.createdAt || normalizedPayload.createdAt || null,
        updated_at: indexRecord.updatedAt || normalizedPayload.updatedAt || null,
      },
    });
  }
  return records;
}

function documentFileRecords(manifest, documents, bucket, now) {
  const sortedDocuments = [...documents].sort((left, right) => right.row.folder_path.length - left.row.folder_path.length);
  return manifest.flatMap(file => {
    if (!file.relativePath.startsWith("documents/")) return [];
    const document = sortedDocuments.find(candidate => file.relativePath === candidate.row.folder_path
      || file.relativePath.startsWith(`${candidate.row.folder_path}/`));
    if (!document) return [];
    return [{
      table: "document_files",
      sourceKey: `document_file:${file.relativePath}`,
      row: {
        source_key: `document_file:${file.relativePath}`,
        document_source_key: document.sourceKey,
        bucket_name: bucket,
        object_path: file.objectPath,
        source_sha256: file.sourceSha256,
        byte_size: file.byteSize,
        content_type: file.contentType,
        original_name: basename(file.relativePath),
        migrated_at: now(),
      },
    }];
  });
}

function countRecords(records) {
  return records.reduce((counts, record) => {
    if (record.table === "documents") counts.documents += 1;
    if (record.table === "document_files") counts.documentFiles += 1;
    return counts;
  }, { documents: 0, documentFiles: 0 });
}

export async function planDocumentMigration({
  rootDir,
  bucket = process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_STORAGE_BUCKET,
  now = () => new Date().toISOString(),
} = {}) {
  const documents = await collectDocumentRecords(rootDir);
  const manifest = await collectStorageManifest({ rootDir });
  const records = [...documents, ...documentFileRecords(manifest, documents, bucket, now)]
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  return {
    migrationName: DOCUMENT_MIGRATION_NAME,
    mode: "dry-run",
    generatedAt: now(),
    counts: countRecords(records),
    records,
    writes: 0,
  };
}

async function updateRun({ client, request, runId, status, counts, errorCode = "", finishedAt = null }) {
  if (!runId) return;
  await request(client, `/rest/v1/migration_runs?id=eq.${encodeURIComponent(runId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: { status, counts, error_code: errorCode, finished_at: finishedAt },
  });
}

export async function applyDocumentMigration({
  rootDir,
  bucket = process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_STORAGE_BUCKET,
  client,
  request = supabaseRequest,
  now = () => new Date().toISOString(),
} = {}) {
  const plan = await planDocumentMigration({ rootDir, bucket, now });
  const runRows = await request(client, "/rest/v1/migration_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: { migration_name: DOCUMENT_MIGRATION_NAME, mode: "apply", status: "running", counts: plan.counts, started_at: now() },
  });
  const runId = Array.isArray(runRows) ? runRows[0]?.id : "";
  let writes = 0;
  try {
    for (const record of plan.records) {
      const sourceKey = encodeURIComponent(record.sourceKey);
      const existing = await request(client, `/rest/v1/migration_records?migration_name=eq.${encodeURIComponent(DOCUMENT_MIGRATION_NAME)}&source_key=eq.${sourceKey}&limit=1`);
      if (Array.isArray(existing) && existing.length) {
        await request(client, `/rest/v1/${record.table}?source_key=eq.${sourceKey}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: record.row,
        });
        continue;
      }
      await request(client, `/rest/v1/${record.table}?on_conflict=source_key`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: record.row,
      });
      const verified = await request(client, `/rest/v1/${record.table}?source_key=eq.${sourceKey}&limit=1`);
      if (!Array.isArray(verified) || verified.length !== 1) {
        const error = new Error("Document migration verification failed");
        error.code = "MIGRATION_VERIFY_FAILED";
        throw error;
      }
      await request(client, "/rest/v1/migration_records", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: {
          migration_name: DOCUMENT_MIGRATION_NAME,
          source_key: record.sourceKey,
          target_table: record.table,
          target_key: record.sourceKey,
          source_hash: createHash("sha256").update(JSON.stringify(record.row)).digest("hex"),
          migrated_at: now(),
        },
      });
      writes += 1;
    }
    await updateRun({ client, request, runId, status: "succeeded", counts: { ...plan.counts, writes }, finishedAt: now() });
    return { ...plan, mode: "apply", writes };
  } catch (error) {
    await updateRun({ client, request, runId, status: "failed", counts: { ...plan.counts, writes }, errorCode: error.code || "DOCUMENT_MIGRATION_FAILED", finishedAt: now() }).catch(() => {});
    throw error;
  }
}

async function main() {
  const rootDir = process.env.SWEET_HOUSE_ROOT_DIR || process.cwd();
  const client = createSupabaseAdminClient();
  const result = process.argv.includes("--apply")
    ? await applyDocumentMigration({ rootDir, client })
    : await planDocumentMigration({ rootDir });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    process.stderr.write(`${error.code || "DOCUMENT_MIGRATION_FAILED"}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
