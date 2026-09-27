function cleanText(value) {
  return String(value ?? "").trim();
}

function stockSkuIdOf(stockSku = {}) {
  return cleanText(stockSku.id);
}

function stockSkuReferenceOf(line = {}) {
  return cleanText(line.stockSkuId);
}

function isUsableStockSku(stockSku = {}) {
  return cleanText(stockSku.status) !== "inactive";
}

function validateStockSkuReferences(lines = [], stockSkus = []) {
  const knownIds = new Set(
    (Array.isArray(stockSkus) ? stockSkus : [])
      .filter(isUsableStockSku)
      .map(stockSku => stockSkuIdOf(stockSku))
      .filter(Boolean),
  );
  return (Array.isArray(lines) ? lines : []).flatMap((line, index) => {
    const stockSkuId = stockSkuReferenceOf(line);
    return stockSkuId && !knownIds.has(stockSkuId)
      ? [`รายการ ${index + 1}: ไม่พบ Stock SKU ที่ใช้งานอยู่`]
      : [];
  });
}

function stockSkuLabel(stockSku = {}) {
  return [stockSku.sku, stockSku.productName].filter(Boolean).join(" - ") || `Stock SKU ${stockSku.id}`;
}

const api = { cleanText, isUsableStockSku, stockSkuIdOf, stockSkuReferenceOf, stockSkuLabel, validateStockSkuReferences };

if (typeof window !== "undefined") window.StockLineLogic = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
