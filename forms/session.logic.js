const crypto = require("node:crypto");

const SESSION_COOKIE_NAME = "sweet_house_session";

function sessionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function encodePart(value) {
  return Buffer.from(value).toString("base64url");
}

function decodePart(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signSession(payload, secret) {
  if (!secret || String(secret).length < 32) {
    throw sessionError("SESSION_CONFIG_MISSING", "Session secret is missing or too short");
  }
  if (!payload || typeof payload !== "object" || !Number.isFinite(payload.exp)) {
    throw sessionError("SESSION_INVALID", "Session payload is invalid");
  }
  const encodedPayload = encodePart(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", String(secret)).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function verifySession(token, secret, now = () => Math.floor(Date.now() / 1000)) {
  if (!secret || String(secret).length < 32 || typeof token !== "string") {
    throw sessionError("SESSION_INVALID", "Session is invalid");
  }
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw sessionError("SESSION_INVALID", "Session is invalid");
  }
  let payload;
  try {
    payload = JSON.parse(decodePart(parts[0]));
  } catch {
    throw sessionError("SESSION_INVALID", "Session is invalid");
  }
  const expected = crypto.createHmac("sha256", String(secret)).update(parts[0]).digest();
  let actual;
  try {
    actual = Buffer.from(parts[1], "base64url");
  } catch {
    throw sessionError("SESSION_INVALID", "Session is invalid");
  }
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw sessionError("SESSION_INVALID", "Session is invalid");
  }
  if (!payload || typeof payload !== "object" || !Number.isFinite(payload.exp)) {
    throw sessionError("SESSION_INVALID", "Session is invalid");
  }
  if (payload.exp <= Number(now())) throw sessionError("SESSION_EXPIRED", "Session is expired");
  return payload;
}

function parseCookies(header = "") {
  const cookies = {};
  for (const part of String(header).split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    if (Object.prototype.hasOwnProperty.call(cookies, name)) {
      throw sessionError("SESSION_INVALID", "Duplicate cookie is invalid");
    }
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      throw sessionError("SESSION_INVALID", "Cookie is invalid");
    }
  }
  return cookies;
}

function buildSessionCookie(token, { secure = false, maxAge = 43200 } = {}) {
  const attributes = [
    `Path=/`,
    `Max-Age=${Math.max(0, Math.floor(Number(maxAge) || 0))}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) attributes.push("Secure");
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; ${attributes.join("; ")}`;
}

function clearSessionCookie(options = {}) {
  return buildSessionCookie("", { ...options, maxAge: 0 });
}

module.exports = {
  SESSION_COOKIE_NAME,
  buildSessionCookie,
  clearSessionCookie,
  parseCookies,
  signSession,
  verifySession,
};
