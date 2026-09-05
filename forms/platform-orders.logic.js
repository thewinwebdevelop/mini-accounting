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

function normalizeSaleSkuCode(value) {
  return cleanText(value).toUpperCase();
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

function parseStrictPositiveInteger(value) {
  const normalized = cleanText(value).replace(/,/g, "");
  return /^[1-9]\d*$/.test(normalized) ? Number.parseInt(normalized, 10) : 0;
}

function isSkippedStatus(status) {
  return /cancel|cancelled|canceled|refund|refunded|ยกเลิก|คืนเงิน/i.test(status || "");
}

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

function mapOrder(row) {
  return {
    id: row.id,
    importId: row.import_id,
    platform: row.platform,
    orderNo: row.order_no,
    orderDate: row.order_date,
    orderStatus: row.order_status,
    buyerName: row.buyer_name,
    createdAt: row.created_at,
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

function createMovementNo(movementDate, db) {
  const compactDate = cleanText(movementDate).replace(/-/g, "") || new Date().toISOString().slice(0, 10).replace(/-/g, "");
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

function getReservedQuantity(db, stockSkuId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) AS reserved_quantity
    FROM platform_order_reservations
    WHERE stock_sku_id = ?
      AND status = 'reserved'
  `).get(stockSkuId);
  return Number(row.reserved_quantity || 0);
}

function getAvailableQuantity(db, stockSkuId) {
  return getQuantityOnHand(db, stockSkuId) - getReservedQuantity(db, stockSkuId);
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

function refreshImportSummary(db, importId, timestamp) {
  const rows = db.prepare(`
    SELECT match_status
    FROM platform_order_lines
    WHERE import_id = ?
  `).all(importId);
  const matchedLineCount = rows.filter((line) => line.match_status === "matched").length;
  const issueCount = rows.filter((line) => (
    line.match_status !== "matched" && line.match_status !== "skipped_status"
  )).length;
  const postableLines = rows.filter((line) => line.match_status !== "skipped_status");
  const status = postableLines.every((line) => line.match_status === "matched") ? "ready" : "has_issues";

  db.prepare(`
    UPDATE platform_order_imports
    SET status = ?,
        matched_line_count = ?,
        issue_count = ?,
        updated_at = ?
    WHERE id = ?
  `).run(status, matchedLineCount, issueCount, timestamp, importId);
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
    const reservedQuantity = getReservedQuantity(db, row.stock_sku_id);
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
      reservedQuantity,
      availableQuantity: quantityOnHand - reservedQuantity,
      unitCost: row.default_unit_cost,
    };
  });
}

function issueMessageFor(matchStatus) {
  return {
    invalid_quantity: "จำนวนไม่ถูกต้อง",
    missing_sale_sku: "ไม่พบ Sale SKU ที่ตรงกัน",
    insufficient_stock: "สต๊อกไม่พอ",
    skipped_status: "ข้ามตามสถานะคำสั่งซื้อ",
  }[matchStatus] || "";
}

function classifyLine(db, row, remainingStockBySku) {
  if (row.skipped) return { matchStatus: "skipped_status", saleSkuId: null, components: [] };
  if (row.quantity <= 0) return { matchStatus: "invalid_quantity", saleSkuId: null, components: [] };

  const saleSku = findSaleSku(db, row.saleSku, row.platform);
  if (!saleSku) return { matchStatus: "missing_sale_sku", saleSkuId: null, components: [] };

  const components = getSaleSkuComponents(db, saleSku.id, row.quantity);
  const hasInsufficientStock = components.some((component) => {
    if (!remainingStockBySku.has(component.stockSkuId)) {
      remainingStockBySku.set(component.stockSkuId, getAvailableQuantity(db, component.stockSkuId));
    }
    return component.requiredQuantity > remainingStockBySku.get(component.stockSkuId);
  });
  if (!hasInsufficientStock) {
    for (const component of components) {
      remainingStockBySku.set(
        component.stockSkuId,
        remainingStockBySku.get(component.stockSkuId) - component.requiredQuantity,
      );
    }
  }
  return {
    matchStatus: hasInsufficientStock ? "insufficient_stock" : "matched",
    saleSkuId: saleSku.id,
    components,
  };
}

function upsertPlatformOrder(db, row, importId, timestamp) {
  return db.prepare(`
    INSERT INTO platform_orders (
      import_id, platform, order_no, order_date, order_status, buyer_name, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(platform, order_no) DO UPDATE SET
      import_id = excluded.import_id,
      order_date = excluded.order_date,
      order_status = excluded.order_status,
      buyer_name = excluded.buyer_name
    RETURNING *
  `).get(
    importId,
    row.platform,
    row.orderNo,
    row.orderDate,
    row.orderStatus,
    row.buyerName,
    timestamp,
  );
}

function upsertPlatformOrderLine(db, row, importId, orderId, classification, timestamp) {
  const matchStatus = classification.matchStatus;
  return db.prepare(`
    INSERT INTO platform_order_lines (
      import_id, order_id, line_no, sale_sku, display_name, quantity,
      sale_sku_id, match_status, issue_message, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(order_id, line_no, sale_sku) DO UPDATE SET
      import_id = excluded.import_id,
      display_name = excluded.display_name,
      quantity = excluded.quantity,
      sale_sku_id = excluded.sale_sku_id,
      match_status = excluded.match_status,
      issue_message = excluded.issue_message
    WHERE platform_order_lines.posted_at = ''
    RETURNING *
  `).get(
    importId,
    orderId,
    row.lineNo,
    row.saleSku,
    row.displayName,
    row.quantity,
    classification.saleSkuId,
    matchStatus,
    issueMessageFor(matchStatus),
    timestamp,
  );
}

function assertNoPostedOrderConflicts(db, rows) {
  const checkedOrders = new Set();
  for (const row of rows) {
    const key = `${row.platform}:${row.orderNo}`;
    if (checkedOrders.has(key)) continue;
    checkedOrders.add(key);

    const posted = db.prepare(`
      SELECT platform_order_lines.id
      FROM platform_orders
      JOIN platform_order_lines ON platform_order_lines.order_id = platform_orders.id
      WHERE platform_orders.platform = ?
        AND platform_orders.order_no = ?
        AND platform_order_lines.posted_at <> ''
      LIMIT 1
    `).get(row.platform, row.orderNo);
    if (posted) throw new Error("คำสั่งซื้อนี้โพสต์แล้ว ไม่สามารถนำเข้าใหม่ได้");
  }
}

function findUnpostedImportIdsForRows(db, rows) {
  const importIds = new Set();
  const checkedOrders = new Set();
  for (const row of rows) {
    const key = `${row.platform}:${row.orderNo}`;
    if (checkedOrders.has(key)) continue;
    checkedOrders.add(key);

    const existing = db.prepare(`
      SELECT platform_orders.import_id
      FROM platform_orders
      JOIN platform_order_imports ON platform_order_imports.id = platform_orders.import_id
      WHERE platform_orders.platform = ?
        AND platform_orders.order_no = ?
        AND platform_order_imports.status <> 'posted'
    `).get(row.platform, row.orderNo);
    if (existing) importIds.add(existing.import_id);
  }
  return [...importIds];
}

function supersedeImports(db, importIds, timestamp) {
  for (const importId of importIds) {
    db.prepare(`
      UPDATE platform_order_reservations
      SET status = 'released',
          updated_at = ?
      WHERE import_id = ?
        AND status = 'reserved'
    `).run(timestamp, importId);

    db.prepare(`
      UPDATE platform_order_imports
      SET status = 'has_issues',
          issue_count = CASE WHEN issue_count = 0 THEN 1 ELSE issue_count END,
          updated_at = ?
      WHERE id = ?
        AND status <> 'posted'
    `).run(timestamp, importId);
  }
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
    const saleSku = normalizeSaleSkuCode(cell(cells, headerMap, "saleSku"));
    const orderCount = (perOrderCounts.get(orderNo) || 0) + 1;
    perOrderCounts.set(orderNo, orderCount);
    const lineNo = cell(cells, headerMap, "lineNo") || String(orderCount);
    const quantity = parseStrictPositiveInteger(cell(cells, headerMap, "quantity"));
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

function mapLine(row, components = []) {
  return {
    id: row.id,
    importId: row.import_id,
    orderId: row.order_id,
    platform: row.platform,
    orderNo: row.order_no,
    lineNo: row.line_no,
    saleSku: row.sale_sku,
    displayName: row.display_name,
    quantity: row.quantity,
    saleSkuId: row.sale_sku_id,
    matchStatus: row.match_status,
    issueMessage: row.issue_message,
    postedAt: row.posted_at,
    createdAt: row.created_at,
    postable: row.match_status !== "skipped_status",
    components,
  };
}

function getReservedComponentsForLine(db, line) {
  const rows = db.prepare(`
    SELECT
      platform_order_reservations.stock_sku_id,
      platform_order_reservations.quantity,
      stock_skus.sku,
      stock_skus.color,
      stock_skus.size,
      stock_skus.default_unit_cost,
      products.product_code,
      products.name AS product_name
    FROM platform_order_reservations
    JOIN stock_skus ON stock_skus.id = platform_order_reservations.stock_sku_id
    JOIN products ON products.id = stock_skus.product_id
    WHERE platform_order_reservations.order_line_id = ?
      AND platform_order_reservations.status IN ('reserved', 'fulfilled')
    ORDER BY platform_order_reservations.id ASC
  `).all(line.id);

  return rows.map((row) => {
    const quantityOnHand = getQuantityOnHand(db, row.stock_sku_id);
    const reservedQuantity = getReservedQuantity(db, row.stock_sku_id);
    return {
      stockSkuId: row.stock_sku_id,
      sku: row.sku,
      color: row.color,
      size: row.size,
      productCode: row.product_code,
      productName: row.product_name,
      componentQuantity: line.quantity ? row.quantity / line.quantity : row.quantity,
      requiredQuantity: row.quantity,
      quantityOnHand,
      reservedQuantity,
      availableQuantity: quantityOnHand - reservedQuantity,
      unitCost: row.default_unit_cost,
    };
  });
}

function getPlatformOrderImportFromDb(db, importId) {
  const id = Number(importId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("ไม่พบ import");

  const importRow = db.prepare("SELECT * FROM platform_order_imports WHERE id = ?").get(id);
  if (!importRow) throw new Error("ไม่พบ import");

  const orderRows = db.prepare(`
    SELECT *
    FROM platform_orders
    WHERE import_id = ?
    ORDER BY order_no ASC, id ASC
  `).all(id);

  const lineRows = db.prepare(`
    SELECT
      platform_order_lines.*,
      platform_orders.platform,
      platform_orders.order_no
    FROM platform_order_lines
    JOIN platform_orders ON platform_orders.id = platform_order_lines.order_id
    WHERE platform_order_lines.import_id = ?
    ORDER BY platform_order_lines.order_id ASC, platform_order_lines.line_no ASC, platform_order_lines.id ASC
  `).all(id);

  return {
    import: mapImport(importRow),
    orders: orderRows.map(mapOrder),
    lines: lineRows.map((row) => {
      const reservedComponents = getReservedComponentsForLine(db, row);
      return mapLine(
        row,
        reservedComponents.length || !row.sale_sku_id ? reservedComponents : getSaleSkuComponents(db, row.sale_sku_id, row.quantity),
      );
    }),
  };
}

function getPlatformOrderImport(rootDir, importId) {
  return withPlatformDb(rootDir, (db) => getPlatformOrderImportFromDb(db, importId));
}

function listPlatformOrderImports(rootDir) {
  return withPlatformDb(rootDir, (db) => db.prepare(`
    SELECT *
    FROM platform_order_imports
    ORDER BY created_at DESC, id DESC
  `).all().map(mapImport));
}

function platformOrderReferenceNo(line) {
  return `${line.platform}:${line.orderNo}:${line.lineNo}:${line.saleSku}`;
}

function getPostedMovementsForLine(db, line) {
  return db.prepare(`
    SELECT *
    FROM stock_movements
    WHERE reference_type = 'platform_order'
      AND reference_no = ?
    ORDER BY movement_date ASC, id ASC
  `).all(platformOrderReferenceNo(line)).map(mapMovement);
}

function getPostedMovementsForLines(db, lines) {
  return lines.flatMap((line) => getPostedMovementsForLine(db, line));
}

function existingPlatformOrderMovement(db, referenceNo, stockSkuId) {
  return db.prepare(`
    SELECT *
    FROM stock_movements
    WHERE reference_type = 'platform_order'
      AND reference_no = ?
      AND stock_sku_id = ?
  `).get(referenceNo, stockSkuId);
}

function pendingRequirementsForLine(db, line) {
  const requirements = new Map();
  const referenceNo = platformOrderReferenceNo(line);
  for (const component of line.components) {
    if (existingPlatformOrderMovement(db, referenceNo, component.stockSkuId)) continue;
    requirements.set(
      component.stockSkuId,
      (requirements.get(component.stockSkuId) || 0) + component.requiredQuantity,
    );
  }
  return requirements;
}

function reserveComponentsForLine(db, importId, sourceRow, line, components, timestamp) {
  db.prepare(`
    UPDATE platform_order_reservations
    SET status = 'released',
        updated_at = ?
    WHERE order_line_id = ?
      AND status = 'reserved'
  `).run(timestamp, line.id);

  const insert = db.prepare(`
    INSERT INTO platform_order_reservations (
      import_id, order_line_id, stock_sku_id, quantity, status, reference_no, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, 'reserved', ?, ?, ?)
  `);
  const referenceNo = platformOrderReferenceNo(sourceRow);
  for (const component of components) {
    insert.run(
      importId,
      line.id,
      component.stockSkuId,
      component.requiredQuantity,
      referenceNo,
      timestamp,
      timestamp,
    );
  }
}

function findInsufficientLinesForPosting(db, lines) {
  const remainingStockBySku = new Map();
  const insufficientLineIds = new Set();
  for (const line of lines) {
    const requirements = pendingRequirementsForLine(db, line);
    const entries = [...requirements.entries()];
    const hasInsufficientStock = entries.some(([stockSkuId, requiredQuantity]) => {
      if (!remainingStockBySku.has(stockSkuId)) {
        remainingStockBySku.set(stockSkuId, getQuantityOnHand(db, stockSkuId));
      }
      return requiredQuantity > remainingStockBySku.get(stockSkuId);
    });

    if (hasInsufficientStock) {
      insufficientLineIds.add(line.id);
      continue;
    }

    for (const [stockSkuId, requiredQuantity] of entries) {
      remainingStockBySku.set(stockSkuId, remainingStockBySku.get(stockSkuId) - requiredQuantity);
    }
  }
  return [...insufficientLineIds];
}

function postPlatformOrderImport(rootDir, importId, options = {}) {
  return withPlatformDb(rootDir, (db) => {
    const detail = getPlatformOrderImportFromDb(db, importId);
    if (detail.import.status === "posted") {
      return {
        ...detail,
        postedMovements: getPostedMovementsForLines(db, detail.lines.filter((line) => line.postable)),
      };
    }

    if (detail.import.status !== "ready") throw new Error("ยังมีรายการที่ต้องแก้ไขก่อนตัดสต๊อก");

    const blockers = detail.lines.filter((line) => line.postable && line.matchStatus !== "matched");
    if (blockers.length) throw new Error("ยังมีรายการที่ต้องแก้ไขก่อนตัดสต๊อก");

    let transactionOpen = false;
    try {
      db.exec("BEGIN");
      transactionOpen = true;
      const timestamp = nowIso(options);
      const movementDate = timestamp.slice(0, 10);
      const postedMovements = [];
      const matchedLines = detail.lines.filter((item) => item.postable && item.matchStatus === "matched");
      const insufficientLineIds = findInsufficientLinesForPosting(db, matchedLines.filter((line) => !line.postedAt));
      if (insufficientLineIds.length) {
        const updateLine = db.prepare(`
          UPDATE platform_order_lines
          SET match_status = 'insufficient_stock',
              issue_message = ?
          WHERE id = ?
            AND posted_at = ''
        `);
        for (const lineId of insufficientLineIds) {
          updateLine.run(issueMessageFor("insufficient_stock"), lineId);
        }
        refreshImportSummary(db, detail.import.id, timestamp);
        db.exec("COMMIT");
        transactionOpen = false;
        throw new Error("สต๊อกไม่พอสำหรับรายการที่เลือก");
      }

      for (const line of matchedLines) {
        if (line.postedAt) {
          postedMovements.push(...getPostedMovementsForLine(db, line));
          continue;
        }

        const referenceNo = platformOrderReferenceNo(line);
        for (const component of line.components) {
          const existing = existingPlatformOrderMovement(db, referenceNo, component.stockSkuId);
          if (existing) {
            postedMovements.push(mapMovement(existing));
            continue;
          }

          const movementNo = createMovementNo(movementDate, db);
          const unitCost = Number(component.unitCost || 0);
          const totalCost = Math.round(unitCost * component.requiredQuantity * 100) / 100;
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
            unitCost,
            totalCost,
            referenceNo,
            `Platform order import ${detail.import.importNo}`,
            timestamp,
          );
          postedMovements.push(mapMovement(inserted));
        }

        db.prepare("UPDATE platform_order_lines SET posted_at = ? WHERE id = ? AND posted_at = ''").run(timestamp, line.id);
        db.prepare(`
          UPDATE platform_order_reservations
          SET status = 'fulfilled',
              updated_at = ?
          WHERE order_line_id = ?
            AND status = 'reserved'
        `).run(timestamp, line.id);
      }

      db.prepare(`
        UPDATE platform_order_imports
        SET status = 'posted',
            posted_at = CASE WHEN posted_at = '' THEN ? ELSE posted_at END,
            updated_at = ?
        WHERE id = ?
      `).run(timestamp, timestamp, detail.import.id);

      const posted = {
        ...getPlatformOrderImportFromDb(db, importId),
        postedMovements,
      };
      db.exec("COMMIT");
      transactionOpen = false;
      return posted;
    } catch (error) {
      if (transactionOpen) db.exec("ROLLBACK");
      throw error;
    }
  });
}

function importPlatformOrders(rootDir, file = {}, options = {}) {
  return withPlatformDb(rootDir, (db) => {
    const timestamp = nowIso(options);
    const platform = normalizePlatform(file.platform || "manual");
    const parsed = parsePlatformOrderFile(file.fileBuffer, { platform });
    if (parsed.duplicateKeys.length) {
      throw new Error(`ไฟล์มีรายการซ้ำ: ${parsed.duplicateKeys.join(", ")}`);
    }
    const importNo = createImportNo(timestamp, db);

    try {
      db.exec("BEGIN");
      assertNoPostedOrderConflicts(db, parsed.rows);
      const supersededImportIds = findUnpostedImportIdsForRows(db, parsed.rows);
      const importRow = db.prepare(`
        INSERT INTO platform_order_imports (
          import_no, platform, file_name, status, row_count,
          matched_line_count, issue_count, created_at, updated_at
        )
        VALUES (?, ?, ?, 'imported', ?, 0, 0, ?, ?)
        RETURNING *
      `).get(importNo, platform, cleanText(file.fileName), parsed.rows.length, timestamp, timestamp);
      supersedeImports(db, supersededImportIds, timestamp);

      const lineRows = [];
      const remainingStockBySku = new Map();
      for (const row of parsed.rows) {
        const order = upsertPlatformOrder(db, row, importRow.id, timestamp);
        const classification = classifyLine(db, row, remainingStockBySku);
        const line = upsertPlatformOrderLine(db, row, importRow.id, order.id, classification, timestamp);
        if (line) {
          if (classification.matchStatus === "matched") {
            reserveComponentsForLine(db, importRow.id, row, line, classification.components, timestamp);
          }
          lineRows.push(line);
        }
      }

      refreshImportSummary(db, importRow.id, timestamp);

      const detail = getPlatformOrderImportFromDb(db, importRow.id);
      db.exec("COMMIT");
      return detail;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
}

module.exports = {
  getPlatformOrderImport,
  importPlatformOrders,
  listPlatformOrderImports,
  normalizePlatform,
  postPlatformOrderImport,
  parsePlatformOrderFile,
};
