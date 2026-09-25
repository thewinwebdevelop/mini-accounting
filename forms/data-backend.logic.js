const crypto = require("node:crypto");

const BACKEND_MODES = Object.freeze(["local", "shadow", "dual-write", "supabase-read"]);
const BACKEND_MODE_SET = new Set(BACKEND_MODES);

function configurationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolveDataBackendMode(env = process.env, domain = "default") {
  const domainKey = String(domain || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const override = domainKey && domainKey !== "DEFAULT"
    ? env[`DATA_BACKEND_${domainKey}`]
    : undefined;
  const value = String(override ?? env.DATA_BACKEND ?? "local").trim().toLowerCase();
  if (!BACKEND_MODE_SET.has(value)) {
    throw configurationError("DATA_BACKEND_INVALID", `Unsupported data backend mode: ${value}`);
  }
  return value;
}

function isCloudBackendMode(mode) {
  return mode !== "local";
}

function stableSourceKey(kind, id) {
  const cleanKind = String(kind ?? "").trim();
  const cleanId = String(id ?? "").trim();
  if (!cleanKind || !cleanId) throw configurationError("SOURCE_KEY_INVALID", "Source identity is required");
  return `${cleanKind}:${cleanId}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

module.exports = {
  BACKEND_MODES,
  canonicalHash,
  canonicalize,
  isCloudBackendMode,
  resolveDataBackendMode,
  stableSourceKey,
};
