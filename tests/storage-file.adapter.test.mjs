import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createSupabaseAdminClient } = require("../forms/supabase.logic.js");
const { createFileAdapter, objectIdentity } = require("../forms/storage-file.adapter.js");

test("storage identity accepts only approved local roots", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "sweet-house-storage-"));
  try {
    assert.deepEqual(objectIdentity(rootDir, path.join(rootDir, "documents", "2026", "a.pdf")), {
      sourceKey: "file:documents/2026/a.pdf",
      objectPath: "documents/2026/a.pdf",
    });
    assert.deepEqual(objectIdentity(rootDir, path.join(rootDir, "data", "inventory-images", "a.png")), {
      sourceKey: "file:data/inventory-images/a.png",
      objectPath: "inventory-images/a.png",
    });
    assert.throws(() => objectIdentity(rootDir, path.join(rootDir, "other", "a.txt")), error => error.code === "STORAGE_SOURCE_NOT_APPROVED");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("Storage-read verifies the manifest hash before returning bytes", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "sweet-house-storage-"));
  try {
    const absolutePath = path.join(rootDir, "documents", "a.pdf");
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, "local");
    const client = createSupabaseAdminClient({
      url: "https://project.supabase.co",
      serviceRoleKey: "secret",
      fetchImpl: async () => new Response(JSON.stringify([{
        source_sha256: "56681010b753e1abe52c449d0aab291b28f1808a3a91b6baeaa726883baad4b0",
        byte_size: 5,
        content_type: "application/pdf",
        object_path: "documents/a.pdf",
      }]), { status: 200 }),
    });
    const adapter = createFileAdapter({
      rootDir,
      env: { DATA_BACKEND_FILES: "supabase-read" },
      client,
      storageClient: { bucket: "sweet-house-files" },
      downloadObject: async () => Buffer.from("cloud"),
    });
    const result = await adapter.read({ file: { absolutePath, fileName: "a.pdf" }, localRead: () => Buffer.from("local") });
    assert.equal(result.body.toString(), "cloud");
    assert.equal(result.contentType, "application/pdf");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
