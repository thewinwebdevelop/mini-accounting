const { supabaseRequest } = require("./supabase.logic.js");
const { uploadStorageObject, downloadStorageObject, storageRequest } = require("./supabase-storage.logic.js");
const { randomUUID } = require("node:crypto");
const { canonicalHash, stableSourceKey } = require("./data-backend.logic.js");
const { createSupabaseDataRepository } = require("./supabase-data.logic.js");
const {
  buildCloudInventoryBalances,
  buildCloudInventoryDashboard,
  buildCloudInventoryStockGroups,
  buildCloudStockCard,
  buildCloudStockInReport,
} = require("./inventory-cloud-read.logic.js");

const ERROR_MESSAGES = Object.freeze({
  INVALID_PRODUCT_CATEGORY: "ระบุชื่อหมวด",
  PRODUCT_CATEGORY_ALREADY_EXISTS: "หมวดสินค้านี้มีอยู่แล้ว",
  INVALID_PRODUCT: "กรอกข้อมูลสินค้าให้ครบ",
  PRODUCT_CODE_ALREADY_EXISTS: "รหัสสินค้าแม่นี้มีอยู่แล้ว",
  PRODUCT_CATEGORY_NOT_FOUND: "ไม่พบหมวดสินค้าที่ใช้งานอยู่",
  PRODUCT_NOT_FOUND: "ไม่พบสินค้าแม่",
  INVALID_STOCK_SKU: "กรอกข้อมูล SKU ให้ครบ",
  STOCK_SKU_ALREADY_EXISTS: "SKU นี้มีอยู่แล้ว",
  STOCK_SKU_NOT_FOUND: "ไม่พบ SKU",
  INVALID_SALE_SKU: "ข้อมูล Sale SKU ไม่ถูกต้อง",
  SALE_SKU_COMPONENTS_REQUIRED: "เลือก Stock SKU อย่างน้อย 1 รายการ",
  INVALID_SALE_SKU_COMPONENT: "Stock SKU component ไม่ถูกต้อง",
  SALE_SKU_ALREADY_EXISTS: "Sale SKU นี้มีอยู่แล้ว",
  SALE_SKU_NOT_FOUND: "ไม่พบ Sale SKU",
  INVALID_PURCHASE_IN: "ข้อมูลรับสินค้าไม่ถูกต้อง",
  MOVEMENT_ALREADY_EXISTS: "รายการรับสินค้านี้มีอยู่แล้ว",
  IDEMPOTENCY_CONFLICT: "คีย์ทำรายการซ้ำถูกใช้กับข้อมูลคนละรายการ",
  STOCK_REVERSAL_SOURCE_INVALID: "STOCK_REVERSAL_SOURCE_INVALID",
  INSUFFICIENT_STOCK_FOR_CANCELLATION: "INSUFFICIENT_STOCK_FOR_CANCELLATION",
  INVALID_RESERVATIONS: "ข้อมูลการจองสินค้าไม่ถูกต้อง",
});

function inventoryError(code, details = {}) {
  const error = new Error(ERROR_MESSAGES[code] || code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function rows(value) { return Array.isArray(value) ? value : value ? [value] : []; }
function first(value) { return rows(value)[0] || null; }
function rpcPayload(value, name) {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, name)) return value[name];
  if (Array.isArray(value) && value.length === 1 && value[0] && Object.hasOwn(value[0], name)) return value[0][name];
  return value;
}

function apiId(value, label = "ID") {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw inventoryError(`INVALID_${label.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`);
  return id;
}

function mapCategory(row) {
  return { id: row.source_id, name: row.name, sortOrder: row.sort_order, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapMovement(row, sku = {}, product = {}) {
  return {
    id: row.source_id, movementNo: row.movement_no, stockSkuId: row.stock_sku_source_id,
    movementType: row.movement_type, movementDate: String(row.movement_date || "").slice(0, 10),
    quantity: Number(row.quantity || 0), unitCost: Number(row.unit_cost || 0).toFixed(2),
    totalCost: Number(row.total_cost || 0).toFixed(2), referenceType: row.reference_type,
    referenceNo: row.reference_no, note: row.note, createdAt: row.created_at,
    runningQuantity: row.runningQuantity ?? null, sku: sku.sku || "", color: sku.color || "",
    size: sku.size || "", barcode: sku.barcode || "", productId: product.id,
    productCode: product.productCode || "", productName: product.name || "", category: product.category || "",
  };
}

function mapSaleSku(row, components = []) {
  return { id: row.source_id, saleSku: row.sale_sku, displayName: row.display_name,
    platform: row.platform, platformProductId: row.platform_product_id,
    platformVariationId: row.platform_variation_id, status: row.status,
    componentCount: components.length, components, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapBundleComponent(row, sku, product) {
  return { id: row.id, saleSkuId: row.sale_sku_source_id, stockSkuId: row.stock_sku_source_id,
    quantity: row.quantity, sku: sku?.sku || "", color: sku?.color || "", size: sku?.size || "",
    productId: product?.id, productCode: product?.productCode || "", productName: product?.name || "",
    defaultUnitCost: Number(sku?.defaultUnitCost || 0).toFixed(2), createdAt: row.created_at };
}

function safeImagePath(objectPath) {
  const value = String(objectPath || "");
  if (!value || value.includes("\\") || value.includes("\0") || value.startsWith("/")
    || value.split("/").some(segment => !segment || segment === "." || segment === "..")) {
    throw inventoryError("INVENTORY_IMAGE_PATH_INVALID");
  }
  return value;
}

function imageExtension(file = {}) {
  const contentType = String(file.type || "").toLowerCase();
  const originalName = String(file.originalName || "").toLowerCase();
  const fromName = originalName.match(/\.(png|jpe?g|webp|gif)$/)?.[0];
  const fromType = ({ "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" })[contentType];
  const extension = fromName || fromType;
  if (!file.buffer?.length || ![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension)) throw inventoryError("INVENTORY_IMAGE_INVALID");
  return extension === ".jpeg" ? ".jpg" : extension;
}

function isCanonicalDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function createInventoryCloudRepository({ client, storageClient, now = () => new Date().toISOString() } = {}) {
  if (!client) throw inventoryError("SUPABASE_CLIENT_INVALID");
  const cloud = createSupabaseDataRepository({ client, now });

  async function allocateSourceId() {
    const result = await supabaseRequest(client, "/rest/v1/rpc/allocate_inventory_source_id", { method: "POST", body: {} });
    const payload = rpcPayload(result, "allocate_inventory_source_id");
    const raw = typeof payload === "number" || typeof payload === "string" ? payload : first(payload)?.allocate_inventory_source_id;
    return apiId(raw, "source ID");
  }

  async function listAllRows(path) {
    const result = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const page = rows(await supabaseRequest(client, path, {
        headers: { Range: `${offset}-${offset + pageSize - 1}` },
      }));
      result.push(...page);
      if (page.length < pageSize) return result;
    }
  }

  async function listProductCategories({ includeInactive = false } = {}) {
    const query = new URLSearchParams({ order: "sort_order.asc,name.asc" });
    if (!includeInactive) query.set("status", "eq.active");
    return (await listAllRows(`/rest/v1/inventory_product_categories?${query}`)).map(mapCategory);
  }

  async function saveProductCategory(payload = {}) {
    const name = String(payload.name || "").trim();
    const sortOrder = payload.sortOrder === undefined || payload.sortOrder === "" ? 0 : Number(payload.sortOrder);
    if (!name || !Number.isSafeInteger(sortOrder) || sortOrder < 0) throw inventoryError("INVALID_PRODUCT_CATEGORY");
    const isUpdate = payload.id !== undefined && payload.id !== null && payload.id !== "";
    const id = isUpdate ? apiId(payload.id, "category ID") : await allocateSourceId();
    const existingCategory = isUpdate
      ? first(await supabaseRequest(client, `/rest/v1/inventory_product_categories?source_id=eq.${id}&limit=1`))
      : null;
    if (isUpdate && !existingCategory) throw inventoryError("PRODUCT_CATEGORY_NOT_FOUND");
    const categoryRows = await listProductCategories({ includeInactive: true });
    if (categoryRows.some(item => String(item.id) !== String(id) && item.name === name)) {
      throw inventoryError("PRODUCT_CATEGORY_ALREADY_EXISTS");
    }
    const status = isUpdate ? String(payload.status || "active").toLowerCase() : "active";
    if (!["active", "inactive"].includes(status)) throw inventoryError("INVALID_PRODUCT_CATEGORY");
    const sourcePayload = { ...payload, id, name, sortOrder, status };
    const record = { source_key: stableSourceKey("product_category", id), source_id: id, name,
      sort_order: sortOrder, status, created_at: payload.createdAt || existingCategory?.created_at || now(), updated_at: now(),
      source_hash: canonicalHash(sourcePayload), source_payload: sourcePayload };
    const result = await supabaseRequest(client, "/rest/v1/inventory_product_categories?on_conflict=source_key", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: record,
    });
    const row = first(result);
    if (!row || row.source_key !== record.source_key || Number(row.source_id) !== id) throw inventoryError("SUPABASE_DATA_VERIFY_FAILED");
    return mapCategory(row);
  }

  async function saveProduct(payload = {}, { creating } = {}) {
    const hasId = payload.id !== undefined && payload.id !== null && payload.id !== "";
    const isCreating = creating === undefined ? !hasId : Boolean(creating);
    const id = hasId ? apiId(payload.id, "product ID") : await allocateSourceId();
    const productCode = String(payload.productCode || "").trim().toUpperCase();
    const name = String(payload.name || "").trim();
    const category = String(payload.category || "").trim();
    const status = String(payload.status || "active").trim().toLowerCase();
    if (!productCode || !name || !category || !["active", "inactive"].includes(status)) throw inventoryError("INVALID_PRODUCT");
    const existingProduct = !isCreating
      ? (await cloud.listProducts({ search: "" })).find(item => String(item.id) === String(id))
      : null;
    if (!isCreating && !existingProduct) throw inventoryError("PRODUCT_NOT_FOUND");
    const productRows = await cloud.listProducts({ search: "" });
    if (productRows.some(item => String(item.id) !== String(id)
      && String(item.productCode || "").trim().toUpperCase() === productCode)) {
      throw inventoryError("PRODUCT_CODE_ALREADY_EXISTS");
    }
    const categoryRows = await supabaseRequest(client,
      `/rest/v1/inventory_product_categories?name=eq.${encodeURIComponent(category)}&status=eq.active&select=name&limit=1`);
    if (!rows(categoryRows).length) throw inventoryError("PRODUCT_CATEGORY_NOT_FOUND");
    return cloud.saveProduct({ id, productCode, name, category, description: String(payload.description || existingProduct?.description || "").trim(),
      imagePath: payload.imagePath === undefined ? (existingProduct?.imagePath || "") : String(payload.imagePath || ""),
      status, createdAt: payload.createdAt || existingProduct?.createdAt || now(), updatedAt: now() });
  }

  async function saveStockSku(payload = {}, { creating } = {}) {
    const hasId = payload.id !== undefined && payload.id !== null && payload.id !== "";
    const isCreating = creating === undefined ? !hasId : Boolean(creating);
    const id = hasId ? apiId(payload.id, "stock SKU ID") : await allocateSourceId();
    const productId = apiId(payload.productId, "product ID");
    const sku = String(payload.sku || "").trim().toUpperCase();
    const cost = Number(payload.defaultUnitCost || 0);
    const status = String(payload.status || "active").trim().toLowerCase();
    if (!sku || !Number.isFinite(cost) || cost < 0 || !["active", "inactive"].includes(status)) throw inventoryError("INVALID_STOCK_SKU");
    const existingSku = !isCreating
      ? (await cloud.listStockSkus({ search: "" })).find(item => String(item.id) === String(id))
      : null;
    if (!isCreating && !existingSku) throw inventoryError("STOCK_SKU_NOT_FOUND");
    const skuRows = await cloud.listStockSkus({ search: "" });
    if (skuRows.some(item => String(item.id) !== String(id)
      && String(item.sku || "").trim().toUpperCase() === sku)) {
      throw inventoryError("STOCK_SKU_ALREADY_EXISTS");
    }
    const parents = await supabaseRequest(client,
      `/rest/v1/inventory_products?source_id=eq.${productId}&status=eq.active&select=source_id,product_code,name&limit=1`);
    const parent = first(parents);
    if (!parent) throw inventoryError("PRODUCT_NOT_FOUND");
    return cloud.saveStockSku({ id, productId, productCode: parent.product_code, productName: parent.name,
      sku, color: String(payload.color || "").trim(), size: String(payload.size || "").trim(),
      barcode: String(payload.barcode || "").trim(), defaultUnitCost: cost.toFixed(2),
      imagePath: payload.imagePath === undefined ? (existingSku?.imagePath || "") : String(payload.imagePath || ""),
      status, createdAt: payload.createdAt || existingSku?.createdAt || now(), updatedAt: now() });
  }

  async function inventorySnapshot() {
    const [products, stockSkus, movements, reservations] = await Promise.all([
      cloud.listProducts({ search: "" }), cloud.listStockSkus({ search: "" }),
      cloud.listInventoryStockMovements(),
      listAllRows("/rest/v1/inventory_stock_reservations?status=eq.reserved&select=stock_sku_source_id,quantity"),
    ]);
    const reservedQuantities = {};
    for (const item of rows(reservations)) {
      const id = String(item.stock_sku_source_id);
      reservedQuantities[id] = (reservedQuantities[id] || 0) + Number(item.quantity || 0);
    }
    return { products, stockSkus, movements, reservedQuantities };
  }

  async function getProductDetail(productId) {
    const id = apiId(productId, "product ID");
    const snapshot = await inventorySnapshot();
    const product = snapshot.products.find(row => String(row.id) === String(id));
    if (!product) throw inventoryError("PRODUCT_NOT_FOUND");
    const children = snapshot.stockSkus.filter(row => String(row.productId) === String(id));
    const childIds = new Set(children.map(row => String(row.id)));
    const movementRows = snapshot.movements.filter(row => childIds.has(String(row.stock_sku_source_id ?? row.stock_sku_id)));
    const balances = buildCloudInventoryBalances({ stockSkus: children, movements: movementRows, reservedQuantities: snapshot.reservedQuantities });
    const movements = movementRows.map(row => {
      const sku = children.find(item => String(item.id) === String(row.stock_sku_source_id ?? row.stock_sku_id));
      return mapMovement(row, sku, product);
    }).sort((a, b) => b.movementDate.localeCompare(a.movementDate) || Number(b.id) - Number(a.id));
    return { product, summary: {
      childCount: balances.length,
      totalQuantityOnHand: balances.reduce((sum, sku) => sum + Number(sku.quantityOnHand || 0), 0),
      totalReservedQuantity: balances.reduce((sum, sku) => sum + Number(sku.reservedQuantity || 0), 0),
      totalAvailableQuantity: balances.reduce((sum, sku) => sum + Number(sku.availableQuantity || 0), 0),
      totalInventoryValue: balances.reduce((sum, sku) => sum + Number(sku.inventoryValue || 0), 0).toFixed(2),
    }, children: balances, movements };
  }

  async function saleSkuRows({ search = "", includeInactive = true } = {}) {
    const params = new URLSearchParams({ order: "sale_sku.asc" });
    if (!includeInactive) params.set("status", "eq.active");
    const [sales, components, stockSkus, products] = await Promise.all([
      listAllRows(`/rest/v1/inventory_sale_skus?${params}`),
      listAllRows("/rest/v1/inventory_bundle_components?order=id.asc"),
      cloud.listStockSkus({ search: "" }), cloud.listProducts({ search: "" }),
    ]);
    const stockById = new Map(stockSkus.map(sku => [String(sku.id), sku]));
    const productsById = new Map(products.map(product => [String(product.id), product]));
    const term = String(search).trim().toLowerCase();
    return rows(sales).map(row => {
      const childRows = rows(components).filter(component => String(component.sale_sku_source_id) === String(row.source_id));
      const childComponents = childRows.map(component => {
        const sku = stockById.get(String(component.stock_sku_source_id));
        return mapBundleComponent(component, sku, productsById.get(String(sku?.productId)));
      });
      return mapSaleSku(row, childComponents);
    }).filter(item => !term || [item.saleSku, item.displayName, item.platform, item.platformProductId,
      item.platformVariationId, ...item.components.flatMap(component => [component.sku, component.productCode, component.productName])]
      .join(" ").toLowerCase().includes(term));
  }

  async function listSaleSkus(filters = {}) { return saleSkuRows(filters); }

  async function getSaleSku(saleSkuId) {
    const id = apiId(saleSkuId, "sale SKU ID");
    const result = (await saleSkuRows()).find(row => String(row.id) === String(id));
    if (!result) throw inventoryError("SALE_SKU_NOT_FOUND");
    return result;
  }

  async function saveSaleSku(payload = {}) {
    const hasId = payload.id !== undefined && payload.id !== null && payload.id !== "";
    const id = hasId ? apiId(payload.id, "sale SKU ID") : await allocateSourceId();
    const existingSaleSku = hasId
      ? first(await supabaseRequest(client, `/rest/v1/inventory_sale_skus?source_id=eq.${id}&limit=1`))
      : null;
    if (hasId && !existingSaleSku) throw inventoryError("SALE_SKU_NOT_FOUND");
    const saleSku = String(payload.saleSku || "").trim().toUpperCase();
    const displayName = String(payload.displayName || "").trim();
    const platform = String(payload.platform || "manual").trim().toLowerCase();
    const status = String(payload.status || "active").trim().toLowerCase();
    const components = (Array.isArray(payload.components) ? payload.components : []).map(component => ({
      stockSkuId: apiId(component.stockSkuId, "stock SKU ID"), quantity: Number(component.quantity),
    }));
    if (!saleSku || !displayName || !["manual", "shopee", "tiktok"].includes(platform)
      || !["active", "inactive"].includes(status)
      || components.some(component => !Number.isSafeInteger(component.quantity) || component.quantity <= 0)
      || new Set(components.map(component => component.stockSkuId)).size !== components.length) throw inventoryError("INVALID_SALE_SKU");
    if (!components.length) throw inventoryError("SALE_SKU_COMPONENTS_REQUIRED");
    const sourcePayload = { ...payload, id, saleSku, displayName, components };
    const record = { source_key: stableSourceKey("sale_sku", id), source_id: id, sale_sku: saleSku,
      display_name: displayName, platform, platform_product_id: String(payload.platformProductId || ""),
      platform_variation_id: String(payload.platformVariationId || ""), status,
      created_at: payload.createdAt || existingSaleSku?.created_at || now(), updated_at: now(), source_hash: canonicalHash(sourcePayload), source_payload: sourcePayload };
    const response = rpcPayload(await supabaseRequest(client, "/rest/v1/rpc/save_inventory_sale_sku", {
      method: "POST", body: { p_sale_sku: record, p_components: components },
    }), "save_inventory_sale_sku");
    const result = first(response);
    if (result?.error) throw inventoryError(result.error);
    return getSaleSku(id);
  }

  async function createPurchaseInMovement(payload = {}) {
    const stockSkuId = apiId(payload.stockSkuId, "stock SKU ID");
    const quantity = Number(payload.quantity);
    const unitCost = Number(payload.unitCost);
    const movementDate = String(payload.movementDate || now().slice(0, 10));
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost <= 0 || !isCanonicalDate(movementDate)) throw inventoryError("INVALID_PURCHASE_IN");
    const sourceId = payload.id ? apiId(payload.id, "movement ID") : await allocateSourceId();
    const sourcePayload = { ...payload, id: sourceId };
    const record = { source_key: stableSourceKey("stock_movement", sourceId), source_id: sourceId,
      stock_sku_source_id: stockSkuId, movement_date: movementDate, quantity, unit_cost: unitCost.toFixed(2),
      total_cost: (Math.round(quantity * unitCost * 100) / 100).toFixed(2), movement_type: "purchase_in",
      reference_type: String(payload.referenceType || "manual"), reference_no: String(payload.referenceNo || ""),
      note: String(payload.note || ""), created_at: now(), source_hash: canonicalHash(sourcePayload),
      source_payload: sourcePayload, idempotency_key: String(payload.idempotencyKey || "") };
    const result = rpcPayload(await supabaseRequest(client, "/rest/v1/rpc/create_inventory_purchase_in", { method: "POST", body: { p_record: record } }), "create_inventory_purchase_in");
    const row = first(result);
    if (row?.error) throw inventoryError(row.error);
    const identityMatches = row && (row.source_key === record.source_key
      || (record.idempotency_key && row.idempotency_key === record.idempotency_key));
    const businessMatches = row && Number(row.stock_sku_source_id) === stockSkuId
      && row.movement_type === "purchase_in" && String(row.movement_date).slice(0, 10) === movementDate
      && Number(row.quantity) === quantity && Number(row.unit_cost) === Number(record.unit_cost)
      && row.reference_type === record.reference_type && row.reference_no === record.reference_no;
    if (!identityMatches || !businessMatches) throw inventoryError("SUPABASE_DATA_VERIFY_FAILED");
    return mapMovement(row);
  }

  async function listStockMovementsByReference(referenceType, referenceNo) {
    const params = new URLSearchParams({ reference_type: `eq.${referenceType}`, reference_no: `eq.${referenceNo}`, order: "movement_date.asc,source_id.asc" });
    const [result, stockSkus, products] = await Promise.all([
      supabaseRequest(client, `/rest/v1/inventory_stock_movements?${params}`), cloud.listStockSkus({ search: "" }), cloud.listProducts({ search: "" }),
    ]);
    const skus = new Map(stockSkus.map(sku => [String(sku.id), sku]));
    const productMap = new Map(products.map(product => [String(product.id), product]));
    return rows(result).map(row => {
      const sku = skus.get(String(row.stock_sku_source_id));
      return mapMovement(row, sku, productMap.get(String(sku?.productId)));
    });
  }

  async function applyStockMovements(records) {
    if (!Array.isArray(records) || !records.length) throw inventoryError("INVALID_STOCK_MOVEMENTS");
    const normalized = [];
    for (const input of records) {
      const id = input.id ? apiId(input.id, "movement ID") : await allocateSourceId();
      const stockSkuId = apiId(input.stockSkuId, "stock SKU ID");
      const quantity = Number(input.quantity);
      const unitCost = Number(input.unitCost || 0);
      const type = String(input.movementType || "");
      const date = String(input.movementDate || now().slice(0, 10));
      if (!Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0
        || !["purchase_in", "sale_out", "return_in", "adjustment_in", "adjustment_out"].includes(type)
        || !isCanonicalDate(date)) throw inventoryError("INVALID_STOCK_MOVEMENTS");
      const sourcePayload = { ...input, id };
      normalized.push({ source_key: stableSourceKey("stock_movement", id), source_id: id,
        stock_sku_source_id: stockSkuId, movement_type: type, movement_date: date, quantity,
        unit_cost: unitCost.toFixed(2), total_cost: (Math.round(quantity * unitCost * 100) / 100).toFixed(2),
        reference_type: String(input.referenceType || "manual"), reference_no: String(input.referenceNo || ""),
        note: String(input.note || ""), created_at: now(), source_hash: canonicalHash(sourcePayload),
        source_payload: sourcePayload, idempotency_key: String(input.idempotencyKey || "") });
    }
    const result = rpcPayload(await supabaseRequest(client, "/rest/v1/rpc/apply_inventory_stock_movements", {
      method: "POST", body: { p_records: normalized },
    }), "apply_inventory_stock_movements");
    if (result?.error) throw inventoryError(result.error, result);
    if (!Array.isArray(result)) throw inventoryError("SUPABASE_DATA_VERIFY_FAILED");
    return result.map(row => mapMovement(row));
  }

  async function reversePurchaseInMovementsByReference(request = {}) {
    const expected = request.expectedOriginalMovementIds;
    if (request.referenceType !== "substitute_receipt"
      || !/^SR-\d{4}-(0[1-9]|1[0-2])-\d{4}$/.test(String(request.referenceNo || ""))
      || !/^workflow_transaction:TXN-\d{4}-(0[1-9]|1[0-2])-\d{4}$/.test(String(request.cancellationReference || ""))
      || !isCanonicalDate(request.reversalDate) || !Array.isArray(expected)
      || expected.some(id => !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) throw inventoryError("STOCK_REVERSAL_SOURCE_INVALID");
    const sourceIds = {};
    for (const id of expected) sourceIds[String(id)] = await allocateSourceId();
    const result = rpcPayload(await supabaseRequest(client, "/rest/v1/rpc/reverse_inventory_purchase_in", {
      method: "POST", body: { p_request: request, p_reversal_source_ids: sourceIds },
    }), "reverse_inventory_purchase_in");
    const row = first(result);
    if (row?.error) throw inventoryError(row.error, row);
    if (!row || !row.status || !Array.isArray(row.reversals)) throw inventoryError("SUPABASE_DATA_VERIFY_FAILED");
    return row;
  }

  async function replaceReservations({ orderLineKey, referenceNo = "", reservations = [] } = {}) {
    if (!String(orderLineKey || "").trim() || !Array.isArray(reservations)) throw inventoryError("INVALID_RESERVATIONS");
    const clean = reservations.map(item => ({ stockSkuId: apiId(item.stockSkuId, "stock SKU ID"), quantity: Number(item.quantity) }));
    if (clean.some(item => !Number.isSafeInteger(item.quantity) || item.quantity <= 0)
      || new Set(clean.map(item => item.stockSkuId)).size !== clean.length) throw inventoryError("INVALID_RESERVATIONS");
    const result = rpcPayload(await supabaseRequest(client, "/rest/v1/rpc/replace_inventory_reservations", {
      method: "POST", body: { p_order_line_key: String(orderLineKey), p_reference_no: String(referenceNo), p_reservations: clean },
    }), "replace_inventory_reservations");
    const row = first(result);
    if (row?.error) throw inventoryError(row.error);
    if (!row || !Array.isArray(row.reservations)) throw inventoryError("SUPABASE_DATA_VERIFY_FAILED");
    return row.reservations;
  }

  async function setReservationStatus(orderLineKey, status) {
    if (!["released", "fulfilled"].includes(status)) throw inventoryError("INVALID_RESERVATIONS");
    const result = rpcPayload(await supabaseRequest(client, "/rest/v1/rpc/set_inventory_reservation_status", {
      method: "POST", body: { p_order_line_key: String(orderLineKey), p_status: status },
    }), "set_inventory_reservation_status");
    const count = Number(first(result) ?? result);
    if (!Number.isInteger(count) || count < 0) throw inventoryError("INVALID_RESERVATIONS");
    return count;
  }

  async function uploadInventoryImage(kind, entityId, file) {
    if (!storageClient) throw inventoryError("SUPABASE_STORAGE_CLIENT_INVALID");
    const id = apiId(entityId, `${kind} ID`);
    const extension = imageExtension(file);
    const entity = kind === "product"
      ? (await cloud.listProducts({ search: "" })).find(row => String(row.id) === String(id))
      : (await cloud.listStockSkus({ search: "" })).find(row => String(row.id) === String(id));
    if (!entity) throw inventoryError(kind === "product" ? "PRODUCT_NOT_FOUND" : "STOCK_SKU_NOT_FOUND");
    const objectPath = safeImagePath(`inventory-images/${kind === "product" ? "products" : "stock-skus"}/${id}/${randomUUID()}${extension}`);
    await uploadStorageObject(storageClient, { objectPath, body: file.buffer, contentType: String(file.type || "application/octet-stream") });
    let saved;
    try {
      saved = kind === "product"
        ? await cloud.saveProduct({ ...entity, imagePath: objectPath, updatedAt: now() })
        : await cloud.saveStockSku({ ...entity, imagePath: objectPath, updatedAt: now() });
    } catch (error) {
      try {
        const latest = kind === "product"
          ? (await cloud.listProducts({ search: "" })).find(row => String(row.id) === String(id))
          : (await cloud.listStockSkus({ search: "" })).find(row => String(row.id) === String(id));
        if (latest?.imagePath !== objectPath) await storageRequest(storageClient, objectPath, { method: "DELETE" });
      } catch { /* Keep the object if its metadata reference cannot be checked safely. */ }
      throw error;
    }
    return kind === "product"
      ? { product: saved, imagePath: objectPath, imageUrl: `/api/inventory/images/${objectPath}` }
      : { stockSku: saved, imagePath: objectPath, imageUrl: `/api/inventory/images/${objectPath}` };
  }

  async function downloadInventoryImage(imagePath) {
    if (!storageClient) throw inventoryError("SUPABASE_STORAGE_CLIENT_INVALID");
    const value = safeImagePath(imagePath);
    if (!value.startsWith("inventory-images/")) throw inventoryError("INVENTORY_IMAGE_PATH_INVALID");
    return downloadStorageObject(storageClient, value);
  }

  return Object.freeze({
    allocateSourceId, saveProduct, saveStockSku, listProductCategories, saveProductCategory,
    getProductDetail, listSaleSkus, getSaleSku, saveSaleSku, createPurchaseInMovement,
    applyStockMovements, listStockMovementsByReference, reversePurchaseInMovementsByReference,
    replaceReservations, setReservationStatus, uploadInventoryImage, downloadInventoryImage,
    listInventoryBalances: async () => buildCloudInventoryBalances(await inventorySnapshot()),
    listInventoryStockGroups: async filters => buildCloudInventoryStockGroups({ ...(await inventorySnapshot()), filters }),
    getInventoryDashboard: async () => {
      const snapshot = await inventorySnapshot();
      return { summary: buildCloudInventoryDashboard({ balances: buildCloudInventoryBalances(snapshot) }),
        latestStockIn: buildCloudStockInReport({ ...snapshot, limit: 10 }) };
    },
    listStockInReport: async filters => buildCloudStockInReport({ ...(await inventorySnapshot()), limit: filters?.limit }),
    getStockCard: async stockSkuId => buildCloudStockCard({ ...(await inventorySnapshot()), stockSkuId }),
  });
}

module.exports = { createInventoryCloudRepository, imageExtension, inventoryError, mapBundleComponent,
  mapCategory, mapMovement, mapSaleSku, safeImagePath };
