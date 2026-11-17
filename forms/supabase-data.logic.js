const { supabaseRequest } = require("./supabase.logic.js");
const { canonicalHash, stableSourceKey } = require("./data-backend.logic.js");
const { mapCloudVendor } = require("./cloud-vendor-read.logic.js");
const { isDeepStrictEqual } = require("node:util");

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

function mapCloudCompanySettings(record = {}) {
  return {
    legalName: String(record.legal_name ?? "หจก.สวีทเฮาส์ เดซี่"),
    taxId: String(record.tax_id || ""),
    branch: String(record.branch || "สำนักงานใหญ่"),
    address: String(record.address || ""),
  };
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
    documentSourceHash: record.document_source_hash,
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

function shopeeMappingKey(record) {
  return `${record.product_name_key}::${record.option_name_key}`;
}

function assertShopeeMappingRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)
    || typeof row.product_name_key !== "string" || !row.product_name_key.trim()
    || typeof row.option_name_key !== "string" || !row.option_name_key.trim()
    || !Array.isArray(row.bundle) || row.bundle.length === 0
    || row.bundle.some(item => !item || typeof item !== "object" || Array.isArray(item)
      || typeof item.sku !== "string" || !item.sku.trim()
      || !Number.isSafeInteger(item.quantity) || item.quantity <= 0)) {
    throw dataError("SUPABASE_DATA_VERIFY_FAILED", "Supabase Shopee mapping row could not be verified");
  }
}

function mapShopeeCustomLabelMapping(record = {}) {
  return {
    productName: record.product_name_key,
    optionName: record.option_name_key,
    bundle: record.bundle,
  };
}

function toShopeeCustomLabelMappingRow(mapping) {
  return {
    product_name_key: mapping.productName,
    option_name_key: mapping.optionName,
    product_name_display: mapping.productName,
    option_name_display: mapping.optionName,
    bundle: mapping.bundle,
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
    const result = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const response = await supabaseRequest(client, `/rest/v1/${table}${query ? `?${query}` : ""}`, {
        headers: { Range: `${offset}-${offset + pageSize - 1}` },
      });
      const page = rows(response);
      result.push(...page.map(mapResult));
      if (page.length < pageSize) return result;
    }
  }

  async function listDocuments(filters = {}) {
    const params = new URLSearchParams();
    if (filters.ownerUserId) params.set("owner_user_id", `eq.${filters.ownerUserId}`);
    if (filters.status) params.set("status", `eq.${filters.status}`);
    if (filters.documentKind) params.set("document_kind", `eq.${filters.documentKind}`);
    const documentKinds = Array.isArray(filters.documentKinds)
      ? filters.documentKinds
        .map(value => String(value || "").trim())
        .filter(value => /^[a-z0-9_]+$/.test(value))
      : [];
    if (!filters.documentKind && documentKinds.length > 0) {
      params.set("or", `(${documentKinds.map(value => `document_kind.eq.${value}`).join(",")})`);
    }
    if (filters.accountingMonth) params.set("accounting_month", `eq.${filters.accountingMonth}`);
    params.set("order", "updated_at.desc");
    return listTable("documents", params.toString(), mapDocumentRecord);
  }

  async function listProducts(filters = {}) {
    const search = String(filters.search || "").trim().toLowerCase();
    const products = await listTable("inventory_products", "order=source_id.asc", mapCloudProduct);
    if (!search) return products;
    return products.filter(product => [product.productCode, product.name, product.category]
      .some(value => String(value || "").toLowerCase().includes(search)));
  }

  async function listStockSkus(filters = {}) {
    const search = String(filters.search || "").trim().toLowerCase();
    const skus = await listTable("inventory_stock_skus", "order=source_id.asc", mapCloudStockSku);
    if (!search) return skus;
    return skus.filter(item => [item.sku, item.color, item.size, item.productCode, item.productName]
      .some(value => String(value || "").toLowerCase().includes(search)));
  }

  function inventoryMovementQuery(query = "") {
    const params = new URLSearchParams(String(query || "").replace(/^\?/, ""));
    if (!params.has("order")) params.set("order", "source_id.asc");
    return params.toString();
  }

  async function getDocument(sourceKey) {
    const params = new URLSearchParams({ source_key: `eq.${sourceKey}`, limit: "1" });
    const result = await listTable("documents", params.toString(), mapDocumentRecord);
    return result[0] || null;
  }

  async function compareAndSwapDocument(record, expectedSourceHash) {
    const response = await supabaseRequest(client, "/rest/v1/rpc/compare_and_swap_document", {
      method: "POST",
      body: {
        p_source_key: sourceKeyOf(record),
        p_expected_source_hash: expectedSourceHash == null ? null : String(expectedSourceHash),
        p_record: toDocumentCloudRecord(record),
      },
    });
    const row = firstRow(response);
    return response === true || (Array.isArray(response) && response[0] === true) || row?.compare_and_swap_document === true;
  }

  async function getCompanySettings() {
    const result = await listTable("company_settings", "setting_key=eq.default&limit=1");
    return result[0] ? mapCloudCompanySettings(result[0]) : {
      legalName: "หจก.สวีทเฮาส์ เดซี่",
      taxId: "",
      branch: "สำนักงานใหญ่",
      address: "",
    };
  }

  async function saveCompanySettings(settings = {}) {
    const record = {
      source_key: "company_settings:default",
      setting_key: "default",
      legal_name: String(settings.legalName || "").trim(),
      tax_id: String(settings.taxId || "").trim(),
      branch: String(settings.branch || "").trim(),
      address: String(settings.address || "").trim(),
      source_hash: canonicalHash(settings),
      source_payload: settings,
    };
    return upsertTable("company_settings", record, mapCloudCompanySettings, "company settings");
  }

  async function saveVendor(vendor = {}) {
    const id = String(vendor.id ?? "").trim();
    const record = {
      source_key: stableSourceKey("vendor", id),
      source_id: id,
      name: vendor.name ?? "",
      tax_id: vendor.taxId ?? "",
      address: vendor.address ?? "",
      contact_name: vendor.contactName ?? "",
      phone: vendor.phone ?? "",
      email: vendor.email ?? "",
      bank_name: vendor.bankName ?? "",
      account_no: vendor.accountNo ?? "",
      payment_channel: vendor.paymentChannel ?? "",
      payment_reference: vendor.paymentReference ?? "",
      default_business_purpose: vendor.defaultBusinessPurpose ?? "",
      note: vendor.note ?? "",
      status: vendor.status ?? "active",
      created_at: vendor.createdAt ?? now(),
      updated_at: vendor.updatedAt ?? now(),
      source_hash: canonicalHash(vendor),
      source_payload: vendor,
    };
    return upsertTable("vendors", record, mapCloudVendor, "vendor");
  }

  async function listShopeeCustomLabelMappings(keys = []) {
    const requested = new Set(keys.map(key => String(key ?? "").trim()).filter(Boolean));
    const result = {};
    let lastId = 0n;
    while (true) {
      const params = new URLSearchParams({
        select: "id,product_name_key,option_name_key,bundle",
        order: "id.asc",
        limit: "500",
      });
      if (lastId) params.set("id", `gt.${lastId}`);
      const mappingRows = await supabaseRequest(client,
        `/rest/v1/shopee_custom_label_mappings?${params.toString()}`);
      if (!Array.isArray(mappingRows)) {
        throw dataError("SUPABASE_DATA_VERIFY_FAILED", "Supabase Shopee mapping page could not be verified");
      }
      if (mappingRows.length === 0) break;
      for (const row of mappingRows) {
        assertShopeeMappingRow(row);
        const id = String(row.id);
        if (!/^[1-9]\d*$/.test(id) || BigInt(id) <= lastId) {
          throw dataError("SUPABASE_DATA_VERIFY_FAILED", "Supabase Shopee mapping page could not be verified");
        }
        lastId = BigInt(id);
        const key = shopeeMappingKey(row);
        if (requested.size && !requested.has(key)) continue;
        result[key] = row.bundle;
      }
    }
    return result;
  }

  async function upsertShopeeCustomLabelMappings(mappings) {
    const mappingRows = Object.values(mappings).map(toShopeeCustomLabelMappingRow);
    if (mappingRows.length === 0) return {};
    const response = await supabaseRequest(client,
      "/rest/v1/shopee_custom_label_mappings?on_conflict=product_name_key,option_name_key", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: mappingRows,
      });
    const expected = new Map(mappingRows.map(row => [shopeeMappingKey(row), row]));
    const result = {};
    for (const row of rows(response)) {
      const key = shopeeMappingKey(row);
      const expectedRow = expected.get(key);
      if (!expectedRow || Object.hasOwn(result, key)
        || row.product_name_key !== expectedRow.product_name_key
        || row.option_name_key !== expectedRow.option_name_key
        || !isDeepStrictEqual(row.bundle, expectedRow.bundle)) {
        throw dataError("SUPABASE_DATA_VERIFY_FAILED", "Supabase Shopee mapping write could not be verified");
      }
      result[key] = mapShopeeCustomLabelMapping(row);
    }
    if (Object.keys(result).length !== expected.size) {
      throw dataError("SUPABASE_DATA_VERIFY_FAILED", "Supabase Shopee mapping write could not be verified");
    }
    return result;
  }

  async function allocateWorkflowTransactionNumber({ accountingMonth, requestKey = "" } = {}) {
    const response = await supabaseRequest(client, "/rest/v1/rpc/allocate_workflow_transaction_number", {
      method: "POST",
      body: {
        p_accounting_month: String(accountingMonth || ""),
        p_request_key: String(requestKey || ""),
      },
    });
    const row = firstRow(response);
    if (!row || !Number.isFinite(Number(row.sequence)) || !row.transaction_no) {
      throw dataError("SUPABASE_DATA_VERIFY_FAILED", "Supabase workflow transaction allocation was invalid");
    }
    return {
      sequence: String(row.sequence),
      transactionNo: String(row.transaction_no),
      existing: row.existing === true,
    };
  }

  async function allocateAccountingDocumentNumber({ documentKind, accountingMonth, requestKey = "", allocate = true } = {}) {
    const response = await supabaseRequest(client, "/rest/v1/rpc/allocate_accounting_document_number", {
      method: "POST",
      body: {
        p_document_kind: String(documentKind || ""),
        p_accounting_month: String(accountingMonth || ""),
        p_request_key: String(requestKey || ""),
        p_allocate: allocate !== false,
      },
    });
    const row = firstRow(response);
    if (!row || !Number.isFinite(Number(row.sequence)) || !row.document_no) {
      throw dataError("SUPABASE_DATA_VERIFY_FAILED", "Supabase document number allocation was invalid");
    }
    return {
      sequence: String(row.sequence),
      documentNo: String(row.document_no),
      existing: row.existing === true,
    };
  }

  async function peekWorkflowTransactionNumber(accountingMonth) {
    const response = await supabaseRequest(client, "/rest/v1/rpc/peek_workflow_transaction_number", {
      method: "POST",
      body: { p_accounting_month: String(accountingMonth || "") },
    });
    const row = firstRow(response);
    if (!row || !Number.isFinite(Number(row.sequence)) || !row.transaction_no) {
      throw dataError("SUPABASE_DATA_VERIFY_FAILED", "Supabase workflow transaction number preview was invalid");
    }
    return { sequence: String(row.sequence), transactionNo: String(row.transaction_no) };
  }

  return Object.freeze({
    now,
    listCompanySettings: query => listTable("company_settings", query, value => value),
    getCompanySettings,
    saveCompanySettings,
    saveVendor,
    listVendors: query => listTable("vendors", query, value => value),
    listInventoryProducts: query => listTable("inventory_products", query, mapInventoryRecord),
    listInventoryStockSkus: query => listTable("inventory_stock_skus", query, value => value),
    listInventoryStockMovements: query => listTable("inventory_stock_movements", inventoryMovementQuery(query), value => value),
    listProducts,
    listStockSkus,
    listShopeeCustomLabelMappings,
    upsertShopeeCustomLabelMappings,
    saveProduct: record => upsertTable("inventory_products", {
      source_key: stableSourceKey("product", record.id),
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
      source_key: stableSourceKey("stock_sku", record.id),
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
    allocateWorkflowTransactionNumber,
    allocateAccountingDocumentNumber,
    peekWorkflowTransactionNumber,
    getDocument,
    compareAndSwapDocument,
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
