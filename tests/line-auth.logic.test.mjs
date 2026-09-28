import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  resolveLineAppUser,
  verifyLineIdToken,
} = require("../forms/line-auth.logic.js");

test("verifyLineIdToken accepts a valid LINE token response", async () => {
  const profile = await verifyLineIdToken({
    idToken: "id-token",
    channelId: "channel-1",
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.line.me/oauth2/v2.1/verify");
      assert.equal(options.method, "POST");
      assert.match(String(options.body), /id_token=id-token/);
      return new Response(JSON.stringify({
        iss: "https://access.line.me",
        sub: "U123",
        aud: "channel-1",
        exp: 4102444800,
        iat: 4102439990,
        name: "ผู้ใช้ทดสอบ",
        picture: "https://example.com/p.png",
      }), { status: 200 });
    },
    now: () => 4102440000,
  });

  assert.deepEqual(profile, {
    lineUserId: "U123",
    displayName: "ผู้ใช้ทดสอบ",
    pictureUrl: "https://example.com/p.png",
  });
});

test("verifyLineIdToken rejects a wrong audience and expired token", async () => {
  await assert.rejects(() => verifyLineIdToken({
    idToken: "id-token",
    channelId: "channel-1",
    fetchImpl: async () => new Response(JSON.stringify({
      iss: "https://access.line.me",
      sub: "U123",
      aud: "wrong",
      exp: 1,
      iat: 1,
    }), { status: 200 }),
    now: () => 100,
  }), error => error.code === "LINE_TOKEN_INVALID");
});

test("verifyLineIdToken rejects a provider error without exposing its body", async () => {
  await assert.rejects(() => verifyLineIdToken({
    idToken: "id-token",
    channelId: "channel-1",
    fetchImpl: async () => new Response("provider secret", { status: 400 }),
  }), error => {
    assert.equal(error.code, "LINE_TOKEN_INVALID");
    assert.doesNotMatch(error.message, /provider secret/);
    return true;
  });
});

test("resolveLineAppUser upserts the LINE profile and returns the stored role", async () => {
  const calls = [];
  const user = await resolveLineAppUser({
    client: { marker: "client" },
    lineProfile: { lineUserId: "U123", displayName: "ทดสอบ", pictureUrl: "https://example.com/p.png" },
    now: () => "2026-09-25T00:00:00.000Z",
    request: async (_client, path, options) => {
      calls.push({ path, options });
      if (options.method === "POST") return [{ id: "user-1", line_user_id: "U123", status: "active" }];
      return [{
        id: "user-1",
        line_user_id: "U123",
        display_name: "ทดสอบ",
        picture_url: "https://example.com/p.png",
        status: "active",
        app_user_roles: [{ role_code: "employee" }],
      }];
    },
  });

  assert.deepEqual(user, {
    id: "user-1",
    lineUserId: "U123",
    displayName: "ทดสอบ",
    pictureUrl: "https://example.com/p.png",
    status: "active",
    role: "employee",
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, "POST");
  assert.match(calls[0].path, /app_users/);
  assert.match(calls[1].path, /app_user_roles|app_users/);
});

test("resolveLineAppUser does not grant a role to a pending user", async () => {
  const user = await resolveLineAppUser({
    client: {},
    lineProfile: { lineUserId: "U999", displayName: "รออนุมัติ", pictureUrl: "" },
    request: async (_client, path, options) => options.method === "POST"
      ? [{ id: "user-9", line_user_id: "U999", status: "pending" }]
      : [{ id: "user-9", line_user_id: "U999", status: "pending", app_user_roles: [] }],
  });
  assert.equal(user.status, "pending");
  assert.equal(user.role, "");
});

test("resolveLineAppUser accepts Supabase one-to-one role objects", async () => {
  const user = await resolveLineAppUser({
    client: {},
    lineProfile: { lineUserId: "U456", displayName: "เจ้าของบริษัท", pictureUrl: "" },
    request: async (_client, path, options) => options.method === "POST"
      ? [{ id: "user-10", line_user_id: "U456", status: "active" }]
      : [{
        id: "user-10",
        line_user_id: "U456",
        display_name: "เจ้าของบริษัท",
        picture_url: "",
        status: "active",
        app_user_roles: { role_code: "admin" },
      }],
  });

  assert.equal(user.role, "admin");
});
