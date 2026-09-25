import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createSupabaseAdminClient } = require("../forms/supabase.logic.js");
const { createSupabaseDataRepository } = require("../forms/supabase-data.logic.js");

function fakeClient(calls, responseFactory = () => [{ source_key: "product:1", source_hash: "hash-1" }]) {
  return createSupabaseAdminClient({
    url: "https://project.supabase.co",
    serviceRoleKey: "server-secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify(responseFactory(url, options)), { status: 200 });
    },
  });
}

test("inventory repository upserts by source key and verifies the returned row", async () => {
  const calls = [];
  const repository = createSupabaseDataRepository({ client: fakeClient(calls) });
  const row = await repository.upsertInventoryProduct({
    sourceKey: "product:1",
    sourceId: 1,
    productCode: "P-1",
    name: "Product",
    sourceHash: "hash-1",
    sourcePayload: { name: "Product" },
  });
  assert.equal(row.sourceKey, "product:1");
  assert.match(calls[0].url, /\/rest\/v1\/inventory_products\?on_conflict=source_key$/);
  assert.equal(calls[0].options.headers.Prefer, "resolution=merge-duplicates,return=representation");
  assert.equal(JSON.parse(calls[0].options.body).source_key, "product:1");
});

test("inventory repository rejects a provider response for a different source hash", async () => {
  const repository = createSupabaseDataRepository({
    client: fakeClient([], () => [{ source_key: "product:1", source_hash: "wrong" }]),
  });
  await assert.rejects(
    () => repository.upsertInventoryProduct({ sourceKey: "product:1", sourceHash: "expected" }),
    error => error.code === "SUPABASE_DATA_VERIFY_FAILED",
  );
});

test("repository maps document records and keeps payload opaque", async () => {
  const calls = [];
  const repository = createSupabaseDataRepository({
    client: fakeClient(calls, () => [{
      source_key: "document:EXP-1",
      document_kind: "expense_request",
      document_no: "EXP-1",
      owner_user_id: "user-1",
      status: "draft",
      accounting_month: "2026-09",
      payload: { privateField: "value" },
      source_hash: "hash-1",
    }]),
  });
  const row = await repository.upsertDocument({
    sourceKey: "document:EXP-1",
    documentKind: "expense_request",
    documentNo: "EXP-1",
    ownerUserId: "user-1",
    status: "draft",
    accountingMonth: "2026-09",
    payload: { privateField: "value" },
    sourceHash: "hash-1",
  });
  assert.equal(row.documentKind, "expense_request");
  assert.equal(row.ownerUserId, "user-1");
  assert.deepEqual(row.payload, { privateField: "value" });
  assert.equal(JSON.parse(calls[0].options.body).owner_user_id, "user-1");
});
