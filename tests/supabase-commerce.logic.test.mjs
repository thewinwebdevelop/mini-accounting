import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createSupabaseAdminClient } = require("../forms/supabase.logic.js");
const { createSupabaseCommerceService } = require("../forms/supabase-commerce.logic.js");

function serviceWithFetch(fetchImpl) {
  const client = createSupabaseAdminClient({
    url: "https://project.supabase.co",
    serviceRoleKey: "test-service-key",
    fetchImpl,
  });
  return createSupabaseCommerceService({ client });
}

test("Shopee connections and orders use durable natural identities", async () => {
  const calls = [];
  const service = serviceWithFetch(async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/rest/v1/commerce_records?")) return new Response("[]", { status: 200 });
    const body = JSON.parse(options.body);
    const record = {
      record_type: body.p_record_type,
      identity_key: body.p_identity_key,
      source_key: `${body.p_record_type}:${body.p_identity_key}`,
      payload: body.p_payload,
      revision: 1,
      created_at: "2026-11-10T00:00:00.000Z",
      updated_at: "2026-11-10T00:00:00.000Z",
    };
    return new Response(JSON.stringify(record), { status: 200 });
  });

  const connection = await service.saveShopeeConnection({ shopId: "SHOP-7", accessToken: "access", refreshToken: "refresh" });
  const order = await service.upsertShopeeOrder({ shopId: "SHOP-7", orderSn: "ORDER-8", lines: [{ lineNo: "1" }] });

  assert.equal(connection.shopId, "SHOP-7");
  assert.equal(order.order.orderSn, "ORDER-8");
  const upserts = calls.filter(call => call.url.includes("/rpc/upsert_commerce_record"));
  assert.equal(upserts.length, 2);
  assert.equal(JSON.parse(upserts[0].options.body).p_record_type, "shopee_connection");
  assert.equal(JSON.parse(upserts[0].options.body).p_identity_key, "SHOP-7");
  assert.equal(JSON.parse(upserts[1].options.body).p_identity_key, "SHOP-7:ORDER-8");
});

test("OAuth state consumption is delegated to an atomic Supabase RPC", async () => {
  const calls = [];
  const service = serviceWithFetch(async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify([{ state: "state-token", returnUrl: "/shopee", consumedAt: "2026-11-10T00:01:00.000Z" }]), { status: 200 });
  });

  const result = await service.consumeShopeeOAuthState("state-token", { now: "2026-11-10T00:01:00.000Z" });

  assert.equal(result.state, "state-token");
  assert.match(calls[0].url, /rpc\/consume_shopee_oauth_state$/);
  assert.deepEqual(JSON.parse(calls[0].options.body), { p_state: "state-token", p_now: "2026-11-10T00:01:00.000Z" });
});

test("shipment actions use an idempotent claim RPC", async () => {
  const calls = [];
  const service = serviceWithFetch(async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ claimed: false, action: { idempotencyKey: "arrange:batch-1", status: "succeeded" } }), { status: 200 });
  });

  const result = await service.claimShipmentAction({
    idempotencyKey: "arrange:batch-1",
    actionType: "arrange_shipment",
    payload: { batchId: "batch-1" },
  });

  assert.equal(result.claimed, false);
  assert.equal(result.action.status, "succeeded");
  assert.match(calls[0].url, /rpc\/claim_commerce_action$/);
});

test("failed and in-flight shipment claims are surfaced instead of returned as success", async () => {
  for (const status of ["failed", "running"]) {
    const service = serviceWithFetch(async () => new Response(JSON.stringify({ claimed: false, action: { status, result: {} } }), { status: 200 }));
    await assert.rejects(() => service.claimShipmentAction({ idempotencyKey: `retry:${status}`, actionType: "arrange_shipment" }), error => error.code === (status === "failed" ? "COMMERCE_ACTION_FAILED" : "COMMERCE_ACTION_IN_PROGRESS"));
  }
});

test("CAS conflicts on concurrent order updates are retried against the latest revision", async () => {
  const calls = [];
  let reads = 0;
  let writes = 0;
  const service = serviceWithFetch(async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/rest/v1/commerce_records?")) {
      reads += 1;
      if (reads === 1) return new Response("[]", { status: 200 });
      return new Response(JSON.stringify([{ record_type: "platform_order", identity_key: "SHOP:ORDER", source_key: "platform_order:SHOP:ORDER", payload: { lines: [] }, revision: 2 }]), { status: 200 });
    }
    writes += 1;
    if (writes === 1) return new Response(JSON.stringify({ code: "40001" }), { status: 409 });
    const body = JSON.parse(options.body);
    return new Response(JSON.stringify({ record_type: body.p_record_type, identity_key: body.p_identity_key, payload: body.p_payload, revision: 3 }), { status: 200 });
  });
  const result = await service.upsertShopeeOrder({ shopId: "SHOP", orderSn: "ORDER", lines: [{ lineNo: "1" }] });
  assert.equal(result.order.orderSn, "ORDER");
  assert.equal(reads, 2);
  assert.equal(writes, 2);
  assert.equal(JSON.parse(calls.at(-1).options.body).p_expected_revision, 2);
});

test("already-posted import replay returns its stored movements", async () => {
  const service = serviceWithFetch(async () => new Response(JSON.stringify([{ record_type: "platform_order_import", identity_key: "IMP-1", payload: { importNo: "IMP-1", status: "posted", postedMovements: [{ source_key: "stock_movement:1" }] }, revision: 2 }]), { status: 200 }));
  const result = await service.postPlatformOrderImport("IMP-1");
  assert.equal(result.status, "posted");
  assert.equal(result.postedMovements[0].source_key, "stock_movement:1");
});

test("posting a commerce import applies its records atomically and idempotently", async () => {
  const calls = [];
  const service = serviceWithFetch(async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ applied: true, records: [{ recordType: "platform_order_import", identityKey: "IMP-1" }] }), { status: 200 });
  });

  const result = await service.applyCommerceMutations({
    idempotencyKey: "post-import:IMP-1",
    mutations: [{ recordType: "platform_order_import", identityKey: "IMP-1", payload: { status: "posted" } }],
  });

  assert.equal(result.applied, true);
  assert.match(calls[0].url, /rpc\/apply_commerce_mutations$/);
  assert.equal(JSON.parse(calls[0].options.body).p_idempotency_key, "post-import:IMP-1");
});
