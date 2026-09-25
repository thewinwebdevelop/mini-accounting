const { supabaseRequest } = require("./supabase.logic.js");
const { canonicalHash, stableSourceKey } = require("./data-backend.logic.js");

function dataError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function firstRow(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

function rows(data) {
  if (Array.isArray(data)) return data;
  return data ? [data] : [];
}

function sourceHashOf(record) {
  return String(record.sourceHash ?? record.source_hash ?? "");
}

function sourceKeyOf(record) {
  return String(record.sourceKey ?? record.source_key ?? "");
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function mapInventoryRecord(record = {}) {
  return compact({
    sourceKey: record.source_key,
    sourceId: record.source_id,
    productCode: record.product_code,
    name: record.name,
    category: record.category,
    description: record.description,
    imagePath: record.image_path,
    status: record.status,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    sourceHash: record.source_hash,
    sourcePayload: record.source_payload,
  });
}

function mapCloudProduct(record = {}) {
  const mapped = mapInventoryRecord(record);
  return compact({
    id: mapped.sourceId,
    productCode: mapped.productCode,
    name: mapped.name,
    category: mapped.category,
    description: mapped.description,
    imagePath: mapped.imagePath || "",
    imageUrl: mapped.imagePath ? `/api/inventory/images/${mapped.imagePath}` : "",
    status: mapped.status,
    createdAt: mapped.createdAt,
    updatedAt: mapped.updatedAt,
  });
}

function mapCloudStockSku(record = {}) {
  return compact({
    id: record.source_id,
    productId: record.product_source_id,
    productCode: record.product_code || "",
    productName: record.product_name || "",
    sku: record.sku,
    color: record.color,
    size: record.size,
    barcode: record.barcode,
    defaultUnitCost: Number(record.default_unit_cost || 0).toFixed(2),
    imagePath: record.image_path || "",
    imageUrl: record.image_path ? `/api/inventory/images/${record.image_path}` : "",
    status: record.status,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  });
}

function mapDocumentRecord(record = {}) {
  return compact({
    sourceKey: record.source_key,
    documentKind: record.document_kind,
    documentNo: record.document_no,
    ownerUserId: record.owner_user_id,
    status: record.status,
    accountingMonth: record.accounting_month,
    folderPath: record.folder_path,
    payload: record.payload,
    sourceHash: record.source_hash,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  });
}

function mapDocumentFile(record = {}) {
  return compact({
    sourceKey: record.source_key,
    documentSourceKey: record.document_source_key,
    bucketName: record.bucket_name,
    objectPath: record.object_path,
    sourceSha256: record.source_sha256,
    byteSize: record.byte_size,
    contentType: record.content_type,
    originalName: record.original_name,
    migratedAt: record.migrated_at,
  });
}

function toDocumentCloudRecord(record = {}) {
  return {
    source_key: sourceKeyOf(record),
    document_kind: String(record.documentKind ?? record.document_kind ?? ""),
    document_no: String(record.documentNo ?? record.document_no ?? ""),
    owner_user_id: record.ownerUserId ?? record.owner_user_id ?? null,
    status: String(record.status ?? "draft"),
    accounting_month: String(record.accountingMonth ?? record.accounting_month ?? ""),
    folder_path: String(record.folderPath ?? record.folder_path ?? ""),
    payload: record.payload ?? {},
    source_hash: sourceHashOf(record),
    created_at: record.createdAt ?? record.created_at ?? null,
    updated_at: record.updatedAt ?? record.updated_at ?? null,
  };
}

function toDocumentFileCloudRecord(record = {}) {
  return {
    source_key: sourceKeyOf(record),
    document_source_key: String(record.documentSourceKey ?? record.document_source_key ?? ""),
    bucket_name: String(record.bucketName ?? record.bucket_name ?? ""),
    object_path: String(record.objectPath ?? record.object_path ?? ""),
    source_sha256: String(record.sourceSha256 ?? record.source_sha256 ?? ""),
    byte_size: Number(record.byteSize ?? record.byte_size ?? 0),
    content_type: String(record.contentType ?? record.content_type ?? "application/octet-stream"),
    original_name: String(record.originalName ?? record.original_name ?? ""),
    migrated_at: record.migratedAt ?? record.migrated_at ?? null,
  };
}

function assertVerifiedRow(row, expected, kind) {
  if (!row || sourceKeyOf(row) !== sourceKeyOf(expected)
    || (sourceHashOf(expected) && sourceHashOf(row) !== sourceHashOf(expected))) {
    throw dataError("SUPABASE_DATA_VERIFY_FAILED", `Supabase ${kind} write could not be verified`);
  }
}

function createSupabaseDataRepository({ client, now = () => new Date().toISOString() } = {}) {
  if (!client) throw dataError("SUPABASE_CLIENT_INVALID", "Supabase client is required");

  async function upsertTable(table, record, mapResult, kind) {
    const response = await supabaseRequest(client, `/rest/v1/${table}?on_conflict=source_key`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: record,
    });
    const row = firstRow(response);
    assertVerifiedRow(row, record, kind);
    return mapResult(row);
  }

  async function listTable(table, query = "", mapResult = value => value) {
    const response = await supabaseRequest(client, `/rest/v1/${table}${query ? `?${query}` : ""}`);
    return rows(response).map(mapResult);
  }

  async function listDocuments(filters = {}) {
    const params = new URLSearchParams();
    if (filters.ownerUserId) params.set("owner_user_id", `eq.${filters.ownerUserId}`);
    if (filters.status) params.set("status", `eq.${filters.status}`);
    if (filters.documentKind) params.set("document_kind", `eq.${filters.documentKind}`);
    if (filters.accountingMonth) params.set("accounting_month", `eq.${filters.accountingMonth}`);
    params.set("order", "updated_at.desc");
    return listTable("documents", params.toString(), mapDocumentRecord);
  }

  async function listProducts(filters = {}) {
    const search = String(filters.search || "").trim().toLowerCase();
    const products = await listTable("inventory_products", "", mapCloudProduct);
    if (!search) return products;
    return products.filter(product => [product.productCode, product.name, product.category]
      .some(value => String(value || "").toLowerCase().includes(search)));
  }

  async function listStockSkus(filters = {}) {
    const search = String(filters.search || "").trim().toLowerCase();
    const skus = await listTable("inventory_stock_skus", "", mapCloudStockSku);
    if (!search) return skus;
    return skus.filter(item => [item.sku, item.color, item.size, item.productCode, item.productName]
      .some(value => String(value || "").toLowerCase().includes(search)));
  }

  async function getDocument(sourceKey) {
    const params = new URLSearchParams({ source_key: `eq.${sourceKey}`, limit: "1" });
    const result = await listTable("documents", params.toString(), mapDocumentRecord);
    return result[0] || null;
  }

  return Object.freeze({
    now,
    listCompanySettings: query => listTable("company_settings", query, value => value),
    listVendors: query => listTable("vendors", query, value => value),
    listInventoryProducts: query => listTable("inventory_products", query, mapInventoryRecord),
    listInventoryStockSkus: query => listTable("inventory_stock_skus", query, value => value),
    listInventoryStockMovements: query => listTable("inventory_stock_movements", query, value => value),
    listProducts,
    listStockSkus,
    saveProduct: record => upsertTable("inventory_products", {
      source_key: stableSourceKey("inventory_product", record.id),
      source_id: record.id,
      product_code: record.productCode ?? "",
      name: record.name ?? "",
      category: record.category ?? "",
      description: record.description ?? "",
      image_path: record.imagePath ?? "",
      status: record.status ?? "active",
      created_at: record.createdAt ?? now(),
      updated_at: record.updatedAt ?? now(),
      source_hash: canonicalHash(record),
      source_payload: record,
    }, mapCloudProduct, "inventory product"),
    saveStockSku: record => upsertTable("inventory_stock_skus", {
      source_key: stableSourceKey("inventory_stock_sku", record.id),
      source_id: record.id,
      product_source_id: record.productId,
      sku: record.sku ?? "",
      color: record.color ?? "",
      size: record.size ?? "",
      barcode: record.barcode ?? "",
      default_unit_cost: record.defaultUnitCost ?? 0,
      image_path: record.imagePath ?? "",
      status: record.status ?? "active",
      created_at: record.createdAt ?? now(),
      updated_at: record.updatedAt ?? now(),
      source_hash: canonicalHash(record),
      source_payload: record,
    }, mapCloudStockSku, "stock SKU"),
    upsertInventoryProduct: record => upsertTable("inventory_products", {
      source_key: sourceKeyOf(record),
      source_id: record.sourceId ?? record.source_id ?? null,
      product_code: record.productCode ?? record.product_code ?? "",
      name: record.name ?? "",
      category: record.category ?? "",
      description: record.description ?? "",
      image_path: record.imagePath ?? record.image_path ?? "",
      status: record.status ?? "active",
      created_at: record.createdAt ?? record.created_at ?? now(),
      updated_at: record.updatedAt ?? record.updated_at ?? now(),
      source_hash: sourceHashOf(record),
      source_payload: record.sourcePayload ?? record.source_payload ?? {},
    }, mapInventoryRecord, "inventory product"),
    upsertDocument: record => upsertTable("documents", toDocumentCloudRecord(record), mapDocumentRecord, "document"),
    getDocument,
    listDocuments,
    upsertDocumentFile: record => upsertTable("document_files", toDocumentFileCloudRecord(record), mapDocumentFile, "document file"),
    getDocumentFile: async sourceKey => {
      const params = new URLSearchParams({ source_key: `eq.${sourceKey}`, limit: "1" });
      const result = await listTable("document_files", params.toString(), mapDocumentFile);
      return result[0] || null;
    },
  });
}

module.exports = {
  createSupabaseDataRepository,
  mapDocumentFile,
  mapDocumentRecord,
  mapInventoryRecord,
  toDocumentCloudRecord,
  toDocumentFileCloudRecord,
};
