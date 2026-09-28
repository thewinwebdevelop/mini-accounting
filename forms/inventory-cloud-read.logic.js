const IN_TYPES = new Set(["purchase_in", "return_in", "adjustment_in"]);
const OUT_TYPES = new Set(["sale_out", "adjustment_out"]);

function money(value) {
  return Number(value || 0).toFixed(2);
}

function movementDirection(type) {
  if (IN_TYPES.has(type)) return 1;
  if (OUT_TYPES.has(type)) return -1;
  return 0;
}

function productById(products = []) {
  return new Map(products.map(product => [Number(product.id), product]));
}

function skuById(stockSkus = []) {
  return new Map(stockSkus.map(sku => [Number(sku.id), sku]));
}

function movementSkuId(row) {
  return Number(row.stock_sku_source_id ?? row.stock_sku_id ?? 0);
}

function publicMovement(row, sku, product, runningQuantity = null) {
  return {
    id: Number(row.source_id ?? row.id),
    movementNo: row.movement_no,
    stockSkuId: movementSkuId(row),
    movementType: row.movement_type,
    movementDate: row.movement_date,
    quantity: Number(row.quantity || 0),
    unitCost: money(row.unit_cost),
    totalCost: money(row.total_cost),
    referenceType: row.reference_type,
    referenceNo: row.reference_no,
    note: row.note,
    createdAt: row.created_at,
    runningQuantity,
    sku: sku?.sku || "",
    color: sku?.color || "",
    size: sku?.size || "",
    barcode: sku?.barcode || "",
    productId: product?.id,
    productCode: product?.productCode || "",
    productName: product?.name || "",
    category: product?.category || "",
  };
}

function balanceForSku(sku, movementRows, reservedQuantity = 0) {
  let quantityOnHand = 0;
  let purchaseQuantity = 0;
  let purchaseTotalCost = 0;
  for (const row of movementRows) {
    quantityOnHand += movementDirection(row.movement_type) * Number(row.quantity || 0);
    if (row.movement_type === "purchase_in") {
      purchaseQuantity += Number(row.quantity || 0);
      purchaseTotalCost += Number(row.total_cost || 0);
    }
  }
  const averageUnitCost = purchaseQuantity ? purchaseTotalCost / purchaseQuantity : 0;
  const reserved = Number(reservedQuantity || 0);
  return {
    ...sku,
    quantityOnHand,
    reservedQuantity: reserved,
    availableQuantity: quantityOnHand - reserved,
    averageUnitCost: money(averageUnitCost),
    inventoryValue: money(quantityOnHand * averageUnitCost),
  };
}

function buildCloudInventoryBalances({ stockSkus = [], movements = [], reservedQuantities = {} } = {}) {
  const bySku = new Map();
  for (const row of movements) {
    const id = movementSkuId(row);
    if (!bySku.has(id)) bySku.set(id, []);
    bySku.get(id).push(row);
  }
  return stockSkus.map(sku => balanceForSku(sku, bySku.get(Number(sku.id)) || [], reservedQuantities[sku.id] || 0));
}

function matchesSearch(product, children, search = "") {
  const term = String(search || "").trim().toLowerCase();
  if (!term) return true;
  return [product.productCode, product.name, product.category, product.description,
    ...children.flatMap(sku => [sku.sku, sku.color, sku.size, sku.barcode])]
    .join(" ").toLowerCase().includes(term);
}

function buildCloudInventoryStockGroups({ products = [], stockSkus = [], movements = [], filters = {} } = {}) {
  const productMap = productById(products);
  const balances = buildCloudInventoryBalances({ stockSkus, movements });
  const balanceMap = new Map(balances.map(sku => [Number(sku.id), sku]));
  const grouped = new Map();
  for (const product of products) {
    grouped.set(Number(product.id), {
      id: product.id,
      productCode: product.productCode,
      name: product.name,
      category: product.category,
      description: product.description,
      imagePath: product.imagePath || "",
      imageUrl: product.imageUrl || "",
      status: product.status,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      childCount: 0,
      totalQuantityOnHand: 0,
      totalReservedQuantity: 0,
      totalAvailableQuantity: 0,
      totalInventoryValue: "0.00",
      children: [],
    });
  }
  for (const sku of stockSkus) {
    const product = productMap.get(Number(sku.productId));
    if (!product || (filters.category && product.category !== filters.category)) continue;
    const balance = balanceMap.get(Number(sku.id));
    const child = { ...balance, productCode: product.productCode, productName: product.name };
    grouped.get(Number(product.id)).children.push(child);
  }
  return [...grouped.values()].map(group => {
    const stockStatus = String(filters.stockStatus || filters.stock || "all");
    const children = group.children.filter(child => {
      if (!matchesSearch(group, [child], filters.search)) return false;
      if (stockStatus === "in_stock") return child.quantityOnHand > 0;
      if (stockStatus === "zero") return child.quantityOnHand === 0;
      return true;
    });
    return {
      ...group,
      childCount: children.length,
      totalQuantityOnHand: children.reduce((sum, child) => sum + child.quantityOnHand, 0),
      totalReservedQuantity: children.reduce((sum, child) => sum + child.reservedQuantity, 0),
      totalAvailableQuantity: children.reduce((sum, child) => sum + child.availableQuantity, 0),
      totalInventoryValue: money(children.reduce((sum, child) => sum + Number(child.inventoryValue || 0), 0)),
      children,
    };
  }).filter(group => group.children.length > 0 || (matchesSearch(group, [], filters.search) && String(filters.stockStatus || filters.stock || "all") === "all"));
}

function buildCloudInventoryDashboard({ balances = [], asOfDate = new Date().toISOString().slice(0, 10) } = {}) {
  const totalQuantityOnHand = balances.reduce((sum, sku) => sum + Number(sku.quantityOnHand || 0), 0);
  const totalReservedQuantity = balances.reduce((sum, sku) => sum + Number(sku.reservedQuantity || 0), 0);
  return {
    asOfDate,
    stockSkuCount: balances.length,
    totalQuantityOnHand,
    totalReservedQuantity,
    totalAvailableQuantity: totalQuantityOnHand - totalReservedQuantity,
    zeroQuantitySkuCount: balances.filter(sku => Number(sku.quantityOnHand || 0) === 0).length,
    totalInventoryValue: money(balances.reduce((sum, sku) => sum + Number(sku.inventoryValue || 0), 0)),
  };
}

function buildCloudStockInReport({ products = [], stockSkus = [], movements = [], limit = 10 } = {}) {
  const productsMap = productById(products);
  const skusMap = skuById(stockSkus);
  return movements
    .filter(row => row.movement_type === "purchase_in")
    .sort((a, b) => `${b.movement_date}:${b.movement_no}`.localeCompare(`${a.movement_date}:${a.movement_no}`))
    .slice(0, Math.max(1, Math.min(Number.parseInt(String(limit), 10) || 10, 500)))
    .map(row => publicMovement(row, skusMap.get(movementSkuId(row)), productsMap.get(Number(skusMap.get(movementSkuId(row))?.productId))));
}

function buildCloudStockCard({ products = [], stockSkus = [], movements = [], stockSkuId } = {}) {
  const id = Number(stockSkuId);
  const sku = stockSkus.find(item => Number(item.id) === id);
  if (!sku) throw new Error("ไม่พบ SKU");
  const product = productById(products).get(Number(sku.productId));
  const rows = movements.filter(row => movementSkuId(row) === id).sort((a, b) => `${a.movement_date}:${a.movement_no}`.localeCompare(`${b.movement_date}:${b.movement_no}`));
  let runningQuantity = 0;
  const mapped = rows.map(row => {
    runningQuantity += movementDirection(row.movement_type) * Number(row.quantity || 0);
    return publicMovement(row, sku, product, runningQuantity);
  });
  const balances = buildCloudInventoryBalances({ stockSkus: [sku], movements: rows });
  return { sku: { ...sku, productCode: product?.productCode || "", productName: product?.name || "" }, movements: mapped, balance: balances[0] };
}

module.exports = {
  buildCloudInventoryBalances,
  buildCloudInventoryDashboard,
  buildCloudInventoryStockGroups,
  buildCloudStockCard,
  buildCloudStockInReport,
};
