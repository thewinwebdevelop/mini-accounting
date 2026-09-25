import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { createShopeeClient } from "../forms/shopee-client.logic.js";

test("createShopeeClient builds a signed authorization URL", () => {
  const client = createShopeeClient({
    partnerId: "12345",
    partnerKey: "secret",
    baseUrl: "https://partner.example.com",
    now: () => 1700000000,
  });

  const url = new URL(client.buildAuthorizationUrl({
    redirectUrl: "http://127.0.0.1:8787/api/shopee/callback",
    state: "state-1",
  }));
  const path = "/api/v2/shop/auth_partner";
  const expectedSign = crypto.createHmac("sha256", "secret")
    .update(`12345${path}1700000000`)
    .digest("hex");

  assert.equal(url.pathname, path);
  assert.equal(url.searchParams.get("partner_id"), "12345");
  assert.equal(url.searchParams.get("timestamp"), "1700000000");
  assert.equal(url.searchParams.get("sign"), expectedSign);
  assert.equal(url.searchParams.get("redirect"), "http://127.0.0.1:8787/api/shopee/callback");
  assert.equal(url.searchParams.get("state"), "state-1");
});

test("request refreshes once after a 401 and retries with the new access token", async () => {
  const calls = [];
  let attempt = 0;
  const client = createShopeeClient({
    partnerId: "12345",
    partnerKey: "secret",
    baseUrl: "https://partner.example.com",
    now: () => 1700000000,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      attempt += 1;
      if (attempt === 1) return { ok: false, status: 401, json: async () => ({ message: "expired" }) };
      return { ok: true, status: 200, json: async () => ({ response: { ok: true } }) };
    },
  });

  const result = await client.request({
    path: "/api/v2/order/get_order_list",
    accessToken: "old-token",
    shopId: "shop-1",
    refresh: async () => "new-token",
  });

  assert.deepEqual(result, { response: { ok: true } });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /access_token=old-token/);
  assert.match(calls[1].url, /access_token=new-token/);
});

test("refreshAccessToken calls the public token endpoint", async () => {
  let request;
  const client = createShopeeClient({
    partnerId: "12345",
    partnerKey: "secret",
    baseUrl: "https://partner.example.com",
    now: () => 1700000000,
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return { ok: true, status: 200, json: async () => ({ access_token: "new", refresh_token: "next", expire_in: 14400 }) };
    },
  });

  const result = await client.refreshAccessToken({ shopId: "shop-1", refreshToken: "refresh-1" });

  assert.equal(result.accessToken, "new");
  assert.equal(result.refreshToken, "next");
  assert.match(request.url, /auth\/access_token\/get/);
  assert.equal(request.options.method, "POST");
});

test("exchangeAuthorizationCode exchanges Shopee callback code for tokens", async () => {
  let request;
  const client = createShopeeClient({
    partnerId: "12345",
    partnerKey: "secret",
    baseUrl: "https://partner.example.com",
    now: () => 1700000000,
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ response: { access_token: "access-1", refresh_token: "refresh-1", expire_in: 14400 } }),
      };
    },
  });

  const result = await client.exchangeAuthorizationCode({ code: "auth-code", shopId: "shop-1" });

  assert.equal(result.accessToken, "access-1");
  assert.equal(result.refreshToken, "refresh-1");
  assert.equal(result.expireIn, 14400);
  assert.match(request.url, /\/api\/v2\/auth\/token\/get/);
  assert.equal(request.options.method, "POST");
  assert.deepEqual(JSON.parse(request.options.body), {
    partner_id: 12345,
    code: "auth-code",
    shop_id: "shop-1",
  });
});
