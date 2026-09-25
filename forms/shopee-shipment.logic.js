const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { ensureInventorySchema, openInventoryDatabase } = require("./inventory-db.logic.js");

function nowIso(options = {}) {
  return options.now ? options.now() : new Date().toISOString();
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function bodyData(body) {
  return body?.response || body?.data || body || {};
}

function isEligible(order) {
  const status = cleanText(order.shippingStatus || order.shipping_status || order.orderStatus || order.order_status).toUpperCase();
  const orderStatus = cleanText(order.orderStatus || order.order_status).toUpperCase();
  return (status === "READY_TO_SHIP" || status === "LOGISTICS_READY" || orderStatus === "READY_TO_SHIP")
    && !order.shipmentArrangedAt
    && !["CANCELLED", "CANCELED", "IN_CANCEL", "COMPLETED"].includes(orderStatus);
}

function orderGroupFields(order) {
  return {
    logisticsChannelId: cleanText(order.logisticsChannelId || order.logistics_channel_id),
    productLocationId: cleanText(order.productLocationId || order.product_location_id),
  };
}

function groupEligibleShopeePackages(orders = []) {
  const groups = new Map();
  for (const order of orders) {
    if (!isEligible(order)) continue;
    const fields = orderGroupFields(order);
    const key = `${fields.logisticsChannelId}::${fields.productLocationId}`;
    if (!groups.has(key)) groups.set(key, { key, ...fields, orders: [] });
    groups.get(key).orders.push({ ...order, ...fields });
  }
  return [...groups.values()]
    .map((group) => ({ ...group, orders: group.orders.sort((a, b) => Number(a.id) - Number(b.id)) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function normalizePickup(body) {
  const response = bodyData(body);
  const pickup = response.pickup || response.pickupInfo || {};
  const addresses = pickup.addressList || pickup.address_list || response.addressList || response.address_list || [];
  return {
    addresses: addresses.map((address) => ({
      addressId: cleanText(address.addressId ?? address.address_id),
      fullAddress: cleanText(address.fullAddress ?? address.full_address ?? address.address),
      timeSlots: (address.timeSlotList || address.time_slot_list || []).map((slot) => ({
        pickupTimeId: cleanText(slot.pickupTimeId ?? slot.pickup_time_id),
        label: cleanText(slot.label || slot.pickupTime || slot.pickup_time || slot.startTime || slot.start_time),
        startTime: cleanText(slot.startTime ?? slot.start_time),
        endTime: cleanText(slot.endTime ?? slot.end_time),
      })),
    })),
    dropoff: pickup.dropoff || response.dropoff || null,
    infoNeeded: response.infoNeeded || response.info_needed || {},
  };
}

function mapBatch(row, orders = []) {
  return {
    id: row.id,
    shopId: row.shop_id,
    logisticsChannelId: row.logistics_channel_id,
    productLocationId: row.product_location_id,
    pickupAddressId: row.pickup_address_id,
    pickupTimeId: row.pickup_time_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    orders,
  };
}

function listBatchOrders(db, batchId) {
  return db.prepare(`
    SELECT shipment_batch_orders.*, platform_orders.order_no, platform_orders.external_order_id,
      platform_orders.shop_id, platform_orders.order_status, platform_orders.shipping_status,
      platform_orders.logistics_channel_id, platform_orders.product_location_id
    FROM shipment_batch_orders
    JOIN platform_orders ON platform_orders.id = shipment_batch_orders.platform_order_id
    WHERE shipment_batch_orders.batch_id = ?
    ORDER BY shipment_batch_orders.id
  `).all(batchId).map((row) => ({
    id: row.id,
    platformOrderId: row.platform_order_id,
    orderNo: row.order_no,
    externalOrderId: row.external_order_id,
    shopId: row.shop_id,
    packageNumber: row.package_number,
    status: row.status,
    errorMessage: row.error_message,
    trackingNumber: row.tracking_number,
    orderStatus: row.order_status,
    shippingStatus: row.shipping_status,
  }));
}

function normalizeBatchResults(body, packages) {
  const response = bodyData(body);
  const raw = response.result || response.results || response.packageList || response.package_list || [];
  if (!raw.length) return packages.map((item) => ({ packageNumber: item.package_number, success: true }));
  return raw.map((item) => ({
    packageNumber: cleanText(item.packageNumber ?? item.package_number),
    success: item.success !== false && !item.error && !item.errMsg && !item.err_msg,
    error: cleanText(item.error || item.errMsg || item.err_msg || ""),
  }));
}

function normalizeTrackingResults(body, packages) {
  const response = bodyData(body);
  const raw = response.result || response.results || response.packageList || response.package_list || [];
  if (!raw.length) return packages.map((item) => ({ packageNumber: item.package_number, trackingNumber: "" }));
  return raw.map((item) => ({
    packageNumber: cleanText(item.packageNumber ?? item.package_number),
    trackingNumber: cleanText(item.trackingNumber ?? item.tracking_number ?? item.trackingNo ?? item.tracking_no),
  }));
}

function mapDocumentJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    batchId: row.batch_id,
    shopeeJobId: row.shopee_job_id,
    documentType: row.document_type,
    status: row.status,
    filePath: row.downloaded_file_path || "",
    downloadedFilePath: row.downloaded_file_path || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function documentJobStatus(body) {
  const response = bodyData(body);
  return cleanText(response.status || response.jobStatus || response.job_status || response.result?.status).toUpperCase();
}

function documentJobId(body) {
  const response = bodyData(body);
  return cleanText(response.jobId || response.job_id || response.taskId || response.task_id || response.result?.jobId || response.result?.job_id);
}

function documentFileBase64(body) {
  const response = bodyData(body);
  return response.fileBase64 || response.file_base64 || response.file || response.dataBase64 || response.data_base64 || "";
}

async function refreshBatchTracking(rootDir, batchId, { client, now = () => new Date().toISOString() } = {}) {
  if (!client?.request) throw new Error("refreshBatchTracking ต้องมี client");
  const db = openInventoryDatabase(rootDir);
  ensureInventorySchema(db);
  try {
    const batch = db.prepare("SELECT * FROM shipment_batches WHERE id = ?").get(Number(batchId));
    if (!batch) throw new Error("ไม่พบ shipment batch");
    const orders = listBatchOrders(db, batch.id);
    const packageList = orders
      .filter((order) => order.status !== "failed")
      .map((order) => ({ order_sn: order.externalOrderId || order.orderNo, package_number: order.packageNumber }));
    const response = await client.request({
      path: "/api/v2/logistics/get_mass_tracking_number",
      method: "POST",
      shopId: batch.shop_id,
      body: { package_list: packageList },
    });
    const tracking = normalizeTrackingResults(response, packageList);
    const byPackage = new Map(tracking.map((item) => [item.packageNumber, item.trackingNumber]));
    const timestamp = now();
    for (const order of orders) {
      if (order.status === "failed") continue;
      const trackingNumber = byPackage.get(order.packageNumber) || order.trackingNumber || "";
      const status = trackingNumber ? "documents_pending" : "tracking_pending";
      db.prepare(`
        UPDATE shipment_batch_orders
        SET status = ?, tracking_number = ?, updated_at = ?
        WHERE id = ?
      `).run(status, trackingNumber, timestamp, order.id);
      if (trackingNumber) {
        db.prepare("UPDATE platform_orders SET tracking_number = ?, shipping_status = ? WHERE id = ?")
          .run(trackingNumber, "SHIPPED", order.platformOrderId);
      }
    }
    const refreshedOrders = listBatchOrders(db, batch.id);
    const allTracked = refreshedOrders.filter((order) => order.status !== "failed")
      .every((order) => Boolean(order.trackingNumber));
    const batchStatus = allTracked ? "documents_pending" : "tracking_pending";
    db.prepare("UPDATE shipment_batches SET status = ?, updated_at = ? WHERE id = ?").run(batchStatus, timestamp, batch.id);
    db.prepare(`
      INSERT INTO shipment_actions (batch_id, action_type, idempotency_key, request_payload, status, created_at, updated_at)
      VALUES (?, 'tracking_refresh', ?, ?, 'succeeded', ?, ?)
      ON CONFLICT(idempotency_key) DO UPDATE SET response_code = excluded.response_code, updated_at = excluded.updated_at
    `).run(batch.id, `tracking_refresh:${batch.id}:${timestamp}`, JSON.stringify({ packageList }), timestamp, timestamp);
    return { batch: mapBatch({ ...batch, status: batchStatus }, refreshedOrders), orders: refreshedOrders };
  } finally {
    db.close();
  }
}

async function createShippingDocumentJob(rootDir, batchId, { client, now = () => new Date().toISOString() } = {}) {
  if (!client?.request) throw new Error("createShippingDocumentJob ต้องมี client");
  const db = openInventoryDatabase(rootDir);
  ensureInventorySchema(db);
  try {
    const batch = db.prepare("SELECT * FROM shipment_batches WHERE id = ?").get(Number(batchId));
    if (!batch) throw new Error("ไม่พบ shipment batch");
    const orders = listBatchOrders(db, batch.id);
    if (!orders.length || orders.some((order) => !order.trackingNumber)) {
      throw new Error("ยังไม่มี Tracking ครบทุก package");
    }
    const existing = db.prepare(`
      SELECT * FROM shipping_document_jobs
      WHERE batch_id = ? AND status IN ('created', 'processing', 'ready')
      ORDER BY id DESC LIMIT 1
    `).get(batch.id);
    if (existing) return mapDocumentJob(existing);

    const timestamp = now();
    const packageList = orders.map((order) => ({
      order_sn: order.externalOrderId || order.orderNo,
      package_number: order.packageNumber,
      tracking_number: order.trackingNumber,
    }));
    const response = await client.request({
      path: "/api/v2/logistics/create_shipping_document_job",
      method: "POST",
      shopId: batch.shop_id,
      body: { package_list: packageList, document_type: "WAYBILL" },
    });
    const shopeeJobId = documentJobId(response);
    if (!shopeeJobId) throw new Error("Shopee ไม่ส่งรหัส shipping document job");
    const row = db.prepare(`
      INSERT INTO shipping_document_jobs (batch_id, shopee_job_id, document_type, status, created_at, updated_at)
      VALUES (?, ?, 'WAYBILL', 'created', ?, ?) RETURNING *
    `).get(batch.id, shopeeJobId, timestamp, timestamp);
    db.prepare("UPDATE shipment_batches SET status = 'documents_pending', updated_at = ? WHERE id = ?").run(timestamp, batch.id);
    db.prepare(`
      INSERT INTO shipment_actions (batch_id, action_type, idempotency_key, request_payload, status, created_at, updated_at)
      VALUES (?, 'document_create', ?, ?, 'succeeded', ?, ?)
    `).run(batch.id, `document_create:${batch.id}`, JSON.stringify({ packageList }), timestamp, timestamp);
    return mapDocumentJob(row);
  } finally {
    db.close();
  }
}

async function pollShippingDocumentJob(rootDir, jobId, { client, now = () => new Date().toISOString() } = {}) {
  if (!client?.request) throw new Error("pollShippingDocumentJob ต้องมี client");
  const db = openInventoryDatabase(rootDir);
  ensureInventorySchema(db);
  try {
    const job = db.prepare("SELECT * FROM shipping_document_jobs WHERE id = ?").get(Number(jobId));
    if (!job) throw new Error("ไม่พบ shipping document job");
    if (job.status === "ready" && job.downloaded_file_path) return mapDocumentJob(job);
    const timestamp = now();
    const statusResponse = await client.request({
      path: "/api/v2/logistics/get_shipping_document_job_status",
      method: "POST",
      shopId: db.prepare("SELECT shop_id FROM shipment_batches WHERE id = ?").get(job.batch_id)?.shop_id,
      body: { job_id: job.shopee_job_id },
    });
    const status = documentJobStatus(statusResponse);
    if (!['READY', 'SUCCESS', 'COMPLETED', 'DONE'].includes(status)) {
      const nextStatus = ['FAILED', 'ERROR'].includes(status) ? "failed" : "processing";
      const updated = db.prepare("UPDATE shipping_document_jobs SET status = ?, updated_at = ? WHERE id = ? RETURNING *")
        .get(nextStatus, timestamp, job.id);
      return mapDocumentJob(updated);
    }
    let content;
    try {
      const downloadResponse = await client.request({
        path: "/api/v2/logistics/download_shipping_document_job",
        method: "POST",
        shopId: db.prepare("SELECT shop_id FROM shipment_batches WHERE id = ?").get(job.batch_id)?.shop_id,
        body: { job_id: job.shopee_job_id },
      });
      const encoded = documentFileBase64(downloadResponse);
      if (!encoded) throw new Error("Shopee ไม่ส่งไฟล์ shipping document");
      content = Buffer.from(encoded, "base64");
      if (!content.length) throw new Error("shipping document ว่างเปล่า");
    } catch (error) {
      const updated = db.prepare("UPDATE shipping_document_jobs SET status = 'failed', updated_at = ? WHERE id = ? RETURNING *")
        .get(timestamp, job.id);
      const failure = new Error(error.message || "ไม่สามารถดาวน์โหลด shipping document ได้");
      failure.job = mapDocumentJob(updated);
      throw failure;
    }
    const outputDir = path.join(rootDir, "data", "shipping-documents");
    await mkdir(outputDir, { recursive: true });
    const filePath = path.join(outputDir, `shipment-batch-${job.batch_id}-${job.shopee_job_id}.pdf`);
    await writeFile(filePath, content, { flag: "wx" }).catch(async (error) => {
      if (error.code !== "EEXIST") throw error;
    });
    const updated = db.prepare("UPDATE shipping_document_jobs SET status = 'ready', downloaded_file_path = ?, updated_at = ? WHERE id = ? RETURNING *")
      .get(filePath, timestamp, job.id);
    db.prepare("UPDATE shipment_batches SET status = 'ready_to_print', updated_at = ? WHERE id = ?").run(timestamp, job.batch_id);
    db.prepare(`
      INSERT INTO shipment_actions (batch_id, action_type, idempotency_key, request_payload, status, created_at, updated_at)
      VALUES (?, 'document_download', ?, ?, 'succeeded', ?, ?)
    `).run(job.batch_id, `document_download:${job.id}`, JSON.stringify({ jobId: job.shopee_job_id }), timestamp, timestamp);
    return mapDocumentJob(updated);
  } finally {
    db.close();
  }
}

async function prepareShipmentBatch(rootDir, orderIds = [], { client, now = () => new Date().toISOString() } = {}) {
  if (!client?.request) throw new Error("prepareShipmentBatch ต้องมี client");
  const db = openInventoryDatabase(rootDir);
  ensureInventorySchema(db);
  try {
    const placeholders = orderIds.map(() => "?").join(",") || "NULL";
    const rows = db.prepare(`SELECT * FROM platform_orders WHERE id IN (${placeholders})`).all(...orderIds.map(Number));
    const groups = groupEligibleShopeePackages(rows.map((row) => ({
      ...row,
      id: row.id,
      orderStatus: row.order_status,
      shippingStatus: row.shipping_status,
      shipmentArrangedAt: row.shipment_arranged_at,
      logisticsChannelId: row.logistics_channel_id,
      productLocationId: row.product_location_id,
      packageNumber: row.package_number,
    })));
    if (!groups.length) throw new Error("ไม่มี Order ที่ไม่พร้อมจัดส่งหรือไม่มี Order ที่พร้อมจัดส่ง");
    const timestamp = now();
    const batches = [];
    for (const group of groups) {
      const first = group.orders[0];
      const batch = db.prepare(`
        INSERT INTO shipment_batches (shop_id, logistics_channel_id, product_location_id, status, created_at, updated_at)
        VALUES (?, ?, ?, 'prepared', ?, ?) RETURNING *
      `).get(first.shop_id, group.logisticsChannelId, group.productLocationId, timestamp, timestamp);
      for (const order of group.orders) {
        db.prepare(`
          INSERT INTO shipment_batch_orders (batch_id, platform_order_id, package_number, status, created_at, updated_at)
          VALUES (?, ?, ?, 'pending', ?, ?)
        `).run(batch.id, order.id, order.packageNumber || "", timestamp, timestamp);
      }
      const packages = group.orders.map((order) => ({
        order_sn: order.external_order_id || order.order_no,
        package_number: order.packageNumber || "",
      }));
      const parameterBody = await client.request({
        path: "/api/v2/logistics/get_mass_shipping_parameter",
        method: "POST",
        shopId: first.shop_id,
        body: { package_list: packages },
      });
      db.prepare(`
        INSERT INTO shipment_actions (batch_id, action_type, idempotency_key, request_payload, status, created_at, updated_at)
        VALUES (?, 'shipping_parameters', ?, ?, 'succeeded', ?, ?)
      `).run(batch.id, `shipping_parameters:${batch.id}`, JSON.stringify({ packages }), timestamp, timestamp);
      batches.push({
        ...mapBatch(batch, listBatchOrders(db, batch.id)),
        pickup: normalizePickup(parameterBody),
      });
    }
    return { batches };
  } finally {
    db.close();
  }
}

async function arrangeShipmentBatch(rootDir, batchId, selection = {}, { client, now = () => new Date().toISOString() } = {}) {
  if (!client?.request) throw new Error("arrangeShipmentBatch ต้องมี client");
  const db = openInventoryDatabase(rootDir);
  ensureInventorySchema(db);
  try {
    const batch = db.prepare("SELECT * FROM shipment_batches WHERE id = ?").get(Number(batchId));
    if (!batch) throw new Error("ไม่พบ shipment batch");
    const orders = listBatchOrders(db, batch.id);
    const pending = orders.filter((order) => !["arranged", "ready_to_print"].includes(order.status));
    if (!pending.length) return { batch: mapBatch({ ...batch, status: "arranged" }, orders), orders, skipped: true };
    const timestamp = now();
    const packageList = pending.map((order) => ({
      order_sn: order.externalOrderId || order.orderNo,
      package_number: order.packageNumber,
    }));
    const idempotencyKey = `arrange_shipment:${batch.id}:${packageList.map((item) => item.package_number).sort().join(",")}`;
    db.prepare(`
      INSERT OR IGNORE INTO shipment_actions (batch_id, action_type, idempotency_key, request_payload, status, created_at, updated_at)
      VALUES (?, 'arrange_shipment', ?, ?, 'pending', ?, ?)
    `).run(batch.id, idempotencyKey, JSON.stringify({ packageList, selection }), timestamp, timestamp);
    db.prepare("UPDATE shipment_batches SET status = 'arranging', pickup_address_id = ?, pickup_time_id = ?, updated_at = ? WHERE id = ?")
      .run(cleanText(selection.addressId), cleanText(selection.pickupTimeId), timestamp, batch.id);
    const response = await client.request({
      path: "/api/v2/logistics/mass_ship_order",
      method: "POST",
      shopId: batch.shop_id,
      body: {
        package_list: packageList,
        pickup: { address_id: selection.addressId, pickup_time_id: selection.pickupTimeId },
      },
    });
    const results = normalizeBatchResults(response, packageList);
    const resultByPackage = new Map(results.map((result) => [result.packageNumber, result]));
    for (const order of pending) {
      const result = resultByPackage.get(order.packageNumber) || { success: false, error: "Shopee ไม่ส่งผลลัพธ์ของ package นี้" };
      db.prepare(`
        UPDATE shipment_batch_orders
        SET status = ?, error_message = ?, updated_at = ?
        WHERE id = ?
      `).run(result.success ? "arranged" : "failed", result.error || "", timestamp, order.id);
    }
    const refreshedOrders = listBatchOrders(db, batch.id);
    const hasFailed = refreshedOrders.some((order) => order.status === "failed");
    const allArranged = refreshedOrders.every((order) => ["arranged", "ready_to_print"].includes(order.status));
    const batchStatus = allArranged ? "arranged" : (hasFailed ? "partially_failed" : "arranging");
    db.prepare("UPDATE shipment_batches SET status = ?, updated_at = ? WHERE id = ?").run(batchStatus, timestamp, batch.id);
    db.prepare("UPDATE shipment_actions SET status = 'succeeded', response_code = ?, updated_at = ? WHERE idempotency_key = ?")
      .run("0", timestamp, idempotencyKey);
    return { batch: mapBatch({ ...batch, status: batchStatus }, refreshedOrders), orders: refreshedOrders, skipped: false };
  } finally {
    db.close();
  }
}

module.exports = {
  arrangeShipmentBatch,
  createShippingDocumentJob,
  groupEligibleShopeePackages,
  normalizePickup,
  pollShippingDocumentJob,
  prepareShipmentBatch,
  refreshBatchTracking,
};
