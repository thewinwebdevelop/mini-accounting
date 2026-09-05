window.addEventListener("DOMContentLoaded", () => {
  const state = {
    products: [],
    stockSkus: [],
  };

  const statusBox = document.querySelector("#inventoryLedgerStatus");
  const productRows = document.querySelector("#productRows");
  const skuRows = document.querySelector("#skuRows");
  const balanceRows = document.querySelector("#balanceRows");
  const stockCardRows = document.querySelector("#stockCardRows");
  const stockCardSkuSelect = document.querySelector("#stockCardSkuSelect");

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function api(route, options = {}) {
    const response = await fetch(route, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {}),
      },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "โหลดข้อมูลไม่สำเร็จ");
    return result;
  }

  function option(label, value) {
    const node = document.createElement("option");
    node.value = value;
    node.textContent = label;
    return node;
  }

  function skuLabel(sku) {
    return `${sku.sku} - ${sku.productName} ${sku.color || ""} ${sku.size || ""}`.trim();
  }

  function statusLabel(status) {
    return status === "inactive" ? "ปิดใช้" : "ใช้งาน";
  }

  function renderStatus(status) {
    const css = status === "inactive" ? "status-pill inactive" : "status-pill";
    return `<span class="${css}">${statusLabel(status)}</span>`;
  }

  function setStatus(message, kind = "") {
    statusBox.className = `status-box active ${kind}`;
    statusBox.textContent = message;
  }

  function clearStatus() {
    statusBox.className = "status-box";
    statusBox.textContent = "";
  }

  function renderProducts() {
    productRows.innerHTML = state.products.map((product) => `
      <tr>
        <td>${escapeHtml(product.productCode)}</td>
        <td>${escapeHtml(product.name)}</td>
        <td>${escapeHtml(product.category)}</td>
        <td>${renderStatus(product.status)}</td>
        <td><a class="button secondary" href="/inventory-product-detail?productId=${encodeURIComponent(product.id)}">รายละเอียด</a></td>
      </tr>
    `).join("") || `<tr><td colspan="5">ยังไม่มีสินค้าแม่</td></tr>`;
  }

  function renderSkus() {
    skuRows.innerHTML = state.stockSkus.map((sku) => `
      <tr>
        <td>${escapeHtml(sku.sku)}</td>
        <td>${escapeHtml(sku.productName)}</td>
        <td>${escapeHtml(sku.color)}</td>
        <td>${escapeHtml(sku.size)}</td>
        <td class="number">${escapeHtml(sku.defaultUnitCost)}</td>
        <td>${renderStatus(sku.status)}</td>
        <td><a class="button secondary" href="/inventory-product-detail?productId=${encodeURIComponent(sku.productId)}">รายละเอียด</a></td>
      </tr>
    `).join("") || `<tr><td colspan="7">ยังไม่มี Stock SKU</td></tr>`;
  }

  function renderSkuOptions() {
    const activeSkus = state.stockSkus.filter((sku) => sku.status !== "inactive");
    stockCardSkuSelect.replaceChildren(
      option("เลือก SKU", ""),
      ...activeSkus.map((sku) => option(skuLabel(sku), sku.id)),
    );
    window.SearchableSelect?.enhance(stockCardSkuSelect);
  }

  function renderBalances(balances) {
    balanceRows.innerHTML = balances.map((row) => `
      <tr>
        <td>${escapeHtml(row.sku)}</td>
        <td>${escapeHtml(row.productName)}</td>
        <td>${escapeHtml(row.color)}</td>
        <td>${escapeHtml(row.size)}</td>
        <td class="number">${row.quantityOnHand}</td>
        <td class="number">${row.reservedQuantity || 0}</td>
        <td class="number">${row.availableQuantity || 0}</td>
        <td class="number">${escapeHtml(row.averageUnitCost)}</td>
        <td class="number">${escapeHtml(row.inventoryValue)}</td>
      </tr>
    `).join("") || `<tr><td colspan="9">ยังไม่มีข้อมูลสต๊อก</td></tr>`;
  }

  async function refreshProducts() {
    const { products } = await api("/api/inventory/products");
    state.products = products;
    renderProducts();
  }

  async function refreshSkus() {
    const { stockSkus } = await api("/api/inventory/stock-skus");
    state.stockSkus = stockSkus;
    renderSkus();
    renderSkuOptions();
  }

  async function refreshBalances() {
    const { balances } = await api("/api/inventory/balances");
    renderBalances(balances);
  }

  async function refreshStockCard() {
    const stockSkuId = stockCardSkuSelect.value;
    if (!stockSkuId) {
      stockCardRows.innerHTML = `<tr><td colspan="8">เลือก SKU เพื่อดู stock card</td></tr>`;
      return;
    }

    const card = await api(`/api/inventory/stock-card?stockSkuId=${encodeURIComponent(stockSkuId)}`);
    stockCardRows.innerHTML = card.movements.map((row) => `
      <tr>
        <td>${escapeHtml(row.movementDate)}</td>
        <td>${escapeHtml(row.movementNo)}</td>
        <td>${escapeHtml(row.movementType)}</td>
        <td class="number">${row.quantity}</td>
        <td class="number">${escapeHtml(row.unitCost)}</td>
        <td class="number">${escapeHtml(row.totalCost)}</td>
        <td class="number">${row.runningQuantity}</td>
        <td>${escapeHtml([row.referenceType, row.referenceNo].filter(Boolean).join(": "))}</td>
      </tr>
    `).join("") || `<tr><td colspan="8">ยังไม่มี movement</td></tr>`;
  }

  async function refreshAll() {
    clearStatus();
    await refreshProducts();
    await refreshSkus();
    await refreshBalances();
    await refreshStockCard();
  }

  stockCardSkuSelect.addEventListener("change", () => refreshStockCard().catch((error) => setStatus(error.message, "error")));
  document.querySelector("#refreshInventoryLedger").addEventListener("click", () => refreshAll().catch((error) => setStatus(error.message, "error")));

  refreshAll().catch((error) => setStatus(error.message, "error"));
});
