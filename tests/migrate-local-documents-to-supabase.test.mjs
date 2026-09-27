import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const { applyDocumentMigration, planDocumentMigration } = await import("../scripts/migrate-local-documents-to-supabase.mjs");

async function makeFixture() {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-document-migration-"));
  const folderPath = "documents/2026/09/เบิกจ่าย/REQ-2026-09-0001";
  await mkdir(join(rootDir, folderPath, "data"), { recursive: true });
  await mkdir(join(rootDir, folderPath, "raw"), { recursive: true });
  await mkdir(join(rootDir, folderPath, "pdf"), { recursive: true });
  await writeFile(join(rootDir, folderPath, "data", "submission.json"), JSON.stringify({
    requestNo: "REQ-2026-09-0001",
    status: "pending_approval",
    accountingMonth: "2026-09",
    folderPath,
    requestTitle: "ทดสอบเอกสาร",
    ownerUserId: "user-1",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T01:00:00.000Z",
    absolutePath: "/must-not-leak",
  }), "utf8");
  await writeFile(join(rootDir, folderPath, "raw", "receipt.jpg"), "receipt-bytes");
  await writeFile(join(rootDir, folderPath, "pdf", "01_expense_request.pdf"), "%PDF-test");
  return rootDir;
}

function fakeSupabase() {
  const rows = new Map();
  const inserted = [];
  return {
    inserted,
    request: async (_client, path, options = {}) => {
      const method = options.method || "GET";
      if (path.startsWith("/rest/v1/migration_records?") && method === "GET") {
        const sourceKey = decodeURIComponent(path.match(/source_key=eq\.([^&]+)/)?.[1] || "");
        const found = rows.get(`migration:${sourceKey}`);
        return found ? [found] : [];
      }
      if (path.startsWith("/rest/v1/migration_records") && method === "POST") {
        const record = Array.isArray(options.body) ? options.body[0] : options.body;
        rows.set(`migration:${record.source_key}`, record);
        return [record];
      }
      if (path.startsWith("/rest/v1/migration_runs") && method === "POST") return [{ id: "run-1" }];
      if (path.startsWith("/rest/v1/migration_runs") && method === "PATCH") return [];
      if (path.startsWith("/rest/v1/") && method === "GET") {
        const table = path.split("?")[0];
        const sourceKey = decodeURIComponent(path.match(/source_key=eq\.([^&]+)/)?.[1] || "");
        const found = rows.get(`${table}:${sourceKey}`);
        return found ? [found] : [];
      }
      if (path.startsWith("/rest/v1/") && method === "POST") {
        const record = Array.isArray(options.body) ? options.body[0] : options.body;
        inserted.push(record);
        rows.set(`${path.split("?")[0]}:${record.source_key}`, record);
        return [record];
      }
      throw new Error(`unexpected fake Supabase request ${method} ${path}`);
    },
  };
}

test("document migration plans metadata and private file references without leaking paths", async () => {
  const rootDir = await makeFixture();
  try {
    const result = await planDocumentMigration({ rootDir, now: () => "2026-09-25T00:00:00.000Z" });
    assert.deepEqual(result.counts, { documents: 1, documentFiles: 3 });
    assert.equal(result.records.filter(record => record.table === "documents").length, 1);
    assert.equal(result.records.filter(record => record.table === "document_files").length, 3);
    const document = result.records.find(record => record.table === "documents").row;
    assert.equal(document.source_key, "document:expense_request:REQ-2026-09-0001");
    assert.equal(document.owner_user_id, "user-1");
    assert.equal(document.payload.absolutePath, undefined);
    assert.equal(JSON.stringify(result).includes(rootDir), false);
    const file = result.records.find(record => record.table === "document_files" && record.row.original_name === "receipt.jpg").row;
    assert.equal(file.document_source_key, document.source_key);
    assert.equal(file.bucket_name, "sweet-house-files");
    assert.match(file.object_path, /^documents\//);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("document migration applies idempotently by source key", async () => {
  const rootDir = await makeFixture();
  const fake = fakeSupabase();
  try {
    await applyDocumentMigration({ rootDir, client: {}, request: fake.request, now: () => "2026-09-25T00:00:00.000Z" });
    await applyDocumentMigration({ rootDir, client: {}, request: fake.request, now: () => "2026-09-25T00:00:00.000Z" });
    assert.equal(fake.inserted.filter(row => row.source_key === "document:expense_request:REQ-2026-09-0001").length, 1);
    assert.equal(fake.inserted.filter(row => row.source_key === "document_file:documents/2026/09/เบิกจ่าย/REQ-2026-09-0001/raw/receipt.jpg").length, 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
