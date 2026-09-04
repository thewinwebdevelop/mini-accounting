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

function mapProductCategory(row) {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
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

function normalizePlatform(value) {
  const platform = cleanText(value).toLowerCase() || "manual";
  if (!["manual", "shopee", "tiktok"].includes(platform)) throw new Error("Platform ไม่ถูกต้อง");
  return platform;
}

function normalizeStatus(value) {
  const status = cleanText(value) || "active";
  if (!["active", "inactive"].includes(status)) throw new Error("สถานะไม่ถูกต้อง");
  return status;
}

function parseSortOrder(value) {
  const text = cleanText(value);
  if (!text) return 0;
  const parsed = Number.parseInt(text, 10);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error("ลำดับหมวดต้องไม่ติดลบ");
  return parsed;
}

function assertActiveProductCategory(db, value) {
  const category = cleanText(value);
  if (!category) throw new Error("เลือกหมวดสินค้า");
  const found = db.prepare("SELECT id FROM product_categories WHERE name = ? AND status = 'active'").get(category);
  if (!found) throw new Error("เลือกหมวดจาก config");
  return category;
}

function listProductCategories(rootDir, filters = {}) {
  return withInventoryDatabase(rootDir, (db) => {
    const includeInactive = Boolean(filters.includeInactive);
    const rows = db.prepare(`
      SELECT *
      FROM product_categories
      WHERE (? = 1 OR status = 'active')
      ORDER BY sort_order ASC, name ASC
    `).all(includeInactive ? 1 : 0);
    return rows.map(mapProductCategory);
  });
}

function createProductCategory(rootDir, data = {}, options = {}) {
  return withInventoryDatabase(rootDir, (db) => {
    const name = cleanText(data.name);
    if (!name) throw new Error("ระบุชื่อหมวด");
    const timestamp = nowIso(options);

    try {
      const row = db.prepare(`
        INSERT INTO product_categories (name, sort_order, status, created_at, updated_at)
        VALUES (?, ?, 'active', ?, ?)
        RETURNING *
      `).get(name, parseSortOrder(data.sortOrder), timestamp, timestamp);
      return mapProductCategory(row);
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw new Error("หมวดนี้มีอยู่แล้ว");
      throw error;
    }
  });
}

function updateProductCategory(rootDir, categoryId, data = {}, options = {}) {
  return withInventoryDatabase(rootDir, (db) => {
    const id = Number(categoryId);
    const name = cleanText(data.name);
    if (!Number.isInteger(id) || id <= 0) throw new Error("ไม่พบหมวดสินค้า");
    if (!name) throw new Error("ระบุชื่อหมวด");

    try {
      const row = db.prepare(`
        UPDATE product_categories
        SET name = ?,
            sort_order = ?,
            status = ?,
            updated_at = ?
        WHERE id = ?
        RETURNING *
      `).get(name, parseSortOrder(data.sortOrder), normalizeStatus(data.status), nowIso(options), id);
      if (!row) throw new Error("ไม่พบหมวดสินค้า");
      return mapProductCategory(row);
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw new Error("หมวดนี้มีอยู่แล้ว");
      throw error;
    }
  });
}

function createProduct(rootDir, data = {}, options = {}) {
  return withInventoryDatabase(rootDir, (db) => {
    const timestamp = nowIso(options);
    const productCode = cleanText(data.productCode).toUpperCase();
    const name = cleanText(data.name);
    if (!productCode) throw new Error("ระบุรหัสสินค้าแม่");
    if (!name) throw new Error("ระบุชื่อสินค้า");
    const category = assertActiveProductCategory(db, data.category);

    try {
      const row = db.prepare(`
        INSERT INTO products (product_code, name, category, description, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?)
        RETURNING *
      `).get(productCode, name, category, cleanText(data.description), timestamp, timestamp);
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

function updateProduct(rootDir, productId, data = {}, options = {}) {
  return withInventoryDatabase(rootDir, (db) => {
    const id = Number(productId);
    const productCode = cleanText(data.productCode).toUpperCase();
    const name = cleanText(data.name);
    if (!Number.isInteger(id) || id <= 0) throw new Error("ไม่พบสินค้าแม่");
    if (!productCode) throw new Error("ระบุรหัสสินค้าแม่");
    if (!name) throw new Error("ระบุชื่อสินค้า");
    const category = assertActiveProductCategory(db, data.category);

    try {
      const row = db.prepare(`
        UPDATE products
        SET product_code = ?,
            name = ?,
            category = ?,
            description = ?,
            status = ?,
            updated_at = ?
        WHERE id = ?
        RETURNING *
      `).get(
        productCode,
        name,
        category,
        cleanText(data.description),
        normalizeStatus(data.status),
        nowIso(options),
        id,
      );
      if (!row) throw new Error("ไม่พบสินค้าแม่");
      return mapProduct(row);
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw new Error("รหัสสินค้าแม่นี้มีอยู่แล้ว");
      throw error;
    }
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

function mapSaleSku(row, components = []) {
  return {
    id: row.id,
    saleSku: row.sale_sku,
    displayName: row.display_name,
    platform: row.platform,
    platformProductId: row.platform_product_id,
    platformVariationId: row.platform_variation_id,
    status: row.status,
    componentCount: components.length,
    components,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBundleComponent(row) {
  return {
    id: row.id,
    saleSkuId: row.sale_sku_id,
    stockSkuId: row.stock_sku_id,
    quantity: row.quantity,
    sku: row.sku,
    color: row.color,
    size: row.size,
    productId: row.product_id,
    productCode: row.product_code,
    productName: row.product_name,
    defaultUnitCost: money(row.default_unit_cost),
    createdAt: row.created_at,
  };
}

function listSaleSkuComponents(db, saleSkuId) {
  return db.prepare(`
    SELECT
      bundle_components.*,
      stock_skus.product_id,
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
  `).all(Number(saleSkuId)).map(mapBundleComponent);
}

function getSaleSkuById(db, saleSkuId) {
  const row = db.prepare("SELECT * FROM sale_skus WHERE id = ?").get(Number(saleSkuId));
  if (!row) throw new Error("ไม่พบ Sale SKU");
  return mapSaleSku(row, listSaleSkuComponents(db, row.id));
}

function normalizeSaleSkuData(db, data = {}) {
  const saleSku = cleanText(data.saleSku).toUpperCase();
  const displayName = cleanText(data.displayName);
  if (!saleSku) throw new Error("ระบุ Sale SKU");
  if (!displayName) throw new Error("ระบุชื่อที่ขาย");

  const components = Array.isArray(data.components) ? data.components : [];
  if (!components.length) throw new Error("เพิ่ม Stock SKU component อย่างน้อย 1 รายการ");
  const normalizedComponents = components.map((component) => {
    const stockSkuId = Number(component.stockSkuId);
    if (!Number.isInteger(stockSkuId) || stockSkuId <= 0) throw new Error("เลือก Stock SKU ให้ครบ");
    const stockSku = db.prepare("SELECT id FROM stock_skus WHERE id = ? AND status = 'active'").get(stockSkuId);
    if (!stockSku) throw new Error("ไม่พบ Stock SKU ที่ใช้งานอยู่");
    return {
      stockSkuId,
      quantity: parseQuantity(component.quantity),
    };
  });
  const duplicate = normalizedComponents.find((component, index) => (
    normalizedComponents.findIndex((item) => item.stockSkuId === component.stockSkuId) !== index
  ));
  if (duplicate) throw new Error("Stock SKU component ซ้ำ");

  return {
    saleSku,
    displayName,
    platform: normalizePlatform(data.platform),
    platformProductId: cleanText(data.platformProductId),
    platformVariationId: cleanText(data.platformVariationId),
    status: normalizeStatus(data.status || "active"),
    components: normalizedComponents,
  };
}

function writeSaleSkuComponents(db, saleSkuId, components, timestamp) {
  const insert = db.prepare(`
    INSERT INTO bundle_components (sale_sku_id, stock_sku_id, quantity, created_at)
    VALUES (?, ?, ?, ?)
  `);
  for (const component of components) {
    insert.run(saleSkuId, component.stockSkuId, component.quantity, timestamp);
  }
}

function createSaleSku(rootDir, data = {}, options = {}) {
  return withInventoryDatabase(rootDir, (db) => {
    const timestamp = nowIso(options);
    const normalized = normalizeSaleSkuData(db, data);

    try {
      db.exec("BEGIN");
      const row = db.prepare(`
        INSERT INTO sale_skus (
          sale_sku, display_name, platform, platform_product_id,
          platform_variation_id, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *
      `).get(
        normalized.saleSku,
        normalized.displayName,
        normalized.platform,
        normalized.platformProductId,
        normalized.platformVariationId,
        normalized.status,
        timestamp,
        timestamp,
      );
      writeSaleSkuComponents(db, row.id, normalized.components, timestamp);
      const result = getSaleSkuById(db, row.id);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      if (String(error.message).includes("UNIQUE")) throw new Error("Sale SKU นี้มีอยู่แล้ว");
      throw error;
    }
  });
}

function updateSaleSku(rootDir, saleSkuId, data = {}, options = {}) {
  return withInventoryDatabase(rootDir, (db) => {
    const id = Number(saleSkuId);
    if (!Number.isInteger(id) || id <= 0) throw new Error("ไม่พบ Sale SKU");
    const timestamp = nowIso(options);
    const normalized = normalizeSaleSkuData(db, data);

    try {
      db.exec("BEGIN");
      const row = db.prepare(`
        UPDATE sale_skus
        SET sale_sku = ?,
            display_name = ?,
            platform = ?,
            platform_product_id = ?,
            platform_variation_id = ?,
            status = ?,
            updated_at = ?
        WHERE id = ?
        RETURNING *
      `).get(
        normalized.saleSku,
        normalized.displayName,
        normalized.platform,
        normalized.platformProductId,
        normalized.platformVariationId,
        normalized.status,
        timestamp,
        id,
      );
      if (!row) throw new Error("ไม่พบ Sale SKU");
      db.prepare("DELETE FROM bundle_components WHERE sale_sku_id = ?").run(id);
      writeSaleSkuComponents(db, id, normalized.components, timestamp);
      const result = getSaleSkuById(db, id);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      if (String(error.message).includes("UNIQUE")) throw new Error("Sale SKU นี้มีอยู่แล้ว");
      throw error;
    }
  });
}

function getSaleSku(rootDir, saleSkuId) {
  return withInventoryDatabase(rootDir, (db) => getSaleSkuById(db, saleSkuId));
}

function listSaleSkus(rootDir, filters = {}) {
  return withInventoryDatabase(rootDir, (db) => {
    const search = `%${cleanText(filters.search)}%`;
    const rows = db.prepare(`
      SELECT DISTINCT sale_skus.*
      FROM sale_skus
      LEFT JOIN bundle_components ON bundle_components.sale_sku_id = sale_skus.id
      LEFT JOIN stock_skus ON stock_skus.id = bundle_components.stock_sku_id
      LEFT JOIN products ON products.id = stock_skus.product_id
      WHERE (? = '%%'
        OR sale_skus.sale_sku LIKE ?
        OR sale_skus.display_name LIKE ?
        OR sale_skus.platform LIKE ?
        OR sale_skus.platform_product_id LIKE ?
        OR sale_skus.platform_variation_id LIKE ?
        OR stock_skus.sku LIKE ?
        OR products.product_code LIKE ?
        OR products.name LIKE ?)
      ORDER BY sale_skus.sale_sku ASC
    `).all(search, search, search, search, search, search, search, search, search);
    return rows.map((row) => mapSaleSku(row, listSaleSkuComponents(db, row.id)));
  });
}

function updateStockSku(rootDir, stockSkuId, data = {}, options = {}) {
  return withInventoryDatabase(rootDir, (db) => {
    const id = Number(stockSkuId);
    const productId = Number(data.productId);
    const sku = cleanText(data.sku).toUpperCase();
    if (!Number.isInteger(id) || id <= 0) throw new Error("ไม่พบ SKU");
    if (!Number.isInteger(productId) || productId <= 0) throw new Error("เลือกสินค้าแม่");
    if (!sku) throw new Error("ระบุ SKU");

    const product = db.prepare("SELECT id FROM products WHERE id = ? AND status = 'active'").get(productId);
    if (!product) throw new Error("ไม่พบสินค้าแม่ที่ใช้งานอยู่");

    try {
      const row = db.prepare(`
        UPDATE stock_skus
        SET product_id = ?,
            sku = ?,
            color = ?,
            size = ?,
            barcode = ?,
            default_unit_cost = ?,
            status = ?,
            updated_at = ?
        WHERE id = ?
        RETURNING *
      `).get(
        productId,
        sku,
        cleanText(data.color),
        cleanText(data.size),
        cleanText(data.barcode),
        parseMoney(data.defaultUnitCost, "ต้นทุนตั้งต้น"),
        normalizeStatus(data.status),
        nowIso(options),
        id,
      );
      if (!row) throw new Error("ไม่พบ SKU");
      return mapStockSku(row);
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw new Error("SKU นี้มีอยู่แล้ว");
      throw error;
    }
  });
}

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

function listStockMovementsByReference(rootDir, referenceType, referenceNo) {
  return withInventoryDatabase(rootDir, (db) => {
    const rows = db.prepare(`
      SELECT *
      FROM stock_movements
      WHERE reference_type = ?
        AND reference_no = ?
      ORDER BY movement_date ASC, id ASC
    `).all(cleanText(referenceType), cleanText(referenceNo));
    return rows.map((row) => mapMovement(row));
  });
}

module.exports = {
  createProductCategory,
  createProduct,
  createPurchaseInMovement,
  createSaleSku,
  createStockSku,
  getSaleSku,
  getStockCard,
  listInventoryBalances,
  listProductCategories,
  listProducts,
  listSaleSkus,
  listStockMovementsByReference,
  listStockSkus,
  updateProductCategory,
  updateProduct,
  updateSaleSku,
  updateStockSku,
};
