# Platform Order Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/platform-orders` workflow that imports Shopee/TikTok order files, matches Sale SKU / Bundle SKU mappings, previews component deductions, and posts duplicate-safe `sale_out` stock movements.

**Architecture:** Add platform-order persistence to the existing inventory SQLite schema, then isolate parsing/import/matching/posting in a new `forms/platform-orders.logic.js` module. Wire that module into `local-server.mjs` with small JSON/multipart handlers, and add a focused HTML/browser page that follows the existing dashboard/list-stock UI conventions.

**Tech Stack:** Node.js built-ins, `node:test`, `node:sqlite` `DatabaseSync`, existing local HTTP server, vanilla HTML/CSS/JavaScript, existing `forms/inventory.logic.js` stock movement and Sale SKU data.

**Spec:** `docs/superpowers/specs/2026-09-05-platform-order-import-design.md`

## Global Constraints

- CSV and TSV imports only; no direct Shopee or TikTok API connection in this phase.
- Platform values are `shopee`, `tiktok`, or `manual`.
- Import statuses are `imported`, `ready`, `has_issues`, or `posted`.
- Line match statuses are `matched`, `missing_sale_sku`, `invalid_quantity`, `insufficient_stock`, or `skipped_status`.
- Posting writes `stock_movements.movement_type = 'sale_out'`, `reference_type = 'platform_order'`, and `reference_no = '{platform}:{order_no}:{line_no}:{sale_sku}'`.
- Re-importing and re-posting must not deduct stock twice.
- Fee summaries, revenue ledgers, tax reports, returns, cancellations after posting, and reversal workflows are out of scope for this phase.

---

## File Structure

- `forms/inventory-db.logic.js`: keep as the single inventory schema owner; bump schema version and create platform order tables/indexes.
- `forms/platform-orders.logic.js`: new service module for parsing files, importing batches, matching lines, building detail views, and posting stock movements.
- `forms/platform-orders.html`: new page shell for upload, import list, detail review, issues, component preview, and post action.
- `forms/platform-orders.logic.browser.js`: new browser controller for `/platform-orders`.
- `forms/index.html`: add Platform Orders menu item under the inventory section.
- `local-server.mjs`: import platform order functions and add static/API routes.
- `tests/platform-orders.logic.test.mjs`: service-level TDD for parser, matching, insufficient stock, posting, and idempotency.
- `tests/platform-orders.html.test.mjs`: static page marker test.
- `tests/inventory-db.logic.test.mjs`: schema table/index migration expectations.
- `tests/inventory-api.test.mjs`: HTTP route tests for upload/detail/post.
- `tests/navigation.html.test.mjs`: menu route coverage.
- `docs/feature-checklist.md`: mark this feature complete only after implementation and verification pass.

---

### Task 1: Schema And Parser Foundation

**Files:**
- Modify: `forms/inventory-db.logic.js`
- Create: `forms/platform-orders.logic.js`
- Modify: `tests/inventory-db.logic.test.mjs`
- Create: `tests/platform-orders.logic.test.mjs`

**Interfaces:**
- Consumes: `openInventoryDatabase(rootDir)`, `ensureInventorySchema(db)` from `forms/inventory-db.logic.js`.
- Produces:
  - `parsePlatformOrderFile(fileBuffer, options): { rows: NormalizedPlatformOrderRow[], duplicateKeys: string[] }`
  - `normalizePlatform(value): 'shopee' | 'tiktok' | 'manual'`
  - `getPlatformOrderTables(db): string[]` is not exported; tests inspect SQLite directly.

- [ ] **Step 1: Write failing schema test**

Add this test to `tests/inventory-db.logic.test.mjs`:

```js
test("inventory schema creates platform order import tables", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-platform-schema-"));

  try {
    const db = openInventoryDatabase(rootDir);
    ensureInventorySchema(db);

    const tables = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
      ORDER BY name
    `).all().map((row) => row.name);

    assert.equal(tables.includes("platform_order_imports"), true);
    assert.equal(tables.includes("platform_orders"), true);
    assert.equal(tables.includes("platform_order_lines"), true);

    const importColumns = db.prepare("PRAGMA table_info(platform_order_imports)").all().map((column) => column.name);
    assert.deepEqual(importColumns, [
      "id",
      "import_no",
      "platform",
      "file_name",
      "status",
      "row_count",
      "matched_line_count",
      "issue_count",
      "posted_at",
      "created_at",
      "updated_at",
    ]);

    const lineColumns = db.prepare("PRAGMA table_info(platform_order_lines)").all().map((column) => column.name);
    assert.equal(lineColumns.includes("match_status"), true);
    assert.equal(lineColumns.includes("posted_at"), true);
    assert.equal(lineColumns.includes("issue_message"), true);

    db.close();
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run schema test to verify it fails**

Run: `node --test tests/inventory-db.logic.test.mjs --test-name-pattern "platform order import tables"`

Expected: FAIL because `platform_order_imports` does not exist.

- [ ] **Step 3: Implement schema**

In `forms/inventory-db.logic.js`:

```js
const SCHEMA_VERSION = 4;
```

Inside `ensureInventorySchema(db)`, after `bundle_components`, add:

```sql
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

CREATE INDEX IF NOT EXISTS idx_platform_order_imports_status
  ON platform_order_imports (status, created_at);

CREATE INDEX IF NOT EXISTS idx_platform_order_lines_import
  ON platform_order_lines (import_id, match_status);
```

- [ ] **Step 4: Run schema test to verify it passes**

Run: `node --test tests/inventory-db.logic.test.mjs --test-name-pattern "platform order import tables"`

Expected: PASS.

- [ ] **Step 5: Write failing parser tests**

Create `tests/platform-orders.logic.test.mjs` with:

```js
import assert from "node:assert/strict";
import test from "node:test";

import platformOrders from "../forms/platform-orders.logic.js";

const { normalizePlatform, parsePlatformOrderFile } = platformOrders;

test("parsePlatformOrderFile normalizes Shopee CSV aliases", () => {
  const csv = [
    "หมายเลขคำสั่งซื้อ,รหัสสินค้า,จำนวน,สถานะ,ชื่อสินค้า,ชื่อผู้ซื้อ",
    "SP-001,SET-A,2,สำเร็จ,เสื้อ A + กระโปรง B,คุณเอ",
  ].join("\n");

  const result = parsePlatformOrderFile(Buffer.from(csv, "utf8"), { platform: "shopee" });

  assert.deepEqual(result.rows, [{
    platform: "shopee",
    orderNo: "SP-001",
    lineNo: "1",
    saleSku: "SET-A",
    quantity: 2,
    orderDate: "",
    orderStatus: "สำเร็จ",
    displayName: "เสื้อ A + กระโปรง B",
    buyerName: "คุณเอ",
    skipped: false,
  }]);
  assert.deepEqual(result.duplicateKeys, []);
});

test("parsePlatformOrderFile supports TSV and skipped cancelled statuses", () => {
  const tsv = [
    "order id\tseller sku\tqty\torder status",
    "TT-001\tTOP-A\t1\tcancelled",
  ].join("\n");

  const result = parsePlatformOrderFile(Buffer.from(tsv, "utf8"), { platform: "tiktok" });

  assert.equal(result.rows[0].platform, "tiktok");
  assert.equal(result.rows[0].skipped, true);
  assert.equal(result.rows[0].orderStatus, "cancelled");
});

test("parsePlatformOrderFile reports duplicate order-line keys", () => {
  const csv = [
    "order_no,sale_sku,quantity,line_no",
    "SP-002,TOP-A,1,1",
    "SP-002,TOP-A,1,1",
  ].join("\n");

  const result = parsePlatformOrderFile(Buffer.from(csv, "utf8"), { platform: "shopee" });

  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.duplicateKeys, ["shopee:SP-002:1:TOP-A"]);
});

test("normalizePlatform accepts only supported platforms", () => {
  assert.equal(normalizePlatform("Shopee"), "shopee");
  assert.equal(normalizePlatform("TikTok"), "tiktok");
  assert.equal(normalizePlatform(""), "manual");
  assert.throws(() => normalizePlatform("lazada"), /platform/);
});
```

- [ ] **Step 6: Run parser tests to verify they fail**

Run: `node --test tests/platform-orders.logic.test.mjs`

Expected: FAIL because `forms/platform-orders.logic.js` does not exist or exports are missing.

- [ ] **Step 7: Implement parser foundation**

Create `forms/platform-orders.logic.js`:

```js
const { openInventoryDatabase, ensureInventorySchema } = require("./inventory-db.logic.js");

const PLATFORM_VALUES = new Set(["shopee", "tiktok", "manual"]);
const HEADER_ALIASES = {
  platform: ["platform", "ช่องทาง", "แพลตฟอร์ม"],
  orderNo: ["order_no", "order id", "order number", "หมายเลขคำสั่งซื้อ"],
  lineNo: ["line_no", "line number", "item no", "ลำดับ"],
  saleSku: ["sale_sku", "seller sku", "sku", "รหัสสินค้า"],
  quantity: ["quantity", "qty", "จำนวน"],
  orderDate: ["order_date", "order date", "วันที่สั่งซื้อ"],
  orderStatus: ["status", "order status", "สถานะ"],
  displayName: ["display_name", "product name", "item name", "ชื่อสินค้า"],
  buyerName: ["buyer_name", "buyer name", "ชื่อลูกค้า", "ชื่อผู้ซื้อ"],
};

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeHeader(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, " ");
}

function normalizePlatform(value) {
  const platform = normalizeHeader(value || "manual");
  if (!platform) return "manual";
  if (PLATFORM_VALUES.has(platform)) return platform;
  throw new Error("platform ไม่รองรับ");
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) || "";
  return firstLine.includes("\t") ? "\t" : ",";
}

function parseDelimitedLine(line, delimiter) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map(cleanText);
}

function buildHeaderMap(headers) {
  const normalized = headers.map(normalizeHeader);
  const map = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = normalized.findIndex((header) => aliases.includes(header));
    if (index >= 0) map[field] = index;
  }
  return map;
}

function cell(cells, map, field) {
  const index = map[field];
  return Number.isInteger(index) ? cleanText(cells[index]) : "";
}

function isSkippedStatus(status) {
  return /cancel|cancelled|canceled|refund|refunded|ยกเลิก|คืนเงิน/i.test(status || "");
}

function parsePlatformOrderFile(fileBuffer, options = {}) {
  const text = Buffer.isBuffer(fileBuffer) ? fileBuffer.toString("utf8") : String(fileBuffer ?? "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("ไฟล์ต้องมี header และข้อมูลอย่างน้อย 1 แถว");
  const delimiter = detectDelimiter(text);
  const headers = parseDelimitedLine(lines[0], delimiter);
  const headerMap = buildHeaderMap(headers);
  for (const required of ["orderNo", "saleSku", "quantity"]) {
    if (!Number.isInteger(headerMap[required])) throw new Error(`ไม่พบคอลัมน์ ${required}`);
  }

  const selectedPlatform = normalizePlatform(options.platform || "");
  const seen = new Set();
  const duplicateKeys = [];
  const perOrderCounts = new Map();
  const rows = lines.slice(1).map((line) => {
    const cells = parseDelimitedLine(line, delimiter);
    const platform = normalizePlatform(cell(cells, headerMap, "platform") || selectedPlatform);
    const orderNo = cell(cells, headerMap, "orderNo");
    const saleSku = cell(cells, headerMap, "saleSku");
    const orderCount = (perOrderCounts.get(orderNo) || 0) + 1;
    perOrderCounts.set(orderNo, orderCount);
    const lineNo = cell(cells, headerMap, "lineNo") || String(orderCount);
    const quantity = Number.parseInt(cell(cells, headerMap, "quantity"), 10);
    const key = `${platform}:${orderNo}:${lineNo}:${saleSku}`;
    if (seen.has(key)) duplicateKeys.push(key);
    seen.add(key);
    const orderStatus = cell(cells, headerMap, "orderStatus");
    return {
      platform,
      orderNo,
      lineNo,
      saleSku,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      orderDate: cell(cells, headerMap, "orderDate"),
      orderStatus,
      displayName: cell(cells, headerMap, "displayName"),
      buyerName: cell(cells, headerMap, "buyerName"),
      skipped: isSkippedStatus(orderStatus),
    };
  });

  return { rows, duplicateKeys };
}

module.exports = {
  normalizePlatform,
  parsePlatformOrderFile,
};
```

- [ ] **Step 8: Run parser and schema tests**

Run: `node --test tests/platform-orders.logic.test.mjs tests/inventory-db.logic.test.mjs`

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add forms/inventory-db.logic.js forms/platform-orders.logic.js tests/inventory-db.logic.test.mjs tests/platform-orders.logic.test.mjs
git commit -m "feat: add platform order schema and parser"
```

---

### Task 2: Import Matching Service

**Files:**
- Modify: `forms/platform-orders.logic.js`
- Modify: `tests/platform-orders.logic.test.mjs`

**Interfaces:**
- Consumes:
  - `parsePlatformOrderFile(fileBuffer, options)`
  - Inventory tables `sale_skus`, `bundle_components`, `stock_skus`, `stock_movements`
- Produces:
  - `importPlatformOrders(rootDir, { platform, fileName, fileBuffer }, options): PlatformOrderImportDetail`
  - `listPlatformOrderImports(rootDir, options): PlatformOrderImportSummary[]`
  - `getPlatformOrderImport(rootDir, importId): PlatformOrderImportDetail`

- [ ] **Step 1: Write failing import/matching test**

Append to `tests/platform-orders.logic.test.mjs`:

```js
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import inventory from "../forms/inventory.logic.js";

const { createProduct, createPurchaseInMovement, createSaleSku, createStockSku } = inventory;
const { importPlatformOrders, getPlatformOrderImport, listPlatformOrderImports } = platformOrders;

test("importPlatformOrders matches Sale SKU bundle components and creates ready batch", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-platform-import-"));

  try {
    const top = createProduct(rootDir, { productCode: "TOP-A", name: "เสื้อ A", category: "เสื้อ" });
    const skirt = createProduct(rootDir, { productCode: "SKIRT-B", name: "กระโปรง B", category: "กระโปรง" });
    const topSku = createStockSku(rootDir, { productId: top.id, sku: "TOP-A-WHITE-M", color: "ขาว", size: "M", defaultUnitCost: "120" });
    const skirtSku = createStockSku(rootDir, { productId: skirt.id, sku: "SKIRT-B-BLACK-M", color: "ดำ", size: "M", defaultUnitCost: "150" });
    createPurchaseInMovement(rootDir, { stockSkuId: topSku.id, quantity: "5", unitCost: "120", movementDate: "2026-09-05" });
    createPurchaseInMovement(rootDir, { stockSkuId: skirtSku.id, quantity: "5", unitCost: "150", movementDate: "2026-09-05" });
    const saleSku = createSaleSku(rootDir, {
      saleSku: "SET-A-SKIRT-B",
      displayName: "เสื้อ A + กระโปรง B",
      platform: "shopee",
      components: [
        { stockSkuId: topSku.id, quantity: "1" },
        { stockSkuId: skirtSku.id, quantity: "1" },
      ],
    });

    const csv = [
      "order_no,sale_sku,quantity,status,product name",
      "SP-1001,SET-A-SKIRT-B,2,paid,Set A",
    ].join("\n");

    const detail = importPlatformOrders(rootDir, {
      platform: "shopee",
      fileName: "orders.csv",
      fileBuffer: Buffer.from(csv, "utf8"),
    }, {
      now: () => "2026-09-05T09:00:00.000Z",
    });

    assert.equal(detail.import.platform, "shopee");
    assert.equal(detail.import.status, "ready");
    assert.equal(detail.import.rowCount, 1);
    assert.equal(detail.import.matchedLineCount, 1);
    assert.equal(detail.import.issueCount, 0);
    assert.equal(detail.lines[0].saleSkuId, saleSku.id);
    assert.deepEqual(detail.lines[0].components.map((component) => ({
      stockSkuId: component.stockSkuId,
      requiredQuantity: component.requiredQuantity,
      quantityOnHand: component.quantityOnHand,
    })), [
      { stockSkuId: topSku.id, requiredQuantity: 2, quantityOnHand: 5 },
      { stockSkuId: skirtSku.id, requiredQuantity: 2, quantityOnHand: 5 },
    ]);

    const listed = listPlatformOrderImports(rootDir);
    assert.equal(listed[0].importNo, detail.import.importNo);

    const loaded = getPlatformOrderImport(rootDir, detail.import.id);
    assert.equal(loaded.orders[0].orderNo, "SP-1001");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Write failing issue-state test**

Append:

```js
test("importPlatformOrders stores row issues for missing mapping invalid quantity and skipped status", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-platform-issues-"));

  try {
    const csv = [
      "order_no,sale_sku,quantity,status",
      "SP-2001,UNKNOWN-SKU,1,paid",
      "SP-2002,UNKNOWN-QTY,abc,paid",
      "SP-2003,CANCELLED-SKU,1,cancelled",
    ].join("\n");

    const detail = importPlatformOrders(rootDir, {
      platform: "shopee",
      fileName: "issue-orders.csv",
      fileBuffer: Buffer.from(csv, "utf8"),
    });

    assert.equal(detail.import.status, "has_issues");
    assert.deepEqual(detail.lines.map((line) => line.matchStatus), [
      "missing_sale_sku",
      "invalid_quantity",
      "skipped_status",
    ]);
    assert.equal(detail.lines[2].postable, false);
    assert.equal(detail.import.issueCount, 2);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Write failing insufficient-stock test**

Append:

```js
test("importPlatformOrders marks matched lines as insufficient_stock when components exceed balance", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-platform-insufficient-"));

  try {
    const product = createProduct(rootDir, { productCode: "LOW-STOCK", name: "เสื้อสต๊อกน้อย", category: "เสื้อ" });
    const stockSku = createStockSku(rootDir, { productId: product.id, sku: "LOW-STOCK-WHITE-M", color: "ขาว", size: "M", defaultUnitCost: "100" });
    createPurchaseInMovement(rootDir, { stockSkuId: stockSku.id, quantity: "1", unitCost: "100", movementDate: "2026-09-05" });
    createSaleSku(rootDir, {
      saleSku: "LOW-STOCK-SALE",
      displayName: "เสื้อสต๊อกน้อย",
      platform: "shopee",
      components: [{ stockSkuId: stockSku.id, quantity: "1" }],
    });

    const detail = importPlatformOrders(rootDir, {
      platform: "shopee",
      fileName: "low-stock.csv",
      fileBuffer: Buffer.from("order_no,sale_sku,quantity\nSP-LOW-001,LOW-STOCK-SALE,2", "utf8"),
    });

    assert.equal(detail.import.status, "has_issues");
    assert.equal(detail.lines[0].matchStatus, "insufficient_stock");
    assert.equal(detail.lines[0].components[0].requiredQuantity, 2);
    assert.equal(detail.lines[0].components[0].quantityOnHand, 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: Run import service tests to verify they fail**

Run: `node --test tests/platform-orders.logic.test.mjs --test-name-pattern "importPlatformOrders"`

Expected: FAIL because import service functions are not exported.

- [ ] **Step 5: Implement import service**

In `forms/platform-orders.logic.js`, add:

```js
function nowIso(options = {}) {
  return options.now ? options.now() : new Date().toISOString();
}

function withPlatformDb(rootDir, fn) {
  const db = openInventoryDatabase(rootDir);
  ensureInventorySchema(db);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function mapImport(row) {
  return {
    id: row.id,
    importNo: row.import_no,
    platform: row.platform,
    fileName: row.file_name,
    status: row.status,
    rowCount: row.row_count,
    matchedLineCount: row.matched_line_count,
    issueCount: row.issue_count,
    postedAt: row.posted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createImportNo(timestamp, db) {
  const datePart = timestamp.slice(0, 10).replace(/-/g, "");
  const count = db.prepare(`
    SELECT COUNT(*) AS count
    FROM platform_order_imports
    WHERE import_no LIKE ?
  `).get(`POI-${datePart}-%`).count;
  return `POI-${datePart}-${String(count + 1).padStart(4, "0")}`;
}
```

Also add helper functions:

```js
function getQuantityOnHand(db, stockSkuId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(CASE
      WHEN movement_type IN ('purchase_in', 'return_in', 'adjustment_in') THEN quantity
      WHEN movement_type IN ('sale_out', 'adjustment_out') THEN -quantity
      ELSE 0
    END), 0) AS quantity_on_hand
    FROM stock_movements
    WHERE stock_sku_id = ?
  `).get(stockSkuId);
  return Number(row.quantity_on_hand || 0);
}

function findSaleSku(db, saleSkuCode, platform) {
  const rows = db.prepare(`
    SELECT *
    FROM sale_skus
    WHERE sale_sku = ?
      AND status = 'active'
    ORDER BY CASE WHEN platform = ? THEN 0 WHEN platform = 'manual' THEN 1 ELSE 2 END, id ASC
  `).all(saleSkuCode, platform);
  if (rows.length === 0) return null;
  const best = rows[0];
  const sameRank = rows.filter((row) => row.platform === best.platform);
  return sameRank.length === 1 ? best : null;
}

function getSaleSkuComponents(db, saleSkuId, lineQuantity) {
  const rows = db.prepare(`
    SELECT
      bundle_components.stock_sku_id,
      bundle_components.quantity AS component_quantity,
      stock_skus.sku,
      stock_skus.color,
      stock_skus.size,
      stock_skus.default_unit_cost,
      products.product_code,
      products.name AS product_name
    FROM bundle_components
    JOIN stock_skus ON stock_skus.id = bundle_components.stock_sku_id
    JOIN products ON products.id = stock_skus.product_id
    WHERE bundle_components.sale_sku_id = ?
    ORDER BY bundle_components.id ASC
  `).all(saleSkuId);

  return rows.map((row) => {
    const quantityOnHand = getQuantityOnHand(db, row.stock_sku_id);
    return {
      stockSkuId: row.stock_sku_id,
      sku: row.sku,
      color: row.color,
      size: row.size,
      productCode: row.product_code,
      productName: row.product_name,
      componentQuantity: row.component_quantity,
      requiredQuantity: row.component_quantity * lineQuantity,
      quantityOnHand,
      unitCost: row.default_unit_cost,
    };
  });
}
```

Implement `importPlatformOrders` to:

1. Parse rows.
2. Insert one `platform_order_imports` row.
3. Upsert `platform_orders` by `(platform, order_no)`.
4. For each parsed row, choose `match_status`:
   - `skipped_status` when `row.skipped`.
   - `invalid_quantity` when `row.quantity <= 0`.
   - `missing_sale_sku` when no unique active Sale SKU mapping exists.
   - `insufficient_stock` when any component quantity would go below zero.
   - `matched` otherwise.
5. Upsert non-posted `platform_order_lines` by `(order_id, line_no, sale_sku)`.
6. Count issues excluding `skipped_status`.
7. Set import status `ready` only when every postable line is `matched`.
8. Return `getPlatformOrderImport(rootDir, importId)`.

Export:

```js
module.exports = {
  getPlatformOrderImport,
  importPlatformOrders,
  listPlatformOrderImports,
  normalizePlatform,
  parsePlatformOrderFile,
};
```

- [ ] **Step 6: Run import service tests**

Run: `node --test tests/platform-orders.logic.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add forms/platform-orders.logic.js tests/platform-orders.logic.test.mjs
git commit -m "feat: import and match platform orders"
```

---

### Task 3: Post-To-Inventory Service

**Files:**
- Modify: `forms/platform-orders.logic.js`
- Modify: `tests/platform-orders.logic.test.mjs`

**Interfaces:**
- Consumes:
  - `getPlatformOrderImport(rootDir, importId)`
  - Existing `stock_movements` table.
- Produces:
  - `postPlatformOrderImport(rootDir, importId, options): PlatformOrderImportDetail`
  - `reference_no` format exactly `{platform}:{orderNo}:{lineNo}:{saleSku}`.

- [ ] **Step 1: Write failing post service test**

Append:

```js
test("postPlatformOrderImport creates sale_out movements for bundle components", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-platform-post-"));

  try {
    const top = createProduct(rootDir, { productCode: "TOP-POST", name: "เสื้อโพสต์", category: "เสื้อ" });
    const skirt = createProduct(rootDir, { productCode: "SKIRT-POST", name: "กระโปรงโพสต์", category: "กระโปรง" });
    const topSku = createStockSku(rootDir, { productId: top.id, sku: "TOP-POST-WHITE-M", color: "ขาว", size: "M", defaultUnitCost: "100" });
    const skirtSku = createStockSku(rootDir, { productId: skirt.id, sku: "SKIRT-POST-BLACK-M", color: "ดำ", size: "M", defaultUnitCost: "150" });
    createPurchaseInMovement(rootDir, { stockSkuId: topSku.id, quantity: "5", unitCost: "100", movementDate: "2026-09-05" });
    createPurchaseInMovement(rootDir, { stockSkuId: skirtSku.id, quantity: "5", unitCost: "150", movementDate: "2026-09-05" });
    createSaleSku(rootDir, {
      saleSku: "POST-SET",
      displayName: "ชุดพร้อมส่ง",
      platform: "tiktok",
      components: [
        { stockSkuId: topSku.id, quantity: "1" },
        { stockSkuId: skirtSku.id, quantity: "1" },
      ],
    });

    const detail = importPlatformOrders(rootDir, {
      platform: "tiktok",
      fileName: "post-orders.tsv",
      fileBuffer: Buffer.from("order id\tseller sku\tqty\nTT-9001\tPOST-SET\t2", "utf8"),
    }, {
      now: () => "2026-09-05T10:00:00.000Z",
    });

    const posted = postPlatformOrderImport(rootDir, detail.import.id, {
      now: () => "2026-09-05T10:05:00.000Z",
    });

    assert.equal(posted.import.status, "posted");
    assert.equal(posted.lines[0].postedAt, "2026-09-05T10:05:00.000Z");

    const movements = posted.postedMovements;
    assert.deepEqual(movements.map((movement) => ({
      stockSkuId: movement.stockSkuId,
      movementType: movement.movementType,
      quantity: movement.quantity,
      referenceType: movement.referenceType,
      referenceNo: movement.referenceNo,
    })), [
      {
        stockSkuId: topSku.id,
        movementType: "sale_out",
        quantity: 2,
        referenceType: "platform_order",
        referenceNo: "tiktok:TT-9001:1:POST-SET",
      },
      {
        stockSkuId: skirtSku.id,
        movementType: "sale_out",
        quantity: 2,
        referenceType: "platform_order",
        referenceNo: "tiktok:TT-9001:1:POST-SET",
      },
    ]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Write failing idempotency/blocking test**

Append:

```js
test("postPlatformOrderImport is idempotent and blocks batches with postable issues", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-platform-idempotent-"));

  try {
    const product = createProduct(rootDir, { productCode: "TOP-IDEMP", name: "เสื้อกันซ้ำ", category: "เสื้อ" });
    const stockSku = createStockSku(rootDir, { productId: product.id, sku: "TOP-IDEMP-WHITE-M", color: "ขาว", size: "M", defaultUnitCost: "90" });
    createPurchaseInMovement(rootDir, { stockSkuId: stockSku.id, quantity: "3", unitCost: "90", movementDate: "2026-09-05" });
    createSaleSku(rootDir, {
      saleSku: "IDEMP-TOP",
      displayName: "เสื้อกันซ้ำ",
      platform: "shopee",
      components: [{ stockSkuId: stockSku.id, quantity: "1" }],
    });

    const ready = importPlatformOrders(rootDir, {
      platform: "shopee",
      fileName: "ready.csv",
      fileBuffer: Buffer.from("order_no,sale_sku,quantity\nSP-3001,IDEMP-TOP,1", "utf8"),
    });

    postPlatformOrderImport(rootDir, ready.import.id);
    const postedAgain = postPlatformOrderImport(rootDir, ready.import.id);

    assert.equal(postedAgain.postedMovements.length, 1);
    assert.equal(postedAgain.import.status, "posted");

    const bad = importPlatformOrders(rootDir, {
      platform: "shopee",
      fileName: "bad.csv",
      fileBuffer: Buffer.from("order_no,sale_sku,quantity\nSP-3002,UNKNOWN,1", "utf8"),
    });

    assert.throws(() => postPlatformOrderImport(rootDir, bad.import.id), /ยังมีรายการที่ต้องแก้ไข/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run post service tests to verify they fail**

Run: `node --test tests/platform-orders.logic.test.mjs --test-name-pattern "postPlatformOrderImport"`

Expected: FAIL because `postPlatformOrderImport` is not exported.

- [ ] **Step 4: Implement posting**

In `forms/platform-orders.logic.js`, add:

```js
function createMovementNo(movementDate, db) {
  const prefix = `MOV-${movementDate.replace(/-/g, "")}`;
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM stock_movements
    WHERE movement_no LIKE ?
  `).get(`${prefix}-%`);
  return `${prefix}-${String(Number(row.count || 0) + 1).padStart(4, "0")}`;
}

function mapMovement(row) {
  return {
    id: row.id,
    movementNo: row.movement_no,
    stockSkuId: row.stock_sku_id,
    movementType: row.movement_type,
    movementDate: row.movement_date,
    quantity: row.quantity,
    unitCost: row.unit_cost,
    totalCost: row.total_cost,
    referenceType: row.reference_type,
    referenceNo: row.reference_no,
    note: row.note,
    createdAt: row.created_at,
  };
}
```

Implement `postPlatformOrderImport(rootDir, importId, options)`:

```js
function postPlatformOrderImport(rootDir, importId, options = {}) {
  return withPlatformDb(rootDir, (db) => {
    const detail = getPlatformOrderImportFromDb(db, importId);
    const blockers = detail.lines.filter((line) => line.postable && line.matchStatus !== "matched");
    if (blockers.length) throw new Error("ยังมีรายการที่ต้องแก้ไขก่อนตัดสต๊อก");

    const timestamp = nowIso(options);
    const movementDate = timestamp.slice(0, 10);
    const postedMovements = [];

    for (const line of detail.lines.filter((item) => item.postable && item.matchStatus === "matched")) {
      for (const component of line.components) {
        const referenceNo = `${line.platform}:${line.orderNo}:${line.lineNo}:${line.saleSku}`;
        const existing = db.prepare(`
          SELECT *
          FROM stock_movements
          WHERE reference_type = 'platform_order'
            AND reference_no = ?
            AND stock_sku_id = ?
        `).get(referenceNo, component.stockSkuId);
        if (existing) {
          postedMovements.push(mapMovement(existing));
          continue;
        }

        const movementNo = createMovementNo(movementDate, db);
        const totalCost = Math.round(Number(component.unitCost || 0) * component.requiredQuantity * 100) / 100;
        const inserted = db.prepare(`
          INSERT INTO stock_movements (
            movement_no, stock_sku_id, movement_type, movement_date, quantity,
            unit_cost, total_cost, reference_type, reference_no, note, created_at
          )
          VALUES (?, ?, 'sale_out', ?, ?, ?, ?, 'platform_order', ?, ?, ?)
          RETURNING *
        `).get(
          movementNo,
          component.stockSkuId,
          movementDate,
          component.requiredQuantity,
          Number(component.unitCost || 0),
          totalCost,
          referenceNo,
          `Platform order import ${detail.import.importNo}`,
          timestamp,
        );
        postedMovements.push(mapMovement(inserted));
      }

      db.prepare("UPDATE platform_order_lines SET posted_at = ? WHERE id = ?").run(timestamp, line.id);
    }

    db.prepare(`
      UPDATE platform_order_imports
      SET status = 'posted', posted_at = ?, updated_at = ?
      WHERE id = ?
    `).run(timestamp, timestamp, detail.import.id);

    return {
      ...getPlatformOrderImportFromDb(db, importId),
      postedMovements,
    };
  });
}
```

Use an internal `getPlatformOrderImportFromDb(db, importId)` so posting can run inside one open database connection.

- [ ] **Step 5: Run post service tests**

Run: `node --test tests/platform-orders.logic.test.mjs`

Expected: PASS.

- [ ] **Step 6: Run existing inventory logic tests**

Run: `node --test tests/inventory.logic.test.mjs tests/inventory-db.logic.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add forms/platform-orders.logic.js tests/platform-orders.logic.test.mjs
git commit -m "feat: post platform orders to inventory"
```

---

### Task 4: API Routes And Navigation

**Files:**
- Modify: `local-server.mjs`
- Modify: `forms/index.html`
- Modify: `tests/inventory-api.test.mjs`
- Modify: `tests/navigation.html.test.mjs`

**Interfaces:**
- Consumes:
  - `listPlatformOrderImports(rootDir)`
  - `getPlatformOrderImport(rootDir, importId)`
  - `importPlatformOrders(rootDir, { platform, fileName, fileBuffer })`
  - `postPlatformOrderImport(rootDir, importId)`
- Produces HTTP endpoints:
  - `GET /api/platform-orders/imports`
  - `GET /api/platform-orders/imports/:id`
  - `POST /api/platform-orders/imports`
  - `POST /api/platform-orders/imports/:id/post`
  - Static route `/platform-orders`

- [ ] **Step 1: Write failing API route test**

Add to `tests/inventory-api.test.mjs` inside the existing server test after Sale SKU API coverage:

```js
    const orderUpload = multipartBody("file", "orders.csv", "text/csv", [
      "order_no,sale_sku,quantity",
      "SP-API-001,API-SET,1",
    ].join("\n"));

    const orderImport = await requestJson(baseUrl, "/api/platform-orders/imports", {
      method: "POST",
      headers: {
        "content-type": orderUpload.contentType,
        "x-platform": "shopee",
      },
      body: orderUpload.body,
    });

    assert.equal(orderImport.import.status, "ready");
    assert.equal(orderImport.lines[0].saleSku, "API-SET");

    const orderImports = await requestJson(baseUrl, "/api/platform-orders/imports");
    assert.equal(orderImports.imports[0].importNo, orderImport.import.importNo);

    const orderDetail = await requestJson(baseUrl, `/api/platform-orders/imports/${orderImport.import.id}`);
    assert.equal(orderDetail.import.id, orderImport.import.id);

    const postedImport = await requestJson(baseUrl, `/api/platform-orders/imports/${orderImport.import.id}/post`, {
      method: "POST",
    });
    assert.equal(postedImport.import.status, "posted");
```

Before this snippet, create the matching API stock data in the same test:

```js
    const { saleSku: apiSaleSku } = await requestJson(baseUrl, "/api/inventory/sale-skus", {
      method: "POST",
      body: JSON.stringify({
        saleSku: "API-SET",
        displayName: "API ชุด",
        platform: "shopee",
        components: [{ stockSkuId: stockSku.id, quantity: "1" }],
      }),
    });
    assert.equal(apiSaleSku.saleSku, "API-SET");
```

- [ ] **Step 2: Write failing navigation test**

In `tests/navigation.html.test.mjs`, add `"platform-orders.html"` to the `pages` array and add:

```js
assert.match(menu, /href="\/platform-orders"/, page);
```

- [ ] **Step 3: Run API/navigation tests to verify they fail**

Run: `node --test tests/inventory-api.test.mjs tests/navigation.html.test.mjs`

Expected: FAIL because routes and menu item are missing.

- [ ] **Step 4: Wire module imports**

In `local-server.mjs`, add:

```js
const {
  getPlatformOrderImport,
  importPlatformOrders,
  listPlatformOrderImports,
  postPlatformOrderImport,
} = require("./forms/platform-orders.logic.js");
```

- [ ] **Step 5: Add static route**

In the existing `routeMap`, add:

```js
"/platform-orders": "/platform-orders.html",
"/platform-orders/": "/platform-orders.html",
```

- [ ] **Step 6: Add handlers**

Add handler functions near the inventory handlers:

```js
async function handlePlatformOrderImportList(response) {
  try {
    sendJson(response, 200, { imports: listPlatformOrderImports(rootDir) });
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot list platform order imports" });
  }
}

async function handlePlatformOrderImportDetail(importId, response) {
  try {
    sendJson(response, 200, getPlatformOrderImport(rootDir, importId));
  } catch (error) {
    sendJson(response, 404, { error: error.message || "Cannot load platform order import" });
  }
}

async function handlePlatformOrderImportCreate(request, response) {
  try {
    const body = await readRequestBody(request);
    const { fields, files } = parseMultipartForm(body, request.headers["content-type"]);
    const file = files.find((upload) => upload.evidenceKey === "file") || files[0];
    if (!file?.buffer?.length) throw new Error("เลือกไฟล์ order");
    const platform = fields.platform || request.headers["x-platform"] || "manual";
    const result = importPlatformOrders(rootDir, {
      platform,
      fileName: file.originalName || "orders.csv",
      fileBuffer: file.buffer,
    });
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot import platform orders" });
  }
}

async function handlePlatformOrderImportPost(importId, response) {
  try {
    sendJson(response, 200, postPlatformOrderImport(rootDir, importId));
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Cannot post platform order import" });
  }
}
```

- [ ] **Step 7: Add route dispatch**

In the POST route area:

```js
if (request.method === "POST" && url.pathname === "/api/platform-orders/imports") {
  await handlePlatformOrderImportCreate(request, response);
  return;
}

if (request.method === "POST" && url.pathname.startsWith("/api/platform-orders/imports/") && url.pathname.endsWith("/post")) {
  const importId = decodeURIComponent(url.pathname.replace("/api/platform-orders/imports/", "").replace("/post", ""));
  await handlePlatformOrderImportPost(importId, response);
  return;
}
```

In the GET route area:

```js
if (url.pathname === "/api/platform-orders/imports") {
  await handlePlatformOrderImportList(response);
  return;
}

if (url.pathname.startsWith("/api/platform-orders/imports/")) {
  const importId = decodeURIComponent(url.pathname.replace("/api/platform-orders/imports/", ""));
  await handlePlatformOrderImportDetail(importId, response);
  return;
}
```

- [ ] **Step 8: Add menu item**

In `forms/index.html`, under inventory menu and after Sale SKU:

```html
<a class="menu-item" href="/platform-orders">Platform Orders</a>
```

- [ ] **Step 9: Run API/navigation tests**

Run: `node --test tests/inventory-api.test.mjs tests/navigation.html.test.mjs`

Expected: PASS.

- [ ] **Step 10: Commit Task 4**

```bash
git add local-server.mjs forms/index.html tests/inventory-api.test.mjs tests/navigation.html.test.mjs
git commit -m "feat: expose platform order APIs"
```

---

### Task 5: Platform Orders Page

**Files:**
- Create: `forms/platform-orders.html`
- Create: `forms/platform-orders.logic.browser.js`
- Create: `tests/platform-orders.html.test.mjs`
- Modify: `docs/feature-checklist.md`

**Interfaces:**
- Consumes:
  - `GET /api/platform-orders/imports`
  - `GET /api/platform-orders/imports/:id`
  - `POST /api/platform-orders/imports`
  - `POST /api/platform-orders/imports/:id/post`
- Produces:
  - Upload form selector `#platformOrderUploadForm`
  - Import list container `#platformOrderImportRows`
  - Detail container `#platformOrderDetail`
  - Post button behavior that is enabled only for `ready` imports.

- [ ] **Step 1: Write failing HTML marker test**

Create `tests/platform-orders.html.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("platform orders page has upload review and post controls", async () => {
  const html = await readFile(join(process.cwd(), "forms", "platform-orders.html"), "utf8");

  assert.match(html, /id="platformOrderUploadForm"/);
  assert.match(html, /id="platformOrderPlatform"/);
  assert.match(html, /id="platformOrderFile"/);
  assert.match(html, /id="platformOrderImportRows"/);
  assert.match(html, /id="platformOrderDetail"/);
  assert.match(html, /id="postPlatformOrderImport"/);
  assert.match(html, /platform-orders\.logic\.browser\.js/);
});
```

- [ ] **Step 2: Run HTML marker test to verify it fails**

Run: `node --test tests/platform-orders.html.test.mjs`

Expected: FAIL because `forms/platform-orders.html` does not exist.

- [ ] **Step 3: Create HTML page**

Create `forms/platform-orders.html` using the same restrained visual language as `forms/inventory-stock-list.html` and `forms/sale-skus.html`. Include:

```html
<form id="platformOrderUploadForm" class="section">
  <div class="section-header">
    <h2 class="section-title">Import order</h2>
  </div>
  <div class="section-body">
    <label class="field">
      <span>Platform</span>
      <select id="platformOrderPlatform" name="platform">
        <option value="shopee">Shopee</option>
        <option value="tiktok">TikTok</option>
        <option value="manual">Manual</option>
      </select>
    </label>
    <label class="field">
      <span>CSV/TSV file</span>
      <input id="platformOrderFile" name="file" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values">
    </label>
    <div class="actions">
      <button class="button primary" type="submit">Import</button>
      <button class="button secondary" id="refreshPlatformOrders" type="button">Refresh</button>
    </div>
    <div id="platformOrderStatusBox" class="status-box"></div>
  </div>
</form>

<section class="section">
  <div class="section-header">
    <h2 class="section-title">Recent imports</h2>
  </div>
  <div class="section-body">
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Import</th>
            <th>Platform</th>
            <th>Status</th>
            <th>Rows</th>
            <th>Issues</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="platformOrderImportRows"></tbody>
      </table>
    </div>
  </div>
</section>

<section id="platformOrderDetail" class="section"></section>
<button id="postPlatformOrderImport" class="button primary" type="button" disabled>Post to inventory</button>
<script src="/platform-orders.logic.browser.js"></script>
```

Keep the full page accessible on mobile: one-column layout below `900px`, tables convert to stacked rows, status badges use compact inline styles, and the detail panel must not require horizontal scrolling except for genuinely tabular component data.

- [ ] **Step 4: Create browser controller**

Create `forms/platform-orders.logic.browser.js`:

```js
window.addEventListener("DOMContentLoaded", () => {
  const state = {
    imports: [],
    selectedImport: null,
  };

  const form = document.querySelector("#platformOrderUploadForm");
  const platformSelect = document.querySelector("#platformOrderPlatform");
  const fileInput = document.querySelector("#platformOrderFile");
  const rowsNode = document.querySelector("#platformOrderImportRows");
  const detailNode = document.querySelector("#platformOrderDetail");
  const postButton = document.querySelector("#postPlatformOrderImport");
  const statusBox = document.querySelector("#platformOrderStatusBox");

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function setStatus(message, kind = "") {
    statusBox.className = `status-box active ${kind}`;
    statusBox.textContent = message;
  }

  function clearStatus() {
    statusBox.className = "status-box";
    statusBox.textContent = "";
  }

  async function api(route, options = {}) {
    const response = await fetch(route, options);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "ดำเนินการไม่สำเร็จ");
    return result;
  }

  function statusLabel(status) {
    const labels = {
      imported: "นำเข้าแล้ว",
      ready: "พร้อมตัดสต๊อก",
      has_issues: "ต้องแก้ไข",
      posted: "ตัดสต๊อกแล้ว",
    };
    return labels[status] || status;
  }

  function renderImports() {
    rowsNode.innerHTML = state.imports.map((item) => `
      <tr>
        <td><strong>${escapeHtml(item.importNo)}</strong><div class="muted">${escapeHtml(item.fileName)}</div></td>
        <td>${escapeHtml(item.platform)}</td>
        <td><span class="pill ${escapeHtml(item.status)}">${statusLabel(item.status)}</span></td>
        <td>${item.rowCount}</td>
        <td>${item.issueCount}</td>
        <td><button class="button secondary small" type="button" data-import-id="${item.id}">ดู</button></td>
      </tr>
    `).join("") || `<tr><td colspan="6">ยังไม่มี import</td></tr>`;
  }

  function renderComponents(line) {
    return (line.components || []).map((component) => `
      <div class="component-line">
        <strong>${escapeHtml(component.sku)}</strong>
        <span>${escapeHtml(component.productName)} ${escapeHtml(component.color)} ${escapeHtml(component.size)}</span>
        <span>ตัด ${component.requiredQuantity} / คงเหลือ ${component.quantityOnHand}</span>
      </div>
    `).join("") || `<span class="muted">ยังไม่มี component</span>`;
  }

  function renderDetail() {
    const detail = state.selectedImport;
    postButton.disabled = !detail || detail.import.status !== "ready";
    if (!detail) {
      detailNode.innerHTML = `<div class="section-body"><div class="muted">เลือก import เพื่อดูรายละเอียด</div></div>`;
      return;
    }

    detailNode.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">${escapeHtml(detail.import.importNo)}</h2>
      </div>
      <div class="section-body">
        <div class="metric-row">
          <div><span>Rows</span><strong>${detail.import.rowCount}</strong></div>
          <div><span>Matched</span><strong>${detail.import.matchedLineCount}</strong></div>
          <div><span>Issues</span><strong>${detail.import.issueCount}</strong></div>
          <div><span>Status</span><strong>${statusLabel(detail.import.status)}</strong></div>
        </div>
        <div class="order-lines">
          ${detail.lines.map((line) => `
            <article class="order-line">
              <header>
                <strong>${escapeHtml(line.orderNo)} / ${escapeHtml(line.saleSku)}</strong>
                <span class="pill ${escapeHtml(line.matchStatus)}">${escapeHtml(line.matchStatus)}</span>
              </header>
              <div class="muted">${escapeHtml(line.displayName || line.buyerName || "")}</div>
              <div>จำนวนขาย: ${line.quantity}</div>
              ${line.issueMessage ? `<div class="issue">${escapeHtml(line.issueMessage)}</div>` : ""}
              <div class="components">${renderComponents(line)}</div>
              ${line.matchStatus === "missing_sale_sku" ? `<a class="button secondary small" href="/sale-skus">แก้ Sale SKU</a>` : ""}
            </article>
          `).join("")}
        </div>
      </div>
    `;
  }

  async function loadImports() {
    const { imports } = await api("/api/platform-orders/imports");
    state.imports = imports;
    renderImports();
    if (!state.selectedImport && imports[0]) await loadDetail(imports[0].id);
    if (!imports[0]) renderDetail();
  }

  async function loadDetail(importId) {
    state.selectedImport = await api(`/api/platform-orders/imports/${encodeURIComponent(importId)}`);
    renderDetail();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();
    const file = fileInput.files[0];
    if (!file) {
      setStatus("เลือกไฟล์ก่อน import", "error");
      return;
    }
    const body = new FormData();
    body.append("platform", platformSelect.value);
    body.append("file", file);
    const detail = await api("/api/platform-orders/imports", {
      method: "POST",
      body,
    });
    state.selectedImport = detail;
    setStatus("Import สำเร็จ", "success");
    fileInput.value = "";
    await loadImports();
    renderDetail();
  });

  rowsNode.addEventListener("click", (event) => {
    const button = event.target.closest("[data-import-id]");
    if (!button) return;
    loadDetail(button.dataset.importId).catch((error) => setStatus(error.message, "error"));
  });

  postButton.addEventListener("click", async () => {
    if (!state.selectedImport) return;
    const detail = await api(`/api/platform-orders/imports/${encodeURIComponent(state.selectedImport.import.id)}/post`, {
      method: "POST",
    });
    state.selectedImport = detail;
    setStatus("ตัดสต๊อกแล้ว", "success");
    await loadImports();
    renderDetail();
  });

  document.querySelector("#refreshPlatformOrders").addEventListener("click", () => {
    loadImports().catch((error) => setStatus(error.message, "error"));
  });

  loadImports().catch((error) => setStatus(error.message, "error"));
});
```

- [ ] **Step 5: Update checklist**

In `docs/feature-checklist.md`, move `Import platform orders and deduct stock from Sale SKU / Bundle SKU mappings.` from current/upcoming into done. Add the next suggested task as `Shopee/TikTok fee summary.`.

- [ ] **Step 6: Run page tests**

Run: `node --test tests/platform-orders.html.test.mjs tests/navigation.html.test.mjs`

Expected: PASS.

- [ ] **Step 7: Run full test suite**

Run: `node --test tests/*.test.mjs`

Expected: PASS.

- [ ] **Step 8: Smoke test local page**

Start or reuse local server:

```bash
PORT=8788 /Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node local-server.mjs
```

Open `http://localhost:8788/platform-orders` and verify:

- Page renders without console-visible blank state.
- Upload form, recent imports, detail section, and post button are visible.
- Importing a small CSV with known Sale SKU changes status to ready.
- Clicking `Post to inventory` changes status to posted.
- The stock card/product history shows a `sale_out` movement.

- [ ] **Step 9: Commit Task 5**

```bash
git add forms/platform-orders.html forms/platform-orders.logic.browser.js tests/platform-orders.html.test.mjs docs/feature-checklist.md
git commit -m "feat: add platform orders page"
```

---

## Final Verification

- [ ] Run `node --test tests/*.test.mjs`.
- [ ] Confirm `http://localhost:8788/platform-orders` is served by the local server.
- [ ] Confirm checklist table in the final report marks:
  - Platform order import and stock deduction: Done.
  - Shopee/TikTok fee summary: Next.
- [ ] Leave the local dev server running only if the user is actively using it in the browser.
