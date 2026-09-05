window.addEventListener("DOMContentLoaded", () => {
  const state = { stockSkus: [] };
  const purchaseInForm = document.querySelector("#purchaseInForm");
  const purchaseSkuSelect = document.querySelector("#purchaseSkuSelect");
  const statusBox = document.querySelector("#inventoryPurchaseInStatus");

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

  function option(label, value, sku = null) {
    const node = document.createElement("option");
    node.value = value;
    node.textContent = label;
    if (sku) node.dataset.unitCost = sku.defaultUnitCost || "";
    return node;
  }

  function skuLabel(sku) {
    return `${sku.sku} - ${sku.productName} ${sku.color || ""} ${sku.size || ""}`.trim();
  }

  function renderSkuOptions() {
    const activeSkus = state.stockSkus.filter((sku) => sku.status !== "inactive");
    purchaseSkuSelect.replaceChildren(
      option("เลือก Stock SKU", ""),
      ...activeSkus.map((sku) => option(skuLabel(sku), sku.id, sku)),
    );
    window.SearchableSelect?.enhance(purchaseSkuSelect);
  }

  async function refreshStockSkus() {
    const { stockSkus } = await api("/api/inventory/stock-skus");
    state.stockSkus = stockSkus;
    renderSkuOptions();
  }

  purchaseSkuSelect.addEventListener("change", () => {
    const selected = purchaseSkuSelect.selectedOptions[0];
    if (selected?.dataset.unitCost && !purchaseInForm.elements.unitCost.value) {
      purchaseInForm.elements.unitCost.value = selected.dataset.unitCost;
    }
  });

  purchaseInForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();
    try {
      await api("/api/inventory/purchase-in", {
        method: "POST",
        body: JSON.stringify(formPayload(purchaseInForm)),
      });
      purchaseInForm.reset();
      purchaseInForm.elements.movementDate.value = todayInputValue();
      purchaseInForm.elements.referenceType.value = "manual";
      await refreshStockSkus();
      setStatus("รับสินค้าเข้าคลังแล้ว", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  document.querySelector("#refreshPurchaseInSkus").addEventListener("click", () => {
    refreshStockSkus().catch((error) => setStatus(error.message, "error"));
  });

  purchaseInForm.elements.movementDate.value = todayInputValue();
  refreshStockSkus().catch((error) => setStatus(error.message, "error"));
});
