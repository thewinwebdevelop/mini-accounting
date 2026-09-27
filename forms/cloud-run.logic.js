function truthy(value) {
  return /^(1|true|yes)$/i.test(String(value || "").trim());
}

function isCloudRunEnvironment(env = process.env) {
  return Boolean(String(env.K_SERVICE || "").trim()) || truthy(env.CLOUD_RUN);
}

function resolveRuntimeRoot({ env = process.env, appDir } = {}) {
  if (String(env.SWEET_HOUSE_ROOT_DIR || "").trim()) return String(env.SWEET_HOUSE_ROOT_DIR).trim();
  return isCloudRunEnvironment(env) ? "/tmp/sweet-house" : appDir;
}

function resolveListenHost(env = process.env) {
  if (isCloudRunEnvironment(env)) return "0.0.0.0";
  return truthy(env.SWEET_HOUSE_ALLOW_NETWORK) ? "0.0.0.0" : "127.0.0.1";
}

function buildCloudRuntimeEnv(env = process.env) {
  if (!isCloudRunEnvironment(env)) return env;
  return {
    ...env,
    DATA_BACKEND: env.DATA_BACKEND || "supabase-read",
    DATA_BACKEND_DOCUMENTS: env.DATA_BACKEND_DOCUMENTS || "supabase-read",
    DATA_BACKEND_INVENTORY: env.DATA_BACKEND_INVENTORY || "supabase-read",
    DATA_BACKEND_FILES: env.DATA_BACKEND_FILES || "supabase-read",
    LINE_INTAKE_BACKEND: env.LINE_INTAKE_BACKEND || "supabase",
    SWEET_HOUSE_AUTH_MODE: env.SWEET_HOUSE_AUTH_MODE || "line",
  };
}

function cloudRuntimeError(message) {
  const error = new Error(message);
  error.code = "CLOUD_RUN_PERSISTENCE_CONFIG_INVALID";
  return error;
}

function assertCloudRuntimeConfig(env = process.env) {
  if (!isCloudRunEnvironment(env)) return env;
  const modes = [
    ["DATA_BACKEND", env.DATA_BACKEND],
    ["DATA_BACKEND_DOCUMENTS", env.DATA_BACKEND_DOCUMENTS],
    ["DATA_BACKEND_INVENTORY", env.DATA_BACKEND_INVENTORY],
    ["DATA_BACKEND_FILES", env.DATA_BACKEND_FILES],
  ];
  for (const [name, value] of modes) {
    if (String(value || "").trim().toLowerCase() !== "supabase-read") {
      throw cloudRuntimeError(`${name} must be supabase-read in Cloud Run`);
    }
  }
  if (String(env.LINE_INTAKE_BACKEND || "").trim().toLowerCase() !== "supabase") {
    throw cloudRuntimeError("LINE_INTAKE_BACKEND must be supabase in Cloud Run");
  }
  if (String(env.DATA_BACKEND_FALLBACK || "").trim().toLowerCase() === "local") {
    throw cloudRuntimeError("DATA_BACKEND_FALLBACK=local is not allowed in Cloud Run");
  }
  if (String(env.SWEET_HOUSE_AUTH_MODE || "").trim().toLowerCase() !== "line") {
    throw cloudRuntimeError("SWEET_HOUSE_AUTH_MODE must be line in Cloud Run");
  }
  return env;
}

function healthPayload(env = process.env) {
  return {
    ok: true,
    runtime: isCloudRunEnvironment(env) ? "cloud-run" : "local",
    version: String(env.K_REVISION || env.APP_VERSION || "unknown"),
  };
}

module.exports = {
  assertCloudRuntimeConfig,
  buildCloudRuntimeEnv,
  healthPayload,
  isCloudRunEnvironment,
  resolveListenHost,
  resolveRuntimeRoot,
};
