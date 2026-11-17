const { createSupabaseAdminClient } = require("./supabase.logic.js");
const { createDataAdapter } = require("./data-adapter.logic.js");
const { resolveDataBackendMode } = require("./data-backend.logic.js");
const inventory = require("./inventory.logic.js");
const { createSupabaseDataRepository } = require("./supabase-data.logic.js");
const { createInventoryCloudRepository } = require("./inventory-cloud.repository.js");
function createLocalDataAdapter(rootDir) {
  return Object.freeze({
    listProducts: filters => inventory.listProducts(rootDir, filters),
    saveProduct: payload => (payload.id ? inventory.updateProduct(rootDir, payload.id, payload) : inventory.createProduct(rootDir, payload)),
    listStockSkus: filters => inventory.listStockSkus(rootDir, filters),
    listInventoryBalances: () => inventory.listInventoryBalances(rootDir),
    listInventoryStockGroups: filters => inventory.listInventoryStockGroups(rootDir, filters),
    getInventoryDashboard: () => ({
      summary: inventory.getInventoryDashboardSummary(rootDir),
      latestStockIn: inventory.listStockInReport(rootDir, { limit: 10 }),
    }),
    listStockInReport: filters => inventory.listStockInReport(rootDir, filters),
    getStockCard: stockSkuId => inventory.getStockCard(rootDir, stockSkuId),
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
  const inventoryCloud = createInventoryCloudRepository({ client: supabaseClient });
  const cloudWithInventoryReads = Object.freeze({
    ...cloud,
    saveProduct: (payload, options = {}) => inventoryCloud.saveProduct(payload, { creating: options.creating ?? !payload.id }),
    saveStockSku: (payload, options = {}) => inventoryCloud.saveStockSku(payload, { creating: options.creating ?? !payload.id }),
    listInventoryBalances: inventoryCloud.listInventoryBalances,
    listInventoryStockGroups: inventoryCloud.listInventoryStockGroups,
    getInventoryDashboard: inventoryCloud.getInventoryDashboard,
    listStockInReport: inventoryCloud.listStockInReport,
    getStockCard: inventoryCloud.getStockCard,
  });
  return createDataAdapter({
    local,
    cloud: cloudWithInventoryReads,
    mode,
    domain: "inventory",
    logger,
    fallbackOnCloudError: String(env.DATA_BACKEND_FALLBACK || "").toLowerCase() === "local",
    prepareCloudWrite: {
      saveProduct: (result, args) => [result, { creating: !args[0]?.id }],
      saveStockSku: (result, args) => [result, { creating: !args[0]?.id }],
    },
  });
}

module.exports = { createInventoryDataAdapter, createLocalDataAdapter };
