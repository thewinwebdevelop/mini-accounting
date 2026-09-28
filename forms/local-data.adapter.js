const { createSupabaseAdminClient } = require("./supabase.logic.js");
const { createDataAdapter } = require("./data-adapter.logic.js");
const { resolveDataBackendMode } = require("./data-backend.logic.js");
const inventory = require("./inventory.logic.js");
const { createSupabaseDataRepository } = require("./supabase-data.logic.js");
const {
  buildCloudInventoryBalances,
  buildCloudInventoryDashboard,
  buildCloudInventoryStockGroups,
  buildCloudStockCard,
  buildCloudStockInReport,
} = require("./inventory-cloud-read.logic.js");

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
  const cloudInventoryRead = async () => {
    const [products, stockSkus, movements] = await Promise.all([
      cloud.listProducts({ search: "" }),
      cloud.listStockSkus({ search: "" }),
      cloud.listInventoryStockMovements(),
    ]);
    return { products, stockSkus, movements };
  };
  const cloudWithInventoryReads = Object.freeze({
    ...cloud,
    listInventoryBalances: async () => {
      const snapshot = await cloudInventoryRead();
      return buildCloudInventoryBalances(snapshot);
    },
    listInventoryStockGroups: async filters => {
      const snapshot = await cloudInventoryRead();
      return buildCloudInventoryStockGroups({ ...snapshot, filters });
    },
    getInventoryDashboard: async () => {
      const snapshot = await cloudInventoryRead();
      const balances = buildCloudInventoryBalances(snapshot);
      return {
        summary: buildCloudInventoryDashboard({ balances }),
        latestStockIn: buildCloudStockInReport({ ...snapshot, limit: 10 }),
      };
    },
    listStockInReport: async filters => {
      const snapshot = await cloudInventoryRead();
      return buildCloudStockInReport({ ...snapshot, limit: filters?.limit });
    },
    getStockCard: async stockSkuId => {
      const snapshot = await cloudInventoryRead();
      return buildCloudStockCard({ ...snapshot, stockSkuId });
    },
  });
  return createDataAdapter({
    local,
    cloud: cloudWithInventoryReads,
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
