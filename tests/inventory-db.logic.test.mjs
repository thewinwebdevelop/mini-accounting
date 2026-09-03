import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import inventoryDb from "../forms/inventory-db.logic.js";

const {
  getInventoryDbPath,
  openInventoryDatabase,
  ensureInventorySchema,
} = inventoryDb;

test("ensureInventorySchema creates inventory database tables", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-inventory-db-"));

  try {
    const dbPath = getInventoryDbPath(rootDir);
    const db = openInventoryDatabase(rootDir);
    ensureInventorySchema(db);

    const tableNames = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);

    assert.deepEqual(tableNames.filter((name) => !name.startsWith("sqlite_")), [
      "bundle_components",
      "inventory_schema_migrations",
      "products",
      "sale_skus",
      "stock_movements",
      "stock_skus",
    ]);

    assert.equal((await stat(dbPath)).isFile(), true);
    db.close();
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("bundle schema enforces sale SKU to Stock SKU component uniqueness", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-inventory-db-"));

  try {
    const db = openInventoryDatabase(rootDir);
    ensureInventorySchema(db);

    const product = db.prepare(`
      INSERT INTO products (product_code, name, category, description, status, created_at, updated_at)
      VALUES ('SHIRT-A', 'เสื้อ A', 'เสื้อ', '', 'active', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')
      RETURNING id
    `).get();
    const stockSku = db.prepare(`
      INSERT INTO stock_skus (product_id, sku, color, size, barcode, default_unit_cost, status, created_at, updated_at)
      VALUES (?, 'SHIRT-A-BLACK-M', 'ดำ', 'M', '', 120, 'active', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')
      RETURNING id
    `).get(product.id);
    const saleSku = db.prepare(`
      INSERT INTO sale_skus (sale_sku, display_name, platform, platform_product_id, platform_variation_id, status, created_at, updated_at)
      VALUES ('SET-A-ONLY', 'เฉพาะเสื้อ A', 'manual', '', '', 'active', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')
      RETURNING id
    `).get();

    db.prepare(`
      INSERT INTO bundle_components (sale_sku_id, stock_sku_id, quantity, created_at)
      VALUES (?, ?, 1, '2026-09-04T00:00:00.000Z')
    `).run(saleSku.id, stockSku.id);

    assert.throws(() => {
      db.prepare(`
        INSERT INTO bundle_components (sale_sku_id, stock_sku_id, quantity, created_at)
        VALUES (?, ?, 1, '2026-09-04T00:00:00.000Z')
      `).run(saleSku.id, stockSku.id);
    }, /UNIQUE/);

    db.close();
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
