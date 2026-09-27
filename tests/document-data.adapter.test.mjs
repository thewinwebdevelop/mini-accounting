import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createSupabaseAdminClient } = require("../forms/supabase.logic.js");
const { buildDocumentCloudRecord, createDocumentDataAdapter } = require("../forms/document-data.adapter.js");

test("document cloud records use stable identity and remove private filesystem paths", () => {
  const record = buildDocumentCloudRecord({
    documentKind: "expense_request",
    documentNo: "EXP-2026-09-0001",
    payload: { ownerUserId: "user-1", absoluteFolderPath: "/private/root", amount: 10 },
    result: { status: "draft" },
  });
  assert.equal(record.sourceKey, "document:expense_request:EXP-2026-09-0001");
  assert.equal(record.ownerUserId, "user-1");
  assert.equal(record.payload.absoluteFolderPath, undefined);
  assert.equal(record.payload.amount, 10);
});

test("document dual-write mirrors a successful local save and returns the local response", async () => {
  const calls = [];
  const client = createSupabaseAdminClient({
    url: "https://project.supabase.co",
    serviceRoleKey: "secret",
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      return new Response(JSON.stringify([{ source_key: body.source_key, source_hash: body.source_hash }]), { status: 200 });
    },
  });
  const adapter = createDocumentDataAdapter({ env: { DATA_BACKEND_DOCUMENTS: "dual-write" }, client });
  const result = await adapter.save({
    localSave: async () => ({ documentNo: "EXP-1", status: "draft", localOnly: true }),
    documentKind: "expense_request",
    documentNo: "EXP-1",
    payload: { ownerUserId: "user-1", amount: 50 },
  });
  assert.deepEqual(result, { documentNo: "EXP-1", status: "draft", localOnly: true });
  assert.equal(calls[0].source_key, "document:expense_request:EXP-1");
});

test("document dual-write uses the generated receipt number when a new substitute receipt has no identity yet", async () => {
  const calls = [];
  const client = createSupabaseAdminClient({
    url: "https://project.supabase.co",
    serviceRoleKey: "secret",
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      return new Response(JSON.stringify([{ source_key: body.source_key, source_hash: body.source_hash }]), { status: 200 });
    },
  });
  const adapter = createDocumentDataAdapter({ env: { DATA_BACKEND_DOCUMENTS: "dual-write" }, client });

  await adapter.save({
    localSave: async () => ({ receiptNo: "SR-2026-09-0001", status: "draft" }),
    documentKind: "substitute_receipt",
    documentNo: "",
    payload: { receiptNo: "", ownerUserId: "user-1" },
  });

  assert.equal(calls[0].source_key, "document:substitute_receipt:SR-2026-09-0001");
  assert.equal(calls[0].document_no, "SR-2026-09-0001");
});

test("cloud document save persists generated files before the document row", async () => {
  const order = [];
  const client = createSupabaseAdminClient({
    url: "https://project.supabase.co",
    serviceRoleKey: "secret",
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      order.push(body.source_key);
      return new Response(JSON.stringify([{ source_key: body.source_key, source_hash: body.source_hash }]), { status: 200 });
    },
  });
  const adapter = createDocumentDataAdapter({
    env: { DATA_BACKEND_DOCUMENTS: "supabase-read" },
    client,
    persistFiles: async ({ folderPath, documentNo }) => {
      order.push(`files:${folderPath}:${documentNo}`);
    },
  });
  await adapter.save({
    localSave: async () => ({ documentNo: "EXP-1", folderPath: "documents/EXP-1" }),
    documentKind: "expense_request",
    documentNo: "EXP-1",
    payload: { folderPath: "documents/EXP-1" },
  });
  assert.deepEqual(order, ["files:documents/EXP-1:EXP-1", "document:expense_request:EXP-1"]);
});

test("document dual-write returns a safe retryable error on cloud failure", async () => {
  const client = createSupabaseAdminClient({
    url: "https://project.supabase.co",
    serviceRoleKey: "secret",
    fetchImpl: async () => new Response("provider secret", { status: 500 }),
  });
  const adapter = createDocumentDataAdapter({ env: { DATA_BACKEND_DOCUMENTS: "dual-write" }, client });
  await assert.rejects(() => adapter.save({
    localSave: async () => ({ documentNo: "EXP-1" }),
    documentKind: "expense_request",
    documentNo: "EXP-1",
    payload: {},
  }), error => error.code === "DATA_CLOUD_WRITE_FAILED" && error.retryable === true && !error.message.includes("provider secret"));
});

test("document supabase-read returns cloud payloads while explicit local fallback preserves local results", async () => {
  const client = createSupabaseAdminClient({
    url: "https://project.supabase.co",
    serviceRoleKey: "secret",
    fetchImpl: async () => new Response(JSON.stringify([{
      source_key: "document:expense_request:EXP-1",
      document_kind: "expense_request",
      document_no: "EXP-1",
      status: "draft",
      payload: { requestNo: "EXP-1", amount: 10 },
    }]), { status: 200 }),
  });
  const adapter = createDocumentDataAdapter({ env: { DATA_BACKEND_DOCUMENTS: "supabase-read" }, client });
  assert.deepEqual(await adapter.list({ localResult: [{ requestNo: "local-only" }], documentKind: "expense_request" }), [{
    requestNo: "EXP-1",
    amount: 10,
    documentKind: "expense_request",
    documentNo: "EXP-1",
    status: "draft",
  }]);
});

test("document list can scope shadow comparison to the same bounded document kinds", async () => {
  let requestedUrl = "";
  const client = createSupabaseAdminClient({
    url: "https://project.supabase.co",
    serviceRoleKey: "secret",
    fetchImpl: async url => {
      requestedUrl = String(url);
      return new Response(JSON.stringify([{
        source_key: "document:purchase_order:PO-1",
        document_kind: "purchase_order",
        document_no: "PO-1",
        status: "draft",
        payload: { documentKind: "purchase_order", documentNo: "PO-1" },
      }]), { status: 200 });
    },
  });
  const logs = [];
  const adapter = createDocumentDataAdapter({
    env: { DATA_BACKEND_DOCUMENTS: "shadow" },
    client,
    logger: event => logs.push(event),
  });
  await adapter.list({
    localResult: [{ documentKind: "purchase_order", documentNo: "PO-1" }],
    filters: {
      documentKinds: ["purchase_order", "payment_voucher", "goods_receipt"],
      status: "draft",
    },
  });

  const query = new URL(requestedUrl).searchParams;
  assert.equal(query.get("status"), "eq.draft");
  assert.equal(query.get("or"), "(document_kind.eq.purchase_order,document_kind.eq.payment_voucher,document_kind.eq.goods_receipt)");
  assert.deepEqual(logs, []);
});
