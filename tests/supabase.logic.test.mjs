import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  assertSupabaseConfiguration,
  createSupabaseAdminClient,
  supabaseRequest,
} = require("../forms/supabase.logic.js");

test("supabaseRequest sends the server key and returns JSON", async () => {
  const calls = [];
  const client = createSupabaseAdminClient({
    url: "https://project.supabase.co",
    serviceRoleKey: "server-secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify([{ id: "u-1" }]), { status: 200 });
    },
  });

  const rows = await supabaseRequest(client, "/rest/v1/app_users?line_user_id=eq.U-1", {
    headers: { Prefer: "return=representation" },
  });

  assert.deepEqual(rows, [{ id: "u-1" }]);
  assert.equal(calls[0].options.headers.apikey, "server-secret");
  assert.equal(calls[0].options.headers.Authorization, "Bearer server-secret");
  assert.equal(calls[0].options.headers.Prefer, "return=representation");
});

test("supabaseRequest redacts provider response details on error", async () => {
  const client = createSupabaseAdminClient({
    url: "https://project.supabase.co",
    serviceRoleKey: "server-secret",
    fetchImpl: async () => new Response("secret database detail", { status: 500 }),
  });

  await assert.rejects(() => supabaseRequest(client, "/rest/v1/app_users"), error => {
    assert.equal(error.code, "SUPABASE_REQUEST_FAILED");
    assert.doesNotMatch(error.message, /secret database detail/);
    return true;
  });
});

test("assertSupabaseConfiguration rejects missing server secrets", () => {
  assert.throws(
    () => assertSupabaseConfiguration({ SUPABASE_URL: "https://project.supabase.co" }),
    error => error.code === "SUPABASE_CONFIG_MISSING",
  );
});
