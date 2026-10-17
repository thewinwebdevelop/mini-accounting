const { signSession, verifySession } = require("./session.logic.js");

const FILE_ACCESS_TOKEN_PURPOSE = "file-access";

function issueFileAccessToken({ secret, path, auth = {}, ttlSeconds = 600, now = () => Math.floor(Date.now() / 1000) } = {}) {
  const issuedAt = Number(now());
  const expiresAt = issuedAt + Math.max(60, Math.floor(Number(ttlSeconds) || 600));
  return signSession({
    purpose: FILE_ACCESS_TOKEN_PURPOSE,
    path: String(path || ""),
    userId: String(auth.userId || ""),
    lineUserId: String(auth.lineUserId || ""),
    displayName: String(auth.displayName || ""),
    role: String(auth.role || ""),
    iat: issuedAt,
    exp: expiresAt,
  }, secret);
}

function verifyFileAccessToken({ token, secret, path } = {}) {
  try {
    const payload = verifySession(String(token || ""), secret);
    if (payload.purpose !== FILE_ACCESS_TOKEN_PURPOSE || payload.path !== String(path || "")) return null;
    if (!payload.userId || !payload.role) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = { FILE_ACCESS_TOKEN_PURPOSE, issueFileAccessToken, verifyFileAccessToken };
