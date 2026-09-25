const crypto = require("node:crypto");

const DEFAULT_BASE_URL = "https://partner.shopeemobile.com";

function cleanText(value) {
  return String(value ?? "").trim();
}

function unixNow(now) {
  const value = typeof now === "function" ? now() : Date.now();
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  const numeric = Number(value);
  return numeric < 1_000_000_000_000 ? Math.floor(numeric) : Math.floor(numeric / 1000);
}

function signature({ partnerId, partnerKey, path, timestamp, accessToken = "", shopId = "" }) {
  const base = `${partnerId}${path}${timestamp}${accessToken}${shopId}`;
  return crypto.createHmac("sha256", partnerKey).update(base).digest("hex");
}

function makeUrl(baseUrl, path, params) {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, String(item)));
    else url.searchParams.set(key, String(value));
  }
  return url;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function apiError(response, body) {
  const error = new Error(body?.message || body?.msg || `Shopee API request failed (${response.status})`);
  error.status = response.status;
  error.body = body;
  return error;
}

function createShopeeClient({ partnerId, partnerKey, fetchImpl = globalThis.fetch, baseUrl = DEFAULT_BASE_URL, now = Date.now }) {
  if (!partnerId || !partnerKey) throw new Error("Shopee client ต้องมี partnerId และ partnerKey");

  function buildAuthorizationUrl({ redirectUrl, state = "" } = {}) {
    const path = "/api/v2/shop/auth_partner";
    const timestamp = unixNow(now);
    return makeUrl(baseUrl, path, {
      partner_id: partnerId,
      timestamp,
      sign: signature({ partnerId, partnerKey, path, timestamp }),
      redirect: redirectUrl,
      ...(state ? { state } : {}),
    }).toString();
  }

  async function request(options = {}, retryContext = { retried: false }) {
    const path = options.path;
    if (!path) throw new Error("Shopee API path is required");
    const timestamp = unixNow(now);
    const accessToken = cleanText(options.accessToken);
    const shopId = cleanText(options.shopId);
    const url = makeUrl(baseUrl, path, {
      partner_id: partnerId,
      timestamp,
      sign: signature({ partnerId, partnerKey, path, timestamp, accessToken, shopId }),
      ...(accessToken ? { access_token: accessToken } : {}),
      ...(shopId ? { shop_id: shopId } : {}),
      ...(options.query || {}),
    });
    const method = String(options.method || "GET").toUpperCase();
    const response = await fetchImpl(url, {
      method,
      headers: {
        accept: "application/json",
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const body = await readJson(response);
    if (response.status === 401 && !retryContext.retried && typeof options.refresh === "function") {
      const refreshed = await options.refresh();
      const refreshedToken = typeof refreshed === "string" ? refreshed : refreshed?.accessToken;
      if (refreshedToken) return request({ ...options, accessToken: refreshedToken, refresh: undefined }, { retried: true });
    }
    if (!response.ok) throw apiError(response, body);
    return body;
  }

  async function refreshAccessToken({ shopId, refreshToken }) {
    const path = "/api/v2/auth/access_token/get";
    const timestamp = unixNow(now);
    const url = makeUrl(baseUrl, path, {
      partner_id: partnerId,
      timestamp,
      sign: signature({ partnerId, partnerKey, path, timestamp }),
    });
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ partner_id: Number(partnerId) || partnerId, shop_id: Number(shopId) || shopId, refresh_token: refreshToken }),
    });
    const body = await readJson(response);
    if (!response.ok) throw apiError(response, body);
    return {
      accessToken: body.access_token || body.response?.access_token || "",
      refreshToken: body.refresh_token || body.response?.refresh_token || refreshToken,
      expireIn: Number(body.expire_in || body.response?.expire_in || 0),
    };
  }

  return { buildAuthorizationUrl, request, refreshAccessToken };
}

module.exports = { createShopeeClient, signature };
