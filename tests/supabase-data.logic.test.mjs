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

test("repository allocates workflow transaction numbers through the durable Supabase RPC", async () => {
  const calls = [];
  const repository = createSupabaseDataRepository({
    client: fakeClient(calls, () => [{
      sequence: 4,
      transaction_no: "TXN-2026-09-0004",
      existing: false,
    }]),
  });

  const result = await repository.allocateWorkflowTransactionNumber({
    accountingMonth: "2026-09",
    requestKey: "create-request-1",
  });

  assert.deepEqual(result, {
    sequence: "4",
    transactionNo: "TXN-2026-09-0004",
    existing: false,
  });
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/allocate_workflow_transaction_number$/);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    p_accounting_month: "2026-09",
    p_request_key: "create-request-1",
  });
});

test("repository lists only requested Shopee mapping bundles by exact product and option key", async () => {
  const calls = [];
  const repository = createSupabaseDataRepository({
    client: fakeClient(calls, () => [
      { product_name_key: "ชุดเซต", option_name_key: "ฟ้า", bundle: [{ sku: "SKU-A", quantity: 2 }, { sku: "SKU-B", quantity: 1 }] },
      { product_name_key: "ชุดเซต", option_name_key: "แดง", bundle: [{ sku: "SKU-C", quantity: 1 }] },
    ]),
  });

  const result = await repository.listShopeeCustomLabelMappings(["ชุดเซต::ฟ้า"]);

  assert.deepEqual(result, {
    "ชุดเซต::ฟ้า": [{ sku: "SKU-A", quantity: 2 }, { sku: "SKU-B", quantity: 1 }],
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/shopee_custom_label_mappings(?:\?|$)/);
  assert.equal(calls[0].options.method, undefined);
});

test("repository bulk upserts Shopee mappings and returns verified multi-SKU bundles", async () => {
  const calls = [];
  const savedRows = [
    { product_name_key: "ชุดเซต", option_name_key: "ฟ้า", product_name_display: "ชุดเซต", option_name_display: "ฟ้า", bundle: [{ sku: "SKU-A", quantity: 2 }, { sku: "SKU-B", quantity: 1 }] },
    { product_name_key: "ชุดเซต", option_name_key: "แดง", product_name_display: "ชุดเซต", option_name_display: "แดง", bundle: [{ sku: "SKU-C", quantity: 3 }] },
  ];
  const repository = createSupabaseDataRepository({ client: fakeClient(calls, () => savedRows) });

  const result = await repository.upsertShopeeCustomLabelMappings({
    "ชุดเซต::ฟ้า": { productName: "ชุดเซต", optionName: "ฟ้า", bundle: [{ sku: "SKU-A", quantity: 2 }, { sku: "SKU-B", quantity: 1 }] },
    "ชุดเซต::แดง": { productName: "ชุดเซต", optionName: "แดง", bundle: [{ sku: "SKU-C", quantity: 3 }] },
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/shopee_custom_label_mappings\?on_conflict=product_name_key,option_name_key$/);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Prefer, "resolution=merge-duplicates,return=representation");
  assert.deepEqual(JSON.parse(calls[0].options.body), savedRows);
  assert.deepEqual(result, {
    "ชุดเซต::ฟ้า": { productName: "ชุดเซต", optionName: "ฟ้า", bundle: [{ sku: "SKU-A", quantity: 2 }, { sku: "SKU-B", quantity: 1 }] },
    "ชุดเซต::แดง": { productName: "ชุดเซต", optionName: "แดง", bundle: [{ sku: "SKU-C", quantity: 3 }] },
  });
});

test("repository rejects Shopee mapping upsert when a returned bundle differs", async () => {
  const repository = createSupabaseDataRepository({
    client: fakeClient([], () => [{
      product_name_key: "ชุดเซต",
      option_name_key: "ฟ้า",
      bundle: [{ sku: "SKU-A", quantity: 1 }],
    }]),
  });

  await assert.rejects(
    () => repository.upsertShopeeCustomLabelMappings({
      "ชุดเซต::ฟ้า": { productName: "ชุดเซต", optionName: "ฟ้า", bundle: [{ sku: "SKU-A", quantity: 2 }] },
    }),
    error => error.code === "SUPABASE_DATA_VERIFY_FAILED",
  );
});

test("repository rejects Shopee mapping upsert when a returned key is missing", async () => {
  const repository = createSupabaseDataRepository({
    client: fakeClient([], () => [{
      product_name_key: "ชุดเซต",
      option_name_key: "ฟ้า",
      bundle: [{ sku: "SKU-A", quantity: 2 }],
    }]),
  });

  await assert.rejects(
    () => repository.upsertShopeeCustomLabelMappings({
      "ชุดเซต::ฟ้า": { productName: "ชุดเซต", optionName: "ฟ้า", bundle: [{ sku: "SKU-A", quantity: 2 }] },
      "ชุดเซต::แดง": { productName: "ชุดเซต", optionName: "แดง", bundle: [{ sku: "SKU-C", quantity: 1 }] },
    }),
    error => error.code === "SUPABASE_DATA_VERIFY_FAILED",
  );
});
