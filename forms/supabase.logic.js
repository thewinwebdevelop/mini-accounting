const DEFAULT_FETCH = globalThis.fetch;

function createCodeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertSupabaseConfiguration(env = process.env) {
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceRoleKey) {
    throw createCodeError(
      "SUPABASE_CONFIG_MISSING",
      "Supabase server configuration is missing",
    );
  }
  try {
    const parsed = new URL(url);
    if (!parsed.protocol.startsWith("http")) throw new Error("unsupported protocol");
  } catch {
    throw createCodeError("SUPABASE_CONFIG_INVALID", "Supabase URL is invalid");
  }
  return { url, serviceRoleKey };
}

function createSupabaseAdminClient({
  url = process.env.SUPABASE_URL,
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
  fetchImpl = DEFAULT_FETCH,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw createCodeError("SUPABASE_FETCH_UNAVAILABLE", "Supabase fetch is unavailable");
  }
  const config = assertSupabaseConfiguration({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey });
  return Object.freeze({
    url: config.url,
    serviceRoleKey: config.serviceRoleKey,
    fetchImpl,
  });
}

async function supabaseRequest(client, path, options = {}) {
  if (!client || typeof client.fetchImpl !== "function") {
    throw createCodeError("SUPABASE_CLIENT_INVALID", "Supabase client is invalid");
  }
  const route = String(path || "");
  if (!route.startsWith("/")) {
    throw createCodeError("SUPABASE_PATH_INVALID", "Supabase path is invalid");
  }

  const headers = {
    Accept: "application/json",
    ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    ...(options.headers || {}),
    apikey: client.serviceRoleKey,
    Authorization: `Bearer ${client.serviceRoleKey}`,
  };
  const response = await client.fetchImpl(`${client.url}${route}`, {
    ...options,
    headers,
    body: options.body === undefined || typeof options.body === "string"
      ? options.body
      : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    throw createCodeError(
      "SUPABASE_REQUEST_FAILED",
      `Supabase request failed with status ${response.status}`,
    );
  }
  return data;
}

module.exports = {
  assertSupabaseConfiguration,
  createSupabaseAdminClient,
  supabaseRequest,
};
