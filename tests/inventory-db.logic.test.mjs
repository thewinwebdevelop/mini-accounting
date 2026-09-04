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
      "product_categories",
      "products",
      "sale_skus",
      "stock_movements",
      "stock_skus",
    ]);

    const categories = db.prepare(`
      SELECT name
      FROM product_categories
      WHERE status = 'active'
      ORDER BY sort_order ASC, name ASC
    `).all().map((row) => row.name);
    assert.deepEqual(categories.slice(0, 6), ["เสื้อ", "กระโปรง", "กางเกง", "เดรส", "เซต", "เครื่องประดับ"]);

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

test("ensureInventorySchema imports existing product category text into config", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-inventory-db-"));

  try {
    const db = openInventoryDatabase(rootDir);
    db.exec(`
      CREATE TABLE products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (status IN ('active', 'inactive'))
      );
    `);
    db.prepare(`
      INSERT INTO products (product_code, name, category, description, status, created_at, updated_at)
      VALUES ('OLD-TOP', 'สินค้าเดิม', 'เสื้อแฟชั่นเดิม', '', 'active', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')
    `).run();

    ensureInventorySchema(db);

    const category = db.prepare("SELECT name, status FROM product_categories WHERE name = ?").get("เสื้อแฟชั่นเดิม");
    assert.equal(category.name, "เสื้อแฟชั่นเดิม");
    assert.equal(category.status, "active");
    db.close();
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
