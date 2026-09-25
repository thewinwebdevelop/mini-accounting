import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const { collectStorageManifest, planStorageMigration, applyStorageMigration } = await import("../scripts/migrate-local-files-to-supabase.mjs");
const require = createRequire(import.meta.url);
const { createSupabaseStorageClient } = require("../forms/supabase-storage.logic.js");

async function makeFixture() {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-storage-") );
  await mkdir(join(rootDir, "documents", "2026", "09", "REQ-1", "pdf"), { recursive: true });
  await mkdir(join(rootDir, "documents", "2026", "09", "REQ-1", "raw"), { recursive: true });
  await mkdir(join(rootDir, "data", "inventory-images", "products"), { recursive: true });
  await writeFile(join(rootDir, "documents", "2026", "09", "REQ-1", "data.json"), "{\"ok\":true}\n");
  await writeFile(join(rootDir, "documents", "2026", "09", "REQ-1", "pdf", "receipt.pdf"), Buffer.from("pdf"));
  await writeFile(join(rootDir, "documents", "2026", "09", "REQ-1", "raw", "slip.txt"), "raw evidence\n");
  await writeFile(join(rootDir, "data", "inventory-images", "products", "product-1.png"), Buffer.from([137, 80, 78, 71]));
  return rootDir;
}

function makeStorageFixture({ mismatch = false } = {}) {
  const objects = new Map();
  const uploads = [];
  const client = createSupabaseStorageClient({
    url: "https://project.supabase.co",
    serviceRoleKey: "server-secret",
    fetchImpl: async (url, options) => {
      const marker = "/storage/v1/object/sweet-house-files/";
      const objectPath = decodeURIComponent(url.slice(url.indexOf(marker) + marker.length));
      if (options.method === "POST") {
        objects.set(objectPath, Buffer.from(options.body));
        uploads.push(objectPath);
        return new Response("{}", { status: 200 });
      }
      const body = mismatch ? Buffer.from("wrong-bytes") : objects.get(objectPath);
      return new Response(body || "", { status: body ? 200 : 404 });
    },
  });
  return { client, objects, uploads };
}

function makeLedgerRequest() {
  const records = new Map();
  const calls = [];
  const request = async (_client, route, options = {}) => {
    calls.push({ route, options });
    if (route.startsWith("/rest/v1/migration_runs")) {
      return options.method === "POST" ? [{ id: "run-1" }] : null;
    }
    if (!route.startsWith("/rest/v1/storage_migration_records")) return null;
    if (!options.method || options.method === "GET") {
      const sourceKey = decodeURIComponent(route.match(/source_key=eq\.([^&]+)/)?.[1] || "");
      const record = records.get(sourceKey);
      return record ? [record] : [];
    }
    const record = options.body;
    records.set(record.source_key, record);
    return null;
  };
  return { request, records, calls };
}

test("collectStorageManifest returns stable ordered records with hashes and content types", async () => {
  const rootDir = await makeFixture();
  try {
    const records = await collectStorageManifest({ rootDir });
    assert.deepEqual(records.map(record => record.sourceKey), [
      "file:data/inventory-images/products/product-1.png",
      "file:documents/2026/09/REQ-1/data.json",
      "file:documents/2026/09/REQ-1/pdf/receipt.pdf",
      "file:documents/2026/09/REQ-1/raw/slip.txt",
    ]);
    const pdf = records.find(record => record.objectPath.endsWith("receipt.pdf"));
    assert.equal(pdf.contentType, "application/pdf");
    assert.equal(pdf.byteSize, 3);
    assert.match(pdf.sourceSha256, /^[a-f0-9]{64}$/);
    assert.equal(pdf.objectPath, "documents/2026/09/REQ-1/pdf/receipt.pdf");
    assert.equal(await readFile(pdf.absolutePath, "utf8"), "pdf");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("collectStorageManifest rejects symlinks under approved roots", async () => {
  const rootDir = await makeFixture();
  try {
    await symlink(join(rootDir, "documents", "2026", "09", "REQ-1", "data.json"), join(rootDir, "documents", "linked.json"));
    await assert.rejects(() => collectStorageManifest({ rootDir }), error => error.code === "STORAGE_SOURCE_SYMLINK");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("collectStorageManifest ignores unsupported roots and rejects an invalid root", async () => {
  const rootDir = await makeFixture();
  try {
    await writeFile(join(rootDir, "not-approved.bin"), "do not upload");
    const records = await collectStorageManifest({ rootDir });
    assert.equal(records.some(record => record.sourceKey.includes("not-approved")), false);
    await assert.rejects(() => collectStorageManifest({ rootDir: join(rootDir, "missing") }), error => error.code === "STORAGE_ROOT_MISSING");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("storage migration dry-run reports counts without DB or Storage writes", async () => {
  const rootDir = await makeFixture();
  const storage = makeStorageFixture();
  const ledger = makeLedgerRequest();
  try {
    const result = await planStorageMigration({ rootDir, now: () => "2026-09-25T00:00:00.000Z" });
    assert.deepEqual(result.counts, { documentFiles: 3, inventoryImages: 1, total: 4 });
    assert.equal(result.mode, "dry-run");
    assert.equal(result.writes, 0);
    assert.equal(storage.uploads.length, 0);
    assert.equal(ledger.calls.length, 0);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(rootDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("storage migration apply is idempotent and re-uploads changed source bytes", async () => {
  const rootDir = await makeFixture();
  const storage = makeStorageFixture();
  const ledger = makeLedgerRequest();
  try {
    const first = await applyStorageMigration({
      rootDir,
      client: storage.client,
      request: ledger.request,
      now: () => "2026-09-25T00:00:00.000Z",
    });
    assert.equal(first.writes, 4);
    assert.equal(storage.uploads.length, 4);
    const second = await applyStorageMigration({
      rootDir,
      client: storage.client,
      request: ledger.request,
      now: () => "2026-09-25T00:00:00.000Z",
    });
    assert.equal(second.writes, 0);
    assert.equal(second.skipped, 4);
    assert.equal(storage.uploads.length, 4);

    await writeFile(join(rootDir, "documents", "2026", "09", "REQ-1", "data.json"), "{\"changed\":true}\n");
    const third = await applyStorageMigration({
      rootDir,
      client: storage.client,
      request: ledger.request,
      now: () => "2026-09-25T00:00:00.000Z",
    });
    assert.equal(third.writes, 1);
    assert.equal(third.skipped, 3);
    assert.equal(storage.uploads.length, 5);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("storage migration does not record a source when downloaded bytes fail verification", async () => {
  const rootDir = await makeFixture();
  const storage = makeStorageFixture({ mismatch: true });
  const ledger = makeLedgerRequest();
  try {
    await assert.rejects(() => applyStorageMigration({
      rootDir,
      client: storage.client,
      request: ledger.request,
      now: () => "2026-09-25T00:00:00.000Z",
    }), error => {
      assert.equal(error.code, "STORAGE_VERIFY_FAILED");
      assert.equal(error.sourceKey, "file:data/inventory-images/products/product-1.png");
      assert.equal(error.relativePath, "data/inventory-images/products/product-1.png");
      return true;
    });
    assert.equal(ledger.records.size, 0);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
