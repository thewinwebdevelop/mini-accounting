import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createDocumentFileSynchronizer } from "../forms/supabase-document-files.logic.js";

test("document file synchronizer uploads files and writes the storage ledger", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-cloud-files-"));
  const folderPath = "documents/2026/REQ-2026-09-0001_demo";
  const folder = join(rootDir, folderPath, "raw");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "receipt.jpg"), Buffer.from("receipt-bytes"));

  const calls = [];
  const client = { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.includes("storage_migration_records")) {
      return new Response(JSON.stringify([{ source_key: "file:documents/2026/REQ-2026-09-0001_demo/raw/receipt.jpg" }]), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }, url: "https://project.supabase.co", serviceRoleKey: "server-secret" };
  const storageClient = { url: client.url, bucket: "sweet-house-files", serviceRoleKey: client.serviceRoleKey, fetchImpl: client.fetchImpl };

  try {
    const result = await createDocumentFileSynchronizer({ rootDir, client, storageClient });
    const synced = await result.sync({ documentKind: "expense_request", documentNo: "REQ-2026-09-0001", folderPath });
    assert.equal(synced.length, 1);
    assert.equal(synced[0].objectPath, `${folderPath}/raw/receipt.jpg`);
    assert.ok(calls.some(call => call.url.includes("/storage/v1/object/sweet-house-files/")));
    const ledgerCall = calls.find(call => call.url.includes("storage_migration_records"));
    assert.ok(ledgerCall);
    assert.match(String(ledgerCall.options.body), /receipt\.jpg/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("document file synchronizer materializes a cloud document into the temporary runtime root", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-cloud-materialize-"));
  const folderPath = "documents/2026/REQ-2026-09-0002_demo";
  const documentFile = `${folderPath}/data/submission.json`;
  const rawFile = `${folderPath}/raw/receipt.jpg`;
  const pdfFile = `${folderPath}/pdf/01_expense_request.pdf`;
  const client = {
    url: "https://project.supabase.co",
    serviceRoleKey: "server-secret",
    fetchImpl: async (url) => {
      if (String(url).includes("/rest/v1/document_files")) {
        return new Response(JSON.stringify([
          { object_path: documentFile, content_type: "application/json" },
          { object_path: rawFile, content_type: "image/jpeg" },
          { object_path: pdfFile, content_type: "application/pdf" },
        ]), { status: 200 });
      }
      if (String(url).includes("/storage/v1/object") && String(url).endsWith("receipt.jpg")) {
        return new Response(Buffer.from("receipt-from-storage"), { status: 200 });
      }
      if (String(url).includes("/storage/v1/object") && String(url).endsWith("01_expense_request.pdf")) {
        return new Response(Buffer.from("pdf-from-storage"), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    },
  };
  const storageClient = { ...client, bucket: "sweet-house-files" };
  const synchronizer = createDocumentFileSynchronizer({ rootDir, client, storageClient });
  const record = {
    documentKind: "expense_request",
    documentNo: "REQ-2026-09-0002",
    folderPath,
    payload: { requestNo: "REQ-2026-09-0002", folderPath, evidenceFiles: { receipt: [{ storedName: "receipt.jpg" }] } },
  };

  try {
    await synchronizer.materialize({ rootDir, record });
    assert.deepEqual(JSON.parse(await readFile(join(rootDir, folderPath, "data", "submission.json"), "utf8")), record.payload);
    assert.deepEqual(await readFile(join(rootDir, folderPath, "raw", "receipt.jpg")), Buffer.from("receipt-from-storage"));
    assert.deepEqual(await readFile(join(rootDir, folderPath, "pdf", "01_expense_request.pdf")), Buffer.from("pdf-from-storage"));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("document file synchronizer materializes flattened cloud adapter records with their payload", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-cloud-materialize-flat-"));
  const folderPath = "documents/2026/09/workflow-transactions/TXN-2026-09-0001_demo";
  const client = {
    url: "https://project.supabase.co",
    serviceRoleKey: "server-secret",
    fetchImpl: async () => new Response(JSON.stringify([]), { status: 200 }),
  };
  const storageClient = { ...client, bucket: "sweet-house-files" };
  const synchronizer = createDocumentFileSynchronizer({ rootDir, client, storageClient });
  const record = {
    documentKind: "workflow_transaction",
    documentNo: "TXN-2026-09-0001",
    folderPath,
    transactionNo: "TXN-2026-09-0001",
    accountingMonth: "2026-09",
    status: "in_progress",
    title: "ร้านพี่หมวย",
    templateSnapshot: { templateId: "stock_no_tax_invoice_director_transfer" },
  };

  try {
    await synchronizer.materialize({ rootDir, record });
    const payload = JSON.parse(await readFile(join(rootDir, folderPath, "data", "workflow-transaction.json"), "utf8"));
    assert.equal(payload.transactionNo, record.transactionNo);
    assert.equal(payload.status, record.status);
    assert.equal(payload.title, record.title);
    assert.deepEqual(payload.templateSnapshot, record.templateSnapshot);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
