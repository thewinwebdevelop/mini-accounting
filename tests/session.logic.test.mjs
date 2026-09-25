import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildSessionCookie,
  clearSessionCookie,
  parseCookies,
  signSession,
  verifySession,
} = require("../forms/session.logic.js");

test("signed sessions round-trip and reject tampering", () => {
  const token = signSession({ userId: "u-1", role: "employee", exp: 4102444800 }, "x".repeat(32));
  assert.deepEqual(verifySession(token, "x".repeat(32), () => 4102440000), {
    userId: "u-1", role: "employee", exp: 4102444800,
  });
  assert.throws(() => verifySession(`${token}x`, "x".repeat(32), () => 4102440000), error => error.code === "SESSION_INVALID");
});

test("expired and malformed sessions are rejected", () => {
  const secret = "x".repeat(32);
  const expired = signSession({ userId: "u-1", exp: 99 }, secret);
  assert.throws(() => verifySession(expired, secret, () => 100), error => error.code === "SESSION_EXPIRED");
  assert.throws(() => verifySession("not-a-session", secret, () => 100), error => error.code === "SESSION_INVALID");
});

test("session cookies are HttpOnly and secure when configured", () => {
  const cookie = buildSessionCookie("signed-value", { secure: true, maxAge: 3600 });
  assert.match(cookie, /^sweet_house_session=signed-value/);
  assert.match(cookie, /Max-Age=3600/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.deepEqual(parseCookies("sweet_house_session=signed-value; other=value"), { sweet_house_session: "signed-value", other: "value" });
});

test("logout cookie expires the session", () => {
  const cookie = clearSessionCookie({ secure: true });
  assert.match(cookie, /^sweet_house_session=/);
  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
});
