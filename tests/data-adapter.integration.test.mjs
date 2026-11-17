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
  const saved = new Map();
  let nextId = 8000000000000000;
  try {
    const client = createSupabaseAdminClient({
      url: "https://project.supabase.co",
      serviceRoleKey: "secret",
      fetchImpl: async (url, options) => {
        const route = new URL(url);
        const table = route.pathname.split("/").pop();
        const method = options.method || "GET";
        const body = options.body ? JSON.parse(options.body) : null;
        if (route.pathname.endsWith("/rpc/allocate_inventory_source_id")) return new Response(JSON.stringify(++nextId), { status: 200 });
        if (method === "GET" && table === "inventory_product_categories") return new Response(JSON.stringify([{ source_id: 1, name: "เสื้อ", status: "active" }]), { status: 200 });
        if (method === "GET" && table === "inventory_products") {
          const selected = [...saved.values()].filter(row => row.table === table).map(row => row.value);
          const parentFilter = route.searchParams.get("source_id");
          return new Response(JSON.stringify(parentFilter ? selected.filter(row => String(row.source_id) === parentFilter.slice(3)) : selected), { status: 200 });
        }
        if (method === "GET" && table === "inventory_stock_skus") return new Response(JSON.stringify([]), { status: 200 });
        if (method === "POST" && ["inventory_products", "inventory_stock_skus"].includes(table)) {
          cloudCalls.push({ table, body });
          saved.set(`${table}:${body.source_id}`, { table, value: body });
          return new Response(JSON.stringify([body]), { status: 200 });
        }
        throw new Error(`Unexpected mocked Supabase request: ${options.method} ${route.pathname}`);
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
    assert.equal(cloudCalls[0].body.source_key, `product:${product.id}`);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("inventory supabase-read allocates source identities for new products and stock SKUs", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "sweet-house-adapter-"));
  const cloudCalls = [];
  let nextId = 8000000000000000;
  try {
    const client = createSupabaseAdminClient({
      url: "https://project.supabase.co",
      serviceRoleKey: "secret",
      fetchImpl: async (url, options) => {
        const route = new URL(url);
        const table = route.pathname.split("/").pop();
        const method = options.method || "GET";
        const body = options.body ? JSON.parse(options.body) : null;
        if (route.pathname.endsWith("/rpc/allocate_inventory_source_id")) return new Response(JSON.stringify(++nextId), { status: 200 });
        if (method === "GET" && table === "inventory_product_categories") return new Response(JSON.stringify([{ source_id: 1, name: "เสื้อ", status: "active" }]), { status: 200 });
        if (method === "GET" && table === "inventory_products") {
          const parentFilter = route.searchParams.get("source_id");
          return new Response(JSON.stringify(parentFilter ? cloudCalls.filter(row => row.table === table && String(row.body.source_id) === parentFilter.slice(3)).map(row => row.body) : cloudCalls.filter(row => row.table === table).map(row => row.body)), { status: 200 });
        }
        if (method === "GET" && table === "inventory_stock_skus") return new Response(JSON.stringify(cloudCalls.filter(row => row.table === table).map(row => row.body)), { status: 200 });
        if (method === "POST" && ["inventory_products", "inventory_stock_skus"].includes(table)) {
          cloudCalls.push({ table, body });
          return new Response(JSON.stringify([body]), { status: 200 });
        }
        throw new Error(`Unexpected mocked Supabase request: ${options.method} ${route.pathname}`);
      },
    });
    const adapter = createInventoryDataAdapter({
      rootDir,
      env: { DATA_BACKEND_INVENTORY: "supabase-read" },
      client,
    });

    const product = await adapter.write("saveProduct", {
      productCode: "AUDIT-PRODUCT", name: "Audit Product", category: "เสื้อ",
    });
    const stockSku = await adapter.write("saveStockSku", {
      productId: product.id, sku: "AUDIT-SKU", color: "ดำ", size: "M",
    });

    assert.ok(Number.isSafeInteger(Number(product.id)) && Number(product.id) > 0);
    assert.ok(Number.isSafeInteger(Number(stockSku.id)) && Number(stockSku.id) > 0);
    const productWrite = cloudCalls.find(row => row.table === "inventory_products");
    const skuWrite = cloudCalls.find(row => row.table === "inventory_stock_skus");
    assert.equal(productWrite.body.source_key, `product:${product.id}`);
    assert.equal(skuWrite.body.source_key, `stock_sku:${stockSku.id}`);
    assert.equal(skuWrite.body.product_source_id, product.id);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
