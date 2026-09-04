window.addEventListener("DOMContentLoaded", () => {
  const state = {
    productCategories: [],
    products: [],
    stockSkus: [],
  };

  const productForm = document.querySelector("#productForm");
  const skuForm = document.querySelector("#skuForm");
  const purchaseInForm = document.querySelector("#purchaseInForm");
  const statusBox = document.querySelector("#inventoryStatus");
  const productRows = document.querySelector("#productRows");
  const skuRows = document.querySelector("#skuRows");
  const balanceRows = document.querySelector("#balanceRows");
  const stockCardRows = document.querySelector("#stockCardRows");
  const skuProductSelect = document.querySelector("#skuProductSelect");
  const productCategorySelect = document.querySelector("#productCategory");
  const purchaseSkuSelect = document.querySelector("#purchaseSkuSelect");
  const stockCardSkuSelect = document.querySelector("#stockCardSkuSelect");
  const productSubmitLabel = document.querySelector("#productSubmitLabel");
  const skuSubmitLabel = document.querySelector("#skuSubmitLabel");

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function todayInputValue() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function setStatus(message, kind = "") {
    statusBox.className = `status-box active ${kind}`;
    statusBox.textContent = message;
  }

  function clearStatus() {
    statusBox.className = "status-box";
    statusBox.textContent = "";
  }

  function formPayload(form) {
    return Object.fromEntries(new FormData(form).entries());
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
    if (!response.ok) throw new Error(result.error || "บันทึกข้อมูลไม่สำเร็จ");
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

  function renderProducts() {
    productRows.innerHTML = state.products.map((product) => `
      <tr>
        <td>${escapeHtml(product.productCode)}</td>
        <td>${escapeHtml(product.name)}</td>
        <td>${escapeHtml(product.category)}</td>
        <td>${renderStatus(product.status)}</td>
        <td><button class="icon-button" type="button" title="แก้ไขสินค้าแม่" data-edit-product="${product.id}">✎</button></td>
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
        <td><button class="icon-button" type="button" title="แก้ไข SKU" data-edit-sku="${sku.id}">✎</button></td>
      </tr>
    `).join("") || `<tr><td colspan="7">ยังไม่มี Stock SKU</td></tr>`;
  }

  function renderProductOptions() {
    const activeProducts = state.products.filter((product) => product.status !== "inactive");
    skuProductSelect.replaceChildren(
      option("เลือกสินค้าแม่", ""),
      ...activeProducts.map((product) => option(`${product.productCode} - ${product.name}`, product.id)),
    );
  }

  function renderProductCategoryOptions() {
    const activeCategories = state.productCategories.filter((category) => category.status !== "inactive");
    productCategorySelect.replaceChildren(
      option("เลือกหมวดสินค้า", ""),
      ...activeCategories.map((category) => option(category.name, category.name)),
    );
  }

  function renderSkuOptions() {
    const activeSkus = state.stockSkus.filter((sku) => sku.status !== "inactive");
    const options = [option("เลือก SKU", ""), ...activeSkus.map((sku) => option(skuLabel(sku), sku.id))];
    purchaseSkuSelect.replaceChildren(...options.map((node) => node.cloneNode(true)));
    stockCardSkuSelect.replaceChildren(...options.map((node) => node.cloneNode(true)));
  }

  function renderBalances(balances) {
    balanceRows.innerHTML = balances.map((row) => `
      <tr>
        <td>${escapeHtml(row.sku)}</td>
        <td>${escapeHtml(row.productName)}</td>
        <td>${escapeHtml(row.color)}</td>
        <td>${escapeHtml(row.size)}</td>
        <td class="number">${row.quantityOnHand}</td>
        <td class="number">${escapeHtml(row.averageUnitCost)}</td>
        <td class="number">${escapeHtml(row.inventoryValue)}</td>
      </tr>
    `).join("") || `<tr><td colspan="7">ยังไม่มีข้อมูลสต๊อก</td></tr>`;
  }

  function resetProductForm() {
    productForm.reset();
    productForm.elements.id.value = "";
    renderProductCategoryOptions();
    productSubmitLabel.textContent = "บันทึกสินค้าแม่";
  }

  function resetSkuForm() {
    skuForm.reset();
    skuForm.elements.id.value = "";
    skuSubmitLabel.textContent = "บันทึก SKU";
    renderProductOptions();
  }

  function fillProductForm(product) {
    productForm.elements.id.value = product.id;
    productForm.elements.productCode.value = product.productCode;
    productForm.elements.name.value = product.name;
    productForm.elements.category.value = product.category;
    productForm.elements.description.value = product.description;
    productForm.elements.status.value = product.status;
    productSubmitLabel.textContent = "บันทึกการแก้ไข";
    productForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function fillSkuForm(sku) {
    renderProductOptions();
    skuForm.elements.id.value = sku.id;
    skuForm.elements.productId.value = sku.productId;
    skuForm.elements.sku.value = sku.sku;
    skuForm.elements.barcode.value = sku.barcode;
    skuForm.elements.color.value = sku.color;
    skuForm.elements.size.value = sku.size;
    skuForm.elements.defaultUnitCost.value = sku.defaultUnitCost;
    skuForm.elements.status.value = sku.status;
    skuSubmitLabel.textContent = "บันทึกการแก้ไข";
    skuForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function refreshProducts() {
    const { products } = await api("/api/inventory/products");
    state.products = products;
    renderProducts();
    renderProductOptions();
  }

  async function refreshProductCategories() {
    const { categories } = await api("/api/inventory/categories");
    state.productCategories = categories;
    renderProductCategoryOptions();
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
    await refreshProductCategories();
    await refreshProducts();
    await refreshSkus();
    await refreshBalances();
    await refreshStockCard();
  }

  productForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();
    try {
      const payload = formPayload(productForm);
      const id = payload.id;
      delete payload.id;
      const route = id ? `/api/inventory/products/${encodeURIComponent(id)}` : "/api/inventory/products";
      const method = id ? "PUT" : "POST";
      await api(route, { method, body: JSON.stringify(payload) });
      resetProductForm();
      await refreshAll();
      setStatus("บันทึกสินค้าแม่แล้ว", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  skuForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();
    try {
      const payload = formPayload(skuForm);
      const id = payload.id;
      delete payload.id;
      const route = id ? `/api/inventory/stock-skus/${encodeURIComponent(id)}` : "/api/inventory/stock-skus";
      const method = id ? "PUT" : "POST";
      await api(route, { method, body: JSON.stringify(payload) });
      resetSkuForm();
      await refreshAll();
      setStatus("บันทึก SKU แล้ว", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  purchaseInForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();
    try {
      await api("/api/inventory/purchase-in", { method: "POST", body: JSON.stringify(formPayload(purchaseInForm)) });
      purchaseInForm.reset();
      purchaseInForm.elements.movementDate.value = todayInputValue();
      purchaseInForm.elements.referenceType.value = "manual";
      await refreshAll();
      setStatus("รับสินค้าเข้าคลังแล้ว", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  productRows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-product]");
    if (!button) return;
    const product = state.products.find((item) => String(item.id) === button.dataset.editProduct);
    if (product) fillProductForm(product);
  });

  skuRows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-sku]");
    if (!button) return;
    const sku = state.stockSkus.find((item) => String(item.id) === button.dataset.editSku);
    if (sku) fillSkuForm(sku);
  });

  purchaseSkuSelect.addEventListener("change", () => {
    const sku = state.stockSkus.find((item) => String(item.id) === purchaseSkuSelect.value);
    if (sku && !purchaseInForm.elements.unitCost.value) {
      purchaseInForm.elements.unitCost.value = sku.defaultUnitCost;
    }
  });
  stockCardSkuSelect.addEventListener("change", () => refreshStockCard().catch((error) => setStatus(error.message, "error")));
  document.querySelector("#refreshInventory").addEventListener("click", () => refreshAll().catch((error) => setStatus(error.message, "error")));
  document.querySelector("#cancelProductEdit").addEventListener("click", resetProductForm);
  document.querySelector("#cancelSkuEdit").addEventListener("click", resetSkuForm);

  purchaseInForm.elements.movementDate.value = todayInputValue();
  refreshAll().catch((error) => setStatus(error.message, "error"));
});
