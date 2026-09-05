const { mkdirSync } = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA_VERSION = 3;
const DEFAULT_PRODUCT_CATEGORIES = ["เสื้อ", "กระโปรง", "กางเกง", "เดรส", "เซต", "เครื่องประดับ"];

function getInventoryDbPath(rootDir) {
  return path.join(rootDir, "data", "sweet-house.sqlite");
}

function openInventoryDatabase(rootDir, options = {}) {
  const dbPath = options.dbPath || getInventoryDbPath(rootDir);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  return db;
}

function ensureInventorySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      image_path TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (status IN ('active', 'inactive'))
    );

    CREATE TABLE IF NOT EXISTS product_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (status IN ('active', 'inactive'))
    );

    CREATE TABLE IF NOT EXISTS stock_skus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      sku TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '',
      size TEXT NOT NULL DEFAULT '',
      barcode TEXT NOT NULL DEFAULT '',
      default_unit_cost REAL NOT NULL DEFAULT 0,
      image_path TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id),
      CHECK (default_unit_cost >= 0),
      CHECK (status IN ('active', 'inactive'))
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movement_no TEXT NOT NULL UNIQUE,
      stock_sku_id INTEGER NOT NULL,
      movement_type TEXT NOT NULL,
      movement_date TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost REAL NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL DEFAULT 0,
      reference_type TEXT NOT NULL DEFAULT 'manual',
      reference_no TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (stock_sku_id) REFERENCES stock_skus(id),
      CHECK (movement_type IN ('purchase_in', 'sale_out', 'return_in', 'adjustment_in', 'adjustment_out')),
      CHECK (quantity > 0),
      CHECK (unit_cost >= 0),
      CHECK (total_cost >= 0)
    );

    CREATE INDEX IF NOT EXISTS idx_stock_movements_sku_date
      ON stock_movements (stock_sku_id, movement_date, id);

    CREATE INDEX IF NOT EXISTS idx_stock_movements_reference
      ON stock_movements (reference_type, reference_no);

    CREATE TABLE IF NOT EXISTS sale_skus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_sku TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'manual',
      platform_product_id TEXT NOT NULL DEFAULT '',
      platform_variation_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (status IN ('active', 'inactive'))
    );

    CREATE TABLE IF NOT EXISTS bundle_components (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_sku_id INTEGER NOT NULL,
      stock_sku_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (sale_sku_id) REFERENCES sale_skus(id),
      FOREIGN KEY (stock_sku_id) REFERENCES stock_skus(id),
      UNIQUE (sale_sku_id, stock_sku_id),
      CHECK (quantity > 0)
    );
  `);

  addColumnIfMissing(db, "products", "image_path", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "stock_skus", "image_path", "TEXT NOT NULL DEFAULT ''");

  db.prepare(`
    INSERT OR IGNORE INTO inventory_schema_migrations (version, applied_at)
    VALUES (?, ?)
  `).run(SCHEMA_VERSION, new Date().toISOString());

  const timestamp = new Date().toISOString();
  const insertCategory = db.prepare(`
    INSERT OR IGNORE INTO product_categories (name, sort_order, status, created_at, updated_at)
    VALUES (?, ?, 'active', ?, ?)
  `);
  DEFAULT_PRODUCT_CATEGORIES.forEach((name, index) => {
    insertCategory.run(name, (index + 1) * 10, timestamp, timestamp);
  });

  db.prepare(`
    INSERT OR IGNORE INTO product_categories (name, sort_order, status, created_at, updated_at)
    SELECT DISTINCT TRIM(category), 1000, 'active', ?, ?
    FROM products
    WHERE TRIM(category) <> ''
  `).run(timestamp, timestamp);
}

function addColumnIfMissing(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
  if (!columns.includes(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function withInventoryDatabase(rootDir, callback) {
  const db = openInventoryDatabase(rootDir);
  try {
    ensureInventorySchema(db);
    return callback(db);
  } finally {
    db.close();
  }
}

module.exports = {
  DEFAULT_PRODUCT_CATEGORIES,
  ensureInventorySchema,
  getInventoryDbPath,
  openInventoryDatabase,
  withInventoryDatabase,
};
