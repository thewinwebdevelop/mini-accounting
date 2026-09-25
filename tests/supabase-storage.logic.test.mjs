import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createSupabaseStorageClient,
  downloadStorageObject,
  storageRequest,
  uploadStorageObject,
} = require("../forms/supabase-storage.logic.js");

test("storage client targets the configured private bucket and storage API", () => {
  const client = createSupabaseStorageClient({
    url: "https://project.supabase.co",
    serviceRoleKey: "server-secret",
    bucket: "sweet-house-files",
    fetchImpl: async () => new Response("{}", { status: 200 }),
  });
  assert.deepEqual(
    { url: client.url, bucket: client.bucket, serviceRoleKey: client.serviceRoleKey },
    { url: "https://project.supabase.co", bucket: "sweet-house-files", serviceRoleKey: "server-secret" },
  );
});

test("uploadStorageObject sends bytes and server authentication headers", async () => {
  let call;
  const client = createSupabaseStorageClient({
    url: "https://project.supabase.co",
    serviceRoleKey: "server-secret",
    fetchImpl: async (url, options) => {
      call = { url, options };
      return new Response(JSON.stringify({ Key: "documents/2026/a.pdf" }), { status: 200 });
    },
  });
  await uploadStorageObject(client, {
    objectPath: "documents/2026/a.pdf",
    body: Buffer.from("pdf-bytes"),
    contentType: "application/pdf",
    headers: { apikey: "attacker-key", Authorization: "Bearer attacker-token" },
  });
  assert.equal(call.url, "https://project.supabase.co/storage/v1/object/sweet-house-files/documents/2026/a.pdf");
  assert.equal(call.options.method, "POST");
  assert.equal(call.options.headers.apikey, "server-secret");
  assert.equal(call.options.headers.Authorization, "Bearer server-secret");
  assert.equal(call.options.headers["content-type"], "application/pdf");
  assert.equal(call.options.headers["x-upsert"], "true");
  assert.deepEqual(Buffer.from(call.options.body), Buffer.from("pdf-bytes"));
});

test("downloadStorageObject returns provider bytes", async () => {
  const client = createSupabaseStorageClient({
    url: "https://project.supabase.co",
    serviceRoleKey: "server-secret",
    fetchImpl: async () => new Response(Buffer.from([0, 1, 2, 255]), { status: 200 }),
  });
  const bytes = await downloadStorageObject(client, "documents/2026/raw.bin");
  assert.deepEqual(Buffer.from(bytes), Buffer.from([0, 1, 2, 255]));
});

test("storageRequest redacts provider response details on error", async () => {
  const client = createSupabaseStorageClient({
    url: "https://project.supabase.co",
    serviceRoleKey: "server-secret",
    fetchImpl: async () => new Response("secret storage detail", { status: 500 }),
  });
  await assert.rejects(() => storageRequest(client, "documents/a.pdf"), error => {
    assert.equal(error.code, "SUPABASE_STORAGE_REQUEST_FAILED");
    assert.doesNotMatch(error.message, /secret storage detail/);
    return true;
  });
});

test("storage migration SQL defines a private bucket and protected ledger", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260925_003_storage.sql", import.meta.url), "utf8");
  assert.match(sql, /storage\.buckets/);
  assert.match(sql, /sweet-house-files/);
  assert.match(sql, /public[\s\S]{0,120}false/);
  assert.match(sql, /storage_migration_records/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.storage_migration_records from anon, authenticated/);
});
