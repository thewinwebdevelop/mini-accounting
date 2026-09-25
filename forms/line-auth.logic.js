const { supabaseRequest } = require("./supabase.logic.js");

const LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
const LINE_ISSUER = "https://access.line.me";
const CLOCK_SKEW_SECONDS = 60;
const VALID_ROLES = new Set(["employee", "owner", "accounting", "admin"]);

function authError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function currentUnixSeconds() {
  return Math.floor(Date.now() / 1000);
}

function assertTokenClaims(claims, channelId, now) {
  if (!claims || claims.iss !== LINE_ISSUER || claims.aud !== channelId) {
    throw authError("LINE_TOKEN_INVALID", "LINE token is invalid");
  }
  if (typeof claims.sub !== "string" || !claims.sub || !/^U[A-Za-z0-9_-]+$/.test(claims.sub)) {
    throw authError("LINE_TOKEN_INVALID", "LINE token is invalid");
  }
  if (!Number.isFinite(claims.exp) || claims.exp <= now - CLOCK_SKEW_SECONDS) {
    throw authError("LINE_TOKEN_INVALID", "LINE token is invalid or expired");
  }
  if (!Number.isFinite(claims.iat) || claims.iat > now + CLOCK_SKEW_SECONDS) {
    throw authError("LINE_TOKEN_INVALID", "LINE token is invalid");
  }
}

async function verifyLineIdToken({
  idToken,
  channelId = process.env.LINE_CHANNEL_ID,
  verifyUrl = process.env.LINE_VERIFY_URL || LINE_VERIFY_URL,
  fetchImpl = globalThis.fetch,
  now = currentUnixSeconds,
} = {}) {
  if (typeof idToken !== "string" || !idToken.trim() || idToken.length > 8192) {
    throw authError("LINE_TOKEN_INVALID", "LINE token is invalid");
  }
  if (typeof channelId !== "string" || !channelId.trim()) {
    throw authError("LINE_AUTH_CONFIG_MISSING", "LINE channel configuration is missing");
  }
  if (typeof fetchImpl !== "function") {
    throw authError("LINE_AUTH_UNAVAILABLE", "LINE verification is unavailable");
  }

  let response;
  try {
    response = await fetchImpl(verifyUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    });
  } catch {
    throw authError("LINE_AUTH_UNAVAILABLE", "LINE verification is unavailable");
  }
  if (!response.ok) {
    throw authError("LINE_TOKEN_INVALID", "LINE token is invalid");
  }

  let claims;
  try {
    claims = await response.json();
  } catch {
    throw authError("LINE_TOKEN_INVALID", "LINE token is invalid");
  }
  assertTokenClaims(claims, channelId, Number(now()));
  return {
    lineUserId: claims.sub,
    displayName: typeof claims.name === "string" ? claims.name : "",
    pictureUrl: typeof claims.picture === "string" ? claims.picture : "",
  };
}

function rowToAppUser(row) {
  if (!row || typeof row !== "object" || typeof row.id !== "string" || typeof row.line_user_id !== "string") {
    throw authError("APP_USER_NOT_FOUND", "ไม่พบผู้ใช้ในระบบ");
  }
  const role = row.status === "active" && VALID_ROLES.has(row.app_user_roles?.[0]?.role_code)
    ? row.app_user_roles[0].role_code
    : "";
  return {
    id: row.id,
    lineUserId: row.line_user_id,
    displayName: typeof row.display_name === "string" ? row.display_name : "",
    pictureUrl: typeof row.picture_url === "string" ? row.picture_url : "",
    status: row.status,
    role,
  };
}

async function resolveLineAppUser({
  client,
  lineProfile,
  now = () => new Date().toISOString(),
  request = supabaseRequest,
} = {}) {
  if (!lineProfile || typeof lineProfile.lineUserId !== "string" || !lineProfile.lineUserId) {
    throw authError("LINE_PROFILE_INVALID", "LINE profile is invalid");
  }
  const lineUserId = encodeURIComponent(lineProfile.lineUserId);
  await request(client, `/rest/v1/app_users?on_conflict=line_user_id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: {
      line_user_id: lineProfile.lineUserId,
      display_name: String(lineProfile.displayName || ""),
      picture_url: String(lineProfile.pictureUrl || ""),
      last_login_at: now(),
      updated_at: now(),
    },
  });
  const rows = await request(
    client,
    `/rest/v1/app_users?select=id,line_user_id,display_name,picture_url,status,app_user_roles(role_code)&line_user_id=eq.${lineUserId}&limit=1`,
    {},
  );
  return rowToAppUser(Array.isArray(rows) ? rows[0] : null);
}

module.exports = {
  LINE_VERIFY_URL,
  resolveLineAppUser,
  verifyLineIdToken,
};
