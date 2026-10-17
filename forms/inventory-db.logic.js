const { mkdirSync } = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA_VERSION = 9;
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

    CREATE TABLE IF NOT EXISTS stock_movement_reversals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_movement_id INTEGER NOT NULL UNIQUE,
      reversal_movement_id INTEGER NOT NULL UNIQUE,
      cancellation_reference TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (original_movement_id) REFERENCES stock_movements(id),
      FOREIGN KEY (reversal_movement_id) REFERENCES stock_movements(id),
      CHECK (original_movement_id <> reversal_movement_id)
    );

    CREATE INDEX IF NOT EXISTS idx_stock_movement_reversals_reference
      ON stock_movement_reversals (cancellation_reference);

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

    CREATE TABLE IF NOT EXISTS platform_order_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_no TEXT NOT NULL UNIQUE,
      platform TEXT NOT NULL DEFAULT 'manual',
      file_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'imported',
      row_count INTEGER NOT NULL DEFAULT 0,
      matched_line_count INTEGER NOT NULL DEFAULT 0,
      issue_count INTEGER NOT NULL DEFAULT 0,
      posted_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (platform IN ('shopee', 'tiktok', 'manual')),
      CHECK (status IN ('imported', 'ready', 'has_issues', 'posted'))
    );

    CREATE TABLE IF NOT EXISTS platform_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER NOT NULL,
      platform TEXT NOT NULL DEFAULT 'manual',
      order_no TEXT NOT NULL,
      order_date TEXT NOT NULL DEFAULT '',
      order_status TEXT NOT NULL DEFAULT '',
      buyer_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (import_id) REFERENCES platform_order_imports(id),
      UNIQUE (platform, order_no),
      CHECK (platform IN ('shopee', 'tiktok', 'manual'))
    );

    CREATE TABLE IF NOT EXISTS platform_order_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      line_no TEXT NOT NULL,
      sale_sku TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 0,
      sale_sku_id INTEGER,
      match_status TEXT NOT NULL DEFAULT 'missing_sale_sku',
      issue_message TEXT NOT NULL DEFAULT '',
      posted_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (import_id) REFERENCES platform_order_imports(id),
      FOREIGN KEY (order_id) REFERENCES platform_orders(id),
      FOREIGN KEY (sale_sku_id) REFERENCES sale_skus(id),
      UNIQUE (order_id, line_no, sale_sku),
      CHECK (quantity >= 0),
      CHECK (match_status IN ('matched', 'missing_sale_sku', 'invalid_quantity', 'insufficient_stock', 'skipped_status'))
    );

    CREATE TABLE IF NOT EXISTS shopee_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id TEXT NOT NULL UNIQUE,
      shop_name TEXT NOT NULL DEFAULT '',
      partner_id TEXT NOT NULL DEFAULT '',
      access_token TEXT NOT NULL DEFAULT '',
      refresh_token TEXT NOT NULL DEFAULT '',
      token_expires_at TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'connected',
      last_sync_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (status IN ('connected', 'expired', 'revoked', 'error'))
    );

    CREATE TABLE IF NOT EXISTS shopee_oauth_states (
      state TEXT PRIMARY KEY,
      return_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS shopee_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL DEFAULT '',
      cursor TEXT NOT NULL DEFAULT '',
      orders_found INTEGER NOT NULL DEFAULT 0,
      orders_upserted INTEGER NOT NULL DEFAULT 0,
      orders_failed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'running',
      error_message TEXT NOT NULL DEFAULT '',
      CHECK (status IN ('running', 'succeeded', 'partial', 'failed'))
    );

    CREATE TABLE IF NOT EXISTS shipment_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id TEXT NOT NULL,
      logistics_channel_id TEXT NOT NULL DEFAULT '',
      product_location_id TEXT NOT NULL DEFAULT '',
      pickup_address_id TEXT NOT NULL DEFAULT '',
      pickup_time_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'prepared',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (status IN ('prepared', 'confirmed', 'arranging', 'arranged', 'tracking_pending', 'documents_pending', 'ready_to_print', 'partially_failed', 'failed'))
    );

    CREATE TABLE IF NOT EXISTS shipment_batch_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      platform_order_id INTEGER NOT NULL,
      package_number TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT NOT NULL DEFAULT '',
      tracking_number TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES shipment_batches(id),
      FOREIGN KEY (platform_order_id) REFERENCES platform_orders(id),
      UNIQUE (batch_id, platform_order_id, package_number),
      CHECK (status IN ('pending', 'arranging', 'arranged', 'tracking_pending', 'documents_pending', 'ready_to_print', 'failed'))
    );

    CREATE TABLE IF NOT EXISTS shipment_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_order_id INTEGER,
      batch_id INTEGER,
      action_type TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      request_payload TEXT NOT NULL DEFAULT '{}',
      response_code TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (platform_order_id) REFERENCES platform_orders(id),
      FOREIGN KEY (batch_id) REFERENCES shipment_batches(id),
      CHECK (action_type IN ('shipping_parameters', 'arrange_shipment', 'tracking_refresh', 'document_create', 'document_download')),
      CHECK (status IN ('pending', 'succeeded', 'retrying', 'failed'))
    );

    CREATE TABLE IF NOT EXISTS shipping_document_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      shopee_job_id TEXT NOT NULL DEFAULT '',
      document_type TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'created',
      downloaded_file_path TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES shipment_batches(id),
      CHECK (status IN ('created', 'processing', 'ready', 'failed'))
    );

    CREATE TABLE IF NOT EXISTS platform_order_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER NOT NULL,
      order_line_id INTEGER NOT NULL,
      stock_sku_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'reserved',
      reference_no TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (import_id) REFERENCES platform_order_imports(id),
      FOREIGN KEY (order_line_id) REFERENCES platform_order_lines(id),
      FOREIGN KEY (stock_sku_id) REFERENCES stock_skus(id),
      CHECK (quantity > 0),
      CHECK (status IN ('reserved', 'released', 'fulfilled'))
    );

    CREATE INDEX IF NOT EXISTS idx_platform_order_imports_status
      ON platform_order_imports (status, created_at);

    CREATE INDEX IF NOT EXISTS idx_platform_order_lines_import
      ON platform_order_lines (import_id, match_status);

    CREATE INDEX IF NOT EXISTS idx_platform_order_reservations_sku_status
      ON platform_order_reservations (stock_sku_id, status);

    CREATE INDEX IF NOT EXISTS idx_platform_order_reservations_import
      ON platform_order_reservations (import_id, status);
  `);

  addColumnIfMissing(db, "products", "image_path", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "stock_skus", "image_path", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "platform_orders", "source", "TEXT NOT NULL DEFAULT 'manual'");
  addColumnIfMissing(db, "platform_orders", "shop_id", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "platform_orders", "external_order_id", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "platform_orders", "external_updated_at", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "platform_orders", "shipping_status", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "platform_orders", "tracking_number", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "platform_orders", "shipping_carrier", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "platform_orders", "logistics_channel_id", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "platform_orders", "product_location_id", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "platform_orders", "package_number", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "platform_orders", "shipment_arranged_at", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "platform_orders", "last_synced_at", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "platform_orders", "raw_payload_json", "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing(db, "platform_order_lines", "external_item_id", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "platform_order_lines", "external_model_id", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "platform_order_lines", "external_model_sku", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "platform_order_lines", "mapping_status", "TEXT NOT NULL DEFAULT 'unmapped'");
  addColumnIfMissing(db, "platform_order_lines", "mapping_source", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "platform_order_lines", "mapped_sale_sku_id", "INTEGER");
  addColumnIfMissing(db, "platform_order_lines", "mapped_stock_sku_id", "INTEGER");

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

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_platform_orders_shopee_key
      ON platform_orders (platform, shop_id, external_order_id);
    CREATE INDEX IF NOT EXISTS idx_platform_order_lines_external
      ON platform_order_lines (external_item_id, external_model_id);
    CREATE INDEX IF NOT EXISTS idx_shopee_sync_runs_shop_status
      ON shopee_sync_runs (shop_id, status, started_at);
    CREATE INDEX IF NOT EXISTS idx_shipment_batch_orders_batch_status
      ON shipment_batch_orders (batch_id, status);
    CREATE INDEX IF NOT EXISTS idx_shipment_actions_batch_status
      ON shipment_actions (batch_id, status);
  `);

  db.prepare(`
    INSERT INTO platform_order_reservations (
      import_id, order_line_id, stock_sku_id, quantity, status, reference_no, created_at, updated_at
    )
    SELECT
      platform_order_lines.import_id,
      platform_order_lines.id,
      bundle_components.stock_sku_id,
      platform_order_lines.quantity * bundle_components.quantity,
      'reserved',
      platform_orders.platform || ':' || platform_orders.order_no || ':' || platform_order_lines.line_no || ':' || platform_order_lines.sale_sku,
      ?,
      ?
    FROM platform_order_lines
    JOIN platform_orders ON platform_orders.id = platform_order_lines.order_id
    JOIN bundle_components ON bundle_components.sale_sku_id = platform_order_lines.sale_sku_id
    WHERE platform_order_lines.match_status = 'matched'
      AND platform_order_lines.posted_at = ''
      AND platform_order_lines.quantity > 0
      AND NOT EXISTS (
        SELECT 1
        FROM platform_order_reservations existing
        WHERE existing.order_line_id = platform_order_lines.id
          AND existing.stock_sku_id = bundle_components.stock_sku_id
          AND existing.status = 'reserved'
      )
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
