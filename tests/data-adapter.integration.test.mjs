import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createInventoryDataAdapter } = require("../forms/local-data.adapter.js");
const { createSupabaseAdminClient } = require("../forms/supabase.logic.js");

test("inventory adapter preserves local product behavior in local mode", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "sweet-house-adapter-"));
  try {
    const adapter = createInventoryDataAdapter({ rootDir, env: { DATA_BACKEND: "local" } });
    const product = await adapter.write("saveProduct", { productCode: "ADAPTER-1", name: "Adapter Product", category: "เสื้อ" });
    assert.equal(product.productCode, "ADAPTER-1");
    assert.equal((await adapter.read("listProducts", { search: "ADAPTER" })).length, 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("inventory dual-write sends the local result with its stable numeric identity to cloud", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "sweet-house-adapter-"));
  const cloudCalls = [];
  try {
    const client = createSupabaseAdminClient({
      url: "https://project.supabase.co",
      serviceRoleKey: "secret",
      fetchImpl: async (_url, options) => {
        cloudCalls.push(JSON.parse(options.body));
        const body = JSON.parse(options.body);
        return new Response(JSON.stringify([{ source_key: body.source_key, source_hash: body.source_hash, source_id: body.source_id }]), { status: 200 });
      },
    });
    const adapter = createInventoryDataAdapter({
      rootDir,
      env: { DATA_BACKEND_INVENTORY: "dual-write" },
      client,
      logger: () => {},
    });
    const product = await adapter.write("saveProduct", { productCode: "ADAPTER-2", name: "Adapter Product 2", category: "เสื้อ" });
    assert.equal(product.productCode, "ADAPTER-2");
    assert.equal(cloudCalls[0].source_key, `inventory_product:${product.id}`);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
