window.addEventListener("DOMContentLoaded", () => {
  const state = {
    productCategories: [],
    products: [],
    mode: new URLSearchParams(window.location.search).get("mode") || "",
  };

  const productForm = document.querySelector("#productForm");
  const skuForm = document.querySelector("#skuForm");
  const statusBox = document.querySelector("#inventoryStatus");
  const skuProductSelect = document.querySelector("#skuProductSelect");
  const productCategorySelect = document.querySelector("#productCategory");
  const productSubmitLabel = document.querySelector("#productSubmitLabel");
  const skuSubmitLabel = document.querySelector("#skuSubmitLabel");

  function option(label, value) {
    const node = document.createElement("option");
    node.value = value;
    node.textContent = label;
    return node;
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

  function renderProductOptions() {
    const activeProducts = state.products.filter((product) => product.status !== "inactive");
    skuProductSelect.replaceChildren(
      option("เลือกสินค้าแม่", ""),
      ...activeProducts.map((product) => option(`${product.productCode} - ${product.name}`, product.id)),
    );
    window.SearchableSelect?.enhance(skuProductSelect);
  }

  function renderProductCategoryOptions() {
    const activeCategories = state.productCategories.filter((category) => category.status !== "inactive");
    productCategorySelect.replaceChildren(
      option("เลือกหมวดสินค้า", ""),
      ...activeCategories.map((category) => option(category.name, category.name)),
    );
    window.SearchableSelect?.enhance(productCategorySelect);
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
    renderProductOptions();
    skuSubmitLabel.textContent = "บันทึก SKU";
  }

  function focusCreateProductFlow() {
    if (state.mode !== "create-product") return;
    resetProductForm();
    productForm.scrollIntoView({ behavior: "smooth", block: "start" });
    productForm.elements.productCode.focus({ preventScroll: true });
  }

  function focusCreateSkuFlow(productId) {
    if (state.mode !== "create-product" || !productId) return;
    resetSkuForm();
    skuForm.elements.productId.value = productId;
    skuForm.scrollIntoView({ behavior: "smooth", block: "start" });
    skuForm.elements.sku.focus({ preventScroll: true });
  }

  async function refreshProducts() {
    const { products } = await api("/api/inventory/products");
    state.products = products;
    renderProductOptions();
  }

  async function refreshProductCategories() {
    const { categories } = await api("/api/inventory/categories");
    state.productCategories = categories;
    renderProductCategoryOptions();
  }

  async function refreshAll() {
    await refreshProductCategories();
    await refreshProducts();
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
      const result = await api(route, { method, body: JSON.stringify(payload) });
      resetProductForm();
      await refreshAll();
      focusCreateSkuFlow(result.product?.id);
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
      await refreshProducts();
      setStatus("บันทึก SKU แล้ว", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  document.querySelector("#cancelProductEdit").addEventListener("click", resetProductForm);
  document.querySelector("#cancelSkuEdit").addEventListener("click", resetSkuForm);
  document.querySelector("#refreshInventoryMaster").addEventListener("click", () => {
    refreshAll().catch((error) => setStatus(error.message, "error"));
  });

  refreshAll()
    .then(focusCreateProductFlow)
    .catch((error) => setStatus(error.message, "error"));
});
