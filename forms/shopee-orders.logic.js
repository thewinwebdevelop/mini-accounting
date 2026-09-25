const { withInventoryDatabase } = require("./inventory-db.logic.js");
const { getShopeeConnection, markShopeeSynced, updateShopeeTokens } = require("./shopee-auth.logic.js");
const { upsertShopeeOrder } = require("./platform-orders.logic.js");

function nowIso(options = {}) {
  return options.now ? options.now() : new Date().toISOString();
}

function unixSeconds(iso) {
  const value = Date.parse(iso || "");
  return Number.isFinite(value) ? Math.floor(value / 1000) : Math.floor(Date.now() / 1000) - 86400;
}

function responseData(body) {
  return body?.response || body?.data || body || {};
}

function listOrders(body) {
  const response = responseData(body);
  return response.orderList || response.order_list || response.orders || [];
}

function listDetails(body) {
  const response = responseData(body);
  return response.orderList || response.order_list || response.orderDetail || response.order_detail || response.orders || (response.orderSn || response.order_sn ? [response] : []);
}

function normalizeOrderSummary(row) {
  return {
    orderSn: row.orderSn || row.order_sn,
    updateTime: row.updateTime || row.update_time,
  };
}

async function syncShopeeOrders(rootDir, { connectionId, client, now = () => new Date().toISOString(), pageSize = 100 } = {}) {
  if (!connectionId || !client?.request) throw new Error("syncShopeeOrders ต้องมี connectionId และ client");
  const connection = getShopeeConnection(rootDir, connectionId);
  if (!connection) throw new Error("ไม่พบ Shopee connection");
  const startedAt = now();
  const run = withInventoryDatabase(rootDir, (db) => db.prepare(`
    INSERT INTO shopee_sync_runs (shop_id, started_at, status) VALUES (?, ?, 'running') RETURNING *
  `).get(connection.shopId, startedAt));
  let imported = 0;
  let updated = 0;
  let failed = 0;
  let cursor = "";
  try {
    const refresh = async () => {
      const refreshed = await client.refreshAccessToken({ shopId: connection.shopId, refreshToken: connection.refreshToken });
      updateShopeeTokens(rootDir, connection.id, {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        tokenExpiresAt: new Date(Date.now() + refreshed.expireIn * 1000).toISOString(),
      }, { now });
      return refreshed.accessToken;
    };
    const orderListBody = await client.request({
      path: "/api/v2/order/get_order_list",
      accessToken: connection.accessToken,
      shopId: connection.shopId,
      query: {
        time_range_field: "update_time",
        time_from: unixSeconds(connection.lastSyncAt || startedAt) - 60,
        time_to: unixSeconds(startedAt) + 60,
        page_size: pageSize,
        ...(cursor ? { cursor } : {}),
      },
      refresh,
    });
    const summaries = listOrders(orderListBody).map(normalizeOrderSummary).filter((row) => row.orderSn);
    cursor = responseData(orderListBody).nextCursor || responseData(orderListBody).next_cursor || "";
    for (const summary of summaries) {
      try {
        const detailBody = await client.request({
          path: "/api/v2/order/get_order_detail",
          accessToken: connection.accessToken,
          shopId: connection.shopId,
          query: { order_sn_list: summary.orderSn },
          refresh,
        });
        for (const detail of listDetails(detailBody)) {
          const result = upsertShopeeOrder(rootDir, { ...detail, shopId: connection.shopId, orderSn: detail.orderSn || detail.order_sn || summary.orderSn }, { now });
          if (result.created) imported += 1;
          else updated += 1;
        }
      } catch {
        failed += 1;
      }
    }
    const finishedAt = now();
    withInventoryDatabase(rootDir, (db) => {
      db.prepare(`
        UPDATE shopee_sync_runs
        SET finished_at = ?, cursor = ?, orders_found = ?, orders_upserted = ?, orders_failed = ?, status = ?
        WHERE id = ?
      `).run(finishedAt, cursor, summaries.length, imported + updated, failed, failed ? "partial" : "succeeded", run.id);
    });
    markShopeeSynced(rootDir, connection.id, finishedAt);
    return { syncRun: { id: run.id, status: failed ? "partial" : "succeeded", cursor }, imported, updated, failed };
  } catch (error) {
    withInventoryDatabase(rootDir, (db) => db.prepare(`
      UPDATE shopee_sync_runs SET finished_at = ?, status = 'failed', error_message = ? WHERE id = ?
    `).run(now(), error.message, run.id));
    throw error;
  }
}

module.exports = { syncShopeeOrders, listDetails, listOrders, responseData };
