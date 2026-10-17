const crypto = require("node:crypto");
const { withInventoryDatabase } = require("./inventory-db.logic.js");

function nowIso(options = {}) {
  return options.now ? options.now() : new Date().toISOString();
}

function mapConnection(row) {
  if (!row) return null;
  return {
    id: row.id,
    shopId: row.shop_id,
    shopName: row.shop_name,
    partnerId: row.partner_id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    tokenExpiresAt: row.token_expires_at,
    status: row.status,
    lastSyncAt: row.last_sync_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function saveShopeeConnection(rootDir, input = {}, options = {}) {
  return withInventoryDatabase(rootDir, (db) => {
    const timestamp = nowIso(options);
    const row = db.prepare(`
      INSERT INTO shopee_connections (
        shop_id, shop_name, partner_id, access_token, refresh_token,
        token_expires_at, status, last_sync_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(shop_id) DO UPDATE SET
        shop_name = excluded.shop_name,
        partner_id = excluded.partner_id,
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        token_expires_at = excluded.token_expires_at,
        status = excluded.status,
        updated_at = excluded.updated_at
      RETURNING *
    `).get(
      String(input.shopId || ""),
      String(input.shopName || ""),
      String(input.partnerId || ""),
      String(input.accessToken || ""),
      String(input.refreshToken || ""),
      String(input.tokenExpiresAt || ""),
      String(input.status || "connected"),
      String(input.lastSyncAt || ""),
      timestamp,
      timestamp,
    );
    return mapConnection(row);
  });
}

function getShopeeConnection(rootDir, connectionIdOrShopId) {
  return withInventoryDatabase(rootDir, (db) => {
    const numericId = Number(connectionIdOrShopId);
    const row = Number.isInteger(numericId) && numericId > 0
      ? db.prepare("SELECT * FROM shopee_connections WHERE id = ?").get(numericId)
      : db.prepare("SELECT * FROM shopee_connections WHERE shop_id = ?").get(String(connectionIdOrShopId || ""));
    return mapConnection(row);
  });
}

function updateShopeeTokens(rootDir, connectionId, tokens = {}, options = {}) {
  return withInventoryDatabase(rootDir, (db) => {
    const timestamp = nowIso(options);
    const row = db.prepare(`
      UPDATE shopee_connections
      SET access_token = ?, refresh_token = ?, token_expires_at = ?, status = 'connected', updated_at = ?
      WHERE id = ?
      RETURNING *
    `).get(
      String(tokens.accessToken || ""),
      String(tokens.refreshToken || ""),
      String(tokens.tokenExpiresAt || ""),
      timestamp,
      Number(connectionId),
    );
    return mapConnection(row);
  });
}

function createShopeeOAuthState(rootDir, options = {}) {
  const createdAt = nowIso(options);
  const ttlSeconds = Number(options.ttlSeconds || 600);
  const expiresAt = new Date(new Date(createdAt).getTime() + ttlSeconds * 1000).toISOString();
  const state = crypto.randomBytes(24).toString("hex");
  withInventoryDatabase(rootDir, (db) => {
    db.prepare(`
      INSERT INTO shopee_oauth_states (state, return_url, created_at, expires_at, consumed_at)
      VALUES (?, ?, ?, ?, '')
    `).run(state, String(options.returnUrl || ""), createdAt, expiresAt);
  });
  return { state, createdAt, expiresAt };
}

function consumeShopeeOAuthState(rootDir, state, options = {}) {
  const currentTime = nowIso(options);
  return withInventoryDatabase(rootDir, (db) => {
    const row = db.prepare(`
      SELECT * FROM shopee_oauth_states
      WHERE state = ? AND consumed_at = '' AND expires_at > ?
    `).get(String(state || ""), currentTime);
    if (!row) return null;
    db.prepare("UPDATE shopee_oauth_states SET consumed_at = ? WHERE state = ? AND consumed_at = ''").run(currentTime, row.state);
    return {
      state: row.state,
      returnUrl: row.return_url,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      consumedAt: currentTime,
    };
  });
}

async function completeShopeeAuthorization(rootDir, input = {}) {
  const shopId = String(input.shopId || "").trim();
  const code = String(input.code || "").trim();
  if (!shopId || !code) throw new Error("Shopee authorization ต้องมี code และ shop_id");
  if (!input.client?.exchangeAuthorizationCode) throw new Error("Shopee client ไม่รองรับการแลก authorization code");
  const tokens = await input.client.exchangeAuthorizationCode({ code, shopId });
  if (!tokens.accessToken || !tokens.refreshToken) throw new Error("Shopee ไม่ส่ง access token กลับมา");
  const now = nowIso(input);
  const expireIn = Number(tokens.expireIn || 0);
  return saveShopeeConnection(rootDir, {
    shopId,
    shopName: input.shopName || "",
    partnerId: input.partnerId || "",
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenExpiresAt: expireIn ? new Date(new Date(now).getTime() + expireIn * 1000).toISOString() : "",
    status: "connected",
  }, { now: () => now });
}

function markShopeeSynced(rootDir, connectionId, timestamp) {
  return withInventoryDatabase(rootDir, (db) => {
    const row = db.prepare(`
      UPDATE shopee_connections SET last_sync_at = ?, updated_at = ? WHERE id = ? RETURNING *
    `).get(timestamp, timestamp, Number(connectionId));
    return mapConnection(row);
  });
}

module.exports = {
  completeShopeeAuthorization,
  consumeShopeeOAuthState,
  createShopeeOAuthState,
  getShopeeConnection,
  markShopeeSynced,
  saveShopeeConnection,
  updateShopeeTokens,
};
