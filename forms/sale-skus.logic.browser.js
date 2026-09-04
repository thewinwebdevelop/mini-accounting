window.addEventListener("DOMContentLoaded", () => {
  const state = {
    saleSkus: [],
    stockSkus: [],
  };

  const form = document.querySelector("#saleSkuForm");
  const componentRows = document.querySelector("#componentRows");
  const componentTemplate = document.querySelector("#componentTemplate");
  const saleSkuRows = document.querySelector("#saleSkuRows");
  const saleSkuStatus = document.querySelector("#saleSkuStatus");
  const saleSkuListStatus = document.querySelector("#saleSkuListStatus");
  const saleSkuSearch = document.querySelector("#saleSkuSearch");
  const submitLabel = document.querySelector("#saleSkuSubmitLabel");

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function setStatus(message, kind = "") {
    saleSkuStatus.className = `status-box active ${kind}`;
    saleSkuStatus.textContent = message;
  }

  function clearStatus() {
    saleSkuStatus.className = "status-box";
    saleSkuStatus.textContent = "";
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

  function stockSkuLabel(sku) {
    return `${sku.sku} - ${sku.productCode} ${sku.productName} ${sku.color || ""} ${sku.size || ""}`.trim();
  }

  function fillStockSkuOptions(select, selectedValue = "") {
    const activeSkus = state.stockSkus.filter((sku) => sku.status !== "inactive");
    select.replaceChildren(
      option("เลือก Stock SKU", ""),
      ...activeSkus.map((sku) => option(stockSkuLabel(sku), sku.id)),
    );
    select.value = selectedValue ? String(selectedValue) : "";
  }

  function addComponent(initial = {}) {
    const fragment = componentTemplate.content.cloneNode(true);
    const row = fragment.querySelector(".component-row");
    const select = row.querySelector('select[name="stockSkuId"]');
    const quantity = row.querySelector('input[name="quantity"]');
    fillStockSkuOptions(select, initial.stockSkuId || "");
    quantity.value = initial.quantity || "1";
    componentRows.append(row);
  }

  function ensureOneComponent() {
    if (!componentRows.children.length) addComponent();
  }

  function formPayload() {
    const data = Object.fromEntries(new FormData(form).entries());
    data.components = [...componentRows.querySelectorAll(".component-row")].map((row) => ({
      stockSkuId: row.querySelector('select[name="stockSkuId"]').value,
      quantity: row.querySelector('input[name="quantity"]').value,
    })).filter((component) => component.stockSkuId || component.quantity);
    return data;
  }

  function resetForm() {
    form.reset();
    form.elements.id.value = "";
    componentRows.innerHTML = "";
    addComponent();
    submitLabel.textContent = "บันทึก Sale SKU";
    clearStatus();
  }

  function statusLabel(status) {
    return status === "inactive" ? "ปิดใช้" : "ใช้งาน";
  }

  function platformLabel(platform) {
    return {
      manual: "Manual",
      shopee: "Shopee",
      tiktok: "TikTok",
    }[platform] || platform || "-";
  }

  function componentTags(saleSku) {
    const components = Array.isArray(saleSku.components) ? saleSku.components : [];
    if (!components.length) return `<span class="muted">ยังไม่มี component</span>`;
    return `
      <div class="component-tags">
        ${components.map((component) => `<span class="pill">${escapeHtml(component.sku)} × ${component.quantity}</span>`).join("")}
      </div>
    `;
  }

  function renderSaleSkus() {
    const term = saleSkuSearch.value.trim().toLowerCase();
    const rows = state.saleSkus.filter((saleSku) => {
      const haystack = [
        saleSku.saleSku,
        saleSku.displayName,
        saleSku.platform,
        saleSku.platformProductId,
        saleSku.platformVariationId,
        ...(saleSku.components || []).flatMap((component) => [component.sku, component.productCode, component.productName]),
      ].join(" ").toLowerCase();
      return !term || haystack.includes(term);
    });
    saleSkuListStatus.textContent = rows.length ? `พบ ${rows.length} รายการ` : "ไม่พบรายการ";
    saleSkuRows.innerHTML = rows.map((saleSku) => `
      <tr>
        <td><span class="mobile-label">Sale SKU</span><strong>${escapeHtml(saleSku.saleSku)}</strong></td>
        <td>
          <span class="mobile-label">ชื่อ/Platform</span>
          <div>${escapeHtml(saleSku.displayName)}</div>
          <div class="muted">${escapeHtml(platformLabel(saleSku.platform))} ${escapeHtml([saleSku.platformProductId, saleSku.platformVariationId].filter(Boolean).join(" / "))}</div>
        </td>
        <td><span class="mobile-label">Components</span>${componentTags(saleSku)}</td>
        <td><span class="mobile-label">สถานะ</span>${escapeHtml(statusLabel(saleSku.status))}</td>
        <td><span class="mobile-label">จัดการ</span><button class="button secondary small" type="button" data-edit-sale-sku="${saleSku.id}">แก้ไข</button></td>
      </tr>
    `).join("") || `<tr><td colspan="5">ยังไม่มี Sale SKU</td></tr>`;
  }

  function fillForm(saleSku) {
    form.elements.id.value = saleSku.id;
    form.elements.saleSku.value = saleSku.saleSku;
    form.elements.displayName.value = saleSku.displayName;
    form.elements.platform.value = saleSku.platform;
    form.elements.platformProductId.value = saleSku.platformProductId || "";
    form.elements.platformVariationId.value = saleSku.platformVariationId || "";
    form.elements.status.value = saleSku.status || "active";
    componentRows.innerHTML = "";
    (saleSku.components || []).forEach(addComponent);
    ensureOneComponent();
    submitLabel.textContent = "บันทึกการแก้ไข";
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function refreshStockSkus() {
    const { stockSkus } = await api("/api/inventory/stock-skus");
    state.stockSkus = stockSkus;
    componentRows.querySelectorAll('select[name="stockSkuId"]').forEach((select) => {
      fillStockSkuOptions(select, select.value);
    });
  }

  async function refreshSaleSkus() {
    const { saleSkus } = await api("/api/inventory/sale-skus");
    state.saleSkus = saleSkus;
    renderSaleSkus();
  }

  async function refreshAll() {
    await refreshStockSkus();
    await refreshSaleSkus();
    ensureOneComponent();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();
    try {
      const payload = formPayload();
      const id = payload.id;
      delete payload.id;
      const route = id ? `/api/inventory/sale-skus/${encodeURIComponent(id)}` : "/api/inventory/sale-skus";
      const method = id ? "PUT" : "POST";
      await api(route, { method, body: JSON.stringify(payload) });
      resetForm();
      await refreshSaleSkus();
      setStatus("บันทึก Sale SKU แล้ว", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  document.querySelector("#addComponent").addEventListener("click", () => addComponent());
  document.querySelector("#cancelSaleSkuEdit").addEventListener("click", resetForm);
  componentRows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-component]");
    if (!button) return;
    button.closest(".component-row")?.remove();
    ensureOneComponent();
  });
  saleSkuRows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-sale-sku]");
    if (!button) return;
    const saleSku = state.saleSkus.find((item) => String(item.id) === button.dataset.editSaleSku);
    if (saleSku) fillForm(saleSku);
  });
  saleSkuSearch.addEventListener("input", renderSaleSkus);

  refreshAll().catch((error) => setStatus(error.message, "error"));
});
