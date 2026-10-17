import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import auth from "../forms/shopee-auth.logic.js";

test("Shopee OAuth state is single-use and expires", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-shopee-oauth-state-"));
  try {
    const created = auth.createShopeeOAuthState(rootDir, {
      returnUrl: "http://127.0.0.1:8787/shopee-connection",
      now: () => "2026-09-25T10:00:00.000Z",
    });
    assert.match(created.state, /^[a-f0-9]{48}$/);
    assert.equal(auth.consumeShopeeOAuthState(rootDir, created.state, { now: () => "2026-09-25T10:05:00.000Z" }).returnUrl, "http://127.0.0.1:8787/shopee-connection");
    assert.equal(auth.consumeShopeeOAuthState(rootDir, created.state, { now: () => "2026-09-25T10:05:00.000Z" }), null);

    const expired = auth.createShopeeOAuthState(rootDir, {
      returnUrl: "http://127.0.0.1:8787/shopee-connection",
      now: () => "2026-09-25T10:00:00.000Z",
      ttlSeconds: 60,
    });
    assert.equal(auth.consumeShopeeOAuthState(rootDir, expired.state, { now: () => "2026-09-25T10:01:01.000Z" }), null);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("completeShopeeAuthorization exchanges the code and saves a connection", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sweet-house-shopee-oauth-complete-"));
  try {
    const connection = await auth.completeShopeeAuthorization(rootDir, {
      shopId: "shop-1",
      shopName: "ร้านทดสอบ",
      code: "auth-code",
      partnerId: "12345",
      client: {
        exchangeAuthorizationCode: async () => ({ accessToken: "access-1", refreshToken: "refresh-1", expireIn: 3600 }),
      },
      now: () => "2026-09-25T10:00:00.000Z",
    });
    assert.equal(connection.shopId, "shop-1");
    assert.equal(connection.status, "connected");
    assert.equal(connection.tokenExpiresAt, "2026-09-25T11:00:00.000Z");
    assert.equal(auth.getShopeeConnection(rootDir, "shop-1").accessToken, "access-1");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
