# Inventory System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working inventory module for clothing Stock SKUs with color, size, purchase-in cost, stock cards, balances, and schema support for future Sale SKU / Bundle SKU deduction.

**Architecture:** Add SQLite as the local relational data store while keeping existing PDF/raw-file storage unchanged. Put inventory database setup and business logic in focused CommonJS modules under `forms/`, expose JSON APIs through the existing local server, and add one inventory HTML page with product/SKU management, purchase-in entry, balance, and stock card views.

**Tech Stack:** Node.js v16.15.0, `better-sqlite3@8.7.0`, built-in `node:test`, existing local HTTP server in `local-server.mjs`, plain HTML/CSS/JS matching the existing form pages.

**Spec:** `docs/superpowers/specs/2026-09-04-inventory-system-design.md`

## Global Constraints

- Use SQLite for inventory data.
- Store the SQLite file at `data/sweet-house.sqlite`.
- Keep PDF and raw attachments as files; database rows only store references/paths when needed later.
- Stock movements attach to Stock SKU, not Sale SKU.
- Stock SKU must support SKU + color + size for clothing.
- Purchase-in must store `unit_cost` and `total_cost`.
- Balance must expose quantity on hand, average unit cost, and inventory value.
- Prepare `sale_skus` and `bundle_components` schema for future marketplace bundle deduction, but do not build full bundle UI in this slice.
- Use query-time balance calculation from `stock_movements`; do not add balance cache tables yet.
- Follow current app style: CommonJS logic modules, simple JSON APIs, Thai UI copy, and plain `node:test`.

---

## File Structure

- Create `package.json`: pins `better-sqlite3@8.7.0` and adds test scripts for the existing Node test suite.
- Create `forms/inventory-db.logic.js`: owns database file path, connection creation, schema bootstrap, migrations, and test database helpers.
- Create `forms/inventory.logic.js`: owns product/SKU CRUD, stock movement validation, purchase-in, stock card, balance, and future bundle schema helper functions.
- Create `tests/inventory-db.logic.test.mjs`: verifies schema bootstrap and future bundle tables.
- Create `tests/inventory.logic.test.mjs`: verifies SKU validation, purchase-in cost, stock cards, and balances.
- Modify `local-server.mjs`: registers inventory routes and serves `/inventory`.
- Create `forms/inventory.html`: inventory UI with tabs/sections for SKU list, purchase-in, balances, and stock card.
- Create `forms/inventory.logic.browser.js`: browser-only UI controller for `inventory.html`.
- Modify `forms/index.html`, `forms/expense-request.html`, `forms/expense-requests.html`, `forms/company-settings.html`, and `forms/google-drive.html`: add inventory menu links.
- Modify relevant HTML tests to assert inventory navigation exists.

---

### Task 1: SQLite Dependency And Schema Bootstrap

**Files:**
- Create: `package.json`
- Create: `forms/inventory-db.logic.js`
- Create: `tests/inventory-db.logic.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `getInventoryDbPath(rootDir): string`
- Produces: `openInventoryDatabase(rootDir, options = {}): Database`
- Produces: `ensureInventorySchema(db): void`
- Produces: `withInventoryDatabase(rootDir, callback): any`

- [ ] **Step 1: Write the failing schema test**

Create `tests/inventory-db.logic.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/inventory-db.logic.test.mjs
```

Expected: FAIL because `forms/inventory-db.logic.js` does not exist.

- [ ] **Step 3: Add dependency metadata**

Create `package.json`:

```json
{
  "name": "sweet-house-accounting-local-app",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "test": "node --test tests/*.mjs",
    "test:inventory": "node --test tests/inventory-db.logic.test.mjs tests/inventory.logic.test.mjs"
  },
  "dependencies": {
    "better-sqlite3": "8.7.0"
  }
}
```

Run:

```bash
npm install
```

Expected: `package-lock.json` and `node_modules/` are created.

- [ ] **Step 4: Ignore local generated data and dependencies**

Modify `.gitignore` so it includes:

```gitignore
node_modules/
data/*.sqlite
data/*.sqlite-shm
data/*.sqlite-wal
```

- [ ] **Step 5: Implement database bootstrap**

Create `forms/inventory-db.logic.js`:

```js
const { mkdirSync } = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const SCHEMA_VERSION = 1;

function getInventoryDbPath(rootDir) {
  return path.join(rootDir, "data", "sweet-house.sqlite");
}

function openInventoryDatabase(rootDir, options = {}) {
  const dbPath = options.dbPath || getInventoryDbPath(rootDir);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
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

  db.prepare(`
    INSERT OR IGNORE INTO inventory_schema_migrations (version, applied_at)
    VALUES (?, ?)
  `).run(SCHEMA_VERSION, new Date().toISOString());
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
  ensureInventorySchema,
  getInventoryDbPath,
  openInventoryDatabase,
  withInventoryDatabase,
};
```

- [ ] **Step 6: Run the schema tests**

Run:

```bash
node --test tests/inventory-db.logic.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore forms/inventory-db.logic.js tests/inventory-db.logic.test.mjs
git commit -m "Add inventory SQLite schema"
```

---

### Task 2: Inventory Business Logic

**Files:**
- Create: `forms/inventory.logic.js`
- Create: `tests/inventory.logic.test.mjs`

**Interfaces:**
- Consumes: `withInventoryDatabase(rootDir, callback)` from `forms/inventory-db.logic.js`
- Produces: `createProduct(rootDir, data, options = {}): Product`
- Produces: `listProducts(rootDir, filters = {}): Product[]`
- Produces: `createStockSku(rootDir, data, options = {}): StockSku`
- Produces: `listStockSkus(rootDir, filters = {}): StockSku[]`
- Produces: `createPurchaseInMovement(rootDir, data, options = {}): StockMovement`
- Produces: `getStockCard(rootDir, stockSkuId): { sku: StockSku, movements: StockMovement[], balance: Balance }`
- Produces: `listInventoryBalances(rootDir): Balance[]`

- [ ] **Step 1: Write failing product and SKU tests**

Create the first part of `tests/inventory.logic.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import inventory from "../forms/inventory.logic.js";

const {
  createProduct,
  createStockSku,
  listProducts,
  listStockSkus,
} = inventory;

test("createProduct and createStockSku store clothing SKU attributes and default cost", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-inventory-"));

  try {
    const product = createProduct(rootDir, {
      productCode: "SHIRT-A",
      name: "เสื้อ A",
      category: "เสื้อ",
      description: "เสื้อรุ่น A",
    }, {
      now: () => "2026-09-04T00:00:00.000Z",
    });

    const sku = createStockSku(rootDir, {
      productId: product.id,
      sku: "SHIRT-A-BLACK-M",
      color: "ดำ",
      size: "M",
      barcode: "885000000001",
      defaultUnitCost: "120.50",
    }, {
      now: () => "2026-09-04T00:00:00.000Z",
    });

    assert.equal(product.productCode, "SHIRT-A");
    assert.equal(sku.sku, "SHIRT-A-BLACK-M");
    assert.equal(sku.color, "ดำ");
    assert.equal(sku.size, "M");
    assert.equal(sku.defaultUnitCost, "120.50");

    assert.deepEqual(listProducts(rootDir).map((item) => item.productCode), ["SHIRT-A"]);
    assert.deepEqual(listStockSkus(rootDir).map((item) => item.sku), ["SHIRT-A-BLACK-M"]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("createStockSku rejects duplicate SKU codes", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-inventory-"));

  try {
    const product = createProduct(rootDir, {
      productCode: "SKIRT-B",
      name: "กระโปรง B",
      category: "กระโปรง",
    });

    createStockSku(rootDir, {
      productId: product.id,
      sku: "SKIRT-B-BLACK-M",
      color: "ดำ",
      size: "M",
      defaultUnitCost: "150",
    });

    assert.throws(() => {
      createStockSku(rootDir, {
        productId: product.id,
        sku: "SKIRT-B-BLACK-M",
        color: "ดำ",
        size: "M",
        defaultUnitCost: "150",
      });
    }, /SKU นี้มีอยู่แล้ว/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run product/SKU tests to verify failure**

Run:

```bash
node --test tests/inventory.logic.test.mjs
```

Expected: FAIL because `forms/inventory.logic.js` does not exist.

- [ ] **Step 3: Implement product/SKU logic**

Create `forms/inventory.logic.js` with:

```js
const { withInventoryDatabase } = require("./inventory-db.logic.js");

const IN_TYPES = new Set(["purchase_in", "return_in", "adjustment_in"]);
const OUT_TYPES = new Set(["sale_out", "adjustment_out"]);

function nowIso(options = {}) {
  return options.now ? options.now() : new Date().toISOString();
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function parseQuantity(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("จำนวนต้องมากกว่า 0");
  }
  return parsed;
}

function parseMoney(value, fieldName = "ต้นทุน") {
  const parsed = Number(String(value ?? "0").replace(/,/g, "").trim());
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldName}ต้องไม่ติดลบ`);
  }
  return Math.round(parsed * 100) / 100;
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function mapProduct(row) {
  return {
    id: row.id,
    productCode: row.product_code,
    name: row.name,
    category: row.category,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapStockSku(row) {
  return {
    id: row.id,
    productId: row.product_id,
    productCode: row.product_code || "",
    productName: row.product_name || "",
    sku: row.sku,
    color: row.color,
    size: row.size,
    barcode: row.barcode,
    defaultUnitCost: money(row.default_unit_cost),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createProduct(rootDir, data = {}, options = {}) {
  return withInventoryDatabase(rootDir, (db) => {
    const timestamp = nowIso(options);
    const productCode = cleanText(data.productCode).toUpperCase();
    const name = cleanText(data.name);
    if (!productCode) throw new Error("ระบุรหัสสินค้าแม่");
    if (!name) throw new Error("ระบุชื่อสินค้า");

    try {
      const row = db.prepare(`
        INSERT INTO products (product_code, name, category, description, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?)
        RETURNING *
      `).get(productCode, name, cleanText(data.category), cleanText(data.description), timestamp, timestamp);
      return mapProduct(row);
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw new Error("รหัสสินค้าแม่นี้มีอยู่แล้ว");
      throw error;
    }
  });
}

function listProducts(rootDir, filters = {}) {
  return withInventoryDatabase(rootDir, (db) => {
    const search = `%${cleanText(filters.search)}%`;
    const rows = db.prepare(`
      SELECT *
      FROM products
      WHERE (? = '%%' OR product_code LIKE ? OR name LIKE ? OR category LIKE ?)
      ORDER BY product_code ASC
    `).all(search, search, search, search);
    return rows.map(mapProduct);
  });
}

function createStockSku(rootDir, data = {}, options = {}) {
  return withInventoryDatabase(rootDir, (db) => {
    const timestamp = nowIso(options);
    const productId = Number(data.productId);
    const sku = cleanText(data.sku).toUpperCase();
    if (!Number.isInteger(productId) || productId <= 0) throw new Error("เลือกสินค้าแม่");
    if (!sku) throw new Error("ระบุ SKU");

    const product = db.prepare("SELECT id FROM products WHERE id = ? AND status = 'active'").get(productId);
    if (!product) throw new Error("ไม่พบสินค้าแม่ที่ใช้งานอยู่");

    try {
      const row = db.prepare(`
        INSERT INTO stock_skus (product_id, sku, color, size, barcode, default_unit_cost, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
        RETURNING *
      `).get(
        productId,
        sku,
        cleanText(data.color),
        cleanText(data.size),
        cleanText(data.barcode),
        parseMoney(data.defaultUnitCost, "ต้นทุนตั้งต้น"),
        timestamp,
        timestamp,
      );
      return mapStockSku(row);
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw new Error("SKU นี้มีอยู่แล้ว");
      throw error;
    }
  });
}

function listStockSkus(rootDir, filters = {}) {
  return withInventoryDatabase(rootDir, (db) => {
    const search = `%${cleanText(filters.search)}%`;
    const rows = db.prepare(`
      SELECT
        stock_skus.*,
        products.product_code,
        products.name AS product_name
      FROM stock_skus
      JOIN products ON products.id = stock_skus.product_id
      WHERE (? = '%%'
        OR stock_skus.sku LIKE ?
        OR stock_skus.color LIKE ?
        OR stock_skus.size LIKE ?
        OR products.product_code LIKE ?
        OR products.name LIKE ?)
      ORDER BY stock_skus.sku ASC
    `).all(search, search, search, search, search, search);
    return rows.map(mapStockSku);
  });
}
```

Export these functions at the bottom:

```js
module.exports = {
  createProduct,
  createStockSku,
  listProducts,
  listStockSkus,
};
```

- [ ] **Step 4: Run product/SKU tests**

Run:

```bash
node --test tests/inventory.logic.test.mjs
```

Expected: PASS for the two tests currently in the file.

- [ ] **Step 5: Add failing purchase-in and balance tests**

Append to `tests/inventory.logic.test.mjs`:

```js
const {
  createPurchaseInMovement,
  getStockCard,
  listInventoryBalances,
} = inventory;

test("createPurchaseInMovement stores unit cost, total cost, and increases balance", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-inventory-"));

  try {
    const product = createProduct(rootDir, { productCode: "DRESS-C", name: "เดรส C", category: "เดรส" });
    const sku = createStockSku(rootDir, {
      productId: product.id,
      sku: "DRESS-C-WHITE-S",
      color: "ขาว",
      size: "S",
      defaultUnitCost: "220",
    });

    const movement = createPurchaseInMovement(rootDir, {
      stockSkuId: sku.id,
      movementDate: "2026-09-04",
      quantity: "10",
      unitCost: "225.75",
      referenceType: "manual",
      referenceNo: "RCV-TEST-001",
      note: "รับเข้าทดสอบ",
    }, {
      now: () => "2026-09-04T01:00:00.000Z",
    });

    assert.match(movement.movementNo, /^MOV-20260904-/);
    assert.equal(movement.movementType, "purchase_in");
    assert.equal(movement.quantity, 10);
    assert.equal(movement.unitCost, "225.75");
    assert.equal(movement.totalCost, "2257.50");

    const balances = listInventoryBalances(rootDir);
    assert.equal(balances.length, 1);
    assert.equal(balances[0].quantityOnHand, 10);
    assert.equal(balances[0].averageUnitCost, "225.75");
    assert.equal(balances[0].inventoryValue, "2257.50");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("stock card lists movements in chronological order with running balance", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-inventory-"));

  try {
    const product = createProduct(rootDir, { productCode: "PANTS-D", name: "กางเกง D", category: "กางเกง" });
    const sku = createStockSku(rootDir, {
      productId: product.id,
      sku: "PANTS-D-NAVY-L",
      color: "กรม",
      size: "L",
      defaultUnitCost: "180",
    });

    createPurchaseInMovement(rootDir, {
      stockSkuId: sku.id,
      movementDate: "2026-09-05",
      quantity: "3",
      unitCost: "180",
    }, { now: () => "2026-09-05T01:00:00.000Z" });

    createPurchaseInMovement(rootDir, {
      stockSkuId: sku.id,
      movementDate: "2026-09-04",
      quantity: "2",
      unitCost: "170",
    }, { now: () => "2026-09-04T01:00:00.000Z" });

    const card = getStockCard(rootDir, sku.id);

    assert.equal(card.sku.sku, "PANTS-D-NAVY-L");
    assert.deepEqual(card.movements.map((movement) => movement.movementDate), ["2026-09-04", "2026-09-05"]);
    assert.deepEqual(card.movements.map((movement) => movement.runningQuantity), [2, 5]);
    assert.equal(card.balance.quantityOnHand, 5);
    assert.equal(card.balance.averageUnitCost, "176.00");
    assert.equal(card.balance.inventoryValue, "880.00");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 6: Run tests to verify new failure**

Run:

```bash
node --test tests/inventory.logic.test.mjs
```

Expected: FAIL because movement/balance functions are not exported yet.

- [ ] **Step 7: Implement movement, balance, and stock card logic**

Add to `forms/inventory.logic.js`:

```js
function movementDirection(type) {
  if (IN_TYPES.has(type)) return 1;
  if (OUT_TYPES.has(type)) return -1;
  throw new Error("ประเภท movement ไม่ถูกต้อง");
}

function createMovementNo(dateText, db) {
  const compactDate = cleanText(dateText).replace(/-/g, "") || new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `MOV-${compactDate}-`;
  const latest = db.prepare(`
    SELECT movement_no
    FROM stock_movements
    WHERE movement_no LIKE ?
    ORDER BY movement_no DESC
    LIMIT 1
  `).get(`${prefix}%`);
  const nextSequence = latest ? Number(latest.movement_no.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(nextSequence).padStart(5, "0")}`;
}

function mapMovement(row, runningQuantity = null) {
  return {
    id: row.id,
    movementNo: row.movement_no,
    stockSkuId: row.stock_sku_id,
    movementType: row.movement_type,
    movementDate: row.movement_date,
    quantity: row.quantity,
    unitCost: money(row.unit_cost),
    totalCost: money(row.total_cost),
    referenceType: row.reference_type,
    referenceNo: row.reference_no,
    note: row.note,
    createdAt: row.created_at,
    runningQuantity,
  };
}

function createPurchaseInMovement(rootDir, data = {}, options = {}) {
  return withInventoryDatabase(rootDir, (db) => {
    const stockSkuId = Number(data.stockSkuId);
    if (!Number.isInteger(stockSkuId) || stockSkuId <= 0) throw new Error("เลือก SKU");

    const sku = db.prepare("SELECT id FROM stock_skus WHERE id = ? AND status = 'active'").get(stockSkuId);
    if (!sku) throw new Error("ไม่พบ SKU ที่ใช้งานอยู่");

    const quantity = parseQuantity(data.quantity);
    const unitCost = parseMoney(data.unitCost, "ต้นทุนต่อหน่วย");
    if (unitCost <= 0) throw new Error("purchase-in ต้องมีต้นทุนต่อหน่วย");

    const totalCost = Math.round(quantity * unitCost * 100) / 100;
    const movementDate = cleanText(data.movementDate) || nowIso(options).slice(0, 10);
    const timestamp = nowIso(options);
    const movementNo = createMovementNo(movementDate, db);

    const row = db.prepare(`
      INSERT INTO stock_movements (
        movement_no, stock_sku_id, movement_type, movement_date, quantity,
        unit_cost, total_cost, reference_type, reference_no, note, created_at
      )
      VALUES (?, ?, 'purchase_in', ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      movementNo,
      stockSkuId,
      movementDate,
      quantity,
      unitCost,
      totalCost,
      cleanText(data.referenceType) || "manual",
      cleanText(data.referenceNo),
      cleanText(data.note),
      timestamp,
    );

    return mapMovement(row);
  });
}

function calculateBalanceFromRows(rows = []) {
  let quantityOnHand = 0;
  let purchaseQuantity = 0;
  let purchaseTotalCost = 0;

  for (const row of rows) {
    const direction = movementDirection(row.movement_type);
    quantityOnHand += direction * row.quantity;
    if (row.movement_type === "purchase_in") {
      purchaseQuantity += row.quantity;
      purchaseTotalCost += Number(row.total_cost || 0);
    }
  }

  const averageUnitCost = purchaseQuantity ? purchaseTotalCost / purchaseQuantity : 0;
  return {
    quantityOnHand,
    averageUnitCost: money(averageUnitCost),
    inventoryValue: money(quantityOnHand * averageUnitCost),
  };
}

function listInventoryBalances(rootDir) {
  return withInventoryDatabase(rootDir, (db) => {
    const skus = listStockSkus(rootDir);
    return skus.map((sku) => {
      const movements = db.prepare(`
        SELECT *
        FROM stock_movements
        WHERE stock_sku_id = ?
        ORDER BY movement_date ASC, id ASC
      `).all(sku.id);
      return {
        ...sku,
        ...calculateBalanceFromRows(movements),
      };
    });
  });
}

function getStockCard(rootDir, stockSkuId) {
  return withInventoryDatabase(rootDir, (db) => {
    const sku = db.prepare(`
      SELECT stock_skus.*, products.product_code, products.name AS product_name
      FROM stock_skus
      JOIN products ON products.id = stock_skus.product_id
      WHERE stock_skus.id = ?
    `).get(Number(stockSkuId));
    if (!sku) throw new Error("ไม่พบ SKU");

    const rows = db.prepare(`
      SELECT *
      FROM stock_movements
      WHERE stock_sku_id = ?
      ORDER BY movement_date ASC, id ASC
    `).all(Number(stockSkuId));

    let runningQuantity = 0;
    const movements = rows.map((row) => {
      runningQuantity += movementDirection(row.movement_type) * row.quantity;
      return mapMovement(row, runningQuantity);
    });

    return {
      sku: mapStockSku(sku),
      movements,
      balance: calculateBalanceFromRows(rows),
    };
  });
}
```

Update `module.exports`:

```js
module.exports = {
  createProduct,
  createPurchaseInMovement,
  createStockSku,
  getStockCard,
  listInventoryBalances,
  listProducts,
  listStockSkus,
};
```

- [ ] **Step 8: Run inventory logic tests**

Run:

```bash
node --test tests/inventory.logic.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add forms/inventory.logic.js tests/inventory.logic.test.mjs
git commit -m "Add inventory business logic"
```

---

### Task 3: Inventory HTTP API

**Files:**
- Modify: `local-server.mjs`
- Modify: `tests/local-server.logic.test.mjs` only if pure logic helper exports are needed; otherwise add API tests through a small server helper in this task.

**Interfaces:**
- Consumes functions from `forms/inventory.logic.js`
- Produces API routes:
  - `GET /api/inventory/products`
  - `POST /api/inventory/products`
  - `GET /api/inventory/stock-skus`
  - `POST /api/inventory/stock-skus`
  - `GET /api/inventory/balances`
  - `POST /api/inventory/purchase-in`
  - `GET /api/inventory/stock-card?stockSkuId=<id>`

- [ ] **Step 1: Add imports**

Modify `local-server.mjs` imports:

```js
const {
  createProduct,
  createPurchaseInMovement,
  createStockSku,
  getStockCard,
  listInventoryBalances,
  listProducts,
  listStockSkus,
} = require("./forms/inventory.logic.js");
```

- [ ] **Step 2: Serve the inventory page**

Add to `safeStaticPath()` routeMap:

```js
"/inventory": "/inventory.html",
"/inventory/": "/inventory.html",
```

- [ ] **Step 3: Add inventory API handlers**

Add these functions above server creation:

```js
async function handleInventoryProductList(url, response) {
  try {
    sendJson(response, 200, { products: listProducts(rootDir, { search: url.searchParams.get("search") || "" }) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot list products" });
  }
}

async function handleInventoryProductCreate(request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { product: createProduct(rootDir, payload) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot create product" });
  }
}

async function handleInventoryStockSkuList(url, response) {
  try {
    sendJson(response, 200, { stockSkus: listStockSkus(rootDir, { search: url.searchParams.get("search") || "" }) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot list stock SKUs" });
  }
}

async function handleInventoryStockSkuCreate(request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { stockSku: createStockSku(rootDir, payload) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot create stock SKU" });
  }
}

async function handleInventoryPurchaseIn(request, response) {
  try {
    const payload = await readJsonBody(request);
    sendJson(response, 200, { movement: createPurchaseInMovement(rootDir, payload), balances: listInventoryBalances(rootDir) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot receive inventory" });
  }
}

async function handleInventoryBalanceList(response) {
  try {
    sendJson(response, 200, { balances: listInventoryBalances(rootDir) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot list inventory balances" });
  }
}

async function handleInventoryStockCard(url, response) {
  try {
    sendJson(response, 200, getStockCard(rootDir, url.searchParams.get("stockSkuId")));
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot load stock card" });
  }
}
```

- [ ] **Step 4: Register POST routes**

Inside the `createServer` callback before existing expense routes:

```js
if (request.method === "POST" && request.url === "/api/inventory/products") {
  await handleInventoryProductCreate(request, response);
  return;
}

if (request.method === "POST" && request.url === "/api/inventory/stock-skus") {
  await handleInventoryStockSkuCreate(request, response);
  return;
}

if (request.method === "POST" && request.url === "/api/inventory/purchase-in") {
  await handleInventoryPurchaseIn(request, response);
  return;
}
```

- [ ] **Step 5: Register GET routes**

Inside the `if (request.method === "GET")` block before static file handling:

```js
if (url.pathname === "/api/inventory/products") {
  await handleInventoryProductList(url, response);
  return;
}

if (url.pathname === "/api/inventory/stock-skus") {
  await handleInventoryStockSkuList(url, response);
  return;
}

if (url.pathname === "/api/inventory/balances") {
  await handleInventoryBalanceList(response);
  return;
}

if (url.pathname === "/api/inventory/stock-card") {
  await handleInventoryStockCard(url, response);
  return;
}
```

- [ ] **Step 6: Manually smoke-test APIs with a temp data directory option if added**

If implementation adds `SWEET_HOUSE_ROOT_DIR` support for testing, run the server against a temp root. If not, skip persistent server smoke test and rely on logic tests for this task.

Recommended smoke commands after starting the server:

```bash
curl -s http://localhost:8787/api/inventory/products
curl -s -X POST http://localhost:8787/api/inventory/products \
  -H 'content-type: application/json' \
  -d '{"productCode":"SHIRT-A","name":"เสื้อ A","category":"เสื้อ"}'
curl -s -X POST http://localhost:8787/api/inventory/stock-skus \
  -H 'content-type: application/json' \
  -d '{"productId":1,"sku":"SHIRT-A-BLACK-M","color":"ดำ","size":"M","defaultUnitCost":"120"}'
curl -s -X POST http://localhost:8787/api/inventory/purchase-in \
  -H 'content-type: application/json' \
  -d '{"stockSkuId":1,"movementDate":"2026-09-04","quantity":"5","unitCost":"120","referenceType":"manual","referenceNo":"RCV-001"}'
curl -s http://localhost:8787/api/inventory/balances
curl -s 'http://localhost:8787/api/inventory/stock-card?stockSkuId=1'
```

Expected: JSON responses contain no `error`, balance quantity is `5`, average unit cost is `"120.00"`, inventory value is `"600.00"`.

- [ ] **Step 7: Run logic and existing server tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add local-server.mjs
git commit -m "Expose inventory APIs"
```

---

### Task 4: Inventory User Interface

**Files:**
- Create: `forms/inventory.html`
- Create: `forms/inventory.logic.browser.js`
- Create: `tests/inventory.html.test.mjs`

**Interfaces:**
- Consumes inventory API routes from Task 3
- Produces route `/inventory`

- [ ] **Step 1: Write failing HTML structure test**

Create `tests/inventory.html.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlPath = new URL("../forms/inventory.html", import.meta.url);

test("inventory page provides SKU, purchase-in, balance, and stock card work areas", async () => {
  const html = await readFile(htmlPath, "utf8");

  assert.match(html, /<title>ระบบสต๊อกสินค้า - หจก\.สวีทเฮาส์<\/title>/);
  assert.match(html, /id="productForm"/);
  assert.match(html, /id="skuForm"/);
  assert.match(html, /id="purchaseInForm"/);
  assert.match(html, /id="balanceRows"/);
  assert.match(html, /id="stockCardRows"/);
  assert.match(html, /src="\.\/inventory\.logic\.browser\.js"/);
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test tests/inventory.html.test.mjs
```

Expected: FAIL because `forms/inventory.html` does not exist.

- [ ] **Step 3: Create inventory page shell**

Create `forms/inventory.html`. Reuse visual tokens from `forms/expense-request.html`, but keep the page operational and dense. Include:

```html
<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ระบบสต๊อกสินค้า - หจก.สวีทเฮาส์</title>
  <style>
    :root {
      --ink: #1f2933;
      --muted: #66788a;
      --line: #cbd2d9;
      --soft: #f5f7fa;
      --panel: #ffffff;
      --brand: #334e68;
      --brand-strong: #102a43;
      --accent: #0f766e;
      --danger: #b91c1c;
      --shadow: 0 12px 28px rgba(16, 42, 67, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      font-family: "Sukhumvit Set", "Thonburi", "Noto Sans Thai", Arial, sans-serif;
      background: #eef2f6;
      font-size: 14px;
      line-height: 1.5;
    }
    button, input, select, textarea { font: inherit; }
    .topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 14px 22px;
      color: #ffffff;
      background: var(--brand-strong);
      box-shadow: 0 2px 10px rgba(16, 42, 67, 0.16);
    }
    .brand-title { margin: 0; font-size: 18px; font-weight: 800; }
    .brand-subtitle { margin: 2px 0 0; color: #d9e2ec; font-size: 12px; }
    .app-menu { position: relative; }
    .menu-button {
      display: grid;
      width: 38px;
      height: 38px;
      place-items: center;
      border: 1px solid rgba(255, 255, 255, 0.35);
      border-radius: 6px;
      cursor: pointer;
      font-size: 22px;
      font-weight: 900;
      list-style: none;
    }
    .menu-button::-webkit-details-marker { display: none; }
    .menu-panel {
      position: absolute;
      top: 48px;
      left: 0;
      width: min(320px, calc(100vw - 32px));
      padding: 10px;
      color: var(--ink);
      background: #ffffff;
      border: 1px solid #d9e2ec;
      border-radius: 8px;
      box-shadow: var(--shadow);
    }
    .menu-group + .menu-group { margin-top: 8px; padding-top: 8px; border-top: 1px solid #eef2f6; }
    .menu-group-title { margin: 5px 8px; color: var(--muted); font-size: 11px; font-weight: 900; }
    .menu-item {
      display: block;
      width: 100%;
      padding: 9px 10px;
      color: var(--brand-strong);
      background: transparent;
      border: 0;
      border-radius: 6px;
      cursor: pointer;
      text-align: left;
      text-decoration: none;
      font-weight: 800;
    }
    .menu-item:hover { background: var(--soft); }
    .page {
      display: grid;
      grid-template-columns: minmax(320px, 430px) minmax(0, 1fr);
      gap: 16px;
      max-width: 1380px;
      margin: 0 auto;
      padding: 18px;
    }
    .stack { display: grid; gap: 12px; }
    .section {
      background: var(--panel);
      border: 1px solid #d9e2ec;
      border-radius: 8px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .section-header {
      padding: 11px 13px;
      color: #ffffff;
      background: var(--brand);
      font-weight: 800;
    }
    .section-body { display: grid; gap: 10px; padding: 14px; }
    .grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 9px; }
    .span-4 { grid-column: span 4; }
    .span-6 { grid-column: span 6; }
    .span-12 { grid-column: span 12; }
    label { color: var(--brand); font-size: 12px; font-weight: 800; }
    .field { display: grid; gap: 5px; }
    input, select, textarea {
      width: 100%;
      min-height: 38px;
      padding: 8px 10px;
      color: var(--ink);
      background: #ffffff;
      border: 1px solid #bcccdc;
      border-radius: 6px;
      outline: none;
    }
    textarea { min-height: 72px; resize: vertical; }
    input:focus, select:focus, textarea:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.12);
    }
    .button {
      min-height: 38px;
      padding: 8px 12px;
      border: 1px solid transparent;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 800;
    }
    .button.primary { color: #ffffff; background: var(--accent); }
    .button.secondary { color: var(--brand-strong); background: #ffffff; border-color: #bcccdc; }
    .table-wrap { overflow-x: auto; border: 1px solid #d9e2ec; border-radius: 8px; background: #ffffff; }
    table { width: 100%; border-collapse: collapse; min-width: 760px; }
    th, td { padding: 8px 9px; border-bottom: 1px solid #eef2f6; text-align: left; vertical-align: top; }
    th { color: #ffffff; background: var(--brand); font-size: 12px; }
    td.number, th.number { text-align: right; }
    .status-box { display: none; padding: 10px; border-radius: 6px; border: 1px solid #d9e2ec; background: var(--soft); }
    .status-box.active { display: block; }
    .status-box.success { border-color: #86efac; background: #f0fdf4; color: #166534; }
    .status-box.error { border-color: #fecaca; background: #fef2f2; color: #991b1b; }
    @media (max-width: 980px) {
      .page { grid-template-columns: 1fr; }
      .span-4, .span-6 { grid-column: span 12; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <details class="app-menu">
      <summary class="menu-button" aria-label="เปิดเมนู">☰</summary>
      <nav class="menu-panel" aria-label="เมนูหลัก">
        <div class="menu-group">
          <div class="menu-group-title">ระบบสต๊อก</div>
          <a class="menu-item" href="/inventory">สินค้าและสต๊อก</a>
        </div>
        <div class="menu-group">
          <div class="menu-group-title">ใบเบิกจ่ายเอกสาร</div>
          <a class="menu-item" href="/expense-requests">รายการใบเบิกจ่ายทั้งหมด</a>
          <a class="menu-item" href="/expense-request">สร้างใบเบิกจ่ายใหม่</a>
        </div>
        <div class="menu-group">
          <div class="menu-group-title">ระบบ</div>
          <a class="menu-item" href="/">หน้าหลัก</a>
          <a class="menu-item" href="/company-settings">ตั้งค่าบริษัท</a>
          <a class="menu-item" href="/google-drive">ตั้งค่า Google Drive</a>
        </div>
      </nav>
    </details>
    <div>
      <h1 class="brand-title">ระบบสต๊อกสินค้า</h1>
      <p class="brand-subtitle">Stock SKU, สี, ไซซ์, ต้นทุน และ stock card</p>
    </div>
  </header>

  <main class="page">
    <div class="stack">
      <section class="section">
        <div class="section-header">เพิ่มสินค้าแม่</div>
        <form class="section-body" id="productForm">
          <div class="grid">
            <div class="field span-6"><label>รหัสสินค้าแม่</label><input name="productCode" required></div>
            <div class="field span-6"><label>ชื่อสินค้า</label><input name="name" required></div>
            <div class="field span-12"><label>หมวด</label><input name="category" placeholder="เช่น เสื้อ / กระโปรง"></div>
            <div class="field span-12"><label>รายละเอียด</label><textarea name="description"></textarea></div>
          </div>
          <button class="button primary" type="submit">บันทึกสินค้าแม่</button>
        </form>
      </section>

      <section class="section">
        <div class="section-header">เพิ่ม Stock SKU</div>
        <form class="section-body" id="skuForm">
          <div class="grid">
            <div class="field span-12"><label>สินค้าแม่</label><select name="productId" id="skuProductSelect" required></select></div>
            <div class="field span-6"><label>SKU</label><input name="sku" required></div>
            <div class="field span-6"><label>บาร์โค้ด</label><input name="barcode"></div>
            <div class="field span-4"><label>สี</label><input name="color"></div>
            <div class="field span-4"><label>ไซซ์</label><input name="size"></div>
            <div class="field span-4"><label>ต้นทุนตั้งต้น</label><input name="defaultUnitCost" inputmode="decimal"></div>
          </div>
          <button class="button primary" type="submit">บันทึก SKU</button>
        </form>
      </section>

      <section class="section">
        <div class="section-header">รับสินค้าเข้าคลัง</div>
        <form class="section-body" id="purchaseInForm">
          <div class="grid">
            <div class="field span-12"><label>Stock SKU</label><select name="stockSkuId" id="purchaseSkuSelect" required></select></div>
            <div class="field span-4"><label>วันที่รับเข้า</label><input name="movementDate" type="date" required></div>
            <div class="field span-4"><label>จำนวน</label><input name="quantity" inputmode="numeric" required></div>
            <div class="field span-4"><label>ต้นทุนต่อหน่วย</label><input name="unitCost" inputmode="decimal" required></div>
            <div class="field span-6"><label>ประเภทอ้างอิง</label><input name="referenceType" value="manual"></div>
            <div class="field span-6"><label>เลขอ้างอิง</label><input name="referenceNo"></div>
            <div class="field span-12"><label>หมายเหตุ</label><textarea name="note"></textarea></div>
          </div>
          <button class="button primary" type="submit">รับเข้าคลัง</button>
        </form>
      </section>
      <div class="status-box" id="inventoryStatus"></div>
    </div>

    <div class="stack">
      <section class="section">
        <div class="section-header">ยอดคงเหลือ</div>
        <div class="section-body">
          <div class="table-wrap">
            <table>
              <thead><tr><th>SKU</th><th>สินค้า</th><th>สี</th><th>ไซซ์</th><th class="number">คงเหลือ</th><th class="number">ต้นทุนเฉลี่ย</th><th class="number">มูลค่า</th></tr></thead>
              <tbody id="balanceRows"></tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-header">Stock Card</div>
        <div class="section-body">
          <div class="field"><label>เลือก SKU</label><select id="stockCardSkuSelect"></select></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>วันที่</th><th>เลข Movement</th><th>ประเภท</th><th class="number">จำนวน</th><th class="number">ต้นทุน/หน่วย</th><th class="number">ต้นทุนรวม</th><th class="number">คงเหลือ</th><th>อ้างอิง</th></tr></thead>
              <tbody id="stockCardRows"></tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  </main>

  <script src="./inventory.logic.browser.js"></script>
</body>
</html>
```

- [ ] **Step 4: Create browser controller**

Create `forms/inventory.logic.browser.js`:

```js
window.addEventListener("DOMContentLoaded", () => {
  const productForm = document.querySelector("#productForm");
  const skuForm = document.querySelector("#skuForm");
  const purchaseInForm = document.querySelector("#purchaseInForm");
  const statusBox = document.querySelector("#inventoryStatus");
  const skuProductSelect = document.querySelector("#skuProductSelect");
  const purchaseSkuSelect = document.querySelector("#purchaseSkuSelect");
  const stockCardSkuSelect = document.querySelector("#stockCardSkuSelect");
  const balanceRows = document.querySelector("#balanceRows");
  const stockCardRows = document.querySelector("#stockCardRows");

  function setStatus(message, kind = "") {
    statusBox.className = `status-box active ${kind}`;
    statusBox.textContent = message;
  }

  function formPayload(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {}),
      },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "บันทึกข้อมูลไม่สำเร็จ");
    return result;
  }

  function option(label, value) {
    const node = document.createElement("option");
    node.value = value;
    node.textContent = label;
    return node;
  }

  function skuLabel(sku) {
    return `${sku.sku} - ${sku.productName} ${sku.color || ""} ${sku.size || ""}`.trim();
  }

  async function refreshProducts() {
    const { products } = await api("/api/inventory/products");
    skuProductSelect.replaceChildren(option("เลือกสินค้าแม่", ""), ...products.map((product) => option(`${product.productCode} - ${product.name}`, product.id)));
  }

  async function refreshSkus() {
    const { stockSkus } = await api("/api/inventory/stock-skus");
    const options = [option("เลือก SKU", ""), ...stockSkus.map((sku) => option(skuLabel(sku), sku.id))];
    purchaseSkuSelect.replaceChildren(...options.map((node) => node.cloneNode(true)));
    stockCardSkuSelect.replaceChildren(...options.map((node) => node.cloneNode(true)));
  }

  async function refreshBalances() {
    const { balances } = await api("/api/inventory/balances");
    balanceRows.innerHTML = balances.map((row) => `
      <tr>
        <td>${row.sku}</td>
        <td>${row.productName}</td>
        <td>${row.color || ""}</td>
        <td>${row.size || ""}</td>
        <td class="number">${row.quantityOnHand}</td>
        <td class="number">${row.averageUnitCost}</td>
        <td class="number">${row.inventoryValue}</td>
      </tr>
    `).join("") || `<tr><td colspan="7">ยังไม่มีข้อมูลสต๊อก</td></tr>`;
  }

  async function refreshStockCard() {
    const stockSkuId = stockCardSkuSelect.value;
    if (!stockSkuId) {
      stockCardRows.innerHTML = `<tr><td colspan="8">เลือก SKU เพื่อดู stock card</td></tr>`;
      return;
    }

    const card = await api(`/api/inventory/stock-card?stockSkuId=${encodeURIComponent(stockSkuId)}`);
    stockCardRows.innerHTML = card.movements.map((row) => `
      <tr>
        <td>${row.movementDate}</td>
        <td>${row.movementNo}</td>
        <td>${row.movementType}</td>
        <td class="number">${row.quantity}</td>
        <td class="number">${row.unitCost}</td>
        <td class="number">${row.totalCost}</td>
        <td class="number">${row.runningQuantity}</td>
        <td>${[row.referenceType, row.referenceNo].filter(Boolean).join(": ")}</td>
      </tr>
    `).join("") || `<tr><td colspan="8">ยังไม่มี movement</td></tr>`;
  }

  async function refreshAll() {
    await refreshProducts();
    await refreshSkus();
    await refreshBalances();
    await refreshStockCard();
  }

  function todayInputValue() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  productForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/inventory/products", { method: "POST", body: JSON.stringify(formPayload(productForm)) });
      productForm.reset();
      await refreshAll();
      setStatus("บันทึกสินค้าแม่แล้ว", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  skuForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/inventory/stock-skus", { method: "POST", body: JSON.stringify(formPayload(skuForm)) });
      skuForm.reset();
      await refreshAll();
      setStatus("บันทึก SKU แล้ว", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  purchaseInForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/inventory/purchase-in", { method: "POST", body: JSON.stringify(formPayload(purchaseInForm)) });
      purchaseInForm.reset();
      purchaseInForm.elements.movementDate.value = todayInputValue();
      await refreshAll();
      setStatus("รับสินค้าเข้าคลังแล้ว", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  stockCardSkuSelect.addEventListener("change", refreshStockCard);
  purchaseInForm.elements.movementDate.value = todayInputValue();
  refreshAll().catch((error) => setStatus(error.message, "error"));
});
```

- [ ] **Step 5: Run HTML test**

Run:

```bash
node --test tests/inventory.html.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Run server and browser smoke test**

Start:

```bash
PORT=8787 node local-server.mjs
```

Open:

```text
http://localhost:8787/inventory
```

Manual expected result:

- Page loads without console errors.
- Create product `SHIRT-A`.
- Create SKU `SHIRT-A-BLACK-M` with color `ดำ`, size `M`, default cost `120`.
- Receive quantity `5` at unit cost `120`.
- Balance table shows quantity `5`, average cost `120.00`, value `600.00`.
- Stock card shows one `purchase_in` row.

- [ ] **Step 7: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add forms/inventory.html forms/inventory.logic.browser.js tests/inventory.html.test.mjs
git commit -m "Add inventory management UI"
```

---

### Task 5: Navigation, Verification, And Polish

**Files:**
- Modify: `forms/index.html`
- Modify: `forms/expense-request.html`
- Modify: `forms/expense-requests.html`
- Modify: `forms/company-settings.html`
- Modify: `forms/google-drive.html`
- Modify: `tests/index.html.test.mjs`
- Modify: existing HTML tests that assert menu structure

**Interfaces:**
- Consumes route `/inventory`
- Produces consistent inventory navigation across the app

- [ ] **Step 1: Update failing navigation tests**

Modify `tests/index.html.test.mjs` so the existing test also asserts:

```js
assert.match(html, /href="\/inventory"/);
assert.match(html, /สินค้าและสต๊อก/);
```

For every existing HTML test that checks app menu links, add:

```js
assert.match(html, /href="\/inventory"/);
```

- [ ] **Step 2: Run navigation tests to verify failure**

Run:

```bash
node --test tests/index.html.test.mjs tests/expense-request.html.test.mjs tests/expense-requests.html.test.mjs tests/company-settings.html.test.mjs tests/google-drive.html.test.mjs
```

Expected: FAIL on pages that do not yet link to `/inventory`.

- [ ] **Step 3: Add inventory menu group to every top menu**

In each page menu, add this group before the expense document group:

```html
<div class="menu-group">
  <div class="menu-group-title">ระบบสต๊อก</div>
  <a class="menu-item" href="/inventory">สินค้าและสต๊อก</a>
</div>
```

On `forms/index.html`, also update the panel copy from:

```html
<p>ศูนย์รวมสำหรับสร้าง ติดตาม และจัดเก็บเอกสารใบเบิกจ่ายพร้อม PDF และหลักฐาน raw files</p>
```

to:

```html
<p>ศูนย์รวมสำหรับเอกสารบัญชี สต๊อกสินค้า PDF และหลักฐาน raw files</p>
```

- [ ] **Step 4: Run navigation tests**

Run:

```bash
node --test tests/index.html.test.mjs tests/expense-request.html.test.mjs tests/expense-requests.html.test.mjs tests/company-settings.html.test.mjs tests/google-drive.html.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Run complete verification**

Run:

```bash
npm test
```

Expected: PASS.

Then start the app:

```bash
PORT=8787 node local-server.mjs
```

Open:

```text
http://localhost:8787/inventory
```

Manual expected result:

- Inventory menu link appears from every app page.
- Inventory page can create product, create Stock SKU, receive purchase-in, show balance, and show stock card.
- No text overlaps at desktop width around 1280px.
- At mobile width around 390px, forms stack into one column and tables scroll horizontally instead of squeezing text.

- [ ] **Step 6: Commit**

```bash
git add forms/index.html forms/expense-request.html forms/expense-requests.html forms/company-settings.html forms/google-drive.html tests/*.mjs
git commit -m "Add inventory navigation"
```

---

## Final Verification

Run:

```bash
npm test
```

Expected: all tests pass.

Run:

```bash
PORT=8787 node local-server.mjs
```

Open:

```text
http://localhost:8787/inventory
```

Confirm:

- Product creation works.
- Stock SKU creation works with SKU, color, size, and default cost.
- Purchase-in requires unit cost.
- Balance shows quantity, average unit cost, and inventory value.
- Stock card shows chronological purchase-in movement and running balance.
- The app menu links to inventory from all pages.

After verification, leave the local server running only if the user wants to try the app immediately; otherwise stop it before final handoff.
