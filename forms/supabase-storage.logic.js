const { assertSupabaseConfiguration } = require("./supabase.logic.js");

const DEFAULT_FETCH = globalThis.fetch;
const DEFAULT_BUCKET = "sweet-house-files";

function createStorageError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertBucketName(bucket) {
  const value = String(bucket || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(value)) {
    throw createStorageError("SUPABASE_STORAGE_BUCKET_INVALID", "Supabase Storage bucket is invalid");
  }
  return value;
}

function assertObjectPath(objectPath) {
  const value = String(objectPath || "");
  if (!value || value.includes("\0") || value.includes("\\") || value.startsWith("/")) {
    throw createStorageError("SUPABASE_STORAGE_PATH_INVALID", "Supabase Storage object path is invalid");
  }
  const segments = value.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === "..")) {
    throw createStorageError("SUPABASE_STORAGE_PATH_INVALID", "Supabase Storage object path is invalid");
  }
  return value;
}

function encodeObjectPath(objectPath) {
  return assertObjectPath(objectPath).split("/").map(encodeURIComponent).join("/");
}

function encodeStoragePathSegment(segment) {
  return encodeURIComponent(segment).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function storageObjectPath(objectPath) {
  return assertObjectPath(objectPath).split("/").map(encodeStoragePathSegment).join("/");
}

function createSupabaseStorageClient({
  url = process.env.SUPABASE_URL,
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
  bucket = process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET,
  fetchImpl = DEFAULT_FETCH,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw createStorageError("SUPABASE_FETCH_UNAVAILABLE", "Supabase fetch is unavailable");
  }
  const config = assertSupabaseConfiguration({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey });
  return Object.freeze({
    url: config.url,
    serviceRoleKey: config.serviceRoleKey,
    bucket: assertBucketName(bucket),
    fetchImpl,
  });
}

async function storageRequest(client, objectPath, options = {}) {
  if (!client || typeof client.fetchImpl !== "function") {
    throw createStorageError("SUPABASE_STORAGE_CLIENT_INVALID", "Supabase Storage client is invalid");
  }
  const method = String(options.method || "GET").toUpperCase();
  const headers = {
    Accept: "*/*",
    ...(options.headers || {}),
    ...(options.body !== undefined && options.contentType ? { "content-type": options.contentType } : {}),
    apikey: client.serviceRoleKey,
    Authorization: `Bearer ${client.serviceRoleKey}`,
  };
  const response = await client.fetchImpl(
    `${client.url}/storage/v1/object/${encodeURIComponent(client.bucket)}/${encodeObjectPath(objectPath)}`,
    {
      ...options,
      method,
      headers,
      body: options.body,
    },
  );
  if (!response.ok) {
    throw createStorageError(
      "SUPABASE_STORAGE_REQUEST_FAILED",
      `Supabase Storage request failed with status ${response.status}`,
    );
  }
  return response;
}

async function uploadStorageObject(client, { objectPath, body, contentType = "application/octet-stream", headers = {} } = {}) {
  if (!(Buffer.isBuffer(body) || body instanceof Uint8Array)) {
    throw createStorageError("SUPABASE_STORAGE_BODY_INVALID", "Supabase Storage body must be bytes");
  }
  const response = await storageRequest(client, objectPath, {
    method: "POST",
    headers: { ...headers, "x-upsert": "true" },
    contentType,
    body,
  });
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function downloadStorageObject(client, objectPath) {
  const response = await storageRequest(client, objectPath, { method: "GET" });
  return Buffer.from(await response.arrayBuffer());
}

module.exports = {
  DEFAULT_BUCKET,
  assertBucketName,
  assertObjectPath,
  createSupabaseStorageClient,
  downloadStorageObject,
  storageObjectPath,
  storageRequest,
  uploadStorageObject,
};
