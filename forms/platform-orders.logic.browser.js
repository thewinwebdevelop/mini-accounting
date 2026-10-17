window.addEventListener("DOMContentLoaded", () => {
  const state = {
    imports: [],
    selectedImport: null,
  };

  const form = document.querySelector("#platformOrderUploadForm");
  const platformSelect = document.querySelector("#platformOrderPlatform");
  const fileInput = document.querySelector("#platformOrderFile");
  const rowsNode = document.querySelector("#platformOrderImportRows");
  const detailNode = document.querySelector("#platformOrderDetail");
  const postButton = document.querySelector("#postPlatformOrderImport");
  const statusBox = document.querySelector("#platformOrderStatusBox");
  const refreshButton = document.querySelector("#refreshPlatformOrders");

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function numberText(value) {
    return Number(value || 0).toLocaleString("th-TH");
  }

  function setStatus(message, kind = "") {
    statusBox.className = `status-box active ${kind}`;
    statusBox.textContent = message;
  }

  function clearStatus() {
    statusBox.className = "status-box";
    statusBox.textContent = "";
  }

  async function api(route, options = {}) {
    const response = await fetch(route, options);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "ดำเนินการไม่สำเร็จ");
    return result;
  }

  function statusLabel(status) {
    const labels = {
      imported: "นำเข้าแล้ว",
      ready: "พร้อมตัดสต๊อก",
      has_issues: "ต้องแก้ไข",
      posted: "ตัดสต๊อกแล้ว",
    };
    return labels[status] || status;
  }

  function renderImports() {
    rowsNode.innerHTML = state.imports.map((item) => `
      <tr>
        <td><span class="mobile-label">Import</span><span><strong>${escapeHtml(item.importNo)}</strong><div class="muted">${escapeHtml(item.fileName)}</div></span></td>
        <td><span class="mobile-label">Platform</span><span>${escapeHtml(item.platform)}</span></td>
        <td><span class="mobile-label">Status</span><span class="pill ${escapeHtml(item.status)}">${statusLabel(item.status)}</span></td>
        <td><span class="mobile-label">Rows</span><span>${numberText(item.rowCount)}</span></td>
        <td><span class="mobile-label">Issues</span><span>${numberText(item.issueCount)}</span></td>
        <td><span class="mobile-label"></span><button class="button secondary small" type="button" data-import-id="${item.id}">ดู</button></td>
      </tr>
    `).join("") || `<tr><td colspan="6">ยังไม่มี import</td></tr>`;
  }

  function renderComponents(line) {
    return (line.components || []).map((component) => `
      <div class="component-line">
        <strong>${escapeHtml(component.sku)}</strong>
        <span>${escapeHtml(component.productName)} ${escapeHtml(component.color)} ${escapeHtml(component.size)}</span>
        <span>ต้องใช้ ${numberText(component.requiredQuantity)} / คงเหลือจริง ${numberText(component.quantityOnHand)} / จองแล้ว ${numberText(component.reservedQuantity)} / พร้อมขาย ${numberText(component.availableQuantity)}</span>
      </div>
    `).join("") || `<span class="muted">ยังไม่มี component</span>`;
  }

  function renderDetail() {
    const detail = state.selectedImport;
    postButton.disabled = !detail || detail.import.status !== "ready";
    if (!detail) {
      detailNode.innerHTML = `<div class="section-body"><div class="muted">เลือก import เพื่อดูรายละเอียด</div></div>`;
      return;
    }

    detailNode.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">${escapeHtml(detail.import.importNo)}</h2>
      </div>
      <div class="section-body">
        <div class="metric-row">
          <div><span>Rows</span><strong>${numberText(detail.import.rowCount)}</strong></div>
          <div><span>Matched</span><strong>${numberText(detail.import.matchedLineCount)}</strong></div>
          <div><span>Issues</span><strong>${numberText(detail.import.issueCount)}</strong></div>
          <div><span>Status</span><strong>${statusLabel(detail.import.status)}</strong></div>
        </div>
        <div class="order-lines">
          ${detail.lines.map((line) => `
            <article class="order-line">
              <header>
                <strong>${escapeHtml(line.orderNo)} / ${escapeHtml(line.saleSku)}</strong>
                <span class="pill ${escapeHtml(line.matchStatus)}">${escapeHtml(line.matchStatus)}</span>
              </header>
              <div class="muted">${escapeHtml(line.displayName || line.buyerName || "")}</div>
              <div>จำนวนขาย: ${numberText(line.quantity)}</div>
              ${line.issueMessage ? `<div class="issue">${escapeHtml(line.issueMessage)}</div>` : ""}
              <div class="components">${renderComponents(line)}</div>
              ${line.matchStatus === "missing_sale_sku" ? `<a class="button secondary small" href="/sale-skus">แก้ Sale SKU</a>` : ""}
            </article>
          `).join("") || `<div class="muted">ยังไม่มีรายการ order</div>`}
        </div>
      </div>
    `;
  }

  async function loadImports() {
    const { imports } = await api("/api/platform-orders/imports");
    state.imports = imports;
    renderImports();
    if (!state.selectedImport && imports[0]) await loadDetail(imports[0].id);
    if (!imports[0]) renderDetail();
  }

  async function loadDetail(importId) {
    state.selectedImport = await api(`/api/platform-orders/imports/${encodeURIComponent(importId)}`);
    renderDetail();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearStatus();
    const file = fileInput.files[0];
    if (!file) {
      setStatus("เลือกไฟล์ก่อน import", "error");
      return;
    }
    try {
      const body = new FormData();
      body.append("platform", platformSelect.value);
      body.append("file", file);
      const detail = await api("/api/platform-orders/imports", {
        method: "POST",
        body,
      });
      state.selectedImport = detail;
      setStatus("Import สำเร็จ", "success");
      fileInput.value = "";
      await loadImports();
      renderDetail();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  rowsNode.addEventListener("click", (event) => {
    const button = event.target.closest("[data-import-id]");
    if (!button) return;
    loadDetail(button.dataset.importId).catch((error) => setStatus(error.message, "error"));
  });

  postButton.addEventListener("click", async () => {
    if (!state.selectedImport) return;
    try {
      const detail = await api(`/api/platform-orders/imports/${encodeURIComponent(state.selectedImport.import.id)}/post`, {
        method: "POST",
      });
      state.selectedImport = detail;
      setStatus("ตัดสต๊อกแล้ว", "success");
      await loadImports();
      renderDetail();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  refreshButton.addEventListener("click", () => {
    loadImports().catch((error) => setStatus(error.message, "error"));
  });

  loadImports().catch((error) => setStatus(error.message, "error"));
});

window.addEventListener("DOMContentLoaded", () => {
  const state = {
    orders: [],
    stockSkus: [],
    selectedOrderIds: new Set(),
    activeOrderId: null,
    batches: [],
    selections: new Map(),
    previewUrl: "",
  };
  const shopIdNode = document.querySelector("#shopeeShopId");
  const connectionStatusNode = document.querySelector("#shopeeConnectionStatus");
  const orderRowsNode = document.querySelector("#shopeeOrderRows");
  const selectedCountNode = document.querySelector("#shopeeSelectedCount");
  const orderDetailNode = document.querySelector("#shopeeOrderDetail .section-body");
  const batchStatusNode = document.querySelector("#shopeeBatchStatus");
  const batchChoicesNode = document.querySelector("#shopeeBatchChoices");
  if (!shopIdNode || !orderRowsNode) return;

  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  async function api(route, options = {}) {
    const request = { ...options, headers: { ...(options.headers || {}) } };
    if (request.body && typeof request.body !== "string") {
      request.headers["content-type"] = "application/json";
      request.body = JSON.stringify(request.body);
    }
    const response = await fetch(route, request);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "ดำเนินการ Shopee ไม่สำเร็จ");
    return result;
  }

  function shopId() {
    return shopIdNode.value.trim();
  }

  function setWorkflowStatus(message, kind = "") {
    batchStatusNode.textContent = message;
    batchStatusNode.className = `status-box active ${kind}`;
  }

  function selectedOrders() {
    return state.orders.filter((order) => state.selectedOrderIds.has(String(order.id)));
  }

  function renderOrders() {
    selectedCountNode.textContent = `${state.selectedOrderIds.size} รายการที่เลือก`;
    orderRowsNode.innerHTML = state.orders.map((order) => `
      <tr class="shopee-order-row ${state.selectedOrderIds.has(String(order.id)) ? "selected" : ""}">
        <td><input type="checkbox" data-shopee-order="${escapeHtml(order.id)}" ${state.selectedOrderIds.has(String(order.id)) ? "checked" : ""}></td>
        <td><button class="button secondary small" type="button" data-shopee-detail="${escapeHtml(order.id)}">${escapeHtml(order.orderNo)}</button><div class="muted">${escapeHtml(order.buyerName)}</div></td>
        <td><span class="pill">${escapeHtml(order.shippingStatus || order.orderStatus)}</span><div class="muted">${escapeHtml(order.shipmentActionStatus)}</div></td>
        <td><span class="pill ${order.mappingStatus === "mapped" ? "matched" : "missing_sale_sku"}">${order.mappingStatus === "mapped" ? "mapped" : "ต้อง map"}</span></td>
        <td>${escapeHtml(order.trackingNumber || order.shipmentTrackingNumber || "ยังไม่มี")}</td>
      </tr>
    `).join("") || `<tr><td colspan="5" class="muted">ยังไม่มี Shopee orders กด Sync orders ก่อน</td></tr>`;
  }

  function renderMappingDetail() {
    const order = state.orders.find((item) => String(item.id) === String(state.activeOrderId));
    if (!order) {
      orderDetailNode.innerHTML = `<div class="muted">เลือก Order ทางซ้ายเพื่อ map Stock SKU</div>`;
      return;
    }
    orderDetailNode.innerHTML = `
      <div><strong>${escapeHtml(order.orderNo)}</strong><div class="muted">${escapeHtml(order.buyerName)} / ${escapeHtml(order.shippingStatus || order.orderStatus)}</div></div>
      <div class="shopee-mapping-list">
        ${order.lines.map((line) => `
          <label class="shopee-mapping-line">
            <span><strong>${escapeHtml(line.externalModelSku || line.saleSku || line.externalItemId)}</strong><br><span class="muted">${escapeHtml(line.displayName)} × ${escapeHtml(line.quantity)}</span></span>
            <select data-shopee-mapping="${escapeHtml(line.id)}">
              <option value="">เลือก Stock SKU</option>
              ${state.stockSkus.map((sku) => `<option value="${escapeHtml(sku.id)}" ${String(sku.id) === String(line.mappedStockSkuId) ? "selected" : ""}>${escapeHtml(sku.sku)} — ${escapeHtml(sku.productName)}</option>`).join("")}
            </select>
          </label>
        `).join("") || `<div class="muted">ไม่พบรายการสินค้า</div>`}
      </div>
    `;
  }

  function renderBatchChoices() {
    const ready = state.batches.length > 0;
    document.querySelector("#arrangeShopeeShipmentButton").disabled = !ready;
    document.querySelector("#refreshShopeeTrackingButton").disabled = !ready;
    document.querySelector("#createShopeeDocumentsButton").disabled = !ready;
    document.querySelector("#overlayShopeeLabelsButton").disabled = !ready;
    document.querySelector("#printShopeeLabelsButton").disabled = !state.previewUrl;
    batchChoicesNode.innerHTML = state.batches.map((batch) => {
      const addresses = batch.pickup?.addresses || [];
      const selection = state.selections.get(String(batch.id)) || {};
      return `<article class="shopee-batch"><strong>Batch #${escapeHtml(batch.id)} / ${escapeHtml(batch.logisticsChannelId)}</strong>
        <label class="field"><span>Pickup address</span><select data-batch-address="${escapeHtml(batch.id)}"><option value="">เลือก address</option>${addresses.map((address) => `<option value="${escapeHtml(address.addressId)}" ${selection.addressId === address.addressId ? "selected" : ""}>${escapeHtml(address.fullAddress || address.addressId)}</option>`).join("")}</select></label>
        <label class="field"><span>Pickup time slot</span><select data-batch-time="${escapeHtml(batch.id)}"><option value="">เลือกเวลา</option>${addresses.flatMap((address) => address.timeSlots || []).map((slot) => `<option value="${escapeHtml(slot.pickupTimeId)}" ${selection.pickupTimeId === slot.pickupTimeId ? "selected" : ""}>${escapeHtml(slot.label || slot.pickupTimeId)}</option>`).join("")}</select></label>
        <div class="muted">สถานะ: ${escapeHtml(batch.status)} / ${batch.orders.length} packages</div></article>`;
    }).join("");
  }

  async function loadOrders() {
    const result = await api(`/api/platform-orders?shopId=${encodeURIComponent(shopId())}`);
    state.orders = result.orders || [];
    state.selectedOrderIds = new Set([...state.selectedOrderIds].filter((id) => state.orders.some((order) => String(order.id) === id)));
    if (!state.activeOrderId && state.orders[0]) state.activeOrderId = state.orders[0].id;
    renderOrders();
    renderMappingDetail();
  }

  async function loadStockSkus() {
    const result = await api("/api/inventory/stock-skus");
    state.stockSkus = result.stockSkus || result.skus || [];
  }

  async function syncOrders() {
    if (!shopId()) throw new Error("ระบุ Shop ID ก่อน Sync");
    await api("/api/shopee/sync", { method: "POST", body: { connectionId: shopId() } });
    await loadOrders();
    connectionStatusNode.textContent = "Sync orders สำเร็จ";
  }

  document.querySelector("#shopeeConnectButton").addEventListener("click", async () => {
    try {
      const result = await api("/api/shopee/authorize", { method: "POST", body: { origin: window.location.origin } });
      window.location.href = result.authorizationUrl;
    } catch (error) { connectionStatusNode.textContent = error.message; }
  });
  document.querySelector("#syncShopeeOrdersButton").addEventListener("click", () => syncOrders().catch((error) => setWorkflowStatus(error.message, "error")));
  document.querySelector("#refreshShopeeOrdersButton").addEventListener("click", () => loadOrders().catch((error) => setWorkflowStatus(error.message, "error")));
  document.querySelector("#prepareShopeeShipmentButton").addEventListener("click", async () => {
    try {
      const ids = [...state.selectedOrderIds].map(Number);
      if (!ids.length) throw new Error("เลือก Order ที่ต้องการนัดรับก่อน");
      const result = await api("/api/shopee/shipment-batches/prepare", { method: "POST", body: { connectionId: shopId(), orderIds: ids } });
      state.batches = result.batches || [];
      state.previewUrl = "";
      renderBatchChoices();
      setWorkflowStatus(`เตรียม ${state.batches.length} batch แล้ว`, "success");
    } catch (error) { setWorkflowStatus(error.message, "error"); }
  });
  document.querySelector("#arrangeShopeeShipmentButton").addEventListener("click", async () => {
    try {
      if (!state.batches.length) throw new Error("ยังไม่มี shipment batch");
      for (const batch of state.batches) {
        const selection = state.selections.get(String(batch.id)) || {};
        if (!selection.addressId || !selection.pickupTimeId) throw new Error(`เลือก address และเวลาใน Batch #${batch.id}`);
        await api(`/api/shopee/shipment-batches/${encodeURIComponent(batch.id)}/arrange`, { method: "POST", body: { connectionId: shopId(), selection } });
      }
      await loadOrders();
      setWorkflowStatus("นัดรับสินค้าสำเร็จ รอ Tracking", "success");
    } catch (error) { setWorkflowStatus(error.message, "error"); }
  });
  document.querySelector("#refreshShopeeTrackingButton").addEventListener("click", async () => {
    try {
      for (const batch of state.batches) await api(`/api/shopee/shipment-batches/${encodeURIComponent(batch.id)}/refresh-tracking`, { method: "POST", body: { connectionId: shopId() } });
      await loadOrders();
      setWorkflowStatus("Refresh Tracking แล้ว", "success");
    } catch (error) { setWorkflowStatus(error.message, "error"); }
  });
  document.querySelector("#createShopeeDocumentsButton").addEventListener("click", async () => {
    try {
      for (const batch of state.batches) {
        const result = await api(`/api/shopee/shipment-batches/${encodeURIComponent(batch.id)}/create-documents`, { method: "POST", body: { connectionId: shopId() } });
        if (result.job?.id) await api(`/api/shopee/shipping-document-jobs/${encodeURIComponent(result.job.id)}/poll`, { method: "POST", body: { connectionId: shopId() } });
      }
      setWorkflowStatus("ส่งคำขอใบปะหน้าแล้ว กดซ้ำเพื่อตรวจสอบสถานะถ้ายังไม่พร้อม", "success");
    } catch (error) { setWorkflowStatus(error.message, "error"); }
  });
  document.querySelector("#overlayShopeeLabelsButton").addEventListener("click", async () => {
    try {
      const mappings = {};
      for (const order of selectedOrders()) {
        if (order.lines.some((line) => line.mappingStatus !== "mapped" || !line.mappedStockSku)) throw new Error(`ยัง map Stock SKU ไม่ครบใน Order ${order.orderNo}`);
        mappings[order.id] = { textLines: order.lines.map((line) => `${line.mappedStockSku} × ${line.quantity}`), protectedRegions: [] };
      }
      const result = await api(`/api/shopee/shipment-batches/${encodeURIComponent(state.batches[0].id)}/overlay-labels`, { method: "POST", body: { mappings } });
      state.previewUrl = result.downloadUrl;
      renderBatchChoices();
      setWorkflowStatus("สร้าง Custom Label แล้ว", "success");
    } catch (error) { setWorkflowStatus(error.message, "error"); }
  });
  document.querySelector("#printShopeeLabelsButton").addEventListener("click", () => { if (state.previewUrl) window.open(state.previewUrl, "_blank", "noopener"); });
  orderRowsNode.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-shopee-order]");
    if (!checkbox) return;
    const id = String(checkbox.dataset.shopeeOrder);
    if (checkbox.checked) state.selectedOrderIds.add(id); else state.selectedOrderIds.delete(id);
    renderOrders();
  });
  orderRowsNode.addEventListener("click", (event) => {
    const button = event.target.closest("[data-shopee-detail]");
    if (!button) return;
    state.activeOrderId = button.dataset.shopeeDetail;
    renderMappingDetail();
  });
  orderDetailNode.addEventListener("change", async (event) => {
    const select = event.target.closest("[data-shopee-mapping]");
    if (!select) return;
    try {
      await api(`/api/platform-orders/${encodeURIComponent(select.dataset.shopeeMapping)}/sku-mapping`, { method: "POST", body: { stockSkuId: select.value || null } });
      await loadOrders();
      setWorkflowStatus("บันทึก mapping แล้ว", "success");
    } catch (error) { setWorkflowStatus(error.message, "error"); }
  });
  batchChoicesNode.addEventListener("change", (event) => {
    const address = event.target.closest("[data-batch-address]");
    const time = event.target.closest("[data-batch-time]");
    const batchId = address?.dataset.batchAddress || time?.dataset.batchTime;
    if (!batchId) return;
    const selection = state.selections.get(String(batchId)) || {};
    if (address) selection.addressId = address.value;
    if (time) selection.pickupTimeId = time.value;
    state.selections.set(String(batchId), selection);
  });

  Promise.all([loadStockSkus(), loadOrders()])
    .then(() => renderMappingDetail())
    .catch((error) => setWorkflowStatus(error.message, "error"));
});
