import assert from "node:assert/strict";
import test from "node:test";

import { issueFileAccessToken, verifyFileAccessToken } from "../forms/file-access.logic.js";

test("file access tokens are scoped to one path and expire independently of the browser session", () => {
  const secret = "x".repeat(32);
  const path = "/workflow-documents/purchase_order/PO-2026-09-0002/pdf/01_purchase_order.pdf";
  const now = Math.floor(Date.now() / 1000);
  const token = issueFileAccessToken({
    secret,
    path,
    auth: { userId: "user-1", lineUserId: "U123", role: "owner" },
    ttlSeconds: 600,
    now: () => now,
  });

  assert.equal(verifyFileAccessToken({ token, secret, path }).userId, "user-1");
  assert.equal(verifyFileAccessToken({ token, secret, path: `${path}?other=1` }), null);

  const expiredToken = issueFileAccessToken({
    secret,
    path,
    auth: { userId: "user-1", role: "owner" },
    ttlSeconds: 60,
    now: () => now - 120,
  });
  assert.equal(verifyFileAccessToken({ token: expiredToken, secret, path }), null);
});
