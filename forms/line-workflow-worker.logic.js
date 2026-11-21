"use strict";

const {
  createPublicKey,
  verify
} = require('node:crypto');
let keysCache = null;
async function verifyWorkerToken(token, {
  audience,
  email,
  now = Math.floor(Date.now() / 1000),
  fetchImpl = fetch
} = {}) {
  const denied = () => {
    throw Object.assign(new Error('Worker identity denied'), {
      statusCode: 401
    });
  };
  if (!audience || !email || typeof token !== 'string' || token.length > 16384) denied();
  const parts = token.split('.');
  if (parts.length !== 3) denied();
  let h, p;
  try {
    h = JSON.parse(Buffer.from(parts[0], 'base64url'));
    p = JSON.parse(Buffer.from(parts[1], 'base64url'));
  } catch {
    denied();
  }
  if (h.alg !== 'RS256' || !h.kid || !['https://accounts.google.com', 'accounts.google.com'].includes(p.iss) || p.aud !== audience || p.email !== email || p.email_verified !== true || !p.sub || !Number.isFinite(p.exp) || p.exp <= now || !Number.isFinite(p.iat) || p.iat > now + 60) denied();
  // Google OIDC verification: https://developers.google.com/identity/openid-connect/openid-connect
  if (!keysCache || keysCache.until <= Date.now() || !keysCache.keys.some(k => k.kid === h.kid) || keysCache.fetchImpl !== fetchImpl) {
    const r = await fetchImpl('https://www.googleapis.com/oauth2/v3/certs', {
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) denied();
    const data = await r.json();
    keysCache = {
      keys: Array.isArray(data.keys) ? data.keys : [],
      until: Date.now() + 3600000,
      fetchImpl
    };
  }
  const jwk = keysCache.keys.find(k => k.kid === h.kid && k.kty === 'RSA');
  if (!jwk) denied();
  try {
    if (!verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), createPublicKey({
      key: jwk,
      format: 'jwk'
    }), Buffer.from(parts[2], 'base64url'))) denied();
  } catch {
    denied();
  }
  return p;
}
module.exports = {
  verifyWorkerToken
};
