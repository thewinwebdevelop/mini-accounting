import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createProduct, createPurchaseInMovement, createStockSku } = require("../forms/inventory.logic.js");
const { applyMigration, planMigration } = await import("../scripts/migrate-local-to-supabase.mjs");

async function makeFixture() {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-migration-"));
  await mkdir(join(rootDir, "config"), { recursive: true });
  await writeFile(join(rootDir, "config", "company-settings.json"), JSON.stringify({ legalName: "หจก.ทดสอบ", taxId: "010", branch: "สำนักงานใหญ่", address: "กรุงเทพ" }));
  await writeFile(join(rootDir, "config", "vendors.json"), JSON.stringify({ vendors: [
    { id: "VENDOR-1", name: "ร้านหนึ่ง", status: "active", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
    { id: "VENDOR-2", name: "ร้านสอง", status: "inactive", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
  ] }));
  const product = createProduct(rootDir, { productCode: "P-1", name: "เสื้อทดสอบ", category: "เสื้อ" }, { now: () => "2026-09-01T00:00:00.000Z" });
  const firstSku = createStockSku(rootDir, { productId: product.id, sku: "SKU-1", color: "แดง", size: "M", defaultUnitCost: "100" }, { now: () => "2026-09-01T00:00:00.000Z" });
  const secondSku = createStockSku(rootDir, { productId: product.id, sku: "SKU-2", color: "น้ำเงิน", size: "L", defaultUnitCost: "120" }, { now: () => "2026-09-01T00:00:00.000Z" });
  createPurchaseInMovement(rootDir, { stockSkuId: firstSku.id, quantity: 2, unitCost: "100", movementDate: "2026-09-01" }, { now: () => "2026-09-01T00:00:00.000Z" });
  createPurchaseInMovement(rootDir, { stockSkuId: firstSku.id, quantity: 1, unitCost: "110", movementDate: "2026-09-02" }, { now: () => "2026-09-02T00:00:00.000Z" });
  createPurchaseInMovement(rootDir, { stockSkuId: secondSku.id, quantity: 3, unitCost: "120", movementDate: "2026-09-02" }, { now: () => "2026-09-02T00:00:00.000Z" });
  return rootDir;
}

function fakeSupabase() {
  const rows = new Map();
  const inserted = [];
  return {
    inserted,
    request: async (_client, path, options = {}) => {
      const method = options.method || "GET";
      if (path.startsWith("/rest/v1/migration_records?") && method === "GET") {
        const sourceKey = decodeURIComponent(path.match(/source_key=eq\.([^&]+)/)?.[1] || "");
        const found = rows.get(`migration:${sourceKey}`);
        return found ? [found] : [];
      }
      if (path.startsWith("/rest/v1/migration_records") && method === "POST") {
        const record = Array.isArray(options.body) ? options.body[0] : options.body;
        rows.set(`migration:${record.source_key}`, record);
        return [record];
      }
      if (path.startsWith("/rest/v1/migration_runs") && method === "POST") return [{ id: "run-1" }];
      if (path.startsWith("/rest/v1/migration_runs") && method === "PATCH") return [];
      if (path.startsWith("/rest/v1/") && method === "GET") {
        const table = path.split("?")[0];
        const sourceKey = decodeURIComponent(path.match(/source_key=eq\.([^&]+)/)?.[1] || "");
        const found = rows.get(`${table}:${sourceKey}`);
        return found ? [found] : [];
      }
      if (path.startsWith("/rest/v1/") && method === "POST") {
        const record = Array.isArray(options.body) ? options.body[0] : options.body;
        inserted.push(record);
        rows.set(`${path.split("?")[0]}:${record.source_key}`, record);
        return [record];
      }
      throw new Error(`unexpected fake Supabase request ${method} ${path}`);
    },
  };
}

test("migration dry run reports deterministic counts without writing", async () => {
  const rootDir = await makeFixture();
  try {
    const result = await planMigration({ rootDir, now: () => "2026-09-25T00:00:00.000Z" });
    assert.deepEqual(result.counts, { companySettings: 1, vendors: 2, products: 1, stockSkus: 2, stockMovements: 3 });
    assert.equal(result.mode, "dry-run");
    assert.equal(result.writes, 0);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("apply migration is idempotent by source key", async () => {
  const rootDir = await makeFixture();
  const fake = fakeSupabase();
  try {
    await applyMigration({ rootDir, client: {}, request: fake.request, now: () => "2026-09-25T00:00:00.000Z" });
    await applyMigration({ rootDir, client: {}, request: fake.request, now: () => "2026-09-25T00:00:00.000Z" });
    assert.equal(fake.inserted.filter(row => row.source_key === "stock_sku:1").length, 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
