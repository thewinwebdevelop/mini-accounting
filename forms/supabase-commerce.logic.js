const crypto = require("node:crypto");
const { supabaseRequest } = require("./supabase.logic.js");
const { groupEligibleShopeePackages } = require("./shopee-shipment.logic.js");

const COMMERCE_RECORD_TYPES = Object.freeze([
  "platform_order_import",
  "platform_order",
  "shopee_connection",
  "shopee_oauth_state",
  "shopee_sync_run",
  "shipment_batch",
  "shipment_batch_order",
  "shipping_document_job",
  "custom_label_job",
]);
const RECORD_TYPE_SET = new Set(COMMERCE_RECORD_TYPES);
const SHIPMENT_ACTION_TYPES = new Set([
  "import_post", "shopee_sync", "shipment_prepare", "arrange_shipment",
  "tracking_refresh", "document_create", "document_download",
  "shipping_document_create", "shipping_document_poll",
]);

function commerceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isRevisionConflict(error) {
  return error?.sqlCode === "40001" || error?.details?.code === "40001";
}

function requiredText(value, label) {
  const clean = String(value ?? "").trim();
  if (!clean) throw commerceError("COMMERCE_IDENTITY_REQUIRED", `${label} is required`);
  return clean;
}

function rows(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function mapCommerceRecord(row) {
  if (!row) return null;
  return {
    recordType: row.record_type,
    identityKey: row.identity_key,
    sourceKey: row.source_key || `${row.record_type}:${row.identity_key}`,
    payload: row.payload || {},
    revision: Number(row.revision || 1),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

function mapRecordPayload(row) {
  const record = mapCommerceRecord(row);
  return record ? { ...record.payload, recordType: record.recordType, identityKey: record.identityKey, sourceKey: record.sourceKey, revision: record.revision } : null;
}

function normalizeShopeeLine(item = {}, index = 0) {
  const itemId = String(item.itemId ?? item.item_id ?? "").trim();
  const modelId = String(item.modelId ?? item.model_id ?? item.variationId ?? item.variation_id ?? "").trim();
  const modelSku = String(item.modelSku ?? item.model_sku ?? item.sellerSku ?? item.seller_sku ?? "").trim();
  const quantity = Number(item.quantity ?? item.itemQuantity ?? item.item_quantity ?? 0);
  return {
    lineNo: String(item.lineNo ?? item.line_no ?? index + 1).trim(),
    saleSku: modelSku || itemId,
    displayName: [item.itemName ?? item.item_name ?? item.name, item.modelName ?? item.model_name ?? item.variationName ?? item.variation_name]
      .map(value => String(value || "").trim()).filter(Boolean).join(" / "),
    quantity: Number.isInteger(quantity) && quantity >= 0 ? quantity : 0,
    externalItemId: itemId,
    externalModelId: modelId,
    externalModelSku: modelSku,
    mappingStatus: String(item.mappingStatus ?? item.mapping_status ?? "unmapped"),
    mappingSource: String(item.mappingSource ?? item.mapping_source ?? ""),
    mappedSaleSkuId: item.mappedSaleSkuId ?? item.mapped_sale_sku_id ?? null,
    mappedStockSkuId: item.mappedStockSkuId ?? item.mapped_stock_sku_id ?? null,
    mappedStockSku: String(item.mappedStockSku ?? item.mapped_stock_sku ?? ""),
    issueMessage: String(item.issueMessage ?? item.issue_message ?? ""),
  };
}

function lineIdentity(line = {}) {
  const itemId = String(line.externalItemId ?? line.itemId ?? line.item_id ?? "").trim();
  const modelId = String(line.externalModelId ?? line.modelId ?? line.model_id ?? line.variationId ?? line.variation_id ?? "").trim();
  const modelSku = String(line.externalModelSku ?? line.modelSku ?? line.model_sku ?? line.sellerSku ?? line.seller_sku ?? "").trim();
  if (itemId || modelId || modelSku) return `external:${itemId}:${modelId}:${modelSku}`;
  return `line:${String(line.lineNo ?? line.line_no ?? "").trim()}`;
}

function responseData(body) { return body?.response || body?.data || body || {}; }
function responseOrderList(body) { const value = responseData(body); return value.orderList || value.order_list || value.orders || []; }
function responseOrderDetails(body) {
  const value = responseData(body);
  return value.orderList || value.order_list || value.orderDetail || value.order_detail || value.orders || (value.orderSn || value.order_sn ? [value] : []);
}
function normalizePickup(body) {
  const response = responseData(body);
  const pickup = response.pickup || response.pickupInfo || {};
  const addresses = pickup.addressList || pickup.address_list || response.addressList || response.address_list || [];
  return {
    addresses: addresses.map(address => ({
      addressId: String(address.addressId ?? address.address_id ?? ""),
      fullAddress: String(address.fullAddress ?? address.full_address ?? address.address ?? ""),
      timeSlots: (address.timeSlotList || address.time_slot_list || []).map(slot => ({
        pickupTimeId: String(slot.pickupTimeId ?? slot.pickup_time_id ?? ""),
        label: String(slot.label || slot.pickupTime || slot.pickup_time || slot.startTime || slot.start_time || ""),
        startTime: String(slot.startTime ?? slot.start_time ?? ""),
        endTime: String(slot.endTime ?? slot.end_time ?? ""),
      })),
    })),
    dropoff: pickup.dropoff || response.dropoff || null,
    infoNeeded: response.infoNeeded || response.info_needed || {},
  };
}
function eligibleForShipment(order) {
  const shippingStatus = String(order.shippingStatus || order.shipping_status || order.orderStatus || order.order_status || "").trim().toUpperCase();
  const orderStatus = String(order.orderStatus || order.order_status || "").trim().toUpperCase();
  return ["READY_TO_SHIP", "LOGISTICS_READY"].includes(shippingStatus)
    && !order.shipmentArrangedAt && !["CANCELLED", "CANCELED", "IN_CANCEL", "COMPLETED"].includes(orderStatus);
}
function normalizePackages(body, packages) {
  const response = responseData(body);
  const raw = response.result || response.results || response.packageList || response.package_list || [];
  if (!raw.length) return packages.map(item => ({ packageNumber: item.package_number, success: true }));
  return raw.map(item => ({
    packageNumber: String(item.packageNumber ?? item.package_number ?? ""),
    success: item.success !== false && !item.error && !item.errMsg && !item.err_msg,
    error: String(item.error || item.errMsg || item.err_msg || ""),
    trackingNumber: String(item.trackingNumber ?? item.tracking_number ?? item.trackingNo ?? item.tracking_no ?? ""),
  }));
}

function createSupabaseCommerceService({ client, now = () => new Date().toISOString() } = {}) {
  if (!client) throw commerceError("SUPABASE_CLIENT_INVALID", "Supabase client is required");

  async function saveRecord(recordType, identityKey, payload, { expectedRevision } = {}) {
    if (!RECORD_TYPE_SET.has(recordType)) throw commerceError("COMMERCE_RECORD_TYPE_INVALID", "Commerce record type is invalid");
    const identity = requiredText(identityKey, "Commerce record identity");
    const response = await supabaseRequest(client, "/rest/v1/rpc/upsert_commerce_record", {
      method: "POST",
      body: {
        p_record_type: recordType,
        p_identity_key: identity,
        p_payload: payload && typeof payload === "object" ? payload : {},
        p_expected_revision: expectedRevision ?? null,
      },
    });
    const record = mapCommerceRecord(Array.isArray(response) ? response[0] : response);
    if (!record || record.recordType !== recordType || record.identityKey !== identity) {
      throw commerceError("SUPABASE_COMMERCE_VERIFY_FAILED", "Supabase commerce record write could not be verified");
    }
    return record;
  }

  async function getRecord(recordType, identityKey) {
    if (!RECORD_TYPE_SET.has(recordType)) throw commerceError("COMMERCE_RECORD_TYPE_INVALID", "Commerce record type is invalid");
    const params = new URLSearchParams({
      select: "record_type,identity_key,source_key,payload,revision,created_at,updated_at",
      record_type: `eq.${recordType}`,
      identity_key: `eq.${requiredText(identityKey, "Commerce record identity")}`,
      limit: "1",
    });
    const result = rows(await supabaseRequest(client, `/rest/v1/commerce_records?${params.toString()}`));
    return mapCommerceRecord(result[0]);
  }

  async function listRecords(recordType, { limit = 500 } = {}) {
    if (!RECORD_TYPE_SET.has(recordType)) throw commerceError("COMMERCE_RECORD_TYPE_INVALID", "Commerce record type is invalid");
    const pageSize = Math.min(Math.max(Number(limit) || 500, 1), 500);
    const result = [];
    let offset = 0;
    while (true) {
      const params = new URLSearchParams({
        select: "record_type,identity_key,source_key,payload,revision,created_at,updated_at",
        record_type: `eq.${recordType}`,
        order: "identity_key.asc",
        limit: String(pageSize),
        offset: String(offset),
      });
      const page = rows(await supabaseRequest(client, `/rest/v1/commerce_records?${params.toString()}`));
      result.push(...page.map(mapCommerceRecord));
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    return result;
  }

  async function deleteRecord(recordType, identityKey) {
    if (!RECORD_TYPE_SET.has(recordType)) throw commerceError("COMMERCE_RECORD_TYPE_INVALID", "Commerce record type is invalid");
    const params = new URLSearchParams({ record_type: `eq.${recordType}`, identity_key: `eq.${requiredText(identityKey, "Commerce record identity")}` });
    const deleted = rows(await supabaseRequest(client, `/rest/v1/commerce_records?${params.toString()}`, {
      method: "DELETE",
      headers: { Prefer: "return=representation" },
    }));
    return deleted.length > 0;
  }

  async function applyCommerceMutations({ idempotencyKey, mutations } = {}) {
    const key = requiredText(idempotencyKey, "Commerce idempotency key");
    if (!Array.isArray(mutations)) throw commerceError("COMMERCE_MUTATIONS_INVALID", "Commerce mutations must be an array");
    for (const mutation of mutations) {
      if (!RECORD_TYPE_SET.has(mutation?.recordType)) throw commerceError("COMMERCE_RECORD_TYPE_INVALID", "Commerce record type is invalid");
      requiredText(mutation?.identityKey, "Commerce record identity");
      if (mutation.operation && !["upsert", "delete"].includes(mutation.operation)) throw commerceError("COMMERCE_MUTATIONS_INVALID", "Commerce mutation operation is invalid");
    }
    const response = await supabaseRequest(client, "/rest/v1/rpc/apply_commerce_mutations", {
      method: "POST",
      body: { p_idempotency_key: key, p_mutations: mutations },
    });
    const result = Array.isArray(response) ? response[0] : response;
    if (!result || typeof result !== "object" || typeof result.applied !== "boolean") {
      throw commerceError("SUPABASE_COMMERCE_VERIFY_FAILED", "Supabase commerce mutation result could not be verified");
    }
    return result;
  }

  async function createOAuthState({ returnUrl = "", ttlSeconds = 600, createdAt = now(), state = crypto.randomBytes(24).toString("hex") } = {}) {
    const expiresAt = new Date(new Date(createdAt).getTime() + Number(ttlSeconds || 600) * 1000).toISOString();
    const payload = { state, returnUrl: String(returnUrl || ""), createdAt, expiresAt, consumedAt: "" };
    await saveRecord("shopee_oauth_state", state, payload);
    return payload;
  }

  async function consumeShopeeOAuthState(state, { now: currentTime = now() } = {}) {
    const result = await supabaseRequest(client, "/rest/v1/rpc/consume_shopee_oauth_state", {
      method: "POST",
      body: { p_state: requiredText(state, "Shopee OAuth state"), p_now: currentTime },
    });
    const row = Array.isArray(result) ? result[0] : result;
    if (!row || typeof row !== "object") return null;
    return {
      state: String(row.state || state),
      returnUrl: String(row.returnUrl || ""),
      createdAt: String(row.createdAt || ""),
      expiresAt: String(row.expiresAt || ""),
      consumedAt: String(row.consumedAt || ""),
    };
  }

  async function saveShopeeConnection(input = {}, retry = 0) {
    const shopId = requiredText(input.shopId ?? input.shop_id, "Shopee shop ID");
    const previous = await getRecord("shopee_connection", shopId);
    const timestamp = input.updatedAt || now();
    const payload = {
      id: shopId,
      shopId,
      shopName: String(input.shopName ?? input.shop_name ?? previous?.payload.shopName ?? ""),
      partnerId: String(input.partnerId ?? input.partner_id ?? previous?.payload.partnerId ?? ""),
      accessToken: String(input.accessToken ?? input.access_token ?? previous?.payload.accessToken ?? ""),
      refreshToken: String(input.refreshToken ?? input.refresh_token ?? previous?.payload.refreshToken ?? ""),
      tokenExpiresAt: String(input.tokenExpiresAt ?? input.token_expires_at ?? previous?.payload.tokenExpiresAt ?? ""),
      status: String(input.status ?? previous?.payload.status ?? "connected"),
      lastSyncAt: String(input.lastSyncAt ?? input.last_sync_at ?? previous?.payload.lastSyncAt ?? ""),
      createdAt: previous?.payload.createdAt || input.createdAt || timestamp,
      updatedAt: timestamp,
    };
    try {
      const record = await saveRecord("shopee_connection", shopId, payload, { expectedRevision: previous?.revision });
      return { ...record.payload, id: shopId, shopId };
    } catch (error) {
      if (retry < 2 && isRevisionConflict(error)) return saveShopeeConnection(input, retry + 1);
      throw error;
    }
  }

  async function getShopeeConnection(connectionIdOrShopId) {
    const key = requiredText(connectionIdOrShopId, "Shopee shop ID");
    const record = await getRecord("shopee_connection", key);
    return record ? { ...record.payload, id: key, shopId: key } : null;
  }

  async function listShopeeConnections() {
    return (await listRecords("shopee_connection")).map(record => ({ ...record.payload, id: record.identityKey, shopId: record.identityKey }));
  }

  async function updateShopeeTokens(connectionIdOrShopId, tokens = {}) {
    const connection = await getShopeeConnection(connectionIdOrShopId);
    if (!connection) return null;
    return saveShopeeConnection({
      ...connection,
      accessToken: tokens.accessToken ?? tokens.access_token ?? "",
      refreshToken: tokens.refreshToken ?? tokens.refresh_token ?? "",
      tokenExpiresAt: tokens.tokenExpiresAt ?? tokens.token_expires_at ?? "",
      status: "connected",
      updatedAt: tokens.updatedAt || now(),
    });
  }

  async function markShopeeSynced(connectionIdOrShopId, timestamp = now()) {
    const connection = await getShopeeConnection(connectionIdOrShopId);
    if (!connection) return null;
    return saveShopeeConnection({ ...connection, lastSyncAt: timestamp, updatedAt: timestamp });
  }

  async function syncShopeeOrders({ connectionId, client: shopeeClient, now: getNow = now, pageSize = 100 } = {}) {
    if (!connectionId || !shopeeClient?.request) throw commerceError("SHOPEE_SYNC_INPUT_INVALID", "Shopee sync requires a connection and client");
    const connection = await getShopeeConnection(connectionId);
    if (!connection) throw commerceError("SHOPEE_CONNECTION_NOT_FOUND", "Shopee connection was not found");
    const startedAt = getNow();
    const idempotencyKey = `shopee-sync:${connection.shopId}:${startedAt}`;
    const claimed = await claimShipmentAction({ idempotencyKey, actionType: "shopee_sync", payload: { shopId: connection.shopId, startedAt } });
    if (!claimed.claimed) return claimed.action.result || { syncRun: { id: idempotencyKey, status: claimed.action.status }, imported: 0, updated: 0, failed: 0 };
    const runId = crypto.randomUUID();
    const run = { id: runId, shopId: connection.shopId, startedAt, finishedAt: "", cursor: "", ordersFound: 0, ordersUpserted: 0, ordersFailed: 0, status: "running", errorMessage: "" };
    await saveRecord("shopee_sync_run", runId, run);
    let imported = 0;
    let updated = 0;
    let failed = 0;
    let cursor = "";
    try {
      const refresh = async () => {
        const refreshed = await shopeeClient.refreshAccessToken({ shopId: connection.shopId, refreshToken: connection.refreshToken });
        await updateShopeeTokens(connection.shopId, {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          tokenExpiresAt: new Date(Date.now() + Number(refreshed.expireIn || 0) * 1000).toISOString(),
        });
        return refreshed.accessToken;
      };
      const startedUnix = Math.floor(new Date(connection.lastSyncAt || startedAt).getTime() / 1000);
      const summariesByOrder = new Map();
      for (let page = 0; page < 100; page += 1) {
        const listBody = await shopeeClient.request({
          path: "/api/v2/order/get_order_list",
          accessToken: connection.accessToken,
          shopId: connection.shopId,
          query: {
            time_range_field: "update_time",
            time_from: startedUnix - 60,
            time_to: Math.floor(new Date(startedAt).getTime() / 1000) + 60,
            page_size: pageSize,
            ...(cursor ? { cursor } : {}),
          },
          refresh,
        });
        const response = responseData(listBody);
        for (const row of responseOrderList(listBody)) {
          const orderSn = row.orderSn || row.order_sn;
          if (orderSn) summariesByOrder.set(String(orderSn), { orderSn: String(orderSn) });
        }
        const nextCursor = String(response.nextCursor || response.next_cursor || "");
        const more = response.more ?? response.hasMore ?? response.has_more ?? Boolean(nextCursor);
        if (!more) { cursor = nextCursor; break; }
        if (!nextCursor || nextCursor === cursor) {
          throw commerceError("SHOPEE_SYNC_CURSOR_INVALID", "Shopee order pagination indicated more results without a new cursor");
        }
        cursor = nextCursor;
        if (page === 99) throw commerceError("SHOPEE_SYNC_PAGE_LIMIT", "Shopee order sync exceeded the pagination safety limit");
      }
      const summaries = [...summariesByOrder.values()];
      for (const summary of summaries) {
        try {
          const detailBody = await shopeeClient.request({
            path: "/api/v2/order/get_order_detail",
            accessToken: connection.accessToken,
            shopId: connection.shopId,
            query: { order_sn_list: summary.orderSn },
            refresh,
          });
          for (const detail of responseOrderDetails(detailBody)) {
            const saved = await upsertShopeeOrder({ ...detail, shopId: connection.shopId, orderSn: detail.orderSn || detail.order_sn || summary.orderSn });
            if (saved.created) imported += 1;
            else updated += 1;
          }
        } catch (error) {
          failed += 1;
        }
      }
      const finishedAt = getNow();
      const finalRun = { ...run, finishedAt, cursor, ordersFound: summaries.length, ordersUpserted: imported + updated, ordersFailed: failed, status: failed ? "partial" : "succeeded" };
      await saveRecord("shopee_sync_run", runId, finalRun);
      await markShopeeSynced(connection.shopId, finishedAt);
      const result = { syncRun: { id: runId, status: finalRun.status, cursor }, imported, updated, failed };
      await completeShipmentAction(idempotencyKey, "succeeded", result);
      return result;
    } catch (error) {
      const finishedAt = getNow();
      await saveRecord("shopee_sync_run", runId, { ...run, finishedAt, status: "failed", errorMessage: String(error?.message || "") });
      await completeShipmentAction(idempotencyKey, "failed", { code: error?.code || "SHOPEE_SYNC_FAILED" });
      throw error;
    }
  }

  async function upsertShopeeOrder(input = {}, retry = 0) {
    const shopId = requiredText(input.shopId ?? input.shop_id, "Shopee shop ID");
    const orderSn = requiredText(input.orderSn ?? input.order_sn ?? input.orderNo ?? input.order_no, "Shopee order number");
    const identityKey = `${shopId}:${orderSn}`;
    const previous = await getRecord("platform_order", identityKey);
    const timestamp = input.lastSyncedAt || now();
    const existing = previous?.payload || {};
    const linesInput = input.lines || input.items || input.itemList || input.item_list || existing.lines || [];
    const existingLines = new Map((existing.lines || []).map(line => [lineIdentity(line), line]));
    const lines = linesInput.map((line, index) => {
      const normalized = normalizeShopeeLine(line, index);
      const prior = existingLines.get(lineIdentity(normalized));
      const hasExplicitMapping = line.mappedStockSkuId !== undefined || line.mapped_stock_sku_id !== undefined;
      const preserveMapping = prior?.mappingStatus === "mapped" && !hasExplicitMapping;
      return {
        ...normalized,
        ...(preserveMapping ? {
          mappingStatus: prior.mappingStatus,
          mappingSource: prior.mappingSource,
          mappedSaleSkuId: prior.mappedSaleSkuId,
          mappedStockSkuId: prior.mappedStockSkuId,
          mappedStockSku: prior.mappedStockSku,
          issueMessage: prior.issueMessage,
        } : {}),
        id: String(prior?.id || line.id || `${identityKey}:${normalized.lineNo}`),
      };
    });
    const payload = {
      ...existing,
      ...input,
      id: identityKey,
      shopId,
      orderNo: orderSn,
      externalOrderId: orderSn,
      orderSn,
      orderDate: String(input.orderDate ?? input.order_date ?? existing.orderDate ?? ""),
      orderStatus: String(input.orderStatus ?? input.order_status ?? existing.orderStatus ?? ""),
      shippingStatus: String(input.shippingStatus ?? input.shipping_status ?? input.orderStatus ?? input.order_status ?? existing.shippingStatus ?? ""),
      buyerName: String(input.buyerName ?? input.buyer_name ?? input.recipientAddress?.name ?? input.recipient_address?.name ?? existing.buyerName ?? ""),
      trackingNumber: String(input.trackingNumber ?? input.tracking_number ?? existing.trackingNumber ?? ""),
      shippingCarrier: String(input.shippingCarrier ?? input.shipping_carrier ?? input.logisticsChannel ?? input.logistics_channel ?? existing.shippingCarrier ?? ""),
      logisticsChannelId: String(input.logisticsChannelId ?? input.logistics_channel_id ?? existing.logisticsChannelId ?? ""),
      productLocationId: String(input.productLocationId ?? input.product_location_id ?? existing.productLocationId ?? ""),
      packageNumber: String(input.packageNumber ?? input.package_number ?? existing.packageNumber ?? ""),
      shipmentArrangedAt: String(input.shipmentArrangedAt ?? input.shipment_arranged_at ?? existing.shipmentArrangedAt ?? ""),
      externalUpdatedAt: String(input.externalUpdatedAt ?? input.external_updated_at ?? input.updateTime ?? input.update_time ?? existing.externalUpdatedAt ?? ""),
      lastSyncedAt: timestamp,
      createdAt: existing.createdAt || input.createdAt || timestamp,
      lines,
    };
    try {
      const record = await saveRecord("platform_order", identityKey, payload, { expectedRevision: previous?.revision });
      return { created: !previous, order: record.payload, lines: record.payload.lines };
    } catch (error) {
      if (retry < 2 && isRevisionConflict(error)) return upsertShopeeOrder(input, retry + 1);
      throw error;
    }
  }

  async function getShopeeOrder({ shopId, orderSn, orderNo } = {}) {
    const identityKey = `${requiredText(shopId, "Shopee shop ID")}:${requiredText(orderSn ?? orderNo, "Shopee order number")}`;
    const record = await getRecord("platform_order", identityKey);
    return record ? { order: record.payload, lines: record.payload.lines || [] } : null;
  }

  async function listShopeeOrders(filters = {}) {
    const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
    const records = await listRecords("platform_order", { limit });
    const shopId = String(filters.shopId ?? filters.shop_id ?? "").trim();
    const status = String(filters.status || "").trim().toUpperCase();
    return records.map(record => record.payload)
      .filter(order => (!shopId || order.shopId === shopId)
        && (!status || String(order.shippingStatus || "").toUpperCase() === status || String(order.orderStatus || "").toUpperCase() === status))
      .sort((a, b) => String(b.externalUpdatedAt || "").localeCompare(String(a.externalUpdatedAt || "")))
      .slice(0, limit)
      .map(order => ({ ...order, mappingStatus: order.lines?.length && order.lines.every(line => line.mappingStatus === "mapped") ? "mapped" : "mapping_required" }));
  }

  async function saveShopeeOrderLineMapping({ lineId, shopId, orderSn, orderNo, lineNo, stockSkuId, stockSku } = {}, retry = 0) {
    let orderRecord;
    let key;
    let lineKey = String(lineId ?? "");
    if (lineKey) {
      const records = await listRecords("platform_order", { limit: 500 });
      orderRecord = records.find(record => (record.payload.lines || []).some(line => String(line.id) === lineKey));
      key = orderRecord?.identityKey;
      lineKey = String(orderRecord?.payload.lines?.find(line => String(line.id) === String(lineId))?.lineNo || "");
    } else {
      key = `${requiredText(shopId, "Shopee shop ID")}:${requiredText(orderSn ?? orderNo, "Shopee order number")}`;
      lineKey = requiredText(lineNo, "Shopee order line number");
      orderRecord = await getRecord("platform_order", key);
    }
    if (!orderRecord) throw commerceError("COMMERCE_ORDER_NOT_FOUND", "Shopee order was not found");
    const lines = [...(orderRecord.payload.lines || [])];
    const index = lines.findIndex(line => String(line.lineNo) === lineKey && (!lineId || String(line.id) === String(lineId)));
    if (index < 0) throw commerceError("COMMERCE_ORDER_LINE_NOT_FOUND", "Shopee order line was not found");
    const rawId = stockSkuId === null || stockSkuId === "" || stockSkuId === undefined ? null : Number(stockSkuId);
    if (rawId !== null && (!Number.isSafeInteger(rawId) || rawId <= 0)) throw commerceError("COMMERCE_STOCK_SKU_INVALID", "Stock SKU ID is invalid");
    lines[index] = {
      ...lines[index],
      mappedStockSkuId: rawId,
      mappedStockSku: String(stockSku || ""),
      mappingStatus: rawId === null ? "unmapped" : "mapped",
      mappingSource: rawId === null ? "" : "manual",
      issueMessage: rawId === null ? "" : "",
    };
    const payload = { ...orderRecord.payload, lines, updatedAt: now() };
    try {
      const updated = await saveRecord("platform_order", key, payload, { expectedRevision: orderRecord.revision });
      return updated.payload.lines[index];
    } catch (error) {
      if (retry < 2 && isRevisionConflict(error)) return saveShopeeOrderLineMapping({ lineId, shopId, orderSn, orderNo, lineNo, stockSkuId, stockSku }, retry + 1);
      throw error;
    }
  }

  async function savePlatformOrderImport(input = {}) {
    const importNo = requiredText(input.importNo ?? input.import_no, "Platform order import number");
    const timestamp = input.updatedAt || now();
    const previous = await getRecord("platform_order_import", importNo);
    const payload = {
      ...previous?.payload,
      ...input,
      id: importNo,
      importNo,
      platform: String(input.platform || previous?.payload.platform || "manual"),
      fileName: String(input.fileName ?? input.file_name ?? previous?.payload.fileName ?? ""),
      status: String(input.status || previous?.payload.status || "imported"),
      orders: input.orders ?? previous?.payload.orders ?? [],
      lines: input.lines ?? previous?.payload.lines ?? [],
      createdAt: previous?.payload.createdAt || input.createdAt || timestamp,
      updatedAt: timestamp,
    };
    if (Array.isArray(payload.lines) && payload.lines.some(line => line.orderLineKey)) {
      const result = await supabaseRequest(client, "/rest/v1/rpc/save_platform_order_import", {
        method: "POST",
        body: { p_import_no: importNo, p_payload: payload },
      });
      const row = Array.isArray(result) ? result[0] : result;
      if (!row || row.identity_key !== importNo || row.record_type !== "platform_order_import") {
        throw commerceError("SUPABASE_COMMERCE_VERIFY_FAILED", "Supabase platform import write could not be verified");
      }
      return row.payload;
    }
    const record = await saveRecord("platform_order_import", importNo, payload, { expectedRevision: previous?.revision });
    return record.payload;
  }

  async function getPlatformOrderImport(importNo) {
    const record = await getRecord("platform_order_import", requiredText(importNo, "Platform order import number"));
    return record?.payload || null;
  }

  async function listPlatformOrderImports({ limit = 100 } = {}) {
    return (await listRecords("platform_order_import", { limit })).map(record => record.payload)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }

  async function postPlatformOrderImport(importNo, { postedAt = now(), movementRecords = [], orderLineKeys = [], importPatch = {}, idempotencyKey = `import-post:${importNo}` } = {}) {
    const current = await getPlatformOrderImport(importNo);
    if (!current) throw commerceError("COMMERCE_IMPORT_NOT_FOUND", "Platform order import was not found");
    if (current.status === "posted") return { ...current, postedMovements: current.postedMovements || [] };
    if (current.status !== "ready") throw commerceError("COMMERCE_IMPORT_NOT_READY", "Platform order import is not ready to post");
    const result = await supabaseRequest(client, "/rest/v1/rpc/post_platform_order_import", {
      method: "POST",
      body: {
        p_idempotency_key: idempotencyKey,
        p_import_no: importNo,
        p_posted_at: postedAt,
        p_movement_records: movementRecords,
        p_order_line_keys: orderLineKeys,
        p_import_patch: importPatch,
      },
    });
    const row = Array.isArray(result) ? result[0] : result;
    if (!row || row.applied !== true || !row.import) throw commerceError("SUPABASE_COMMERCE_VERIFY_FAILED", "Supabase platform import posting could not be verified");
    return { ...row.import, postedMovements: Array.isArray(row.movements) ? row.movements : [] };
  }

  async function saveShipmentBatch(input = {}, retry = 0) {
    const identityKey = requiredText(input.id ?? input.batchId, "Shipment batch ID");
    const previous = await getRecord("shipment_batch", identityKey);
    const timestamp = input.updatedAt || now();
    const payload = { ...previous?.payload, ...input, id: identityKey, orders: input.orders ?? previous?.payload.orders ?? [], actions: input.actions ?? previous?.payload.actions ?? [], createdAt: previous?.payload.createdAt || input.createdAt || timestamp, updatedAt: timestamp };
    try {
      const record = await saveRecord("shipment_batch", identityKey, payload, { expectedRevision: previous?.revision });
      return record.payload;
    } catch (error) {
      if (retry < 2 && isRevisionConflict(error)) return saveShipmentBatch(input, retry + 1);
      throw error;
    }
  }

  async function getShipmentBatch(batchId) {
    return (await getRecord("shipment_batch", requiredText(batchId, "Shipment batch ID")))?.payload || null;
  }

  async function listShipmentBatches({ shopId, limit = 100 } = {}) {
    return (await listRecords("shipment_batch", { limit })).map(record => record.payload)
      .filter(batch => !shopId || String(batch.shopId) === String(shopId))
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }

  async function prepareShipmentBatch({ orderIds = [], client: shopeeClient } = {}) {
    if (!shopeeClient?.request || !Array.isArray(orderIds) || !orderIds.length) throw commerceError("SHIPMENT_PREPARE_INPUT_INVALID", "Select orders before preparing a shipment");
    const selected = new Set(orderIds.map(String));
    const orders = (await listShopeeOrders({ limit: 500 })).filter(order => selected.has(String(order.id)));
    const groups = groupEligibleShopeePackages(orders.filter(eligibleForShipment));
    if (!groups.length) throw commerceError("SHIPMENT_ORDERS_NOT_READY", "No eligible orders are selected");
    const idempotencyKey = `shipment-prepare:${[...selected].sort().join(",")}`;
    const claimed = await claimShipmentAction({ idempotencyKey, actionType: "shipment_prepare", payload: { orderIds: [...selected].sort() } });
    if (!claimed.claimed) return claimed.action.result || { batches: [] };
    const batches = [];
    try {
      for (const group of groups) {
        const firstOrder = group.orders[0];
        const batchId = crypto.randomUUID();
        const timestamp = now();
        const batchOrders = group.orders.map(order => ({
          id: `${batchId}:${order.id}`,
          platformOrderId: order.id,
          orderNo: order.orderNo,
          externalOrderId: order.externalOrderId || order.orderNo,
          shopId: order.shopId,
          packageNumber: order.packageNumber || "",
          status: "pending",
          errorMessage: "",
          trackingNumber: order.trackingNumber || "",
          orderStatus: order.orderStatus || "",
          shippingStatus: order.shippingStatus || "",
          createdAt: timestamp,
          updatedAt: timestamp,
        }));
        const batch = {
          id: batchId,
          shopId: firstOrder.shopId,
          logisticsChannelId: group.logisticsChannelId,
          productLocationId: group.productLocationId,
          pickupAddressId: "",
          pickupTimeId: "",
          status: "prepared",
          orders: batchOrders,
          actions: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const packageList = group.orders.map(order => ({ order_sn: order.externalOrderId || order.orderNo, package_number: order.packageNumber || "" }));
        const params = await shopeeClient.request({
          path: "/api/v2/logistics/get_mass_shipping_parameter",
          method: "POST",
          shopId: batch.shopId,
          body: { package_list: packageList },
        });
        const pickup = normalizePickup(params);
        batch.actions.push({ idempotencyKey: `shipping_parameters:${batchId}`, actionType: "shipping_parameters", status: "succeeded", payload: { packageList }, createdAt: timestamp, updatedAt: timestamp });
        const saved = await saveShipmentBatch(batch);
        batches.push({ ...saved, pickup });
      }
      await completeShipmentAction(idempotencyKey, "succeeded", { batches });
      return { batches };
    } catch (error) {
      await completeShipmentAction(idempotencyKey, "failed", { code: error?.code || "SHIPMENT_PREPARE_FAILED" });
      throw error;
    }
  }

  async function arrangeShipmentBatch(batchId, selection = {}, { client: shopeeClient } = {}) {
    if (!shopeeClient?.request) throw commerceError("SHIPMENT_CLIENT_REQUIRED", "Shopee client is required");
    const batch = await getShipmentBatch(batchId);
    if (!batch) throw commerceError("SHIPMENT_BATCH_NOT_FOUND", "Shipment batch was not found");
    const pending = (batch.orders || []).filter(order => !["arranged", "ready_to_print"].includes(order.status));
    if (!pending.length) return { batch: { ...batch, status: "arranged" }, orders: batch.orders, skipped: true };
    const packageList = pending.map(order => ({ order_sn: order.externalOrderId || order.orderNo, package_number: order.packageNumber }));
    const actionKey = `arrange_shipment:${batch.id}:${packageList.map(item => item.package_number).sort().join(",")}`;
    const claimed = await claimShipmentAction({ idempotencyKey: actionKey, actionType: "arrange_shipment", payload: { packageList, selection } });
    if (!claimed.claimed) return claimed.action.result || { batch, orders: batch.orders, skipped: true };
    try {
      const timestamp = now();
      const arranged = { ...batch, status: "arranging", pickupAddressId: String(selection.addressId || ""), pickupTimeId: String(selection.pickupTimeId || ""), updatedAt: timestamp };
      const response = await shopeeClient.request({
        path: "/api/v2/logistics/mass_ship_order",
        method: "POST",
        shopId: batch.shopId,
        body: { package_list: packageList, pickup: { address_id: selection.addressId, pickup_time_id: selection.pickupTimeId } },
      });
      const results = normalizePackages(response, packageList);
      const byPackage = new Map(results.map(result => [result.packageNumber, result]));
      arranged.orders = await Promise.all((batch.orders || []).map(async order => {
        if (!pending.some(item => item.id === order.id)) return order;
        const result = byPackage.get(order.packageNumber) || { success: false, error: "Shopee did not return this package result" };
        const updated = { ...order, status: result.success ? "arranged" : "failed", errorMessage: result.error || "", updatedAt: timestamp };
        if (result.success) await updateShopeeOrderState(order.platformOrderId, { shipmentArrangedAt: timestamp, shippingStatus: "ARRANGED" });
        return updated;
      }));
      const hasFailed = arranged.orders.some(order => order.status === "failed");
      const allArranged = arranged.orders.every(order => ["arranged", "ready_to_print"].includes(order.status));
      arranged.status = allArranged ? "arranged" : hasFailed ? "partially_failed" : "arranging";
      const saved = await saveShipmentBatch(arranged);
      const result = { batch: saved, orders: saved.orders, skipped: false };
      await completeShipmentAction(actionKey, "succeeded", result);
      return result;
    } catch (error) {
      await completeShipmentAction(actionKey, "failed", { code: error?.code || "SHIPMENT_ARRANGE_FAILED" });
      throw error;
    }
  }

  async function updateShopeeOrderState(orderIdentity, patch) {
    const record = await getRecord("platform_order", orderIdentity);
    if (!record) return null;
    const payload = { ...record.payload, ...patch, updatedAt: now() };
    return saveRecord("platform_order", orderIdentity, payload, { expectedRevision: record.revision });
  }

  async function refreshBatchTracking(batchId, { client: shopeeClient } = {}) {
    if (!shopeeClient?.request) throw commerceError("SHIPMENT_CLIENT_REQUIRED", "Shopee client is required");
    const batch = await getShipmentBatch(batchId);
    if (!batch) throw commerceError("SHIPMENT_BATCH_NOT_FOUND", "Shipment batch was not found");
    const orders = batch.orders || [];
    const packageList = orders.filter(order => order.status !== "failed").map(order => ({ order_sn: order.externalOrderId || order.orderNo, package_number: order.packageNumber }));
    const timestamp = now();
    const actionKey = `tracking_refresh:${batch.id}:${timestamp}`;
    const claimed = await claimShipmentAction({ idempotencyKey: actionKey, actionType: "tracking_refresh", payload: { packageList } });
    if (!claimed.claimed) return claimed.action.result || { batch, orders, skipped: true };
    try {
      const response = await shopeeClient.request({ path: "/api/v2/logistics/get_mass_tracking_number", method: "POST", shopId: batch.shopId, body: { package_list: packageList } });
      const byPackage = new Map(normalizePackages(response, packageList).map(result => [result.packageNumber, result.trackingNumber || ""]));
      const refreshedOrders = await Promise.all(orders.map(async order => {
        if (order.status === "failed") return order;
        const trackingNumber = byPackage.get(order.packageNumber) || order.trackingNumber || "";
        const status = trackingNumber ? "documents_pending" : "tracking_pending";
        const updated = { ...order, status, trackingNumber, updatedAt: timestamp };
        if (trackingNumber) await updateShopeeOrderState(order.platformOrderId, { trackingNumber, shippingStatus: "SHIPPED" });
        return updated;
      }));
      const allTracked = refreshedOrders.filter(order => order.status !== "failed").every(order => Boolean(order.trackingNumber));
      const saved = await saveShipmentBatch({ ...batch, orders: refreshedOrders, status: allTracked ? "documents_pending" : "tracking_pending", updatedAt: timestamp });
      const result = { batch: saved, orders: saved.orders };
      await completeShipmentAction(actionKey, "succeeded", result);
      return result;
    } catch (error) {
      await completeShipmentAction(actionKey, "failed", { code: error?.code || "TRACKING_REFRESH_FAILED" });
      throw error;
    }
  }

  async function createShippingDocumentJob(batchId, { client: shopeeClient } = {}) {
    if (!shopeeClient?.request) throw commerceError("SHIPMENT_CLIENT_REQUIRED", "Shopee client is required");
    const batch = await getShipmentBatch(batchId);
    if (!batch) throw commerceError("SHIPMENT_BATCH_NOT_FOUND", "Shipment batch was not found");
    const orders = batch.orders || [];
    if (!orders.length || orders.some(order => !order.trackingNumber)) throw commerceError("SHIPMENT_TRACKING_INCOMPLETE", "Tracking numbers are required for every package");
    const activeJobs = (await listRecords("shipping_document_job", { limit: 500 })).map(record => record.payload)
      .filter(job => String(job.batchId) === String(batch.id) && ["created", "processing", "ready"].includes(job.status))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    if (activeJobs[0]) return activeJobs[0];
    const actionKey = `document_create:${batch.id}`;
    const claimed = await claimShipmentAction({ idempotencyKey: actionKey, actionType: "document_create", payload: { batchId: batch.id } });
    if (!claimed.claimed) return claimed.action.result?.job || claimed.action.result || null;
    try {
      const packageList = orders.map(order => ({ order_sn: order.externalOrderId || order.orderNo, package_number: order.packageNumber, tracking_number: order.trackingNumber }));
      const response = await shopeeClient.request({ path: "/api/v2/logistics/create_shipping_document_job", method: "POST", shopId: batch.shopId, body: { package_list: packageList, document_type: "WAYBILL" } });
      const value = responseData(response);
      const shopeeJobId = String(value.jobId || value.job_id || value.taskId || value.task_id || value.result?.jobId || value.result?.job_id || "");
      if (!shopeeJobId) throw commerceError("SHIPPING_DOCUMENT_JOB_ID_MISSING", "Shopee did not return a shipping document job ID");
      const timestamp = now();
      const job = await saveShippingDocumentJob({ id: `${batch.id}:${shopeeJobId}`, batchId: batch.id, shopeeJobId, documentType: "WAYBILL", status: "created", objectPath: "", createdAt: timestamp, updatedAt: timestamp });
      const updatedBatch = await saveShipmentBatch({ ...batch, status: "documents_pending", updatedAt: timestamp });
      const result = { job, batch: updatedBatch };
      await completeShipmentAction(actionKey, "succeeded", result);
      return job;
    } catch (error) {
      await completeShipmentAction(actionKey, "failed", { code: error?.code || "SHIPPING_DOCUMENT_CREATE_FAILED" });
      throw error;
    }
  }

  async function getShippingDocumentJob(jobId) { return (await getRecord("shipping_document_job", requiredText(jobId, "Shipping document job ID")))?.payload || null; }

  async function getReadyShippingDocumentJob(batchId) {
    return (await listRecords("shipping_document_job", { limit: 500 })).map(record => record.payload)
      .filter(job => String(job.batchId) === String(batchId) && job.status === "ready" && job.objectPath)
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0] || null;
  }

  async function pollShippingDocumentJob(jobId, { client: shopeeClient, saveArtifact } = {}) {
    if (!shopeeClient?.request) throw commerceError("SHIPMENT_CLIENT_REQUIRED", "Shopee client is required");
    const job = await getShippingDocumentJob(jobId);
    if (!job) throw commerceError("SHIPPING_DOCUMENT_JOB_NOT_FOUND", "Shipping document job was not found");
    if (job.status === "ready" && job.objectPath) return job;
    const batch = await getShipmentBatch(job.batchId);
    if (!batch) throw commerceError("SHIPMENT_BATCH_NOT_FOUND", "Shipment batch was not found");
    const timestamp = now();
    const actionKey = `document_poll:${job.id}:${timestamp}`;
    const claimed = await claimShipmentAction({ idempotencyKey: actionKey, actionType: "shipping_document_poll", payload: { jobId: job.id } });
    if (!claimed.claimed) return claimed.action.result?.job || job;
    try {
      const statusResponse = await shopeeClient.request({ path: "/api/v2/logistics/get_shipping_document_job_status", method: "POST", shopId: batch.shopId, body: { job_id: job.shopeeJobId } });
      const value = responseData(statusResponse);
      const status = String(value.status || value.jobStatus || value.job_status || value.result?.status || "").toUpperCase();
      if (!["READY", "SUCCESS", "COMPLETED", "DONE"].includes(status)) {
        const nextStatus = ["FAILED", "ERROR"].includes(status) ? "failed" : "processing";
        const updated = await saveShippingDocumentJob({ ...job, status: nextStatus, updatedAt: timestamp });
        await completeShipmentAction(actionKey, "succeeded", { job: updated });
        return updated;
      }
      const downloadResponse = await shopeeClient.request({ path: "/api/v2/logistics/download_shipping_document_job", method: "POST", shopId: batch.shopId, body: { job_id: job.shopeeJobId } });
      const downloadValue = responseData(downloadResponse);
      const encoded = downloadValue.fileBase64 || downloadValue.file_base64 || downloadValue.file || downloadValue.dataBase64 || downloadValue.data_base64 || "";
      if (!encoded) throw commerceError("SHIPPING_DOCUMENT_BODY_MISSING", "Shopee did not return a shipping document");
      const content = Buffer.from(encoded, "base64");
      if (!content.length) throw commerceError("SHIPPING_DOCUMENT_BODY_MISSING", "Shopee returned an empty shipping document");
      if (typeof saveArtifact !== "function") throw commerceError("SHIPPING_DOCUMENT_STORAGE_UNAVAILABLE", "Shipping document storage is unavailable");
      const objectPath = await saveArtifact({ jobId: job.id, content, contentType: "application/pdf" });
      const updated = await saveShippingDocumentJob({ ...job, status: "ready", objectPath, updatedAt: timestamp });
      await saveShipmentBatch({ ...batch, status: "ready_to_print", updatedAt: timestamp });
      await completeShipmentAction(actionKey, "succeeded", { job: updated });
      return updated;
    } catch (error) {
      await completeShipmentAction(actionKey, "failed", { code: error?.code || "SHIPPING_DOCUMENT_POLL_FAILED" });
      throw error;
    }
  }

  async function claimShipmentAction({ idempotencyKey, actionType, payload = {} } = {}) {
    const key = requiredText(idempotencyKey, "Shipment action idempotency key");
    if (!SHIPMENT_ACTION_TYPES.has(actionType)) throw commerceError("COMMERCE_ACTION_TYPE_INVALID", "Shipment action type is invalid");
    const response = await supabaseRequest(client, "/rest/v1/rpc/claim_commerce_action", {
      method: "POST",
      body: { p_idempotency_key: key, p_action_type: actionType, p_payload: payload },
    });
    const result = Array.isArray(response) ? response[0] : response;
    if (!result || typeof result.claimed !== "boolean" || !result.action) throw commerceError("SUPABASE_COMMERCE_VERIFY_FAILED", "Supabase action claim could not be verified");
    if (!result.claimed && result.action.status === "running") {
      throw commerceError("COMMERCE_ACTION_IN_PROGRESS", "This Shopee action is already running");
    }
    if (!result.claimed && result.action.status === "failed") {
      throw commerceError("COMMERCE_ACTION_FAILED", "The previous Shopee action failed; review its result before retrying");
    }
    return result;
  }

  async function completeShipmentAction(idempotencyKey, status, result = {}) {
    const key = requiredText(idempotencyKey, "Shipment action idempotency key");
    if (!["succeeded", "failed"].includes(status)) throw commerceError("COMMERCE_ACTION_STATUS_INVALID", "Shipment action status is invalid");
    const response = await supabaseRequest(client, "/rest/v1/rpc/complete_commerce_action", {
      method: "POST",
      body: { p_idempotency_key: key, p_status: status, p_result: result },
    });
    const row = Array.isArray(response) ? response[0] : response;
    if (!row || row.idempotency_key !== key || row.status !== status) throw commerceError("SUPABASE_COMMERCE_VERIFY_FAILED", "Supabase action completion could not be verified");
    return row;
  }

  async function saveShippingDocumentJob(input = {}) {
    const identityKey = requiredText(input.id ?? input.jobId, "Shipping document job ID");
    const previous = await getRecord("shipping_document_job", identityKey);
    const timestamp = input.updatedAt || now();
    const payload = { ...previous?.payload, ...input, id: identityKey, createdAt: previous?.payload.createdAt || input.createdAt || timestamp, updatedAt: timestamp };
    return (await saveRecord("shipping_document_job", identityKey, payload, { expectedRevision: previous?.revision })).payload;
  }

  async function saveCustomLabelJob(input = {}) {
    const identityKey = requiredText(input.id ?? input.jobId, "Custom label job ID");
    const previous = await getRecord("custom_label_job", identityKey);
    const timestamp = input.updatedAt || now();
    const payload = { ...previous?.payload, ...input, id: identityKey, createdAt: previous?.payload.createdAt || input.createdAt || timestamp, updatedAt: timestamp };
    return (await saveRecord("custom_label_job", identityKey, payload, { expectedRevision: previous?.revision })).payload;
  }

  async function getCustomLabelJob(jobId) {
    return (await getRecord("custom_label_job", requiredText(jobId, "Custom label job ID")))?.payload || null;
  }

  async function listCustomLabelJobs({ limit = 100 } = {}) {
    return (await listRecords("custom_label_job", { limit })).map(record => record.payload)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }

  return Object.freeze({
    applyCommerceMutations,
    arrangeShipmentBatch,
    claimShipmentAction,
    completeShipmentAction,
    consumeShopeeOAuthState,
    createOAuthState,
    createShippingDocumentJob,
    deleteRecord,
    getCustomLabelJob,
    getPlatformOrderImport,
    getRecord,
    getReadyShippingDocumentJob,
    getShipmentBatch,
    getShippingDocumentJob,
    getShopeeConnection,
    getShopeeOrder,
    listCustomLabelJobs,
    listPlatformOrderImports,
    listRecords,
    listShipmentBatches,
    listShopeeConnections,
    listShopeeOrders,
    markShopeeSynced,
    postPlatformOrderImport,
    pollShippingDocumentJob,
    prepareShipmentBatch,
    refreshBatchTracking,
    saveCustomLabelJob,
    savePlatformOrderImport,
    saveRecord,
    saveShipmentBatch,
    saveShippingDocumentJob,
    saveShopeeConnection,
    saveShopeeOrderLineMapping,
    syncShopeeOrders,
    updateShopeeTokens,
    upsertShopeeOrder,
  });
}

module.exports = { COMMERCE_RECORD_TYPES, createSupabaseCommerceService, mapCommerceRecord, normalizeShopeeLine };
