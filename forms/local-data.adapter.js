const { createSupabaseAdminClient } = require("./supabase.logic.js");
const { createDataAdapter } = require("./data-adapter.logic.js");
const { resolveDataBackendMode } = require("./data-backend.logic.js");
const inventory = require("./inventory.logic.js");
const { createSupabaseDataRepository } = require("./supabase-data.logic.js");

function createLocalDataAdapter(rootDir) {
  return Object.freeze({
    listProducts: filters => inventory.listProducts(rootDir, filters),
    saveProduct: payload => (payload.id ? inventory.updateProduct(rootDir, payload.id, payload) : inventory.createProduct(rootDir, payload)),
    listStockSkus: filters => inventory.listStockSkus(rootDir, filters),
    saveStockSku: payload => (payload.id ? inventory.updateStockSku(rootDir, payload.id, payload) : inventory.createStockSku(rootDir, payload)),
  });
}

function createInventoryDataAdapter({ rootDir, env = process.env, client, logger = () => {} } = {}) {
  const mode = resolveDataBackendMode(env, "inventory");
  const local = createLocalDataAdapter(rootDir);
  if (mode === "local") return createDataAdapter({ local, mode, domain: "inventory", logger });

  const supabaseClient = client || createSupabaseAdminClient({
    url: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  });
  const cloud = createSupabaseDataRepository({ client: supabaseClient });
  return createDataAdapter({
    local,
    cloud,
    mode,
    domain: "inventory",
    logger,
    fallbackOnCloudError: String(env.DATA_BACKEND_FALLBACK || "").toLowerCase() === "local",
    prepareCloudWrite: {
      saveProduct: result => [result],
      saveStockSku: result => [result],
    },
  });
}

module.exports = { createInventoryDataAdapter, createLocalDataAdapter };
