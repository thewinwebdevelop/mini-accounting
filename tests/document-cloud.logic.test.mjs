import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createSupabaseAdminClient } = require("../forms/supabase.logic.js");
const { createDocumentCloudRepository } = require("../forms/document-cloud.logic.js");

test("document repository lists by owner and status without exposing private fields", async () => {
  const calls = [];
  const client = createSupabaseAdminClient({
    url: "https://project.supabase.co",
    serviceRoleKey: "secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify([{ source_key: "document:1", owner_user_id: "user-1", status: "draft" }]), { status: 200 });
    },
  });
  const repository = createDocumentCloudRepository({ client });
  const rows = await repository.listDocuments({ ownerUserId: "user-1", status: "draft" });
  assert.deepEqual(rows[0], { sourceKey: "document:1", ownerUserId: "user-1", status: "draft" });
  assert.match(calls[0].url, /owner_user_id=eq\.user-1/);
  assert.match(calls[0].url, /status=eq\.draft/);
  assert.doesNotMatch(JSON.stringify(rows), /secret/);
});

test("document file references use stable source keys and return normalized data", async () => {
  const calls = [];
  const client = createSupabaseAdminClient({
    url: "https://project.supabase.co",
    serviceRoleKey: "secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify([{ source_key: "file:document:1:pdf", object_path: "documents/1.pdf", source_sha256: "abc" }]), { status: 200 });
    },
  });
  const repository = createDocumentCloudRepository({ client });
  const file = await repository.upsertDocumentFile({
    sourceKey: "file:document:1:pdf",
    documentSourceKey: "document:1",
    bucketName: "sweet-house-files",
    objectPath: "documents/1.pdf",
    sourceSha256: "abc",
    byteSize: 10,
    contentType: "application/pdf",
    originalName: "1.pdf",
  });
  assert.equal(file.objectPath, "documents/1.pdf");
  assert.match(calls[0].url, /document_files\?on_conflict=source_key/);
  assert.equal(JSON.parse(calls[0].options.body).document_source_key, "document:1");
});
