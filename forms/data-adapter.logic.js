const { canonicalHash } = require("./data-backend.logic.js");

function adapterError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function sourceKeyOf(value, fallback) {
  if (!value || typeof value !== "object") return fallback;
  return value.sourceKey ?? value.source_key ?? value.id ?? fallback;
}

function compareResults(localValue, cloudValue) {
  if (Array.isArray(localValue) && Array.isArray(cloudValue)) {
    const localHashes = new Map(localValue.map((item, index) => [String(sourceKeyOf(item, index)), canonicalHash(item)]));
    const cloudHashes = new Map(cloudValue.map((item, index) => [String(sourceKeyOf(item, index)), canonicalHash(item)]));
    const missing = [...localHashes.keys()].filter(key => !cloudHashes.has(key));
    const extra = [...cloudHashes.keys()].filter(key => !localHashes.has(key));
    const mismatches = [...localHashes.keys()].filter(key => cloudHashes.has(key) && localHashes.get(key) !== cloudHashes.get(key));
    return { equal: missing.length === 0 && extra.length === 0 && mismatches.length === 0, missing, extra, mismatches };
  }
  return {
    equal: canonicalHash(localValue) === canonicalHash(cloudValue),
    missing: [],
    extra: [],
    mismatches: canonicalHash(localValue) === canonicalHash(cloudValue) ? [] : ["result"],
  };
}

function safeShadowEvent(domain, method, comparison) {
  const parts = [];
  if (comparison.missing.length) parts.push(`${comparison.missing.length} missing`);
  if (comparison.extra.length) parts.push(`${comparison.extra.length} extra`);
  if (comparison.mismatches.length) parts.push(`${comparison.mismatches.length} hash mismatch`);
  return {
    type: "data-shadow-diff",
    domain,
    method,
    summary: parts.join(", "),
    counts: {
      missing: comparison.missing.length,
      extra: comparison.extra.length,
      mismatches: comparison.mismatches.length,
    },
  };
}

function assertRepositoryMethod(repository, method, role) {
  if (!repository || typeof repository[method] !== "function") {
    throw adapterError("DATA_ADAPTER_METHOD_MISSING", `${role} adapter does not implement ${method}`);
  }
}

function createDataAdapter({ local, cloud = null, mode = "local", domain = "default", logger = () => {}, fallbackOnCloudError = false, prepareCloudWrite = {} } = {}) {
  if (!["local", "shadow", "dual-write", "supabase-read"].includes(mode)) {
    throw adapterError("DATA_BACKEND_INVALID", `Unsupported data backend mode: ${mode}`);
  }
  if (!local) throw adapterError("DATA_LOCAL_ADAPTER_MISSING", "Local data adapter is required");

  async function read(method, ...args) {
    assertRepositoryMethod(local, method, "local");
    if (mode === "local") return local[method](...args);
    assertRepositoryMethod(cloud, method, "cloud");

    if (mode === "shadow") {
      const localResult = await local[method](...args);
      try {
        const cloudResult = await cloud[method](...args);
        const comparison = compareResults(localResult, cloudResult);
        if (!comparison.equal) logger(safeShadowEvent(domain, method, comparison));
      } catch (error) {
        logger({ type: "data-shadow-cloud-error", domain, method, code: error?.code || "CLOUD_ERROR" });
      }
      return localResult;
    }

    try {
      return await cloud[method](...args);
    } catch (error) {
      if (!fallbackOnCloudError) throw error;
      logger({ type: "data-cloud-fallback", domain, method, code: error?.code || "CLOUD_ERROR" });
      return local[method](...args);
    }
  }

  async function write(method, ...args) {
    assertRepositoryMethod(local, method, "local");
    if (mode === "local" || mode === "shadow") return local[method](...args);

    assertRepositoryMethod(cloud, method, "cloud");
    if (mode === "supabase-read") return cloud[method](...args);

    const localResult = await local[method](...args);
    const cloudArgs = typeof prepareCloudWrite[method] === "function"
      ? prepareCloudWrite[method](localResult, args)
      : args;
    try {
      await cloud[method](...cloudArgs);
    } catch (error) {
      throw adapterError("DATA_CLOUD_WRITE_FAILED", "Cloud data write failed; retry is required", { retryable: true, causeCode: error?.code || "CLOUD_ERROR" });
    }
    return localResult;
  }

  return Object.freeze({ mode, domain, read, write });
}

module.exports = { compareResults, createDataAdapter };
